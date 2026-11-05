// "La mia anagrafica" dell'app (GET /api/v1/profilo): oltre ai dati dell'impresa porta lo stato dell'anagrafica ('in_attesa' = nessun banco l'ha ancora approvata: la
// pagina avvisa che si può sfogliare ma non inviare richieste) e il codice cliente del banco di riferimento, solo se quel banco ha approvato. DB finto: nessun
// accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const impronta = (t) => crypto.createHash('sha256').update(t).digest('hex');
const utente = { id: 9, username: 'rossi', ragione_sociale: 'Rossi Impianti Srl', ruolo: 'cliente', attivo: 1, stato_anagrafica: 'attivo', tipo_soggetto: 'impresa' };
let legami = [];
const tokenValidi = new Set(); // impronte dei token concessi in questo file di prove

// Il DB finto riconosce solo le query che servono qui: lettura del token e dei collegamenti con i banchi.
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      get: async (...p) => (/^SELECT t\.id AS token_id/.test(s) && tokenValidi.has(p[0]) ? { ...utente, token_id: 1, usato_il: new Date() } : null),
      all: async () => (/FROM client_distributors cd/.test(s) ? legami : []),
      run: async () => ({ changes: 1 }),
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

// Il server ricorda per un minuto l'utente di un token già visto: ogni prova usa un token nuovo, così legge lo stato che ha appena impostato.
let contatore = 0;
function leggi() {
  const token = 'token-prova-' + ++contatore;
  tokenValidi.add(impronta(token));
  return fetch(base + '/profilo', { headers: { authorization: 'Bearer ' + token } });
}

test('banco che ha approvato: il profilo dice il nome del banco e il codice cliente', async () => {
  utente.stato_anagrafica = 'attivo';
  legami = [{ distributor_id: 1, distributore: 'BOREA', filiale: '', ditta_id: 1, stato: 'approvato', codice_cliente: 'C-4521' }];
  const r = await leggi();
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.utente.stato_anagrafica, 'attivo');
  assert.equal(j.codice_cliente, 'C-4521');
  assert.ok(j.distributore, 'il nome del banco di riferimento c\'è');
});

test('nessun banco ha ancora approvato: stato "in_attesa" e nessun codice cliente (anche se la riga ne avesse uno)', async () => {
  utente.stato_anagrafica = 'in_attesa';
  legami = [{ distributor_id: 1, distributore: 'BOREA', filiale: '', ditta_id: 1, stato: 'in_attesa', codice_cliente: 'C-PROVVISORIO' }];
  const j = await (await leggi()).json();
  assert.equal(j.utente.stato_anagrafica, 'in_attesa');
  assert.equal(j.codice_cliente, '', 'il codice si mostra solo a banco approvato');
  assert.ok(j.distributore);
});

test('senza nessun collegamento: nessun banco e nessun codice', async () => {
  utente.stato_anagrafica = 'in_attesa';
  legami = [];
  const j = await (await leggi()).json();
  assert.equal(j.distributore, null);
  assert.equal(j.codice_cliente, '');
});

test('senza accesso: 401', async () => {
  assert.equal((await fetch(base + '/profilo')).status, 401);
});
