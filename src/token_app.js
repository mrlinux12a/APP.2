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

// Ogni chiamata dell'app verifica il token sul DB: una lettura in più prima ancora di
// rispondere. Un token valido si ricorda per un minuto (vale anche per l'aggiornamento di
// "usato_il", che comunque avviene al massimo una volta l'ora); logout e revoca lo tolgono
// subito. Un utente disattivato smette di entrare entro un minuto.
const DURATA_RICORDO_MS = 60 * 1000;
const ricordati = new Map(); // hash del token -> { riga, scade }

function ricorda(hash, riga) {
  const adesso = Date.now();
  ricordati.set(hash, { riga, scade: adesso + DURATA_RICORDO_MS });
  if (ricordati.size > 1000) {
    for (const [k, v] of ricordati) if (v.scade <= adesso) ricordati.delete(k);
  }
}

// Restituisce l'utente (attivo) a cui appartiene il token, o null.
async function utenteDaToken(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const ricordato = ricordati.get(hash);
  if (ricordato && ricordato.scade > Date.now()) return ricordato.riga;
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
    .get(hash);
  if (!riga) return null;
  ricorda(hash, riga);
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
  ricordati.delete(hashToken(token));
  await db
    .prepare('UPDATE app_tokens SET revocato_il = NOW() WHERE token_hash = ? AND revocato_il IS NULL')
    .run(hashToken(token));
}

module.exports = { creaToken, utenteDaToken, revocaToken };
