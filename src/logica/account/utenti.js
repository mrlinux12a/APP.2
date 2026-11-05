// Letture degli utenti usate da più pagine: l'accesso (sito e app), l'anagrafica dell'installatore e la scheda cliente del banco.
const db = require('../../../db');

// L'utente attivo con questo nome di accesso, o undefined. È la prima cosa che fanno l'accesso del sito e quello dell'app.
async function utenteAttivoPerUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
}

// L'utente con questo id (di qualunque ruolo), o undefined.
async function utentePerId(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Il cliente (l'installatore) con questo id; un utente di un altro ruolo non conta. Undefined se non c'è.
async function clientePerId(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(id);
}

module.exports = { utenteAttivoPerUsername, utentePerId, clientePerId };
