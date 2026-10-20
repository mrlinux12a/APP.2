// Cambio della password di un utente già collegato, uguale per ogni ruolo (installatore: "La mia anagrafica"; banco: "Anagrafica del banco").
// Prima stava dentro src/anagrafica_banco.js; qui lo usano anche il profilo dell'installatore e il recupero della password (src/recupero_password.js).
//
// Regole: la password ATTUALE deve essere giusta (si controlla con passwordValida); la nuova vale come in registrazione (8-72 caratteri, uguale alla
// ripetizione) e deve essere DIVERSA dall'attuale. Dopo il cambio si chiudono le ALTRE sessioni web dello stesso utente (chi aveva la vecchia password
// esce; quella da cui si cambia resta) e si revocano i suoi accessi dall'app nativa (token Bearer): la password nuova non lascia aperto niente di vecchio.
const bcrypt = require('bcryptjs');
const db = require('../db');
const tokenApp = require('./token_app');
const { passwordValida, erroriNuovaPassword } = require('./password');

// Controlli sui campi del modulo (attuale, nuova, ripeti): errori per campo, `{}` se va bene.
function controllaCambioPassword(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const attuale = typeof c.attuale === 'string' ? c.attuale : '';
  const nuova = typeof c.nuova === 'string' ? c.nuova : '';
  const ripeti = typeof c.ripeti === 'string' ? c.ripeti : '';
  const errori = {};
  if (!attuale) errori.attuale = 'Scrivi la password attuale.';
  Object.assign(errori, erroriNuovaPassword(nuova, ripeti));
  if (!errori.nuova && !errori.ripeti && attuale && nuova === attuale) errori.nuova = 'La nuova password deve essere diversa da quella attuale.';
  return { attuale, nuova, errori };
}

// Toglie dalla tabella `session` tutte le sessioni di un utente tranne una (come src/account.js: l'id sta in sess -> user -> id). Senza sessione da
// tenere (`''`) le toglie tutte: lo fa il recupero della password, dove chi lo chiede non è collegato.
async function chiudiAltreSessioni(utenteId, sessioneDaTenere) {
  await db
    .prepare(`DELETE FROM session WHERE (sess::jsonb #>> '{user,id}') = ? AND sid <> ?`)
    .run(String(utenteId), String(sessioneDaTenere || ''));
}

// Revoca tutti gli accessi dell'app nativa di un utente (l'app dovrà rifare l'accesso con la password nuova) e li fa dimenticare alla memoria del server
// (un token già ricordato varrebbe ancora fino a un minuto).
async function revocaAccessiApp(utenteId) {
  await db.prepare('UPDATE app_tokens SET revocato_il = NOW() WHERE user_id = ? AND revocato_il IS NULL').run(utenteId);
  tokenApp.dimenticaUtente(utenteId);
}

// Scrive la nuova password (hash bcrypt come al login e alla registrazione) e chiude gli altri accessi. Senza controlli: li ha già fatti chi chiama.
async function scriviNuovaPassword(utenteId, nuova, sessioneDaTenere) {
  const hash = await bcrypt.hash(nuova, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, utenteId);
  await chiudiAltreSessioni(utenteId, sessioneDaTenere);
  await revocaAccessiApp(utenteId);
}

// Cambia la password: controlla l'attuale, salva l'hash e chiude gli altri accessi. Ritorna { ok: true } o { ok: false, errori }; `passwordSbagliata`
// distingue "l'attuale non è giusta" (conta nel limite dei tentativi) dai campi che non vanno (non conta).
async function cambiaPassword(utenteId, sessioneCorrente, corpo) {
  const { attuale, nuova, errori } = controllaCambioPassword(corpo);
  const utente = await db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(utenteId);
  if (!utente) return { ok: false, errori: { attuale: 'Utente non trovato.' } };
  // Con l'attuale mancante o la nuova scorretta non si guarda nemmeno l'attuale: il tentativo non conta come errore di password.
  if (Object.keys(errori).length) return { ok: false, errori };
  if (!(await passwordValida(attuale, utente))) return { ok: false, errori: { attuale: 'La password attuale non è corretta.' }, passwordSbagliata: true };
  await scriviNuovaPassword(utenteId, nuova, sessioneCorrente);
  return { ok: true };
}

module.exports = { controllaCambioPassword, chiudiAltreSessioni, revocaAccessiApp, scriviNuovaPassword, cambiaPassword };
