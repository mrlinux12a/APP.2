// L'elenco di tutti i gruppi di rotte del sito. Ogni gruppo sta nel suo file; qui si montano nell'ordine in cui Express li prova.
// Le rotte che servono prima della sessione (webhook di Stripe, canale degli eventi) non sono qui: le monta src/app.js al posto giusto.
const autenticazione = require('./autenticazione');
const cliente = require('./cliente');
const notifiche = require('./notifiche');
const banco = require('./banco');
const agente = require('./agente');

// Tutte le pagine e le API del sito che richiedono la sessione, nell'ordine di montaggio. `cliente` (l'installatore) e `banco` (il distributore) sono una
// cartella ciascuno; autenticazione, notifiche e agente sono usati da più ruoli o da uno solo che non ha una cartella.
const GRUPPI = [autenticazione, cliente, notifiche, banco, agente];

// Monta tutti i gruppi di rotte sull'app.
function montaRotte(app) {
  for (const gruppo of GRUPPI) app.use(gruppo);
}

module.exports = { montaRotte };
