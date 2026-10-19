// Prove dell'annullamento da parte del cliente: SOLO in fase 1 (richiesta in attesa E nessun banco ha ancora accettato), mai per un ordine.
// Regole in cima a src/pagamenti.js. DB in memoria, WhatsApp finto: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.STRIPE_SECRET_KEY = 'sk_test_finta';

// ---------------- DB in memoria ----------------
const dati = {
  richieste: new Map(), // id -> { stato, order_id, pagamento_stato }
  risposte: [], // { request_id, esito, corriere_stato }
  ordini: new Map(), // id -> riga
  stripe: [], // { request_id, stato }
};
const scritture = []; // le istruzioni che modificano qualcosa (UPDATE, DELETE, INSERT)
const sqlViste = [];
let dopoIlBlocco = null; // un'azione che scatta subito dopo il blocco della riga: un banco che conferma "nello stesso momento"

function esegui(sql, p) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqlViste.push(s);
  if (/^(UPDATE|DELETE|INSERT)/.test(s)) scritture.push(s);

  if (/^SELECT stato FROM requests WHERE id = \? FOR UPDATE$/.test(s)) {
    const r = dati.richieste.get(Number(p[0]));
    if (dopoIlBlocco) { const f = dopoIlBlocco; dopoIlBlocco = null; f(); }
    return r ? { stato: r.stato } : null;
  }
  if (/^UPDATE requests SET stato = 'annullata' WHERE id = \? AND stato = 'in_attesa' AND NOT EXISTS \(SELECT 1 FROM request_responses rr WHERE rr\.request_id = requests\.id AND rr\.esito = 'confermato'\)$/.test(s)) {
    const r = dati.richieste.get(Number(p[0]));
    const confermata = dati.risposte.some((x) => x.request_id === Number(p[0]) && x.esito === 'confermato');
    if (r && r.stato === 'in_attesa' && !confermata) { r.stato = 'annullata'; return { changes: 1 }; }
    return { changes: 0 };
  }
  if (/^UPDATE requests SET pagamento_stato = 'rimborsato'(?:, rimborsato_il = NOW\(\))? WHERE id = \? AND pagamento_stato = 'pagato'$/.test(s)) {
    const r = dati.richieste.get(Number(p[0]));
    if (r && r.pagamento_stato === 'pagato') { r.pagamento_stato = 'rimborsato'; return { changes: 1 }; }
    return { changes: 0 };
  }
  if (/^UPDATE stripe_pagamenti SET stato = CASE WHEN stato = 'incassato' THEN 'da_rimborsare' ELSE 'da_rilasciare' END, aggiornato_il = NOW\(\) WHERE request_id = \? AND stato IN/.test(s)) {
    let n = 0;
    for (const riga of dati.stripe) {
      if (riga.request_id === Number(p[0]) && ['autorizzato', 'da_incassare', 'incassato'].includes(riga.stato)) { riga.stato = riga.stato === 'incassato' ? 'da_rimborsare' : 'da_rilasciare'; n++; }
    }
    return { changes: n };
  }
  if (/^UPDATE request_responses SET esito = 'scaduto' WHERE request_id = \? AND esito = 'in_attesa'$/.test(s)) {
    let n = 0;
    for (const x of dati.risposte) if (x.request_id === Number(p[0]) && x.esito === 'in_attesa') { x.esito = 'scaduto'; n++; }
    return { changes: n };
  }
  if (/^UPDATE request_responses SET corriere_stato = 'scaduto' WHERE request_id = \? AND corriere_stato = 'in_attesa'$/.test(s)) {
    let n = 0;
    for (const x of dati.risposte) if (x.request_id === Number(p[0]) && x.corriere_stato === 'in_attesa') { x.corriere_stato = 'scaduto'; n++; }
    return { changes: n };
  }
  if (/^SELECT order_id, stato FROM requests WHERE id = \? FOR UPDATE$/.test(s)) return dati.richieste.get(Number(p[0])) || null;
  if (/^SELECT \* FROM orders WHERE id = \?$/.test(s)) return dati.ordini.get(Number(p[0])) || null;
  if (/^SELECT 1 AS x FROM request_responses WHERE request_id = \? AND esito = 'confermato' LIMIT 1$/.test(s)) {
    return dati.risposte.some((x) => x.request_id === Number(p[0]) && x.esito === 'confermato') ? { x: 1 } : null;
  }
  if (/^DELETE FROM /.test(s)) return { changes: 1 };
  throw new Error('SQL non gestito dal DB finto: ' + s.slice(0, 130));
}
const dbFinto = {
  prepare: (sql) => ({
    get: async (...p) => esegui(sql, p),
    all: async (...p) => { const r = esegui(sql, p); return Array.isArray(r) ? r : []; },
    run: async (...p) => esegui(sql, p),
  }),
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const ritiri = [];
const whatsapp = require('../src/whatsapp');
whatsapp.ritiraRichiesta = async (...a) => { ritiri.push(a); };
const pagamenti = require('../src/pagamenti');
const flusso = require('../src/flusso_cliente');

// Una richiesta pagata con Stripe (carta AUTORIZZATA, blocco sulla carta) e le sue risposte.
function prepara({ stato = 'in_attesa', risposte = [{ esito: 'in_attesa', corriere_stato: null }], orderId = null, stripe = 'autorizzato' } = {}) {
  dati.richieste.clear();
  dati.richieste.set(10, { stato, order_id: orderId, pagamento_stato: 'pagato' });
  dati.risposte = risposte.map((r) => ({ request_id: 10, ...r }));
  dati.ordini.clear();
  dati.stripe = stripe ? [{ request_id: 10, stato: stripe }] : [];
  scritture.length = 0;
  sqlViste.length = 0;
  ritiri.length = 0;
  dopoIlBlocco = null;
}

test('fase 1: richiesta in attesa e nessun banco ha accettato -> annullata; il blocco sulla carta si RILASCIA (non è un rimborso)', async () => {
  prepara({ risposte: [{ esito: 'in_attesa', corriere_stato: null }, { esito: 'non_disponibile', corriere_stato: null }] });
  assert.equal(await flusso.annullaRichiesta(10), true);
  assert.equal(dati.richieste.get(10).stato, 'annullata');
  assert.equal(dati.richieste.get(10).pagamento_stato, 'rimborsato', 'sulla richiesta resta il segno "tornato al cliente": per le viste è "nessun addebito"');
  // la carta era solo autorizzata: si rilascia, mai "da_rimborsare"
  assert.equal(dati.stripe[0].stato, 'da_rilasciare');
  // le risposte ancora aperte dei banchi si chiudono, e il messaggio dei corrieri sparisce
  assert.deepEqual(dati.risposte.map((r) => r.esito), ['scaduto', 'non_disponibile']);
  assert.equal(ritiri.length, 1);
  assert.deepEqual(ritiri[0], [10, { motivo: 'il cliente ha annullato la richiesta' }]);
  // e lo stato che vede il cliente: annullato, niente ricevuta (nessun incasso)
  const sp = pagamenti.calcolaStatoPagamento({ riga: dati.stripe[0], richiesta: { ...dati.richieste.get(10), id: 10 } });
  assert.deepEqual([sp.chiave, sp.ricevuta], ['annullato', false]);
});

test('un banco ha già accettato (anche senza corriere): non si annulla più, e non cambia NIENTE', async () => {
  for (const corriere of [null, 'in_attesa', 'preso']) {
    prepara({ risposte: [{ esito: 'confermato', corriere_stato: corriere }, { esito: 'in_attesa', corriere_stato: null }] });
    assert.equal(await flusso.annullaRichiesta(10), false, 'corriere ' + corriere);
    assert.equal(dati.richieste.get(10).stato, 'in_attesa');
    assert.equal(dati.richieste.get(10).pagamento_stato, 'pagato');
    assert.equal(dati.stripe[0].stato, 'autorizzato', 'il blocco sulla carta resta');
    assert.deepEqual(dati.risposte.map((r) => r.esito), ['confermato', 'in_attesa'], 'le risposte non si toccano');
    assert.deepEqual(scritture.filter((q) => !/^UPDATE requests SET stato = 'annullata'/.test(q)), [], 'nessun\'altra scrittura');
    assert.equal(ritiri.length, 0);
  }
});

test('richiesta già ordinata, già chiusa, già annullata o inesistente: false, senza toccare niente', async () => {
  for (const stato of ['ordinata', 'nessuna_offerta', 'annullata', 'con_offerte']) {
    prepara({ stato, orderId: stato === 'ordinata' ? 55 : null, risposte: [{ esito: 'confermato', corriere_stato: 'preso' }] });
    assert.equal(await flusso.annullaRichiesta(10), false, stato);
    assert.equal(dati.richieste.get(10).stato, stato, 'resta com\'è');
    assert.equal(dati.stripe[0].stato, 'autorizzato');
    assert.equal(ritiri.length, 0);
  }
  prepara();
  assert.equal(await flusso.annullaRichiesta(999), false);
  assert.deepEqual(scritture, []);
});

test('la regola sta DENTRO la UPDATE (e la riga si blocca prima): un banco che conferma nello stesso momento non viene aggirato', async () => {
  prepara();
  // il banco conferma subito dopo che l'annullamento ha letto la richiesta "in attesa, nessuna conferma": la UPDATE, con la sua condizione, non annulla
  dopoIlBlocco = () => { dati.risposte[0].esito = 'confermato'; };
  assert.equal(await flusso.annullaRichiesta(10), false);
  assert.equal(dati.richieste.get(10).stato, 'in_attesa');
  assert.equal(dati.stripe[0].stato, 'autorizzato');
  assert.equal(ritiri.length, 0);
  // il testo della condizione, per non perderla in una modifica futura: solo 'in_attesa' e nessuna risposta 'confermato'
  const update = sqlViste.find((q) => /^UPDATE requests SET stato = 'annullata'/.test(q));
  assert.match(update, /WHERE id = \? AND stato = 'in_attesa' AND NOT EXISTS \(SELECT 1 FROM request_responses rr WHERE rr\.request_id = requests\.id AND rr\.esito = 'confermato'\)/);
  assert.ok(sqlViste.indexOf(sqlViste.find((q) => /FOR UPDATE$/.test(q))) < sqlViste.indexOf(update), 'prima il blocco della riga, poi la UPDATE');
  assert.doesNotMatch(update, /con_offerte|nessuna_offerta/, 'non si annulla più una richiesta già chiusa');
});

test('pagamento già incassato (non dovrebbe succedere in fase 1): se mai, si rimborsa invece di rilasciare', async () => {
  // difesa in profondità di pagamenti.rimborsa: una carta incassata non si "rilascia"
  prepara({ stripe: 'incassato' });
  assert.equal(await pagamenti.rimborsa(10), true);
  assert.equal(dati.stripe[0].stato, 'da_rimborsare');
});

test('eliminare la richiesta segue la stessa regola: sì in fase 1 o a richiesta chiusa senza ordine; no se un banco ha confermato o c\'è un ordine', async () => {
  // in attesa, nessuna conferma: si elimina (il blocco si rilascia)
  prepara();
  await flusso.eliminaRichiesta(10);
  assert.ok(scritture.some((q) => /^DELETE FROM requests WHERE id = \?/.test(q)));
  assert.equal(dati.stripe[0].stato, 'da_rilasciare');
  assert.equal(ritiri.length, 1);
  // già chiusa senza ordine (nessuna risposta): si elimina
  prepara({ stato: 'nessuna_offerta', risposte: [{ esito: 'scaduto', corriere_stato: null }], stripe: 'rilasciato' });
  await flusso.eliminaRichiesta(10);
  assert.ok(scritture.some((q) => /^DELETE FROM requests WHERE id = \?/.test(q)));

  // un banco ha già confermato: rifiutata, e non si tocca niente (nemmeno il pagamento)
  prepara({ risposte: [{ esito: 'confermato', corriere_stato: 'in_attesa' }] });
  await assert.rejects(
    () => flusso.eliminaRichiesta(10),
    (e) => e instanceof flusso.OrdineInLavorazione && e.richiestaId === 10 && e.ordine.id === null && /Il banco ha già confermato/.test(e.messaggioCliente)
  );
  assert.deepEqual(scritture, [], 'nessuna scrittura');
  assert.equal(dati.stripe[0].stato, 'autorizzato');
  assert.equal(ritiri.length, 0);

  // c'è un ordine: rifiutata, qualunque ne sia lo stato
  for (const ordine of [{ id: 55, stato: 'inviato', consegnato_il: null }, { id: 55, stato: 'in_evasione', consegnato_il: null }, { id: 55, stato: 'evaso', consegnato_il: new Date() }]) {
    prepara({ stato: 'ordinata', orderId: 55, risposte: [{ esito: 'confermato', corriere_stato: 'preso' }], stripe: 'incassato' });
    dati.ordini.set(55, ordine);
    await assert.rejects(() => flusso.eliminaRichiesta(10), (e) => e instanceof flusso.OrdineInLavorazione && e.ordine.id === 55);
    assert.deepEqual(scritture, [], 'nessuna scrittura per un ordine ' + ordine.stato);
    assert.equal(dati.stripe[0].stato, 'incassato', 'la carta incassata resta incassata');
  }
});

test('il cliente non annulla MAI un ordine: ordineAnnullabileDalCliente è sempre false, eliminaOrdine rifiuta con il messaggio dell\'assistenza e non scrive', async () => {
  for (const ordine of [{ stato: 'inviato', consegnato_il: null }, { stato: 'in_evasione', consegnato_il: null }, { stato: 'evaso', consegnato_il: null }, { stato: 'evaso', consegnato_il: new Date() }, { stato: 'inviato', consegnato_il: new Date() }]) {
    assert.equal(flusso.ordineAnnullabileDalCliente(ordine), false, JSON.stringify(ordine));
    prepara({ stato: 'ordinata', orderId: 55, stripe: 'incassato' });
    dati.ordini.set(55, { id: 55, ...ordine });
    await assert.rejects(
      () => flusso.eliminaOrdine(55),
      (e) => e instanceof flusso.OrdineInLavorazione
        && e.messaggioCliente === "Il banco ha già confermato: l'ordine non si può più annullare. Per problemi contatta l'assistenza."
        && e.ordine.id === 55
    );
    assert.deepEqual(scritture, [], 'nessuna scrittura');
    assert.equal(dati.stripe[0].stato, 'incassato', 'niente rimborso né rilascio');
    assert.equal(ritiri.length, 0);
  }
  // un ordine che non esiste: niente da fare, nessun errore
  prepara();
  await flusso.eliminaOrdine(999);
  assert.deepEqual(scritture, []);
});
