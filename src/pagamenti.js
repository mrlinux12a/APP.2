const db = require('../db');

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
  setTimeout(() => {
    elaboratore().catch((e) => console.error('[stripe] elaborazione:', e.message));
  }, 2000).unref();
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

module.exports = {
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
