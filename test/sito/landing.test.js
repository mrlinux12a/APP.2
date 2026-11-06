// Landing pubblica: l'indirizzo "/" per chi non è collegato (views/auth/landing.ejs, public/landing.css e landing.js). Spiegata in docs/landing.md.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38487);
const { biscotti, chiedi, erroriServer, form } = aiuti;

// Prova a nome di chi apre il sito senza essere collegato: nessun cookie.
async function landing() {
  biscotti.cookie = '';
  const r = await chiedi('/');
  return { r, t: await r.text() };
}

test('"/" senza accesso: la landing (non più il rimando a /login), con Accedi e Registrati', async () => {
  const { r, t } = await landing();
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('cache-control'), /no-cache/);
  assert.match(t, /<title>Flash Delivery/);
  // "Scopri come" resta, e accanto c'è "Accedi" che porta alla pagina di accesso (dove c'è anche la scheda Registrati)
  assert.match(t, /<a class="navcta" href="#come-funziona">Scopri come/);
  assert.match(t, /<a class="navaccedi" href="\/login">Accedi<\/a>/);
  // in fondo l'invito a registrarsi, il rimando all'accesso e i testi legali
  assert.match(t, /<a class="button" href="\/registrati">Registra la tua impresa/);
  assert.match(t, /<a class="textlink" href="\/login">Hai già un account\? Accedi<\/a>/);
  assert.match(t, /href="\/privacy"/);
  assert.match(t, /href="\/elimina-account"/);
  // la simulazione c'è e sta tutta nel browser: nessun modulo che parli col server
  assert.match(t, /id="sim-submit"/);
  assert.doesNotMatch(t, /<form/);
  assert.equal(erroriServer.length, 0, erroriServer.join('\n'));
});

test('landing: pagina autonoma e adatta al telefono (viewport, sue risorse, non quelle dell\'app)', async () => {
  const { t } = await landing();
  assert.match(t, /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover">/);
  assert.match(t, /href="\/landing\.css\?v=\d+"/);
  assert.match(t, /src="\/landing\.js\?v=\d+"/);
  assert.doesNotMatch(t, /\/style\.css|\/app\.js/);
});

test('landing: css e js versionati con cache lunga, senza ?v solo ETag', async () => {
  const { t } = await landing();
  const css = t.match(/href="(\/landing\.css\?v=\d+)"/)[1];
  const js = t.match(/src="(\/landing\.js\?v=\d+)"/)[1];
  let r = await chiedi(css);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/css/);
  assert.match(r.headers.get('cache-control'), /max-age=31536000, immutable/);
  const foglio = await r.text();
  // l'adattamento al telefono: "Accedi" resta visibile anche dove le altre voci si nascondono, e la simulazione perde la cornice del telefono
  assert.match(foglio, /@media\(max-width:600px\)/);
  assert.match(foglio, /\.navlinks>a\.navaccedi\{display:inline-block\}/);
  assert.match(foglio, /\.app-panel:before,\.device-status\{display:none\}/);
  r = await chiedi(js);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(r.headers.get('cache-control'), /immutable/);
  r = await chiedi('/landing.css');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.headers.get('cache-control') || '', /immutable/);
  assert.ok(r.headers.get('etag'));
});

test('"/" con accesso: ognuno alla sua pagina, la landing non si vede', async () => {
  biscotti.cookie = '';
  const accesso = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  assert.equal(accesso.status, 302);
  const r = await chiedi('/');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/home');
  // e senza più sessione si torna alla landing
  biscotti.cookie = '';
  assert.equal((await chiedi('/')).status, 200);
});

test('/login resta la pagina di accesso (con la scheda Registrati) e /registrati si apre senza accesso', async () => {
  biscotti.cookie = '';
  let r = await chiedi('/login');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<a href="\/registrati">Registrati<\/a>/);
  r = await chiedi('/registrati');
  assert.equal(r.status, 200);
});
