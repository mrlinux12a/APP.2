const fs = require('fs');
const path = require('path');
const db = require('../db');
const { conCache } = require('./memo');

const PER_PAGINA = 40;

// Legge i valori di una variante (misura, diametro...) come elenco di testi; se non c'è niente di leggibile restituisce niente.
function valoriVariante(variante_valori) {
  try {
    const arr = typeof variante_valori === 'string' ? JSON.parse(variante_valori) : variante_valori;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch (e) {
    return null;
  }
}

// "H108xl60xp44cm" -> { lettere: ['H','L','P'], numeri: ['108','60','44'], unita: 'cm' }. Da due a tre coppie
// lettera+numero separate da "x", unità facoltativa in fondo; l'ordine delle lettere cambia da un prodotto
// all'altro (c'è anche "L1000xh400xp180"). Qualunque altra forma (Ø, Dn, gradi, più valori) non è una misura.
const RE_DIMENSIONI = /^\s*((?:[hlp]\s*\d+(?:[.,]\d+)?\s*[x×]\s*){1,2}[hlp]\s*\d+(?:[.,]\d+)?)\s*(cm|mm|m)?\s*$/i;

// Riconosce nel testo una misura tipo "H108xL60xP44cm" e la restituisce come altezza, larghezza e profondità; se non è una misura, niente.
function leggiDimensioni(testo) {
  const m = RE_DIMENSIONI.exec(String(testo));
  if (!m) return null;
  const coppie = m[1].split(/\s*[x×]\s*/i).map((c) => /^([hlp])\s*(\d.*)$/i.exec(c));
  const lettere = coppie.map((c) => c[1].toUpperCase());
  if (new Set(lettere).size !== lettere.length) return null; // "H10xh20" non descrive tre misure diverse
  return { lettere, numeri: coppie.map((c) => c[2]), unita: m[2] ? m[2].toLowerCase() : '' };
}

// Le dimensioni di una variante, ma solo se la variante è una sola misura scritta come altezza/larghezza/profondità.
function dimensioniVariante(variante_valori) {
  const arr = valoriVariante(variante_valori);
  return arr && arr.length === 1 ? leggiDimensioni(arr[0]) : null;
}

// Etichetta di una variante, per il sito (chip, pannello) e per l'app: "H108xl60xp44cm" -> "108 × 60 × 44 cm".
// Con formatta = false, o se i valori non sono dimensioni, resta quella scritta nel catalogo.
function etichettaVariante(variante_valori, formatta = true) {
  const dim = formatta ? dimensioniVariante(variante_valori) : null;
  if (dim) return dim.numeri.join(' × ') + (dim.unita ? ' ' + dim.unita : '');
  const arr = valoriVariante(variante_valori);
  return arr ? arr.join(' ') : null;
}

// Intestazioni del selettore di un prodotto con varianti. Le etichette si riscrivono come misure solo se
// TUTTE le varianti sono dimensioni con le lettere nello stesso ordine: un gruppo misto resta com'è, con
// l'occhiello "Variante" (un "H × L × P" sopra una misura che non lo è direbbe il falso).
function infoVarianti(membri) {
  const dim = membri.map((m) => dimensioniVariante(m.variante_valori));
  const ordine = dim[0] ? dim[0].lettere.join(' × ') : '';
  const sonoMisure = !!ordine && dim.every((d) => d && d.lettere.join(' × ') === ordine);
  return sonoMisure
    ? { voce: 'Misura', ordine, occhiello: 'Misura · ' + ordine, titolo: 'Scegli la misura' }
    : { voce: 'Variante', ordine: '', occhiello: 'Variante', titolo: 'Scegli la variante' };
}

// Prodotti con lo stesso gruppo_id (stesso nome principale, misure diverse) vengono
// mostrati come una sola card con un selettore di varianti, invece che una riga per
// ciascuna misura. Un prodotto senza gruppo (o i cui "fratelli" non sono più attivi)
// resta invariato: zero rischio per il catalogo esistente.
// Le query di ricerca ed elenco leggono i membri del gruppo (le varianti) insieme alle righe, come
// colonna JSON "_gruppo": un giro al DB in meno, ~50 ms su ogni ricerca ed elenco. Si manda UNA volta
// per gruppo, sulla prima riga di quel gruppo nell'ordine dei risultati: ripetuta su ogni riga, la
// stessa lista di 58 misure viaggiava decine di volte e per certe ricerche costava più della
// seconda query che sostituiva. Stessi campi che raggruppaVarianti leggeva prima; le righe senza
// "_gruppo" (altri chiamanti) ripiegano su quella query.
function membriDelGruppo(alias) {
  return `(SELECT json_build_object(
              'nome_rappresentativo', g.nome_rappresentativo,
              'membri', (SELECT json_agg(json_build_object(
                            'prodotto_id', q.id, 'nome', q.nome, 'codice', q.codice,
                            'variante_valori', q.variante_valori, 'prezzo_listino', q.prezzo_listino,
                            'sconto_base_pct', q.sconto_base_pct, 'disponibilita', q.disponibilita, 'raee', q.raee)
                          ORDER BY q.prezzo_listino, q.id)
                         FROM products q WHERE q.gruppo_id = g.id AND q.attivo = 1))
            FROM product_groups g WHERE g.id = ${alias}.gruppo_id)`;
}

// Avvolge una SELECT già ordinata e limitata aggiungendo "_gruppo". _ord numera le righe
// nell'ordine della query interna, _primo segna la prima di ogni gruppo: solo lì si calcolano
// e si mandano i membri. Non aggiunge parametri: i "?" restano quelli della query interna.
function conMembriDelGruppo(interna) {
  return `SELECT r.*, CASE WHEN r._primo THEN ${membriDelGruppo('r')} END AS _gruppo
            FROM (SELECT t.*, (t.gruppo_id IS NOT NULL
                               AND ROW_NUMBER() OVER (PARTITION BY t.gruppo_id ORDER BY t._ord) = 1) AS _primo
                    FROM (SELECT s.*, ROW_NUMBER() OVER () AS _ord FROM (${interna}) s) t) r
           ORDER BY r._ord`;
}

// Le colonne di servizio di conMembriDelGruppo non fanno parte del prodotto.
function senzaColonneDiServizio(righe) {
  return righe.map(({ _gruppo, _ord, _primo, _pri, _rn, ...resto }) => resto);
}

// Riunisce in un'unica scheda i prodotti che sono varianti dello stesso articolo (stesso gruppo), con le loro misure; gli altri restano schede
// singole.
async function raggruppaVarianti(righe) {
  const conGruppo = righe.filter((r) => r.gruppo_id);
  if (!conGruppo.length) return senzaColonneDiServizio(righe);

  const perGruppo = new Map();
  for (const r of conGruppo) {
    if (r._gruppo) {
      perGruppo.set(r.gruppo_id, { nome_rappresentativo: r._gruppo.nome_rappresentativo, membri: r._gruppo.membri || [] });
    }
  }
  if (conGruppo.some((r) => !perGruppo.has(r.gruppo_id))) {
    perGruppo.clear();
    const idGruppi = [...new Set(conGruppo.map((r) => r.gruppo_id))];
    const placeholders = idGruppi.map(() => '?').join(',');
    const gruppi = await db
      .prepare(
        `SELECT g.id, g.nome_rappresentativo,
                p.id AS prodotto_id, p.nome, p.codice, p.variante_valori,
                p.prezzo_listino, p.sconto_base_pct, p.disponibilita, p.raee
           FROM product_groups g
           JOIN products p ON p.gruppo_id = g.id
          WHERE g.id IN (${placeholders}) AND p.attivo = 1`
      )
      .all(...idGruppi);
    for (const m of gruppi) {
      if (!perGruppo.has(m.id)) perGruppo.set(m.id, { nome_rappresentativo: m.nome_rappresentativo, membri: [] });
      perGruppo.get(m.id).membri.push(m);
    }
  }

  const giaMostrati = new Set();
  const risultato = [];
  for (const r of righe) {
    if (!r.gruppo_id) {
      risultato.push(r);
      continue;
    }
    if (giaMostrati.has(r.gruppo_id)) continue; // già rappresentato da un'altra riga dello stesso gruppo
    const gruppo = perGruppo.get(r.gruppo_id);
    if (!gruppo || gruppo.membri.length < 2) {
      risultato.push(r); // fratelli non più attivi: si comporta come un prodotto singolo
      continue;
    }
    giaMostrati.add(r.gruppo_id);
    const membriOrdinati = gruppo.membri.slice().sort((a, b) => a.prezzo_listino - b.prezzo_listino);
    const rappresentante = membriOrdinati.find((m) => m.prodotto_id === r.id) || membriOrdinati[0];
    const info = infoVarianti(membriOrdinati);
    risultato.push({
      ...r,
      id: rappresentante.prodotto_id,
      nome: gruppo.nome_rappresentativo || r.nome,
      codice: rappresentante.codice,
      prezzo_listino: rappresentante.prezzo_listino,
      sconto_base_pct: rappresentante.sconto_base_pct,
      disponibilita: rappresentante.disponibilita,
      varianti_info: info,
      varianti: membriOrdinati.map((m) => ({
        id: m.prodotto_id,
        etichetta: etichettaVariante(m.variante_valori, !!info.ordine) || m.nome,
        codice: m.codice,
        prezzo_listino: m.prezzo_listino,
        sconto_base_pct: m.sconto_base_pct,
        disponibilita: m.disponibilita,
        raee: m.raee,
      })),
    });
  }
  return senzaColonneDiServizio(risultato);
}

// Equivalenze pollici -> mm SOLO per le taglie gas/impianti a pressione: verificato sui
// dati che il catalogo non usa mai "DN", e che i diametri mm "tondi" più grandi (90, 110,
// 125, 160) appartengono a tubi di scarico/pluviale senza un vero equivalente in pollici
// in questo catalogo — non vanno mai aggiunti qui.
const EQUIVALENZE_POLLICI_MM = {
  '1/8': [6, 8],
  '1/4': [8, 10],
  '3/8': [10, 12], // 12 = misura rame comune per 3/8", come 22 per 3/4"
  '1/2': [15, 20],
  '3/4': [20, 22, 25], // 22 = misura rame comune per 3/4", sempre inclusa (non solo se il materiale è rame)
  '1': [25, 32],
  '1.1/4': [32, 40],
  '1.1/2': [40, 50],
  '2': [50, 63],
  '2.1/2': [65, 76],
};

// "3/4"" -> "3/4": la stessa forma con cui è scritta la chiave delle equivalenze sopra.
function chiaveEquivalenza(termine) {
  return String(termine || '').replace(/"$/, '');
}

// Frazioni pollici scritte a parole ("un mezzo", "tre quarti"): nel catalogo non compaiono
// mai per esteso, quindi vanno tradotte nella cifra corrispondente PRIMA di spezzare la
// query in singoli termini — da lì in poi passano per la stessa pipeline di sempre
// (equivalenze mm comprese). Ordine dalla frase più lunga/specifica alla più corta, per
// non lasciare che "mezzo" da solo consumi un pezzo di "uno e mezzo" o "due e mezzo".
const SINONIMI_FRAZIONE_A_PAROLE = [
  [/\bdue\s+e\s+mezzo\b/g, '2.1/2'],
  [/\buno?\s+e\s+un\s+quarto\b/g, '1.1/4'],
  [/\buno?\s+e\s+mezzo\b/g, '1.1/2'],
  [/\btre\s+ottavi\b/g, '3/8'],
  [/\btre\s+quarti\b/g, '3/4'],
  [/\bun\s+ottavo\b/g, '1/8'],
  [/\bun\s+quarto\b/g, '1/4'],
  [/\bun\s+mezzo\b/g, '1/2'],
  [/\bmezzo\b/g, '1/2'],
];

// Riscrive le frazioni a parole ("un mezzo", "tre quarti") come cifre, così la ricerca le trova.
function sostituisciFrazioniAParole(testo) {
  return SINONIMI_FRAZIONE_A_PAROLE.reduce((acc, [pattern, sostituzione]) => acc.replace(pattern, sostituzione), testo);
}

// Parole generiche sulla misura: chi scrive "diametro"/"pollici" nella ricerca non sta
// cercando quella parola scritta nel nome (il catalogo usa quasi sempre il simbolo Ø o le
// virgolette, mai la parola per esteso — verificato: "diametro" letterale compare solo in
// 22 nomi su 27.676), sta chiedendo "prodotti con una misura", punto. Ogni parola qui sotto
// diventa quindi un controllo sul PATTERN della misura invece che sul testo letterale.
const PAROLE_GENERICHE_MISURA = {
  diametro: 'ø\\s?[0-9]|[0-9]\\s*(mm|")|diam',
  diam: 'ø\\s?[0-9]|[0-9]\\s*(mm|")|diam',
  misura: 'ø\\s?[0-9]|[0-9]\\s*(mm|")|diam',
  pollici: '[0-9]\\s*"',
  pollice: '[0-9]\\s*"',
};
const CHIAVI_PAROLE_GENERICHE_MISURA = Object.keys(PAROLE_GENERICHE_MISURA);

// Conta quante lettere bisogna cambiare, togliere o aggiungere per passare da una parola all'altra (serve a perdonare i refusi).
function distanzaLevenshtein(a, b) {
  const righe = a.length;
  const colonne = b.length;
  const dp = Array.from({ length: righe + 1 }, () => new Array(colonne + 1).fill(0));
  for (let i = 0; i <= righe; i++) dp[i][0] = i;
  for (let j = 0; j <= colonne; j++) dp[0][j] = j;
  for (let i = 1; i <= righe; i++) {
    for (let j = 1; j <= colonne; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[righe][colonne];
}

// Refusi anche sulle parole-comando sopra (non solo sui nomi prodotto): "pollicq" deve
// capire "pollice" tanto quanto "valvla" capisce "valvola" più sotto. Soglia più stretta
// (1 carattere) per le chiavi corte come "diam", più permissiva (2) per quelle lunghe —
// verificato contro un elenco di termini comuni del catalogo (valvola, raccordo, dado,
// bocchettone...) per escludere collisioni accidentali.
function correggiParolaChiave(termine) {
  if (PAROLE_GENERICHE_MISURA[termine]) return termine;
  if (termine.length < SOGLIA_MINIMA_FUZZY) return termine;
  let migliore = null;
  let distanzaMigliore = Infinity;
  for (const chiave of CHIAVI_PAROLE_GENERICHE_MISURA) {
    const distanzaMassima = chiave.length >= 7 ? 2 : 1;
    const d = distanzaLevenshtein(termine, chiave);
    if (d <= distanzaMassima && d < distanzaMigliore) {
      migliore = chiave;
      distanzaMigliore = d;
    }
  }
  return migliore || termine;
}

// Tolleranza ai refusi di battitura (richiede l'estensione pg_trgm, attivata in
// db/postgres/schema.sql): sotto i 4 caratteri il confronto per somiglianza è troppo
// rumoroso, sopra la soglia 0.45 verificata sui dati distingue bene i refusi reali
// (racordo, otone, sfeera...) dal rumore.
// Nota tecnica: l'operatore <% userebbe l'indice GIN esistente invece di scansionare
// tutta la tabella, ma legge la soglia da un'impostazione di sessione (SET
// pg_trgm.word_similarity_threshold) — impostarla una volta per connessione via
// pool.on('connect', ...) è stato provato e scartato: il listener è asincrono e il pool
// può assegnare quella stessa connessione a un'altra query prima che la SET finisca,
// causando due query concorrenti sullo stesso client (confermato da un avviso di
// deprecazione di pg proprio su questo). La ricerca lenta resta quindi sulla funzione
// esplicita, con scansione sequenziale. Quella veloce (eseguiRicerca) usa l'indice senza
// stato di sessione: la funzione SQL ricerca_simili porta la soglia nella sua clausola SET,
// che vale solo durante la chiamata (vedi db/postgres/schema.sql).
const SOGLIA_MINIMA_FUZZY = 4;
const SOGLIA_FUZZY = 0.45;
const SOGLIA_REFUSI = 0.55; // ricerca per refusi: solo le parole davvero simili (la 0.45 dell'indice è il minimo per essere candidate)

// Una ricerca vera è di poche parole: oltre questi limiti il resto del testo si ignora.
const LUNGHEZZA_MASSIMA_RICERCA = 200;
const TERMINI_MASSIMI_RICERCA = 12;

// Pattern Postgres (operatore ~*) per un diametro in mm ancorato a un confine non
// numerico: "20" non deve mai intercettare "Ø200" o "120". Uno o più valori insieme,
// es. frammentiDiametroMm([20,22,25]) -> 'ø\s?(20|22|25)(?!\d)'.
function frammentoDiametroMm(valoriMm) {
  return `ø\\s?(${valoriMm.join('|')})(?!\\d)`;
}

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria / marchio del prodotto. Scrivendo "valv" escono tutte
// le valvole; scrivendo "toshiba estia" escono le pompe di calore ESTIA.
//
// Due modi di eseguirla, con gli stessi risultati:
//  - veloce: le parole che l'indice sa cercare (3+ caratteri) diventano insiemi di id
//    (funzioni SQL ricerca_esatti / ricerca_simili, vedi db/postgres/schema.sql) che si
//    intersecano sull'indice; le altre (misure, parole di 1-2 caratteri) filtrano le poche
//    righe rimaste. ~45 ms nel DB.
//  - lenta: la vecchia query con sei LIKE in OR per parola e scansione dell'intera tabella,
//    ~220 ms. Resta come ripiego se le funzioni SQL non ci sono (schema non aggiornato).
let ricercaVeloceAttiva = true;

// Quanti risultati (schede, non righe) al massimo: la ricerca live, la pagina /cerca, quella di una categoria o di un marchio
// usano lo stesso numero. Se i risultati sono di più, l'elenco porta `troncato = true` e la pagina lo dice.
const LIMITE_RISULTATI = 100;
// I refusi di battitura si tentano solo se la ricerca esatta trova pochissimo: è una correzione ("valvla" -> "valvola"), non un
// allargamento. Prima si cercava sempre per somiglianza, e parole lunghe attiravano nomi senza alcun rapporto ("adattatore" trovava
// "contatore", "alimentatore", "scambiatore": 336 risultati su 551 erano sbagliati, più di quelli di "adatt").
const MINIMO_RISULTATI_SENZA_REFUSI = 10; // un refuso scritto uguale in 2-3 prodotti ("adatatore") non deve bastare a escludere la correzione
const LIMITE_CANDIDATI_REFUSI = 300; // colonne di testo soltanto: trasferire 1500 righe costava più di un secondo, e ne servono 100

// Il testo cercato diviso in parole (stesso taglio per la ricerca e per i refusi).
function dividiTermini(query) {
  return sostituisciFrazioniAParole(String(query || '').slice(0, LUNGHEZZA_MASSIMA_RICERCA).toLowerCase())
    .replace(/(^|\s)(dn|ø)\s+(\d)/g, '$1$2$3') // "dn 50" e "ø 20" sono una misura sola, non due parole
    .split(/\s+/)
    .map((t) => t.trim())
    // Un segno di punteggiatura da solo ("-", ".", "%") non è una parola: cercato alla lettera trovava mezzo catalogo.
    .filter((t) => /[a-zà-ú0-9]/.test(t))
    .slice(0, TERMINI_MASSIMI_RICERCA);
}

// I caratteri speciali di LIKE scritti da chi cerca valgono per sé: "%" e "_" non sono jolly ("%%" trovava tutto il catalogo, in 3 secondi).
function escapeLike(testo) {
  return String(testo).replace(/[\\%_]/g, '\\$&');
}

// Singolare e plurale ("valvola"/"valvole", "raccordo"/"raccordi", "adattatore"/"adattatori"): si cerca la radice, senza la vocale
// finale, che cambia. Prima lo faceva per caso la somiglianza; senza, "valvole" non troverebbe le "valvola". Solo parole di sole
// lettere, da 5 caratteri (con 4 la radice di 3 lettere, "tub", prenderebbe quasi tutto: "tubi" resta "tubi").
function radiceParola(t) {
  if (!/^[a-zà-ú]+$/.test(t)) return t;
  if (t.length >= 6 && /[cg](ia|ie)$/.test(t)) return t.slice(0, -2); // "doccia"/"docce" -> "docc", "valigia"/"valige" -> "valig"
  if (t.length >= 5 && /[aeio]$/.test(t)) return t.slice(0, -1);
  return t;
}

// Le parole su cui ha senso cercare un refuso: solo lettere (un "dn50" sbagliato non è un refuso di "dn40"), da 4 caratteri, e non le parole
// che hanno già un significato proprio (misure generiche, pollici).
function terminiPerRefusi(query) {
  return dividiTermini(query).filter(
    (t) =>
      t.length >= SOGLIA_MINIMA_FUZZY &&
      /^[a-zà-ú'’.-]+$/.test(t) &&
      !PAROLE_GENERICHE_MISURA[correggiParolaChiave(t)] &&
      !EQUIVALENZE_POLLICI_MM[chiaveEquivalenza(t)]
  );
}

// La riga ha, per ogni parola cercata, la parola stessa nel testo o una parola davvero vicina: al massimo 1 carattere sbagliato (2 dalle
// 8 lettere in su), anche se la parola nel prodotto è più lunga perché chi scrive non ha finito ("valvl" -> "valvola").
function corrispondeConRefusi(riga, termini) {
  const testo = [riga.nome, riga.codice, riga.categoria, riga.ean, riga.macro_slug, riga.brand_slug]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
  const parole = testo.split(/[^a-zà-ú0-9]+/).filter((w) => w.length >= 3);
  return termini.every((t) => {
    if (testo.includes(radiceParola(t))) return true;
    const k = t.length >= 8 ? 2 : 1;
    return parole.some((w) => {
      if (Math.abs(w.length - t.length) <= k && distanzaLevenshtein(t, w) <= k) return true;
      return w.length > t.length + k && distanzaLevenshtein(t, w.slice(0, t.length)) <= k;
    });
  });
}

// Segna sull'elenco dei risultati se ce n'erano altri oltre il limite ("troncato"), senza che finisca nei dati.
function conTroncato(righe, troncato) {
  Object.defineProperty(righe, 'troncato', { value: !!troncato, enumerable: false });
  return righe;
}

// La ricerca del catalogo: prima i risultati esatti, e solo se sono pochi anche quelli con refusi. Restituisce le schede (varianti riunite), al
// massimo il limite.
async function cercaProdotti(query, opzioni = {}) {
  const limite = Number(opzioni.limite) > 0 ? Math.floor(Number(opzioni.limite)) : LIMITE_RISULTATI;
  if (!dividiTermini(query).length) return conTroncato([], false); // niente di cercabile (vuoto, solo segni): non tutto il catalogo
  const esatti = await cercaConModo(query, { ...opzioni, limite, refusi: false });
  const daCorreggere = terminiPerRefusi(query);
  if (!daCorreggere.length || esatti.length >= MINIMO_RISULTATI_SENZA_REFUSI) return esatti;

  // Quasi niente di esatto: si prova a correggere i refusi. La somiglianza del DB dà molti candidati (anche sbagliati): si tengono solo
  // quelli che hanno davvero una parola vicina a quella scritta.
  // La ricerca con i refusi comprende anche tutto ciò che trova quella esatta (la somiglianza include la parte di parola), nello
  // stesso ordine: si parte da lì invece di unire i due elenchi.
  const larga = await cercaConModo(query, { ...opzioni, limite: LIMITE_CANDIDATI_REFUSI, refusi: true, soloRighe: true });
  const buone = larga.filter((r) => corrispondeConRefusi(r, daCorreggere));
  if (buone.length <= esatti.length) return esatti;
  // Solo ora si leggono le righe intere, e solo di quelle tenute (nell'ordine in cui sono).
  const tenute = buone.slice(0, limite);
  const intere = await db
    .prepare(
      `SELECT p.*, m.nome AS macro_nome, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN macro_categorie m ON m.slug = p.macro_slug
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE p.id = ANY(?::int[])`
    )
    .all(tenute.map((r) => r.id));
  const perId = new Map(intere.map((r) => [r.id, r]));
  const righe = tenute.map((r) => perId.get(r.id)).filter(Boolean);
  return conTroncato(await raggruppaVarianti(righe), buone.length > limite);
}

// Esegue la ricerca nel modo veloce (funzioni SQL con indice); se non è disponibile o fallisce, ripiega sul modo lento con lo stesso risultato.
async function cercaConModo(query, opzioni) {
  if (ricercaVeloceAttiva) {
    try {
      return await eseguiRicerca(query, opzioni, true);
    } catch (e) {
      if (e.code !== '42883') throw e; // 42883 = funzione inesistente
      ricercaVeloceAttiva = false;
      console.warn(
        '[ricerca] funzioni SQL non trovate: uso la ricerca lenta. Applica lo schema: node scripts/apply_schema_pg.js'
      );
    }
  }
  return eseguiRicerca(query, opzioni, false);
}

// Stessa espressione dell'indice idx_products_ricerca_trgm: scritta identica lo usa.
function testoRicerca(alias) {
  return `ricerca_testo(${alias}.nome, ${alias}.codice, ${alias}.categoria, ${alias}.ean, ${alias}.macro_slug, ${alias}.brand_slug)`;
}

// Costruisce ed esegue la query di ricerca vera: parole, misure e filtri (categoria, marchio, sottocategoria), una riga per gruppo di varianti e il
// limite sulle schede.
async function eseguiRicerca(
  query,
  {
    macroSlug = null, brandSlug = null, famiglia = null, sotto = null, misura = null,
    materiale = null, diametro = null, limite = LIMITE_RISULTATI, refusi = false, soloRighe = false,
  } = {},
  veloce = true
) {
  // Il testo cercato ha un tetto di lunghezza e di parole: ogni parola aggiunge condizioni e parametri alla
  // query, e un testo di migliaia di parole superava il limite di parametri di Postgres (errore 500).
  const termini = dividiTermini(query);

  // I filtri espliciti arrivano dalla query string: se non sono testo (vecchi link, richieste a mano) si
  // ignorano invece di far fallire la ricerca con un TypeError.
  materiale = typeof materiale === 'string' ? materiale : null;
  diametro = typeof diametro === 'string' ? diametro : null;

  const where = ['p.attivo = 1'];
  const params = [];

  // Gli stessi filtri della pagina da cui si cerca: chi sta sfogliando una famiglia
  // cerca dentro quella famiglia, non in tutto il catalogo.
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (brandSlug) {
    where.push('p.brand_slug = ?');
    params.push(brandSlug);
  }
  if (famiglia) {
    where.push('p.famiglia = ?');
    params.push(famiglia);
  }
  if (sotto) {
    where.push('EXISTS (SELECT 1 FROM product_sottocategorie ps WHERE ps.product_id = p.id AND ps.sottocategoria_slug = ?)');
    params.push(sotto);
  }
  if (misura) {
    where.push('p.misura = ?');
    params.push(misura);
  }
  // Filtro esplicito per materiale, isolato dal testo digitato liberamente in "query".
  if (materiale) {
    where.push('LOWER(p.nome) LIKE ?');
    params.push(`%${escapeLike(materiale.toLowerCase())}%`);
  }
  // Filtro esplicito per diametro: accetta sia la forma mm ("20 mm") sia quella in
  // pollici ('3/4"'), isolato dal testo digitato liberamente in "query".
  if (diametro) {
    const mm = diametro.match(/^(\d{2,3})\s?mm$/i);
    if (mm) {
      where.push('p.nome ~* ?');
      params.push(frammentoDiametroMm([mm[1]]));
    } else {
      const pollici = chiaveEquivalenza(diametro).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.push('p.nome ~* ?');
      params.push(`${pollici}\\s*"`);
    }
  }

  // Nella ricerca lenta ogni parola è una condizione in AND sulla riga (finisce in where); in
  // quella veloce le parole che l'indice sa cercare diventano "candidati" da intersecare e le
  // altre restano condizioni sulle righe rimaste (filtri).
  const filtri = [];
  const paramsFiltri = [];
  const candidati = [];
  const paramsCandidati = [];
  const aggiungi = (condizione, ...valori) => {
    if (veloce) {
      filtri.push(condizione);
      paramsFiltri.push(...valori);
    } else {
      where.push(condizione);
      params.push(...valori);
    }
  };

  for (const t of termini) {
    const bloccoBase = `(LOWER(p.nome) LIKE ? OR LOWER(p.codice) LIKE ? OR LOWER(COALESCE(p.categoria, '')) LIKE ?
        OR LOWER(COALESCE(m.nome, '')) LIKE ? OR LOWER(COALESCE(b.nome, '')) LIKE ?
        OR LOWER(COALESCE(p.ean, '')) LIKE ?)`;
    // Singolare/plurale: il termine intero si cerca come sempre in tutto il testo (nome, codice, categoria, marchio), la radice senza vocale
    // finale solo nel NOME ("valvole" trova anche le "valvola", ma "rubinetto" non pesca tutta la categoria "Rubinetteria").
    const radice = radiceParola(t);
    const conRadice = radice !== t;
    const cerca = radice; // per i candidati dell'indice si parte dalla radice (più larga); il filtro sotto stringe
    const like = `%${escapeLike(t)}%`;
    const likeRadice = `%${escapeLike(radice)}%`;
    const paramsBase = [like, like, like, like, like, like];

    // "ø20" / "dn50" / "ø20mm": la misura intera, con un confine dopo il numero (prima "ø20" trovava anche "Ø200" e "Ø250").
    const misuraSigla = t.match(/^(dn|ø)(\d{1,4})(?:mm)?$/);
    if (misuraSigla) {
      aggiungi('p.nome ~* ?', `${misuraSigla[1]}\\s?${misuraSigla[2]}(?!\\d)`);
      continue;
    }

    // Parola generica sulla misura ("diametro", "pollici"...): il catalogo non scrive mai
    // quella parola per esteso, quindi cercarla alla lettera non troverebbe nulla anche
    // quando il prodotto ha eccome un diametro (es. "Detentore...Ø3/8"..."). Sostituisce
    // l'intero blocco con un controllo sul pattern della misura, non sul testo letterale.
    // correggiParolaChiave tollera anche i refusi su queste parole-comando (es. "pollicq").
    const patternGenerico = PAROLE_GENERICHE_MISURA[correggiParolaChiave(t)];
    if (patternGenerico) {
      aggiungi('p.nome ~* ?', patternGenerico);
      continue;
    }

    // Il termine digitato è una misura in pollici riconosciuta (es. "3/4", '3/4"'): oltre
    // al confronto testuale letterale di sempre, si prova anche il match sui millimetri
    // equivalenti scritti nel nome — solo su nome (mai su codice/categoria/marchio/ean,
    // per non allargare la superficie di falsi positivi a campi dove un "20" nudo
    // significherebbe altro).
    const equivalenti = EQUIVALENZE_POLLICI_MM[chiaveEquivalenza(t)];
    if (equivalenti) {
      if (veloce) aggiungi(`(${testoRicerca('p')} LIKE ? OR p.nome ~* ?)`, like, frammentoDiametroMm(equivalenti));
      else aggiungi(`(${bloccoBase} OR p.nome ~* ?)`, ...paramsBase, frammentoDiametroMm(equivalenti));
    } else if (refusi && t.length >= SOGLIA_MINIMA_FUZZY && /^[a-zà-ú'’.-]+$/.test(t)) {
      // Solo nel secondo tentativo (vedi cercaProdotti), quando la ricerca esatta non ha trovato quasi nulla. Tollera i refusi di battitura (es. "valvla" invece di "valvola"): oltre al
      // confronto esatto di sempre, prova anche una corrispondenza per somiglianza
      // (pg_trgm) su una parola del nome. Solo dai 4 caratteri in su: sotto, la
      // somiglianza è troppo rumorosa (quasi tutto assomiglierebbe a quasi tutto).
      if (veloce) {
        candidati.push('SELECT ricerca_simili(?)');
        paramsCandidati.push(cerca);
        // L'indice dà tutto ciò che supera 0.45 (migliaia di righe, per lo più sbagliate: trasferirle costava più di un secondo). I refusi
        // veri stanno sopra 0.55 (misurato: "valvla" 0.57, "racordo" 0.70, "adatatore" 0.75): qui si scarta il resto.
        aggiungi(`(${testoRicerca('p')} LIKE ? OR word_similarity(?, LOWER(p.nome)) >= ${SOGLIA_REFUSI})`, like, t);
      } else {
        aggiungi(`(${bloccoBase} OR word_similarity(?, LOWER(p.nome)) > ${SOGLIA_FUZZY})`, ...paramsBase, cerca);
      }
    } else if (veloce && t.length >= 3) {
      // 3 caratteri o più, senza refusi: l'indice trigram cerca la parte di parola.
      candidati.push('SELECT ricerca_esatti(?)');
      paramsCandidati.push(escapeLike(cerca));
      // I candidati partono dalla radice (più larga): qui si stringe a "il termine intero ovunque, oppure la radice nel nome".
      if (conRadice) aggiungi(`(${testoRicerca('p')} LIKE ? OR LOWER(p.nome) LIKE ?)`, like, likeRadice);
    } else if (veloce) {
      // 1-2 caratteri (es. "16", "3"): l'indice non li aiuta, si controllano le righe rimaste.
      aggiungi(`${testoRicerca('p')} LIKE ?`, like);
    } else if (conRadice) {
      aggiungi(`(${bloccoBase} OR LOWER(p.nome) LIKE ?)`, ...paramsBase, likeRadice);
    } else {
      aggiungi(bloccoBase, ...paramsBase);
    }
  }

  // Chi inizia con il testo digitato viene prima (cercando "valv" prima le "Valvola ...").
  const primoTermine = termini[0] ? `${escapeLike(termini[0])}%` : null;
  const priorita = primoTermine
    ? 'CASE WHEN LOWER(p.nome) LIKE ? THEN 0 WHEN LOWER(p.codice) LIKE ? THEN 1 ELSE 2 END'
    : '0';
  const paramsPriorita = primoTermine ? [primoTermine, primoTermine] : [];

  // La ricerca e la finestra per gruppo lavorano su poche colonne (id, gruppo, categoria, nome, prezzo, priorità): le righe intere
  // si leggono solo per i risultati finali. Sulle righe intere la stessa ricerca costava ~70 ms in più.
  const colonne = `p.id, p.gruppo_id, p.categoria, p.nome, p.codice, p.ean, p.macro_slug, p.brand_slug, p.prezzo_listino, ${priorita} AS _pri`;
  const join = 'LEFT JOIN macro_categorie m ON m.slug = p.macro_slug LEFT JOIN brands b ON b.slug = p.brand_slug';

  let interna;
  let paramsInterna;
  if (veloce && candidati.length) {
    // Prima si restringe ai candidati dell'indice, poi si applicano i filtri (misure, parole
    // corte) alle sole righe rimaste: senza OFFSET 0 il planner fonde i due livelli e
    // valuta i filtri su tutte le 27.676 righe.
    const sorgente = `(SELECT p.* FROM products p
                        WHERE ${where.join(' AND ')} AND p.id IN (${candidati.join(' INTERSECT ')})
                        OFFSET 0)`;
    interna = `SELECT ${colonne} FROM ${sorgente} p ${join}
                ${filtri.length ? 'WHERE ' + filtri.join(' AND ') : ''}`;
    paramsInterna = [...paramsPriorita, ...params, ...paramsCandidati, ...paramsFiltri];
  } else {
    interna = `SELECT ${colonne} FROM products p ${join}
                WHERE ${[...where, ...filtri].join(' AND ')}`;
    paramsInterna = [...paramsPriorita, ...params, ...paramsFiltri];
  }

  // UNA riga per gruppo di varianti PRIMA del limite: prima il LIMIT contava le righe (le singole misure) e solo dopo
  // raggruppaVarianti le riuniva in una scheda, quindi con un limite di 60 si vedevano da 23 a 54 schede a seconda della ricerca
  // (cercando "adatt" 23, "adattatore" 50) e il resto veniva tagliato senza dirlo. Ora il limite conta le schede.
  // La riga che rappresenta il gruppo è la prima nell'ordine sotto (stessa regola di prima). Si chiede una riga in più per sapere se
  // l'elenco è stato tagliato. In fondo prezzo e id: a parità di categoria e nome l'ordine era arbitrario (cambiava col piano di
  // esecuzione), e da lì dipende quale variante fa da "default" nella scheda di un gruppo: a parità di nome vince la più economica.
  const ordine = 's._pri, s.categoria, s.nome, s.prezzo_listino, s.id';
  const sql = `SELECT p.*, m.nome AS macro_nome, b.nome AS brand_nome, b.colore AS brand_colore
                 FROM (SELECT u.id, u._pri, u.categoria, u.nome, u.prezzo_listino
                         FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(s.gruppo_id, -s.id) ORDER BY ${ordine}) AS _rn
                                 FROM (${interna}) s) u
                        WHERE u._rn = 1
                        ORDER BY u._pri, u.categoria, u.nome, u.prezzo_listino, u.id
                        LIMIT ?) r
                 JOIN products p ON p.id = r.id
                 LEFT JOIN macro_categorie m ON m.slug = p.macro_slug
                 LEFT JOIN brands b ON b.slug = p.brand_slug
                ORDER BY r._pri, r.categoria, r.nome, r.prezzo_listino, r.id`;

  // soloRighe: righe una per gruppo, senza le varianti: serve al ripiego dei refusi, che ne scarta la maggior parte e raggruppa solo
  // quelle tenute (il JSON dei membri per 1500 gruppi costava più di tutto il resto).
  if (soloRighe) {
    return db
      .prepare(
        `SELECT u.id, u.nome, u.codice, u.categoria, u.ean, u.macro_slug, u.brand_slug
           FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(s.gruppo_id, -s.id) ORDER BY ${ordine}) AS _rn
                   FROM (${interna}) s) u
          WHERE u._rn = 1
          ORDER BY u._pri, u.categoria, u.nome, u.prezzo_listino, u.id
          LIMIT ?`
      )
      .all(...paramsInterna, limite + 1);
  }
  const righeGrezze = await db.prepare(conMembriDelGruppo(sql)).all(...paramsInterna, limite + 1);
  const schede = await raggruppaVarianti(righeGrezze);
  return conTroncato(schede.slice(0, limite), schede.length > limite);
}

// ---------- Macro categorie ----------

// macroCategorie, sottocategorieDi, macroCategoria e contaProdottiConFoto sono in cache per
// 60 secondi (vedi memo.js): il server non le modifica mai, e i conteggi sono la parte più
// lenta di home e categorie. Una modifica fatta da script compare entro un minuto.
// Immagine di una categoria (richiesta esplicita del 22/10/2026, sostituisce l'icona su sfondo azzurro nella griglia della home): public/img/categorie/<slug>.svg, si propone
// SOLO se il file c'è (stessa logica di `fotoSottocategoria`: un file mancante sotto /img non è un 404 innocuo, passa da sessione e query). Il controllo sta dentro
// macroCategorie/macroCategoria, che sono in cache 60 s: niente `fs.access` a ogni richiesta, e un file tolto o aggiunto compare entro un minuto. "Riscaldamento e Caldaie" ed
// "Elementi con foto" non hanno il file e restano con la loro icona.
const CARTELLA_IMMAGINI_CATEGORIE = path.join(__dirname, '..', 'public', 'img', 'categorie');

// L'indirizzo dell'immagine di una categoria, se il file esiste; altrimenti niente (e il sito usa l'icona).
async function immagineCategoria(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) return null; // lo slug viene dal DB, ma non si costruisce mai un percorso da un valore strano
  try {
    await fs.promises.access(path.join(CARTELLA_IMMAGINI_CATEGORIE, slug + '.svg'));
    return '/img/categorie/' + slug + '.svg';
  } catch (e) {
    return null;
  }
}

const macroCategorie = conCache(60 * 1000, async function macroCategorie() {
  const righe = await db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.macro_slug = m.slug AND p.attivo = 1) AS n_prodotti
         FROM macro_categorie m
        ORDER BY m.priorita, m.ordine, m.nome`
    )
    .all();
  const immagini = await Promise.all(righe.map((m) => immagineCategoria(m.slug)));
  return righe.map((m, i) => ({ ...m, immagine: immagini[i] }));
});

// Le due liste della home con una sola lettura: le categorie che in cantiere si cercano più spesso (in
// cima) e le altre con almeno un prodotto. Il conteggio dei prodotti è la query più lenta della home.
// "Riscaldamento e Caldaie" sta SEMPRE per ultima fra le categorie (richiesta esplicita del 22/10/2026), qualunque sia la sua priorità nel DB: sito e app mostrano
// `inEvidenza` poi `altre`, quindi la si toglie da dov'è e la si mette in fondo ad `altre`. "Elementi con foto" non è una categoria e resta l'ultima tessera della home.
const CATEGORIA_IN_FONDO = 'riscaldamento-e-caldaie';

// Le categorie per la home: quelle in evidenza e, per ultima, "Riscaldamento e Caldaie".
async function categorieHome() {
  const cats = await macroCategorie();
  const inFondo = cats.filter((m) => m.slug === CATEGORIA_IN_FONDO && (m.in_evidenza === 1 || m.n_prodotti > 0));
  return {
    inEvidenza: cats.filter((m) => m.in_evidenza === 1 && m.slug !== CATEGORIA_IN_FONDO),
    altre: cats.filter((m) => m.in_evidenza !== 1 && m.n_prodotti > 0 && m.slug !== CATEGORIA_IN_FONDO).concat(inFondo),
  };
}

// ---------- Sottocategorie e misure ----------

// Foto delle sottocategorie: la tabella non ha una colonna immagine, vale la convenzione
// public/img/sottocategorie/<slug>.webp. "varie" esiste in ogni categoria, quindi lì il file è
// <macro>-varie.webp. Si propone solo se il file c'è: un'immagine mancante non è un errore innocuo, perché
// /img cade nel resto dell'app (sessione e query delle viste) prima di arrivare al 404.
const CARTELLA_FOTO_SOTTO = path.join(__dirname, '..', 'public', 'img', 'sottocategorie');

// L'indirizzo della foto di una sottocategoria, se il file esiste; altrimenti niente.
async function fotoSottocategoria(macroSlug, slug) {
  const file = (slug === 'varie' ? macroSlug + '-varie' : slug) + '.webp';
  try {
    await fs.promises.access(path.join(CARTELLA_FOTO_SOTTO, file));
    return '/img/sottocategorie/' + file;
  } catch (e) {
    return null;
  }
}

const sottocategorieDi = conCache(60 * 1000, async function sottocategorieDi(macroSlug) {
  const rows = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM products p
                     JOIN product_sottocategorie ps ON ps.product_id = p.id
                     WHERE ps.macro_slug = s.macro_slug AND ps.sottocategoria_slug = s.slug AND p.attivo = 1) AS n
         FROM sottocategorie s
        WHERE s.macro_slug = ?
        ORDER BY s.ordine, s.nome`
    )
    .all(macroSlug);
  const conArticoli = rows.filter((s) => s.n > 0);
  const foto = await Promise.all(conArticoli.map((s) => fotoSottocategoria(macroSlug, s.slug)));
  return conArticoli.map((s, i) => ({ ...s, foto: foto[i] }));
});

// Una sottocategoria, cercata per categoria madre e nome breve.
async function sottocategoria(macroSlug, slug) {
  return db
    .prepare('SELECT * FROM sottocategorie WHERE macro_slug = ? AND slug = ?')
    .get(macroSlug, slug);
}

// Marchi presenti dentro una categoria: la categoria è il livello principale,
// il marchio è un filtro che sta sotto.
async function marchiNellaCategoria({ macroSlug = null, sotto = null } = {}) {
  const where = ["p.attivo = 1", "p.brand_slug <> ''"];
  const params = [];
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (sotto) {
    where.push('EXISTS (SELECT 1 FROM product_sottocategorie ps WHERE ps.product_id = p.id AND ps.sottocategoria_slug = ?)');
    params.push(sotto);
  }
  return db
    .prepare(
      `SELECT b.slug, b.nome, b.colore, b.iniziali, COUNT(*) AS n
         FROM products p JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where.join(' AND ')}
        GROUP BY b.slug, b.nome, b.colore, b.iniziali
        ORDER BY n DESC`
    )
    .all(...params);
}

const macroCategoria = conCache(60 * 1000, async function macroCategoria(slug) {
  const macro = await db.prepare('SELECT * FROM macro_categorie WHERE slug = ?').get(slug);
  return macro ? { ...macro, immagine: await immagineCategoria(macro.slug) } : macro;
});

// ---------- Elenchi paginati ----------

// Il totale di un elenco cambia solo quando si importa il catalogo: si ricorda per 60 s (come
// macroCategorie) e vale per tutte le pagine dello stesso elenco, che prima lo ricalcolavano
// a ogni pagina scorsa.
// Conta le SCHEDE, non i prodotti: una famiglia di misure (gruppo di varianti) è una scheda sola, come nell'elenco.
const contaRighe = conCache(60 * 1000, async (where, params) => {
  const row = await db.prepare(`SELECT COUNT(DISTINCT COALESCE(p.gruppo_id, -p.id)) AS n FROM products p WHERE ${where}`).get(...params);
  return row ? Number(row.n) : 0;
});

// Un elenco di prodotti a pagine: conta le schede (non i singoli prodotti), legge la pagina richiesta e riunisce le varianti.
async function paginato({ where, params, pagina = 1, perPagina = PER_PAGINA }) {
  const leggiPagina = (p) =>
    db
      .prepare(
        // Una riga per gruppo di varianti PRIMA di LIMIT/OFFSET: prima una pagina erano 40 prodotti che raggruppaVarianti riuniva in
        // meno schede (da 2 a 34 invece di 40 in "Raccorderia e valvole"), e la stessa famiglia, con le sue misure sparse fra più
        // pagine, ricompariva in ognuna. Il gruppo sta dove sta il suo primo membro nell'ordine di sempre. La finestra lavora su
        // quattro colonne (id, nome, prezzo, gruppo) e solo le righe della pagina si rileggono intere: sulle righe intere costava ~80 ms.
        conMembriDelGruppo(
          `SELECT p.*, b.nome AS brand_nome, b.colore AS brand_colore
             FROM (SELECT t.id, t.nome, t.prezzo_listino
                     FROM (SELECT p.id, p.nome, p.prezzo_listino,
                                  ROW_NUMBER() OVER (PARTITION BY COALESCE(p.gruppo_id, -p.id)
                                                     ORDER BY p.nome, p.prezzo_listino, p.id) AS _rn
                             FROM products p
                            WHERE ${where}) t
                    WHERE t._rn = 1
                    ORDER BY t.nome, t.prezzo_listino, t.id
                    LIMIT ? OFFSET ?) pagina
             JOIN products p ON p.id = pagina.id
             LEFT JOIN brands b ON b.slug = p.brand_slug
            ORDER BY p.nome, p.prezzo_listino, p.id`
        )
      )
      .all(...params, perPagina, (p - 1) * perPagina);

  // Totale e pagina partono insieme: prima erano in fila, una andata e ritorno al DB in più
  // a ogni apertura di un elenco.
  // Tetto alla pagina richiesta: un numero enorme (?p=99999999999999999999) dava un OFFSET fuori scala
  // per Postgres e un 500 invece dell'ultima pagina.
  const richiesta = Math.min(1000000, Math.max(1, parseInt(pagina, 10) || 1));
  const [totale, prima] = await Promise.all([contaRighe(where, params), leggiPagina(richiesta)]);

  const pagine = Math.max(1, Math.ceil(totale / perPagina));
  const p = Math.min(richiesta, pagine);
  // Pagina oltre l'ultima (raro): si legge quella giusta.
  const righeGrezze = p === richiesta ? prima : await leggiPagina(p);
  const righe = await raggruppaVarianti(righeGrezze);

  return { righe, totale, pagina: p, pagine, perPagina };
}

// Prodotti di una categoria, filtrabili per sottocategoria, misura e marchio.
// materiale/diametro accettati per simmetria con cercaProdotti() (stessa logica di
// estrazione dal testo, vedi sopra) — non ancora collegati a un filtro visibile in
// categoria.ejs, pronti per quando si deciderà di estenderla.
async function prodottiDellaCategoria(
  macroSlug,
  { sotto = null, misura = null, marchio = null, materiale = null, diametro = null, pagina = 1 } = {}
) {
  const where = ['p.attivo = 1', 'p.macro_slug = ?'];
  const params = [macroSlug];
  if (sotto) {
    where.push('EXISTS (SELECT 1 FROM product_sottocategorie ps WHERE ps.product_id = p.id AND ps.sottocategoria_slug = ?)');
    params.push(sotto);
  }
  if (misura) {
    where.push('p.misura = ?');
    params.push(misura);
  }
  if (marchio) {
    where.push('p.brand_slug = ?');
    params.push(marchio);
  }
  if (materiale) {
    where.push('LOWER(p.nome) LIKE ?');
    params.push(`%${materiale.toLowerCase()}%`);
  }
  if (diametro) {
    const mm = diametro.match(/^(\d{2,3})\s?mm$/i);
    if (mm) {
      where.push('p.nome ~* ?');
      params.push(frammentoDiametroMm([mm[1]]));
    } else {
      const pollici = chiaveEquivalenza(diametro).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.push('p.nome ~* ?');
      params.push(`${pollici}\\s*"`);
    }
  }
  return paginato({ where: where.join(' AND '), params, pagina });
}

// Vetrina trasversale alle categorie: tutti i prodotti che hanno già una foto, qualunque
// sia la marca/categoria. Cresce da sola man mano che si aggiungono foto — non è un elenco
// fisso da aggiornare a mano.
async function prodottiConFoto({ pagina = 1 } = {}) {
  return paginato({ where: 'p.attivo = 1 AND p.foto_url IS NOT NULL', params: [], pagina });
}

const contaProdottiConFoto = conCache(60 * 1000, async function contaProdottiConFoto() {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM products WHERE attivo = 1 AND foto_url IS NOT NULL')
    .get();
  return row ? Number(row.n) : 0;
});

// ---------- Marchi ----------

async function marchi() {
  return db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_slug = b.slug AND p.attivo = 1) AS n_prodotti
         FROM brands b
        WHERE b.attivo = 1
        ORDER BY b.ordine, b.nome`
    )
    .all();
}

// Un marchio attivo, cercato per nome breve.
async function marchio(slug) {
  return db.prepare('SELECT * FROM brands WHERE slug = ? AND attivo = 1').get(slug);
}

// Le famiglie di prodotti di un marchio, con quanti prodotti attivi hanno.
async function famiglieDelMarchio(slug) {
  return db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM products p
                WHERE p.brand_slug = f.brand_slug AND p.famiglia = f.codice AND p.attivo = 1) AS n_prodotti
         FROM brand_families f
        WHERE f.brand_slug = ?
        ORDER BY f.ordine, f.nome`
    )
    .all(slug);
}

// Una famiglia di un marchio, cercata per codice.
async function famigliaDelMarchio(slug, codice) {
  return db
    .prepare('SELECT * FROM brand_families WHERE brand_slug = ? AND codice = ?')
    .get(slug, codice);
}

// I prodotti di un marchio (o di una sua famiglia), a pagine.
async function prodottiDelMarchio(slug, famiglia, pagina) {
  if (famiglia) {
    return paginato({
      where: 'p.attivo = 1 AND p.brand_slug = ? AND p.famiglia = ?',
      params: [slug, famiglia],
      pagina,
    });
  }
  return paginato({
    where: 'p.attivo = 1 AND p.brand_slug = ?',
    params: [slug],
    pagina,
  });
}

module.exports = {
  PER_PAGINA,
  etichettaVariante,
  infoVarianti,
  raggruppaVarianti,
  cercaProdotti,
  macroCategorie,
  immagineCategoria,
  categorieHome,
  macroCategoria,
  sottocategorieDi,
  sottocategoria,
  marchiNellaCategoria,
  prodottiDellaCategoria,
  prodottiConFoto,
  contaProdottiConFoto,
  marchi,
  marchio,
  famiglieDelMarchio,
  famigliaDelMarchio,
  prodottiDelMarchio,
  LIMITE_RISULTATI,
  // solo per le prove (test/ricerca.test.js)
  _prova: { radiceParola, terminiPerRefusi, corrispondeConRefusi },
};
