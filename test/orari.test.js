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

// ---------------- Chiusura, testi di "ordini chiusi" e pagina "Orari di BOREA" (richiesta del 22/10/2026) ----------------

// Una settimana con l'ultima fascia che finisce alle 17:00 (come nel mockup del carrello in chiusura).
const FINO_17 = [['07:30', '12:30'], ['14:00', '17:00']];
const S17 = { lun: FINO_17, mar: FINO_17, mer: FINO_17, gio: FINO_17, ven: FINO_17, sab: [['07:30', '12:00']], dom: [] };

test('chiude: la fine della fascia in corso, con i minuti che mancano (ora di Roma: 16:59 aperto, 17:00 chiuso)', () => {
  const s = orari.statoOrari(S17, a(MAR, 16, 59));
  assert.equal(s.aperto, true);
  assert.equal(s.chiude.ora, '17:00');
  assert.equal(s.chiude.mancanoMin, 1);
  assert.equal(s.chiude.istante.toISOString(), a(MAR, 17, 0).toISOString());
  assert.equal(orari.statoOrari(S17, a(MAR, 17, 0)).aperto, false, 'alle 17:00 è chiuso (la fine è esclusa)');
  assert.deepEqual(orari.statoOrari(S17, a(MAR, 17, 0)), { aperto: false, riapre: { giorno: 'mer', giorniDa: 1, ora: '07:30', attesaMin: 870, testo: 'domani alle 07:30' } });
  // in mezzo alla mattina: chiude alla fine della fascia in corso, non dell'ultima
  assert.equal(orari.statoOrari(S17, a(MAR, 10, 0)).chiude.ora, '12:30');
  assert.equal(orari.statoOrari(S17, a(MAR, 10, 0)).chiude.mancanoMin, 150);
  assert.equal(orari.statoOrari(S17, a(MAR, 15, 0)).chiude.ora, '17:00');
  // i secondi: alle 16:51:30 mancano 8,5 minuti = "9 min" (per eccesso) e 510 secondi
  const aMezzo = new Date(a(MAR, 16, 51).getTime() + 30000);
  assert.equal(orari.statoOrari(S17, aMezzo).chiude.mancanoMin, 9);
  assert.equal(orari.statoOrari(S17, aMezzo).chiude.secondi, 510);
  // senza orari: sempre aperto, non chiude mai
  assert.deepEqual(orari.statoOrari(null, a(MAR, 16, 59)), { aperto: true, riapre: null, chiude: null });
  // due fasce che si toccano non sono una chiusura: chiude alla fine della seconda
  const attaccate = { ...S17, mar: [['07:30', '14:00'], ['14:00', '17:00']] };
  assert.equal(orari.statoOrari(attaccate, a(MAR, 13, 0)).chiude.ora, '17:00');
});

test('chiude: vale l\'ora di Roma, con l\'ora legale e con quella solare, qualunque sia il fuso del server', () => {
  // ora legale: mercoledì 21 ottobre 2026, 16:59 a Roma = 14:59 UTC
  assert.equal(orari.statoOrari(S17, new Date(Date.UTC(2026, 9, 21, 14, 59))).chiude.mancanoMin, 1);
  assert.equal(orari.statoOrari(S17, new Date(Date.UTC(2026, 9, 21, 15, 0))).aperto, false);
  // ora solare: mercoledì 2 dicembre 2026, 16:59 a Roma = 15:59 UTC
  assert.equal(orari.statoOrari(S17, new Date(Date.UTC(2026, 11, 2, 15, 59))).chiude.mancanoMin, 1);
  assert.equal(orari.statoOrari(S17, new Date(Date.UTC(2026, 11, 2, 16, 0))).aperto, false);
});

test('statoBanchi: con più filiali aperte "chiude" è la chiusura che arriva più tardi; una sempre aperta = non chiude', () => {
  const presto = { id: 1, orari: S17 };
  const tardi = { id: 2, orari: { ...S17, mar: [['07:30', '12:30'], ['14:00', '19:00']] } };
  const s = orari.statoBanchi([presto, tardi], a(MAR, 16, 0));
  assert.equal(s.aperto, true);
  assert.equal(s.chiude.ora, '19:00');
  assert.equal(s.chiude.mancanoMin, 180);
  assert.equal(orari.statoBanchi([presto, { id: 3, orari: null }], a(MAR, 16, 0)).chiude, null, 'una filiale senza orari non chiude');
  assert.equal(orari.statoBanchi([], a(MAR, 16, 0)).chiude, null);
  // una chiusa e una aperta: conta quella aperta
  assert.equal(orari.statoBanchi([presto, { id: 4, orari: { ...S17, mar: [['15:00', '16:30']] } }], a(MAR, 12, 0)).chiude.ora, '12:30');
});

test('inChiusura / avvisoChiusura: solo negli ultimi minuti (soglia IN_CHIUSURA_MIN)', () => {
  const stato = (h, m) => orari.statoOrari(S17, a(MAR, h, m));
  assert.equal(orari.IN_CHIUSURA_MIN, 30);
  assert.equal(orari.inChiusura(stato(16, 30)), true, 'a 30 minuti dalla chiusura');
  assert.equal(orari.inChiusura(stato(16, 29)), false, 'a 31 minuti no');
  assert.equal(orari.inChiusura(stato(16, 59)), true);
  assert.equal(orari.inChiusura(stato(17, 0)), false, 'chiuso: non è "in chiusura"');
  assert.equal(orari.inChiusura(orari.statoOrari(null, a(MAR, 16, 59))), false, 'sempre aperto');
  assert.equal(orari.inChiusura(stato(16, 51), 5), false, 'soglia diversa');
  assert.deepEqual(orari.avvisoChiusura(stato(16, 51)), { ora: '17:00', mancanoMin: 9, secondi: 540 });
  assert.equal(orari.avvisoChiusura(stato(10, 0)), null);
});

test('secondiAlCambio: fra quanti secondi lo stato cambia da solo (chiude se aperto, riapre se chiuso)', () => {
  // aperto: alla chiusura (16:51:00 -> 17:00 = 540 s)
  assert.equal(orari.secondiAlCambio(orari.statoOrari(S17, a(MAR, 16, 51)), a(MAR, 16, 51)), 540);
  // chiuso: alla riapertura (martedì 17:00 -> mercoledì 07:30 = 870 minuti)
  assert.equal(orari.secondiAlCambio(orari.statoOrari(S17, a(MAR, 17, 0)), a(MAR, 17, 0)), 870 * 60);
  // con i secondi dentro il minuto: alle 17:00:20 mancano 20 secondi in meno
  const venti = new Date(a(MAR, 17, 0).getTime() + 20000);
  assert.equal(orari.secondiAlCambio(orari.statoOrari(S17, venti), venti), 870 * 60 - 20);
  // pausa pranzo: riapre oggi alle 14:00
  assert.equal(orari.secondiAlCambio(orari.statoOrari(S17, a(MAR, 13, 0)), a(MAR, 13, 0)), 60 * 60);
  // sempre aperto o nessun giorno aperto: non cambia mai
  assert.equal(orari.secondiAlCambio(orari.statoOrari(null, a(MAR, 13, 0)), a(MAR, 13, 0)), null);
  assert.equal(orari.secondiAlCambio({ aperto: false, riapre: null }), null);
  assert.equal(orari.secondiAlCambio(null), null);
  assert.equal(orari.paginaOrari([{ id: 1, orari: S17 }], 'BOREA', a(MAR, 16, 51)).cambiaSec, 540);
});

test('testiChiuso: i testi di "ordini chiusi" (oggi, domani, un altro giorno, mai), col nome del banco preso dal DB', () => {
  const testi = (quando, nome = 'BOREA') => orari.testiChiuso(orari.statoOrari(S17, quando), nome);
  // pausa fra due fasce: riapre oggi
  let t = testi(a(MAR, 13, 0));
  assert.equal(t.titolo, 'Ordini chiusi ora');
  assert.equal(t.sotto, 'BOREA riapre oggi alle 14:00');
  assert.equal(t.sottoPrefisso, 'BOREA riapre ');
  assert.equal(t.quando, 'oggi alle 14:00');
  assert.equal(testi(a(MAR, 6, 0)).titolo, 'Ordini chiusi ora', 'prima dell\'apertura di stamattina: riapre oggi');
  // finita la giornata: riapre domani
  t = testi(a(MAR, 17, 0));
  assert.equal(t.titolo, 'Ordini chiusi per oggi');
  assert.equal(t.sotto, 'BOREA riapre domani alle 07:30');
  assert.equal(t.nota, 'Ordini chiusi · BOREA riapre domani alle 07:30');
  assert.equal(t.notaPrefisso, 'Ordini chiusi · BOREA riapre ');
  // più avanti (sabato dopo mezzogiorno: la domenica è chiusa)
  t = testi(a(SAB, 12, 0));
  assert.equal(t.titolo, 'Ordini chiusi per oggi');
  assert.equal(t.sotto, 'BOREA riapre lunedì alle 07:30');
  // nessun giorno aperto
  const nessuno = orari.testiChiuso({ aperto: false, riapre: null }, 'BOREA');
  assert.equal(nessuno.titolo, 'Ordini chiusi');
  assert.equal(nessuno.sotto, 'Al momento BOREA non riceve richieste');
  assert.equal(nessuno.quando, '');
  assert.equal(nessuno.nota, 'Ordini chiusi · al momento BOREA non riceve richieste');
  // il nome viene dal DB: un altro nome, o nessuno ("il banco")
  assert.equal(testi(a(MAR, 17, 0), 'ALTRA DITTA').sotto, 'ALTRA DITTA riapre domani alle 07:30');
  assert.equal(testi(a(MAR, 17, 0), '').sotto, 'Il banco riapre domani alle 07:30');
  assert.equal(testi(a(MAR, 17, 0), '').nota, 'Ordini chiusi · il banco riapre domani alle 07:30');
  // aperto: niente testi
  assert.equal(orari.testiChiuso(orari.statoOrari(S17, a(MAR, 10, 0)), 'BOREA'), null);
  assert.equal(orari.testiChiuso(null, 'BOREA'), null);
});

test('unisciOrari: le fasce di tutte le filiali insieme, fuse quando si toccano; senza orari = sempre aperto', () => {
  const f1 = { id: 1, orari: S17 };
  const f2 = { id: 2, orari: { ...S17, mar: [['12:30', '13:00'], ['17:00', '19:00']] } };
  const u = orari.unisciOrari([f1, f2]);
  assert.deepEqual(u.lun, FINO_17, 'uguali: restano com\'erano');
  assert.deepEqual(u.mar, [['07:30', '13:00'], ['14:00', '19:00']], '07:30–12:30 e 12:30–13:00 si toccano, 14:00–17:00 e 17:00–19:00 anche');
  // sovrapposte: una fascia sola
  assert.deepEqual(orari.unisciOrari([f1, { id: 5, orari: { ...S17, mar: [['10:00', '15:00'], ['16:00', '19:00']] } }]).mar, [['07:30', '19:00']]);
  assert.deepEqual(u.dom, []);
  assert.equal(orari.unisciOrari([f1, { id: 3, orari: null }]), null, 'una filiale sempre aperta: sempre aperto');
  assert.equal(orari.unisciOrari([]), null);
});

test('paginaOrari: lo stato adesso, i testi e i sette giorni (oggi, giorno di riapertura, chiusi)', () => {
  // martedì 17:00: chiuso, riapre domani
  let p = orari.paginaOrari([{ id: 1, orari: S17 }], 'BOREA', a(MAR, 17, 0));
  assert.equal(p.aperto, false);
  assert.equal(p.titolo, 'Chiuso ora');
  assert.equal(p.sottoPrefisso, 'BOREA riapre ');
  assert.equal(p.quando, 'domani alle 07:30');
  assert.equal(p.sempreAperto, false);
  assert.deepEqual(p.giorni.map((g) => g.nome), ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica']);
  assert.deepEqual(p.giorni.map((g) => g.oggi), [false, true, false, false, false, false, false]);
  assert.deepEqual(p.giorni.map((g) => g.riapre), [false, false, true, false, false, false, false]);
  assert.deepEqual(p.giorni[0].fasce, ['07:30 – 12:30', '14:00 – 17:00']);
  assert.deepEqual(p.giorni[5].fasce, ['07:30 – 12:00']);
  assert.equal(p.giorni[6].chiuso, true);
  assert.deepEqual(p.giorni[6].fasce, []);
  // chiuso ma riapre oggi (pausa): niente badge "riapre" sugli altri giorni, il giorno è "oggi"
  p = orari.paginaOrari([{ id: 1, orari: S17 }], 'BOREA', a(MAR, 13, 0));
  assert.equal(p.quando, 'oggi alle 14:00');
  assert.equal(p.giorni.some((g) => g.riapre), false);
  // aperto: "Aperto ora", chiude alle 17:00
  p = orari.paginaOrari([{ id: 1, orari: S17 }], 'BOREA', a(MAR, 15, 0));
  assert.equal(p.aperto, true);
  assert.equal(p.titolo, 'Aperto ora');
  assert.equal(p.sottoPrefisso, 'Chiude oggi alle ');
  assert.equal(p.quando, '17:00');
  assert.equal(p.testi, null);
  // sempre aperto: niente giorni da elencare
  p = orari.paginaOrari([{ id: 1, orari: null }], 'BOREA', a(MAR, 15, 0));
  assert.equal(p.sempreAperto, true);
  assert.deepEqual(p.giorni, []);
  assert.equal(p.sottoPrefisso, 'Sempre aperto');
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
