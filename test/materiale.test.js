// Prove del calcolo del materiale (src/materiale.js) e dell'importo che si paga in app (pricing.calcolaOrdine: servizio + consegna).
// DB finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

let ordini = [];
let righe = [];
let richieste = [];
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
function ordine(id, { cliente = 1, banco = 2, ditta = 'BOREA SRL', data = quando(2026, 10, 15), stato = 'evaso', consegnato = false, netto = 100, qta = 1, raee = 0, addebitato = null } = {}) {
  const subtotale = netto * qta;
  const cliente_ = Math.round(subtotale * 1.1 * 100) / 100;
  const imponibile = cliente_ + raee * qta + 10;
  ordini.push({
    id, cliente_id: cliente, creato_il: data, stato, consegnato_il: consegnato ? data : null, distributor_id: banco, costo_consegna: 10, totale_netto: subtotale,
    contributo_raee: raee * qta, iva: Math.round(imponibile * 0.22 * 100) / 100, totale_finale: cliente_, distributore_nome: ditta, pagamento_importo: addebitato,
  });
  righe.push({
    order_id: id, product_id: id, codice_snapshot: 'C' + id, nome_snapshot: 'Articolo ' + id, quantita: qta, prezzo_netto_unitario: netto,
    subtotale, subtotale_cliente: cliente_, raee_unitario: raee, raee_riga: raee * qta,
  });
}
const prova = (f) => async () => { ordini = []; righe = []; richieste = []; chiamate.length = 0; await f(); };

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

test('stato dell\'ordine: Consegnato, In consegna (partito), In preparazione (inviato o in preparazione)', prova(async () => {
  ordine(30, { consegnato: true });
  ordine(31, { stato: 'evaso' });
  ordine(32, { stato: 'in_evasione' });
  ordine(33, { stato: 'inviato' });
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: '2026-10' });
  const stati = Object.fromEntries(m.gruppi[0].ordini.map((o) => [o.id, o.stato.etichetta]));
  assert.deepEqual(stati, { 30: 'Consegnato', 31: 'In consegna', 32: 'In preparazione', 33: 'In preparazione' });
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
  const m = await materiale.materialeOrdini({ clienteId: 1, mese: 'tutto' });
  assert.deepEqual(m.gruppi.map((g) => [g.nome, g.riepilogo.nOrdini, g.riepilogo.totale]), [['AFIS SPA', 1, 61], ['BOREA SRL', 1, 122]] /* la ditta con l'ordine più recente per prima */);
  assert.equal(m.riepilogo.totale, 183);
  assert.deepEqual(m.senzaOrdine.map((r) => [r.id, r.etichetta, r.tono]), [[7, 'Nessuna risposta', 'nessuna'], [8, 'Annullata', 'annullata']]);
  assert.deepEqual(m.ditte, ['AFIS SPA', 'BOREA SRL']);
  // il banco: solo i suoi ordini, niente richieste senza ordine, niente Riordina, nessun link se non lo vuole
  const lato = await materiale.materialeOrdini({ clienteId: 1, distributorId: 1, mese: 'tutto', hrefOrdine: () => null });
  assert.deepEqual(lato.gruppi.map((g) => g.nome), ['AFIS SPA']);
  assert.deepEqual(lato.senzaOrdine, []);
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
  assert.equal(linee[1], '15/10/2026;#100;In consegna;C100;"\'- Materiale; ""speciale""";1;122,00;122,00;24,40');
  assert.equal(linee[2], 'Totale;;;;;;;122,00;24,40');
  assert.equal(materiale.nomeFileCsv(m), 'materiale-2026-10.csv');
  assert.equal(materiale.nomeFileCsv({ mese: 'tutto' }), 'materiale-tutto.csv');
}));
