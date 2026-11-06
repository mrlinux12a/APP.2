// I corrieri e il sito (docs/app-corrieri.md): il sito NON li fa entrare e non ha pagine per loro. Il server vero con un DB finto in memoria: vedi
// test/sito/_aiuti/server_finto.js. L'API dell'app per i corrieri si prova a parte (test/account/api_corrieri.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38488);
const { biscotti, chiedi, form, utenteCorriere } = aiuti;

test('login del sito: un corriere con la password giusta riceve "Gli account corriere si usano dall\'app" e NON ha una sessione', async () => {
  biscotti.cookie = '';
  const r = await chiedi('/login', form({ username: utenteCorriere.username, password: 'password-corriere' }));
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Gli account corriere si usano dall’app\./);
  // nessun accesso: una pagina dell'installatore rimanda al login
  const casa = await chiedi('/home');
  assert.equal(casa.status, 302);
  assert.equal(casa.headers.get('location'), '/login');
});

test('login del sito: con la password sbagliata il corriere vede il solito "Credenziali non valide" (il sito non dice chi è iscritto)', async () => {
  biscotti.cookie = '';
  const r = await chiedi('/login', form({ username: utenteCorriere.username, password: 'sbagliata' }));
  assert.equal(r.status, 401);
  const t = await r.text();
  assert.match(t, /Credenziali non valide\./);
  assert.doesNotMatch(t, /corriere/i);
});

test('login del sito: l\'installatore entra come sempre', async () => {
  biscotti.cookie = '';
  const r = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
});

test('il sito resta identico: le pagine di accesso e di registrazione non nominano i corrieri e non esistono pagine per loro', async () => {
  biscotti.cookie = '';
  for (const pagina of ['/login', '/registrati']) {
    const t = await (await chiedi(pagina)).text();
    assert.doesNotMatch(t, /corrier/i, pagina + ' non deve parlare di corrieri');
  }
  for (const pagina of ['/corriere', '/corrieri', '/accesso-corriere', '/registrati-corriere', '/corrieri/accedi']) {
    assert.equal((await chiedi(pagina)).status, 404, pagina);
  }
});
