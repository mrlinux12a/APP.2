const path = require('path');
const db = require('../db');
const consegna = require('./consegna');
const format = require('./format');
const ddt = require('./ddt');

// Gruppo WhatsApp dei corrieri.
//
// Quando un banco accetta una richiesta, PRIMA che l'offerta arrivi all'installatore, nel gruppo
// parte un messaggio con le due tappe: prelievo merci (la filiale che ha accettato) e consegna
// (l'installatore). L'installatore non vede l'offerta finché qualcuno nel gruppo non risponde al
// messaggio con la parola chiave e i minuti totali ("preso 30"): solo allora la risposta del banco
// diventa un'offerta, con quel tempo come tempo di consegna. Se la finestra della richiesta scade
// senza che nessuno risponda, il messaggio viene eliminato dal gruppo e per l'installatore è come
// se nessun banco avesse accettato.
//
// La logica di stato (offerta nascosta, "preso", scadenza) sta in richieste.js: qui solo il
// gruppo, cioè messaggi in uscita, risposte in ingresso e la connessione.
//
// Libreria non ufficiale (Baileys): si collega come dispositivo del numero scelto e scrive nel
// gruppo. Il modulo è spento finché non c'è WHATSAPP_ATTIVO=1, che va messo in un solo posto
// (la VPS): due istanze leggerebbero lo stesso gruppo e risponderebbero due volte. Un server locale,
// che usa lo stesso DB di produzione, non deve né collegarsi né accodare messaggi: con il modulo
// spento i banchi accettano come prima, senza corriere.
//
// Variabili d'ambiente:
//   WHATSAPP_ATTIVO          1 per accenderlo
//   WHATSAPP_GRUPPO          id del gruppo (xxx@g.us) oppure il suo nome esatto
//   WHATSAPP_NUMERO          facoltativo: numero con prefisso (393331234567) per collegarsi con
//                            un codice al posto del QR
//   WHATSAPP_PAROLA_CHIAVE   parola con cui si risponde, default "preso"
//   WHATSAPP_AUTH_DIR        cartella della sessione, default "whatsapp_auth" (fuori da git)

const MINUTI_MAX = 600; // oltre 10 ore non è un tempo di consegna: probabile errore di battitura
const TENTATIVI_MAX = 5;

function attivo() {
  return process.env.WHATSAPP_ATTIVO === '1';
}

function parolaChiave() {
  return (process.env.WHATSAPP_PAROLA_CHIAVE || 'preso').trim() || 'preso';
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

function testoRitiroConsegna({ richiestaId, banco, consegnaA }) {
  const p = parolaChiave();
  return [
    `🚚 Richiesta #${richiestaId}: nuova consegna`,
    '',
    tappa('1️⃣ PRELIEVO MERCI', banco.nome, banco.indirizzo, banco.lat, banco.lng),
    '',
    tappa('2️⃣ CONSEGNA MERCE', null, consegnaA.indirizzo, consegnaA.lat, consegnaA.lng),
    '',
    `Per prenderla rispondi a questo messaggio con «${p} <minuti>» (es. ${p} 30). I minuti sono il tempo totale, dal ritiro alla consegna.`,
  ].join('\n');
}

// Dove si ritira: la filiale che ha accettato. Vale il punto vendita (store_locations), che è
// l'indirizzo vero; la riga del distributore resta come ripiego.
async function datiRitiro(distributorId) {
  const d = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const s = await db
    .prepare(
      `SELECT indirizzo, citta, geo_lat, geo_lng FROM store_locations
        WHERE distributor_id = ? AND attivo = 1 AND geo_lat IS NOT NULL ORDER BY id LIMIT 1`
    )
    .get(distributorId);
  return {
    nome: [d.nome, d.filiale].filter(Boolean).join(' — '),
    indirizzo: s
      ? [s.indirizzo, s.citta].filter(Boolean).join(', ')
      : [d.indirizzo, d.zona].filter(Boolean).join(', '),
    lat: s ? s.geo_lat : d.geo_lat,
    lng: s ? s.geo_lng : d.geo_lng,
  };
}

// Dove si consegna: l'indirizzo dell'installatore (per ora uguale per tutti, vedi sede_installatori.js).
async function datiConsegna(clienteId) {
  const c = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  return {
    indirizzo: (c.indirizzo_consegna || '').trim() || ddt.indirizzoCompleto(c),
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

  const testo = testoRitiroConsegna({
    richiestaId: richiesta.id,
    banco: await datiRitiro(risposta.distributor_id),
    consegnaA: await datiConsegna(richiesta.cliente_id),
  });
  const info = await db
    .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo) VALUES (?, ?, 'ritiro_consegna', ?)`)
    .run(richiesta.id, risposta.id, testo);
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
        WHERE request_id = ? AND tipo = 'ritiro_consegna' AND preso_il IS NULL
          AND stato IN ('da_inviare', 'inviato')
          AND (?::int IS NULL OR response_id IS DISTINCT FROM ?::int)`
    )
    .run(requestId, tranne, tranne);

  let avvisati = { changes: 0 };
  if (motivo) {
    avvisati = await db
      .prepare(
        `INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo)
         SELECT m.request_id, m.response_id, 'esito', ?
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
    .prepare(`INSERT INTO whatsapp_messaggi (request_id, response_id, tipo, testo) VALUES (?, ?, 'esito', ?)`)
    .run(requestId, responseId, testo);
  svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
}

// L'installatore ha confermato (o l'ordine è partito da solo): chi ha preso la consegna deve saperlo.
// Se il cliente ritira al banco la consegna non serve più.
async function avvisaOrdine(orderId, risposta) {
  if (!risposta || risposta.corriere_stato !== 'preso') return;
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine) return;
  const testo =
    ordine.modalita === 'ritiro'
      ? `ℹ️ Richiesta #${ordine.request_id}: il cliente ritira al banco, la consegna non serve più.`
      : `✅ Richiesta #${ordine.request_id}: il cliente ha confermato (ordine #${ordine.id}). Ritira la merce e consegna entro le ${format.oraRoma(ordine.corriere_arrivo_il)}.`;
  await accodaEsito(ordine.request_id, risposta.id, testo);
}

// L'installatore annulla un ordine che aveva già un corriere.
async function avvisaAnnulloOrdine(ordine) {
  if (!ordine || ordine.corriere_minuti === null || ordine.corriere_minuti === undefined) return;
  await accodaEsito(
    ordine.request_id,
    null,
    `❌ Ordine #${ordine.id} (richiesta #${ordine.request_id}) annullato dal cliente: la consegna non serve più.`
  );
}

async function inviaMessaggiInCoda() {
  const gruppo = await gruppoId();
  if (!gruppo) return;

  const daInviare = await db
    .prepare(
      `SELECT * FROM whatsapp_messaggi
        WHERE stato = 'da_inviare' AND tentativi < ?
        ORDER BY id`
    )
    .all(TENTATIVI_MAX);
  for (const riga of daInviare) {
    try {
      const inviato = await sock.sendMessage(gruppo, { text: riga.testo });
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
        WHERE stato = 'da_eliminare' AND wa_msg_id IS NOT NULL AND tentativi < ?
        ORDER BY id`
    )
    .all(TENTATIVI_MAX);
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

async function rispondi(msg, testo) {
  try {
    const inviato = await sock.sendMessage(msg.key.remoteJid, { text: testo }, { quoted: msg });
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

  if (letta.minuti === null) {
    await rispondi(msg, `Non ho capito i minuti: scrivi per esempio «${parolaChiave()} 30».`);
    return;
  }

  const nome = (msg.pushName || (msg.key.fromMe && sock.user && sock.user.name) || '').trim().slice(0, 60);
  const esito = await require('./richieste').corriereHaPreso(riga.response_id, letta.minuti, nome);
  if (esito.esito === 'preso') {
    await db.prepare('UPDATE whatsapp_messaggi SET preso_il = NOW() WHERE id = ?').run(riga.id);
    await rispondi(
      msg,
      `✅ Preso! Richiesta #${riga.request_id}: ${consegna.inParole(letta.minuti)} in totale. Aspetto la conferma del cliente e ti scrivo qui appena arriva.`
    );
  } else if (esito.esito === 'gia_preso') {
    const da = esito.nome ? ` da ${esito.nome}` : '';
    await rispondi(msg, `La richiesta #${riga.request_id} è già stata presa${da}.`);
  } else {
    await rispondi(msg, `La richiesta #${riga.request_id} è scaduta: non è più disponibile.`);
  }
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
  avvisaOrdine,
  avvisaAnnulloOrdine,
  leggiRisposta,
  leggiMinuti,
  testoRitiroConsegna,
  gestisciMessaggio,
  svuotaCoda,
  // Solo per le prove: mette un socket finto al posto di quello vero.
  _prova: { impostaSocket(s, g) { sock = s; connesso = !!s; gruppo = g || null; } },
};
