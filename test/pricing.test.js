// Prove del calcolo di quello che paga l'installatore (src/pricing.js: dividiTotale e calcolaOrdine). DB finto per la configurazione:
// nessun accesso al database vero. Si lancia con `npm test`.
//
// La regola (la stessa scritta sopra calcolaOrdine):
//   paga ORA in app   = corriere fisso + servizio (servizio_pct della merce a prezzo del banco, IVA esclusa) + IVA su (corriere + servizio)
//   paga DOPO a BOREA = merce a prezzo del banco (+ RAEE) + IVA su quella somma
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const config = { servizio_pct: '10', iva_pct: '22', spedizione_fissa: '10', ordine_minimo: '33' };
const dbFinto = {
  prepare: (sql) => {
    const esegui = async (...p) => (/FROM config WHERE chiave/.test(sql) ? (config[p[0]] !== undefined ? [{ valore: config[p[0]] }] : []) : []);
    return { all: esegui, get: async (...p) => (await esegui(...p))[0] || null, run: async () => ({ changes: 0 }) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const pricing = require('../src/pricing');
const arrotonda = pricing.round2;
// La cache della configurazione (60 s) tiene i valori: per provare un'altra percentuale si sostituiscono le due letture.
const prodotto = (id, listino, { sconto = 0, raee = 0 } = {}) => ({ id, codice: 'C' + id, nome: 'P' + id, prezzo_listino: listino, sconto_base_pct: sconto, raee });
const riga = (p, quantita) => ({ prodotto: p, quantita });

test('dividiTotale: l\'esempio della specifica — merce 64,50: servizio 6,45, in app 20,07, materiale 78,69, spesa 98,76', () => {
  const d = pricing.dividiTotale({ netto: 64.5, raee: 0, consegna: 10, servizioPct: 10, ivaPct: 22 });
  assert.deepEqual(d.app, { corriere: 10, servizio: 6.45, imponibile: 16.45, iva: 3.62, totale: 20.07 });
  assert.deepEqual(d.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  assert.equal(d.servizio, 6.45);
  assert.equal(arrotonda(d.app.totale + d.banco.totale), 98.76);
  assert.deepEqual([d.servizioPct, d.ivaPct], [10, 22]);
});

test('calcolaOrdine: 54,50 + 10,00 di merce -> consegna 10,00 + servizio 6,45 + IVA 3,62 = 20,07; materiale 64,50 + IVA 14,19 = 78,69; spesa 98,76', async () => {
  const t = await pricing.calcolaOrdine([riga(prodotto(1, 54.5), 1), riga(prodotto(2, 10), 1)], { costoConsegna: 10 });
  assert.equal(t.totale_netto, 64.5, 'la merce è a prezzo del banco');
  assert.deepEqual(t.app, { corriere: 10, servizio: 6.45, imponibile: 16.45, iva: 3.62, totale: 20.07 });
  assert.deepEqual(t.banco, { merce: 64.5, raee: 0, imponibile: 64.5, iva: 14.19, totale: 78.69 });
  // i valori "piatti" coincidono con le voci, centesimo per centesimo
  assert.equal(t.da_pagare_app, t.app.totale);
  assert.equal(t.materiale_banco, t.banco.totale);
  assert.equal(t.totale_ivato, 98.76, 'spesa complessiva = app.totale + banco.totale');
  assert.equal(t.totale_ivato, arrotonda(t.app.totale + t.banco.totale));
  assert.equal(t.imponibile, arrotonda(t.app.imponibile + t.banco.imponibile));
  assert.equal(t.iva, arrotonda(t.app.iva + t.banco.iva));
  assert.equal(t.servizio, 6.45);
  assert.deepEqual([t.servizioPct, t.ivaPct], [10, 22]);
  // la somma delle righe (a prezzo del banco) è esattamente la "Merce"
  assert.equal(arrotonda(t.righe.reduce((s, r) => s + r.subtotale, 0)), t.banco.merce);
});

test('il servizio è ESATTAMENTE il 10% della merce, non la somma di righe arrotondate una per una', async () => {
  // 50 pezzi a 33,33: merce 1.666,50. Il prezzo col 10% arrotondato per pezzo (36,66) darebbe 166,50 di servizio invece di 166,65.
  const t = await pricing.calcolaOrdine([riga(prodotto(1, 33.33), 50)], { costoConsegna: 10 });
  assert.equal(t.totale_netto, 1666.5);
  assert.equal(t.servizio, 166.65);
  assert.equal(t.app.servizio, 166.65);
  assert.equal(t.app.imponibile, 176.65);
  // quello che si salva in order_items resta come prima: prezzo e subtotale col 10% (arrotondati per riga)
  assert.equal(t.righe[0].prezzo_unitario_cliente, 36.66);
  assert.equal(t.righe[0].subtotale_cliente, 1833);
  assert.equal(t.totale_finale, 1833, 'la merce col servizio, come si salva sull\'ordine');
  assert.equal(t.righe[0].prezzo_netto_unitario, 33.33);
});

test('RAEE: sta solo nel Materiale (con la sua IVA), mai nella consegna', async () => {
  const t = await pricing.calcolaOrdine([riga(prodotto(1, 100, { raee: 2.5 }), 2)], { costoConsegna: 10 });
  assert.equal(t.contributo_raee, 5);
  assert.deepEqual(t.banco, { merce: 200, raee: 5, imponibile: 205, iva: 45.1, totale: 250.1 });
  assert.deepEqual(t.app, { corriere: 10, servizio: 20, imponibile: 30, iva: 6.6, totale: 36.6 });
  assert.equal(t.da_pagare_app, 36.6);
  assert.equal(t.materiale_banco, 250.1);
  assert.equal(t.totale_ivato, 286.7);
});

test('lo sconto del banco entra nel prezzo del banco: listino − sconto, e il servizio è il 10% di quello', async () => {
  const t = await pricing.calcolaOrdine([riga(prodotto(1, 10, { sconto: 30 }), 50)], { costoConsegna: 10 });
  assert.equal(t.righe[0].prezzo_netto_unitario, 7);
  assert.equal(t.totale_netto, 350);
  assert.equal(t.servizio, 35);
  assert.equal(t.da_pagare_app, 54.9); // (10 + 35) × 1,22
  assert.equal(t.materiale_banco, 427); // 350 × 1,22
  assert.equal(t.totale_ivato, 481.9);
});

test('carrello vuoto: tutto a zero tranne la consegna (che l\'ordine minimo impedisce di pagare)', async () => {
  const t = await pricing.calcolaOrdine([], { costoConsegna: 10 });
  assert.equal(t.totale_netto, 0);
  assert.equal(t.servizio, 0);
  assert.equal(t.banco.totale, 0);
  assert.equal(t.app.totale, 12.2);
});

test('prezzoNetto: il prezzo che si mostra a chi sfoglia il catalogo è quello del banco, uguale a prezzo_netto_unitario del carrello', async () => {
  const p = prodotto(1, 54.5, { sconto: 12.5 });
  const t = await pricing.calcolaOrdine([riga(p, 1)], { costoConsegna: 10 });
  assert.equal(pricing.prezzoNetto(p), 47.69);
  assert.equal(t.righe[0].prezzo_netto_unitario, pricing.prezzoNetto(p), 'catalogo e carrello dicono lo stesso prezzo');
});

// ---- importiOrdine: gli importi di un ordine già nato, uguali dappertutto (pagina dell'ordine, richiesta, Storico, pagina del cliente lato banco)

// Le colonne che flusso_cliente scrive in orders alla nascita dell'ordine, prese da calcolaOrdine.
const colonneSalvate = (t, extra = {}) => ({
  totale_netto: t.totale_netto, totale_finale: t.totale_finale, costo_consegna: t.app.corriere, contributo_raee: t.banco.raee, iva: t.iva,
  servizio: t.servizio, imponibile_app: t.app.imponibile, iva_app: t.app.iva, da_pagare_app: t.da_pagare_app,
  imponibile_banco: t.banco.imponibile, iva_banco: t.banco.iva, materiale_banco: t.materiale_banco, ...extra,
});
// Un ordine di PRIMA delle colonne nuove (a zero nel DB): solo i valori che c'erano già.
const ordineVecchio = (extra = {}) => ({
  totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81,
  servizio: 0, imponibile_app: 0, iva_app: 0, da_pagare_app: 0, imponibile_banco: 0, iva_banco: 0, materiale_banco: 0, ...extra,
});

test('importiOrdine, ordine NUOVO: usa le colonne salvate, e sono quelle di calcolaOrdine (54,50 + 10,00 -> 20,07 in app, 78,69 al banco)', async () => {
  const t = await pricing.calcolaOrdine([riga(prodotto(1, 54.5), 1), riga(prodotto(2, 10), 1)], { costoConsegna: 10 });
  const i = pricing.importiOrdine(colonneSalvate(t), null, 22);
  const { conPagamento, pagatoIl, rimborsato, rimborsatoIl, metodo, ...parteApp } = i.app;
  assert.deepEqual(parteApp, t.app);
  assert.equal(conPagamento, false, 'senza pagamento la consegna non dice "pagata"');
  assert.deepEqual(i.banco, t.banco);
  assert.equal(i.app.corriere, 10);
  assert.equal(i.app.servizio, 6.45);
  assert.equal(i.app.iva, 3.62);
  assert.equal(i.app.totale, 20.07);
  assert.equal(i.banco.merce, 64.5);
  assert.equal(i.banco.iva, 14.19);
  assert.equal(i.banco.totale, 78.69);
  assert.equal(i.servizioPct, 10, 'la % si ricava da servizio / merce');
  assert.equal(i.ivaPct, 22);
});

test('importiOrdine, ordine VECCHIO (colonne a zero): si ricalcola e dà gli stessi importi di uno nuovo', () => {
  const i = pricing.importiOrdine(ordineVecchio(), null, 22, 10);
  assert.equal(i.app.corriere, 10);
  assert.equal(i.app.servizio, 6.45, 'totale_finale − totale_netto');
  assert.equal(i.app.imponibile, 16.45);
  assert.equal(i.app.iva, 3.62);
  assert.equal(i.app.totale, 20.07);
  assert.equal(i.banco.merce, 64.5);
  assert.equal(i.banco.imponibile, 64.5);
  assert.equal(i.banco.iva, 14.19);
  assert.equal(i.banco.totale, 78.69);
  assert.equal(i.servizioPct, 10);
  // senza la % di configurazione per gli ordini vecchi si ricava comunque dall'ordine
  assert.equal(pricing.importiOrdine(ordineVecchio(), null, 22).servizioPct, 10);
});

test('importiOrdine, RAEE: sta solo nel materiale, con la sua IVA, anche nei vecchi', () => {
  const i = pricing.importiOrdine(ordineVecchio({ contributo_raee: 1.2, iva: 18.07 }), null, 22, 10);
  assert.equal(i.banco.raee, 1.2);
  assert.equal(i.banco.imponibile, 65.7);
  assert.equal(i.banco.iva, 14.45);
  assert.equal(i.banco.totale, 80.15);
  assert.equal(i.app.totale, 20.07, 'la consegna non cambia');
});

test('importiOrdine, pagamento: l\'importo davvero addebitato, la data e il rimborso', () => {
  const pag = (extra) => ({ stato: 'pagato', metodo: 'stripe', importo: 20.07, pagato_il: '2026-10-15T10:00:00Z', ...extra });
  let i = pricing.importiOrdine(ordineVecchio(), pag(), 22, 10);
  assert.equal(i.app.totale, 20.07);
  assert.equal(i.app.pagatoIl, '2026-10-15T10:00:00Z');
  assert.equal(i.app.rimborsato, false);
  assert.equal(i.app.metodo, 'stripe');
  // un centesimo in meno (incasso con Stripe): vale quello che è stato incassato
  assert.equal(pricing.importiOrdine(ordineVecchio(), pag({ importo: 20.06 }), 22, 10).app.totale, 20.06);
  // un ordine di prima pagato INTERO in app (consegna + materiale): non è la consegna, vale il calcolo
  i = pricing.importiOrdine(ordineVecchio(), pag({ importo: 98.76 }), 22, 10);
  assert.equal(i.app.totale, 20.07);
  assert.equal(i.banco.totale, 78.69);
  // senza importo (vecchio flusso) o a zero: il calcolo
  assert.equal(pricing.importiOrdine(ordineVecchio(), pag({ importo: 0 }), 22, 10).app.totale, 20.07);
  assert.equal(pricing.importiOrdine(ordineVecchio(), pag({ importo: null }), 22, 10).app.totale, 20.07);
  // rimborsata
  i = pricing.importiOrdine(ordineVecchio(), pag({ stato: 'rimborsato' }), 22, 10);
  assert.equal(i.app.rimborsato, true);
  assert.equal(i.app.totale, 20.07, 'la cifra resta quella pagata, è la scheda a dire "Rimborsata"');
});

test('ivaPctOrdine: dai valori SALVATI dell\'ordine, non da quelli di oggi', () => {
  // colonne nuove: (iva_app + iva_banco) / (imponibile_app + imponibile_banco)
  assert.equal(pricing.ivaPctOrdine({ imponibile_app: 16.45, iva_app: 3.62, imponibile_banco: 64.5, iva_banco: 14.19 }, 99), 22);
  // un'IVA diversa da quella di configurazione (ordine fatto con l'aliquota di allora)
  assert.equal(pricing.ivaPctOrdine({ imponibile_app: 10, iva_app: 1, imponibile_banco: 90, iva_banco: 9 }, 22), 10);
  // ordine vecchio: iva / (totale_finale + RAEE + consegna)
  assert.equal(pricing.ivaPctOrdine(ordineVecchio(), 99), 22);
  // niente di salvato: la configurazione
  assert.equal(pricing.ivaPctOrdine({ totale_finale: 70.95, iva: 0 }, 22), 22);
  assert.equal(pricing.ivaPctOrdine({}, 22), 22);
});
