// Notifiche push del sito e della web app (Web Push, chiavi VAPID): la notifica arriva sul telefono o sul computer anche con l'app CHIUSA.
// Per le notifiche della sola app Android nativa c'è src/push.js (Expo); qui sono i browser.
//
// Come funziona:
//  · il browser, dopo il permesso, si iscrive al servizio push del suo produttore (Google/FCM, Apple, Mozilla, Microsoft) e manda a POST /api/push/iscrivi
//    il suo indirizzo (`endpoint`) e le due chiavi per cifrare i messaggi: `registra` li salva in `iscrizioni_push`;
//  · `notifiche.notifica()` chiama `inviaAUtente` per ogni notifica nuova: il messaggio, cifrato e firmato con la chiave VAPID del sito, parte verso il
//    servizio push, che lo consegna al dispositivo anche se il browser è chiuso; lì lo mostra il service worker (public/sw.js, evento `push`);
//  · se il servizio push dice che l'iscrizione non esiste più (404/410) la riga si cancella.
//
// Regole che non si rompono:
//  · MAI far fallire la richiesta o il flusso che ha generato la notifica: ogni errore finisce nel log e basta (`inviaAUtente` non lancia);
//  · senza le chiavi VAPID nel .env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e un contatto: VAPID_SUBJECT, o APP_URL se è https) non succede niente: gli
//    avvisi restano quelli di sempre, solo con l'app aperta. Si genera una coppia con `node scripts/genera_chiavi_vapid.js`;
//  · senza la tabella `iscrizioni_push` (blocco "Notifiche push del sito e della web app" di db/postgres/schema.sql non ancora applicato) idem: si scrive
//    una volta nel log;
//  · PUSH_ATTIVO=0 spegne tutto (come per l'app Android);
//  · ogni server usa SOLO le iscrizioni nate con la sua chiave pubblica (colonna `chiave`): il PC di sviluppo parla col DB di produzione ma ha un'altra
//    coppia di chiavi, quindi non può mandare niente ai telefoni dei clienti veri (e il servizio push lo rifiuterebbe comunque);
//  · l'endpoint lo sceglie chi si iscrive e il server lo chiama: per questo si accettano solo i servizi push veri (https, porta 443, host in HOST_AMMESSI).
const webpush = require('web-push');
const db = require('../db');

const TTL_SEC = 30 * 60; // un messaggio che il dispositivo non ritira entro mezz'ora non serve più (le richieste hanno 10 minuti)
const TIMEOUT_MS = 8000;
const MASSIMO_PER_UTENTE = 10; // oltre, si tolgono le iscrizioni più vecchie: nessuno ha dieci browser
const MASSIMO_ENDPOINT = 1500;

// Gli host dei servizi push: Google (Chrome, Edge, Brave, Opera, Samsung Internet: fcm.googleapis.com), Apple (web.push.apple.com, Safari e web app
// su iPhone), Mozilla (updates.push.services.mozilla.com), Microsoft (*.notify.windows.com).
const HOST_AMMESSI = [/(^|\.)googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

let avvisatoTabellaMancante = false;
let invio = (iscrizione, payload, opzioni) => webpush.sendNotification(iscrizione, payload, opzioni); // sostituibile nelle prove

function impostaInvio(fn) {
  invio = fn;
}

function configurazione() {
  const pubblica = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privata = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  let soggetto = String(process.env.VAPID_SUBJECT || '').trim();
  const appUrl = String(process.env.APP_URL || '').trim();
  if (!soggetto && /^https:\/\//i.test(appUrl)) soggetto = appUrl;
  if (!/^[A-Za-z0-9_-]{87}$/.test(pubblica) || !/^[A-Za-z0-9_-]{43}$/.test(privata)) return null;
  try {
    const url = new URL(soggetto);
    if (url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
  } catch (err) {
    return null;
  }
  return { pubblica, privata, soggetto };
}

// Spegnibile da PUSH_ATTIVO=0 (stesso interruttore dell'app Android); senza chiavi valide è spento da sé.
function attivo() {
  return String(process.env.PUSH_ATTIVO || '').trim() !== '0' && configurazione() !== null;
}

// La chiave pubblica che il browser usa per iscriversi (nel <meta name="push-chiave"> di ogni pagina); vuota se le push sono spente.
function chiavePubblica() {
  return attivo() ? configurazione().pubblica : '';
}

// Una riga di log all'avvio: dice se le notifiche ad app chiusa sono accese e, se no, perché.
function descriviConfigurazione() {
  if (String(process.env.PUSH_ATTIVO || '').trim() === '0') return '[web push] spente (PUSH_ATTIVO=0)';
  if (configurazione()) return '[web push] accese (chiave ' + configurazione().pubblica.slice(0, 8) + '…): le notifiche arrivano anche ad app chiusa';
  const manca = [];
  if (!String(process.env.VAPID_PUBLIC_KEY || '').trim() || !String(process.env.VAPID_PRIVATE_KEY || '').trim()) manca.push('VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (node scripts/genera_chiavi_vapid.js)');
  else if (!/^[A-Za-z0-9_-]{87}$/.test(String(process.env.VAPID_PUBLIC_KEY).trim()) || !/^[A-Za-z0-9_-]{43}$/.test(String(process.env.VAPID_PRIVATE_KEY).trim())) manca.push('chiavi VAPID valide (le attuali non hanno la forma giusta)');
  if (!String(process.env.VAPID_SUBJECT || '').trim() && !/^https:\/\//i.test(String(process.env.APP_URL || '').trim())) manca.push('VAPID_SUBJECT (https://tuo-dominio o mailto:indirizzo)');
  else if (String(process.env.VAPID_SUBJECT || '').trim() && !/^(https:\/\/|mailto:)/i.test(String(process.env.VAPID_SUBJECT).trim())) manca.push('VAPID_SUBJECT valido (https://... o mailto:...)');
  return '[web push] spente: nel .env manca ' + manca.join(' e ') + '. Le notifiche arrivano solo con l\'app aperta.';
}

function tabellaAssente(err) {
  // 42P01 = la tabella non esiste (schema non aggiornato).
  if (err && err.code === '42P01') {
    if (!avvisatoTabellaMancante) {
      avvisatoTabellaMancante = true;
      console.warn('[web push] la tabella iscrizioni_push non esiste: applica il blocco "Notifiche push del sito e della web app" di db/postgres/schema.sql (node scripts/applica_blocco_schema.js "-- Notifiche push del sito e della web app" --applica). Intanto le notifiche ad app chiusa restano spente.');
    }
    return true;
  }
  return false;
}

// L'iscrizione come la manda il browser (`PushSubscription.toJSON()`): { endpoint, keys: { p256dh, auth } }. Ritorna i tre pezzi puliti o null.
function validaIscrizione(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
  const chiavi = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
  const p256dh = typeof chiavi.p256dh === 'string' ? chiavi.p256dh.trim() : '';
  const auth = typeof chiavi.auth === 'string' ? chiavi.auth.trim() : '';
  if (!endpoint || endpoint.length > MASSIMO_ENDPOINT) return null;
  let url;
  try {
    url = new URL(endpoint);
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  if (!HOST_AMMESSI.some((re) => re.test(url.hostname))) return null;
  // p256dh = punto P-256 non compresso (65 byte → 87 caratteri base64url), auth = 16 byte (22 caratteri): lasciamo un po' di margine.
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) return null;
  return { endpoint, p256dh, auth };
}

// Salva l'iscrizione del browser per l'utente. Ritorna { ok: true, endpoint } oppure { ok: false, motivo: 'spente' | 'non_valida' | 'tabella' }.
async function registra(userId, sub, { userAgent = '' } = {}) {
  if (!attivo()) return { ok: false, motivo: 'spente' };
  const s = validaIscrizione(sub);
  if (!s) return { ok: false, motivo: 'non_valida' };
  try {
    await db
      .prepare(
        `INSERT INTO iscrizioni_push (user_id, endpoint, p256dh, auth, chiave, user_agent) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           chiave = EXCLUDED.chiave, user_agent = EXCLUDED.user_agent, aggiornato_il = NOW()`
      )
      .run(userId, s.endpoint, s.p256dh, s.auth, configurazione().pubblica, String(userAgent || '').slice(0, 300));
    // Le iscrizioni più vecchie oltre il massimo (browser che non esistono più e che il servizio push non ha ancora segnalato) si tolgono.
    await db
      .prepare(
        `DELETE FROM iscrizioni_push WHERE user_id = ? AND id NOT IN
           (SELECT id FROM iscrizioni_push WHERE user_id = ? ORDER BY aggiornato_il DESC, id DESC LIMIT ${MASSIMO_PER_UTENTE})`
      )
      .run(userId, userId);
    return { ok: true, endpoint: s.endpoint };
  } catch (err) {
    if (tabellaAssente(err)) return { ok: false, motivo: 'tabella' };
    throw err;
  }
}

async function rimuovi(endpoint, userId = null) {
  try {
    if (userId === null) await db.prepare('DELETE FROM iscrizioni_push WHERE endpoint = ?').run(String(endpoint || ''));
    else await db.prepare('DELETE FROM iscrizioni_push WHERE endpoint = ? AND user_id = ?').run(String(endpoint || ''), userId);
  } catch (err) {
    if (!tabellaAssente(err)) throw err;
  }
}

async function rimuoviUtente(userId) {
  try {
    await db.prepare('DELETE FROM iscrizioni_push WHERE user_id = ?').run(userId);
  } catch (err) {
    if (!tabellaAssente(err)) throw err;
  }
}

// Le iscrizioni dell'utente che questo server può usare (quelle nate con la sua chiave pubblica).
async function iscrizioniDi(userId) {
  const cfg = configurazione();
  if (!cfg) return [];
  try {
    return (await db.prepare('SELECT id, endpoint, p256dh, auth FROM iscrizioni_push WHERE user_id = ? AND chiave = ?').all(userId, cfg.pubblica)) || [];
  } catch (err) {
    if (tabellaAssente(err)) return [];
    throw err;
  }
}

// Il testo di una notifica: corto (le anteprime tagliano), niente a capo.
function accorcia(testo, massimo) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  return t.length > massimo ? t.slice(0, massimo - 1) + '…' : t;
}

// Il link del messaggio è un percorso del sito ("/ordini/12"); qualunque altra cosa diventa niente (il service worker lo controlla di nuovo).
function percorsoInterno(link) {
  const l = String(link || '');
  return /^\/(?!\/)[^\s\\]*$/.test(l) ? l.slice(0, 300) : null;
}

function hostDi(endpoint) {
  try {
    return new URL(endpoint).hostname;
  } catch (err) {
    return '?';
  }
}

// Manda la notifica a tutti i browser dell'utente. `id` è l'id della riga in `notifications` (diventa il `tag` della notifica di sistema: la stessa notifica
// mostrata due volte, da qui e dalla pagina aperta, resta una). Non lancia MAI. Ritorna quante consegne sono state accettate dai servizi push.
async function inviaAUtente(userId, { titolo, testo, link = null, id = null, tipo = null, tag = null } = {}) {
  if (!userId || !attivo()) return 0;
  try {
    const cfg = configurazione();
    const iscrizioni = await iscrizioniDi(userId);
    if (!iscrizioni.length) return 0;
    const payload = JSON.stringify({
      titolo: accorcia(titolo, 80) || 'Minuteria',
      testo: accorcia(testo, 220),
      link: percorsoInterno(link),
      tag: tag || (id ? 'minuteria-' + id : null),
      id: id || null,
      tipo: tipo || null,
    });
    const opzioni = { TTL: TTL_SEC, urgency: 'high', timeout: TIMEOUT_MS, vapidDetails: { subject: cfg.soggetto, publicKey: cfg.pubblica, privateKey: cfg.privata } };
    let accettate = 0;
    await Promise.all(
      iscrizioni.map(async (s) => {
        try {
          await invio({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, opzioni);
          accettate++;
        } catch (err) {
          const stato = err && err.statusCode;
          if (stato === 404 || stato === 410) await rimuovi(s.endpoint).catch(() => {}); // il browser non è più iscritto
          else console.error('[web push] consegna non riuscita (' + (stato || (err && (err.code || err.message)) || 'errore') + ') verso ' + hostDi(s.endpoint));
        }
      })
    );
    return accettate;
  } catch (err) {
    console.error('[web push] invio non riuscito:', err && err.message);
    return 0;
  }
}

// La notifica di prova della pagina "Sul telefono" / Anagrafica del banco: passa dal server come una notifica vera, quindi prova tutto il percorso.
async function inviaProva(userId) {
  return inviaAUtente(userId, { titolo: 'Notifica di prova', testo: 'Le notifiche funzionano, anche ad app chiusa.', link: '/', tag: 'minuteria-prova', tipo: 'prova' });
}

module.exports = {
  attivo,
  chiavePubblica,
  configurazione,
  descriviConfigurazione,
  validaIscrizione,
  registra,
  rimuovi,
  rimuoviUtente,
  iscrizioniDi,
  inviaAUtente,
  inviaProva,
  impostaInvio,
  HOST_AMMESSI,
};
