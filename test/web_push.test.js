// Notifiche push del sito e della web app (src/web_push.js): iscrizioni, invio, pulizia e cifratura. DB finto e servizio push finto: nessuna rete,
// nessun database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const webpush = require('web-push');
const ece = require('http_ece');

// ---------------- DB finto ----------------
const scritture = [];
const letture = [];
let righeIscrizioni = [];
let erroreDb = null; // se impostato, le query di iscrizioni_push lo lanciano
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      all: async (...p) => {
        letture.push({ s, p });
        if (/FROM iscrizioni_push/.test(s)) {
          if (erroreDb) throw erroreDb;
          return righeIscrizioni;
        }
        return [];
      },
      get: async () => null,
      run: async (...p) => {
        scritture.push({ s, p });
        if (/iscrizioni_push/.test(s) && erroreDb) throw erroreDb;
        return { changes: 1, lastInsertRowid: /^INSERT INTO notifications/.test(s) ? 77 : null };
      },
    };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

// Le prove non dipendono dal .env vero: le variabili si impostano a mano e si tolgono alla fine.
const CHIAVI = webpush.generateVAPIDKeys();
const ALTRE_CHIAVI = webpush.generateVAPIDKeys();
const VARIABILI = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'APP_URL', 'PUSH_ATTIVO'];
const salvate = Object.fromEntries(VARIABILI.map((v) => [v, process.env[v]]));
function configura(valori = {}) {
  for (const v of VARIABILI) delete process.env[v];
  Object.assign(process.env, { VAPID_PUBLIC_KEY: CHIAVI.publicKey, VAPID_PRIVATE_KEY: CHIAVI.privateKey, VAPID_SUBJECT: 'mailto:prova@example.com' }, valori);
  for (const v of VARIABILI) if (process.env[v] === undefined || valori[v] === null) delete process.env[v];
}
test.after(() => {
  for (const v of VARIABILI) {
    if (salvate[v] === undefined) delete process.env[v];
    else process.env[v] = salvate[v];
  }
});

const webPush = require('../src/web_push');
const notifiche = require('../src/notifiche');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
// Una iscrizione come la manderebbe un browser: chiavi vere (P-256 + 16 byte di auth), così si può anche decifrare ciò che il server cifra.
function nuovaIscrizione(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { endpoint, keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) } } };
}
const ripulisci = () => { scritture.length = 0; letture.length = 0; righeIscrizioni = []; erroreDb = null; };
const riga = (id, endpoint = 'https://fcm.googleapis.com/fcm/send/riga' + id) => ({ id, endpoint, p256dh: nuovaIscrizione().sub.keys.p256dh, auth: nuovaIscrizione().sub.keys.auth });
const attendi = async (condizione, tentativi = 50) => {
  for (let i = 0; i < tentativi && !condizione(); i++) await new Promise((r) => setTimeout(r, 5));
};

// ---------------- configurazione ----------------

test('configurazione: accese solo con chiavi VAPID valide e un contatto (VAPID_SUBJECT, o APP_URL se https)', () => {
  configura();
  assert.equal(webPush.attivo(), true);
  assert.equal(webPush.chiavePubblica(), CHIAVI.publicKey);
  assert.match(webPush.descriviConfigurazione(), /accese.*anche ad app chiusa/);

  configura({ VAPID_SUBJECT: null, APP_URL: 'https://minuteria.example' });
  assert.equal(webPush.attivo(), true, 'il contatto può essere l\'indirizzo del sito, se è https');
  assert.equal(webPush.configurazione().soggetto, 'https://minuteria.example');

  for (const [nome, valori, mancante] of [
    ['senza chiavi', { VAPID_PUBLIC_KEY: null, VAPID_PRIVATE_KEY: null }, /VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY/],
    ['chiave pubblica rovinata', { VAPID_PUBLIC_KEY: 'abc' }, /chiavi VAPID valide/],
    ['chiave privata rovinata', { VAPID_PRIVATE_KEY: 'x'.repeat(10) }, /chiavi VAPID valide/],
    ['senza contatto', { VAPID_SUBJECT: null }, /VAPID_SUBJECT/],
    ['contatto http', { VAPID_SUBJECT: 'http://minuteria.example' }, /VAPID_SUBJECT valido/],
    ['APP_URL non https come contatto', { VAPID_SUBJECT: null, APP_URL: 'http://localhost:3000' }, /VAPID_SUBJECT/],
  ]) {
    configura(valori);
    assert.equal(webPush.attivo(), false, nome);
    assert.equal(webPush.chiavePubblica(), '', nome + ': nessuna chiave alle pagine');
    assert.match(webPush.descriviConfigurazione(), mancante, nome);
  }
  configura({ PUSH_ATTIVO: '0' });
  assert.equal(webPush.attivo(), false, 'PUSH_ATTIVO=0 spegne tutto');
  assert.match(webPush.descriviConfigurazione(), /PUSH_ATTIVO=0/);
});

// ---------------- iscrizione ----------------

test('validaIscrizione: solo i servizi push veri, in https sulla porta 443, con chiavi della forma giusta', () => {
  const { sub } = nuovaIscrizione();
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QGxyz',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ]) {
    const ok = webPush.validaIscrizione({ ...sub, endpoint });
    assert.ok(ok, endpoint);
    assert.equal(ok.endpoint, endpoint);
    assert.equal(ok.p256dh, sub.keys.p256dh);
  }
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc', // niente http
    'https://fcm.googleapis.com:8443/fcm/send/abc', // niente altre porte
    'https://utente:password@fcm.googleapis.com/fcm/send/abc', // niente credenziali nell'indirizzo
    'https://fcm.googleapis.com.sito-cattivo.example/fcm/send/abc', // l'host finisce con un dominio altrui
    'https://sito-cattivo.example/fcm/googleapis.com',
    'https://notgoogleapis.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'javascript:alert(1)',
    'fcm.googleapis.com/fcm/send/abc',
    '',
    'https://fcm.googleapis.com/' + 'a'.repeat(1600),
  ]) {
    assert.equal(webPush.validaIscrizione({ ...sub, endpoint }), null, endpoint.slice(0, 60));
  }
  for (const cattivo of [null, undefined, 'x', 5, [], {}, { endpoint: sub.endpoint }, { endpoint: sub.endpoint, keys: {} },
    { endpoint: sub.endpoint, keys: { p256dh: 'corta', auth: sub.keys.auth } },
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: 'a' } },
    { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh + '!!', auth: sub.keys.auth } },
    { endpoint: sub.endpoint, keys: { p256dh: 5, auth: sub.keys.auth } },
    { endpoint: 12, keys: sub.keys }]) {
    assert.equal(webPush.validaIscrizione(cattivo), null, JSON.stringify(cattivo));
  }
});

test('registra: salva (o aggiorna) l\'iscrizione con la chiave del server e toglie le più vecchie oltre le dieci', async () => {
  configura();
  ripulisci();
  const { sub } = nuovaIscrizione();
  const esito = await webPush.registra(5, sub, { userAgent: 'Safari/iPhone ' + 'x'.repeat(400) });
  assert.deepEqual(esito, { ok: true, endpoint: sub.endpoint });
  assert.equal(scritture.length, 2);
  assert.match(scritture[0].s, /^INSERT INTO iscrizioni_push \(user_id, endpoint, p256dh, auth, chiave, user_agent\) VALUES \(\?, \?, \?, \?, \?, \?\) ON CONFLICT \(endpoint\) DO UPDATE SET user_id = EXCLUDED\.user_id/);
  assert.deepEqual(scritture[0].p.slice(0, 5), [5, sub.endpoint, sub.keys.p256dh, sub.keys.auth, CHIAVI.publicKey]);
  assert.equal(scritture[0].p[5].length, 300, 'lo user agent è tagliato');
  assert.match(scritture[1].s, /^DELETE FROM iscrizioni_push WHERE user_id = \? AND id NOT IN \(SELECT id FROM iscrizioni_push WHERE user_id = \? ORDER BY aggiornato_il DESC, id DESC LIMIT 10\)$/);
  assert.deepEqual(scritture[1].p, [5, 5]);
});

test('registra: iscrizione non valida o push spente = niente scritture; tabella mancante = "tabella" (e un solo avviso nel log)', async () => {
  configura();
  ripulisci();
  assert.deepEqual(await webPush.registra(5, { endpoint: 'https://sito-cattivo.example/x', keys: nuovaIscrizione().sub.keys }), { ok: false, motivo: 'non_valida' });
  assert.deepEqual(await webPush.registra(5, null), { ok: false, motivo: 'non_valida' });
  configura({ PUSH_ATTIVO: '0' });
  assert.deepEqual(await webPush.registra(5, nuovaIscrizione().sub), { ok: false, motivo: 'spente' });
  assert.equal(scritture.length, 0);

  configura();
  erroreDb = Object.assign(new Error('relation "iscrizioni_push" does not exist'), { code: '42P01' });
  const avvisi = [];
  const originale = console.warn;
  console.warn = (...a) => avvisi.push(a.join(' '));
  try {
    assert.deepEqual(await webPush.registra(5, nuovaIscrizione().sub), { ok: false, motivo: 'tabella' });
    assert.deepEqual(await webPush.registra(5, nuovaIscrizione().sub), { ok: false, motivo: 'tabella' });
  } finally {
    console.warn = originale;
  }
  assert.equal(avvisi.length, 1, 'l\'avviso nel log è uno solo');
  assert.match(avvisi[0], /applica il blocco "Notifiche push del sito e della web app"/);
  // un guasto vero del DB invece risale a chi chiama (la rotta risponde 500)
  erroreDb = new Error('connessione caduta');
  await assert.rejects(webPush.registra(5, nuovaIscrizione().sub), /connessione caduta/);
});

test('rimuovi e rimuoviUtente: cancellano per endpoint (con l\'utente, se c\'è) o per utente', async () => {
  ripulisci();
  await webPush.rimuovi('https://fcm.googleapis.com/x', 5);
  await webPush.rimuovi('https://fcm.googleapis.com/y');
  await webPush.rimuoviUtente(5);
  assert.deepEqual(scritture.map((w) => [w.s, w.p]), [
    ['DELETE FROM iscrizioni_push WHERE endpoint = ? AND user_id = ?', ['https://fcm.googleapis.com/x', 5]],
    ['DELETE FROM iscrizioni_push WHERE endpoint = ?', ['https://fcm.googleapis.com/y']],
    ['DELETE FROM iscrizioni_push WHERE user_id = ?', [5]],
  ]);
});

// ---------------- invio ----------------

test('inviaAUtente: legge solo le iscrizioni nate con la chiave di questo server e manda a ognuna il messaggio, con TTL, urgenza e firma VAPID', async () => {
  configura();
  ripulisci();
  righeIscrizioni = [riga(1), riga(2)];
  const inviati = [];
  webPush.impostaInvio(async (iscrizione, payload, opzioni) => { inviati.push({ iscrizione, payload, opzioni }); });
  const n = await webPush.inviaAUtente(9, { titolo: 'Richiesta confermata', testo: 'Borea\n ha   confermato', link: '/richieste/12?x=1', id: 55, tipo: 'richiesta_confermata' });
  assert.equal(n, 2);
  assert.match(letture[0].s, /^SELECT id, endpoint, p256dh, auth FROM iscrizioni_push WHERE user_id = \? AND chiave = \?$/);
  assert.deepEqual(letture[0].p, [9, CHIAVI.publicKey], 'le iscrizioni di un\'altra coppia di chiavi (altro ambiente) non si toccano');
  assert.equal(inviati.length, 2);
  assert.deepEqual(inviati.map((i) => i.iscrizione.endpoint), ['https://fcm.googleapis.com/fcm/send/riga1', 'https://fcm.googleapis.com/fcm/send/riga2']);
  assert.deepEqual(Object.keys(inviati[0].iscrizione.keys).sort(), ['auth', 'p256dh']);
  assert.deepEqual(JSON.parse(inviati[0].payload), {
    titolo: 'Richiesta confermata', testo: 'Borea ha confermato', link: '/richieste/12?x=1', tag: 'minuteria-55', id: 55, tipo: 'richiesta_confermata',
  });
  assert.equal(inviati[0].opzioni.TTL, 1800);
  assert.equal(inviati[0].opzioni.urgency, 'high', 'urgenza alta: il telefono in risparmio energetico la consegna subito');
  assert.equal(inviati[0].opzioni.timeout, 8000);
  assert.deepEqual(inviati[0].opzioni.vapidDetails, { subject: 'mailto:prova@example.com', publicKey: CHIAVI.publicKey, privateKey: CHIAVI.privateKey });
});

test('inviaAUtente: testo troppo lungo tagliato, link che non è un percorso del sito scartato, niente id = niente tag', async () => {
  configura();
  righeIscrizioni = [riga(1)];
  const inviati = [];
  webPush.impostaInvio(async (iscrizione, payload) => { inviati.push(JSON.parse(payload)); });
  await webPush.inviaAUtente(9, { titolo: 'T'.repeat(200), testo: 'x'.repeat(500), link: 'https://sito-cattivo.example/' });
  await webPush.inviaAUtente(9, { titolo: 'a', testo: 'b', link: '//sito-cattivo.example/x' });
  await webPush.inviaAUtente(9, { titolo: 'a', testo: 'b', link: 'javascript:alert(1)' });
  await webPush.inviaAUtente(9, { titolo: '', testo: 'b', link: null });
  assert.equal(inviati[0].titolo.length, 80);
  assert.equal(inviati[0].testo.length, 220);
  assert.equal(inviati[0].link, null);
  assert.equal(inviati[0].tag, null);
  assert.equal(inviati[1].link, null);
  assert.equal(inviati[2].link, null);
  assert.equal(inviati[3].titolo, 'Minuteria', 'senza titolo ce n\'è uno');
});

test('inviaAUtente: 404/410 dal servizio push = iscrizione morta, si cancella; altri errori no; una consegna fallita non ferma le altre; non lancia mai', async () => {
  configura();
  ripulisci();
  righeIscrizioni = [riga(1), riga(2), riga(3), riga(4)];
  const errori = [];
  const originale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  const errore = (statusCode) => Object.assign(new Error('Received unexpected response code'), { statusCode });
  const esiti = { riga1: null, riga2: errore(410), riga3: errore(500), riga4: errore(404) };
  webPush.impostaInvio(async (iscrizione) => {
    const e = esiti[iscrizione.endpoint.split('/').pop()];
    if (e) throw e;
  });
  try {
    const n = await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' });
    assert.equal(n, 1, 'una sola consegna accettata');
  } finally {
    console.error = originale;
  }
  const cancellate = scritture.filter((w) => /^DELETE FROM iscrizioni_push WHERE endpoint = \?$/.test(w.s)).map((w) => w.p[0]).sort();
  assert.deepEqual(cancellate, ['https://fcm.googleapis.com/fcm/send/riga2', 'https://fcm.googleapis.com/fcm/send/riga4'], '410 e 404 sì, 500 no');
  assert.equal(errori.length, 1, 'il 500 si scrive nel log, una volta');
  assert.match(errori[0], /\(500\) verso fcm\.googleapis\.com/);
  assert.ok(!errori[0].includes('riga3'), 'il log non riporta l\'indirizzo completo (contiene il segreto dell\'iscrizione)');

  // guasti del DB e dell'invio: mai un'eccezione verso chi ha generato la notifica
  console.error = () => {};
  try {
    erroreDb = new Error('db giù');
    assert.equal(await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' }), 0);
    erroreDb = Object.assign(new Error('manca la tabella'), { code: '42P01' });
    assert.equal(await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' }), 0);
  } finally {
    console.error = originale;
    erroreDb = null;
  }
});

test('inviaAUtente: spento (PUSH_ATTIVO=0, senza chiavi, senza utente) non legge nemmeno il DB', async () => {
  ripulisci();
  righeIscrizioni = [riga(1)];
  let chiamate = 0;
  webPush.impostaInvio(async () => { chiamate++; });
  configura({ PUSH_ATTIVO: '0' });
  assert.equal(await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' }), 0);
  configura({ VAPID_PUBLIC_KEY: null });
  assert.equal(await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' }), 0);
  configura();
  assert.equal(await webPush.inviaAUtente(0, { titolo: 'x', testo: 'y' }), 0);
  assert.equal(letture.length, 0);
  assert.equal(chiamate, 0);
  // nessuna iscrizione = nessun invio
  righeIscrizioni = [];
  assert.equal(await webPush.inviaAUtente(9, { titolo: 'x', testo: 'y' }), 0);
  assert.equal(chiamate, 0);
});

test('inviaProva: una notifica di prova col suo tag, senza id (non è una notifica del sito)', async () => {
  configura();
  righeIscrizioni = [riga(1)];
  const inviati = [];
  webPush.impostaInvio(async (iscrizione, payload) => { inviati.push(JSON.parse(payload)); });
  assert.equal(await webPush.inviaProva(9), 1);
  assert.equal(inviati[0].titolo, 'Notifica di prova');
  assert.equal(inviati[0].tag, 'minuteria-prova');
  assert.equal(inviati[0].id, null);
  assert.equal(inviati[0].link, '/');
});

// ---------------- cifratura e firma vere ----------------

test('il messaggio che parte è cifrato per quel browser (aes128gcm) e firmato con la chiave VAPID del sito: lo si decifra e si verifica la firma', () => {
  configura();
  const { ecdh, auth, sub } = nuovaIscrizione();
  const payload = JSON.stringify({ titolo: 'Città: più caffè', testo: 'Ordine #12 è in arrivo', link: '/ordini/12', tag: 'minuteria-12' });
  const dettagli = webpush.generateRequestDetails(sub, payload, {
    TTL: 1800, urgency: 'high', vapidDetails: { subject: 'mailto:prova@example.com', publicKey: CHIAVI.publicKey, privateKey: CHIAVI.privateKey },
  });
  assert.equal(dettagli.method, 'POST');
  assert.equal(dettagli.endpoint, sub.endpoint);
  assert.equal(dettagli.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(dettagli.headers.TTL, 1800);
  assert.equal(dettagli.headers.Urgency, 'high');
  // 1. il contenuto: lo decifra solo chi ha la chiave privata del browser
  const chiaro = ece.decrypt(dettagli.body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth });
  assert.equal(chiaro.toString('utf8'), payload);
  assert.ok(!dettagli.body.toString('utf8').includes('caffè'), 'sul filo non c\'è testo in chiaro');
  // 2. la firma VAPID: "vapid t=<JWT>, k=<chiave pubblica>"
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(dettagli.headers.Authorization);
  assert.ok(m, dettagli.headers.Authorization);
  assert.equal(m[4], CHIAVI.publicKey);
  const intestazione = JSON.parse(Buffer.from(m[1], 'base64url').toString());
  const rivendicazioni = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(intestazione.alg, 'ES256');
  assert.equal(rivendicazioni.aud, 'https://fcm.googleapis.com', 'il pubblico è l\'origine del servizio push');
  assert.equal(rivendicazioni.sub, 'mailto:prova@example.com');
  assert.ok(rivendicazioni.exp > Date.now() / 1000 && rivendicazioni.exp <= Date.now() / 1000 + 24 * 3600, 'scade entro 24 ore');
  const punto = Buffer.from(CHIAVI.publicKey, 'base64url');
  const chiavePubblica = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(punto.subarray(1, 33)), y: b64url(punto.subarray(33, 65)) }, format: 'jwk' });
  const valida = crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: chiavePubblica, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.equal(valida, true, 'la firma si verifica con la chiave pubblica del sito');
  // un'altra chiave non la verifica
  const altro = Buffer.from(ALTRE_CHIAVI.publicKey, 'base64url');
  const chiaveAltrui = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(altro.subarray(1, 33)), y: b64url(altro.subarray(33, 65)) }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: chiaveAltrui, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), false);
});

test('il payload di una notifica vera sta ampiamente nel limite dei servizi push (4 KB) anche col testo più lungo consentito', () => {
  const payload = JSON.stringify({ titolo: 'T'.repeat(80), testo: 'x'.repeat(220), link: '/' + 'a'.repeat(299), tag: 'minuteria-2147483647', id: 2147483647, tipo: 'nessun_corriere' });
  assert.ok(Buffer.byteLength(payload) < 1000, String(Buffer.byteLength(payload)));
});

// ---------------- notifiche::notifica manda anche la push ----------------

test('notifica(): crea la riga e manda la push col tag "minuteria-<id>"; consegnata, la segna come già mostrata (tranne al banco)', async () => {
  configura();
  ripulisci();
  righeIscrizioni = [riga(1)];
  const inviati = [];
  webPush.impostaInvio(async (iscrizione, payload) => { inviati.push(JSON.parse(payload)); });
  await notifiche.notifica(9, { titolo: 'Ordine confermato', testo: 'In arrivo', link: '/ordini/3', categoria: 'ordini', tipo: 'corriere_trovato', order_id: 3 });
  await attendi(() => scritture.some((w) => /^UPDATE notifications SET notificata = 1/.test(w.s)));
  assert.match(scritture[0].s, /^INSERT INTO notifications/);
  assert.equal(inviati.length, 1);
  assert.deepEqual([inviati[0].titolo, inviati[0].tag, inviati[0].id, inviati[0].tipo, inviati[0].link], ['Ordine confermato', 'minuteria-77', 77, 'corriere_trovato', '/ordini/3']);
  const segna = scritture.find((w) => /^UPDATE notifications SET notificata = 1/.test(w.s));
  assert.ok(segna, 'la notifica consegnata come push non deve arrivare una seconda volta dal controllo della pagina');
  assert.deepEqual(segna.p, [77, 9, 9]);
  assert.match(segna.s, /NOT EXISTS \(SELECT 1 FROM users WHERE id = \? AND ruolo = 'distributore'\)/, 'al banco no: le sue pagine usano quella lettura per avvisi e suoni');
});

test('notifica(): se la push non viene consegnata la notifica resta da mostrare (il controllo della pagina aperta fa da rete di sicurezza); un guasto non la rompe', async () => {
  configura();
  ripulisci();
  righeIscrizioni = [riga(1)];
  const originale = console.error;
  console.error = () => {};
  webPush.impostaInvio(async () => { throw Object.assign(new Error('x'), { statusCode: 503 }); });
  try {
    await notifiche.notifica(9, { titolo: 'a', testo: 'b' });
    await attendi(() => letture.length > 0);
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    console.error = originale;
  }
  assert.ok(!scritture.some((w) => /^UPDATE notifications SET notificata/.test(w.s)));
  // senza iscrizioni (o con le push spente) la notifica nasce e basta
  ripulisci();
  configura({ PUSH_ATTIVO: '0' });
  await notifiche.notifica(9, { titolo: 'a', testo: 'b' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(scritture.map((w) => w.s.split(' ').slice(0, 3).join(' ')), ['INSERT INTO notifications']);
  assert.equal(letture.filter((l) => /iscrizioni_push/.test(l.s)).length, 0);
});
