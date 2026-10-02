require('dotenv').config();
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');
// Connessioni al DB già aperte e tenute sveglie (solo Postgres): vedi db/postgres/index.js.
if (typeof db.mantieniCalde === 'function') db.mantieniCalde();
// auto-seed se DB vuoto (dopo clone/pull basta npm start)
(async () => {
  try {
    await db.ensureInit();
    const r1 = await db.prepare('SELECT COUNT(*) n FROM products').get();
    const nProd = r1 ? Number(r1.n) : 0;
    if (nProd === 0) {
      console.log('DB vuoto -> eseguo seed automatico...');
      await require('./db/seed');
    }
    // Il popolamento di distributor_products (prezzo/sconto per distributore) non è più
    // automatico: con un catalogo reale da migliaia di articoli, riempirlo con sconto 0%
    // per tutti sarebbe dato finto, non un listino vero. Va fatto deliberatamente quando
    // sono disponibili le condizioni reali negoziate con ogni distributore.
  } catch (e) { console.error('auto-seed fallito', e.message); }
})();

const { requireLogin, requireRole } = require('./src/auth');
const pricing = require('./src/pricing');
const format = require('./src/format');
const icone = require('./src/icone');
const catalogo = require('./src/catalogo');
const richieste = require('./src/richieste');
const notifiche = require('./src/notifiche');
const ddt = require('./src/ddt');
const geo = require('./src/geo');
const anagrafiche = require('./src/anagrafiche');
const consegna = require('./src/consegna');
const flusso = require('./src/flusso_cliente');
const { ArchivioSqlite } = require('./src/sessioni');
const { TESTO_DISPONIBILITA, prodottoJson } = require('./src/prodotto_json');
const { chiaveLogin, loginBloccato, registraTentativoFallito, azzeraTentativi } = require('./src/limite_login');
const apiV1 = require('./src/api_v1');
const whatsapp = require('./src/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

// Prima qui c'era un segreto fisso ('minuteria-mvp-demo-secret') usato come fallback: era
// scritto nel sorgente, quindi pubblico per chiunque leggesse il repository — con quello
// chiunque può firmare cookie di sessione validi. La correzione giusta è impostare
// SESSION_SECRET nell'ambiente (.env in locale, variabili d'ambiente in produzione).
// Se manca, PRIMA qui si generava un valore casuale nuovo ad ogni avvio: sembrava più
// sicuro, ma un valore diverso ad ogni riavvio invalida tutti i cookie già emessi — con
// l'hosting che fa auto-deploy ad ogni push, ogni deploy disconnetteva tutti (compresi
// utenti a metà azione). Meglio un fallback STABILE: derivato da DATABASE_URL (che non
// cambia da un riavvio all'altro), invece che casuale. Non è un segreto nuovo da
// proteggere in più: chi ha già DATABASE_URL ha accesso diretto al DB, ben oltre quello
// che potrebbe fare forgiando un cookie di sessione.
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto
    .createHash('sha256')
    .update('minuteria-session|' + (process.env.DATABASE_URL || 'sviluppo-locale'))
    .digest('hex');
  console.warn(
    'ATTENZIONE: SESSION_SECRET non impostata nell\'ambiente. Uso un valore derivato da ' +
    'DATABASE_URL (stabile fra i riavvii, ma meglio impostare SESSION_SECRET esplicitamente ' +
    'in .env e, in produzione, nelle variabili d\'ambiente del servizio di hosting).'
  );
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Dove stanno tutti gli installatori, per ora (vedi src/sede_installatori.js).
app.locals.sede = require('./src/sede_installatori');
// Necessario per leggere il vero IP del client (usato dal limite tentativi di login)
// quando l'app gira dietro un proxy/load balancer (es. Vercel).
app.set('trust proxy', 1);
// Comprime HTML, JSON, CSS e JS (sotto 1 KB no): la ricerca in JSON passa da ~46 KB a pochi KB,
// che su rete mobile è la parte più lenta. Le foto sono già compresse (webp) e restano intatte.
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// API dell'app nativa: autenticazione con token (Authorization: Bearer), niente cookie.
// Montata prima del controllo di origine, della sessione e del middleware che prepara i
// dati delle viste: nessuno dei tre serve (né vale) per richieste che non vengono da un
// browser e non portano credenziali "ambientali" sfruttabili da un sito terzo.
app.use('/api/v1', apiV1);

// Difesa in profondità contro il CSRF, in aggiunta al cookie di sessione già impostato
// con sameSite:'lax' (che da solo blocca già la maggior parte degli invii cross-site):
// rifiuta le richieste che cambiano stato se Origin (o, in mancanza, Referer) non
// corrisponde all'host di questa app. Se mancano entrambe le intestazioni si lascia
// passare piuttosto che bloccare traffico legittimo: capita con alcuni browser/estensioni
// per la privacy, e sameSite:'lax' resta comunque la prima barriera.
function stessaOrigine(req) {
  const host = req.get('host');
  if (!host) return false;
  const origin = req.get('origin');
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  const referer = req.get('referer');
  if (referer) {
    try { return new URL(referer).host === host; } catch { return false; }
  }
  return true;
}
const METODI_DA_VERIFICARE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
app.use((req, res, next) => {
  if (METODI_DA_VERIFICARE.has(req.method) && !stessaOrigine(req)) {
    return res.status(403).send('Richiesta rifiutata: origine non corrispondente.');
  }
  next();
});

// Foto e librerie cambiano di rado: il browser (e l'app) le tiene 7 giorni invece di
// richiederle a ogni pagina. CSS e JS restano con la sola verifica (ETag), così una modifica si
// vede subito.
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), { maxAge: '7d' }));
app.use('/vendor', express.static(path.join(__dirname, 'public', 'vendor'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    store: new ArchivioSqlite(), // su file, così un riavvio non scollega nessuno
    secret: sessionSecret,
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
app.use(async (req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.euro = pricing.euro;
  res.locals.fmt = format;
  Object.assign(res.locals, icone);
  res.locals.carrelloPezzi = contaCarrello(req);
  res.locals.testoDisponibilita = TESTO_DISPONIBILITA;

  const utente = req.session.user;
  // Nessuna di queste dipende dal risultato di un'altra: prima giravano una dopo l'altra
  // (fino a una decina di query in sequenza, anche per un cliente senza nulla da mostrare),
  // sommando la latenza di ognuna invece di pagare solo quella della più lenta.
  const [servizioPct, notificheNonLette, ordiniNonLetti, richiesteNonLette, geoStato, contatori] =
    await Promise.all([
      pricing.getServizioPct(),
      utente ? notifiche.nonLette(utente.id) : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'ordini') : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'richieste') : Promise.resolve(0),
      utente ? geo.statoUtente(utente.id) : Promise.resolve({ consenso: false }),
      utente && utente.ruolo === 'distributore' && utente.distributor_id
        ? contatoriBanco(utente.distributor_id)
        : Promise.resolve(null),
    ]);

  // pricing.prezzoCliente legge il DB (async): i template EJS non possono fare "await"
  // dentro <%= %>, quindi qui si legge la percentuale di servizio una volta per
  // richiesta e si espone ai template una versione sincrona e pura per riga.
  res.locals.prezzoCliente = (riga) => pricing.prezzoClienteConPct(riga, servizioPct);
  // Gli ordini creati prima delle offerte per distributore non hanno l'IVA calcolata.
  res.locals.totaleOrdine = (o) => (o.totale_ivato > 0 ? o.totale_ivato : o.totale_finale);
  res.locals.notificheNonLette = notificheNonLette;
  // Il tab "Stato ordini" segue tutta la pipeline del cliente (richiesta -> offerte ->
  // ordine), non solo gli ordini veri e propri: il badge conta le notifiche non lette di
  // entrambe le categorie, altrimenti una conferma disponibilità (categoria "richieste")
  // non farebbe comparire nulla.
  res.locals.ordiniNonLetti = ordiniNonLetti + richiesteNonLette;
  res.locals.geo = geoStato;
  // I contatori del banco servono alla barra di navigazione di tutte le pagine distributore.
  res.locals.contatori = contatori;
  // Pagine e risposte dell'app sono dati di chi è collegato: il browser (o un proxy davanti alla
  // VPS) non deve riproporre una copia vecchia, altrimenti richieste e ordini nuovi non si vedono
  // finché non si forza il refresh. Con ETag il ricontrollo costa poco.
  res.set('Cache-Control', 'private, no-cache');
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
async function righeCarrello(req) {
  const carrello = getCarrello(req);
  const ids = Object.keys(carrello).map(Number).filter((id) => carrello[id] > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const prodotti = await db.prepare(
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
  for (const [chiave, valore] of Object.entries(req.body || {})) {
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

app.get('/', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.ruolo === 'agente') return res.redirect('/agente/ordini');
  if (req.session.user.ruolo === 'distributore') return res.redirect('/distributore');
  return res.redirect('/home');
});

app.get('/login', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { titolo: 'Accedi', errore: null, scheda: 'accedi' });
});

// ---------- Registrazione cliente ----------

// Una voce per ditta: con più filiali (es. Borea) l'installatore sceglie la ditta, non la
// filiale. L'id è quello della prima filiale; alla registrazione il legame si crea con tutte.
async function distributoriSelezionabili() {
  return db
    .prepare(
      `SELECT DISTINCT ON (COALESCE(ditta_id, -id)) id, nome, zona
         FROM distributors WHERE attivo = 1
        ORDER BY COALESCE(ditta_id, -id), id`
    )
    .all()
    .then((righe) => righe.sort((a, b) => a.nome.localeCompare(b.nome)));
}

app.get('/registrati', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('registrati', {
    titolo: 'Crea la tua anagrafica',
    distributori: await distributoriSelezionabili(),
    tipi: anagrafiche.TIPI_SOGGETTO,
    dati: {},
    scelti: [],
    errori: [],
  });
});

app.post('/registrati', async (req, res, next) => {
  const scelti = []
    .concat(req.body.distributori || [])
    .map((v) => parseInt(v, 10))
    .filter(Boolean);

  const validi = new Set((await distributoriSelezionabili()).map((d) => d.id));
  const distributoriScelti = scelti.filter((id) => validi.has(id));
  const errori = await anagrafiche.validaIscrizione(req.body, distributoriScelti);

  if (errori.length) {
    return res.status(400).render('registrati', {
      titolo: 'Crea la tua anagrafica',
      distributori: await distributoriSelezionabili(),
      tipi: anagrafiche.TIPI_SOGGETTO,
      dati: req.body,
      scelti: distributoriScelti,
      errori,
    });
  }

  const cliente = await anagrafiche.iscriviCliente(
    req.body,
    await anagrafiche.conTutteLeFiliali(distributoriScelti)
  );
  req.session.user = {
    id: cliente.id,
    ruolo: cliente.ruolo,
    username: cliente.username,
    ragione_sociale: cliente.ragione_sociale,
    zona: cliente.zona,
    distributor_id: null,
  };
  // Come per il login: prima si salva la sessione, poi si va al profilo.
  req.session.save((err) => (err ? next(err) : res.redirect('/profilo?benvenuto=1')));
});

// ---------- Profilo del cliente ----------

app.get('/profilo', requireRole('cliente'), async (req, res) => {
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  res.render('profilo', {
    titolo: 'La mia anagrafica',
    cliente,
    legami: await anagrafiche.legamiDelCliente(cliente.id),
    tipi: anagrafiche.TIPI_SOGGETTO,
    benvenuto: req.query.benvenuto === '1',
    indirizzoCliente: ddt.indirizzoCompleto(cliente),
  });
});

app.post('/login', async (req, res, next) => {
  // Uno spazio digitato per sbaglio (specie a fine nome, su telefono con autocorrezione)
  // non deve far fallire l'accesso: il nome utente si confronta sempre già "ripulito".
  const username = String(req.body.username || '').trim();
  const { password } = req.body;
  const chiave = chiaveLogin(req, username);

  if (loginBloccato(chiave)) {
    return res.status(429).render('login', { errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    registraTentativoFallito(chiave);
    return res.render('login', { errore: 'Credenziali non valide.' });
  }
  azzeraTentativi(chiave);
  req.session.user = {
    id: user.id,
    ruolo: user.ruolo,
    username: user.username,
    ragione_sociale: user.ragione_sociale,
    zona: user.zona,
    distributor_id: user.distributor_id,
  };
  // La sessione si salva PRIMA del redirect: express-session manda la risposta e salva dopo, e se il
  // browser rilegge subito la pagina (succede) la sessione non c'è ancora e si torna al login.
  req.session.save((err) => (err ? next(err) : res.redirect('/')));
});

app.post('/logout', async (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Cliente: home, ricerca, categorie ----------

app.get('/home', requireRole('cliente'), async (req, res) => {
  const [{ inEvidenza, altre }, prodottiConFotoConta] = await Promise.all([
    catalogo.categorieHome(),
    catalogo.contaProdottiConFoto(),
  ]);
  res.render('home', { titolo: 'Ordini Minuteria', inEvidenza, altre, prodottiConFotoConta });
});

app.get('/cerca', requireRole('cliente'), async (req, res) => {
  const q = (req.query.q || '').trim();
  const diametro = req.query.diametro || null;
  const materiale = req.query.materiale || null;
  const risultati = q ? await catalogo.cercaProdotti(q, { diametro, materiale, limite: 100 }) : [];
  res.render('cerca', {
    titolo: 'Cerca',
    q,
    diametro,
    materiale,
    risultati,
    carrello: getCarrello(req),
  });
});

// Ricerca mentre si digita: stessa logica parziale della pagina /cerca.
app.get('/api/cerca', requireRole('cliente'), async (req, res) => {
  const q = (req.query.q || '').trim();
  // L'ambito arriva dalla pagina che sta cercando: categoria, marchio, famiglia, gruppo.
  const ambito = {
    macroSlug: req.query.macro || null,
    brandSlug: req.query.marchio || null,
    famiglia: req.query.famiglia || null,
    sotto: req.query.sotto || null,
    misura: req.query.misura || null,
    materiale: req.query.materiale || null,
    diametro: req.query.diametro || null,
    limite: 60,
  };
  const risultati = q.length >= 2 ? await catalogo.cercaProdotti(q, ambito) : [];
  const servizioPct = await pricing.getServizioPct();
  res.json({ risultati: risultati.map((p) => prodottoJson(p, servizioPct)) });
});

// Vetrina "Elementi con foto": trasversale alle categorie, cresce da sola man mano che i
// prodotti guadagnano una foto (vedi catalogo.prodottiConFoto).
app.get('/con-foto', requireRole('cliente'), async (req, res) => {
  const elenco = await catalogo.prodottiConFoto({ pagina: req.query.p });
  res.render('con_foto', {
    titolo: 'Elementi con foto',
    elenco,
    carrello: getCarrello(req),
  });
});

app.get('/api/con-foto/prodotti', requireRole('cliente'), async (req, res) => {
  const elenco = await catalogo.prodottiConFoto({ pagina: req.query.pagina });
  const servizioPct = await pricing.getServizioPct();
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p, servizioPct)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  });
});

// Pagina successiva di una categoria/sottocategoria, per lo scroll infinito: stessi
// filtri di /categoria/:slug, ma restituisce solo i prodotti in JSON da accodare.
app.get('/api/categoria/:slug/prodotti', requireRole('cliente'), async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ risultati: [] });
  const elenco = await catalogo.prodottiDellaCategoria(macro.slug, {
    sotto: req.query.sotto || null,
    misura: req.query.misura || null,
    marchio: req.query.marchio || null,
    pagina: req.query.pagina,
  });
  const servizioPct = await pricing.getServizioPct();
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p, servizioPct)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  });
});

app.get('/categoria/:slug', requireRole('cliente'), async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Categoria non trovata.' });

  const sottocategorie = await catalogo.sottocategorieDi(macro.slug);
  const sottoSlug = req.query.sotto || (sottocategorie.length === 1 ? sottocategorie[0].slug : null);
  const sotto = sottoSlug ? await catalogo.sottocategoria(macro.slug, sottoSlug) : null;
  // Senza sottocategorie censite si sfoglia direttamente tutta la macro categoria,
  // invece di mostrare un elenco di sottocategorie vuoto.
  const sfogliaDiretto = sottocategorie.length === 0;
  const misura = req.query.misura || null;
  const marchio = req.query.marchio || null;
  const q = (req.query.q || '').trim();

  // Con una ricerca attiva l'elenco è quello dei risultati, senza paginazione.
  const elenco = q
    ? {
        righe: await catalogo.cercaProdotti(q, { macroSlug: macro.slug, sotto: sottoSlug, limite: 60 }),
        ricerca: true,
      }
    : sottoSlug || sfogliaDiretto
    ? await catalogo.prodottiDellaCategoria(macro.slug, { sotto: sottoSlug, misura, marchio, pagina: req.query.p })
    : null;

  res.render('categoria', {
    titolo: macro.nome,
    macro,
    sottocategorie,
    sotto,
    sottoSlug,
    marchi: sottoSlug || sfogliaDiretto ? await catalogo.marchiNellaCategoria({ macroSlug: macro.slug, sotto: sottoSlug }) : [],
    marchio,
    misura,
    q,
    elenco,
    carrello: getCarrello(req),
  });
});

// ---------- Punti vendita sulla mappa ----------

app.get('/punti-vendita', requireLogin, async (req, res) => {
  const punti = await db
    .prepare(
      `SELECT s.*, d.nome AS distributore, d.zona
         FROM store_locations s
         JOIN distributors d ON d.id = s.distributor_id
        WHERE s.attivo = 1 AND s.geo_lat IS NOT NULL
        ORDER BY d.nome, s.nome`
    )
    .all();

  const mia = await geo.statoUtente(req.session.user.id);
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

app.get('/marchi', requireRole('cliente'), async (req, res) => {
  res.render('marchi', { titolo: 'Marchi', marchi: await catalogo.marchi() });
});

app.get('/marchi/:slug', requireRole('cliente'), async (req, res) => {
  const marca = await catalogo.marchio(req.params.slug);
  if (!marca) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Marchio non trovato.' });

  const famiglie = await catalogo.famiglieDelMarchio(marca.slug);
  const codice = req.query.famiglia || null;
  const famiglia = codice ? await catalogo.famigliaDelMarchio(marca.slug, codice) : null;
  const q = (req.query.q || '').trim();

  // Cercando dentro un marchio i risultati restano dentro quel marchio (e, se si sta
  // sfogliando una famiglia, dentro quella famiglia).
  const elenco = q
    ? {
        righe: await catalogo.cercaProdotti(q, { brandSlug: marca.slug, famiglia: codice, limite: 60 }),
        ricerca: true,
      }
    : codice
    ? await catalogo.prodottiDelMarchio(marca.slug, codice, req.query.p)
    : null;

  res.render('marchio', { titolo: marca.nome, marca, famiglie, famiglia, q, elenco, carrello: getCarrello(req) });
});

// ---------- Cliente: carrello ----------

// API carrello per aggiunta asincrona (nuovo flusso: Aggiungi -> reset stepper -> mini-card)
app.get('/api/carrello', requireRole('cliente'), async (req, res) => {
  const carrello = getCarrello(req);
  const righe = await righeCarrello(req);
  const totali = await pricing.calcolaOrdine(righe);
  res.json({ carrello, pezzi: contaCarrello(req), totale_finale: totali.totale_finale });
});

app.post('/api/carrello/aggiungi', requireRole('cliente'), async (req, res) => {
  const id = parseInt(req.body.id || req.body.product_id, 10);
  const qty = Math.max(0, parseInt(req.body.qty || req.body.quantita, 10) || 0);
  if (!id || !qty) return res.status(400).json({ ok: false, errore: 'Quantità non valida.' });
  const prodotto = await db.prepare('SELECT id FROM products WHERE id = ? AND attivo = 1').get(id);
  if (!prodotto) return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  const carrello = getCarrello(req);
  carrello[id] = (carrello[id] || 0) + qty;
  const pezzi = contaCarrello(req);
  res.json({ ok: true, carrello, pezzi, prodottoQty: carrello[id] });
});

app.post('/api/carrello/aggiungi-batch', requireRole('cliente'), async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ ok: false, errore: 'Nessun articolo.' });
  const richiesti = items
    .map(({ id, qty }) => ({ pid: parseInt(id, 10), q: Math.max(0, parseInt(qty, 10) || 0) }))
    .filter(({ pid, q }) => pid && q);
  // Un articolo non valido o non più attivo si salta: prima un "return" dentro il ciclo
  // chiudeva la route senza rispondere, il pulsante restava su "…" e il carrello non si salvava.
  const attivi = richiesti.length
    ? new Set(
        (await db.prepare('SELECT id FROM products WHERE attivo = 1 AND id = ANY(?::int[])').all(richiesti.map((r) => r.pid)))
          .map((p) => p.id)
      )
    : new Set();
  const carrello = getCarrello(req);
  const aggiornati = {};
  for (const { pid, q } of richiesti) {
    if (!attivi.has(pid)) continue;
    carrello[pid] = (carrello[pid] || 0) + q;
    aggiornati[pid] = carrello[pid];
  }
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), aggiornati });
});

app.post('/api/carrello/imposta', requireRole('cliente'), async (req, res) => {
  const id = parseInt(req.body.id, 10);
  const qty = Math.max(0, parseInt(req.body.qty, 10) || 0);
  if (!id) return res.status(400).json({ ok: false });
  const carrello = getCarrello(req);
  if (qty > 0) carrello[id] = qty;
  else delete carrello[id];
  const righe = await righeCarrello(req);
  const totali = await pricing.calcolaOrdine(righe);
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), totali, righe: righe.length });
});

app.post('/carrello', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  // "Procedi" non manda più la richiesta: porta al riepilogo, dove si conferma.
  if (req.body.azione === 'procedi') return res.redirect('/carrello');
  return res.redirect(req.body.ritorno || '/carrello');
});

// Riepilogo prima di procedere: articoli, quantità, prezzi, totale e conferma finale.
app.get('/carrello', requireRole('cliente'), async (req, res) => {
  const righe = await righeCarrello(req);
  const totali = await pricing.calcolaOrdine(righe);
  const minimo = await pricing.getOrdineMinimo();
  const spedizione = await pricing.getSpedizioneFissa();

  res.render('carrello', {
    titolo: 'Riepilogo',
    righe,
    totali,
    minimo,
    spedizione,
    // La soglia si misura sulla sola merce: la spedizione si somma dopo.
    mancaAlMinimo: pricing.round2(Math.max(0, minimo - totali.totale_finale)),
    raggiunto: totali.totale_finale >= minimo,
    ivaPct: await pricing.getIvaPct(),
    minutiRisposta: await pricing.getFinestraMinuti(),
  });
});

app.post('/carrello/svuota', requireRole('cliente'), async (req, res) => {
  req.session.carrello = {};
  res.redirect('/home');
});

// ---------- Cliente: richiesta di disponibilità ----------

// "Conferma e chiedi disponibilità": manda la richiesta ai distributori e apre l'attesa.
// Dal carrello arrivano le quantità visibili in pagina (modo 'imposta'): anche quelle
// scritte a mano e mai salvate, che prima andavano perse e la richiesta partiva con le vecchie.
// La logica del flusso (qui e nelle route sotto) sta in src/flusso_cliente.js, condivisa
// con l'API dell'app.
app.post('/richieste', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body && req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  let requestId;
  try {
    requestId = await flusso.nuovaRichiesta(req.session.user.id, await righeCarrello(req));
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    const link =
      e.codice === 'in_corso'
        ? { link: '/richieste/' + e.requestId, linkTesto: 'Apri la richiesta in corso' }
        : e.codice === 'vuota'
          ? { link: '/home', linkTesto: 'Torna alla home' }
          : { link: '/carrello', linkTesto: 'Torna al riepilogo' };
    return res.status(400).render('errore', { titolo: e.titolo, messaggio: e.message, ...link });
  }
  req.session.carrello = {};
  res.redirect('/richieste/' + requestId);
});

app.get('/richieste/:id', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  if (richiesta.stato === 'ordinata' && richiesta.order_id) {
    return res.redirect('/ordini/' + richiesta.order_id);
  }
  // Il cliente sta già guardando questa richiesta (schermata di attesa/offerte, che si
  // auto-aggiorna): il cambio di stato non deve anche accendere il pallino in basso.
  // dettaglioRichiesta segna lette le notifiche, ma res.locals.ordiniNonLetti è già stato
  // calcolato dal middleware prima di questa route: va azzerato qui, altrimenti questa
  // stessa risposta renderizzerebbe ancora il conteggio vecchio.
  const dati = await flusso.dettaglioRichiesta(richiesta);
  res.locals.ordiniNonLetti = 0;
  const vista = { titolo: 'Richiesta #' + richiesta.id, ...dati };
  if (richiesta.stato === 'in_attesa') return res.render('richiesta_attesa', vista);
  return res.render('richiesta_offerte', { ...vista, consegna });
});

// Stato della richiesta per la schermata di attesa (polling + notifica push del browser).
app.get('/api/richieste/:id', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).json({ errore: 'non trovata' });
  }
  // Una voce per ditta: con due filiali la pagina (un solo badge per nome) mostrerebbe l'ultima
  // in elenco, anche "Nessuna risposta" per la filiale chiusa dopo la conferma dell'altra.
  const risposte = richieste.raggruppaRisposteDitta(await richieste.risposteRichiesta(richiesta.id));
  res.json({
    stato: richiesta.stato,
    secondi: await richieste.secondiRimasti(richiesta),
    conferme: risposte.filter((r) => r.esito === 'confermato').length,
    risposte: risposte.map((r) => ({ nome: r.distributore_nome, esito: r.esito })),
  });
});

app.post('/richieste/:id/annulla', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  if (!(await flusso.annullaRichiesta(richiesta.id))) return res.redirect('/richieste/' + richiesta.id);
  res.redirect('/ordini');
});

app.post('/richieste/:id/reinvia', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  res.redirect('/richieste/' + (await flusso.reinviaRichiesta(richiesta)));
});

// Elimina richiesta (cliente) — globale: sparisce anche per tutti i distributori (da confermare + storico)
app.post('/richieste/:id/elimina', requireRole('cliente'), async (req, res) => {
  const richiesta = await db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  try {
    await flusso.eliminaRichiesta(richiesta.id);
  } catch (e) {
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e.ordine);
    throw e;
  }
  res.redirect('/home');
});

function rifiutaEliminazioneOrdine(res, ordine) {
  return res.status(400).render('errore', {
    titolo: 'Ordine già in lavorazione',
    messaggio: 'Il distributore ha già preso in carico questo ordine: per annullarlo contattalo direttamente.',
    link: '/ordini/' + ordine.id,
    linkTesto: "Torna all'ordine",
  });
}

// Elimina richiesta (distributore) — locale: sparisce solo dal suo banco (da confermare + storico)
app.post('/distributore/richieste/:id/elimina', requireRole('distributore'), async (req, res) => {
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
      await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
      await db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
    }
  });
  await elimina();
  res.redirect('/distributore');
});

// Riepilogo ordine con il distributore scelto.
app.get('/richieste/:id/offerta/:distributorId', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  // Solo da una richiesta con offerte aperte: da una annullata o scaduta si arrivava comunque
  // al riepilogo e si poteva chiudere un ordine (la pagina offerte mostrava ancora le card).
  if (richiesta.stato !== 'con_offerte') return res.redirect('/richieste/' + richiesta.id);

  const modalita = req.query.modalita === 'ritiro' ? 'ritiro' : 'consegna_mezzo_grossista';
  const riepilogo = await flusso.riepilogoOfferta(richiesta, req.params.distributorId, modalita);
  if (!riepilogo) {
    return res.status(404).render('errore', {
      titolo: 'Offerta non valida',
      messaggio: 'Questo distributore non ha confermato la disponibilità.',
      link: '/richieste/' + richiesta.id,
      linkTesto: 'Torna alle offerte',
    });
  }

  res.render('riepilogo', {
    titolo: "Riepilogo dell'ordine",
    richiesta,
    modalita,
    cliente: await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id),
    consegna,
    ...riepilogo,
  });
});

// ---------- Cliente: ordine ----------

app.post('/ordini', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.body.request_id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }

  const esito = await flusso.ordinaDaOfferta(richiesta, parseInt(req.body.distributor_id, 10), {
    modalita: req.body.modalita,
    note: req.body.note,
    destinazione: req.body.destinazione,
  });
  if (esito.esito === 'creato') return res.redirect('/ordini/' + esito.orderId + '?nuovo=1');
  if (esito.esito === 'gia_ordinata') return rispostaGiaOrdinata(res, esito.richiesta);
  if (esito.esito === 'offerta_non_valida') {
    return res.status(400).render('errore', {
      titolo: 'Offerta non valida',
      messaggio: 'Questo distributore non ha confermato la disponibilità.',
      link: '/richieste/' + richiesta.id,
      linkTesto: 'Torna alle offerte',
    });
  }
  return res.status(400).render('errore', {
    titolo: 'Richiesta non più aperta',
    messaggio:
      esito.richiesta.stato === 'annullata'
        ? 'Hai annullato questa richiesta: non si può più ordinare da qui.'
        : 'Le offerte di questa richiesta sono scadute: puoi reinviarla per avere conferme aggiornate.',
    link: '/richieste/' + richiesta.id,
    linkTesto: 'Apri la richiesta',
  });
});

// "Invia l'ordine" su una richiesta già chiusa. Se l'ha chiusa l'ordine automatico il
// cliente va avvisato: prima veniva portato sull'ordine in silenzio, e consegna/ritiro,
// destinazione e note appena scritte andavano perse senza che lo sapesse.
function rispostaGiaOrdinata(res, richiesta) {
  if (!richiesta.order_id) return res.redirect('/richieste/' + richiesta.id);
  if (!richiesta.assegnata_auto) return res.redirect('/ordini/' + richiesta.order_id);
  return res.status(409).render('errore', {
    titolo: 'Ordine già assegnato',
    messaggio:
      "Il tempo per scegliere era scaduto e l'ordine è partito in automatico, con consegna e note predefinite: " +
      'le scelte di questa pagina non sono state applicate. Se serve cambiarle contatta il distributore.',
    link: '/ordini/' + richiesta.order_id,
    linkTesto: "Apri l'ordine",
  });
}

// "Stato ordini": porta dritto all'unica attività in corso (vedi flusso.attivitaCorrente).
app.get('/ordini', requireRole('cliente'), async (req, res) => {
  const attivo = await flusso.attivitaCorrente(req.session.user.id);
  if (attivo) return res.redirect((attivo.tipo === 'ordine' ? '/ordini/' : '/richieste/') + attivo.id);
  res.render('ordini_cliente', { titolo: 'Stato ordini' });
});

// Storico unificato (tutto: in corso, scaduto, annullato, consegnato) — raggiungibile dal
// menu account, non più dal tab "Stato ordini".
app.get('/storico', requireRole('cliente'), async (req, res) => {
  const cardsAll = await flusso.richiesteClienteConStato(req.session.user.id);
  res.render('storico', { titolo: 'Storico', cards: cardsAll });
});

app.get('/ordini/:id', requireLogin, async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });

  // un cliente può vedere solo i propri ordini; l'agente li vede tutti
  if (req.session.user.ruolo === 'cliente' && ordine.cliente_id !== req.session.user.id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  if (req.session.user.ruolo === 'distributore' && ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  // Il cliente sta guardando proprio questo ordine: un suo cambio di stato non deve
  // anche accendere il pallino "Stato ordini" in basso.
  if (req.session.user.ruolo === 'cliente') {
    await notifiche.segnaLetteCategoria(req.session.user.id, 'ordini');
    await notifiche.segnaLetteCategoria(req.session.user.id, 'richieste');
    res.locals.ordiniNonLetti = 0;
  }

  const dettaglio = await flusso.dettaglioOrdine(ordine);
  // Il cliente vede la ditta, non la filiale; banchi e agente sì (da dove parte il pacco).
  if (req.session.user.ruolo === 'cliente') dettaglio.distributore = flusso.senzaFiliale(dettaglio.distributore);
  res.render('ordine_dettaglio', {
    titolo: 'Ordine #' + ordine.id,
    ordine,
    nuovo: req.query.nuovo === '1',
    ...dettaglio,
  });
});

app.post('/ordini/:id/consegnato', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  await flusso.segnaConsegnato(ordine);
  res.redirect('/ordini/' + ordine.id);
});

// Elimina ordine (cliente) — globale
app.post('/ordini/:id/elimina', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  try {
    await flusso.eliminaOrdine(ordine.id);
  } catch (e) {
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e.ordine);
    throw e;
  }
  res.redirect('/ordini');
});

// Elimina ordine (distributore) — globale
app.post('/distributore/ordini/:id/elimina', requireRole('distributore'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const elimina = db.transaction(async () => {
    if (ordine.request_id) await db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', ordine.request_id);
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ordine.id);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(ordine.id);
  });
  await elimina();
  res.redirect('/distributore');
});

// ---------- Notifiche ----------

app.get('/notifiche', requireLogin, async (req, res) => {
  if (req.session.user.ruolo === 'cliente') return res.redirect('/ordini');
  const categoria = notifiche.CATEGORIE[req.query.categoria] ? req.query.categoria : null;
  const sottostato = req.query.sottostato || null;

  const elenco = await notifiche.elenco(req.session.user.id, { categoria, sottostato });
  const conteggi = await notifiche.conteggiPerCategoria(req.session.user.id);
  const sottostati = categoria ? await notifiche.conteggiPerSottostato(req.session.user.id, categoria) : [];

  await notifiche.segnaLette(req.session.user.id);
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
app.get('/api/notifiche/push', requireLogin, async (req, res) => {
  res.json({ notifiche: await notifiche.daMostrare(req.session.user.id) });
});

// ---------- Posizione ----------

// La posizione del dispositivo non si raccoglie più: gli installatori stanno tutti in Via Puggia 22/3
// (src/sede_installatori.js) e i banchi hanno la posizione del punto vendita (store_locations).

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
async function contatoriBanco(distributorId) {
  // Prima erano 5 query separate, una dopo l'altra (await in sequenza): eseguita ad ogni
  // singola pagina vista da un distributore, sommava 5 andate e ritorno verso il DB dove
  // ne bastava una per gli ordini (con FILTER) più altre due, tutte e tre in parallelo.
  const [ordini, daRispondereRow, daApprovareRow] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE stato = 'inviato') AS da_preparare,
         COUNT(*) FILTER (WHERE stato = 'in_evasione') AS in_preparazione,
         COALESCE(MAX(id), 0) AS ultimo
         FROM orders WHERE distributor_id = ?`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()) AS n,
              COALESCE(MAX(r.id) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()), 0) AS ultima,
              COUNT(*) FILTER (WHERE rr.corriere_stato = 'in_attesa') AS attesa_corriere
         FROM request_responses rr JOIN requests r ON r.id = rr.request_id
        WHERE rr.distributor_id = ?
          AND ((rr.esito = 'in_attesa' AND r.scade_il > NOW()) OR rr.corriere_stato = 'in_attesa')`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) AS n FROM client_distributors WHERE distributor_id = ? AND stato = 'in_attesa'`
    ).get(distributorId),
  ]);
  return {
    daRispondere: Number(daRispondereRow.n),
    daPreparare: Number(ordini.da_preparare),
    inPreparazione: Number(ordini.in_preparazione),
    daApprovare: Number(daApprovareRow.n),
    // Non si vedono in pagina: servono a /api/distributore/novita per accorgersi che qualcosa è
    // cambiato anche quando i conteggi restano uguali (una richiesta scade e un'altra arriva, un
    // corriere prende la consegna).
    ultimaRichiesta: Number(daRispondereRow.ultima),
    ultimoOrdine: Number(ordini.ultimo),
    inAttesaCorriere: Number(daRispondereRow.attesa_corriere),
  };
}

// Controllo leggero per le pagine del banco (public/app.js, data-versione): restituisce gli stessi
// numeri che la pagina ha ricevuto, e il browser si ricarica solo se sono cambiati.
app.get('/api/distributore/novita', requireRole('distributore'), (req, res) => {
  res.json(res.locals.contatori || {});
});

app.get('/distributore', requireRole('distributore'), async (req, res) => {
  // Niente più sweep completo di tutte le richieste aperte del sistema ad ogni apertura
  // pagina (era una scansione system-wide, non solo di questo distributore): ci pensa già
  // il job periodico ogni 30s, e la singola richiesta si autoaggiorna quando la si apre
  // (vedi GET /distributore/richieste/:id).
  const distributore = await db
    .prepare('SELECT * FROM distributors WHERE id = ?')
    .get(req.session.user.distributor_id);

  const elenco = await db
    .prepare(
      `SELECT r.*, rr.esito, u.ragione_sociale AS cliente_nome,
              EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int AS secondi,
              (SELECT SUM(quantita) FROM request_items ri WHERE ri.request_id = r.id) AS pezzi
         FROM request_responses rr
         JOIN requests r ON r.id = rr.request_id
         JOIN users u ON u.id = r.cliente_id
        WHERE rr.distributor_id = ?
        ORDER BY r.id DESC
        LIMIT 50`
    )
    .all(req.session.user.distributor_id);

  // Aperte finché la finestra non scade, anche se un altro banco ha già confermato.
  const daRispondere = elenco.filter((r) => r.esito === 'in_attesa' && r.secondi > 0);

  // Anteprima sintetica dei pezzi ("2x Valvola...") invece del solo totale: le prime 2
  // righe più un conteggio delle altre, mostrata direttamente nella card urgente.
  for (const r of daRispondere) {
    const righe = await richieste.righeRichiesta(r.id);
    r.anteprima = righe.slice(0, 2).map((ri) => ({ quantita: ri.quantita, nome: ri.nome }));
    r.altreRighe = Math.max(0, righe.length - r.anteprima.length);
  }

  // Ordini già confermati, in attesa che il banco li prepari: anteprima a card in home,
  // stesso trattamento di "daRispondere" ma senza countdown.
  const daPreparare = await db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
        WHERE o.distributor_id = ? AND o.stato = 'inviato'
        ORDER BY o.id DESC
        LIMIT 20`
    )
    .all(req.session.user.distributor_id);

  for (const o of daPreparare) {
    const righe = await db
      .prepare('SELECT nome_snapshot, quantita FROM order_items WHERE order_id = ?')
      .all(o.id);
    o.anteprima = righe.slice(0, 2).map((ri) => ({ quantita: ri.quantita, nome: ri.nome_snapshot }));
    o.altreRighe = Math.max(0, righe.length - o.anteprima.length);
  }

  res.render('distributore_richieste', {
    titolo: 'Richieste al banco',
    distributore,
    contatori: await contatoriBanco(req.session.user.distributor_id),
    daRispondere,
    daPreparare,
    minutiRisposta: await pricing.getFinestraMinuti(),
  });
});

// Accende/spegne la ricezione di nuove richieste, senza toccare l'attivazione della sede
// sulla piattaforma (quella resta sempre "attivo"). Risposta JSON: la home la richiama
// via fetch per un cambio istantaneo, senza ricaricare la pagina.
app.post('/api/distributore/stato', requireRole('distributore'), async (req, res) => {
  const attivo = req.body.attivo ? 1 : 0;
  await db.prepare('UPDATE distributors SET ricezione_attiva = ? WHERE id = ?').run(
    attivo,
    req.session.user.distributor_id
  );
  res.json({ ok: true, attivo: attivo === 1 });
});

// Storico richieste del banco: separato dalla home operativa per non intasarla di dati
// vecchi. Le stesse righe che prima stavano in fondo a /distributore.
app.get('/distributore/storico', requireRole('distributore'), async (req, res) => {
  const distributore = await db
    .prepare('SELECT * FROM distributors WHERE id = ?')
    .get(req.session.user.distributor_id);

  const elenco = await db
    .prepare(
      `SELECT r.*, rr.esito, rr.corriere_stato, u.ragione_sociale AS cliente_nome,
              EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int AS secondi,
              (SELECT SUM(quantita) FROM request_items ri WHERE ri.request_id = r.id) AS pezzi
         FROM request_responses rr
         JOIN requests r ON r.id = rr.request_id
         JOIN users u ON u.id = r.cliente_id
        WHERE rr.distributor_id = ?
        ORDER BY r.id DESC
        LIMIT 100`
    )
    .all(req.session.user.distributor_id);

  res.render('distributore_storico', {
    titolo: 'Storico richieste',
    distributore,
    contatori: await contatoriBanco(req.session.user.distributor_id),
    storico: elenco.filter((r) => !(r.esito === 'in_attesa' && r.secondi > 0)),
  });
});

app.get('/distributore/richieste/:id', requireRole('distributore'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  const distributorId = req.session.user.distributor_id;
  const risposta = richiesta
    ? await db
        .prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?')
        .get(richiesta.id, distributorId)
    : null;
  if (!richiesta || !risposta) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }

  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const offerta = await richieste.calcolaOfferta(richiesta.id, distributorId);
  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const ordine = richiesta.order_id
    ? await db.prepare('SELECT * FROM orders WHERE id = ?').get(richiesta.order_id)
    : null;

  const secondi = await richieste.secondiRimasti(richiesta);
  res.render('distributore_dettaglio', {
    titolo: 'Richiesta #' + richiesta.id,
    minutiRisposta: await pricing.getFinestraMinuti(),
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
    errore: req.query.errore || null,
  });
});

// Il banco ha solo due azioni possibili: accettare tutto il richiesto al prezzo standard,
// o rifiutare. Si può rispondere sia dal dettaglio della richiesta sia con un click diretto
// dalla card "Da confermare" in home (in tal caso "torna" riporta alla home invece che al
// dettaglio, ma solo se la risposta va a buon fine).
app.post('/distributore/richieste/:id/rispondi', requireRole('distributore'), async (req, res) => {
  const esitoRisposta = await richieste.rispondi(req.params.id, req.session.user.distributor_id, {
    rifiuta: req.body.azione === 'rifiuta',
    prezzoRichiesto: req.body.azione === 'prezzo_richiesto',
    utenteId: req.session.user.id,
    // Tempi non più scelti dal banco: partenza/consegna stimata restano un default fisso
    // finché non saranno calcolati dal corriere collegato via API.
    partenza_ore: req.body.partenza_ore || 2,
    consegna_ore: req.body.consegna_ore || 6,
  });

  const base = '/distributore/richieste/' + req.params.id;
  if (!esitoRisposta.ok) return res.redirect(base + '?errore=' + encodeURIComponent(esitoRisposta.errore));
  res.redirect(req.body.torna === 'home' ? '/distributore' : base);
});

// ---------- Distributore: anagrafiche clienti da approvare ----------

app.get('/distributore/clienti', requireRole('distributore'), async (req, res) => {
  const elenco = await anagrafiche.clientiDelDistributore(req.session.user.distributor_id);
  res.render('distributore_clienti', {
    titolo: 'Clienti',
    daApprovare: elenco.filter((c) => c.stato === 'in_attesa'),
    approvati: elenco.filter((c) => c.stato === 'approvato'),
    rifiutati: elenco.filter((c) => c.stato === 'rifiutato'),
    tipi: anagrafiche.TIPI_SOGGETTO,
  });
});

app.get('/distributore/clienti/:id', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const cliente = await db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(req.params.id);
  const rapporto = cliente ? await anagrafiche.legame(distributorId, cliente.id) : null;
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
    regole: await anagrafiche.regoleSconto(distributorId, cliente.id),
    marchi: await catalogo.marchi(),
     macro: await catalogo.macroCategorie(),
    famiglie: (await (async () => { const ms = await catalogo.marchi(); const out=[]; for (const m of ms) { const fs = await catalogo.famiglieDelMarchio(m.slug); for (const f of fs) out.push({ ...f, marchio: m.nome, marchio_slug: m.slug }); } return out; })()),
    salvato: req.query.salvato === '1',
  });
});

app.post('/distributore/clienti/:id/decidi', requireRole('distributore'), async (req, res) => {
  const esito = await anagrafiche.decidi(req.session.user.distributor_id, parseInt(req.params.id, 10), {
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
app.post('/distributore/clienti/:id/sconti', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const clienteId = parseInt(req.params.id, 10);
  if (!await anagrafiche.legame(distributorId, clienteId)) {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Cliente non tuo.' });
  }

  // I campi arrivano come sconto<n>_<ambito>_<chiave>: raggruppiamo i 5 scaglioni.
  const perRegola = new Map();
  for (const [campo, valore] of Object.entries(req.body || {})) {
    const m = campo.match(/^sconto([1-5])_(marchio|macro|famiglia)_(.*)$/);
    if (!m) continue;
    const chiaveRegola = m[2] + '|' + m[3];
    if (!perRegola.has(chiaveRegola)) perRegola.set(chiaveRegola, [null, null, null, null, null]);
    perRegola.get(chiaveRegola)[Number(m[1]) - 1] = valore;
  }

  for (const [chiaveRegola, scaglioni] of perRegola) {
    const taglio = chiaveRegola.indexOf('|');
    await anagrafiche.salvaRegola(
      distributorId,
      clienteId,
      chiaveRegola.slice(0, taglio),
      chiaveRegola.slice(taglio + 1),
      scaglioni
    );
  }

  res.redirect('/distributore/clienti/' + clienteId + '?salvato=1');
});

// ---------- Distributore: ordini ricevuti, preparazione e bolla ----------

app.get('/distributore/ordini', requireRole('distributore'), async (req, res) => {
  const ordini = await db
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
    contatori: await contatoriBanco(req.session.user.distributor_id),
    ordini,
  });
});

// Carica un ordine verificando che appartenga al banco loggato.
async function ordineDelBanco(req) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) return null;
  return ordine;
}

// Segna l'ordine come preso in carico dal banco (stato 'inviato' -> 'in_evasione') e avvisa
// il cliente. Non c'è più un pulsante dedicato per questo passaggio: scatta da solo aprendo
// il dettaglio dell'ordine, oppure con il tasto di rimozione sulla card in home.
async function prendiInCarico(ordine) {
  if (ordine.stato !== 'inviato') return ordine;
  await db.prepare(
    `UPDATE orders SET stato = 'in_evasione', in_evasione_il = NOW(), preso_in_carico_il = NOW()
      WHERE id = ?`
  ).run(ordine.id);
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Ordine in preparazione',
    testo: `Il banco sta preparando il tuo ordine #${ordine.id}.`,
    link: '/ordini/' + ordine.id,
    categoria: 'ordini',
    order_id: ordine.id,
  });
  return { ...ordine, stato: 'in_evasione', in_evasione_il: new Date(), preso_in_carico_il: new Date() };
}

app.get('/distributore/ordini/:id', requireRole('distributore'), async (req, res) => {
  let ordine = await ordineDelBanco(req);
  if (!ordine) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  ordine = await prendiInCarico(ordine);

  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = await db
    .prepare('SELECT * FROM distributors WHERE id = ?')
    .get(ordine.distributor_id);
  const righe = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const risposta = ordine.request_id
    ? await richieste.getRisposta(ordine.request_id, ordine.distributor_id)
    : null;
  const mancanti = ordine.request_id
    ? (await richieste.calcolaOfferta(ordine.request_id, ordine.distributor_id)).mancanti
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
    ivaPct: await pricing.getIvaPct(),
    errore: req.query.errore || null,
  });
});

// Usata dal tasto di rimozione sulla card "Ordini da preparare" in home: la fa sparire da
// lì spostandola in "in preparazione", senza dover aprire il dettaglio.
app.post('/distributore/ordini/:id/preparazione', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/ordini');
  await prendiInCarico(ordine);
  res.redirect(req.body.torna === 'home' ? '/distributore' : '/distributore/ordini/' + ordine.id);
});

// Emissione della bolla / DDT: assegna il numero progressivo e segna la merce partita.
app.post('/distributore/ordini/:id/ddt', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/ordini');

  const numero = await ddt.emetti(ordine, {
    colli: req.body.colli,
    aspetto: req.body.aspetto,
    trasporto: req.body.trasporto,
    causale: req.body.causale,
    note: req.body.note,
  });

  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Merce in partenza',
    testo: `Ordine #${ordine.id}: emessa la bolla n. ${numero}. Puoi vedere il DDT in app.`,
    link: '/ddt/' + ordine.id,
    categoria: 'ordini',
    sottostato: 'spedito',
    order_id: ordine.id,
  });

  res.redirect('/ddt/' + ordine.id);
});

// ---------- Bolla / DDT ----------

app.get('/ddt/:id', requireLogin, async (req, res) => {
  const documento = await ddt.documento(req.params.id);
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
    ivaPct: await pricing.getIvaPct(),
  });
});

// ---------- Agente: vista ordini ----------

app.get('/agente/ordini', requireRole('agente'), async (req, res) => {
  const ordini = await db
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

// ---------- Gestione errori ----------

// Senza un handler dedicato, un errore lanciato da una rotta async finiva nel gestore di
// default di Express: fuori da NODE_ENV=production può restituire lo stack trace al
// client, e comunque non è coerente con le pagine di errore già esistenti nell'app.
// Va registrato dopo tutte le rotte (Express lo riconosce come error-handler dai 4
// parametri), quindi resta qui in fondo.
app.use((err, req, res, next) => {
  console.error('Errore non gestito nella richiesta', req.method, req.originalUrl, ':', err);
  if (res.headersSent) return next(err);
  res.status(500).render('errore', {
    titolo: 'Errore imprevisto',
    messaggio: 'Si è verificato un problema imprevisto. Riprova tra poco.',
  });
});

// Reti di sicurezza a livello di processo: prima non c'erano, quindi un errore sfuggito
// (es. una Promise rifiutata senza .catch) poteva passare inosservato nei log, o — nel
// caso di un'eccezione davvero non gestita — lasciare il processo in uno stato incerto
// senza che nessuno se ne accorgesse. Sull'eccezione non gestita si esce deliberatamente
// (invece di continuare a girare in uno stato che potrebbe essere corrotto): se l'app è
// tenuta in vita da un process manager/hosting che la riavvia, è la scelta più sicura.
process.on('unhandledRejection', (motivo) => {
  console.error('Promise rifiutata senza gestione:', motivo);
});
process.on('uncaughtException', (err) => {
  console.error('Eccezione non gestita, arresto il processo:', err);
  process.exit(1);
});

// ---------- Avvio ----------

// Le richieste scadono anche se nessuno sta guardando una pagina: così la notifica
// "nessuna conferma" arriva comunque allo scadere dei 10 minuti.
(async () => {
  try { await richieste.aggiornaScadenzeAperte(); } catch {}
})();
setInterval(async () => {
  try {
    // Chiude le finestre scadute e crea gli ordini automatici (vedi impostaAssegnatore).
    await richieste.aggiornaScadenzeAperte();
  } catch (err) {
    console.error('Errore nel controllo scadenze:', err.message);
  }
}, 30 * 1000).unref();

// Gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/whatsapp.js).
whatsapp.avvia();

app.listen(PORT, () => {
  console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
});
