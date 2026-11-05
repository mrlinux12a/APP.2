// Cambio della password dall'app (POST /api/v1/password): stesse regole del sito, e a chi la cambia si dà subito un accesso nuovo, perché il cambio revoca
// tutti quelli vecchi, compreso il suo. DB finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');

const impronta = (t) => crypto.createHash('sha256').update(t).digest('hex');
const utente = { id: 7, username: 'prova', ragione_sociale: 'Prova srl', ruolo: 'cliente', attivo: 1, password_hash: bcrypt.hashSync('vecchia-password', 4) };
const accessi = new Map(); // impronta del token -> { revocato }
const scritture = [];

// Il DB finto riconosce solo le query che servono qui: lettura del token, lettura della password, e le scritture del cambio.
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      get: async (...p) => {
        if (/^SELECT t\.id AS token_id/.test(s)) {
          const t = accessi.get(p[0]);
          return t && !t.revocato ? { ...utente, token_id: 1, usato_il: new Date() } : null;
        }
        if (/^SELECT id, password_hash FROM users WHERE id = \?/.test(s)) return { id: utente.id, password_hash: utente.password_hash };
        return null;
      },
      all: async () => [],
      run: async (...p) => {
        scritture.push({ s, p });
        if (/^INSERT INTO app_tokens/.test(s)) accessi.set(p[1], { revocato: false });
        if (/^UPDATE app_tokens SET revocato_il = NOW\(\) WHERE user_id/.test(s)) for (const t of accessi.values()) t.revocato = true;
        if (/^UPDATE users SET password_hash/.test(s)) utente.password_hash = p[0];
        return { changes: 1 };
      },
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const apiV1 = require('../../src/routes/api_v1');

const app = express();
app.use(express.json());
app.use('/api/v1', apiV1);
let server;
let base;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((fatto) => server.once('listening', fatto));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(() => server.close());

// Riparte da un telefono con un accesso valido e la password di prima.
function riparti() {
  accessi.clear();
  accessi.set(impronta('token-vecchio'), { revocato: false });
  utente.password_hash = bcrypt.hashSync('vecchia-password', 4);
  scritture.length = 0;
}

const cambia = (corpo, token = 'token-vecchio') =>
  fetch(base + '/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(corpo),
  });
const sceglie = (attuale, nuova, ripeti = nuova) => ({ attuale, nuova, ripeti, dispositivo: 'android' });

test('cambio riuscito: la password si salva, il vecchio accesso è revocato e questo telefono ne riceve uno nuovo che funziona', async () => {
  riparti();
  const r = await cambia(sceglie('vecchia-password', 'nuova-password-1'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(j.token && j.token !== 'token-vecchio', 'un accesso nuovo, diverso dal vecchio');
  assert.ok(await bcrypt.compare('nuova-password-1', utente.password_hash), 'la password nuova è salvata (hash)');
  const iRevoca = scritture.findIndex((w) => /^UPDATE app_tokens SET revocato_il/.test(w.s));
  const iNuovo = scritture.findIndex((w) => /^INSERT INTO app_tokens/.test(w.s));
  assert.ok(iRevoca >= 0 && iNuovo > iRevoca, 'gli accessi vecchi si revocano PRIMA di crearne uno nuovo (altrimenti anche il nuovo verrebbe revocato)');
  assert.equal((await fetch(base + '/me', { headers: { authorization: 'Bearer ' + j.token } })).status, 200, 'il nuovo accesso vale');
  assert.equal((await fetch(base + '/me', { headers: { authorization: 'Bearer token-vecchio' } })).status, 401, 'il vecchio non vale più');
});

test('password attuale sbagliata: 400 sul campo giusto e niente viene scritto', async () => {
  riparti();
  const r = await cambia(sceglie('sbagliata', 'nuova-password-1'));
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.ok(j.errori.attuale);
  assert.equal(j.errore, j.errori.attuale, 'il messaggio principale è il primo errore');
  assert.ok(!scritture.some((w) => /^UPDATE users|^INSERT INTO app_tokens/.test(w.s)), 'nessuna password cambiata, nessun accesso nuovo');
});

test('campi scritti male: nuova troppo corta, ripetizione diversa, uguale all\'attuale', async () => {
  riparti();
  let r = await cambia(sceglie('vecchia-password', 'corta'));
  assert.equal(r.status, 400);
  assert.ok((await r.json()).errori.nuova);
  r = await cambia(sceglie('vecchia-password', 'nuova-password-1', 'nuova-password-2'));
  assert.equal(r.status, 400);
  assert.ok((await r.json()).errori.ripeti);
  r = await cambia(sceglie('vecchia-password', 'vecchia-password'));
  assert.equal(r.status, 400);
  assert.match((await r.json()).errori.nuova, /diversa/);
  assert.ok(!scritture.some((w) => /^UPDATE users/.test(w.s)));
});

test('senza accesso o con un accesso sconosciuto: 401', async () => {
  riparti();
  assert.equal((await cambia(sceglie('vecchia-password', 'nuova-password-1'), null)).status, 401);
  assert.equal((await cambia(sceglie('vecchia-password', 'nuova-password-1'), 'token-inventato')).status, 401);
  assert.ok(!scritture.some((w) => /^UPDATE users/.test(w.s)));
});

test('troppe password attuali sbagliate: 429, anche scrivendo poi quella giusta', async () => {
  riparti();
  let bloccato = false;
  for (let i = 0; i < 10 && !bloccato; i++) bloccato = (await cambia(sceglie('sbagliata-' + i, 'nuova-password-1'))).status === 429;
  assert.ok(bloccato, 'dopo una serie di tentativi sbagliati risponde 429');
  const r = await cambia(sceglie('vecchia-password', 'nuova-password-1'));
  assert.equal(r.status, 429);
  assert.ok(!scritture.some((w) => /^UPDATE users/.test(w.s)), 'bloccata: la password non cambia nemmeno se quella attuale è giusta');
});
