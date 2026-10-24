// La pagina di pagamento con Stripe e il ritorno da Stripe. La carta non passa mai dal nostro server (Payment Element, public/pagamento.js).
// La logica dei pagamenti sta in src/stripe_pagamenti.js: qui solo le pagine.
const { creaRouter } = require('./base');
const { requireRole } = require('../auth');
const pricing = require('../pricing');
const pagamenti = require('../pagamenti');
const stripePagamenti = require('../stripe_pagamenti');
const { eLocale, urlBase } = require('../services/url_sito');

const router = creaRouter();

// Decide cosa fare dopo un tentativo di pagamento (ritorno da Stripe o pagina già pagata): la richiesta è nata -> alla sua schermata di attesa; la sta
// creando qualcun altro -> pagina che si ricarica da sola; carta non autorizzata -> di nuovo il form; respinto -> errore con il motivo; altro -> carrello.
function esitoPagamento(req, res, esito) {
  if (esito.esito === 'ok') {
    if (esito.tipo !== 'reinvio') req.session.carrello = {};
    return res.redirect('/richieste/' + esito.requestId);
  }
  if (esito.esito === 'in_corso') return res.render('pagamento_esito', { titolo: 'Pagamento in corso' });
  if (esito.esito === 'da_pagare') return res.redirect('/pagamento/' + esito.id + '?riprova=1');
  if (esito.esito === 'rifiutato') {
    return res.status(400).render('errore', { titolo: esito.titolo, messaggio: esito.messaggio, link: '/carrello', linkTesto: 'Torna al riepilogo' });
  }
  if (esito.esito === 'non_configurato') {
    return res.status(503).render('errore', {
      titolo: 'Pagamento non disponibile',
      messaggio:
        'Il pagamento online non è ancora configurato. Non è stato addebitato nulla.' +
        // Chi sviluppa in locale deve sapere cosa guardare: ai clienti veri non si dice niente delle chiavi.
        (eLocale(req)
          ? ' In locale: controlla le chiavi Stripe nel .env (la pubblicabile deve iniziare con pk_test_) e gli avvisi [stripe] nel log del server.'
          : ''),
      link: '/carrello',
      linkTesto: 'Torna al riepilogo',
    });
  }
  return res.redirect('/carrello'); // annullato o sconosciuto: il cliente è tornato indietro senza pagare
}

// Il cliente torna dal pagamento: da Stripe dopo il 3-D Secure (con ?payment_intent=...) o dal nostro script, subito dopo aver pagato senza
// reindirizzamenti. Se la carta è autorizzata la richiesta nasce adesso, se non è già nata (la crea chi arriva primo fra questa pagina, il webhook e il
// timer).
router.get('/pagamento/esito', requireRole('cliente'), async (req, res) => {
  if (!stripePagamenti.attivo()) return res.redirect('/carrello');
  esitoPagamento(req, res, await stripePagamenti.esitoRitorno(req.query.payment_intent, req.session.user.id));
});

// Mostra la pagina di pagamento: riepilogo e form di Stripe (Payment Element, public/pagamento.js). La carta non passa dal nostro server. Solo il
// cliente della riga; se la carta è già autorizzata, si va avanti.
router.get('/pagamento/:id', requireRole('cliente'), async (req, res) => {
  if (!stripePagamenti.attivo()) return res.redirect('/carrello');
  const pagina = await stripePagamenti.preparaPagina(Number(req.params.id), req.session.user.id);
  if (pagina.esito !== 'pagina') return esitoPagamento(req, res, pagina);
  res.render('pagamento', {
    titolo: 'Pagamento',
    ...pagina,
    ritorno: urlBase(req) + '/pagamento/esito',
    minutiTesto: await pricing.getFinestraMinutiTesto(), // il numero scritto sotto il pulsante: 10, anche se il timer è accorciato per le prove
    riprova: req.query.riprova === '1',
    // In sandbox la pagina lo dice (carta di prova, nessun addebito): su un sito pubblico lasciato per sbaglio in prova nessuno deve credere di aver pagato.
    modoProva: pagamenti.modoStripe() === 'test',
  });
});

module.exports = router;
