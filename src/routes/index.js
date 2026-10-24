// L'elenco di tutti i gruppi di rotte del sito. Ogni gruppo sta nel suo file; qui si montano nell'ordine in cui Express li prova.
// Le rotte che servono prima della sessione (webhook di Stripe, canale degli eventi) non sono qui: le monta src/app.js al posto giusto.
const autenticazione = require('./autenticazione');
const profilo = require('./profilo');
const catalogo = require('./catalogo');
const carrello = require('./carrello');
const richieste = require('./richieste');
const pagamenti = require('./pagamenti');
const ordini = require('./ordini');
const notifiche = require('./notifiche');
const banco = require('./banco');
const bancoAnagrafica = require('./banco_anagrafica');
const bancoClienti = require('./banco_clienti');
const agente = require('./agente');

// Tutte le pagine e le API del sito che richiedono la sessione, nell'ordine di montaggio.
const GRUPPI = [autenticazione, profilo, catalogo, carrello, richieste, pagamenti, ordini, notifiche, banco, bancoAnagrafica, bancoClienti, agente];

// Monta tutti i gruppi di rotte sull'app.
function montaRotte(app) {
  for (const gruppo of GRUPPI) app.use(gruppo);
}

module.exports = { montaRotte, GRUPPI };
