// "Password dimenticata?" dell'installatore (richiesta del 20/10/2026). Il percorso:
//  1. chi non ricorda la password scrive il suo nome utente o la sua email (GET/POST /password-dimenticata);
//  2. per ogni account cliente attivo che corrisponde parte UNA email, all'indirizzo SALVATO nell'account (mai a uno scritto da chi chiede), con un
//     link che porta a /reimposta-password/<codice>;
//  3. il link vale un'ora e una volta sola; sul DB resta solo l'hash SHA-256 del codice (tabella recupero_password), quindi chi legge il database non
//     può usarlo. Un link nuovo annulla i precedenti;
//  4. scegliendo la nuova password si chiudono TUTTE le sessioni web dell'account e si revocano gli accessi dell'app: chi aveva la vecchia password esce.
//
// La risposta alla richiesta è SEMPRE la stessa, che l'account esista o no (niente elenco di chi è iscritto), e l'invio dell'email non si aspetta: nemmeno
// il tempo di risposta dice qualcosa. Vale solo per i clienti (gli installatori): banco e agente hanno altri canali. Senza email nell'account (o senza
// SMTP configurato, vedi src/email.js) non parte niente: in quel caso resta solo il supporto.
const crypto = require('crypto');
const db = require('../db');
const email = require('./email');
const { erroriNuovaPassword } = require('./password');
const { scriviNuovaPassword } = require('./password_account');

const VALIDITA_MIN = 60;
const MAX_ACCOUNT_PER_RICHIESTA = 3; // più account con la stessa email: al massimo tre mail (una per account), non un'inondazione

// L'impronta (hash) del codice di recupero: nel database si salva questa, mai il codice.
const hashCodice = (codice) => crypto.createHash('sha256').update(String(codice)).digest('hex');
// Un codice fatto come quelli che generiamo (32 byte in base64url = 43 caratteri): qualunque altra cosa non si cerca nemmeno nel DB.
const codiceBenFatto = (codice) => typeof codice === 'string' && /^[A-Za-z0-9_-]{43}$/.test(codice);
// Controlla che un testo sia un indirizzo email scritto in modo plausibile.
const emailValida = (testo) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(testo || '').trim());

// I clienti attivi con questo nome utente o questa email (senza badare alle maiuscole).
async function accountDa(identificativo) {
  const testo = String(typeof identificativo === 'string' ? identificativo : '').trim().slice(0, 200);
  if (!testo) return [];
  return db
    .prepare(
      `SELECT id, username, email, referente, ragione_sociale
         FROM users
        WHERE ruolo = 'cliente' AND attivo = 1
          AND (lower(username) = lower(?) OR (email <> '' AND lower(email) = lower(?)))
        ORDER BY id
        LIMIT ${MAX_ACCOUNT_PER_RICHIESTA}`
    )
    .all(testo, testo);
}

// Prepara i link e manda le email. `baseUrl`: l'indirizzo pubblico del sito (senza barra finale); senza, non si manda niente (un link con un indirizzo
// scelto da chi chiede permetterebbe di rubare il codice). `invia`: per le prove.
// Ritorna { trovati, consegne }: `trovati` = account che corrispondono; `consegne` = la promessa dell'invio (CHI RISPONDE ALLA RICHIESTA NON LA ASPETTA, i
// test sì), che si risolve con la lista dei link generati ([{ username, link, inviata }]).
async function richiedi(identificativo, { baseUrl, invia = email.inviaRecuperoPassword } = {}) {
  const accounts = (await accountDa(identificativo)).filter((a) => emailValida(a.email));
  const preparati = [];
  for (const a of accounts) {
    const codice = crypto.randomBytes(32).toString('base64url');
    await db.transaction(async () => {
      // I link già mandati non valgono più: vale l'ultimo.
      await db.prepare('UPDATE recupero_password SET usato_il = NOW() WHERE user_id = ? AND usato_il IS NULL').run(a.id);
      await db
        .prepare(`INSERT INTO recupero_password (user_id, token_hash, scade_il) VALUES (?, ?, NOW() + INTERVAL '${VALIDITA_MIN} minutes')`)
        .run(a.id, hashCodice(codice));
    })();
    preparati.push({ a, link: baseUrl ? baseUrl + '/reimposta-password/' + codice : '' });
  }
  const consegne = Promise.all(
    preparati.map(async ({ a, link }) => {
      if (!link) {
        console.error('[recupero password] APP_URL non impostato: il link non si può mandare (vedi README).');
        return { username: a.username, link: '', inviata: false };
      }
      const r = await invia({ a: String(a.email).trim(), username: a.username, nome: a.referente || a.ragione_sociale, link, validitaMin: VALIDITA_MIN });
      return { username: a.username, link, inviata: !!(r && r.inviata) };
    })
  ).catch((err) => {
    console.error('[recupero password] invio non riuscito:', err.message);
    return [];
  });
  return { trovati: accounts.length, consegne };
}

// L'account a cui appartiene il codice, se il link è ancora buono (non scaduto, non usato, account attivo): { recupero_id, id, username } o null.
async function accountDaCodice(codice) {
  if (!codiceBenFatto(codice)) return null;
  const riga = await db
    .prepare(
      `SELECT r.id AS recupero_id, u.id, u.username
         FROM recupero_password r
         JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = ? AND r.usato_il IS NULL AND r.scade_il > NOW() AND u.attivo = 1 AND u.ruolo = 'cliente'`
    )
    .get(hashCodice(codice));
  return riga || null;
}

// Sceglie la nuova password. Ritorna { ok: true, username } | { ok: false, nonValido: true } (link scaduto, già usato o inventato) | { ok: false, errori }.
// Il link si "consuma" nella stessa transazione che cambia la password: due invii insieme non la cambiano due volte e un guasto non brucia il link.
async function reimposta(codice, { nuova, ripeti } = {}) {
  const account = await accountDaCodice(codice);
  if (!account) return { ok: false, nonValido: true };
  const errori = erroriNuovaPassword(nuova, ripeti);
  if (Object.keys(errori).length) return { ok: false, errori };

  let consumato = false;
  await db.transaction(async () => {
    const r = await db
      .prepare('UPDATE recupero_password SET usato_il = NOW() WHERE id = ? AND usato_il IS NULL AND scade_il > NOW()')
      .run(account.recupero_id);
    if (!r || !r.changes) return; // un altro invio ha già usato il link
    consumato = true;
    await db.prepare('UPDATE recupero_password SET usato_il = NOW() WHERE user_id = ? AND usato_il IS NULL').run(account.id);
    // Nessuna sessione da tenere: chi sta reimpostando non è collegato, e se lo era (qualcun altro, un'altra scheda) esce anche lui.
    await scriviNuovaPassword(account.id, nuova, '');
  })();
  return consumato ? { ok: true, username: account.username } : { ok: false, nonValido: true };
}

module.exports = { VALIDITA_MIN, richiedi, accountDaCodice, reimposta, accountDa, hashCodice };
