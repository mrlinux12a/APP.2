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

// Le regole di una password NUOVA (le stesse della registrazione, vedi anagrafiche.validaIscrizione): almeno 8 caratteri, al massimo 72 (bcrypt considera
// solo i primi 72 byte: oltre non aggiunge sicurezza). Ritorna gli errori per campo: { nuova: 'testo', ripeti: 'testo' }, vuoto se va bene.
const LUNGHEZZA_MINIMA_PASSWORD = 8;
const LUNGHEZZA_MASSIMA_PASSWORD = 72;

// Controlla una nuova password e la sua ripetizione (lunghezza minima e massima, devono coincidere); restituisce gli errori per campo, vuoto se va
// bene.
function erroriNuovaPassword(nuova, ripeti) {
  const errori = {};
  const pwd = typeof nuova === 'string' ? nuova : '';
  if (pwd.length < LUNGHEZZA_MINIMA_PASSWORD) errori.nuova = `La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`;
  else if (pwd.length > LUNGHEZZA_MASSIMA_PASSWORD) errori.nuova = `La password può avere al massimo ${LUNGHEZZA_MASSIMA_PASSWORD} caratteri.`;
  else if (pwd !== (typeof ripeti === 'string' ? ripeti : '')) errori.ripeti = 'Le due password non coincidono.';
  return errori;
}

module.exports = { passwordValida, erroriNuovaPassword, LUNGHEZZA_MINIMA_PASSWORD, LUNGHEZZA_MASSIMA_PASSWORD };
