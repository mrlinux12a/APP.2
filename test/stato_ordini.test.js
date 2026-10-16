// Prove di "Stato ordini" dell'installatore (src/flusso_cliente.js): più attività insieme, ordine dell'elenco, attività che
// segue l'icona, "Nessuna risposta" solo quando è davvero l'ultima cosa successa. DB e moduli collegati sono finti:
// nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---------------- DB finto: solo le due letture di "Stato ordini" ----------------
let richiesteDb = []; // righe come le restituisce leggiRichiesteRecenti (con secondi_rimasti)
let ordiniDb = {};
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const esegui = (...p) => {
      if (/FROM requests WHERE cliente_id = \? ORDER BY id DESC LIMIT 30/.test(s)) {
        return [...richiesteDb].sort((a, b) => b.id - a.id).slice(0, 30);
      }
      if (/FROM orders WHERE id IN/.test(s)) return p.map((id) => ordiniDb[id]).filter(Boolean);
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 100));
    };
    return { get: async (...p) => esegui(...p)[0] || null, all: async (...p) => esegui(...p), run: async () => ({ changes: 0 }) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const flusso = require('../src/flusso_cliente');
const richieste = require('../src/richieste');
const notifiche = require('../src/notifiche');
const pricing = require('../src/pricing');

// La finestra di conferma (10 minuti): qui non c'è un DB vero che la legga dalla configurazione.
pricing.getFinestraMinuti = async () => 10;

// Moduli collegati: nessuna scrittura, nessuna chiusura di scadenze (le prove danno già lo stato che serve).
const aggiornate = [];
richieste.aggiornaScadenza = async (id) => {
  aggiornate.push(id);
  return null;
};
notifiche.segnaLetteCategoria = async () => {};
let righeFinte = new Map();
richieste.righeRichieste = async (ids) => new Map(ids.map((id) => [Number(id), righeFinte.get(Number(id)) || []]));

// pg legge le colonne TIMESTAMP (UTC senza fuso) come ora locale: `naive` costruisce lo stesso tipo di Date.
const naive = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
const fa = (ms) => naive(new Date(Date.now() - ms));
const tra = (ms) => naive(new Date(Date.now() + ms));
const MIN = 60000;
const ORA = 3600000;

// Una richiesta in attesa con `secondi` ancora sulla finestra, nata `nataFa` ms fa.
const inAttesa = (id, secondi, nataFa = 60000) => ({
  id, stato: 'in_attesa', creato_il: fa(nataFa), scade_il: tra(secondi * 1000), order_id: null, secondi_rimasti: secondi,
});
// Una richiesta con ordine: in consegna (consegnato = false) o consegnato; `arrivoTraMin` = corriere_arrivo_il fra N minuti.
function conOrdine(id, { consegnato = false, arrivoTraMin = null, nataFa = ORA, corriere = '', consegnaOre = null } = {}) {
  ordiniDb[id + 1000] = {
    id: id + 1000, stato: 'inviato', creato_il: fa(nataFa), consegnato_il: consegnato ? fa(MIN) : null, consegna_ore: consegnaOre,
    corriere_arrivo_il: arrivoTraMin === null ? null : new Date(Date.now() + arrivoTraMin * MIN), corriere_risposto_il: null, corriere_nome: corriere,
  };
  return { id, stato: 'ordinata', creato_il: fa(nataFa), scade_il: fa(nataFa - 10 * MIN), order_id: id + 1000, secondi_rimasti: -1 };
}
const scaduta = (id, scadutaFa = 30 * MIN) => ({
  id, stato: 'nessuna_offerta', creato_il: fa(scadutaFa + 10 * MIN), scade_il: fa(scadutaFa), order_id: null, secondi_rimasti: -Math.round(scadutaFa / 1000),
});

// `costruisci` fa le righe DOPO lo svuotamento: conOrdine() scrive anche l'ordine in ordiniDb.
function prepara(costruisci) {
  ordiniDb = {};
  righeFinte = new Map();
  aggiornate.length = 0;
  richiesteDb = costruisci();
}

test('non esiste più il blocco "una sola richiesta aperta"', () => {
  assert.equal(flusso.richiestaBloccante, undefined);
});

// Le voci come le costruisce il flusso: { fase, tipo, id, richiestaId, href, voce, ... }
const voceScaduta = (id) => ({ fase: 'scaduta', tipo: 'richiesta', id, richiestaId: id, href: '/richieste/' + id, voce: 'richiesta-' + id });
const chiavi = (voci) => voci.map((v) => v.voce);

test('icona: un ordine consegnato (fase 3) non mostra "Nessuna risposta" per una richiesta scaduta più vecchia', async () => {
  const consegnato = conOrdine(11, { consegnato: true });
  prepara(() => [scaduta(10, 90 * MIN), consegnato]);
  assert.deepEqual(await flusso.statoIconaOrdini(1), { fase: 'nessuna', voci: [], firma: '' });
  const { attive, corrente } = await flusso.attivitaCliente(1);
  assert.equal(attive.length, 0);
  assert.equal(corrente, null, 'neanche "Stato ordini" rimanda alla richiesta scaduta');
  assert.deepEqual(await flusso.vociStriscia(1), [], 'e la striscia non ha voci');
});

test('icona: "Nessuna risposta" resta quando la richiesta scaduta è l\'ultima cosa successa', async () => {
  prepara(() => [conOrdine(9, { consegnato: true }), scaduta(10, 30 * MIN)]);
  assert.deepEqual(await flusso.statoIconaOrdini(1), { fase: 'scaduta', voci: [voceScaduta(10)], firma: 'richiesta-10-scaduta' });
  assert.deepEqual((await flusso.attivitaCliente(1)).corrente, { tipo: 'richiesta', id: 10 });
  // oltre le 3 ore non conta più
  prepara(() => [scaduta(10, 4 * ORA)]);
  assert.deepEqual(await flusso.statoIconaOrdini(1), { fase: 'nessuna', voci: [], firma: '' });
});

test('icona: una richiesta annullata dopo la scaduta cancella il "Nessuna risposta"', async () => {
  prepara(() => [scaduta(10, 30 * MIN), { id: 11, stato: 'annullata', creato_il: fa(5 * MIN), scade_il: tra(5 * MIN), order_id: null, secondi_rimasti: 300 }]);
  assert.deepEqual(await flusso.statoIconaOrdini(1), { fase: 'nessuna', voci: [], firma: '' });
});

// ---------------- Striscia di schede: le voci ----------------

test('striscia: più richieste in attesa vanno dal timer più corto al più lungo, ognuna col suo articolo', async () => {
  prepara(() => [inAttesa(20, 120), inAttesa(21, 540), inAttesa(22, 300)]);
  righeFinte.set(20, [{ nome: 'Valvola a sfera' }]);
  righeFinte.set(21, [{ nome: 'Raccordo a T' }, { nome: 'Sifone' }, { nome: 'Gomito' }]);
  righeFinte.set(22, [{ nome: 'Tubo Ø20' }, { nome: 'Curva' }]);
  const voci = await flusso.vociStriscia(1);
  assert.deepEqual(voci.map((v) => v.secondi), [120, 300, 540]);
  assert.deepEqual(chiavi(voci), ['richiesta-20', 'richiesta-22', 'richiesta-21']);
  assert.deepEqual(voci.map((v) => v.href), ['/richieste/20', '/richieste/22', '/richieste/21']);
  // breve: il primo articolo e, se ce ne sono altri, " +N"
  assert.deepEqual(voci.map((v) => v.breve), ['Valvola a sfera', 'Tubo Ø20 +1', 'Raccordo a T +2']);
  assert.ok(voci.every((v) => v.durata > 0 && v.tipo === 'richiesta' && v.fase === 'richiesta'));
});

test('striscia: scaduta, poi le richieste in attesa, poi gli ordini in consegna dall\'arrivo più vicino; i consegnati no', async () => {
  prepara(() => [
    conOrdine(30, { arrivoTraMin: 15, corriere: 'Mario' }),
    conOrdine(31, { arrivoTraMin: 50 }),
    conOrdine(32, { consegnato: true, arrivoTraMin: 5 }),
    conOrdine(33, { arrivoTraMin: null }),
    inAttesa(34, 400),
    inAttesa(35, 200),
    scaduta(36, 30 * MIN),
  ]);
  const voci = await flusso.vociStriscia(1);
  assert.deepEqual(chiavi(voci), ['richiesta-36', 'richiesta-35', 'richiesta-34', 'ordine-1030', 'ordine-1031', 'ordine-1033']);
  assert.deepEqual(voci.map((v) => v.fase), ['scaduta', 'richiesta', 'richiesta', 'consegna', 'consegna', 'consegna']);
  assert.equal(voci[3].href, '/ordini/1030');
  assert.equal(voci[3].tipo, 'ordine');
  assert.ok(voci[3].minuti >= 14 && voci[3].minuti <= 15);
  assert.equal(voci[5].minuti, null, 'senza orario: "In consegna"');
  // una sola lettura del materiale per tutte le richieste, non una per voce
  assert.ok(voci.every((v) => typeof v.breve === 'string'));
});

test('striscia: `segnaLette` segna le notifiche, `breve: false` salta la lettura del materiale', async () => {
  prepara(() => [inAttesa(40, 300), inAttesa(41, 200)]);
  const lette = [];
  const originale = notifiche.segnaLetteCategoria;
  notifiche.segnaLetteCategoria = async (cliente, categoria) => { lette.push(categoria); };
  let letture = 0;
  const righeOriginale = richieste.righeRichieste;
  richieste.righeRichieste = async (ids) => { letture++; return righeOriginale(ids); };
  try {
    await flusso.vociStriscia(1);
    assert.deepEqual(lette, [], 'di norma non segna niente');
    assert.equal(letture, 1);
    const senza = await flusso.vociStriscia(1, { segnaLette: true, breve: false });
    assert.deepEqual(lette.sort(), ['ordini', 'richieste']);
    assert.equal(letture, 1, 'nessuna lettura del materiale');
    assert.ok(senza.every((v) => v.breve === undefined));
  } finally {
    notifiche.segnaLetteCategoria = originale;
    richieste.righeRichieste = righeOriginale;
  }
});

test('striscia e icona dicono la stessa cosa: stesse voci, stesso ordine', async () => {
  prepara(() => [conOrdine(50, { arrivoTraMin: 30 }), inAttesa(51, 300), inAttesa(52, 100), scaduta(53, 20 * MIN)]);
  const icona = await flusso.statoIconaOrdini(1);
  const striscia = await flusso.vociStriscia(1);
  assert.deepEqual(chiavi(striscia), chiavi(icona.voci));
  // le voci della striscia sono quelle dell'icona più il materiale
  assert.deepEqual(striscia.map(({ breve, ...resto }) => resto), icona.voci);
});

test('firmaVoci: cambia con un ordine nuovo o una fase diversa, non col passare del tempo né con l\'ordine di alternanza', async () => {
  prepara(() => [inAttesa(60, 300), inAttesa(61, 100)]);
  const a = (await flusso.statoIconaOrdini(1)).firma;
  assert.equal(a, 'richiesta-60-richiesta,richiesta-61-richiesta');
  // passa il tempo (altri secondi), stesse voci: la firma è la stessa
  prepara(() => [inAttesa(60, 250), inAttesa(61, 50)]);
  assert.equal((await flusso.statoIconaOrdini(1)).firma, a);
  // la 61 diventa un ordine in consegna: un'altra firma
  prepara(() => [inAttesa(60, 250), conOrdine(61, { arrivoTraMin: 20 })]);
  assert.equal((await flusso.statoIconaOrdini(1)).firma, 'ordine-1061-consegna,richiesta-60-richiesta');
  // ne arriva una nuova
  prepara(() => [inAttesa(60, 250), conOrdine(61, { arrivoTraMin: 20 }), inAttesa(62, 500)]);
  assert.equal((await flusso.statoIconaOrdini(1)).firma, 'ordine-1061-consegna,richiesta-60-richiesta,richiesta-62-richiesta');
  assert.equal(flusso.firmaVoci([]), '');
});

test('icona e app seguono la PRIMA inviata, qualunque sia la fase', async () => {
  // due richieste in attesa: la più vecchia (id 50) ha meno tempo, l'icona segue comunque lei
  prepara(() => [inAttesa(50, 100), inAttesa(51, 500)]);
  assert.deepEqual((await flusso.statoIconaOrdini(1)).secondi, 100);
  assert.equal((await flusso.statoIconaOrdini(1)).fase, 'richiesta');
  assert.deepEqual((await flusso.attivitaCorrente(1)), { tipo: 'richiesta', id: 50 });

  // il primo fatto è un ordine in consegna, il secondo una richiesta in attesa: l'icona resta sull'ordine
  prepara(() => [conOrdine(60, { arrivoTraMin: 25, corriere: 'Luca' }), inAttesa(61, 300)]);
  const icona = await flusso.statoIconaOrdini(1);
  assert.equal(icona.fase, 'consegna');
  assert.equal(icona.ordineId, 1060);
  assert.equal(icona.corriere, 'Luca');
  assert.deepEqual(await flusso.attivitaCorrente(1), { tipo: 'ordine', id: 1060 });

  // il primo fatto è una richiesta in attesa, il secondo un ordine in consegna: l'icona segue la richiesta
  prepara(() => [inAttesa(70, 300), conOrdine(71, { arrivoTraMin: 25 })]);
  assert.equal((await flusso.statoIconaOrdini(1)).fase, 'richiesta');
});

test('una sola attività: icona e attività corrente sono quella', async () => {
  prepara(() => [conOrdine(80, { arrivoTraMin: 40 })]);
  assert.equal((await flusso.statoIconaOrdini(1)).fase, 'consegna');
  assert.deepEqual(await flusso.attivitaCorrente(1), { tipo: 'ordine', id: 1080 });
  prepara(() => []);
  assert.deepEqual(await flusso.statoIconaOrdini(1), { fase: 'nessuna', voci: [], firma: '' });
  assert.equal(await flusso.attivitaCorrente(1), null);
});

test('un ordine in consegna da più di 24 ore non conta più come attivo', async () => {
  prepara(() => [conOrdine(90, { arrivoTraMin: null, nataFa: 30 * ORA })]);
  assert.equal((await flusso.attivitaCliente(1)).attive.length, 0);
  assert.deepEqual(await flusso.vociStriscia(1), []);
});

test('la scadenza si controlla solo dove serve: finestra già finita o vecchio flusso, non le richieste con tempo davanti', async () => {
  prepara(() => [
    inAttesa(100, 300),
    { ...inAttesa(101, 0), secondi_rimasti: -5 },
    { id: 102, stato: 'con_offerte', creato_il: fa(MIN), scade_il: tra(MIN), order_id: null, secondi_rimasti: 60 },
  ]);
  await flusso.attivitaCliente(1);
  assert.deepEqual(aggiornate.sort(), [101, 102]);
});

// ---------------- Icona che alterna le attività (voci) ----------------

test('ordinaVociIcona: prima la scaduta, poi le richieste dal timer più corto, poi le consegne da chi arriva prima (senza minuti in fondo)', () => {
  const voci = [
    { fase: 'consegna', id: 301, minuti: 40 },
    { fase: 'richiesta', id: 202, secondi: 500, durata: 600 },
    { fase: 'consegna', id: 302, minuti: null },
    { fase: 'scaduta', id: 100 },
    { fase: 'richiesta', id: 201, secondi: 90, durata: 600 },
    { fase: 'consegna', id: 303, minuti: 6 },
  ];
  const ordinate = flusso.ordinaVociIcona(voci);
  assert.deepEqual(
    ordinate.map((v) => [v.fase, v.id]),
    [['scaduta', 100], ['richiesta', 201], ['richiesta', 202], ['consegna', 303], ['consegna', 301], ['consegna', 302]]
  );
  assert.notEqual(ordinate, voci, 'non modifica l\'elenco ricevuto');
  assert.equal(voci[0].id, 301);
  // a parità, la più vecchia per prima: l'ordine non cambia da un aggiornamento all'altro
  const pari = flusso.ordinaVociIcona([
    { fase: 'richiesta', id: 9, secondi: 120 },
    { fase: 'richiesta', id: 7, secondi: 120 },
    { fase: 'consegna', id: 12, minuti: 10 },
    { fase: 'consegna', id: 11, minuti: 10 },
  ]);
  assert.deepEqual(pari.map((v) => v.id), [7, 9, 11, 12]);
  assert.deepEqual(flusso.ordinaVociIcona([]), []);
});

test('icona: `voci` elenca tutte le attività nell\'ordine dell\'alternanza, i campi di primo livello restano quelli della prima inviata', async () => {
  prepara(() => [
    conOrdine(60, { arrivoTraMin: 25, corriere: 'Luca' }),
    inAttesa(61, 300),
    inAttesa(62, 120),
  ]);
  const icona = await flusso.statoIconaOrdini(1);
  // primo livello: la prima inviata (l'ordine in consegna), come prima: ci conta la scheda della home
  assert.equal(icona.fase, 'consegna');
  assert.equal(icona.ordineId, 1060);
  assert.equal(icona.corriere, 'Luca');
  // voci: prima le richieste dal timer più corto, poi la consegna
  assert.deepEqual(icona.voci.map((v) => [v.fase, v.id]), [['richiesta', 62], ['richiesta', 61], ['consegna', 1060]]);
  assert.equal(icona.voci[0].secondi, 120);
  assert.ok(icona.voci[0].durata > 0);
  assert.ok(icona.voci[2].minuti >= 24 && icona.voci[2].minuti <= 25);
  assert.deepEqual(Object.keys(icona.voci[2]).sort(), ['corriere', 'durataSec', 'etaSec', 'fase', 'href', 'id', 'inArrivo', 'minuti', 'progresso', 'richiestaId', 'tipo', 'voce']);
  assert.equal(icona.voci[2].corriere, 'Luca');
  // la barra della home non è più ferma a metà: ordine nato 1 ora fa, arrivo fra 25 minuti -> 60 su 85 minuti trascorsi
  assert.ok(Math.abs(icona.voci[2].progresso - (0.5 + 0.44 * 60 / 85)) < 0.01, 'progresso = da metà (In viaggio) a 1 col tempo trascorso: ' + icona.voci[2].progresso);
  assert.ok(Math.abs(icona.voci[2].etaSec - 25 * 60) <= 2);
  assert.ok(Math.abs(icona.voci[2].durataSec - 85 * 60) <= 2);
  assert.equal(icona.voci[2].inArrivo, false);
  assert.deepEqual(Object.keys(icona.voci[0]).sort(), ['durata', 'fase', 'href', 'id', 'richiestaId', 'secondi', 'tipo', 'voce']);
  assert.equal(icona.voci[2].href, '/ordini/1060');
  assert.equal(icona.voci[2].voce, 'ordine-1060');
});

test('icona: la richiesta scaduta entra fra le voci anche con un ordine in consegna (e viene per prima)', async () => {
  prepara(() => [conOrdine(9, { arrivoTraMin: 20 }), scaduta(10, 30 * MIN)]);
  const icona = await flusso.statoIconaOrdini(1);
  assert.equal(icona.fase, 'consegna', 'il primo livello resta l\'ordine in consegna');
  assert.deepEqual(icona.voci.map((v) => [v.fase, v.id]), [['scaduta', 10], ['consegna', 1009]]);
});

test('icona: con una sola attività o nessuna `voci` ha 1 o 0 elementi (l\'icona resta quella singola)', async () => {
  prepara(() => [inAttesa(70, 300)]);
  let icona = await flusso.statoIconaOrdini(1);
  assert.equal(icona.voci.length, 1);
  assert.equal(icona.fase, 'richiesta');
  prepara(() => []);
  icona = await flusso.statoIconaOrdini(1);
  assert.deepEqual(icona, { fase: 'nessuna', voci: [], firma: '' });
  prepara(() => [scaduta(80, 30 * MIN)]);
  icona = await flusso.statoIconaOrdini(1);
  assert.equal(icona.fase, 'scaduta');
  assert.deepEqual(icona.voci, [voceScaduta(80)]);
});

test('anello: una richiesta rinviata (creata ore fa, finestra ripartita adesso) parte piena, non quasi vuota', async () => {
  // creata 2 ore fa, rinviata: scade_il = adesso + 9 minuti. La differenza scade_il - creato_il è di ore, la finestra è di 10 minuti.
  prepara(() => [{ id: 188, stato: 'in_attesa', creato_il: fa(2 * ORA), scade_il: tra(9 * MIN), order_id: null, secondi_rimasti: 540 }]);
  const icona = await flusso.statoIconaOrdini(1);
  assert.equal(icona.secondi, 540);
  assert.equal(icona.durata, 600, 'durata = la finestra configurata, non le ore passate dalla prima volta');
  assert.equal(icona.voci[0].durata, 600);
  const [voce] = await flusso.vociStriscia(1);
  assert.equal(voce.durata, 600);
});

// ---------------- "In arrivo" a 3 minuti o meno, minuti e barra che scendono col tempo ----------------

test('voce di consegna: secondi all\'arrivo, durata e "In arrivo" a 3 minuti o meno (anche a orario passato)', async () => {
  prepara(() => [
    conOrdine(1, { arrivoTraMin: 10 }),
    conOrdine(2, { arrivoTraMin: 3 }),
    conOrdine(3, { arrivoTraMin: 0.5 }),
    conOrdine(4, { arrivoTraMin: -2 }), // l'orario è passato, l'ordine non è ancora segnato consegnato
    conOrdine(5, { arrivoTraMin: null }),
  ]);
  const voci = await flusso.vociStriscia(1);
  const per = (id) => voci.find((v) => v.id === 1000 + id);
  assert.equal(per(1).inArrivo, false);
  assert.equal(per(2).inArrivo, true, 'a 3 minuti precisi è già "In arrivo"');
  assert.equal(per(3).inArrivo, true);
  assert.equal(per(4).inArrivo, true);
  assert.ok(per(4).etaSec < 0, 'i secondi possono essere negativi');
  assert.equal(per(4).minuti, 1, 'i minuti non scendono sotto 1');
  assert.ok(Math.abs(per(1).etaSec - 600) <= 2);
  // l'ordine è nato un'ora fa: durata = 1 h + il tempo che manca
  assert.ok(Math.abs(per(1).durataSec - 70 * 60) <= 2);
  // senza orario del corriere: niente conto, resta "In consegna" e la barra a metà
  assert.equal(per(5).minuti, null);
  assert.equal(per(5).etaSec, null);
  assert.equal(per(5).inArrivo, false);
  assert.equal(per(5).progresso, 0.5);
  // la barra della home avanza col tempo (ora 60 min trascorsi su 70) e non esce da 0..1 se l'orario è passato
  assert.ok(Math.abs(per(1).progresso - (0.5 + 0.44 * 60 / 70)) < 0.01);
  assert.equal(per(4).progresso, 0.94, "a tempo finito un filo prima di Consegnato");
});

test('format.inArrivo: la soglia è di 3 minuti', () => {
  const format = require('../src/format');
  assert.equal(format.SOGLIA_IN_ARRIVO_SEC, 180);
  assert.equal(format.inArrivo(181), false);
  assert.equal(format.inArrivo(180), true);
  assert.equal(format.inArrivo(0), true);
  assert.equal(format.inArrivo(-30), true);
  assert.equal(format.inArrivo(null), false);
  assert.equal(format.inArrivo(undefined), false);
});

// Le schede e l'icona si disegnano dai partial: si provano con le voci come le costruisce il flusso.
test('schede e icona: "In arrivo" e basta a 3 minuti o meno, altrimenti i minuti; ogni contenitore porta i suoi secondi', async () => {
  const ejs = require('ejs');
  const format = require('../src/format');
  const viste = path.join(__dirname, '..', 'views', 'partials');
  const icone = { iconaOrdini: '', iconaFurgone: '' };
  prepara(() => [conOrdine(1, { arrivoTraMin: 12, corriere: 'Luca' }), conOrdine(2, { arrivoTraMin: 2, corriere: 'Anna' }), conOrdine(3, { arrivoTraMin: null })]);
  const voci = await flusso.vociStriscia(1);
  const lontana = voci.find((v) => v.id === 1001);
  const vicina = voci.find((v) => v.id === 1002);
  const senza = voci.find((v) => v.id === 1003);

  // icona (nav_ordini_fase): etichetta e badge
  const fase = (v) => ejs.renderFile(path.join(viste, 'nav_ordini_fase.ejs'), { v, CIRC: 65.97, fmt: format, ...icone });
  let h = await fase(lontana);
  assert.match(h, /<span class="etichetta" data-eta-testo="Arriva tra \{t\}">Arriva tra 12 min<\/span>/);
  assert.match(h, /<span class="badge-eta" data-eta-testo="\{c\}" data-eta-nascondi>12′<\/span>/);
  h = await fase(vicina);
  assert.match(h, /<span class="etichetta" data-eta-testo="Arriva tra \{t\}">In arrivo<\/span>/);
  assert.doesNotMatch(h, /Arriva tra \d/);
  assert.doesNotMatch(h, /badge-eta/, 'a 3 minuti o meno solo "In arrivo", senza il numero dei minuti');
  h = await fase(senza);
  assert.match(h, /<span class="etichetta">In consegna<\/span>/);
  assert.doesNotMatch(h, /data-eta/);

  // scheda della home: una per ordine, ognuna col suo [data-eta-sec], titolo e barra
  const home = await ejs.renderFile(path.join(viste, 'stato_home.ejs'), { statoOrdini: { voci }, fmt: format, ...icone });
  const schede = home.split('<div class="stato-home stato-consegna"').slice(1);
  assert.equal(schede.length, 3);
  const scheda = (id) => schede.find((s) => s.includes('/ordini/' + id));
  assert.match(scheda(1001), /^ data-eta-sec="\d+" data-eta-durata="\d+">/);
  assert.match(scheda(1001), /<span class="stato-titolo" data-eta-testo="Arriva tra \{t\}">Arriva tra 12 min<\/span>/);
  assert.match(scheda(1001), /<span data-eta-barra="da-meta" style="width: \d+\.\d%">/);
  assert.match(scheda(1002), /<span class="stato-titolo" data-eta-testo="Arriva tra \{t\}">In arrivo<\/span>/);
  assert.match(scheda(1003), /^>/, 'senza orario nessun conto');
  assert.match(scheda(1003), /<span class="stato-titolo">In consegna<\/span>/);
  assert.match(scheda(1003), /<span style="width: 50%"><\/span>/);

  // striscia (più ordini): "tra N min" scende da solo, "In arrivo" a 3 minuti o meno
  const striscia = await ejs.renderFile(path.join(viste, 'striscia_ordini.ejs'), { striscia: { voci: voci.map((v) => ({ ...v, breve: 'Tubo' })), attiva: voci[0].voce, firma: 'x' }, fmt: format, ...icone });
  assert.match(striscia, /data-voce="ordine-1001" data-eta-sec="\d+"/);
  assert.match(striscia, /<span class="str-valore" data-eta-testo="tra \{t\}">tra 12 min<\/span>/);
  assert.match(striscia, /<span class="str-valore" data-eta-testo="tra \{t\}">In arrivo<\/span>/);
  assert.match(striscia, /<span class="str-valore">In consegna<\/span>/);
});

test('senza il corriere l\'arrivo è la stima del banco (consegna_ore): "Arriva tra 5 h 57", "In arrivo" solo negli ultimi 3 minuti', async () => {
  const ejs = require('ejs');
  const format = require('../src/format');
  const viste = path.join(__dirname, '..', 'views', 'partials');
  const fase = (v) => ejs.renderFile(path.join(viste, 'nav_ordini_fase.ejs'), { v, CIRC: 65.97, fmt: format, iconaOrdini: '', iconaFurgone: '' });

  // ordine di 6 ore nato 3 minuti fa: mancano 5 h 57, NON "In arrivo"
  prepara(() => [conOrdine(1, { consegnaOre: 6, nataFa: 3 * MIN })]);
  let [v] = await flusso.vociStriscia(1);
  assert.equal(v.minuti, 357);
  assert.equal(v.inArrivo, false);
  assert.ok(Math.abs(v.durataSec - 6 * 3600) <= 2);
  let h = await fase(v);
  assert.match(h, /data-eta-testo="Arriva tra \{t\}">Arriva tra 5 h 57<\/span>/);
  assert.match(h, /<span class="badge-eta" data-eta-testo="\{c\}" data-eta-nascondi>5h57<\/span>/, 'oltre l\'ora il badge dice ore e minuti, non 357′');

  // nato 5 h 58 fa: mancano 2 minuti
  prepara(() => [conOrdine(2, { consegnaOre: 6, nataFa: 6 * ORA - 2 * MIN })]);
  [v] = await flusso.vociStriscia(1);
  assert.equal(v.inArrivo, true);
  assert.match(await fase(v), />In arrivo<\/span>/);

  // il corriere, se c'è, vince sulla stima; senza né l'uno né l'altra resta "In consegna"
  prepara(() => [conOrdine(3, { consegnaOre: 6, arrivoTraMin: 20, nataFa: 3 * MIN })]);
  [v] = await flusso.vociStriscia(1);
  assert.ok(v.minuti >= 19 && v.minuti <= 20);
  prepara(() => [conOrdine(4, { consegnaOre: null, nataFa: 3 * MIN })]);
  [v] = await flusso.vociStriscia(1);
  assert.equal(v.minuti, null);
});
