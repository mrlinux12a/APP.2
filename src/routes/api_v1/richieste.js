// Carrello e richiesta di disponibilità dell'app: riepilogo, orari, invio, annullamento, rinvio e pagamento della consegna.
const { creaRouter } = require('../base');
const pricing = require('../../logica/pagamenti/pricing');
const richieste =require('../../logica/ordini/richieste');
const flusso = require('../../logica/ordini/flusso_cliente');
const format = require('../../comune/format');
const orari = require('../../logica/ordini/orari');
const anagrafiche = require('../../logica/account/anagrafiche');
const pagamentiModulo = require('../../logica/pagamenti/pagamenti');
const stripePagamenti = require('../../logica/pagamenti/stripe_pagamenti');
const { e2, importiJson, richiedeCliente, statoPagamentoJson } = require('./ausiliari');

const router = creaRouter();

// Il carrello dell'app sta sul telefono: qui arrivano le quantità e il server rifà i conti
// con i prezzi veri, come la pagina Carrello del sito (merce, RAEE, spedizione, minimo).
router.post('/carrello/riepilogo', richiedeCliente, async (req, res) => {
  const righe = await flusso.righeDaQuantita(req.body && req.body.righe);
  const [r, intestazione] = await Promise.all([flusso.riepilogoCarrello(righe), anagrafiche.intestazioneCliente(req.utente.id).catch(() => null)]);
  const presenti = new Set(righe.map((x) => x.prodotto.id));
  res.json({
    merce: pricing.euro(r.totali.totale_netto), // a prezzo del banco: il 10% di servizio sta solo nella voce Servizio (`riepilogo`)
    raee: r.totali.contributo_raee > 0 ? pricing.euro(r.totali.contributo_raee) : null,
    spedizione: pricing.euro(r.spedizione),
    imponibile: pricing.euro(r.totali.imponibile),
    iva: pricing.euro(r.totali.iva),
    iva_pct: r.ivaPct,
    // La spesa complessiva (consegna + materiale). Quello che si paga ORA in app è `da_pagare_ora`; il resto si paga dopo al banco.
    totale_ivato: pricing.euro(r.totali.totale_ivato),
    da_pagare_ora: pricing.euro(r.totali.da_pagare_app),
    da_pagare_al_banco: pricing.euro(r.totali.materiale_banco),
    // Le due parti con ogni voce già in testo (corriere, servizio, IVA / merce, RAEE, IVA), come le disegna il carrello del sito.
    riepilogo: r.vista,
    // Nome della ditta a cui si paga il materiale ("BOREA"), per "Lo paghi dopo a ...".
    ditta: intestazione && intestazione.distributore ? format.nomeCommerciale(intestazione.distributore) : null,
    // Con la carta vera (Stripe) o di prova (nessun addebito): l'app lo dice sul pulsante di pagamento.
    pagamento_reale: stripePagamenti.pagaConStripe(),
    // Destinazione di partenza: l'indirizzo di consegna abituale (il cliente può cambiarlo).
    indirizzo_consegna: req.utente.indirizzo_consegna || '',
    minimo: pricing.euro(r.minimo),
    manca_al_minimo: pricing.euro(r.mancaAlMinimo),
    raggiunto: r.raggiunto,
    minuti_risposta: Math.round(r.minutiTesto), // è solo il numero che l'app scrive ("risponde entro 10 minuti")
    // Articoli tolti dal catalogo dopo essere finiti nel carrello: l'app li segnala.
    non_piu_disponibili: ((req.body && req.body.righe) || [])
      .map((v) => parseInt(v && v.id, 10))
      .filter((id) => id && !presenti.has(id)),
  });
});

// Come finisce una richiesta di pagamento Stripe, nella forma dell'app: { esito: 'da_pagare', id, client_secret, chiave_pubblica, importo, modo } finché la
// carta non è autorizzata (l'app apre il foglio di pagamento), { esito: 'ok', request_id } quando la richiesta è nata, e gli altri esiti di
// stripe_pagamenti.preparaPagina ('in_corso', 'rifiutato' con titolo e messaggio, 'annullato', 'non_configurato').
async function esitoPagamentoJson(id, clienteId) {
  const riga = await stripePagamenti.importoCent(id, clienteId);
  const pagina = await stripePagamenti.preparaPagina(id, clienteId);
  switch (pagina.esito) {
    case 'pagina':
      return {
        esito: 'da_pagare',
        id,
        client_secret: pagina.clientSecret,
        chiave_pubblica: pagina.chiavePubblica,
        importo: e2((riga ? riga.importo_cent : pagina.importoCent) / 100),
        modo: pagamentiModulo.modoStripe(),
      };
    case 'ok':
      return { esito: 'ok', id, request_id: pagina.requestId, tipo: pagina.tipo };
    case 'da_pagare':
      // Pagamento aperto da oltre un'ora e mai autorizzato: la pagina non si apre più (come sul sito) e il blocco scade da solo.
      return { esito: 'annullato' };
    case 'rifiutato':
      return { esito: 'rifiutato', titolo: pagina.titolo, messaggio: pagina.messaggio };
    default:
      return { esito: pagina.esito };
  }
}

// Risposta d'errore (400) per un invio che non si può fare: testo, titolo e codice, più, se il banco è chiuso, quando riapre.
function rispostaErroreFlusso(res, e) {
  return res.status(400).json({
    errore: e.message, titolo: e.titolo, codice: e.codice, request_id: e.requestId || null,
    // "banco_chiuso": quando riapre e i testi pronti (gli stessi del carrello del sito, src/logica/ordini/orari.js `testiChiuso`)
    ...(e.testi ? { testi: e.testi, riapre: e.riapre ? { giorno: e.riapre.giorno, ora: e.riapre.ora, testo: e.riapre.testo } : null } : {}),
  });
}

// Orari dei banchi per l'app (la stessa fonte del carrello e della pagina "Orari di BOREA" del sito): aperto o chiuso adesso, quando chiude (`chiude`, con i
// minuti che mancano) o riapre, i testi di "ordini chiusi" e i sette giorni con le fasce. Tutto viene dagli orari impostati dal banco, mai scritto qui.
router.get('/orari', richiedeCliente, async (req, res) => {
  const banco = await richieste.bancoPerInstallatore();
  const pagina = orari.paginaOrari(banco.distributori, banco.nome);
  res.json({
    nome: banco.nome || null,
    aperto: pagina.aperto,
    // Lo stato come lo scrive la pagina "Orari di BOREA" del sito: "Chiuso ora" / "Riapre " + "domani alle 07:30" (la seconda parte va in grassetto).
    titolo: pagina.titolo,
    sotto_prefisso: pagina.sottoPrefisso,
    quando: pagina.quando,
    sempre_aperto: pagina.sempreAperto,
    chiude: pagina.chiude
      ? { ora: pagina.chiude.ora, minuti_mancanti: pagina.chiude.mancanoMin, secondi: pagina.chiude.secondi, in_chiusura: orari.inChiusura(banco.stato) }
      : null,
    riapre: pagina.riapre ? { giorno: pagina.riapre.giorno, ora: pagina.riapre.ora, testo: pagina.riapre.testo } : null,
    testi: pagina.testi,
    // Fra quanti secondi lo stato cambia da solo (chiude o riapre): l'app si rilegge a quell'ora. null se non cambia mai (sempre aperto o mai aperto).
    cambia_sec: pagina.cambiaSec,
    giorni: pagina.giorni.map((g) => ({ giorno: g.chiave, nome: g.nome, fasce: g.fasce, chiuso: g.chiuso, oggi: g.oggi, riapre: g.riapre })),
  });
});

// Paga e invia la richiesta, con destinazione e note scritte nel carrello. `chiave` (facoltativa) identifica l'invio dal carrello: lo
// stesso invio ripetuto (doppio tocco, ritentativo) risponde con la richiesta già partita, senza crearne un'altra.
//  · Senza Stripe (sviluppo, prove, pagamento simulato): la richiesta parte subito → { id }.
//  · Con Stripe: la richiesta NON nasce qui. Si crea il pagamento (carta solo autorizzata) e l'app apre il foglio di pagamento → { pagamento: { esito:
//    'da_pagare', id, client_secret, chiave_pubblica, importo } }; la richiesta nasce quando la carta è autorizzata (GET /pagamenti/:id, il webhook o il
//    timer del server). Così dall'app NON si ordina senza pagare, come dal sito.
router.post('/richieste', richiedeCliente, async (req, res) => {
  try {
    const body = req.body || {};
    const righe = await flusso.righeDaQuantita(body.righe);
    const dati = { destinazione: body.destinazione, note: body.note, chiaveInvio: body.chiave };
    if (stripePagamenti.pagaConStripe()) {
      const pagamentoId = await stripePagamenti.avviaPagamento(req.utente.id, righe, dati);
      const pagamento = await esitoPagamentoJson(pagamentoId, req.utente.id);
      if (pagamento.esito === 'non_configurato') {
        return res.status(503).json({ errore: 'Il pagamento non è disponibile in questo momento. Non è stato addebitato nulla.' });
      }
      return res.json(pagamento.esito === 'ok' ? { id: pagamento.request_id } : { pagamento });
    }
    const id = await flusso.nuovaRichiesta(req.utente.id, righe, dati);
    res.json({ id });
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    // Questo invio ha già dato una richiesta (secondo tocco, risposta persa): si porta a quella.
    if (e.codice === 'gia_inviata' && e.requestId) return res.json({ id: e.requestId });
    rispostaErroreFlusso(res, e);
  }
});

// Come sta andando un pagamento Stripe iniziato da POST /richieste o /richieste/:id/reinvia: l'app lo chiede dopo il foglio di pagamento
// finché non è 'ok' (o un altro esito definitivo). Solo il cliente del pagamento.
router.get('/pagamenti/:id', richiedeCliente, async (req, res) => {
  if (!stripePagamenti.attivo()) return res.status(404).json({ errore: 'Pagamento non trovato.' });
  res.json(await esitoPagamentoJson(Number(req.params.id), req.utente.id));
});

const ESITO_RISPOSTA = {
  in_attesa: 'In attesa',
  confermato: 'Disponibile',
  non_disponibile: 'Non disponibile',
};

// Le righe di una richiesta in forma semplice per l'app: quantità, nome e codice.
function righeJson(righe) {
  return righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice }));
}

// Il pagamento di una richiesta (forma storica, usata anche dallo storico): null se la richiesta è nata col vecchio flusso e non ha pagamento.
function pagamentoJson(r) {
  if (!r || !r.pagamento_stato) return null;
  return {
    stato: r.pagamento_stato,
    stato_testo: r.pagamento_stato === 'rimborsato' ? 'Rimborsato' : 'Pagato',
    importo: pricing.euro(r.pagamento_importo),
    simulato: r.pagamento_metodo === 'simulato',
    pagato_il: r.pagato_il ? format.dataOra(r.pagato_il) : null,
  };
}

// Trova la richiesta indicata nell'indirizzo (aggiornando prima la scadenza) e controlla che sia di questo cliente; altrimenti risponde 404 e
// restituisce niente.
async function richiestaDelCliente(req, res) {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.utente.id) {
    res.status(404).json({ errore: 'Richiesta non trovata.' });
    return null;
  }
  return richiesta;
}

// Una richiesta com'è ora: attesa con conto alla rovescia, chiusa senza ordine (nessuno ha confermato: blocco sulla carta tolto), annullata o
// (con order_id) già diventata ordine. L'app la rilegge ogni pochi secondi.
router.get('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const d = await flusso.dettaglioRichiesta(richiesta);
  res.json({
    id: richiesta.id,
    stato: richiesta.stato,
    order_id: richiesta.stato === 'ordinata' ? richiesta.order_id : null,
    creato_il: format.dataOraRoma(richiesta.creato_il, ', '),
    secondi: d.secondi,
    minuti_risposta: Math.round(d.minutiTesto), // solo il numero che l'app scrive nel testo
    righe: righeJson(d.righe),
    // Le righe a prezzo del banco (come le mostra il sito) e gli importi divisi: consegna pagata in app / materiale pagato dopo al banco.
    righe_prezzi: d.righePrezzi.map((r) => ({ quantita: r.quantita, nome: r.nome_snapshot, codice: r.codice_snapshot, cad: e2(Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)), totale: e2(Number(r.subtotale) + Number(r.raee_riga || 0)) })),
    importi: importiJson(d.importi),
    ditta: d.ditta || null,
    // Cosa si pagherebbe rinviando una richiesta chiusa (prezzi di oggi): la consegna si addebita di nuovo, il materiale solo se un banco conferma.
    rinvio: { consegna: e2(d.rinvio.consegna), materiale: e2(d.rinvio.materiale) },
    risposte: d.risposte.map((r) => ({
      distributore: r.distributore_nome,
      filiale: '', // l'installatore vede solo la ditta
      esito: r.esito,
      esito_testo: ESITO_RISPOSTA[r.esito] || 'Nessuna risposta',
      banco_confermato: !!r.bancoConfermato,
    })),
    pagamento: pagamentoJson(richiesta),
    stato_pagamento: statoPagamentoJson(d.statoPag),
    // Si può annullare solo in fase 1: in attesa e nessun banco ha ancora accettato.
    annullabile: d.annullabile,
  });
});

// Solo in fase 1 (in attesa e nessun banco ha accettato): `ok: false` se non è più possibile, la richiesta resta com'è.
router.post('/richieste/:id/annulla', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const ok = await flusso.annullaRichiesta(richiesta.id);
  res.json({ ok });
});

// "Rinvia richiesta" (solo se chiusa senza ordine). Con Stripe si autorizza di nuovo la consegna: stessa risposta di POST /richieste
// ({ pagamento: {...} } da pagare con il foglio di pagamento); senza Stripe la richiesta riparte subito → { id }.
router.post('/richieste/:id/reinvia', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  if (stripePagamenti.pagaConStripe() && richiesta.stato === 'nessuna_offerta') {
    try {
      const pagamentoId = await stripePagamenti.avviaPagamentoReinvio(req.utente.id, richiesta);
      const pagamento = await esitoPagamentoJson(pagamentoId, req.utente.id);
      if (pagamento.esito === 'non_configurato') {
        return res.status(503).json({ errore: 'Il pagamento non è disponibile in questo momento. Non è stato addebitato nulla.' });
      }
      return res.json(pagamento.esito === 'ok' ? { id: pagamento.request_id } : { pagamento });
    } catch (e) {
      if (!(e instanceof flusso.ErroreFlusso)) throw e;
      return rispostaErroreFlusso(res, e);
    }
  }
  try {
    res.json({ id: await flusso.reinviaRichiesta(richiesta) });
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    rispostaErroreFlusso(res, e); // per esempio 'banco_chiuso' fuori orario
  }
});

// Annulla o elimina una richiesta del cliente, se la regola lo permette (altrimenti spiega perché no).
router.delete('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  try {
    await flusso.eliminaRichiesta(richiesta.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: e.messaggioCliente,
    });
  }
  res.json({ ok: true });
});

module.exports = router;
