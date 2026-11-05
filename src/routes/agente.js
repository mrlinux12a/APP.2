// Le pagine dell'agente (il gestore del sistema, che vede tutti gli ordini).
const { creaRouter } = require('./base');
const { requireRole } = require('../middleware/auth');
const datiOrdini = require('../logica/ordini/ordini');

const router = creaRouter();

// Mostra l'elenco di tutti gli ordini arrivati (con cliente e distributore), dal più recente.
router.get('/agente/ordini', requireRole('agente'), async (req, res) => {
  const ordini = await datiOrdini.ordiniConClienteEDistributore();
  res.render('agente/ordini', { titolo: 'Ordini in arrivo', ordini });
});

module.exports = router;
