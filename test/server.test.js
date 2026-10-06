// Prova end-to-end di server.js: l'app vera (middleware, route, viste, sessioni) con un DB finto in memoria.
// Non tocca MAI il database di produzione: il modulo db/index.js viene sostituito prima di caricare il
// server, quindi nessuna connessione a Postgres viene aperta. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const radice = path.join(__dirname, '..');
const PORTA = 38471;
const bcrypt = require('bcryptjs');

// ---------------- DB finto ----------------
const sessioni = new Map();
const catalogo = {
  1: { id: 1, codice: 'C1', nome: 'Valvola a sfera', categoria: 'Raccordi', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 10, sconto_base_pct: 30, raee: 0, attivo: 1, disponibilita: 'disponibile' },
  2: { id: 2, codice: 'C2', nome: 'Raccordo a T', categoria: 'Raccordi', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 5, sconto_base_pct: 20, raee: 0, attivo: 1, disponibilita: 'disponibile' },
};
const utente = {
  id: 1, ruolo: 'cliente', username: 'prova', ragione_sociale: 'Prova S.r.l.', zona: 'Genova', distributor_id: null, attivo: 1,
  password_hash: bcrypt.hashSync('password-di-prova', 4), indirizzo_consegna: 'Via Puggia 22/3, Genova',
};
const config = { servizio_pct: '10', iva_pct: '22', finestra_conferma_min: '10', ordine_minimo: '33', spedizione_fissa: '10' };
const registro = []; // le query viste, per controllare cosa NON è stato eseguito

// Storico del cliente 1: richieste, righe e ordini. Si accende solo nelle prove che lo usano (storico.attivo), così
// le altre pagine (barra in basso, home) restano come prima. pg legge le colonne TIMESTAMP (UTC senza fuso) come ora
// locale: `naive` costruisce lo stesso tipo di Date, e funziona qualunque sia il fuso del PC.
const naive = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
const fa = (ms) => naive(new Date(Date.now() - ms));
const storico = {
  attivo: false,
  richieste: [
    { id: 6, stato: 'in_attesa', creato_il: fa(60000), scade_il: naive(new Date(Date.now() + 300000)), order_id: null, pagamento_stato: 'pagato', pagamento_importo: 66.9 },
    { id: 5, stato: 'ordinata', creato_il: fa(2 * 3600000), scade_il: fa(3600000), order_id: 50, pagamento_stato: 'pagato', pagamento_importo: 66.9 },
    { id: 4, stato: 'nessuna_offerta', creato_il: new Date(2025, 2, 20, 9, 0), scade_il: new Date(2025, 2, 20, 9, 10), order_id: null, pagamento_stato: 'rimborsato', pagamento_importo: 85.34 },
    { id: 3, stato: 'ordinata', creato_il: new Date(2025, 2, 12, 10, 40), scade_il: new Date(2025, 2, 12, 10, 50), order_id: 30, pagamento_stato: 'pagato', pagamento_importo: 120.5 },
    { id: 2, stato: 'annullata', creato_il: new Date(2025, 1, 25, 8, 0), scade_il: new Date(2025, 1, 25, 8, 10), order_id: null, pagamento_stato: 'rimborsato', pagamento_importo: 20 },
    { id: 1, stato: 'ordinata', creato_il: new Date(2025, 1, 10, 15, 0), scade_il: new Date(2025, 1, 10, 15, 10), order_id: 10, pagamento_stato: null, pagamento_importo: null },
  ].map((r) => ({ cliente_id: 1, zona: 'Genova', ...r })),
  righe: {
    6: [{ nome: 'Bocchettone A 90°', quantita: 2 }],
    5: [{ nome: 'Adattatore Ø80/100mm', quantita: 1 }],
    4: [{ nome: 'Sifone doccia', quantita: 1 }],
    3: [{ nome: 'Valvola a sfera', quantita: 4 }],
    2: [{ nome: 'Raccordo a T', quantita: 1 }],
    1: [{ nome: 'Valvola a sfera', quantita: 2 }, { nome: 'Raccordo a T', quantita: 3 }],
  },
  ordini: {
    50: { id: 50, cliente_id: 1, stato: 'inviato', creato_il: fa(2 * 3600000), consegnato_il: null, totale_ivato: 66.9, totale_finale: 54.84, distributore_nome: 'Borea' },
    30: { id: 30, cliente_id: 1, stato: 'evaso', creato_il: new Date(2025, 2, 12, 10, 45), consegnato_il: new Date(2025, 2, 12, 14, 0), totale_ivato: 120.5, totale_finale: 98.77, distributore_nome: 'Borea' },
    // ordine di prima delle offerte per distributore: niente IVA calcolata, si mostra totale_finale
    10: { id: 10, cliente_id: 1, stato: 'evaso', creato_il: new Date(2025, 1, 10, 15, 5), consegnato_il: new Date(2025, 1, 11, 9, 0), totale_ivato: 0, totale_finale: 40, distributore_nome: 'Cambielli' },
  },
};
// Gli articoli dell'ordine 10 per "Riordina": due buoni, uno disattivato, uno non più nel catalogo, uno non disponibile.
const articoliOrdine10 = [
  { product_id: 1, quantita: 2, prodotto_id: 1, attivo: 1, disponibilita: 'disponibile' },
  { product_id: 2, quantita: 3, prodotto_id: 2, attivo: 1, disponibilita: 'in_esaurimento' },
  { product_id: 3, quantita: 1, prodotto_id: 3, attivo: 0, disponibilita: 'disponibile' },
  { product_id: 77, quantita: 1, prodotto_id: null, attivo: null, disponibilita: null },
  { product_id: 4, quantita: 1, prodotto_id: 4, attivo: 1, disponibilita: 'non_disponibile' },
];

function eseguiStorico(s, p, modo) {
  if (/SELECT \* FROM requests WHERE cliente_id = \? ORDER BY id DESC LIMIT 50/.test(s)) return storico.richieste;
  if (/SELECT id, stato, creato_il, scade_il, order_id FROM requests WHERE cliente_id/.test(s)) return storico.richieste.slice(0, 5);
  if (/SELECT \* FROM requests WHERE id = \?/.test(s)) return storico.richieste.find((r) => r.id === Number(p[0])) || null;
  if (/EXTRACT\(EPOCH FROM/.test(s)) return { s: 300 };
  if (/FROM request_items ri JOIN products p/.test(s)) return p.flatMap((id) => (storico.righe[id] || []).map((x) => ({ request_id: id, ...x })));
  if (/FROM orders o LEFT JOIN distributors d/.test(s)) return p.map((id) => storico.ordini[id]).filter(Boolean);
  if (/SELECT id, cliente_id FROM orders WHERE id = \?/.test(s)) {
    return Number(p[0]) === 10 ? { id: 10, cliente_id: 1 } : Number(p[0]) === 99 ? { id: 99, cliente_id: 2 } : null;
  }
  if (/FROM order_items oi LEFT JOIN products p/.test(s)) return Number(p[0]) === 10 ? articoliOrdine10 : [];
  return undefined; // non è una query dello storico
}

// Registrazione: il distributore predefinito (BOREA SRL, due filiali: 2 e 181) e i legami che la prova ha visto creare.
// Come lo storico, si accende solo nelle prove che lo usano.
const registrazione = { attiva: false, cercato: null, legamiCreati: [], stato: 'in_attesa' };
const FILIALI = [2, 181];

function eseguiRegistrazione(s, p, modo) {
  if (/SELECT id FROM distributors WHERE attivo = 1 AND LOWER\(nome\) = LOWER/.test(s)) {
    registrazione.cercato = p[0];
    return String(p[0]).toLowerCase() === 'borea srl' ? [{ id: 2 }] : [];
  }
  if (/SELECT id FROM distributors WHERE attivo = 1 AND id = \?/.test(s)) {
    registrazione.cercato = Number(p[0]);
    return FILIALI.includes(Number(p[0])) ? [{ id: Number(p[0]) }] : [];
  }
  if (/SELECT d\.id FROM distributors d/.test(s)) return p[0].some((id) => FILIALI.includes(id)) ? FILIALI.map((id) => ({ id })) : [];
  if (/INSERT INTO users/.test(s)) return { changes: 1, lastInsertRowid: utente.id };
  if (/INSERT INTO client_distributors/.test(s)) { registrazione.legamiCreati.push([p[0], p[1]]); return { changes: 1 }; }
  if (/FROM client_distributors cd JOIN distributors d/.test(s)) {
    return registrazione.legamiCreati.map(([, d]) => ({ cliente_id: utente.id, distributor_id: d, stato: registrazione.stato, distributore: 'BOREA SRL', filiale: 'Banco', ditta_id: 6 }));
  }
  return undefined;
}

function esegui(sql, p, modo) {
  const s = sql.replace(/\s+/g, ' ');
  registro.push(s.slice(0, 90));
  if (registrazione.attiva) {
    const r = eseguiRegistrazione(s, p, modo);
    if (r !== undefined) return r;
  }
  if (storico.attivo) {
    const r = eseguiStorico(s, p, modo);
    if (r !== undefined) return modo === 'all' ? (Array.isArray(r) ? r : []) : Array.isArray(r) ? r[0] : r;
  }
  if (/^DELETE FROM session WHERE sid/.test(s)) { sessioni.delete(p[0]); return { changes: 1 }; }
  if (/^SELECT sess FROM session WHERE sid/.test(s)) { const r = sessioni.get(p[0]); return modo === 'get' ? (r ? { sess: JSON.parse(r.sess) } : null) : []; }
  if (/INSERT INTO session/.test(s)) { sessioni.set(p[0], { sess: p[1], expire: p[2] }); return { changes: 1 }; }
  if (/UPDATE session SET expire/.test(s)) return { changes: 1 };
  if (/DELETE FROM session WHERE expire/.test(s)) return { changes: 0 };
  if (/COUNT\(\*\) n FROM products/.test(s)) return { n: 1 }; // catalogo "non vuoto": niente seed automatico
  if (/FROM config WHERE chiave/.test(s)) return config[p[0]] !== undefined ? { valore: config[p[0]] } : null;
  if (/FROM users WHERE username/.test(s)) return p[0] === 'prova' ? utente : null;
  if (/FROM users WHERE id/.test(s)) return modo === 'get' ? utente : [];
  if (/FROM products WHERE attivo = 1 AND id IN/.test(s)) return p.map((id) => catalogo[id]).filter(Boolean);
  if (/FROM products WHERE attivo = 1 AND id = ANY/.test(s)) return (p[0] || []).filter((id) => catalogo[id]).map((id) => ({ id }));
  if (/SELECT id FROM products WHERE id = \? AND attivo = 1/.test(s)) return catalogo[p[0]] ? { id: p[0] } : null;
  if (/FROM macro_categorie m/.test(s)) return [{ slug: 'idraulica', nome: 'Idraulica', in_evidenza: 1, n_prodotti: 2 }, { slug: 'scarichi', nome: 'Scarichi', in_evidenza: 0, n_prodotti: 1 }];
  if (/COUNT\(\*\) AS n FROM products WHERE attivo = 1 AND foto_url/.test(s)) return { n: 0 };
  if (/COUNT\(\*\)/.test(s)) return modo === 'get' ? { n: 0 } : [];
  return modo === 'all' ? [] : modo === 'get' ? null : { changes: 0, lastInsertRowid: null };
}
const dbFinto = {
  prepare: (sql) => ({ get: async (...p) => esegui(sql, p, 'get'), all: async (...p) => esegui(sql, p, 'all'), run: async (...p) => esegui(sql, p, 'run') }),
  exec: async () => {}, ensureInit: async () => {}, mantieniCalde() {}, transaction: (fn) => (...a) => fn(...a),
  query: async () => ({ rows: [] }), pool: {},
};

// ---------------- avvio del server vero ----------------
process.env.PORT = String(PORTA);
process.env.SESSION_SECRET = 'segreto-di-prova';
delete process.env.WHATSAPP_ATTIVO;
const percorsoDb = require.resolve(path.join(radice, 'db/index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const consoleOriginale = { log: console.log, warn: console.warn, error: console.error };
const erroriServer = [];
console.log = () => {};
console.warn = () => {};
console.error = (...a) => erroriServer.push(a.map(String).join(' ').slice(0, 200));
require(path.join(radice, 'server.js'));

const base = 'http://127.0.0.1:' + PORTA;
let cookie = '';
async function chiedi(percorso, opzioni = {}) {
  const r = await fetch(base + percorso, { redirect: 'manual', ...opzioni, headers: { ...(cookie ? { cookie } : {}), ...(opzioni.headers || {}) } });
  const nuovo = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (nuovo.length) cookie = nuovo.map((c) => c.split(';')[0]).join('; ');
  return r;
}
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const json = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

test.before(async () => {
  // Una guardia in più: se per qualunque motivo il DB finto non fosse quello in uso, meglio fermarsi.
  assert.equal(require.cache[percorsoDb].exports, dbFinto, 'il DB deve essere quello finto');
  await new Promise((r) => setTimeout(r, 800)); // il server parte
});

test.after(() => {
  Object.assign(console, consoleOriginale);
  // Il server continua ad ascoltare: si esce a mano, node:test non lo farebbe da solo.
  setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
});

test('login: pagina con icone, manifest e intestazioni di sicurezza', async () => {
  const r = await chiedi('/login');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /rel="manifest"/);
  assert.match(t, /icona-192\.png/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.match(r.headers.get('cache-control'), /no-cache/);
});

test('accedi: testata, pillola, campi con occhio; senza la vecchia nota sui distributori', async () => {
  const t = await (await chiedi('/login')).text();
  assert.match(t, /Il pezzo che ti manca, in cantiere\./);
  assert.match(t, /acc-occhiello">Ordini Minuteria</);
  assert.match(t, /Chiedi la disponibilità al banco e ricevi il materiale dove lavori\./);
  assert.doesNotMatch(t, /confronta tempi|distributori che indichi|i distributori dovranno/);
  assert.match(t, /<nav class="acc-schede"[^>]*>\s*<a href="\/login" class="attiva"[^>]*>Accedi<\/a>\s*<a href="\/registrati">Registrati<\/a>/);
  assert.match(t, /<input type="text" id="username" name="username"[^>]*placeholder="es\. rossimpianti"[^>]*autocomplete="username"/);
  assert.match(t, /<input type="password" id="password" name="password"[^>]*autocomplete="current-password"/);
  assert.match(t, /data-mostra-password hidden aria-label="Mostra password" aria-pressed="false"/);
  assert.match(t, /Non hai un account\? <a href="\/registrati">Registra la tua impresa<\/a>/);
  // l'errore resta sopra i campi
  const r = await chiedi('/login', form({ username: 'prova', password: 'sbagliata' }));
  const e = await r.text();
  assert.equal(r.status, 401);
  assert.ok(e.indexOf('Credenziali non valide.') < e.indexOf('<form'), 'errore sopra il modulo');
});

test('asset versionati: ?v=<data di modifica> con cache lunga, senza ?v solo ETag', async () => {
  const t = await (await chiedi('/login')).text();
  const css = t.match(/href="(\/style\.css\?v=\d+)"/);
  assert.ok(css, 'link css versionato');
  const js = t.match(/src="(\/app\.js\?v=\d+)"/);
  assert.ok(js, 'script versionato');
  let r = await chiedi(css[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=31536000, immutable/);
  r = await chiedi(js[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /immutable/);
  r = await chiedi('/style.css');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.headers.get('cache-control') || '', /immutable/);
  assert.ok(r.headers.get('etag'));
  // un file che non è nell'elenco non prende la cache lunga, nemmeno con ?v=
  r = await chiedi('/manifest.webmanifest?v=1');
  assert.doesNotMatch(r.headers.get('cache-control') || '', /immutable/);

  // la versione segue la data di modifica del file (si rilegge al massimo ogni 5 secondi)
  const file = path.join(radice, 'public', 'style.css');
  const originale = fs.statSync(file);
  fs.utimesSync(file, originale.atime, new Date(originale.mtimeMs + 60000));
  try {
    await new Promise((x) => setTimeout(x, 5200));
    const t2 = await (await chiedi('/login')).text();
    assert.notEqual(t2.match(/href="(\/style\.css\?v=\d+)"/)[1], css[1], 'la versione cambia con il file');
  } finally {
    fs.utimesSync(file, originale.atime, originale.mtime);
  }
});

test('file statici della PWA: favicon, manifest, service worker, icone', async () => {
  let r = await chiedi('/favicon.ico');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);
  r = await chiedi('/manifest.webmanifest');
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length >= 3);
  r = await chiedi('/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /notificationclick/);
  for (const i of m.icons) assert.equal((await chiedi(i.src)).status, 200, i.src);
  assert.equal((await chiedi('/icons/apple-touch-icon.png')).status, 200);
});

test('percorso inesistente: 404 con pagina, /api: 404 JSON', async () => {
  let r = await chiedi('/non-esiste');
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Pagina non trovata/);
  r = await chiedi('/api/non-esiste');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /json/);
  assert.equal((await r.json()).ok, false);
});

test('id non numerico: 404 e nessuna query al DB', async () => {
  const prima = registro.length;
  assert.equal((await chiedi('/ordini/abc')).status, 404);
  assert.equal((await chiedi('/richieste/1e3')).status, 404);
  assert.equal((await chiedi('/ddt/99999999999')).status, 404);
  assert.ok(!registro.slice(prima).some((q) => /FROM orders|FROM requests WHERE id/.test(q)), 'nessuna query con un id non valido');
});

test('API senza sessione: 401 JSON (non un redirect HTML)', async () => {
  for (const [metodo, percorso] of [['GET', '/api/carrello'], ['POST', '/api/carrello/imposta'], ['GET', '/api/cerca?q=ab'], ['GET', '/api/notifiche/push'], ['GET', '/api/distributore/novita']]) {
    const r = await chiedi(percorso, { method: metodo });
    assert.equal(r.status, 401, percorso);
    assert.match(r.headers.get('content-type'), /json/);
    assert.equal((await r.json()).ok, false);
  }
});

test('login: password come array o corpo assente non danno errori 500', async () => {
  let r = await chiedi('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=prova&password[]=a&password[]=b' });
  assert.equal(r.status, 401);
  r = await chiedi('/login', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('login: credenziali sbagliate o utente inesistente -> 401', async () => {
  let r = await chiedi('/login', form({ username: 'prova', password: 'sbagliata' }));
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Credenziali non valide/);
  r = await chiedi('/login', form({ username: 'nessuno', password: 'x' }));
  assert.equal(r.status, 401);
});

test('login: credenziali giuste -> sessione, redirect, cookie HttpOnly', async () => {
  cookie = '';
  const r = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const impostati = r.headers.getSetCookie().join(' ');
  assert.match(impostati, /HttpOnly/i);
  assert.match(impostati, /SameSite=Lax/i);
  assert.ok(cookie, 'cookie ricevuto');
  assert.equal((await chiedi('/')).headers.get('location'), '/home');
});

test('home cliente: pagina completa', async () => {
  const r = await chiedi('/home');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Cosa ti serve/);
  assert.match(t, /Idraulica/);
});

test('query ripetuta (?q=a&q=b) e filtri come array: niente 500', async () => {
  assert.equal((await chiedi('/cerca?q=a&q=b')).status, 200);
  assert.equal((await chiedi('/cerca?q=valvola&diametro=1&diametro=2&materiale=x&materiale=y')).status, 200);
  assert.equal((await chiedi('/api/cerca?q=ab&q=cd')).status, 200);
  assert.notEqual((await chiedi('/categoria/idraulica?p=99999999999999999999&sotto=a&sotto=b')).status, 500);
});

test('carrello: imposta, tetto sulla quantità, id non valido o inesistente', async () => {
  let r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 5 }));
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.pezzi, 5);
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 99999999999 }));
  d = await r.json();
  assert.equal(d.carrello['1'], 9999);
  assert.equal(d.pezzi, 9999);
  r = await chiedi('/api/carrello/imposta', json({ id: 'abc', qty: 3 }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
  r = await chiedi('/api/carrello/imposta', json({ id: 999, qty: 3 }));
  assert.equal(r.status, 404);
  r = await chiedi('/api/carrello');
  d = await r.json();
  assert.deepEqual(Object.keys(d.carrello), ['1']);
  assert.equal(d.pezzi, 9999, "l'id inventato non resta nel carrello");
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 0 }));
  assert.equal((await r.json()).pezzi, 0);
});

test('carrello: aggiungi e batch con valori strani', async () => {
  let r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 3 }));
  let d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.prodottoQty, 3);
  r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 99999 }));
  assert.equal((await r.json()).prodottoQty, 9999);
  assert.equal((await chiedi('/api/carrello/aggiungi', json({ id: 'x', qty: 1 }))).status, 400);
  r = await chiedi('/api/carrello/aggiungi-batch', json({ items: [null, 5, 'a', { id: 1, qty: 2 }, { id: 'zz', qty: 1 }, { id: 999, qty: 1 }] }));
  d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(d.aggiornati), ['1']);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({ items: 'niente' }))).status, 400);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({}))).status, 400);
});

test('carrello: pagina con articoli e totali', async () => {
  const r = await chiedi('/carrello');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Valvola a sfera/);
  assert.match(t, /max="9999"/);
});

test('menu del profilo (cliente): niente voce "Notifiche"', async () => {
  const t = await (await chiedi('/home')).text();
  assert.match(t, /La mia anagrafica/);
  assert.match(t, /Storico ordini/);
  assert.doesNotMatch(t, /href="\/notifiche"/);
});

test('storico: "In corso", mesi, etichette, importi e Riordina solo sui consegnati', async () => {
  storico.attivo = true;
  try {
    const prima = registro.length;
    const r = await chiedi('/storico');
    assert.equal(r.status, 200);
    const t = await r.text();
    const dopo = registro.slice(prima);
    // righe e ordini di tutte le schede con una lettura ciascuna, non una per scheda
    assert.equal(dopo.filter((q) => /FROM request_items/.test(q)).length, 1);
    assert.equal(dopo.filter((q) => /FROM orders o LEFT JOIN distributors/.test(q)).length, 1);

    assert.match(t, /<title>[^<]*Storico ordini/);
    assert.match(t, /class="titolo">Storico ordini</);
    // ordine delle sezioni: In corso, poi i mesi dal più recente
    const posizioni = ['In corso', 'Marzo 2025', 'Febbraio 2025'].map((x) => t.indexOf('>' + x + '<'));
    assert.ok(posizioni.every((x) => x > 0), 'ci sono tutte le sezioni');
    assert.deepEqual([...posizioni].sort((a, b) => a - b), posizioni);
    // in corso: richiesta in attesa (id 6) e ordine in consegna (richiesta 5, ordine 50), non il resto
    const inCorso = t.slice(posizioni[0], posizioni[1]);
    assert.match(inCorso, /href="\/richieste\/6"/);
    assert.match(inCorso, /href="\/ordini\/50"/);
    assert.doesNotMatch(inCorso, /href="\/(ordini\/30|ordini\/10|richieste\/4|richieste\/2)"/);
    assert.match(inCorso, /Oggi · \d\d:\d\d/);
    assert.match(inCorso, /2× Bocchettone/);
    assert.match(inCorso, /In attesa/);
    assert.match(inCorso, /In consegna/);
    assert.match(inCorso, /€ 66,90/);
    assert.match(inCorso, /Borea/);
    // marzo 2025: nessuna risposta (rimborsata) e consegnato
    const marzo = t.slice(posizioni[1], posizioni[2]);
    assert.match(marzo, /20 mar 2025 · 10:00/);
    assert.match(marzo, /Nessuna risposta/);
    assert.match(marzo, /Rimborsato/);
    assert.match(marzo, /€ 85,34/);
    assert.match(marzo, /12 mar 2025 · 11:40/);
    assert.match(marzo, /Consegnato/);
    assert.match(marzo, /€ 120,50/);
    // febbraio 2025: annullata e un ordine con più articoli, vecchio (totale_ivato 0 -> totale_finale)
    const febbraio = t.slice(posizioni[2]);
    assert.match(febbraio, /Annullata/);
    assert.match(febbraio, /2× Valvola a sfera <span class="st-altri">\+ 1 altro</);
    assert.match(febbraio, /€ 40,00/);
    assert.match(febbraio, /Cambielli/);
    // nessuna etichetta del vecchio elenco
    assert.doesNotMatch(t, /Inviato|In preparazione|Partito|Scaduta senza ordine/);
    // "Riordina" solo sui due ordini consegnati (30 e 10), come form fuori dal link
    const form = [...t.matchAll(/<form class="st-riordina" method="POST" action="\/storico\/(\d+)\/riordina">/g)].map((m) => m[1]);
    assert.deepEqual(form.sort(), ['10', '30']);
    assert.doesNotMatch(t, /<a class="st-link"[^>]*>(?:(?!<\/a>)[\s\S])*<form/);
    // il menu del profilo non ha le Notifiche nemmeno qui
    assert.doesNotMatch(t, /href="\/notifiche"/);
  } finally {
    storico.attivo = false;
  }
});

test('storico vuoto: icona, "Nessun ordine ancora." e pulsante verso il catalogo', async () => {
  const t = await (await chiedi('/storico')).text();
  assert.match(t, /Nessun ordine ancora\./);
  assert.match(t, /<a class="btn btn-primary btn-blocco" href="\/home">Vai al catalogo<\/a>/);
  assert.doesNotMatch(t, /st-titolo/);
});

test('riordina: somma al carrello, salta gli articoli non disponibili e lo dice una sola volta', async () => {
  storico.attivo = true;
  try {
    await chiedi('/carrello/svuota', { method: 'POST' });
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 1 })); // già nel carrello: le quantità si sommano
    let r = await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/carrello');
    const carrello = (await (await chiedi('/api/carrello')).json()).carrello;
    assert.deepEqual(carrello, { 1: 3, 2: 3 });

    r = await chiedi('/carrello');
    const t = await r.text();
    assert.match(t, /class="avviso avviso-attenzione"[^>]*>3 articoli non sono più disponibili</);
    assert.ok(t.indexOf('avviso-attenzione') < t.indexOf('carrello-layout'), 'avviso in cima');
    assert.doesNotMatch(await (await chiedi('/carrello')).text(), /non sono più disponibili/, 'solo una volta');

    // un secondo riordino somma ancora
    await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 });

    // l'ordine di un altro cliente e uno inesistente non si riordinano; un id non valido è 404
    assert.equal((await chiedi('/storico/99/riordina', { method: 'POST' })).status, 403);
    assert.equal((await chiedi('/storico/98/riordina', { method: 'POST' })).status, 404);
    assert.equal((await chiedi('/storico/abc/riordina', { method: 'POST' })).status, 404);
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 }, 'carrello intatto');
  } finally {
    storico.attivo = false;
    await chiedi('/carrello/svuota', { method: 'POST' });
  }
});

test('JSON malformato: 400 pulito (non 500); corpo enorme: 413', async () => {
  let r = await chiedi('/api/carrello/imposta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rotto' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
  r = await chiedi('/carrello', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(200000) }) });
  assert.equal(r.status, 413);
});

test('CSRF: un POST da un altro sito è respinto', async () => {
  const r = await chiedi('/logout', { method: 'POST', headers: { origin: 'http://sito-cattivo.example' } });
  assert.equal(r.status, 403);
});

test('ruolo sbagliato: la pagina del banco a un cliente -> 403', async () => {
  const r = await chiedi('/distributore');
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Accesso non consentito/);
  const j = await chiedi('/api/distributore/novita');
  assert.equal(j.status, 403);
  assert.match(j.headers.get('content-type'), /json/);
});

test('registrazione: "constructor" non è una forma giuridica valida', async () => {
  const r = await chiedi('/registrati', form({ tipo_soggetto: 'constructor', ragione_sociale: 'X' }));
  assert.equal(r.status, 400);
  assert.match(await r.text(), /impresa o una ditta individuale/);
});

test('registrazione: campi troppo lunghi e password oltre 72 caratteri respinti', async () => {
  const r = await chiedi('/registrati', form({
    tipo_soggetto: 'impresa', ragione_sociale: 'x'.repeat(300), username: 'nuovo.utente',
    password: 'p'.repeat(80), password2: 'p'.repeat(80),
  }));
  assert.equal(r.status, 400);
  const t = await r.text();
  assert.match(t, /Nessun campo può superare i 200 caratteri/);
  assert.match(t, /al massimo 72 caratteri/);
});

test('logout: la sessione è distrutta', async () => {
  assert.equal((await chiedi('/logout', { method: 'POST' })).status, 302);
  const dopo = await chiedi('/home');
  assert.equal(dopo.status, 302);
  assert.equal(dopo.headers.get('location'), '/login');
});

// ---- Registrazione a tre passi, collegamento automatico al distributore predefinito, benvenuto ----

const iscrizione = {
  tipo_soggetto: 'impresa', ragione_sociale: 'Rossi Impianti S.r.l.', referente: 'Mario Rossi', email: 'info@rossi.it',
  telefono: '333 1234567', partita_iva: '01234567890', codice_fiscale: '', indirizzo: 'Via Roma 1', cap: '16100',
  citta: 'Genova', provincia: 'GE', sdi_pec: '', username: 'rossimpianti', password: 'password-lunga', password2: 'password-lunga',
};

test('registrati: un solo modulo in tre passi, senza scelta del distributore né note vecchie', async () => {
  cookie = '';
  const t = await (await chiedi('/registrati')).text();
  assert.equal(t.match(/<form /g).length, 1);
  assert.match(t, /<form method="POST" action="\/registrati" data-reg-form>/);
  assert.equal(t.match(/data-reg-passo/g).length, 3);
  for (const x of ['La tua impresa', 'Dati di fatturazione', 'Accesso', 'Passo 1 di 3', 'Passo 2 di 3', 'Passo 3 di 3', 'Registra la tua impresa']) {
    assert.ok(t.includes(x), x);
  }
  assert.match(t, /data-passo-iniziale="1"/);
  // forma giuridica: i due valori, "Impresa" già scelta
  assert.match(t, /value="impresa" checked required/);
  assert.match(t, /value="ditta_individuale"\s+required/);
  // autocomplete corretti
  for (const a of ['username', 'new-password', 'organization', 'email', 'tel', 'street-address', 'postal-code']) {
    assert.ok(t.includes('autocomplete="' + a + '"'), a);
  }
  // hint al posto degli asterischi
  assert.match(t, /Tutto attaccato: lettere, numeri, punto o trattino\./);
  assert.match(t, /Almeno 8 caratteri\./);
  assert.match(t, /Facoltativo, se diverso dalla Partita IVA/);
  assert.match(t, /Facoltativo: serve per la fattura elettronica/);
  assert.match(t, /I dati fiscali servono per intestare bolle e fatture\./);
  assert.doesNotMatch(t, /<label[^>]*>[^<]*\*/);
  // via le sezioni e le note sui distributori
  assert.doesNotMatch(t, /name="distributori"|I tuoi distributori|Per ora tutte le consegne|ai distributori che indichi/);
  // due password con l'occhio e fascia fissa con il pulsante
  assert.equal(t.match(/data-mostra-password/g).length, 2);
  assert.match(t, /Hai già un account\? <a href="\/login">Accedi<\/a>/);
});

test('registrati: dopo un errore si riapre sul primo passo sbagliato e i dati restano', async () => {
  const casi = [
    [{ tipo_soggetto: 'constructor' }, 1, 'impresa o una ditta individuale'],
    [{ email: 'non-una-email' }, 1, "L&#39;email non sembra valida"],
    [{ partita_iva: '123' }, 2, 'La partita IVA deve avere 11 cifre'],
    [{ cap: '12' }, 2, 'Il CAP deve avere 5 cifre'],
    [{ username: 'ab' }, 3, 'Il nome utente può avere da 3 a 30 caratteri'],
    [{ password2: 'un-altra-password' }, 3, 'Le due password non coincidono'],
    // errori in più passi: vale il primo
    [{ partita_iva: '123', password2: 'diversa' }, 2, 'La partita IVA deve avere 11 cifre'],
    [{ email: 'x', partita_iva: '123', username: 'ab' }, 1, 'Controlla questi punti'],
  ];
  for (const [modifica, passo, testo] of casi) {
    const r = await chiedi('/registrati', form({ ...iscrizione, ...modifica }));
    const t = await r.text();
    const descrizione = JSON.stringify(modifica);
    assert.equal(r.status, 400, descrizione);
    assert.match(t, new RegExp(`data-passo-iniziale="${passo}"`), descrizione);
    assert.ok(t.includes(testo), descrizione + ' -> ' + testo);
    assert.match(t, /Controlla questi punti/, descrizione);
    // i campi già compilati restano pieni (le password no)
    assert.match(t, /value="Rossi Impianti S\.r\.l\."/, descrizione);
    assert.match(t, /value="Mario Rossi"/, descrizione);
    assert.doesNotMatch(t, /value="password-lunga"/, descrizione);
  }
  // il campo sbagliato è segnato
  const t = await (await chiedi('/registrati', form({ ...iscrizione, partita_iva: '123' }))).text();
  assert.match(t, /id="partita_iva"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(t, /id="ragione_sociale"[^>]*aria-invalid/);
});

test('registrati: collegamento automatico a BOREA SRL (tutte le filiali) e schermata di benvenuto', async () => {
  registrazione.attiva = true;
  Object.assign(registrazione, { cercato: null, legamiCreati: [], stato: 'in_attesa' });
  try {
    // "distributori" nel corpo non conta più: il legame è sempre quello predefinito
    let r = await chiedi('/registrati', form({ ...iscrizione, distributori: '99' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/benvenuto');
    assert.equal(registrazione.cercato, 'BOREA SRL');
    assert.deepEqual(registrazione.legamiCreati, [[utente.id, 2], [utente.id, 181]]);

    r = await chiedi('/benvenuto');
    assert.equal(r.status, 200);
    let t = await r.text();
    assert.match(t, /Benvenuto in Ordini Minuteria/);
    assert.match(t, /L’anagrafica di <strong>Prova S\.r\.l\.<\/strong> è pronta\./);
    assert.match(t, /Il tuo distributore<\/div>\s*<div class="ben-nome">BOREA SRL</);
    assert.match(t, /BOREA SRL confermerà a breve che sei suo cliente\./);
    assert.match(t, /<a class="acc-btn" href="\/home">Vai al catalogo<\/a>/);
    assert.match(t, /<a class="ben-link" href="\/profilo">Vedi la mia anagrafica<\/a>/);
    assert.doesNotMatch(t, /class="navbar"|class="appbar"/);

    // già approvato: niente riga "confermerà a breve"
    registrazione.stato = 'approvato';
    t = await (await chiedi('/benvenuto')).text();
    assert.match(t, /ben-nome">BOREA SRL</);
    assert.doesNotMatch(t, /confermerà a breve/);

    // il distributore predefinito si cambia dal .env: id di una filiale, o nome della ditta
    registrazione.legamiCreati = [];
    process.env.DISTRIBUTORE_PREDEFINITO = '181';
    await chiedi('/logout', { method: 'POST' });
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    assert.equal(registrazione.cercato, 181);
    assert.deepEqual(registrazione.legamiCreati, [[utente.id, 2], [utente.id, 181]], 'con tutte le filiali della ditta');

    // un distributore che non esiste non blocca la registrazione: nessun legame, e un errore nel log
    registrazione.legamiCreati = [];
    process.env.DISTRIBUTORE_PREDEFINITO = '999';
    await chiedi('/logout', { method: 'POST' });
    const prima = erroriServer.length;
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    assert.deepEqual(registrazione.legamiCreati, []);
    assert.match(erroriServer[prima], /distributore predefinito "999" non trovato/);
    erroriServer.splice(prima, 1); // atteso: non è un errore inatteso per la prova finale
    t = await (await chiedi('/benvenuto')).text();
    assert.match(t, /Benvenuto in Ordini Minuteria/);
    assert.doesNotMatch(t, /Il tuo distributore/);
  } finally {
    delete process.env.DISTRIBUTORE_PREDEFINITO;
    registrazione.attiva = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('benvenuto: senza accesso si va al login', async () => {
  const r = await chiedi('/benvenuto');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
