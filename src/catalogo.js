const db = require('../db');

const PER_PAGINA = 40;

function etichettaVariante(variante_valori) {
  try {
    const arr = typeof variante_valori === 'string' ? JSON.parse(variante_valori) : variante_valori;
    return Array.isArray(arr) && arr.length ? arr.join(' ') : null;
  } catch (e) {
    return null;
  }
}

// Prodotti con lo stesso gruppo_id (stesso nome principale, misure diverse) vengono
// mostrati come una sola card con un selettore di varianti, invece che una riga per
// ciascuna misura. Un prodotto senza gruppo (o i cui "fratelli" non sono più attivi)
// resta invariato: zero rischio per il catalogo esistente.
async function raggruppaVarianti(righe) {
  const idGruppi = [...new Set(righe.filter((r) => r.gruppo_id).map((r) => r.gruppo_id))];
  if (!idGruppi.length) return righe;

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

  const perGruppo = new Map();
  for (const m of gruppi) {
    if (!perGruppo.has(m.id)) perGruppo.set(m.id, { nome_rappresentativo: m.nome_rappresentativo, membri: [] });
    perGruppo.get(m.id).membri.push(m);
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
    risultato.push({
      ...r,
      id: rappresentante.prodotto_id,
      nome: gruppo.nome_rappresentativo || r.nome,
      codice: rappresentante.codice,
      prezzo_listino: rappresentante.prezzo_listino,
      sconto_base_pct: rappresentante.sconto_base_pct,
      disponibilita: rappresentante.disponibilita,
      varianti: membriOrdinati.map((m) => ({
        id: m.prodotto_id,
        etichetta: etichettaVariante(m.variante_valori) || m.nome,
        codice: m.codice,
        prezzo_listino: m.prezzo_listino,
        sconto_base_pct: m.sconto_base_pct,
        disponibilita: m.disponibilita,
        raee: m.raee,
      })),
    });
  }
  return risultato;
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
// deprecazione di pg proprio su questo). Si resta quindi sulla funzione esplicita,
// con scansione sequenziale — più lenta ma senza rischi di concorrenza.
const SOGLIA_MINIMA_FUZZY = 4;
const SOGLIA_FUZZY = 0.45;

// Pattern Postgres (operatore ~*) per un diametro in mm ancorato a un confine non
// numerico: "20" non deve mai intercettare "Ø200" o "120". Uno o più valori insieme,
// es. frammentiDiametroMm([20,22,25]) -> 'ø\s?(20|22|25)(?!\d)'.
function frammentoDiametroMm(valoriMm) {
  return `ø\\s?(${valoriMm.join('|')})(?!\\d)`;
}

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria / marchio del prodotto. Scrivendo "valv" escono tutte
// le valvole; scrivendo "toshiba estia" escono le pompe di calore ESTIA.
async function cercaProdotti(
  query,
  {
    macroSlug = null, brandSlug = null, famiglia = null, sotto = null, misura = null,
    materiale = null, diametro = null, limite = 100,
  } = {}
) {
  const termini = sostituisciFrazioniAParole(String(query || '').toLowerCase())
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

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
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  if (misura) {
    where.push('p.misura = ?');
    params.push(misura);
  }
  // Filtro esplicito per materiale, isolato dal testo digitato liberamente in "query".
  if (materiale) {
    where.push('LOWER(p.nome) LIKE ?');
    params.push(`%${materiale.toLowerCase()}%`);
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

  for (const t of termini) {
    const bloccoBase = `(LOWER(p.nome) LIKE ? OR LOWER(p.codice) LIKE ? OR LOWER(COALESCE(p.categoria, '')) LIKE ?
        OR LOWER(COALESCE(m.nome, '')) LIKE ? OR LOWER(COALESCE(b.nome, '')) LIKE ?
        OR LOWER(COALESCE(p.ean, '')) LIKE ?)`;
    const like = `%${t}%`;
    const paramsBase = [like, like, like, like, like, like];

    // Parola generica sulla misura ("diametro", "pollici"...): il catalogo non scrive mai
    // quella parola per esteso, quindi cercarla alla lettera non troverebbe nulla anche
    // quando il prodotto ha eccome un diametro (es. "Detentore...Ø3/8"..."). Sostituisce
    // l'intero blocco con un controllo sul pattern della misura, non sul testo letterale.
    // correggiParolaChiave tollera anche i refusi su queste parole-comando (es. "pollicq").
    const patternGenerico = PAROLE_GENERICHE_MISURA[correggiParolaChiave(t)];
    if (patternGenerico) {
      where.push('p.nome ~* ?');
      params.push(patternGenerico);
      continue;
    }

    // Il termine digitato è una misura in pollici riconosciuta (es. "3/4", '3/4"'): oltre
    // al confronto testuale letterale di sempre, si prova anche il match sui millimetri
    // equivalenti scritti nel nome — solo su nome (mai su codice/categoria/marchio/ean,
    // per non allargare la superficie di falsi positivi a campi dove un "20" nudo
    // significherebbe altro).
    const equivalenti = EQUIVALENZE_POLLICI_MM[chiaveEquivalenza(t)];
    if (equivalenti) {
      where.push(`(${bloccoBase} OR p.nome ~* ?)`);
      params.push(...paramsBase, frammentoDiametroMm(equivalenti));
    } else if (t.length >= SOGLIA_MINIMA_FUZZY) {
      // Tollera i refusi di battitura (es. "valvla" invece di "valvola"): oltre al
      // confronto esatto di sempre, prova anche una corrispondenza per somiglianza
      // (pg_trgm) su una parola del nome. Solo dai 4 caratteri in su: sotto, la
      // somiglianza è troppo rumorosa (quasi tutto assomiglierebbe a quasi tutto).
      where.push(`(${bloccoBase} OR word_similarity(?, LOWER(p.nome)) > ${SOGLIA_FUZZY})`);
      params.push(...paramsBase, t);
    } else {
      where.push(bloccoBase);
      params.push(...paramsBase);
    }
  }

  // Chi inizia con il testo digitato viene prima (cercando "valv" prima le "Valvola ...").
  const primoTermine = termini[0] ? `${termini[0]}%` : null;
  const ordinePrefisso = primoTermine
    ? 'CASE WHEN LOWER(p.nome) LIKE ? THEN 0 WHEN LOWER(p.codice) LIKE ? THEN 1 ELSE 2 END,'
    : '';
  const paramsOrdine = primoTermine ? [primoTermine, primoTermine] : [];

  const righeGrezze = await db
    .prepare(
      `SELECT p.*, m.nome AS macro_nome, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN macro_categorie m ON m.slug = p.macro_slug
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where.join(' AND ')}
        ORDER BY ${ordinePrefisso} p.categoria, p.nome
        LIMIT ?`
    )
    .all(...params, ...paramsOrdine, limite);
  return raggruppaVarianti(righeGrezze);
}

// ---------- Macro categorie ----------

async function macroCategorie() {
  return db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.macro_slug = m.slug AND p.attivo = 1) AS n_prodotti
         FROM macro_categorie m
        ORDER BY m.priorita, m.ordine, m.nome`
    )
    .all();
}

// Le categorie che in cantiere si cercano più spesso: vanno in cima alla home.
async function categorieInEvidenza() {
  const cats = await macroCategorie();
  return cats.filter((m) => m.in_evidenza === 1);
}

async function altreCategorie() {
  const cats = await macroCategorie();
  return cats.filter((m) => m.in_evidenza !== 1 && m.n_prodotti > 0);
}

// ---------- Sottocategorie e misure ----------

async function sottocategorieDi(macroSlug) {
  const rows = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM products p
                     WHERE p.macro_slug = s.macro_slug AND p.sottocategoria = s.slug AND p.attivo = 1) AS n
         FROM sottocategorie s
        WHERE s.macro_slug = ?
        ORDER BY s.ordine, s.nome`
    )
    .all(macroSlug);
  return rows.filter((s) => s.n > 0);
}

async function sottocategoria(macroSlug, slug) {
  return db
    .prepare('SELECT * FROM sottocategorie WHERE macro_slug = ? AND slug = ?')
    .get(macroSlug, slug);
}

// Misure realmente presenti fra i prodotti di un elenco: è il primo filtro che serve
// a un installatore, prima ancora della marca.
async function misureDisponibili({ macroSlug = null, sotto = null, brandSlug = null } = {}) {
  const where = ["p.attivo = 1", "p.misura <> ''"];
  const params = [];
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (sotto) {
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  if (brandSlug) {
    where.push('p.brand_slug = ?');
    params.push(brandSlug);
  }
  return db
    .prepare(
      `SELECT p.misura, COUNT(*) AS n FROM products p
        WHERE ${where.join(' AND ')}
        GROUP BY p.misura
        ORDER BY n DESC, p.misura
        LIMIT 24`
    )
    .all(...params);
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
    where.push('p.sottocategoria = ?');
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

async function macroCategoria(slug) {
  return db.prepare('SELECT * FROM macro_categorie WHERE slug = ?').get(slug);
}

// ---------- Elenchi paginati ----------

async function paginato({ where, params, pagina = 1, perPagina = PER_PAGINA }) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE ${where}`
    )
    .get(...params);
  const totale = row ? Number(row.n) : 0;

  const pagine = Math.max(1, Math.ceil(totale / perPagina));
  const p = Math.min(Math.max(1, parseInt(pagina, 10) || 1), pagine);

  const righeGrezze = await db
    .prepare(
      `SELECT p.*, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where}
        ORDER BY p.nome
        LIMIT ? OFFSET ?`
    )
    .all(...params, perPagina, (p - 1) * perPagina);
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
    where.push('p.sottocategoria = ?');
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

async function contaProdottiConFoto() {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM products WHERE attivo = 1 AND foto_url IS NOT NULL')
    .get();
  return row ? Number(row.n) : 0;
}

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

async function marchio(slug) {
  return db.prepare('SELECT * FROM brands WHERE slug = ? AND attivo = 1').get(slug);
}

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

async function famigliaDelMarchio(slug, codice) {
  return db
    .prepare('SELECT * FROM brand_families WHERE brand_slug = ? AND codice = ?')
    .get(slug, codice);
}

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
  cercaProdotti,
  macroCategorie,
  categorieInEvidenza,
  altreCategorie,
  macroCategoria,
  sottocategorieDi,
  sottocategoria,
  misureDisponibili,
  marchiNellaCategoria,
  prodottiDellaCategoria,
  prodottiConFoto,
  contaProdottiConFoto,
  marchi,
  marchio,
  famiglieDelMarchio,
  famigliaDelMarchio,
  prodottiDelMarchio,
};
