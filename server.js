require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = require('./db');
const { requireLogin, requireRole } = require('./src/auth');
const { calcolaOrdine } = require('./src/pricing');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'minuteria-mvp-demo-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 ore
  })
);

// rende disponibile l'utente loggato a tutte le viste
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// ---------- Home / Login ----------

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.ruolo === 'agente') return res.redirect('/agente/ordini');
  return res.redirect('/catalogo');
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
  };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Cliente: catalogo + creazione ordine ----------

app.get('/catalogo', requireRole('cliente'), (req, res) => {
  const prodotti = db
    .prepare('SELECT * FROM products WHERE attivo = 1 ORDER BY categoria, nome')
    .all();
  res.render('catalogo', { prodotti, errore: null });
});

app.post('/ordini', requireRole('cliente'), (req, res) => {
  const body = req.body; // quantita_<id> = numero, modalita, note
  const modalitaValide = ['ritiro', 'consegna_mezzo_grossista'];
  const modalita = modalitaValide.includes(body.modalita) ? body.modalita : 'ritiro';
  const note = (body.note || '').trim();

  const prodotti = db.prepare('SELECT * FROM products WHERE attivo = 1').all();
  const righeCarrello = [];
  for (const prodotto of prodotti) {
    const q = parseInt(body['quantita_' + prodotto.id], 10);
    if (q && q > 0) righeCarrello.push({ prodotto, quantita: q });
  }

  if (righeCarrello.length === 0) {
    const prodottiVista = db
      .prepare('SELECT * FROM products WHERE attivo = 1 ORDER BY categoria, nome')
      .all();
    return res.render('catalogo', {
      prodotti: prodottiVista,
      errore: 'Seleziona almeno un prodotto con quantità maggiore di zero.',
    });
  }

  const { righe, totale_netto, totale_finale } = calcolaOrdine(righeCarrello);

  const insertOrder = db.prepare(
    `INSERT INTO orders (cliente_id, stato, modalita, note, totale_netto, totale_finale)
     VALUES (?, 'inviato', ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items
       (order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_listino_snapshot, sconto_pct_snapshot, prezzo_netto_unitario, subtotale)
     VALUES (@order_id, @product_id, @codice_snapshot, @nome_snapshot, @quantita, @prezzo_listino_snapshot, @sconto_pct_snapshot, @prezzo_netto_unitario, @subtotale)`
  );

  const creaOrdine = db.transaction(() => {
    const info = insertOrder.run(req.session.user.id, modalita, note, totale_netto, totale_finale);
    const orderId = info.lastInsertRowid;
    for (const riga of righe) {
      insertItem.run({ order_id: orderId, ...riga });
    }
    return orderId;
  });

  const orderId = creaOrdine();
  res.redirect('/ordini/' + orderId);
});

app.get('/ordini/:id', requireLogin, (req, res) => {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine) return res.status(404).send('Ordine non trovato.');

  // un cliente può vedere solo i propri ordini; l'agente li vede tutti
  if (req.session.user.ruolo === 'cliente' && ordine.cliente_id !== req.session.user.id) {
    return res.status(403).send('Accesso non consentito.');
  }

  const righe = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  res.render('ordine_dettaglio', { ordine, righe, cliente });
});

// ---------- Agente: vista ordini ----------

app.get('/agente/ordini', requireRole('agente'), (req, res) => {
  const ordini = db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome
       FROM orders o
       JOIN users u ON u.id = o.cliente_id
       ORDER BY o.creato_il DESC`
    )
    .all();
  res.render('agente_ordini', { ordini });
});

app.listen(PORT, () => {
  console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
});
