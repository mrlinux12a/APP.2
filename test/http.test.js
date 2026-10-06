// Prova di src/http.js, src/auth.js e src/input.js con un'app Express vuota (nessun DB).
// Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const radice = path.join(__dirname, '..');
const express = require('express');
const session = require('express-session');
const { leggiQuery, corpoSempreOggetto, idNumerico, gestoreNonTrovato, gestoreErrori } = require(path.join(radice, 'src/http'));
const { requireLogin, requireRole } = require(path.join(radice, 'src/auth'));
const { leggiId, leggiQuantita, QUANTITA_MASSIMA } = require(path.join(radice, 'src/input'));

function creaApp({ viste = true } = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', viste ? path.join(radice, 'views') : path.join(radice, 'cartella-inesistente'));
  app.set('query parser', leggiQuery);
  app.param('id', idNumerico);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(corpoSempreOggetto);
  app.use(session({ secret: 'x', resave: false, saveUninitialized: false }));
  // sessione finta: ?ruolo=cliente|distributore  (solo per la prova)
  app.use((req, res, next) => {
    if (req.get('x-ruolo')) req.session.user = { id: 1, ruolo: req.get('x-ruolo') };
    next();
  });

  app.get('/eco', (req, res) => res.json({ query: req.query, tipo: typeof req.query.x }));
  app.post('/corpo', (req, res) => res.json({ corpo: req.body }));
  app.get('/ordini/:id', (req, res) => res.json({ id: req.params.id }));
  app.get('/api/cose/:id', (req, res) => res.json({ id: req.params.id }));
  app.get('/boom', () => { throw new Error('segreto interno'); });
  app.get('/api/boom', async () => { throw new Error('segreto interno'); });
  app.get('/solo-cliente', requireRole('cliente'), (req, res) => res.json({ ok: true }));
  app.get('/api/solo-cliente', requireRole('cliente'), (req, res) => res.json({ ok: true }));
  app.get('/solo-login', requireLogin, (req, res) => res.json({ ok: true }));
  app.get('/api/solo-login', requireLogin, (req, res) => res.json({ ok: true }));
  app.use(gestoreNonTrovato);
  app.use(gestoreErrori);
  return app;
}

async function avvia(opzioni) {
  const app = creaApp(opzioni);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, chiudi: () => new Promise((r) => server.close(r)) };
}

test('query: ogni parametro è un testo, anche se ripetuto', async () => {
  const { base, chiudi } = await avvia();
  try {
    let r = await (await fetch(base + '/eco?x=a&x=b&y=c')).json();
    assert.equal(r.query.x, 'a');
    assert.equal(r.query.y, 'c');
    assert.equal(r.tipo, 'string');
    r = await (await fetch(base + '/eco?x[]=1&x[]=2')).json();
    assert.equal(typeof Object.values(r.query)[0], 'string');
    r = await (await fetch(base + '/eco')).json();
    assert.deepEqual(r.query, {});
  } finally { await chiudi(); }
});

test('corpo: POST senza corpo non lascia req.body undefined', async () => {
  const { base, chiudi } = await avvia();
  try {
    const r = await fetch(base + '/corpo', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).corpo, {});
  } finally { await chiudi(); }
});

test('id nei percorsi: solo interi positivi, il resto è 404 (pagina o JSON)', async () => {
  const { base, chiudi } = await avvia();
  try {
    assert.equal((await (await fetch(base + '/ordini/42')).json()).id, '42');
    for (const cattivo of ['abc', '0', '-1', '99999999999', '1.5', '1e3', '12abc']) {
      const r = await fetch(base + '/ordini/' + cattivo);
      assert.equal(r.status, 404, cattivo);
      assert.match(r.headers.get('content-type'), /text\/html/);
      const j = await fetch(base + '/api/cose/' + cattivo);
      assert.equal(j.status, 404, 'api ' + cattivo);
      assert.match(j.headers.get('content-type'), /application\/json/);
      const corpo = await j.json();
      assert.equal(corpo.ok, false);
      assert.ok(corpo.errore);
    }
  } finally { await chiudi(); }
});

test('404 per percorsi inesistenti: pagina o JSON', async () => {
  const { base, chiudi } = await avvia();
  try {
    const h = await fetch(base + '/non-esiste');
    assert.equal(h.status, 404);
    const testo = await h.text();
    assert.match(testo, /Pagina non trovata/);
    const j = await fetch(base + '/api/non-esiste');
    assert.equal(j.status, 404);
    assert.deepEqual(await j.json(), { ok: false, errore: 'Risorsa non trovata.' });
  } finally { await chiudi(); }
});

test('errori del client mantengono il loro 4xx (JSON malformato, corpo enorme)', async () => {
  const { base, chiudi } = await avvia();
  try {
    let r = await fetch(base + '/api/cose/1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rotto' });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).ok, false);
    r = await fetch(base + '/corpo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rotto' });
    assert.equal(r.status, 400);
    assert.match(r.headers.get('content-type'), /html/);
    const enorme = JSON.stringify({ a: 'x'.repeat(200 * 1024) });
    r = await fetch(base + '/corpo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: enorme });
    assert.equal(r.status, 413);
  } finally { await chiudi(); }
});

test('500: messaggio pulito, mai lo stack, JSON per /api', async () => {
  const { base, chiudi } = await avvia();
  const consoleError = console.error; console.error = () => {};
  try {
    const h = await fetch(base + '/boom');
    assert.equal(h.status, 500);
    const testo = await h.text();
    assert.ok(!testo.includes('segreto interno'));
    assert.ok(!testo.includes('at '));
    const j = await fetch(base + '/api/boom');
    assert.equal(j.status, 500);
    const corpo = await j.json();
    assert.equal(corpo.ok, false);
    assert.ok(!JSON.stringify(corpo).includes('segreto'));
  } finally { console.error = consoleError; await chiudi(); }
});

test('500 con vista rotta: pagina di ripiego, non una risposta vuota', async () => {
  const { base, chiudi } = await avvia({ viste: false });
  const consoleError = console.error; console.error = () => {};
  try {
    const h = await fetch(base + '/boom');
    assert.equal(h.status, 500);
    const testo = await h.text();
    assert.match(testo, /<h1/);
    assert.match(testo, /Errore imprevisto/);
  } finally { console.error = consoleError; await chiudi(); }
});

test('accesso: 401 JSON per /api, redirect al login per le pagine, 403 per il ruolo sbagliato', async () => {
  const { base, chiudi } = await avvia();
  try {
    let r = await fetch(base + '/solo-cliente', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
    r = await fetch(base + '/api/solo-cliente');
    assert.equal(r.status, 401);
    assert.equal((await r.json()).ok, false);
    r = await fetch(base + '/api/solo-login');
    assert.equal(r.status, 401);
    r = await fetch(base + '/solo-login', { redirect: 'manual' });
    assert.equal(r.status, 302);

    r = await fetch(base + '/solo-cliente', { headers: { 'x-ruolo': 'distributore' } });
    assert.equal(r.status, 403);
    assert.match(r.headers.get('content-type'), /html/);
    r = await fetch(base + '/api/solo-cliente', { headers: { 'x-ruolo': 'distributore' } });
    assert.equal(r.status, 403);
    assert.match(r.headers.get('content-type'), /json/);
    r = await fetch(base + '/solo-cliente', { headers: { 'x-ruolo': 'cliente' } });
    assert.equal(r.status, 200);
  } finally { await chiudi(); }
});

test('input: id e quantità fuori misura', () => {
  assert.equal(leggiId('12'), 12);
  for (const v of ['abc', '', null, undefined, '0', '-3', '99999999999', '2147483648', [], {}]) assert.equal(leggiId(v), 0, String(v));
  assert.equal(leggiId('2147483647'), 2147483647);
  assert.equal(leggiQuantita('5'), 5);
  assert.equal(leggiQuantita('-5'), 0);
  assert.equal(leggiQuantita('abc'), 0);
  assert.equal(leggiQuantita('99999999999'), QUANTITA_MASSIMA);
  assert.equal(leggiQuantita(undefined), 0);
  assert.equal(leggiQuantita('3.9'), 3);
});
