// Le due rotte leggere che tengono allineata la barra del banco: i numeri (`/api/distributore/novita`) e la striscia con il pallino degli avvisi (`/distributore/stato-banco`).
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const bancoAvvisi = require('../../logica/banco/avvisi');

const router = creaRouter();

// Controllo leggero per le pagine del banco (assets/js, data-versione): restituisce gli stessi numeri che la pagina ha ricevuto, e il browser si
// ricarica solo se sono cambiati.
router.get('/api/distributore/novita', requireRole('distributore'), (req, res) => {
  res.json(res.locals.contatori || {});
});

// Dà i numeri della striscia arancio e del pallino su "Banco" (partials/banco/banco_avviso.ejs, assets/js "Avvisi del banco"): richieste da confermare e
// quanto manca alla prima, più l'elenco di quelle ancora aperte (con cliente, pezzi e scadenza) per tenere allineati gli avvisi "Nuova richiesta". Il
// browser la chiede ogni 15 s e subito quando arriva una notifica nuova.
router.get('/distributore/stato-banco', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  res.set('Cache-Control', 'no-store');
  if (!distributorId) return res.json({ daConfermare: 0, primaScadeSec: null, attesaCorriere: 0, daPreparare: 0, richieste: [] });
  res.json(await bancoAvvisi.statoBanco(distributorId, res.locals.contatori || {}));
});

module.exports = router;
