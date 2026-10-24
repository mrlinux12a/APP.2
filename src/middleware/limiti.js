// Limiti di richieste per indirizzo (express-rate-limit): fermano chi inonda il sito, senza dare fastidio a chi lo usa. Si aggiungono ai limiti per nome
// utente di src/limite_login.js (tentativi di accesso sbagliati, registrazioni, richieste di recupero password), che restano.
// I contatori stanno in memoria del processo: sulla VPS c'è un solo processo, quindi bastano; con più processi ognuno conterebbe per conto suo.
const rateLimit = require('express-rate-limit');
const impostazioni = require('../config/limiti');
const { rispondiErrore } = require('../http');

// Una risposta "troppe richieste" (429): JSON per le API, la pagina di errore per il resto, con quanti secondi aspettare.
function rispostaTroppeRichieste(req, res) {
  const resetTime = req.rateLimit && req.rateLimit.resetTime;
  const attesaSec = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : null;
  if (attesaSec) res.set('Retry-After', String(attesaSec));
  return rispondiErrore(req, res, 429);
}

// Crea un limitatore: al massimo `massimo` richieste ogni `finestraMs` per indirizzo. Con `soloFalliti` contano solo le richieste finite male (stato 400
// o più): serve per l'accesso, dove un login riuscito (redirect) non deve consumare i tentativi. Con i limiti spenti (LIMITE_RICHIESTE_DISATTIVATO=1,
// solo per le prove) non fa niente.
function creaLimitatore({ finestraMs, massimo, soloFalliti = false }) {
  if (impostazioni.disattivati) return (req, res, next) => next();
  return rateLimit({
    windowMs: finestraMs,
    limit: massimo,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: soloFalliti,
    handler: rispostaTroppeRichieste,
  });
}

module.exports = {
  creaLimitatore,
  // Tutte le pagine e le API (i file statici e il webhook di Stripe passano prima, senza contare).
  generale: creaLimitatore(impostazioni.generale),
  // Login, registrazione e recupero password: contano solo i tentativi andati male.
  accesso: creaLimitatore({ ...impostazioni.accesso, soloFalliti: true }),
  // Ricerche nel catalogo: ogni digitazione è una query sul database.
  ricerca: creaLimitatore(impostazioni.ricerca),
  // Indirizzo dalla posizione: chiama un servizio esterno.
  indirizzo: creaLimitatore(impostazioni.indirizzo),
};
