// Prove della configurazione di Stripe con DUE serie di chiavi (reale e sandbox) e l'interruttore STRIPE_MODO (src/stripe_config.js), e di come la usano
// src/pagamenti.js e src/stripe_pagamenti.js. Nessun accesso a Stripe né al database: le variabili d'ambiente si impostano e si ripristinano a ogni prova.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// DB finto: questi test non devono toccare niente (gestisciEvento scarta gli eventi dell'altro modo prima di leggere il DB).
const dbFinto = { prepare: () => { throw new Error('il DB non si tocca'); }, transaction: (fn) => fn };
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const config = require('../src/stripe_config');
const pagamenti = require('../src/pagamenti');
const stripePagamenti = require('../src/stripe_pagamenti');

const NOMI = [
  'STRIPE_MODO', 'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_LIVE_SECRET_KEY', 'STRIPE_LIVE_PUBLISHABLE_KEY', 'STRIPE_LIVE_PUBLIC_KEY', 'STRIPE_LIVE_WEBHOOK_SECRET',
  'STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_PUBLISHABLE_KEY', 'STRIPE_TEST_PUBLIC_KEY', 'STRIPE_TEST_WEBHOOK_SECRET',
  'PAGAMENTO_SIMULATO', 'PAGAMENTO_SIMULATO_FORZA', 'NODE_ENV', 'APP_URL',
];
const salvate = Object.fromEntries(NOMI.map((n) => [n, process.env[n]]));
function imposta(valori = {}) {
  for (const n of NOMI) delete process.env[n];
  Object.assign(process.env, valori);
}
test.afterEach(() => {
  for (const n of NOMI) { if (salvate[n] === undefined) delete process.env[n]; else process.env[n] = salvate[n]; }
  stripePagamenti.impostaStripe(null);
});

// Un .env come quello della VPS: le due serie di chiavi, e il modo scelto da una riga.
const DUE_SERIE = {
  STRIPE_LIVE_SECRET_KEY: 'sk_live_reale', STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_reale', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_reale',
  STRIPE_TEST_SECRET_KEY: 'sk_test_prova', STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_prova', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_prova',
  APP_URL: 'https://minuteria.example',
};

test('STRIPE_MODO=live usa la serie REALE, STRIPE_MODO=test la SANDBOX: una riga cambia tutto', () => {
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live' });
  let c = config.configurazione();
  assert.deepEqual([c.dichiarato, c.modo, c.segreta, c.pubblicabile, c.webhook, c.altroWebhook], [true, 'live', 'sk_live_reale', 'pk_live_reale', 'whsec_reale', 'whsec_prova']);
  assert.deepEqual(c.problemi, []);
  assert.equal(pagamenti.modoStripe(), 'live');
  assert.equal(pagamenti.stripeAttivo(), true);
  assert.equal(pagamenti.pagaConStripe(), true);

  imposta({ ...DUE_SERIE, STRIPE_MODO: 'test' });
  c = config.configurazione();
  assert.deepEqual([c.modo, c.segreta, c.pubblicabile, c.webhook, c.altroWebhook], ['test', 'sk_test_prova', 'pk_test_prova', 'whsec_prova', 'whsec_reale']);
  assert.equal(pagamenti.modoStripe(), 'test');
  assert.equal(stripePagamenti.chiavePubblica(), 'pk_test_prova');

  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live' });
  assert.equal(stripePagamenti.chiavePubblica(), 'pk_live_reale');
});

test('nomi del modo: reale/produzione = live, prova/sandbox = test, maiuscole e spazi non contano; un valore strano si ignora con un avviso', () => {
  for (const [scritto, atteso] of [['live', 'live'], ['LIVE', 'live'], ['reale', 'live'], ['Produzione', 'live'], [' prod ', 'live'], ['test', 'test'], ['prova', 'test'], ['SANDBOX', 'test']]) {
    imposta({ ...DUE_SERIE, STRIPE_MODO: scritto });
    assert.equal(config.modo(), atteso, scritto);
    assert.equal(config.configurazione().dichiarato, true, scritto);
  }
  for (const strano of ['lvie', 'si', '1', 'constructor', '__proto__', 'toString']) {
    imposta({ STRIPE_SECRET_KEY: 'sk_test_singola', STRIPE_MODO: strano });
    const c = config.configurazione();
    assert.equal(c.dichiarato, false, strano + ': non è un modo');
    assert.match(c.problemi.join(' '), /STRIPE_MODO=.* non è valido/, strano);
    assert.equal(c.segreta, 'sk_test_singola', 'si ricade sul vecchio modo (una serie, il modo lo dice la chiave)');
  }
});

test('senza STRIPE_MODO vale come prima: una serie sola, il modo lo dice la chiave; senza chiavi il pagamento resta SIMULATO', () => {
  imposta({ STRIPE_SECRET_KEY: 'sk_live_singola', STRIPE_PUBLISHABLE_KEY: 'pk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
  assert.deepEqual([config.modo(), config.attivo(), config.chiaveSegreta(), config.chiavePubblicabileGrezza(), config.segretiWebhook()], ['live', true, 'sk_live_singola', 'pk_live_x', ['whsec_x']]);
  imposta({ STRIPE_SECRET_KEY: 'sk_test_singola', STRIPE_PUBLIC_KEY: 'pk_test_x' });
  assert.deepEqual([config.modo(), config.attivo(), config.chiavePubblicabileGrezza()], ['test', true, 'pk_test_x'], 'vale anche il nome STRIPE_PUBLIC_KEY');
  imposta({});
  assert.equal(config.attivo(), false);
  assert.equal(pagamenti.stripeAttivo(), false);
  assert.equal(pagamenti.pagaConStripe(), false, 'senza chiavi: simulato (sviluppo)');
  assert.match(config.descrizione(), /SIMULATI/);
});

test('una chiave nel posto sbagliato NON si usa mai: sk_test_ in STRIPE_LIVE_SECRET_KEY, la chiave reale vecchia con STRIPE_MODO=test', () => {
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_test_nelPostoSbagliato' });
  let c = config.configurazione();
  assert.equal(c.segreta, '', 'mai una chiave di prova al posto di quella reale');
  assert.match(c.problemi.join(' '), /STRIPE_LIVE_SECRET_KEY non è una chiave reale \(sk_live_\.\.\.\): non la uso/);
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'test', STRIPE_TEST_SECRET_KEY: 'sk_live_nelPostoSbagliato' });
  c = config.configurazione();
  assert.equal(c.segreta, '', 'mai una chiave REALE in modalità prova');
  assert.match(c.problemi.join(' '), /STRIPE_TEST_SECRET_KEY non è una chiave di prova/);
  // la chiave pubblicabile dell'altro modo: idem
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_test_sbagliata' });
  c = config.configurazione();
  assert.equal(c.pubblicabile, '');
  assert.match(c.problemi.join(' '), /pubblicabile di STRIPE_LIVE_ è dell'altro modo/);
  // ripiego sui vecchi nomi: solo se sono del modo scelto
  imposta({ STRIPE_MODO: 'test', STRIPE_SECRET_KEY: 'sk_live_vecchia', STRIPE_PUBLISHABLE_KEY: 'pk_live_vecchia' });
  c = config.configurazione();
  assert.deepEqual([c.segreta, c.pubblicabile], ['', ''], 'le chiavi reali senza serie non entrano in modalità prova');
  assert.equal(c.problemi.length, 2);
  imposta({ STRIPE_MODO: 'test', STRIPE_SECRET_KEY: 'sk_test_vecchia', STRIPE_PUBLISHABLE_KEY: 'pk_test_vecchia', STRIPE_WEBHOOK_SECRET: 'whsec_vecchio' });
  c = config.configurazione();
  assert.deepEqual([c.segreta, c.pubblicabile, c.webhook], ['sk_test_vecchia', 'pk_test_vecchia', 'whsec_vecchio']);
  // una restricted key (rk_) è una chiave segreta valida per il suo modo
  imposta({ STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'rk_live_ristretta' });
  assert.equal(config.chiaveSegreta(), 'rk_live_ristretta');
});

test('con STRIPE_MODO scritto Stripe resta ACCESO anche senza la chiave: i pagamenti danno errore, NON ricadono sul pagamento simulato (che fa ordinare gratis)', () => {
  imposta({ STRIPE_MODO: 'live', STRIPE_TEST_SECRET_KEY: 'sk_test_prova' }); // manca la serie reale
  assert.equal(config.chiaveSegreta(), '');
  assert.equal(pagamenti.stripeAttivo(), true);
  assert.equal(pagamenti.pagaConStripe(), true, 'nessuna richiesta parte senza pagare');
  const avvisi = stripePagamenti.controllaConfigurazione().join(' | ');
  assert.match(avvisi, /ATTENZIONE: manca la chiave segreta di Stripe per il modo in uso \(live\)/);
  // nemmeno PAGAMENTO_SIMULATO=1 (dimenticato nel .env) lo aggira con il modo reale scelto
  imposta({ STRIPE_MODO: 'live', PAGAMENTO_SIMULATO: '1', ...DUE_SERIE });
  assert.equal(pagamenti.pagamentoSimulatoForzato(), false, 'con il modo reale la scorciatoia è ignorata');
  assert.equal(pagamenti.pagaConStripe(), true);
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /PAGAMENTO_SIMULATO=1 è ignorata/);
  // la scorciatoia vale solo in prova sul PC (modo test, non in produzione), come prima
  imposta({ STRIPE_MODO: 'test', PAGAMENTO_SIMULATO: '1', ...DUE_SERIE });
  assert.equal(pagamenti.pagamentoSimulatoForzato(), true);
  imposta({ STRIPE_MODO: 'test', PAGAMENTO_SIMULATO: '1', NODE_ENV: 'production', ...DUE_SERIE });
  assert.equal(pagamenti.pagamentoSimulatoForzato(), false);
  // il bypass voluto di proposito, con le due righe, resta possibile anche in reale (e lo dice forte)
  imposta({ STRIPE_MODO: 'live', PAGAMENTO_SIMULATO: '1', PAGAMENTO_SIMULATO_FORZA: '1', ...DUE_SERIE });
  assert.equal(pagamenti.pagamentoSimulatoForzato(), true);
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /ATTENZIONE: PAGAMENTO_SIMULATO=1 \+ PAGAMENTO_SIMULATO_FORZA=1/);
});

test('avvio: a posto non dice niente di storto; reale senza HTTPS, webhook mancante e chiavi nel posto sbagliato sì', () => {
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live' });
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []);
  assert.match(stripePagamenti.descrizioneModo(), /modalità REALE \(live, STRIPE_MODO=live\): i clienti pagano davvero/);
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'test' });
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []);
  assert.match(stripePagamenti.descrizioneModo(), /modalità PROVA \(sandbox, STRIPE_MODO=test\).*4242/);

  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', APP_URL: 'http://minuteria.example' });
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /pagamento REALE ma APP_URL non è un indirizzo https:\/\//);
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', APP_URL: '' });
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /APP_URL non è un indirizzo https/);
  // in prova l'HTTP non è un problema (localhost)
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'test', APP_URL: 'http://localhost:3000' });
  assert.deepEqual(stripePagamenti.controllaConfigurazione(), []);

  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', STRIPE_LIVE_WEBHOOK_SECRET: '' });
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /segreto del webhook \(STRIPE_LIVE_WEBHOOK_SECRET, o STRIPE_WEBHOOK_SECRET\) manca/);
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_test_sbagliata' });
  const avvisi = stripePagamenti.controllaConfigurazione().join(' | ');
  assert.match(avvisi, /STRIPE_LIVE_SECRET_KEY non è una chiave reale/);
  assert.match(avvisi, /manca la chiave segreta di Stripe per il modo in uso \(live\)/);
});

test('webhook: si controlla la firma col segreto del modo in uso, poi con quello dell\'altro; gli eventi dell\'altro modo si riconoscono e si scartano', async () => {
  const provati = [];
  stripePagamenti.impostaStripe({
    webhooks: {
      constructEvent: (corpo, firma, segreto) => {
        provati.push(segreto);
        if (firma !== 'firma-di:' + segreto) throw new Error('firma non valida');
        return { type: 'payment_intent.amount_capturable_updated', livemode: segreto === 'whsec_reale', data: { object: { id: 'pi_1' } } };
      },
    },
  });
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'live' });
  assert.deepEqual(config.segretiWebhook(), ['whsec_reale', 'whsec_prova'], 'prima quello del modo in uso');
  assert.equal(stripePagamenti.webhookConfigurato(), true);

  // evento firmato col segreto reale: buono
  let evento = stripePagamenti.leggiEvento(Buffer.from('{}'), 'firma-di:whsec_reale');
  assert.equal(evento.livemode, true);
  assert.deepEqual(provati, ['whsec_reale']);
  // evento dell'endpoint di PROVA (stessa URL): la firma torna col secondo segreto, nessun errore 400... ma gestisciEvento lo scarta senza toccare il DB
  provati.length = 0;
  evento = stripePagamenti.leggiEvento(Buffer.from('{}'), 'firma-di:whsec_prova');
  assert.deepEqual(provati, ['whsec_reale', 'whsec_prova']);
  assert.equal(evento.livemode, false);
  await stripePagamenti.gestisciEvento(evento); // se toccasse il DB, il DB finto lancerebbe
  // firma sbagliata con entrambi: errore (il server risponde 400)
  assert.throws(() => stripePagamenti.leggiEvento(Buffer.from('{}'), 'firma-falsa'), /firma non valida/);

  // in prova il contrario: l'evento reale si scarta
  imposta({ ...DUE_SERIE, STRIPE_MODO: 'test' });
  evento = stripePagamenti.leggiEvento(Buffer.from('{}'), 'firma-di:whsec_reale');
  assert.equal(evento.livemode, true);
  await stripePagamenti.gestisciEvento(evento);

  // un solo segreto (o lo stesso per i due modi): niente doppioni; nessuno: webhook non configurato
  imposta({ STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_unico', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_unico' });
  assert.deepEqual(config.segretiWebhook(), ['whsec_unico']);
  imposta({ STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_live_x' });
  assert.equal(stripePagamenti.webhookConfigurato(), false);
  assert.throws(() => stripePagamenti.leggiEvento(Buffer.from('{}'), 'x'), /Nessun segreto del webhook/);
});

test('il vecchio STRIPE_WEBHOOK_SECRET non finisce a controllare i webhook dell\'altro modo (un whsec_ non dice di che modo è)', () => {
  // serie separate: il segreto senza serie NON si usa (era di prova, i webhook reali verrebbero tutti respinti)
  imposta({ STRIPE_MODO: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_live_x', STRIPE_LIVE_PUBLISHABLE_KEY: 'pk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_vecchio_di_prova', APP_URL: 'https://minuteria.example' });
  assert.equal(config.configurazione().webhook, '');
  assert.equal(stripePagamenti.webhookConfigurato(), false);
  assert.match(stripePagamenti.controllaConfigurazione().join(' | '), /segreto del webhook \(STRIPE_LIVE_WEBHOOK_SECRET/);
  // con la VECCHIA chiave segreta (stessa serie senza modo) invece vale
  imposta({ STRIPE_MODO: 'live', STRIPE_SECRET_KEY: 'sk_live_vecchia', STRIPE_WEBHOOK_SECRET: 'whsec_vecchio' });
  assert.equal(config.configurazione().webhook, 'whsec_vecchio');
});
