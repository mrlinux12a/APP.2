// Il giro completo dell'app dei corrieri su un Postgres VERO (src/routes/api_v1/corrieri_consegne.js, src/logica/corrieri/consegne.js): l'installatore invia la richiesta,
// il banco conferma, i corrieri la vedono, il primo accetta, ritira, consegna. Gli altri test usano un DB finto in memoria; questo usa il database per davvero, perché le
// parti più delicate (un corriere = una consegna alla volta, il primo che accetta vince, l'ordine che nasce, gli stati del banco) stanno nelle query.
//
// Parte SOLO se TEST_DATABASE_URL punta a un database sul computer stesso il cui nome comincia per «prova_» (per esempio
// postgres://postgres:postgres@127.0.0.1:5432/prova_corrieri, con lo schema già applicato: `DATABASE_URL=... node scripts/db/apply_schema_pg.js`). Altrimenti viene
// saltato, come in `npm test`. ATTENZIONE: all'inizio SVUOTA utenti, banchi e prodotti di quel database e ci scrive i dati di prova: mai su un database vero (per
// questo l'indirizzo viene controllato prima di toccare qualsiasi cosa). La guida per prepararlo è in docs/ambienti.md.
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_PROVA = process.env.TEST_DATABASE_URL || '';

// Il database di prova sta sul computer stesso e si chiama prova_...: è l'unico che questo test accetta di svuotare.
function urlLocaleDiProva(url) {
  try {
    const u = new URL(url);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && /^\/prova_[a-z0-9_]+$/.test(u.pathname);
  } catch (e) {
    return false;
  }
}

const motivoSalto = !URL_PROVA
  ? 'manca TEST_DATABASE_URL (prova su un Postgres locale, vedi l\'intestazione di questo file)'
  : !urlLocaleDiProva(URL_PROVA)
  ? 'TEST_DATABASE_URL non punta a un database «prova_...» sul computer stesso: per sicurezza non parto'
  : false;

if (motivoSalto) test('app dei corrieri su Postgres vero', { skip: motivoSalto }, () => {});
else eseguiProve();

function eseguiProve() {
  // L'ambiente di questa prova: l'ambiente «app», senza WhatsApp, senza chiamate alle mappe (il tragitto è la stima in linea d'aria) e con le push dirette a un invio
  // finto. Va scritto PRIMA di caricare i moduli, che leggono il database dall'ambiente.
  Object.assign(process.env, {
    DATABASE_URL: URL_PROVA,
    CORRIERI_APP: '1',
    WHATSAPP_ATTIVO: '0',
    ROUTING_ATTIVO: '0',
    GOOGLE_MAPS_API_KEY: '',
    ROUTING_URL: '',
    LIMITE_RICHIESTE_DISATTIVATO: '1',
    FINESTRA_CONFERMA_SEC: '',
    APP_URL: '',
  });
  delete process.env.FINESTRA_CONFERMA_SEC;

  const express = require('express');
  const db = require('../../db');
  const { seed } = require('../../db/seed');
  const apiV1 = require('../../src/routes/api_v1');
  const flusso = require('../../src/logica/ordini/flusso_cliente');
  const richieste = require('../../src/logica/ordini/richieste');
  const push = require('../../src/logica/notifiche/push');
  const limite = require('../../src/logica/account/limite_login');

  const SEMPRE_APERTO = Object.fromEntries(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((g) => [g, [['00:00', '23:59']]]));
  const INDIRIZZO_CANTIERE = 'Via Tortona 3, 16139 Genova GE';
  const BANCO = { lat: 44.4577, lng: 8.8877 }; // Fegino
  const CANTIERE = { lat: 44.4175, lng: 8.8939 }; // Via Tortona
  const POS_A = { lat: 44.4056, lng: 8.9463 }; // il corriere A sta in centro
  const POS_B = { lat: 44.4949, lng: 8.8800 }; // il corriere B è più lontano
  const TOKEN_PUSH_A = 'ExponentPushToken[AAAAAAAAAAAAAAAAAAAAAA]';
  const TOKEN_PUSH_B = 'ExponentPushToken[BBBBBBBBBBBBBBBBBBBBBB]';

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiV1);
  let server;
  let base;

  // Quello che i test si passano l'un l'altro (le prove vanno in fila, nell'ordine del file).
  const s = { A: {}, B: {}, invii: [] };
  let borea;
  let utenteBanco;
  let rossi;
  let prodotto;

  // Una chiamata all'API: { status, json }.
  const api = async (metodo, percorso, { token, corpo } = {}) => {
    const r = await fetch(base + percorso, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let json = null;
    try {
      json = await r.json();
    } catch (e) {
      json = null;
    }
    return { status: r.status, json };
  };
  const conPos = (p) => `?lat=${p.lat}&lng=${p.lng}`;
  const notificheDi = (userId) => db.prepare('SELECT titolo, testo FROM notifications WHERE user_id = ? ORDER BY id').all(userId);
  const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
  // Aspetta (al massimo 3 s) che una condizione diventi vera: le notifiche push partono senza che nessuno le aspetti.
  const finche = async (condizione) => {
    for (let i = 0; i < 60; i++) {
      if (await condizione()) return true;
      await attendi(50);
    }
    return false;
  };

  // Un'altra richiesta dell'installatore, già confermata dal banco e in attesa di un corriere.
  async function richiestaConfermata() {
    const righe = await flusso.righeDaQuantita([{ id: prodotto.id, quantita: 2 }]);
    const requestId = await flusso.nuovaRichiesta(rossi.id, righe, { destinazione: INDIRIZZO_CANTIERE, note: 'Citofono Rossi' });
    const esito = await richieste.rispondi(requestId, borea.id, { prezzoRichiesto: true, utenteId: utenteBanco.id });
    assert.equal(esito.ok, true, JSON.stringify(esito));
    assert.equal(esito.attesaCorriere, true, 'nell\'ambiente app la conferma del banco aspetta un corriere');
    const risposta = await db.prepare('SELECT id FROM request_responses WHERE request_id = ? AND distributor_id = ?').get(requestId, borea.id);
    return { requestId, rispostaId: risposta.id };
  }

  test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((fatto) => server.once('listening', fatto));
    base = `http://127.0.0.1:${server.address().port}/api/v1`;

    // Le push vanno a un invio finto: si guarda a chi sono state mandate.
    push.impostaInvio(async (url, opzioni) => {
      const messaggi = JSON.parse(opzioni.body);
      s.invii.push(...messaggi);
      return { ok: true, json: async () => ({ data: messaggi.map(() => ({ status: 'ok' })) }) };
    });

    // Database pulito + dati demo (banchi, installatori, legami) + i ritocchi che servono qui.
    await db.prepare('TRUNCATE TABLE users, distributors, products RESTART IDENTITY CASCADE').run();
    await seed();
    borea = await db.prepare("SELECT * FROM distributors WHERE nome = 'BOREA SRL'").get();
    await db.prepare('UPDATE distributors SET attivo = 0 WHERE id <> ?').run(borea.id);
    await db
      .prepare('UPDATE distributors SET orari = ?::jsonb, geo_lat = ?, geo_lng = ?, telefono = ? WHERE id = ?')
      .run(JSON.stringify(SEMPRE_APERTO), BANCO.lat, BANCO.lng, '010 716871', borea.id);
    utenteBanco = await db.prepare("SELECT * FROM users WHERE username = 'borea'").get();
    await db.prepare("UPDATE users SET geo_lat = ?, geo_lng = ?, geo_consenso = 1, telefono = '333 0000001' WHERE username = 'rossi'").run(CANTIERE.lat, CANTIERE.lng);
    rossi = await db.prepare("SELECT * FROM users WHERE username = 'rossi'").get();
    await db.prepare("INSERT INTO products (codice, nome, categoria, prezzo_listino, sconto_base_pct) VALUES ('PROVA-001', 'Raccordo di prova', 'Raccordi', 100, 0)").run();
    prodotto = await db.prepare("SELECT * FROM products WHERE codice = 'PROVA-001'").get();
    limite.svuotaTutto();
  });

  test.after(async () => {
    push.impostaInvio((url, opzioni) => fetch(url, opzioni));
    await new Promise((fatto) => server.close(fatto));
  });

  // ---------------- registrazione e disponibilità ----------------

  test('due corrieri si registrano dall\'app, entrano subito e registrano il telefono per le notifiche', async () => {
    for (const [chi, dati, tokenPush] of [
      ['A', { nome: 'Marco', cognome: 'Bianchi', email: 'marco@example.com' }, TOKEN_PUSH_A],
      ['B', { nome: 'Luca', cognome: 'Verdi', email: 'luca@example.com' }, TOKEN_PUSH_B],
    ]) {
      const r = await api('POST', '/corrieri/registrati', { corpo: { ...dati, password: 'password-lunga', dispositivo: 'android' } });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      s[chi].token = r.json.token;
      s[chi].id = r.json.utente.id;
      s[chi].nome = `${dati.nome} ${dati.cognome}`;
      const d = await api('POST', '/corrieri/dispositivi', { token: s[chi].token, corpo: { token: tokenPush, piattaforma: 'android' } });
      assert.equal(d.status, 200, JSON.stringify(d.json));
    }
    const sbagliato = await api('POST', '/corrieri/dispositivi', { token: s.A.token, corpo: { token: 'non-un-token' } });
    assert.equal(sbagliato.status, 400);
    // Senza token o con quello di un installatore l'API del lavoro non si apre.
    assert.equal((await api('GET', '/corrieri/richieste')).status, 401);
    const inst = await api('POST', '/login', { corpo: { username: 'rossi', password: 'cliente123' } });
    assert.equal(inst.status, 200);
    assert.equal((await api('GET', '/corrieri/richieste', { token: inst.json.token })).status, 403);
    assert.equal((await api('GET', '/corrieri/in-corso', { token: inst.json.token })).status, 403);
  });

  test('da spento «Sei disponibile» l\'elenco è vuoto e lo dice; si accende e si spegne con true/false', async () => {
    const spento = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.deepEqual(spento.json, { disponibile: false, in_corso: false, richieste: [] });
    assert.equal((await api('GET', '/corrieri/disponibilita', { token: s.A.token })).json.disponibile, false);

    for (const corpo of [{}, { disponibile: 'si' }, { disponibile: 1 }, undefined]) {
      const r = await api('PUT', '/corrieri/disponibilita', { token: s.A.token, corpo });
      assert.equal(r.status, 400, String(JSON.stringify(corpo)));
      assert.equal(r.json.codice, 'dato_non_valido');
    }
    const acceso = await api('PUT', '/corrieri/disponibilita', { token: s.A.token, corpo: { disponibile: true } });
    assert.deepEqual(acceso.json, { disponibile: true });
    assert.equal((await api('GET', '/corrieri/disponibilita', { token: s.A.token })).json.disponibile, true);
    const vuoto = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.deepEqual(vuoto.json, { disponibile: true, in_corso: false, posizione: true, richieste: [] }, 'il banco non ha ancora confermato niente');
  });

  // ---------------- la richiesta arriva ai corrieri ----------------

  test('il banco conferma: la richiesta aspetta un corriere, compare nell\'app e la notifica parte solo ai corrieri disponibili', async () => {
    const r = await richiestaConfermata();
    Object.assign(s, r);
    const risposta = await db.prepare('SELECT * FROM request_responses WHERE id = ?').get(r.rispostaId);
    assert.equal(risposta.esito, 'confermato');
    assert.equal(risposta.corriere_stato, 'in_attesa');
    assert.ok(Number(risposta.consegna_minuti_stimati) > 0, 'il tragitto banco → cantiere è stato scritto');
    assert.ok(Number(risposta.consegna_km) > 0, 'e anche i suoi km');
    assert.equal(risposta.corriere_id, null);
    const richiesta = await db.prepare('SELECT stato FROM requests WHERE id = ?').get(r.requestId);
    assert.equal(richiesta.stato, 'in_attesa', 'l\'installatore non sa ancora niente: l\'ordine non c\'è');
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders').get()).n, 0);

    // La notifica «Nuova richiesta di consegna» va ad A (disponibile), non a B (spento).
    assert.ok(await finche(() => s.invii.length >= 1), 'la notifica doveva partire');
    await attendi(200);
    assert.deepEqual([...new Set(s.invii.map((m) => m.to))], [TOKEN_PUSH_A]);
    assert.equal(s.invii[0].title, 'Nuova richiesta di consegna');
    assert.match(s.invii[0].body, /Ritiro da BOREA · Banco Genova Fegino/);
    assert.equal(s.invii[0].data.link, '/corriere/richieste/' + r.rispostaId);
  });

  test('l\'elenco mostra la scheda: ditta e zona del ritiro, zona della consegna, tempo e km totali; B (spento) non vede niente', async () => {
    const r = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.equal(r.status, 200);
    assert.equal(r.json.richieste.length, 1);
    const scheda = r.json.richieste[0];
    assert.equal(scheda.id, s.rispostaId);
    assert.equal(scheda.ritiro.ditta, 'BOREA');
    assert.equal(scheda.ritiro.zona, 'Banco Genova Fegino');
    assert.equal(scheda.consegna.zona, 'Genova');
    assert.ok(scheda.tempo_totale_min > 0 && Number.isInteger(scheda.tempo_totale_min), 'tempo totale: ' + scheda.tempo_totale_min);
    assert.ok(scheda.km_totali > 0, 'km totali: ' + scheda.km_totali);
    assert.ok(scheda.fa_secondi >= 0);
    // Senza la posizione la richiesta si vede lo stesso, ma senza tempo né km totali (non si sa da dove parte il corriere).
    const senza = (await api('GET', '/corrieri/richieste', { token: s.A.token })).json;
    assert.equal(senza.richieste.length, 1);
    assert.equal(senza.richieste[0].tempo_totale_min, null);
    assert.equal(senza.richieste[0].km_totali, null);
    // B è spento: niente richieste.
    const b = await api('GET', '/corrieri/richieste' + conPos(POS_B), { token: s.B.token });
    assert.deepEqual(b.json, { disponibile: false, in_corso: false, richieste: [] });
  });

  test('il dettaglio ha il banco (indirizzo, telefono, orari), il cantiere, i tempi delle due tratte e il link a Google Maps', async () => {
    const r = await api('GET', `/corrieri/richieste/${s.rispostaId}` + conPos(POS_A), { token: s.A.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const d = r.json;
    assert.equal(d.id, s.rispostaId);
    assert.equal(d.banco.ditta, 'BOREA');
    assert.equal(d.banco.filiale, 'Banco Genova Fegino');
    assert.match(d.banco.indirizzo, /Via Castel Morrone 1/);
    assert.equal(d.banco.telefono, '010 716871');
    assert.equal(d.banco.orari.aperto, true);
    assert.match(d.banco.orari.testo, /^Banco aperto 0:00 – 23:59/);
    assert.equal(d.cantiere.installatore, 'Rossi Impianti S.r.l.');
    assert.equal(d.cantiere.indirizzo, INDIRIZZO_CANTIERE);
    assert.equal(d.cantiere.zona, 'Genova');
    assert.equal(d.cantiere.note, 'Citofono Rossi');
    assert.ok(d.alla_sede.minuti > 0 && d.alla_sede.km > 0, 'tratta fino al banco');
    assert.ok(d.al_cantiere.minuti > 0 && d.al_cantiere.km > 0, 'tratta banco → cantiere');
    assert.equal(d.tempo_totale_min, d.alla_sede.minuti + d.al_cantiere.minuti);
    assert.equal(Math.round(d.km_totali * 10), Math.round((d.alla_sede.km + d.al_cantiere.km) * 10));
    // Le due tappe: 1) dal telefono al banco (nessuna partenza scritta), 2) dal banco al cantiere.
    const tappaBanco = new URL(d.mappe.al_banco);
    assert.equal(tappaBanco.searchParams.get('origin'), null);
    assert.equal(tappaBanco.searchParams.get('destination'), `${BANCO.lat},${BANCO.lng}`);
    const tappaCantiere = new URL(d.mappe.al_cantiere);
    assert.equal(tappaCantiere.searchParams.get('origin'), `${BANCO.lat},${BANCO.lng}`);
    assert.equal(tappaCantiere.searchParams.get('destination'), `${CANTIERE.lat},${CANTIERE.lng}`);
    const mappa = new URL(d.mappe.percorso);
    assert.equal(mappa.origin + mappa.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(mappa.searchParams.get('origin'), `${BANCO.lat},${BANCO.lng}`);
    assert.equal(mappa.searchParams.get('destination'), `${CANTIERE.lat},${CANTIERE.lng}`);
    s.tempoAlBanco = d.alla_sede.minuti;

    assert.equal((await api('GET', '/corrieri/richieste/999999' + conPos(POS_A), { token: s.A.token })).status, 404);
    assert.equal((await api('GET', '/corrieri/richieste/abc', { token: s.A.token })).status, 404, 'un id che non è un numero non esiste');
  });

  // ---------------- accettare ----------------

  test('accetta: senza posizione 400; da spento 409; con la posizione l\'ordine nasce, col corriere scritto e banco e installatore avvisati', async () => {
    const senzaPos = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.A.token, corpo: {} });
    assert.equal(senzaPos.status, 400);
    assert.equal(senzaPos.json.codice, 'posizione_mancante');
    const posFinta = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.A.token, corpo: { lat: 0, lng: 0 } });
    assert.equal(posFinta.json.codice, 'posizione_mancante', '(0, 0) non è una posizione');
    const spento = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.B.token, corpo: POS_B });
    assert.equal(spento.status, 409);
    assert.equal(spento.json.codice, 'non_disponibile');
    assert.equal((await db.prepare('SELECT corriere_stato FROM request_responses WHERE id = ?').get(s.rispostaId)).corriere_stato, 'in_attesa', 'niente è cambiato');

    const r = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.ok(r.json.ordine_id > 0, 'l\'ordine è nato subito');
    s.ordineId = r.json.ordine_id;

    const risposta = await db.prepare('SELECT * FROM request_responses WHERE id = ?').get(s.rispostaId);
    assert.equal(risposta.corriere_stato, 'preso');
    assert.equal(risposta.corriere_id, s.A.id);
    assert.equal(risposta.corriere_nome, 'Marco Bianchi');
    assert.ok(risposta.corriere_minuti > 0 && risposta.corriere_minuti >= 1);
    assert.ok(Number(risposta.corriere_km) > 0, 'i km fino al banco');
    const richiesta = await db.prepare('SELECT stato, order_id FROM requests WHERE id = ?').get(s.requestId);
    assert.equal(richiesta.stato, 'ordinata');
    assert.equal(Number(richiesta.order_id), s.ordineId);
    const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(s.ordineId);
    assert.equal(ordine.corriere_id, s.A.id);
    assert.equal(ordine.corriere_nome, 'Marco Bianchi');
    assert.equal(ordine.stato, 'inviato');
    assert.equal(ordine.ritirato_il, null);
    assert.equal(ordine.consegnato_il, null);
    assert.ok(ordine.corriere_arrivo_il, 'l\'installatore sa quando arriva la merce');

    const banco = (await notificheDi(utenteBanco.id)).map((n) => n.titolo);
    assert.ok(banco.includes('Nuovo ordine da preparare'), banco.join(' | '));
    const testoBanco = (await notificheDi(utenteBanco.id)).find((n) => n.titolo === 'Nuovo ordine da preparare').testo;
    assert.match(testoBanco, /Il corriere Marco Bianchi ritira alle \d\d:\d\d/);
    assert.ok((await notificheDi(rossi.id)).some((n) => n.titolo === 'Ordine confermato'));
  });

  test('accettare due volte non fa danni; un altro corriere arrivato dopo trova 410 e la richiesta sparita dal suo elenco', async () => {
    const ancora = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(ancora.status, 200, JSON.stringify(ancora.json));
    assert.equal(ancora.json.ordine_id, s.ordineId, 'stessa consegna, stesso ordine');
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders').get()).n, 1, 'nessun secondo ordine');

    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: true } });
    const tardi = await api('POST', `/corrieri/richieste/${s.rispostaId}/accetta`, { token: s.B.token, corpo: POS_B });
    assert.equal(tardi.status, 410);
    assert.equal(tardi.json.codice, 'gia_accettata');
    const dettaglio = await api('GET', `/corrieri/richieste/${s.rispostaId}` + conPos(POS_B), { token: s.B.token });
    assert.equal(dettaglio.status, 410);
    assert.equal(dettaglio.json.codice, 'gia_accettata');
    const proprio = await api('GET', `/corrieri/richieste/${s.rispostaId}` + conPos(POS_A), { token: s.A.token });
    assert.equal(proprio.status, 410);
    assert.equal(proprio.json.codice, 'tua', 'chi l\'ha presa lo sa: l\'app lo porta alla consegna');
    const elencoB = await api('GET', '/corrieri/richieste' + conPos(POS_B), { token: s.B.token });
    assert.deepEqual(elencoB.json, { disponibile: true, in_corso: false, posizione: true, richieste: [] });
    assert.equal((await db.prepare('SELECT corriere_id FROM request_responses WHERE id = ?').get(s.rispostaId)).corriere_id, s.A.id, 'la consegna resta di A');
    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: false } });
  });

  // ---------------- le due fasi della consegna ----------------

  test('in corso, fase 1 «Vai al ritiro»: il codice, il banco, il cantiere, i tempi e i link alle mappe', async () => {
    const r = await api('GET', '/corrieri/in-corso', { token: s.A.token });
    assert.equal(r.status, 200);
    const c = r.json.consegna;
    assert.equal(c.ordine_id, s.ordineId);
    assert.equal(c.codice, '#' + s.ordineId);
    assert.equal(c.fase, 1);
    assert.equal(c.ritirato_il, null);
    assert.equal(c.banco.ditta, 'BOREA');
    assert.equal(c.cantiere.installatore, 'Rossi Impianti S.r.l.');
    assert.equal(c.cantiere.indirizzo, INDIRIZZO_CANTIERE);
    assert.equal(c.cantiere.telefono, '333 0000001');
    assert.equal(c.al_banco.minuti, s.tempoAlBanco, 'i minuti fino al banco sono quelli visti nel dettaglio');
    assert.ok(c.al_cantiere.minuti > 0 && c.al_cantiere.km > 0);
    assert.match(c.arrivo_stimato, /^\d\d:\d\d$/);
    assert.ok(c.mappe.al_banco.startsWith('https://www.google.com/maps/dir/?'));
    assert.equal(new URL(c.mappe.al_banco).searchParams.get('destination'), `${BANCO.lat},${BANCO.lng}`);
    assert.equal(new URL(c.mappe.al_cantiere).searchParams.get('destination'), `${CANTIERE.lat},${CANTIERE.lng}`);
    // Per B (che non ha consegne) non c'è niente.
    assert.deepEqual((await api('GET', '/corrieri/in-corso', { token: s.B.token })).json, { consegna: null });
    // Con una consegna in corso l'elenco non mostra richieste e lo dice.
    const elenco = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.deepEqual(elenco.json, { disponibile: true, in_corso: true, richieste: [] });
  });

  test('«consegna confermata» prima del ritiro è rifiutata; la consegna di un altro corriere non esiste', async () => {
    const presto = await api('POST', `/corrieri/consegne/${s.ordineId}/consegnato`, { token: s.A.token });
    assert.equal(presto.status, 409);
    assert.equal(presto.json.codice, 'non_ritirato');
    assert.equal((await db.prepare('SELECT consegnato_il FROM orders WHERE id = ?').get(s.ordineId)).consegnato_il, null);
    for (const azione of ['ritirato', 'consegnato']) {
      const altrui = await api('POST', `/corrieri/consegne/${s.ordineId}/${azione}`, { token: s.B.token });
      assert.equal(altrui.status, 404, azione);
      assert.equal(altrui.json.codice, 'ordine_non_trovato');
    }
    assert.equal((await api('GET', `/corrieri/consegne/${s.ordineId}/riepilogo`, { token: s.B.token })).status, 404);
    assert.equal((await api('POST', '/corrieri/consegne/999999/ritirato', { token: s.A.token })).status, 404);
  });

  test('«ho ritirato il materiale»: fase 2, l\'ordine del banco passa a «In consegna», banco e installatore avvisati una volta sola', async () => {
    const r = await api('POST', `/corrieri/consegne/${s.ordineId}/ritirato`, { token: s.A.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.consegna.fase, 2);
    assert.ok(r.json.consegna.ritirato_il);
    assert.match(r.json.consegna.ritirato_alle, /^\d\d:\d\d$/);
    const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(s.ordineId);
    assert.ok(ordine.ritirato_il);
    assert.equal(ordine.stato, 'in_evasione', 'il banco lo vede in «In consegna»');
    assert.ok(ordine.in_evasione_il);

    const titoliBanco = () => notificheDi(utenteBanco.id).then((n) => n.map((x) => x.titolo));
    const titoliInstallatore = () => notificheDi(rossi.id).then((n) => n.map((x) => x.titolo));
    assert.equal((await titoliBanco()).filter((t) => t === `Ordine #${s.ordineId} ritirato`).length, 1);
    assert.equal((await titoliInstallatore()).filter((t) => t === 'Materiale ritirato').length, 1);

    // Ripetere il tocco (rete lenta, doppio clic) non cambia l'orario del ritiro e non avvisa di nuovo.
    const ancora = await api('POST', `/corrieri/consegne/${s.ordineId}/ritirato`, { token: s.A.token });
    assert.equal(ancora.status, 200);
    assert.equal(ancora.json.consegna.ritirato_il, r.json.consegna.ritirato_il);
    assert.equal((await titoliBanco()).filter((t) => t === `Ordine #${s.ordineId} ritirato`).length, 1);
    assert.equal((await titoliInstallatore()).filter((t) => t === 'Materiale ritirato').length, 1);
    assert.equal((await api('GET', '/corrieri/in-corso', { token: s.A.token })).json.consegna.fase, 2, 'la fase 2 resta anche riaprendo l\'app');
  });

  test('«consegna confermata»: riepilogo, ordine consegnato, banco e installatore avvisati una volta sola; il corriere torna libero', async () => {
    const r = await api('POST', `/corrieri/consegne/${s.ordineId}/consegnato`, { token: s.A.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    const riep = r.json.riepilogo;
    assert.equal(riep.ordine_id, s.ordineId);
    assert.equal(riep.codice, '#' + s.ordineId);
    assert.match(riep.ritirata_alle, /^\d\d:\d\d$/);
    assert.match(riep.consegnata_alle, /^\d\d:\d\d$/);
    assert.ok(riep.tempo_effettivo_min >= 1);
    assert.ok(riep.tempo_stimato_min > 0);
    assert.ok(riep.distanza_km > 0);
    const ordine = await db.prepare('SELECT consegnato_il FROM orders WHERE id = ?').get(s.ordineId);
    assert.ok(ordine.consegnato_il);

    const nBanco = (await notificheDi(utenteBanco.id)).filter((n) => n.titolo === `Ordine #${s.ordineId} consegnato`).length;
    const nInstallatore = (await notificheDi(rossi.id)).filter((n) => n.titolo === 'Ordine consegnato').length;
    assert.equal(nBanco, 1);
    assert.equal(nInstallatore, 1);
    const ancora = await api('POST', `/corrieri/consegne/${s.ordineId}/consegnato`, { token: s.A.token });
    assert.equal(ancora.status, 200);
    assert.deepEqual(ancora.json.riepilogo, riep, 'stesso riepilogo, nessuna nuova scrittura');
    assert.equal((await notificheDi(utenteBanco.id)).filter((n) => n.titolo === `Ordine #${s.ordineId} consegnato`).length, 1);
    assert.equal((await notificheDi(rossi.id)).filter((n) => n.titolo === 'Ordine consegnato').length, 1);

    assert.deepEqual((await api('GET', `/corrieri/consegne/${s.ordineId}/riepilogo`, { token: s.A.token })).json, riep);
    assert.deepEqual((await api('GET', '/corrieri/in-corso', { token: s.A.token })).json, { consegna: null });
    const elenco = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.equal(elenco.json.in_corso, false, 'dopo la consegna è di nuovo libero');
  });

  // ---------------- una consegna alla volta, il primo vince ----------------

  test('un corriere ha una consegna sola alla volta: la seconda accettazione è rifiutata e la prende un altro', async () => {
    const r2 = await richiestaConfermata();
    const r3 = await richiestaConfermata();
    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: true } });
    const elenco = await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token });
    assert.equal(elenco.json.richieste.length, 2, 'A vede le due richieste');

    const prima = await api('POST', `/corrieri/richieste/${r2.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(prima.status, 200, JSON.stringify(prima.json));
    const seconda = await api('POST', `/corrieri/richieste/${r3.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(seconda.status, 409);
    assert.equal(seconda.json.codice, 'gia_in_consegna');
    assert.equal((await db.prepare('SELECT corriere_stato FROM request_responses WHERE id = ?').get(r3.rispostaId)).corriere_stato, 'in_attesa', 'la seconda è rimasta libera');
    assert.equal((await db.prepare('SELECT stato FROM requests WHERE id = ?').get(r3.requestId)).stato, 'in_attesa');

    // Due accettazioni insieme dello STESSO corriere: ne passa una sola (l'altra o è la stessa, o è rifiutata).
    const r4 = await richiestaConfermata();
    const insieme = await Promise.all([
      api('POST', `/corrieri/richieste/${r3.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A }),
      api('POST', `/corrieri/richieste/${r4.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A }),
    ]);
    assert.deepEqual(insieme.map((x) => x.status), [409, 409], 'A è già occupato con r2: nessuna delle due passa');

    // B prende la r3; chi arriva dopo di lui (A, ormai occupato, e un terzo che accetta insieme a B) non la ottiene.
    const [dueB, tardoA] = await Promise.all([
      api('POST', `/corrieri/richieste/${r3.rispostaId}/accetta`, { token: s.B.token, corpo: POS_B }),
      api('POST', `/corrieri/richieste/${r3.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A }),
    ]);
    assert.equal(dueB.status, 200, JSON.stringify(dueB.json));
    assert.ok([409, 410].includes(tardoA.status), 'A: ' + tardoA.status);
    assert.equal((await db.prepare('SELECT corriere_id FROM request_responses WHERE id = ?').get(r3.rispostaId)).corriere_id, s.B.id);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders WHERE corriere_id = ? AND consegnato_il IS NULL').get(s.A.id)).n, 1);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders WHERE corriere_id = ? AND consegnato_il IS NULL').get(s.B.id)).n, 1);

    // Si portano a termine tutte e due, così i corrieri tornano liberi per le prove dopo.
    for (const [chi, ordineId] of [['A', prima.json.ordine_id], ['B', dueB.json.ordine_id]]) {
      assert.equal((await api('POST', `/corrieri/consegne/${ordineId}/ritirato`, { token: s[chi].token })).status, 200);
      assert.equal((await api('POST', `/corrieri/consegne/${ordineId}/consegnato`, { token: s[chi].token })).status, 200);
    }
    s.rimasta = r4;
    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: false } });
  });

  // Porta a termine una consegna del corriere `chi` (ritirato + consegnato), così torna libero.
  async function completa(chi, ordineId) {
    assert.equal((await api('POST', `/corrieri/consegne/${ordineId}/ritirato`, { token: s[chi].token })).status, 200);
    assert.equal((await api('POST', `/corrieri/consegne/${ordineId}/consegnato`, { token: s[chi].token })).status, 200);
  }

  test('due accettazioni INSIEME dello stesso corriere libero: ne passa esattamente una (provato più volte di fila)', async () => {
    await api('PUT', '/corrieri/disponibilita', { token: s.A.token, corpo: { disponibile: true } });
    for (let giro = 1; giro <= 5; giro++) {
      const x = await richiestaConfermata();
      const y = await richiestaConfermata();
      const esiti = await Promise.all([
        api('POST', `/corrieri/richieste/${x.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A }),
        api('POST', `/corrieri/richieste/${y.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A }),
      ]);
      assert.deepEqual(esiti.map((e) => e.status).sort(), [200, 409], `giro ${giro}: ${JSON.stringify(esiti.map((e) => e.json))}`);
      const vinta = esiti.find((e) => e.status === 200);
      assert.equal(esiti.find((e) => e.status === 409).json.codice, 'gia_in_consegna');
      const prese = await db
        .prepare("SELECT COUNT(*)::int AS n FROM request_responses WHERE corriere_id = ? AND corriere_stato = 'preso' AND request_id IN (?, ?)")
        .get(s.A.id, x.requestId, y.requestId);
      assert.equal(prese.n, 1, `giro ${giro}: una consegna sola presa`);
      assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders WHERE corriere_id = ? AND consegnato_il IS NULL').get(s.A.id)).n, 1);
      await completa('A', vinta.json.ordine_id);
    }
  });

  test('una consegna presa ma rimasta senza ordine (guasto passeggero) viene completata aprendo «In corso»', async () => {
    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: true } });
    const { requestId, rispostaId } = await richiestaConfermata();
    // Come se l'accettazione fosse stata scritta e la creazione dell'ordine fosse fallita subito dopo.
    await db
      .prepare(
        `UPDATE request_responses
            SET corriere_stato = 'preso', corriere_id = ?, corriere_nome = 'Luca Verdi', corriere_minuti = 7, corriere_km = 2.1, corriere_preso_il = NOW(),
                consegna_minuti_stimati = consegna_minuti_stimati + 7
          WHERE id = ?`
      )
      .run(s.B.id, rispostaId);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM orders WHERE request_id = ?').get(requestId)).n, 0);
    // Intanto B non può prendere altro e l'elenco lo dice.
    assert.equal((await api('GET', '/corrieri/richieste' + conPos(POS_B), { token: s.B.token })).json.in_corso, true);

    const r = await api('GET', '/corrieri/in-corso', { token: s.B.token });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.consegna, JSON.stringify(r.json));
    assert.equal(r.json.consegna.fase, 1);
    assert.equal(r.json.consegna.al_banco.minuti, 7);
    const ordine = await db.prepare('SELECT * FROM orders WHERE request_id = ?').get(requestId);
    assert.equal(ordine.corriere_id, s.B.id);
    assert.equal(r.json.consegna.ordine_id, ordine.id);
    await completa('B', ordine.id);
    await api('PUT', '/corrieri/disponibilita', { token: s.B.token, corpo: { disponibile: false } });
  });

  test('se il banco elimina l\'ordine mentre il corriere è in viaggio, la consegna sparisce senza errori e il corriere può prenderne un\'altra', async () => {
    const banco = require('../../src/logica/banco/banco');
    const { rispostaId } = await richiestaConfermata();
    const presa = await api('POST', `/corrieri/richieste/${rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(presa.status, 200, JSON.stringify(presa.json));
    const ordineId = presa.json.ordine_id;
    assert.equal((await api('GET', '/corrieri/in-corso', { token: s.A.token })).json.consegna.ordine_id, ordineId);

    await banco.eliminaOrdineDalBanco(await db.prepare('SELECT * FROM orders WHERE id = ?').get(ordineId));
    assert.deepEqual((await api('GET', '/corrieri/in-corso', { token: s.A.token })).json, { consegna: null });
    for (const azione of ['ritirato', 'consegnato']) {
      const r = await api('POST', `/corrieri/consegne/${ordineId}/${azione}`, { token: s.A.token });
      assert.equal(r.status, 404, azione);
      assert.equal(r.json.codice, 'ordine_non_trovato');
    }
    assert.equal((await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token })).json.in_corso, false, 'il corriere è libero');

    const altra = await richiestaConfermata();
    const seconda = await api('POST', `/corrieri/richieste/${altra.rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(seconda.status, 200, JSON.stringify(seconda.json));
    await completa('A', seconda.json.ordine_id);
  });

  test('richiesta con la finestra scaduta: 410 «scaduta», sparisce dall\'elenco, e alla chiusura il banco sa che nessun corriere l\'ha presa', async () => {
    // La r4 della prova prima è ancora libera: la finestra di conferma finisce adesso.
    const { requestId, rispostaId } = s.rimasta;
    await db.prepare("UPDATE requests SET scade_il = NOW() - INTERVAL '1 minute' WHERE id = ?").run(requestId);
    const dettaglio = await api('GET', `/corrieri/richieste/${rispostaId}` + conPos(POS_A), { token: s.A.token });
    assert.equal(dettaglio.status, 410);
    assert.equal(dettaglio.json.codice, 'scaduta');
    const accetta = await api('POST', `/corrieri/richieste/${rispostaId}/accetta`, { token: s.A.token, corpo: POS_A });
    assert.equal(accetta.status, 410);
    assert.equal(accetta.json.codice, 'scaduta');
    // (Le prove di prima hanno lasciato altre richieste aperte, che l'elenco giustamente mostra: qui conta che questa non ci sia più.)
    const elenco = (await api('GET', '/corrieri/richieste' + conPos(POS_A), { token: s.A.token })).json.richieste;
    assert.ok(elenco.length > 0 && !elenco.some((x) => x.id === rispostaId), 'la richiesta scaduta non è più nell\'elenco');

    await richieste.aggiornaScadenza(requestId);
    assert.equal((await db.prepare('SELECT stato FROM requests WHERE id = ?').get(requestId)).stato, 'nessuna_offerta');
    assert.equal((await db.prepare('SELECT corriere_stato FROM request_responses WHERE id = ?').get(rispostaId)).corriere_stato, 'scaduto');
    assert.ok((await notificheDi(utenteBanco.id)).some((n) => n.titolo === `Nessun corriere · richiesta #${requestId}`));
    assert.ok((await notificheDi(rossi.id)).some((n) => n.titolo === 'Nessun corriere disponibile'));
  });

  test('rinviare una richiesta rimasta senza corriere la rimette in gioco senza il corriere di prima', async () => {
    // Una richiesta con un corriere che l'ha presa e poi... non può essere rinviata (è un ordine). Qui si prova quella scaduta: dopo il rinvio la riga è pulita.
    const { requestId, rispostaId } = s.rimasta;
    await db.prepare('UPDATE request_responses SET corriere_id = ?, corriere_km = 3.2 WHERE id = ?').run(s.B.id, rispostaId); // residuo che non deve sopravvivere
    const nuovoId = await richieste.reinviaRichiesta(requestId);
    assert.equal(nuovoId, requestId, 'stessa richiesta, finestra nuova');
    const riga = await db.prepare('SELECT * FROM request_responses WHERE id = ?').get(rispostaId);
    assert.equal(riga.esito, 'in_attesa');
    assert.equal(riga.corriere_id, null);
    assert.equal(riga.corriere_km, null);
    assert.equal(riga.consegna_km, null);
    assert.equal(riga.corriere_stato, null);
  });

  // ---------------- uscita ----------------

  test('uscendo dall\'app il corriere non è più disponibile e il token non vale più', async () => {
    assert.equal((await api('GET', '/corrieri/disponibilita', { token: s.A.token })).json.disponibile, true);
    const esci = await api('POST', '/logout', { token: s.A.token, corpo: { token_push: TOKEN_PUSH_A } });
    assert.equal(esci.status, 200);
    assert.equal((await db.prepare('SELECT corriere_disponibile FROM users WHERE id = ?').get(s.A.id)).corriere_disponibile, 0);
    assert.equal((await api('GET', '/corrieri/disponibilita', { token: s.A.token })).status, 401);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS n FROM dispositivi_push WHERE user_id = ?').get(s.A.id)).n, 0, 'e il telefono non riceve più notifiche');
    // Rientrando, A riparte da spento.
    const rientro = await api('POST', '/corrieri/accedi', { corpo: { email: 'marco@example.com', password: 'password-lunga' } });
    assert.equal(rientro.status, 200);
    assert.equal((await api('GET', '/corrieri/disponibilita', { token: rientro.json.token })).json.disponibile, false);
  });
}
