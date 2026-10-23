const path = require('path');
const os = require('os');
const crypto = require('crypto');
const db = require('../db');
const consegna = require('./consegna');
const format = require('./format');

// Gruppo WhatsApp dei corrieri.
//
// L'installatore paga quando manda la richiesta. Quando un banco la accetta, nel gruppo parte un
// messaggio con le due tappe: prelievo merci (la filiale che ha accettato) e consegna (l'installatore).
// L'installatore non sa niente finché qualcuno nel gruppo non risponde al messaggio con la parola
// chiave e i minuti ("preso 30"): solo allora l'ordine nasce da solo. I minuti sono il tempo che il
// corriere ci mette ad ARRIVARE DAL VENDITORE (la tappa 1): il banco vede esattamente quelli (ritiro alle
// HH:MM), all'installatore si dice quando arriva la merce da lui = quei minuti + il tragitto dal banco
// che ha accettato alla sua posizione, calcolato sulla mappa (src/corriere.js, src/consegna.js). Dopo il
// "preso" il bot non scrive più nel gruppo (a parte la risposta al "preso" stesso). Se la finestra della
// richiesta scade senza che nessuno risponda, il messaggio viene eliminato dal gruppo e per
// l'installatore è come se nessun banco avesse accettato (e il pagamento gli torna).
//
// La logica di stato ("preso", scadenza, ordine) sta in richieste.js: qui solo il gruppo, cioè
// messaggi in uscita, risposte in ingresso e la connessione.
//
// SONDAGGIO (WHATSAPP_SONDAGGIO=1, dal 21/10/2026): l'API ufficiale di WhatsApp non ha i pulsanti nei gruppi (la documentazione dei gruppi elenca solo testo, media e modelli) e i
// pulsanti "interattivi" di Baileys sono un trucco non ufficiale che WhatsApp può spegnere. L'unica cosa da toccare che in un gruppo funziona sempre, su ogni telefono, è un
// SONDAGGIO: subito dopo il messaggio "nuova consegna" il bot ne manda uno (singola scelta) con le opzioni in minuti ("5 minuti", "10 minuti"... "1 ora e mezza"), e il primo che
// vota prende la consegna, esattamente come chi scrive "preso 30". I voti arrivano cifrati (si leggono con la chiave del sondaggio, tenuta in whatsapp_messaggi.segreto_sondaggio:
// senza, un riavvio a metà richiesta li perderebbe) e la versione di Baileys che usiamo non li decifra da sola: lo facciamo qui (decifraVoto). Scrivere "preso <minuti>" funziona
// comunque. Spento di default: va acceso nel .env e serve il blocco di schema "WhatsApp: sondaggio per prendere la consegna".
// Quando qualcuno prende la consegna il sondaggio dei minuti sparisce dal gruppo (resta il messaggio "nuova consegna"), il bot scrive "✅ Preso da ...!" e, appena nasce l'ordine,
// manda un SECONDO sondaggio ("Ordine #N: consegna", tipo 'consegna') con "🚀 Segna come Consegnato": il primo voto segna l'ordine consegnato (flusso_cliente.segnaConsegnatoDalCorriere),
// il sondaggio sparisce e il bot scrive "📦 Ordine #N consegnato alle HH:MM — indirizzo". (La seconda opzione, "⏳ Ancora in viaggio", c'è solo perché un sondaggio ne vuole due.)
//
// Libreria non ufficiale (Baileys): si collega come dispositivo del numero scelto e scrive nel
// gruppo. Il modulo è spento finché non c'è WHATSAPP_ATTIVO=1 (0 o niente = spento: i banchi accettano
// come prima, senza corriere). Si può accendere anche su un server locale, che usa lo stesso DB della
// VPS, a due condizioni:
//  - una SESSIONE PROPRIA (WHATSAPP_AUTH_DIR diversa, un secondo dispositivo collegato al numero): le
//    stesse credenziali usate da due macchine insieme si scollegano a vicenda e rovinano le chiavi;
//  - un'ISTANZA con un nome (WHATSAPP_ISTANZA, default il nome del computer): ogni messaggio in coda
//    porta il nome dell'istanza che l'ha creato (whatsapp_messaggi.istanza) e lo invia, lo elimina e
//    ne legge le risposte SOLO lei. Così con due istanze accese nello stesso gruppo non partono messaggi
//    doppi né risposte doppie ("Preso!" due volte).
//
// Variabili d'ambiente:
//   WHATSAPP_ATTIVO          1 per accenderlo, 0 (o niente) per spegnerlo
//   WHATSAPP_ISTANZA         nome di questa istanza (es. "locale"); se manca vale il nome del computer.
//                            Con un nome scritto qui l'istanza tratta SOLO le righe che portano quel nome;
//                            senza, tratta anche le righe senza nome (quelle di prima: vedi miaRiga)
//   WHATSAPP_GRUPPO          id del gruppo (xxx@g.us) oppure il suo nome esatto
//   WHATSAPP_NUMERO          facoltativo: numero con prefisso (393331234567) per collegarsi con
//                            un codice al posto del QR
//   WHATSAPP_PAROLA_CHIAVE   parola con cui si risponde, default "preso"
//   WHATSAPP_AUTH_DIR        cartella della sessione, default "whatsapp_auth" (fuori da git)
//   WHATSAPP_SONDAGGIO       1 per accompagnare ogni "nuova consegna" con un sondaggio da votare (default spento)
//   WHATSAPP_SONDAGGIO_MINUTI  le opzioni del sondaggio, in minuti separati da virgola (da 2 a 12; default 5,10,15,20,30,45,60,90)

const MINUTI_MAX = 600; // oltre 10 ore non è un tempo per arrivare dal venditore: probabile errore di battitura
const TENTATIVI_MAX = 5;

function attivo() {
  return String(process.env.WHATSAPP_ATTIVO || '').trim() === '1';
}

// ---------- Istanza proprietaria dei messaggi ----------

function istanzaConfigurata() {
  return (process.env.WHATSAPP_ISTANZA || '').trim();
}

function nomeIstanza() {
  return istanzaConfigurata() || os.hostname();
}

// Una riga di whatsapp_messaggi è di questa istanza se porta il suo nome. Le righe senza nome (create prima di questa regola, o da un
// server non ancora aggiornato) le tratta solo chi NON ha un nome scritto nel .env: la VPS di produzione sì, un server locale con
// WHATSAPP_ISTANZA no (altrimenti manderebbe i messaggi accodati dalla VPS).
function miaRiga(riga) {
  if (!riga) return false;
  return riga.istanza ? riga.istanza === nomeIstanza() : !istanzaConfigurata();
}

// Le due condizioni di miaRiga per le query: [testo SQL, parametri].
function condizioneMia() {
  return ['(istanza = ? OR (istanza IS NULL AND ?::boolean))', [nomeIstanza(), !istanzaConfigurata()]];
}

// L'istanza a cui va un messaggio che riguarda una richiesta: quella del suo "nuova consegna", se c'è; altrimenti questa.
async function istanzaDellaRichiesta(requestId) {
  const riga = await db
    .prepare(`SELECT istanza FROM whatsapp_messaggi WHERE request_id = ? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1`)
    .get(requestId);
  return (riga && riga.istanza) || nomeIstanza();
}

function parolaChiave() {
  return (process.env.WHATSAPP_PAROLA_CHIAVE || 'preso').trim() || 'preso';
}

// ---------- Sondaggio ----------

const MINUTI_SONDAGGIO = [5, 10, 15, 20, 30, 45, 60, 90];
const OPZIONI_SONDAGGIO_MAX = 12; // il massimo di WhatsApp

function sondaggioAcceso() {
  return String(process.env.WHATSAPP_SONDAGGIO || '').trim() === '1';
}

// Le opzioni: WHATSAPP_SONDAGGIO_MINUTI ("10,20,30"), senza doppioni né valori fuori misura; meno di due valide = quelle di default.
function minutiDelSondaggio() {
  const scritti = String(process.env.WHATSAPP_SONDAGGIO_MINUTI || '')
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= MINUTI_MAX);
  const unici = [...new Set(scritti)].slice(0, OPZIONI_SONDAGGIO_MAX);
  return unici.length >= 2 ? unici : MINUTI_SONDAGGIO;
}

// "5 minuti", "1 minuto", "1 ora", "1 ora e mezza", "2 ore e 15 minuti": il testo che si vede nel sondaggio (e che, col suo SHA-256, identifica l'opzione votata).
function etichettaMinuti(minuti) {
  if (minuti === 1) return '1 minuto';
  if (minuti < 60) return `${minuti} minuti`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  const parteOre = ore === 1 ? '1 ora' : `${ore} ore`;
  if (!resto) return parteOre;
  if (resto === 30) return `${parteOre} e mezza`;
  return `${parteOre} e ${resto} minuti`;
}

// Domanda e opzioni del sondaggio di una richiesta: finiscono in JSON nel `testo` della riga, così il voto si interpreta con le opzioni di quando è stato mandato anche se nel
// frattempo cambiano nel .env.
function datiSondaggio(richiestaId) {
  return {
    domanda: `Richiesta #${richiestaId}: in quanti minuti arrivi dal venditore?`,
    opzioni: minutiDelSondaggio().map((minuti) => ({ minuti, etichetta: etichettaMinuti(minuti) })),
  };
}

// La colonna del blocco di schema c'è? Se manca il sondaggio non parte (e il messaggio non lo promette): si riprova a guardare ogni 5 minuti, così dopo aver applicato lo schema
// parte da solo, senza riavviare.
let colonnaSondaggio = { presente: null, letta: 0 };
async function sondaggioPossibile() {
  if (!sondaggioAcceso()) return false;
  const ora = Date.now();
  if (colonnaSondaggio.presente === null || (!colonnaSondaggio.presente && ora - colonnaSondaggio.letta > 5 * 60 * 1000)) {
    try {
      const r = await db
        .prepare(
          `SELECT 1 AS si FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'whatsapp_messaggi' AND column_name = 'segreto_sondaggio'`
        )
        .get();
      colonnaSondaggio = { presente: !!r, letta: ora };
    } catch (err) {
      return false; // il database non risponde: non si ricorda, si riguarda al prossimo messaggio
    }
    if (!colonnaSondaggio.presente) {
      console.error('WhatsApp: WHATSAPP_SONDAGGIO=1 ma manca la colonna whatsapp_messaggi.segreto_sondaggio: applica il blocco "WhatsApp: sondaggio per prendere la consegna" di db/postgres/schema.sql. Intanto la consegna si prende scrivendo "' + parolaChiave() + ' <minuti>".');
    }
  }
  return colonnaSondaggio.presente;
}

// Le righe di whatsapp_messaggi che sono sondaggi: 'sondaggio' (i minuti per arrivare dal venditore) e 'consegna' (quello che compare dopo il "preso", per segnare l'ordine consegnato).
const TIPI_SONDAGGIO = ['sondaggio', 'consegna'];
const OPZIONE_CONSEGNATO = '🚀 Segna come Consegnato';
// WhatsApp non ammette un sondaggio con una sola scelta: la seconda non fa niente (serve solo a poter toccare la prima).
const OPZIONE_IN_VIAGGIO = '⏳ Ancora in viaggio';

// Domanda e opzioni del sondaggio "consegnato" di un ordine (stessa forma di datiSondaggio, con l'`id` di ogni opzione al posto dei minuti).
function datiSondaggioConsegna(ordineId) {
  return {
    domanda: `Ordine #${ordineId}: consegna`,
    opzioni: [
      { id: 'consegnato', etichetta: OPZIONE_CONSEGNATO },
      { id: 'in_viaggio', etichetta: OPZIONE_IN_VIAGGIO },
    ],
  };
}

// Quale opzione ha scelto un voto già decifrato: `selectedOptions` sono gli SHA-256 dei testi delle opzioni. Un voto vuoto (ritirato) o di un'opzione che non conosciamo = null.
function opzioneVotata(voto, opzioni) {
  const scelti = (voto && voto.selectedOptions) || [];
  for (const hash of scelti) {
    const hex = Buffer.from(hash).toString('hex');
    const trovata = (opzioni || []).find((o) => crypto.createHash('sha256').update(Buffer.from(o.etichetta)).digest('hex') === hex);
    if (trovata) return trovata;
  }
  return null;
}

// ---------- Lettura della risposta ----------

function normalizza(testo) {
  return String(testo || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapaRegex(testo) {
  return testo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Minuti scritti nel testo: "30", "30 min", "1 ora e 15", "1h30", "2 ore", "mezz'ora",
// "1,5 ore". null se non si capisce o se il valore è fuori misura.
function leggiMinuti(testo) {
  const t = normalizza(testo).replace(/#\d+/g, ' ');
  let minuti = null;
  let m;

  if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h|ore|ora)(?![a-z])\s*(?:e\s*)?(\d+)?/))) {
    const ore = parseFloat(m[1].replace(',', '.'));
    minuti = Math.round(ore * 60) + (m[2] ? parseInt(m[2], 10) : 0);
    if (!m[2] && /^\s*(?:e\s*)?mezz[ao]/.test(t.slice(m.index + m[0].length))) minuti += 30;
  } else if (/mezz ?ora/.test(t)) {
    minuti = 30;
  } else if (/(^|\s)un ora(?![a-z])/.test(t)) {
    minuti = 60;
  } else if ((m = t.match(/(\d+)(?![.,]\d)/))) {
    minuti = parseInt(m[1], 10);
  }

  return Number.isFinite(minuti) && minuti >= 1 && minuti <= MINUTI_MAX ? minuti : null;
}

// Una risposta vale solo se contiene la parola chiave: altrimenti è una chiacchiera del gruppo.
// { risposta: false }                  nessuna parola chiave
// { risposta: true, minuti: null }     parola chiave ma tempo illeggibile
// { risposta: true, minuti: 30 }
function leggiRisposta(testo, parola = parolaChiave()) {
  const t = normalizza(testo);
  const p = normalizza(parola);
  if (!p || !new RegExp('(^|[^a-z0-9])' + escapaRegex(p) + '([^a-z]|$)').test(t)) return { risposta: false };
  return { risposta: true, minuti: leggiMinuti(t.replace(p, ' ')) };
}

// ---------- Testi dei messaggi ----------

function linkMappa(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)) || lat === null || lng === null) return '';
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function tappa(titolo, nome, indirizzo, lat, lng) {
  const righe = [titolo];
  if (nome) righe.push(nome);
  if (indirizzo) righe.push(indirizzo);
  const link = linkMappa(lat, lng);
  if (link) righe.push(`📍 ${link}`);
  return righe.join('\n');
}

function testoRitiroConsegna({ richiestaId, banco, consegnaA, conSondaggio = false }) {
  const p = parolaChiave();
  const come = conSondaggio
    ? `Per prenderla vota nel sondaggio qui sotto: scegli i minuti che ci metti ad arrivare dal venditore (tappa 1, prelievo merci). Oppure rispondi a questo messaggio con «${p} <minuti>» (es. ${p} 30).`
    : `Per prenderla rispondi a questo messaggio con «${p} <minuti>» (es. ${p} 30). I minuti sono il tempo che ci metti ad arrivare dal venditore (tappa 1, prelievo merci).`;
  return [
    `🚚 Richiesta #${richiestaId}: nuova consegna`,
    '',
    tappa('1️⃣ PRELIEVO MERCI', banco.nome, banco.indirizzo, banco.lat, banco.lng),
    '',
    tappa('2️⃣ CONSEGNA MERCE', null, consegnaA.indirizzo, consegnaA.lat, consegnaA.lng),
    '',
    come,
  ].join('\n');
}

// Dove si ritira: la filiale che ha accettato. Vale il punto vendita (store_locations), che è
// l'indirizzo vero; la riga del distributore resta come ripiego.
async function datiRitiro(distributorId) {
  const d = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const s = await db
    .prepare(
      `SELECT indirizzo, cap, citta, provincia, geo_lat, geo_lng FROM store_locations
        WHERE distributor_id = ? AND attivo = 1 AND geo_lat IS NOT NULL ORDER BY id LIMIT 1`
    )
    .get(distributorId);
  return {
    nome: [d.nome, d.filiale].filter(Boolean).join(' — '),
    // "Via Antonio Cantore, 266r, 16149 Genova GE": il CAP e la provincia ci sono, il corriere deve trovare il posto giusto.
    indirizzo: s
      ? [s.indirizzo, [s.cap, s.citta, s.provincia].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : [d.indirizzo, d.zona].filter(Boolean).join(', '),
    lat: s ? s.geo_lat : d.geo_lat,
    lng: s ? s.geo_lng : d.geo_lng,
  };
}

// Dove si consegna: l'indirizzo scritto nel carrello (`destinazione` della richiesta) e la posizione che l'installatore ha mandato con quello stesso invio
// (users.geo_*). Per le richieste senza destinazione (app, vecchio flusso) l'indirizzo di consegna abituale.
async function datiConsegna(clienteId, destinazione) {
  const c = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  return {
    indirizzo: String(destinazione || '').trim() || (c.indirizzo_consegna || '').trim() || format.indirizzoCompleto(c),
    lat: c.geo_lat,
    lng: c.geo_lng,
  };
}

// ---------- Coda dei messaggi ----------

// Messaggio "nuova consegna" per la risposta con cui un banco ha accettato. Non scrive nulla se il
// modulo è spento (e allora il banco accetta senza corriere, vedi richieste.rispondi).
async function accodaRitiroConsegna(requestId, responseId) {
  if (!attivo()) return null;
  const richiesta = await db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
  const risposta = await db.prepare('SELECT * FROM request_responses WHERE id = ?').get(responseId);
  if (!richiesta || !risposta) return null;

  const conSondaggio = await sondaggioPossibile();
  const dati = {
    richiestaId: richiesta.id,
    banco: await datiRitiro(risposta.distributor_id),
    consegnaA: await datiConsegna(richiesta.cliente_id, richiesta.destinazione),
  };
  const info = await db
    .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo, istanza) VALUES (?, ?, 'ritiro_consegna', ?, ?)`)
    .run(richiesta.id, risposta.id, testoRitiroConsegna({ ...dati, conSondaggio }), nomeIstanza());
  if (conSondaggio) {
    // Il sondaggio è una riga a sé, subito dopo (le righe partono in ordine di id): il segreto si sceglie e si salva QUI, prima dell'invio, così i voti sono leggibili anche
    // se il server si riavvia dopo averlo mandato. Se non si riesce a scriverla il messaggio torna quello di sempre (senza promettere un sondaggio che non c'è).
    try {
      await db
        .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo, istanza, segreto_sondaggio) VALUES (?, ?, 'sondaggio', ?, ?, ?)`)
        .run(richiesta.id, risposta.id, JSON.stringify(datiSondaggio(richiesta.id)), nomeIstanza(), crypto.randomBytes(32).toString('base64'));
    } catch (err) {
      console.error('WhatsApp, sondaggio non accodato:', err.message);
      await db.prepare('UPDATE whatsapp_messaggi SET testo = ? WHERE id = ?').run(testoRitiroConsegna(dati), info.lastInsertRowid).catch(() => {});
    }
  }
  svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
  return Number(info.lastInsertRowid);
}

// La richiesta non ha più bisogno del corriere (scaduta, annullata, ordine andato altrove): i
// messaggi che nessuno ha preso spariscono dal gruppo e nessuno può più rispondere, a quelli già
// presi si scrive il motivo (se c'è) perché il corriere non parta per niente. Non guarda se il
// modulo è acceso: con il DB condiviso scrive solo righe, le manda l'istanza collegata.
// `tranne`: id di una risposta da lasciare com'è (quella che ha vinto).
async function ritiraRichiesta(requestId, { motivo = null, tranne = null } = {}) {
  const ritirati = await db
    .prepare(
      `UPDATE whatsapp_messaggi
          SET stato = CASE WHEN stato = 'da_inviare' THEN 'annullato' ELSE 'da_eliminare' END
        WHERE request_id = ? AND tipo IN ('ritiro_consegna', 'sondaggio') AND preso_il IS NULL
          AND stato IN ('da_inviare', 'inviato')
          AND (?::int IS NULL OR response_id IS DISTINCT FROM ?::int)`
    )
    .run(requestId, tranne, tranne);

  let avvisati = { changes: 0 };
  if (motivo) {
    avvisati = await db
      .prepare(
        `INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo, istanza)
         SELECT m.request_id, m.response_id, 'esito', ?, m.istanza
           FROM whatsapp_messaggi m
          WHERE m.request_id = ? AND m.tipo = 'ritiro_consegna' AND m.preso_il IS NOT NULL
            AND m.stato = 'inviato'
            AND NOT EXISTS (SELECT 1 FROM whatsapp_messaggi e
                             WHERE e.request_id = m.request_id AND e.tipo = 'esito'
                               AND e.response_id IS NOT DISTINCT FROM m.response_id)`
      )
      .run(`❌ Richiesta #${requestId} annullata: ${motivo}. Non devi più fare questa consegna.`, requestId);
  }

  if (ritirati.changes || avvisati.changes) {
    svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
  }
}

async function accodaEsito(requestId, responseId, testo) {
  await db
    .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo, istanza) VALUES (?, ?, 'esito', ?, ?)`)
    .run(requestId, responseId, testo, await istanzaDellaRichiesta(requestId));
  svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
}

// L'installatore annulla un ordine che aveva già un corriere (per ora l'annullo resta possibile, per i
// test): è l'unico messaggio che il bot scrive dopo il "preso".
async function avvisaAnnulloOrdine(ordine) {
  if (!ordine || ordine.corriere_minuti === null || ordine.corriere_minuti === undefined) return;
  await accodaEsito(
    ordine.request_id,
    null,
    `❌ Ordine #${ordine.id} (richiesta #${ordine.request_id}) annullato dal cliente: la consegna non serve più.`
  );
}

// Il sondaggio di una riga: singola scelta, con la chiave salvata (messageSecret: Baileys la userebbe a caso, noi la vogliamo conoscere per leggere i voti).
async function inviaSondaggio(gruppo, riga) {
  if (!riga.segreto_sondaggio) throw new Error('sondaggio senza chiave');
  const dati = JSON.parse(riga.testo);
  return sock.sendMessage(gruppo, {
    poll: { name: dati.domanda, values: dati.opzioni.map((o) => o.etichetta), selectableCount: 1, messageSecret: Buffer.from(riga.segreto_sondaggio, 'base64') },
  });
}

async function inviaMessaggiInCoda() {
  const gruppo = await gruppoId();
  if (!gruppo) return;

  // Solo le righe di questa istanza: con la VPS e un server locale accesi insieme, ognuno manda i suoi messaggi (vedi miaRiga).
  const [mia, paramMia] = condizioneMia();
  const daInviare = await db
    .prepare(
      `SELECT * FROM whatsapp_messaggi
        WHERE stato = 'da_inviare' AND tentativi < ? AND ${mia}
        ORDER BY id`
    )
    .all(TENTATIVI_MAX, ...paramMia);
  for (const riga of daInviare) {
    try {
      const inviato = TIPI_SONDAGGIO.includes(riga.tipo) ? await inviaSondaggio(gruppo, riga) : await sock.sendMessage(gruppo, { text: riga.testo });
      const ok = await db
        .prepare(
          `UPDATE whatsapp_messaggi SET stato = 'inviato', wa_msg_id = ?, inviato_il = NOW(), errore = NULL
            WHERE id = ? AND stato = 'da_inviare'`
        )
        .run(inviato.key.id, riga.id);
      if (!ok.changes) {
        // Annullato proprio mentre partiva: lo tolgo subito dal gruppo.
        await sock.sendMessage(gruppo, { delete: inviato.key });
        await db
          .prepare(`UPDATE whatsapp_messaggi SET wa_msg_id = ?, stato = 'eliminato' WHERE id = ?`)
          .run(inviato.key.id, riga.id);
      }
    } catch (err) {
      await db
        .prepare(`UPDATE whatsapp_messaggi SET tentativi = tentativi + 1, errore = ? WHERE id = ?`)
        .run(String(err.message).slice(0, 300), riga.id);
      console.error(`WhatsApp, messaggio ${riga.id} non inviato:`, err.message);
    }
  }

  const daEliminare = await db
    .prepare(
      `SELECT * FROM whatsapp_messaggi
        WHERE stato = 'da_eliminare' AND wa_msg_id IS NOT NULL AND tentativi < ? AND ${mia}
        ORDER BY id`
    )
    .all(TENTATIVI_MAX, ...paramMia);
  for (const riga of daEliminare) {
    try {
      await sock.sendMessage(gruppo, { delete: { remoteJid: gruppo, fromMe: true, id: riga.wa_msg_id } });
      await db.prepare(`UPDATE whatsapp_messaggi SET stato = 'eliminato', errore = NULL WHERE id = ?`).run(riga.id);
    } catch (err) {
      await db
        .prepare(`UPDATE whatsapp_messaggi SET tentativi = tentativi + 1, errore = ? WHERE id = ?`)
        .run(String(err.message).slice(0, 300), riga.id);
      console.error(`WhatsApp, messaggio ${riga.id} non eliminato:`, err.message);
    }
  }
}

let inCorso = null;
let daRifare = false;

// Un solo invio alla volta. Chi chiama mentre uno è in corso non ritorna a mani vuote: segna che
// c'è altro da inviare (l'invio in corso ripassa la coda) e aspetta che finisca, così un messaggio
// accodato proprio durante un invio non resta fermo fino al giro successivo.
function svuotaCoda() {
  if (!pronto()) return Promise.resolve();
  if (inCorso) {
    daRifare = true;
    return inCorso;
  }
  inCorso = (async () => {
    try {
      do {
        daRifare = false;
        await inviaMessaggiInCoda();
      } while (daRifare && pronto());
    } finally {
      inCorso = null;
    }
  })();
  return inCorso;
}

// ---------- Risposta del corriere ----------

function testoDelMessaggio(contenuto) {
  if (!contenuto) return '';
  return contenuto.conversation || (contenuto.extendedTextMessage && contenuto.extendedTextMessage.text) || '';
}

// Id dei messaggi scritti dal bot nel gruppo (conferme e avvisi): contengono la parola chiave e un
// numero di richiesta, quindi se tornassero indietro come messaggi "miei" verrebbero letti come risposte.
const inviatiDalBot = new Set();

async function rispondi(msg, testo, citare = true) {
  try {
    // Una risposta a un voto di un sondaggio non cita niente (il voto non è un messaggio da citare): il testo dice già a quale richiesta si riferisce.
    const inviato = citare
      ? await sock.sendMessage(msg.key.remoteJid, { text: testo }, { quoted: msg })
      : await sock.sendMessage(msg.key.remoteJid, { text: testo });
    if (inviato && inviato.key) {
      inviatiDalBot.add(inviato.key.id);
      if (inviatiDalBot.size > 200) inviatiDalBot.delete(inviatiDalBot.values().next().value);
    }
  } catch (err) {
    console.error('WhatsApp, risposta nel gruppo:', err.message);
  }
}

// Un messaggio arrivato nel gruppo: se risponde a un nostro messaggio "nuova consegna" (o cita il
// numero della richiesta, "#12") e contiene la parola chiave, legge i minuti. Il resto del gruppo
// è ignorato.
async function gestisciMessaggio(msg) {
  if (!msg || !msg.message) return;
  if (msg.key.fromMe) {
    // Il bot è un numero vero: quello che scrive chi ha il telefono in mano arriva come messaggio
    // "mio" e deve valere come risposta. Non valgono i messaggi mandati dal bot stesso.
    if (inviatiDalBot.has(msg.key.id)) return;
    const nostro = await db.prepare('SELECT 1 AS si FROM whatsapp_messaggi WHERE wa_msg_id = ?').get(msg.key.id);
    if (nostro) return;
  }
  const contenuto = normalizzaContenuto(msg.message);
  // Il voto di un sondaggio (non è un testo): lo legge gestisciVoto.
  if (contenuto && contenuto.pollUpdateMessage) {
    await gestisciVoto(msg, contenuto.pollUpdateMessage);
    return;
  }
  const testo = testoDelMessaggio(contenuto);
  const letta = leggiRisposta(testo);
  if (!letta.risposta) return;

  let riga = null;
  const info = contenuto.extendedTextMessage && contenuto.extendedTextMessage.contextInfo;
  if (info && info.stanzaId) {
    riga = await db
      .prepare(`SELECT * FROM whatsapp_messaggi WHERE wa_msg_id = ? AND tipo = 'ritiro_consegna'`)
      .get(info.stanzaId);
  }
  if (!riga) {
    const cita = testo.match(/#(\d+)/);
    if (cita) {
      riga = await db
        .prepare(`SELECT * FROM whatsapp_messaggi WHERE request_id = ? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1`)
        .get(Number(cita[1]));
    }
  }
  // Parola chiave senza una consegna a cui riferirla: probabilmente parla d'altro.
  if (!riga) return;
  // Il messaggio l'ha mandato un'altra istanza (la VPS, o un server locale): la risposta la gestisce lei, che la riceve nello stesso gruppo.
  // Senza questo controllo due istanze accese insieme risponderebbero entrambe al corriere ("Preso!" e poi "già presa").
  if (!miaRiga(riga)) return;

  if (letta.minuti === null) {
    await rispondi(msg, `Non ho capito i minuti: scrivi per esempio «${parolaChiave()} 30».`);
    return;
  }

  const nome = nomeDi(msg);
  await prendiConsegna(msg, riga, letta.minuti, nome, true);
}

function nomeDi(msg) {
  return (msg.pushName || (msg.key.fromMe && sock && sock.user && sock.user.name) || '').trim().slice(0, 60);
}

// Un corriere prende la consegna (scrivendo "preso 30" o votando il sondaggio): lo decide richieste.corriereHaPreso, atomica, e qui si risponde nel gruppo. `riga` è la riga
// di whatsapp_messaggi a cui si riferisce (il messaggio o il sondaggio), `citare`: se la risposta cita il messaggio del corriere (i voti non si citano, e il nome lo dice la risposta).
async function prendiConsegna(msg, riga, minuti, nome, citare) {
  const esito = await require('./richieste').corriereHaPreso(riga.response_id, minuti, nome);
  if (esito.esito === 'preso') {
    await db.prepare('UPDATE whatsapp_messaggi SET preso_il = NOW() WHERE id = ?').run(riga.id);
    // Il messaggio e il sondaggio della stessa risposta sono "presi" insieme: nessuno dei due va tolto dal gruppo alla chiusura della richiesta.
    await db
      .prepare(`UPDATE whatsapp_messaggi SET preso_il = NOW() WHERE response_id = ? AND tipo IN ('ritiro_consegna', 'sondaggio') AND preso_il IS NULL`)
      .run(riga.response_id);
    // L'ordine è già confermato (il cliente ha pagato all'invio): dopo questa risposta il bot non
    // scrive più niente nel gruppo.
    const entro = format.oraRoma(new Date(Date.now() + minuti * 60 * 1000));
    const da = !citare && nome ? ` da ${nome}` : '';
    await rispondi(
      msg,
      `✅ Preso${da}! Richiesta #${riga.request_id}: arrivi dal venditore in ${consegna.inParole(minuti)}, ritiro entro le ${entro}.`,
      citare
    );
    await dopoPreso(riga, esito).catch((err) => console.error(`WhatsApp, dopo il "preso" della richiesta #${riga.request_id}:`, err.message));
  } else if (esito.esito === 'gia_preso') {
    const da = esito.nome ? ` da ${esito.nome}` : '';
    await rispondi(msg, `La richiesta #${riga.request_id} è già stata presa${da}.`, citare);
  } else {
    await rispondi(msg, `La richiesta #${riga.request_id} è scaduta: non è più disponibile.`, citare);
  }
  return esito;
}

// Dopo il "preso": il sondaggio dei minuti sparisce dal gruppo (il messaggio "nuova consegna" resta) e, appena nasce l'ordine, compare il sondaggio per segnarlo consegnato.
// Solo con i sondaggi accesi. Un guasto qui non toglie la consegna al corriere (la risposta "Preso" è già partita): si scrive nel log.
async function dopoPreso(riga, esito) {
  await db
    .prepare(
      `UPDATE whatsapp_messaggi
          SET stato = CASE WHEN stato = 'da_inviare' THEN 'annullato' ELSE 'da_eliminare' END
        WHERE response_id = ? AND tipo = 'sondaggio' AND stato IN ('da_inviare', 'inviato')`
    )
    .run(riga.response_id);
  if (await sondaggioPossibile()) {
    if (esito.ordineId) {
      await db
        .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, order_id, tipo, testo, istanza, segreto_sondaggio) VALUES (?, ?, ?, 'consegna', ?, ?, ?)`)
        .run(riga.request_id, riga.response_id, esito.ordineId, JSON.stringify(datiSondaggioConsegna(esito.ordineId)), nomeIstanza(), crypto.randomBytes(32).toString('base64'));
    } else {
      console.error(`WhatsApp: la richiesta #${riga.request_id} è stata presa ma l'ordine non è ancora nato: il sondaggio "consegnato" non parte.`);
    }
  }
  await svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
}

// ---------- Voti del sondaggio ----------

// Il voto arriva cifrato: si decifra con la chiave del sondaggio, l'id del sondaggio e gli indirizzi di chi l'ha creato (questo numero) e di chi vota. Con gli indirizzi
// "nuovi" di WhatsApp (LID) lo stesso numero può comparire in due forme e non si sa quale abbia usato chi ha cifrato: si provano tutte le combinazioni (la cifratura è
// autenticata, quella sbagliata non decifra mai niente di falso). Ritorna il voto ({ selectedOptions }) o null.
async function decifraVoto(msg, aggiornamento, riga) {
  if (!riga.segreto_sondaggio || !aggiornamento.vote) return null;
  baileys = baileys || (await import('baileys'));
  const { decryptPollVote, jidNormalizedUser } = baileys;
  const normalizza = (jid) => (jid ? jidNormalizedUser(jid) : null);
  const unici = (lista) => [...new Set(lista.filter(Boolean))];
  const miei = unici([sock && sock.user && sock.user.id, sock && sock.user && sock.user.lid].map(normalizza));
  const votanti = msg.key.fromMe ? miei : unici([msg.key.participantAlt, msg.key.participant, msg.key.remoteJidAlt].map(normalizza));
  const segreto = Buffer.from(riga.segreto_sondaggio, 'base64');
  for (const creatore of miei) {
    for (const votante of votanti) {
      try {
        return decryptPollVote(aggiornamento.vote, { pollCreatorJid: creatore, pollMsgId: riga.wa_msg_id, pollEncKey: segreto, voterJid: votante });
      } catch (err) {
        /* un'altra combinazione */
      }
    }
  }
  return null;
}

// Chi ha già votato questo sondaggio e ha già avuto la sua risposta: un voto cambiato o ripetuto non fa rispondere due volte (né toglie la consegna a chi l'ha presa).
const votiGestiti = new Set();

// Un voto in un sondaggio nostro: il primo che sceglie un'opzione prende la consegna con quei minuti. Un voto ritirato, di un sondaggio che non conosciamo o di un'altra istanza
// non fa niente.
async function gestisciVoto(msg, aggiornamento) {
  const chiave = aggiornamento && aggiornamento.pollCreationMessageKey;
  if (!chiave || !chiave.id || !aggiornamento.vote) return;
  const riga = await db.prepare(`SELECT * FROM whatsapp_messaggi WHERE wa_msg_id = ? AND tipo IN ('sondaggio', 'consegna')`).get(chiave.id);
  if (!riga || !miaRiga(riga)) return;
  let dati;
  try {
    dati = JSON.parse(riga.testo);
  } catch (err) {
    return;
  }
  const voto = await decifraVoto(msg, aggiornamento, riga);
  if (!voto) {
    console.error(`WhatsApp: voto del sondaggio della richiesta #${riga.request_id} non leggibile (indirizzi o chiave non coincidono).`);
    return;
  }
  const scelta = opzioneVotata(voto, dati.opzioni);
  if (!scelta) return; // voto ritirato
  if (riga.tipo === 'consegna') {
    await gestisciVotoConsegna(msg, riga, scelta);
    return;
  }
  const votante = msg.key.fromMe ? 'io' : msg.key.participantAlt || msg.key.participant || '';
  const gia = `${riga.id}|${votante}`;
  if (votiGestiti.has(gia)) return;
  votiGestiti.add(gia);
  if (votiGestiti.size > 500) votiGestiti.delete(votiGestiti.values().next().value);

  const nome = nomeDi(msg);
  console.log(`WhatsApp, sondaggio della richiesta #${riga.request_id}: ${nome || 'un corriere'} ha scelto ${scelta.etichetta}.`);
  await prendiConsegna(msg, riga, scelta.minuti, nome, false);
}

// Un voto nel sondaggio "consegna" di un ordine: "🚀 Segna come Consegnato" segna l'ordine consegnato (come il pulsante dell'installatore, ma lo fa il corriere), il sondaggio sparisce
// dal gruppo e il bot scrive "Ordine #N consegnato alle HH:MM" con l'indirizzo. Vale il primo voto (preso_il è il segno che è già stato fatto); l'altra opzione non fa niente.
async function gestisciVotoConsegna(msg, riga, scelta) {
  if (scelta.id !== 'consegnato') return;
  const preso = await db.prepare('UPDATE whatsapp_messaggi SET preso_il = NOW() WHERE id = ? AND preso_il IS NULL').run(riga.id);
  if (!preso.changes) return;

  const ordine = riga.order_id ? await db.prepare('SELECT * FROM orders WHERE id = ?').get(riga.order_id) : null;
  const adesso = new Date();
  console.log(`WhatsApp, ordine #${riga.order_id}: ${nomeDi(msg) || 'un corriere'} lo ha segnato consegnato.`);
  try {
    if (!ordine) throw new Error('ordine non trovato');
    await require('./flusso_cliente').segnaConsegnatoDalCorriere(ordine);
  } catch (err) {
    // Non si scrive "consegnato" se l'ordine non è stato segnato: si libera il voto e si dice di riprovare.
    console.error(`WhatsApp, ordine #${riga.order_id} non segnato consegnato:`, err.message);
    await db.prepare('UPDATE whatsapp_messaggi SET preso_il = NULL WHERE id = ?').run(riga.id).catch(() => {});
    await rispondi(msg, `Non sono riuscito a segnare l'ordine #${riga.order_id} come consegnato: togli il voto e votalo di nuovo.`, false);
    return;
  }

  await db.prepare(`UPDATE whatsapp_messaggi SET stato = 'da_eliminare' WHERE id = ? AND stato = 'inviato'`).run(riga.id);
  let dove = '';
  try {
    const richiesta = ordine.request_id ? await db.prepare('SELECT * FROM requests WHERE id = ?').get(ordine.request_id) : null;
    dove = (await datiConsegna(ordine.cliente_id, richiesta && richiesta.destinazione)).indirizzo;
  } catch (err) {
    console.error(`WhatsApp, indirizzo dell'ordine #${riga.order_id}:`, err.message);
  }
  await accodaEsito(riga.request_id, riga.response_id, `📦 Ordine #${riga.order_id} consegnato alle ${format.oraRoma(adesso)}${dove ? ` — ${dove}` : ''}.`);
  await svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
}

// ---------- Connessione ----------

let baileys = null;
let sock = null;
let connesso = false;
let gruppo = null;
let ritardoRiconnessione = 2000;

function pronto() {
  return !!(sock && connesso);
}

function normalizzaContenuto(messaggio) {
  return baileys && baileys.normalizeMessageContent ? baileys.normalizeMessageContent(messaggio) || messaggio : messaggio;
}

// Id del gruppo: WHATSAPP_GRUPPO è già un id (xxx@g.us) oppure il nome, da cercare fra i gruppi
// di cui il numero fa parte.
async function gruppoId() {
  if (gruppo) return gruppo;
  const voluto = (process.env.WHATSAPP_GRUPPO || '').trim();
  if (!voluto) return null;
  if (voluto.endsWith('@g.us')) return (gruppo = voluto);
  const tutti = await sock.groupFetchAllParticipating();
  const trovato = Object.values(tutti).find((g) => g.subject === voluto);
  if (!trovato) {
    console.error(`WhatsApp: il numero non fa parte di nessun gruppo chiamato "${voluto}".`);
    return null;
  }
  return (gruppo = trovato.id);
}

async function elencaGruppi() {
  const tutti = await sock.groupFetchAllParticipating();
  console.log('WhatsApp, gruppi di questo numero (copia l’id in WHATSAPP_GRUPPO):');
  for (const g of Object.values(tutti)) console.log(`  ${g.id}  ${g.subject}`);
}

const logger = {
  level: 'error',
  child() {
    return logger;
  },
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error(...args) {
    console.error('Baileys:', ...args);
  },
};

async function collega() {
  baileys = baileys || (await import('baileys'));
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

  const cartella = path.resolve(process.env.WHATSAPP_AUTH_DIR || 'whatsapp_auth');
  const { state, saveCreds } = await useMultiFileAuthState(cartella);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Minuteria'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  let codiceRichiesto = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    // Collegamento di un numero nuovo: l'evento "qr" arriva quando il server aspetta di essere
    // abbinato, ed è il momento giusto sia per mostrare il QR sia per chiedere il codice.
    if (u.qr && process.env.WHATSAPP_NUMERO) {
      if (!codiceRichiesto && !state.creds.registered) {
        codiceRichiesto = true;
        try {
          const codice = await sock.requestPairingCode(process.env.WHATSAPP_NUMERO.replace(/\D/g, ''));
          console.log(`WhatsApp: sul telefono del numero apri Dispositivi collegati → Collega un dispositivo → Collega con numero di telefono, e scrivi il codice ${codice}`);
        } catch (err) {
          console.error('WhatsApp, codice di collegamento:', err.message);
        }
      }
    } else if (u.qr) {
      // Il disegno "small" usa il colore del testo del terminale: con un tema chiaro il QR esce
      // invertito e il telefono non lo legge. Colori fissi (bianco su nero) al posto di quelli del tema.
      require('qrcode-terminal').generate(u.qr, { small: true }, (qr) => {
        console.log('WhatsApp: scansiona questo QR (l\'ultimo in basso, si rinnova ogni 20 s) da Dispositivi collegati → Collega un dispositivo.');
        console.log(qr.split('\n').map((riga) => `\x1b[97;40m${riga}\x1b[0m`).join('\n'));
      });
    }
    if (u.connection === 'open') {
      connesso = true;
      ritardoRiconnessione = 2000;
      console.log('WhatsApp collegato.');
      try {
        if (!(process.env.WHATSAPP_GRUPPO || '').trim()) await elencaGruppi();
        else await svuotaCoda();
      } catch (err) {
        console.error('WhatsApp, avvio:', err.message);
      }
    }
    if (u.connection === 'close') {
      connesso = false;
      const codice = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output
        ? u.lastDisconnect.error.output.statusCode
        : null;
      if (codice === DisconnectReason.loggedOut) {
        console.error(`WhatsApp: sessione chiusa dal telefono. Cancella la cartella ${cartella} e riavvia per collegarlo di nuovo.`);
        return;
      }
      if (codice === DisconnectReason.connectionReplaced) {
        console.error('WhatsApp: questa sessione è stata aperta da un\'altra parte (440). Due server con le stesse credenziali si scollegano a vicenda: ' +
          'dai a questo una sessione sua (WHATSAPP_AUTH_DIR diversa, da collegare con un QR) oppure spegni WhatsApp (WHATSAPP_ATTIVO=0) in uno dei due.');
      }
      console.error(`WhatsApp scollegato (${codice || 'errore'}), riprovo fra ${Math.round(ritardoRiconnessione / 1000)} s.`);
      setTimeout(() => collega().catch((err) => console.error('WhatsApp, riconnessione:', err.message)), ritardoRiconnessione).unref();
      ritardoRiconnessione = Math.min(ritardoRiconnessione * 2, 5 * 60 * 1000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const id = await gruppoId().catch(() => null);
    for (const msg of messages) {
      if (!id || msg.key.remoteJid !== id) continue;
      try {
        await gestisciMessaggio(msg);
      } catch (err) {
        console.error('WhatsApp, lettura messaggio:', err.message);
      }
    }
  });
}

// Lo chiama server.js all'avvio. Non fa nulla se il modulo è spento.
function avvia() {
  if (!attivo()) return;
  console.log(`WhatsApp acceso (istanza "${nomeIstanza()}", sessione in ${path.resolve(process.env.WHATSAPP_AUTH_DIR || 'whatsapp_auth')}).`);
  // La finestra di conferma accorciata nel .env di un computer (prove dei timer) vale anche per il corriere: la richiesta scade e il messaggio sparisce dal gruppo.
  const accorciata = parseFloat(process.env.FINESTRA_CONFERMA_SEC);
  if (Number.isFinite(accorciata) && accorciata > 0) {
    console.warn(`WhatsApp: FINESTRA_CONFERMA_SEC=${accorciata} è nel .env: il corriere ha al massimo ${accorciata} secondi per rispondere "${parolaChiave()} <minuti>" (togli la riga per avere la finestra vera).`);
  }
  if (sondaggioAcceso()) {
    console.log(`WhatsApp: sondaggio per prendere la consegna ACCESO (opzioni: ${minutiDelSondaggio().map(etichettaMinuti).join(', ')}).`);
  }
  collega().catch((err) => console.error('WhatsApp, avvio:', err.message));
  // I messaggi rimasti in coda (collegamento caduto, riavvio) partono appena si può.
  setInterval(() => svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message)), 60 * 1000).unref();
}

module.exports = {
  avvia,
  attivo,
  pronto,
  gruppoId,
  elencaGruppi,
  accodaRitiroConsegna,
  ritiraRichiesta,
  avvisaAnnulloOrdine,
  leggiRisposta,
  leggiMinuti,
  testoRitiroConsegna,
  gestisciMessaggio,
  svuotaCoda,
  // Solo per le prove: mette un socket finto al posto di quello vero.
  _prova: {
    impostaSocket(s, g) { sock = s; connesso = !!s; gruppo = g || null; },
    nomeIstanza, miaRiga, condizioneMia, istanzaDellaRichiesta, inviaMessaggiInCoda,
    sondaggioAcceso, sondaggioPossibile, minutiDelSondaggio, etichettaMinuti, datiSondaggio, datiSondaggioConsegna, opzioneVotata, decifraVoto, votiGestiti,
    azzeraControlloColonna() { colonnaSondaggio = { presente: null, letta: 0 }; },
  },
};
