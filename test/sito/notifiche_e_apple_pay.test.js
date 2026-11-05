// File di verifica di Apple Pay e notifiche ad app chiusa.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const aiuti = require('./_aiuti/server_finto');
const { leggiComposto } = require('../../src/comune/asset_composti');

aiuti.avvia(38486);
const {
  banco, biscotti, chiaviVapidProva, chiedi, erroriServer, form, iscrizioniPush, json, radice,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

test('Apple Pay: il file di verifica del dominio sta a /.well-known/..., in testo, senza sessione né reindirizzamenti (404 se non è stato scaricato)', async () => {
  const fs = require('fs');
  const file = path.join(radice, 'public', '.well-known', 'apple-developer-merchantid-domain-association');
  const prima = biscotti.cookie;
  biscotti.cookie = '';
  try {
    const r = await chiedi('/.well-known/apple-developer-merchantid-domain-association', { redirect: 'manual' });
    assert.equal(r.headers.get('set-cookie'), null, 'prima della sessione: nessun cookie');
    if (fs.existsSync(file)) {
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^text\/plain/);
      assert.equal(await r.text(), fs.readFileSync(file, 'utf8'));
    } else {
      assert.equal(r.status, 404);
    }
  } finally {
    biscotti.cookie = prima;
  }
});

// ---------------- Notifiche ad app chiusa: rotte /api/push/... (src/logica/notifiche/web_push.js) ----------------

test('notifiche ad app chiusa: le pagine portano la chiave del sito e l\'iscrizione già nota; senza accesso o con le push spente niente', async () => {
  const webPush = require(path.join(radice, 'src/logica/notifiche/web_push'));
  const crypto = require('crypto');
  const nuova = (endpoint) => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  };
  const sub = nuova('https://fcm.googleapis.com/fcm/send/prova-1');
  const metaChiave = new RegExp('<meta name="push-chiave" content="' + chiaviVapidProva.publicKey + '"><meta name="push-endpoint" content="([^"]*)">');
  iscrizioniPush.length = 0;

  // la pagina di accesso (nessuno è entrato) non porta niente
  biscotti.cookie = '';
  assert.doesNotMatch(await (await chiedi('/login')).text(), /name="push-chiave"/);
  // senza accesso le rotte rispondono 401, non fanno niente
  for (const rotta of ['/api/push/iscrivi', '/api/push/disiscrivi', '/api/push/prova']) assert.equal((await chiedi(rotta, json({ subscription: sub }))).status, 401, rotta);
  assert.equal(iscrizioniPush.length, 0);

  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  // entrato: la chiave c'è, l'iscrizione nota è vuota (primo accesso)
  let t = await (await chiedi('/home')).text();
  assert.equal((metaChiave.exec(t) || [])[1], '', 'il server non ha ancora l\'iscrizione di questa sessione: il browser la manda');

  // iscrizione non valida (indirizzo che non è di un servizio push), vuota o con le chiavi rovinate: 400, niente salvato
  for (const cattiva of [{ ...sub, endpoint: 'https://sito-cattivo.example/x' }, { ...sub, endpoint: 'http://fcm.googleapis.com/x' }, { endpoint: sub.endpoint, keys: { p256dh: 'x', auth: 'y' } }, null]) {
    const r = await chiedi('/api/push/iscrivi', json({ subscription: cattiva }));
    assert.equal(r.status, 400, JSON.stringify(cattiva));
    assert.equal((await r.json()).ok, false);
  }
  assert.equal((await chiedi('/api/push/iscrivi', json({}))).status, 400);
  assert.equal(iscrizioniPush.length, 0);

  // iscrizione buona: salvata per l'utente con la chiave del sito e ricordata in sessione
  let r = await chiedi('/api/push/iscrivi', { ...json({ subscription: sub }), headers: { 'content-type': 'application/json', 'user-agent': 'Safari iPhone prova' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(iscrizioniPush.length, 1);
  assert.deepEqual([iscrizioniPush[0].user_id, iscrizioniPush[0].endpoint, iscrizioniPush[0].chiave, iscrizioniPush[0].user_agent],
    [1, sub.endpoint, chiaviVapidProva.publicKey, 'Safari iPhone prova']);
  t = await (await chiedi('/home')).text();
  assert.equal((metaChiave.exec(t) || [])[1], sub.endpoint, 'da ora la pagina sa che il server ha questo browser: non lo rimanda a ogni pagina');
  // rimandarla (stesso browser) aggiorna la riga, non ne crea un'altra
  assert.equal((await chiedi('/api/push/iscrivi', json({ subscription: sub }))).status, 200);
  assert.equal(iscrizioniPush.length, 1);

  // notifica di prova: dal server, subito (dopoSec assente) o fra un po'; al massimo una ogni 10 secondi
  const consegne = [];
  webPush.impostaInvio(async (iscrizione, payload) => { consegne.push({ endpoint: iscrizione.endpoint, payload: JSON.parse(payload) }); });
  r = await chiedi('/api/push/prova', json({}));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, inviate: 1 });
  assert.equal(consegne.length, 1);
  assert.equal(consegne[0].endpoint, sub.endpoint);
  assert.equal(consegne[0].payload.tag, 'minuteria-prova');
  r = await chiedi('/api/push/prova', json({ dopoSec: 10 }));
  assert.equal(r.status, 429, 'troppo presto');
  assert.equal(consegne.length, 1);

  // disiscrizione: toglie la riga di questo utente per quell'indirizzo (un indirizzo altrui non lo tocca)
  iscrizioniPush.push({ id: 99, user_id: 5, endpoint: 'https://fcm.googleapis.com/fcm/send/altrui', p256dh: 'a', auth: 'b', chiave: chiaviVapidProva.publicKey, user_agent: '' });
  assert.deepEqual(await (await chiedi('/api/push/disiscrivi', json({ endpoint: 'https://fcm.googleapis.com/fcm/send/altrui' }))).json(), { ok: true });
  assert.equal(iscrizioniPush.length, 2, 'l\'iscrizione di un altro utente resta');
  assert.deepEqual(await (await chiedi('/api/push/disiscrivi', json({ endpoint: sub.endpoint }))).json(), { ok: true });
  assert.deepEqual(iscrizioniPush.map((x) => x.user_id), [5]);
  t = await (await chiedi('/home')).text();
  assert.equal((metaChiave.exec(t) || [])[1], '', 'dopo la disiscrizione la sessione non ricorda più l\'iscrizione');

  // uscita: il browser non riceve più le notifiche di questo account
  await chiedi('/api/push/iscrivi', json({ subscription: sub }));
  assert.equal(iscrizioniPush.length, 2);
  assert.equal((await chiedi('/logout', { method: 'POST' })).status, 302);
  assert.deepEqual(iscrizioniPush.map((x) => x.user_id), [5], 'l\'iscrizione di questo browser è stata tolta all\'uscita');

  // push spente sul server (PUSH_ATTIVO=0): le pagine non portano la chiave, le rotte rispondono 503 e non salvano niente
  process.env.PUSH_ATTIVO = '0';
  try {
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    assert.doesNotMatch(await (await chiedi('/home')).text(), /name="push-chiave"/);
    r = await chiedi('/api/push/iscrivi', json({ subscription: nuova('https://fcm.googleapis.com/fcm/send/spente') }));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).ok, false);
    assert.deepEqual(iscrizioniPush.map((x) => x.user_id), [5]);
  } finally {
    process.env.PUSH_ATTIVO = '';
    iscrizioniPush.length = 0;
    await chiedi('/logout', { method: 'POST' });
    biscotti.cookie = '';
  }
});

test('notifiche ad app chiusa: la notifica di prova senza dispositivi iscritti dice di attivare prima le notifiche (409), e il banco ha le stesse rotte', async () => {
  iscrizioniPush.length = 0;
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    // il banco non ha un'iscrizione: la prova non parte
    let r = await chiedi('/api/push/prova', json({}));
    assert.equal(r.status, 409);
    assert.match((await r.json()).errore, /attiva prima le notifiche/);
    // e può iscriversi come gli altri ruoli (nell'Anagrafica del banco, "Notifiche del computer")
    const ecdh = require('crypto').createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/banco-1', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: require('crypto').randomBytes(16).toString('base64url') } };
    assert.equal((await chiedi('/api/push/iscrivi', json({ subscription: sub }))).status, 200);
    assert.deepEqual(iscrizioniPush.map((x) => x.user_id), [9]);
  } finally {
    banco.attivo = false;
    iscrizioniPush.length = 0;
    await chiedi('/logout', { method: 'POST' });
    biscotti.cookie = '';
  }
});

test('notifiche ad app chiusa: app.js e service worker contengono i pezzi che la rotta si aspetta (iscrizione, prova, disiscrizione, messaggi del service worker)', () => {
  const fs = require('fs');
  const js = leggiComposto('/app.js').testo;
  for (const pezzo of ["'/api/push/iscrivi'", "'/api/push/disiscrivi'", "'/api/push/prova'", 'userVisibleOnly: true', 'applicationServerKey', "'push-chiave'", "'push-endpoint'",
    "tipo === 'vai'", 'getNotifications', 'registrazioneSw(', "document.visibilityState === 'visible'", 'icona-distintivo-96.png']) {
    assert.ok(js.includes(pezzo), pezzo);
  }
  // Solo notifiche di sistema col suono del telefono (richiesta esplicita del 21/10/2026): il sito non fa NESSUN suono dentro la pagina dell'installatore (il "ding" è
  // stato tolto: niente audio, niente sblocco al primo tocco) e dal service worker non parte più il messaggio che lo faceva suonare. Il banco ha ancora il suo
  // (`public/suoni/avviso.mp3`, interruttore "Suoni" dell'Anagrafica), che è un'altra funzione.
  assert.doesNotMatch(js, /suonaAvviso|audioAvviso|alPrimoTocco/);
  assert.doesNotMatch(js, /tipo === 'push'/);
  // L'unico suono del sito è quello del banco, con la Web Audio API (un contesto solo, creato nel blocco "Avvisi del banco"): niente più <audio> riusato.
  assert.equal((js.match(/new Audio\(/g) || []).length, 0, 'nessun <audio> riusato');
  assert.equal((js.match(/new ContestoAudio\(\)/g) || []).length, 1, 'un solo contesto audio nel sito: quello del banco');
  const vista = fs.readFileSync(path.join(radice, 'views', 'partials/comune/app_head.ejs'), 'utf8');
  assert.match(vista, /name="push-chiave"/);
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
