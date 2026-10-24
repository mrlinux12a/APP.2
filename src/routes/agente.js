// Le pagine dell'agente (il gestore del sistema, che vede tutti gli ordini).
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');

const router = creaRouter();

// Mostra l'elenco di tutti gli ordini arrivati (con cliente e distributore), dal più recente.
router.get('/agente/ordini', requireRole('agente'), async (req, res) => {
  const ordini = await db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome, d.nome AS distributore_nome
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
         LEFT JOIN distributors d ON d.id = o.distributor_id
        ORDER BY o.creato_il DESC`
    )
    .all();
  res.render('agente_ordini', { titolo: 'Ordini in arrivo', ordini });
});

module.exports = router;
