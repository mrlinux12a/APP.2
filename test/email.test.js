// Prove di src/email.js: l'email "Pagamento ricevuto" (contenuto, HTML sicuro, pulsanti) e l'invio, che NON deve mai far fallire un incasso.
// Trasporto finto: nessuna rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbFinto = { prepare: () => ({ get: async () => null, all: async () => [], run: async () => ({}) }), transaction: (fn) => (...a) => fn(...a) };
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const email = require('../src/email');
const pricing = require('../src/pricing');
const { azienda } = require('../src/azienda');

const CHIAVI = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_DA', 'AZIENDA_NOME', 'APP_URL'];
function conAmbiente(valori, prova) {
  const prima = Object.fromEntries(CHIAVI.map((k) => [k, process.env[k]]));
  for (const k of CHIAVI) delete process.env[k];
  Object.assign(process.env, valori);
  const ripristina = () => { for (const k of CHIAVI) { if (prima[k] === undefined) delete process.env[k]; else process.env[k] = prima[k]; } email.impostaTrasporto(null); };
  const r = prova();
  return r && typeof r.then === 'function' ? r.finally(ripristina) : (ripristina(), r);
}

// I dati come li dà ricevute.datiRicevuta: 54,50 + 10,00 di merce -> in app 20,07 (corriere 10,00 + servizio 6,45 + IVA 3,62), materiale 78,69.
const importi = pricing.importiOrdine(
  { totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81, servizio: 6.45, imponibile_app: 16.45, iva_app: 3.62, da_pagare_app: 20.07, imponibile_banco: 64.5, iva_banco: 14.19, materiale_banco: 78.69 },
  { stato: 'pagato', importo: 20.07, metodo: 'stripe' }, 22, 10
);
const dati = (extra = {}) => ({
  tipo: 'pagamento', numero: 'R-2026-000123', data: new Date(2026, 9, 15, 19, 16), ordineId: 97, richiestaId: 177, ditta: 'BOREA SRL', destinazione: 'Via Puggia 22/3',
  cliente: { ragione_sociale: 'Rossi Impianti S.r.l.', email: 'rossi@example.com' }, importi, carta: { marca: 'Visa', ultime4: '4242', testo: 'Visa •••• 4242' },
  transazione: 'pi_1', azienda: azienda(), ...extra,
});

test('oggetto e testo dell\'email "Pagamento ricevuto"', () => {
  const d = conAmbiente({}, () => dati());
  assert.equal(email.oggettoPagamentoRicevuto(d), 'Pagamento ricevuto · Ordine #97 · € 20,07');
  const t = email.testoPagamentoRicevuto(d);
  assert.match(t, /^Pagamento ricevuto\n/);
  assert.match(t, /BOREA SRL ha confermato il tuo ordine #97\. Abbiamo addebitato la consegna in cantiere sulla tua Visa •••• 4242\./);
  assert.match(t, /Consegna in cantiere: € 20,07\n  Corriere · costo fisso: € 10,00\n  Servizio · 10% della merce: € 6,45\n  IVA 22%: € 3,62/);
  assert.match(t, /Materiale € 78,69 IVA inclusa: non è in questo pagamento, lo paghi a BOREA SRL con la sua fattura\./);
  assert.match(t, /Ricevuta N\. R-2026-000123 · 15\/10\/2026, 21:16\nTrovi tutte le ricevute in Storico ordini → Ricevute del mese\./);
  assert.doesNotMatch(t, /Scarica la ricevuta|Segui l'ordine/, 'senza APP_URL i link non ci sono');
});

test('HTML: larga 520px, intestazione blu col nome, riquadro verde con le tre voci, riquadro grigio sul materiale, due pulsanti, piè di pagina', () => {
  const html = conAmbiente({ APP_URL: 'https://minuteria.example/', AZIENDA_NOME: 'Cantiere Facile' }, () => email.htmlPagamentoRicevuto(dati({ azienda: azienda() })));
  assert.match(html, /<title>Pagamento ricevuto · Ordine #97 · € 20,07<\/title>/);
  assert.match(html, /width="520"/);
  assert.match(html, /background:#245A8F;padding:18px 24px/);
  assert.match(html, />C<\/td>\s*<td style="padding-left:12px[^"]*">Cantiere Facile<\/td>/, 'logo con la lettera e il nome');
  assert.match(html, /<h1[^>]*>Pagamento ricevuto<\/h1>/);
  assert.match(html, /BOREA SRL ha confermato il tuo ordine #97\. Abbiamo addebitato la consegna in cantiere sulla tua Visa •••• 4242\./);
  // riquadro verde: titolo, totale grande e le tre voci
  assert.match(html, /background:#E3F3E6/);
  assert.match(html, /Consegna in cantiere<\/td><td align="right"[^>]*>€ 20,07<\/td>/);
  for (const voce of ['Corriere · costo fisso', 'Servizio · 10% della merce', 'IVA 22%']) assert.ok(html.includes(voce), voce);
  assert.match(html, /€ 10,00<\/td>[\s\S]*?€ 6,45<\/td>[\s\S]*?€ 3,62<\/td>/);
  // riquadro grigio: il materiale NON è in questo pagamento
  assert.match(html, /background:#F7F6F2;border:1px solid #E2DED3/);
  assert.match(html, /<strong[^>]*>Materiale € 78,69<\/strong> IVA inclusa: non è in questo pagamento, lo paghi a BOREA SRL con la sua fattura\./);
  // pulsanti: "Scarica la ricevuta" (blu pieno) e "Segui l'ordine" (bordo blu), con l'indirizzo del sito (senza barra finale doppia)
  assert.match(html, /<a href="https:\/\/minuteria\.example\/ordini\/97\/ricevuta\.pdf" style="[^"]*background:#245A8F;color:#ffffff[^"]*">Scarica la ricevuta<\/a>/);
  assert.match(html, /<a href="https:\/\/minuteria\.example\/ordini\/97" style="[^"]*background:#ffffff;color:#245A8F[^"]*">Segui l'ordine<\/a>/);
  // piè di pagina
  assert.match(html, /Ricevuta N\. R-2026-000123 · 15\/10\/2026, 21:16<br>\s*Trovi tutte le ricevute in Storico ordini → Ricevute del mese\./);
  assert.doesNotMatch(html, /98,76|85,80/, 'mai la somma di consegna e materiale');
});

test('HTML: senza l\'indirizzo del sito (APP_URL) i pulsanti non ci sono (un link relativo in una email non funziona); senza carta si dice "carta"', () => {
  const html = conAmbiente({}, () => email.htmlPagamentoRicevuto(dati({ carta: null, azienda: azienda() })));
  assert.doesNotMatch(html, /Scarica la ricevuta|Segui l/);
  assert.match(html, /sulla tua carta\./);
  assert.match(html, />M<\/td>\s*<td style="padding-left:12px[^"]*">Minuteria<\/td>/, 'nome di default');
});

test('HTML: tutto quello che arriva da fuori è escapato (nome, ditta, indirizzo)', () => {
  const html = conAmbiente({ AZIENDA_NOME: 'A&B <Servizi>' }, () => email.htmlPagamentoRicevuto(dati({ ditta: '<script>alert(1)</script> SRL', azienda: azienda() })));
  assert.doesNotMatch(html, /<script>|alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; SRL/);
  assert.match(html, /A&amp;B &lt;Servizi&gt;/);
});

test('invia: senza SMTP_HOST non parte niente (e lo dice nel log una volta sola); con il trasporto manda da, a, oggetto, html e testo', async () => {
  const righeLog = [];
  const log = console.log;
  console.log = (...a) => righeLog.push(a.join(' '));
  try {
    await conAmbiente({}, async () => {
      assert.equal(email.configurato(), false);
      assert.deepEqual(await email.invia({ a: 'x@y.it', oggetto: 'o', html: 'h', testo: 't' }), { inviata: false, motivo: 'SMTP non configurato' });
      await email.invia({ a: 'x@y.it', oggetto: 'o', html: 'h', testo: 't' });
    });
  } finally {
    console.log = log;
  }
  assert.equal(righeLog.filter((r) => /SMTP_HOST non impostato/.test(r)).length, 1, 'avviso una volta sola');

  const inviate = [];
  await conAmbiente({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'ordini@example.com', AZIENDA_NOME: 'Minuteria' }, async () => {
    assert.equal(email.configurato(), true);
    email.impostaTrasporto({ sendMail: async (o) => { inviate.push(o); } });
    assert.deepEqual(await email.invia({ a: 'x@y.it', oggetto: 'Oggetto', html: '<p>h</p>', testo: 't' }), { inviata: true });
  });
  assert.deepEqual(inviate, [{ from: '"Minuteria" <ordini@example.com>', to: 'x@y.it', subject: 'Oggetto', html: '<p>h</p>', text: 't' }]);
  // il mittente può essere scritto a mano
  await conAmbiente({ SMTP_HOST: 'smtp.example.com', EMAIL_DA: 'Assistenza <assistenza@example.com>' }, async () => {
    email.impostaTrasporto({ sendMail: async (o) => { inviate.push(o); } });
    await email.invia({ a: 'x@y.it', oggetto: 'o', html: 'h', testo: 't' });
  });
  assert.equal(inviate.at(-1).from, 'Assistenza <assistenza@example.com>');
});

test('inviaPagamentoRicevuto NON lancia mai: indirizzo non valido, trasporto che si rompe, SMTP non configurato', async () => {
  const errori = [];
  const logErr = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await conAmbiente({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'ordini@example.com' }, async () => {
      const inviate = [];
      email.impostaTrasporto({ sendMail: async (o) => { inviate.push(o); } });
      // buono: una mail al cliente, con oggetto e corpo della ricevuta
      assert.deepEqual(await email.inviaPagamentoRicevuto(dati()), { inviata: true });
      assert.equal(inviate.length, 1);
      assert.equal(inviate[0].to, 'rossi@example.com');
      assert.equal(inviate[0].subject, 'Pagamento ricevuto · Ordine #97 · € 20,07');
      assert.match(inviate[0].html, /<h1[^>]*>Pagamento ricevuto<\/h1>/);
      assert.match(inviate[0].text, /^Pagamento ricevuto/);
      // indirizzi che non sono indirizzi: niente invio, niente errore
      for (const indirizzo of ['', null, 'non-una-mail', 'a@b']) {
        const r = await email.inviaPagamentoRicevuto(dati({ cliente: { email: indirizzo } }));
        assert.equal(r.inviata, false);
        assert.match(r.motivo, /indirizzo email valido/);
      }
      assert.equal(inviate.length, 1);
      // il trasporto si rompe: il risultato dice "non inviata", il log dice perché, e non lancia
      email.impostaTrasporto({ sendMail: async () => { throw new Error('connessione rifiutata'); } });
      const guasto = await email.inviaPagamentoRicevuto(dati());
      assert.deepEqual([guasto.inviata, guasto.motivo], [false, 'connessione rifiutata']);
      // dati strani (nessun cliente): nemmeno questo lancia
      assert.equal((await email.inviaPagamentoRicevuto({ ordineId: 1 })).inviata, false);
    });
    await conAmbiente({}, async () => {
      assert.equal((await email.inviaPagamentoRicevuto(dati())).inviata, false, 'SMTP non configurato');
    });
  } finally {
    console.error = logErr;
  }
  assert.ok(errori.some((r) => /connessione rifiutata/.test(r)), 'l\'errore finisce nel log: ' + errori.join(' | '));
});
