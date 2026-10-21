// Prove di src/stripe_pagamenti.js (e dei punti di aggancio in src/pagamenti.js) con un Stripe finto e un DB in memoria:
// nessuna chiamata di rete, nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_finto';

// ---------------- DB in memoria: solo le istruzioni di pagamenti.js e stripe_pagamenti.js ----------------
const righe = []; // tabella stripe_pagamenti
const richiesteDb = new Map(); // id richiesta -> { pagamento_stato, pagamento_importo }

// Valore di un'espressione di una SET o di un confronto: parametro (?), testo tra apici, numero, NOW(), colonna.
function valore(espressione, riga, params, cursore) {
  const e = espressione.trim();
  if (e === '?') return params[cursore.i++];
  if (/^\?::\w+$/.test(e)) return params[cursore.i++];
  if (e === 'NOW()') return 'ora';
  if (e === 'NULL') return null;
  if (/^'.*'$/.test(e)) return e.slice(1, -1);
  if (/^-?\d+$/.test(e)) return Number(e);
  if (/^\w+ \+ 1$/.test(e)) return riga[e.split(' ')[0]] + 1;
  if (/^LEAST\(importo_cent, \?::int\)$/.test(e)) {
    const v = params[cursore.i++];
    return v === null || v === undefined ? riga.importo_cent : Math.min(riga.importo_cent, v);
  }
  let m = e.match(/^CASE WHEN stato = 'incassato' THEN '(\w+)' ELSE '(\w+)' END$/);
  if (m) return riga.stato === 'incassato' ? m[1] : m[2];
  m = e.match(/^CASE WHEN \? THEN '(\w+)' ELSE stato END$/);
  if (m) return params[cursore.i++] ? m[1] : riga.stato;
  if (e in riga) return riga[e];
  throw new Error('espressione non gestita dal DB finto: ' + e);
}

// Condizioni di una WHERE, separate da AND.
function corrisponde(condizioni, riga, params, cursore) {
  return condizioni.split(' AND ').every((c) => {
    c = c.trim();
    let m = c.match(/^(\w+) IN \((.*)\)$/);
    if (m) return m[2].split(',').map((x) => x.trim().slice(1, -1)).includes(String(riga[m[1]]));
    if (/^aggiornato_il < NOW\(\) - INTERVAL/.test(c)) return riga._vecchia === true;
    m = c.match(/^(\w+) < (\d+)$/);
    if (m) return riga[m[1]] < Number(m[2]);
    m = c.match(/^(\w+) = (.+)$/);
    if (m) return riga[m[1]] === valore(m[2], riga, params, cursore);
    throw new Error('condizione non gestita dal DB finto: ' + c);
  });
}

// "a = ?, b = 'x', c = NOW()" -> [['a','?'], ['b',"'x'"], ...], senza spezzare dentro CASE ... END o parentesi.
function assegnazioni(testo) {
  const pezzi = [];
  let corrente = '';
  let profondita = 0;
  for (const parola of testo.split(/(\s+|,)/)) {
    if (parola === ',' && profondita === 0) { pezzi.push(corrente); corrente = ''; continue; }
    if (/^CASE$/.test(parola)) profondita++;
    if (/^END$/.test(parola)) profondita--;
    profondita += (parola.match(/\(/g) || []).length - (parola.match(/\)/g) || []).length;
    corrente += parola;
  }
  pezzi.push(corrente);
  return pezzi.map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
}

const sqlViste = [];
let guastoColonne = false; // lo schema nuovo non è ancora applicato: ricevuta e carta non si possono scrivere
function esegui(sql, params, modo) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqlViste.push(s);
  if (guastoColonne && /receipt_url|carta_ultime4|incassato_il/.test(s)) throw new Error('column "receipt_url" of relation "stripe_pagamenti" does not exist');
  if (/^SELECT id FROM orders WHERE request_id = \?/.test(s)) return { id: 500 + Number(params[0]) };

  if (/^INSERT INTO stripe_pagamenti/.test(s)) {
    const [cliente_id, tipo, modoRiga, importo_cent, righeJson, destinazione, note, request_id, chiave_invio] = params;
    const r = {
      id: righe.length + 1, cliente_id, tipo, modo: modoRiga, stato: 'da_pagare', payment_intent_id: null,
      importo_cent, incasso_cent: null, righe: righeJson, destinazione, note, request_id, chiave_invio, tentativi: 0, motivo: null, errore: null,
      eta_sec: 0, _vecchia: false,
    };
    righe.push(r);
    return { changes: 1, lastInsertRowid: r.id };
  }

  let m = s.match(/^UPDATE stripe_pagamenti SET (.+) WHERE (.+)$/);
  if (m) {
    const sets = assegnazioni(m[1]);
    // i parametri della SET vengono prima di quelli della WHERE
    const nParamSet = (m[1].match(/\?/g) || []).length;
    let cambiate = 0;
    for (const riga of righe) {
      if (!corrisponde(m[2], riga, params, { i: nParamSet })) continue;
      const cursoreSet = { i: 0 };
      const nuovi = sets.map(([col, esp]) => [col, valore(esp, riga, params, cursoreSet)]);
      for (const [col, v] of nuovi) riga[col] = v === 'ora' ? riga[col] : v;
      cambiate++;
    }
    return { changes: cambiate };
  }

  m = s.match(/^SELECT \*(?:, EXTRACT\(EPOCH FROM \(NOW\(\) - creato_il\)\)::int AS eta_sec)? FROM stripe_pagamenti WHERE (.+?)(?: ORDER BY id)?(?: LIMIT (\d+))?$/);
  if (m) {
    const trovate = righe.filter((riga) => corrisponde(m[1], riga, params, { i: 0 }));
    const lista = m[2] ? trovate.slice(0, Number(m[2])) : trovate;
    return modo === 'get' ? lista[0] || null : lista;
  }

  if (/^UPDATE requests SET pagamento_stato = 'rimborsato'(?:, rimborsato_il = NOW\(\))? WHERE id = \? AND pagamento_stato = 'pagato'/.test(s)) {
    const r = richiesteDb.get(params[0]);
    if (r && r.pagamento_stato === 'pagato') { r.pagamento_stato = 'rimborsato'; return { changes: 1 }; }
    return { changes: 0 };
  }
  if (/^UPDATE requests SET pagamento_importo = \? WHERE id = \?/.test(s)) {
    richiesteDb.get(params[1]).pagamento_importo = params[0];
    return { changes: 1 };
  }
  if (/^SELECT pagamento_stato FROM requests WHERE id = \?/.test(s)) return richiesteDb.get(params[0]) || null;
  if (/^SELECT \* FROM users WHERE id = \?/.test(s)) return { id: params[0], ragione_sociale: 'Rossi Impianti', email: 'info@rossi.it' };
  if (/^SELECT email, telefono FROM users WHERE id = \?/.test(s)) return { email: 'info@rossi.it', telefono: '+39 333 123 4567' };
  // Le filiali attive con i loro orari (flusso.controllaBancoAperto): una sola, senza orari = sempre aperta.
  if (/^SELECT \* FROM distributors WHERE attivo = 1 ORDER BY nome/.test(s)) return [{ id: 1, nome: 'Borea', filiale: 'Fegino', orari: null }];

  throw new Error('SQL non gestito dal DB finto: ' + s.slice(0, 120));
}
const dbFinto = {
  prepare: (sql) => ({
    get: async (...p) => esegui(sql, p, 'get'),
    all: async (...p) => esegui(sql, p, 'all'),
    run: async (...p) => esegui(sql, p, 'run'),
  }),
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const pagamenti = require('../src/pagamenti');
const flusso = require('../src/flusso_cliente');
const richieste = require('../src/richieste');
const stripePagamenti = require('../src/stripe_pagamenti');
// Il giro "subito dopo" (richiediElaborazione) si spegne: nelle prove si chiama elabora() a mano, quando serve.
pagamenti.impostaElaboratore(null);

// ---------------- Stripe finto ----------------
function stripeFinto() {
  const chiamate = [];
  const intenti = new Map();
  let n = 0;
  const finto = {
    chiamate,
    intenti,
    // Il cliente ha pagato nel form: carta autorizzata, importo bloccato.
    paga(intentoId, { importo } = {}) {
      const pi = intenti.get(intentoId);
      pi.status = 'requires_capture';
      if (importo !== undefined) pi.amount = importo;
    },
    paymentIntents: {
      create: async (params, opzioni) => {
        chiamate.push(['create', params, opzioni]);
        const id = 'pi_test_' + ++n;
        const pi = { id, client_secret: id + '_secret_xyz', status: 'requires_payment_method', amount: params.amount, metadata: params.metadata };
        intenti.set(id, pi);
        return { ...pi };
      },
      retrieve: async (id, params) => {
        if (finto.erroreDati && params && params.expand) throw new Error('rete');
        const pi = { ...intenti.get(id) };
        if (params && params.expand && params.expand.includes('latest_charge') && finto.addebito && pi.status === 'succeeded') pi.latest_charge = finto.addebito;
        return pi;
      },
      capture: async (id, params, opzioni) => {
        chiamate.push(['capture', id, params, opzioni]);
        if (finto.fallimenti > 0) { finto.fallimenti--; throw new Error('Stripe non risponde'); }
        intenti.get(id).status = 'succeeded';
        return intenti.get(id);
      },
      cancel: async (id, params, opzioni) => {
        chiamate.push(['cancel', id, params, opzioni]);
        const pi = intenti.get(id);
        if (!['requires_capture', 'requires_payment_method'].includes(pi.status)) throw new Error('stato non valido: ' + pi.status);
        pi.status = 'canceled';
        return pi;
      },
    },
    refunds: {
      create: async (params, opzioni) => {
        chiamate.push(['refund', params, opzioni]);
        return { id: 're_1', status: 'succeeded' };
      },
    },
    webhooks: {
      constructEvent: (corpo, firma, segreto) => {
        if (firma !== 'firma-buona' || segreto !== 'whsec_finto') throw new Error('firma non valida');
        return JSON.parse(String(corpo));
      },
    },
    fallimenti: 0,
  };
  return finto;
}

const cliente = { id: 7, ragione_sociale: 'Rossi Impianti', email: 'info@rossi.it' };
const carrello = [{ prodotto: { id: 1 }, quantita: 2 }, { prodotto: { id: 2 }, quantita: 3 }];

// Stato di partenza di ogni prova + sostituzioni delle parti del flusso che qui non servono.
let stripe;
let richiesteCreate;
let creaRichiesta;
// Quanto si paga in app per una richiesta con i prezzi di OGGI (flusso.totaliRichiestaOggi): "Rinvia richiesta" addebita questo, non quello di prima.
let consegnaDiOggi;
function preparati() {
  righe.length = 0;
  consegnaDiOggi = 66.9;
  flusso.totaliRichiestaOggi = async () => ({ da_pagare_app: consegnaDiOggi });
  richiesteDb.clear();
  richiesteCreate = [];
  stripe = stripeFinto();
  stripePagamenti.impostaStripe(stripe);
  process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
  flusso.validaRichiesta = async () => ({ cliente, totali: { totale_ivato: 66.9, da_pagare_app: 66.9 } });
  flusso.righeDaQuantita = async (voci) => voci.map((v) => ({ prodotto: { id: v.id }, quantita: v.quantita }));
  creaRichiesta = async (clienteId, righeCarrello, opzioni) => {
    const id = 100 + richiesteCreate.length;
    richiesteCreate.push({ id, clienteId, righeCarrello, opzioni });
    richiesteDb.set(id, { pagamento_stato: 'pagato', pagamento_importo: opzioni.importoPagato });
    return id;
  };
  flusso.nuovaRichiesta = (...a) => creaRichiesta(...a);
  // Le richieste già nate da un invio del carrello: chiave -> id (si riempie nelle prove che servono).
  richiesteConChiave.clear();
  richieste.richiestaConChiave = async (clienteId, chiave) => (richiesteConChiave.has(chiave) ? { id: richiesteConChiave.get(chiave), stato: 'in_attesa' } : null);
}
const richiesteConChiave = new Map();

// Il cliente preme "Paga e invia" e paga nel form: ritorna l'id della pagina e del PaymentIntent.
async function avviaEPaga(opzioni = {}) {
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, { destinazione: 'Via Puggia 22/3', note: 'citofono' });
  const riga = righe[id - 1];
  stripe.paga(riga.payment_intent_id, opzioni);
  return { id, intentoId: riga.payment_intent_id, riga };
}

// ---------------- Prove ----------------

test('avviaPagamento: PaymentIntent con carta solo autorizzata, importo del carrello in centesimi, carrello fotografato', async () => {
  preparati();
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, { destinazione: ' Via Puggia 22/3 ', note: 'citofono' });
  assert.equal(id, 1);

  const [, p, opzioni] = stripe.chiamate.find((c) => c[0] === 'create');
  assert.equal(p.amount, 6690);
  assert.equal(p.currency, 'eur');
  assert.equal(p.capture_method, 'manual'); // blocca, non incassa
  assert.deepEqual(p.automatic_payment_methods, { enabled: true }); // i metodi che compaiono li decide il Dashboard
  assert.equal(p.receipt_email, 'info@rossi.it');
  assert.deepEqual(p.metadata, { pagamento_id: '1', cliente_id: '7' });
  assert.equal(opzioni.idempotencyKey, 'pi-test-1');

  // il carrello è fotografato sulla riga: la richiesta nascerà da lì, non da quello che c'è in sessione dopo
  const riga = righe[0];
  assert.equal(riga.stato, 'da_pagare');
  assert.equal(riga.modo, 'test');
  assert.equal(riga.importo_cent, 6690);
  assert.deepEqual(JSON.parse(riga.righe), [{ id: 1, quantita: 2 }, { id: 2, quantita: 3 }]);
  assert.equal(riga.destinazione, 'Via Puggia 22/3');
  assert.equal(riga.payment_intent_id, 'pi_test_1');
  assert.equal(richiesteCreate.length, 0, 'la richiesta non nasce prima del pagamento');
});

test('avviaPagamento: Stripe addebita SOLO "Paghi ora" (corriere + servizio + IVA = 20,07), non il materiale né la spesa complessiva', async () => {
  preparati();
  // i totali come li dà pricing.calcolaOrdine per 54,50 + 10,00 di merce: app.totale 20,07, materiale 78,69, spesa 98,76
  flusso.validaRichiesta = async () => ({ cliente, totali: { totale_ivato: 98.76, da_pagare_app: 20.07, materiale_banco: 78.69 } });
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, { destinazione: 'Via Puggia 22/3' });
  const [, p] = stripe.chiamate.find((c) => c[0] === 'create');
  assert.equal(p.amount, 2007);
  assert.equal(righe[id - 1].importo_cent, 2007);
  // e con i numeri veri del calcolo: lo stesso valore che il carrello mostra come "Totale da pagare ora"
  const pricing = require('../src/pricing');
  const d = pricing.dividiTotale({ netto: 64.5, raee: 0, consegna: 10, servizioPct: 10, ivaPct: 22 });
  assert.equal(Math.round(d.app.totale * 100), p.amount);
});

test('avviaPagamento: se Stripe non risponde la riga è "fallito" e il cliente vede un errore chiaro', async () => {
  preparati();
  stripe.paymentIntents.create = async () => { throw new Error('rete'); };
  const errori = [];
  const log = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await assert.rejects(
      () => stripePagamenti.avviaPagamento(cliente.id, carrello),
      (e) => e instanceof flusso.ErroreFlusso && e.codice === 'pagamento' && /Non è stato addebitato nulla/.test(e.message)
    );
  } finally {
    console.error = log;
  }
  assert.equal(righe[0].stato, 'fallito');
});

test('avviaPagamento: i controlli del flusso (minimo, richiesta già aperta) fermano prima di Stripe', async () => {
  preparati();
  flusso.validaRichiesta = async () => { throw new flusso.ErroreFlusso('ordine_minimo', 'Ordine minimo non raggiunto', 'Ti mancano € 5,00.'); };
  await assert.rejects(() => stripePagamenti.avviaPagamento(cliente.id, carrello), /Ti mancano/);
  assert.equal(stripe.chiamate.length, 0);
  assert.equal(righe.length, 0);
});

test('pagina di pagamento: chiave pubblica, client secret, importo e pezzi; solo per il cliente della riga', async () => {
  preparati();
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, {});
  const pagina = await stripePagamenti.preparaPagina(id, cliente.id);
  assert.deepEqual(pagina, {
    esito: 'pagina',
    chiavePubblica: 'pk_test_finta',
    clientSecret: 'pi_test_1_secret_xyz',
    importoCent: 6690,
    tipo: 'richiesta',
    requestId: null,
    pezzi: 5,
    // Email e telefono dell'account: la pagina non li chiede, li passa lei a Stripe (public/pagamento.js)
    emailCliente: 'info@rossi.it',
    telefonoCliente: '+393331234567',
  });
  assert.equal((await stripePagamenti.preparaPagina(id, 999)).esito, 'annullato'); // un altro cliente
  assert.equal((await stripePagamenti.preparaPagina(12345, cliente.id)).esito, 'annullato');
  assert.equal(richiesteCreate.length, 0);
});

test('contatti per Stripe: email e telefono dell\'account, puliti; se mancano o non sono validi restano vuoti (la pagina lascia il campo a Stripe)', () => {
  const { contattiPerStripe } = stripePagamenti;
  assert.deepEqual(contattiPerStripe({ email: ' info@rossi.it ', telefono: '(+39) 333-123 4567' }), { emailCliente: 'info@rossi.it', telefonoCliente: '+393331234567' });
  assert.deepEqual(contattiPerStripe({ email: 'non-una-mail', telefono: 'abc' }), { emailCliente: '', telefonoCliente: '' });
  assert.deepEqual(contattiPerStripe({ email: '', telefono: '12' }), { emailCliente: '', telefonoCliente: '' });
  assert.deepEqual(contattiPerStripe(null), { emailCliente: '', telefonoCliente: '' });
});

test('pagina di pagamento: senza chiave pubblica non si apre; pagamento annullato o in elaborazione', async () => {
  preparati();
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, {});
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  assert.equal((await stripePagamenti.preparaPagina(id, cliente.id)).esito, 'non_configurato');
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';

  stripe.intenti.get('pi_test_1').status = 'processing';
  assert.equal((await stripePagamenti.preparaPagina(id, cliente.id)).esito, 'in_corso');
  stripe.intenti.get('pi_test_1').status = 'canceled';
  assert.equal((await stripePagamenti.preparaPagina(id, cliente.id)).esito, 'annullato');
});

test('pagina di pagamento: aperta da troppo tempo non si riapre, e il PaymentIntent si annulla', async () => {
  preparati();
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, {});
  righe[0].eta_sec = 75 * 60;
  const esito = await stripePagamenti.preparaPagina(id, cliente.id);
  assert.equal(esito.esito, 'annullato');
  assert.equal(stripe.intenti.get('pi_test_1').status, 'canceled');
  assert.equal(righe[0].stato, 'scaduto');
});

test('pagina di pagamento: se la carta è già autorizzata (pagina ricaricata) la richiesta nasce e si va avanti', async () => {
  preparati();
  const { id } = await avviaEPaga();
  const esito = await stripePagamenti.preparaPagina(id, cliente.id);
  assert.equal(esito.esito, 'ok');
  assert.equal(richiesteCreate.length, 1);
  // ricaricarla di nuovo non ne crea un'altra
  assert.equal((await stripePagamenti.preparaPagina(id, cliente.id)).esito, 'ok');
  assert.equal(richiesteCreate.length, 1);
});

test('ritorno dal pagamento: carta autorizzata -> la richiesta nasce una volta sola, anche con webhook e ritorno insieme', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();

  // il ritorno del cliente e il webhook arrivano nello stesso istante
  const [a, b] = await Promise.all([
    stripePagamenti.esitoRitorno(intentoId, cliente.id),
    stripePagamenti.completaDaIntento(intentoId),
  ]);
  assert.equal(richiesteCreate.length, 1, 'una sola richiesta');
  assert.ok([a, b].filter((x) => x.esito === 'ok').length >= 1);
  assert.ok([a, b].every((x) => x.esito === 'ok' || x.esito === 'in_corso'));

  const creata = richiesteCreate[0];
  assert.equal(creata.opzioni.metodoPagamento, 'stripe');
  assert.equal(creata.opzioni.importoPagato, 66.9); // quanto autorizzato, non un nuovo calcolo
  assert.equal(creata.opzioni.destinazione, 'Via Puggia 22/3');
  assert.equal(creata.opzioni.note, 'citofono');
  assert.deepEqual(creata.righeCarrello.map((r) => [r.prodotto.id, r.quantita]), [[1, 2], [2, 3]]);
  assert.equal(righe[0].stato, 'autorizzato');
  assert.equal(righe[0].request_id, creata.id);

  // chi arriva dopo trova già tutto fatto
  const ancora = await stripePagamenti.esitoRitorno(intentoId, cliente.id);
  assert.deepEqual(ancora, { esito: 'ok', requestId: creata.id, tipo: 'richiesta' });
  assert.equal(richiesteCreate.length, 1);
});

test('ritorno dal pagamento: solo il cliente della riga, e un id strano non fa niente', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  assert.equal((await stripePagamenti.esitoRitorno(intentoId, 999)).esito, 'annullato'); // un altro cliente
  assert.equal((await stripePagamenti.esitoRitorno('../etc', cliente.id)).esito, 'annullato');
  assert.equal((await stripePagamenti.esitoRitorno(undefined, cliente.id)).esito, 'annullato');
  assert.equal(richiesteCreate.length, 0);
});

test('ritorno senza carta autorizzata: si può riprovare; annullato: la riga scade; nessuna richiesta', async () => {
  preparati();
  const id = await stripePagamenti.avviaPagamento(cliente.id, carrello, {});
  assert.deepEqual(await stripePagamenti.esitoRitorno('pi_test_1', cliente.id), { esito: 'da_pagare', id }); // pagamento non riuscito
  assert.equal(righe[0].stato, 'da_pagare');

  stripe.intenti.get('pi_test_1').status = 'canceled';
  assert.equal((await stripePagamenti.esitoRitorno('pi_test_1', cliente.id)).esito, 'annullato');
  assert.equal(righe[0].stato, 'scaduto');
  assert.equal(richiesteCreate.length, 0);
});

test('importo diverso da quello chiesto: la richiesta non nasce e la carta si rilascia', async () => {
  preparati();
  const { intentoId } = await avviaEPaga({ importo: 100 });
  const esito = await stripePagamenti.completaDaIntento(intentoId);
  assert.equal(esito.esito, 'rifiutato');
  assert.equal(richiesteCreate.length, 0);
  assert.equal(righe[0].stato, 'da_rilasciare');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
});

test('richiesta rifiutata dal flusso (minimo non più raggiunto): carta rilasciata e motivo mostrato al cliente', async () => {
  preparati();
  creaRichiesta = async () => { throw new flusso.ErroreFlusso('ordine_minimo', 'Ordine minimo non raggiunto', 'Ti mancano € 3,00 per l\'ordine minimo.'); };
  const { intentoId } = await avviaEPaga();
  const esito = await stripePagamenti.esitoRitorno(intentoId, cliente.id);
  assert.equal(esito.esito, 'rifiutato');
  assert.match(esito.messaggio, /Ti mancano € 3,00 per l'ordine minimo\. Non è stato addebitato nulla\./);
  assert.equal(righe[0].stato, 'da_rilasciare');

  // chi ricarica la pagina vede lo stesso messaggio, non una seconda richiesta
  assert.equal((await stripePagamenti.esitoRitorno(intentoId, cliente.id)).esito, 'rifiutato');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
  assert.equal(richiesteCreate.length, 0);
});

test('guasto imprevisto mentre nasce la richiesta: carta rilasciata, mai incassata', async () => {
  preparati();
  creaRichiesta = async () => { throw new Error('DB irraggiungibile'); };
  const { intentoId } = await avviaEPaga();
  const log = console.error;
  console.error = () => {};
  let esito;
  try { esito = await stripePagamenti.completaDaIntento(intentoId); } finally { console.error = log; }
  assert.equal(esito.esito, 'rifiutato');
  assert.match(esito.messaggio, /Non siamo riusciti a inviare la richiesta\. Non è stato addebitato nulla\./);
  await stripePagamenti.elabora();
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
});

test('richiesta nata già chiusa (nessun banco disponibile): il blocco sulla carta si rilascia', async () => {
  preparati();
  creaRichiesta = async (clienteId, righeCarrello, opzioni) => {
    richiesteDb.set(100, { pagamento_stato: 'rimborsato', pagamento_importo: opzioni.importoPagato });
    return 100;
  };
  const { intentoId } = await avviaEPaga();
  const esito = await stripePagamenti.completaDaIntento(intentoId);
  assert.equal(esito.esito, 'ok'); // la richiesta c'è, chiusa: la pagina lo spiegherà
  assert.equal(righe[0].stato, 'da_rilasciare');
  await stripePagamenti.elabora();
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
});

test('nasce l\'ordine: si incassa il totale dell\'ordine (mai più dell\'autorizzato) e l\'importo pagato si aggiorna', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  const requestId = righe[0].request_id;

  await pagamenti.segnaDaIncassare(requestId, 60.0); // il banco ha applicato uno sconto: 60 € invece di 66,90
  assert.equal(righe[0].stato, 'da_incassare');
  assert.equal(righe[0].incasso_cent, 6000);
  assert.equal(stripe.chiamate.some((c) => c[0] === 'capture'), false, 'la chiamata a Stripe non sta nella transazione');

  await stripePagamenti.elabora();
  const [, id, params, opzioni] = stripe.chiamate.find((c) => c[0] === 'capture');
  assert.equal(id, intentoId);
  assert.deepEqual(params, { amount_to_capture: 6000 });
  assert.equal(opzioni.idempotencyKey, 'cap-1');
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(richiesteDb.get(requestId).pagamento_importo, 60);

  // un secondo giro non incassa di nuovo
  await stripePagamenti.elabora();
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'capture').length, 1);
});

test('incasso: un totale d\'ordine più alto dell\'autorizzato non fa incassare di più', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.segnaDaIncassare(righe[0].request_id, 80);
  assert.equal(righe[0].incasso_cent, 6690);
  await stripePagamenti.elabora();
  assert.deepEqual(stripe.chiamate.find((c) => c[0] === 'capture')[2], { amount_to_capture: 6690 });
  assert.equal(richiesteDb.get(righe[0].request_id).pagamento_importo, 66.9); // intatto
});

test('incasso che non riesce: si riprova al giro dopo, senza perdere niente', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.segnaDaIncassare(righe[0].request_id, 66.9);

  stripe.fallimenti = 1;
  const log = console.error;
  console.error = () => {};
  try { await stripePagamenti.elabora(); } finally { console.error = log; }
  assert.equal(righe[0].stato, 'da_incassare');
  assert.equal(righe[0].tentativi, 1);
  assert.match(righe[0].errore, /Stripe non risponde/);

  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'incassato');
});

test('troppi errori: la riga passa a "da_verificare" e non si riprova all\'infinito', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.segnaDaIncassare(righe[0].request_id, 66.9);
  righe[0].tentativi = 29;
  stripe.fallimenti = 5;
  const log = console.error;
  console.error = () => {};
  try { await stripePagamenti.elabora(); } finally { console.error = log; }
  assert.equal(righe[0].stato, 'da_verificare');
  await stripePagamenti.elabora();
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'capture').length, 1);
});

test('richiesta chiusa senza ordine: il blocco sulla carta si rilascia, nessun incasso né rimborso', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  const requestId = righe[0].request_id;

  assert.equal(await pagamenti.rimborsa(requestId), true);
  assert.equal(richiesteDb.get(requestId).pagamento_stato, 'rimborsato');
  assert.equal(righe[0].stato, 'da_rilasciare');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
  assert.equal(stripe.chiamate.some((c) => c[0] === 'refund' || c[0] === 'capture'), false);

  // chiamarla di nuovo non rilascia due volte
  assert.equal(await pagamenti.rimborsa(requestId), false);
  await stripePagamenti.elabora();
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'cancel').length, 1);
});

test('ordine annullato dopo l\'incasso: si rimborsa quanto incassato', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  const requestId = righe[0].request_id;
  await pagamenti.segnaDaIncassare(requestId, 66.9);
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'incassato');

  await pagamenti.rimborsa(requestId);
  assert.equal(righe[0].stato, 'da_rimborsare');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rimborsato');
  const [, params, opzioni] = stripe.chiamate.find((c) => c[0] === 'refund');
  assert.deepEqual(params, { payment_intent: intentoId });
  assert.equal(opzioni.idempotencyKey, 'ref-1');
});

test('rilascio quando nel frattempo era stata incassata: si passa al rimborso', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.rimborsa(righe[0].request_id); // da_rilasciare
  stripe.intenti.get(intentoId).status = 'succeeded'; // ma un altro giro l'aveva già incassata
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'da_rimborsare');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rimborsato');
});

test('processo caduto fra autorizzazione e richiesta: dopo qualche minuto il blocco si rilascia da solo', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  righe[0].stato = 'in_creazione';
  await stripePagamenti.elabora(); // appena iniziata: si aspetta
  assert.equal(righe[0].stato, 'in_creazione');
  righe[0]._vecchia = true; // passati più di 3 minuti
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
});

test('timer: una carta autorizzata che nessuno ha raccolto (webhook perso, scheda chiusa) fa nascere la richiesta', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  righe[0].eta_sec = 20; // appena pagata: il ritorno del cliente è ancora in corso, si aspetta
  await stripePagamenti.elabora();
  assert.equal(richiesteCreate.length, 0);

  righe[0].eta_sec = 90; // passato più di un minuto e nessuno l'ha raccolta
  await stripePagamenti.elabora();
  assert.equal(richiesteCreate.length, 1);
  assert.equal(righe[0].stato, 'autorizzato');
  assert.equal(stripe.intenti.get(intentoId).status, 'requires_capture');

  await stripePagamenti.elabora(); // un secondo giro non ne crea altre
  assert.equal(richiesteCreate.length, 1);
});

test('timer: i pagamenti abbandonati si chiudono (PaymentIntent annullato) solo dopo il tempo; i recenti restano', async () => {
  preparati();
  await stripePagamenti.avviaPagamento(cliente.id, carrello, {});
  righe[0].eta_sec = 30 * 60; // aperta da mezz'ora: il cliente può ancora pagare
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'da_pagare');
  assert.equal(stripe.chiamate.some((c) => c[0] === 'cancel'), false);

  righe[0].eta_sec = 75 * 60;
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'scaduto');
  assert.equal(stripe.intenti.get('pi_test_1').status, 'canceled');
});

test('pagamento arrivato troppo tardi: niente richiesta, carta rilasciata', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  righe[0].eta_sec = 100 * 60;
  const esito = await stripePagamenti.completaDaIntento(intentoId);
  assert.equal(esito.esito, 'rifiutato');
  assert.equal(richiesteCreate.length, 0);
  await stripePagamenti.elabora();
  assert.equal(stripe.intenti.get(intentoId).status, 'canceled');
});

test('Rinvia richiesta: si paga di nuovo la consegna di OGGI e la STESSA richiesta si riapre con pagamento Stripe', async () => {
  preparati();
  consegnaDiOggi = 20.07; // la richiesta era stata pagata 66,90 (vecchio modello): rinviando si paga la consegna ricalcolata
  const chiusa = { id: 55, cliente_id: cliente.id, stato: 'nessuna_offerta', pagamento_importo: 66.9 };
  richiesteDb.set(55, { pagamento_stato: 'rimborsato', pagamento_importo: 66.9 });
  richieste.getRichiesta = async () => chiusa;
  const riaperture = [];
  richieste.reinviaRichiesta = async (id, opzioni) => {
    riaperture.push([id, opzioni]);
    richiesteDb.get(id).pagamento_stato = 'pagato'; // come fa pagamenti.incassaDiNuovo
    return id;
  };

  const id = await stripePagamenti.avviaPagamentoReinvio(cliente.id, chiusa);
  const [, p] = stripe.chiamate.find((c) => c[0] === 'create');
  assert.equal(p.amount, 2007);
  assert.equal(righe[0].importo_cent, 2007);
  assert.equal(righe[0].tipo, 'reinvio');
  assert.equal(righe[0].request_id, 55);

  const pagina = await stripePagamenti.preparaPagina(id, cliente.id);
  assert.equal(pagina.esito, 'pagina');
  assert.equal(pagina.tipo, 'reinvio');
  assert.equal(pagina.requestId, 55);

  assert.deepEqual(await stripePagamenti.esitoRitorno('pi_test_1', cliente.id), { esito: 'da_pagare', id }); // non ha ancora pagato
  stripe.paga('pi_test_1');
  const esito = await stripePagamenti.esitoRitorno('pi_test_1', cliente.id);
  assert.deepEqual(esito, { esito: 'ok', requestId: 55, tipo: 'reinvio' });
  // la richiesta torna a segnare come pagato quanto è stato autorizzato
  assert.deepEqual(riaperture, [[55, { metodoPagamento: 'stripe', importo: 20.07 }]]);
  assert.equal(richiesteCreate.length, 0, 'nessuna richiesta nuova');
  assert.equal(righe[0].stato, 'autorizzato');
});

test('Rinvia richiesta: non per quella di un altro, non se non è chiusa; con altre richieste aperte invece sì', async () => {
  preparati();
  const base = { id: 55, cliente_id: cliente.id, stato: 'nessuna_offerta', pagamento_importo: 66.9 };
  await assert.rejects(() => stripePagamenti.avviaPagamentoReinvio(cliente.id, { ...base, cliente_id: 8 }), /non si può più rinviare/);
  await assert.rejects(() => stripePagamenti.avviaPagamentoReinvio(cliente.id, { ...base, stato: 'in_attesa' }), /non si può più rinviare/);
  // niente da pagare (nessuna riga, consegna a zero): non si rinvia, si invia una richiesta nuova dal carrello
  consegnaDiOggi = 0;
  await assert.rejects(() => stripePagamenti.avviaPagamentoReinvio(cliente.id, base), /nuova richiesta dal carrello/);
  consegnaDiOggi = 66.9;
  assert.equal(righe.length, 0);
  // Non c'è più il limite di una richiesta aperta alla volta: il pagamento parte anche con altre in attesa.
  await stripePagamenti.avviaPagamentoReinvio(cliente.id, base);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].tipo, 'reinvio');
});

test('webhook: firma verificata, carta autorizzata e annullata, eventi dell\'altro modo ignorati', async () => {
  preparati();
  const corpo = Buffer.from('{"type":"x"}');
  assert.throws(() => stripePagamenti.leggiEvento(corpo, 'firma-sbagliata'), /firma/);
  assert.equal(stripePagamenti.leggiEvento(corpo, 'firma-buona').type, 'x');

  // carta autorizzata: fa nascere la richiesta
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.gestisciEvento({ type: 'payment_intent.amount_capturable_updated', livemode: false, data: { object: { id: intentoId } } });
  assert.equal(richiesteCreate.length, 1);

  // dell'altro modo (produzione): ignorato
  const seconda = await avviaEPaga();
  await stripePagamenti.gestisciEvento({ type: 'payment_intent.amount_capturable_updated', livemode: true, data: { object: { id: seconda.intentoId } } });
  assert.equal(richiesteCreate.length, 1);
  assert.equal(righe[1].stato, 'da_pagare');

  // annullato: la riga si chiude
  await stripePagamenti.gestisciEvento({ type: 'payment_intent.canceled', livemode: false, data: { object: { id: seconda.intentoId } } });
  assert.equal(righe[1].stato, 'scaduto');

  // un PaymentIntent sconosciuto o un evento che non ci riguarda non fanno niente
  await stripePagamenti.gestisciEvento({ type: 'payment_intent.amount_capturable_updated', livemode: false, data: { object: { id: 'pi_di_altri' } } });
  await stripePagamenti.gestisciEvento({ type: 'charge.succeeded', livemode: false, data: { object: { id: 'ch_1' } } });
  assert.equal(richiesteCreate.length, 1);
});

test('elabora lavora solo le righe del proprio modo (test/produzione)', async () => {
  preparati();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.rimborsa(righe[0].request_id);
  righe[0].modo = 'live'; // una riga di produzione, vista da un'istanza con la chiave di prova
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'da_rilasciare');
  assert.equal(stripe.chiamate.some((c) => c[0] === 'cancel'), false);

  process.env.STRIPE_SECRET_KEY = 'sk_live_finta'; // ora l'istanza è quella di produzione
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
});

test('configurazione: avvisi per chiave pubblica mancante, modi diversi e webhook mancante', () => {
  preparati();
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []);
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  assert.match(stripePagamenti.controllaConfigurazione().join(' '), /STRIPE_PUBLISHABLE_KEY \(o STRIPE_PUBLIC_KEY\) manca/);
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_finta';
  assert.match(stripePagamenti.controllaConfigurazione().join(' '), /modi diversi/);
  // senza senso (né prefisso né forma di una chiave): non è valida, e la pagina non si apre
  process.env.STRIPE_PUBLISHABLE_KEY = 'abc';
  assert.match(stripePagamenti.controllaConfigurazione().join(' '), /non è valida: deve iniziare con pk_test_/);
  assert.equal(stripePagamenti.chiavePubblica(), '');
  // incollata senza il prefisso (come capita copiando dal Dashboard): lo si ricava dalla chiave segreta, con un avviso
  const senzaPrefisso = '51UQUmxVfinta' + 'x'.repeat(60);
  process.env.STRIPE_PUBLISHABLE_KEY = senzaPrefisso;
  assert.equal(stripePagamenti.chiavePubblica(), 'pk_test_' + senzaPrefisso);
  assert.match(stripePagamenti.controllaConfigurazione().join(' '), /senza prefisso: l'ho completata io con pk_test_/);
  process.env.STRIPE_SECRET_KEY = 'sk_live_finta'; // con una chiave segreta reale il prefisso diventa pk_live_
  assert.equal(stripePagamenti.chiavePubblica(), 'pk_live_' + senzaPrefisso);
  process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
  // il nome alternativo STRIPE_PUBLIC_KEY vale quanto STRIPE_PUBLISHABLE_KEY
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  process.env.STRIPE_PUBLIC_KEY = 'pk_test_finta';
  assert.equal(stripePagamenti.chiavePubblica(), 'pk_test_finta');
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []);
  delete process.env.STRIPE_PUBLIC_KEY;
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.match(stripePagamenti.controllaConfigurazione().join(' '), /segreto del webhook \(STRIPE_TEST_WEBHOOK_SECRET, o STRIPE_WEBHOOK_SECRET\) manca/);
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_finto';
  delete process.env.STRIPE_SECRET_KEY;
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []); // Stripe spento: niente da dire
});

test('senza chiave Stripe tutto resta simulato: nessuna query sui pagamenti Stripe', async () => {
  preparati();
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(stripePagamenti.attivo(), false);
  richiesteDb.set(9, { pagamento_stato: 'pagato' });
  sqlViste.length = 0;
  assert.equal(await pagamenti.rimborsa(9), true);
  await pagamenti.segnaDaIncassare(9, 10);
  await stripePagamenti.elabora();
  assert.equal(sqlViste.some((q) => /stripe_pagamenti/.test(q)), false);
  assert.deepEqual(pagamenti.incassoSimulato(10), { stato: 'pagato', metodo: 'simulato', importo: 10 });
  assert.deepEqual(pagamenti.incasso(10, 'stripe'), { stato: 'pagato', metodo: 'stripe', importo: 10 });
});

// ---------------- Un invio, una richiesta ----------------

test('stesso invio cliccato due volte: la seconda volta riporta alla stessa pagina di pagamento, senza un secondo PaymentIntent', async () => {
  preparati();
  const opz = { destinazione: 'Via Puggia 22/3', note: '', chiaveInvio: 'carrello-aaaa1111' };
  const primo = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  const secondo = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  assert.equal(secondo, primo);
  assert.equal(righe.length, 1, 'una riga sola');
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'create').length, 1, 'un PaymentIntent solo');
  assert.equal(righe[0].chiave_invio, 'carrello-aaaa1111', 'la chiave resta sulla riga');

  // un invio nuovo (chiave nuova) apre un pagamento nuovo, anche per lo stesso carrello
  const terzo = await stripePagamenti.avviaPagamento(cliente.id, carrello, { ...opz, chiaveInvio: 'carrello-bbbb2222' });
  assert.notEqual(terzo, primo);
  assert.equal(righe.length, 2);
});

test('invio già diventato richiesta: niente nuovo pagamento, si porta il cliente alla sua richiesta', async () => {
  preparati();
  richiesteConChiave.set('carrello-cccc3333', 91);
  await assert.rejects(
    () => stripePagamenti.avviaPagamento(cliente.id, carrello, { destinazione: 'Via Puggia 22/3', chiaveInvio: 'carrello-cccc3333' }),
    (e) => e instanceof flusso.ErroreFlusso && e.codice === 'gia_inviata' && e.requestId === 91
  );
  assert.equal(righe.length, 0);
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'create').length, 0);
});

test('un pagamento dello stesso invio non più da fare (scaduto) non si riusa: se ne apre uno nuovo', async () => {
  preparati();
  const opz = { destinazione: 'Via Puggia 22/3', chiaveInvio: 'carrello-dddd4444' };
  const primo = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  righe[0].stato = 'scaduto';
  const secondo = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  assert.notEqual(secondo, primo);
  assert.equal(righe.length, 2);
});

test('seconda carta dello stesso invio (due schede): la richiesta nasce una volta, la seconda carta si rilascia senza addebito', async () => {
  preparati();
  const opz = { destinazione: 'Via Puggia 22/3', note: '', chiaveInvio: 'carrello-eeee5555' };
  // due pagamenti aperti per lo stesso invio (due schede del browser, prima che uno dei due fosse pagato)
  const idA = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  righe[0].stato = 'scaduto'; // così avviaPagamento non riusa il primo e apre il secondo come due schede aperte insieme
  const idB = await stripePagamenti.avviaPagamento(cliente.id, carrello, opz);
  righe[0].stato = 'da_pagare';
  const a = righe[idA - 1];
  const b = righe[idB - 1];
  stripe.paga(a.payment_intent_id, {});
  stripe.paga(b.payment_intent_id, {});

  // il flusso lascia passare la prima e respinge la seconda, come fa l'indice unico del DB
  let nata = null;
  creaRichiesta = async (clienteId, righeCarrello, opzioni) => {
    assert.equal(opzioni.chiaveInvio, 'carrello-eeee5555', 'la chiave arriva al flusso');
    assert.equal(opzioni.inCasoDiDuplicato, 'rifiuta', 'una seconda carta non si "riporta": si respinge');
    if (nata) throw new flusso.ErroreFlusso('gia_inviata', 'Ordine già inviato', 'Questo ordine è già stato inviato: non ne parte un altro.', { requestId: nata });
    nata = 100 + richiesteCreate.length;
    richiesteCreate.push({ id: nata, clienteId, righeCarrello, opzioni });
    richiesteDb.set(nata, { pagamento_stato: 'pagato', pagamento_importo: opzioni.importoPagato });
    return nata;
  };
  const esitoA = await stripePagamenti.esitoRitorno(a.payment_intent_id, cliente.id);
  const esitoB = await stripePagamenti.esitoRitorno(b.payment_intent_id, cliente.id);
  assert.equal(esitoA.esito, 'ok');
  assert.equal(esitoB.esito, 'rifiutato');
  assert.match(esitoB.messaggio, /già stato inviato.*Non è stato addebitato nulla\./);
  assert.equal(richiesteCreate.length, 1, 'una richiesta sola');
  assert.equal(b.stato, 'da_rilasciare');
  await stripePagamenti.elabora();
  assert.equal(stripe.intenti.get(b.payment_intent_id).status, 'canceled', 'la seconda carta è rilasciata');
});

// ---------------- Bypass locale del pagamento ----------------

test('PAGAMENTO_SIMULATO: salta Stripe solo con chiave di prova e fuori da NODE_ENV=production; sulla VPS non vale mai', () => {
  const nomi = ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'PAGAMENTO_SIMULATO', 'PAGAMENTO_SIMULATO_FORZA', 'NODE_ENV'];
  const salvati = Object.fromEntries(nomi.map((n) => [n, process.env[n]]));
  const imposta = (v) => nomi.forEach((n) => (v[n] === undefined ? delete process.env[n] : (process.env[n] = v[n])));
  const avviso = () => stripePagamenti.controllaConfigurazione().find((a) => /PAGAMENTO_SIMULATO/.test(a));
  try {
    const prova = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PUBLISHABLE_KEY: 'pk_test_x' };

    imposta(prova);
    assert.equal(pagamenti.pagaConStripe(), true, 'senza la riga: Stripe');
    assert.equal(avviso(), undefined);

    imposta({ ...prova, PAGAMENTO_SIMULATO: '1' });
    assert.equal(pagamenti.pagaConStripe(), false, 'PC di sviluppo: pagamento simulato');
    assert.equal(stripePagamenti.pagaConStripe(), false);
    assert.equal(pagamenti.stripeAttivo(), true, 'gli incassi e i rilasci dei pagamenti già fatti restano attivi');
    assert.match(avviso(), /salta Stripe.*sulla VPS quella riga non deve esserci/);

    imposta({ ...prova, PAGAMENTO_SIMULATO: '1', NODE_ENV: 'production' });
    assert.equal(pagamenti.pagaConStripe(), true, 'NODE_ENV=production: ignorata');
    assert.match(avviso(), /ignorata/);

    imposta({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x', PAGAMENTO_SIMULATO: '1' });
    assert.equal(pagamenti.pagaConStripe(), true, 'chiave reale: ignorata');
    assert.match(avviso(), /ignorata/);

    // la VPS può accenderlo di proposito: servono PAGAMENTO_SIMULATO=1 E PAGAMENTO_SIMULATO_FORZA=1
    imposta({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x', NODE_ENV: 'production', PAGAMENTO_SIMULATO: '1', PAGAMENTO_SIMULATO_FORZA: '1' });
    assert.equal(pagamenti.pagaConStripe(), false, 'con FORZA anche chiave reale e produzione saltano Stripe');
    assert.equal(stripePagamenti.pagaConStripe(), false);
    assert.equal(pagamenti.stripeAttivo(), true, 'incassi e rimborsi dei pagamenti già fatti restano attivi');
    assert.match(avviso(), /ATTENZIONE.*senza pagare/);
    imposta({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_PUBLISHABLE_KEY: 'pk_live_x', NODE_ENV: 'production', PAGAMENTO_SIMULATO_FORZA: '1' });
    assert.equal(pagamenti.pagaConStripe(), true, 'FORZA da sola non basta');

    for (const valore of ['0', 'false', '', 'no']) {
      imposta({ ...prova, PAGAMENTO_SIMULATO: valore });
      assert.equal(pagamenti.pagaConStripe(), true, 'PAGAMENTO_SIMULATO=' + valore);
    }

    // senza chiave Stripe non c'è niente da saltare: resta tutto simulato come prima
    imposta({ PAGAMENTO_SIMULATO: '1' });
    assert.equal(pagamenti.pagaConStripe(), false);
    assert.equal(pagamenti.stripeAttivo(), false);
  } finally {
    imposta(salvati);
  }
});

// ---------------- Ricevuta, carta ed email all'incasso ----------------
// Dopo l'incasso (la capture non cambia: stessi parametri e stessa chiave) si salvano ricevuta di Stripe, marca e ultime 4 cifre della carta e
// l'istante; poi si assegna il numero della ricevuta nostra e parte l'email. Tutto "best effort": niente può far fallire né ripetere l'incasso.
const ricevuteChiamate = [];
const emailInviate = [];
const ricevute = require('../src/ricevute');
const email = require('../src/email');
function preparaRicevute() {
  ricevuteChiamate.length = 0;
  emailInviate.length = 0;
  guastoColonne = false;
  ricevute.datiRicevuta = async (ordineId, opzioni) => {
    ricevuteChiamate.push([ordineId, opzioni]);
    return { ordineId, numero: 'R-2026-000001', cliente: { email: 'info@rossi.it' } };
  };
  email.inviaPagamentoRicevuto = async (dati) => {
    emailInviate.push(dati);
    return { inviata: true };
  };
}
async function incassa(importo = 66.9) {
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  await pagamenti.segnaDaIncassare(righe[0].request_id, importo);
  return intentoId;
}
const senzaLog = async (f) => {
  const log = console.error;
  console.error = () => {};
  try { return await f(); } finally { console.error = log; }
};

test('incasso: si salvano ricevuta di Stripe, marca e ultime 4 cifre della carta e l\'istante; poi ricevuta numerata ed email, UNA volta sola', async () => {
  preparati();
  preparaRicevute();
  stripe.addebito = { receipt_url: 'https://pay.stripe.com/receipts/r_1', payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } };
  const intentoId = await incassa();
  const requestId = righe[0].request_id;
  await stripePagamenti.elabora();

  assert.equal(righe[0].stato, 'incassato');
  assert.deepEqual([righe[0].receipt_url, righe[0].carta_marca, righe[0].carta_ultime4], ['https://pay.stripe.com/receipts/r_1', 'visa', '4242']);
  assert.ok(sqlViste.some((q) => /^UPDATE stripe_pagamenti SET receipt_url = \?, carta_marca = \?, carta_ultime4 = \?, incassato_il = NOW\(\) WHERE id = \?/.test(q)), "l'istante dell'incasso si scrive con NOW()");
  // la capture è quella di prima: stessi parametri e stessa chiave di idempotenza (nessun `expand`, che con la stessa chiave darebbe un errore di Stripe)
  const capture = stripe.chiamate.find((c) => c[0] === 'capture');
  assert.equal(capture[1], intentoId);
  assert.deepEqual(capture[2], { amount_to_capture: 6690 });
  assert.equal(capture[3].idempotencyKey, 'cap-1');
  // numero di ricevuta (all'ordine di quella richiesta) ed email al cliente
  assert.deepEqual(ricevuteChiamate, [[500 + requestId, { tipo: 'pagamento' }]]);
  assert.equal(emailInviate.length, 1);
  assert.equal(emailInviate[0].numero, 'R-2026-000001');

  // un secondo giro non rifà niente: né incasso, né ricevuta, né una seconda email
  await stripePagamenti.elabora();
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'capture').length, 1);
  assert.equal(ricevuteChiamate.length, 1);
  assert.equal(emailInviate.length, 1);
});

test('incasso con un pagamento non a carta (nessun dettaglio della carta): la riga si incassa lo stesso, senza marca né cifre', async () => {
  preparati();
  preparaRicevute();
  stripe.addebito = { receipt_url: 'https://pay.stripe.com/receipts/r_2', payment_method_details: { type: 'link' } };
  await incassa();
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(righe[0].receipt_url, 'https://pay.stripe.com/receipts/r_2');
  assert.equal(righe[0].carta_marca, null);
  assert.equal(righe[0].carta_ultime4, null);
});

test('incasso: se i dati della carta non si leggono, o lo schema non è aggiornato, o la ricevuta o l\'email vanno male, l\'incasso resta fatto e non si ripete', async () => {
  // 1) Stripe non risponde alla lettura dei dati della carta (l'incasso invece è andato)
  preparati();
  preparaRicevute();
  stripe.addebito = { receipt_url: 'x', payment_method_details: { card: { brand: 'visa', last4: '4242' } } };
  stripe.erroreDati = true;
  await incassa();
  await senzaLog(() => stripePagamenti.elabora());
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(righe[0].tentativi, 0, 'non è un tentativo fallito: l\'incasso è riuscito');
  assert.equal(righe[0].carta_ultime4, null);
  assert.equal(ricevuteChiamate.length, 1, 'la ricevuta nostra si prepara lo stesso');

  // 2) lo schema nuovo non è ancora applicato (colonne mancanti): la UPDATE dei dati fallisce, l'incasso no
  preparati();
  preparaRicevute();
  guastoColonne = true;
  await incassa();
  await senzaLog(() => stripePagamenti.elabora());
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(righe[0].tentativi, 0);
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'capture').length, 1);
  guastoColonne = false;

  // 3) la ricevuta non si prepara (tabella mancante, errore): nessuna email, l'incasso resta
  preparati();
  preparaRicevute();
  ricevute.datiRicevuta = async () => { throw new Error('tabella ricevute mancante'); };
  await incassa();
  await senzaLog(() => stripePagamenti.elabora());
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(righe[0].tentativi, 0);
  assert.equal(emailInviate.length, 0);

  // 4) niente da mandare (nessun incasso vero da ricevuta): nessuna email e nessun errore
  preparati();
  preparaRicevute();
  ricevute.datiRicevuta = async () => null;
  await incassa();
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(emailInviate.length, 0);

  // 5) l'invio dell'email fallisce con un errore: non viene aspettato e non rompe il giro
  preparati();
  preparaRicevute();
  email.inviaPagamentoRicevuto = async () => { throw new Error('SMTP giù'); };
  await incassa();
  const rifiuti = [];
  const gestore = (e) => rifiuti.push(e);
  process.on('unhandledRejection', gestore);
  await senzaLog(() => stripePagamenti.elabora());
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', gestore);
  assert.equal(righe[0].stato, 'incassato');
  assert.equal(righe[0].tentativi, 0);
  // (inviaPagamentoRicevuto vero non lancia mai: qui il finto sì, per provare che nemmeno così un errore sfugge al giro dei pagamenti)
  assert.deepEqual(rifiuti, [], 'nessuna promessa rifiutata senza chi la raccolga');
});

test('blocco rilasciato (richiesta annullata o senza risposta): nessuna ricevuta, nessuna email, nessun rimborso', async () => {
  preparati();
  preparaRicevute();
  const { intentoId } = await avviaEPaga();
  await stripePagamenti.completaDaIntento(intentoId);
  const requestId = righe[0].request_id;
  assert.equal(await pagamenti.rimborsa(requestId), true);
  assert.equal(righe[0].stato, 'da_rilasciare');
  await stripePagamenti.elabora();
  assert.equal(righe[0].stato, 'rilasciato');
  assert.equal(stripe.chiamate.some((c) => c[0] === 'capture' || c[0] === 'refund'), false, 'mai incassato, mai rimborsato');
  assert.equal(stripe.chiamate.filter((c) => c[0] === 'cancel').length, 1);
  assert.equal(ricevuteChiamate.length, 0);
  assert.equal(emailInviate.length, 0);
});
