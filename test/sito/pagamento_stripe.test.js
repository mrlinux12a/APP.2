// Stripe: webhook, pagina di pagamento e ritorno.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38483);
const {
  biscotti, chiedi, erroriServer, form, json, radice, registro,
} = aiuti;

test('Stripe: webhook con firma sul corpo grezzo, "Paga e invia" verso la pagina di pagamento del sito, ritorno senza pagare', async () => {
  const stripePagamenti = require(path.join(radice, 'src/logica/pagamenti/stripe_pagamenti'));
  const corpoWebhook = JSON.stringify({ id: 'evt_1', type: 'payment_intent.canceled', livemode: false, data: { object: { id: 'pi_test_sconosciuto' } } });
  const webhook = (firma) => chiedi('/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(firma ? { 'stripe-signature': firma } : {}) },
    body: corpoWebhook,
  });
  const intentiCreati = [];
  const corpiVisti = [];
  const finto = {
    paymentIntents: {
      create: async (p, o) => {
        intentiCreati.push([p, o]);
        return { id: 'pi_test_abc', client_secret: 'pi_test_abc_secret_xyz', status: 'requires_payment_method', amount: p.amount, metadata: p.metadata };
      },
      retrieve: async () => ({ id: 'pi_test_abc', client_secret: 'pi_test_abc_secret_xyz', status: 'requires_payment_method', amount: 0, metadata: {} }),
    },
    webhooks: {
      constructEvent: (corpo, firma) => {
        corpiVisti.push(corpo);
        if (firma !== 'firma-buona') throw new Error('firma non valida');
        return JSON.parse(corpo.toString());
      },
    },
  };

  // senza chiave Stripe il webhook non esiste (503) e "Paga e invia" resta quello simulato (provato dalle altre prove)
  assert.equal((await webhook('firma-buona')).status, 503);

  process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
  stripePagamenti.impostaStripe(finto);
  try {
    // chiave ma niente segreto del webhook: ancora 503
    assert.equal((await webhook('firma-buona')).status, 503);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_finto';

    // la firma si controlla sul corpo grezzo (un Buffer, non un oggetto già interpretato)
    assert.equal((await webhook(null)).status, 400);
    assert.equal((await webhook('firma-sbagliata')).status, 400);
    const r = await webhook('firma-buona');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ricevuto: true });
    assert.ok(corpiVisti.every((c) => Buffer.isBuffer(c) && c.toString() === corpoWebhook));

    // cliente con qualcosa nel carrello: "Paga e invia richiesta" porta alla pagina di pagamento DEL SITO e NON crea la richiesta
    biscotti.cookie = '';
    let risposta = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    assert.equal(risposta.status, 302);
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 10 }));
    const prima = registro.length;
    risposta = await chiedi('/richieste', form({ modo: 'imposta', destinazione: 'Via Puggia 22/3' }));
    assert.equal(risposta.status, 303);
    assert.equal(risposta.headers.get('location'), '/pagamento/1');
    assert.equal(intentiCreati.length, 1);
    assert.equal(intentiCreati[0][0].capture_method, 'manual');
    assert.equal(registro.slice(prima).some((q) => /INSERT INTO requests/.test(q)), false, 'la richiesta nasce solo a carta autorizzata');
    assert.match(await (await chiedi('/carrello')).text(), /Valvola a sfera/); // il carrello resta com'era

    // la pagina: form di Stripe nel sito, con chiave pubblica e client secret (mai la chiave segreta)
    risposta = await chiedi('/pagamento/1');
    assert.equal(risposta.status, 200);
    let t = await risposta.text();
    assert.match(t, /<title>Pagamento/);
    // sandbox (chiave sk_test_): la pagina lo dice, con la carta di prova; in reale non compare mai
    assert.match(t, /<strong>Modalità prova:<\/strong> nessun addebito reale\. Usa la carta di prova 4242 4242 4242 4242/);
    assert.match(t, /data-pagamento\s+data-chiave="pk_test_finta" data-segreto="pi_test_abc_secret_xyz" data-ritorno="http:\/\/127\.0\.0\.1:\d+\/pagamento\/esito"/);
    assert.match(t, /<div id="elemento-pagamento"/);
    assert.match(t, /<button class="btn-paga pag-paga" type="button" data-pag-paga disabled>Paga € /);
    assert.match(t, /<script src="https:\/\/js\.stripe\.com\/v3\/"><\/script>/);
    assert.match(t, /src="\/pagamento\.js\?v=\d+"/);
    assert.doesNotMatch(t, /sk_test|whsec_/);
    assert.doesNotMatch(t, /class="navbar"/);
    assert.doesNotMatch(t, /non è andato a buon fine/);

    // APP_URL, se c'è, vince sull'indirizzo della richiesta (per il ritorno da Stripe)
    process.env.APP_URL = 'https://sito.test/';
    t = await (await chiedi('/pagamento/1')).text();
    assert.match(t, /data-ritorno="https:\/\/sito\.test\/pagamento\/esito"/);

    // ritorno senza carta autorizzata (pagamento non riuscito): di nuovo il form, con l'avviso
    risposta = await chiedi('/pagamento/esito?payment_intent=pi_test_abc');
    assert.equal(risposta.status, 302);
    assert.equal(risposta.headers.get('location'), '/pagamento/1?riprova=1');
    t = await (await chiedi('/pagamento/1?riprova=1')).text();
    assert.match(t, /Il pagamento non è andato a buon fine\./);

    // un pagamento che non esiste (o di un altro) e un ritorno senza parametri: si torna al carrello
    for (const percorso of ['/pagamento/999', '/pagamento/esito', '/pagamento/esito?payment_intent=pi_di_altri']) {
      risposta = await chiedi(percorso);
      assert.equal(risposta.status, 302, percorso);
      assert.equal(risposta.headers.get('location'), '/carrello', percorso);
    }

    // senza chiave pubblica il form non si può mostrare: errore chiaro, non una pagina rotta
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    risposta = await chiedi('/pagamento/1');
    assert.equal(risposta.status, 503);
    assert.match(await risposta.text(), /Il pagamento online non è ancora configurato/);
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';

    // Sul PC di sviluppo, con PAGAMENTO_SIMULATO=1, "Paga e invia" salta Stripe: la richiesta parte con il pagamento simulato
    // e non si apre nessuna pagina di pagamento. Sulla VPS non deve valere MAI: né con la chiave reale né con NODE_ENV=production.
    // (Si ripete il carrello perché la richiesta simulata lo svuota.)
    const nuovoCarrello = async () => {
      await chiedi('/carrello/svuota', { method: 'POST' });
      await chiedi('/api/carrello/imposta', json({ id: 1, qty: 10 }));
    };
    const pagaDalCarrello = () => chiedi('/richieste', form({ modo: 'imposta', destinazione: 'Via Puggia 22/3' }));
    const nodeEnvPrima = process.env.NODE_ENV;
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    process.env.PAGAMENTO_SIMULATO = '1';
    try {
      await nuovoCarrello();
      const intentiPrima = intentiCreati.length;
      const registroPrima = registro.length;
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 302, 'con il bypass non si va a /pagamento (303)');
      assert.match(risposta.headers.get('location'), /^\/richieste\//);
      assert.equal(intentiCreati.length, intentiPrima, 'nessun PaymentIntent');
      assert.ok(registro.slice(registroPrima).some((q) => /INSERT INTO requests/.test(q)), 'la richiesta nasce subito');

      // con NODE_ENV=production il bypass è ignorato: si paga con Stripe
      process.env.NODE_ENV = 'production';
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.match(risposta.headers.get('location'), /^\/pagamento\/\d+$/);
      assert.equal(intentiCreati.length, intentiPrima + 1);
      delete process.env.NODE_ENV;

      // con la chiave reale (sk_live_) idem
      process.env.STRIPE_SECRET_KEY = 'sk_live_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_finta';
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.match(risposta.headers.get('location'), /^\/pagamento\/\d+$/);
      assert.equal(intentiCreati.length, intentiPrima + 2);
      process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';

      // senza la riga nel .env: Stripe come sempre
      delete process.env.PAGAMENTO_SIMULATO;
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.equal(intentiCreati.length, intentiPrima + 3);
    } finally {
      delete process.env.PAGAMENTO_SIMULATO;
      if (nodeEnvPrima === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvPrima;
      process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
    }

    // senza accesso, al login
    await chiedi('/logout', { method: 'POST' });
    for (const percorso of ['/pagamento/1', '/pagamento/esito?payment_intent=pi_test_abc']) {
      risposta = await chiedi(percorso);
      assert.equal(risposta.status, 302, percorso);
      assert.equal(risposta.headers.get('location'), '/login', percorso);
    }
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.APP_URL;
    stripePagamenti.impostaStripe(null);
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
