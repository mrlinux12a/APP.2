// Notifiche push del browser (src/notifiche.js): le vecchie non devono arrivare tutte insieme quando si attivano gli avvisi sul telefono.
// DB finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const scritture = [];
let righe = [];
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      all: async () => (/^SELECT id, titolo/.test(s) ? righe : []),
      get: async () => null,
      run: async (...p) => { scritture.push({ s, p }); return { changes: 1 }; },
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };
const notifiche = require('../src/notifiche');

const nota = (id, eta_sec) => ({ id, titolo: 'T' + id, testo: '', link: '/', tipo: null, request_id: null, order_id: null, eta_sec });

test('daMostrare con massimoEtaSec: le vecchie si segnano come mostrate ma NON si restituiscono', async () => {
  scritture.length = 0;
  righe = [nota(1, 3 * 86400), nota(2, 700), nota(3, 120), nota(4, 600)];
  const nuove = await notifiche.daMostrare(5, { massimoEtaSec: 600 });
  assert.deepEqual(nuove.map((n) => n.id), [3, 4], 'solo quelle degli ultimi 10 minuti (estremo compreso)');
  assert.equal(scritture.length, 1);
  assert.match(scritture[0].s, /^UPDATE notifications SET notificata = 1/);
  assert.deepEqual(scritture[0].p, [5, [1, 2, 3, 4]], 'tutte segnate, anche quelle scartate: non torneranno al giro dopo');
});

test('daMostrare senza limite (il banco): restituisce tutte, come prima', async () => {
  righe = [nota(1, 3 * 86400), nota(2, 5)];
  assert.deepEqual((await notifiche.daMostrare(5)).map((n) => n.id), [1, 2]);
});

test('daMostrare senza niente di nuovo: nessuna scrittura', async () => {
  scritture.length = 0;
  righe = [];
  assert.deepEqual(await notifiche.daMostrare(5, { massimoEtaSec: 600 }), []);
  assert.equal(scritture.length, 0);
});

test('segnaTutteNotificate: all\'attivazione tutto quello che c\'è già diventa storia', async () => {
  scritture.length = 0;
  await notifiche.segnaTutteNotificate(9);
  assert.equal(scritture.length, 1);
  assert.match(scritture[0].s, /^UPDATE notifications SET notificata = 1 WHERE user_id = \? AND notificata = 0$/);
  assert.deepEqual(scritture[0].p, [9]);
});
