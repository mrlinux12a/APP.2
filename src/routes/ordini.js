// Gli ordini dell'installatore: "Stato ordini", lo Storico (materiale ordinato, CSV, ricevute in PDF, "Riordina") e la pagina di un singolo ordine.
// Non c'è più "riepilogo con il distributore scelto" né "Invia l'ordine": l'installatore paga con la richiesta e l'ordine nasce da solo quando il corriere
// prende la consegna (src/richieste.js).
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireLogin, requireRole } = require('../auth');
const { QUANTITA_MASSIMA } = require('../input');
const pricing = require('../pricing');
const orariCorriere = require('../corriere');
const materialeModulo = require('../materiale');
const ricevuteModulo = require('../ricevute');
const notifiche = require('../notifiche');
const flusso = require('../flusso_cliente');
const { getCarrello } = require('../services/carrello_sessione');
const { rifiutaEliminazioneOrdine, inviaPdf } = require('../services/risposte_flusso');
const { strisciaPer } = require('../services/striscia_ordini');

const router = creaRouter();

// ---------- Stato ordini ----------

// Dà solo il link "Stato ordini" della barra in basso, già aggiornato: lo richiede lo script di partials/nav_ordini.ejs mentre una richiesta è in attesa o
// un ordine è in consegna. Dalla home (?scheda=1) segue anche la scheda di stato in cima (partials/stato_home.ejs).
router.get('/nav/stato-ordini', requireRole('cliente'), (req, res) => {
  res.render('partials/nav_ordini', {
    attivo: String(req.query.attivo || ''),
    parziale: true,
    conScheda: req.query.scheda === '1',
  });
});

// "Stato ordini": con una sola attività in corso porta dritto alla sua pagina (richiesta in attesa o ordine in consegna); con due o più porta a quella
// indicata da ?voce=<tipo>-<id> (se è fra le voci) o alla PRIMA, la più urgente: lì, sopra la pagina intera dell'ordine, c'è la striscia di schede per
// passare dall'uno all'altro (partials/striscia_ordini.ejs); senza niente, la pagina vuota. Le voci e il loro ordine sono quelli dell'icona in basso
// (flusso.vociStriscia).
router.get('/ordini', requireRole('cliente'), async (req, res) => {
  const voci = await flusso.vociStriscia(req.session.user.id, { segnaLette: true, breve: false });
  if (voci.length >= 2) {
    const scelta = voci.find((v) => v.voce === String(req.query.voce || ''));
    return res.redirect((scelta || voci[0]).href);
  }
  if (voci.length === 1) return res.redirect(voci[0].href);
  res.render('ordini_cliente', { titolo: 'Stato ordini', minutiTesto: await pricing.getFinestraMinutiTesto() });
});

// ---------- Storico ----------

// Mostra lo Storico ordini dell'installatore: il materiale ordinato, con i prezzi IVA inclusa, e quanto deve al banco (a BOREA). In app paga solo il
// servizio e la consegna; il calcolo è di src/materiale.js, lo stesso che usa il banco (vedi quel file). Raggiungibile dal menu del profilo.
router.get('/storico', requireRole('cliente'), async (req, res) => {
  const materiale = await materialeModulo.materialeOrdini({
    clienteId: req.session.user.id, mese: req.query.mese, vista: req.query.vista,
  });
  res.render('storico', { titolo: 'Storico ordini', materiale });
});

// Scarica lo stesso materiale in CSV (";" e BOM per Excel): solo gli ordini del cliente loggato.
router.get('/storico/materiale.csv', requireRole('cliente'), async (req, res) => {
  const materiale = await materialeModulo.materialeOrdini({ clienteId: req.session.user.id, mese: req.query.mese });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + materialeModulo.nomeFileCsv(materiale) + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(materialeModulo.csvMateriale(materiale));
});

// ---------- Ricevute di pagamento in PDF (src/ricevute.js) ----------

// Manda il PDF della ricevuta di un ordine (di pagamento o di rimborso). Solo il cliente proprietario dell'ordine, e solo per un pagamento incassato (la
// carta si incassa quando nasce l'ordine, e vale anche per i pagamenti di prova): per un blocco annullato o una richiesta in attesa non c'è nessuna
// ricevuta. Il PDF si apre nel browser (inline).
async function ricevutaPdfDellOrdine(req, res, tipo) {
  const dati = await ricevuteModulo.datiRicevuta(Number(req.params.id), { tipo, clienteId: req.session.user.id });
  if (!dati) {
    return res.status(404).render('errore', {
      titolo: 'Ricevuta non disponibile',
      messaggio: tipo === 'rimborso' ? "Per questo ordine non c'è una ricevuta di rimborso." : "Per questo ordine non c'è una ricevuta di pagamento.",
      link: '/ordini/' + req.params.id,
      linkTesto: "Torna all'ordine",
    });
  }
  inviaPdf(res, await ricevuteModulo.pdfRicevute([dati], tipo === 'rimborso' ? 'Ricevuta di rimborso' : 'Ricevuta di pagamento'), ricevuteModulo.nomeFilePdf(dati));
}

// Apre la ricevuta di pagamento di un ordine.
router.get('/ordini/:id/ricevuta.pdf', requireRole('cliente'), (req, res) => ricevutaPdfDellOrdine(req, res, 'pagamento'));

// Apre la ricevuta di rimborso di un ordine.
router.get('/ordini/:id/ricevuta-rimborso.pdf', requireRole('cliente'), (req, res) => ricevutaPdfDellOrdine(req, res, 'rimborso'));

// "Ricevute del mese" dello Storico: un solo PDF con una pagina per ricevuta, per gli ordini del mese (?mese=AAAA-MM, o "tutto") che hanno un pagamento
// incassato, dal più vecchio. Le stesse regole dello Storico per il mese: valore mancante o sbagliato = il mese corrente (o il più recente).
router.get('/storico/ricevute.pdf', requireRole('cliente'), async (req, res) => {
  const clienteId = req.session.user.id;
  const materiale = await materialeModulo.materialeOrdini({ clienteId, mese: req.query.mese });
  const idOrdini = materiale.gruppi.flatMap((g) => g.ordini).filter((o) => o.ricevuta).map((o) => o.id).sort((a, b) => a - b);
  // Poche letture alla volta: ogni ricevuta ne fa alcune, e un mese può avere molti ordini.
  const elenco = [];
  for (let i = 0; i < idOrdini.length; i += 5) {
    const dati = await Promise.all(idOrdini.slice(i, i + 5).map((id) => ricevuteModulo.datiRicevuta(id, { tipo: 'pagamento', clienteId })));
    elenco.push(...dati.filter(Boolean));
  }
  if (!elenco.length) {
    return res.status(404).render('errore', {
      titolo: 'Nessuna ricevuta',
      messaggio: 'In questo periodo non ci sono ricevute di pagamento.',
      link: '/storico?mese=' + encodeURIComponent(materiale.mese),
      linkTesto: 'Torna allo storico',
    });
  }
  inviaPdf(res, await ricevuteModulo.pdfRicevute(elenco, 'Ricevute ' + materiale.mese), `ricevute-${materiale.mese}.pdf`);
});

// "Riordina" (solo sulle schede "Consegnato"): rimette nel carrello gli stessi articoli dell'ordine, sommati a quelli già presenti, e porta al carrello.
// Gli articoli tolti dal catalogo o non più disponibili si saltano: il carrello lo dice con un avviso (letto una volta sola da GET /carrello).
router.post('/storico/:id/riordina', requireRole('cliente'), async (req, res) => {
  const daRiordinare = await flusso.articoliDaRiordinare(req.session.user.id, req.params.id);
  if (!daRiordinare) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  if (daRiordinare === 'altrui') {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  const carrello = getCarrello(req);
  for (const { id, quantita } of daRiordinare.articoli) {
    carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + quantita);
  }
  if (daRiordinare.saltati) req.session.avvisoCarrello = daRiordinare.saltati;
  res.redirect('/carrello');
});

// ---------- Un ordine ----------

// Mostra la pagina di un ordine. Un cliente vede solo i propri ordini, un banco solo i suoi, l'agente li vede tutti. Per il cliente: ordine in consegna,
// consegnato o ritiro (con gli orari sotto i passi); per banco e agente, il markup storico.
router.get('/ordini/:id', requireLogin, async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });

  // un cliente può vedere solo i propri ordini; l'agente li vede tutti
  if (req.session.user.ruolo === 'cliente' && ordine.cliente_id !== req.session.user.id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  if (req.session.user.ruolo === 'distributore' && ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  // Il cliente sta guardando proprio questo ordine: un suo cambio di stato non deve anche accendere il pallino "Stato ordini" in basso.
  const eCliente = req.session.user.ruolo === 'cliente';
  // Le due notifiche segnate lette, il dettaglio e il materiale della striscia non dipendono uno dall'altro: partono insieme (questa pagina si apre a
  // ogni passaggio fra gli ordini di "Stato ordini", e ogni lettura in fila è un giro di rete).
  const [, , dettaglio, striscia] = await Promise.all([
    eCliente ? notifiche.segnaLetteCategoria(req.session.user.id, 'ordini') : null,
    eCliente ? notifiche.segnaLetteCategoria(req.session.user.id, 'richieste') : null,
    flusso.dettaglioOrdine(ordine),
    strisciaPer(req, res, 'ordine-' + ordine.id),
  ]);
  if (eCliente) {
    res.locals.ordiniNonLetti = 0;
    // Il cliente vede la ditta, non la filiale; banchi e agente sì (da dove parte il pacco).
    dettaglio.distributore = flusso.senzaFiliale(dettaglio.distributore);
  }
  res.render('ordine_dettaglio', {
    titolo: 'Ordine #' + ordine.id,
    ordine,
    // Quando il corriere arriva dal banco (il tempo scritto su WhatsApp): è l'unico orario del corriere che vede il banco.
    ritiroCorriere: orariCorriere.ritiro(ordine),
    nuovo: req.query.nuovo === '1',
    striscia,
    ...dettaglio,
  });
});

// Dice alla pagina dell'ordine in consegna se è stato consegnato. L'installatore NON conferma la consegna (richiesta esplicita del 21/10/2026): la segna il
// corriere dal sondaggio nel gruppo WhatsApp ("🚀 Segna come Consegnato", src/whatsapp.js → flusso.segnaConsegnatoDalCorriere). Questa rotta serve solo
// alla pagina dell'ordine in consegna, che la interroga ogni pochi secondi (data-attendi-consegna in app.js) e, appena l'ordine risulta consegnato, si
// ricarica mostrando la pagina "Consegnato".
router.get('/api/ordini/:id/consegnato', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) return res.status(404).json({ errore: 'non trovato' });
  res.set('Cache-Control', 'no-store');
  res.json({ consegnato: !!ordine.consegnato_il });
});

// Elimina un ordine (cliente): non si può mai, il banco ha già confermato e la carta è incassata. La pagina lo spiega e non cambia niente.
router.post('/ordini/:id/elimina', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  try {
    await flusso.eliminaOrdine(ordine.id);
  } catch (e) {
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e);
    throw e;
  }
  res.redirect('/ordini');
});

module.exports = router;
