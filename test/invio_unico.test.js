// "Un invio, una richiesta" (src/flusso_cliente.js, nuovaRichiesta): la stessa chiave del carrello dà una richiesta sola,
// comunque si clicchi; per un ordine nuovo serve un invio nuovo (chiave diversa). DB e moduli collegati sono finti:
// nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const utente = { id: 7, ragione_sociale: 'Rossi Impianti', zona: 'Genova', indirizzo_consegna: 'Via Puggia 22/3' };
const dbFinto = {
  prepare: () => ({ get: async () => utente, all: async () => [], run: async () => ({ changes: 0 }) }),
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const pricing = require('../src/pricing');
const richieste = require('../src/richieste');
const flusso = require('../src/flusso_cliente');

pricing.getSpedizioneFissa = async () => 10;
pricing.getOrdineMinimo = async () => 33;
pricing.calcolaOrdine = async () => ({ totale_finale: 100, totale_ivato: 134.2, da_pagare_app: 24.4 });

const righe = [{ prodotto: { id: 1 }, quantita: 2 }];
let create; // richieste "scritte": { id, chiaveInvio }
let chiaviUsate; // l'indice unico (cliente, chiave)

function prepara() {
  create = [];
  chiaviUsate = new Map();
  // Come il DB vero: una pausa fra il controllo e la scrittura (i due invii di un doppio clic arrivano insieme), e
  // l'indice unico che lascia passare una sola scrittura per chiave.
  richieste.creaRichiesta = async (cliente, righeCarrello, opzioni) => {
    await new Promise((r) => setImmediate(r));
    const k = opzioni.chiaveInvio ? cliente.id + ':' + opzioni.chiaveInvio : null;
    if (k && chiaviUsate.has(k)) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const id = 500 + create.length;
    create.push({ id, chiaveInvio: opzioni.chiaveInvio, importo: opzioni.importo, totali: opzioni.totali });
    if (k) chiaviUsate.set(k, id);
    return { requestId: id, candidati: [] };
  };
  richieste.richiestaConChiave = async (clienteId, chiave) => {
    const id = chiaviUsate.get(clienteId + ':' + chiave);
    return id ? { id, stato: 'in_attesa' } : null;
  };
}

test('chiaveInvioValida: lettere, cifre, - e _ da 8 a 64 caratteri; il resto vale "nessuna chiave"', () => {
  assert.equal(flusso.chiaveInvioValida('a1b2c3d4e5f6'), 'a1b2c3d4e5f6');
  assert.equal(flusso.chiaveInvioValida('  abcd-EFGH_12  '), 'abcd-EFGH_12');
  for (const male of [undefined, null, '', 'corta', 'ha spazi dentro', 'x'.repeat(65), 12345678, ['abcdefgh'], "abc'; DROP TABLE x;--"]) {
    assert.equal(flusso.chiaveInvioValida(male), null, String(male));
  }
});

test('doppio clic (due invii insieme con la stessa chiave): parte una richiesta sola e tutti e due vanno a quella', async () => {
  prepara();
  const [a, b] = await Promise.all([
    flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0001' }),
    flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0001' }),
  ]);
  assert.equal(create.length, 1, 'una richiesta sola');
  assert.equal(a, b);
  assert.equal(a, create[0].id);
});

test('la richiesta nasce con i totali del carrello: sono quelli che creaRichiesta salva (consegna pagata in app, materiale da pagare a BOREA)', async () => {
  prepara();
  await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0009' });
  assert.equal(create[0].totali.da_pagare_app, 24.4);
  assert.equal(create[0].importo, 24.4, "l'importo pagato è quello dei totali");
});

test('ritorno con "indietro" sulla stessa pagina: l\'invio già partito riporta alla sua richiesta, anche a carrello vuoto', async () => {
  prepara();
  const primo = await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0002' });
  // il carrello è già vuoto (svuotato dopo il primo invio): niente errore "Nessun materiale", si torna alla richiesta
  const secondo = await flusso.nuovaRichiesta(7, [], { chiaveInvio: 'carrello-0002' });
  assert.equal(secondo, primo);
  assert.equal(create.length, 1);
});

test('un ordine nuovo (chiave nuova dal carrello) parte, anche identico al precedente', async () => {
  prepara();
  const a = await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0003' });
  const b = await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0004' });
  assert.notEqual(a, b);
  assert.equal(create.length, 2);
  assert.deepEqual(create.map((r) => r.chiaveInvio), ['carrello-0003', 'carrello-0004']);
});

test('senza chiave (o con una chiave fuori forma) non c\'è controllo: ogni invio è una richiesta', async () => {
  prepara();
  await flusso.nuovaRichiesta(7, righe);
  await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'no' });
  await flusso.nuovaRichiesta(7, righe, { chiaveInvio: '' });
  assert.equal(create.length, 3);
  assert.deepEqual(create.map((r) => r.chiaveInvio), [null, null, null]);
});

test('un invio che fallisce per altri motivi (minimo, carrello vuoto) non "brucia" la chiave', async () => {
  prepara();
  await assert.rejects(() => flusso.nuovaRichiesta(7, [], { chiaveInvio: 'carrello-0006' }), (e) => e.codice === 'vuota');
  assert.equal(create.length, 0);
  // riprovando con lo stesso carrello (ora pieno) l'ordine parte
  const id = await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0006' });
  assert.equal(id, create[0].id);
});

test('col pagamento Stripe il secondo invio dello stesso carrello si respinge (la sua carta si rilascia), non si "riporta"', async () => {
  prepara();
  const primo = await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0007' });
  await assert.rejects(
    () => flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0007', inCasoDiDuplicato: 'rifiuta' }),
    (e) => e instanceof flusso.ErroreFlusso && e.codice === 'gia_inviata' && e.requestId === primo
  );
  // anche se i due arrivano insieme (stesso sorteggio dell'indice unico)
  prepara();
  const esiti = await Promise.allSettled([
    flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0008', inCasoDiDuplicato: 'rifiuta' }),
    flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0008', inCasoDiDuplicato: 'rifiuta' }),
  ]);
  assert.equal(create.length, 1);
  assert.deepEqual(esiti.map((e) => e.status).sort(), ['fulfilled', 'rejected']);
});

test('la richiesta si paga con quello che si paga in app (servizio + consegna), non con il totale del materiale', async () => {
  prepara();
  await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0002' });
  assert.equal(create.length, 1);
  assert.equal(create[0].importo, 24.4, 'da_pagare_app: il materiale si paga dopo al banco');
  assert.notEqual(create[0].importo, 134.2);
  // con Stripe l'importo autorizzato è quello già scritto, anche se i prezzi si sono mossi
  await flusso.nuovaRichiesta(7, righe, { chiaveInvio: 'carrello-0003', importoPagato: 25.1 });
  assert.equal(create[1].importo, 25.1);
});
