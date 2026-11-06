// I pezzi senza database dell'app dei corrieri: l'interruttore dei due ambienti (src/logica/ordini/modalita_corrieri.js) e gli aiuti di
// src/logica/corrieri/consegne.js (posizione, zona del cantiere, link alle mappe, orari del banco). Il giro completo su un Postgres vero sta in
// app_corrieri_postgres.test.js. Nessun accesso al database né alla rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Un DB finto che non risponde a niente: qui nessuna funzione che lo usa viene chiamata.
const dbFinto = {
  prepare: () => {
    throw new Error('questo test non deve toccare il database');
  },
  transaction: (fn) => fn,
};
const percorsoDb = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const modalita = require('../../src/logica/ordini/modalita_corrieri');
const consegne = require('../../src/logica/corrieri/consegne');

// Imposta (o toglie, con undefined) due variabili d'ambiente per la durata di una prova.
async function conAmbiente(variabili, prova) {
  const prima = {};
  for (const [k, v] of Object.entries(variabili)) {
    prima[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await prova();
  } finally {
    for (const [k, v] of Object.entries(prima)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------- interruttore dei due ambienti ----------------

test('ambiente reale (WhatsApp) o senza corrieri: l\'app dei corrieri è spenta e tutto resta come prima', async () => {
  await conAmbiente({ CORRIERI_APP: undefined, WHATSAPP_ATTIVO: '1' }, () => {
    assert.equal(modalita.appAttiva(), false);
    assert.equal(modalita.conCorriere(), true, 'con WhatsApp acceso la conferma del banco aspetta un corriere');
    assert.equal(modalita.erroreConfigurazione(), null);
  });
  await conAmbiente({ CORRIERI_APP: undefined, WHATSAPP_ATTIVO: undefined }, () => {
    assert.equal(modalita.conCorriere(), false, 'senza nessun canale l\'ordine nasce subito');
    assert.equal(modalita.erroreConfigurazione(), null);
  });
  await conAmbiente({ CORRIERI_APP: '0', WHATSAPP_ATTIVO: '1' }, () => {
    assert.equal(modalita.appAttiva(), false, 'solo "1" accende l\'app');
  });
});

test('ambiente app: i corrieri usano l\'app e la conferma del banco li aspetta', async () => {
  await conAmbiente({ CORRIERI_APP: '1', WHATSAPP_ATTIVO: '0' }, () => {
    assert.equal(modalita.appAttiva(), true);
    assert.equal(modalita.conCorriere(), true);
    assert.equal(modalita.erroreConfigurazione(), null);
  });
  await conAmbiente({ CORRIERI_APP: ' 1 ', WHATSAPP_ATTIVO: undefined }, () => {
    assert.equal(modalita.appAttiva(), true, 'gli spazi attorno non contano');
  });
});

test('app dei corrieri e WhatsApp accesi insieme: configurazione rifiutata (il server non parte)', async () => {
  await conAmbiente({ CORRIERI_APP: '1', WHATSAPP_ATTIVO: '1' }, () => {
    const errore = modalita.erroreConfigurazione();
    assert.match(errore, /CORRIERI_APP=1 e WHATSAPP_ATTIVO=1/);
    assert.match(errore, /docs\/ambienti\.md/);
  });
});

// ---------------- posizione del telefono ----------------

test('leggiPosizione: due numeri veri dentro i limiti della Terra, anche scritti come testo; altrimenti null', () => {
  assert.deepEqual(consegne.leggiPosizione(44.4056, 8.9463), { lat: 44.4056, lng: 8.9463 });
  assert.deepEqual(consegne.leggiPosizione('44.4056', '8.9463'), { lat: 44.4056, lng: 8.9463 });
  assert.deepEqual(consegne.leggiPosizione(-33.9, -70.7), { lat: -33.9, lng: -70.7 });
  for (const [lat, lng] of [
    [undefined, undefined], [null, null], ['', ''], [44.4, undefined], [undefined, 8.9], ['abc', '8.9'], [91, 8.9], [44.4, 181], [-91, 0], [0, 0], ['0', '0'],
    [NaN, 8.9], [Infinity, 8.9], [{}, {}], [['1', '2'], ['3', '4']],
  ]) {
    assert.equal(consegne.leggiPosizione(lat, lng), null, JSON.stringify([lat, lng]));
  }
});

// ---------------- zona del cantiere ----------------

test('zonaDaIndirizzo: la città dopo il CAP (con o senza provincia), altrimenti l\'ultimo pezzo; vuota se non si capisce', () => {
  assert.equal(consegne.zonaDaIndirizzo('Via Puggia 22/3, 16131 Genova GE'), 'Genova');
  assert.equal(consegne.zonaDaIndirizzo('Cantiere Via Tortona 3, 16139 Genova (GE)'), 'Genova');
  assert.equal(consegne.zonaDaIndirizzo('Via Roma 1, 17100 Savona'), 'Savona');
  assert.equal(consegne.zonaDaIndirizzo('Via Aurelia 5, 16035 Rapallo GE'), 'Rapallo');
  assert.equal(consegne.zonaDaIndirizzo('Via Roma 1, Savona'), 'Savona');
  assert.equal(consegne.zonaDaIndirizzo('Via Roma 1'), '');
  assert.equal(consegne.zonaDaIndirizzo(''), '');
  assert.equal(consegne.zonaDaIndirizzo(null), '');
});

// ---------------- link alle mappe ----------------

test('urlMappe: link di Google Maps con le coordinate (più precise) o con l\'indirizzo; senza partenza parte dalla posizione del telefono', () => {
  const soloArrivo = new URL(consegne.urlMappe(null, { lat: 44.4577, lng: 8.8877, indirizzo: 'Via X 1' }));
  assert.equal(soloArrivo.origin + soloArrivo.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(soloArrivo.searchParams.get('api'), '1');
  assert.equal(soloArrivo.searchParams.get('travelmode'), 'driving');
  assert.equal(soloArrivo.searchParams.get('destination'), '44.4577,8.8877');
  assert.equal(soloArrivo.searchParams.has('origin'), false);

  const conPartenza = new URL(consegne.urlMappe({ lat: 44.4577, lng: 8.8877 }, { lat: null, lng: null, indirizzo: 'Via Puggia 22/3, 16131 Genova GE' }));
  assert.equal(conPartenza.searchParams.get('origin'), '44.4577,8.8877');
  assert.equal(conPartenza.searchParams.get('destination'), 'Via Puggia 22/3, 16131 Genova GE', 'senza coordinate vale il testo dell\'indirizzo');
});

// ---------------- orari del banco ----------------

const SETTIMANA = {
  lun: [['07:30', '12:30'], ['14:00', '18:00']], mar: [['07:30', '12:30'], ['14:00', '18:00']], mer: [['07:30', '12:30'], ['14:00', '18:00']],
  gio: [['07:30', '12:30'], ['14:00', '18:00']], ven: [['07:30', '12:30'], ['14:00', '18:00']], sab: [['07:30', '12:00']], dom: [],
};

test('orariDelBanco: aperto adesso (fasce di oggi e fino a che ora), chiuso con la riapertura, nessun orario = null', () => {
  // Lunedì 9 novembre 2026: a Roma sono UTC+1.
  const alle10 = new Date('2026-11-09T09:00:00Z');
  const aperto = consegne.orariDelBanco(SETTIMANA, alle10);
  assert.equal(aperto.aperto, true);
  assert.deepEqual(aperto.oggi, ['7:30 – 12:30', '14:00 – 18:00']);
  assert.equal(aperto.testo, 'Banco aperto 7:30 – 12:30 · 14:00 – 18:00');
  assert.equal(aperto.chiude_alle, '12:30');

  const alle13 = new Date('2026-11-09T12:00:00Z');
  const pausa = consegne.orariDelBanco(SETTIMANA, alle13);
  assert.equal(pausa.aperto, false);
  assert.equal(pausa.testo, 'Banco chiuso · riapre oggi alle 14:00');
  assert.equal(pausa.chiude_alle, null);

  const domenica = new Date('2026-11-08T10:00:00Z');
  const chiuso = consegne.orariDelBanco(SETTIMANA, domenica);
  assert.equal(chiuso.aperto, false);
  assert.deepEqual(chiuso.oggi, []);
  assert.equal(chiuso.testo, 'Banco chiuso · riapre domani alle 07:30');

  assert.equal(consegne.orariDelBanco(null, alle10), null, 'banco senza orari impostati');
  assert.equal(consegne.orariDelBanco('non è json', alle10), null);
  // L'orario arriva dal DB anche come testo JSON.
  assert.equal(consegne.orariDelBanco(JSON.stringify(SETTIMANA), alle10).aperto, true);
});
