const path = require('path');
const db = require('../db');
const notifiche = require('./notifiche');
const consegna = require('./consegna');
const format = require('./format');

// Gruppo WhatsApp dei corrieri.
//
// Quando un ordine con consegna parte dal banco, nel gruppo arriva un messaggio con l'indirizzo
// di ritiro (la filiale che ha accettato) e quello di consegna (l'installatore). Chi lo prende
// risponde al messaggio scrivendo la parola chiave e i minuti ("preso 30"): il sistema legge il
// tempo, lo salva sull'ordine e avvisa cliente e banco.
//
// Libreria non ufficiale (Baileys): si collega come dispositivo di un numero dedicato e scrive
// nel gruppo. Il modulo è spento finché non c'è WHATSAPP_ATTIVO=1, che va messo in un solo posto
// (la VPS): due istanze leggerebbero lo stesso gruppo e risponderebbero due volte. Un server locale,
// che usa lo stesso DB di produzione, non deve né collegarsi né accodare messaggi.
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

function indirizzoBanco(d) {
  return [d.indirizzo, d.zona].filter(Boolean).join(', ') || d.filiale;
}

function testoOrdine(ordine, distributore) {
  return [
    `📦 Ordine #${ordine.id}`,
    `Ritiro merce: ${indirizzoBanco(distributore)}`,
    `Consegna merce: ${ordine.destinazione}`,
    '',
    `Rispondi a questo messaggio con «${parolaChiave()} <minuti>» (es. ${parolaChiave()} 30) per prenderlo: i minuti sono il tempo della consegna.`,
  ].join('\n');
}

// ---------- Coda dei messaggi ----------

// Accoda il messaggio di un ordine appena creato. Non scrive nulla se il modulo è spento, se
// l'ordine è un ritiro al banco (nessun corriere) o se manca l'indirizzo di consegna.
async function accodaOrdine(orderId) {
  if (!attivo()) return null;
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine || ordine.modalita === 'ritiro' || !ordine.distributor_id) return null;
  if (!(ordine.destinazione || '').trim()) return null;
  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id);
  if (!distributore) return null;

  const info = await db
    .prepare(`INSERT INTO whatsapp_messaggi (order_id, tipo, testo) VALUES (?, 'ordine', ?)`)
    .run(ordine.id, testoOrdine(ordine, distributore));
  svuotaCoda().catch((err) => console.error('WhatsApp, invio:', err.message));
  return Number(info.lastInsertRowid);
}

async function inviaMessaggiInCoda() {
  const gruppo = await gruppoId();
  if (!gruppo) return;
  const righe = await db
    .prepare(
      `SELECT * FROM whatsapp_messaggi
        WHERE stato = 'da_inviare' AND tentativi < ?
        ORDER BY id`
    )
    .all(TENTATIVI_MAX);
  for (const riga of righe) {
    try {
      const inviato = await sock.sendMessage(gruppo, { text: riga.testo });
      await db
        .prepare(`UPDATE whatsapp_messaggi SET stato = 'inviato', wa_msg_id = ?, inviato_il = NOW(), errore = NULL WHERE id = ?`)
        .run(inviato.key.id, riga.id);
    } catch (err) {
      await db
        .prepare(`UPDATE whatsapp_messaggi SET tentativi = tentativi + 1, errore = ? WHERE id = ?`)
        .run(String(err.message).slice(0, 300), riga.id);
      console.error(`WhatsApp, messaggio ${riga.id} non inviato:`, err.message);
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

// Il primo che risponde prende l'ordine. Esiti:
//   { esito: 'preso', ordine }    tempo salvato
//   { esito: 'gia_preso', ordine } qualcun altro l'aveva già preso
//   { esito: 'inesistente' }      ordine annullato o cancellato
async function registraRisposta(orderId, minuti, nome) {
  const arrivo = new Date(Date.now() + minuti * 60 * 1000);
  const preso = await db
    .prepare(
      `UPDATE orders
          SET corriere_minuti = ?, corriere_arrivo_il = ?, corriere_risposto_il = NOW(), corriere_nome = ?
        WHERE id = ? AND corriere_minuti IS NULL`
    )
    .run(minuti, arrivo, nome, orderId);
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine) return { esito: 'inesistente' };
  if (!preso.changes) return { esito: 'gia_preso', ordine };

  const quando = format.oraRoma(arrivo);
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Consegna in arrivo',
    testo: `Il corriere consegna l'ordine #${ordine.id} entro le ${quando} (circa ${consegna.inParole(minuti)}).`,
    link: '/ordini/' + ordine.id,
    categoria: 'ordini',
    order_id: ordine.id,
  });
  if (ordine.distributor_id) {
    await notifiche.notificaDistributore(ordine.distributor_id, {
      titolo: 'Corriere per il ritiro',
      testo: `Ordine #${ordine.id}: ${nome || 'il corriere'} ha preso la consegna, arriva dal cliente entro le ${quando}.`,
      link: '/distributore/ordini/' + ordine.id,
      categoria: 'ordini',
      order_id: ordine.id,
    });
  }
  return { esito: 'preso', ordine, quando };
}

function testoDelMessaggio(contenuto) {
  if (!contenuto) return '';
  return contenuto.conversation || (contenuto.extendedTextMessage && contenuto.extendedTextMessage.text) || '';
}

// Id dei messaggi scritti dal bot nel gruppo (conferme e avvisi): contengono la parola chiave e un
// numero d'ordine, quindi se tornassero indietro come messaggi "miei" verrebbero letti come risposte.
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

// Un messaggio arrivato nel gruppo: se risponde a un nostro messaggio d'ordine (o cita il suo
// numero, "#12") e contiene la parola chiave, legge i minuti. Il resto del gruppo è ignorato.
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

  let orderId = null;
  const info = contenuto.extendedTextMessage && contenuto.extendedTextMessage.contextInfo;
  if (info && info.stanzaId) {
    const riga = await db
      .prepare(`SELECT order_id FROM whatsapp_messaggi WHERE wa_msg_id = ? AND tipo = 'ordine'`)
      .get(info.stanzaId);
    if (riga) orderId = riga.order_id;
  }
  if (!orderId) {
    const cita = testo.match(/#(\d+)/);
    if (cita) {
      const riga = await db
        .prepare(`SELECT order_id FROM whatsapp_messaggi WHERE order_id = ? AND tipo = 'ordine' LIMIT 1`)
        .get(Number(cita[1]));
      if (riga) orderId = riga.order_id;
    }
  }
  // Parola chiave senza un ordine a cui riferirla: probabilmente parla d'altro.
  if (!orderId) return;

  if (letta.minuti === null) {
    await rispondi(msg, `Non ho capito i minuti: scrivi per esempio «${parolaChiave()} 30».`);
    return;
  }

  const nome = (msg.pushName || (msg.key.fromMe && sock.user && sock.user.name) || '').trim().slice(0, 60);
  const esito = await registraRisposta(orderId, letta.minuti, nome);
  if (esito.esito === 'preso') {
    await rispondi(msg, `✅ Ordine #${orderId} preso: consegna entro le ${esito.quando} (${consegna.inParole(letta.minuti)}).`);
  } else if (esito.esito === 'gia_preso') {
    const da = esito.ordine.corriere_nome ? ` da ${esito.ordine.corriere_nome}` : '';
    await rispondi(msg, `L'ordine #${orderId} è già stato preso${da}.`);
  } else {
    await rispondi(msg, `L'ordine #${orderId} non esiste più: è stato annullato.`);
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

module.exports = { avvia, attivo, pronto, gruppoId, elencaGruppi, accodaOrdine, leggiRisposta, leggiMinuti, testoOrdine, registraRisposta, gestisciMessaggio, svuotaCoda, _prova: { impostaSocket(s, g) { sock = s; connesso = !!s; gruppo = g || null; } } };
