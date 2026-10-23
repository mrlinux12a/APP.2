// Prove degli importi salvati sulla richiesta (consegna pagata in app / materiale da pagare a BOREA): cosa scrive creaRichiesta alla nascita, cosa
// riscrive "Rinvia richiesta" (la consegna ricalcolata con i prezzi di oggi) e il rimborso con la sua data. DB finto che tiene le query:
// nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Dal 22/10/2026 una filiale senza orari impostati NON riceve richieste: le prove che hanno bisogno di un banco aperto gli danno un orario vero (24 ore, a Roma).
const SEMPRE_APERTO = Object.fromEntries(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((g) => [g, [['00:00', '23:59']]]));
const config = { servizio_pct: '10', iva_pct: '22', spedizione_fissa: '5', ordine_minimo: '33', finestra_conferma_min: '10' };
const chiamate = []; // { s, p, modo }
let richiestaDb = null; // la riga di requests che "esiste"
let righeDb = []; // request_items + prodotto
let banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: SEMPRE_APERTO }]; // le filiali attive (con i loro `orari`, se ci sono)
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = async (modo, p) => {
      chiamate.push({ s, p, modo });
      if (/FROM config WHERE chiave/.test(s)) return config[p[0]] !== undefined ? [{ valore: config[p[0]] }] : [];
      if (/^SELECT \* FROM requests WHERE id = \?/.test(s)) return richiestaDb ? [richiestaDb] : [];
      if (/FROM request_items ri JOIN products p/.test(s)) return righeDb;
      if (/^SELECT \* FROM distributors WHERE attivo = 1/.test(s)) return banchiAttivi;
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
const prepara = () => { chiamate.length = 0; richiestaDb = null; righeDb = []; banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: SEMPRE_APERTO }]; };

test('creaRichiesta: salva gli importi divisi (consegna e materiale) dai totali del carrello, accanto al pagamento', async () => {
  prepara();
  const totali = await pricing.calcolaOrdine(righeCarrello, { costoConsegna: 5 });
  const { requestId } = await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, {
    destinazione: 'Via Puggia 22/3', importo: totali.da_pagare_app, totali,
  });
  assert.equal(requestId, 321);
  const ins = inserimento();
  assert.ok(ins, 'INSERT INTO requests');
  // le colonne nuove, nell'ordine: corriere, servizio, iva_app, da_pagare_app, merce_banco, raee_banco, iva_banco, materiale_banco
  assert.match(ins.s, /corriere, servizio, iva_app, da_pagare_app, merce_banco, raee_banco, iva_banco, materiale_banco\)/);
  assert.deepEqual(ins.p.slice(-8), [5, 6.45, 2.32, 12.87, 64.5, 0, 14.19, 78.69]);
  assert.equal(ins.p[8], 12.87, 'pagamento_importo: quello addebitato');
  // placeholders e valori tornano: 10 parametri di prima + 8 nuovi
  assert.equal((ins.s.match(/\?/g) || []).length, ins.p.length);
  // richiesta in attesa: non è rimborsata, quindi niente data di rimborso
  assert.match(ins.s, /NOW\(\), NULL, \?/);
});

test('creaRichiesta senza `totali` (script, prove): le colonne restano a 0 e le pagine ricalcolano', async () => {
  prepara();
  await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, { importo: 12.87 });
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
  // 5 + 11,45 di servizio × 1,22 = 13,97 -> 18,97 (di cui IVA 3,42); materiale 114,50 + IVA 25,19 = 139,69
  assert.deepEqual(su.p.slice(1, 9), [5, 11.45, 3.42, 18.97, 114.5, 0, 25.19, 139.69]);
  const incasso = aggiornamento(/^UPDATE requests SET pagamento_stato = 'pagato'/);
  assert.ok(incasso, 'si addebita di nuovo');
  assert.match(incasso.s, /rimborsato_il = NULL/);
  assert.deepEqual(incasso.p, ['simulato', 18.97, 55], 'metodo, importo ricalcolato, richiesta');
});

test('"Rinvia richiesta" con Stripe: la richiesta torna a segnare come pagato quanto è stato autorizzato', async () => {
  prepara();
  richiestaDb = { id: 55, cliente_id: 1, stato: 'nessuna_offerta', pagamento_stato: 'rimborsato', pagamento_importo: 66.9 };
  righeDb = [riga(1, 54.5), riga(2, 10)];
  await richieste.reinviaRichiesta(55, { metodoPagamento: 'stripe', importo: 12.87 });
  assert.deepEqual(aggiornamento(/^UPDATE requests SET pagamento_stato = 'pagato'/).p, ['stripe', 12.87, 55]);
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
  corriere: 5, servizio: 6.45, iva_app: 2.32, da_pagare_app: 12.87, merce_banco: 64.5, raee_banco: 0, iva_banco: 14.19, materiale_banco: 78.69,
  stato: 'in_attesa', pagamento_stato: 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 12.87, pagato_il: '2026-10-17T09:00:00Z', rimborsato_il: null,
  scade_il: '2026-10-17T09:10:00Z', ...extra,
});
const richiestaVecchia = (extra = {}) => richiestaSalvata({
  corriere: 0, servizio: 0, iva_app: 0, da_pagare_app: 0, merce_banco: 0, raee_banco: 0, iva_banco: 0, materiale_banco: 0, ...extra,
});

test('importiRichiesta, richiesta NUOVA: le colonne salvate (54,50 + 10,00 -> 12,87 in app, 78,69 al banco)', () => {
  const i = pricing.importiRichiesta(richiestaSalvata());
  assert.deepEqual(i.app, {
    corriere: 5, servizio: 6.45, servizioIva: 7.87, imponibile: 10.55, iva: 2.32, totale: 12.87, ivaInclusa: true,
    conPagamento: true, pagatoIl: '2026-10-17T09:00:00Z', rimborsato: false, rimborsatoIl: null, metodo: 'stripe',
  });
  assert.deepEqual(i.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  assert.equal(i.servizioPct, 10);
  assert.equal(i.ivaPct, 22);
});

test('importiRichiesta, richiesta nata COL MODELLO DI PRIMA (IVA sopra: 10 + 6,45 + 3,62 = 20,07): resta com\'era, con la sua riga IVA', () => {
  const i = pricing.importiRichiesta(richiestaSalvata({ corriere: 10, servizio: 6.45, iva_app: 3.62, da_pagare_app: 20.07, pagamento_importo: 20.07 }));
  assert.equal(i.app.ivaInclusa, false);
  assert.deepEqual([i.app.corriere, i.app.servizio, i.app.servizioIva, i.app.imponibile, i.app.iva, i.app.totale], [10, 6.45, 6.45, 16.45, 3.62, 20.07]);
  assert.equal(i.ivaPct, 22, 'l\'IVA % si ricava dal materiale, non dalle due parti insieme');
});

test('importiRichiesta, richiesta VECCHIA: si ricalcola sulle righe (stessa funzione del carrello); la consegna è quanto è stato addebitato', async () => {
  const calcolato = await pricing.calcolaDaRigheDb([riga(1, 54.5), riga(2, 10)], { costoConsegna: 5 });
  assert.equal(calcolato.da_pagare_app, 12.87, 'calcolaDaRigheDb = calcolaOrdine sulle righe del DB');
  const i = pricing.importiRichiesta(richiestaVecchia({ pagamento_importo: 66.9 }), calcolato);
  assert.equal(i.app.totale, 66.9, 'pagamento_importo: quello davvero addebitato');
  assert.equal(i.app.servizio, 6.45);
  assert.equal(i.app.iva, 2.32);
  assert.deepEqual(i.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  assert.equal(i.servizioPct, 10);
  assert.equal(i.ivaPct, 22);
  // senza pagamento (vecchio flusso): il calcolo, e niente "conPagamento"
  const senza = pricing.importiRichiesta(richiestaVecchia({ pagamento_stato: null, pagamento_importo: null, pagato_il: null }), calcolato);
  assert.equal(senza.app.totale, 12.87);
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
  const calcolato = await pricing.calcolaDaRigheDb([riga(1, 54.5), riga(2, 10)], { costoConsegna: 5 });
  assert.deepEqual(pricing.importi({ richiesta: richiestaSalvata() }), pricing.importiRichiesta(richiestaSalvata()));
  assert.deepEqual(pricing.importi({ richiesta: richiestaVecchia(), calcolato }), pricing.importiRichiesta(richiestaVecchia(), calcolato));
  const ordine = { totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81 };
  assert.deepEqual(pricing.importi({ ordine, ivaPct: 22, servizioPct: 10 }), pricing.importiOrdine(ordine, null, 22, 10));
  assert.throws(() => pricing.importi({}), /ordine o una richiesta/);
});

// ---------------- Orari del banco (Anagrafica del banco, 20/10/2026) ----------------

const FASCE_ORARI = [['07:30', '12:30'], ['14:00', '18:00']];
const SETTIMANA = { lun: FASCE_ORARI, mar: FASCE_ORARI, mer: FASCE_ORARI, gio: FASCE_ORARI, ven: FASCE_ORARI, sab: [['07:30', '12:00']], dom: [] };
// Roma, lunedì 19 ottobre 2026 (ora legale, UTC+2): `a(giorno, ore, minuti)` con giorno 0 = lunedì.
const a = (giorno, ore, minuti = 0) => new Date(Date.UTC(2026, 9, 19 + giorno, ore - 2, minuti));

test('distributoriCandidati: solo le filiali aperte adesso (senza orari impostati: mai)', async () => {
  prepara();
  banchiAttivi = [
    { id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: SETTIMANA },
    { id: 3, nome: 'BOREA SRL', filiale: 'Staglieno', orari: { ...SETTIMANA, mar: [['15:00', '19:00']] } },
    { id: 4, nome: 'ALTRA', filiale: 'Sempre', orari: SEMPRE_APERTO },
    { id: 5, nome: 'SENZA ORARI', filiale: 'Nuova', orari: null },
  ];
  const ids = async (quando) => (await richieste.distributoriCandidati([1], 'Genova', 1, quando)).map((d) => d.id);
  assert.deepEqual(await ids(a(1, 10)), [2, 4], 'martedì 10:00: Fegino aperta, Staglieno no (apre alle 15), la terza aperta 24 ore, la quarta senza orari mai');
  assert.deepEqual(await ids(a(1, 13)), [4], 'martedì 13:00: Fegino è nella pausa pranzo, Staglieno apre alle 15');
  assert.deepEqual(await ids(a(1, 16)), [2, 3, 4], 'martedì 16:00: tutte aperte');
  assert.deepEqual(await ids(a(6, 10)), [4], 'domenica: aperta solo quella a 24 ore');
  assert.deepEqual(await richieste.distributoriCandidati([], 'Genova', 1, a(1, 10)), [], 'senza articoli niente candidati');
});

test('statoBanchiAttivi: basta una filiale aperta; se sono tutte chiuse dice quando riapre la prima', async () => {
  prepara();
  banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: SETTIMANA }, { id: 3, nome: 'BOREA SRL', filiale: 'Staglieno', orari: { ...SETTIMANA, mer: [['09:00', '12:00']] } }];
  assert.equal((await richieste.statoBanchiAttivi(a(1, 10))).aperto, true);
  const chiuso = await richieste.statoBanchiAttivi(a(1, 20));
  assert.equal(chiuso.aperto, false);
  assert.equal(chiuso.riapre.testo, 'domani alle 07:30', 'mercoledì apre prima Fegino (07:30)');
  banchiAttivi = [];
  assert.equal((await richieste.statoBanchiAttivi(a(1, 20))).aperto, true, 'nessuna filiale attiva: non è una questione di orari');
});

test('creaRichiesta con i banchi chiusi: il ripiego "broadcast" non include i chiusi, la richiesta nasce già chiusa e nessun banco è interpellato', async () => {
  prepara();
  const chiusoAdesso = Object.fromEntries(Object.keys(SETTIMANA).map((g) => [g, []]));
  chiusoAdesso[['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'][(new Date(Date.now() + 86400000 * 3).getUTCDay() + 6) % 7]] = [['07:30', '12:30']]; // aperto solo fra tre giorni
  banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: chiusoAdesso }];
  const { candidati } = await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, { destinazione: 'Via Puggia 22/3', importo: 12.87 });
  assert.deepEqual(candidati, []);
  const ins = inserimento();
  assert.equal(ins.p[2], 'nessuna_offerta', 'la richiesta nasce chiusa');
  assert.equal(chiamate.some((c) => /^INSERT INTO request_responses/.test(c.s) && c.modo === 'run'), false, 'nessun banco interpellato');

  // con un banco aperto (senza orari) invece parte
  prepara();
  const { candidati: aperti } = await richieste.creaRichiesta({ id: 1, zona: 'Genova', ragione_sociale: 'Rossi' }, righeCarrello, { destinazione: 'Via Puggia 22/3', importo: 12.87 });
  assert.equal(aperti.length, 1);
  assert.equal(inserimento().p[2], 'in_attesa');
});

test('controllaBancoAperto: lancia ErroreFlusso "banco_chiuso" con quando riapre; aperto = ritorna lo stato', async () => {
  const flusso = require('../src/flusso_cliente');
  prepara();
  banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: SETTIMANA }];
  assert.equal((await flusso.controllaBancoAperto(a(1, 10))).aperto, true);
  await assert.rejects(flusso.controllaBancoAperto(a(1, 20)), (e) => {
    assert.ok(e instanceof flusso.ErroreFlusso);
    assert.equal(e.codice, 'banco_chiuso');
    assert.equal(e.titolo, 'Il banco è chiuso');
    assert.equal(e.message, 'Riapre domani alle 07:30. Non è stato addebitato nulla: riprova quando riapre.');
    assert.equal(e.frase, 'Il banco è chiuso · riapre domani alle 07:30');
    assert.equal(e.riapre.ora, '07:30');
    return true;
  });
  // tutti i giorni chiusi: dice solo che non riceve richieste
  banchiAttivi = [{ id: 2, nome: 'BOREA SRL', filiale: 'Fegino', orari: Object.fromEntries(Object.keys(SETTIMANA).map((g) => [g, []])) }];
  await assert.rejects(flusso.controllaBancoAperto(a(1, 10)), /Al momento non riceve richieste/);
});
