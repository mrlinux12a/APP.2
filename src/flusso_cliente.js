// Flusso dell'installatore: richiesta pagata -> banco accetta -> corriere prende la consegna -> ordine.
// L'installatore paga e manda la richiesta, poi non decide più niente: l'ordine nasce da solo.
// Prima stava dentro le route di server.js; spostato qui perché lo usano sia le pagine del
// sito sia l'API dell'app (src/api_v1.js), che devono seguire esattamente le stesse regole.
// Qui solo la logica: come rispondere (pagina, redirect o JSON) lo decide chi chiama.
const db = require('../db');
const pricing = require('./pricing');
const richieste = require('./richieste');
const notifiche = require('./notifiche');
const whatsapp = require('./whatsapp');
const pagamenti = require('./pagamenti');
const consegna = require('./consegna');
const format = require('./format');
const eventi = require('./eventi');
const orari = require('./orari');
const { QUANTITA_MASSIMA, leggiId, leggiQuantita } = require('./input');

// Errore "previsto" del flusso (ordine minimo, richiesta già aperta...): il chiamante lo
// mostra così com'è. codice serve a chi deve decidere dove mandare l'utente.
class ErroreFlusso extends Error {
  constructor(codice, titolo, messaggio, extra = {}) {
    super(messaggio);
    this.codice = codice;
    this.titolo = titolo;
    Object.assign(this, extra);
  }
}

// ---------- Invio della richiesta ----------

// Righe [{prodotto, quantita}] a partire da coppie {id, quantita} (il carrello dell'app,
// che vive sul telefono): prodotti riletti dal DB, solo quelli ancora attivi.
async function righeDaQuantita(voci) {
  const quantita = new Map();
  // `voci` viene dal corpo JSON della richiesta: se non è un elenco si tratta come vuoto.
  for (const v of Array.isArray(voci) ? voci : []) {
    const id = leggiId(v && v.id);
    const q = leggiQuantita(v && v.quantita);
    if (id && q > 0) quantita.set(id, Math.min(QUANTITA_MASSIMA, (quantita.get(id) || 0) + q));
  }
  if (!quantita.size) return [];
  const ids = [...quantita.keys()];
  const prodotti = await db
    .prepare(
      `SELECT * FROM products WHERE attivo = 1 AND id IN (${ids.map(() => '?').join(',')})
        ORDER BY macro_slug, categoria, nome`
    )
    .all(...ids);
  return prodotti.map((prodotto) => ({ prodotto, quantita: quantita.get(prodotto.id) }));
}

// Le voci del riepilogo del carrello come TESTO già pronto (euro all'italiana, percentuali, conteggi): la pagina Carrello le disegna al
// primo caricamento e le stesse chiavi viaggiano nella risposta di /api/carrello/imposta, così il ricalcolo dal vivo di public/app.js
// riscrive ogni `[data-riep="<chiave>"]` senza fare un solo conto nel browser. `totali` viene da pricing.calcolaOrdine.
function vistaRiepilogo(totali, { nArticoli, minimo }) {
  const e = pricing.euro;
  const { app, banco } = totali;
  const mancaAlMinimo = pricing.round2(Math.max(0, minimo - totali.totale_netto));
  return {
    // Consegna in cantiere: la paghi ORA in app
    app_corriere: e(app.corriere),
    app_servizio: e(app.servizioIva), // il servizio con l'IVA dentro: nel riepilogo non c'è più la riga IVA (23/10/2026)
    app_imponibile: e(app.imponibile), // "di cui": non sono righe del riepilogo, restano per chi le vuole (API)
    app_iva: e(app.iva),
    app_totale: e(app.totale),
    servizio_pct: String(totali.servizioPct),
    iva_pct: String(totali.ivaPct),
    // Materiale: lo paghi DOPO a BOREA
    banco_merce: e(banco.merce),
    banco_raee: e(banco.raee),
    banco_imponibile: e(banco.imponibile),
    banco_iva: e(banco.iva),
    banco_totale: e(banco.totale),
    articoli: nArticoli === 1 ? '1 articolo' : nArticoli + ' articoli',
    con_raee: banco.raee > 0,
    spesa: e(totali.totale_ivato),
    // Ordine minimo, misurato sulla merce a prezzo del banco
    raggiunto: totali.totale_netto >= minimo,
    manca: e(mancaAlMinimo),
  };
}

// Totali del carrello come li mostra la pagina Carrello del sito: la merce a prezzo del banco, la consegna e il servizio che si pagano
// ORA in app (`totali.app`, `totali.da_pagare_app`) e il materiale che si paga DOPO a BOREA (`totali.banco`, `totali.materiale_banco`).
// Vedi pricing.dividiTotale. L'ordine minimo si misura sulla merce a prezzo del banco (`totale_netto`), non sul prezzo col servizio.
async function riepilogoCarrello(righe) {
  const spedizione = await pricing.getSpedizioneFissa();
  const totali = await pricing.calcolaOrdine(righe, { costoConsegna: spedizione });
  const minimo = await pricing.getOrdineMinimo();
  const vista = vistaRiepilogo(totali, { nArticoli: righe.length, minimo });
  return {
    totali,
    vista,
    minimo,
    spedizione,
    ivaPct: totali.ivaPct,
    // La soglia si misura sulla merce a prezzo del banco: corriere e servizio si sommano dopo.
    mancaAlMinimo: pricing.round2(Math.max(0, minimo - totali.totale_netto)),
    raggiunto: totali.totale_netto >= minimo,
    minutiRisposta: await pricing.getFinestraMinuti(),
    minutiTesto: await pricing.getFinestraMinutiTesto(), // il numero da SCRIVERE ("risponde entro 10 minuti"), vedi pricing.getFinestraMinutiTesto
  };
}

// I controlli prima di pagare e inviare: carrello non vuoto e ordine minimo. Non c'è più il limite di una sola
// richiesta aperta alla volta: l'installatore può mandarne altre mentre una è in attesa o un ordine è in consegna
// (le segue tutte "Stato ordini", vedi attivitaCliente).
// Ritorna { cliente, totali } (totali.da_pagare_app è quello che l'installatore paga in app) o lancia ErroreFlusso. Li
// fa il flusso del sito prima di mandare il cliente a Stripe, e di nuovo `nuovaRichiesta` quando il pagamento è
// autorizzato.
async function validaRichiesta(clienteId, righe) {
  // L'ordine minimo si misura sulla merce a prezzo del banco (`totale_netto`), senza servizio, consegna e IVA.
  const totali = await pricing.calcolaOrdine(righe, { costoConsegna: await pricing.getSpedizioneFissa() });
  const minimo = await pricing.getOrdineMinimo();
  if (righe.length && totali.totale_netto < minimo) {
    throw new ErroreFlusso(
      'ordine_minimo',
      'Ordine minimo non raggiunto',
      `L'ordine minimo è di € ${pricing.euro(minimo)} di merce (IVA esclusa). Ti mancano € ${pricing.euro(minimo - totali.totale_netto)}.`
    );
  }
  if (!righe.length) {
    throw new ErroreFlusso('vuota', 'Nessun materiale', 'Seleziona almeno un prodotto prima di procedere.');
  }
  await controllaBancoAperto();

  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);

  return { cliente, totali };
}

// Fuori dagli orari dei banchi (src/orari.js, impostati nell'"Anagrafica del banco") una richiesta non arriva a nessuno: quindi non si paga e non
// parte. Si controlla ADESSO anche lato server (il pulsante del carrello è disabilitato, ma la pagina può essere rimasta aperta o la richiesta
// arrivare da un'altra parte): vale per l'invio, per "Rinvia" e, con Stripe, anche a carta già autorizzata (allora la carta si rilascia).
// Ritorna lo stato ({ aperto, riapre }) se è aperto, altrimenti lancia ErroreFlusso 'banco_chiuso'.
async function controllaBancoAperto(quando = new Date()) {
  const { stato, nome } = await richieste.bancoPerInstallatore(quando);
  if (!stato.aperto) {
    throw new ErroreFlusso(
      'banco_chiuso',
      'Il banco è chiuso',
      (stato.riapre ? 'Riapre ' + stato.riapre.testo + '.' : 'Al momento non riceve richieste.') + ' Non è stato addebitato nulla: riprova quando riapre.',
      { riapre: stato.riapre, frase: orari.frasePerCarrello(stato), testi: orari.testiChiuso(stato, nome) }
    );
  }
  return stato;
}

// La chiave di un invio dal carrello: una stringa casuale scritta nella pagina (o generata dall'app) che identifica quel
// carrello. La stessa chiave dà una richiesta sola (indice unico in schema.sql): un doppio clic, o un ritorno con
// "indietro" sulla stessa pagina, non fanno partire due ordini; per un ordine nuovo si riparte dal carrello. Una chiave
// mancante o fuori forma vale "nessuna": niente controllo.
function chiaveInvioValida(valore) {
  const chiave = typeof valore === 'string' ? valore.trim() : '';
  return /^[A-Za-z0-9_-]{8,64}$/.test(chiave) ? chiave : null;
}

// Come si risponde a un invio che ha già dato una richiesta: sul sito e sull'app si porta il cliente sulla richiesta già
// partita ('riporta'); col pagamento Stripe il secondo invio ha già una carta autorizzata e va respinto ('rifiuta').
function giaInviata(requestId, inCasoDiDuplicato) {
  if (inCasoDiDuplicato !== 'rifiuta') return requestId;
  throw new ErroreFlusso('gia_inviata', 'Ordine già inviato', 'Questo ordine è già stato inviato: non ne parte un altro.', { requestId });
}

// Paga e invia la richiesta ai distributori. Ritorna l'id creato. `destinazione` e `note` sono quelle
// del carrello (la destinazione, se vuota, è l'indirizzo di consegna abituale del cliente): da qui
// l'ordine nasce da solo, senza altre scelte. Il pagamento vale quanto il carrello ha mostrato come "Paghi ora"
// (`totali.da_pagare_app`: servizio + consegna, IVA inclusa; il materiale si paga dopo al banco): simulato (vedi pagamenti.js) per l'app e senza Stripe; col sito e Stripe lo chiama
// src/stripe_pagamenti.js a carta già autorizzata (`metodoPagamento: 'stripe'`, `importoPagato` = quanto
// autorizzato, che resta quello scritto sulla richiesta anche se i prezzi si sono mossi nel frattempo).
async function nuovaRichiesta(
  clienteId,
  righe,
  {
    destinazione = '', note = '', metodoPagamento = pagamenti.METODO_SIMULATO, importoPagato = null,
    chiaveInvio = null, inCasoDiDuplicato = 'riporta',
  } = {}
) {
  // Prima di tutto: questo invio ha già dato una richiesta? Allora non se ne crea un'altra (e non si rifanno i controlli:
  // con "indietro" il carrello può anche essere già vuoto).
  const chiave = chiaveInvioValida(chiaveInvio);
  if (chiave) {
    const gia = await richieste.richiestaConChiave(clienteId, chiave);
    if (gia) return giaInviata(gia.id, inCasoDiDuplicato);
  }

  const { cliente, totali } = await validaRichiesta(clienteId, righe);

  try {
    const { requestId } = await richieste.creaRichiesta(cliente, righe, {
      destinazione: String(destinazione || '').trim().slice(0, 300) || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente),
      note: String(note || '').trim().slice(0, 500),
      importo: importoPagato === null ? totali.da_pagare_app : importoPagato,
      metodoPagamento,
      chiaveInvio: chiave,
      // Gli importi divisi (consegna pagata in app / materiale da pagare a BOREA) si salvano sulla richiesta, come sull'ordine.
      totali,
    });
    return requestId;
  } catch (e) {
    // 23505 = la stessa chiave è stata scritta un istante prima da un altro invio dello stesso carrello (doppio clic: i
    // due arrivano insieme e il controllo qui sopra non li vede ancora). L'indice unico lascia passare uno solo.
    if (e && e.code === '23505' && chiave) {
      const gia = await richieste.richiestaConChiave(clienteId, chiave);
      if (gia) return giaInviata(gia.id, inCasoDiDuplicato);
    }
    throw e;
  }
}

// ---------- Richiesta: lettura, annullamento, reinvio, eliminazione ----------

// L'installatore vede solo la ditta (es. "Borea"): la filiale che risponde e da cui parte
// l'ordine conta per i banchi, non per lui. Copia di una riga `distributors` senza filiale.
function senzaFiliale(distributore) {
  return distributore ? { ...distributore, filiale: '' } : distributore;
}

// Tutto quello che serve per mostrare una richiesta (attesa, chiusa senza ordine, annullata). Segna
// anche come lette le notifiche di richieste/ordini: il cliente sta guardando proprio questa. Il
// pagamento (pagamento_stato, pagamento_importo...) sta sulla riga `richiesta`.
async function dettaglioRichiesta(richiesta) {
  // Nessuna delle letture dipende da un'altra: partono insieme (ognuna è un giro di rete verso il DB, e questa pagina
  // si apre a ogni passaggio fra gli ordini di "Stato ordini").
  const [, , righe, risposte, secondi, minutiRisposta, minutiTesto, spedizione, rigaPagamento] = await Promise.all([
    notifiche.segnaLetteCategoria(richiesta.cliente_id, 'richieste'),
    notifiche.segnaLetteCategoria(richiesta.cliente_id, 'ordini'),
    richieste.righeRichiesta(richiesta.id),
    richieste.risposteRichiesta(richiesta.id),
    richieste.secondiRimasti(richiesta),
    pricing.getFinestraMinuti(),
    pricing.getFinestraMinutiTesto(),
    pricing.getSpedizioneFissa(),
    pagamenti.rigaPagamento(richiesta.id),
  ]);
  // Le righe a PREZZO DEL BANCO e gli importi di oggi, con la stessa funzione del carrello (calcolaOrdine): servono alle righe della
  // scheda "Materiale richiesto", agli importi delle richieste nate prima delle colonne salvate e a "Se rinvii la richiesta paghi di nuovo...".
  const oggi = await pricing.calcolaDaRigheDb(righe, { costoConsegna: spedizione });
  const risposteDitta = richieste.raggruppaRisposteDitta(risposte);
  // Il nome della ditta interpellata, senza forma giuridica e senza filiale ("BOREA"); con più ditte non c'è un nome solo e le viste
  // dicono "il banco".
  const ditte = Array.from(new Set(risposteDitta.map((r) => format.nomeCommerciale(r.distributore_nome)).filter(Boolean)));
  return {
    richiesta,
    righe,
    // Una ditta con più filiali è una voce sola.
    risposte: risposteDitta,
    secondi,
    minutiRisposta,
    minutiTesto, // il numero da SCRIVERE nei testi (10), che col timer accorciato per le prove non coincide con minutiRisposta
    // Consegna pagata in app e materiale da pagare a BOREA (stessa forma di dettaglioOrdine: la legge partials/pagamenti).
    importi: pricing.importi({ richiesta, calcolato: oggi }),
    // Cosa dice la carta: bloccata, pagata, annullata o rimborsata (pagamenti.calcolaStatoPagamento), per la scheda "Pagamenti" e la pillola.
    statoPag: pagamenti.calcolaStatoPagamento({ riga: rigaPagamento, richiesta }),
    // Si può ancora annullare? Solo in fase 1: richiesta in attesa e nessun banco ha accettato (vedi annullaRichiesta).
    annullabile: richiesta.stato === 'in_attesa' && !risposteDitta.some((r) => r.bancoConfermato),
    righePrezzi: oggi.righe,
    ditta: ditte.length === 1 ? ditte[0] : '',
    // Cosa si pagherebbe rinviando una richiesta chiusa, con i prezzi di oggi: la consegna (si addebita di nuovo) e il materiale (resta da pagare
    // a BOREA solo se conferma).
    rinvio: { consegna: oggi.da_pagare_app, materiale: oggi.materiale_banco },
  };
}

// Quanto si paga in app per questa richiesta con i prezzi di oggi (pricing.calcolaOrdine sulle sue righe e la consegna fissa): lo usa
// "Rinvia richiesta" con Stripe per l'importo da autorizzare.
async function totaliRichiestaOggi(requestId) {
  return pricing.calcolaDaRigheDb(await richieste.righeRichiesta(requestId), { costoConsegna: await pricing.getSpedizioneFissa() });
}

// Annullamento da parte del cliente: SOLO in fase 1, cioè richiesta in attesa E nessun banco ha ancora accettato (nessuna risposta
// 'confermato', nemmeno se il corriere non ha ancora preso la consegna). Dopo, mai: né la richiesta né l'ordine (vedi le regole in
// src/pagamenti.js). Il blocco sulla carta si RILASCIA (cancel del PaymentIntent, stato 'rilasciato'): non è un rimborso, non è mai passato
// un euro. Ritorna false se la richiesta non era più annullabile (un banco ha confermato un istante prima, l'ordine è nato...).
async function annullaRichiesta(requestId) {
  const annullata = await db.transaction(async () => {
    // Prima si blocca la riga della richiesta, come fa rispondi() quando un banco conferma: due operazioni insieme non si
    // incrociano, chi arriva dopo trova lo stato già cambiato (e la UPDATE qui sotto, che è una istruzione nuova, vede anche la conferma
    // appena registrata).
    const attuale = await db.prepare('SELECT stato FROM requests WHERE id = ? FOR UPDATE').get(requestId);
    if (!attuale) return false;
    // La regola sta ANCHE dentro la UPDATE: se un banco ha confermato o l'ordine è nato un istante prima, l'annullamento non deve
    // sovrascrivere 'ordinata' né cancellare una conferma già data.
    const upd = await db
      .prepare(
        `UPDATE requests SET stato = 'annullata'
          WHERE id = ? AND stato = 'in_attesa'
            AND NOT EXISTS (SELECT 1 FROM request_responses rr WHERE rr.request_id = requests.id AND rr.esito = 'confermato')`
      )
      .run(requestId);
    if (!upd.changes) return false;
    // Il blocco sulla carta si rilascia (solo DB: lo esegue il giro di Stripe, vedi pagamenti.rimborsa).
    await pagamenti.rimborsa(requestId);
    // Chiude anche le risposte ancora "in attesa" dal lato banco: altrimenti la
    // richiesta annullata dal cliente resta a intasare la dashboard dei distributori
    // come se ci fosse ancora qualcosa da confermare.
    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto' WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(requestId);
    await db.prepare(
      `UPDATE request_responses SET corriere_stato = 'scaduto' WHERE request_id = ? AND corriere_stato = 'in_attesa'`
    ).run(requestId);
    return true;
  })();
  if (!annullata) return false;
  // Nel gruppo WhatsApp il messaggio sparisce (la rete sta fuori dalla transazione).
  await whatsapp
    .ritiraRichiesta(requestId, { motivo: 'il cliente ha annullato la richiesta' })
    .catch((err) => console.error('WhatsApp, ritiro messaggio:', err.message));
  return true;
}

// Nessuno ha confermato entro la finestra: riapre la STESSA richiesta (stesso id, per
// distributori e installatore) con una finestra fresca, invece di crearne una nuova — così
// resta un riferimento unico nel tempo, utile per pagamenti o altro.
// Ritorna l'id della richiesta da mostrare.
async function reinviaRichiesta(richiesta) {
  if (richiesta.stato !== 'nessuna_offerta') return richiesta.id;
  await controllaBancoAperto();
  await richieste.reinviaRichiesta(richiesta.id);
  return richiesta.id;
}

// Il cliente NON annulla mai un ordine (richiesta esplicita del 18/10/2026): un ordine nasce quando un banco conferma e la carta è già stata
// incassata, quindi l'unico annullamento possibile è quello della richiesta in fase 1 (annullaRichiesta). Per un problema si contatta l'assistenza.
// Questa è l'unica regola: la usano la pagina dell'ordine, le rotte del sito (/ordini/:id/elimina e /richieste/:id/elimina) e l'API dell'app,
// che quindi non mostrano nessun pulsante e rifiutano comunque la richiesta.
function ordineAnnullabileDalCliente() {
  return false;
}

const MESSAGGIO_ORDINE_NON_ANNULLABILE = "Il banco ha già confermato: l'ordine non si può più annullare. Per problemi contatta l'assistenza.";

// Lanciata quando l'ordine non si può annullare (sempre, per il cliente). Non cambia niente nel DB. `messaggioCliente` è il testo da mostrare
// (sito e app); `consegnato` dice solo se l'ordine è anche già consegnato.
class OrdineInLavorazione extends Error {
  // `richiestaId`: quando il rifiuto è per una richiesta senza ordine (un banco ha già confermato), `ordine.id` è null e la pagina torna alla richiesta.
  constructor(ordine, { richiestaId = null } = {}) {
    const consegnato = !!ordine.consegnato_il;
    super('ordine non annullabile dal cliente');
    this.ordine = ordine;
    this.richiestaId = richiestaId;
    this.consegnato = consegnato;
    this.messaggioCliente = MESSAGGIO_ORDINE_NON_ANNULLABILE;
  }
}

// Elimina richiesta (cliente) — globale: sparisce anche per tutti i distributori (da confermare + storico). Vale la stessa regola dell'annullamento
// (solo fase 1): si elimina una richiesta in attesa su cui nessun banco ha ancora confermato, o una già chiusa senza ordine (nessuna risposta,
// annullata). Se è nato un ordine, o un banco ha già confermato, lancia OrdineInLavorazione e non tocca niente (nemmeno il pagamento).
async function eliminaRichiesta(requestId) {
  const elimina = db.transaction(async () => {
    // Righe bloccate fino alla fine: un banco che conferma o un ordine che nasce nel frattempo non può più essere cancellato "sotto" al distributore.
    const attuale = await db.prepare('SELECT order_id, stato FROM requests WHERE id = ? FOR UPDATE').get(requestId);
    if (!attuale) return;
    // Un ordine esiste: il banco ha già confermato e la carta è stata incassata. Il cliente non lo annulla (e quindi nemmeno la richiesta).
    if (attuale.order_id) {
      const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(attuale.order_id);
      if (ordine) throw new OrdineInLavorazione(ordine);
    }
    // Eliminare è un annullamento mascherato. Una richiesta in attesa su cui un banco ha già confermato (magari in attesa del corriere) non si
    // può far sparire dal cliente; una già chiusa senza ordine sì.
    if (attuale.stato === 'in_attesa') {
      const confermata = await db
        .prepare(`SELECT 1 AS x FROM request_responses WHERE request_id = ? AND esito = 'confermato' LIMIT 1`)
        .get(requestId);
      if (confermata) throw new OrdineInLavorazione({ id: null, consegnato_il: null }, { richiestaId: requestId });
    }
    // La riga della richiesta sparisce, ma il blocco sulla carta prima si rilascia (solo DB: lo esegue il giro di Stripe).
    await pagamenti.rimborsa(requestId);
    await db.prepare(
      `DELETE FROM request_response_items
        WHERE response_id IN (SELECT id FROM request_responses WHERE request_id = ?)`
    ).run(requestId);
    await db.prepare('DELETE FROM request_responses WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
  });
  await elimina();
  await whatsapp
    .ritiraRichiesta(requestId, { motivo: 'il cliente ha eliminato la richiesta' })
    .catch((err) => console.error('WhatsApp, ritiro messaggio:', err.message));
}

// ---------- Ordine ----------

// Minuti dalla risposta del corriere alla consegna dall'installatore: il tempo scritto dal corriere (arriva dal banco) + il tragitto dal banco a lui, che
// richieste.corriereHaPreso ha già sommato in consegna_minuti_stimati. Mai meno dei minuti del corriere: un dato mancante non deve accorciare l'attesa.
function minutiConsegna(risposta) {
  const corriere = Number(risposta.corriere_minuti) || 0;
  const totale = Number(risposta.consegna_minuti_stimati) || 0;
  return Math.max(corriere, totale);
}

// L'installatore non sceglie niente dopo aver pagato: l'ordine nasce da solo quando una risposta del
// banco diventa valida, cioè quando il corriere prende la consegna nel gruppo WhatsApp (o, a modulo
// spento, appena il banco accetta). Destinazione e note sono quelle scritte nel carrello, salvate
// sulla richiesta; il pagamento è già sulla richiesta (vedi pagamenti.js).
async function creaOrdineDaRisposta(richiesta, risposta) {
  const distributorId = risposta.distributor_id;
  const modalita = 'consegna_mezzo_grossista';
  const note = (richiesta.note || '').trim();
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const destinazione = (richiesta.destinazione || '').trim() || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente);
  const { totali } = await richieste.calcolaOfferta(richiesta.id, distributorId);

  // Insieme ai totali di sempre l'ordine salva le due parti già calcolate da calcolaOrdine (consegna pagata in app e materiale da pagare a
  // BOREA): pricing.importiOrdine le rilegge, così pagina dell'ordine, Storico e pagina del banco dicono gli stessi numeri.
  const insertOrder = db.prepare(
    `INSERT INTO orders
       (cliente_id, stato, modalita, note, totale_netto, totale_finale,
        request_id, distributor_id, consegna_ore, partenza_ore, destinazione,
        costo_consegna, contributo_raee, iva, totale_ivato,
        servizio, imponibile_app, iva_app, da_pagare_app, imponibile_banco, iva_banco, materiale_banco)
     VALUES (?, 'inviato', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items
       (order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_listino_snapshot,
        sconto_pct_snapshot, prezzo_netto_unitario, subtotale, prezzo_unitario_cliente,
        subtotale_cliente, raee_unitario, raee_riga)
     VALUES (?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?)`
  );

  const creaOrdine = db.transaction(async () => {
    // Blocco atomico "solo il primo vince": la richiesta passa a 'ordinata' una volta sola, anche se
    // un corriere e il timer (o due corrieri) arrivano nello stesso istante. Chi non riesce a far
    // passare questa UPDATE (changes=0) si ferma senza scrivere nulla.
    const claim = await db.prepare(
      `UPDATE requests SET stato = 'ordinata' WHERE id = ? AND stato = 'in_attesa'`
    ).run(richiesta.id);
    if (!claim.changes) return null;

    const info = await insertOrder.run(
      richiesta.cliente_id,
      modalita,
      note,
      totali.totale_netto,
      totali.totale_finale,
      richiesta.id,
      distributorId,
      risposta.consegna_ore,
      risposta.partenza_ore,
      destinazione,
      totali.costo_consegna,
      totali.contributo_raee,
      totali.iva,
      totali.totale_ivato,
      totali.servizio,
      totali.app.imponibile,
      totali.app.iva,
      totali.da_pagare_app,
      totali.banco.imponibile,
      totali.banco.iva,
      totali.materiale_banco
    );
    const orderId = Number(info.lastInsertRowid);
    for (const riga of totali.righe) await insertItem.run(orderId, riga.product_id, riga.codice_snapshot, riga.nome_snapshot, riga.quantita, riga.prezzo_listino_snapshot, riga.sconto_pct_snapshot, riga.prezzo_netto_unitario, riga.subtotale, riga.prezzo_unitario_cliente, riga.subtotale_cliente, riga.raee_unitario, riga.raee_riga);
    await db.prepare(`UPDATE requests SET order_id = ? WHERE id = ?`).run(orderId, richiesta.id);
    // Con Stripe la carta, finora solo bloccata, si incassa (per la parte da pagare in app dell'ordine, se più bassa di quanto
    // autorizzato). Qui si segna soltanto sul DB, nella stessa transazione dell'ordine: la chiamata a Stripe la
    // fa src/stripe_pagamenti.js subito dopo e, se non riesce, dal timer.
    await pagamenti.segnaDaIncassare(richiesta.id, totali.da_pagare_app);
    // Con il corriere i minuti scritti nel gruppo ("preso 30") sono il tempo che ci mette ad arrivare dal banco: stanno in corriere_minuti e il banco vede
    // solo quelli (src/corriere.js). All'installatore si dice quando arriva la merce da lui: quei minuti + il tragitto dal banco (già in
    // consegna_minuti_stimati, vedi richieste.corriereHaPreso), contati da quando il corriere ha risposto, non da adesso: così il ritiro promesso al banco e
    // l'arrivo promesso all'installatore partono dallo stesso istante, anche se l'ordine nasce un po' dopo (riprova del timer).
    if (risposta.corriere_stato === 'preso') {
      await db.prepare(
        `UPDATE orders
            SET corriere_minuti = ?, corriere_nome = ?, corriere_risposto_il = ?,
                corriere_arrivo_il = COALESCE(?::timestamptz, NOW()) + (? * INTERVAL '1 minute')
          WHERE id = ?`
      ).run(risposta.corriere_minuti, risposta.corriere_nome || '', risposta.corriere_preso_il, risposta.corriere_preso_il, minutiConsegna(risposta), orderId);
    }
    // Chiuso l'ordine, gli altri banchi non devono più poter rispondere.
    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW()
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(richiesta.id);
    await db.prepare(
      `UPDATE request_responses SET corriere_stato = 'scaduto'
        WHERE request_id = ? AND corriere_stato = 'in_attesa'`
    ).run(richiesta.id);
    return orderId;
  });

  const orderId = await creaOrdine();
  if (orderId === null) return null;

  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const conCorriere = risposta.corriere_stato === 'preso' && risposta.corriere_minuti;
  // Due orari diversi, ognuno per chi deve vederlo: il banco sa quando arriva il corriere (i minuti scritti su WhatsApp), l'installatore quando arriva la merce
  // (quei minuti + il tragitto dal banco). Partono entrambi dal momento in cui il corriere ha risposto.
  const preso = format.toDate(risposta.corriere_preso_il) || new Date();
  const ritiro = conCorriere ? format.oraRoma(new Date(preso.getTime() + risposta.corriere_minuti * 60 * 1000)) : null;
  const minutiTotali = conCorriere ? minutiConsegna(risposta) : null;
  const arrivo = conCorriere ? format.oraRoma(new Date(preso.getTime() + minutiTotali * 60 * 1000)) : null;

  // Al banco l'ordine arriva già pagato: deve solo prepararlo.
  await notifiche.notificaDistributore(distributorId, {
    titolo: 'Nuovo ordine da preparare',
    testo: `${cliente.ragione_sociale} — ordine #${orderId}, già pagato.${ritiro ? ` Il corriere ritira alle ${ritiro}.` : ''}`,
    link: '/distributore/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
    // Avviso a comparsa "Corriere trovato" (o, a modulo WhatsApp spento, "Nuovo ordine"): public/app.js, "Avvisi del banco".
    tipo: 'corriere_trovato',
    request_id: richiesta.id,
  });

  // La richiesta confermata non resta una richiesta: diventa un ordine, e la notifica del cliente lo
  // dice con il tempo stimato.
  await notifiche.notifica(richiesta.cliente_id, {
    titolo: 'Ordine confermato',
    testo: testoOrdineConfermato({ orderId, distributoreNome: distributore && distributore.nome, arrivo: conCorriere ? arrivo : null, minutiStimati: risposta.consegna_minuti_stimati }),
    link: '/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  // Gruppo WhatsApp dei corrieri: i messaggi degli altri banchi spariscono. Al corriere che ha preso la
  // consegna non si scrive altro. Un guasto lì non deve far fallire un ordine già creato.
  try {
    await whatsapp.ritiraRichiesta(richiesta.id, { tranne: risposta.id });
  } catch (err) {
    console.error('WhatsApp, ordine #' + orderId + ' non comunicato al gruppo:', err.message);
  }

  return orderId;
}

// Il testo della notifica "Ordine confermato" dell'installatore, nella forma di tutte le sue notifiche (richiesta esplicita del 21/10/2026):
// "Ordine #312 — BOREA prepara il tuo ordine. Consegna prevista entro le 10:45." Il nome è quello della ditta, senza "SRL" e mai la filiale. `arrivo` (HH:MM) c'è
// quando un corriere ha preso la consegna; senza, vale la stima del banco ("Consegna stimata in 2 ore").
function testoOrdineConfermato({ orderId, distributoreNome, arrivo = null, minutiStimati = 0 }) {
  const ditta = format.nomeCommerciale(distributoreNome) || 'Il banco';
  const consegnaTesto = arrivo ? `Consegna prevista entro le ${arrivo}.` : `Consegna stimata in ${consegna.inParole(minutiStimati)}.`;
  return `Ordine #${orderId} — ${ditta} prepara il tuo ordine. ${consegnaTesto}`;
}

// L'ordine nasce quando una risposta del banco diventa valida (vedi richieste.assegnaOrdine), subito e
// poi dal timer in server.js se la prima volta è fallito: l'assegnatore si registra qui. Uno script che
// usa solo src/richieste.js non lo ha.
richieste.impostaAssegnatore(creaOrdineDaRisposta);

// ---------- Ordine: lettura, consegna, annullamento ----------

async function dettaglioOrdine(ordine) {
  // Le letture non dipendono una dall'altra (tutto parte da `ordine`, già letto): partono insieme, un solo giro di rete
  // invece di cinque in fila. Questa pagina si apre a ogni passaggio fra gli ordini di "Stato ordini".
  const [righe, cliente, distributore, richiestaOrdine, ivaConfig, servizioPct, rigaPagamento] = await Promise.all([
    db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id),
    db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id),
    ordine.distributor_id ? db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id) : null,
    ordine.request_id
      ? db
          .prepare('SELECT pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il, rimborsato_il FROM requests WHERE id = ?')
          .get(ordine.request_id)
      : null,
    pricing.getIvaPct(),
    pricing.getServizioPct(),
    pagamenti.rigaPagamento(ordine.request_id),
  ]);
  // Il pagamento fatto all'invio della richiesta (null per gli ordini del vecchio flusso).
  const pagamento =
    richiestaOrdine && richiestaOrdine.pagamento_stato
      ? {
          stato: richiestaOrdine.pagamento_stato,
          metodo: richiestaOrdine.pagamento_metodo,
          importo: richiestaOrdine.pagamento_importo,
          pagato_il: richiestaOrdine.pagato_il,
          rimborsato_il: richiestaOrdine.rimborsato_il,
        }
      : null;
  const ivaPct = pricing.ivaPctOrdine(ordine, ivaConfig);
  return {
    righe,
    cliente,
    distributore,
    pagamento,
    // Consegna pagata in app e materiale da pagare a BOREA, divisi come nel carrello (la stessa funzione dello Storico e del banco).
    importi: pricing.importiOrdine(ordine, pagamento, ivaPct, servizioPct),
    annullabile: ordineAnnullabileDalCliente(ordine), // sempre false: il cliente non annulla un ordine
    statoPag: pagamenti.calcolaStatoPagamento({ riga: rigaPagamento, richiesta: richiestaOrdine, ordine }),
    ivaPct,
  };
}

// La consegna la segna SOLO il corriere, dal sondaggio nel gruppo WhatsApp (segnaConsegnatoDalCorriere, più sotto): l'installatore non ha nessun pulsante né
// rotta per confermarla (richiesta esplicita del 21/10/2026). Non cambia lo stato DB dell'ordine: valorizza solo consegnato_il, che basta per mostrare "Consegnato".

// Scrive la consegna (solo se ancora non c'è: due conferme insieme non avvisano il banco due volte) e avvisa il banco. Un guasto dell'avviso
// non deve far fallire la conferma del cliente: finisce nel log.
async function scriviConsegna(ordine, { dalCorriere = true } = {}) {
  const info = await db.prepare('UPDATE orders SET consegnato_il = NOW() WHERE id = ? AND consegnato_il IS NULL').run(ordine.id);
  if (!info.changes) return;
  // Le pagine aperte dell'installatore (pagina dell'ordine, icona e scheda "Stato ordini") lo sanno subito, senza chiedere (src/eventi.js, GET /api/eventi).
  eventi.emetti(ordine.cliente_id, 'consegnato', { ordine: ordine.id });
  if (!ordine.distributor_id) return;
  try {
    const cliente = await db.prepare('SELECT ragione_sociale FROM users WHERE id = ?').get(ordine.cliente_id);
    await notifiche.notificaDistributore(ordine.distributor_id, {
      titolo: `Ordine #${ordine.id} consegnato`,
      testo: dalCorriere
        ? `Il corriere ha segnato la consegna a ${cliente ? cliente.ragione_sociale : 'il cliente'} alle ${format.oraRoma(new Date())}.`
        : `${cliente ? cliente.ragione_sociale : 'Il cliente'} ha confermato la consegna alle ${format.oraRoma(new Date())}.`,
      link: '/distributore/ordini/' + ordine.id,
      categoria: 'ordini',
      sottostato: 'consegnato',
      order_id: ordine.id,
      tipo: 'ordine_consegnato',
      request_id: ordine.request_id || null,
    });
  } catch (err) {
    console.error(`[ordini] avviso di consegna dell'ordine ${ordine.id} al banco non inviato:`, err.message);
  }
}

// Il corriere segna la consegna dal gruppo WhatsApp (sondaggio "🚀 Segna come Consegnato", src/whatsapp.js): stessa scrittura della conferma del cliente, a qualunque stato
// sia l'ordine, con l'avviso al banco che dice chi l'ha segnata. Se è già consegnato non fa niente.
async function segnaConsegnatoDalCorriere(ordine) {
  if (!ordine.consegnato_il) {
    await scriviConsegna(ordine, { dalCorriere: true });
  }
}

// Elimina ordine (cliente): il cliente NON annulla mai un ordine (vedi ordineAnnullabileDalCliente), quindi lancia sempre OrdineInLavorazione senza
// toccare niente. C'è ancora perché sito e API la chiamano e rifiutano con lo stesso messaggio.
async function eliminaOrdine(orderId) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine) return;
  throw new OrdineInLavorazione(ordine);
}

// ---------- Stato ordini e storico ----------

// Tutte le richieste del cliente (più un ordine associato, quando c'è) con lo step 1 (in attesa)
// o 3 (ordine) già calcolato — solo i campi che lo Storico mostra davvero (data, materiale,
// stato): niente risposte dei distributori, che lì non servono.
// aggiornaScadenza si chiama solo sulle richieste ancora aperte, non su tutte e 50: su
// quelle già chiuse (la maggioranza, in uno storico) costerebbe una query a vuoto.
async function richiesteClienteConStato(clienteId) {
  const tutte = await db
    .prepare(`SELECT * FROM requests WHERE cliente_id = ? ORDER BY id DESC LIMIT 50`)
    .all(clienteId);
  if (!tutte.length) return [];

  // La scadenza si aggiorna solo per le richieste ancora aperte (di solito zero o una).
  const aggiornate = [];
  for (const r of tutte) {
    aggiornate.push(
      r.stato === 'in_attesa' || r.stato === 'con_offerte' ? (await richieste.aggiornaScadenza(r.id)) || r : r
    );
  }

  // Righe e ordini di tutte le richieste con due letture in tutto, non due per richiesta:
  // erano circa 100 query di fila, oltre 3 secondi per aprire lo storico.
  const righePerRichiesta = await richieste.righeRichieste(aggiornate.map((r) => r.id));
  const idOrdini = aggiornate.filter((r) => r.stato === 'ordinata' && r.order_id).map((r) => r.order_id);
  const ordiniPerId = new Map();
  if (idOrdini.length) {
    // Il nome del banco (la ditta, mai la filiale: l'installatore non la vede) viaggia nella stessa lettura.
    const ordini = await db
      .prepare(
        `SELECT o.*, d.nome AS distributore_nome
           FROM orders o
           LEFT JOIN distributors d ON d.id = o.distributor_id
          WHERE o.id IN (${idOrdini.map(() => '?').join(',')})`
      )
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'ordinata') {
      step = 3;
      if (rAgg.order_id) ordine = ordiniPerId.get(Number(rAgg.order_id)) || null;
    }
    return { richiesta: rAgg, righe: righePerRichiesta.get(Number(rAgg.id)) || [], ordine, step };
  });
}

// "Riordina": gli articoli di un ordine del cliente che si possono rimettere nel carrello, e quanti no
// (tolti dal catalogo o non più disponibili). Ritorna null se l'ordine non esiste, 'altrui' se è di un altro.
async function articoliDaRiordinare(clienteId, ordineId) {
  const ordine = await db.prepare('SELECT id, cliente_id FROM orders WHERE id = ?').get(ordineId);
  if (!ordine) return null;
  if (Number(ordine.cliente_id) !== Number(clienteId)) return 'altrui';
  const righe = await db
    .prepare(
      `SELECT oi.product_id, oi.quantita, p.id AS prodotto_id, p.attivo, p.disponibilita
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?`
    )
    .all(ordine.id);
  const articoli = [];
  let saltati = 0;
  for (const r of righe) {
    const quantita = leggiQuantita(r.quantita);
    if (r.prodotto_id && Number(r.attivo) === 1 && r.disponibilita !== 'non_disponibile' && quantita > 0) {
      articoli.push({ id: Number(r.product_id), quantita });
    } else {
      saltati++;
    }
  }
  return { articoli, saltati };
}

// La scheda "Il tuo ultimo ordine" del carrello vuoto: l'ordine consegnato più recente del cliente, con data e
// righe. Una sola lettura (ordine + righe insieme); le righe mostrate sono al massimo `massimo`, il resto è
// `altri`. Ritorna null se il cliente non ha mai avuto un ordine consegnato.
async function ultimoOrdineConsegnato(clienteId, massimo = 3) {
  const righe = await db
    .prepare(
      `SELECT o.id AS ordine_id, o.creato_il, oi.quantita, oi.nome_snapshot
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id = (SELECT id FROM orders
                       WHERE cliente_id = ? AND consegnato_il IS NOT NULL
                       ORDER BY creato_il DESC, id DESC
                       LIMIT 1)
        ORDER BY oi.id`
    )
    .all(clienteId);
  if (!righe.length) return null;
  return {
    id: righe[0].ordine_id,
    data: format.dataCortaRoma(righe[0].creato_il),
    righe: righe.slice(0, massimo).map((r) => ({ quantita: r.quantita, nome: r.nome_snapshot })),
    altri: Math.max(0, righe.length - massimo),
  };
}

// "Stato ordini": le attività in corso del cliente. Possono essere più d'una insieme (non c'è più il limite di una
// richiesta alla volta). Le fasi sono tre, ma solo le prime due sono "in corso":
//   fase 1 — richiesta in attesa di banco e corriere (la finestra di conferma scorre);
//   fase 2 — ordine nato e in consegna (non ancora segnato consegnato, nato da meno di 24 ore);
//   fase 3 — ordine consegnato (consegnato_il): non si mostra più in "Stato ordini", resta nello Storico.
// "Stato ordini" le elenca prima le richieste (timer più lungo per primo) e poi gli ordini in consegna (arrivo più
// lontano per primo, senza orario in fondo). L'icona della barra, la scheda della home e l'API dell'app seguono invece
// UNA sola attività: la prima in ordine di invio (la richiesta con id più basso). Le richieste chiuse senza ordine
// ("Nessuna risposta") restano visibili 10 minuti dalla scadenza, ciascuna per conto suo (vedi scaduteRecenti).
const PROGRESSO_IN_VIAGGIO = 0.5; // metà barra: "In viaggio"
const PROGRESSO_ARRIVO = 0.94; // dove si ferma la barra a tempo finito: un filo prima di "Consegnato", che arriva solo con la consegna vera
const SCADUTA_VISIBILE_MS = 10 * 60 * 1000; // quanto una richiesta senza risposta resta in "Stato ordini" (richiesta esplicita del 20/10/2026)
const VENTIQUATTRO_ORE_MS = 24 * 60 * 60 * 1000;
const FASE_ATTESA = 1;
const FASE_CONSEGNA = 2;
// Quante richieste recenti si guardano per trovare quelle in corso: con più ordini insieme non bastano più le ultime 5.
const RICHIESTE_RECENTI = 30;

// Millisecondi passati da un istante scritto in una colonna TIMESTAMP (UTC senza fuso). pg la legge come
// ora locale del processo: `new Date(colonna)` confrontato con Date.now() sbagliava dell'offset del fuso
// (2 ore sul PC a Roma, niente sulla VPS in UTC), e le finestre di 3 e 24 ore non erano quelle vere.
// istanteUtc rimette a posto l'istante.
function eta(naive) {
  const istante = format.istanteUtc(naive);
  return istante ? Date.now() - istante.getTime() : Infinity;
}

// Ordine ancora in viaggio: non consegnato e nato da meno di 24 ore (oltre, non conta più come "attivo").
function eInConsegna(c) {
  if (c.step !== 3 || !c.ordine || c.ordine.consegnato_il) return false;
  return eta(c.ordine.creato_il) <= VENTIQUATTRO_ORE_MS;
}

// Versione "leggera" di richiesteClienteConStato, solo per scegliere le attività: qui non serve MAI il dettaglio
// (righe, risposte) di ogni richiesta — solo stato e id. `secondi_rimasti` (la finestra di conferma, calcolata dal
// DB con il suo orologio) serve a ordinare le richieste in attesa e al timer: così non costa una query ciascuna.
function leggiRichiesteRecenti(clienteId) {
  return db
    .prepare(
      `SELECT id, stato, creato_il, scade_il, order_id,
              EXTRACT(EPOCH FROM (scade_il - NOW()))::int AS secondi_rimasti
         FROM requests WHERE cliente_id = ? ORDER BY id DESC LIMIT ${RICHIESTE_RECENTI}`
    )
    .all(clienteId);
}

async function richiesteAttiveClienteLeggere(recenti) {
  // La scadenza si aggiorna solo per le richieste che ne hanno bisogno: quelle del vecchio flusso ('con_offerte')
  // e quelle in attesa con la finestra già finita. Una richiesta in attesa con tempo davanti non ha niente da
  // chiudere (aggiornaScadenza ci sarebbe arrivata con due letture inutili), e con più richieste aperte insieme
  // si fanno in parallelo.
  const aggiornate = await Promise.all(
    recenti.map(async (r) => {
      const daControllare = r.stato === 'con_offerte' || (r.stato === 'in_attesa' && !(Number(r.secondi_rimasti) > 0));
      if (!daControllare) return r;
      const agg = await richieste.aggiornaScadenza(r.id);
      return agg ? { ...r, ...agg } : r;
    })
  );

  // Gli ordini delle richieste già ordinate con una sola lettura, non una per richiesta.
  const idOrdini = aggiornate.filter((r) => r.stato === 'ordinata' && r.order_id).map((r) => r.order_id);
  const ordiniPerId = new Map();
  if (idOrdini.length) {
    const ordini = await db
      .prepare(`SELECT id, stato, consegnato_il, creato_il, corriere_arrivo_il, corriere_risposto_il, corriere_nome, consegna_ore FROM orders WHERE id IN (${idOrdini.map(() => '?').join(',')})`)
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'ordinata') {
      step = 3;
      if (rAgg.order_id) ordine = ordiniPerId.get(Number(rAgg.order_id)) || null;
    }
    return { richiesta: rAgg, step, ordine };
  });
}

// Secondi che mancano alla fine della finestra di conferma di una richiesta in attesa (0 se già finita).
function secondiAllaScadenza(c) {
  const s = Number(c.richiesta.secondi_rimasti);
  return Number.isFinite(s) ? Math.max(0, s) : 0;
}

// Quando arriva l'ordine al cliente, in millisecondi; senza orario scritto va in fondo all'elenco.
function arrivoMs(c) {
  const arrivo = format.toDate(c.ordine.corriere_arrivo_il);
  return arrivo ? arrivo.getTime() : Number.MIN_SAFE_INTEGER;
}

// Le attività in corso nell'ordine di "Stato ordini": [{ fase, card }]. A parità vince la richiesta più recente.
function attiveOrdinate(cards) {
  const attesa = cards
    .filter((c) => c.step === 1)
    .sort((a, b) => secondiAllaScadenza(b) - secondiAllaScadenza(a) || b.richiesta.id - a.richiesta.id);
  const consegna = cards
    .filter(eInConsegna)
    .sort((a, b) => arrivoMs(b) - arrivoMs(a) || b.richiesta.id - a.richiesta.id);
  return [
    ...attesa.map((card) => ({ fase: FASE_ATTESA, card })),
    ...consegna.map((card) => ({ fase: FASE_CONSEGNA, card })),
  ];
}

// L'attività che seguono l'icona, la home e l'app: la prima inviata (id di richiesta più basso), a prescindere
// dalla fase. Con una sola attività è quella.
function primaInviata(attive) {
  return attive.length ? attive.reduce((a, b) => (b.card.richiesta.id < a.card.richiesta.id ? b : a)) : null;
}

// Secondi che mancano a far sparire da "Stato ordini" una richiesta chiusa senza ordine: 10 minuti dalla scadenza (`scade_il`, il momento in cui
// la finestra è finita e nessuno ha confermato). 0 se non è una richiesta "senza risposta" o i 10 minuti sono passati. Arrotondato per eccesso:
// una voce che c'è non ha mai 0 secondi, e il browser che aspetta quel numero trova il server già pronto a non mandarla più.
function secondiAllaScomparsa(richiesta) {
  if (!richiesta || richiesta.stato !== 'nessuna_offerta') return 0;
  return Math.max(0, Math.ceil((SCADUTA_VISIBILE_MS - eta(richiesta.scade_il)) / 1000));
}

// Le richieste rimaste senza risposta da meno di 10 minuti: OGNUNA resta in "Stato ordini" per 10 minuti dalla sua scadenza, a prescindere da cos'altro
// è successo dopo (un'altra richiesta in attesa o scaduta, un ordine anche già consegnato). Prima ne contava una sola, e solo se era l'ULTIMA cosa
// fatta: con due richieste insieme la prima a scadere spariva subito, davanti agli occhi del cliente. Le annullate non ci sono (le ha chiuse lui).
// Ordine: prima quella che sparisce prima, a parità la più vecchia.
function scaduteRecenti(cards) {
  return cards
    .filter((c) => c.step === 0 && c.richiesta.stato === 'nessuna_offerta' && secondiAllaScomparsa(c.richiesta) > 0)
    .sort((a, b) => secondiAllaScomparsa(a.richiesta) - secondiAllaScomparsa(b.richiesta) || a.richiesta.id - b.richiesta.id);
}

function riferimentoAttivita(card) {
  return card.step === 3 ? { tipo: 'ordine', id: card.ordine.id } : { tipo: 'richiesta', id: card.richiesta.id };
}

// Tutto quello che "Stato ordini" deve sapere: `attive` (le attività in corso, già nell'ordine da mostrare) e
// `corrente` ({ tipo: 'ordine'|'richiesta', id } o null: la singola attività che segue l'app, o la prima richiesta senza risposta
// ancora visibile se non c'è altro). Segna anche come lette le notifiche di richieste/ordini: il cliente le sta guardando.
async function attivitaCliente(clienteId) {
  // I due "segna come lette" e la lettura delle richieste recenti non dipendono l'uno dall'altro: partono
  // insieme (un giro al DB invece di tre). Le scadenze si aggiornano DOPO, come prima: le notifiche che possono
  // creare (es. "nessuna conferma") restano da leggere.
  const [, , recenti] = await Promise.all([
    notifiche.segnaLetteCategoria(clienteId, 'ordini'),
    notifiche.segnaLetteCategoria(clienteId, 'richieste'),
    leggiRichiesteRecenti(clienteId),
  ]);
  const cards = await richiesteAttiveClienteLeggere(recenti);
  const attive = attiveOrdinate(cards);

  const prima = primaInviata(attive);
  if (prima) return { attive, corrente: riferimentoAttivita(prima.card) };
  const scadute = scaduteRecenti(cards);
  return { attive, corrente: scadute.length ? { tipo: 'richiesta', id: scadute[0].richiesta.id } : null };
}

// L'attività da mostrare quando se ne può mostrare una sola (l'app): { tipo, id } o null. È la prima inviata, non la più urgente.
async function attivitaCorrente(clienteId) {
  return (await attivitaCliente(clienteId)).corrente;
}

// L'ordine delle voci di "Stato ordini", uguale per l'icona che alterna e per la striscia di schede (funzione pura, provata in
// test/stato_ordini.test.js): prima le richieste scadute (il cliente deve rinviarle) da quella che sparisce prima, poi le richieste in attesa
// dal timer più corto al più lungo, poi gli ordini in consegna da quello che arriva prima a quello che arriva dopo (senza minuti in fondo).
// A parità, la più vecchia per prima: l'ordine non cambia da un aggiornamento all'altro. Ogni voce ha `fase` ('scaduta' | 'richiesta' |
// 'consegna') e `id`.
function ordinaVociIcona(voci) {
  const peso = { scaduta: 0, richiesta: 1, consegna: 2 };
  const minuti = (v) => (v.minuti === null || v.minuti === undefined ? Infinity : v.minuti);
  return [...voci].sort((a, b) => {
    if (a.fase !== b.fase) return peso[a.fase] - peso[b.fase];
    if (a.fase === 'scaduta' && (a.scompareTraSec || 0) !== (b.scompareTraSec || 0)) return (a.scompareTraSec || 0) - (b.scompareTraSec || 0);
    if (a.fase === 'richiesta' && a.secondi !== b.secondi) return a.secondi - b.secondi;
    if (a.fase === 'consegna' && minuti(a) !== minuti(b)) return minuti(a) < minuti(b) ? -1 : 1;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

// Una voce di "Stato ordini": quello che serve all'icona e alla striscia, sempre dalla stessa costruzione (così non dicono mai cose
// diverse). `tipo`+`id` dicono quale pagina la mostra (/richieste/:id o /ordini/:id), `voce` è "tipo-id" (il parametro ?voce= di
// /ordini), `richiestaId` serve a leggere il materiale. Solo `richiesta` ha secondi e durata, solo `scaduta` ha `scompareTraSec` (secondi
// che mancano a farla sparire: 10 minuti dalla scadenza), solo `consegna` ha minuti (null se il corriere non ha scritto l'orario), il nome
// del corriere ('' se manca) e l'avanzamento 0-1 della barra della home.
// Le schede della home (partials/stato_home.ejs) sono una per voce, quindi leggono tutto da qui.
function costruisciVoce(fase, card, finestra, minutiTesto = null) {
  const r = card.richiesta;
  if (fase === 'consegna') {
    // corriere_arrivo_il è TIMESTAMPTZ (un istante vero), a differenza degli altri orari dello schema.
    const creato = format.istanteUtc(card.ordine.creato_il); // TIMESTAMP UTC senza fuso: istanteUtc lo rimette a posto
    // Senza il corriere l'arrivo è la stima del banco (`consegna_ore` dalla nascita dell'ordine): la stessa regola della pagina dell'ordine
    // ("Arriva entro 6 ore"). Prima la card e l'icona dicevano solo "In consegna".
    const ore = Number(card.ordine.consegna_ore);
    const arrivo = card.ordine.corriere_arrivo_il
      ? format.toDate(card.ordine.corriere_arrivo_il)
      : (creato && ore > 0 ? new Date(creato.getTime() + ore * 3600 * 1000) : null);
    const msAllArrivo = arrivo ? arrivo.getTime() - Date.now() : null;
    const etaSec = arrivo ? Math.round(msAllArrivo / 1000) : null;
    const durataSec = arrivo && creato ? Math.max(1, Math.round((arrivo.getTime() - creato.getTime()) / 1000)) : null;
    return {
      fase, tipo: 'ordine', id: card.ordine.id, richiestaId: r.id, href: '/ordini/' + card.ordine.id, voce: 'ordine-' + card.ordine.id,
      minuti: arrivo ? Math.max(1, Math.ceil(msAllArrivo / 60000)) : null,
      // Secondi all'arrivo (anche negativi) e durata dalla nascita dell'ordine: dal disegno in poi il browser fa scendere minuti, barra
      // e "In arrivo" con il suo orologio (public/app.js, "Consegna in arrivo"); `inArrivo` è lo stesso controllo già fatto qui, per il
      // primo disegno. Senza orario del corriere: niente di tutto questo, resta "In consegna".
      etaSec,
      durataSec,
      inArrivo: arrivo ? format.inArrivo(etaSec) : false,
      corriere: String(card.ordine.corriere_nome || '').trim(),
      // Barra della home: avanza in modo lineare col tempo (da "In viaggio" a "Consegnato", dalla nascita dell’ordine all’arrivo). Senza orario del corriere resta
      // ferma a metà ("In viaggio"): solo con l'evento che segna la consegna vera (ancora da collegare) arriverebbe a 1 ("Consegnato").
      // Parte da "In viaggio" (metà: il banco ha già accettato) e a tempo finito si ferma a PROGRESSO_ARRIVO (un filo prima di "Consegnato").
      progresso: durataSec ? PROGRESSO_IN_VIAGGIO + (PROGRESSO_ARRIVO - PROGRESSO_IN_VIAGGIO) * Math.min(1, Math.max(0, 1 - etaSec / durataSec)) : PROGRESSO_IN_VIAGGIO,
    };
  }
  const voce = { fase, tipo: 'richiesta', id: r.id, richiestaId: r.id, href: '/richieste/' + r.id, voce: 'richiesta-' + r.id };
  if (fase === 'richiesta') {
    voce.secondi = secondiAllaScadenza(card);
    voce.durata = format.durataFinestraSec(r.creato_il, r.scade_il, finestra);
    // Il numero scritto nella scheda della home ("entro 10 min"): quello della configurazione, non la durata dell'anello (col timer accorciato per le prove sarebbe "1 min").
    if (minutiTesto) voce.minutiTesto = Math.max(1, Math.round(minutiTesto));
  } else if (fase === 'scaduta') {
    voce.scompareTraSec = secondiAllaScomparsa(r);
  }
  return voce;
}

// Una firma delle voci ("richiesta-12-richiesta,ordine-9-consegna"): cambia quando un ordine cambia fase, ne arriva uno nuovo o ne
// finisce uno; non cambia col passare del tempo. In ordine alfabetico, così non dipende dall'ordine di alternanza. La pagina con la
// striscia si ricarica quando la firma dell'icona non è più quella con cui è stata disegnata.
function firmaVoci(voci) {
  return voci.map((v) => `${v.tipo}-${v.id}-${v.fase}`).sort().join(',');
}

// Legge una volta sola quello che serve a icona e striscia: le voci nell'ordine di alternanza (ordinaVociIcona) e le attività da cui
// vengono. Nessuna query per voce: richieste recenti, ordini e finestra in un giro.
async function leggiVoci(clienteId) {
  const [recenti, finestra, minutiTesto] = await Promise.all([leggiRichiesteRecenti(clienteId), pricing.getFinestraMinuti(), pricing.getFinestraMinutiTesto()]);
  const cards = await richiesteAttiveClienteLeggere(recenti);
  const attive = attiveOrdinate(cards);
  const scadute = scaduteRecenti(cards);
  const voci = ordinaVociIcona([
    ...scadute.map((card) => costruisciVoce('scaduta', card, finestra)),
    ...attive.map(({ fase, card }) => costruisciVoce(fase === FASE_ATTESA ? 'richiesta' : 'consegna', card, finestra, minutiTesto)),
  ]);
  return { attive, scadute, voci, finestra };
}

// Aggiunge a ogni voce `breve`: il nome del primo articolo e, se ce ne sono altri, " +N". Una lettura sola per tutte le richieste.
async function conBreve(voci) {
  if (!voci.length) return [];
  const righe = await richieste.righeRichieste([...new Set(voci.map((v) => v.richiestaId))]);
  return voci.map((v) => {
    const elenco = righe.get(Number(v.richiestaId)) || [];
    const nome = elenco[0] ? String(elenco[0].nome || '') : '';
    return { ...v, breve: nome ? nome + (elenco.length > 1 ? ' +' + (elenco.length - 1) : '') : '' };
  });
}

// Le voci della striscia di schede di "Stato ordini", nello stesso ordine dell'icona: richieste senza risposta da meno di 10 minuti,
// richieste in attesa dal timer più corto, ordini in consegna dall'arrivo più vicino. Con `segnaLette` segna anche come lette le notifiche (è la pagina "Stato ordini" a
// chiederlo); con `breve: false` salta la lettura del materiale.
async function vociStriscia(clienteId, { segnaLette = false, breve = true } = {}) {
  const [, , lette] = await Promise.all([
    segnaLette ? notifiche.segnaLetteCategoria(clienteId, 'ordini') : null,
    segnaLette ? notifiche.segnaLetteCategoria(clienteId, 'richieste') : null,
    leggiVoci(clienteId),
  ]);
  return breve ? conBreve(lette.voci) : lette.voci;
}

// Stato dell'icona "Stato ordini" nella barra in basso. I campi di primo livello descrivono UNA sola attività (la prima inviata, vedi
// primaInviata) e li usa anche la scheda della home; `voci` le elenca TUTTE, nell'ordine in cui l'icona le alterna (ordinaVociIcona), e
// `firma` le riassume (firmaVoci). In sola lettura: NON segna le notifiche come lette, perché gira su ogni pagina del cliente e ogni 15
// secondi mentre una richiesta è in attesa.
//   { fase: 'nessuna', voci: [], firma }
//   { fase: 'richiesta', secondi, durata, voci, firma }   -> conto alla rovescia della finestra (10 min)
//   { fase: 'consegna', ordineId, minuti, etaSec, durataSec, inArrivo, corriere, progresso, voci, firma } -> minuti all'arrivo (null se
//                                                non scritto), secondi all'arrivo e durata totale, "In arrivo" (3 min o meno), nome del
//                                                corriere ('' se manca), avanzamento 0-1 per la home
//   { fase: 'scaduta', voci, firma }          -> nessun banco ha accettato in tempo, da meno di 10 minuti, e non c'è altra attività in corso
// voci: [{ fase, tipo, id, richiestaId, href, voce, secondi?, durata?, scompareTraSec?, minuti?, etaSec?, durataSec?, inArrivo?, corriere?,
// progresso? }] (la `breve` la aggiunge solo la striscia).
async function statoIconaOrdini(clienteId) {
  const { attive, scadute, voci, finestra } = await leggiVoci(clienteId);
  const firma = firmaVoci(voci);

  const prima = primaInviata(attive);
  if (prima && prima.fase === FASE_ATTESA) {
    const v = costruisciVoce('richiesta', prima.card, finestra);
    return { fase: 'richiesta', secondi: v.secondi, durata: v.durata, voci, firma };
  }

  if (prima) {
    const v = costruisciVoce('consegna', prima.card, finestra);
    return {
      fase: 'consegna',
      ordineId: v.id,
      minuti: v.minuti,
      etaSec: v.etaSec,
      durataSec: v.durataSec,
      inArrivo: v.inArrivo,
      corriere: v.corriere,
      progresso: v.progresso,
      voci,
      firma,
    };
  }

  return { fase: scadute.length ? 'scaduta' : 'nessuna', voci, firma };
}

module.exports = {
  ErroreFlusso,
  testoOrdineConfermato,
  statoIconaOrdini,
  ordinaVociIcona,
  secondiAllaScomparsa,
  senzaFiliale,
  OrdineInLavorazione,
  righeDaQuantita,
  riepilogoCarrello,
  vistaRiepilogo,
  validaRichiesta,
  controllaBancoAperto,
  nuovaRichiesta,
  chiaveInvioValida,
  dettaglioRichiesta,
  totaliRichiestaOggi,
  annullaRichiesta,
  reinviaRichiesta,
  eliminaRichiesta,
  creaOrdineDaRisposta,
  dettaglioOrdine,
  segnaConsegnatoDalCorriere,
  eliminaOrdine,
  ordineAnnullabileDalCliente,
  richiesteClienteConStato,
  articoliDaRiordinare,
  ultimoOrdineConsegnato,
  attivitaCorrente,
  attivitaCliente,
  vociStriscia,
  conBreve,
  firmaVoci,
};
