// Prova di public/sw.js senza browser: lo si esegue in un contesto isolato con un finto `self`.
// Il browser accetta un service worker solo in HTTPS (o localhost), quindi la logica del tocco su una
// notifica si controlla qui. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGINE = 'https://minuteria.example';

// `rete`: false = nessuna connessione (fetch rifiuta); `cacheEsistenti`: nomi di cache già presenti (di versioni vecchie); `scaricabile`: false = la pagina
// offline non si riesce a scaricare all'installazione.
function caricaSw({ finestre = [], rete = true, cacheEsistenti = [], scaricabile = true } = {}) {
  const gestori = {};
  const chiamate = { openWindow: [], focus: [], navigate: [], skipWaiting: 0, claim: 0, fetch: [], cacheAggiunte: [], cacheEliminate: [] };
  const nomiCache = new Set(cacheEsistenti);
  let paginaOffline = null; // cosa c'è in cache: solo la pagina offline
  const caches = {
    open: async (nome) => { nomiCache.add(nome); return { add: async (richiesta) => {
      if (!scaricabile) throw new Error('rete assente');
      chiamate.cacheAggiunte.push({ nome, url: richiesta.url, cache: richiesta.cache });
      paginaOffline = { offline: true };
    } }; },
    keys: async () => [...nomiCache],
    delete: async (nome) => { chiamate.cacheEliminate.push(nome); nomiCache.delete(nome); return true; },
    match: async (url) => (url === '/offline.html' ? paginaOffline : undefined),
  };
  const fetchFinto = async (richiesta) => {
    chiamate.fetch.push(richiesta.url);
    if (!rete) throw new TypeError('Failed to fetch');
    return { dalServer: true, url: richiesta.url };
  };
  class RichiestaFinta { constructor(url, opzioni = {}) { this.url = url; this.cache = opzioni.cache; } }
  const RispostaFinta = { error: () => ({ errore: true }) };
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
  vm.runInNewContext(codice, { self, URL, caches, fetch: fetchFinto, Request: RichiestaFinta, Response: RispostaFinta, Promise });
  return { gestori, chiamate, nomiCache };
}

// Esegue un evento che usa waitUntil e aspetta il lavoro registrato.
async function esegui(sw, nome) {
  const attese = [];
  sw.gestori[nome]({ waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
}

// Una navigazione (o altro) passata al gestore "fetch": ritorna la risposta data a respondWith, o undefined se il gestore non l'ha presa in carico.
async function richiedi(sw, url, mode = 'navigate') {
  let risposta;
  let presa = false;
  sw.gestori.fetch({ request: { url, mode }, respondWith: (p) => { presa = true; risposta = p; } });
  return presa ? await risposta : undefined;
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

test('install e activate: prende il controllo subito e tiene in cache SOLO la pagina offline', async () => {
  const sw = caricaSw();
  await esegui(sw, 'install');
  assert.equal(sw.chiamate.skipWaiting, 1);
  assert.deepEqual(sw.chiamate.cacheAggiunte, [{ nome: 'minuteria-offline-v1', url: '/offline.html', cache: 'reload' }], 'una sola cosa in cache, sempre aggiornata dal server');
  await esegui(sw, 'activate');
  assert.equal(sw.chiamate.claim, 1);
  assert.equal(sw.gestori.push, undefined);
});

test('install: se la pagina offline non si scarica il service worker si installa lo stesso', async () => {
  const sw = caricaSw({ scaricabile: false });
  await esegui(sw, 'install');
  assert.equal(sw.chiamate.skipWaiting, 1);
  assert.deepEqual(sw.chiamate.cacheAggiunte, []);
});

test('activate: toglie le cache di versioni vecchie ("minuteria-...") e lascia stare le altre', async () => {
  const sw = caricaSw({ cacheEsistenti: ['minuteria-offline-v0', 'minuteria-offline-v1', 'altro-sito'] });
  await esegui(sw, 'activate');
  assert.deepEqual(sw.chiamate.cacheEliminate, ['minuteria-offline-v0']);
  assert.equal(sw.chiamate.claim, 1);
});

test('fetch: una pagina col server raggiungibile passa com\'è (anche una risposta d\'errore), non si copia né si ritarda', async () => {
  const sw = caricaSw();
  const risposta = await richiedi(sw, ORIGINE + '/ordini/12');
  assert.deepEqual(risposta, { dalServer: true, url: ORIGINE + '/ordini/12' });
  assert.deepEqual(sw.chiamate.fetch, [ORIGINE + '/ordini/12']);
  assert.deepEqual(sw.chiamate.cacheAggiunte, [], 'nessuna pagina viene messa in cache');
});

test('fetch: senza rete una pagina mostra "Sei offline" (la copia in cache), una sola volta installata', async () => {
  const sw = caricaSw({ rete: false });
  await esegui(sw, 'install');
  assert.deepEqual(await richiedi(sw, ORIGINE + '/carrello'), { offline: true });
  assert.deepEqual(await richiedi(sw, ORIGINE + '/richieste/9'), { offline: true });
  // pagina offline mai scaricata (rete assente fin dall'inizio): errore di rete come prima, niente di inventato
  const senza = caricaSw({ rete: false, scaricabile: false });
  await esegui(senza, 'install');
  assert.deepEqual(await richiedi(senza, ORIGINE + '/carrello'), { errore: true });
});

test('fetch: immagini, script e chiamate /api non passano dal service worker (falliscono come prima, mai dati finti)', async () => {
  const sw = caricaSw({ rete: false });
  await esegui(sw, 'install');
  for (const [url, mode] of [['/api/carrello', 'cors'], ['/style.css', 'no-cors'], ['/img/prodotti/x.webp', 'no-cors'], ['/app.js', 'same-origin']]) {
    assert.equal(await richiedi(sw, ORIGINE + url, mode), undefined, url);
  }
  assert.deepEqual(sw.chiamate.fetch, [], 'neppure una chiamata alla rete da parte del service worker');
});

test('la pagina offline esiste, è autonoma (niente script o stile del sito) e ha il pulsante "Riprova"', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline.html'), 'utf8');
  assert.match(html, /<title>Sei offline/);
  assert.match(html, /<button[^>]*id="riprova"[^>]*>Riprova<\/button>/);
  assert.match(html, /addEventListener\('online'/, 'si riapre da sola quando torna la rete');
  assert.doesNotMatch(html, /<script[^>]*src=|<link[^>]*stylesheet/, 'deve funzionare senza rete: tutto in linea');
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
