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
// Per le notifiche push: `senzaNavigate` = la finestra non ha `navigate` (capita su iPhone), `navigateFallisce` = c'è ma rifiuta, `focusFallisce` = non si
// riesce a metterla in primo piano; `mostraRifiutaLaPrima` = il browser rifiuta le opzioni della prima notifica; `sottoscrizioneVecchia` = le opzioni con cui
// il browser si era iscritto (per `pushsubscriptionchange`).
function caricaSw({ finestre = [], rete = true, cacheEsistenti = [], scaricabile = true, senzaNavigate = false, navigateFallisce = false, focusFallisce = false, mostraRifiutaLaPrima = false, messaggioLancia = false, matchAllRifiuta = false, notificheRifiutano = false } = {}) {
  const gestori = {};
  const chiamate = { openWindow: [], focus: [], navigate: [], messaggi: [], notifiche: [], chiuse: [], iscrizioni: [], skipWaiting: 0, claim: 0, fetch: [], fetchOpzioni: [], cacheAggiunte: [], cacheEliminate: [] };
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
  const fetchFinto = async (richiesta, opzioni) => {
    const url = typeof richiesta === 'string' ? richiesta : richiesta.url;
    chiamate.fetch.push(url);
    if (opzioni) chiamate.fetchOpzioni.push(opzioni);
    if (!rete) throw new TypeError('Failed to fetch');
    return { dalServer: true, url };
  };
  class RichiestaFinta { constructor(url, opzioni = {}) { this.url = url; this.cache = opzioni.cache; } }
  const RispostaFinta = { error: () => ({ errore: true }) };
  const self = {
    location: { origin: ORIGINE },
    addEventListener: (nome, fn) => { gestori[nome] = fn; },
    skipWaiting: () => { chiamate.skipWaiting++; },
    clients: {
      claim: () => { chiamate.claim++; return Promise.resolve(); },
      matchAll: () => (matchAllRifiuta ? Promise.reject(new Error('matchAll')) : Promise.resolve(finestre.map((voce) => {
        // `voce`: un indirizzo (finestra in secondo piano) oppure { url, visibilityState, focused }
        const url = typeof voce === 'string' ? voce : voce.url;
        const finestra = {
          url,
          visibilityState: (typeof voce === 'object' && voce.visibilityState) || 'hidden',
          focused: typeof voce === 'object' ? !!voce.focused : false,
          focus() { chiamate.focus.push(url); return focusFallisce ? Promise.reject(new Error('focus')) : Promise.resolve(this); },
          postMessage(messaggio) { if (messaggioLancia) throw new Error('pagina chiusa'); chiamate.messaggi.push({ url, messaggio }); },
        };
        if (!senzaNavigate) finestra.navigate = function (dove) { chiamate.navigate.push(dove); return navigateFallisce ? Promise.reject(new Error('navigate')) : Promise.resolve(this); };
        return finestra;
      }))),
      openWindow: (url) => { chiamate.openWindow.push(url); return Promise.resolve(null); },
    },
    registration: {
      // Una notifica di sistema: ricordata con titolo e opzioni; il browser vero lancia con `renotify` senza `tag`, qui lo si imita.
      showNotification: (titolo, opzioni) => {
        if (mostraRifiutaLaPrima && chiamate.notifiche.length === 0 && !chiamate.rifiutata) { chiamate.rifiutata = true; return Promise.reject(new TypeError('opzioni')); }
        if (opzioni && opzioni.renotify && !opzioni.tag) return Promise.reject(new TypeError('renotify senza tag'));
        chiamate.notifiche.push({ titolo, opzioni });
        return Promise.resolve();
      },
      // Le notifiche ancora sullo schermo (non chiuse), con quel tag se c'è un filtro, tutte senza: ognuna si può chiudere.
      getNotifications: ({ tag } = {}) => notificheRifiutano ? Promise.reject(new Error('getNotifications')) : Promise.resolve(chiamate.notifiche.filter((n) => (tag === undefined || (n.opzioni && n.opzioni.tag === tag)) && !n.chiusa).map((n) => ({ close() { n.chiusa = true; chiamate.chiuse.push(n.opzioni && n.opzioni.tag); } }))),
      pushManager: { subscribe: (opzioni) => { chiamate.iscrizioni.push(opzioni); return Promise.resolve({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }) }); } },
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

test('tocco su una notifica: spariscono dalla tendina anche TUTTE le altre del sito (si entra nell\'app)', async () => {
  const sw = caricaSw({ finestre: [ORIGINE + '/home'] });
  sw.chiamate.notifiche.push({ titolo: 'A', opzioni: { tag: 'minuteria-1' } }, { titolo: 'B', opzioni: { tag: 'minuteria-2' } }, { titolo: 'C', opzioni: {} });
  await tocca(sw, '/richieste/7');
  assert.deepEqual(sw.chiamate.notifiche.map((n) => !!n.chiusa), [true, true, true]);
  assert.deepEqual(sw.chiamate.navigate, [ORIGINE + '/richieste/7'], 'e la pagina si apre lo stesso');
});

test('tocco su una notifica: se la tendina non si lascia leggere la pagina si apre comunque', async () => {
  const sw = caricaSw({ notificheRifiutano: true });
  sw.chiamate.notifiche.push({ titolo: 'A', opzioni: { tag: 'minuteria-1' } });
  await tocca(sw, '/ordini/12');
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

// ---------------- Notifiche push (src/web_push.js): arrivano anche ad app chiusa ----------------

// Esegue l'evento `push` con un messaggio e aspetta il lavoro registrato con waitUntil. `dati`: l'oggetto che il server ha mandato (undefined = messaggio senza corpo).
async function spingi(sw, dati, corpo) {
  const attese = [];
  const evento = { data: corpo !== undefined ? corpo : dati === undefined ? null : { json: () => dati, text: () => JSON.stringify(dati) }, waitUntil: (p) => attese.push(p) };
  sw.gestori.push(evento);
  await Promise.all(attese);
}

test('push: con l\'app in secondo piano mostra la notifica di sistema con titolo, testo, tag, suono, vibrazione, icona e link; nessun messaggio alle pagine', async () => {
  // due finestre del sito aperte ma nessuna in primo piano (visibili senza fuoco, o nascoste)
  const sw = caricaSw({ finestre: [{ url: ORIGINE + '/home', visibilityState: 'visible', focused: false }, ORIGINE + '/ordini/3'] });
  await spingi(sw, { titolo: 'Richiesta confermata', testo: 'Borea ha confermato', link: '/richieste/7', tag: 'minuteria-123', id: 123, tipo: 'nuovo' });
  assert.equal(sw.chiamate.notifiche.length, 1);
  const { titolo, opzioni } = sw.chiamate.notifiche[0];
  assert.equal(titolo, 'Richiesta confermata');
  assert.equal(opzioni.body, 'Borea ha confermato');
  assert.equal(opzioni.tag, 'minuteria-123', 'lo stesso tag della notifica mostrata dalla pagina aperta: una notifica sola');
  assert.equal(opzioni.renotify, true);
  assert.equal(opzioni.silent, false);
  assert.ok(Array.isArray(opzioni.vibrate) && opzioni.vibrate.length > 0);
  assert.equal(opzioni.data.link, '/richieste/7');
  assert.equal(opzioni.requireInteraction, false);
  assert.equal(opzioni.icon, '/icons/icona-192.png', 'la "M" blu');
  assert.equal(opzioni.badge, '/icons/icona-distintivo-96.png', 'la "M" bianca su trasparente per la barra di stato di Android');
  assert.deepEqual(sw.chiamate.chiuse, [], 'non si chiude: resta sullo schermo');
  // il sito non fa nessun suono suo: al posto del vecchio "ding" nessun messaggio alle pagine
  assert.deepEqual(sw.chiamate.messaggi, []);
});

test('push: con l\'app APERTA IN PRIMO PIANO nessuna notifica si vede né si sente: mostrata in silenzio e chiusa subito (iPhone ne vuole una per ogni push)', async () => {
  const sw = caricaSw({ finestre: [ORIGINE + '/home', { url: ORIGINE + '/richieste/7', visibilityState: 'visible', focused: true }] });
  await spingi(sw, { titolo: 'Ordine confermato', testo: 'Ordine #312 — BOREA prepara il tuo ordine.', link: '/ordini/312', tag: 'minuteria-312', tipo: 'corriere_trovato' });
  assert.equal(sw.chiamate.notifiche.length, 1, 'comunque UNA notifica mostrata al sistema: Safari cancella l\'iscrizione dopo tre push senza');
  const { titolo, opzioni } = sw.chiamate.notifiche[0];
  assert.equal(titolo, 'Ordine confermato');
  assert.equal(opzioni.silent, true, 'niente suono');
  assert.equal(opzioni.vibrate, undefined, 'niente vibrazione');
  assert.equal(opzioni.renotify, undefined);
  assert.equal(opzioni.requireInteraction, undefined);
  assert.equal(opzioni.tag, 'minuteria-312');
  assert.deepEqual(sw.chiamate.chiuse, ['minuteria-312'], 'e chiusa subito: l\'utente non vede niente');
  assert.deepEqual(sw.chiamate.messaggi, [], 'e nessun "ding" nella pagina');
});

test('push: in primo piano ma senza tag, o con le opzioni rifiutate dal browser: sempre silenziosa e chiusa', async () => {
  const davanti = { url: ORIGINE + '/home', visibilityState: 'visible', focused: true };
  const senzaTag = caricaSw({ finestre: [davanti] });
  await spingi(senzaTag, { titolo: 'Senza tag', testo: 'x' });
  assert.equal(senzaTag.chiamate.notifiche.length, 1);
  assert.equal(senzaTag.chiamate.notifiche[0].opzioni.silent, true);
  assert.deepEqual(senzaTag.chiamate.chiuse, ['minuteria-in-primo-piano'], 'un tag suo, così la si chiude');

  const rifiutata = caricaSw({ finestre: [davanti], mostraRifiutaLaPrima: true });
  await spingi(rifiutata, { titolo: 'Ordine', testo: 'in arrivo', link: '/ordini/5', tag: 'minuteria-5' });
  assert.equal(rifiutata.chiamate.notifiche.length, 1);
  assert.equal(rifiutata.chiamate.notifiche[0].opzioni.silent, true, 'anche il ripiego è silenzioso');
  assert.equal(rifiutata.chiamate.notifiche[0].opzioni.vibrate, undefined);
});

test('push: una finestra visibile ma senza il fuoco (computer: scheda dietro un\'altra applicazione) non è "primo piano": notifica normale', async () => {
  const sw = caricaSw({ finestre: [{ url: ORIGINE + '/distributore', visibilityState: 'visible', focused: false }] });
  await spingi(sw, { titolo: 'Nuova richiesta', testo: 'x', link: '/distributore/richieste/4', tag: 'minuteria-9', tipo: 'nuova_richiesta' });
  assert.equal(sw.chiamate.notifiche[0].opzioni.silent, false);
  assert.deepEqual(sw.chiamate.chiuse, []);
});

test('push: la notifica di PROVA si vede sempre, anche con l\'app davanti (l\'ha chiesta l\'utente per vedere che il telefono la riceve)', async () => {
  const sw = caricaSw({ finestre: [{ url: ORIGINE + '/profilo', visibilityState: 'visible', focused: true }] });
  await spingi(sw, { titolo: 'Notifica di prova', testo: 'Le notifiche funzionano, anche ad app chiusa.', link: '/', tag: 'minuteria-prova', tipo: 'prova' });
  assert.equal(sw.chiamate.notifiche.length, 1);
  assert.equal(sw.chiamate.notifiche[0].opzioni.silent, false);
  assert.deepEqual(sw.chiamate.chiuse, []);
});

test('push: se non si riesce a sapere quali finestre ci sono si considera l\'app in secondo piano (meglio una notifica in più che una persa)', async () => {
  const sw = caricaSw({ matchAllRifiuta: true });
  await spingi(sw, { titolo: 'Ordine confermato', testo: 'x', tag: 'minuteria-1' });
  assert.equal(sw.chiamate.notifiche.length, 1);
  assert.equal(sw.chiamate.notifiche[0].opzioni.silent, false);
});

test('push: una richiesta da confermare resta sullo schermo del computer finché non la si tocca', async () => {
  const sw = caricaSw();
  await spingi(sw, { titolo: 'Nuova richiesta', testo: 'x', link: '/distributore/richieste/4', tag: 'minuteria-9', tipo: 'nuova_richiesta' });
  assert.equal(sw.chiamate.notifiche[0].opzioni.requireInteraction, true);
});

test('push: anche "corriere trovato" (prepara il materiale) resta sullo schermo del computer finché non la si tocca, col suono del sistema', async () => {
  const sw = caricaSw();
  await spingi(sw, { titolo: 'Nuovo ordine da preparare', testo: 'Rossi — ordine #12, già pagato.', link: '/distributore/ordini/12', tag: 'minuteria-31', tipo: 'corriere_trovato' });
  const { opzioni } = sw.chiamate.notifiche[0];
  assert.equal(opzioni.requireInteraction, true);
  assert.equal(opzioni.silent, false, 'col suono del sistema');
  assert.equal(opzioni.data.link, '/distributore/ordini/12');
  // le altre notifiche del banco (nessun corriere, scaduta, consegnata) spariscono da sole come sempre
  for (const tipo of ['nessun_corriere', 'richiesta_scaduta', 'ordine_consegnato']) {
    const altro = caricaSw();
    await spingi(altro, { titolo: 'x', testo: 'y', link: '/distributore', tag: 'minuteria-40', tipo });
    assert.equal(altro.chiamate.notifiche[0].opzioni.requireInteraction, false, tipo);
  }
});

test('push: senza tag niente `renotify` (il browser lo rifiuta) ma la notifica si mostra lo stesso', async () => {
  const sw = caricaSw();
  await spingi(sw, { titolo: 'Senza tag', testo: 'x' });
  assert.equal(sw.chiamate.notifiche.length, 1);
  assert.equal(sw.chiamate.notifiche[0].opzioni.renotify, undefined);
  assert.equal(sw.chiamate.notifiche[0].opzioni.tag, undefined);
  assert.equal(sw.chiamate.notifiche[0].opzioni.data.link, '/');
});

test('push: SI MOSTRA SEMPRE una notifica, anche con un messaggio vuoto o rovinato (iPhone cancella l\'iscrizione dopo tre push silenziose)', async () => {
  const casi = [
    ['senza corpo', undefined, undefined],
    ['JSON rovinato', undefined, { json: () => { throw new SyntaxError('JSON'); }, text: () => 'testo semplice' }],
    ['corpo che non si legge nemmeno come testo', undefined, { json: () => { throw new Error('x'); }, text: () => { throw new Error('y'); } }],
    ['JSON che non è un oggetto', 'una stringa', undefined],
    ['campi del tipo sbagliato', { titolo: 5, testo: { a: 1 }, link: 3, tag: 9 }, undefined],
  ];
  for (const [nome, dati, corpo] of casi) {
    const sw = caricaSw();
    await spingi(sw, dati, corpo);
    assert.equal(sw.chiamate.notifiche.length, 1, nome);
    assert.equal(sw.chiamate.notifiche[0].titolo, 'Minuteria', nome);
  }
  // il testo semplice (non JSON) diventa il corpo della notifica
  const sw = caricaSw();
  await spingi(sw, undefined, { json: () => { throw new SyntaxError('JSON'); }, text: () => 'Ordine pronto' });
  assert.equal(sw.chiamate.notifiche[0].opzioni.body, 'Ordine pronto');
});

test('push: se il browser rifiuta le opzioni si mostra una notifica semplice (ma una notifica)', async () => {
  const sw = caricaSw({ mostraRifiutaLaPrima: true });
  await spingi(sw, { titolo: 'Ordine', testo: 'in arrivo', link: '/ordini/5', tag: 'minuteria-5' });
  assert.equal(sw.chiamate.notifiche.length, 1);
  assert.equal(sw.chiamate.notifiche[0].titolo, 'Minuteria');
  assert.equal(sw.chiamate.notifiche[0].opzioni.body, 'in arrivo');
  assert.equal(sw.chiamate.notifiche[0].opzioni.data.link, '/ordini/5', 'il tocco porta comunque sulla pagina giusta');
});

test('pushsubscriptionchange: con le opzioni vecchie il browser si riscrive da solo e lo dice al server', async () => {
  const sw = caricaSw();
  const attese = [];
  sw.gestori.pushsubscriptionchange({ oldSubscription: { options: { userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) } }, waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
  assert.equal(sw.chiamate.iscrizioni.length, 1);
  assert.equal(sw.chiamate.iscrizioni[0].userVisibleOnly, true);
  assert.deepEqual(sw.chiamate.fetch, ['/api/push/iscrivi']);
  const opzioni = sw.chiamate.fetchOpzioni[0];
  assert.equal(opzioni.method, 'POST');
  assert.equal(opzioni.credentials, 'same-origin', 'con la sessione di chi è entrato');
  assert.deepEqual(JSON.parse(opzioni.body), { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } } });
});

test('pushsubscriptionchange: senza le opzioni vecchie non fa niente (ci pensa la pagina alla prossima apertura) e non lancia', async () => {
  const sw = caricaSw();
  const attese = [];
  sw.gestori.pushsubscriptionchange({ waitUntil: (p) => attese.push(p) });
  await Promise.all(attese);
  assert.deepEqual(sw.chiamate.iscrizioni, []);
  assert.deepEqual(sw.chiamate.fetch, []);
});

test('tocco su una notifica: se la finestra non ha `navigate` (iPhone) le si manda un messaggio e ci va da sola', async () => {
  const sw = caricaSw({ finestre: [ORIGINE + '/home'], senzaNavigate: true });
  await tocca(sw, '/richieste/7');
  assert.deepEqual(sw.chiamate.focus, [ORIGINE + '/home']);
  // (gli oggetti creati nel contesto isolato del service worker hanno un altro prototipo: si confrontano come JSON)
  assert.deepEqual(JSON.parse(JSON.stringify(sw.chiamate.messaggi)), [{ url: ORIGINE + '/home', messaggio: { tipo: 'vai', url: ORIGINE + '/richieste/7' } }]);
  assert.deepEqual(sw.chiamate.openWindow, []);
});

test('tocco su una notifica: se `navigate` rifiuta, stesso messaggio; se la finestra non si mette in primo piano se ne apre una nuova', async () => {
  const a = caricaSw({ finestre: [ORIGINE + '/home'], navigateFallisce: true });
  await tocca(a, '/ordini/12');
  assert.deepEqual(a.chiamate.navigate, [ORIGINE + '/ordini/12']);
  assert.deepEqual(JSON.parse(JSON.stringify(a.chiamate.messaggi.map((m) => m.messaggio))), [{ tipo: 'vai', url: ORIGINE + '/ordini/12' }]);
  const b = caricaSw({ finestre: [ORIGINE + '/home'], focusFallisce: true });
  await tocca(b, '/ordini/12');
  assert.deepEqual(b.chiamate.openWindow, [ORIGINE + '/ordini/12']);
});
