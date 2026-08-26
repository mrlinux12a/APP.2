require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('./db');
const { requireLogin, requireRole } = require('./src/auth');
const pricing = require('./src/pricing');
const format = require('./src/format');
const catalogo = require('./src/catalogo');
const richieste = require('./src/richieste');
const notifiche = require('./src/notifiche');
const ddt = require('./src/ddt');
const geo = require('./src/geo');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'minuteria-mvp-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 ore
  })
);

// rende disponibili utente, helper e contatori a tutte le viste
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.euro = pricing.euro;
  res.locals.prezzoCliente = pricing.prezzoCliente;
  // Gli ordini creati prima delle offerte per distributore non hanno l'IVA calcolata.
  res.locals.totaleOrdine = (o) => (o.totale_ivato > 0 ? o.totale_ivato : o.totale_finale);
  res.locals.fmt = format;
  res.locals.carrelloPezzi = contaCarrello(req);
  res.locals.notificheNonLette = req.session.user ? notifiche.nonLette(req.session.user.id) : 0;
  res.locals.testoDisponibilita = TESTO_DISPONIBILITA;
  res.locals.geo = req.session.user ? geo.statoUtente(req.session.user.id) : { consenso: false };
  // I contatori del banco servono alla barra di navigazione di tutte le pagine distributore.
  res.locals.contatori =
    req.session.user && req.session.user.ruolo === 'distributore' && req.session.user.distributor_id
      ? contatoriBanco(req.session.user.distributor_id)
      : null;
  next();
});

// ---------- Carrello in sessione ----------

function getCarrello(req) {
  if (!req.session.carrello) req.session.carrello = {};
  return req.session.carrello;
}

function contaCarrello(req) {
  const c = req.session && req.session.carrello ? req.session.carrello : {};
  return Object.values(c).reduce((acc, q) => acc + q, 0);
}

// Trasforma il carrello di sessione in righe [{prodotto, quantita}] con i dati aggiornati.
function righeCarrello(req) {
  const carrello = getCarrello(req);
  const ids = Object.keys(carrello).map(Number).filter((id) => carrello[id] > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const prodotti = db
    .prepare(
      `SELECT * FROM products WHERE attivo = 1 AND id IN (${placeholders}) ORDER BY macro_slug, categoria, nome`
    )
    .all(...ids);
  return prodotti.map((prodotto) => ({ prodotto, quantita: carrello[prodotto.id] }));
}

// Legge i campi quantita_<id> di un form e aggiorna il carrello di sessione.
// modo 'aggiungi' (cataloghi e ricerca): le quantità si sommano, lo zero non tocca nulla.
// modo 'imposta' (pagina carrello): le quantità sostituiscono, lo zero rimuove la riga.
function aggiornaCarrelloDaForm(req, modo = 'aggiungi') {
  const carrello = getCarrello(req);
  for (const [chiave, valore] of Object.entries(req.body)) {
    if (!chiave.startsWith('quantita_')) continue;
    const id = parseInt(chiave.slice('quantita_'.length), 10);
    if (!id) continue;
    const q = Math.max(0, parseInt(valore, 10) || 0);
    if (modo === 'imposta') {
      if (q > 0) carrello[id] = q;
      else delete carrello[id];
    } else if (q > 0) {
      carrello[id] = (carrello[id] || 0) + q;
    }
  }
}

// ---------- Home / Login ----------

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.ruolo === 'agente') return res.redirect('/agente/ordini');
  if (req.session.user.ruolo === 'distributore') return res.redirect('/distributore');
  return res.redirect('/home');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { errore: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { errore: 'Credenziali non valide.' });
  }
  req.session.user = {
    id: user.id,
    ruolo: user.ruolo,
    username: user.username,
    ragione_sociale: user.ragione_sociale,
    zona: user.zona,
    distributor_id: user.distributor_id,
  };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Cliente: home, ricerca, categorie ----------

app.get('/home', requireRole('cliente'), (req, res) => {
  richieste.aggiornaScadenzeAperte();
  const inCorso = db
    .prepare(
      `SELECT * FROM requests
        WHERE cliente_id = ? AND stato IN ('in_attesa', 'con_offerte')
        ORDER BY id DESC`
    )
    .all(req.session.user.id);
  const ultimiOrdini = db
    .prepare(
      `SELECT o.*, d.nome AS distributore_nome
         FROM orders o
         LEFT JOIN distributors d ON d.id = o.distributor_id
        WHERE o.cliente_id = ?
        ORDER BY o.id DESC LIMIT 3`
    )
    .all(req.session.user.id);

  res.render('home', {
    titolo: 'Ordini Minuteria',
    macro: catalogo.macroCategorie(),
    marchi: catalogo.marchi(),
    inCorso,
    ultimiOrdini,
  });
});

app.get('/cerca', requireRole('cliente'), (req, res) => {
  const q = (req.query.q || '').trim();
  const risultati = q ? catalogo.cercaProdotti(q) : [];
  res.render('cerca', {
    titolo: 'Cerca',
    q,
    risultati,
    carrello: getCarrello(req),
  });
});

const TESTO_DISPONIBILITA = {
  disponibile: 'Disponibile',
  in_esaurimento: 'In esaurimento',
  non_disponibile: 'Non disponibile',
};

// Ricerca mentre si digita: stessa logica parziale della pagina /cerca.
app.get('/api/cerca', requireRole('cliente'), (req, res) => {
  const q = (req.query.q || '').trim();
  // L'ambito arriva dalla pagina che sta cercando: categoria, marchio, famiglia, gruppo.
  const ambito = {
    macroSlug: req.query.macro || null,
    brandSlug: req.query.marchio || null,
    famiglia: req.query.famiglia || null,
    gruppo: req.query.gruppo || null,
    limite: 60,
  };
  const risultati = q.length >= 2 ? catalogo.cercaProdotti(q, ambito) : [];
  res.json({
    risultati: risultati.map((p) => ({
      id: p.id,
      codice: p.codice,
      nome: p.nome,
      macro_nome: p.macro_nome,
      brand_nome: p.brand_nome,
      brand_colore: p.brand_colore,
      raee: p.raee > 0 ? pricing.euro(p.raee) : null,
      disponibilita: p.disponibilita,
      disponibilita_testo: TESTO_DISPONIBILITA[p.disponibilita] || p.disponibilita,
      sconto_base_pct: p.sconto_base_pct,
      listino: pricing.euro(p.prezzo_listino),
      prezzo: pricing.euro(pricing.prezzoCliente(p)),
    })),
  });
});

app.get('/categoria/:slug', requireRole('cliente'), (req, res) => {
  const macro = catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Categoria non trovata.' });

  const gruppi = catalogo.gruppiPerMacro(macro.slug);
  const gruppo = req.query.gruppo || (gruppi.length === 1 ? gruppi[0].nome : null);
  const q = (req.query.q || '').trim();

  // Con una ricerca attiva l'elenco è quello dei risultati, senza paginazione.
  const elenco = q
    ? { righe: catalogo.cercaProdotti(q, { macroSlug: macro.slug, gruppo, limite: 60 }), ricerca: true }
    : gruppo
    ? catalogo.prodottiDelGruppo(macro.slug, gruppo, req.query.p)
    : null;

  res.render('categoria', { titolo: macro.nome, macro, gruppi, gruppo, q, elenco });
});

// ---------- Cliente: marchi ----------

app.get('/marchi', requireRole('cliente'), (req, res) => {
  res.render('marchi', { titolo: 'Marchi', marchi: catalogo.marchi() });
});

app.get('/marchi/:slug', requireRole('cliente'), (req, res) => {
  const marca = catalogo.marchio(req.params.slug);
  if (!marca) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Marchio non trovato.' });

  const famiglie = catalogo.famiglieDelMarchio(marca.slug);
  const codice = req.query.famiglia || null;
  const famiglia = codice ? catalogo.famigliaDelMarchio(marca.slug, codice) : null;
  const q = (req.query.q || '').trim();

  // Cercando dentro un marchio i risultati restano dentro quel marchio (e, se si sta
  // sfogliando una famiglia, dentro quella famiglia).
  const elenco = q
    ? {
        righe: catalogo.cercaProdotti(q, { brandSlug: marca.slug, famiglia: codice, limite: 60 }),
        ricerca: true,
      }
    : codice
    ? catalogo.prodottiDelMarchio(marca.slug, codice, req.query.p)
    : null;

  res.render('marchio', { titolo: marca.nome, marca, famiglie, famiglia, q, elenco });
});

// ---------- Cliente: carrello ----------

app.post('/carrello', requireRole('cliente'), (req, res) => {
  aggiornaCarrelloDaForm(req, req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  if (req.body.azione === 'procedi') return inviaRichiesta(req, res);
  return res.redirect(req.body.ritorno || '/carrello');
});

app.get('/carrello', requireRole('cliente'), (req, res) => {
  res.render('carrello', { titolo: 'Materiale selezionato', righe: righeCarrello(req) });
});

app.post('/carrello/svuota', requireRole('cliente'), (req, res) => {
  req.session.carrello = {};
  res.redirect('/home');
});

// ---------- Cliente: richiesta di disponibilità ----------

// "Procedi": manda la richiesta ai distributori della zona e apre la schermata di attesa.
app.post('/richieste', requireRole('cliente'), (req, res) => {
  aggiornaCarrelloDaForm(req, 'aggiungi');
  return inviaRichiesta(req, res);
});

function inviaRichiesta(req, res) {
  const righe = righeCarrello(req);
  if (!righe.length) {
    return res.status(400).render('errore', {
      titolo: 'Nessun materiale',
      messaggio: 'Seleziona almeno un prodotto prima di procedere.',
      link: '/home',
      linkTesto: 'Torna alla home',
    });
  }

  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const { requestId } = richieste.creaRichiesta(cliente, righe);
  req.session.carrello = {};
  res.redirect('/richieste/' + requestId);
}

app.get('/richieste/:id', requireRole('cliente'), (req, res) => {
  const richiesta = richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  if (richiesta.stato === 'ordinata' && richiesta.order_id) {
    return res.redirect('/ordini/' + richiesta.order_id);
  }

  const dati = {
    titolo: 'Richiesta #' + richiesta.id,
    richiesta,
    righe: richieste.righeRichiesta(richiesta.id),
    risposte: richieste.risposteRichiesta(richiesta.id),
    secondi: richieste.secondiRimasti(richiesta),
  };

  if (richiesta.stato === 'in_attesa') return res.render('richiesta_attesa', dati);
  return res.render('richiesta_offerte', {
    ...dati,
    offerte: richieste.offerte(richiesta.id),
  });
});

// Stato della richiesta per la schermata di attesa (polling + notifica push del browser).
app.get('/api/richieste/:id', requireRole('cliente'), (req, res) => {
  const richiesta = richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).json({ errore: 'non trovata' });
  }
  const risposte = richieste.risposteRichiesta(richiesta.id);
  res.json({
    stato: richiesta.stato,
    secondi: richieste.secondiRimasti(richiesta),
    conferme: risposte.filter((r) => r.esito === 'confermato').length,
    risposte: risposte.map((r) => ({ nome: r.distributore_nome, esito: r.esito })),
  });
});

app.post('/richieste/:id/annulla', requireRole('cliente'), (req, res) => {
  const richiesta = richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/home');
  if (richiesta.stato !== 'ordinata') {
    db.prepare(`UPDATE requests SET stato = 'annullata' WHERE id = ?`).run(richiesta.id);
  }
  res.redirect('/home');
});

// Riepilogo ordine con il distributore scelto.
app.get('/richieste/:id/offerta/:distributorId', requireRole('cliente'), (req, res) => {
  const richiesta = richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  const risposta = db
    .prepare(
      `SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ? AND esito = 'confermato'`
    )
    .get(richiesta.id, req.params.distributorId);
  if (!risposta) {
    return res.status(404).render('errore', {
      titolo: 'Offerta non valida',
      messaggio: 'Questo distributore non ha confermato la disponibilità.',
      link: '/richieste/' + richiesta.id,
      linkTesto: 'Torna alle offerte',
    });
  }

  const modalita = req.query.modalita === 'ritiro' ? 'ritiro' : 'consegna_mezzo_grossista';
  const offerta = richieste.calcolaOfferta(richiesta.id, req.params.distributorId, { modalita });
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  res.render('riepilogo', {
    titolo: "Riepilogo dell'ordine",
    richiesta,
    risposta,
    offerta,
    modalita,
    cliente,
    ivaPct: pricing.getIvaPct(),
  });
});

// ---------- Cliente: ordine ----------

app.post('/ordini', requireRole('cliente'), (req, res) => {
  const richiesta = richieste.getRichiesta(req.body.request_id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  if (richiesta.stato === 'ordinata') return res.redirect('/ordini/' + richiesta.order_id);

  const distributorId = parseInt(req.body.distributor_id, 10);
  const risposta = db
    .prepare(
      `SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ? AND esito = 'confermato'`
    )
    .get(richiesta.id, distributorId);
  if (!risposta) {
    return res.status(400).render('errore', {
      titolo: 'Offerta non valida',
      messaggio: 'Questo distributore non ha confermato la disponibilità.',
      link: '/richieste/' + richiesta.id,
      linkTesto: 'Torna alle offerte',
    });
  }

  const modalita = req.body.modalita === 'ritiro' ? 'ritiro' : 'consegna_mezzo_grossista';
  const note = (req.body.note || '').trim();
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const destinazione =
    modalita === 'ritiro'
      ? 'Ritiro al banco'
      : (req.body.destinazione || '').trim() || cliente.indirizzo_consegna || ddt.indirizzoCompleto(cliente);
  const { totali } = richieste.calcolaOfferta(richiesta.id, distributorId, { modalita });

  const insertOrder = db.prepare(
    `INSERT INTO orders
       (cliente_id, stato, modalita, note, totale_netto, totale_finale,
        request_id, distributor_id, consegna_ore, partenza_ore, destinazione,
        costo_consegna, contributo_raee, iva, totale_ivato)
     VALUES (?, 'inviato', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items
       (order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_listino_snapshot,
        sconto_pct_snapshot, prezzo_netto_unitario, subtotale, prezzo_unitario_cliente,
        subtotale_cliente, raee_unitario, raee_riga)
     VALUES (@order_id, @product_id, @codice_snapshot, @nome_snapshot, @quantita, @prezzo_listino_snapshot,
             @sconto_pct_snapshot, @prezzo_netto_unitario, @subtotale, @prezzo_unitario_cliente,
             @subtotale_cliente, @raee_unitario, @raee_riga)`
  );

  const creaOrdine = db.transaction(() => {
    const info = insertOrder.run(
      req.session.user.id,
      modalita,
      note,
      totali.totale_netto,
      totali.totale_finale,
      richiesta.id,
      distributorId,
      risposta.consegna_ore,
      risposta.partenza_ore,
      destinazione,
      totali.costo_consegna,
      totali.contributo_raee,
      totali.iva,
      totali.totale_ivato
    );
    const orderId = Number(info.lastInsertRowid);
    totali.righe.forEach((riga) => insertItem.run({ order_id: orderId, ...riga }));
    db.prepare(`UPDATE requests SET stato = 'ordinata', order_id = ? WHERE id = ?`).run(
      orderId,
      richiesta.id
    );
    // Chiuso l'ordine, gli altri banchi non devono più poter rispondere.
    db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = datetime('now')
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(richiesta.id);
    return orderId;
  });

  const orderId = creaOrdine();

  const distributore = db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  notifiche.notificaDistributore(distributorId, {
    titolo: 'Nuovo ordine da preparare',
    testo: `${req.session.user.ragione_sociale} ha scelto ${distributore.nome} — ordine #${orderId}.`,
    link: '/distributore/ordini/' + orderId,
  });

  res.redirect('/ordini/' + orderId + '?nuovo=1');
});

app.get('/ordini', requireRole('cliente'), (req, res) => {
  const ordini = db
    .prepare(
      `SELECT o.*, d.nome AS distributore_nome
         FROM orders o
         LEFT JOIN distributors d ON d.id = o.distributor_id
        WHERE o.cliente_id = ?
        ORDER BY o.id DESC`
    )
    .all(req.session.user.id);
  res.render('ordini_cliente', { titolo: 'I miei ordini', ordini });
});

app.get('/ordini/:id', requireLogin, (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });

  // un cliente può vedere solo i propri ordini; l'agente li vede tutti
  if (req.session.user.ruolo === 'cliente' && ordine.cliente_id !== req.session.user.id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  if (req.session.user.ruolo === 'distributore' && ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }

  const righe = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = ordine.distributor_id
    ? db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id)
    : null;

  res.render('ordine_dettaglio', {
    titolo: 'Ordine #' + ordine.id,
    ordine,
    righe,
    cliente,
    distributore,
    nuovo: req.query.nuovo === '1',
    ivaPct: pricing.getIvaPct(),
  });
});

// ---------- Notifiche ----------

app.get('/notifiche', requireLogin, (req, res) => {
  const elenco = notifiche.elenco(req.session.user.id);
  notifiche.segnaLette(req.session.user.id);
  res.locals.notificheNonLette = 0; // appena lette: la campanella non deve restare accesa
  res.render('notifiche', { titolo: 'Notifiche', elenco });
});

// Notifiche non ancora mostrate: app.js le trasforma in notifica push del browser.
app.get('/api/notifiche/push', requireLogin, (req, res) => {
  res.json({ notifiche: notifiche.daMostrare(req.session.user.id) });
});

// ---------- Geolocalizzazione (solo con consenso esplicito) ----------

// Il browser chiede il permesso all'utente; qui arriva la posizione solo dopo che l'ha dato.
app.post('/api/posizione', requireLogin, (req, res) => {
  const salvata = geo.salvaPosizione(req.session.user.id, {
    lat: req.body.lat,
    lng: req.body.lng,
    precisione: req.body.precisione,
  });
  if (!salvata) return res.status(400).json({ ok: false, errore: 'Coordinate non valide.' });
  res.json({ ok: true, ...geo.statoUtente(req.session.user.id) });
});

// Revoca: spegne il consenso e cancella davvero le coordinate salvate.
app.post('/api/posizione/revoca', requireLogin, (req, res) => {
  geo.revoca(req.session.user.id);
  if (req.session.user.ruolo === 'distributore' && req.session.user.distributor_id) {
    db.prepare(
      `UPDATE orders SET tracciamento_attivo = 0 WHERE distributor_id = ? AND tracciamento_attivo = 1`
    ).run(req.session.user.distributor_id);
  }
  res.json({ ok: true, consenso: false });
});

// Il banco accende o spegne la condivisione del mezzo per un singolo ordine.
app.post('/api/ordini/:id/tracciamento', requireRole('distributore'), (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(404).json({ ok: false });
  }
  const attivo = req.body.attivo ? 1 : 0;
  if (attivo && !geo.statoUtente(req.session.user.id).consenso) {
    return res
      .status(400)
      .json({ ok: false, errore: 'Attiva prima la posizione del banco: serve il tuo consenso.' });
  }
  db.prepare('UPDATE orders SET tracciamento_attivo = ? WHERE id = ?').run(attivo, ordine.id);
  if (attivo) {
    notifiche.notifica(ordine.cliente_id, {
      titolo: 'Consegna in viaggio',
      testo: `Puoi seguire in tempo reale il mezzo che porta l'ordine #${ordine.id}.`,
      link: '/ordini/' + ordine.id,
    });
  }
  res.json({ ok: true, attivo: attivo === 1 });
});

// Il cliente segue il mezzo: risponde solo se il banco sta condividendo per quell'ordine.
app.get('/api/ordini/:id/posizione', requireLogin, (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine) return res.status(404).json({ attivo: false });
  const utente = req.session.user;
  const suo =
    (utente.ruolo === 'cliente' && ordine.cliente_id === utente.id) ||
    (utente.ruolo === 'distributore' && ordine.distributor_id === utente.distributor_id) ||
    utente.ruolo === 'agente';
  if (!suo) return res.status(403).json({ attivo: false });

  if (!ordine.tracciamento_attivo || !ordine.distributor_id) return res.json({ attivo: false });

  const distributore = db
    .prepare('SELECT geo_lat, geo_lng, nome FROM distributors WHERE id = ?')
    .get(ordine.distributor_id);
  const cliente = db
    .prepare('SELECT geo_lat, geo_lng, geo_consenso FROM users WHERE id = ?')
    .get(ordine.cliente_id);

  const mezzo =
    distributore && distributore.geo_lat !== null
      ? { lat: distributore.geo_lat, lng: distributore.geo_lng }
      : null;
  const destinazione =
    cliente && cliente.geo_consenso && cliente.geo_lat !== null
      ? { lat: cliente.geo_lat, lng: cliente.geo_lng }
      : null;
  const km = geo.distanzaKm(mezzo, destinazione);

  res.json({
    attivo: true,
    mezzo,
    destinazione,
    nome_mezzo: distributore ? distributore.nome : '',
    distanza_km: km,
    distanza: geo.formattaDistanza(km),
  });
});

// ---------- Distributore: banco ----------

// Distanza banco↔cliente: c'è solo se entrambi hanno dato il consenso alla posizione.
function distanzaClienteBanco(cliente, distributore) {
  if (!cliente || !distributore) return null;
  if (!cliente.geo_consenso) return null;
  const km = geo.distanzaKm(
    { lat: cliente.geo_lat, lng: cliente.geo_lng },
    { lat: distributore.geo_lat, lng: distributore.geo_lng }
  );
  return geo.formattaDistanza(km);
}

// Riepilogo dei numeri che il banco deve avere sotto gli occhi.
function contatoriBanco(distributorId) {
  const q = (sql, ...p) => db.prepare(sql).get(distributorId, ...p).n;
  return {
    daRispondere: q(
      `SELECT COUNT(*) AS n FROM request_responses rr JOIN requests r ON r.id = rr.request_id
        WHERE rr.distributor_id = ? AND rr.esito = 'in_attesa' AND r.scade_il > datetime('now')`
    ),
    daPreparare: q(
      `SELECT COUNT(*) AS n FROM orders WHERE distributor_id = ? AND stato = 'inviato'`
    ),
    inPreparazione: q(
      `SELECT COUNT(*) AS n FROM orders WHERE distributor_id = ? AND stato = 'in_evasione'`
    ),
  };
}

app.get('/distributore', requireRole('distributore'), (req, res) => {
  richieste.aggiornaScadenzeAperte();
  const distributore = db
    .prepare('SELECT * FROM distributors WHERE id = ?')
    .get(req.session.user.distributor_id);

  const elenco = db
    .prepare(
      `SELECT r.*, rr.esito, u.ragione_sociale AS cliente_nome,
              CAST((julianday(r.scade_il) - julianday('now')) * 86400 AS INTEGER) AS secondi,
              (SELECT SUM(quantita) FROM request_items ri WHERE ri.request_id = r.id) AS pezzi
         FROM request_responses rr
         JOIN requests r ON r.id = rr.request_id
         JOIN users u ON u.id = r.cliente_id
        WHERE rr.distributor_id = ?
        ORDER BY r.id DESC
        LIMIT 50`
    )
    .all(req.session.user.distributor_id);

  res.render('distributore_richieste', {
    titolo: 'Richieste al banco',
    distributore,
    contatori: contatoriBanco(req.session.user.distributor_id),
    // Aperte finché la finestra non scade, anche se un altro banco ha già confermato.
    daRispondere: elenco.filter((r) => r.esito === 'in_attesa' && r.secondi > 0),
    storico: elenco.filter((r) => !(r.esito === 'in_attesa' && r.secondi > 0)),
  });
});

app.get('/distributore/richieste/:id', requireRole('distributore'), (req, res) => {
  const richiesta = richieste.aggiornaScadenza(req.params.id);
  const distributorId = req.session.user.distributor_id;
  const risposta = richiesta
    ? db
        .prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?')
        .get(richiesta.id, distributorId)
    : null;
  if (!richiesta || !risposta) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }

  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const offerta = richieste.calcolaOfferta(richiesta.id, distributorId);
  const distributore = db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const ordine = richiesta.order_id
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(richiesta.order_id)
    : null;

  const secondi = richieste.secondiRimasti(richiesta);
  res.render('distributore_dettaglio', {
    titolo: 'Richiesta #' + richiesta.id,
    richiesta,
    risposta,
    cliente,
    distributore,
    offerta,
    ordine,
    secondi,
    // La risposta si può ancora dare solo se la finestra è aperta e nessuno ha già ordinato.
    apribile:
      risposta.esito === 'in_attesa' &&
      secondi > 0 &&
      richiesta.stato !== 'ordinata' &&
      richiesta.stato !== 'annullata',
    indirizzoCliente: ddt.indirizzoCompleto(cliente),
    distanza: distanzaClienteBanco(cliente, distributore),
    // Sconto già concordato con questo cliente: precompila il modulo.
    scontoCliente: richieste.scontoCliente(distributorId, richiesta.cliente_id),
    servizioPct: pricing.getServizioPct(),
    errore: req.query.errore || null,
  });
});

// Il banco risponde riga per riga: campi disp_<product_id> con la quantità che riesce a
// coprire, più il tempo di partenza e quello di consegna. Il pulsante "rifiuta" azzera tutto.
app.post('/distributore/richieste/:id/rispondi', requireRole('distributore'), (req, res) => {
  const righe = {};
  const sconti = {};
  for (const [chiave, valore] of Object.entries(req.body)) {
    if (chiave.startsWith('disp_')) {
      const id = parseInt(chiave.slice('disp_'.length), 10);
      if (id) righe[id] = parseInt(valore, 10) || 0;
    } else if (chiave.startsWith('sconto_riga_')) {
      const id = parseInt(chiave.slice('sconto_riga_'.length), 10);
      if (id) sconti[id] = valore;
    }
  }

  const esitoRisposta = richieste.rispondi(req.params.id, req.session.user.distributor_id, {
    righe,
    sconti,
    rifiuta: req.body.azione === 'rifiuta',
    // "Accetta al prezzo di richiesta": conferma tutto com'è, senza toccare gli sconti.
    prezzoRichiesto: req.body.azione === 'prezzo_richiesto',
    scontoCliente: req.body.sconto_cliente,
    salvaScontoCliente: req.body.salva_sconto === 'si',
    partenza_ore: req.body.partenza_ore,
    consegna_ore: req.body.consegna_ore,
    note: req.body.note,
  });

  const base = '/distributore/richieste/' + req.params.id;
  res.redirect(esitoRisposta.ok ? base : base + '?errore=' + encodeURIComponent(esitoRisposta.errore));
});

// ---------- Distributore: ordini ricevuti, preparazione e bolla ----------

app.get('/distributore/ordini', requireRole('distributore'), (req, res) => {
  const ordini = db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome, u.citta AS cliente_citta
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
        WHERE o.distributor_id = ?
        ORDER BY CASE o.stato WHEN 'inviato' THEN 0 WHEN 'in_evasione' THEN 1 ELSE 2 END, o.id DESC`
    )
    .all(req.session.user.distributor_id);

  res.render('distributore_ordini', {
    titolo: 'Ordini da evadere',
    contatori: contatoriBanco(req.session.user.distributor_id),
    ordini,
  });
});

// Carica un ordine verificando che appartenga al banco loggato.
function ordineDelBanco(req) {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) return null;
  return ordine;
}

app.get('/distributore/ordini/:id', requireRole('distributore'), (req, res) => {
  const ordine = ordineDelBanco(req);
  if (!ordine) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }

  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = db
    .prepare('SELECT * FROM distributors WHERE id = ?')
    .get(ordine.distributor_id);
  const righe = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const risposta = ordine.request_id
    ? richieste.getRisposta(ordine.request_id, ordine.distributor_id)
    : null;
  const mancanti = ordine.request_id
    ? richieste.calcolaOfferta(ordine.request_id, ordine.distributor_id).mancanti
    : [];

  res.render('distributore_ordine', {
    titolo: 'Ordine #' + ordine.id,
    ordine,
    cliente,
    distributore,
    righe,
    risposta,
    mancanti,
    indirizzoCliente: ddt.indirizzoCompleto(cliente),
    distanza: distanzaClienteBanco(cliente, distributore),
    ivaPct: pricing.getIvaPct(),
    errore: req.query.errore || null,
  });
});

app.post('/distributore/ordini/:id/preparazione', requireRole('distributore'), (req, res) => {
  const ordine = ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/ordini');
  if (ordine.stato === 'inviato') {
    db.prepare(
      `UPDATE orders SET stato = 'in_evasione', in_evasione_il = datetime('now'),
                         preso_in_carico_il = datetime('now')
        WHERE id = ?`
    ).run(ordine.id);
    notifiche.notifica(ordine.cliente_id, {
      titolo: 'Ordine in preparazione',
      testo: `Il banco sta preparando il tuo ordine #${ordine.id}.`,
      link: '/ordini/' + ordine.id,
    });
  }
  res.redirect('/distributore/ordini/' + ordine.id);
});

// Emissione della bolla / DDT: assegna il numero progressivo e segna la merce partita.
app.post('/distributore/ordini/:id/ddt', requireRole('distributore'), (req, res) => {
  const ordine = ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/ordini');
  if (ordine.stato === 'inviato') {
    return res.redirect(
      '/distributore/ordini/' +
        ordine.id +
        '?errore=' +
        encodeURIComponent('Prendi prima in preparazione l’ordine, poi emetti la bolla.')
    );
  }

  const numero = ddt.emetti(ordine, {
    colli: req.body.colli,
    aspetto: req.body.aspetto,
    trasporto: req.body.trasporto,
    causale: req.body.causale,
    note: req.body.note,
  });

  notifiche.notifica(ordine.cliente_id, {
    titolo: 'Merce in partenza',
    testo: `Ordine #${ordine.id}: emessa la bolla n. ${numero}. Puoi vedere il DDT in app.`,
    link: '/ddt/' + ordine.id,
  });

  res.redirect('/ddt/' + ordine.id);
});

// ---------- Bolla / DDT ----------

app.get('/ddt/:id', requireLogin, (req, res) => {
  const documento = ddt.documento(req.params.id);
  if (!documento) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Documento non trovato.' });
  }

  const { ordine } = documento;
  const utente = req.session.user;
  const puoVedere =
    utente.ruolo === 'agente' ||
    (utente.ruolo === 'cliente' && ordine.cliente_id === utente.id) ||
    (utente.ruolo === 'distributore' && ordine.distributor_id === utente.distributor_id);
  if (!puoVedere) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  if (!ordine.ddt_numero) {
    return res.status(404).render('errore', {
      titolo: 'Bolla non emessa',
      messaggio: 'La bolla per questo ordine non è ancora stata emessa dal distributore.',
      link: utente.ruolo === 'cliente' ? '/ordini/' + ordine.id : '/distributore/ordini/' + ordine.id,
      linkTesto: "Torna all'ordine",
    });
  }

  res.render('ddt', {
    titolo: 'DDT ' + ordine.ddt_numero,
    ...documento,
    indirizzoMittente: ddt.indirizzoCompleto(documento.distributore),
    indirizzoCliente: ddt.indirizzoCompleto(documento.cliente),
    ivaPct: pricing.getIvaPct(),
  });
});

// ---------- Agente: vista ordini ----------

app.get('/agente/ordini', requireRole('agente'), (req, res) => {
  const ordini = db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome, d.nome AS distributore_nome
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
         LEFT JOIN distributors d ON d.id = o.distributor_id
        ORDER BY o.creato_il DESC`
    )
    .all();
  res.render('agente_ordini', { titolo: 'Ordini in arrivo', ordini });
});

// ---------- Avvio ----------

// Le richieste scadono anche se nessuno sta guardando una pagina: così la notifica
// "nessuna conferma" arriva comunque allo scadere dei 10 minuti.
richieste.aggiornaScadenzeAperte();
setInterval(() => {
  try {
    richieste.aggiornaScadenzeAperte();
  } catch (err) {
    console.error('Errore nel controllo scadenze:', err.message);
  }
}, 30 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
});
