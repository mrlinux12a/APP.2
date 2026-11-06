// Sicurezza (CSRF, CSP, redirect), pagine pubbliche, registrazione e uscita.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38477);
const {
  biscotti, chiedi, erroriServer, form, iscrizione, json, registrazione, utente,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

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

test('sicurezza: CSP "leggera" (niente cornici, niente <base>, moduli solo qui), Permissions-Policy, niente HSTS su HTTP semplice', async () => {
  const r = await chiedi('/login');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.doesNotMatch(csp, /script-src/, 'le pagine usano script in linea: niente script-src');
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  // la posizione è permessa solo a questo sito (il pulsante del carrello): con `geolocation=()` il browser la bloccava sempre, su qualunque dispositivo
  assert.match(r.headers.get('permissions-policy'), /geolocation=\(self\)/);
  assert.doesNotMatch(r.headers.get('permissions-policy'), /geolocation=\(\)/);
  assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS solo quando la richiesta è HTTPS');
  // Dietro il proxy (trust proxy 1) X-Forwarded-Proto dice che la richiesta è arrivata in HTTPS: lì l'intestazione c'è.
  const https = await chiedi('/login', { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(https.headers.get('strict-transport-security'), /^max-age=\d+$/);
});

test('open redirect: "ritorno" vale solo se è un percorso di questo sito', async () => {
  for (const cattivo of ['https://sito-cattivo.example/x', '//sito-cattivo.example', '/\\sito-cattivo.example', 'javascript:alert(1)']) {
    const r = await chiedi('/carrello', form({ quantita_1: '1', ritorno: cattivo }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/carrello', cattivo);
  }
  const ok = await chiedi('/carrello', form({ quantita_1: '1', ritorno: '/categoria/idraulica?p=2' }));
  assert.equal(ok.headers.get('location'), '/categoria/idraulica?p=2');
  await chiedi('/carrello/svuota', form({}));
});

test('caratteri NUL: nella query sono tolti, nel percorso 400; nessun 500', async () => {
  assert.equal((await chiedi('/cerca?q=val%00vola')).status, 200);
  assert.equal((await chiedi('/api/cerca?q=ab%00cd')).status, 200);
  assert.equal((await chiedi('/categoria/idraulica%00x')).status, 400);
  assert.equal((await chiedi('/api/carrello/aggiungi', json({ id: 1, qty: 1, nota: 'a\u0000b' }))).status, 200);
});

test('pagine pubbliche per Google Play: informativa sulla privacy e come eliminare l’account, anche senza accesso', async () => {
  const salvato = biscotti.cookie;
  biscotti.cookie = '';
  try {
    const p = await chiedi('/privacy');
    assert.equal(p.status, 200);
    const t = await p.text();
    assert.match(t, /Informativa sulla privacy/);
    assert.match(t, /Stripe/);
    assert.match(t, /non raccoglie la posizione/);
    const e = await chiedi('/elimina-account');
    assert.equal(e.status, 200);
    const te = await e.text();
    assert.match(te, /Eliminazione dell’account/);
    assert.match(te, /Elimina account/);
    assert.match(await (await chiedi('/login')).text(), /href="\/privacy"/);
  } finally {
    biscotti.cookie = salvato;
  }
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

test('registrati: un solo modulo in tre passi, senza scelta del distributore né note vecchie', async () => {
  biscotti.cookie = '';
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
  assert.match(t, /I dati fiscali servono per intestare le fatture\./);
  assert.doesNotMatch(t, /bolle|bolla/i);
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
  Object.assign(registrazione, { cercato: null, legamiCreati: [], stato: 'approvato', sql: [] });
  try {
    // "distributori" nel corpo non conta più: il legame è sempre quello predefinito
    let r = await chiedi('/registrati', form({ ...iscrizione, distributori: '99' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/benvenuto');
    assert.equal(registrazione.cercato, 'BOREA SRL');
    assert.deepEqual(registrazione.legamiCreati, [[utente.id, 2], [utente.id, 181]]);

    // approvazione automatica: legami già approvati su tutte le filiali, anagrafica attiva, nessuna notifica da confermare
    const legami = registrazione.sql.filter((q) => /INSERT INTO client_distributors/.test(q.s));
    assert.equal(legami.length, 2);
    for (const q of legami) assert.match(q.s, /VALUES \(\?, \?, 'approvato', NOW\(\)\)/);
    const nuovoUtente = registrazione.sql.find((q) => /INSERT INTO users/.test(q.s));
    assert.ok(nuovoUtente.p.includes('attivo') && !nuovoUtente.p.includes('in_attesa'), 'anagrafica attiva');
    assert.equal(registrazione.sql.filter((q) => /INSERT INTO notifications/.test(q.s)).length, 0, 'niente notifiche');

    r = await chiedi('/benvenuto');
    assert.equal(r.status, 200);
    let t = await r.text();
    assert.match(t, /Benvenuto in Flash Delivery/);
    assert.match(t, /L’anagrafica di <strong>Prova S\.r\.l\.<\/strong> è pronta\./);
    assert.match(t, /Il tuo distributore<\/div>\s*<div class="ben-nome">BOREA SRL</);
    assert.doesNotMatch(t, /confermerà a breve/); // già approvato
    assert.match(t, /<a class="acc-btn" href="\/home">Vai al catalogo<\/a>/);
    assert.match(t, /<a class="ben-link" href="\/profilo">Vedi la mia anagrafica<\/a>/);
    assert.doesNotMatch(t, /class="navbar"|class="appbar"/);

    // APPROVAZIONE_AUTOMATICA=0: si torna alla conferma a mano (legame in attesa, notifica al cliente, riga "confermerà a breve")
    process.env.APPROVAZIONE_AUTOMATICA = '0';
    Object.assign(registrazione, { legamiCreati: [], stato: 'in_attesa', sql: [] });
    await chiedi('/logout', { method: 'POST' });
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    for (const q of registrazione.sql.filter((x) => /INSERT INTO client_distributors/.test(x.s))) {
      assert.match(q.s, /'in_attesa'\)/);
      assert.doesNotMatch(q.s, /approvato/);
    }
    assert.ok(registrazione.sql.find((q) => /INSERT INTO users/.test(q.s)).p.includes('in_attesa'));
    assert.ok(registrazione.sql.some((q) => /INSERT INTO notifications/.test(q.s)), 'notifica "iscrizione inviata"');
    t = await (await chiedi('/benvenuto')).text();
    assert.match(t, /BOREA SRL confermerà a breve che sei suo cliente\./);
    delete process.env.APPROVAZIONE_AUTOMATICA;
    registrazione.stato = 'approvato';

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
    assert.match(t, /Benvenuto in Flash Delivery/);
    assert.doesNotMatch(t, /Il tuo distributore/);
  } finally {
    delete process.env.DISTRIBUTORE_PREDEFINITO;
    delete process.env.APPROVAZIONE_AUTOMATICA;
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
