// Prove degli orari del banco (src/orari.js): funzioni pure, nessun DB. Le date sono istanti UTC scelti perché a Roma cadano dove serve
// (ottobre 2026: ora legale, UTC+2; dicembre: ora solare, UTC+1). Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const orari = require('../src/orari');

const FASCE = [['07:30', '12:30'], ['14:00', '18:00']];
const SETTIMANA = {
  lun: FASCE, mar: FASCE, mer: FASCE, gio: FASCE, ven: FASCE,
  sab: [['07:30', '12:00']],
  dom: [],
};
// Roma, 19 ottobre 2026 = lunedì. `a(giorno, ore, minuti)`: quel giorno della settimana di quella settimana (19 = lun ... 25 = dom) a quell'ora di Roma.
const a = (giorno, ore, minuti = 0) => new Date(Date.UTC(2026, 9, 19 + giorno, ore - 2, minuti));
const LUN = 0, MAR = 1, MER = 2, VEN = 4, SAB = 5, DOM = 6;

test('leggiOrari: senza orari (o con un dato rovinato) vale "sempre aperto", mai "chiuso"', () => {
  assert.equal(orari.leggiOrari(null), null);
  assert.equal(orari.leggiOrari(undefined), null);
  assert.equal(orari.leggiOrari('non è json'), null);
  assert.equal(orari.leggiOrari([]), null);
  assert.equal(orari.leggiOrari({ lun: 'ciao' }), null);
  assert.equal(orari.leggiOrari({ lun: [['18:00', '07:00']] }), null, 'fascia alla rovescia');
  assert.equal(orari.leggiOrari({ lun: [['07:00', '12:00'], ['11:00', '13:00']] }), null, 'fasce sovrapposte');
  assert.equal(orari.leggiOrari({ lun: [['07:00', '08:00'], ['09:00', '10:00'], ['11:00', '12:00']] }), null, 'più di due fasce');
  assert.equal(orari.apertoAdesso(null, a(MAR, 3)), true);
  assert.equal(orari.apertoAdesso('rovinato', a(MAR, 3)), true);
  // completa i giorni mancanti come chiusi e legge anche il testo JSON
  const letti = orari.leggiOrari(JSON.stringify({ lun: [['07:30', '12:00']] }));
  assert.deepEqual(letti.lun, [['07:30', '12:00']]);
  assert.deepEqual(letti.mar, []);
  assert.equal(Object.keys(letti).length, 7);
  // le fasce si rimettono in ordine
  assert.deepEqual(orari.leggiOrari({ lun: [['14:00', '18:00'], ['07:30', '12:30']] }).lun, FASCE);
});

test('apertoAdesso: dentro le fasce sì, nella pausa pranzo e fuori orario no (la fine è esclusa)', () => {
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 7, 29)), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 7, 30)), true);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 12, 29)), true);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 12, 30)), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 13, 0)), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 14, 0)), true);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(MAR, 18, 0)), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(SAB, 11, 59)), true);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(SAB, 12, 0)), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, a(DOM, 10, 0)), false, 'domenica chiuso');
});

test('fuso: conta l\'ora di Roma, con l\'ora legale e con quella solare, qualunque sia il fuso del server', () => {
  // mercoledì 21 ottobre 2026, ora legale: 05:30 UTC = 07:30 a Roma
  assert.equal(orari.apertoAdesso(SETTIMANA, new Date(Date.UTC(2026, 9, 21, 5, 29))), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, new Date(Date.UTC(2026, 9, 21, 5, 30))), true);
  // mercoledì 2 dicembre 2026, ora solare: 06:30 UTC = 07:30 a Roma
  assert.equal(orari.apertoAdesso(SETTIMANA, new Date(Date.UTC(2026, 11, 2, 6, 29))), false);
  assert.equal(orari.apertoAdesso(SETTIMANA, new Date(Date.UTC(2026, 11, 2, 6, 30))), true);
  // a cavallo della mezzanotte: domenica 1 novembre 23:30 UTC = lunedì 2 novembre 00:30 a Roma (ancora chiuso, ma è già lunedì)
  assert.equal(orari.statoOrari(SETTIMANA, new Date(Date.UTC(2026, 10, 1, 23, 30))).riapre.testo, 'oggi alle 07:30');
});

test('statoOrari: quando riapre (oggi, domani, un giorno della settimana)', () => {
  const riapre = (quando) => orari.statoOrari(SETTIMANA, quando).riapre;
  assert.equal(riapre(a(MAR, 6, 0)).testo, 'oggi alle 07:30');
  assert.equal(riapre(a(MAR, 13, 0)).testo, 'oggi alle 14:00');
  assert.equal(riapre(a(MAR, 19, 0)).testo, 'domani alle 07:30');
  assert.equal(riapre(a(VEN, 18, 30)).testo, 'domani alle 07:30', 'il sabato apre');
  assert.equal(riapre(a(SAB, 12, 0)).testo, 'lunedì alle 07:30', 'la domenica è chiuso');
  assert.equal(riapre(a(DOM, 10, 0)).testo, 'domani alle 07:30');
  assert.equal(riapre(a(MAR, 19, 0)).giorno, 'mer');
  assert.equal(orari.statoOrari(SETTIMANA, a(MAR, 10, 0)).riapre, null, 'aperto: non riapre');
  // un solo giorno aperto: fra due giorni e, se è oggi ma già finito, lo stesso giorno della settimana dopo
  const solo = { ...Object.fromEntries(orari.GIORNI.map((g) => [g, []])), gio: [['09:00', '12:00']] };
  assert.equal(orari.statoOrari(solo, a(MAR, 10, 0)).riapre.testo, 'giovedì alle 09:00');
  assert.equal(orari.statoOrari(solo, new Date(Date.UTC(2026, 9, 22, 11, 0))).riapre.testo, 'giovedì alle 09:00', 'giovedì 13:00: la settimana dopo');
  // tutti i giorni chiusi: chiuso e non riapre mai
  assert.deepEqual(orari.statoOrari(Object.fromEntries(orari.GIORNI.map((g) => [g, []])), a(MAR, 10, 0)), { aperto: false, riapre: null });
});

test('statoBanchi: basta una filiale aperta; se sono tutte chiuse riapre la prima', () => {
  const presto = { id: 1, orari: SETTIMANA };
  const tardi = { id: 2, orari: { ...SETTIMANA, mer: [['15:00', '19:00']] } };
  const sempre = { id: 3, orari: null };
  // martedì 19:00: chiuse entrambe; mercoledì la prima apre alle 07:30, la seconda alle 15:00
  const chiuso = orari.statoBanchi([tardi, presto], a(MAR, 19, 0));
  assert.equal(chiuso.aperto, false);
  assert.equal(chiuso.riapre.testo, 'domani alle 07:30');
  assert.equal(orari.statoBanchi([presto, sempre], a(MAR, 19, 0)).aperto, true, 'una filiale senza orari è sempre aperta');
  assert.equal(orari.statoBanchi([presto, tardi], a(MAR, 10, 0)).aperto, true);
  assert.equal(orari.statoBanchi([], a(MAR, 19, 0)).aperto, true, 'nessun banco: non è una questione di orari');
  assert.equal(orari.frasePerCarrello(chiuso), 'Il banco è chiuso · riapre domani alle 07:30');
  assert.equal(orari.frasePerCarrello({ aperto: false, riapre: null }), 'Il banco è chiuso');
  assert.equal(orari.frasePerCarrello({ aperto: true, riapre: null }), '');
});

test('riassunto: i giorni consecutivi con gli stessi orari stanno su una riga', () => {
  assert.deepEqual(orari.riassunto(SETTIMANA).map((r) => [r.etichetta, r.fasce, r.chiuso]), [
    ['Lunedì – Venerdì', ['07:30 – 12:30', '14:00 – 18:00'], false],
    ['Sabato', ['07:30 – 12:00'], false],
    ['Domenica', [], true],
  ]);
  // sabato e domenica chiusi insieme; un giovedì diverso spezza la riga
  const altro = { ...SETTIMANA, gio: [['08:00', '12:00']], sab: [] };
  assert.deepEqual(orari.riassunto(altro).map((r) => r.etichetta), ['Lunedì – Mercoledì', 'Giovedì', 'Venerdì', 'Sabato – Domenica']);
  assert.deepEqual(orari.riassunto(null), [], 'senza orari non c\'è niente da elencare');
});

test('orariDaModulo: legge il modulo, controlla le fasce e dice dov\'è l\'errore', () => {
  const modulo = (extra = {}) => ({
    aperto_lun: '1', da1_lun: '07:30', a1_lun: '12:30', da2_lun: '14:00', a2_lun: '18:00',
    aperto_sab: '1', da1_sab: '07:30', a1_sab: '12:00',
    ...extra,
  });
  let r = orari.orariDaModulo(modulo());
  assert.deepEqual(r.errori, {});
  assert.deepEqual(r.orari.lun, FASCE);
  assert.deepEqual(r.orari.sab, [['07:30', '12:00']]);
  assert.deepEqual(r.orari.mar, [], 'un giorno senza la casella è chiuso');
  assert.equal(Object.keys(r.orari).length, 7);

  // fine prima dell'inizio, orario scritto male, fascia mancante, seconda fascia che si sovrappone
  r = orari.orariDaModulo(modulo({ da1_lun: '13:00', a1_lun: '12:00', da1_sab: '7.30' }));
  assert.equal(r.orari, null);
  assert.match(r.errori.lun, /dopo l.inizio/);
  assert.match(r.errori.sab, /Orari non validi/);
  r = orari.orariDaModulo(modulo({ da1_lun: '', a1_lun: '', da2_lun: '', a2_lun: '' }));
  assert.match(r.errori.lun, /prima fascia/);
  r = orari.orariDaModulo(modulo({ da2_lun: '12:00' }));
  assert.match(r.errori.lun, /seconda fascia/);
  r = orari.orariDaModulo(modulo({ da2_lun: '25:00', a2_lun: '26:00' }));
  assert.match(r.errori.lun, /Orari non validi/);
  // i valori scritti tornano nel modulo anche se sbagliati
  assert.equal(r.valori.lun.da2, '25:00');
  assert.equal(r.valori.lun.aperto, true);

  // tutto chiuso: non si salva (il banco non riceverebbe mai niente); "sempre aperto" non c'è più nel modulo, un `sempre_aperto` scritto a mano non conta
  r = orari.orariDaModulo({});
  assert.equal(r.orari, null);
  assert.equal(r.errore, 'Segna almeno un giorno come aperto.');
  r = orari.orariDaModulo({ sempre_aperto: '1' });
  assert.equal(r.orari, null);
  assert.match(r.errore, /almeno un giorno/);
  r = orari.orariDaModulo({ sempre_aperto: '1', aperto_lun: '1', da1_lun: 'xx' });
  assert.match(r.errori.lun, /Orari non validi/, 'i campi si controllano sempre');
  // il corpo non è un oggetto: nessun errore del server
  assert.match(orari.orariDaModulo(null).errore, /almeno un giorno/);
  assert.match(orari.orariDaModulo({ da1_lun: ['a'], aperto_lun: '1' }).errori.lun, /prima fascia|non validi/);
});

test('valoriPerModulo: i valori salvati, o una proposta come nel mockup se non ci sono orari', () => {
  const salvati = orari.valoriPerModulo(SETTIMANA);
  assert.deepEqual(salvati.lun, { aperto: true, da1: '07:30', a1: '12:30', da2: '14:00', a2: '18:00' });
  assert.deepEqual(salvati.sab, { aperto: true, da1: '07:30', a1: '12:00', da2: '', a2: '' });
  assert.equal(salvati.dom.aperto, false);
  const proposta = orari.valoriPerModulo(null);
  assert.equal(proposta.lun.da1, '07:30');
  assert.equal(proposta.dom.aperto, false);
});
