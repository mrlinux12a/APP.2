const crypto = require('crypto');
const db = require('../db');

// Accessi dell'app nativa. Il telefono conserva il token in chiaro (nel portachiavi del
// sistema); nel DB ne resta solo l'hash, così chi legge la tabella non può riusarlo.
// Un token non usato per GIORNI_INATTIVITA giorni smette di valere: stesso spirito della
// sessione web "rolling", che resta viva finché si usa l'app.
const GIORNI_INATTIVITA = 60;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function creaToken(userId, dispositivo) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db
    .prepare('INSERT INTO app_tokens (user_id, token_hash, dispositivo) VALUES (?, ?, ?)')
    .run(userId, hashToken(token), dispositivo ? String(dispositivo).slice(0, 120) : null);
  return token;
}

// Restituisce l'utente (attivo) a cui appartiene il token, o null.
async function utenteDaToken(token) {
  if (!token) return null;
  const riga = await db
    .prepare(
      `SELECT t.id AS token_id, t.usato_il, u.*
         FROM app_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?
          AND t.revocato_il IS NULL
          AND t.usato_il > NOW() - INTERVAL '${GIORNI_INATTIVITA} days'
          AND u.attivo = 1`
    )
    .get(hashToken(token));
  if (!riga) return null;
  // Rinnova la scadenza al massimo una volta l'ora: non serve una scrittura per ogni
  // chiamata dell'app, basta sapere che il token è ancora in uso.
  db.prepare(
    `UPDATE app_tokens SET usato_il = NOW() WHERE id = ? AND usato_il < NOW() - INTERVAL '1 hour'`
  )
    .run(riga.token_id)
    .catch((err) => console.error('Rinnovo token app fallito:', err.message));
  return riga;
}

async function revocaToken(token) {
  if (!token) return;
  await db
    .prepare('UPDATE app_tokens SET revocato_il = NOW() WHERE token_hash = ? AND revocato_il IS NULL')
    .run(hashToken(token));
}

module.exports = { creaToken, utenteDaToken, revocaToken };
