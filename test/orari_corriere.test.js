// Gli orari del corriere. I minuti che scrive su WhatsApp ("preso 30") sono il tempo che ci mette ad arrivare dal banco:
//  · il BANCO vede esattamente quelli (ritiro = momento della risposta + minuti, src/corriere.js);
//  · l'INSTALLATORE vede quei minuti + il tragitto dal banco a lui, calcolato sulla mappa (src/percorso.js, src/consegna.js).
// DB finto e servizio di mappe finto: nessun accesso al database vero né alla rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const radice = path.join(__dirname, '..');

// ---------------- DB finto ----------------
const chiamate = []; // { s, p, modo }
let cliente = { lat: 44.4284, lng: 8.9438, geo_consenso: 1 }; // Via Puggia, Genova
let puntiVendita = [{ lat: 44.4577, lng: 8.8877, nome: 'Fegino' }];
let rispostaDb = null; // la riga di request_responses dopo l'UPDATE del "preso"
let corriereAggiornato = { changes: 1 };
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = async (modo, p) => {
      chiamate.push({ s, p, modo });
      if (/FROM config WHERE chiave = 'velocita_media_kmh'/.test(s)) return [{ valore: '25' }];
      if (/FROM users WHERE id = \?/.test(s)) return cliente ? [cliente] : [];
      if (/FROM store_locations/.test(s)) return puntiVendita;
      if (/^UPDATE request_responses SET corriere_stato = 'preso'/.test(s)) return corriereAggiornato;
      if (/^SELECT \* FROM request_responses WHERE id = \?/.test(s)) return rispostaDb ? [rispostaDb] : [];
      if (/^SELECT \* FROM requests WHERE id = \?/.test(s)) return [{ id: 5, stato: 'in_attesa', cliente_id: 7 }]; // la richiesta è ancora aperta
      if (modo === 'run') return { changes: 1, lastInsertRowid: 1 };
      return [];
    };
    return { all: (...p) => esegui('all', p), get: async (...p) => (await esegui('get', p))[0] || null, run: (...p) => esegui('run', p) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(radice, 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const orariCorriere = require('../src/corriere');
const percorso = require('../src/percorso');
const consegna = require('../src/consegna');
const richieste = require('../src/richieste');
const format = require('../src/format');

// ---------------- src/corriere.js: il ritiro che vede il banco ----------------

test('ritiro: il momento in cui il corriere ha risposto + i minuti che ha scritto, un istante vero', () => {
  const risposto = new Date(Date.UTC(2026, 9, 20, 7, 15)); // 09:15 a Roma (ora legale)
  const r = orariCorriere.ritiro({ corriere_risposto_il: risposto, corriere_minuti: 30 });
  assert.equal(r.toISOString(), '2026-10-20T07:45:00.000Z');
  assert.equal(format.oraRoma(r), '09:45');
  // pg dà i minuti anche come testo (colonne numeriche grandi): contano lo stesso
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: risposto, corriere_minuti: '30' }).toISOString(), '2026-10-20T07:45:00.000Z');
  // minuti oltre l'ora e attraverso la mezzanotte
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: new Date(Date.UTC(2026, 9, 20, 21, 30)), corriere_minuti: 90 }).toISOString(), '2026-10-20T23:00:00.000Z');
});

test('ritiro: senza uno dei due dati (nessun corriere, modulo WhatsApp spento) non c\'è, e un valore a zero conta', () => {
  assert.equal(orariCorriere.ritiro(null), null);
  assert.equal(orariCorriere.ritiro({}), null);
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: new Date(), corriere_minuti: null }), null);
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: null, corriere_minuti: 30 }), null);
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: new Date(), corriere_minuti: undefined }), null);
  assert.equal(orariCorriere.ritiro({ corriere_risposto_il: new Date(), corriere_minuti: 'boh' }), null);
  // l'arrivo dall'installatore NON è il ritiro: corriere_arrivo_il da solo non basta a dire quando il corriere arriva dal banco
  assert.equal(orariCorriere.ritiro({ corriere_arrivo_il: new Date() }), null);
});

test('ritiroSql: la stessa somma per le query, con o senza alias, senza mai toccare corriere_arrivo_il', () => {
  assert.equal(orariCorriere.ritiroSql('o'), "(o.corriere_risposto_il + o.corriere_minuti * INTERVAL '1 minute')");
  assert.equal(orariCorriere.ritiroSql(), "(o.corriere_risposto_il + o.corriere_minuti * INTERVAL '1 minute')");
  assert.equal(orariCorriere.ritiroSql(''), "(corriere_risposto_il + corriere_minuti * INTERVAL '1 minute')");
  assert.doesNotMatch(orariCorriere.ritiroSql('o'), /corriere_arrivo_il/);
});

// ---------------- src/percorso.js: il tragitto sulla mappa ----------------

const rispostaOsrm = (json, ok = true) => async () => ({ ok, json: async () => json });
const A = { lat: 44.4577, lng: 8.8877 }; // banco
const B = { lat: 44.4284, lng: 8.9438 }; // installatore

test('minutiInAuto: chiede il tragitto con longitudine,latitudine (l\'ordine di OSRM) e ne legge durata e chilometri', async () => {
  const viste = [];
  const finto = async (url, opzioni) => {
    viste.push({ url, opzioni });
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ duration: 1272.4, distance: 8123 }] }) };
  };
  const r = await percorso.minutiInAuto(A, B, { fetch: finto });
  assert.deepEqual(r, { minuti: 21, km: 8.1 });
  assert.equal(viste.length, 1);
  assert.match(viste[0].url, /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/8\.8877,44\.4577;8\.9438,44\.4284\?/);
  assert.match(viste[0].url, /overview=false/);
  assert.ok(viste[0].opzioni.signal, 'con un limite di attesa');
  assert.match(viste[0].opzioni.headers['User-Agent'], /Minuteria/);
});

test('minutiInAuto: i minuti si arrotondano e non scendono sotto 1; ROUTING_URL cambia il servizio', async () => {
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [{ duration: 20, distance: 100 }] }) })).minuti, 1);
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [{ duration: 89, distance: 100 }] }) })).minuti, 1);
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [{ duration: 91, distance: 100 }] }) })).minuti, 2);
  const prima = process.env.ROUTING_URL;
  process.env.ROUTING_URL = 'http://osrm.interno:5000/';
  try {
    let url = '';
    await percorso.minutiInAuto(A, B, { fetch: async (u) => { url = u; return { ok: false }; } });
    assert.match(url, /^http:\/\/osrm\.interno:5000\/route\/v1\/driving\//, 'senza la barra finale doppia');
  } finally {
    if (prima === undefined) delete process.env.ROUTING_URL;
    else process.env.ROUTING_URL = prima;
  }
});

test('minutiInAuto: NON lancia mai; se il servizio non risponde o non trova la strada ritorna null (chi chiama usa la stima)', async () => {
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({}, false) }), null, 'risposta HTTP non ok');
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'NoRoute', routes: [] }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [] }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [{ duration: 'x' }] }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: rispostaOsrm({ code: 'Ok', routes: [{ duration: -5 }] }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: async () => { throw new Error('ECONNREFUSED'); } }), null, 'rete assente');
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: async () => ({ ok: true, json: async () => { throw new Error('non è JSON'); } }) }), null);
  // tempo scaduto: il segnale di annullo scatta e fetch lo rifiuta
  const lento = (url, { signal }) => new Promise((_, rifiuta) => signal.addEventListener('abort', () => rifiuta(new Error('aborted'))));
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: lento, attesaMs: 20 }), null);
});

test('minutiInAuto: senza una posizione valida non chiama nessun servizio; ROUTING_ATTIVO=0 lo spegne', async () => {
  let chiamato = 0;
  const finto = async () => { chiamato++; return { ok: true, json: async () => ({ code: 'Ok', routes: [{ duration: 600, distance: 1000 }] }) }; };
  for (const [da, a] of [[null, B], [A, undefined], [{ lat: null, lng: 8.9 }, B], [A, { lat: 'x', lng: 8.9 }], [{ lat: 44.4 }, B]]) {
    assert.equal(await percorso.minutiInAuto(da, a, { fetch: finto }), null);
  }
  assert.equal(chiamato, 0);
  process.env.ROUTING_ATTIVO = '0';
  try {
    assert.equal(percorso.attivo(), false);
    assert.equal(await percorso.minutiInAuto(A, B, { fetch: finto }), null);
    assert.equal(chiamato, 0);
  } finally {
    delete process.env.ROUTING_ATTIVO;
  }
  assert.equal(percorso.attivo(), true);
});

// ---------------- src/consegna.js: dal banco all'installatore ----------------

// Il servizio di mappe finto: si sostituisce la funzione del modulo (consegna.js la chiama come percorso.minutiInAuto).
const veroMinutiInAuto = percorso.minutiInAuto;
const conMappa = (fn) => { percorso.minutiInAuto = fn; };
test.afterEach(() => { percorso.minutiInAuto = veroMinutiInAuto; });

test('minutiStimati: il tragitto è quello della mappa, dal punto vendita più vicino alla posizione dell\'installatore', async () => {
  chiamate.length = 0;
  let visto = null;
  conMappa(async (da, a) => { visto = { da, a }; return { minuti: 21, km: 8.1 }; });
  const stima = await consegna.minutiStimati(2, 7, 0);
  assert.deepEqual(visto.da, { lat: 44.4577, lng: 8.8877, nome: 'Fegino', km: visto.da.km }, 'parte dal banco (il punto vendita)');
  assert.deepEqual(visto.a, cliente, 'arriva alla posizione dell\'installatore');
  assert.deepEqual([stima.minuti, stima.viaggio, stima.km, stima.fonte, stima.stimato], [21, 21, 8.1, 'mappa', true]);
  assert.equal(stima.partenzaDa, 'Fegino');
  // con una partenza dichiarata (gli ordini senza corriere) si somma
  assert.equal((await consegna.minutiStimati(2, 7, 1.5)).minuti, 90 + 21);
});

test('minutiStimati: se la mappa non risponde si ripiega sulla stima in linea d\'aria (con il fattore strada e la velocità media)', async () => {
  conMappa(async () => null);
  const stima = await consegna.minutiStimati(2, 7, 0);
  // ~5,5 km in linea d'aria x 1,35 = ~7,5 km a 25 km/h = ~18 minuti
  assert.equal(stima.fonte, 'stima');
  assert.equal(stima.stimato, true);
  assert.ok(stima.viaggio >= 15 && stima.viaggio <= 21, 'viaggio ' + stima.viaggio);
  assert.equal(stima.minuti, stima.viaggio);
});

test('minutiStimati: un account senza posizione (nessuna mandata dal dispositivo, o senza consenso) parte dalla sede provvisoria, non resta senza tragitto', async () => {
  const sede = require('../src/sede_installatori');
  let visto = null;
  conMappa(async (da, a) => { visto = { da, a }; return { minuti: 21, km: 8.1 }; });
  const prima = cliente;
  try {
    cliente = { lat: null, lng: null, geo_consenso: 0 };
    let stima = await consegna.minutiStimati(2, 7, 0);
    assert.deepEqual([stima.minuti, stima.viaggio, stima.stimato, stima.fonte], [21, 21, true, 'mappa'], 'il tragitto c\'è comunque');
    assert.deepEqual(visto.a, { lat: sede.lat, lng: sede.lng }, 'arriva alla sede provvisoria di tutti gli installatori');
    cliente = { lat: 45.1, lng: 9.1, geo_consenso: 0 }; // una posizione senza consenso non vale: si usa la sede, non quella
    await consegna.minutiStimati(2, 7, 0);
    assert.deepEqual(visto.a, { lat: sede.lat, lng: sede.lng });
    cliente = { lat: 45.1, lng: 9.1, geo_consenso: 1 }; // quella mandata dal dispositivo vince sulla sede
    await consegna.minutiStimati(2, 7, 0);
    assert.deepEqual(visto.a, cliente);
  } finally {
    cliente = prima;
  }
});

test('minutiStimati: senza il cliente o senza la posizione del banco non chiama la mappa e resta il solo tempo dichiarato', async () => {
  let chiamata = 0;
  conMappa(async () => { chiamata++; return { minuti: 99, km: 1 }; });
  const prima = { cliente, puntiVendita };
  try {
    cliente = null; // account che non c'è
    let stima = await consegna.minutiStimati(2, 7, 2);
    assert.deepEqual([stima.minuti, stima.viaggio, stima.stimato], [120, null, false]);
    cliente = prima.cliente;
    puntiVendita = []; // e il banco non ha nessuna posizione (neanche la riga di distributors, che il DB finto non ha)
    stima = await consegna.minutiStimati(2, 7, 0);
    assert.deepEqual([stima.minuti, stima.stimato], [0, false]);
  } finally {
    cliente = prima.cliente;
    puntiVendita = prima.puntiVendita;
  }
  assert.equal(chiamata, 0);
});

// ---------------- src/richieste.js: il corriere ha preso ----------------

test('corriereHaPreso: i minuti del corriere si SOMMANO al tragitto già calcolato (consegna_minuti_stimati), non lo sostituiscono', async () => {
  chiamate.length = 0;
  corriereAggiornato = { changes: 1 };
  rispostaDb = { id: 50, request_id: 5, corriere_stato: 'preso', corriere_minuti: 30, consegna_minuti_stimati: 51 };
  let assegnata = null;
  richieste.impostaAssegnatore(async (richiesta, risposta) => { assegnata = risposta; return 77; });
  const esito = await richieste.corriereHaPreso(50, 30, 'Marco');
  assert.deepEqual(esito, { esito: 'preso', ordineId: 77 });
  const su = chiamate.find((c) => /^UPDATE request_responses SET corriere_stato = 'preso'/.test(c.s));
  assert.ok(su, 'UPDATE del "preso"');
  assert.match(su.s, /corriere_minuti = \?/);
  assert.match(su.s, /consegna_minuti_stimati = COALESCE\(consegna_minuti_stimati, 0\) \+ \?/);
  assert.match(su.s, /AND esito = 'confermato' AND corriere_stato = 'in_attesa'/, 'una volta sola, e solo se il banco ha confermato');
  assert.deepEqual(su.p, [30, 'Marco', 30, 50], 'i minuti scritti dal corriere: nella colonna del banco e da sommare al tragitto');
  assert.equal(assegnata && assegnata.consegna_minuti_stimati, 51, 'l\'ordine nasce dalla riga già aggiornata (corriere + tragitto)');
});

test('corriereHaPreso: un secondo "preso" (o la finestra chiusa) non somma niente: l\'UPDATE non cambia righe', async () => {
  chiamate.length = 0;
  corriereAggiornato = { changes: 0 };
  rispostaDb = { id: 50, request_id: 5, corriere_stato: 'preso', corriere_nome: 'Marco' };
  assert.deepEqual(await richieste.corriereHaPreso(50, 45, 'Luca'), { esito: 'gia_preso', nome: 'Marco' });
  rispostaDb = { id: 50, request_id: 5, corriere_stato: 'scaduto' };
  assert.deepEqual(await richieste.corriereHaPreso(50, 45, 'Luca'), { esito: 'scaduta' });
  corriereAggiornato = { changes: 1 };
});
