// Il dettaglio che si apre sotto una riga dello Storico del banco (src/storico_dettaglio.js): le parti che non toccano il DB, più due guardie
// sulle colonne che la lista legge per il "Da incassare". La pagina intera (e la rotta) si prova in test/server.test.js, con il DB finto.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// pricing.js carica il DB in testa: qui un DB finto (nessun accesso al database vero), come in test/pricing.test.js.
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

const sd = require('../src/storico_dettaglio');
const sb = require('../src/storico_banco');
const pricing = require('../src/pricing');

// 19/10/2026 hh:mm UTC = hh+2:mm a Roma (ora legale). Le colonne TIMESTAMP si leggono "naive", le TIMESTAMPTZ (corriere_*) sono istanti veri.
const alle = (h, m, g = 19) => new Date(Date.UTC(2026, 9, g, h, m));
const naive = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());

const ordine = (extra = {}) => ({
  id: 149, cliente_id: 7, distributor_id: 2, request_id: 177, stato: 'in_evasione', modalita: 'consegna_mezzo_grossista',
  creato_il: naive(alle(8, 28)), in_evasione_il: naive(alle(8, 47)), consegnato_il: null,
  // il corriere ha risposto alle 08:34 UTC (10:34 a Roma) scrivendo "preso 30": arriva dal banco alle 11:04. corriere_arrivo_il (ritiro + tragitto) è l'arrivo dal CLIENTE:
  // il banco non lo vede mai.
  corriere_nome: 'Marco', corriere_risposto_il: alle(8, 34), corriere_minuti: 30, corriere_arrivo_il: alle(9, 21),
  totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81,
  servizio: 6.45, imponibile_app: 16.45, iva_app: 3.62, da_pagare_app: 20.07, imponibile_banco: 64.5, iva_banco: 14.19, materiale_banco: 78.69,
  ...extra,
});
const risposta = { risposto_il: naive(alle(8, 29)), copertura: 'totale' };
const riga = (id, extra = {}) => ({
  id, quantita: 1, codice_snapshot: 'C' + id, nome_snapshot: 'Articolo ' + id, prezzo_netto_unitario: 54.5, subtotale: 54.5, raee_unitario: 0, raee_riga: 0,
  prezzo_unitario_cliente: 59.95, subtotale_cliente: 59.95, ...extra,
});
const sintesi = (passi) => passi.map((p) => [p.testo, p.fase, p.ora, p.giorno]);

test('cronologia, consegnato: Ricevuto, Confermato, Corriere (con l\'ora in cui ritira), Partito e Consegnato, tutti fatti, in ora italiana', () => {
  const p = sd.cronologia(ordine({ consegnato_il: naive(alle(9, 21)) }), { risposta, corriereNome: 'Marco' });
  assert.deepEqual(sintesi(p), [
    ['Ricevuto', 'fatto', '10:28', ''],
    ['Confermato da te', 'fatto', '10:29', ''],
    ['Corriere Marco ha accettato, ritira alle 11:04', 'fatto', '10:34', ''],
    ['Partito', 'fatto', '10:47', ''],
    ['Consegnato · confermato dal cliente', 'fatto', '11:21', ''],
  ]);
  assert.equal(p[0].completo, '19/10/2026 alle 10:28', 'la data per intero sta nel suggerimento dell\'ora');
});

test('cronologia, in consegna: "Partito · in viaggio" è il passo in corso; Consegnato futuro con l\'ora vuota; nessun orario di arrivo dal cliente', () => {
  const p = sd.cronologia(ordine(), { risposta, corriereNome: 'Marco' });
  assert.deepEqual(sintesi(p).slice(3), [
    ['Partito · in viaggio', 'corrente', '10:47', ''],
    ['Consegnato', 'futuro', '', ''],
  ]);
  // il banco vede solo il tempo scritto dal corriere su WhatsApp (ritira alle 11:04), mai l'arrivo dal cliente (corriere_arrivo_il = 11:21)
  assert.doesNotMatch(JSON.stringify(p), /arrivo|11:21/);
  // un ordine vecchio (stato `evaso`) ha evaso_il al posto di in_evasione_il
  const vecchio = sd.cronologia(ordine({ stato: 'evaso', in_evasione_il: null, evaso_il: naive(alle(8, 50)) }), { risposta, corriereNome: 'Marco' });
  assert.deepEqual(sintesi(vecchio).slice(3), [['Partito · in viaggio', 'corrente', '10:50', ''], ['Consegnato', 'futuro', '', '']]);
  // senza i minuti del corriere il passo del corriere non dice quando ritira
  const senzaMinuti = sd.cronologia(ordine({ corriere_minuti: null }), { risposta, corriereNome: 'Marco' });
  assert.equal(senzaMinuti[2].testo, 'Corriere Marco ha accettato');
  // il ritiro il giorno dopo: col giorno
  const domani = sd.cronologia(ordine({ corriere_risposto_il: alle(21, 40), corriere_minuti: 60 }), { risposta, corriereNome: 'Marco' });
  assert.equal(domani[2].testo, 'Corriere Marco ha accettato, ritira il 20/10 alle 00:40');
});

test('cronologia, da preparare: Partito e Consegnato ancora da venire; un passo senza dati (niente corriere, niente richiesta) non si scrive', () => {
  const p = sd.cronologia(ordine({ stato: 'inviato', in_evasione_il: null, corriere_nome: '', corriere_risposto_il: null, corriere_minuti: null, corriere_arrivo_il: null }), { risposta });
  assert.deepEqual(sintesi(p), [['Ricevuto', 'fatto', '10:28', ''], ['Confermato da te', 'fatto', '10:29', ''], ['Partito', 'futuro', '', ''], ['Consegnato', 'futuro', '', '']]);
  const senzaRichiesta = sd.cronologia(ordine({ stato: 'inviato', in_evasione_il: null, corriere_nome: '', corriere_risposto_il: null }), { risposta: null });
  assert.deepEqual(senzaRichiesta.map((x) => x.testo), ['Ricevuto', 'Partito', 'Consegnato']);
  // un corriere con il nome ma senza l'ora in cui ha accettato: il passo c'è, l'ora è vuota
  const senzaOra = sd.cronologia(ordine({ stato: 'inviato', in_evasione_il: null, corriere_risposto_il: null }), { risposta, corriereNome: 'Marco' });
  assert.deepEqual(senzaOra.filter((x) => x.chiave === 'corriere').map((x) => [x.testo, x.ora]), [['Corriere Marco ha accettato', '']]);
});

test('cronologia, consegnato senza essere mai partito (consegna provvisoria): niente "Partito"; consegnato il giorno dopo: col giorno', () => {
  const p = sd.cronologia(ordine({ stato: 'inviato', in_evasione_il: null, consegnato_il: naive(alle(9, 21)) }), { risposta, corriereNome: 'Marco' });
  assert.deepEqual(p.map((x) => x.testo), ['Ricevuto', 'Confermato da te', 'Corriere Marco ha accettato, ritira alle 11:04', 'Consegnato · confermato dal cliente']);
  const domani = sd.cronologia(ordine({ consegnato_il: naive(alle(22, 40)) }), { risposta, corriereNome: 'Marco' });
  assert.deepEqual([domani[domani.length - 1].ora, domani[domani.length - 1].giorno], ['00:40', '20/10']);
});

test('contaMateriale: "2 articoli · 2 pezzi", "1 articolo · 1 pezzo", pezzi sommati', () => {
  assert.equal(sd.contaMateriale([riga(1), riga(2)]), '2 articoli · 2 pezzi');
  assert.equal(sd.contaMateriale([riga(1)]), '1 articolo · 1 pezzo');
  assert.equal(sd.contaMateriale([riga(1, { quantita: 4 }), riga(2, { quantita: 2 })]), '2 articoli · 6 pezzi');
  assert.equal(sd.contaMateriale([]), '0 articoli · 0 pezzi');
});

test('rigaCorriere: "Corriere Marco"; senza nome ma con corriere "Corriere"; il ritiro del cliente; niente se non c\'è nessuno', () => {
  assert.equal(sd.rigaCorriere(ordine(), 'Marco'), 'Corriere Marco');
  assert.equal(sd.rigaCorriere(ordine(), ''), 'Corriere');
  assert.equal(sd.rigaCorriere(ordine({ corriere_arrivo_il: null, corriere_risposto_il: null }), ''), '');
  assert.equal(sd.rigaCorriere(ordine({ modalita: 'ritiro' }), 'Marco'), 'Ritiro al banco da parte del cliente');
});

test('costruisciDettaglio: righe e totale a prezzo del banco (78,69, mai 59,95 né 98,76), stato, scheda cliente solo con il legame; nessuna bolla', () => {
  const d = sd.costruisciDettaglio({
    ordine: ordine({ consegnato_il: naive(alle(9, 21)) }), righe: [riga(1), riga(2, { prezzo_netto_unitario: 10, subtotale: 10 })],
    risposta, destinazione: 'Via Castel Morrone 1/7r, 16161 Genova (GE)', ivaConfig: 22, legame: { id: 1 },
  });
  assert.deepEqual(d.materiale.righe.map((r) => [r.quantita, r.cad, r.totale]), [[1, 54.5, 54.5], [1, 10, 10]]);
  assert.deepEqual([d.banco.merce, d.banco.iva, d.banco.totale, d.ivaPct], [64.5, 14.19, 78.69, 22]);
  assert.equal(d.conta, '2 articoli · 2 pezzi');
  assert.equal(d.stato.chiave, 'consegnato');
  assert.equal('bolla' in d, false, 'la bolla non esiste più');
  assert.equal(d.corriere, 'Corriere Marco');
  assert.equal(d.destinazione, 'Via Castel Morrone 1/7r, 16161 Genova (GE)');
  assert.equal(d.schedaClienteAperta, true);
  assert.doesNotMatch(JSON.stringify(d), /59[.,]95|98[.,]76/);
  const senza = sd.costruisciDettaglio({ ordine: ordine(), righe: [], ivaConfig: 22, legame: null });
  assert.equal(senza.schedaClienteAperta, false);
  assert.equal(senza.conta, '0 articoli · 0 pezzi');
});

test('costruisciDettaglio: un ordine vecchio (importi non salvati) si ricalcola dalla merce con l\'IVA salvata nell\'ordine', () => {
  const vecchio = ordine({ totale_netto: 54, totale_finale: 59.4, costo_consegna: 0, contributo_raee: 0, iva: 13.07, servizio: 0, imponibile_app: 0, iva_app: 0, da_pagare_app: 0, imponibile_banco: 0, iva_banco: 0, materiale_banco: 0 });
  const d = sd.costruisciDettaglio({ ordine: vecchio, righe: [riga(1)], ivaConfig: 10 });
  // iva 13,07 su 59,40 = 22%: vale l'IVA dell'ordine, non quella di oggi (10)
  assert.equal(d.ivaPct, 22);
  assert.deepEqual([d.banco.merce, d.banco.iva, d.banco.totale], [54, 11.88, 65.88]);
});

// Guardia: la lista dello Storico legge solo le colonne elencate in COLONNE_IMPORTI. Se pricing.importiOrdine o ivaPctOrdine cominciano a usare
// un'altra colonna dell'ordine, e qui non c'è, "Da incassare" tornerebbe sbagliato in silenzio (0 al posto del valore) solo nella lista.
test('COLONNE_IMPORTI: ogni colonna dell\'ordine che importiOrdine e ivaPctOrdine leggono è nella SELECT della lista', () => {
  const sorgente = pricing.importiOrdine.toString() + pricing.ivaPctOrdine.toString();
  const lette = new Set([...sorgente.matchAll(/\b(?:ordine|o)\.([a-z_]+)/g)].map((m) => m[1]));
  const nellaLista = new Set(sb.COLONNE_IMPORTI.split(', ').map((c) => c.replace(/^o\./, '')));
  assert.ok(lette.size >= 10, 'la regex deve trovare le colonne (sono ' + [...lette].join(', ') + ')');
  assert.deepEqual([...lette].filter((c) => !nellaLista.has(c)), [], 'colonne lette dal calcolo e non lette dalla lista');
});
