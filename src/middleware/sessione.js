// Sessione dell'utente (il cookie di accesso): dove si salva, quanto dura e come si protegge.
const session = require('express-session');
const { segretoSessione } = require('../config/ambiente');
const { ArchivioSessioni } = require('../sessioni');
const { salvaSessionePrimaDelRedirect } = require('../http');

// Crea i due pezzi della sessione, da montare uno dopo l'altro: la sessione vera (salvata nel database, così un riavvio non scollega nessuno) e il
// salvataggio forzato prima dei redirect (src/http.js).
function creaSessione() {
  return [
    session({
      store: new ArchivioSessioni(), // nel database (tabella session), così un riavvio non scollega nessuno
      secret: segretoSessione,
      resave: false,
      saveUninitialized: false,
      rolling: true, // ogni visita rinnova la scadenza: chi usa l'app resta dentro
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 giorni
        httpOnly: true,
        sameSite: 'lax',
        // Marcato "Secure" solo quando la richiesta arriva davvero in HTTPS (con `trust proxy` vale anche dietro un proxy): oggi il sito gira anche
        // su HTTP semplice, dove un cookie Secure non verrebbe mai rimandato.
        secure: 'auto',
      },
    }),
    salvaSessionePrimaDelRedirect,
  ];
}

module.exports = { creaSessione };
