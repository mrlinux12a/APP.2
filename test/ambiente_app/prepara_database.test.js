// I pezzi senza database dello script che prepara il database dell'ambiente «app» (scripts/ambiente_app/prepara_database.js): come si riconosce lo stesso
// database, come nascono i nomi utente dei banchi di prova e, soprattutto, che l'ORDINE delle tabelle da copiare rispetti i legami dello schema e che nessuna
// tabella del catalogo rimandi a persone, ordini o pagamenti (che la copia non porta). La copia vera, su due Postgres, si prova a mano (docs/ambienti.md).
// Nessun accesso al database né alla rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { TABELLE, nomeUtenteBanco, stessoIndirizzo } = require('../../scripts/ambiente_app/prepara_database');

test('stessoIndirizzo riconosce lo stesso database anche scritto in modi diversi', () => {
  assert.equal(stessoIndirizzo('postgres://a:b@localhost:5432/minuteria', 'postgres://c:d@127.0.0.1/minuteria'), true);
  assert.equal(stessoIndirizzo('postgres://a:b@127.0.0.1:5433/minuteria', 'postgres://a:b@127.0.0.1:5433/minuteria?sslmode=disable'), true);
  // Stesso nome ma porta diversa (il tunnel verso il server e il Postgres del PC): sono due database.
  assert.equal(stessoIndirizzo('postgres://a:b@127.0.0.1:5433/minuteria', 'postgres://a:b@127.0.0.1:5432/minuteria'), false);
  assert.equal(stessoIndirizzo('postgres://a:b@127.0.0.1:5432/minuteria', 'postgres://a:b@127.0.0.1:5432/flash_app'), false);
  assert.equal(stessoIndirizzo('postgres://a:b@db1.esempio.it/minuteria', 'postgres://a:b@db2.esempio.it/minuteria'), false);
});

test('nomeUtenteBanco: «banco-» + la filiale in minuscolo, senza accenti né simboli, al massimo 30 caratteri', () => {
  assert.equal(nomeUtenteBanco('Banco Genova Fegino'), 'banco-genova-fegino');
  assert.equal(nomeUtenteBanco('Banco Genova Staglieno'), 'banco-genova-staglieno');
  assert.equal(nomeUtenteBanco('Filiale d\'Èlite & C.'), 'banco-filiale-d-elite-c');
  assert.equal(nomeUtenteBanco(''), 'banco-filiale');
  const lungo = nomeUtenteBanco('Banco di una filiale con un nome davvero molto ma molto lungo');
  assert.ok(lungo.length <= 30, lungo);
  assert.match(lungo, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

// Legge lo schema e ritorna, per ogni tabella, le tabelle a cui rimanda (REFERENCES nel CREATE TABLE e nei ADD COLUMN).
function legamiDelloSchema() {
  const testo = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  const legami = new Map();
  const aggiungi = (tabella, riferita) => {
    if (!legami.has(tabella)) legami.set(tabella, new Set());
    legami.get(tabella).add(riferita);
  };
  for (const m of testo.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    if (!legami.has(m[1])) legami.set(m[1], new Set());
    for (const r of m[2].matchAll(/REFERENCES (\w+)\(/g)) aggiungi(m[1], r[1]);
  }
  for (const m of testo.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS \w+ [^;]*?REFERENCES (\w+)\(/g)) aggiungi(m[1], m[2]);
  return legami;
}

test('il lettore dello schema vede i legami noti (altrimenti le prove qui sotto non direbbero niente)', () => {
  const legami = legamiDelloSchema();
  assert.ok(legami.get('distributor_products').has('distributors'), 'CREATE TABLE ... REFERENCES');
  assert.ok(legami.get('distributor_products').has('products'));
  assert.ok(legami.get('products').has('product_groups'), 'ALTER TABLE ... ADD COLUMN ... REFERENCES');
  assert.ok(legami.get('distributors').has('ditte'));
  assert.ok(legami.get('orders').has('users'), 'legame verso le persone');
});

test('le tabelle da copiare esistono nello schema e non sono ripetute', () => {
  const legami = legamiDelloSchema();
  const nomi = TABELLE.map((t) => t.nome);
  assert.equal(new Set(nomi).size, nomi.length, 'una tabella è nell\'elenco due volte');
  for (const nome of nomi) assert.ok(legami.has(nome), `${nome} non esiste in db/schema.sql`);
});

test('ogni tabella copiata rimanda solo a tabelle copiate PRIMA di lei (e mai a persone, ordini o pagamenti)', () => {
  const legami = legamiDelloSchema();
  const nomi = TABELLE.map((t) => t.nome);
  for (const [posizione, nome] of nomi.entries()) {
    for (const riferita of legami.get(nome)) {
      if (riferita === nome) continue;
      const dove = nomi.indexOf(riferita);
      assert.ok(dove !== -1, `${nome} rimanda a ${riferita}, che la copia non porta: la copia si fermerebbe sul legame (aggiungi ${riferita} all'elenco o togli il legame)`);
      assert.ok(dove < posizione, `${nome} rimanda a ${riferita}, che nell'elenco viene DOPO: va scritta prima`);
    }
  }
});

test('l\'elenco non copia mai persone, ordini, richieste, pagamenti, sessioni o token', () => {
  const vietate = ['users', 'orders', 'order_items', 'requests', 'request_items', 'request_responses', 'request_response_items', 'notifications', 'client_distributors',
    'client_discounts', 'client_discount_rules', 'session', 'app_tokens', 'whatsapp_messaggi', 'stripe_pagamenti', 'ricevute', 'dispositivi_push', 'recupero_password', 'iscrizioni_push'];
  const nomi = TABELLE.map((t) => t.nome);
  for (const v of vietate) assert.ok(!nomi.includes(v), `${v} non deve essere copiata nell'ambiente app`);
});
