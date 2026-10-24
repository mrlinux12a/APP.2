// Le pagine del banco (il distributore): la bacheca con le richieste da confermare, lo Storico ordini, il dettaglio di una richiesta, la risposta del
// banco ("Conferma" / "Non disponibile") e la pagina dell'ordine con "Preparato".
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const { ritornoBanco, conRitorno, vuoleJson } = require('../http');
const pricing = require('../pricing');
const format = require('../format');
const orariCorriere = require('../corriere');
const richieste = require('../richieste');
const anagrafiche = require('../anagrafiche');
const pagamenti = require('../pagamenti');
const notifiche = require('../notifiche');
const bancoAvvisi = require('../banco_avvisi');
const storicoBanco = require('../storico_banco');
const storicoDettaglio = require('../storico_dettaglio');
const richiestaBanco = require('../richiesta_banco');
const ordineBanco = require('../ordine_banco');
const whatsapp = require('../whatsapp');
const { BACHECA } = require('../config/bacheca');
const { contatoriBanco, riassuntoArticoli, distanzaClienteBanco, ordineDelBanco, prendiInCarico } = require('../services/banco');

const router = creaRouter();

// ---------- Numeri e avvisi della barra ----------

// Controllo leggero per le pagine del banco (public/app.js, data-versione): restituisce gli stessi numeri che la pagina ha ricevuto, e il browser si
// ricarica solo se sono cambiati.
router.get('/api/distributore/novita', requireRole('distributore'), (req, res) => {
  res.json(res.locals.contatori || {});
});

// Dà i numeri della striscia arancio e del pallino su "Banco" (partials/banco_avviso.ejs, public/app.js "Avvisi del banco"): richieste da confermare e
// quanto manca alla prima, più l'elenco di quelle ancora aperte (con cliente, pezzi e scadenza) per tenere allineati gli avvisi "Nuova richiesta". Il
// browser la chiede ogni 15 s e subito quando arriva una notifica nuova.
router.get('/distributore/stato-banco', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  res.set('Cache-Control', 'no-store');
  if (!distributorId) return res.json({ daConfermare: 0, primaScadeSec: null, attesaCorriere: 0, daPreparare: 0, richieste: [] });
  res.json(await bancoAvvisi.statoBanco(distributorId, res.locals.contatori || {}));
});

// ---------- Home del banco ----------

// Mostra la home del banco: bacheca a tre colonne, nell'ordine in cui passa una richiesta.
//   Da confermare   richieste arrivate al banco, con la finestra di risposta ancora aperta
//   Attesa corriere richieste confermate dal banco; nel gruppo WhatsApp nessun corriere ha ancora preso la consegna
//   Da preparare    ordini nati (consegna presa, o banco che ha accettato a modulo spento) non ancora presi in carico
// Il banco riceve sempre: non c'è più una pausa della ricezione.
router.get('/distributore', requireRole('distributore'), async (req, res) => {
  // Niente più sweep completo di tutte le richieste aperte del sistema ad ogni apertura pagina (era una scansione system-wide, non solo di questo
  // distributore): ci pensa già il job periodico ogni 30s, e la singola richiesta si autoaggiorna quando la si apre (vedi GET /distributore/richieste/:id).
  const distributorId = req.session.user.distributor_id;

  // Letture indipendenti: partono insieme (col DB su un altro server ogni query in sequenza costa ~50 ms).
  const [aperte, ordiniDaPreparare, minutiRisposta, contatori] = await Promise.all([
    // Le due colonne "di richiesta" in una query sola. Le colonne TIMESTAMP (risposto_il) sono ora UTC senza fuso: si confrontano con NOW() in SQL,
    // mai con un Date di JS.
    db
      .prepare(
        `SELECT r.id, u.ragione_sociale AS cliente_nome, rr.esito,
                EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int AS secondi,
                EXTRACT(EPOCH FROM (NOW() - rr.risposto_il))::int AS secondi_da_risposta
           FROM request_responses rr
           JOIN requests r ON r.id = rr.request_id
           JOIN users u ON u.id = r.cliente_id
          WHERE rr.distributor_id = ? AND r.scade_il > NOW()
            AND (rr.esito = 'in_attesa' OR (rr.esito = 'confermato' AND rr.corriere_stato = 'in_attesa'))
          ORDER BY r.id DESC`
      )
      .all(distributorId),
    // Il banco vede solo il tempo scritto dal corriere su WhatsApp: quando arriva da lui (corriere_risposto_il + corriere_minuti, src/corriere.js;
    // TIMESTAMPTZ, un istante vero). I secondi che mancano si calcolano in SQL.
    // Un ordine segnato consegnato (rotta provvisoria) può restare 'inviato': non è "Da preparare" (come nello Storico) e la sua pagina rimanda allo Storico.
    db
      .prepare(
        `SELECT o.id, o.request_id, o.corriere_nome, ${orariCorriere.ritiroSql('o')} AS ritiro_il, u.ragione_sociale AS cliente_nome,
                EXTRACT(EPOCH FROM (${orariCorriere.ritiroSql('o')} - NOW()))::int AS secondi_arrivo
           FROM orders o
           JOIN users u ON u.id = o.cliente_id
          WHERE o.distributor_id = ? AND o.stato = 'inviato' AND o.consegnato_il IS NULL
          ORDER BY ${orariCorriere.ritiroSql('o')} ASC NULLS LAST, o.id ASC
          LIMIT 100`
      )
      .all(distributorId),
    pricing.getFinestraMinuti(),
    contatoriBanco(distributorId),
  ]);

  // Gli articoli di tutte le schede si leggono insieme (una query per le richieste, una per gli ordini), non una per scheda.
  const [righePerRichiesta, righeOrdini] = await Promise.all([
    richieste.righeRichieste(aperte.map((r) => r.id)),
    ordiniDaPreparare.length
      ? db
          .prepare(
            `SELECT order_id, codice_snapshot AS codice, nome_snapshot AS nome, quantita
               FROM order_items WHERE order_id = ANY(?::int[]) ORDER BY order_id, id`
          )
          .all(ordiniDaPreparare.map((o) => o.id))
      : [],
  ]);
  const righePerOrdine = new Map();
  for (const ri of righeOrdini) {
    const id = Number(ri.order_id);
    if (!righePerOrdine.has(id)) righePerOrdine.set(id, []);
    righePerOrdine.get(id).push(ri);
  }

  const finestraSecondi = Math.max(1, Math.round(minutiRisposta * 60));

  const daConfermare = aperte
    .filter((r) => r.esito === 'in_attesa')
    .map((r) => {
      const secondi = Math.max(0, Number(r.secondi));
      const trascorsi = Math.max(0, finestraSecondi - secondi);
      return {
        ...r,
        ...riassuntoArticoli(righePerRichiesta.get(Number(r.id)) || []),
        secondi,
        frazione: Math.min(1, secondi / finestraSecondi),
        urgente: secondi <= BACHECA.urgenteSec,
        nuovaSec: Math.max(0, BACHECA.nuovaSec - trascorsi), // quanto resta all'etichetta "Nuova"
        appena: trascorsi < BACHECA.appenaSec,
      };
    });

  // In attesa da più tempo per prime: è quella a cui ricordare di più il corriere.
  const attesaCorriere = aperte
    .filter((r) => r.esito === 'confermato')
    .map((r) => ({
      ...r,
      ...riassuntoArticoli(righePerRichiesta.get(Number(r.id)) || []),
      trascorsi: Math.max(0, Number(r.secondi_da_risposta) || 0),
    }))
    .sort((a, b) => b.trascorsi - a.trascorsi);

  const daPreparare = ordiniDaPreparare.map((o) => ({
    ...o,
    ...riassuntoArticoli(righePerOrdine.get(Number(o.id)) || []),
    // Senza corriere (modulo WhatsApp spento) non c'è un orario d'arrivo da mostrare.
    arrivo: o.ritiro_il ? { secondi: Number(o.secondi_arrivo) } : null,
  }));

  res.render('distributore_richieste', {
    titolo: 'Richieste al banco',
    contatori,
    bacheca: BACHECA,
    finestraSecondi,
    daConfermare,
    attesaCorriere,
    daPreparare,
  });
});

// ---------- Storico ordini del banco ----------

// Mostra lo Storico ordini del banco: la lista di tutti gli ordini della filiale, con filtri per stato e periodo, ricerca e paginazione. Sta tutto
// nell'URL (?stato=&periodo=&q=&pagina=), vedi src/storico_banco.js. Prende il posto di "Tutti gli ordini" (/distributore/ordini, che ora rimanda qui) e
// dello "Storico richieste".
router.get('/distributore/storico', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const filtri = storicoBanco.leggiFiltri(req.query);
  const [storico, contatori] = await Promise.all([
    storicoBanco.storicoOrdini(distributorId, filtri),
    contatoriBanco(distributorId),
  ]);
  res.render('distributore_storico', {
    titolo: 'Storico ordini',
    contatori,
    filtri,
    link: (modifiche) => storicoBanco.urlStorico(filtri, modifiche),
    ...storico,
  });
});

// Dà il dettaglio di una riga dello Storico: un frammento HTML (views/partials/storico_dettaglio.ejs) che la pagina carica al primo clic sulla riga e mette
// sotto di essa (public/app.js, "Storico ordini: righe che si aprono"): materiale a prezzo del banco, "Come è andata" e i pulsanti. Solo ordini del banco
// loggato. SOLA LETTURA: non chiama prendiInCarico né scrive niente, qualunque sia lo stato dell'ordine (aprire il dettaglio non lo cambia). `torna` (la
// pagina dello Storico com'è adesso, scritta dallo script) vale solo se è una pagina del banco (ritornoBanco): il pulsante "Apri ordine completo" la porta
// con sé, con l'ancora #o<id> della riga, così la freccia della pagina dell'ordine riporta allo Storico con la stessa voce aperta.
router.get('/distributore/storico/:id/dettaglio', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.status(404).type('text/plain').send('Ordine non trovato.');
  const dettaglio = await storicoDettaglio.leggiDettaglio(ordine);
  const torna = ritornoBanco(req.query.torna, '/distributore/storico').split('#')[0];
  res.render('partials/storico_dettaglio', { ...dettaglio, tornaStorico: torna + '#o' + ordine.id });
});

// ---------- Richiesta ----------

// Mostra il dettaglio di una richiesta al banco: a sinistra il materiale (tabella con listino, prezzo cliente e totale) e i passi dopo la conferma, a
// destra cosa fare (timer e pulsanti, oppure lo stato dopo la risposta), il cliente e "Elimina dal banco". Lo stato, la tabella e i passi si preparano in
// src/richiesta_banco.js; la vista (views/distributore_dettaglio.ejs) disegna. Se l'ordine è già "Da preparare" porta direttamente alla pagina dell'ordine.
router.get('/distributore/richieste/:id', requireRole('distributore'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  const distributorId = req.session.user.distributor_id;
  // `secondi_da_risposta`: da quanto il banco ha risposto (lo stesso calcolo della home, per il tempo di attesa del corriere).
  const risposta = richiesta
    ? await db
        .prepare(
          `SELECT rr.*, EXTRACT(EPOCH FROM (NOW() - rr.risposto_il))::int AS secondi_da_risposta
             FROM request_responses rr
            WHERE rr.request_id = ? AND rr.distributor_id = ?`
        )
        .get(richiesta.id, distributorId)
    : null;
  if (!richiesta || !risposta) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }

  // Letture indipendenti: partono insieme (col DB su un altro server ogni query in sequenza costa ~50 ms).
  const [cliente, offerta, distributore, ordine, secondi, minutiRisposta, minutiTesto, legameCliente] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id),
    richieste.calcolaOfferta(richiesta.id, distributorId),
    db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId),
    richiesta.order_id ? db.prepare('SELECT * FROM orders WHERE id = ?').get(richiesta.order_id) : null,
    richieste.secondiRimasti(richiesta),
    pricing.getFinestraMinuti(),
    pricing.getFinestraMinutiTesto(),
    // La scheda del cliente si apre solo se il cliente ha indicato questo banco (altrimenti la pagina risponde 404).
    anagrafiche.legame(distributorId, richiesta.cliente_id),
  ]);

  // La risposta si può ancora dare solo se la finestra è aperta e nessuno ha già ordinato.
  const apribile =
    risposta.esito === 'in_attesa' &&
    secondi > 0 &&
    richiesta.stato !== 'ordinata' &&
    richiesta.stato !== 'annullata';
  const ordineMio = !!ordine && ordine.distributor_id === distributorId;
  // L'ordine è nella colonna "Da preparare" della home finché è 'inviato' (e non segnato consegnato).
  const ordineDaPreparare = ordineMio && ordine.stato === 'inviato' && !ordine.consegnato_il;
  const stato = richiestaBanco.statoRichiestaBanco({ richiesta, risposta, apribile, ordineMio, ordineDaPreparare });

  // La freccia riporta alla pagina da cui si è arrivati (`torna`: Storico, scheda cliente...), altrimenti alla home.
  const daDove = ritornoBanco(req.query.torna, '');

  // Quando l'ordine è "Da preparare" (un corriere ha accettato, o non ce n'è bisogno) la richiesta non ha più una sua pagina: si va dritti a quella
  // dell'ordine (materiale, ritiro del corriere, "Preparato"). Anche la pagina in attesa del corriere, che si ricarica da sola, arriva qui. La freccia
  // dell'ordine riporta da dove si era partiti (`daDove`: la home se non c'è), non alla richiesta.
  if (stato.chiave === 'da_preparare') return res.redirect(conRitorno('/distributore/ordini/' + ordine.id, daDove));

  const conCorriere = whatsapp.attivo();
  // "confermata alle 21:05" (ora italiana): solo se il banco ha confermato.
  const oraConferma = risposta.esito === 'confermato' && risposta.risposto_il ? format.oraSolaRoma(risposta.risposto_il) : null;

  res.render('distributore_dettaglio', {
    titolo: 'Richiesta #' + richiesta.id,
    // Non si chiama `indietro`: l'intestazione del banco (partials/banco_testa), inclusa dalla vista, ne disegnerebbe un'altra freccia.
    paginaPrecedente: daDove || '/distributore',
    minutiRisposta,
    minutiTesto, // il numero scritto nel testo di "richiesta chiusa" (10); minutiRisposta serve all'anello
    richiesta,
    risposta,
    cliente,
    distributore,
    offerta,
    ordine,
    ordineMio,
    secondi,
    apribile,
    stato,
    materiale: richiestaBanco.tabellaMateriale(offerta.righe, (riga) => pricing.prezzoNetto(riga), {
      confermata: risposta.esito === 'confermato',
    }),
    // Timer: la finestra intera serve all'anello, la soglia al passaggio al rosso (data-* sulla scheda, public/app.js).
    finestraSecondi: Math.max(1, Math.round(minutiRisposta * 60)),
    sogliaUrgenteSec: richiestaBanco.SOGLIA_URGENTE_SEC,
    ricevuta: richiestaBanco.quandoRicevuta(format.giornoRoma(richiesta.creato_il), format.oraSolaRoma(richiesta.creato_il)),
    scadenzaOra: format.oraSolaRoma(richiesta.scade_il),
    // Da confermare: "Cosa succede dopo la conferma" (siamo al primo passo). In attesa del corriere: "Avanzamento", con la conferma fatta e, se il
    // modulo WhatsApp è acceso, il passo dei corrieri in corso.
    passi: richiestaBanco.passiDopoConferma({
      conCorriere,
      corrente: stato.chiave === 'da_confermare' ? 'conferma' : conCorriere ? 'corrieri' : 'prepara',
      avanzamento: stato.chiave === 'attesa_corriere' ? { conCorriere, oraConferma } : null,
    }),
    mostraPassi: ['da_confermare', 'attesa_corriere'].includes(stato.chiave),
    oraConferma,
    // Secondi da quando il banco ha confermato: il cerchio dell'attesa e "da N min" partono da qui (data-trascorsi) e salgono.
    trascorsi: Math.max(0, Number(risposta.secondi_da_risposta) || 0),
    conCorriere,
    schedaClienteAperta: !!legameCliente,
    destinazione: richiesta.destinazione || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente) || '',
    errore: req.query.errore || null,
  });
});

// Registra la risposta del banco a una richiesta. Il banco ha solo due azioni possibili: accettare tutto il richiesto al prezzo standard, o rifiutare. Si
// può rispondere sia dal dettaglio della richiesta sia con un click diretto dalla card "Da confermare" in home (in tal caso "torna" riporta alla home
// invece che al dettaglio, ma solo se la risposta va a buon fine).
router.post('/distributore/richieste/:id/rispondi', requireRole('distributore'), async (req, res) => {
  const esitoRisposta = await richieste.rispondi(req.params.id, req.session.user.distributor_id, {
    rifiuta: req.body.azione === 'rifiuta',
    prezzoRichiesto: req.body.azione === 'prezzo_richiesto',
    utenteId: req.session.user.id,
    // Tempi non più scelti dal banco: partenza/consegna stimata restano un default fisso finché non saranno calcolati dal corriere collegato via API.
    // Non si leggono dal corpo della richiesta: la pagina non li manda più, e un valore enorme scritto a mano finiva in una colonna intera ("out of
    // range", 500).
    partenza_ore: 2,
    consegna_ore: 6,
  });

  // "Conferma" dall'avviso a comparsa (public/app.js, "Avvisi del banco") risponde senza lasciare la pagina: chiede JSON e lo riceve, niente redirect.
  if (vuoleJson(req)) return res.status(esitoRisposta.ok ? 200 : 409).json({ ok: !!esitoRisposta.ok, errore: esitoRisposta.ok ? null : esitoRisposta.errore });

  const base = '/distributore/richieste/' + req.params.id;
  if (!esitoRisposta.ok) return res.redirect(base + '?errore=' + encodeURIComponent(esitoRisposta.errore));
  res.redirect(req.body.torna === 'home' ? '/distributore' : base);
});

// Elimina una richiesta dal banco (locale: sparisce solo dal suo banco, da "da confermare" e dallo storico). Se la richiesta è già ordinata su un altro
// banco elimina solo la propria risposta; se è l'unica risposta rimasta e non è ordinata, elimina anche la richiesta vuota (e fa tornare il pagamento).
router.post('/distributore/richieste/:id/elimina', requireRole('distributore'), async (req, res) => {
  const richiesta = await db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  const risposta = richiesta ? await db.prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?').get(richiesta.id, req.session.user.distributor_id) : null;
  if (!richiesta || !risposta) return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  // se la richiesta è già ordinata su altro banco, elimina solo la propria risposta
  // se è l'unica risposta rimasta e non è ordinata, elimina anche la richiesta vuota
  const elimina = db.transaction(async () => {
    await db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    await db.prepare('DELETE FROM request_responses WHERE id = ?').run(risposta.id);
    const rm = await db.prepare('SELECT COUNT(*) n FROM request_responses WHERE request_id = ?').get(richiesta.id);
    const rimaste = rm ? Number(rm.n) : 0;
    if (rimaste === 0 && richiesta.stato !== 'ordinata') {
      // La richiesta sparisce: la carta dell'installatore non deve restare bloccata (o addebitata) per qualcosa che non esiste più. Solo DB (lo esegue
      // il giro di Stripe); no-op se la richiesta era già stata rimborsata o è del vecchio flusso.
      await pagamenti.rimborsa(richiesta.id);
      await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
      await db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
    }
  });
  await elimina();
  res.redirect('/distributore');
});

// ---------- Ordini ricevuti e preparazione ----------

// I vecchi link (e i segnalibri) alla lista degli ordini arrivano allo Storico, con la loro query string (301). La lista degli ordini è lo Storico ordini:
// il dettaglio /distributore/ordini/:id resta com'è.
router.get('/distributore/ordini', requireRole('distributore'), (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect(301, '/distributore/storico' + (i === -1 ? '' : req.originalUrl.slice(i)));
});

// Mostra la pagina dell'ordine vista dal banco (views/distributore_ordine.ejs, src/ordine_banco.js): materiale, consegna, cliente, avanzamento e, a
// destra, quello che serve in quello stato. Si adatta allo stato (storicoBanco.statoStorico, lo stesso della lista dello Storico), e "Apri ordine
// completo" dello Storico funziona per tutti:
//  · Da preparare: il ritiro del corriere con il conto alla rovescia (il tempo scritto dal corriere su WhatsApp) e il pulsante "Preparato", "Elimina ordine";
//  · In consegna (dopo "Preparato"): la scheda "In consegna" (partito, ritiro del corriere, corriere);
//  · Consegnato: la scheda "Consegnato" (quando, tempo di consegna).
// SOLA LETTURA in ogni stato: aprirla non cambia l'ordine. In particolare un ordine già partito o consegnato non si tocca: prendiInCarico (che lo
// porterebbe a 'in_evasione') non si chiama da qui, e comunque agisce solo su 'inviato'. Prova: test "banco: pagina dell'ordine in consegna e consegnato...".
router.get('/distributore/ordini/:id', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const stato = storicoBanco.statoStorico(ordine);
  const daPreparare = stato.chiave === 'da_preparare';

  const distributorId = req.session.user.distributor_id;
  // Quando il corriere arriva dal banco: il tempo che ha scritto su WhatsApp (src/corriere.js). È l'unico orario del corriere che il banco vede.
  const ritiroCorriere = orariCorriere.ritiro(ordine);
  // Letture indipendenti: partono insieme (ogni query in sequenza costa un giro di rete). `secondi`: quanti ne mancano al corriere, calcolati dal DB.
  const [cliente, distributore, righe, risposta, ivaConfig, arrivo, legameCliente] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id),
    db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id),
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(ordine.id),
    ordine.request_id ? richieste.getRisposta(ordine.request_id, ordine.distributor_id) : null,
    pricing.getIvaPct(),
    // Il conto alla rovescia del ritiro c'è solo finché l'ordine è da preparare.
    daPreparare && ritiroCorriere
      ? db.prepare(`SELECT EXTRACT(EPOCH FROM (${orariCorriere.ritiroSql('')} - NOW()))::int AS secondi FROM orders WHERE id = ?`).get(ordine.id)
      : null,
    // "Apri scheda cliente" solo se il cliente ha indicato questo banco (altrimenti la pagina risponde 404).
    anagrafiche.legame(distributorId, ordine.cliente_id),
  ]);
  // Le righe confermate a metà si leggono solo se il banco ha risposto con una copertura parziale (la UI di oggi non la produce più).
  const mancanti = risposta && risposta.copertura === 'parziale'
    ? (await richieste.calcolaOfferta(ordine.request_id, ordine.distributor_id)).mancanti
    : [];

  // Gli importi del banco, gli stessi del Materiale ordinato del cliente e dello Storico: merce, IVA (quella salvata nell'ordine) e totale.
  const importi = pricing.importi({ ordine, pagamento: null, ivaPct: pricing.ivaPctOrdine(ordine, ivaConfig) });
  const materiale = ordineBanco.righeMateriale(righe, mancanti);
  const conCorriere = !!(ordine.corriere_risposto_il || ordine.corriere_nome);
  const destinazione = ordine.destinazione || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente) || '';
  const corriereNome = ordine.corriere_nome || (risposta && risposta.corriere_nome) || '';
  const oraRitiro = ritiroCorriere ? format.oraRoma(ritiroCorriere) : '';
  // Quando è partita la merce (il "Preparato"): lo vedono "In consegna" e "Consegnato".
  const partenza = ordineBanco.partenza(ordine);
  const consegnato = stato.chiave === 'consegnato';

  res.render('distributore_ordine', {
    titolo: 'Ordine #' + ordine.id,
    // La freccia riporta alla pagina da cui si è arrivati (`torna`: Storico, scheda cliente, richiesta), altrimenti alla home.
    paginaPrecedente: ritornoBanco(req.query.torna),
    ordine,
    cliente,
    stato,
    // Un ordine consegnato non è più "di oggi": la testata dice il giorno ("il 19/10 alle 09:28").
    ricevuto: consegnato
      ? ordineBanco.ricevutoIl(ordine)
      : richiestaBanco.quandoRicevuta(format.giornoRoma(ordine.creato_il), format.oraSolaRoma(ordine.creato_il)),
    materiale,
    conta: storicoDettaglio.contaMateriale(materiale.righe),
    banco: importi.banco,
    ivaPct: importi.ivaPct,
    conCorriere,
    corriereNome,
    // La scheda "In consegna": quando è partito e quando è previsto l'arrivo. La scheda "Consegnato": quando, da quando è partito e in quanto tempo.
    inConsegna: stato.chiave === 'in_consegna' ? { testo: ordineBanco.testoInConsegna(ordine) } : null,
    consegnato: consegnato
      ? {
          testo: ordineBanco.consegnatoTesto(ordine),
          partito: partenza ? `${format.giornoMeseRoma(partenza)} · ${format.oraSolaRoma(partenza)}` : '',
          durata: ordineBanco.tempoDiConsegna(ordine) || '',
        }
      : null,
    // Il riquadro "Ritiro": c'è l'orario del corriere, e solo finché l'ordine è da preparare. I secondi si muovono nel browser (app.js, data-ric-arrivo).
    ritiro: daPreparare && oraRitiro
      ? {
          secondi: Number(arrivo && arrivo.secondi) || 0,
          ora: oraRitiro,
          oraAccettato: ordine.corriere_risposto_il ? format.oraRoma(ordine.corriere_risposto_il) : '',
          sogliaMin: BACHECA.arrivoVicinoMin,
        }
      : null,
    passi: ordineBanco.passiOrdine({
      stato: stato.chiave,
      oraConferma: format.oraSolaRoma((risposta && risposta.risposto_il) || ordine.creato_il),
      corriere: conCorriere
        ? { nome: corriereNome, ora: ordine.corriere_risposto_il ? format.oraRoma(ordine.corriere_risposto_il) : '' }
        : null,
      oraRitiro,
      partito: { quando: ordineBanco.momento(partenza, ordine.creato_il) },
      consegnato: { quando: ordineBanco.momento(ordine.consegnato_il, ordine.creato_il) },
    }),
    destinazione,
    indirizzo: ordineBanco.indirizzoDiviso(destinazione),
    distanza: distanzaClienteBanco(cliente, distributore),
    descrizioneConsegna: ordineBanco.descrizioneConsegna({ modalita: ordine.modalita, conCorriere, corriereNome }),
    sottotitoloCliente: ordineBanco.sottotitoloCliente(cliente),
    schedaClienteAperta: !!legameCliente,
    errore: req.query.errore || null,
  });
});

// "Preparato": dalla card "Da preparare" in home (`torna` = 'home': la card sparisce da lì) o dalla pagina dell'ordine (`torna` = la pagina da cui si era
// arrivati: si resta sull'ordine, che ora è "In consegna", e la sua freccia riporta ancora lì). Il materiale parte e il cliente è avvisato.
router.post('/distributore/ordini/:id/preparazione', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/storico');
  await prendiInCarico(ordine);
  if (req.body.torna === 'home') return res.redirect('/distributore');
  res.redirect(conRitorno('/distributore/ordini/' + ordine.id, ritornoBanco(req.body.torna, '')));
});

// Elimina un ordine dal banco: l'ordine sparisce, e il pagamento torna all'installatore (che viene avvisato). È l'unico caso in cui un ordine confermato si
// annulla.
router.post('/distributore/ordini/:id/elimina', requireRole('distributore'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const elimina = db.transaction(async () => {
    // L'ordine sparisce, ma l'installatore ha già pagato la consegna (con Stripe la carta è anche già stata incassata): il pagamento gli torna (solo
    // DB; lo esegue il giro di Stripe). Senza questa riga spariva l'ordine e restava addebitato.
    const rimborsato = ordine.request_id ? await pagamenti.rimborsa(ordine.request_id) : false;
    if (ordine.request_id) await db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', ordine.request_id);
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ordine.id);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(ordine.id);
    return rimborsato;
  });
  const rimborsato = await elimina();
  // L'installatore deve saperlo: altrimenti l'ordine sparisce dal suo "Stato ordini" senza una parola.
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Ordine annullato dal banco',
    testo: `Ordine #${ordine.id} — Il banco ha annullato l'ordine.` + (rimborsato ? ' Il pagamento è stato rimborsato.' : ''),
    link: '/ordini',
    categoria: 'ordini',
  }).catch((err) => console.error('[ordini] notifica di annullamento non inviata:', err.message));
  res.redirect('/distributore');
});

module.exports = router;
