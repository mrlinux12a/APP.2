const db = require('../db');

// ============================ REGOLE DEI PAGAMENTI (lato installatore) ============================
//  · All'invio della richiesta la carta è solo AUTORIZZATA (capture_method manual): l'importo è "bloccato", non pagato.
//  · Si incassa SOLO quando nasce l'ordine (un banco conferma). Da quel momento esiste la ricevuta.
//  · Se nessun banco conferma, o il cliente annulla in fase 1, il blocco si annulla: nessun addebito, nessun rimborso, nessuna
//    ricevuta, nessuna consegna.
//  · Il cliente può annullare SOLO in fase 1: richiesta in attesa e nessun banco ha ancora accettato. Dopo, mai: né la richiesta né
//    l'ordine (flusso_cliente.annullaRichiesta, ordineAnnullabileDalCliente; per un problema si contatta l'assistenza).
// Cosa vede l'installatore lo dice statoPagamento (più in basso): 'bloccato' | 'pagato' | 'annullato' | 'rimborsato'.
// ===================================================================================================

// Pagamento dell'installatore: avviene quando manda la richiesta, prima che un banco o un corriere
// la prendano in carico. Due modi, scelti da chi crea la richiesta (`pagamento_metodo` sulla richiesta):
//  - 'simulato': nessun provider, il pagamento riesce sempre e si annota solo sulla richiesta. È quello dell'app
//    nativa e del sito quando STRIPE_SECRET_KEY non c'è (sviluppo, prove).
//  - 'stripe': il sito, con STRIPE_SECRET_KEY impostata. La carta viene solo AUTORIZZATA all'invio; si incassa
//    quando nasce l'ordine e si rilascia il blocco se la richiesta si chiude senza ordine. Il lavoro vero con
//    Stripe sta in src/stripe_pagamenti.js: qui solo i punti di aggancio del flusso (rimborsa, segnaDaIncassare,
//    incassaDiNuovo), che scrivono SOLO sul DB — spesso girano dentro una transazione e una chiamata di rete lì
//    la terrebbe aperta. La chiamata a Stripe la fa il giro successivo (richiediElaborazione + timer di server.js).
//
// pagamento_stato (sulla richiesta): NULL = richiesta nata col vecchio flusso (nessun pagamento), 'pagato',
// 'rimborsato'. Con Stripe 'pagato' vale anche per la carta solo bloccata, 'rimborsato' per il blocco rilasciato:
// per l'installatore l'effetto è lo stesso.

const METODO_SIMULATO = 'simulato';
const METODO_STRIPE = 'stripe';

// Stripe è acceso solo se c'è la chiave segreta nel .env. Senza, tutto resta simulato.
function stripeAttivo() {
  return String(process.env.STRIPE_SECRET_KEY || '').trim() !== '';
}

// Solo per lo sviluppo sul PC: con PAGAMENTO_SIMULATO=1 nel .env LOCALE "Paga e invia" salta Stripe e manda la richiesta con il
// pagamento simulato, come senza chiavi. Sulla VPS non vale mai: il suo .env non ha quella riga, e anche se l'avesse viene ignorata
// con la chiave reale (sk_live_) o con NODE_ENV=production. Non si guarda mai l'indirizzo con cui arriva la richiesta (l'intestazione
// Host la scrive chi chiama: bypassare il pagamento da lì sarebbe un buco). Riguarda solo COME si paga una richiesta nuova: incassi,
// rilasci e rimborsi dei pagamenti Stripe già fatti (il .env locale ha il DB di produzione) funzionano com'erano.
function simulatoRichiesto() {
  return /^(1|true|si|sì|yes)$/i.test(String(process.env.PAGAMENTO_SIMULATO || '').trim());
}
// Sulla VPS il bypass si accende solo di proposito (richiesta esplicita del 16/10/2026): servono nel .env DELLA VPS entrambe le righe,
// PAGAMENTO_SIMULATO=1 e PAGAMENTO_SIMULATO_FORZA=1. Con la seconda le difese di sopra (chiave reale, NODE_ENV=production) non contano e
// "Paga e invia" / "Rinvia richiesta" non passano più da Stripe: i clienti veri ordinano SENZA pagare. Per spegnerlo: via una delle due righe e riavvio.
function simulatoForzatoInProduzione() {
  return /^(1|true|si|sì|yes)$/i.test(String(process.env.PAGAMENTO_SIMULATO_FORZA || '').trim());
}
function pagamentoSimulatoForzato() {
  if (!simulatoRichiesto()) return false;
  if (simulatoForzatoInProduzione()) return true;
  return modoStripe() !== 'live' && process.env.NODE_ENV !== 'production';
}
// Una richiesta nuova si paga con Stripe (pagina di pagamento del sito)? Stripe acceso e nessun bypass locale.
function pagaConStripe() {
  return stripeAttivo() && !pagamentoSimulatoForzato();
}

// 'live' o 'test', dalla chiave: le righe di stripe_pagamenti portano il modo in cui sono nate e ogni istanza
// lavora solo le sue (il .env del PC punta al DB di produzione, con una chiave di prova: non deve toccare i
// pagamenti veri, e viceversa).
function modoStripe() {
  return /^(sk|rk)_live_/.test(String(process.env.STRIPE_SECRET_KEY || '').trim()) ? 'live' : 'test';
}

// Cosa si scrive su una richiesta nuova. L'importo è il totale IVA inclusa del carrello.
function incasso(importo, metodo = METODO_SIMULATO) {
  return { stato: 'pagato', metodo, importo };
}
function incassoSimulato(importo) {
  return incasso(importo, METODO_SIMULATO);
}

// Chi sa parlare con Stripe (src/stripe_pagamenti.js, che si registra caricandosi) e un giro "a breve": dopo che
// il flusso ha segnato nel DB un incasso o un rilascio da fare, dà il tempo alla transazione di chiudersi e poi
// lo esegue. Se non parte (processo che si ferma, errore di rete) lo riprende il timer di server.js.
let elaboratore = null;
function impostaElaboratore(fn) {
  elaboratore = fn;
}
function richiediElaborazione() {
  if (!elaboratore) return;
  // Si chiama anche da dentro le transazioni del flusso (creazione dell'ordine, chiusura della finestra): il timer non deve ereditare il
  // client di quella transazione, che a 2 secondi di distanza è già chiusa e restituita al pool (vedi db.fuoriDallaTransazione).
  const fuori = typeof db.fuoriDallaTransazione === 'function' ? db.fuoriDallaTransazione : (fn) => fn();
  fuori(() => {
    setTimeout(() => {
      elaboratore().catch((e) => console.error('[stripe] elaborazione:', e.message));
    }, 2000).unref();
  });
}

// Il pagamento torna all'installatore. Vero solo la prima volta e solo se c'era qualcosa da
// rimborsare: la richiesta del vecchio flusso (stato NULL) o già rimborsata resta com'è. Con Stripe segna anche
// il da farsi: carta ancora solo bloccata -> rilasciare il blocco; già incassata -> rimborsare.
async function rimborsa(requestId) {
  const r = await db
    .prepare(`UPDATE requests SET pagamento_stato = 'rimborsato', rimborsato_il = NOW() WHERE id = ? AND pagamento_stato = 'pagato'`)
    .run(requestId);
  if (r.changes > 0 && stripeAttivo()) {
    await db
      .prepare(
        `UPDATE stripe_pagamenti
            SET stato = CASE WHEN stato = 'incassato' THEN 'da_rimborsare' ELSE 'da_rilasciare' END,
                aggiornato_il = NOW()
          WHERE request_id = ? AND stato IN ('autorizzato', 'da_incassare', 'incassato')`
      )
      .run(requestId);
    richiediElaborazione();
  }
  return r.changes > 0;
}

// È nato l'ordine: la carta bloccata va incassata. Si incassa il totale dell'ordine se è più basso di quanto
// autorizzato (il banco ha applicato uno sconto che il carrello non conosceva), mai di più. Chiamata dentro la
// transazione che crea l'ordine, quindi solo DB.
async function segnaDaIncassare(requestId, totaleOrdine) {
  if (!stripeAttivo()) return;
  const euro = Number(totaleOrdine);
  const centesimi = Number.isFinite(euro) && euro > 0 ? Math.round(euro * 100) : null;
  await db
    .prepare(
      `UPDATE stripe_pagamenti
          SET stato = 'da_incassare', incasso_cent = LEAST(importo_cent, ?::int), aggiornato_il = NOW()
        WHERE request_id = ? AND stato = 'autorizzato'`
    )
    .run(centesimi, requestId);
  richiediElaborazione();
}

// "Rinvia richiesta": l'installatore ha già visto cosa paga (la consegna, ricalcolata con i prezzi di oggi: vedi richieste.reinviaRichiesta)
// e preme il tasto, quindi si paga di nuovo. `importo` è quanto si addebita ora (il pagamento autorizzato con Stripe, o il calcolo
// col simulato): senza, resta quello di prima. Il simulato riesce da solo; con Stripe la richiesta arriva qui solo a pagamento
// autorizzato (src/stripe_pagamenti.js), con metodo 'stripe'.
async function incassaDiNuovo(requestId, { metodo = METODO_SIMULATO, importo = null } = {}) {
  const r = await db
    .prepare(
      `UPDATE requests SET pagamento_stato = 'pagato', pagamento_metodo = ?, pagato_il = NOW(), rimborsato_il = NULL,
                           pagamento_importo = COALESCE(?::float8, pagamento_importo)
        WHERE id = ? AND pagamento_stato = 'rimborsato'`
    )
    .run(metodo, importo === null || importo === undefined ? null : importo, requestId);
  return r.changes > 0;
}

// ---------- Cosa vede l'installatore: lo stato del pagamento ----------

// Gli stati di stripe_pagamenti che raccontano il destino della carta (gli altri, da_pagare / in_creazione / fallito / da_verificare, sono
// tentativi non andati a buon fine o in corso: non sono "il pagamento" di una richiesta) e la chiave che ne esce per le viste.
const STATI_CARTA = ['autorizzato', 'da_incassare', 'incassato', 'da_rilasciare', 'rilasciato', 'scaduto', 'da_rimborsare', 'rimborsato'];
const CHIAVE_DA_STATO_CARTA = {
  autorizzato: 'bloccato',
  da_incassare: 'bloccato',
  incassato: 'pagato',
  da_rilasciare: 'annullato',
  rilasciato: 'annullato',
  scaduto: 'annullato',
  da_rimborsare: 'rimborsato',
  rimborsato: 'rimborsato',
};

// La riga di stripe_pagamenti che vale per una richiesta: l'ultima fra quelle che raccontano il destino della carta (con "Rinvia
// richiesta" ce ne sono due: la prima rilasciata, la seconda autorizzata). Una sola lettura; null se la richiesta non è stata pagata con Stripe.
async function rigaPagamento(requestId) {
  if (!requestId) return null;
  return (
    (await db
      .prepare(`SELECT * FROM stripe_pagamenti WHERE request_id = ? AND stato IN (${STATI_CARTA.map((s) => `'${s}'`).join(', ')}) ORDER BY id DESC LIMIT 1`)
      .get(requestId)) || null
  );
}

// "visa" -> "Visa", "amex" -> "American Express": come si scrive la marca accanto alle ultime 4 cifre.
const NOMI_MARCA = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', maestro: 'Maestro', diners: 'Diners Club', discover: 'Discover', jcb: 'JCB', unionpay: 'UnionPay' };
function nomeMarca(marca) {
  const m = String(marca || '').trim().toLowerCase();
  return NOMI_MARCA[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : '');
}

// Il calcolo, senza DB: `riga` = rigaPagamento, `richiesta` = la riga di requests (stato, order_id, pagamento_*), `ordine` = la riga di orders se
// la pagina è quella di un ordine. Ritorna null per una richiesta del vecchio flusso (mai pagata), altrimenti
//   { chiave: 'bloccato' | 'pagato' | 'annullato' | 'rimborsato', importo (euro), data (quando), carta ({ marca, ultime4, testo }|null),
//     receiptUrl (ricevuta di Stripe), ricevuta (c'è una ricevuta di pagamento), ricevutaRimborso, prova (pagamento NON reale), metodo }
//  · 'bloccato'  ← carta autorizzata (richiesta in attesa, nessun ordine ancora);
//  · 'pagato'    ← è nato l'ordine, cioè un banco ha confermato e (col modulo WhatsApp) un corriere ha preso la consegna: la carta è PAGATA per l'installatore
//                  (richiesta esplicita del 19/10/2026), anche se Stripe non ha ancora fatto la capture (riga 'da_incassare': passano pochi secondi, e la
//                  pagina dell'ordine non si ricarica da sola: la scheda diceva "Bloccati sulla carta" per un ordine già partito, e non aveva la ricevuta);
//  · 'annullato' ← blocco rilasciato o scaduto, oppure richiesta chiusa/annullata senza incasso: niente addebito, niente rimborso;
//  · 'rimborsato'← incassata e poi restituita (caso raro, lo gestisce l'assistenza).
// Senza riga di Stripe (pagamento simulato dell'app e del PC, o richiesta di prima) si ricava lo stesso dalla richiesta. Anche il pagamento simulato (la
// "sandbox") ha la sua ricevuta una volta nato l'ordine (richiesta esplicita del 19/10/2026), come un incasso vero: ma è un pagamento NON reale, quindi
// `prova` è true (vale anche per le righe di Stripe nate con la chiave di prova, `modo = 'test'`) e la ricevuta lo scrive.
function calcolaStatoPagamento({ riga = null, richiesta = null, ordine = null } = {}) {
  const chiusaSenzaOrdine = !!richiesta && ['annullata', 'nessuna_offerta'].includes(richiesta.stato) && !richiesta.order_id && !ordine;
  if (riga && CHIAVE_DA_STATO_CARTA[riga.stato]) {
    let chiave = CHIAVE_DA_STATO_CARTA[riga.stato];
    // Richiesta chiusa senza ordine ma il blocco non risulta ancora rilasciato (un attimo prima del giro di Stripe): per chi guarda è annullato.
    if (chiave === 'bloccato' && chiusaSenzaOrdine) chiave = 'annullato';
    // L'ordine è nato e la capture è solo da fare ('da_incassare': l'ha segnata la transazione che ha creato l'ordine, `incasso_cent` è già deciso): è pagato.
    // La ricevuta c'è già (importo e data sono quelli dell'ordine); la marca della carta, e la ricevuta di Stripe, arrivano con la capture.
    const incassoInCorso = riga.stato === 'da_incassare' && (!!ordine || (!!richiesta && !!richiesta.order_id));
    if (incassoInCorso) chiave = 'pagato';
    const cent = Number(riga.incasso_cent) > 0 ? Number(riga.incasso_cent) : Number(riga.importo_cent);
    const incassata = (['incassato', 'da_rimborsare', 'rimborsato'].includes(riga.stato) && !!riga.incasso_cent) || incassoInCorso;
    return {
      chiave,
      importo: Number.isFinite(cent) ? cent / 100 : null,
      data: (chiave === 'pagato' ? riga.incassato_il : null) || riga.aggiornato_il || null,
      carta: riga.carta_ultime4
        ? { marca: nomeMarca(riga.carta_marca), ultime4: String(riga.carta_ultime4), testo: `${nomeMarca(riga.carta_marca) || 'Carta'} •••• ${riga.carta_ultime4}` }
        : null,
      receiptUrl: riga.receipt_url || null,
      ricevuta: incassata,
      ricevutaRimborso: riga.stato === 'rimborsato' && incassata,
      prova: riga.modo === 'test',
      metodo: METODO_STRIPE,
    };
  }
  if (!richiesta || !richiesta.pagamento_stato) return null;
  const conOrdine = !!ordine || !!richiesta.order_id;
  const simulato = richiesta.pagamento_metodo === METODO_SIMULATO;
  let chiave;
  if (richiesta.pagamento_stato === 'rimborsato') chiave = conOrdine ? 'rimborsato' : 'annullato';
  else chiave = chiusaSenzaOrdine ? 'annullato' : conOrdine ? 'pagato' : 'bloccato';
  return {
    chiave,
    importo: richiesta.pagamento_importo === null || richiesta.pagamento_importo === undefined ? null : Number(richiesta.pagamento_importo),
    data: (chiave === 'pagato' ? richiesta.pagato_il : richiesta.rimborsato_il) || null,
    carta: null,
    receiptUrl: null,
    // Solo per il pagamento SIMULATO, e con l'ordine nato (pagato, o poi rimborsato); senza ordine (bloccato, annullato) no, come per Stripe. Un pagamento
    // 'stripe' senza la sua riga non è una prova: lì la ricevuta non c'è (non si sa se è stato incassato).
    ricevuta: simulato && conOrdine && (chiave === 'pagato' || chiave === 'rimborsato'),
    ricevutaRimborso: simulato && conOrdine && chiave === 'rimborsato',
    prova: simulato,
    metodo: richiesta.pagamento_metodo || null,
  };
}

// Lo stato del pagamento di una richiesta o di un ordine (con le sue letture). `opzioni.richiesta` / `opzioni.riga` evitano di rileggere quello che la
// pagina ha già in mano. Una richiesta si riconosce da pagamento_stato / scade_il / order_id, un ordine da request_id.
async function statoPagamento(oggetto, opzioni = {}) {
  if (!oggetto) return null;
  const eRichiesta = ['pagamento_stato', 'scade_il', 'order_id'].some((k) => k in oggetto);
  const richiestaId = eRichiesta ? oggetto.id : oggetto.request_id;
  const [riga, richiesta] = await Promise.all([
    opzioni.riga !== undefined ? opzioni.riga : rigaPagamento(richiestaId),
    eRichiesta
      ? oggetto
      : opzioni.richiesta !== undefined
        ? opzioni.richiesta
        : richiestaId
          ? db
              .prepare('SELECT id, stato, order_id, pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il, rimborsato_il FROM requests WHERE id = ?')
              .get(richiestaId)
          : null,
  ]);
  return calcolaStatoPagamento({ riga, richiesta, ordine: eRichiesta ? null : oggetto });
}

module.exports = {
  rigaPagamento,
  calcolaStatoPagamento,
  statoPagamento,
  nomeMarca,
  METODO_SIMULATO,
  METODO_STRIPE,
  stripeAttivo,
  modoStripe,
  simulatoRichiesto,
  pagamentoSimulatoForzato,
  simulatoForzatoInProduzione,
  pagaConStripe,
  incasso,
  incassoSimulato,
  impostaElaboratore,
  richiediElaborazione,
  rimborsa,
  segnaDaIncassare,
  incassaDiNuovo,
};
