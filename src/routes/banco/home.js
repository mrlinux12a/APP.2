// La home del banco (`GET /distributore`): la bacheca a tre colonne con le richieste da confermare, quelle in attesa del corriere e gli ordini da preparare,
// e il popup "Ispeziona" (`GET /distributore/ispeziona/:chiave`).
// Le colonne si preparano in src/logica/banco/bacheca.js; la vista (views/banco/richieste.ejs) le disegna. Il popup in src/logica/banco/ispeziona.js.
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const { BACHECA } = require('../../config/bacheca');
const { bachecaBanco } = require('../../logica/banco/bacheca');
const { schedaIspeziona } = require('../../logica/banco/ispeziona');

const router = creaRouter();

// Mostra la home del banco: bacheca a tre colonne, nell'ordine in cui passa una richiesta.
router.get('/distributore', requireRole('distributore'), async (req, res) => {
  const colonne = await bachecaBanco(req.session.user.distributor_id);
  res.render('banco/richieste', { titolo: 'Richieste al banco', bacheca: BACHECA, ...colonne });
});

// Il contenuto del popup "Ispeziona" di un lavoro (chiave "r177" o "o1281", vedi src/logica/banco/ispeziona.js): un pezzo di pagina già disegnato (cliente, tempo,
// tabella del materiale e pulsanti della fase in cui si trova), che lo script mette dentro il popup e rilegge a ogni cambiamento della bacheca. Sola lettura.
// 404 se il lavoro non esiste o è di un altro banco.
router.get('/distributore/ispeziona/:chiave', requireRole('distributore'), async (req, res) => {
  const scheda = await schedaIspeziona(req.session.user.distributor_id, req.params.chiave);
  res.set('Cache-Control', 'no-store');
  if (!scheda) return res.status(404).type('text/plain').send('Lavoro non trovato.');
  res.render('partials/banco/ispeziona', { scheda, bacheca: BACHECA });
});

module.exports = router;
