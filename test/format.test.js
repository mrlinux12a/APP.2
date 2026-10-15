// Date brevi dello Storico (src/format.js): "Oggi · 21:20", "Ieri · 18:05", "12 set · 09:40" e il mese in ora italiana.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dataBreveRoma, dataCortaRoma, dataEstesaRoma, dataSolaRoma, meseRoma, durataMinuti, daMinuti, tempoTrascorso } = require('../src/format');

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

test('dataSolaRoma: giorno italiano gg/mm/aaaa, "—" se manca', () => {
  assert.equal(dataSolaRoma('2026-10-10 12:00:00'), '10/10/2026');
  // 22:30 UTC del 9 ottobre sono già le 00:30 del 10 a Roma
  assert.equal(dataSolaRoma('2026-10-09 22:30:00'), '10/10/2026');
  assert.equal(dataSolaRoma(new Date(2026, 9, 10, 12, 0)), '10/10/2026'); // come la leggerebbe pg
  assert.equal(dataSolaRoma(null), '—');
});

test('meseRoma: mese e anno in ora italiana, maiuscola iniziale', () => {
  assert.deepEqual(meseRoma('2026-10-05 19:20:00'), { chiave: '2026-10', titolo: 'Ottobre 2026' });
  assert.deepEqual(meseRoma('2025-02-10 14:00:00'), { chiave: '2025-02', titolo: 'Febbraio 2025' });
  // 22:30 UTC del 30 settembre sono già l'1 ottobre a Roma
  assert.deepEqual(meseRoma('2026-09-30 22:30:00'), { chiave: '2026-10', titolo: 'Ottobre 2026' });
  assert.deepEqual(meseRoma(null), { chiave: '', titolo: '—' });
});

test('dataCortaRoma: giorno e mese in ora italiana, senza "Oggi" né ora; l’anno solo se non è quello corrente', () => {
  assert.equal(dataCortaRoma('2026-09-12 07:40:00', adesso), '12 set');
  assert.equal(dataCortaRoma('2026-10-05 19:20:00', adesso), '5 ott'); // anche oggi: niente "Oggi"
  assert.equal(dataCortaRoma('2025-03-12 10:40:00', adesso), '12 mar 2025');
  // 23:30 UTC del 30 settembre sono già l'1 ottobre a Roma
  assert.equal(dataCortaRoma('2026-09-30 23:30:00', adesso), '1 ott');
  assert.equal(dataCortaRoma(new Date(2026, 8, 12, 7, 40), adesso), '12 set'); // come la leggerebbe pg
  assert.equal(dataCortaRoma(null, adesso), '—');
});

test('dataEstesaRoma: giorno della settimana e mese in italiano con la maiuscola, ora italiana; l’anno solo se non è quello corrente', () => {
  // 18:10 UTC del 14 ottobre 2026 sono le 20:10 a Roma (mercoledì)
  assert.equal(dataEstesaRoma('2026-10-14 18:10:00', new Date('2026-10-14T20:00:00Z')), 'Mercoledì 14 ottobre alle 20:10');
  assert.equal(dataEstesaRoma('2025-10-14 18:10:00', new Date('2026-10-14T20:00:00Z')), 'Martedì 14 ottobre 2025 alle 20:10');
  // 23:30 UTC del 31 dicembre sono già l'1 gennaio a Roma
  assert.equal(dataEstesaRoma('2026-12-31 23:30:00', new Date('2026-12-31T12:00:00Z')), 'Venerdì 1 gennaio 2027 alle 00:30');
  assert.equal(dataEstesaRoma(new Date(2026, 9, 14, 18, 10), new Date('2026-10-14T20:00:00Z')), 'Mercoledì 14 ottobre alle 20:10'); // come la leggerebbe pg
  assert.equal(dataEstesaRoma(null), '—');
});

test('durataMinuti, daMinuti e tempoTrascorso: i tempi della home e del dettaglio della richiesta', () => {
  assert.equal(durataMinuti(8), '8 min');
  assert.equal(durataMinuti(59), '59 min');
  assert.equal(durataMinuti(60), '1 h 00');
  assert.equal(durataMinuti(65), '1 h 05');
  assert.equal(durataMinuti(125), '2 h 05');
  // "da N min": sotto il minuto si dice "meno di 1 min"
  assert.equal(daMinuti(0), 'meno di 1 min');
  assert.equal(daMinuti(59), 'meno di 1 min');
  assert.equal(daMinuti(60), '1 min');
  assert.equal(daMinuti(253), '4 min');
  assert.equal(daMinuti(3905), '1 h 05');
  assert.equal(daMinuti(-5), 'meno di 1 min');
  assert.equal(daMinuti(null), 'meno di 1 min');
  // il cerchio dell'attesa: mm:ss che sale, "1 h 05" oltre l'ora
  assert.equal(tempoTrascorso(0), '00:00');
  assert.equal(tempoTrascorso(253), '04:13');
  assert.equal(tempoTrascorso(3599), '59:59');
  assert.equal(tempoTrascorso(3600), '1 h 00');
  assert.equal(tempoTrascorso(3905), '1 h 05');
  assert.equal(tempoTrascorso(-3), '00:00');
});

test('durataFinestraSec: la finestra di conferma, anche per una richiesta rinviata che ha ancora il creato_il di ore fa', () => {
  const { durataFinestraSec } = require('../src/format');
  const t = (iso) => new Date(iso + 'Z');
  // richiesta normale: scade_il = creato_il + 10 minuti
  assert.equal(durataFinestraSec(t('2026-10-15T10:00:00'), t('2026-10-15T10:10:00'), 10), 600);
  // finestra più corta di quella configurata (config cambiata dopo): resta quella vera della richiesta
  assert.equal(durataFinestraSec(t('2026-10-15T10:00:00'), t('2026-10-15T10:05:00'), 10), 300);
  // rinviata: creata alle 8, finestra ripartita alle 10:00 e scade alle 10:10 -> 2 ore e 10 di differenza, vale la finestra
  assert.equal(durataFinestraSec(t('2026-10-15T08:00:00'), t('2026-10-15T10:10:00'), 10), 600);
  assert.equal(durataFinestraSec(t('2026-10-15T08:00:00'), t('2026-10-15T10:10:00'), 15), 900);
  // dati mancanti o assurdi: la finestra (e 10 minuti se manca anche quella)
  assert.equal(durataFinestraSec(null, null, 10), 600);
  assert.equal(durataFinestraSec(t('2026-10-15T10:10:00'), t('2026-10-15T10:00:00'), 10), 600);
  assert.equal(durataFinestraSec(null, null, undefined), 600);
});
