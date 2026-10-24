// I clienti del banco: l'elenco, la scheda di un cliente (con il materiale ordinato), l'approvazione o il rifiuto.
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const format = require('../format');
const anagrafiche = require('../anagrafiche');
const materialeModulo = require('../materiale');

const router = creaRouter();

// Mostra l'elenco dei clienti del banco: da approvare, approvati e non riconosciuti.
router.get('/distributore/clienti', requireRole('distributore'), async (req, res) => {
  // Una query sola, con l'ultimo ordine di ogni cliente (`ultimo_ordine`). Ordine per ragione sociale fatto qui, senza badare alle maiuscole: quello
  // del DB dipende dalla collazione.
  const elenco = await anagrafiche.clientiDelDistributore(req.session.user.distributor_id);
  const perNome = (a, b) => String(a.ragione_sociale).localeCompare(String(b.ragione_sociale), 'it', { sensitivity: 'base' });
  const conStato = (stato) => elenco.filter((c) => c.stato === stato).sort(perNome);
  res.render('distributore_clienti', {
    titolo: 'Clienti',
    daApprovare: conStato('in_attesa'),
    approvati: conStato('approvato'),
    rifiutati: conStato('rifiutato'),
    tipi: anagrafiche.TIPI_SOGGETTO,
  });
});

// Scarica il materiale del cliente in CSV (stessi numeri della scheda "Materiale ordinato", ";" e BOM per Excel): solo per un cliente approvato di
// questo banco.
router.get('/distributore/clienti/:id/materiale.csv', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const cliente = await db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(req.params.id);
  const rapporto = cliente ? await anagrafiche.legame(distributorId, cliente.id) : null;
  if (!cliente || !rapporto || rapporto.stato !== 'approvato') {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Cliente non trovato.' });
  }
  const materiale = await materialeModulo.materialeCliente(distributorId, cliente.id, { mese: req.query.mese });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + materialeModulo.nomeFileCsvCliente(cliente.ragione_sociale, materiale.mese) + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(materialeModulo.csvMaterialeCliente(materiale));
});

// Mostra la scheda di un cliente. Per un cliente approvato mostra anche tutti gli ordini fatti a questo banco, col materiale e i prezzi IVA inclusa; per
// uno da verificare o rifiutato, i dati e il riquadro per decidere. Se il cliente non ha indicato questo banco risponde 404.
router.get('/distributore/clienti/:id', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const cliente = await db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(req.params.id);
  const rapporto = cliente ? await anagrafiche.legame(distributorId, cliente.id) : null;
  if (!cliente || !rapporto) {
    return res.status(404).render('errore', {
      titolo: 'Non trovato',
      messaggio: 'Questo cliente non ti ha indicato come distributore di riferimento.',
      link: '/distributore/clienti',
      linkTesto: 'Torna ai clienti',
    });
  }

  // Solo per i clienti approvati: TUTTI gli ordini fatti a questo banco, col materiale e i prezzi IVA inclusa (src/materiale.js, gli stessi numeri dello
  // Storico dell'installatore). Il filtro del mese e la vista (per ordine / per articolo) stanno nell'URL.
  const materiale = rapporto.stato === 'approvato'
    ? await materialeModulo.materialeCliente(distributorId, cliente.id, {
        mese: req.query.mese,
        vista: req.query.vista,
        ditta: res.locals.bancoTesta ? res.locals.bancoTesta.nome : '',
      })
    : null;

  res.render('distributore_cliente', {
    titolo: cliente.ragione_sociale,
    cliente,
    rapporto,
    materiale,
    tipi: anagrafiche.TIPI_SOGGETTO,
    indirizzoCliente: format.indirizzoCompleto(cliente),
  });
});

// Registra la decisione del banco su un cliente: lo approva (con il suo codice cliente e le note) oppure lo rifiuta.
router.post('/distributore/clienti/:id/decidi', requireRole('distributore'), async (req, res) => {
  const esito = await anagrafiche.decidi(req.session.user.distributor_id, parseInt(req.params.id, 10), {
    approva: req.body.azione === 'approva',
    codiceCliente: req.body.codice_cliente,
    note: req.body.note,
  });
  if (!esito.ok) {
    return res.status(400).render('errore', { titolo: 'Non riuscito', messaggio: esito.errore });
  }
  res.redirect('/distributore/clienti/' + req.params.id);
});

module.exports = router;
