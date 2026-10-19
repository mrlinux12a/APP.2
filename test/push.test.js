// Prove di src/push.js (notifiche push dell'app Android) con un DB finto e un invio finto: nessuna rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const radice = path.join(__dirname, '..');

// DB finto: tiene i token in memoria e riconosce le sole istruzioni che push.js usa.
const righe = [];
let tabellaMancante = false;
const dbFinto = {
  prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();
    const controlla = () => {
      if (tabellaMancante) { const e = new Error('relation "dispositivi_push" does not exist'); e.code = '42P01'; throw e; }
    };
    return {
      async run(...p) {
        controlla();
        if (/^INSERT INTO dispositivi_push/.test(s)) {
          const [user_id, token, piattaforma] = p;
          const esiste = righe.find((r) => r.token === token);
          if (esiste) Object.assign(esiste, { user_id, piattaforma });
          else righe.push({ user_id, token, piattaforma });
        } else if (/^DELETE FROM dispositivi_push WHERE token = \? AND user_id = \?/.test(s)) {
          const i = righe.findIndex((r) => r.token === p[0] && r.user_id === p[1]);
          if (i >= 0) righe.splice(i, 1);
        } else if (/^DELETE FROM dispositivi_push WHERE token = \?/.test(s)) {
          const i = righe.findIndex((r) => r.token === p[0]);
          if (i >= 0) righe.splice(i, 1);
        } else if (/^DELETE FROM dispositivi_push WHERE user_id = \?/.test(s)) {
          for (let i = righe.length - 1; i >= 0; i--) if (righe[i].user_id === p[0]) righe.splice(i, 1);
        } else throw new Error('SQL non previsto: ' + s);
        return { changes: 1 };
      },
      async all(...p) {
        controlla();
        if (/^SELECT token FROM dispositivi_push WHERE user_id = \?/.test(s)) return righe.filter((r) => r.user_id === p[0]).map((r) => ({ token: r.token }));
        throw new Error('SQL non previsto: ' + s);
      },
    };
  },
};
require.cache[require.resolve(path.join(radice, 'db/index.js'))] = { id: 'db', filename: 'db', loaded: true, exports: dbFinto };
const push = require(path.join(radice, 'src/push'));

const T1 = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
const T2 = 'ExpoPushToken[ZYXWVUTSRQPONMLKJIHGFE]';

test.beforeEach(() => {
  righe.length = 0;
  tabellaMancante = false;
  delete process.env.PUSH_ATTIVO;
  delete process.env.EXPO_ACCESS_TOKEN;
});

test('registra: solo token Expo nella forma giusta, e lo stesso telefono passa all’ultimo utente', async () => {
  assert.equal(await push.registra(1, T1, 'android'), true);
  assert.equal(await push.registra(1, "x'; DROP TABLE users;--"), false);
  assert.equal(await push.registra(1, ''), false);
  assert.equal(await push.registra(1, null), false);
  assert.equal(await push.registra(1, 'ExponentPushToken[corto]'), false);
  assert.equal(righe.length, 1);
  assert.equal(await push.registra(2, T1, 'android'), true);
  assert.equal(righe.length, 1, 'un token è di un telefono solo');
  assert.equal(righe[0].user_id, 2);
});

test('rimuovi: per token (solo del proprietario) e per utente', async () => {
  await push.registra(1, T1);
  await push.registra(1, T2);
  await push.rimuovi(T1, 99); // un altro utente non toglie il mio telefono
  assert.equal(righe.length, 2);
  await push.rimuovi(T1, 1);
  assert.equal(righe.length, 1);
  await push.rimuoviUtente(1);
  assert.equal(righe.length, 0);
});

test('inviaAUtente: manda ogni notifica a ogni telefono dell’utente, in forma corta, senza lanciare mai', async () => {
  await push.registra(1, T1);
  await push.registra(1, T2);
  await push.registra(2, 'ExponentPushToken[altroutenteaaaaaaaaaa]');
  const chiamate = [];
  push.impostaInvio(async (url, opzioni) => {
    chiamate.push({ url, opzioni });
    return { ok: true, status: 200, json: async () => ({ data: JSON.parse(opzioni.body).map(() => ({ status: 'ok' })) }) };
  });
  const lungo = 'x'.repeat(500);
  const n = await push.inviaAUtente(1, { titolo: 'Ordine confermato', testo: lungo, link: '/ordini/12', orderId: 12 });
  assert.equal(n, 2);
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0].url, 'https://exp.host/--/api/v2/push/send');
  const corpo = JSON.parse(chiamate[0].opzioni.body);
  assert.equal(corpo.length, 2);
  assert.deepEqual(corpo.map((m) => m.to).sort(), [T1, T2].sort());
  assert.equal(corpo[0].title, 'Ordine confermato');
  assert.ok(corpo[0].body.length <= 180, 'testo accorciato');
  assert.deepEqual(corpo[0].data, { link: '/ordini/12', order_id: 12 });
  assert.equal(corpo[0].channelId, 'default');
  assert.equal(chiamate[0].opzioni.headers.Authorization, undefined);
  process.env.EXPO_ACCESS_TOKEN = 'segreto';
  await push.inviaAUtente(1, { titolo: 't', testo: 'x' });
  assert.equal(chiamate[1].opzioni.headers.Authorization, 'Bearer segreto');
});

test('inviaAUtente: un telefono che Expo non riconosce più (DeviceNotRegistered) si cancella', async () => {
  await push.registra(1, T1);
  await push.registra(1, T2);
  push.impostaInvio(async (url, opzioni) => {
    const m = JSON.parse(opzioni.body);
    return { ok: true, status: 200, json: async () => ({ data: m.map((x) => (x.to === T1 ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) };
  });
  const n = await push.inviaAUtente(1, { titolo: 't', testo: 'x' });
  assert.equal(n, 1);
  assert.deepEqual(righe.map((r) => r.token), [T2]);
});

test('inviaAUtente: senza token, spento, con Expo giù o senza tabella non fa niente e non lancia', async () => {
  let chiamato = 0;
  push.impostaInvio(async () => { chiamato++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; });
  assert.equal(await push.inviaAUtente(5, { titolo: 't', testo: 'x' }), 0, 'nessun telefono');
  assert.equal(chiamato, 0);

  await push.registra(1, T1);
  process.env.PUSH_ATTIVO = '0';
  assert.equal(await push.inviaAUtente(1, { titolo: 't', testo: 'x' }), 0, 'PUSH_ATTIVO=0');
  assert.equal(chiamato, 0);
  delete process.env.PUSH_ATTIVO;

  const errori = console.error;
  const avvisi = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    push.impostaInvio(async () => { throw new Error('rete giù'); });
    assert.equal(await push.inviaAUtente(1, { titolo: 't', testo: 'x' }), 0, 'Expo non raggiungibile');
    push.impostaInvio(async () => ({ ok: false, status: 500, json: async () => null }));
    assert.equal(await push.inviaAUtente(1, { titolo: 't', testo: 'x' }), 0, 'Expo risponde 500');
    tabellaMancante = true;
    assert.equal(await push.inviaAUtente(1, { titolo: 't', testo: 'x' }), 0, 'tabella non ancora creata');
    assert.equal(await push.registra(1, T2), false, 'registrare senza tabella non lancia');
  } finally {
    console.error = errori;
    console.warn = avvisi;
  }
});

test('destinazioneApp: dal percorso del sito alla schermata dell’app', () => {
  assert.deepEqual(push.destinazioneApp('/ordini/12'), { tipo: 'ordine', id: 12 });
  assert.deepEqual(push.destinazioneApp('/ddt/7'), { tipo: 'ordine', id: 7 });
  assert.deepEqual(push.destinazioneApp('/richieste/3'), { tipo: 'richiesta', id: 3 });
  assert.deepEqual(push.destinazioneApp('/profilo'), { tipo: 'ordini' });
  assert.deepEqual(push.destinazioneApp(null), { tipo: 'ordini' });
});
