// Prove di pagamenti.calcolaStatoPagamento / statoPagamento (src/pagamenti.js): cosa vede l'installatore del suo pagamento, dalle righe di
// stripe_pagamenti e dalla richiesta. Le regole stanno in cima a src/pagamenti.js: carta solo AUTORIZZATA all'invio, incassata quando nasce
// l'ordine, blocco annullato (nessun addebito, nessuna ricevuta) se nessun banco conferma o il cliente annulla in fase 1. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let letture = [];
let rigaStripe = null;
let richiestaDb = null;
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const esegui = async (...p) => {
      letture.push({ s, p });
      if (/FROM stripe_pagamenti WHERE request_id = \? AND stato IN/.test(s)) return rigaStripe;
      if (/FROM requests WHERE id = \?/.test(s)) return richiestaDb;
      throw new Error('query non prevista: ' + s.slice(0, 100));
    };
    return { get: esegui, all: esegui, run: esegui };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const pagamenti = require('../src/pagamenti');
const { calcolaStatoPagamento: stato } = pagamenti;

const incassoUtc = new Date(2026, 9, 15, 19, 16);
const riga = (extra = {}) => ({ stato: 'autorizzato', importo_cent: 2007, incasso_cent: null, aggiornato_il: new Date(2026, 9, 15, 10, 0), ...extra });
const richiesta = (extra = {}) => ({ id: 177, stato: 'in_attesa', order_id: null, pagamento_stato: 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: new Date(2026, 9, 15, 10, 0), rimborsato_il: null, ...extra });

test('le quattro chiavi dagli stati di Stripe: bloccato, pagato, annullato, rimborsato', () => {
  const attese = {
    autorizzato: 'bloccato', da_incassare: 'bloccato',
    incassato: 'pagato',
    da_rilasciare: 'annullato', rilasciato: 'annullato', scaduto: 'annullato',
    da_rimborsare: 'rimborsato', rimborsato: 'rimborsato',
  };
  for (const [statoRiga, chiave] of Object.entries(attese)) {
    // `incasso_cent` c'è dove la carta è stata incassata (da_incassare lo ha già deciso, ma non è ancora incassata)
    const r = riga({ stato: statoRiga, incasso_cent: ['incassato', 'da_rimborsare', 'rimborsato'].includes(statoRiga) ? 2007 : null });
    assert.equal(stato({ riga: r, richiesta: richiesta() }).chiave, chiave, statoRiga);
  }
  // stati che non raccontano il destino della carta (tentativo in corso o fallito): non sono "il pagamento", si ricade sulla richiesta
  assert.equal(stato({ riga: riga({ stato: 'da_pagare' }), richiesta: richiesta() }).metodo, 'stripe');
  assert.equal(stato({ riga: riga({ stato: 'da_verificare' }), richiesta: richiesta() }).chiave, 'bloccato');
});

test('importo, data, carta e ricevuta: l\'incasso se c\'è, altrimenti il blocco; la ricevuta solo con un incasso vero', () => {
  // bloccato: importo autorizzato, niente ricevuta, data dell'ultimo aggiornamento
  let s = stato({ riga: riga(), richiesta: richiesta() });
  assert.deepEqual([s.chiave, s.importo, s.ricevuta, s.ricevutaRimborso, s.carta, s.receiptUrl], ['bloccato', 20.07, false, false, null, null]);
  // pagato: importo INCASSATO (anche più basso dell'autorizzato), data dell'incasso, carta e ricevuta di Stripe
  s = stato({
    riga: riga({ stato: 'incassato', incasso_cent: 1900, incassato_il: incassoUtc, carta_marca: 'visa', carta_ultime4: '4242', receipt_url: 'https://pay.stripe.com/receipts/x' }),
    richiesta: richiesta({ order_id: 97 }),
  });
  assert.equal(s.chiave, 'pagato');
  assert.equal(s.importo, 19);
  assert.equal(s.data, incassoUtc, 'la data è quella dell\'incasso, non quella del blocco');
  assert.deepEqual(s.carta, { marca: 'Visa', ultime4: '4242', testo: 'Visa •••• 4242' });
  assert.equal(s.receiptUrl, 'https://pay.stripe.com/receipts/x');
  assert.deepEqual([s.ricevuta, s.ricevutaRimborso], [true, false]);
  // senza `incassato_il` (incassi di prima della colonna) si ripiega sull'ultimo aggiornamento
  s = stato({ riga: riga({ stato: 'incassato', incasso_cent: 2007 }), richiesta: richiesta({ order_id: 97 }) });
  assert.equal(s.data.getTime(), new Date(2026, 9, 15, 10, 0).getTime());
  // rimborsato: ricevuta di pagamento E di rimborso; "da rimborsare" (rimborso in corso) ha solo la prima
  s = stato({ riga: riga({ stato: 'rimborsato', incasso_cent: 2007 }), richiesta: richiesta({ order_id: 97 }) });
  assert.deepEqual([s.chiave, s.ricevuta, s.ricevutaRimborso], ['rimborsato', true, true]);
  s = stato({ riga: riga({ stato: 'da_rimborsare', incasso_cent: 2007 }), richiesta: richiesta({ order_id: 97 }) });
  assert.deepEqual([s.chiave, s.ricevuta, s.ricevutaRimborso], ['rimborsato', true, false]);
  // `prova` (pagamento non reale): le righe nate con la chiave di prova sì, quelle vere no
  assert.equal(stato({ riga: riga({ stato: 'incassato', incasso_cent: 2007, modo: 'test' }), richiesta: richiesta({ order_id: 97 }) }).prova, true);
  assert.equal(stato({ riga: riga({ stato: 'incassato', incasso_cent: 2007, modo: 'live' }), richiesta: richiesta({ order_id: 97 }) }).prova, false);
  // annullato: nessuna ricevuta, mai
  s = stato({ riga: riga({ stato: 'rilasciato' }), richiesta: richiesta({ stato: 'nessuna_offerta', pagamento_stato: 'rimborsato' }) });
  assert.deepEqual([s.chiave, s.ricevuta, s.ricevutaRimborso], ['annullato', false, false]);
});

test('la marca della carta si scrive per esteso', () => {
  assert.equal(pagamenti.nomeMarca('visa'), 'Visa');
  assert.equal(pagamenti.nomeMarca('mastercard'), 'Mastercard');
  assert.equal(pagamenti.nomeMarca('amex'), 'American Express');
  assert.equal(pagamenti.nomeMarca('cartasi'), 'Cartasi'); // marca sconosciuta: maiuscola iniziale
  assert.equal(pagamenti.nomeMarca(null), '');
  // senza marca ma con le cifre: "Carta •••• 4242"
  assert.equal(stato({ riga: riga({ stato: 'incassato', incasso_cent: 2007, carta_ultime4: '4242' }), richiesta: richiesta({ order_id: 1 }) }).carta.testo, 'Carta •••• 4242');
});

test('richiesta chiusa o annullata senza ordine: il blocco è "annullato" anche se Stripe non l\'ha ancora rilasciato', () => {
  for (const chiusura of ['annullata', 'nessuna_offerta']) {
    const s = stato({ riga: riga({ stato: 'autorizzato' }), richiesta: richiesta({ stato: chiusura }) });
    assert.equal(s.chiave, 'annullato', chiusura);
    assert.equal(s.ricevuta, false);
  }
  // ma con un ordine nato non è chiusa: resta bloccato finché la carta non è incassata
  assert.equal(stato({ riga: riga({ stato: 'da_incassare' }), richiesta: richiesta({ stato: 'ordinata', order_id: 97 }) }).chiave, 'bloccato');
});

test('senza riga di Stripe (pagamento simulato dell\'app e del PC, o richiesta di prima): lo stato si ricava dalla richiesta; con l\'ordine nato c\'è la ricevuta "di prova"', () => {
  // vecchio flusso, mai pagata: niente scheda
  assert.equal(stato({ richiesta: richiesta({ pagamento_stato: null }) }), null);
  assert.equal(stato({}), null);
  // richiesta in attesa pagata (simulato): bloccato
  let s = stato({ richiesta: richiesta({ pagamento_metodo: 'simulato' }) });
  assert.deepEqual([s.chiave, s.importo, s.metodo, s.ricevuta, s.carta], ['bloccato', 20.07, 'simulato', false, null]);
  // con l'ordine: pagato, e la ricevuta c'è (la sandbox ha la sua), segnata "di prova"; quella di rimborso no
  s = stato({ richiesta: richiesta({ stato: 'ordinata', order_id: 97, pagamento_metodo: 'simulato' }) });
  assert.deepEqual([s.chiave, s.ricevuta, s.ricevutaRimborso, s.prova], ['pagato', true, false, true]);
  // ...ma non per un pagamento 'stripe' senza la sua riga (non si sa se è stato incassato), né finché è solo bloccato o se è annullato: come per Stripe
  assert.equal(stato({ richiesta: richiesta({ stato: 'ordinata', order_id: 97, pagamento_metodo: 'stripe' }) }).ricevuta, false);
  assert.deepEqual([stato({ richiesta: richiesta({ pagamento_metodo: 'simulato' }) }).ricevuta, stato({ richiesta: richiesta({ stato: 'nessuna_offerta', pagamento_metodo: 'simulato' }) }).ricevuta], [false, false]);
  assert.equal(s.data.getTime(), new Date(2026, 9, 15, 10, 0).getTime(), 'la data è quella sulla richiesta');
  // una pagina d'ordine passa l'ordine (la richiesta sul pagamento non ha l'order_id): conta lo stesso come ordine nato
  assert.equal(stato({ richiesta: richiesta({ order_id: null }), ordine: { id: 97 } }).chiave, 'pagato');
  // "rimborsato" sulla richiesta: senza ordine è un blocco annullato (nessun addebito), con un ordine un rimborso vero
  const rimborsata = { pagamento_stato: 'rimborsato', rimborsato_il: new Date(2026, 9, 16, 8, 0) };
  s = stato({ richiesta: richiesta({ stato: 'nessuna_offerta', ...rimborsata }) });
  assert.equal(s.chiave, 'annullato');
  assert.equal(s.data.getTime(), new Date(2026, 9, 16, 8, 0).getTime());
  assert.equal(stato({ richiesta: richiesta({ stato: 'annullata', ...rimborsata }) }).chiave, 'annullato');
  assert.equal(stato({ richiesta: richiesta({ stato: 'ordinata', order_id: 97, ...rimborsata }) }).chiave, 'rimborsato');
  // con un ordine, rimborsato: le due ricevute (come per Stripe); senza ordine nessuna
  s = stato({ richiesta: richiesta({ stato: 'ordinata', order_id: 97, pagamento_metodo: 'simulato', ...rimborsata }) });
  assert.deepEqual([s.ricevuta, s.ricevutaRimborso, s.prova], [true, true, true]);
  s = stato({ richiesta: richiesta({ stato: 'nessuna_offerta', pagamento_metodo: 'simulato', ...rimborsata }) });
  assert.deepEqual([s.ricevuta, s.ricevutaRimborso], [false, false]);
  // chiusa senza ordine ma ancora "pagato" (l'aggiornamento non è arrivato): annullato
  assert.equal(stato({ richiesta: richiesta({ stato: 'nessuna_offerta' }) }).chiave, 'annullato');
});

test('statoPagamento: legge la riga di Stripe e, per un ordine, la sua richiesta; salta le letture già fatte dalla pagina', async () => {
  rigaStripe = riga({ stato: 'incassato', incasso_cent: 2007, carta_marca: 'visa', carta_ultime4: '4242' });
  richiestaDb = richiesta({ order_id: 97 });
  // una richiesta (si riconosce da pagamento_stato): una sola lettura, quella della riga
  letture = [];
  let s = await pagamenti.statoPagamento(richiesta({ id: 177, order_id: 97 }));
  assert.equal(s.chiave, 'pagato');
  assert.equal(letture.length, 1);
  assert.deepEqual(letture[0].p, [177]);
  // un ordine (ha request_id): la riga della sua richiesta e la richiesta
  letture = [];
  s = await pagamenti.statoPagamento({ id: 97, request_id: 177, cliente_id: 1 });
  assert.equal(s.chiave, 'pagato');
  assert.deepEqual(letture.map((l) => l.p), [[177], [177]]);
  // con la richiesta e la riga già in mano non si legge niente
  letture = [];
  s = await pagamenti.statoPagamento({ id: 97, request_id: 177 }, { riga: rigaStripe, richiesta: richiestaDb });
  assert.equal(s.chiave, 'pagato');
  assert.equal(letture.length, 0);
  // un ordine senza richiesta (di prima del pagamento in app): niente stato, nessuna lettura
  letture = [];
  assert.equal(await pagamenti.statoPagamento({ id: 5, request_id: null }), null);
  assert.equal(letture.length, 0);
  assert.equal(await pagamenti.statoPagamento(null), null);
  // la riga di Stripe: l'ultima fra quelle che raccontano il destino della carta (con "Rinvia" ce ne sono due)
  letture = [];
  await pagamenti.rigaPagamento(177);
  assert.match(letture[0].s, /WHERE request_id = \? AND stato IN \('autorizzato', 'da_incassare', 'incassato', 'da_rilasciare', 'rilasciato', 'scaduto', 'da_rimborsare', 'rimborsato'\) ORDER BY id DESC LIMIT 1/);
  assert.equal(await pagamenti.rigaPagamento(null), null);
});
