// db/postgres/resilienza.js: cosa si riprova e cosa no quando la rete verso il database cade, e la risposta immediata quando è giù.
// Pool finto: nessuna connessione vera.
const test = require('node:test');
const assert = require('node:assert/strict');
const { eErroreDiRete, eLettura, eSessione, eRiprovabile, ErroreDbNonRaggiungibile, creaInterruttore, creaEsecutore } = require('../db/postgres/resilienza');

const errRete = (messaggio = 'Connection terminated unexpectedly', code) => Object.assign(new Error(messaggio), code ? { code } : {});

// Un pool che esegue il "copione": ogni connect() o query() prende il prossimo passo (un errore da lanciare, o un risultato).
function poolFinto({ connessioni = [], queries = [] } = {}) {
  const stato = { connect: 0, query: 0, rilasci: [], testi: [] };
  return {
    stato,
    async connect() {
      const passo = connessioni[stato.connect++];
      if (passo instanceof Error) throw passo;
      return {
        async query(testo, params) {
          stato.testi.push(testo);
          const q = queries[stato.query++];
          if (q instanceof Error) throw q;
          return q === undefined ? { rows: [{ ok: 1 }], rowCount: 1 } : q;
        },
        release(errore) { stato.rilasci.push(errore ? 'buttato' : 'rimesso'); },
      };
    },
  };
}
const senzaAttesa = () => Promise.resolve();
const esecutore = (pool, opzioni = {}) => creaEsecutore({ pool, attesa: senzaAttesa, ...opzioni });

test('eErroreDiRete: riconosce rete e server giù, non gli errori della query', () => {
  for (const e of [
    errRete('read ECONNRESET', 'ECONNRESET'),
    errRete('getaddrinfo ENOTFOUND aws-1-eu-west-1.pooler.supabase.com', 'ENOTFOUND'),
    errRete('Connection terminated unexpectedly'),
    errRete('Connection terminated due to connection timeout'),
    errRete('timeout exceeded when trying to connect'),
    errRete('Client has encountered a connection error and is not queryable'),
    errRete('x', '08006'),
    errRete('x', '57P01'),
    new ErroreDbNonRaggiungibile(errRete('boh')),
    Object.assign(new Error('avvolto'), { cause: errRete('read ECONNRESET', 'ECONNRESET') }),
  ]) assert.equal(eErroreDiRete(e), true, e.message);
  for (const e of [
    errRete('duplicate key value violates unique constraint', '23505'),
    errRete('syntax error at or near "FORM"', '42601'),
    errRete('password authentication failed', '28P01'),
    errRete('canceling statement due to statement timeout', '57014'),
    null,
    undefined,
  ]) assert.equal(eErroreDiRete(e), false, String(e && e.message));
});

test('eLettura / eRiprovabile: solo le letture pure e le istruzioni delle sessioni', () => {
  assert.equal(eLettura('SELECT * FROM orders WHERE id = $1'), true);
  assert.equal(eLettura('  select 1'), true);
  assert.equal(eLettura('WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(eLettura('SELECT creato_il, updated_at FROM t'), true, 'una colonna che somiglia a UPDATE non è una scrittura');
  assert.equal(eLettura('WITH x AS (UPDATE orders SET stato = 1 RETURNING id) SELECT * FROM x'), false);
  assert.equal(eLettura('SELECT id FROM orders WHERE id = $1 FOR UPDATE'), false);
  assert.equal(eLettura('INSERT INTO orders (a) VALUES ($1)'), false);
  assert.equal(eLettura('UPDATE orders SET stato = $1'), false);
  assert.equal(eLettura('DELETE FROM orders'), false);
  assert.equal(eSessione('INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2'), true);
  assert.equal(eSessione('UPDATE session SET expire = $1 WHERE sid = $2'), true);
  assert.equal(eSessione('DELETE FROM session WHERE sid = $1'), true);
  assert.equal(eSessione('UPDATE orders SET stato = $1'), false);
  assert.equal(eRiprovabile('UPDATE session SET expire = $1 WHERE sid = $2'), true);
  assert.equal(eRiprovabile('UPDATE orders SET totale = totale + 1'), false);
});

test('la connessione si riprova sempre: nessuna query è partita, quindi anche una scrittura è al sicuro', async () => {
  const pool = poolFinto({ connessioni: [errRete('timeout exceeded when trying to connect'), {}] });
  const r = await esecutore(pool).interroga('INSERT INTO orders (a) VALUES ($1)', [1]);
  assert.equal(r.rowCount, 1);
  assert.equal(pool.stato.connect, 2);
  assert.equal(pool.stato.query, 1, 'la scrittura è partita una volta sola');
  assert.deepEqual(pool.stato.rilasci, ['rimesso']);
});

test('una lettura che perde la connessione a metà si rifà su una connessione nuova; il client rotto non torna nel pool', async () => {
  const pool = poolFinto({ queries: [errRete('Connection terminated unexpectedly'), { rows: [{ n: 7 }], rowCount: 1 }] });
  const r = await esecutore(pool).interroga('SELECT n FROM t', []);
  assert.deepEqual(r.rows, [{ n: 7 }]);
  assert.equal(pool.stato.connect, 2);
  assert.deepEqual(pool.stato.rilasci, ['buttato', 'rimesso']);
});

test('una scrittura che perde la connessione a metà NON si rifà (potrebbe essere arrivata): errore 503, una sola esecuzione', async () => {
  const pool = poolFinto({ queries: [errRete('read ECONNRESET', 'ECONNRESET')] });
  await assert.rejects(
    esecutore(pool).interroga('INSERT INTO orders (a) VALUES ($1)', [1]),
    (e) => e instanceof ErroreDbNonRaggiungibile && e.status === 503 && e.dbNonRaggiungibile === true && e.cause.code === 'ECONNRESET'
  );
  assert.equal(pool.stato.query, 1);
  assert.deepEqual(pool.stato.rilasci, ['buttato']);
});

test('le istruzioni delle sessioni sono ripetibili anche se sono scritture', async () => {
  const pool = poolFinto({ queries: [errRete('Connection terminated unexpectedly'), {}] });
  await esecutore(pool).interroga('UPDATE session SET expire = $1 WHERE sid = $2', [1, 2]);
  assert.equal(pool.stato.query, 2);
});

test('un errore della query (vincolo, sintassi) passa com\'è: nessuna riprova, client rimesso nel pool, interruttore intatto', async () => {
  const dup = errRete('duplicate key value violates unique constraint', '23505');
  const pool = poolFinto({ queries: [dup] });
  const e = esecutore(pool);
  await assert.rejects(e.interroga('SELECT 1', []), (err) => err === dup);
  assert.equal(pool.stato.query, 1);
  assert.deepEqual(pool.stato.rilasci, ['rimesso']);
  assert.deepEqual(e.interruttore.stato(), { falliti: 0, apertoFinoA: 0 });
});

test('un errore di connessione che non è di rete (password sbagliata) sale subito, senza riprove', async () => {
  const auth = errRete('password authentication failed', '28P01');
  const pool = poolFinto({ connessioni: [auth] });
  await assert.rejects(esecutore(pool).interroga('SELECT 1', []), (err) => err === auth);
  assert.equal(pool.stato.connect, 1);
});

test('rete giù: dopo i tentativi errore 503; poi l\'interruttore risponde subito senza toccare il pool; passata la pausa si riprova', async () => {
  let ora = 1000;
  const pool = poolFinto({ connessioni: Array.from({ length: 10 }, () => errRete('Connection terminated due to connection timeout')) });
  const e = esecutore(pool, { interruttore: creaInterruttore({ soglia: 3, pausaMs: 5000, adesso: () => ora }) });

  // 1ª richiesta: 2 tentativi (falliti = 2), errore con la causa
  await assert.rejects(e.interroga('SELECT 1', []), (err) => err.dbNonRaggiungibile && /connection timeout/.test(err.cause.message));
  assert.equal(pool.stato.connect, 2);
  assert.equal(e.interruttore.aperto(), false);
  // 2ª richiesta: il terzo fallimento apre l'interruttore, quindi niente secondo tentativo
  await assert.rejects(e.interroga('SELECT 1', []), (err) => err.dbNonRaggiungibile);
  assert.equal(pool.stato.connect, 3);
  assert.equal(e.interruttore.aperto(), true);
  // finché è aperto: risposta immediata, il pool non viene nemmeno toccato
  await assert.rejects(e.interroga('SELECT 1', []), (err) => err.dbNonRaggiungibile && /tentativo saltato/.test(err.message));
  assert.equal(pool.stato.connect, 3);
  // passata la pausa si prova di nuovo
  ora += 5001;
  assert.equal(e.interruttore.aperto(), false);
  await assert.rejects(e.interroga('SELECT 1', []), (err) => err.dbNonRaggiungibile);
  assert.equal(pool.stato.connect, 4);
});

test("il timeout dell'attesa nel pool (pool pieno) si riprova ma non apre l'interruttore: non è la rete a essere giù", async () => {
  const pool = poolFinto({ connessioni: Array.from({ length: 20 }, () => errRete('timeout exceeded when trying to connect')) });
  const e = esecutore(pool, { interruttore: creaInterruttore({ soglia: 3 }) });
  for (let i = 0; i < 5; i++) await assert.rejects(e.interroga('SELECT 1', []), (err) => err.dbNonRaggiungibile);
  assert.equal(pool.stato.connect, 10, 'due tentativi per richiesta, ogni volta');
  assert.equal(e.interruttore.aperto(), false);
  assert.deepEqual(e.interruttore.stato(), { falliti: 0, apertoFinoA: 0 });
});

test('un successo azzera il conto dei fallimenti: la rete a tratti non apre l\'interruttore', async () => {
  const pool = poolFinto({
    connessioni: [errRete('timeout exceeded when trying to connect'), {}, errRete('timeout exceeded when trying to connect'), {}, errRete('timeout exceeded when trying to connect'), {}],
  });
  const e = esecutore(pool, { interruttore: creaInterruttore({ soglia: 3 }) });
  for (let i = 0; i < 3; i++) await e.interroga('SELECT 1', []);
  assert.equal(e.interruttore.aperto(), false);
  assert.deepEqual(e.interruttore.stato(), { falliti: 0, apertoFinoA: 0 });
});

test('collega() (per le transazioni) usa le stesse regole: riprova la connessione, poi 503', async () => {
  const pool = poolFinto({ connessioni: [errRete('read ECONNRESET', 'ECONNRESET'), {}] });
  const client = await esecutore(pool).collega();
  assert.equal(typeof client.query, 'function');
  const giu = poolFinto({ connessioni: [errRete('getaddrinfo ENOTFOUND x', 'ENOTFOUND'), errRete('getaddrinfo ENOTFOUND x', 'ENOTFOUND')] });
  await assert.rejects(esecutore(giu).collega(), (e) => e.dbNonRaggiungibile && e.status === 503);
});

test('HTTP: il database giù è un 503 con messaggio chiaro, in pagina e in JSON, e nel log una riga sola', async () => {
  const express = require('express');
  const http = require('../src/http');
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '..', 'views'));
  app.get('/pagina', (req, res, next) => next(new ErroreDbNonRaggiungibile(errRete('read ECONNRESET', 'ECONNRESET'))));
  app.get('/api/x', (req, res, next) => next(new ErroreDbNonRaggiungibile(errRete('read ECONNRESET', 'ECONNRESET'))));
  app.get('/boh', (req, res, next) => next(new Error('guasto vero')));
  app.use(http.gestoreErrori);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const log = [];
  const originale = console.error;
  console.error = (...a) => log.push(a);
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const api = await fetch(base + '/api/x');
    assert.equal(api.status, 503);
    assert.deepEqual(await api.json(), { ok: false, errore: 'Il servizio non riesce a collegarsi al database in questo momento. Riprova tra poco.' });
    const pagina = await fetch(base + '/pagina');
    assert.equal(pagina.status, 503);
    assert.match(await pagina.text(), /collegarsi al database in questo momento/);
    assert.equal(log.length, 2);
    assert.deepEqual(log.map((r) => r[0]), ['Database non raggiungibile nella richiesta', 'Database non raggiungibile nella richiesta']);
    assert.ok(log.every((r) => r.length === 3), 'niente stack: metodo e percorso');
    // un guasto vero resta un 500 con il suo stack nel log, come prima
    const boh = await fetch(base + '/boh');
    assert.equal(boh.status, 500);
    assert.equal(log[2][0], 'Errore non gestito nella richiesta');
  } finally {
    console.error = originale;
    await new Promise((r) => server.close(r));
  }
});
