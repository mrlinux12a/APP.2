// Le richieste di disponibilità dell'installatore: mandarla ("Paga e invia"), vederla in attesa o chiusa, annullarla, rinviarla, eliminarla.
// La logica del flusso (qui e nelle altre rotte dell'installatore) sta in src/flusso_cliente.js, condivisa con l'API dell'app.
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const richieste = require('../richieste');
const flusso = require('../flusso_cliente');
const geo = require('../geo');
const stripePagamenti = require('../stripe_pagamenti');
const { righeCarrello, aggiornaCarrelloDaForm } = require('../services/carrello_sessione');
const { paginaErroreFlusso, rifiutaEliminazioneOrdine } = require('../services/risposte_flusso');
const { strisciaPer } = require('../services/striscia_ordini');

const router = creaRouter();

// "Paga e invia la richiesta": manda la richiesta ai distributori e apre l'attesa. Il pagamento è simulato, oppure (con STRIPE_SECRET_KEY nel .env) Stripe:
// allora da qui si va alla pagina di pagamento del sito (/pagamento/<id>) e la richiesta parte a carta autorizzata. Dal carrello arrivano le quantità
// visibili in pagina (modo 'imposta'): anche quelle scritte a mano e mai salvate, che prima andavano perse e la richiesta partiva con le vecchie.
router.post('/richieste', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body && req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  let requestId;
  try {
    // Non si invia senza un indirizzo di consegna (la pagina lo precompila dalla posizione, se c'è; altrimenti è vuoto e lo scrive l'installatore).
    const destinazione = String((req.body && req.body.destinazione) || '').trim();
    if (!destinazione) {
      throw new flusso.ErroreFlusso('destinazione', 'Manca l’indirizzo di consegna', 'Scrivi dove consegnare il materiale (via, numero, CAP, città) prima di pagare.');
    }
    // La posizione per il tragitto banco -> installatore è quella di questo indirizzo: le coordinate del dispositivo, se la pagina le ha mandate
    // (indirizzo preso dal pulsante "posizione" accanto al campo), altrimenti quelle dell'indirizzo scritto. Se non si trovano resta l'ultima posizione
    // nota (o la sede provvisoria).
    const posizione = await geo.posizioneDellaDestinazione(destinazione, req.body.dest_lat, req.body.dest_lng);
    if (posizione) await geo.salvaPosizioneCliente(req.session.user.id, posizione.lat, posizione.lng, null);
    // `chiave_invio` è scritta nella pagina del carrello: la stessa pagina dà una richiesta sola, comunque si clicchi.
    const dati = {
      destinazione: req.body && req.body.destinazione,
      note: req.body && req.body.note,
      chiaveInvio: req.body && req.body.chiave_invio,
    };
    if (stripePagamenti.pagaConStripe()) {
      // Con Stripe la richiesta non parte da qui: parte quando la carta è autorizzata (vedi /pagamento/esito, il webhook e il timer). Il carrello si
      // svuota solo allora.
      const pagamentoId = await stripePagamenti.avviaPagamento(req.session.user.id, await righeCarrello(req), dati);
      return res.redirect(303, '/pagamento/' + pagamentoId);
    }
    requestId = await flusso.nuovaRichiesta(req.session.user.id, await righeCarrello(req), dati);
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    // Questo invio ha già dato una richiesta (secondo clic, o "indietro" sulla stessa pagina): si va a quella.
    if (e.codice === 'gia_inviata' && e.requestId) {
      req.session.carrello = {};
      return res.redirect('/richieste/' + e.requestId);
    }
    return paginaErroreFlusso(res, e);
  }
  req.session.carrello = {};
  res.redirect('/richieste/' + requestId);
});

// Mostra una richiesta: la schermata di attesa con il timer (finché è in attesa) o la pagina "chiusa" (scaduta, annullata). Se è diventata un ordine porta
// all'ordine.
router.get('/richieste/:id', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  if (richiesta.stato === 'ordinata' && richiesta.order_id) {
    return res.redirect('/ordini/' + richiesta.order_id);
  }
  // Il cliente sta già guardando questa richiesta (schermata di attesa, che si auto-aggiorna): il cambio di stato non deve anche accendere il pallino in
  // basso. dettaglioRichiesta segna lette le notifiche, ma res.locals.ordiniNonLetti è già stato calcolato dal middleware prima di questa route: va
  // azzerato qui, altrimenti questa stessa risposta renderizzerebbe ancora il conteggio vecchio.
  // Dettaglio e materiale della striscia non dipendono uno dall'altro: un solo giro di rete invece di due.
  const [dati, striscia] = await Promise.all([
    flusso.dettaglioRichiesta(richiesta),
    strisciaPer(req, res, 'richiesta-' + richiesta.id),
  ]);
  res.locals.ordiniNonLetti = 0;
  // Una richiesta senza risposta resta in "Stato ordini" per 10 minuti dalla scadenza: se la si sta guardando quando finiscono, la pagina passa da sola a
  // "Stato ordini" (che mostra la prossima attività, o la pagina vuota). 0 = non è più in "Stato ordini" (aperta dallo Storico, o già oltre): nessun
  // passaggio automatico.
  const vista = { titolo: 'Richiesta #' + richiesta.id, striscia, lasciaFra: flusso.secondiAllaScomparsa(richiesta), ...dati };
  if (richiesta.stato === 'in_attesa') return res.render('richiesta_attesa', vista);
  return res.render('richiesta_chiusa', vista);
});

// Dà lo stato della richiesta alla schermata di attesa (si interroga ogni pochi secondi): stato, secondi rimasti, risposta di ogni banco e se si può
// ancora annullare.
router.get('/api/richieste/:id', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).json({ errore: 'non trovata' });
  }
  // Una voce per ditta: con due filiali la pagina (un solo badge per nome) mostrerebbe l'ultima in elenco, anche "Nessuna risposta" per la filiale chiusa
  // dopo la conferma dell'altra.
  const risposte = richieste.raggruppaRisposteDitta(await richieste.risposteRichiesta(richiesta.id));
  res.json({
    stato: richiesta.stato,
    // Con l'ordine già nato la pagina di attesa porta dritto all'ordine.
    order_id: richiesta.stato === 'ordinata' ? richiesta.order_id : null,
    secondi: await richieste.secondiRimasti(richiesta),
    risposte: risposte.map((r) => ({ nome: r.distributore_nome, esito: r.esito })),
    // "Annulla la richiesta" sparisce appena un banco conferma (anche se il corriere non ha ancora risposto: per l'installatore la ditta risulta ancora
    // "in attesa", ma l'annullamento non è più possibile).
    annullabile: richiesta.stato === 'in_attesa' && !risposte.some((r) => r.bancoConfermato),
  });
});

// Annulla la richiesta: solo in fase 1 (in attesa e nessun banco ha ancora accettato, vedi flusso.annullaRichiesta). Se nel frattempo un banco ha
// confermato, la richiesta resta com'è e si torna alla sua pagina.
router.post('/richieste/:id/annulla', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  if (!(await flusso.annullaRichiesta(richiesta.id))) return res.redirect('/richieste/' + richiesta.id);
  res.redirect('/ordini');
});

// Rinvia una richiesta chiusa senza risposta (nuovo pagamento e nuova finestra di conferma). Se non si può (banco chiuso fuori orario, richiesta non più
// rinviabile) si torna alla richiesta con la spiegazione.
router.post('/richieste/:id/reinvia', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  // Con Stripe il blocco sulla carta è stato rilasciato alla chiusura: per rinviare si autorizza di nuovo, e la richiesta si riapre a pagamento fatto.
  // Se non si può rinviare (banco chiuso fuori orario, richiesta non più rinviabile) si torna alla richiesta, non al carrello.
  const allaRichiesta = { link: '/richieste/' + richiesta.id, linkTesto: 'Torna alla richiesta' };
  if (stripePagamenti.pagaConStripe() && richiesta.stato === 'nessuna_offerta') {
    try {
      return res.redirect(303, '/pagamento/' + (await stripePagamenti.avviaPagamentoReinvio(req.session.user.id, richiesta)));
    } catch (e) {
      if (!(e instanceof flusso.ErroreFlusso)) throw e;
      return paginaErroreFlusso(res, e, allaRichiesta);
    }
  }
  try {
    res.redirect('/richieste/' + (await flusso.reinviaRichiesta(richiesta)));
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    paginaErroreFlusso(res, e, allaRichiesta);
  }
});

// Elimina una richiesta (cliente) — globale: sparisce anche per tutti i distributori (da confermare + storico). Se un banco ha già confermato non si può:
// la pagina lo spiega e non cambia niente.
router.post('/richieste/:id/elimina', requireRole('cliente'), async (req, res) => {
  const richiesta = await db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  try {
    await flusso.eliminaRichiesta(richiesta.id);
  } catch (e) {
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e);
    throw e;
  }
  res.redirect('/home');
});

module.exports = router;
