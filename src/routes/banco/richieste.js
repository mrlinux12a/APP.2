// Il dettaglio di una richiesta al banco (`GET /distributore/richieste/:id`), la risposta ("Conferma" / "Non disponibile") e "Elimina dal banco".
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const { ritornoBanco, conRitorno, vuoleJson } = require('../../comune/http');
const pricing = require('../../logica/pagamenti/pricing');
const format = require('../../comune/format');
const richieste = require('../../logica/ordini/richieste');
const datiOrdini = require('../../logica/ordini/ordini');
const utenti = require('../../logica/account/utenti');
const anagrafiche = require('../../logica/account/anagrafiche');
const { rispostaConTempi, eliminaRichiestaDalBanco } = require('../../logica/banco/banco');
const richiestaBanco = require('../../logica/banco/richiesta');
const whatsapp = require('../../logica/whatsapp/whatsapp');

const router = creaRouter();

// Mostra il dettaglio di una richiesta al banco: a sinistra il materiale (tabella con listino, prezzo cliente e totale) e i passi dopo la conferma, a
// destra cosa fare (timer e pulsanti, oppure lo stato dopo la risposta), il cliente e "Elimina dal banco". Lo stato, la tabella e i passi si preparano in
// src/logica/banco/richiesta.js; la vista (views/banco/dettaglio.ejs) disegna. Se l'ordine è già "Da preparare" porta direttamente alla pagina dell'ordine.
router.get('/distributore/richieste/:id', requireRole('distributore'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  const distributorId = req.session.user.distributor_id;
  // `secondi_da_risposta`: da quanto il banco ha risposto (lo stesso calcolo della home, per il tempo di attesa del corriere).
  const risposta = richiesta ? await rispostaConTempi(richiesta.id, distributorId) : null;
  if (!richiesta || !risposta) {
    return res.status(404).render('comune/errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }

  // Letture indipendenti: partono insieme (col DB su un altro server ogni query in sequenza costa ~50 ms).
  const [cliente, offerta, distributore, ordine, secondi, minutiRisposta, minutiTesto, legameCliente] = await Promise.all([
    utenti.utentePerId(richiesta.cliente_id),
    richieste.calcolaOfferta(richiesta.id, distributorId),
    anagrafiche.distributorePerId(distributorId),
    richiesta.order_id ? datiOrdini.ordinePerId(richiesta.order_id) : null,
    richieste.secondiRimasti(richiesta),
    pricing.getFinestraMinuti(),
    pricing.getFinestraMinutiTesto(),
    // La scheda del cliente si apre solo se il cliente ha indicato questo banco (altrimenti la pagina risponde 404).
    anagrafiche.legame(distributorId, richiesta.cliente_id),
  ]);

  // La risposta si può ancora dare solo se la finestra è aperta e nessuno ha già ordinato.
  const apribile =
    risposta.esito === 'in_attesa' &&
    secondi > 0 &&
    richiesta.stato !== 'ordinata' &&
    richiesta.stato !== 'annullata';
  const ordineMio = !!ordine && ordine.distributor_id === distributorId;
  // L'ordine è nella colonna "Da preparare" della home finché è 'inviato' (e non segnato consegnato).
  const ordineDaPreparare = ordineMio && ordine.stato === 'inviato' && !ordine.consegnato_il;
  const stato = richiestaBanco.statoRichiestaBanco({ richiesta, risposta, apribile, ordineMio, ordineDaPreparare });

  // La freccia riporta alla pagina da cui si è arrivati (`torna`: Storico, scheda cliente...), altrimenti alla home.
  const daDove = ritornoBanco(req.query.torna, '');

  // Quando l'ordine è "Da preparare" (un corriere ha accettato, o non ce n'è bisogno) la richiesta non ha più una sua pagina: si va dritti a quella
  // dell'ordine (materiale, ritiro del corriere, "Preparato"). Anche la pagina in attesa del corriere, che si ricarica da sola, arriva qui. La freccia
  // dell'ordine riporta da dove si era partiti (`daDove`: la home se non c'è), non alla richiesta.
  if (stato.chiave === 'da_preparare') return res.redirect(conRitorno('/distributore/ordini/' + ordine.id, daDove));

  const conCorriere = whatsapp.attivo();
  // "confermata alle 21:05" (ora italiana): solo se il banco ha confermato.
  const oraConferma = risposta.esito === 'confermato' && risposta.risposto_il ? format.oraSolaRoma(risposta.risposto_il) : null;

  res.render('banco/dettaglio', {
    titolo: 'Richiesta #' + richiesta.id,
    // Non si chiama `indietro`: l'intestazione del banco (partials/banco/banco_testa), inclusa dalla vista, ne disegnerebbe un'altra freccia.
    paginaPrecedente: daDove || '/distributore',
    minutiRisposta,
    minutiTesto, // il numero scritto nel testo di "richiesta chiusa" (10); minutiRisposta serve all'anello
    richiesta,
    risposta,
    cliente,
    distributore,
    offerta,
    ordine,
    ordineMio,
    secondi,
    apribile,
    stato,
    materiale: richiestaBanco.tabellaMateriale(offerta.righe, (riga) => pricing.prezzoNetto(riga), {
      confermata: risposta.esito === 'confermato',
    }),
    // Timer: la finestra intera serve all'anello, la soglia al passaggio al rosso (data-* sulla scheda, assets/js).
    finestraSecondi: Math.max(1, Math.round(minutiRisposta * 60)),
    sogliaUrgenteSec: richiestaBanco.SOGLIA_URGENTE_SEC,
    ricevuta: richiestaBanco.quandoRicevuta(format.giornoRoma(richiesta.creato_il), format.oraSolaRoma(richiesta.creato_il)),
    scadenzaOra: format.oraSolaRoma(richiesta.scade_il),
    // Da confermare: "Cosa succede dopo la conferma" (siamo al primo passo). In attesa del corriere: "Avanzamento", con la conferma fatta e, se il
    // modulo WhatsApp è acceso, il passo dei corrieri in corso.
    passi: richiestaBanco.passiDopoConferma({
      conCorriere,
      corrente: stato.chiave === 'da_confermare' ? 'conferma' : conCorriere ? 'corrieri' : 'prepara',
      avanzamento: stato.chiave === 'attesa_corriere' ? { conCorriere, oraConferma } : null,
    }),
    mostraPassi: ['da_confermare', 'attesa_corriere'].includes(stato.chiave),
    oraConferma,
    // Secondi da quando il banco ha confermato: il cerchio dell'attesa e "da N min" partono da qui (data-trascorsi) e salgono.
    trascorsi: Math.max(0, Number(risposta.secondi_da_risposta) || 0),
    conCorriere,
    schedaClienteAperta: !!legameCliente,
    destinazione: richiesta.destinazione || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente) || '',
    errore: req.query.errore || null,
  });
});

// Registra la risposta del banco a una richiesta. Il banco ha solo due azioni possibili: accettare tutto il richiesto al prezzo standard, o rifiutare. Si
// può rispondere sia dal dettaglio della richiesta sia con un click diretto dalla card "Da confermare" in home (in tal caso "torna" riporta alla home
// invece che al dettaglio, ma solo se la risposta va a buon fine).
router.post('/distributore/richieste/:id/rispondi', requireRole('distributore'), async (req, res) => {
  const esitoRisposta = await richieste.rispondi(req.params.id, req.session.user.distributor_id, {
    rifiuta: req.body.azione === 'rifiuta',
    prezzoRichiesto: req.body.azione === 'prezzo_richiesto',
    utenteId: req.session.user.id,
    // Tempi non più scelti dal banco: partenza/consegna stimata restano un default fisso finché non saranno calcolati dal corriere collegato via API.
    // Non si leggono dal corpo della richiesta: la pagina non li manda più, e un valore enorme scritto a mano finiva in una colonna intera ("out of
    // range", 500).
    partenza_ore: 2,
    consegna_ore: 6,
  });

  // "Conferma" dall'avviso a comparsa (assets/js, "Avvisi del banco") risponde senza lasciare la pagina: chiede JSON e lo riceve, niente redirect.
  if (vuoleJson(req)) return res.status(esitoRisposta.ok ? 200 : 409).json({ ok: !!esitoRisposta.ok, errore: esitoRisposta.ok ? null : esitoRisposta.errore });

  const base = '/distributore/richieste/' + req.params.id;
  if (!esitoRisposta.ok) return res.redirect(base + '?errore=' + encodeURIComponent(esitoRisposta.errore));
  res.redirect(req.body.torna === 'home' ? '/distributore' : base);
});

// Elimina una richiesta dal banco (locale: sparisce solo dal suo banco, da "da confermare" e dallo storico). Se la richiesta è già ordinata su un altro
// banco elimina solo la propria risposta; se è l'unica risposta rimasta e non è ordinata, elimina anche la richiesta vuota (e fa tornare il pagamento).
router.post('/distributore/richieste/:id/elimina', requireRole('distributore'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  const risposta = richiesta ? await richieste.getRisposta(richiesta.id, req.session.user.distributor_id) : null;
  if (!richiesta || !risposta) return res.status(404).render('comune/errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  await eliminaRichiestaDalBanco(richiesta, risposta);
  res.redirect('/distributore');
});

module.exports = router;
