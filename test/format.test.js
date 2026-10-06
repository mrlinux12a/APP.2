// Date brevi dello Storico (src/format.js): "Oggi · 21:20", "Ieri · 18:05", "12 set · 09:40" e il mese in ora italiana.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dataBreveRoma, meseRoma } = require('../src/format');

// Le colonne TIMESTAMP sono UTC senza fuso: a Roma d'estate (ottobre) sono +2 ore, d'inverno +1.
const adesso = new Date('2026-10-05T20:00:00Z');

test('dataBreveRoma: oggi, ieri, data e ora italiane', () => {
  assert.equal(dataBreveRoma('2026-10-05 19:20:00', adesso), 'Oggi · 21:20');
  assert.equal(dataBreveRoma('2026-10-04 16:05:00', adesso), 'Ieri · 18:05');
  assert.equal(dataBreveRoma('2026-09-12 07:40:00', adesso), '12 set · 09:40');
});

test('dataBreveRoma: il giorno cambia a mezzanotte italiana, non UTC', () => {
  // 22:30 UTC del 4 ottobre sono le 00:30 del 5 a Roma: è "Oggi"
  assert.equal(dataBreveRoma('2026-10-04 22:30:00', adesso), 'Oggi · 00:30');
  // 21:59 UTC del 4 ottobre sono le 23:59 del 4 a Roma: è "Ieri"
  assert.equal(dataBreveRoma('2026-10-04 21:59:00', adesso), 'Ieri · 23:59');
});

test('dataBreveRoma: con l’anno solo se non è quello corrente; d’inverno +1 ora', () => {
  assert.equal(dataBreveRoma('2025-03-12 10:40:00', adesso), '12 mar 2025 · 11:40');
  assert.equal(dataBreveRoma('2026-01-02 08:05:00', adesso), '2 gen · 09:05');
});

test('dataBreveRoma: una Date come la leggerebbe pg vale quanto la stringa UTC, in qualunque fuso del PC', () => {
  // pg legge "2026-10-05 19:20:00" come ora locale del processo: i componenti locali sono quelli UTC
  assert.equal(dataBreveRoma(new Date(2026, 9, 5, 19, 20), adesso), 'Oggi · 21:20');
});

test('dataBreveRoma: valore assente', () => {
  assert.equal(dataBreveRoma(null, adesso), '—');
  assert.equal(dataBreveRoma('niente', adesso), '—');
});

test('meseRoma: mese e anno in ora italiana, maiuscola iniziale', () => {
  assert.deepEqual(meseRoma('2026-10-05 19:20:00'), { chiave: '2026-10', titolo: 'Ottobre 2026' });
  assert.deepEqual(meseRoma('2025-02-10 14:00:00'), { chiave: '2025-02', titolo: 'Febbraio 2025' });
  // 22:30 UTC del 30 settembre sono già l'1 ottobre a Roma
  assert.deepEqual(meseRoma('2026-09-30 22:30:00'), { chiave: '2026-10', titolo: 'Ottobre 2026' });
  assert.deepEqual(meseRoma(null), { chiave: '', titolo: '—' });
});
