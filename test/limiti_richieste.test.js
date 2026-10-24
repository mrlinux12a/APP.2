// Prove dei limiti di richieste per indirizzo (src/middleware/limiti.js, express-rate-limit) e dell'ordine in cui l'app li monta: i file statici e il webhook
// di Stripe non contano, le pagine e le API sì. Niente database: si usano piccole app Express costruite qui. Ogni file di prova gira in un processo suo,
// quindi le variabili d'ambiente qui sotto valgono solo per questo file.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Soglie basse, impostate PRIMA di caricare il modulo (le legge una volta sola, all'avvio).
process.env.LIMITE_RICHIESTE_DISATTIVATO = '';
process.env.LIMITE_RICHIESTE_AL_MINUTO = '5';
process.env.LIMITE_ACCESSI_FALLITI = '3';
process.env.LIMITE_RICERCHE_AL_MINUTO = '4';
process.env.LIMITE_INDIRIZZI_AL_MINUTO = '2';

const limiti = require('../src/middleware/limiti');
const { creaFileStatici } = require('../src/middleware/file_statici');

// Un'app Express come quella vera quanto basta: un solo proxy davanti e le pagine EJS (la pagina d'errore 429 si disegna con la vista `errore`).
function nuovaApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', require('path').join(__dirname, '..', 'views'));
  return app;
}

// Avvia un'app su una porta libera e ritorna { base, chiudi }.
async function avvia(app) {
  const server = await new Promise((risolvi) => {
    const s = app.listen(0, '127.0.0.1', () => risolvi(s));
  });
  return { base: 'http://127.0.0.1:' + server.address().port, chiudi: () => new Promise((r) => server.close(r)) };
}

test('il limite generale ferma la richiesta oltre la soglia: 429 in JSON per /api (con Retry-After), pagina d\'errore per il resto', async () => {
  const app = nuovaApp();
  // Un limitatore nuovo per ogni prova: quelli esportati (limiti.generale...) tengono il conto per tutto il processo e si condividerebbero fra le prove.
  app.use(limiti.creaLimitatore({ finestraMs: 60 * 1000, massimo: 5 }));
  app.get('/api/prova', (req, res) => res.json({ ok: true }));
  const { base, chiudi } = await avvia(app);
  try {
    for (let i = 0; i < 5; i++) assert.equal((await fetch(base + '/api/prova')).status, 200, 'richiesta ' + (i + 1));
    const troppe = await fetch(base + '/api/prova');
    assert.equal(troppe.status, 429);
    assert.match(troppe.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await troppe.json(), { ok: false, errore: 'Troppe richieste: riprova tra poco.' });
    assert.ok(Number(troppe.headers.get('retry-after')) >= 1, 'dice quanti secondi aspettare');
    assert.ok(troppe.headers.get('ratelimit') || troppe.headers.get('ratelimit-policy'), 'intestazioni standard del limite');
    // una pagina (non /api) risponde con la pagina d'errore, senza stack né dettagli
    const pagina = await fetch(base + '/una-pagina', { headers: { accept: 'text/html' } });
    assert.equal(pagina.status, 429);
    assert.match(pagina.headers.get('content-type'), /text\/html/);
    assert.match(await pagina.text(), /Troppe richieste/);
  } finally {
    await chiudi();
  }
});

test('l\'ordine dell\'app: file statici e webhook passano PRIMA del limite e non contano; le pagine dopo sì', async () => {
  const app = nuovaApp();
  // come src/app.js: webhook, file statici, poi il limite generale
  app.post('/webhooks/stripe', express.raw({ type: '*/*' }), (req, res) => res.json({ ricevuto: true }));
  app.use(creaFileStatici());
  app.use(limiti.creaLimitatore({ finestraMs: 60 * 1000, massimo: 5 }));
  app.get('/api/prova', (req, res) => res.json({ ok: true }));
  const { base, chiudi } = await avvia(app);
  try {
    // 20 richieste a un file statico e al webhook: nessuna è limitata e nessuna consuma la soglia (5)
    for (let i = 0; i < 20; i++) {
      assert.equal((await fetch(base + '/style.css')).status, 200);
      assert.equal((await fetch(base + '/webhooks/stripe', { method: 'POST', body: '{}' })).status, 200);
    }
    for (let i = 0; i < 5; i++) assert.equal((await fetch(base + '/api/prova')).status, 200);
    assert.equal((await fetch(base + '/api/prova')).status, 429, 'la sesta richiesta alla pagina è oltre la soglia');
    // i file statici restano raggiungibili anche a limite superato
    assert.equal((await fetch(base + '/style.css')).status, 200);
  } finally {
    await chiudi();
  }
});

test('il limite degli accessi conta solo i tentativi andati male: un login riuscito non consuma la soglia', async () => {
  const app = nuovaApp();
  app.use(express.json());
  app.post('/login', limiti.creaLimitatore({ finestraMs: 15 * 60 * 1000, massimo: 3, soloFalliti: true }), (req, res) => (req.body.ok ? res.redirect('/') : res.status(401).json({ errore: 'Credenziali non valide.' })));
  const { base, chiudi } = await avvia(app);
  const accedi = (ok) => fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok }) });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await accedi(true)).status, 302, 'accessi riusciti: mai limitati');
    for (let i = 0; i < 3; i++) assert.equal((await accedi(false)).status, 401, 'tentativo sbagliato ' + (i + 1));
    assert.equal((await accedi(false)).status, 429, 'dopo 3 tentativi sbagliati si ferma');
    assert.equal((await accedi(true)).status, 429, 'e per un po\' ferma anche chi ora scrive giusto (stesso indirizzo)');
  } finally {
    await chiudi();
  }
});

test('i limiti di ricerca e indirizzo si fermano alla loro soglia', async () => {
  const app = nuovaApp();
  app.get('/api/cerca', limiti.creaLimitatore({ finestraMs: 60 * 1000, massimo: 4 }), (req, res) => res.json({ risultati: [] }));
  app.get('/api/indirizzo', limiti.creaLimitatore({ finestraMs: 60 * 1000, massimo: 2 }), (req, res) => res.json({ ok: true }));
  const { base, chiudi } = await avvia(app);
  try {
    for (let i = 0; i < 4; i++) assert.equal((await fetch(base + '/api/cerca?q=ab')).status, 200);
    assert.equal((await fetch(base + '/api/cerca?q=ab')).status, 429, 'la quinta ricerca in un minuto è oltre la soglia (4)');
    for (let i = 0; i < 2; i++) assert.equal((await fetch(base + '/api/indirizzo')).status, 200);
    assert.equal((await fetch(base + '/api/indirizzo')).status, 429, 'la terza richiesta di indirizzo è oltre la soglia (2)');
  } finally {
    await chiudi();
  }
});

test('le soglie si leggono dal .env, e un valore scritto male torna a quello di partenza', () => {
  const impostazioni = require('../src/config/limiti');
  assert.equal(impostazioni.disattivati, false, 'in questo file i limiti sono accesi');
  assert.equal(impostazioni.generale.massimo, 5);
  assert.equal(impostazioni.accesso.massimo, 3);
  assert.equal(impostazioni.ricerca.massimo, 4);
  assert.equal(impostazioni.indirizzo.massimo, 2);
  // gli esportati da limiti.js sono funzioni middleware pronte all'uso
  for (const nome of ['generale', 'accesso', 'ricerca', 'indirizzo']) assert.equal(typeof limiti[nome], 'function', nome);

  // un valore scritto male (testo, zero, negativo, decimale) non spegne il limite: vale quello di partenza
  const percorso = require.resolve('../src/config/limiti');
  const prima = process.env.LIMITE_RICHIESTE_AL_MINUTO;
  try {
    for (const storto of ['abc', '0', '-5', '2.5', '']) {
      process.env.LIMITE_RICHIESTE_AL_MINUTO = storto;
      delete require.cache[percorso];
      assert.equal(require('../src/config/limiti').generale.massimo, 1000, JSON.stringify(storto));
    }
  } finally {
    process.env.LIMITE_RICHIESTE_AL_MINUTO = prima;
    delete require.cache[percorso];
  }
});

test('i limiti esportati (generale, accesso, ricerca, indirizzo) usano le soglie del .env', async () => {
  // Qui si usano proprio quelli esportati, su indirizzi di prova diversi (intestazione X-Forwarded-For con un proxy davanti): così non si pestano.
  const app = nuovaApp();
  app.get('/p', limiti.indirizzo, (req, res) => res.json({ ok: true }));
  const { base, chiudi } = await avvia(app);
  const da = (ip) => fetch(base + '/p', { headers: { 'x-forwarded-for': ip } });
  try {
    assert.equal((await da('10.0.0.1')).status, 200);
    assert.equal((await da('10.0.0.1')).status, 200);
    assert.equal((await da('10.0.0.1')).status, 429, 'terza richiesta dallo stesso indirizzo');
    assert.equal((await da('10.0.0.2')).status, 200, 'un altro indirizzo ha il suo conto');
  } finally {
    await chiudi();
  }
});
