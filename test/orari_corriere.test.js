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
let tragittoMancante = null; // la riga letta da assicuraTragitto: { tragitto, distributor_id, cliente_id }; null = nessuna riga
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = async (modo, p) => {
      chiamate.push({ s, p, modo });
      if (/FROM config WHERE chiave = 'velocita_media_kmh'/.test(s)) return [{ valore: '25' }];
      if (/FROM users WHERE id = \?/.test(s)) return cliente ? [cliente] : [];
      if (/FROM store_locations/.test(s)) return puntiVendita;
      if (/^SELECT rr.consegna_minuti_stimati AS tragitto/.test(s)) return tragittoMancante ? [tragittoMancante] : [];
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
// Ordine dei servizi: Google Maps (col traffico, se c'è la chiave) -> OSRM proprio (solo se c'è ROUTING_URL) -> Valhalla (senza chiave). Il server pubblico di
// OSRM non si usa più: dava 21 minuti dove Maps ne dice 31 (Fegino -> Via Dodecaneso).

const A = { lat: 44.4577, lng: 8.8877 }; // banco
const B = { lat: 44.4284, lng: 8.9438 }; // installatore
const risposta = (json, ok = true) => async () => ({ ok, json: async () => json });
const rispostaValhalla = (secondi, km) => ({ trip: { status: 0, summary: { time: secondi, length: km } } });
const rispostaOsrm = (secondi, metri) => ({ code: 'Ok', routes: [{ duration: secondi, distance: metri }] });
const rispostaGoogle = (durata, metri) => ({ routes: [{ duration: durata, distanceMeters: metri }] });
const VARIABILI_MAPPE = ['GOOGLE_MAPS_API_KEY', 'ROUTING_URL', 'VALHALLA_URL', 'ROUTING_ATTIVO'];
// Le prove non dipendono dal .env del PC: si parte da zero e si rimette tutto com'era.
async function conAmbiente(valori, prova) {
  const prima = {};
  for (const n of VARIABILI_MAPPE) { prima[n] = process.env[n]; delete process.env[n]; }
  Object.assign(process.env, valori);
  try { return await prova(); } finally {
    for (const n of VARIABILI_MAPPE) { if (prima[n] === undefined) delete process.env[n]; else process.env[n] = prima[n]; }
  }
}
// Un fetch finto che sceglie la risposta dall'indirizzo e tiene le chiamate.
function servizi(mappa) {
  const viste = [];
  const finto = async (url, opzioni = {}) => {
    viste.push({ url, opzioni });
    for (const [parte, fn] of Object.entries(mappa)) {
      if (String(url).includes(parte)) return fn(url, opzioni);
    }
    throw new Error('servizio non previsto: ' + url);
  };
  return { finto, viste };
}

test('minutiInAuto: senza chiave né ROUTING_URL si usa Valhalla (POST, lat/lon, auto) e se ne leggono tempo e chilometri', () => conAmbiente({}, async () => {
  const { finto, viste } = servizi({ 'valhalla1.openstreetmap.de': risposta(rispostaValhalla(2022, 14.967)) });
  const r = await percorso.minutiInAuto(A, B, { fetch: finto });
  assert.deepEqual(r, { minuti: 34, km: 15, servizio: 'valhalla' }, '2022 s = 33,7 min -> 34, come il percorso Fegino -> Via Dodecaneso');
  assert.equal(viste.length, 1);
  assert.equal(viste[0].url, 'https://valhalla1.openstreetmap.de/route');
  assert.equal(viste[0].opzioni.method, 'POST');
  assert.deepEqual(JSON.parse(viste[0].opzioni.body), { locations: [{ lat: 44.4577, lon: 8.8877 }, { lat: 44.4284, lon: 8.9438 }], costing: 'auto', directions_type: 'none' });
  assert.ok(viste[0].opzioni.signal, 'con un limite di attesa');
  assert.match(viste[0].opzioni.headers['User-Agent'], /Minuteria/);
  assert.equal(viste[0].opzioni.headers['Content-Type'], 'application/json');
  assert.deepEqual(percorso.elencoServizi(), ['valhalla']);
}));

test('minutiInAuto: con la chiave di Google si chiede il tempo CON IL TRAFFICO e vale quello (31 minuti come su Maps), senza toccare gli altri servizi', () => conAmbiente({ GOOGLE_MAPS_API_KEY: 'chiave-segreta-di-prova' }, async () => {
  const { finto, viste } = servizi({
    'routes.googleapis.com': risposta(rispostaGoogle('1860s', 15300)),
    'valhalla1.openstreetmap.de': risposta(rispostaValhalla(2022, 14.967)),
  });
  const r = await percorso.minutiInAuto(A, B, { fetch: finto });
  assert.deepEqual(r, { minuti: 31, km: 15.3, servizio: 'google' });
  assert.equal(viste.length, 1, 'Google ha risposto: nessun altro servizio');
  assert.equal(viste[0].url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(viste[0].opzioni.method, 'POST');
  assert.equal(viste[0].opzioni.headers['X-Goog-Api-Key'], 'chiave-segreta-di-prova', 'la chiave viaggia in un\'intestazione');
  assert.equal(viste[0].opzioni.headers['X-Goog-FieldMask'], 'routes.duration,routes.distanceMeters');
  assert.ok(!viste[0].url.includes('chiave-segreta'), 'mai nell\'indirizzo (finirebbe nei log)');
  const corpo = JSON.parse(viste[0].opzioni.body);
  assert.deepEqual(corpo.origin, { location: { latLng: { latitude: 44.4577, longitude: 8.8877 } } });
  assert.deepEqual(corpo.destination, { location: { latLng: { latitude: 44.4284, longitude: 8.9438 } } });
  assert.equal(corpo.travelMode, 'DRIVE');
  assert.equal(corpo.routingPreference, 'TRAFFIC_AWARE', 'il tempo con il traffico di adesso');
  assert.equal(corpo.departureTime, undefined, 'senza orario: parte adesso (un orario passato farebbe rifiutare la richiesta)');
  assert.deepEqual(percorso.elencoServizi(), ['google', 'valhalla']);
  // durata con decimali, e il minimo di un minuto
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: servizi({ 'routes.googleapis.com': risposta(rispostaGoogle('1860.4s', 100)) }).finto })).minuti, 31);
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: servizi({ 'routes.googleapis.com': risposta(rispostaGoogle('12s', 100)) }).finto })).minuti, 1);
}));

test('minutiInAuto: se Google non risponde (chiave rifiutata, quota finita, rete, risposta strana) si passa a Valhalla; mai un errore', () => conAmbiente({ GOOGLE_MAPS_API_KEY: 'k' }, async () => {
  const valhalla = risposta(rispostaValhalla(1800, 14));
  const guasti = [
    risposta({ error: { code: 403, message: 'API key not valid' } }, false),
    risposta({}),
    risposta({ routes: [] }),
    risposta({ routes: [{ distanceMeters: 100 }] }),
    risposta({ routes: [{ duration: 'tanto' }] }),
    async () => { throw new Error('ECONNRESET'); },
    async () => ({ ok: true, json: async () => { throw new Error('non è JSON'); } }),
  ];
  for (const guasto of guasti) {
    const { finto, viste } = servizi({ 'routes.googleapis.com': guasto, 'valhalla1.openstreetmap.de': valhalla });
    const r = await percorso.minutiInAuto(A, B, { fetch: finto });
    assert.deepEqual(r, { minuti: 30, km: 14, servizio: 'valhalla' });
    assert.deepEqual(viste.map((v) => v.url.split('/')[2]), ['routes.googleapis.com', 'valhalla1.openstreetmap.de'], 'prima Google, poi Valhalla');
  }
}));

test('minutiInAuto: un OSRM proprio (ROUTING_URL) viene dopo Google e prima di Valhalla; il server pubblico di OSRM non si chiama MAI', () => conAmbiente({ ROUTING_URL: 'http://osrm.interno:5000/' }, async () => {
  const { finto, viste } = servizi({
    'osrm.interno': risposta(rispostaOsrm(1272.4, 8123)),
    'valhalla1.openstreetmap.de': risposta(rispostaValhalla(2022, 14.967)),
  });
  assert.deepEqual(await percorso.minutiInAuto(A, B, { fetch: finto }), { minuti: 21, km: 8.1, servizio: 'osrm' });
  assert.match(viste[0].url, /^http:\/\/osrm\.interno:5000\/route\/v1\/driving\/8\.8877,44\.4577;8\.9438,44\.4284\?/, 'longitudine,latitudine, senza la barra finale doppia');
  assert.equal(viste.length, 1);
  // l'OSRM proprio è giù: Valhalla
  const giu = servizi({ 'osrm.interno': risposta({}, false), 'valhalla1.openstreetmap.de': risposta(rispostaValhalla(1800, 14)) });
  assert.equal((await percorso.minutiInAuto(A, B, { fetch: giu.finto })).servizio, 'valhalla');
  assert.deepEqual(percorso.elencoServizi(), ['osrm', 'valhalla']);
  for (const v of [...viste, ...giu.viste]) assert.doesNotMatch(v.url, /router\.project-osrm\.org/);
}));

test('minutiInAuto: VALHALLA_URL cambia il server; i minuti si arrotondano e non scendono sotto 1', () => conAmbiente({ VALHALLA_URL: 'http://valhalla.interno:8002/' }, async () => {
  let url = '';
  await percorso.minutiInAuto(A, B, { fetch: async (u) => { url = u; return { ok: false }; } });
  assert.equal(url, 'http://valhalla.interno:8002/route');
  const con = (secondi) => percorso.minutiInAuto(A, B, { fetch: servizi({ 'valhalla.interno': risposta(rispostaValhalla(secondi, 0.1)) }).finto });
  assert.equal((await con(20)).minuti, 1);
  assert.equal((await con(89)).minuti, 1);
  assert.equal((await con(91)).minuti, 2);
}));

test('minutiInAuto: NON lancia mai; se nessun servizio risponde o non trova la strada ritorna null (chi chiama usa la stima)', () => conAmbiente({ GOOGLE_MAPS_API_KEY: 'k', ROUTING_URL: 'http://osrm.interno:5000' }, async () => {
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: risposta({}, false) }), null, 'risposta HTTP non ok');
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: risposta({ code: 'NoRoute', routes: [] }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: risposta({ trip: { summary: { time: 'x' } } }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: risposta({ trip: { summary: { time: -5, length: 1 } } }) }), null);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: async () => { throw new Error('ECONNREFUSED'); } }), null, 'rete assente');
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: async () => ({ ok: true, json: async () => { throw new Error('non è JSON'); } }) }), null);
  // tempo scaduto per ogni servizio: il segnale di annullo scatta e fetch lo rifiuta
  const lento = (url, { signal }) => new Promise((_, rifiuta) => signal.addEventListener('abort', () => rifiuta(new Error('aborted'))));
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: lento, attesaMs: 20 }), null);
  // e un servizio lento non impedisce al successivo di rispondere
  const mezzo = servizi({ 'routes.googleapis.com': lento, 'osrm.interno': lento, 'valhalla1.openstreetmap.de': risposta(rispostaValhalla(600, 5)) });
  assert.deepEqual(await percorso.minutiInAuto(A, B, { fetch: mezzo.finto, attesaMs: 20 }), { minuti: 10, km: 5, servizio: 'valhalla' });
}));

test('minutiInAuto: senza una posizione valida non chiama nessun servizio; ROUTING_ATTIVO=0 lo spegne', () => conAmbiente({}, async () => {
  let chiamato = 0;
  const finto = async () => { chiamato++; return { ok: true, json: async () => rispostaValhalla(600, 1) }; };
  for (const [da, a] of [[null, B], [A, undefined], [{ lat: null, lng: 8.9 }, B], [A, { lat: 'x', lng: 8.9 }], [{ lat: 44.4 }, B]]) {
    assert.equal(await percorso.minutiInAuto(da, a, { fetch: finto }), null);
  }
  assert.equal(chiamato, 0);
  process.env.ROUTING_ATTIVO = '0';
  assert.equal(percorso.attivo(), false);
  assert.equal(await percorso.minutiInAuto(A, B, { fetch: finto }), null);
  assert.equal(chiamato, 0);
  delete process.env.ROUTING_ATTIVO;
  assert.equal(percorso.attivo(), true);
}));

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

// ---------------- Il tempo che vede l'installatore: corriere + tragitto, preciso e sempre presente ----------------

test('tempo all\'installatore: corriere 10 minuti + tragitto Fegino -> Via Dodecaneso come su Maps (31) = 41, non 31', () => conAmbiente({ GOOGLE_MAPS_API_KEY: 'k' }, async () => {
  // il caso della prova del 21/10/2026: con il vecchio OSRM pubblico il tragitto veniva 21 minuti (totale 31), Maps dice 31 (totale 41)
  const fetchOriginale = global.fetch;
  global.fetch = servizi({ 'routes.googleapis.com': risposta(rispostaGoogle('1860s', 15300)) }).finto;
  try {
    const stima = await consegna.minutiStimati(2, 7, 0);
    assert.deepEqual([stima.viaggio, stima.minuti, stima.km, stima.fonte, stima.servizio], [31, 31, 15.3, 'mappa', 'google']);
    // alla risposta del corriere i suoi minuti si SOMMANO (richieste.corriereHaPreso, nella UPDATE): 10 + 31 = 41
    assert.equal(10 + stima.minuti, 41);
  } finally {
    global.fetch = fetchOriginale;
  }
}));

test('tempo all\'installatore: se i servizi di mappe sono tutti giù resta una stima ragionevole e si scrive nel log, mai il solo tempo del corriere', () => conAmbiente({}, async () => {
  const fetchOriginale = global.fetch;
  const warnOriginale = console.warn;
  const avvisi = [];
  global.fetch = async () => { throw new Error('rete giù'); };
  console.warn = (m) => avvisi.push(String(m));
  try {
    const stima = await consegna.minutiStimati(2, 7, 0);
    assert.equal(stima.fonte, 'stima');
    assert.ok(stima.minuti >= 5, 'mai zero: ' + stima.minuti);
    assert.match(avvisi.join(' '), /\[tragitto\] banco 2, cliente 7: nessun servizio di mappe ha risposto/);
  } finally {
    global.fetch = fetchOriginale;
    console.warn = warnOriginale;
  }
}));

test('tempo all\'installatore: senza la posizione del banco si scrive nel log (non si mostra in silenzio un tempo corto)', async () => {
  const prima = puntiVendita;
  const warnOriginale = console.warn;
  const avvisi = [];
  console.warn = (m) => avvisi.push(String(m));
  try {
    puntiVendita = [];
    const stima = await consegna.minutiStimati(2, 7, 0);
    assert.equal(stima.stimato, false);
    assert.match(avvisi.join(' '), /manca una posizione \(banco\)/);
  } finally {
    puntiVendita = prima;
    console.warn = warnOriginale;
  }
});

test('corriereHaPreso: se alla conferma il tragitto non era stato scritto (0 o vuoto) lo ricalcola PRIMA di sommare i minuti del corriere', async () => {
  chiamate.length = 0;
  corriereAggiornato = { changes: 1 };
  rispostaDb = { id: 50, request_id: 5, corriere_stato: 'preso', corriere_minuti: 10, consegna_minuti_stimati: 41 };
  richieste.impostaAssegnatore(async () => 77);
  conMappa(async () => ({ minuti: 31, km: 15.3, servizio: 'google' }));
  for (const mancante of [0, null]) {
    chiamate.length = 0;
    tragittoMancante = { tragitto: mancante, distributor_id: 2, cliente_id: 7 };
    assert.deepEqual(await richieste.corriereHaPreso(50, 10, 'Marco'), { esito: 'preso', ordineId: 77 });
    const sistema = chiamate.findIndex((c) => /^UPDATE request_responses SET consegna_minuti_stimati = \? WHERE id = \? AND COALESCE\(consegna_minuti_stimati, 0\) <= 0/.test(c.s));
    const somma = chiamate.findIndex((c) => /^UPDATE request_responses SET corriere_stato = 'preso'/.test(c.s));
    assert.ok(sistema >= 0, 'il tragitto si riscrive (mancante: ' + mancante + ')');
    assert.deepEqual(chiamate[sistema].p, [31, 50]);
    assert.ok(sistema < somma, 'prima il tragitto, poi la somma dei minuti del corriere');
  }
  // il tragitto c'era: nessun ricalcolo, nessuna chiamata alla mappa
  let mappa = 0;
  conMappa(async () => { mappa++; return { minuti: 99, km: 1 }; });
  chiamate.length = 0;
  tragittoMancante = { tragitto: 31, distributor_id: 2, cliente_id: 7 };
  await richieste.corriereHaPreso(50, 10, 'Marco');
  assert.equal(mappa, 0);
  assert.ok(!chiamate.some((c) => /SET consegna_minuti_stimati = \? WHERE id = \? AND COALESCE/.test(c.s)));
  // e se il ricalcolo si rompe il "preso" va avanti lo stesso: l'ordine nasce, con il solo tempo del corriere
  const erroreOriginale = console.error;
  console.error = () => {};
  try {
    conMappa(async () => { throw new Error('mappa rotta'); });
    tragittoMancante = { tragitto: 0, distributor_id: 2, cliente_id: 7 };
    assert.deepEqual(await richieste.corriereHaPreso(50, 10, 'Marco'), { esito: 'preso', ordineId: 77 });
  } finally {
    console.error = erroreOriginale;
    tragittoMancante = null;
  }
});
