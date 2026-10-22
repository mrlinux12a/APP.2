// Prove del calcolo del materiale (src/materiale.js) e dell'importo che si paga in app (pricing.calcolaOrdine: servizio + consegna).
// DB finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let ordini = [];
let righe = [];
let richieste = [];
let righeRichieste = [];
let richiesteConIncasso = []; // le richieste per cui stripe_pagamenti ha una riga con la ricevuta (la SQL la sceglie, qui si finge il risultato)
const chiamate = [];
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const esegui = async (...p) => {
      chiamate.push({ s, p });
      if (/FROM config WHERE chiave/.test(s)) return [{ valore: p[0] === 'iva_pct' ? '22' : p[0] === 'servizio_pct' ? '10' : p[0] === 'spedizione_fissa' ? '10' : '33' }];
      if (/FROM orders o LEFT JOIN distributors/.test(s)) {
        const filiale = /AND o\.distributor_id = \?/.test(s) ? p[1] : null;
        return ordini.filter((o) => o.cliente_id === p[0] && (filiale === null || o.distributor_id === filiale)).sort((a, b) => b.id - a.id); // ORDER BY o.id DESC
      }
      if (/FROM order_items WHERE order_id = ANY/.test(s)) return righe.filter((r) => p[0].includes(r.order_id));
      if (/SELECT DISTINCT request_id FROM stripe_pagamenti/.test(s)) return richiesteConIncasso.filter((id) => p[0].includes(id)).map((id) => ({ request_id: id }));
      // le righe delle richieste chiuse (una lettura sola, con la sotto-query delle stesse richieste) PRIMA della lettura delle richieste: la contiene
      if (/FROM request_items ri JOIN products p ON p\.id = ri\.product_id WHERE ri\.request_id IN \(/.test(s)) return righeRichieste;
      if (/FROM requests WHERE cliente_id = \? AND order_id IS NULL/.test(s)) return richieste;
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 100));
    };
    return { all: esegui, get: async (...p) => (await esegui(...p))[0] || null, run: async () => ({ changes: 0 }) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const materiale = require('../src/materiale');
const pricing = require('../src/pricing');

// pg legge le colonne TIMESTAMP (UTC senza fuso) come ora locale: stesso tipo di Date, qualunque sia il fuso del PC.
const quando = (anno, mese, giorno, ore = 10, minuti = 0) => {
  const d = new Date(Date.UTC(anno, mese - 1, giorno, ore, minuti));
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
};
// Un ordine con UNA riga: netto del banco, +10% di servizio, RAEE opzionale, consegna 10, IVA 22%.
function ordine(id, { cliente = 1, banco = 2, ditta = 'BOREA SRL', data = quando(2026, 10, 15), stato = 'evaso', consegnato = false, netto = 100, qta = 1, raee = 0, addebitato = null, metodo = null, statoPag = null } = {}) {
  const subtotale = netto * qta;
  const cliente_ = Math.round(subtotale * 1.1 * 100) / 100;
  const imponibile = cliente_ + raee * qta + 10;
  ordini.push({
    id, cliente_id: cliente, creato_il: data, stato, consegnato_il: consegnato ? data : null, distributor_id: banco, costo_consegna: 10, totale_netto: subtotale,
    contributo_raee: raee * qta, iva: Math.round(imponibile * 0.22 * 100) / 100, totale_finale: cliente_, distributore_nome: ditta, pagamento_importo: addebitato,
    request_id: id + 1000, pagamento_metodo: metodo, pagamento_stato: statoPag,
  });
  righe.push({
    order_id: id, product_id: id, codice_snapshot: 'C' + id, nome_snapshot: 'Articolo ' + id, quantita: qta, prezzo_netto_unitario: netto,
    subtotale, subtotale_cliente: cliente_, raee_unitario: raee, raee_riga: raee * qta,
  });
}
const prova = (f) => async () => { ordini = []; righe = []; richieste = []; righeRichieste = []; richiesteConIncasso = []; chiamate.length = 0; await f(); };

test('importo che si paga in app: servizio (10%) + consegna, IVA inclusa; il materiale (prezzo del banco + RAEE) si paga dopo; le due parti fanno il totale', async () => {
  const prodotto = (id, listino, sconto, raee) => ({ prodotto: { id, codice: 'C' + id, nome: 'P' + id, prezzo_listino: listino, sconto_base_pct: sconto, raee }, quantita: 2 });
  // netto: 100 × (1 − 0,3) = 70 → ×2 = 140; con servizio 77 → ×2 = 154; RAEE 1,50 × 2 = 3
  const t = await pricing.calcolaOrdine([prodotto(1, 100, 30, 1.5)], { costoConsegna: 10 });
  assert.equal(t.totale_netto, 140);
  assert.equal(t.totale_finale, 154);
  assert.equal(t.servizio, 14, 'il 10% sul prezzo del banco, IVA esclusa');
  assert.equal(t.da_pagare_app, 29.28, '(14 + 10) × 1,22');
  assert.equal(t.materiale_banco, 174.46, '(140 + 3) × 1,22');
  assert.ok(Math.abs(t.da_pagare_app + t.materiale_banco - t.totale_ivato) <= 0.01, 'insieme fanno il totale: ' + t.totale_ivato);
  assert.equal(t.totale_ivato, 203.74, '(154 + 3 + 10) × 1,22: invariato');
  // senza consegna né servizio (sconto 0 e prezzo netto = listino... il servizio c'è sempre): nessun ordine vuoto
  const vuoto = await pricing.calcolaOrdine([], { costoConsegna: 0 });
  assert.equal(vuoto.da_pagare_app, 0);
  assert.equal(vuoto.materiale_banco, 0);
});

test('materialeOrdini: prezzi dal NETTO + RAEE con IVA, mai dal prezzo con servizio; il servizio è fuori dal totale', prova(async () => {
  ordine(10, { netto: 100, raee: 2, addebitato: 24.4 }); // materiale (100 + 2) × 1,22 = 124,44; servizio (10 + 10) × 1,22 = 24,40
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const o = m.gruppi[0].ordini[0];
  assert.deepEqual(o.righe.map((r) => [r.cad, r.totale]), [[124.44, 124.44]]);
  assert.equal(o.totale, 124.44);
  assert.equal(o.servizio, 24.4);
  assert.deepEqual(m.riepilogo, { totale: 124.44, servizio: 24.4, nOrdini: 1 });
  assert.notEqual(o.totale, 134.2, 'non è subtotale_cliente (110) + RAEE, IVA inclusa');
  // più pezzi: il totale di riga è netto riga × 1,22, il prezzo cad. è (unitario + RAEE unitario) × 1,22
  ordini = []; righe = [];
  ordine(11, { netto: 30, qta: 2, raee: 1 });
  const r = (await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' })).gruppi[0].ordini[0].righe[0];
  assert.equal(r.cad, 37.82); // (30 + 1) × 1,22
  assert.equal(r.totale, 75.64); // (60 + 2) × 1,22
}));

test('servizio pagato: l\'addebitato se torna, altrimenti il calcolo (pagamento intero di una volta, o non salvato)', prova(async () => {
  ordine(20, { netto: 100, addebitato: 24.4 }); // coerente: si tiene
  ordine(21, { netto: 100, addebitato: 134.2 }); // si pagava tutto in app: 134,20 non è un servizio, vale il calcolo 24,40
  ordine(22, { netto: 100, addebitato: null }); // non salvato: calcolo
  ordine(23, { netto: 100, addebitato: 24.39 }); // un centesimo di meno (arrotondamenti): si tiene
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const per = Object.fromEntries(m.gruppi[0].ordini.map((o) => [o.id, o.servizio]));
  assert.deepEqual(per, { 20: 24.4, 21: 24.4, 22: 24.4, 23: 24.39 });
}));

test('Storico e pagina del banco: gli importi di un ordine sono quelli di pricing.importiOrdine (colonne salvate o ricalcolo), mai altri', prova(async () => {
  // nuovo: con le colonne salvate alla nascita (54,50 + 10,00 di merce -> 20,07 in app, 78,69 al banco)
  ordine(30, { netto: 64.5, addebitato: 20.07 });
  Object.assign(ordini[0], { servizio: 6.45, imponibile_app: 16.45, iva_app: 3.62, da_pagare_app: 20.07, imponibile_banco: 64.5, iva_banco: 14.19, materiale_banco: 78.69 });
  // vecchio: stesse cifre ricalcolate
  ordine(31, { netto: 64.5, addebitato: 20.07 });
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  for (const o of m.gruppi[0].ordini) {
    const grezzo = ordini.find((x) => x.id === o.id);
    const atteso = pricing.importiOrdine(grezzo, { stato: 'pagato', importo: grezzo.pagamento_importo }, pricing.ivaPctOrdine(grezzo, 22));
    assert.equal(o.totale, atteso.banco.totale, 'materiale dell\'ordine #' + o.id);
    assert.equal(o.servizio, atteso.app.totale, 'consegna pagata in app, ordine #' + o.id);
  }
  const per = Object.fromEntries(m.gruppi[0].ordini.map((o) => [o.id, [o.totale, o.servizio]]));
  assert.deepEqual(per, { 30: [78.69, 20.07], 31: [78.69, 20.07] }, 'nuovo e vecchio dicono la stessa cosa');
}));

test('stato dell\'ordine: Consegnato oppure In preparazione (inviato, in preparazione e anche partito: niente "In consegna")', prova(async () => {
  ordine(30, { consegnato: true });
  ordine(31, { stato: 'evaso' });
  ordine(32, { stato: 'in_evasione' });
  ordine(33, { stato: 'inviato' });
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const stati = Object.fromEntries(m.gruppi[0].ordini.map((o) => [o.id, o.stato.etichetta]));
  assert.deepEqual(stati, { 30: 'Consegnato', 31: 'In preparazione', 32: 'In preparazione', 33: 'In preparazione' });
  assert.equal(m.riepilogo.nOrdini, 4, 'compaiono tutti, anche quelli ancora in preparazione o in consegna');
}));

test('mese: il corrente se ha ordini, altrimenti il più recente; "tutto"; valori non validi; l\'elenco dei mesi', prova(async () => {
  ordine(40, { data: quando(2026, 10, 15) });
  ordine(41, { data: quando(2026, 9, 3) });
  ordine(42, { data: quando(2026, 6, 20) });
  const chiedi = (mese, adesso) => materiale.materialeOrdini({ clienteId: 1, mese, adesso });
  assert.equal((await chiedi(undefined, quando(2026, 10, 20))).mese, '2026-10', 'il mese corrente ha ordini');
  assert.equal((await chiedi(undefined, quando(2026, 11, 2))).mese, '2026-10', 'novembre non ne ha: il più recente');
  assert.equal((await chiedi('2026-09', quando(2026, 10, 20))).mese, '2026-09');
  assert.equal((await chiedi('2026-02', quando(2026, 10, 20))).mese, '2026-10', 'un mese senza attività torna al corrente');
  assert.equal((await chiedi('ciao', quando(2026, 10, 20))).mese, '2026-10');
  assert.equal((await chiedi('tutto')).riepilogo.nOrdini, 3);
  const m = await chiedi('2026-10');
  assert.deepEqual(m.mesi, [{ chiave: '2026-10', titolo: 'Ottobre 2026' }, { chiave: '2026-09', titolo: 'Settembre 2026' }, { chiave: '2026-06', titolo: 'Giugno 2026' }]);
  assert.equal(m.riepilogo.nOrdini, 1);
  // senza ordini né richieste: il mese corrente, vuoto
  ordini = []; righe = [];
  const vuoto = await chiedi(undefined, quando(2026, 10, 20));
  assert.deepEqual([vuoto.mese, vuoto.vuoto, vuoto.mesi.length], ['2026-10', true, 0]);
}));

test('il mese si legge in ora italiana: un ordine di mezzanotte e mezza a Roma sta nel mese nuovo', prova(async () => {
  ordine(50, { data: quando(2026, 9, 30, 22, 30) }); // 23:30 UTC del 30 -> 00:30 del 1 ottobre a Roma (CEST, +2)
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  assert.deepEqual(m.mesi.map((x) => x.chiave), ['2026-10']);
  assert.equal(m.gruppi[0].ordini[0].data, '1 ott, 00:30');
}));

test('più distributori: un gruppo (un riquadro) per ditta; il filtro sul banco e le richieste senza ordine', prova(async () => {
  ordine(60, { netto: 100 });
  ordine(61, { netto: 50, ditta: 'AFIS SPA', banco: 1 });
  ordine(62, { netto: 100, cliente: 9 }); // di un altro cliente: mai
  richieste = [
    { id: 7, stato: 'nessuna_offerta', creato_il: quando(2026, 10, 2) },
    { id: 8, stato: 'annullata', creato_il: quando(2026, 9, 2) },
  ];
  righeRichieste = [{ request_id: 7, quantita: 2, nome: 'Valvola a sfera' }, { request_id: 7, quantita: 1, nome: 'Raccordo a T' }];
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  assert.deepEqual(m.gruppi.map((g) => [g.nome, g.riepilogo.nOrdini, g.riepilogo.totale]), [['AFIS SPA', 1, 61], ['BOREA SRL', 1, 122]] /* la ditta con l'ordine più recente per prima */);
  assert.equal(m.riepilogo.totale, 183);
  assert.deepEqual(m.senzaOrdine.map((r) => [r.id, r.etichetta, r.tono]), [[7, 'Nessuna risposta', 'nessuna'], [8, 'Annullata', 'annullata']]);
  // la richiesta ANNULLATA non apre nessuna pagina (href null); quella senza risposta sì (da lì si rinvia)
  assert.deepEqual(m.senzaOrdine.map((r) => r.href), ['/richieste/7', null]);
  // la stessa forma di un ordine: data compatta, primo articolo con "+altri" e le righe (quantità e nome, nessun prezzo); senza righe salvate niente primo
  assert.equal(m.senzaOrdine[0].data, '2 ott, 12:00');
  assert.equal(m.senzaOrdine[0].primo, '2× Valvola a sfera');
  assert.equal(m.senzaOrdine[0].altri, 1);
  assert.deepEqual(m.senzaOrdine[0].righe, [{ quantita: 2, nome: 'Valvola a sfera' }, { quantita: 1, nome: 'Raccordo a T' }]);
  assert.deepEqual([m.senzaOrdine[1].primo, m.senzaOrdine[1].altri, m.senzaOrdine[1].righe], ['', 0, []]);
  // le righe di tutte le richieste con UNA sola lettura, insieme alle altre (non una in fila dopo)
  assert.equal(chiamate.filter((c) => /FROM request_items/.test(c.s)).length, 1);
  assert.deepEqual(m.ditte, ['AFIS SPA', 'BOREA SRL']);
  // il banco: solo i suoi ordini, niente richieste senza ordine, niente Riordina, nessun link se non lo vuole
  const lato = await materiale.materialeOrdini({ clienteId: 1, distributorId: 1, mese: 'tutto', hrefOrdine: () => null });
  assert.deepEqual(lato.gruppi.map((g) => g.nome), ['AFIS SPA']);
  assert.deepEqual(lato.senzaOrdine, []);
  assert.equal(chiamate.filter((c) => /FROM request_items/.test(c.s)).length, 1, 'il banco non legge le righe delle richieste: nessuna lettura in più');
  assert.equal(lato.gruppi[0].ordini[0].href, null);
  assert.equal(lato.gruppi[0].ordini[0].riordinaId, null);
  // e l'installatore ha Riordina solo sui consegnati
  ordini = []; righe = [];
  ordine(70, { consegnato: true });
  ordine(71, { consegnato: false });
  const mio = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  assert.deepEqual(mio.gruppi[0].ordini.map((o) => [o.id, o.riordinaId]), [[71, null], [70, 70]]);
}));

test('vista per articolo: righe sommate per articolo e prezzo, dal totale più alto, con gli ordini', prova(async () => {
  ordine(80, { netto: 100, qta: 1, data: quando(2026, 10, 10) });
  ordine(81, { netto: 100, qta: 1, data: quando(2026, 10, 11) });
  righe.find((r) => r.order_id === 81).codice_snapshot = 'C80';
  righe.find((r) => r.order_id === 81).nome_snapshot = 'Articolo 80'; // lo stesso articolo ordinato due volte
  ordine(82, { netto: 400, qta: 1, data: quando(2026, 10, 12) });
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10', vista: 'articolo' });
  assert.equal(m.vista, 'articolo');
  assert.deepEqual(m.gruppi[0].articoli.map((a) => [a.nome, a.quantita, a.cad, a.totale, a.ordini]), [
    ['Articolo 82', 1, 488, 488, [82]],
    ['Articolo 80', 2, 122, 244, [81, 80]],
  ]);
  assert.equal((await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10', vista: 'cosa' })).vista, 'ordine');
}));

test('IVA dell\'ordine: quella salvata (iva / imponibile), non quella di oggi; senza IVA salvata, quella della configurazione', prova(async () => {
  ordine(90, { netto: 100 });
  ordini[0].iva = 22.2; // imponibile 120 -> 18,5%: un'IVA diversa da quella di oggi (22%)
  ordine(91, { netto: 100 });
  ordini[1].iva = 0; // vecchio ordine senza IVA: configurazione (22%)
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const per = Object.fromEntries(m.gruppi[0].ordini.map((o) => [o.id, [o.iva, o.totale]]));
  assert.deepEqual(per[90], [18.5, 118.5]);
  assert.deepEqual(per[91], [22, 122]);
}));

test('CSV: ";", BOM, una riga per articolo, servizio sulla prima riga dell\'ordine, totali in fondo, celle sicure per Excel', prova(async () => {
  ordine(100, { netto: 100, data: quando(2026, 10, 15) });
  righe[0].nome_snapshot = '- Materiale; "speciale"'; // comincia per "-" (formula in Excel), ha ";" e virgolette
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const csv = materiale.csvMateriale(m);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const linee = csv.slice(1).split('\r\n');
  assert.equal(linee[0], 'Data;Ordine;Stato;Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl.;Servizio pagato');
  assert.equal(linee[1], '15/10/2026;#100;In preparazione;C100;"\'- Materiale; ""speciale""";1;122,00;122,00;24,40');
  assert.equal(linee[2], 'Totale;;;;;;;122,00;24,40');
  assert.equal(materiale.nomeFileCsv(m), 'materiale-2026-10.csv');
  assert.equal(materiale.nomeFileCsv({ mese: 'tutto' }), 'materiale-tutto.csv');
}));

// ---------- Pagina del cliente lato banco: materialeCliente (stessi numeri di materialeOrdini, disposti per il banco) ----------

test('materialeCliente: TUTTI gli ordini di quel banco, stato del banco, totali con IVA e RAEE, "di cui IVA", articoli e pezzi', prova(async () => {
  ordine(10, { netto: 100, raee: 2, stato: 'inviato', data: quando(2026, 10, 16) }); // da preparare: (100 + 2) × 1,22 = 124,44
  ordine(11, { netto: 30, qta: 2, raee: 1, stato: 'in_evasione', data: quando(2026, 10, 15) }); // (60 + 2) × 1,22 = 75,64
  ordine(12, { netto: 50, stato: 'evaso', data: quando(2026, 10, 14) }); // `evaso` (ordine vecchio), anche lui "in consegna": 61,00
  ordine(13, { netto: 50, consegnato: true, data: quando(2026, 10, 13) }); // consegnato: 61,00
  ordine(14, { netto: 999, cliente: 9 }); // di un altro cliente: mai
  ordine(15, { netto: 999, banco: 1, ditta: 'AFIS SPA' }); // dello stesso cliente ma di un altro banco: mai
  Object.assign(ordini.find((o) => o.id === 10), { request_id: 500 });
  const m = await materiale.materialeCliente(2, 1, { mese: '2026-10', adesso: quando(2026, 10, 20) });
  assert.deepEqual(m.ordini.map((o) => [o.id, o.stato.chiave, o.stato.etichetta, o.nArticoli, o.totale]), [
    [10, 'da_preparare', 'Da preparare', 1, 124.44],
    [11, 'in_consegna', 'In consegna', 1, 75.64],
    [12, 'in_consegna', 'In consegna', 1, 61],
    [13, 'consegnato', 'Consegnato', 1, 61],
  ], 'dal più recente; ci sono anche quelli ancora da preparare');
  assert.ok(m.ordini.every((o) => !('ddt' in o)), 'nessun numero di bolla');
  // totale = somma dei totali di ordine (già IVA inclusa, RAEE dentro); IVA = totale − netti di riga (102 + 62 + 50 + 50 = 264)
  assert.deepEqual(m.riepilogo, { nOrdini: 4, nArticoli: 4, pezzi: 5, totale: 322.08, iva: 58.08 });
  // righe: prezzo cad. e totale di riga dai valori salvati, il servizio non c'è
  assert.deepEqual(m.ordini[1].righe.map((r) => [r.quantita, r.cad, r.totale]), [[2, 37.82, 75.64]]);
  assert.deepEqual([m.mese, m.meseNome, m.vista, m.vuoto, m.ditta], ['2026-10', 'ottobre', 'ordine', false, 'BOREA']);
  assert.equal('servizio' in m.ordini[0], false);
  // la lettura è una sola per gli ordini e una per le righe (niente query per ordine)
  assert.equal(chiamate.filter((c) => /FROM order_items/.test(c.s)).length, 1);
  // il banco giusto: le query sono filtrate per cliente e filiale
  assert.deepEqual(chiamate.find((c) => /FROM orders o/.test(c.s)).p, [1, 2]);
}));

test('materialeCliente: gli ordini non portano più un link alla pagina dell\'ordine (c\'è solo per quelli "Da preparare", e ci si arriva dalla home)', prova(async () => {
  ordine(10, { stato: 'inviato' });
  ordine(11, { stato: 'in_evasione' });
  ordine(12, { stato: 'evaso' });
  ordine(13, { stato: 'inviato', consegnato: true }); // segnato consegnato con la rotta provvisoria, ma per il DB è ancora 'inviato'
  Object.assign(ordini.find((o) => o.id === 10), { request_id: 500 });
  const m = await materiale.materialeCliente(2, 1, { mese: '2026-10' });
  assert.deepEqual(m.ordini.map((o) => o.id).sort(), [10, 11, 12, 13]);
  for (const o of m.ordini) assert.equal('href' in o, false, '#' + o.id);
  assert.equal(m.ordini.find((o) => o.id === 13).stato.etichetta, 'Consegnato', 'lo stato mostrato guarda consegnato_il per primo');
  assert.equal('linkOrdineBanco' in materiale, false);
}));

test('materialeCliente: i due mesi più recenti, gli altri a parte; mese corrente o più recente; "Tutto"; nome del mese', prova(async () => {
  ordine(40, { data: quando(2026, 10, 15) });
  ordine(41, { data: quando(2026, 9, 3) });
  ordine(42, { data: quando(2026, 6, 20) });
  ordine(43, { data: quando(2026, 3, 2) });
  const chiedi = (mese, adesso = quando(2026, 10, 20)) => materiale.materialeCliente(2, 1, { mese, adesso });
  const m = await chiedi(undefined);
  assert.equal(m.mese, '2026-10');
  assert.deepEqual(m.mesiRecenti.map((x) => x.chiave), ['2026-10', '2026-09']);
  assert.deepEqual(m.mesiAltri.map((x) => x.titolo), ['Giugno 2026', 'Marzo 2026']);
  assert.equal((await chiedi(undefined, quando(2026, 11, 3))).mese, '2026-10', 'novembre non ha ordini: il più recente che ne ha');
  const tutto = await chiedi('tutto');
  assert.deepEqual([tutto.mese, tutto.meseNome, tutto.riepilogo.nOrdini], ['tutto', '', 4]);
  const giugno = await chiedi('2026-06');
  assert.deepEqual([giugno.mese, giugno.meseNome], ['2026-06', 'giugno']);
  assert.equal((await chiedi('2026-02')).mese, '2026-10', 'un mese senza ordini torna al corrente');
  // nessun ordine: scheda vuota, nome del banco dal ripiego, mese corrente
  ordini = []; righe = [];
  const vuoto = await materiale.materialeCliente(2, 1, { adesso: quando(2026, 10, 20), ditta: 'AFIS SPA' });
  assert.deepEqual([vuoto.vuoto, vuoto.mese, vuoto.meseNome, vuoto.ditta, vuoto.mesiRecenti.length], [true, '2026-10', 'ottobre', 'AFIS', 0]);
  assert.deepEqual(vuoto.riepilogo, { nOrdini: 0, nArticoli: 0, pezzi: 0, totale: 0, iva: 0 });
}));

test('materialeCliente, per articolo: somma per codice e nome, "prezzi diversi" se i cad. non sono tutti uguali, dal totale più alto', prova(async () => {
  ordine(20, { netto: 100, qta: 1, data: quando(2026, 10, 10) }); // l'articolo A a 122,00
  ordine(21, { netto: 100, qta: 3, data: quando(2026, 10, 11) }); // lo stesso articolo A, stesso prezzo
  ordine(22, { netto: 80, qta: 1, data: quando(2026, 10, 12) }); // ancora A, ma a 97,60
  ordine(23, { netto: 10, qta: 2, data: quando(2026, 10, 13) }); // B: un solo prezzo
  ordine(24, { netto: 10, qta: 1, data: quando(2026, 10, 14) }); // ancora B, stesso prezzo
  for (const id of [21, 22]) Object.assign(righe.find((r) => r.order_id === id), { codice_snapshot: 'C20', nome_snapshot: 'Articolo 20' });
  Object.assign(righe.find((r) => r.order_id === 24), { codice_snapshot: 'C23', nome_snapshot: 'Articolo 23' });
  const m = await materiale.materialeCliente(2, 1, { mese: '2026-10', vista: 'articolo' });
  assert.equal(m.vista, 'articolo');
  assert.deepEqual(m.articoli.map((a) => [a.nome, a.quantita, a.cad, a.prezziDiversi, a.totale, a.ordini]), [
    ['Articolo 20', 5, null, true, 585.6, [22, 21, 20]], // 122,00 + 366,00 + 97,60
    ['Articolo 23', 3, 12.2, false, 36.6, [24, 23]],
  ]);
  assert.deepEqual([m.riepilogo.nArticoli, m.riepilogo.pezzi], [2, 8], 'articoli distinti e pezzi totali');
  assert.equal((await materiale.materialeCliente(2, 1, { mese: '2026-10', vista: 'cosa' })).vista, 'ordine');
  // lo Storico dell'installatore non cambia: lì le righe restano divise per prezzo
  const mio = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10', vista: 'articolo' });
  assert.deepEqual(mio.gruppi[0].articoli.filter((a) => a.nome === 'Articolo 20').map((a) => [a.quantita, a.cad]), [[4, 122], [1, 97.6]]);
}));

test('CSV del banco: ";" e BOM, dal più vecchio, stato del banco (nessuna colonna DDT), nessun servizio, totale in fondo; nome del file dal cliente e dal mese', prova(async () => {
  ordine(100, { netto: 100, data: quando(2026, 10, 15) });
  righe[0].nome_snapshot = '- Materiale; "speciale"'; // comincia per "-" (formula in Excel), ha ";" e virgolette
  ordine(101, { netto: 50, stato: 'inviato', data: quando(2026, 10, 16) });
  const m = await materiale.materialeCliente(2, 1, { mese: '2026-10' });
  const csv = materiale.csvMaterialeCliente(m);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.deepEqual(csv.slice(1).split('\r\n'), [
    'Data;Ordine;Stato;Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl.',
    '15/10/2026;#100;In consegna;C100;"\'- Materiale; ""speciale""";1;122,00;122,00',
    '16/10/2026;#101;Da preparare;C101;Articolo 101;1;61,00;61,00',
    'Totale;;;;;;;183,00',
    '',
  ]);
  assert.equal(/Servizio/i.test(csv), false);
  assert.equal(materiale.nomeFileCsvCliente('Rossi Impianti S.r.l.', '2026-10'), 'materiale_rossi-impianti-s-r-l_2026-10.csv');
  assert.equal(materiale.nomeFileCsvCliente('Génova & Figli — Società', 'tutto'), 'materiale_genova-figli-societa_tutto.csv');
  assert.equal(materiale.nomeFileCsvCliente('', '2026-09'), 'materiale_cliente_2026-09.csv');
}));

test('scheda "Materiale ordinato" (partial): stato vuoto, "Altri mesi" solo con più di due mesi, nessun servizio', prova(async () => {
  const ejs = require('ejs');
  const format = require('../src/format');
  const icone = require('../src/icone');
  const disegna = (m) => ejs.renderFile(
    path.join(__dirname, '..', 'views', 'partials', 'materiale_cliente.ejs'),
    { m, clienteId: 5, esporta: '/distributore/clienti/5/materiale.csv', euro: pricing.euro, fmt: format, conRitorno: require('../src/http').conRitorno, ...icone },
  );
  // nessun ordine: zeri, "Nessun ordine in questo periodo.", niente riga del totale, solo "Tutto" fra i mesi
  const vuoto = await disegna(await materiale.materialeCliente(2, 1, { adesso: quando(2026, 10, 20), ditta: 'BOREA SRL' }));
  assert.match(vuoto, /<p class="mc-vuoto">Nessun ordine in questo periodo\.<\/p>/);
  assert.doesNotMatch(vuoto, /mc-fondo|<details|<table/);
  // striscia del riepilogo: "0 ordini", "0 articoli · 0 pezzi" e il totale a zero
  assert.match(vuoto, /<span class="mc-conta"><strong>0<\/strong> ordini<\/span>\s*<span class="mc-conta"><strong>0<\/strong> articoli · <strong>0<\/strong> pezzi<\/span>/);
  assert.match(vuoto, /<strong class="mc-totale-val">€ 0,00<\/strong>\s*<span class="mc-totale-iva">di cui IVA € 0,00<\/span>/);
  assert.deepEqual([...vuoto.matchAll(/<a class="mc-seg-voce[^"]*" href="[^"]+"[^>]*>([^<]+)<\/a>/g)].map((x) => x[1]), ['Tutto', 'Per ordine', 'Per articolo']);
  assert.match(vuoto, /<span class="mc-nota">Prezzi IVA inclusa · il cliente li paga a BOREA<\/span>/);
  // senza il nome della ditta: "al banco", non "a il banco"
  const senzaDitta = await disegna({ ...(await materiale.materialeCliente(2, 1, { adesso: quando(2026, 10, 20) })), ditta: '' });
  assert.match(senzaDitta, /Prezzi IVA inclusa · il cliente li paga al banco/);
  // vista per articolo vuota: lo stesso messaggio, niente tabella
  assert.match(await disegna(await materiale.materialeCliente(2, 1, { vista: 'articolo', adesso: quando(2026, 10, 20) })), /Nessun ordine in questo periodo\./);

  // due mesi: nessun "Altri mesi"; quattro mesi: la <select> con gli altri due; se il mese scelto è fra gli altri, la select è quella attiva
  ordine(40, { data: quando(2026, 10, 15) });
  ordine(41, { data: quando(2026, 9, 3) });
  let t = await disegna(await materiale.materialeCliente(2, 1, { mese: '2026-10', adesso: quando(2026, 10, 20) }));
  assert.doesNotMatch(t, /mc-altri/);
  ordine(42, { data: quando(2026, 6, 20) });
  ordine(43, { data: quando(2026, 3, 2) });
  t = await disegna(await materiale.materialeCliente(2, 1, { mese: '2026-10', adesso: quando(2026, 10, 20) }));
  assert.match(t, /<input type="hidden" name="vista" value="ordine">\s*<select class="mc-altri-select" name="mese" aria-label="Altri mesi"[^>]*>\s*<option value="" selected disabled>Altri mesi<\/option>\s*<option value="2026-06">Giugno 2026<\/option>\s*<option value="2026-03">Marzo 2026<\/option>/);
  t = await disegna(await materiale.materialeCliente(2, 1, { mese: '2026-06', adesso: quando(2026, 10, 20) }));
  assert.match(t, /<select class="mc-altri-select attiva" name="mese"/);
  assert.match(t, /<option value="2026-06" selected>Giugno 2026<\/option>/);
  assert.doesNotMatch(t, /selected disabled/, 'con un mese degli "altri" scelto, niente segnaposto');
  assert.match(t, /<span class="mc-totale-eti">Totale giugno<\/span>\s*<strong class="mc-totale-val">€ 122,00<\/strong>/);
  // nessuna voce mensile attiva fra i segmenti (è la select ad esserlo) e "Tutto" non lo è
  assert.deepEqual([...t.matchAll(/<a class="mc-seg-voce( attiva)?" href="[^"]+"[^>]*>([^<]+)<\/a>/g)].map((x) => [x[2], !!x[1]]),
    [['Ottobre 2026', false], ['Settembre 2026', false], ['Tutto', false], ['Per ordine', true], ['Per articolo', false]]);
}));

test('elenco: ordini e richieste chiuse INSIEME, dal più recente per data di creazione (niente sezione a parte); a parità, prima l\'ordine', prova(async () => {
  ordine(50, { data: quando(2026, 10, 15, 10, 0) });
  ordine(51, { data: quando(2026, 10, 5, 10, 0) });
  ordine(52, { data: quando(2026, 10, 1, 9, 0) });
  richieste = [
    { id: 7, stato: 'nessuna_offerta', creato_il: quando(2026, 10, 10, 9, 0) }, // fra il 50 e il 51
    { id: 8, stato: 'annullata', creato_il: quando(2026, 10, 5, 10, 0) }, // stesso istante del 51: l'ordine prima
    { id: 9, stato: 'annullata', creato_il: quando(2026, 10, 20, 8, 0) }, // la più recente di tutte
    { id: 3, stato: 'annullata', creato_il: quando(2026, 9, 30, 8, 0) }, // un altro mese: non c'è
  ];
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const sigla = (v) => (v.tipo === 'ordine' ? 'O' + v.ordine.id : 'R' + v.richiesta.id);
  assert.deepEqual(m.elenco.map(sigla), ['R9', 'O50', 'R7', 'O51', 'R8', 'O52']);
  // le richieste restano nei dati di prima (senzaOrdine) e "vuoto" le conta
  assert.deepEqual(m.senzaOrdine.map((r) => r.id), [7, 8, 9]);
  assert.equal(m.vuoto, false);
  // un mese con le sole richieste non è vuoto; "tutto" le mette in fila con gli ordini
  const tutto = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  assert.deepEqual(tutto.elenco.map(sigla), ['R9', 'O50', 'R7', 'O51', 'R8', 'O52', 'R3']);
  // la vista per articolo non cambia: l'elenco c'è sempre, la vista sceglie cosa disegnare
  assert.equal((await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10', vista: 'articolo' })).elenco.length, 6);
  // il banco non ha richieste senza ordine: l'elenco ha solo i suoi ordini
  const lato = await materiale.materialeOrdini({ clienteId: 1, distributorId: 2, mese: '2026-10', hrefOrdine: () => null });
  assert.deepEqual(lato.elenco.map(sigla), ['O50', 'O51', 'O52']);
}));

test('ricevuta: anche un pagamento simulato (sandbox) la ha; un pagamento senza incasso né simulato no; il banco mai', prova(async () => {
  ordine(70, { metodo: 'simulato', statoPag: 'pagato' }); // pagato in simulato: ricevuta di prova
  ordine(71, { metodo: 'simulato', statoPag: 'rimborsato' }); // blocco tornato: niente
  ordine(72, { metodo: 'stripe', statoPag: 'pagato' }); // Stripe senza un incasso registrato: niente (lo dice stripe_pagamenti, non la richiesta)
  ordine(73); // vecchio flusso: niente
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  const ricevute = Object.fromEntries(m.gruppi.flatMap((g) => g.ordini).map((o) => [o.id, o.ricevuta]));
  assert.deepEqual(ricevute, { 70: true, 71: false, 72: false, 73: false });
  // lato banco: nessun link alle ricevute dell'installatore
  const lato = await materiale.materialeOrdini({ clienteId: 1, distributorId: 2, mese: 'tutto', hrefOrdine: () => null });
  assert.ok(lato.gruppi.flatMap((g) => g.ordini).every((o) => o.ricevuta === false));
}));

test('ricevuta con Stripe: anche l\'ordine appena nato con la capture ancora da fare (da_incassare) ha il link, non il blocco annullato né quello solo autorizzato', prova(async () => {
  ordine(80, { metodo: 'stripe', statoPag: 'pagato' }); // capture da fare: la SQL lo include, la ricevuta c'è
  ordine(81, { metodo: 'stripe', statoPag: 'pagato' }); // nessuna riga che racconti un incasso
  richiesteConIncasso = [1080];
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  const ricevute = Object.fromEntries(m.gruppi.flatMap((g) => g.ordini).map((o) => [o.id, o.ricevuta]));
  assert.deepEqual(ricevute, { 80: true, 81: false });
  // la lettura sceglie le righe con la ricevuta: l'incasso fatto o poi rimborsato, e l'incasso da fare; mai autorizzato, rilasciato o scaduto
  const sql = chiamate.find((c) => /SELECT DISTINCT request_id FROM stripe_pagamenti/.test(c.s)).s;
  assert.match(sql, /incasso_cent > 0 AND stato IN \('da_incassare', 'incassato', 'da_rimborsare', 'rimborsato'\)/);
  assert.doesNotMatch(sql, /autorizzato|rilasciato|scaduto/);
}));
