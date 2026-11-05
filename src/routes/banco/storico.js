// Lo Storico ordini del banco (`GET /distributore/storico`) e il dettaglio che si apre sotto una riga (`GET /distributore/storico/:id/dettaglio`).
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const { ritornoBanco } = require('../../comune/http');
const storicoBanco = require('../../logica/banco/storico');
const storicoDettaglio = require('../../logica/banco/storico_dettaglio');
const { contatoriBanco, ordineDelBanco } = require('../../logica/banco/banco');

const router = creaRouter();

// Mostra lo Storico ordini del banco: la lista di tutti gli ordini della filiale, con filtri per stato e periodo, ricerca e paginazione. Sta tutto
// nell'URL (?stato=&periodo=&q=&pagina=), vedi src/logica/banco/storico.js. Prende il posto di "Tutti gli ordini" (/distributore/ordini, che ora rimanda qui) e
// dello "Storico richieste".
router.get('/distributore/storico', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const filtri = storicoBanco.leggiFiltri(req.query);
  const [storico, contatori] = await Promise.all([
    storicoBanco.storicoOrdini(distributorId, filtri),
    contatoriBanco(distributorId),
  ]);
  res.render('banco/storico', {
    titolo: 'Storico ordini',
    contatori,
    filtri,
    link: (modifiche) => storicoBanco.urlStorico(filtri, modifiche),
    ...storico,
  });
});

// Dà il dettaglio di una riga dello Storico: un frammento HTML (views/partials/banco/storico_dettaglio.ejs) che la pagina carica al primo clic sulla riga e mette
// sotto di essa (assets/js, "Storico ordini: righe che si aprono"): materiale a prezzo del banco, "Come è andata" e i pulsanti. Solo ordini del banco
// loggato. SOLA LETTURA: non chiama prendiInCarico né scrive niente, qualunque sia lo stato dell'ordine (aprire il dettaglio non lo cambia). `torna` (la
// pagina dello Storico com'è adesso, scritta dallo script) vale solo se è una pagina del banco (ritornoBanco): il pulsante "Apri ordine completo" la porta
// con sé, con l'ancora #o<id> della riga, così la freccia della pagina dell'ordine riporta allo Storico con la stessa voce aperta.
router.get('/distributore/storico/:id/dettaglio', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.status(404).type('text/plain').send('Ordine non trovato.');
  const dettaglio = await storicoDettaglio.leggiDettaglio(ordine);
  const torna = ritornoBanco(req.query.torna, '/distributore/storico').split('#')[0];
  res.render('partials/banco/storico_dettaglio', { ...dettaglio, tornaStorico: torna + '#o' + ordine.id });
});

module.exports = router;
