// La richiesta dell'app (GET /api/v1/richieste/:id) porta anche l'indirizzo di consegna scritto nel carrello (`destinazione`): l'app lo mostra nella
// scheda "Consegna in cantiere" sotto il banco in ogni fase (in attesa, nessuna risposta, annullata), come fa già per l'ordine. Senza indirizzo vale null
// e la scheda non compare. DB finto e dettaglio finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const impronta = (t) => crypto.createHash('sha256').update(t).digest('hex');
const utente = { id: 9, username: 'rossi', ragione_sociale: 'Rossi Impianti Srl', ruolo: 'cliente', attivo: 1, stato_anagrafica: 'attivo', tipo_soggetto: 'impresa' };
const tokenValidi = new Set();

// Il DB finto riconosce solo la lettura del token: il resto lo fanno le funzioni sostituite qui sotto.
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      get: async (...p) => (/^SELECT t\.id AS token_id/.test(s) && tokenValidi.has(p[0]) ? { ...utente, token_id: 1, usato_il: new Date() } : null),
      all: async () => [],
      run: async () => ({ changes: 1 }),
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const richieste = require('../../src/logica/ordini/richieste');
const flusso = require('../../src/logica/ordini/flusso_cliente');
const apiV1 = require('../../src/routes/api_v1');

let riga = null;
richieste.aggiornaScadenza = async () => riga;
flusso.dettaglioRichiesta = async () => ({
  secondi: 0,
  minutiRisposta: 10,
  minutiTesto: 10,
  righe: [],
  righePrezzi: [],
  importi: { app: { totale: 0, corriere: 0, servizioIva: 0, imponibile: 0, iva: 0, ivaInclusa: true }, banco: { totale: 0, merce: 0, raee: 0, imponibile: 0, iva: 0 }, servizioPct: 10, ivaPct: 22 },
  ditta: 'BOREA',
  rinvio: { consegna: 0, materiale: 0 },
  risposte: [],
  statoPag: null,
  annullabile: false,
});

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

let contatore = 0;
function leggi() {
  const token = 'token-richiesta-' + ++contatore;
  tokenValidi.add(impronta(token));
  return fetch(base + '/richieste/5', { headers: { authorization: 'Bearer ' + token } });
}

test('la richiesta porta l\'indirizzo di consegna scritto nel carrello', async () => {
  riga = { id: 5, cliente_id: 9, stato: 'in_attesa', creato_il: new Date(), scade_il: new Date(Date.now() + 60000), destinazione: 'Via Roma 12, Genova' };
  const r = await leggi();
  assert.equal(r.status, 200);
  assert.equal((await r.json()).destinazione, 'Via Roma 12, Genova');
});

test('senza indirizzo: destinazione null (la scheda non compare)', async () => {
  riga = { id: 5, cliente_id: 9, stato: 'nessuna_offerta', creato_il: new Date(), scade_il: new Date(), destinazione: '' };
  const j = await (await leggi()).json();
  assert.equal(j.destinazione, null);
});

test('la richiesta di un altro cliente non si vede: 404', async () => {
  riga = { id: 5, cliente_id: 77, stato: 'in_attesa', creato_il: new Date(), scade_il: new Date(), destinazione: 'Via Segreta 1' };
  assert.equal((await leggi()).status, 404);
});
