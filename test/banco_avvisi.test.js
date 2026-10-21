// Prove degli avvisi del banco (src/banco_avvisi.js, e le notifiche con `tipo` che nascono in src/richieste.js e src/flusso_cliente.js):
// i dati che il browser chiede (stato-banco, notifiche nuove con i dati dell'avviso) e i cinque tipi di notifica. DB in memoria, nessun accesso
// al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.PUSH_ATTIVO = '0';
process.env.FINESTRA_CONFERMA_SEC = ''; // la finestra è quella della config (10 minuti), non quella forzata dal .env del PC

// ---------------- DB in memoria ----------------
const dati = {
  richiesta: { id: 10, stato: 'in_attesa', cliente_id: 5, scade_il: '2026-10-20 10:00:00' },
  risposte: [], // { distributor_id, esito, corriere_stato }
  utenti: { 2: [20, 21], 3: [30], 4: [40] }, // utenti attivi per filiale
  inAttesa: [], // le righe che la query delle richieste da confermare restituirebbe
  ordini: [], // le righe della lettura degli ordini delle notifiche
  daPreparare: [{ id: 70 }, { id: 71 }], // ordini della filiale ancora da preparare
  ordine: { id: 77, distributor_id: 3, cliente_id: 5, request_id: 10, stato: 'evaso', consegnato_il: null },
  consegnaScritta: 0, // quante UPDATE della consegna sono riuscite
  ditte: ['BOREA SRL'], // i nomi delle ditte dei banchi a cui è andata la richiesta
};
const notifiche = []; // le righe scritte in notifications
const viste = []; // { s, p } di ogni query

function esegui(sql, p, modo) {
  const s = sql.replace(/\s+/g, ' ').trim();
  viste.push({ s, p });
  if (/^SELECT \* FROM requests WHERE id = \?$/.test(s)) return Number(p[0]) === dati.richiesta.id ? dati.richiesta : null;
  if (/^SELECT EXTRACT\(EPOCH FROM \(\?::timestamp - NOW\(\)\)\)::int AS s$/.test(s)) return { s: 0 }; // la finestra è finita
  if (/^UPDATE requests SET stato = 'nessuna_offerta' WHERE id = \? AND stato = 'in_attesa'/.test(s)) { dati.richiesta.stato = 'nessuna_offerta'; return { changes: 1 }; }
  if (/^UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW\(\) WHERE request_id = \? AND esito = 'in_attesa' RETURNING distributor_id$/.test(s)) {
    const toccate = dati.risposte.filter((r) => r.esito === 'in_attesa');
    toccate.forEach((r) => { r.esito = 'scaduto'; });
    return toccate.map((r) => ({ distributor_id: r.distributor_id }));
  }
  if (/^UPDATE request_responses SET corriere_stato = 'scaduto' WHERE request_id = \? AND corriere_stato = 'in_attesa' RETURNING distributor_id$/.test(s)) {
    const toccate = dati.risposte.filter((r) => r.corriere_stato === 'in_attesa');
    toccate.forEach((r) => { r.corriere_stato = 'scaduto'; });
    return toccate.map((r) => ({ distributor_id: r.distributor_id }));
  }
  if (/^UPDATE requests SET pagamento_stato = 'rimborsato'/.test(s)) return { changes: 0 }; // nessun pagamento in questa prova
  if (/FROM config WHERE chiave/.test(s)) return { valore: '10' };
  if (/^SELECT id FROM users WHERE distributor_id = \? AND attivo = 1$/.test(s)) return (dati.utenti[p[0]] || []).map((id) => ({ id }));
  if (/^INSERT INTO notifications/.test(s)) {
    const [user_id, titolo, testo, link, categoria, sottostato, order_id, tipo, request_id] = p;
    notifiche.push({ s, user_id, titolo, testo, link, categoria, sottostato, order_id, tipo, request_id });
    return { changes: 1 };
  }
  if (/n_articoli/.test(s)) return dati.inAttesa;
  if (/^SELECT id FROM orders WHERE distributor_id = \? AND stato = 'inviato' AND consegnato_il IS NULL ORDER BY id$/.test(s)) return dati.daPreparare;
  if (/FROM orders o JOIN users u ON u\.id = o\.cliente_id WHERE o\.distributor_id = \? AND o\.id = ANY/.test(s)) return dati.ordini;
  if (/^UPDATE orders SET consegnato_il = NOW\(\) WHERE id = \? AND consegnato_il IS NULL$/.test(s)) {
    dati.consegnaScritta += 1;
    return { changes: dati.consegnaScritta === 1 ? 1 : 0 };
  }
  if (/^SELECT ragione_sociale FROM users WHERE id = \?$/.test(s)) return { ragione_sociale: 'Rossi Impianti S.r.l.' };
  // Il nome della ditta a cui è andata la richiesta (per il testo della notifica dell'installatore): una sola ditta, oppure più d'una (`dati.ditte`).
  if (/^SELECT DISTINCT d\.nome FROM request_responses rr JOIN distributors d ON d\.id = rr\.distributor_id WHERE rr\.request_id = \?$/.test(s)) return dati.ditte.map((nome) => ({ nome }));
  return modo === 'all' ? [] : modo === 'get' ? null : { changes: 0 };
}
const dbFinto = {
  prepare: (sql) => ({
    get: async (...p) => esegui(sql, p, 'get'),
    all: async (...p) => { const r = esegui(sql, p, 'all'); return Array.isArray(r) ? r : []; },
    run: async (...p) => esegui(sql, p, 'run'),
  }),
  transaction: (fn) => (...a) => fn(...a),
  fuoriDallaTransazione: (fn) => fn(),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const whatsapp = require('../src/whatsapp');
whatsapp.ritiraRichiesta = async () => {};
const richieste = require('../src/richieste');
const flusso = require('../src/flusso_cliente');
const bancoAvvisi = require('../src/banco_avvisi');
const notificheModulo = require('../src/notifiche');

function preparaChiusura(risposte) {
  dati.richiesta = { id: 10, stato: 'in_attesa', cliente_id: 5, scade_il: '2026-10-20 10:00:00' };
  dati.risposte = risposte.map((r) => ({ esito: 'in_attesa', corriere_stato: null, ...r }));
  notifiche.length = 0;
  viste.length = 0;
}

test('notifica(): tipo e request_id finiscono nelle due colonne nuove; senza, restano NULL (come prima)', async () => {
  notifiche.length = 0;
  await notificheModulo.notifica(5, { titolo: 'T', testo: 'X', link: '/l', categoria: 'richieste', tipo: 'nuova_richiesta', request_id: 12 });
  await notificheModulo.notifica(5, { titolo: 'Altra', testo: 'Y' });
  assert.match(notifiche[0].s, /INSERT INTO notifications \(user_id, titolo, testo, link, categoria, sottostato, order_id, tipo, request_id\)/);
  assert.deepEqual([notifiche[0].tipo, notifiche[0].request_id], ['nuova_richiesta', 12]);
  assert.deepEqual([notifiche[1].tipo, notifiche[1].request_id], [null, null]);
});

test('finestra scaduta: chi non ha risposto riceve "Richiesta scaduta", chi aveva confermato senza corriere "Nessun corriere", gli altri niente', async () => {
  // filiale 2: non ha risposto; filiale 3: ha confermato e aspetta il corriere; filiale 4: aveva già risposto "non disponibile"
  preparaChiusura([
    { distributor_id: 2, esito: 'in_attesa' },
    { distributor_id: 3, esito: 'confermato', corriere_stato: 'in_attesa' },
    { distributor_id: 4, esito: 'non_disponibile' },
  ]);
  await richieste.aggiornaScadenza(10);

  const perTipo = (tipo) => notifiche.filter((n) => n.tipo === tipo);
  const scaduta = perTipo('richiesta_scaduta');
  assert.deepEqual(scaduta.map((n) => n.user_id), [20, 21], 'tutti gli utenti della filiale che non ha risposto');
  assert.equal(scaduta[0].titolo, 'Richiesta #10 scaduta');
  assert.equal(scaduta[0].testo, 'Non hai risposto in tempo. Il cliente non paga nulla.');
  assert.equal(scaduta[0].request_id, 10);
  assert.equal(scaduta[0].link, '/distributore/richieste/10');

  const senzaCorriere = perTipo('nessun_corriere');
  assert.deepEqual(senzaCorriere.map((n) => n.user_id), [30]);
  assert.equal(senzaCorriere[0].titolo, 'Nessun corriere · richiesta #10');
  assert.equal(senzaCorriere[0].testo, 'Nessuno ha preso la consegna: non preparare. Il cliente è stato avvisato e non paga nulla.');
  assert.equal(senzaCorriere[0].request_id, 10);

  assert.equal(notifiche.filter((n) => [40].includes(n.user_id)).length, 0, 'chi aveva già rifiutato non riceve niente');
  // il cliente riceve la sua notifica di sempre (senza tipo)
  const cliente = notifiche.filter((n) => n.user_id === 5);
  assert.equal(cliente.length, 1);
  assert.equal(cliente[0].tipo, null);
  // il testo come nel mockup delle notifiche (richiesta esplicita del 21/10/2026): titolo corto, "Richiesta #N — ..." nel corpo, niente rimborso (la carta era solo bloccata)
  assert.equal(cliente[0].titolo, 'Nessun corriere disponibile');
  assert.equal(cliente[0].testo, 'Richiesta #10 — BOREA aveva il materiale, ma nessun corriere ha preso la consegna. Puoi rinviarla.');
  assert.equal(cliente[0].link, '/richieste/10');
});

test('finestra scaduta senza nessuna risposta: "BOREA non ha confermato" e il corpo della foto; con più ditte "Nessun banco ha confermato"', async () => {
  preparaChiusura([{ distributor_id: 2, esito: 'in_attesa' }, { distributor_id: 3, esito: 'in_attesa' }]);
  await richieste.aggiornaScadenza(10);
  let cliente = notifiche.filter((n) => n.user_id === 5);
  assert.equal(cliente.length, 1);
  assert.equal(cliente[0].titolo, 'BOREA non ha confermato', 'la ditta senza forma giuridica, mai la filiale');
  assert.equal(cliente[0].testo, 'Richiesta #10 — La richiesta non è stata accettata. Nessun addebito: puoi rinviarla.');

  dati.ditte = ['BOREA SRL', 'Cambielli S.p.A.'];
  try {
    preparaChiusura([{ distributor_id: 2, esito: 'in_attesa' }]);
    await richieste.aggiornaScadenza(10);
    cliente = notifiche.filter((n) => n.user_id === 5);
    assert.equal(cliente[0].titolo, 'Nessun banco ha confermato');
    assert.equal(cliente[0].testo, 'Richiesta #10 — La richiesta non è stata accettata. Nessun addebito: puoi rinviarla.');
    // un banco che aveva accettato: "Il banco" al posto del nome
    preparaChiusura([{ distributor_id: 3, esito: 'confermato', corriere_stato: 'in_attesa' }]);
    await richieste.aggiornaScadenza(10);
    cliente = notifiche.filter((n) => n.user_id === 5);
    assert.equal(cliente[0].titolo, 'Nessun corriere disponibile');
    assert.equal(cliente[0].testo, 'Richiesta #10 — Il banco aveva il materiale, ma nessun corriere ha preso la consegna. Puoi rinviarla.');
  } finally {
    dati.ditte = ['BOREA SRL'];
  }
});

test('finestra scaduta senza nessun banco in attesa del corriere: solo "Richiesta scaduta", mai "Nessun corriere"', async () => {
  preparaChiusura([{ distributor_id: 2, esito: 'in_attesa' }, { distributor_id: 3, esito: 'in_attesa' }]);
  await richieste.aggiornaScadenza(10);
  assert.deepEqual(notifiche.filter((n) => n.tipo === 'richiesta_scaduta').map((n) => n.user_id).sort(), [20, 21, 30]);
  assert.equal(notifiche.filter((n) => n.tipo === 'nessun_corriere').length, 0);
});

test('una richiesta già chiusa non avvisa nessuno (la UPDATE atomica non cambia niente)', async () => {
  preparaChiusura([{ distributor_id: 2, esito: 'in_attesa' }]);
  dati.richiesta.stato = 'ordinata'; // un ordine è nato un istante prima: aggiornaScadenza esce prima ancora di chiudere
  await richieste.aggiornaScadenza(10);
  assert.equal(notifiche.length, 0);
});

test('consegna: il banco riceve "Ordine #N consegnato" una volta sola, anche se il cliente conferma due volte', async () => {
  notifiche.length = 0;
  dati.consegnaScritta = 0;
  dati.ordine.consegnato_il = null;
  await flusso.segnaConsegnatoProva(dati.ordine);
  assert.equal(notifiche.length, 1);
  const n = notifiche[0];
  assert.equal(n.tipo, 'ordine_consegnato');
  assert.equal(n.user_id, 30, 'gli utenti della filiale dell\'ordine');
  assert.equal(n.titolo, 'Ordine #77 consegnato');
  assert.match(n.testo, /^Rossi Impianti S\.r\.l\. ha confermato la consegna alle \d\d:\d\d\.$/);
  assert.equal(n.order_id, 77);
  assert.equal(n.link, '/distributore/ordini/77');

  // la seconda conferma (due schede aperte): la UPDATE non cambia niente, nessun secondo avviso
  await flusso.segnaConsegnatoProva(dati.ordine);
  assert.equal(notifiche.length, 1);

  // con la rotta vera (ordine evaso) vale lo stesso
  dati.consegnaScritta = 0;
  await flusso.segnaConsegnato({ ...dati.ordine, stato: 'evaso', consegnato_il: null });
  assert.equal(notifiche.length, 2);
  // un ordine già consegnato non si tocca
  await flusso.segnaConsegnato({ ...dati.ordine, stato: 'evaso', consegnato_il: new Date() });
  assert.equal(notifiche.length, 2);
});

test('richiesteInAttesa: solo le richieste da confermare di questa filiale, con cliente, articoli, pezzi, secondi e ora di scadenza', async () => {
  viste.length = 0;
  dati.inAttesa = [
    { id: 12, cliente_nome: 'Bianchi <b>Idraulica</b>', secondi: 95, n_articoli: '1', n_pezzi: '1' },
    { id: 11, cliente_nome: 'Rossi S.r.l.', secondi: 447, n_articoli: '2', n_pezzi: '3' },
  ];
  const r = await bancoAvvisi.richiesteInAttesa(2);
  const q = viste.find((v) => /n_articoli/.test(v.s));
  assert.deepEqual(q.p, [2], 'la filiale dell\'utente');
  assert.match(q.s, /rr\.esito = 'in_attesa' AND r\.scade_il > NOW\(\)/);
  assert.match(q.s, /ORDER BY r\.scade_il ASC/);
  assert.deepEqual(r.map((x) => [x.id, x.cliente, x.articoli, x.pezzi, x.secondi, x.finestraSec]), [
    [12, 'Bianchi <b>Idraulica</b>', 1, 1, 95, 600],
    [11, 'Rossi S.r.l.', 2, 3, 447, 600],
  ]);
  assert.match(r[0].scadeAlle, /^\d\d:\d\d$/);

  // limitata a certi id (le notifiche nuove): l'elenco va nella query; senza id, niente query
  viste.length = 0;
  await bancoAvvisi.richiesteInAttesa(2, [12, 99]);
  assert.deepEqual(viste.find((v) => /n_articoli/.test(v.s)).p, [2, [12, 99]]);
  assert.match(viste.find((v) => /n_articoli/.test(v.s)).s, /r\.id = ANY\(\?::int\[\]\)/);
  viste.length = 0;
  assert.deepEqual(await bancoAvvisi.richiesteInAttesa(2, []), []);
  assert.equal(viste.length, 0);
});

test('statoBanco: i numeri della striscia (dai contatori già letti) e la prima scadenza', async () => {
  dati.inAttesa = [{ id: 12, cliente_nome: 'Bianchi', secondi: 95, n_articoli: 1, n_pezzi: 1 }, { id: 11, cliente_nome: 'Rossi', secondi: 447, n_articoli: 2, n_pezzi: 3 }];
  const stato = await bancoAvvisi.statoBanco(2, { daRispondere: 2, inAttesaCorriere: 1, daPreparare: 3 });
  assert.equal(stato.daConfermare, 2);
  assert.equal(stato.primaScadeSec, 95);
  assert.equal(stato.attesaCorriere, 1);
  assert.equal(stato.daPreparare, 3);
  assert.deepEqual(stato.richieste.map((r) => r.id), [12, 11]);
  assert.deepEqual(stato.ordini, [70, 71], 'ordini ancora da preparare (id interi)');

  dati.inAttesa = [];
  const vuoto = await bancoAvvisi.statoBanco(2, { daRispondere: 0, inAttesaCorriere: 0, daPreparare: 0 });
  assert.equal(vuoto.primaScadeSec, null);
  assert.deepEqual(vuoto.richieste, []);
});

test('arricchisciPush: ogni notifica porta i dati del suo avviso; una richiesta già risposta o un ordine già partito si riconoscono', async () => {
  dati.inAttesa = [{ id: 12, cliente_nome: 'Bianchi', secondi: 95, n_articoli: 1, n_pezzi: 1 }]; // la 99 non c'è più da confermare
  dati.ordini = [
    // il corriere ha risposto alle 07:15 UTC scrivendo "preso 30": arriva dal banco alle 07:45 UTC (09:45 a Roma). L'arrivo dal CLIENTE (corriere_arrivo_il) il banco non lo vede.
    { id: 1280, stato: 'inviato', consegnato_il: null, corriere_nome: 'Marco', corriere_risposto_il: new Date(Date.UTC(2026, 9, 19, 7, 15)), corriere_minuti: 30, cliente_nome: 'Rossi' },
    { id: 1281, stato: 'evaso', consegnato_il: '2026-10-19 19:21:00', corriere_nome: '', corriere_risposto_il: null, corriere_minuti: null, cliente_nome: 'Neri Impianti' },
  ];
  const nuove = [
    { id: 1, titolo: 'a', testo: 'a', link: '/distributore/richieste/12', tipo: 'nuova_richiesta', request_id: 12, order_id: null },
    { id: 2, titolo: 'b', testo: 'b', link: '/distributore/richieste/99', tipo: 'nuova_richiesta', request_id: 99, order_id: null },
    { id: 3, titolo: 'c', testo: 'c', link: '/distributore/ordini/1280', tipo: 'corriere_trovato', request_id: 10, order_id: 1280 },
    { id: 4, titolo: 'd', testo: 'd', link: '/distributore/ordini/1281', tipo: 'ordine_consegnato', request_id: null, order_id: 1281 },
    { id: 5, titolo: 'e', testo: 'e', link: '/distributore/richieste/10', tipo: 'nessun_corriere', request_id: 10, order_id: null },
    { id: 6, titolo: 'f', testo: 'f', link: null, tipo: null, request_id: null, order_id: null },
    { id: 7, titolo: 'g', testo: 'g', link: '/distributore/ordini/5000', tipo: 'corriere_trovato', request_id: 10, order_id: 5000 },
  ];
  viste.length = 0;
  const r = await bancoAvvisi.arricchisciPush(2, nuove);
  assert.equal(r.length, 7);
  assert.equal(r[0].richiesta.id, 12);
  assert.equal(r[0].richiesta.cliente, 'Bianchi');
  assert.equal(r[0].richiesta.secondi, 95);
  assert.equal(r[1].richiesta, null, 'la 99 non è più da confermare');
  assert.deepEqual(r[2].ordine, { id: 1280, corriere: 'Marco', ritiroAlle: '09:45', daPreparare: true }); // 07:45 UTC = 09:45 a Roma (ora legale)
  assert.equal(r[3].ordine.cliente, 'Neri Impianti');
  assert.equal(r[3].ordine.alle, '21:21'); // 19:21 UTC = 21:21 a Roma
  assert.equal('richiesta' in r[4] || 'ordine' in r[4], false, 'nessun_corriere basta col suo request_id');
  assert.equal('richiesta' in r[5] || 'ordine' in r[5], false);
  assert.equal(r[6].ordine, null, 'un ordine di un altro banco (o inesistente) non c\'è');
  // due letture sole (richieste e ordini), per tutte le notifiche insieme
  assert.equal(viste.filter((v) => /n_articoli|FROM orders o JOIN/.test(v.s)).length, 2);
  assert.deepEqual(viste.find((v) => /FROM orders o JOIN/.test(v.s)).p, [2, [1280, 1281, 5000]]);

  // un ordine già consegnato o partito non è più "da preparare"
  dati.ordini = [{ id: 1280, stato: 'in_evasione', consegnato_il: null, corriere_nome: 'Marco', corriere_risposto_il: null, corriere_minuti: null, cliente_nome: 'Rossi' }];
  const partito = await bancoAvvisi.arricchisciPush(2, [nuove[2]]);
  assert.deepEqual(partito[0].ordine, { id: 1280, corriere: 'Marco', ritiroAlle: null, daPreparare: false });

  // senza notifiche da arricchire non parte nessuna query
  viste.length = 0;
  const semplici = await bancoAvvisi.arricchisciPush(2, [nuove[4], nuove[5]]);
  assert.equal(semplici.length, 2);
  assert.equal(viste.length, 0);
});

test('"Ordine confermato" per l\'installatore: la forma del mockup ("Ordine #312 — BOREA prepara il tuo ordine. Consegna prevista entro le 10:45.")', () => {
  // col corriere: l'orario d'arrivo, senza il "(in N min)" di prima e senza ripetere il numero dopo "ordine"
  assert.equal(flusso.testoOrdineConfermato({ orderId: 312, distributoreNome: 'BOREA SRL', arrivo: '10:45' }),
    'Ordine #312 — BOREA prepara il tuo ordine. Consegna prevista entro le 10:45.');
  // la ditta senza forma giuridica, comunque sia scritta
  assert.match(flusso.testoOrdineConfermato({ orderId: 1, distributoreNome: 'Borea S.r.l.', arrivo: '08:00' }), /^Ordine #1 — Borea prepara/);
  // senza corriere (WhatsApp spento): la stima del banco
  assert.equal(flusso.testoOrdineConfermato({ orderId: 313, distributoreNome: 'BOREA SRL', minutiStimati: 120 }),
    'Ordine #313 — BOREA prepara il tuo ordine. Consegna stimata in 2 ore.');
  // nome sconosciuto: "Il banco"
  assert.match(flusso.testoOrdineConfermato({ orderId: 314, distributoreNome: null, minutiStimati: 45 }), /^Ordine #314 — Il banco prepara il tuo ordine\./);
});
