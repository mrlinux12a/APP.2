// Notifiche push dell'app Android (Expo Push Service). Ogni notifica in-app di un installatore (src/notifiche.js) può diventare anche una
// notifica di sistema sul suo telefono: "Ordine confermato", "Nessuna conferma ricevuta", "Ordine annullato dal banco"...
//
// Come funziona:
//  · il telefono, appena l'utente entra nell'app, ottiene il suo token Expo e lo manda a POST /api/v1/dispositivi (`registra`);
//  · `inviaAUtente` legge i token dell'utente e li passa al servizio di Expo, che li consegna a Google (FCM);
//  · se Expo dice che un telefono non esiste più (DeviceNotRegistered) il token si cancella.
//
// Regole che non si rompono:
//  · MAI far fallire la richiesta o il flusso che ha generato la notifica: ogni errore finisce nel log e basta (`inviaAUtente` non lancia);
//  · senza la tabella `dispositivi_push` (blocco "Notifiche push" di db/postgres/schema.sql non ancora applicato) non succede niente: si
//    scrive una volta nel log e le push restano spente;
//  · si può spegnere del tutto con PUSH_ATTIVO=0 nel .env (per esempio sul PC, che parla col DB di produzione: una prova locale non deve
//    mandare notifiche ai telefoni dei clienti veri). Per le prove con un telefono vero si lascia acceso.
//  · EXPO_ACCESS_TOKEN (facoltativo): il token di accesso di Expo, se nel progetto è attiva la "sicurezza avanzata" delle push.
const db = require('../db');

const URL_INVIO = 'https://exp.host/--/api/v2/push/send';
const TIMEOUT_MS = 8000;
const MASSIMO_PER_CHIAMATA = 100;

// ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]: l'unica forma che accettiamo dal telefono (finisce in una colonna e poi in una chiamata esterna).
const TOKEN_VALIDO = /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,60}\]$/;

let avvisatoTabellaMancante = false;
// Il modo in cui si chiama il servizio delle notifiche push di Expo (sostituibile nelle prove).
let invio = (url, opzioni) => fetch(url, opzioni); // sostituibile nelle prove

// Cambia il modo di chiamare il servizio push (serve alle prove, per non fare chiamate vere).
function impostaInvio(fn) {
  invio = fn;
}

// Dice se le notifiche push dell'app sono accese (si spengono con PUSH_ATTIVO=0).
function attivo() {
  return String(process.env.PUSH_ATTIVO || '').trim() !== '0';
}

// Riconosce l'errore "la tabella non esiste" (schema non aggiornato) e lo scrive nel log una volta sola: le push restano spente invece di rompere il
// resto.
function tabellaAssente(err) {
  // 42P01 = la tabella non esiste (schema non aggiornato).
  if (err && err.code === '42P01') {
    if (!avvisatoTabellaMancante) {
      avvisatoTabellaMancante = true;
      console.warn('[push] la tabella dispositivi_push non esiste: applica il blocco "Notifiche push" di db/postgres/schema.sql (node scripts/applica_blocco_schema.js "-- Notifiche push dell\'app Android" --applica). Intanto le push restano spente.');
    }
    return true;
  }
  return false;
}

// Il telefono dell'utente: se il token c'era già (anche di un altro utente) passa a lui.
async function registra(userId, token, piattaforma = 'android') {
  const t = String(token || '').trim();
  if (!TOKEN_VALIDO.test(t)) return false;
  const p = String(piattaforma || 'android').toLowerCase().slice(0, 20) || 'android';
  try {
    await db
      .prepare(
        `INSERT INTO dispositivi_push (user_id, token, piattaforma) VALUES (?, ?, ?)
         ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, piattaforma = EXCLUDED.piattaforma, aggiornato_il = NOW()`
      )
      .run(userId, t, p);
    return true;
  } catch (err) {
    if (tabellaAssente(err)) return false;
    throw err;
  }
}

// Toglie un telefono dalle notifiche: solo quello di questo utente se si indica l'utente, altrimenti ovunque.
async function rimuovi(token, userId = null) {
  try {
    if (userId === null) await db.prepare('DELETE FROM dispositivi_push WHERE token = ?').run(String(token || ''));
    else await db.prepare('DELETE FROM dispositivi_push WHERE token = ? AND user_id = ?').run(String(token || ''), userId);
  } catch (err) {
    if (!tabellaAssente(err)) throw err;
  }
}

// Toglie tutti i telefoni di un utente dalle notifiche (per esempio quando elimina l'account).
async function rimuoviUtente(userId) {
  try {
    await db.prepare('DELETE FROM dispositivi_push WHERE user_id = ?').run(userId);
  } catch (err) {
    if (!tabellaAssente(err)) throw err;
  }
}

// I codici dei telefoni di un utente che possono ricevere notifiche (solo quelli scritti bene).
async function tokenDi(userId) {
  try {
    const righe = await db.prepare('SELECT token FROM dispositivi_push WHERE user_id = ?').all(userId);
    return (righe || []).map((r) => r.token).filter((t) => TOKEN_VALIDO.test(String(t)));
  } catch (err) {
    if (tabellaAssente(err)) return [];
    throw err;
  }
}

// Il testo di una notifica push: corto (le anteprime di Android tagliano), niente a capo.
function accorcia(testo, massimo) {
  const t = String(testo || '').replace(/\s+/g, ' ').trim();
  return t.length > massimo ? t.slice(0, massimo - 1) + '…' : t;
}

// Manda una push a tutti i telefoni dell'utente. `link` è il percorso del sito ("/ordini/12", "/richieste/7"): l'app lo trasforma nella sua schermata.
// Non lancia MAI. Ritorna quante push sono state accettate da Expo.
async function inviaAUtente(userId, { titolo, testo, link = null, orderId = null } = {}) {
  if (!attivo() || !userId) return 0;
  try {
    const tokens = await tokenDi(userId);
    if (!tokens.length) return 0;
    const messaggi = tokens.map((to) => ({
      to,
      title: accorcia(titolo, 60),
      body: accorcia(testo, 180),
      data: { link: link || null, order_id: orderId || null },
      sound: 'default',
      channelId: 'default',
      priority: 'high',
    }));

    let accettate = 0;
    for (let i = 0; i < messaggi.length; i += MASSIMO_PER_CHIAMATA) {
      const gruppo = messaggi.slice(i, i + MASSIMO_PER_CHIAMATA);
      const intestazioni = { Accept: 'application/json', 'Content-Type': 'application/json' };
      if (process.env.EXPO_ACCESS_TOKEN) intestazioni.Authorization = 'Bearer ' + String(process.env.EXPO_ACCESS_TOKEN).trim();
      const ctrl = new AbortController();
      const scadenza = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let esito;
      try {
        const r = await invio(URL_INVIO, { method: 'POST', headers: intestazioni, body: JSON.stringify(gruppo), signal: ctrl.signal });
        esito = await r.json().catch(() => null);
        if (!r.ok) {
          console.error('[push] Expo ha risposto', r.status);
          continue;
        }
      } finally {
        clearTimeout(scadenza);
      }
      const biglietti = esito && Array.isArray(esito.data) ? esito.data : [];
      for (let k = 0; k < gruppo.length; k++) {
        const b = biglietti[k];
        if (b && b.status === 'ok') accettate++;
        else if (b && b.details && b.details.error === 'DeviceNotRegistered') await rimuovi(gruppo[k].to).catch(() => {});
        else if (b) console.error('[push] notifica non accettata:', b.message || (b.details && b.details.error) || 'errore');
      }
    }
    return accettate;
  } catch (err) {
    console.error('[push] invio non riuscito:', err.message);
    return 0;
  }
}

// Il percorso del sito → il percorso dell'app, per chi tocca la notifica (lo usa anche il server per provare la corrispondenza).
// Ritorna { tipo: 'ordine'|'richiesta'|'ordini', id? }.
function destinazioneApp(link) {
  const l = String(link || '');
  let m = /^\/ordini\/(\d+)/.exec(l);
  if (m) return { tipo: 'ordine', id: Number(m[1]) };
  m = /^\/richieste\/(\d+)/.exec(l);
  if (m) return { tipo: 'richiesta', id: Number(m[1]) };
  return { tipo: 'ordini' };
}

module.exports = { registra, rimuovi, rimuoviUtente, tokenDi, inviaAUtente, destinazioneApp, impostaInvio, attivo, TOKEN_VALIDO };
