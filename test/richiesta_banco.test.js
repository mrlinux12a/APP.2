// Dettaglio di una richiesta al banco: le parti che non toccano il DB (stato mostrato, tabella del materiale, passi, "quando è arrivata").
// La pagina intera si prova in test/server.test.js, con il DB finto.
const test = require('node:test');
const assert = require('node:assert/strict');
const rb = require('../src/richiesta_banco');

const richiesta = (stato) => ({ id: 177, stato });
const risposta = (esito, corriere = null) => ({ esito, corriere_stato: corriere });

test('statoRichiestaBanco: Da confermare, Attesa corriere e Non disponibile (i tre del disegno) più gli altri casi', () => {
  const s = (r, p, extra = {}) => rb.statoRichiestaBanco({ richiesta: r, risposta: p, apribile: false, ...extra });
  assert.deepEqual(rb.statoRichiestaBanco({ richiesta: richiesta('in_attesa'), risposta: risposta('in_attesa'), apribile: true }),
    { chiave: 'da_confermare', etichetta: 'Da confermare' });
  assert.deepEqual(s(richiesta('in_attesa'), risposta('confermato', 'in_attesa')), { chiave: 'attesa_corriere', etichetta: 'Attesa corriere' });
  assert.deepEqual(s(richiesta('in_attesa'), risposta('non_disponibile')), { chiave: 'non_disponibile', etichetta: 'Non disponibile' });
  // confermata: consegna presa (o senza corriere) e ordine di questo banco
  assert.deepEqual(s(richiesta('ordinata'), risposta('confermato', 'preso'), { ordineMio: true }), { chiave: 'confermata', etichetta: 'Confermata' });
  assert.deepEqual(s(richiesta('in_attesa'), risposta('confermato', null)), { chiave: 'confermata', etichetta: 'Confermata' });
  // nessun corriere in tempo (anche prima che il timer segni la risposta come scaduta)
  assert.equal(s(richiesta('nessuna_offerta'), risposta('confermato', 'scaduto')).chiave, 'senza_corriere');
  assert.equal(s(richiesta('nessuna_offerta'), risposta('confermato', 'in_attesa')).chiave, 'senza_corriere');
  // chiusa: ha ordinato da un altro banco; annullata dal cliente; scaduta senza risposta
  assert.equal(s(richiesta('ordinata'), risposta('scaduto')).chiave, 'chiusa');
  assert.equal(s(richiesta('ordinata'), risposta('confermato', 'preso'), { ordineMio: false }).chiave, 'chiusa');
  assert.equal(s(richiesta('annullata'), risposta('in_attesa')).chiave, 'annullata');
  assert.equal(s(richiesta('annullata'), risposta('confermato', 'in_attesa')).chiave, 'annullata');
  assert.deepEqual(s(richiesta('nessuna_offerta'), risposta('scaduto')), { chiave: 'scaduta', etichetta: 'Scaduta' });
  // il rifiuto del banco vale anche se la richiesta poi si chiude
  assert.equal(s(richiesta('nessuna_offerta'), risposta('non_disponibile')).chiave, 'non_disponibile');
});

test('tabellaMateriale: prezzo e totale di riga, totale per il cliente con RAEE, quantità richieste o confermate', () => {
  const righe = [
    { nome: 'Elemento A', codice: '12364959', quantita_richiesta: 3, quantita: 3, prezzo_listino: 102.3, raee: 0 },
    { nome: 'Caldaia', codice: '99', quantita_richiesta: 2, quantita: 1, prezzo_listino: 500, raee: 1.5 },
  ];
  const unitario = (r) => Math.round(r.prezzo_listino * 1.1 * 100) / 100; // listino + 10% di servizio
  let t = rb.tabellaMateriale(righe, unitario, { confermata: false });
  assert.equal(t.nArticoli, 2);
  assert.equal(t.nPezzi, 5); // richieste: 3 + 2
  assert.deepEqual(t.righe.map((r) => [r.quantita, r.unitario, r.totale, r.mancano]), [[3, 112.53, 337.59, 0], [2, 550, 1100, 0]]);
  assert.equal(t.raee, 3); // 1,50 x 2
  assert.equal(t.totale, 1440.59); // 337,59 + 1100 + 3 di RAEE

  // confermata: contano le quantità confermate, e si vede cosa manca
  t = rb.tabellaMateriale(righe, unitario, { confermata: true });
  assert.equal(t.nPezzi, 4);
  assert.deepEqual(t.righe.map((r) => [r.quantita, r.richiesta, r.mancano]), [[3, 3, 0], [1, 2, 1]]);
  assert.equal(t.raee, 1.5);
  assert.equal(t.totale, round2(337.59 + 550 + 1.5));

  // un articolo, come nel disegno: 1× a 112,53, totale 112,53
  t = rb.tabellaMateriale([righe[0]].map((r) => ({ ...r, quantita_richiesta: 1, quantita: 1 })), unitario);
  assert.equal(t.totale, 112.53);
  assert.equal(t.nArticoli, 1);
  assert.equal(t.nPezzi, 1);
  assert.equal(rb.tabellaMateriale([], unitario).totale, 0);
});

function round2(n) { return Math.round(n * 100) / 100; }

test('passiDopoConferma: tre passi col modulo WhatsApp, due senza (non ci sono corrieri da avvisare); uno solo è quello in corso', () => {
  const tre = rb.passiDopoConferma({ conCorriere: true, corrente: 'conferma' });
  assert.deepEqual(tre.map((p) => p.chiave), ['conferma', 'corrieri', 'prepara']);
  assert.deepEqual(tre.map((p) => p.tono), ['arancio', 'viola', 'verde']);
  assert.deepEqual(tre.map((p) => p.corrente), [true, false, false]);
  assert.match(tre[1].testo, /Non preparare ancora/);
  assert.deepEqual(rb.passiDopoConferma({ conCorriere: true, corrente: 'corrieri' }).map((p) => p.corrente), [false, true, false]);

  const due = rb.passiDopoConferma({ conCorriere: false, corrente: 'conferma' });
  assert.deepEqual(due.map((p) => p.chiave), ['conferma', 'prepara']);
  assert.ok(!due.some((p) => /corrier/i.test(p.titolo + p.testo)));
});

test('quandoRicevuta: oggi, ieri o la data', () => {
  assert.equal(rb.quandoRicevuta({ etichetta: 'Oggi' }, '21:04'), 'oggi alle 21:04');
  assert.equal(rb.quandoRicevuta({ etichetta: 'Ieri' }, '09:15'), 'ieri alle 09:15');
  assert.equal(rb.quandoRicevuta({ etichetta: '12 ottobre' }, '18:00'), 'il 12 ottobre alle 18:00');
  assert.equal(rb.quandoRicevuta({ etichetta: '12 marzo 2025' }, '18:00'), 'il 12 marzo 2025 alle 18:00');
});

test('la soglia del rosso è di 2 minuti', () => {
  assert.equal(rb.SOGLIA_URGENTE_SEC, 120);
});

test('passiDopoConferma: ogni passo ha la sua fase (fatto, corrente, futuro) rispetto a quello in corso', () => {
  const fasi = (o) => rb.passiDopoConferma(o).map((p) => p.fase);
  assert.deepEqual(fasi({ conCorriere: true, corrente: 'conferma' }), ['corrente', 'futuro', 'futuro']);
  assert.deepEqual(fasi({ conCorriere: true, corrente: 'corrieri' }), ['fatto', 'corrente', 'futuro']);
  assert.deepEqual(fasi({ conCorriere: true, corrente: 'prepara' }), ['fatto', 'fatto', 'corrente']);
  assert.deepEqual(fasi({ conCorriere: false, corrente: 'prepara' }), ['fatto', 'corrente']);
  // un passo in corso che non c'è (il passo dei corrieri a modulo spento): tutti da fare, nessun errore
  assert.deepEqual(fasi({ conCorriere: false, corrente: 'corrieri' }), ['futuro', 'futuro']);
  // `corrente` (booleano) resta com'era
  assert.deepEqual(rb.passiDopoConferma({ conCorriere: true, corrente: 'corrieri' }).map((p) => p.corrente), [false, true, false]);
});

test('passiDopoConferma con avanzamento: gli stessi passi con i testi di "Avanzamento"', () => {
  const p = rb.passiDopoConferma({ conCorriere: true, corrente: 'corrieri', avanzamento: { conCorriere: true, oraConferma: '21:05' } });
  assert.deepEqual(p.map((x) => [x.chiave, x.fase, x.titolo, x.testo]), [
    ['conferma', 'fatto', 'Disponibilità confermata', 'Fatto alle 21:05'],
    ['corrieri', 'corrente', 'Corriere avvisato', 'Aspettiamo che un corriere accetti la consegna.'],
    ['prepara', 'futuro', 'Da preparare', 'Quando un corriere accetta, l\u2019ordine passa in Da preparare con l\u2019ora di ritiro.'],
  ]);
  // solo il passo dei corrieri porta "· da N min"
  assert.deepEqual(p.map((x) => !!x.conTempo), [false, true, false]);
  // senza modulo WhatsApp: due passi, niente corrieri
  const due = rb.passiDopoConferma({ conCorriere: false, corrente: 'prepara', avanzamento: { conCorriere: false, oraConferma: '21:05' } });
  assert.deepEqual(due.map((x) => [x.chiave, x.fase]), [['conferma', 'fatto'], ['prepara', 'corrente']]);
  assert.match(due[1].testo, /passa subito in Da preparare/);
  // senza l'ora della conferma: "Fatto" e basta
  assert.equal(rb.passiDopoConferma({ conCorriere: true, corrente: 'corrieri', avanzamento: { conCorriere: true, oraConferma: null } })[0].testo, 'Fatto');
  // senza `avanzamento` i testi sono quelli di "Cosa succede dopo la conferma"
  assert.equal(rb.passiDopoConferma({ conCorriere: true, corrente: 'conferma' })[0].titolo, 'Confermi la disponibilità');
});

test('statoRichiestaBanco: Da preparare quando l\'ordine è nato e non è ancora stato preparato', () => {
  const base = { richiesta: { id: 177, stato: 'ordinata' }, risposta: { esito: 'confermato', corriere_stato: 'preso' }, apribile: false };
  assert.deepEqual(rb.statoRichiestaBanco({ ...base, ordineMio: true, ordineDaPreparare: true }), { chiave: 'da_preparare', etichetta: 'Da preparare' });
  // già preso in carico (o non suo): Confermata (o Chiusa), come prima
  assert.equal(rb.statoRichiestaBanco({ ...base, ordineMio: true, ordineDaPreparare: false }).chiave, 'confermata');
  assert.equal(rb.statoRichiestaBanco({ ...base, ordineMio: false, ordineDaPreparare: true }).chiave, 'chiusa');
  // senza corriere (modulo spento) l'ordine nasce alla conferma: subito Da preparare
  assert.equal(rb.statoRichiestaBanco({ ...base, risposta: { esito: 'confermato', corriere_stato: null }, ordineMio: true, ordineDaPreparare: true }).chiave, 'da_preparare');
  // ma finché il corriere non ha risposto l'ordine non c'è: Attesa corriere vince
  assert.equal(rb.statoRichiestaBanco({ ...base, richiesta: { id: 177, stato: 'in_attesa' }, risposta: { esito: 'confermato', corriere_stato: 'in_attesa' } }).chiave, 'attesa_corriere');
});

test('passiDopoConferma con avanzamento da preparare: consegna presa fatta, "Da preparare" in corso', () => {
  const p = rb.passiDopoConferma({
    conCorriere: true, corrente: 'prepara',
    avanzamento: { conCorriere: true, oraConferma: '21:05', daPreparare: true, corriere: { nome: 'Marco', oraConsegna: '21:30' } },
  });
  assert.deepEqual(p.map((x) => [x.chiave, x.fase, x.titolo, x.testo]), [
    ['conferma', 'fatto', 'Disponibilità confermata', 'Fatto alle 21:05'],
    ['corrieri', 'fatto', 'Consegna presa da Marco', 'Dal cliente entro le 21:30.'],
    ['prepara', 'corrente', 'Da preparare', 'Quando hai finito, premi "Preparato".'],
  ]);
  assert.deepEqual(p.map((x) => !!x.conTempo), [false, false, false]); // il passo dei corrieri è fatto: niente "da N min"
  // il corriere senza nome né ora: testi neutri
  const senza = rb.passiDopoConferma({ conCorriere: true, corrente: 'prepara', avanzamento: { conCorriere: true, oraConferma: '21:05', daPreparare: true, corriere: { nome: '', oraConsegna: '' } } });
  assert.equal(senza[1].titolo, 'Consegna presa');
  assert.equal(senza[1].testo, 'Il corriere è in arrivo.');
  // senza modulo WhatsApp: due passi, conferma fatta e "Da preparare" in corso
  const due = rb.passiDopoConferma({ conCorriere: false, corrente: 'prepara', avanzamento: { conCorriere: false, oraConferma: '21:05', daPreparare: true, corriere: null } });
  assert.deepEqual(due.map((x) => [x.chiave, x.fase, x.testo]), [['conferma', 'fatto', 'Fatto alle 21:05'], ['prepara', 'corrente', 'Quando hai finito, premi "Preparato".']]);
});
