const db = require('../db');

// Pagamento dell'installatore: avviene quando manda la richiesta, prima che un banco o un corriere
// la prendano in carico. Per ora è SIMULATO: nessun provider, il pagamento riesce sempre e si
// annota solo sulla richiesta (pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il).
// Quando ci sarà un provider vero basta cambiare qui dentro: incasso all'invio, rimborso se la
// richiesta si chiude senza ordine (nessun banco, nessun corriere in tempo, annullo).
//
// pagamento_stato: NULL = richiesta nata col vecchio flusso (nessun pagamento), 'pagato', 'rimborsato'.

const METODO_SIMULATO = 'simulato';

// Cosa si scrive su una richiesta nuova. L'importo è il totale IVA inclusa del carrello.
function incassoSimulato(importo) {
  return { stato: 'pagato', metodo: METODO_SIMULATO, importo };
}

// Il pagamento torna all'installatore. Vero solo la prima volta e solo se c'era qualcosa da
// rimborsare: la richiesta del vecchio flusso (stato NULL) o già rimborsata resta com'è.
async function rimborsa(requestId) {
  const r = await db
    .prepare(`UPDATE requests SET pagamento_stato = 'rimborsato' WHERE id = ? AND pagamento_stato = 'pagato'`)
    .run(requestId);
  return r.changes > 0;
}

// "Riinvia richiesta": l'installatore ha già visto il totale e preme il tasto, quindi si paga di
// nuovo lo stesso importo. Con un provider vero qui servirebbe un nuovo passaggio di pagamento.
async function incassaDiNuovo(requestId) {
  const r = await db
    .prepare(
      `UPDATE requests SET pagamento_stato = 'pagato', pagato_il = NOW()
        WHERE id = ? AND pagamento_stato = 'rimborsato'`
    )
    .run(requestId);
  return r.changes > 0;
}

module.exports = { incassoSimulato, rimborsa, incassaDiNuovo, METODO_SIMULATO };
