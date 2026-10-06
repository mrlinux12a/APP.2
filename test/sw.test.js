// Prova di public/sw.js senza browser: lo si esegue in un contesto isolato con un finto `self`.
// Il browser accetta un service worker solo in HTTPS (o localhost), quindi la logica del tocco su una
// notifica si controlla qui. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGINE = 'https://minuteria.example';

function caricaSw({ finestre = [] } = {}) {
  const gestori = {};
  const chiamate = { openWindow: [], focus: [], navigate: [], skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: ORIGINE },
    addEventListener: (nome, fn) => { gestori[nome] = fn; },
    skipWaiting: () => { chiamate.skipWaiting++; },
    clients: {
      claim: () => { chiamate.claim++; return Promise.resolve(); },
      matchAll: () => Promise.resolve(finestre.map((url) => ({
        url,
        focus() { chiamate.focus.push(url); return Promise.resolve(this); },
        navigate(dove) { chiamate.navigate.push(dove); return Promise.resolve(this); },
      }))),
      openWindow: (url) => { chiamate.openWindow.push(url); return Promise.resolve(null); },
    },
  };
  const codice = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  vm.runInNewContext(codice, { self, URL });
  return { gestori, chiamate };
}

// Esegue notificationclick e aspetta il lavoro registrato con waitUntil.
async function tocca(sw, link) {
  const attese = [];
  const evento = {
    notification: { data: link === undefined ? undefined : { link }, close() { evento.chiusa = true; } },
    waitUntil: (p) => attese.push(p),
  };
  sw.gestori.notificationclick(evento);
  await Promise.all(attese);
  return evento;
}

test('install e activate: prende il controllo subito, senza cache', async () => {
  const sw = caricaSw();
  sw.gestori.install({});
  assert.equal(sw.chiamate.skipWaiting, 1);
  const attese = [];
  sw.gestori.activate({ waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
  assert.equal(sw.chiamate.claim, 1);
  // niente gestore "fetch": pagine, CSS, JS e API restano sempre quelli del server
  assert.equal(sw.gestori.fetch, undefined);
  assert.equal(sw.gestori.push, undefined);
});

test('tocco su una notifica: apre la pagina indicata se non c\'è già una finestra', async () => {
  const sw = caricaSw();
  const evento = await tocca(sw, '/ordini/12');
  assert.equal(evento.chiusa, true);
  assert.deepEqual(sw.chiamate.openWindow, [ORIGINE + '/ordini/12']);
});

test('tocco su una notifica: riusa una finestra già aperta e la porta sulla pagina', async () => {
  const sw = caricaSw({ finestre: [ORIGINE + '/home'] });
  await tocca(sw, '/richieste/7');
  assert.deepEqual(sw.chiamate.focus, [ORIGINE + '/home']);
  assert.deepEqual(sw.chiamate.navigate, [ORIGINE + '/richieste/7']);
  assert.deepEqual(sw.chiamate.openWindow, []);
});

test('tocco su una notifica: un link verso un altro sito non viene mai aperto (si va alla home)', async () => {
  for (const cattivo of ['https://sito-cattivo.example/login', '//sito-cattivo.example/x', 'javascript:alert(1)', 'http://minuteria.example/x']) {
    const sw = caricaSw();
    await tocca(sw, cattivo);
    assert.equal(sw.chiamate.openWindow.length, 1, cattivo);
    assert.ok(sw.chiamate.openWindow[0].startsWith(ORIGINE + '/'), cattivo + ' -> ' + sw.chiamate.openWindow[0]);
    assert.ok(!sw.chiamate.openWindow[0].includes('sito-cattivo'), cattivo);
  }
});

test('tocco su una notifica senza dati o con link vuoto: si va alla home', async () => {
  for (const link of [undefined, '', null]) {
    const sw = caricaSw();
    await tocca(sw, link);
    assert.deepEqual(sw.chiamate.openWindow, [ORIGINE + '/'], String(link));
  }
});
