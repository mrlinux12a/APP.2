require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('./db');
// auto-seed se DB vuoto (dopo clone/pull basta npm start)
try {
  const nProd = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  if (nProd === 0) {
    console.log('DB vuoto -> eseguo seed automatico...');
    require('./db/seed');
  } else {
    const nDp = db.prepare('SELECT COUNT(*) n FROM distributor_products').get().n;
    if (nDp === 0) {
      console.log('Listini vuoti -> popolo distributor_products...');
      const dists = db.prepare('SELECT id FROM distributors WHERE attivo=1').all();
      const prods = db.prepare('SELECT id, prezzo_listino, sconto_base_pct FROM products').all();
      const ins = db.prepare('INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
      const tx = db.transaction(() => { for (const d of dists) for (const p of prods) ins.run(d.id, p.id, p.prezzo_listino, p.sconto_base_pct); });
      tx();
      console.log(`Listini popolati ${dists.length * prods.length}`);
    }
  }
} catch (e) { console.error('auto-seed fallito', e.message); }

const { requireLogin, requireRole } = require('./src/auth');
const pricing = require('./src/pricing');
const format = require('./src/format');
const catalogo = require('./src/catalogo');
const richieste = require('./src/richieste');
const notifiche = require('./src/notifiche');
const ddt = require('./src/ddt');
const geo = require('./src/geo');
const anagrafiche = require('./src/anagrafiche');
const consegna = require('./src/consegna');
const { ArchivioSqlite } = require('./src/sessioni');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    store: new ArchivioSqlite(), // su file, così un riavvio non scollega nessuno
    secret: process.env.SESSION_SECRET || 'minuteria-mvp-demo-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // ogni visita rinnova la scadenza: chi usa l'app resta dentro
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 giorni
      httpOnly: true,
      sameSite: 'lax',
    },
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
  res.render('login', { titolo: 'Accedi', errore: null, scheda: 'accedi' });
});

// ---------- Registrazione cliente ----------

function distributoriSelezionabili() {
  return db
    .prepare('SELECT id, nome, filiale, zona FROM distributors WHERE attivo = 1 ORDER BY nome')
    .all();
}

app.get('/registrati', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('registrati', {
    titolo: 'Crea la tua anagrafica',
    distributori: distributoriSelezionabili(),
    tipi: anagrafiche.TIPI_SOGGETTO,
    dati: {},
    scelti: [],
    errori: [],
  });
});

app.post('/registrati', (req, res) => {
  const scelti = []
    .concat(req.body.distributori || [])
    .map((v) => parseInt(v, 10))
    .filter(Boolean);

  const validi = new Set(distributoriSelezionabili().map((d) => d.id));
  const distributoriScelti = scelti.filter((id) => validi.has(id));
  const errori = anagrafiche.validaIscrizione(req.body, distributoriScelti);

  if (errori.length) {
    return res.status(400).render('registrati', {
      titolo: 'Crea la tua anagrafica',
      distributori: distributoriSelezionabili(),
      tipi: anagrafiche.TIPI_SOGGETTO,
      dati: req.body,
      scelti: distributoriScelti,
      errori,
    });
  }

  const cliente = anagrafiche.iscriviCliente(req.body, distributoriScelti);
  req.session.user = {
    id: cliente.id,
    ruolo: cliente.ruolo,
    username: cliente.username,
    ragione_sociale: cliente.ragione_sociale,
    zona: cliente.zona,
    distributor_id: null,
  };
  res.redirect('/profilo?benvenuto=1');
});

// ---------- Profilo del cliente ----------

app.get('/profilo', requireRole('cliente'), (req, res) => {
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('profilo', {
    titolo: 'La mia anagrafica',
    cliente,
    legami: anagrafiche.legamiDelCliente(cliente.id),
    tipi: anagrafiche.TIPI_SOGGETTO,
    benvenuto: req.query.benvenuto === '1',
    indirizzoCliente: ddt.indirizzoCompleto(cliente),
  });
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
  res.render('home', {
    titolo: 'Ordini Minuteria',
    inEvidenza: catalogo.categorieInEvidenza(),
    altre: catalogo.altreCategorie(),
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
    sotto: req.query.sotto || null,
    misura: req.query.misura || null,
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

  const sottocategorie = catalogo.sottocategorieDi(macro.slug);
  const sottoSlug = req.query.sotto || (sottocategorie.length === 1 ? sottocategorie[0].slug : null);
  const sotto = sottoSlug ? catalogo.sottocategoria(macro.slug, sottoSlug) : null;
  const misura = req.query.misura || null;
  const marchio = req.query.marchio || null;
  const q = (req.query.q || '').trim();

  // Con una ricerca attiva l'elenco è quello dei risultati, senza paginazione.
  const elenco = q
    ? {
        righe: catalogo.cercaProdotti(q, { macroSlug: macro.slug, sotto: sottoSlug, limite: 60 }),
        ricerca: true,
      }
    : sottoSlug
    ? catalogo.prodottiDellaCategoria(macro.slug, { sotto: sottoSlug, misura, marchio, pagina: req.query.p })
    : null;

  res.render('categoria', {
    titolo: macro.nome,
    macro,
    sottocategorie,
    sotto,
    sottoSlug,
    // La misura è il primo filtro utile in cantiere; il marchio viene dopo.
    misure: sottoSlug ? catalogo.misureDisponibili({ macroSlug: macro.slug, sotto: sottoSlug }) : [],
    misura,
    marchi: sottoSlug ? catalogo.marchiNellaCategoria({ macroSlug: macro.slug, sotto: sottoSlug }) : [],
    marchio,
    q,
    elenco,
    carrello: getCarrello(req),
  });
});

// ---------- Punti vendita sulla mappa ----------

app.get('/punti-vendita', requireLogin, (req, res) => {
  const punti = db
    .prepare(
      `SELECT s.*, d.nome AS distributore, d.zona
         FROM store_locations s
         JOIN distributors d ON d.id = s.distributor_id
        WHERE s.attivo = 1 AND s.geo_lat IS NOT NULL
        ORDER BY d.nome, s.nome`
    )
    .all();

  const mia = geo.statoUtente(req.session.user.id);
  const conDistanza = punti.map((p) => {
    const km = mia.consenso ? geo.distanzaKm({ lat: mia.lat, lng: mia.lng }, { lat: p.geo_lat, lng: p.geo_lng }) : null;
    return { ...p, km, distanza: geo.formattaDistanza(km) };
  });
  // Con la posizione condivisa l'elenco parte dal punto vendita più vicino.
  if (mia.consenso) conDistanza.sort((a, b) => (a.km === null ? 1 : b.km === null ? -1 : a.km - b.km));

  const insegne = [...new Set(punti.map((p) => p.distributore))];

  res.render('punti_vendita', {
    titolo: 'Punti vendita',
    punti: conDistanza,
    insegne,
    citta: [...new Set(punti.map((p) => p.citta))],
  });
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

  res.render('marchio', { titolo: marca.nome, marca, famiglie, famiglia, q, elenco, carrello: getCarrello(req) });
});

// ---------- Cliente: carrello ----------

// API carrello per aggiunta asincrona (nuovo flusso: Aggiungi -> reset stepper -> mini-card)
app.get('/api/carrello', requireRole('cliente'), (req, res) => {
  const carrello = getCarrello(req);
  const righe = righeCarrello(req);
  const totali = pricing.calcolaOrdine(righe);
  res.json({ carrello, pezzi: contaCarrello(req), totale_finale: totali.totale_finale });
});

app.post('/api/carrello/aggiungi', requireRole('cliente'), (req, res) => {
  const id = parseInt(req.body.id || req.body.product_id, 10);
  const qty = Math.max(0, parseInt(req.body.qty || req.body.quantita, 10) || 0);
  if (!id || !qty) return res.status(400).json({ ok: false, errore: 'Quantità non valida.' });
  const prodotto = db.prepare('SELECT id FROM products WHERE id = ? AND attivo = 1').get(id);
  if (!prodotto) return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  const carrello = getCarrello(req);
  carrello[id] = (carrello[id] || 0) + qty;
  const pezzi = contaCarrello(req);
  res.json({ ok: true, carrello, pezzi, prodottoQty: carrello[id] });
});

app.post('/api/carrello/aggiungi-batch', requireRole('cliente'), (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ ok: false, errore: 'Nessun articolo.' });
  const carrello = getCarrello(req);
  const aggiornati = {};
  items.forEach(({ id, qty }) => {
    const pid = parseInt(id, 10);
    const q = Math.max(0, parseInt(qty, 10) || 0);
    if (!pid || !q) return;
    const prodotto = db.prepare('SELECT id FROM products WHERE id = ? AND attivo = 1').get(pid);
    if (!prodotto) return;
    carrello[pid] = (carrello[pid] || 0) + q;
    aggiornati[pid] = carrello[pid];
  });
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), aggiornati });
});

app.post('/api/carrello/imposta', requireRole('cliente'), (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(0, parseInt(req.body.qty, 10) || 0);
  if (!id) return res.status(400).json({ ok: false });
  const carrello = getCarrello(req);
  if (qty > 0) carrello[id] = qty;
  else delete carrello[id];
  const righe = righeCarrello(req);
  const totali = pricing.calcolaOrdine(righe);
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), totali, righe: righe.length });
});

app.post('/carrello', requireRole('cliente'), (req, res) => {
  aggiornaCarrelloDaForm(req, req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  // "Procedi" non manda più la richiesta: porta al riepilogo, dove si conferma.
  if (req.body.azione === 'procedi') return res.redirect('/carrello');
  return res.redirect(req.body.ritorno || '/carrello');
});

// Riepilogo prima di procedere: articoli, quantità, prezzi, totale e conferma finale.
app.get('/carrello', requireRole('cliente'), (req, res) => {
  const righe = righeCarrello(req);
  const totali = pricing.calcolaOrdine(righe);
  const minimo = pricing.getOrdineMinimo();
  const spedizione = pricing.getSpedizioneFissa();

  res.render('carrello', {
    titolo: 'Riepilogo',
    righe,
    totali,
    minimo,
    spedizione,
    // La soglia si misura sulla sola merce: la spedizione si somma dopo.
    mancaAlMinimo: pricing.round2(Math.max(0, minimo - totali.totale_finale)),
    raggiunto: totali.totale_finale >= minimo,
    ivaPct: pricing.getIvaPct(),
  });
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

  // L'ordine minimo si misura sulla merce già maggiorata, spedizione esclusa.
  const totali = pricing.calcolaOrdine(righe);
  const minimo = pricing.getOrdineMinimo();
  if (righe.length && totali.totale_finale < minimo) {
    return res.status(400).render('errore', {
      titolo: 'Ordine minimo non raggiunto',
      messaggio: `L'ordine minimo è di € ${pricing.euro(minimo)} di merce (IVA esclusa). Ti mancano € ${pricing.euro(minimo - totali.totale_finale)}.`,
      link: '/carrello',
      linkTesto: 'Torna al riepilogo',
    });
  }

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

  const offerte = richieste.offerte(richiesta.id);
  const piuVeloce = richieste.offertaPiuVeloce(richiesta.id);
  return res.render('richiesta_offerte', {
    ...dati,
    offerte,
    // Con più di un'offerta scatta la finestra di 5 minuti per scegliere.
    secondiScelta: offerte.length > 1 ? richieste.secondiPerScegliere(richiesta) : null,
    minutiScelta: pricing.getFinestraSceltaMinuti(),
    idPiuVeloce: piuVeloce ? piuVeloce.distributor_id : null,
    consegna,
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

// Elimina richiesta (cliente) — globale: sparisce anche per tutti i distributori (da confermare + storico)
app.post('/richieste/:id/elimina', requireRole('cliente'), (req, res) => {
  const richiesta = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  const elimina = db.transaction(() => {
    if (richiesta.order_id) {
      db.prepare('UPDATE requests SET order_id = NULL WHERE id = ?').run(richiesta.id);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(richiesta.order_id);
      db.prepare('DELETE FROM orders WHERE id = ?').run(richiesta.order_id);
    }
    const rids = db.prepare('SELECT id FROM request_responses WHERE request_id = ?').all(richiesta.id).map(r => r.id);
    for (const rid of rids) db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(rid);
    db.prepare('DELETE FROM request_responses WHERE request_id = ?').run(richiesta.id);
    db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
    db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
  });
  elimina();
  res.redirect('/home');
});

// Elimina richiesta (distributore) — locale: sparisce solo dal suo banco (da confermare + storico)
app.post('/distributore/richieste/:id/elimina', requireRole('distributore'), (req, res) => {
  const richiesta = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  const risposta = richiesta ? db.prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?').get(richiesta.id, req.session.user.distributor_id) : null;
  if (!richiesta || !risposta) return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  // se la richiesta è già ordinata su altro banco, elimina solo la propria risposta
  // se è l'unica risposta rimasta e non è ordinata, elimina anche la richiesta vuota
  const elimina = db.transaction(() => {
    db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    db.prepare('DELETE FROM request_responses WHERE id = ?').run(risposta.id);
    const rimaste = db.prepare('SELECT COUNT(*) n FROM request_responses WHERE request_id = ?').get(richiesta.id).n;
    if (rimaste === 0 && richiesta.stato !== 'ordinata') {
      db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
      db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
    }
  });
  elimina();
  res.redirect('/distributore');
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

  const orderId = creaOrdineDaOfferta(richiesta, distributorId, risposta, {
    modalita: req.body.modalita,
    note: req.body.note,
    destinazione: req.body.destinazione,
  });
  res.redirect('/ordini');
});

// Creazione dell'ordine a partire da un'offerta confermata: la usano sia la scelta
// manuale del cliente sia l'assegnazione automatica allo scadere dei 5 minuti.
function creaOrdineDaOfferta(richiesta, distributorId, risposta, opzioni = {}) {
  const modalita = opzioni.modalita === 'ritiro' ? 'ritiro' : 'consegna_mezzo_grossista';
  const note = (opzioni.note || '').trim();
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const destinazione =
    modalita === 'ritiro'
      ? 'Ritiro al banco'
      : (opzioni.destinazione || '').trim() || cliente.indirizzo_consegna || ddt.indirizzoCompleto(cliente);
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
      richiesta.cliente_id,
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
    testo: `${cliente.ragione_sociale} ha scelto ${distributore.nome} — ordine #${orderId}.`,
    link: '/distributore/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  // La richiesta confermata non resta una richiesta: diventa un ordine, e la notifica
  // del cliente lo dice esplicitamente.
  notifiche.notifica(richiesta.cliente_id, {
    titolo: opzioni.automatico ? 'Ordine assegnato automaticamente' : 'Ordine inviato',
    testo: opzioni.automatico
      ? `Non hai scelto entro i 5 minuti: l'ordine #${orderId} è andato a ${distributore.nome}, il più veloce.`
      : `Ordine #${orderId} inviato a ${distributore.nome}.`,
    link: '/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  return orderId;
}

// Allo scadere dei 5 minuti senza scelta, l'ordine va al distributore più veloce.
function assegnaOffertePerScadenza() {
  richieste.sceltePerScadenza().forEach((r) => {
    const richiesta = richieste.getRichiesta(r.id);
    const migliore = richieste.offertaPiuVeloce(r.id);
    if (!richiesta || !migliore) return;

    db.prepare('UPDATE requests SET assegnata_auto = 1 WHERE id = ?').run(r.id);
    try {
      creaOrdineDaOfferta(richiesta, migliore.distributor_id, migliore, { automatico: true });
    } catch (err) {
      console.error(`Assegnazione automatica fallita per la richiesta ${r.id}:`, err.message);
    }
  });
}

app.get('/ordini', requireRole('cliente'), (req, res) => {
  richieste.aggiornaScadenzeAperte();
  const ordini = db
    .prepare(
      `SELECT o.*, d.nome AS distributore_nome
         FROM orders o
         LEFT JOIN distributors d ON d.id = o.distributor_id
        WHERE o.cliente_id = ?
        ORDER BY o.id DESC`
    )
    .all(req.session.user.id);
  // tutte le richieste del cliente, ordinate per creazione (nuove prima)
  const tutte = db
    .prepare(`SELECT * FROM requests WHERE cliente_id = ? ORDER BY id DESC LIMIT 50`)
    .all(req.session.user.id);

  // costruisce le card 3-stati: ogni richiesta è una card, l'ordine ne è la continuazione
  const cardsAll = tutte.map((r) => {
    const rAgg = richieste.aggiornaScadenza(r.id) || r;
    const righe = richieste.righeRichiesta(rAgg.id);
    const risposte = richieste.risposteRichiesta(rAgg.id);
    let step = 1;
    let offerte = [];
    let ordine = null;
    let secondi = null;
    let secondiScelta = null;
    let scaduta = false;
    if (rAgg.stato === 'in_attesa') {
      step = 1;
      secondi = richieste.secondiRimasti(rAgg);
      if (secondi === 0) scaduta = true;
    } else if (rAgg.stato === 'con_offerte') {
      step = 2;
      offerte = richieste.offerte(rAgg.id);
      secondiScelta = offerte.length > 1 ? richieste.secondiPerScegliere(rAgg) : null;
    } else if (rAgg.stato === 'ordinata' && rAgg.order_id) {
      step = 3;
      ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(rAgg.order_id);
    } else if (rAgg.stato === 'ordinata') {
      step = 3;
    } else if (rAgg.stato === 'nessuna_offerta' || rAgg.stato === 'annullata') {
      step = 0;
      scaduta = true;
    }
    return { richiesta: rAgg, righe, risposte, offerte, ordine, step, secondi, secondiScelta, scaduta };
  });
  const cards = cardsAll.filter(c => c.step >= 1 && c.step <= 3 && !c.scaduta);
  const storico = cardsAll.filter(c => c.scaduta || c.step === 0);

  res.render('ordini_cliente', { titolo: 'Stato ordini', ordini, cards, storico, consegna });
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

// Elimina ordine (cliente) — globale
app.post('/ordini/:id/elimina', requireRole('cliente'), (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const elimina = db.transaction(() => {
    if (ordine.request_id) db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', ordine.request_id);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ordine.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(ordine.id);
  });
  elimina();
  res.redirect('/ordini');
});

// Elimina ordine (distributore) — globale
app.post('/distributore/ordini/:id/elimina', requireRole('distributore'), (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const elimina = db.transaction(() => {
    if (ordine.request_id) db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', ordine.request_id);
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ordine.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(ordine.id);
  });
  elimina();
  res.redirect('/distributore/ordini');
});

// ---------- Notifiche ----------

app.get('/notifiche', requireLogin, (req, res) => {
  if (req.session.user.ruolo === 'cliente') return res.redirect('/ordini');
  const categoria = notifiche.CATEGORIE[req.query.categoria] ? req.query.categoria : null;
  const sottostato = req.query.sottostato || null;

  const elenco = notifiche.elenco(req.session.user.id, { categoria, sottostato });
  const conteggi = notifiche.conteggiPerCategoria(req.session.user.id);
  const sottostati = categoria ? notifiche.conteggiPerSottostato(req.session.user.id, categoria) : [];

  notifiche.segnaLette(req.session.user.id);
  res.locals.notificheNonLette = 0; // appena lette: la campanella non deve restare accesa
  res.render('notifiche', {
    titolo: 'Notifiche',
    elenco,
    categorie: notifiche.CATEGORIE,
    conteggi,
    sottostati,
    categoria,
    sottostato,
  });
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
    daApprovare: q(
      `SELECT COUNT(*) AS n FROM client_distributors WHERE distributor_id = ? AND stato = 'in_attesa'`
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

// ---------- Distributore: anagrafiche clienti da approvare ----------

app.get('/distributore/clienti', requireRole('distributore'), (req, res) => {
  const elenco = anagrafiche.clientiDelDistributore(req.session.user.distributor_id);
  res.render('distributore_clienti', {
    titolo: 'Clienti',
    daApprovare: elenco.filter((c) => c.stato === 'in_attesa'),
    approvati: elenco.filter((c) => c.stato === 'approvato'),
    rifiutati: elenco.filter((c) => c.stato === 'rifiutato'),
    tipi: anagrafiche.TIPI_SOGGETTO,
  });
});

app.get('/distributore/clienti/:id', requireRole('distributore'), (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const cliente = db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(req.params.id);
  const rapporto = cliente ? anagrafiche.legame(distributorId, cliente.id) : null;
  if (!cliente || !rapporto) {
    return res.status(404).render('errore', {
      titolo: 'Non trovato',
      messaggio: 'Questo cliente non ti ha indicato come distributore di riferimento.',
      link: '/distributore/clienti',
      linkTesto: 'Torna ai clienti',
    });
  }

  res.render('distributore_cliente', {
    titolo: cliente.ragione_sociale,
    cliente,
    rapporto,
    tipi: anagrafiche.TIPI_SOGGETTO,
    indirizzoCliente: ddt.indirizzoCompleto(cliente),
    regole: anagrafiche.regoleSconto(distributorId, cliente.id),
    marchi: catalogo.marchi(),
    macro: catalogo.macroCategorie(),
    famiglie: catalogo.marchi().flatMap((m) =>
      catalogo.famiglieDelMarchio(m.slug).map((f) => ({ ...f, marchio: m.nome, marchio_slug: m.slug }))
    ),
    salvato: req.query.salvato === '1',
  });
});

app.post('/distributore/clienti/:id/decidi', requireRole('distributore'), (req, res) => {
  const esito = anagrafiche.decidi(req.session.user.distributor_id, parseInt(req.params.id, 10), {
    approva: req.body.azione === 'approva',
    codiceCliente: req.body.codice_cliente,
    note: req.body.note,
  });
  if (!esito.ok) {
    return res.status(400).render('errore', { titolo: 'Non riuscito', messaggio: esito.errore });
  }
  res.redirect('/distributore/clienti/' + req.params.id);
});

// Sconti per ambito: i campi arrivano come sconto_<ambito>_<chiave>.
app.post('/distributore/clienti/:id/sconti', requireRole('distributore'), (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const clienteId = parseInt(req.params.id, 10);
  if (!anagrafiche.legame(distributorId, clienteId)) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Cliente non tuo.' });
  }

  // I campi arrivano come sconto<n>_<ambito>_<chiave>: raggruppiamo i 5 scaglioni.
  const perRegola = new Map();
  for (const [campo, valore] of Object.entries(req.body)) {
    const m = campo.match(/^sconto([1-5])_(marchio|macro|famiglia)_(.*)$/);
    if (!m) continue;
    const chiaveRegola = m[2] + '|' + m[3];
    if (!perRegola.has(chiaveRegola)) perRegola.set(chiaveRegola, [null, null, null, null, null]);
    perRegola.get(chiaveRegola)[Number(m[1]) - 1] = valore;
  }

  perRegola.forEach((scaglioni, chiaveRegola) => {
    const taglio = chiaveRegola.indexOf('|');
    anagrafiche.salvaRegola(
      distributorId,
      clienteId,
      chiaveRegola.slice(0, taglio),
      chiaveRegola.slice(taglio + 1),
      scaglioni
    );
  });

  res.redirect('/distributore/clienti/' + clienteId + '?salvato=1');
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
assegnaOffertePerScadenza();
setInterval(() => {
  try {
    richieste.aggiornaScadenzeAperte();
    // Passati i 5 minuti senza scelta, l'ordine va al distributore più veloce.
    assegnaOffertePerScadenza();
  } catch (err) {
    console.error('Errore nel controllo scadenze:', err.message);
  }
}, 30 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
});
