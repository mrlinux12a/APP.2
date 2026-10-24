// Indirizzi del sito da scrivere fuori dal sito (email, ritorno da Stripe): mai presi dall'intestazione Host se non in locale.

// I nomi con cui il sito si chiama quando lo si apre dal proprio computer.
const HOST_LOCALI = ['localhost', '127.0.0.1', '::1'];

// Dice se la richiesta arriva dal computer di chi sviluppa (non dal sito pubblico).
const eLocale = (req) => HOST_LOCALI.includes(req.hostname);

// Indirizzo del sito da scrivere nelle email (link per reimpostare la password): APP_URL del .env; senza, vale solo in locale. Mai l'intestazione Host,
// che la scrive chi chiama: un link verso un sito altrui farebbe rubare il codice.
function urlPerEmail(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || (eLocale(req) ? req.protocol + '://' + req.get('host') : '');
}

// Indirizzo del sito, per il ritorno da Stripe (3-D Secure e simili): APP_URL nel .env (in produzione, con il dominio vero); senza, quello della
// richiesta (va bene in locale).
function urlBase(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || req.protocol + '://' + req.get('host');
}

module.exports = { HOST_LOCALI, eLocale, urlPerEmail, urlBase };
