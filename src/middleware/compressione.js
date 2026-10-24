// Compressione delle risposte.
const compression = require('compression');

// Comprime HTML, JSON, CSS e JS (sotto 1 KB no): la ricerca in JSON passa da ~46 KB a pochi KB, che su rete mobile è la parte più lenta. Le foto sono
// già compresse (webp) e restano intatte. Gli eventi in tempo reale (GET /api/eventi) NON si comprimono: la compressione tratterrebbe i messaggi
// invece di mandarli subito.
function comprimiRisposte() {
  return compression({ filter: (req, res) => (req.path === '/api/eventi' ? false : compression.filter(req, res)) });
}

module.exports = { comprimiRisposte };
