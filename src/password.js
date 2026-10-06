const bcrypt = require('bcryptjs');

// Confronto della password di un accesso, condiviso dal login del sito e da quello dell'app.
//
// - Asincrono: bcrypt.compareSync occupava il processo per ~60 ms a ogni tentativo, e in quel tempo
//   nessun'altra richiesta veniva servita.
// - Per un nome utente che non esiste si confronta comunque con un hash fittizio, così il tempo di
//   risposta non rivela se l'utente c'è.
// - Una password che non è testo (array o oggetto da un form `extended`) non vale mai.
const HASH_FITTIZIO = bcrypt.hashSync('password-che-non-corrisponde-a-nessuno', 10);

// `utente` è la riga di `users` (o null se il nome utente non esiste).
async function passwordValida(password, utente) {
  const testo = typeof password === 'string' ? password : '';
  const corrisponde = await bcrypt.compare(testo, utente ? utente.password_hash : HASH_FITTIZIO);
  return !!utente && corrisponde;
}

module.exports = { passwordValida };
