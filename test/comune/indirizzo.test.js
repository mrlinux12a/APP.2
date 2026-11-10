// L'indirizzo di consegna a campi separati (src/comune/indirizzo.js) e come lo legge il flusso (flusso_cliente.destinazioneDaCorpo).
const test = require('node:test');
const assert = require('node:assert/strict');
const indirizzo = require('../../src/comune/indirizzo');

test('componi: via, civico, interno, CAP e città in una riga; senza interno niente "int."', () => {
  assert.equal(indirizzo.componi({ indirizzo: 'Via Puggia', civico: '22', interno: '3', cap: '16131', citta: 'Genova (GE)' }), 'Via Puggia 22 int. 3, 16131 Genova (GE)');
  assert.equal(indirizzo.componi({ indirizzo: 'Via Puggia', civico: '22/3', interno: '', cap: '16131', citta: 'Genova' }), 'Via Puggia 22/3, 16131 Genova');
});

test('leggiCampi: ripulisce spazi e a capo, taglia le lunghezze, accetta valori mancanti', () => {
  const c = indirizzo.leggiCampi({ indirizzo: '  Via   Puggia\n', civico: ' 22 ', cap: '1613199', citta: 'Genova', interno: undefined });
  assert.deepEqual(c, { indirizzo: 'Via Puggia', civico: '22', interno: '', cap: '16131', citta: 'Genova' });
  assert.deepEqual(indirizzo.leggiCampi(null), { indirizzo: '', civico: '', interno: '', cap: '', citta: '' });
});

test('haCampi: basta uno dei cinque; la sola `destinazione` (vecchi client) no', () => {
  assert.equal(indirizzo.haCampi({ cap: '' }), true);
  assert.equal(indirizzo.haCampi({ destinazione: 'Via Roma 1' }), false);
  assert.equal(indirizzo.haCampi(undefined), false);
});

test('campiMancanti: servono tutti, interno compreso; il CAP ha 5 cifre', () => {
  const ok = { indirizzo: 'Via Roma', civico: '1', interno: '2', cap: '16100', citta: 'Genova' };
  assert.deepEqual(indirizzo.campiMancanti(ok), []);
  assert.deepEqual(indirizzo.campiMancanti({ ...ok, indirizzo: '', civico: '', interno: '' }), ['indirizzo', 'civico', 'interno']);
  assert.deepEqual(indirizzo.campiMancanti({ ...ok, cap: '161' }), ['cap']);
  assert.deepEqual(indirizzo.campiMancanti({ ...ok, cap: 'abcde', citta: '' }), ['cap', 'citta']);
});
