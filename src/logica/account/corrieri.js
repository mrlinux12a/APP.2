// Gli account dei corrieri (ruolo 'corriere', vedi docs/app-corrieri.md): registrazione dall'app e ricerca per email.
//
// Il corriere NON ha un nome utente scelto da lui: entra con l'email. Per non toccare la colonna `users.username` (obbligatoria e unica) ci si scrive
// l'email in minuscolo: così l'unicità dell'email è garantita dal database, due registrazioni insieme non passano entrambe, e il login del sito (che
// cerca per `username`) trova l'account e può dire "si usa dall'app". Un nome utente di un installatore non contiene mai una chiocciola (vedi
// anagrafiche.validaIscrizione), quindi i due insiemi non si sovrappongono.
const bcrypt = require('bcryptjs');
const db = require('../../../db');
const { erroriNuovaPassword } = require('./password');

const RUOLO_CORRIERE = 'corriere';
// Ruoli che esistono solo nell'app: il sito non li fa entrare.
const RUOLI_SOLO_APP = [RUOLO_CORRIERE, 'supervisore_corrieri'];
const LUNGHEZZA_MASSIMA = 200; // come i dati anagrafici dell'installatore: nessun nome o email reale è più lungo
const LUNGHEZZA_MASSIMA_NOME = 100;

// Testo ripulito: un campo di JSON può arrivare come numero, array o oggetto, qui diventa sempre una stringa.
function pulisci(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

// L'email com'è salvata e confrontata: senza spazi ai lati e in minuscolo.
function normalizzaEmail(v) {
  return pulisci(v).toLowerCase();
}

// Un indirizzo email scritto in modo plausibile (lo stesso controllo leggero della registrazione dell'installatore).
function emailValida(testo) {
  return testo.length <= LUNGHEZZA_MASSIMA && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testo);
}

// Il sito non è per questi ruoli.
function eSoloApp(ruolo) {
  return RUOLI_SOLO_APP.includes(ruolo);
}

// Controlla i dati della registrazione. Ritorna [{ testo, campi }] come la registrazione dell'installatore: il messaggio e i campi dell'app a cui si
// riferisce (nome, cognome, email, password). Lista vuota = si può registrare.
async function validaRegistrazione(dati) {
  const d = dati && typeof dati === 'object' ? dati : {};
  const errori = [];
  const errore = (testo, ...campi) => errori.push({ testo, campi });

  const nome = pulisci(d.nome);
  const cognome = pulisci(d.cognome);
  if (!nome) errore('Scrivi il tuo nome.', 'nome');
  else if (nome.length > LUNGHEZZA_MASSIMA_NOME) errore('Il nome è troppo lungo.', 'nome');
  if (!cognome) errore('Scrivi il tuo cognome.', 'cognome');
  else if (cognome.length > LUNGHEZZA_MASSIMA_NOME) errore('Il cognome è troppo lungo.', 'cognome');

  const email = normalizzaEmail(d.email);
  if (!email) errore('Scrivi la tua email.', 'email');
  else if (!emailValida(email)) errore("L'email non sembra valida.", 'email');
  else if (await db.prepare('SELECT id FROM users WHERE username = ?').get(email)) errore('Questa email è già registrata.', 'email');

  // Qui non c'è "Ripeti la password": la ripetizione è la password stessa, quindi restano solo i limiti di lunghezza.
  const password = typeof d.password === 'string' ? d.password : '';
  const erroriPassword = erroriNuovaPassword(password, password);
  if (erroriPassword.nuova) errore(erroriPassword.nuova, 'password');

  return errori;
}

// Crea l'account del corriere (i dati devono aver già passato validaRegistrazione) e ritorna la riga di `users`. Se nel frattempo un'altra registrazione ha
// preso la stessa email il database rifiuta (codice 23505) e l'errore sale a chi chiama.
async function registra(dati) {
  const nome = pulisci(dati.nome);
  const cognome = pulisci(dati.cognome);
  const email = normalizzaEmail(dati.email);
  // L'hash (asincrono, ~60 ms di calcolo) si fa prima di scrivere: non blocca il processo.
  const passwordHash = await bcrypt.hash(String(dati.password), 10);
  const info = await db
    .prepare(
      `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, nome, cognome, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(RUOLO_CORRIERE, email, passwordHash, `${nome} ${cognome}`, nome, cognome, email);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
}

// L'utente attivo che si presenta con questa email, di qualunque ruolo, o undefined. Prima per nome utente (per il corriere è l'email), poi per l'email scritta
// nel profilo: serve a dire a un installatore che ha scritto la sua email nell'accesso dei corrieri "questo non è un account corriere" (dopo aver controllato la
// password: senza, la risposta direbbe a chiunque chi è iscritto).
async function utenteDaEmail(email) {
  const e = normalizzaEmail(email).slice(0, LUNGHEZZA_MASSIMA);
  if (!e) return undefined;
  return db
    .prepare(
      `SELECT * FROM users
        WHERE attivo = 1 AND (username = ? OR (email <> '' AND lower(email) = ?))
        ORDER BY (username = ?) DESC, id
        LIMIT 1`
    )
    .get(e, e, e);
}

module.exports = { RUOLO_CORRIERE, RUOLI_SOLO_APP, eSoloApp, normalizzaEmail, emailValida, validaRegistrazione, registra, utenteDaEmail };
