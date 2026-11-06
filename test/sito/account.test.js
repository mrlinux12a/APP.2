// Account dell'installatore: password dimenticata, recupero, cambio password, eliminazione.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38485);
const {
  accountProva, bcrypt, biscotti, chiedi, erroriServer, form,
} = aiuti;

// ---------- Account dell'installatore: password dimenticata, cambio password, elimina account (richiesta del 20/10/2026) ----------

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

const erroriCampo = (t) => [...t.matchAll(/<p class="acc-hint"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

test('login: link "Password dimenticata?" e avvisi dopo il cambio password o l\'eliminazione (solo frasi nostre, mai testo dall\'indirizzo)', async () => {
  biscotti.cookie = '';
  let t = await (await chiedi('/login')).text();
  assert.match(t, /<p class="acc-dimenticata"><a href="\/password-dimenticata">Password dimenticata\?<\/a><\/p>/);
  assert.doesNotMatch(t, /acc-avviso/);
  t = await (await chiedi('/login?avviso=password')).text();
  assert.match(t, /<div class="acc-avviso" role="status">Password cambiata\. Accedi con quella nuova\.<\/div>/);
  t = await (await chiedi('/login?avviso=eliminato')).text();
  assert.match(t, /Account eliminato\. Grazie per aver usato Flash Delivery\./);
  t = await (await chiedi('/login?avviso=' + encodeURIComponent('<script>alert(1)</script>'))).text();
  assert.doesNotMatch(t, /acc-avviso|<script>alert/);
  // la pagina del recupero: senza accesso; con l'accesso si va alla home
  const r = await chiedi('/password-dimenticata');
  assert.equal(r.status, 200);
  t = await r.text();
  assert.match(t, /<h1 class="acc-titolo">Password dimenticata\?<\/h1>/);
  assert.match(t, /name="identificativo"/);
  assert.match(t, /<button class="acc-btn" type="submit">Mandami il link<\/button>/);
  assert.equal((await chiedi('/password-dimenticata', form({ identificativo: '' }))).status, 400);
});

test('recupero password: email con il link, scelta della nuova password, link usabile una volta sola; risposta uguale per account che c\'è e che non c\'è', async () => {
  biscotti.cookie = '';
  const limite = require('../../src/logica/account/limite_login');
  limite.svuotaTutto();
  const emailModulo2 = require('../../src/logica/notifiche/email');
  accountProva.link.length = 0;
  accountProva.scritture.length = 0;
  const spedite = [];
  emailModulo2.impostaTrasporto({ sendMail: async (o) => { spedite.push(o); } });
  try {
    // account che c'è (per email) e account che non c'è: la STESSA pagina, lo stesso stato
    let r = await chiedi('/password-dimenticata', form({ identificativo: 'PROVA@example.com' }));
    assert.equal(r.status, 200);
    const trovato = await r.text();
    r = await chiedi('/password-dimenticata', form({ identificativo: 'nessuno@example.com' }));
    assert.equal(r.status, 200);
    const nonTrovato = await r.text();
    const pulisci = (t) => t.replace(/\s+/g, ' ').replace(/value="[^"]*"/g, '');
    assert.equal(pulisci(trovato), pulisci(nonTrovato), 'chi chiede non può capire se l\'account esiste');
    assert.match(trovato, /Controlla la posta\./);
    assert.match(trovato, /Il link vale 60 minuti/);
    await attendi(60); // l'invio non si aspetta: parte dopo la risposta
    assert.equal(spedite.length, 1, 'una sola email, per l\'account che c\'è');
    assert.equal(spedite[0].to, 'prova@example.com');
    const m = /href="(http:\/\/127\.0\.0\.1:\d+\/reimposta-password\/([A-Za-z0-9_-]{43}))"/.exec(spedite[0].html);
    assert.ok(m, 'il link è nell\'email, sul nostro indirizzo (solo in locale: in produzione vale APP_URL)');
    const percorso = '/reimposta-password/' + m[2];

    // il link: modulo con il nome utente
    r = await chiedi(percorso);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    let t = await r.text();
    assert.match(t, /<h1 class="acc-titolo">Scegli una nuova password<\/h1>/);
    assert.match(t, /Account: <strong>prova<\/strong>/);
    assert.match(t, /name="nuova"/);
    assert.match(t, /<meta name="referrer" content="no-referrer">/);
    // campi che non vanno: 400, il link resta buono
    r = await chiedi(percorso, form({ nuova: 'corta', ripeti: 'corta' }));
    assert.equal(r.status, 400);
    assert.match(await r.text(), /La password deve avere almeno 8 caratteri\./);
    r = await chiedi(percorso, form({ nuova: 'nuovapassword1', ripeti: 'diversa1234567' }));
    assert.match(await r.text(), /Le due password non coincidono\./);
    assert.equal(accountProva.scritture.length, 0);
    // la password nuova: torna al login con l'avviso; chiude tutte le sessioni e gli accessi dell'app
    r = await chiedi(percorso, form({ nuova: 'nuovapassword1', ripeti: 'nuovapassword1' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login?avviso=password');
    const [hash, sessioni, app] = accountProva.scritture;
    assert.ok(bcrypt.compareSync('nuovapassword1', hash.p[0]));
    assert.equal(hash.p[1], 1);
    assert.deepEqual(sessioni.p, ['1', ''], 'tutte le sessioni di quell\'account');
    assert.match(app.s, /^UPDATE app_tokens SET revocato_il = NOW\(\)/);
    // lo stesso link non vale più (né per aprirlo né per usarlo)
    r = await chiedi(percorso);
    assert.equal(r.status, 410);
    t = await r.text();
    assert.match(t, /<h1 class="acc-titolo">Link non valido<\/h1>/);
    assert.match(t, /href="\/password-dimenticata"[^>]*>Chiedi un nuovo link<\/a>/);
    assert.equal((await chiedi(percorso, form({ nuova: 'altrapassword2', ripeti: 'altrapassword2' }))).status, 410);
    // un codice inventato o fatto male: stessa pagina, senza errori
    assert.equal((await chiedi('/reimposta-password/inventato')).status, 410);
    assert.equal((await chiedi('/reimposta-password/' + 'A'.repeat(43))).status, 410);

    // troppe richieste per lo stesso identificativo: 429, e conta anche se l'account non c'è
    limite.svuotaTutto();
    for (let i = 0; i < limite.MAX_RECUPERI_PER_COPPIA; i++) assert.equal((await chiedi('/password-dimenticata', form({ identificativo: 'spam@example.com' }))).status, 200);
    r = await chiedi('/password-dimenticata', form({ identificativo: 'spam@example.com' }));
    assert.equal(r.status, 429);
    assert.match(await r.text(), /troppe richieste/);
  } finally {
    emailModulo2.impostaTrasporto(null);
    limite.svuotaTutto();
  }
});

test('profilo: scheda "Accesso" e cambio password (errori sotto i campi, poi riesce); l\'attuale sbagliata conta nel limite del login', async () => {
  biscotti.cookie = '';
  const limite = require('../../src/logica/account/limite_login');
  limite.svuotaTutto();
  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  accountProva.scritture.length = 0;
  try {
    let t = await (await chiedi('/profilo')).text();
    assert.match(t, /<h2 class="an-titolo">Accesso<\/h2>/);
    assert.match(t, /<div class="an-etichetta">Nome utente<\/div>\s*<div class="an-valore">prova<\/div>/);
    assert.match(t, /<details class="an-pw">\s*<summary>Cambia password<\/summary>/);
    assert.doesNotMatch(t, /an-ok/);

    const cambia = (attuale, nuova, ripeti) => chiedi('/profilo/password', form({ attuale, nuova, ripeti }));
    let r = await cambia('sbagliata!', 'nuovapassword1', 'nuovapassword1');
    assert.equal(r.status, 400);
    t = await r.text();
    assert.deepEqual(erroriCampo(t).filter((x) => /password/.test(x)), ['La password attuale non è corretta.']);
    assert.match(t, /<details class="an-pw" open>/, 'con errori il modulo resta aperto');
    assert.doesNotMatch(t, /value="sbagliata!"/, 'le password non tornano mai nel modulo');
    r = await cambia('password-di-prova', 'corta', 'corta');
    assert.match(await r.text(), /La password deve avere almeno 8 caratteri\./);
    r = await cambia('password-di-prova', 'password-di-prova', 'password-di-prova');
    assert.match(await r.text(), /La nuova password deve essere diversa da quella attuale\./);
    assert.equal(accountProva.scritture.length, 0);

    r = await cambia('password-di-prova', 'nuovapassword1', 'nuovapassword1');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/profilo?ok=password#accesso');
    const [hash, sessioni, app] = accountProva.scritture;
    assert.ok(bcrypt.compareSync('nuovapassword1', hash.p[0]));
    assert.equal(sessioni.p[0], '1');
    assert.ok(sessioni.p[1].length > 10, 'la sessione corrente resta: ' + sessioni.p[1]);
    assert.match(app.s, /^UPDATE app_tokens SET revocato_il/);
    t = await (await chiedi('/profilo?ok=password')).text();
    assert.match(t, /<p class="an-ok" role="status">Password cambiata\. Le altre sessioni e l'app dovranno accedere di nuovo\.<\/p>/);

    // otto tentativi con l'attuale sbagliata: poi 429
    let ultimo;
    for (let i = 0; i < 9; i++) ultimo = await cambia('sbagliata' + i, 'nuovapassword1', 'nuovapassword1');
    assert.equal(ultimo.status, 429);
    assert.match(await ultimo.text(), /Troppi tentativi non riusciti/);
  } finally {
    limite.svuotaTutto();
  }
});

test('elimina account dal sito: spiega cosa si cancella e cosa resta, chiede la password, rifiuta se c\'è qualcosa in corso, poi disattiva e chiude la sessione', async () => {
  biscotti.cookie = '';
  const limite = require('../../src/logica/account/limite_login');
  limite.svuotaTutto();
  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  accountProva.scritture.length = 0;
  accountProva.corso = { richieste: 0, ordini: 0, pagamenti: 0 };
  try {
    // la scheda nel profilo porta alla pagina di conferma
    let t = await (await chiedi('/profilo')).text();
    assert.match(t, /<a class="an-elimina" href="\/profilo\/elimina">Elimina account…<\/a>/);

    let r = await chiedi('/profilo/elimina');
    assert.equal(r.status, 200);
    t = await r.text();
    assert.match(t, /<h1 class="an-titolo">Vuoi eliminare il tuo account\?<\/h1>/);
    assert.match(t, /Viene cancellato/);
    assert.match(t, /Resta, per obbligo di legge/);
    assert.match(t, /<form method="POST" action="\/profilo\/elimina"/);
    assert.match(t, /<button class="an-elimina-btn" type="submit">Elimina il mio account<\/button>/);

    // password sbagliata: errore sul campo, niente scritto
    r = await chiedi('/profilo/elimina', form({ password: 'sbagliata' }));
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Password non corretta\./);
    assert.equal(accountProva.scritture.length, 0);

    // qualcosa in corso: la pagina lo dice subito, il modulo non c'è, e anche un invio a mano viene respinto
    accountProva.corso = { richieste: 1, ordini: 1, pagamenti: 0 };
    t = await (await chiedi('/profilo/elimina')).text();
    assert.match(t, /Hai ancora qualcosa in corso\./);
    assert.match(t, /Una richiesta è in attesa di risposta\./);
    assert.match(t, /Un ordine non è ancora stato consegnato\./);
    assert.doesNotMatch(t, /an-elimina-btn|action="\/profilo\/elimina"/);
    r = await chiedi('/profilo/elimina', form({ password: 'password-di-prova' }));
    assert.equal(r.status, 409);
    assert.match(await r.text(), /Hai ancora qualcosa in corso./, 'la pagina rifà vedere il motivo, senza il modulo');
    assert.equal(accountProva.scritture.length, 0, 'niente è stato eliminato');

    // tutto finito: si elimina, si va al login con l'avviso e la sessione non vale più
    accountProva.corso = { richieste: 0, ordini: 0, pagamenti: 0 };
    r = await chiedi('/profilo/elimina', form({ password: 'password-di-prova' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login?avviso=eliminato');
    const disattivato = accountProva.scritture.find((w) => /^UPDATE users SET attivo = 0/.test(w.s));
    assert.ok(disattivato, 'account disattivato e anonimizzato (src/logica/account/account.js)');
    assert.equal(disattivato.p[0], 'eliminato-1');
    assert.ok(accountProva.scritture.some((w) => /^DELETE FROM app_tokens WHERE user_id/.test(w.s)), 'accessi dell\'app tolti');
    assert.ok(accountProva.scritture.some((w) => /^DELETE FROM session WHERE \(sess::jsonb/.test(w.s)), 'sessioni tolte');
    assert.match(await (await chiedi('/login?avviso=eliminato')).text(), /Account eliminato/);
    assert.equal((await chiedi('/home')).status, 302, 'la sessione di questa scheda è stata chiusa');
  } finally {
    accountProva.corso = { richieste: 0, ordini: 0, pagamenti: 0 };
    limite.svuotaTutto();
    biscotti.cookie = '';
  }
});

test('pagina pubblica "Elimina account": ora spiega anche il percorso dal sito', async () => {
  biscotti.cookie = '';
  const t = await (await chiedi('/elimina-account')).text();
  assert.match(t, /Dal sito/);
  assert.match(t, /Elimina account/);
  assert.match(t, /Lo stesso account vale per il sito e per l’app/);
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
