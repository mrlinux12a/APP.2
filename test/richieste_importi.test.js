// Prove degli importi salvati sulla richiesta (consegna pagata in app / materiale da pagare a BOREA): cosa scrive creaRichiesta alla nascita, cosa
// riscrive "Rinvia richiesta" (la consegna ricalcolata con i prezzi di oggi) e il rimborso con la sua data. DB finto che tiene le query:
// nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const config = { servizio_pct: '10', iva_pct: '22', spedizione_fissa: '10', ordine_minimo: '33', finestra_conferma_min: '10' };
const chiamate = []; // { s, p, modo }
let richiestaDb = null; // la riga di requests che "esiste"
let righeDb = []; // request_items + prodotto
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = async (modo, p) => {
      chiamate.push({ s, p, modo });
      if (/FROM config WHERE chiave/.test(s)) return config[p[0]] !== undefined ? [{ valore: config[p[0]] }] : [];
      if (/^SELECT \* FROM requests WHERE id = \?/.test(s)) return richiestaDb ? [richiestaDb] : [];
      if (/FROM request_items ri JOIN products p/.test(s)) return righeDb;
      if (/^SELECT \* FROM distributors WHERE attivo = 1/.test(s)) return [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino' }];
      if (/FROM request_responses rr/.test(s)) return [];
      if (/^SELECT id FROM users WHERE distributor_id/.test(s)) return [];
      if (/^UPDATE requests SET pagamento_stato = 'rimborsato'/.test(s)) return { changes: 1 };
      if (modo === 'run') return { changes: 1, lastInsertRowid: 321 };
      return [];
    };
    return {
      all: (...p) => esegui('all', p),
      get: async (...p) => (await esegui('get', p))[0] || null,
      run: (...p) => esegui('run', p),
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const pricing = require('../src/pricing');
const pagamenti = require('../src/pagamenti');
const richieste = require('../src/richieste');

const prodotto = (id, listino) => ({ id, codice: 'C' + id, nome: 'P' + id, prezzo_listino: listino, sconto_base_pct: 0, raee: 0 });
const righeCarrello = [{ prodotto: prodotto(1, 54.5), quantita: 1 }, { prodotto: prodotto(2, 10), quantita: 1 }];
const riga = (id, listino) => ({ request_id: 55, product_id: id, quantita: 1, codice: 'C' + id, nome: 'P' + id, categoria: 'X', prezzo_listino: listino, sconto_base_pct: 0, raee: 0 });
const inserimento = () => chiamate.find((c) => /^INSERT INTO requests/.test(c.s));
const aggiornamento = (re) => chiamate.find((c) => re.test(c.s));
const prepara = () => { chiamate.length = 0; richiestaDb = null; righeDb = []; };

test('creaRichiesta: salva gli importi divisi (consegna e materiale) dai totali del carrello, accanto al pagamento', async () => {
  prepara();
  const totali = await pricing.calcolaOrdine(righeCarrello, { costoConsegna: 10 });
  const { requestId } = await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, {
    destinazione: 'Via Puggia 22/3', importo: totali.da_pagare_app, totali,
  });
  assert.equal(requestId, 321);
  const ins = inserimento();
  assert.ok(ins, 'INSERT INTO requests');
  // le colonne nuove, nell'ordine: corriere, servizio, iva_app, da_pagare_app, merce_banco, raee_banco, iva_banco, materiale_banco
  assert.match(ins.s, /corriere, servizio, iva_app, da_pagare_app, merce_banco, raee_banco, iva_banco, materiale_banco\)/);
  assert.deepEqual(ins.p.slice(-8), [10, 6.45, 3.62, 20.07, 64.5, 0, 14.19, 78.69]);
  assert.equal(ins.p[8], 20.07, 'pagamento_importo: quello addebitato');
  // placeholders e valori tornano: 10 parametri di prima + 8 nuovi
  assert.equal((ins.s.match(/\?/g) || []).length, ins.p.length);
  // richiesta in attesa: non è rimborsata, quindi niente data di rimborso
  assert.match(ins.s, /NOW\(\), NULL, \?/);
});

test('creaRichiesta senza `totali` (script, prove): le colonne restano a 0 e le pagine ricalcolano', async () => {
  prepara();
  await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, { importo: 20.07 });
  assert.deepEqual(inserimento().p.slice(-8), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('"Rinvia richiesta": la consegna si ricalcola con i prezzi di OGGI e si riscrive, insieme agli importi salvati e al pagamento', async () => {
  prepara();
  richiestaDb = { id: 55, cliente_id: 1, stato: 'nessuna_offerta', pagamento_stato: 'rimborsato', pagamento_importo: 66.9 };
  righeDb = [riga(1, 104.5), riga(2, 10)]; // l'articolo costa di più di quando è stata pagata: merce 114,50
  await richieste.reinviaRichiesta(55);
  const su = aggiornamento(/^UPDATE requests SET stato = 'in_attesa'/);
  assert.ok(su, 'la richiesta si riapre');
  assert.match(su.s, /corriere = \?, servizio = \?, iva_app = \?, da_pagare_app = \?, merce_banco = \?, raee_banco = \?, iva_banco = \?, materiale_banco = \?/);
  // 10 + 11,45 di servizio = 21,45 + IVA 4,72 = 26,17; materiale 114,50 + IVA 25,19 = 139,69
  assert.deepEqual(su.p.slice(1, 9), [10, 11.45, 4.72, 26.17, 114.5, 0, 25.19, 139.69]);
  const incasso = aggiornamento(/^UPDATE requests SET pagamento_stato = 'pagato'/);
  assert.ok(incasso, 'si addebita di nuovo');
  assert.match(incasso.s, /rimborsato_il = NULL/);
  assert.deepEqual(incasso.p, ['simulato', 26.17, 55], 'metodo, importo ricalcolato, richiesta');
});

test('"Rinvia richiesta" con Stripe: la richiesta torna a segnare come pagato quanto è stato autorizzato', async () => {
  prepara();
  richiestaDb = { id: 55, cliente_id: 1, stato: 'nessuna_offerta', pagamento_stato: 'rimborsato', pagamento_importo: 66.9 };
  righeDb = [riga(1, 54.5), riga(2, 10)];
  await richieste.reinviaRichiesta(55, { metodoPagamento: 'stripe', importo: 20.07 });
  assert.deepEqual(aggiornamento(/^UPDATE requests SET pagamento_stato = 'pagato'/).p, ['stripe', 20.07, 55]);
  // una richiesta non chiusa non si riapre
  prepara();
  richiestaDb = { id: 55, cliente_id: 1, stato: 'in_attesa' };
  assert.equal(await richieste.reinviaRichiesta(55), null);
  assert.equal(aggiornamento(/^UPDATE requests SET stato = 'in_attesa'/), undefined);
});

test('rimborso: scrive anche QUANDO è stato rimborsato (rimborsato_il), per "Rimborsata il …"', async () => {
  prepara();
  assert.equal(await pagamenti.rimborsa(55), true);
  const su = aggiornamento(/^UPDATE requests SET pagamento_stato = 'rimborsato'/);
  assert.match(su.s, /rimborsato_il = NOW\(\)/);
  assert.match(su.s, /AND pagamento_stato = 'pagato'/, 'solo la prima volta');
});

// ---- pricing: importiRichiesta / importi / calcolaDaRigheDb

const richiestaSalvata = (extra = {}) => ({
  corriere: 10, servizio: 6.45, iva_app: 3.62, da_pagare_app: 20.07, merce_banco: 64.5, raee_banco: 0, iva_banco: 14.19, materiale_banco: 78.69,
  stato: 'in_attesa', pagamento_stato: 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: '2026-10-17T09:00:00Z', rimborsato_il: null,
  scade_il: '2026-10-17T09:10:00Z', ...extra,
});
const richiestaVecchia = (extra = {}) => richiestaSalvata({
  corriere: 0, servizio: 0, iva_app: 0, da_pagare_app: 0, merce_banco: 0, raee_banco: 0, iva_banco: 0, materiale_banco: 0, ...extra,
});

test('importiRichiesta, richiesta NUOVA: le colonne salvate (54,50 + 10,00 -> 20,07 in app, 78,69 al banco)', () => {
  const i = pricing.importiRichiesta(richiestaSalvata());
  assert.deepEqual(i.app, {
    corriere: 10, servizio: 6.45, imponibile: 16.45, iva: 3.62, totale: 20.07,
    conPagamento: true, pagatoIl: '2026-10-17T09:00:00Z', rimborsato: false, rimborsatoIl: null, metodo: 'stripe',
  });
  assert.deepEqual(i.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  assert.equal(i.servizioPct, 10);
  assert.equal(i.ivaPct, 22);
});

test('importiRichiesta, richiesta VECCHIA: si ricalcola sulle righe (stessa funzione del carrello); la consegna è quanto è stato addebitato', async () => {
  const calcolato = await pricing.calcolaDaRigheDb([riga(1, 54.5), riga(2, 10)], { costoConsegna: 10 });
  assert.equal(calcolato.da_pagare_app, 20.07, 'calcolaDaRigheDb = calcolaOrdine sulle righe del DB');
  const i = pricing.importiRichiesta(richiestaVecchia({ pagamento_importo: 66.9 }), calcolato);
  assert.equal(i.app.totale, 66.9, 'pagamento_importo: quello davvero addebitato');
  assert.equal(i.app.servizio, 6.45);
  assert.equal(i.app.iva, 3.62);
  assert.deepEqual(i.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  assert.equal(i.servizioPct, 10);
  assert.equal(i.ivaPct, 22);
  // senza pagamento (vecchio flusso): il calcolo, e niente "conPagamento"
  const senza = pricing.importiRichiesta(richiestaVecchia({ pagamento_stato: null, pagamento_importo: null, pagato_il: null }), calcolato);
  assert.equal(senza.app.totale, 20.07);
  assert.equal(senza.app.conPagamento, false);
});

test('importiRichiesta, rimborso: quanto è tornato indietro, e la data (rimborsato_il, o la scadenza di una richiesta chiusa senza ordine)', () => {
  const scritta = pricing.importiRichiesta(richiestaSalvata({ pagamento_stato: 'rimborsato', stato: 'nessuna_offerta', rimborsato_il: '2026-10-17T09:11:00Z' }));
  assert.equal(scritta.app.rimborsato, true);
  assert.equal(scritta.app.rimborsatoIl, '2026-10-17T09:11:00Z');
  // rimborsi fatti prima che la colonna esistesse: la richiesta chiusa senza ordine ha la sua scadenza
  const vecchio = pricing.importiRichiesta(richiestaSalvata({ pagamento_stato: 'rimborsato', stato: 'nessuna_offerta' }));
  assert.equal(vecchio.app.rimborsatoIl, '2026-10-17T09:10:00Z');
  // annullata dal cliente: nessuna data da dedurre
  const annullata = pricing.importiRichiesta(richiestaSalvata({ pagamento_stato: 'rimborsato', stato: 'annullata' }));
  assert.equal(annullata.app.rimborsatoIl, null);
  // non rimborsata: niente data
  assert.equal(pricing.importiRichiesta(richiestaSalvata()).app.rimborsatoIl, null);
});

test('importi(): un solo punto per ordine o richiesta', async () => {
  const calcolato = await pricing.calcolaDaRigheDb([riga(1, 54.5), riga(2, 10)], { costoConsegna: 10 });
  assert.deepEqual(pricing.importi({ richiesta: richiestaSalvata() }), pricing.importiRichiesta(richiestaSalvata()));
  assert.deepEqual(pricing.importi({ richiesta: richiestaVecchia(), calcolato }), pricing.importiRichiesta(richiestaVecchia(), calcolato));
  const ordine = { totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81 };
  assert.deepEqual(pricing.importi({ ordine, ivaPct: 22, servizioPct: 10 }), pricing.importiOrdine(ordine, null, 22, 10));
  assert.throws(() => pricing.importi({}), /ordine o una richiesta/);
});
