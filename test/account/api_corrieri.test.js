// L'API dell'app per i corrieri (src/routes/api_v1/corrieri.js): registrazione con nome, cognome, email e password; accesso con l'email; "chi sono"; "password
// dimenticata"; e il rifiuto dell'accesso degli installatori a un account corriere. DB finto in memoria: nessun accesso al database vero e nessuna email
// vera. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

// I limiti per indirizzo (express-rate-limit) restano spenti: qui si provano i contatori per utente di limite_login.
process.env.LIMITE_RICHIESTE_DISATTIVATO = '1';
process.env.APP_URL = '';

const impronta = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ---------------- DB finto ----------------
let utenti = [];
let prossimoId = 1;
const accessiApp = new Map(); // impronta del token -> id utente
const inserimenti = []; // le righe di app_tokens scritte: { user_id, token_hash, dispositivo }
const linkRecupero = [];
let corsa = false; // simula un'altra registrazione che prende la stessa email un istante prima dell'inserimento

const nuovoUtente = (extra) => ({
  id: prossimoId++, attivo: 1, email: '', nome: '', cognome: '', referente: '', ragione_sociale: 'X', password_hash: bcrypt.hashSync('password-giusta', 4), ...extra,
});

const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = (p) => {
      if (/^SELECT id FROM users WHERE username = \?$/.test(s)) {
        if (corsa) return undefined; // il controllo non vede ancora l'altra registrazione...
        const u = utenti.find((x) => x.username === p[0]);
        return u ? { id: u.id } : undefined;
      }
      if (/^INSERT INTO users \(ruolo, username, password_hash, ragione_sociale, nome, cognome, email\)/.test(s)) {
        if (utenti.some((x) => x.username === p[1])) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
        const u = nuovoUtente({ ruolo: p[0], username: p[1], password_hash: p[2], ragione_sociale: p[3], nome: p[4], cognome: p[5], email: p[6] });
        utenti.push(u);
        return { lastInsertRowid: u.id, changes: 1 };
      }
      if (/^SELECT \* FROM users WHERE id = \?$/.test(s)) return utenti.find((x) => x.id === p[0]);
      // L'accesso degli installatori (src/logica/account/utenti.js).
      if (/^SELECT \* FROM users WHERE username = \? AND attivo = 1$/.test(s)) return utenti.find((x) => x.username === p[0] && x.attivo === 1);
      // L'accesso dei corrieri: per nome utente (l'email), poi per l'email del profilo.
      if (/^SELECT \* FROM users WHERE attivo = 1 AND \(username = \? OR \(email <> '' AND lower\(email\) = \?\)\)/.test(s)) {
        const trovati = utenti.filter((x) => x.attivo === 1 && (x.username === p[0] || (x.email !== '' && x.email.toLowerCase() === p[1])));
        return trovati.sort((a, b) => Number(b.username === p[2]) - Number(a.username === p[2]) || a.id - b.id)[0];
      }
      if (/^INSERT INTO app_tokens/.test(s)) {
        accessiApp.set(p[1], p[0]);
        inserimenti.push({ user_id: p[0], token_hash: p[1], dispositivo: p[2] });
        return { changes: 1 };
      }
      if (/^SELECT t\.id AS token_id/.test(s)) {
        const u = utenti.find((x) => x.id === accessiApp.get(p[0]) && x.attivo === 1);
        return u ? { ...u, token_id: 1, usato_il: new Date() } : undefined;
      }
      if (/^UPDATE app_tokens SET usato_il/.test(s)) return { changes: 1 };
      // Il recupero della password (src/logica/account/recupero_password.js).
      if (/^SELECT id, username, email, referente, ragione_sociale FROM users WHERE ruolo = \? AND attivo = 1/.test(s)) {
        const cerca = String(p[1]).toLowerCase();
        return utenti.filter((x) => x.ruolo === p[0] && x.attivo === 1 && (x.username.toLowerCase() === cerca || (x.email !== '' && x.email.toLowerCase() === String(p[2]).toLowerCase())));
      }
      if (/^UPDATE recupero_password SET usato_il = NOW\(\) WHERE user_id = \? AND usato_il IS NULL/.test(s)) return { changes: 1 };
      if (/^INSERT INTO recupero_password \(user_id, token_hash, scade_il\)/.test(s)) {
        linkRecupero.push({ user_id: p[0], token_hash: p[1] });
        return { changes: 1 };
      }
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 120));
    };
    return {
      get: async (...p) => esegui(p) || null,
      all: async (...p) => {
        const r = esegui(p);
        return Array.isArray(r) ? r : r ? [r] : [];
      },
      run: async (...p) => esegui(p),
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const apiV1 = require('../../src/routes/api_v1');
const email = require('../../src/logica/notifiche/email');
const limite = require('../../src/logica/account/limite_login');

const app = express();
app.use(express.json());
app.use('/api/v1', apiV1);
let server;
let base;
const spedite = [];

test.before(async () => {
  email.impostaTrasporto({ sendMail: async (o) => { spedite.push(o); } });
  server = app.listen(0, '127.0.0.1');
  await new Promise((fatto) => server.once('listening', fatto));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(() => {
  email.impostaTrasporto(null);
  server.close();
});
test.beforeEach(() => {
  utenti = [];
  prossimoId = 1;
  accessiApp.clear();
  inserimenti.length = 0;
  linkRecupero.length = 0;
  spedite.length = 0;
  corsa = false;
  limite.svuotaTutto();
});

const post = (percorso, corpo, intestazioni = {}) =>
  fetch(base + percorso, { method: 'POST', headers: { 'content-type': 'application/json', ...intestazioni }, body: JSON.stringify(corpo) });
const corriere = (extra = {}) =>
  nuovoUtente({ ruolo: 'corriere', username: 'marco@example.com', email: 'marco@example.com', nome: 'Marco', cognome: 'Bianchi', ragione_sociale: 'Marco Bianchi', ...extra });
const installatore = (extra = {}) => nuovoUtente({ ruolo: 'cliente', username: 'rossi', email: 'info@rossi.it', ragione_sociale: 'Rossi Impianti', ...extra });
const attendiMail = async () => {
  for (let i = 0; i < 40 && !spedite.length; i++) await new Promise((r) => setTimeout(r, 25));
};

// ---------------- registrazione ----------------

test('registrati: crea l\'account corriere (email in minuscolo come nome utente, password cifrata) e risponde col token: si entra subito', async () => {
  const r = await post('/corrieri/registrati', { nome: ' Marco ', cognome: 'Bianchi', email: '  Marco@Example.COM ', password: 'password-lunga', dispositivo: 'android' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(j.utente, { id: 1, username: 'marco@example.com', ragione_sociale: 'Marco Bianchi', ruolo: 'corriere', nome: 'Marco', cognome: 'Bianchi', email: 'marco@example.com' });

  const riga = utenti[0];
  assert.equal(riga.ruolo, 'corriere');
  assert.equal(riga.username, 'marco@example.com');
  assert.notEqual(riga.password_hash, 'password-lunga');
  assert.ok(bcrypt.compareSync('password-lunga', riga.password_hash), 'la password è salvata come hash bcrypt');
  // nel DB resta l'impronta del token, mai il token
  assert.equal(inserimenti.length, 1);
  assert.equal(inserimenti[0].token_hash, impronta(j.token));
  assert.equal(inserimenti[0].dispositivo, 'android');
  // il token apre "chi sono"
  const me = await fetch(base + '/corrieri/me', { headers: { authorization: 'Bearer ' + j.token } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).utente.nome, 'Marco');
});

test('registrati: errori per campo (stesso formato della registrazione dell\'installatore) e niente account', async () => {
  let r = await post('/corrieri/registrati', {});
  assert.equal(r.status, 400);
  let j = await r.json();
  assert.deepEqual(j.errori.map((e) => e.campi[0]), ['nome', 'cognome', 'email', 'password']);
  assert.equal(j.errore, j.errori[0].testo);

  r = await post('/corrieri/registrati', { nome: 'Marco', cognome: 'Bianchi', email: 'non-un-email', password: 'password-lunga' });
  j = await r.json();
  assert.deepEqual(j.errori, [{ testo: 'L\'email non sembra valida.', campi: ['email'] }]);

  r = await post('/corrieri/registrati', { nome: 'Marco', cognome: 'Bianchi', email: 'marco@example.com', password: '1234567' });
  j = await r.json();
  assert.deepEqual(j.errori, [{ testo: 'La password deve avere almeno 8 caratteri.', campi: ['password'] }]);

  r = await post('/corrieri/registrati', { nome: 'Marco', cognome: 'Bianchi', email: 'marco@example.com', password: 'a'.repeat(73) });
  assert.equal(r.status, 400);

  // valori che non sono testo (JSON): non esplodono, sono semplicemente sbagliati
  r = await post('/corrieri/registrati', { nome: { a: 1 }, cognome: ['x'], email: 5, password: ['password-lunga'] });
  assert.equal(r.status, 400);
  assert.equal(utenti.length, 0, 'nessun account creato');
  assert.equal(inserimenti.length, 0, 'nessun token creato');
});

test('registrati: email già usata (anche con le maiuscole, anche se la corsa con un\'altra registrazione la prende un istante prima)', async () => {
  utenti.push(corriere());
  prossimoId = 2;
  let r = await post('/corrieri/registrati', { nome: 'Altro', cognome: 'Corriere', email: 'MARCO@example.com', password: 'password-lunga' });
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).errori, [{ testo: 'Questa email è già registrata.', campi: ['email'] }]);

  corsa = true; // il controllo non la vede, l'inserimento sì (vincolo di unicità del database)
  r = await post('/corrieri/registrati', { nome: 'Altro', cognome: 'Corriere', email: 'marco@example.com', password: 'password-lunga' });
  assert.equal(r.status, 400);
  assert.deepEqual((await r.json()).errori, [{ testo: 'Questa email è già registrata.', campi: ['email'] }]);
  assert.equal(utenti.length, 1);
});

test('registrati: troppe registrazioni dallo stesso indirizzo -> 429', async () => {
  let ultimo;
  for (let i = 0; i < 14; i++) {
    ultimo = await post('/corrieri/registrati', { nome: 'N', cognome: 'C', email: `c${i}@example.com`, password: 'password-lunga' });
    if (ultimo.status === 429) break;
  }
  assert.equal(ultimo.status, 429);
  assert.match((await ultimo.json()).errore, /troppe registrazioni/);
});

// ---------------- accesso ----------------

test('accedi: email e password giuste (maiuscole e spazi non contano) -> token e dati del corriere', async () => {
  utenti.push(corriere());
  const r = await post('/corrieri/accedi', { email: '  MARCO@example.com ', password: 'password-giusta', dispositivo: 'ios' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.utente.ruolo, 'corriere');
  assert.equal(j.utente.nome, 'Marco');
  assert.equal(j.utente.email, 'marco@example.com');
  assert.equal(inserimenti[0].token_hash, impronta(j.token));
});

test('accedi: password sbagliata o email che non esiste -> stesso 401 e stesso messaggio generico dell\'installatore', async () => {
  utenti.push(corriere());
  const sbagliata = await post('/corrieri/accedi', { email: 'marco@example.com', password: 'sbagliata' });
  const inesistente = await post('/corrieri/accedi', { email: 'nessuno@example.com', password: 'password-giusta' });
  const vuota = await post('/corrieri/accedi', {});
  for (const r of [sbagliata, inesistente, vuota]) {
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { errore: 'Credenziali non valide.' });
  }
  assert.equal(inserimenti.length, 0);
});

test('accedi: l\'account di un altro ruolo (con la password giusta) -> "Questo account non è un account corriere"; con la password sbagliata nessuna differenza', async () => {
  utenti.push(installatore(), nuovoUtente({ ruolo: 'supervisore_corrieri', username: 'sup@example.com', email: 'sup@example.com' }), nuovoUtente({ ruolo: 'distributore', username: 'banco', email: '' }));
  // l'installatore si presenta col nome utente o con l'email del profilo; il supervisore e il banco con il loro nome utente
  for (const chi of ['rossi', 'info@rossi.it', 'sup@example.com', 'banco']) {
    const r = await post('/corrieri/accedi', { email: chi, password: 'password-giusta' });
    assert.equal(r.status, 403, chi);
    assert.deepEqual(await r.json(), { errore: 'Questo account non è un account corriere' }, chi);
    const sbagliata = await post('/corrieri/accedi', { email: chi, password: 'sbagliata' });
    assert.equal(sbagliata.status, 401, 'senza la password giusta non si scopre che ruolo ha: ' + chi);
  }
  assert.equal(inserimenti.length, 0, 'nessun token');
});

test('accedi: un account disattivato non entra; troppi tentativi sbagliati -> 429', async () => {
  utenti.push(corriere({ attivo: 0 }));
  assert.equal((await post('/corrieri/accedi', { email: 'marco@example.com', password: 'password-giusta' })).status, 401);
  limite.svuotaTutto();
  let ultimo;
  for (let i = 0; i < 12; i++) {
    ultimo = await post('/corrieri/accedi', { email: 'marco@example.com', password: 'sbagliata' + i });
    if (ultimo.status === 429) break;
  }
  assert.equal(ultimo.status, 429);
  assert.match((await ultimo.json()).errore, /Troppi tentativi/);
});

// ---------------- chi sono, uscita e rotte degli installatori ----------------

test('/corrieri/me: 401 senza token, 403 con il token di un installatore; il corriere non apre l\'API degli installatori', async () => {
  utenti.push(corriere(), installatore());
  const tc = (await (await post('/corrieri/accedi', { email: 'marco@example.com', password: 'password-giusta' })).json()).token;
  const ti = (await (await post('/login', { username: 'rossi', password: 'password-giusta' })).json()).token;

  assert.equal((await fetch(base + '/corrieri/me')).status, 401);
  assert.equal((await fetch(base + '/corrieri/me', { headers: { authorization: 'Bearer ' + ti } })).status, 403);
  assert.equal((await fetch(base + '/corrieri/me', { headers: { authorization: 'Bearer ' + tc } })).status, 200);
  // le rotte dell'installatore restano chiuse al corriere
  assert.equal((await fetch(base + '/me', { headers: { authorization: 'Bearer ' + tc } })).status, 403);
  assert.equal((await fetch(base + '/profilo', { headers: { authorization: 'Bearer ' + tc } })).status, 403);
});

test('accesso degli installatori (/login): un corriere o un supervisore con la password giusta riceve "Questo account non è un account installatore"', async () => {
  utenti.push(corriere(), nuovoUtente({ ruolo: 'supervisore_corrieri', username: 'sup', email: '' }), nuovoUtente({ ruolo: 'agente', username: 'agente' }));
  for (const chi of ['marco@example.com', 'sup']) {
    const r = await post('/login', { username: chi, password: 'password-giusta' });
    assert.equal(r.status, 403, chi);
    assert.deepEqual(await r.json(), { errore: 'Questo account non è un account installatore' }, chi);
  }
  // gli altri ruoli senza app hanno il loro messaggio di sempre
  const agente = await post('/login', { username: 'agente', password: 'password-giusta' });
  assert.equal(agente.status, 403);
  assert.match((await agente.json()).errore, /riservata agli installatori/);
  assert.equal(inserimenti.length, 0);
});

// ---------------- password dimenticata ----------------

test('password-dimenticata: stessa risposta per un corriere che c\'è e per uno che non c\'è; la mail parte solo al corriere, con il link del sito', async () => {
  utenti.push(corriere(), installatore({ email: 'marco@example.com' }));
  const c = await post('/corrieri/password-dimenticata', { email: 'MARCO@example.com' });
  const n = await post('/corrieri/password-dimenticata', { email: 'nessuno@example.com' });
  assert.equal(c.status, 200);
  assert.equal(n.status, 200);
  assert.deepEqual(await c.json(), await n.json());

  await attendiMail();
  assert.equal(spedite.length, 1, 'una sola mail, al corriere (non all\'installatore che ha la stessa email nel profilo)');
  assert.equal(spedite[0].to, 'marco@example.com');
  assert.match(spedite[0].html, /\/reimposta-password\/[A-Za-z0-9_-]{43}/);
  assert.equal(linkRecupero.length, 1);
  assert.equal(linkRecupero[0].user_id, 1);
});

test('password-dimenticata: email mancante o non valida -> 400; un installatore non riceve niente da qui', async () => {
  utenti.push(installatore());
  assert.equal((await post('/corrieri/password-dimenticata', {})).status, 400);
  assert.equal((await post('/corrieri/password-dimenticata', { email: 'non-un-email' })).status, 400);
  assert.equal((await post('/corrieri/password-dimenticata', { email: 'info@rossi.it' })).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(spedite.length, 0);
  assert.equal(linkRecupero.length, 0);
});

test('password-dimenticata: troppe richieste dalla stessa email -> 429', async () => {
  utenti.push(corriere());
  let ultimo;
  for (let i = 0; i < 6; i++) {
    ultimo = await post('/corrieri/password-dimenticata', { email: 'marco@example.com' });
    if (ultimo.status === 429) break;
  }
  assert.equal(ultimo.status, 429);
});
