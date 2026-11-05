// La home del banco (`GET /distributore`): la bacheca a tre colonne con le richieste da confermare, quelle in attesa del corriere e gli ordini da preparare.
// Le colonne si preparano in src/logica/banco/bacheca.js; la vista (views/banco/richieste.ejs) le disegna.
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const { BACHECA } = require('../../config/bacheca');
const { bachecaBanco } = require('../../logica/banco/bacheca');

const router = creaRouter();

// Mostra la home del banco: bacheca a tre colonne, nell'ordine in cui passa una richiesta.
router.get('/distributore', requireRole('distributore'), async (req, res) => {
  const colonne = await bachecaBanco(req.session.user.distributor_id);
  res.render('banco/richieste', { titolo: 'Richieste al banco', bacheca: BACHECA, ...colonne });
});

module.exports = router;
