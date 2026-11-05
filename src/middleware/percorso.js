// Controlli sul percorso della richiesta, prima che arrivi alle route: un %00 nell'indirizzo e un :id che non è un numero valido.
const { rispondiErrore } = require('./errori');

// Un %00 nel percorso (`/categoria/a%00b`) arriva ai parametri delle route: lo si respinge subito con un 400.
// (I NUL dentro la query e il corpo si tolgono invece in src/comune/http.js e in middleware/corpo.js.)
function rifiutaNulNelPercorso(req, res, next) {
  if (/%00/i.test(String(req.originalUrl || req.url || '').split('?')[0])) return rispondiErrore(req, res, 400);
  next();
}

// Id numerico positivo che entra in un int4 del DB. Con `/ordini/abc` o `/ordini/99999999999` la query
// falliva ("invalid input syntax for type integer", "out of range") e l'utente vedeva un errore 500 al
// posto di "non trovato". Si usa con app.param('id', idNumerico) e router.param('id', idNumerico):
// se non è valido il percorso viene saltato e si arriva al 404.
const ID_VALIDO = /^[1-9]\d{0,8}$/;

// Controllo dell':id negli indirizzi: se non è un numero intero valido l'indirizzo viene trattato come inesistente (404) invece di arrivare al
// database.
function idNumerico(req, res, next, valore) {
  if (ID_VALIDO.test(String(valore))) return next();
  return next('route');
}

module.exports = { rifiutaNulNelPercorso, idNumerico };
