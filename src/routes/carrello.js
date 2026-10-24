// Il carrello dell'installatore: aggiungere e togliere pezzi, il riepilogo "Cosa paghi e a chi" con gli orari del banco, e l'indirizzo di consegna dalla
// posizione del telefono.
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const { percorsoInterno } = require('../http');
const { QUANTITA_MASSIMA, leggiId, leggiQuantita } = require('../input');
const pricing = require('../pricing');
const richieste = require('../richieste');
const orari = require('../orari');
const geo = require('../geo');
const flusso = require('../flusso_cliente');
const { getCarrello, contaCarrello, righeCarrello, aggiornaCarrelloDaForm } = require('../services/carrello_sessione');
const limiti = require('../middleware/limiti');

const router = creaRouter();

// ---------- API del carrello (aggiunta asincrona: Aggiungi -> reset stepper -> mini-card) ----------

// Dà il contenuto del carrello (quantità per prodotto, pezzi e totale merce). Le pagine lo rileggono quando tornano visibili.
router.get('/api/carrello', requireRole('cliente'), async (req, res) => {
  const carrello = getCarrello(req);
  const righe = await righeCarrello(req);
  const totali = await pricing.calcolaOrdine(righe);
  // `totale_finale` (nome storico) è la merce a prezzo del banco: lo stesso prezzo di catalogo e carrello; il 10% sta solo nel Servizio.
  res.json({ carrello, pezzi: contaCarrello(req), totale_finale: totali.totale_netto });
});

// Aggiunge un prodotto al carrello (sommando la quantità a quella già presente, fino al tetto per riga).
router.post('/api/carrello/aggiungi', requireRole('cliente'), async (req, res) => {
  const id = leggiId(req.body.id || req.body.product_id);
  const qty = leggiQuantita(req.body.qty || req.body.quantita);
  if (!id || !qty) return res.status(400).json({ ok: false, errore: 'Quantità non valida.' });
  const prodotto = await db.prepare('SELECT id FROM products WHERE id = ? AND attivo = 1').get(id);
  if (!prodotto) return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  const carrello = getCarrello(req);
  carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + qty);
  const pezzi = contaCarrello(req);
  res.json({ ok: true, carrello, pezzi, prodottoQty: carrello[id] });
});

// Aggiunge più prodotti insieme al carrello. Un articolo non valido o non più attivo si salta senza fermare gli altri.
router.post('/api/carrello/aggiungi-batch', requireRole('cliente'), async (req, res) => {
  // Un elemento che non è un oggetto ({id, qty}) si scarta: il destructuring di null/numeri lanciava un errore.
  const items = Array.isArray(req.body.items) ? req.body.items.filter((v) => v && typeof v === 'object') : [];
  if (!items.length) return res.status(400).json({ ok: false, errore: 'Nessun articolo.' });
  const richiesti = items
    .map(({ id, qty }) => ({ pid: leggiId(id), q: leggiQuantita(qty) }))
    .filter(({ pid, q }) => pid && q);
  // Un articolo non valido o non più attivo si salta: prima un "return" dentro il ciclo chiudeva la route senza rispondere, il pulsante restava su "…"
  // e il carrello non si salvava.
  const attivi = richiesti.length
    ? new Set(
        (await db.prepare('SELECT id FROM products WHERE attivo = 1 AND id = ANY(?::int[])').all(richiesti.map((r) => r.pid)))
          .map((p) => p.id)
      )
    : new Set();
  const carrello = getCarrello(req);
  const aggiornati = {};
  for (const { pid, q } of richiesti) {
    if (!attivi.has(pid)) continue;
    carrello[pid] = Math.min(QUANTITA_MASSIMA, (carrello[pid] || 0) + q);
    aggiornati[pid] = carrello[pid];
  }
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), aggiornati });
});

// Imposta la quantità di un prodotto nel carrello (zero lo toglie) e risponde con tutti i totali già scritti in testo: la pagina li riscrive senza
// ricaricarsi (+ e − dello stepper).
router.post('/api/carrello/imposta', requireRole('cliente'), async (req, res) => {
  const id = leggiId(req.body.id);
  const qty = leggiQuantita(req.body.qty);
  if (!id) return res.status(400).json({ ok: false, errore: 'Prodotto non valido.' });
  const carrello = getCarrello(req);
  if (qty > 0) carrello[id] = qty;
  else delete carrello[id];
  // righeCarrello legge i prodotti attivi: se quello appena impostato non c'è (id inventato, articolo tolto dal catalogo) esce anche dal carrello,
  // così il conteggio dei pezzi resta quello vero.
  const righe = await righeCarrello(req);
  if (qty > 0 && !righe.some((r) => r.prodotto.id === id)) {
    return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  }
  // Gli stessi totali della pagina Carrello (flusso.riepilogoCarrello: con corriere e servizio): `riepilogo` ha le voci già in testo, con le chiavi dei
  // `[data-riep]` della vista, e `totali_righe` il totale di ogni riga a prezzo del banco. public/app.js riscrive la pagina da qui.
  const riepilogo = await flusso.riepilogoCarrello(righe);
  res.json({
    ok: true,
    carrello,
    pezzi: contaCarrello(req),
    totali: riepilogo.totali,
    righe: righe.length,
    riepilogo: riepilogo.vista,
    totali_righe: Object.fromEntries(righe.map((r) => [r.prodotto.id, pricing.euro(pricing.round2(pricing.prezzoNetto(r.prodotto) * r.quantita))])),
  });
});

// Dalla posizione del dispositivo all'indirizzo: il carrello (blocco "Carrello: indirizzo di consegna" di public/app.js) ne precompila "Consegna in
// cantiere". Senza una via trovata (o fuori dall'Italia) `indirizzo` è vuoto e il campo resta da scrivere a mano. `precisione` = i metri di incertezza
// che dichiara il dispositivo: oltre geo.PRECISIONE_CIVICO_M il civico non si scrive (`civico: false`, `precisa: false`: sarebbe quello di un'altra casa)
// e il carrello lo chiede a chi paga.
router.get('/api/indirizzo', limiti.indirizzo, requireRole('cliente'), async (req, res) => {
  const precisioneM = req.query.precisione ? Number(req.query.precisione) : NaN;
  const trovato = await geo.indirizzoDaPosizioneDettaglio(Number(req.query.lat), Number(req.query.lng), { precisioneM });
  if (!trovato) return res.json({ ok: false, indirizzo: '' });
  res.json({ ok: true, indirizzo: trovato.indirizzo, civico: trovato.civico, precisa: trovato.precisa });
});

// ---------- Pagine del carrello ----------

// Salva le quantità scritte nel modulo (dal catalogo o dal riepilogo) e porta al riepilogo o alla pagina da cui si veniva.
router.post('/carrello', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  // "Procedi" non manda più la richiesta: porta al riepilogo, dove si conferma.
  if (req.body.azione === 'procedi') return res.redirect('/carrello');
  // `ritorno` lo scrive il browser: solo un percorso di questo sito vale (percorsoInterno), mai un indirizzo esterno.
  return res.redirect(percorsoInterno(req.body.ritorno, '/carrello'));
});

// Mostra il riepilogo prima di procedere: articoli, quantità, prezzi, destinazione, note, totale da pagare. Da qui si paga e parte la richiesta: dopo
// l'installatore non sceglie più niente.
router.get('/carrello', requireRole('cliente'), async (req, res) => {
  const righe = await righeCarrello(req);
  // Il banco è aperto? Fuori dagli orari impostati nella sua "Anagrafica" il pulsante di pagamento dice quando riapre e non si può premere (lo stesso
  // controllo lo rifà il server al momento di pagare). A carrello vuoto non serve: niente query in più.
  const [riepilogo, banco, cliente] = await Promise.all([
    flusso.riepilogoCarrello(righe),
    righe.length ? richieste.bancoPerInstallatore() : { stato: { aperto: true, riapre: null, chiude: null }, nome: '' },
    db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id),
  ]);
  const statoBanco = banco.stato;

  // Gli articoli che "Riordina" ha saltato (POST /storico/:id/riordina): l'avviso si mostra una volta sola.
  const saltati = Number(req.session.avvisoCarrello) || 0;
  delete req.session.avvisoCarrello;

  res.render('carrello', {
    titolo: 'Riepilogo',
    // Una chiave nuova a ogni apertura della pagina: identifica l'invio di QUESTO carrello (vedi flusso.chiaveInvioValida).
    chiaveInvio: require('crypto').randomBytes(12).toString('hex'),
    avviso: saltati === 1 ? '1 articolo non è più disponibile' : saltati > 1 ? saltati + ' articoli non sono più disponibili' : '',
    righe,
    // Fuori orario il carrello si riempie ma non si invia (richiesta esplicita del 22/10/2026): in alto il riquadro "Ordini chiusi", sotto il pulsante
    // spento e la nota con quando riapre. Poco prima della chiusura (orari.IN_CHIUSURA_MIN) una striscia sopra la barra di pagamento dice quanto manca.
    // Tutti i testi: orari.testiChiuso.
    bancoChiuso: !statoBanco.aperto,
    fraseBancoChiuso: orari.frasePerCarrello(statoBanco),
    testiChiuso: orari.testiChiuso(statoBanco, banco.nome),
    avvisoChiusura: orari.avvisoChiusura(statoBanco),
    // Fra quanti secondi lo stato cambia da solo (chiude/riapre): la pagina si rilegge a quell'ora, e quando il banco cambia gli orari (evento 'orari')
    // o la scheda torna visibile.
    cambiaSec: orari.secondiAlCambio(statoBanco),
    ...riepilogo,
    cliente,
    // Solo a carrello vuoto: la scheda "Il tuo ultimo ordine" con "Rimetti nel carrello" (una lettura sola).
    ultimoOrdine: righe.length ? null : await flusso.ultimoOrdineConsegnato(req.session.user.id),
  });
});

// Mostra "Orari di BOREA" (richiesta esplicita del 22/10/2026): a quali ore si può inviare una richiesta, dagli orari impostati nella "Anagrafica del
// banco" (mai scritti nel codice). Ci si arriva da "Vedi orari" del carrello quando è chiuso. L'installatore vede la ditta, mai la filiale: gli orari
// delle filiali si mettono insieme.
router.get('/orari', requireRole('cliente'), async (req, res) => {
  const banco = await richieste.bancoPerInstallatore();
  const nome = banco.nome || 'il banco';
  res.render('orari_banco', { titolo: 'Orari di ' + nome, intestazione: banco.nome ? 'Orari di ' + banco.nome : 'Orari del banco', nomeBanco: nome, pagina: orari.paginaOrari(banco.distributori, banco.nome) });
});

// Svuota il carrello e porta alla home.
router.post('/carrello/svuota', requireRole('cliente'), async (req, res) => {
  req.session.carrello = {};
  res.redirect('/home');
});

module.exports = router;
