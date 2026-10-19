// Pagina dell'ordine vista dal banco (src/ordine_banco.js): le parti che non toccano il DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ob = require(path.join(__dirname, '..', 'src/ordine_banco'));

const riga = (id, extra = {}) => ({
  id, quantita: 1, codice_snapshot: 'C' + id, nome_snapshot: 'Articolo ' + id, prezzo_netto_unitario: 54.5, subtotale: 54.5,
  raee_unitario: 0, raee_riga: 0, prezzo_unitario_cliente: 59.95, subtotale_cliente: 59.95, preso_il: null, ...extra,
});

test('righeMateriale: prezzo del banco (netto + RAEE), mai quello col servizio; spunte e conteggio', () => {
  const m = ob.righeMateriale([
    riga(1),
    riga(2, { quantita: 2, prezzo_netto_unitario: 100, subtotale: 200, raee_unitario: 1.5, raee_riga: 3, preso_il: new Date() }),
  ]);
  assert.deepEqual(m.righe.map((r) => [r.id, r.quantita, r.cad, r.totale, r.preso]), [[1, 1, 54.5, 54.5, false], [2, 2, 101.5, 203, true]]);
  assert.equal(m.presi, 1);
  assert.equal(m.tutti, false);
  assert.deepEqual(m.fuori, []);
  assert.ok(m.righe.every((r) => r.richiesti === null && r.confermati === null));
  // non esistono i prezzi col servizio fra i valori restituiti
  assert.doesNotMatch(JSON.stringify(m), /59[.,]95/);
});

test('righeMateriale: tutto spuntato, o niente da spuntare, vale "tutti"', () => {
  assert.equal(ob.righeMateriale([riga(1, { preso_il: new Date() }), riga(2, { preso_il: new Date() })]).tutti, true);
  const vuoto = ob.righeMateriale([]);
  assert.equal(vuoto.tutti, true);
  assert.deepEqual(vuoto.righe, []);
  assert.equal(ob.righeMateriale(undefined).tutti, true);
});

test('righeMateriale: le righe confermate a metà portano "richiesti / confermati"; quelle a zero vanno in `fuori`', () => {
  const mancanti = [
    { codice: 'C1', nome: 'Articolo 1', quantita_richiesta: 3, quantita_disponibile: 1, mancano: 2 },
    { codice: 'ZZ9', nome: 'Pompa', quantita_richiesta: 2, quantita_disponibile: 0, mancano: 2 },
  ];
  const m = ob.righeMateriale([riga(1), riga(2)], mancanti);
  assert.deepEqual(m.righe.map((r) => [r.richiesti, r.confermati]), [[3, 1], [null, null]]);
  assert.deepEqual(m.fuori.map((x) => x.codice), ['ZZ9']);
});

test('trasportoPredefinito: vettore col corriere; senza, mittente o destinatario secondo la modalità', () => {
  assert.equal(ob.trasportoPredefinito({ conCorriere: true, modalita: 'consegna_mezzo_grossista' }), 'vettore');
  assert.equal(ob.trasportoPredefinito({ conCorriere: true, modalita: 'ritiro' }), 'vettore');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false, modalita: 'consegna_mezzo_grossista' }), 'mittente');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false, modalita: 'ritiro' }), 'destinatario');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false }), 'mittente');
  assert.deepEqual(ob.ASPETTI, ['Colli', 'Bancali', 'Scatole', 'Sfuso']);
  assert.deepEqual(ob.CAUSALI, ['Vendita', 'Conto visione', 'Reso', 'Conto lavorazione']);
});

test('indirizzoDiviso, linkMaps, descrizioneConsegna e sottotitoloCliente', () => {
  assert.deepEqual(ob.indirizzoDiviso('Via Castel Morrone 1/7r, 16161 Genova (GE)'), { via: 'Via Castel Morrone 1/7r', resto: '16161 Genova (GE)' });
  assert.deepEqual(ob.indirizzoDiviso('Via Roma 3'), { via: 'Via Roma 3', resto: '' });
  assert.deepEqual(ob.indirizzoDiviso('Via A, 1, Genova'), { via: 'Via A', resto: '1, Genova' });
  assert.deepEqual(ob.indirizzoDiviso(null), { via: '', resto: '' });
  assert.equal(ob.linkMaps('Via Roma 3, 16121 Genova'), 'https://www.google.com/maps/search/?api=1&query=Via%20Roma%203%2C%2016121%20Genova');
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: true, corriereNome: 'Marco' }), 'Corriere Marco · ritiro al banco');
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: true, corriereNome: '' }), 'Corriere · ritiro al banco');
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: false }), 'Consegna con mezzo del banco');
  assert.equal(ob.descrizioneConsegna({ modalita: 'ritiro', conCorriere: false }), 'Ritiro al banco da parte del cliente');
  assert.equal(ob.sottotitoloCliente({ referente: 'Mario', partita_iva: '012' }), 'referente Mario · P. IVA 012');
  assert.equal(ob.sottotitoloCliente({ referente: '', partita_iva: '012' }), 'P. IVA 012');
  assert.equal(ob.sottotitoloCliente({ referente: 'Mario', partita_iva: null }), 'referente Mario');
  assert.equal(ob.sottotitoloCliente({}), '');
});

const riassunto = (passi) => passi.map((p) => [p.chiave, p.fase]);
const corriere = { nome: 'Marco', ora: '09:24' };

test('passiOrdine: la pagina è per un ordine "Da preparare" — conferma e corriere fatti, "Da preparare" (blu) in corso, poi In consegna e Consegnato', () => {
  const passi = ob.passiOrdine({ oraConferma: '09:20', corriere, oraRitiro: '09:45' });
  assert.deepEqual(riassunto(passi), [['conferma', 'fatto'], ['corriere', 'fatto'], ['preparare', 'corrente'], ['consegna', 'futuro'], ['consegnato', 'futuro']]);
  assert.deepEqual(passi.map((p) => [p.titolo, p.testo]), [
    ['Confermato da te', 'Alle 09:20'],
    ['Corriere trovato', 'Marco ha accettato alle 09:24'],
    ['Da preparare', 'Ritiro alle 09:45'],
    ['In consegna', 'La merce passa al corriere'],
    ['Consegnato', 'Lo conferma il cliente'],
  ]);
  // i toni: verde per ciò che è fatto e per la consegna, blu per "Da preparare" (come la pillola)
  assert.deepEqual(passi.map((p) => p.tono), ['verde', 'verde', 'blu', 'verde', 'verde']);
  // niente più "In preparazione" né "Partito"
  assert.doesNotMatch(JSON.stringify(passi), /In preparazione|Partito/);
});

test('passiOrdine: senza corriere (WhatsApp spento) quel passo non c\'è e "Da preparare" non promette un orario', () => {
  const passi = ob.passiOrdine({ oraConferma: '09:20' });
  assert.deepEqual(riassunto(passi), [['conferma', 'fatto'], ['preparare', 'corrente'], ['consegna', 'futuro'], ['consegnato', 'futuro']]);
  assert.equal(passi[1].testo, 'Prepara la merce e la bolla');
  assert.equal(passi[0].testo, 'Alle 09:20');
  // senza nemmeno l'ora della conferma
  assert.equal(ob.passiOrdine({ oraConferma: '—' })[0].testo, 'Fatto');
  assert.equal(ob.passiOrdine({})[0].testo, 'Fatto');
});

test('passiOrdine: il testo del corriere con i pezzi che mancano', () => {
  const testo = (c) => ob.passiOrdine({ corriere: c })[1].testo;
  assert.equal(testo({ nome: 'Marco', ora: '' }), 'Marco ha accettato');
  assert.equal(testo({ nome: '', ora: '09:24' }), 'Un corriere ha accettato alle 09:24');
  assert.equal(testo({ nome: '', ora: '' }), 'Un corriere ha accettato');
  assert.equal(testo({ nome: 'Marco', ora: '—' }), 'Marco ha accettato');
});
