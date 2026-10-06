// Redirect dopo una modifica della sessione (src/http.js, salvaSessionePrimaDelRedirect): express-session scrive la
// sessione DOPO aver mandato le intestazioni, e il browser segue un redirect appena le riceve. Qui un archivio lento
// (come il DB remoto) mostra la corsa e che il middleware la toglie. Nessun DB. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const radice = path.join(__dirname, '..');
const express = require('express');
const session = require('express-session');
const { salvaSessionePrimaDelRedirect } = require(path.join(radice, 'src/http'));

const RITARDO_MS = 200;

class ArchivioLento extends session.MemoryStore {
  constructor() { super(); this.scritture = 0; }
  set(sid, sess, callback) {
    setTimeout(() => { this.scritture++; super.set(sid, sess, callback); }, RITARDO_MS);
  }
  // Valori attualmente scritti nell'archivio.
  valori() { return Object.values(this.sessions).map((s) => JSON.parse(s).valore); }
}

async function avvia({ conMiddleware }) {
  const archivio = new ArchivioLento();
  const app = express();
  app.use(session({ store: archivio, secret: 'x', resave: false, saveUninitialized: false, rolling: true }));
  if (conMiddleware) app.use(salvaSessionePrimaDelRedirect);
  app.post('/scrivi', (req, res) => { req.session.valore = 'nuovo'; res.redirect('/leggi'); });
  app.post('/scrivi-con-stato', (req, res) => { req.session.valore = 'nuovo'; res.redirect(303, '/leggi'); });
  app.post('/niente', (req, res) => res.redirect('/leggi'));
  app.get('/leggi', (req, res) => res.json({ valore: req.session.valore || null }));
  const server = await new Promise((risolvi) => { const s = app.listen(0, '127.0.0.1', () => risolvi(s)); });
  return { archivio, server, base: 'http://127.0.0.1:' + server.address().port };
}

// Risolve appena arrivano le intestazioni, come un browser che segue il redirect.
const post = (base, percorso) => fetch(base + percorso, { method: 'POST', redirect: 'manual' });

test('senza il middleware il redirect arriva prima che la sessione sia scritta (la corsa)', async () => {
  const { archivio, server, base } = await avvia({ conMiddleware: false });
  try {
    const r = await post(base, '/scrivi');
    assert.equal(r.status, 302);
    assert.deepEqual(archivio.valori(), [], 'la pagina di arrivo leggerebbe la sessione vecchia');
    await new Promise((x) => setTimeout(x, RITARDO_MS + 150));
    assert.deepEqual(archivio.valori(), ['nuovo'], 'poi la scrittura finisce');
  } finally { server.close(); }
});

test('con il middleware la sessione è già scritta quando arriva il redirect', async () => {
  const { archivio, server, base } = await avvia({ conMiddleware: true });
  try {
    for (const percorso of ['/scrivi', '/scrivi-con-stato']) {
      archivio.sessions = {};
      const r = await post(base, percorso);
      assert.ok([302, 303].includes(r.status), percorso);
      assert.equal(r.headers.get('location'), '/leggi');
      assert.deepEqual(archivio.valori(), ['nuovo'], percorso);
    }
  } finally { server.close(); }
});

test('sessione non modificata: il redirect parte subito, senza scritture in più', async () => {
  const { archivio, server, base } = await avvia({ conMiddleware: true });
  try {
    const inizio = Date.now();
    const r = await post(base, '/niente');
    assert.equal(r.status, 302);
    assert.ok(Date.now() - inizio < RITARDO_MS, 'nessuna attesa del salvataggio');
    assert.equal(archivio.scritture, 0);
  } finally { server.close(); }
});
