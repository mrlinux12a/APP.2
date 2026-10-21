require('dotenv').config();
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
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
const { leggiQuery, corpoSempreOggetto, rifiutaNulNelPercorso, percorsoInterno, ritornoBanco, conRitorno, salvaSessionePrimaDelRedirect, idNumerico, gestoreNonTrovato, gestoreErrori, vuoleJson } = require('./src/http');
const { QUANTITA_MASSIMA, leggiId, leggiQuantita } = require('./src/input');
const { passwordValida } = require('./src/password');
const pricing = require('./src/pricing');
const format = require('./src/format');
const orariCorriere = require('./src/corriere');
const icone = require('./src/icone');
const materialeModulo = require('./src/materiale');
const ricevuteModulo = require('./src/ricevute');
const catalogo = require('./src/catalogo');
const richieste = require('./src/richieste');
const orari = require('./src/orari');
const notifiche = require('./src/notifiche');
const webPush = require('./src/web_push');
const bancoAvvisi = require('./src/banco_avvisi');
const geo = require('./src/geo');
const anagrafiche = require('./src/anagrafiche');
const anagraficaBanco = require('./src/anagrafica_banco');
const passwordAccount = require('./src/password_account');
const recuperoPassword = require('./src/recupero_password');
const account = require('./src/account');
const tokenApp = require('./src/token_app');
const emailModulo = require('./src/email');
const { conCache } = require('./src/memo');
const flusso = require('./src/flusso_cliente');
const storicoBanco = require('./src/storico_banco');
const storicoDettaglio = require('./src/storico_dettaglio');
const richiestaBanco = require('./src/richiesta_banco');
const ordineBanco = require('./src/ordine_banco');
const stripePagamenti = require('./src/stripe_pagamenti');
const pagamenti = require('./src/pagamenti');
const testiLegali = require('./src/testi_legali');
const { ArchivioSqlite } = require('./src/sessioni');
const { TESTO_DISPONIBILITA, prodottoJson } = require('./src/prodotto_json');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito, iscrizioneBloccata, registraIscrizione, recuperoBloccato, registraRecupero } = require('./src/limite_login');
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
// Le viste del banco che portano a un ordine o a una richiesta ci aggiungono `torna` (la pagina da cui si parte): vedi ritornoBanco.
app.locals.conRitorno = conRitorno;
// asset('/style.css') -> '/style.css?v=1759660000000': l'indirizzo di un file statico con la sua versione (data di
// modifica). La data si rilegge al massimo ogni 5 secondi: una modifica in locale si vede quasi subito, senza
// riavviare il server, e in produzione costa una lettura ogni tanto invece di una per pagina.
const versioniAsset = new Map();
app.locals.asset = function asset(percorso) {
  const adesso = Date.now();
  const voce = versioniAsset.get(percorso);
  if (voce && adesso - voce.letta < 5000) return voce.url;
  let url = percorso;
  try {
    url = percorso + '?v=' + Math.floor(fs.statSync(path.join(__dirname, 'public', percorso)).mtimeMs);
  } catch (err) { /* file mancante: l'indirizzo resta senza versione */ }
  versioniAsset.set(percorso, { url, letta: adesso });
  return url;
};
// Necessario per leggere il vero IP del client (usato dal limite tentativi di login)
// quando l'app gira dietro un proxy/load balancer (es. Vercel).
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Ogni parametro della query string è sempre un testo, mai un array (?q=a&q=b): vedi src/http.js.
app.set('query parser', leggiQuery);
// Gli id nei percorsi (/ordini/:id, /richieste/:id...) sono numeri interi positivi: con qualsiasi altra
// cosa il percorso non esiste (404) invece di far fallire la query e dare un 500.
app.param('id', idNumerico);

// Un %00 nel percorso non è mai valido (Postgres lo rifiuta): 400 subito, prima di qualunque route.
app.use(rifiutaNulNelPercorso);

// Intestazioni di sicurezza. Una Content-Security-Policy completa (script-src) non è possibile: le pagine usano script e stili
// inline. Quella qui sotto non tocca gli script ma chiude le strade che non servono: il sito non si incornicia in pagine altrui
// (clickjacking, anche per i browser che ignorano X-Frame-Options), nessun <base> iniettato può cambiare dove puntano i
// collegamenti relativi, nessun <object>/<embed>, e i moduli si inviano solo a questo sito (un modulo iniettato non può
// portare i dati su un indirizzo esterno). HSTS solo quando la richiesta è davvero HTTPS (con `trust proxy` vale anche dietro
// il proxy): su HTTP semplice il browser lo ignorerebbe e in locale non deve restare appiccicato a localhost.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    // Il sito non usa fotocamera né microfono: niente script (nemmeno iniettato) può chiederli. La posizione sì, ma solo a questo sito (`self`) e solo
    // dal pulsante accanto all'indirizzo di consegna del carrello: con `geolocation=()` il browser la bloccava sempre, su iPhone, Android e PC. `payment`
    // resta com'è (Stripe lo usa per Apple Pay e Google Pay) e non si imposta Cross-Origin-Opener-Policy, che romperebbe le finestre di Google Pay e Link.
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
// Comprime HTML, JSON, CSS e JS (sotto 1 KB no): la ricerca in JSON passa da ~46 KB a pochi KB,
// che su rete mobile è la parte più lenta. Le foto sono già compresse (webp) e restano intatte.
app.use(compression());

// Webhook di Stripe (checkout.session.completed / expired). Prima dei parser del corpo: la firma si verifica sul testo
// grezzo, e un JSON già interpretato non la farebbe più tornare. Niente sessione né controllo d'origine: la chiamata
// viene da Stripe, non da un browser, e vale solo se la firma (il segreto del webhook, vedi src/stripe_config.js) è giusta. 2xx = ricevuto; un
// errore nostro (500) fa riprovare Stripe da solo per giorni.
app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!stripePagamenti.attivo() || !stripePagamenti.webhookConfigurato()) return res.status(503).send('Stripe non configurato');
  let evento;
  try {
    evento = stripePagamenti.leggiEvento(req.body, req.get('stripe-signature'));
  } catch (e) {
    return res.status(400).send('Firma non valida');
  }
  try {
    await stripePagamenti.gestisciEvento(evento);
    res.json({ ricevuto: true });
  } catch (e) {
    console.error('[stripe] webhook', evento.type, e.message);
    res.status(500).send('Errore');
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(corpoSempreOggetto);

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
// CSS e JS dell'app: nelle pagine arrivano con ?v=<data di modifica del file> (asset(), definita in alto), quindi un URL
// con la versione non cambia mai contenuto e il browser lo tiene un anno senza richiederlo di nuovo a ogni
// pagina (sono 2-3 richieste in meno a ogni apertura, su una rete da cantiere). Quando il file cambia cambia
// anche la versione e il browser lo riscarica da solo. Senza ?v= (collegamenti vecchi) resta la sola verifica
// ETag di prima.
const ASSET_VERSIONATI = new Set(['/style.css', '/app.js', '/mappa.js', '/pagamento.js']);
app.use((req, res, next) => {
  if (req.query.v && ASSET_VERSIONATI.has(req.path)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// I browser chiedono /favicon.ico da soli: risposto qui, prima della sessione e delle query del middleware
// delle viste, invece di far passare un 404 per tutta la pagina (con le sue letture dal DB) a ogni apertura.
app.get('/favicon.ico', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.type('png').sendFile(path.join(__dirname, 'public', 'icons', 'icona-192.png'));
});
// Verifica del dominio per Apple Pay (Stripe): Apple controlla che questo sito pubblichi il file di Stripe, uguale per tutti i conti, a questo indirizzo esatto, in
// HTTPS, senza reindirizzamenti. express.static ignora le cartelle che cominciano per punto, per questo c'è una rotta apposta, prima della sessione. Il file sta in
// public/.well-known/ (scripts/scarica_file_apple_pay.js lo scarica da Stripe); se manca risponde 404 e Apple Pay semplicemente non compare.
app.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
  const file = path.join(__dirname, 'public', '.well-known', 'apple-developer-merchantid-domain-association');
  res.set('Cache-Control', 'public, max-age=300');
  res.type('text/plain').sendFile(file, { dotfiles: 'allow' }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text/plain').send('Non trovato');
  });
});
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
      // Marcato "Secure" solo quando la richiesta arriva davvero in HTTPS (con `trust proxy` vale anche dietro
      // un proxy): oggi il sito gira anche su HTTP semplice, dove un cookie Secure non verrebbe mai rimandato.
      secure: 'auto',
    },
  })
);
app.use(salvaSessionePrimaDelRedirect);

// Ditta e filiale scritte nell'intestazione del banco (views/partials/banco_testa.ejs), che ha ogni pagina del
// distributore: cambiano di rado, quindi si leggono una volta al minuto invece che a ogni pagina.
// La chiave della cache include una "versione" per banco: quando l'Anagrafica del banco cambia nome o filiale la si alza e l'intestazione si rilegge
// subito (senza, il vecchio nome restava fino a un minuto).
const versioneIntestazioneBanco = new Map();
const intestazioneBancoLetta = conCache(60000, (distributorId) =>
  db.prepare('SELECT nome, filiale FROM distributors WHERE id = ?').get(distributorId)
);
const intestazioneBanco = (distributorId) => intestazioneBancoLetta(distributorId, versioneIntestazioneBanco.get(distributorId) || 0);
const rileggiIntestazioneBanco = (distributorId) => versioneIntestazioneBanco.set(distributorId, (versioneIntestazioneBanco.get(distributorId) || 0) + 1);

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
  const [notificheNonLette, ordiniNonLetti, richiesteNonLette, geoStato, letturaContatori, statoOrdini, profiloCliente, bancoTesta] =
    await Promise.all([
      utente ? notifiche.nonLette(utente.id) : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'ordini') : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'richieste') : Promise.resolve(0),
      utente ? geo.statoUtente(utente.id) : Promise.resolve({ consenso: false }),
      utente && utente.ruolo === 'distributore' && utente.distributor_id
        ? letturaBanco(utente.distributor_id)
        : Promise.resolve(null),
      // Icona dinamica "Stato ordini" (partials/nav_ordini.ejs): solo per il cliente e solo per le
      // pagine, non per le API dell'app. Un errore qui non deve mai rompere la pagina, ma va scritto
      // nel log: se lo si ingoia in silenzio l'icona resta quella di prima e nessuno capisce perché.
      utente && utente.ruolo === 'cliente' && !req.path.startsWith('/api/')
        ? flusso.statoIconaOrdini(utente.id).catch((err) => {
            console.error('[nav] icona Stato ordini non calcolata:', err.message);
            return null;
          })
        : Promise.resolve(null),
      // Menu del profilo nell'appbar del cliente (partials/appbar.ejs): referente e distributore di riferimento.
      // Come sopra, un errore non rompe la pagina: il menu mostra solo la ragione sociale.
      utente && utente.ruolo === 'cliente' && !req.path.startsWith('/api/')
        ? anagrafiche.intestazioneCliente(utente.id).catch((err) => {
            console.error('[appbar] intestazione del profilo non letta:', err.message);
            return null;
          })
        : Promise.resolve(null),
      // Intestazione del banco, uguale su tutte le sue pagine. Come sopra: un errore non rompe la pagina (la
      // barra mostra allora il nome dell'utente al posto di ditta e filiale).
      utente && utente.ruolo === 'distributore' && utente.distributor_id && !req.path.startsWith('/api/')
        ? intestazioneBanco(utente.distributor_id).catch((err) => {
            console.error('[banco] intestazione non letta:', err.message);
            return null;
          })
        : Promise.resolve(null),
    ]);

  // Il prezzo di un articolo che vede l'installatore (catalogo, categoria, ricerca, varianti, carrello) è il PREZZO DEL BANCO: listino meno lo
  // sconto del banco, senza il 10% di servizio, che sta solo nella voce "Servizio" del riepilogo (vedi pricing.dividiTotale). Funzione pura
  // (niente DB): i template EJS non possono fare "await". `totaleRigaBanco` è prezzo × quantità arrotondato come `subtotale` dell'ordine.
  res.locals.prezzoBanco = (riga) => pricing.prezzoNetto(riga);
  res.locals.totaleRigaBanco = (riga, quantita) => pricing.round2(pricing.prezzoNetto(riga) * quantita);
  // Gli ordini creati prima delle offerte per distributore non hanno l'IVA calcolata.
  res.locals.totaleOrdine = (o) => (o.totale_ivato > 0 ? o.totale_ivato : o.totale_finale);
  res.locals.notificheNonLette = notificheNonLette;
  // Il tab "Stato ordini" segue tutta la pipeline del cliente (richiesta -> offerte ->
  // ordine), non solo gli ordini veri e propri: il badge conta le notifiche non lette di
  // entrambe le categorie, altrimenti una conferma disponibilità (categoria "richieste")
  // non farebbe comparire nulla.
  res.locals.ordiniNonLetti = ordiniNonLetti + richiesteNonLette;
  res.locals.statoOrdini = statoOrdini;
  res.locals.profiloCliente = profiloCliente;
  res.locals.bancoTesta = bancoTesta;
  res.locals.percorso = req.path; // la voce attiva dell'intestazione del banco si sceglie da qui
  // Notifiche ad app chiusa (src/web_push.js): la chiave pubblica con cui il browser si iscrive (vuota = le push sono spente) e l'iscrizione che il server
  // già ha per QUESTA sessione. Le legge public/app.js dai <meta> di partials/app_head.ejs: se l'iscrizione del browser è un'altra (primo accesso, nuovo
  // login, uscita e rientro) la manda di nuovo; senza questo confronto servirebbe una chiamata a ogni pagina.
  res.locals.pushChiave = utente ? webPush.chiavePubblica() : '';
  res.locals.pushEndpoint = (req.session && req.session.pushEndpoint) || '';
  res.locals.geo = geoStato;
  // I contatori del banco servono alla barra di navigazione di tutte le pagine distributore.
  res.locals.contatori = letturaContatori ? letturaContatori.contatori : null;
  // Quanto manca alla prima richiesta da confermare (null se non ce n'è): la striscia sotto l'intestazione del banco.
  res.locals.primaScadeSec = letturaContatori ? letturaContatori.primaScadeSec : null;
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

// Trasforma il carrello di sessione in righe [{prodotto, quantita}] con i dati aggiornati. Gli articoli
// non più in catalogo (tolti o disattivati dopo essere finiti nel carrello) escono anche dal carrello di
// sessione: altrimenti il pallino del carrello li contava ancora, senza che la pagina li mostrasse.
async function righeCarrello(req) {
  const carrello = getCarrello(req);
  const ids = Object.keys(carrello).map(Number).filter((id) => carrello[id] > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const prodotti = await db.prepare(
      `SELECT * FROM products WHERE attivo = 1 AND id IN (${placeholders}) ORDER BY macro_slug, categoria, nome`
    )
    .all(...ids);
  const presenti = new Set(prodotti.map((p) => p.id));
  for (const id of Object.keys(carrello)) {
    if (!presenti.has(Number(id))) delete carrello[id];
  }
  return prodotti.map((prodotto) => ({ prodotto, quantita: carrello[prodotto.id] }));
}

// Legge i campi quantita_<id> di un form e aggiorna il carrello di sessione.
// modo 'aggiungi' (cataloghi e ricerca): le quantità si sommano, lo zero non tocca nulla.
// modo 'imposta' (pagina carrello): le quantità sostituiscono, lo zero rimuove la riga.
// Le quantità hanno un tetto (QUANTITA_MASSIMA, src/input.js): un numero enorme o scritto male non deve
// arrivare al DB come quantità di una riga.
function aggiornaCarrelloDaForm(req, modo = 'aggiungi') {
  const carrello = getCarrello(req);
  for (const [chiave, valore] of Object.entries(req.body || {})) {
    if (!chiave.startsWith('quantita_')) continue;
    const id = leggiId(chiave.slice('quantita_'.length));
    if (!id) continue;
    const q = leggiQuantita(valore);
    if (modo === 'imposta') {
      if (q > 0) carrello[id] = q;
      else delete carrello[id];
    } else if (q > 0) {
      carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + q);
    }
  }
}

// Apre la sessione di un utente appena riconosciuto (login o registrazione). Prima si cambia l'id di
// sessione (regenerate): un cookie di sessione preesistente non diventa mai quello di un utente collegato
// (session fixation). Poi si salva PRIMA di rispondere: express-session manda la risposta e salva dopo, e se
// il browser rilegge subito la pagina (succede) la sessione non c'è ancora e si torna al login.
function avviaSessione(req, utente) {
  return new Promise((risolvi, rifiuta) => {
    req.session.regenerate((err) => {
      if (err) return rifiuta(err);
      req.session.user = utente;
      req.session.save((errSalvataggio) => (errSalvataggio ? rifiuta(errSalvataggio) : risolvi()));
    });
  });
}

// ---------- Home / Login ----------

app.get('/', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.ruolo === 'agente') return res.redirect('/agente/ordini');
  if (req.session.user.ruolo === 'distributore') return res.redirect('/distributore');
  return res.redirect('/home');
});

// Le frasi che il login può mostrare dopo un passaggio altrove (?avviso=...): solo queste, scelte da noi (mai testo preso dall'indirizzo).
const AVVISI_LOGIN = {
  password: 'Password cambiata. Accedi con quella nuova.',
  eliminato: 'Account eliminato. Grazie per aver usato Minuteria.',
};

app.get('/login', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { titolo: 'Accedi', errore: null, scheda: 'accedi', avviso: AVVISI_LOGIN[req.query.avviso] || '' });
});

// ---------- Recupero della password (installatore) ----------
// "Password dimenticata?": nome utente o email -> email con un link valido un'ora (src/recupero_password.js). La risposta è sempre la stessa, che l'account esista
// o no, e l'invio non si aspetta. Il link usa APP_URL (mai l'intestazione Host, che la scrive chi chiama: un link verso un sito altrui farebbe rubare il codice);
// senza APP_URL vale solo in locale.
const HOST_LOCALI = ['localhost', '127.0.0.1', '::1'];
const eLocale = (req) => HOST_LOCALI.includes(req.hostname);
function urlPerEmail(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || (eLocale(req) ? req.protocol + '://' + req.get('host') : '');
}

app.get('/password-dimenticata', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('password_dimenticata', { stato: 'modulo', identificativo: '' });
});

app.post('/password-dimenticata', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  const identificativo = typeof req.body.identificativo === 'string' ? req.body.identificativo.trim().slice(0, 200) : '';
  if (!identificativo) {
    return res.status(400).render('password_dimenticata', { stato: 'modulo', errore: 'Scrivi il tuo nome utente o la tua email.', identificativo: '' });
  }
  if (recuperoBloccato(req, identificativo)) return res.status(429).render('password_dimenticata', { stato: 'troppe' });
  registraRecupero(req, identificativo);
  const esito = await recuperoPassword.richiedi(identificativo, { baseUrl: urlPerEmail(req) });
  // Non si aspetta l'invio (nemmeno il tempo di risposta deve dire se l'account c'è). In locale, se l'email non è partita (niente SMTP), il link si scrive nel
  // log del server: serve a provare senza posta. Mai su un indirizzo pubblico: nel log finirebbe un link che apre un account.
  esito.consegne.then((consegne) => {
    if (!eLocale(req)) return;
    for (const c of consegne) if (!c.inviata && c.link) console.log('[recupero password] (solo in locale) link per ' + c.username + ': ' + c.link);
  });
  res.render('password_dimenticata', { stato: 'inviata', minutiValidita: recuperoPassword.VALIDITA_MIN });
});

// Il link dell'email: se è ancora buono si sceglie la nuova password, altrimenti si propone di chiederne uno nuovo.
app.get('/reimposta-password/:codice', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const accountLink = await recuperoPassword.accountDaCodice(req.params.codice);
  if (!accountLink) return res.status(410).render('password_reimposta', { stato: 'nonvalido' });
  res.render('password_reimposta', { stato: 'modulo', username: accountLink.username, codice: req.params.codice, errori: {} });
});

app.post('/reimposta-password/:codice', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const esito = await recuperoPassword.reimposta(req.params.codice, req.body);
  if (esito.nonValido) return res.status(410).render('password_reimposta', { stato: 'nonvalido' });
  if (!esito.ok) {
    const accountLink = await recuperoPassword.accountDaCodice(req.params.codice);
    if (!accountLink) return res.status(410).render('password_reimposta', { stato: 'nonvalido' });
    return res.status(400).render('password_reimposta', { stato: 'modulo', username: accountLink.username, codice: req.params.codice, errori: esito.errori });
  }
  res.redirect('/login?avviso=password');
});

// Pagine pubbliche richieste da Google Play per l'app: informativa sulla privacy e come eliminare l'account (src/testi_legali.js). Senza accesso.
app.get('/privacy', (req, res) => res.render('legale', { pagina: testiLegali.privacy() }));
app.get('/elimina-account', (req, res) => res.render('legale', { pagina: testiLegali.eliminazione() }));

// ---------- Registrazione cliente ----------

// La pagina ha tre passi (uno script li mostra uno alla volta) ma è un unico modulo. Il distributore non si sceglie:
// ogni nuovo cliente è collegato a quello predefinito (anagrafiche.distributoriPredefiniti).
app.get('/registrati', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('registrati', {
    titolo: 'Registra la tua impresa',
    tipi: anagrafiche.TIPI_SOGGETTO,
    dati: {},
    errori: [],
    campiErrore: [],
    passo: 1,
  });
});

app.post('/registrati', async (req, res) => {
  // Gli errori ripropongono il modulo com'è stato compilato (le password no) e la pagina si riapre sul primo passo
  // che ha un campo sbagliato.
  const mostraErrori = (errori) =>
    res.status(400).render('registrati', {
      titolo: 'Registra la tua impresa',
      tipi: anagrafiche.TIPI_SOGGETTO,
      dati: req.body,
      errori: errori.map((e) => e.testo),
      campiErrore: errori.flatMap((e) => e.campi),
      passo: anagrafiche.primoPassoConErrori(errori),
    });

  // La registrazione è aperta a tutti e ogni iscrizione costa un hash bcrypt e una riga di anagrafica approvata da sola:
  // senza un limite per indirizzo un ciclo di richieste riempiva il database di clienti finti.
  if (iscrizioneBloccata(req)) {
    return res.status(429).render('errore', {
      titolo: 'Troppe registrazioni',
      messaggio: 'Da questo indirizzo sono state fatte troppe registrazioni. Riprova più tardi, o contattaci se sei un nuovo cliente.',
      link: '/login',
      linkTesto: 'Vai all’accesso',
    });
  }

  const errori = await anagrafiche.validaIscrizione(req.body);
  if (errori.length) return mostraErrori(errori);

  let cliente;
  try {
    cliente = await anagrafiche.iscriviCliente(req.body, await anagrafiche.distributoriPredefiniti());
  } catch (e) {
    // 23505 = nome utente (unico) preso da qualcun altro fra il controllo di validaIscrizione e l'inserimento.
    if (e && e.code === '23505') return mostraErrori([{ testo: 'Questo nome utente è già in uso.', campi: ['username'] }]);
    throw e;
  }
  registraIscrizione(req);
  await avviaSessione(req, {
    id: cliente.id,
    ruolo: cliente.ruolo,
    username: cliente.username,
    ragione_sociale: cliente.ragione_sociale,
    zona: cliente.zona,
    distributor_id: null,
  });
  res.redirect('/benvenuto');
});

// Schermata dopo la registrazione: l'anagrafica è pronta e c'è il distributore di riferimento. Senza stato: se la
// si riapre, mostra la stessa cosa. Se il distributore non ha ancora approvato, lo dice.
app.get('/benvenuto', requireRole('cliente'), async (req, res) => {
  const legami = await anagrafiche.legamiDelCliente(req.session.user.id);
  res.render('benvenuto', {
    titolo: 'Benvenuto',
    distributore: anagrafiche.distributoreDiRiferimento(legami),
  });
});

// ---------- Profilo del cliente ----------

// La pagina "La mia anagrafica". `extra`: stato (400/429 dopo un cambio password andato male) e erroriPassword (aprono la scheda "Accesso").
async function paginaProfilo(req, res, extra = {}) {
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const legami = await anagrafiche.legamiDelCliente(cliente.id);
  res.status(extra.stato || 200).render('profilo', {
    titolo: 'La mia anagrafica',
    cliente,
    legami,
    distributore: anagrafiche.distributoreDiRiferimento(legami),
    tipi: anagrafiche.TIPI_SOGGETTO,
    indirizzoCliente: format.indirizzoCompleto(cliente),
    // Scheda "Accesso": errori del cambio password (aprono il modulo) e messaggio dopo averla cambiata (?ok=password).
    erroriPassword: extra.erroriPassword || {},
    passwordCambiata: !extra.erroriPassword && req.query.ok === 'password',
  });
}

app.get('/profilo', requireRole('cliente'), (req, res) => paginaProfilo(req, res));

// Cambio della password dall'interno (scheda "Accesso"). Stesse regole del banco (src/password_account.js): attuale giusta, nuova di 8-72 caratteri e diversa,
// altre sessioni chiuse e accessi dell'app revocati. La password attuale sbagliata conta nel limite dei tentativi del login.
app.post('/profilo/password', requireRole('cliente'), async (req, res) => {
  const chiaveLimite = 'cambio-password:' + String(req.session.user.username || req.session.user.id);
  if (accessoBloccato(req, chiaveLimite)) {
    return paginaProfilo(req, res, { stato: 429, erroriPassword: { attuale: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' } });
  }
  const esito = await passwordAccount.cambiaPassword(req.session.user.id, req.sessionID, req.body);
  if (!esito.ok) {
    if (esito.passwordSbagliata) registraAccessoFallito(req, chiaveLimite);
    return paginaProfilo(req, res, { stato: 400, erroriPassword: esito.errori });
  }
  accessoRiuscito(req, chiaveLimite);
  res.redirect('/profilo?ok=password#accesso');
});

// Eliminare l'account dal sito (src/account.js, lo stesso dell'app): una pagina che spiega cosa succede e chiede la password. Si anonimizza e si disattiva,
// non si cancella (ordini e ricevute restano). Se c'è qualcosa in corso la pagina lo dice subito e il pulsante non c'è.
async function paginaEliminaAccount(req, res, extra = {}) {
  const corso = await account.attivitaInCorso(req.session.user.id);
  res.status(extra.stato || 200).render('profilo_elimina', {
    titolo: 'Elimina account',
    corso,
    inCorso: !!(corso.richieste || corso.ordini || corso.pagamenti),
    errore: extra.errore || '',
  });
}

app.get('/profilo/elimina', requireRole('cliente'), (req, res) => paginaEliminaAccount(req, res));

app.post('/profilo/elimina', requireRole('cliente'), async (req, res) => {
  const username = String(req.session.user.username || '');
  if (accessoBloccato(req, username)) {
    return paginaEliminaAccount(req, res, { stato: 429, errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const utente = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!(await passwordValida(req.body.password, utente))) {
    registraAccessoFallito(req, username);
    return paginaEliminaAccount(req, res, { stato: 400, errore: 'Password non corretta.' });
  }
  accessoRiuscito(req, username);
  try {
    await account.eliminaAccount(utente);
  } catch (e) {
    if (!(e instanceof account.AccountNonEliminabile)) throw e;
    return paginaEliminaAccount(req, res, { stato: 409, errore: e.messaggioCliente });
  }
  tokenApp.dimenticaUtente(utente.id);
  // L'account non esiste più: anche la sessione di questa scheda (le altre le ha già tolte eliminaAccount).
  req.session.destroy(() => res.redirect('/login?avviso=eliminato'));
});

app.post('/login', async (req, res) => {
  // Uno spazio digitato per sbaglio (specie a fine nome, su telefono con autocorrezione)
  // non deve far fallire l'accesso: il nome utente si confronta sempre già "ripulito".
  // Un nome utente reale è corto: il taglio evita chiavi enormi nel contatore dei tentativi.
  const username = String(req.body.username || '').trim().slice(0, 100);

  if (accessoBloccato(req, username)) {
    return res.status(429).render('login', { errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
  if (!(await passwordValida(req.body.password, user))) {
    registraAccessoFallito(req, username);
    return res.status(401).render('login', { errore: 'Credenziali non valide.' });
  }
  accessoRiuscito(req, username);
  await avviaSessione(req, {
    id: user.id,
    ruolo: user.ruolo,
    username: user.username,
    ragione_sociale: user.ragione_sociale,
    zona: user.zona,
    distributor_id: user.distributor_id,
  });
  res.redirect('/');
});

app.post('/logout', async (req, res) => {
  // Chi esce non deve più ricevere le notifiche di questo account su questo telefono o computer (se poi entra qualcun altro, l'iscrizione passa a lui).
  const utenteUscente = req.session.user;
  if (utenteUscente && req.session.pushEndpoint) await webPush.rimuovi(req.session.pushEndpoint, utenteUscente.id).catch(() => {});
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Cliente: home, ricerca, categorie ----------

app.get('/home', requireRole('cliente'), async (req, res) => {
  const [{ inEvidenza, altre }, prodottiConFotoConta] = await Promise.all([
    catalogo.categorieHome(),
    catalogo.contaProdottiConFoto(),
  ]);
  res.render('home', { titolo: 'Ordini Minuteria', inEvidenza, altre, prodottiConFotoConta, carrello: getCarrello(req) });
});

// Una ricerca dentro una categoria o un marchio, nella forma dell'elenco delle pagine ({ righe, ricerca, troncato }).
async function cercaComeElenco(q, ambito) {
  const righe = await catalogo.cercaProdotti(q, ambito);
  return { righe, ricerca: true, troncato: !!righe.troncato };
}

app.get('/cerca', requireRole('cliente'), async (req, res) => {
  const q = (req.query.q || '').trim();
  const diametro = req.query.diametro || null;
  const materiale = req.query.materiale || null;
  const risultati = q ? await catalogo.cercaProdotti(q, { diametro, materiale }) : [];
  res.render('cerca', {
    titolo: 'Cerca',
    q,
    diametro,
    materiale,
    risultati,
    troncato: !!risultati.troncato,
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
  };
  const risultati = q.length >= 2 ? await catalogo.cercaProdotti(q, ambito) : [];
  res.json({ risultati: risultati.map((p) => prodottoJson(p)), troncato: !!risultati.troncato });
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
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p)),
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
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p)),
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
    ? await cercaComeElenco(q, { macroSlug: macro.slug, sotto: sottoSlug })
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

// Il banco non ha più questa pagina (tolta dal suo menu il 14/10/2026): per lui è come se non esistesse (404).
app.get('/punti-vendita', requireLogin, async (req, res, next) => {
  if (req.session.user.ruolo === 'distributore') return next();
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
    ? await cercaComeElenco(q, { brandSlug: marca.slug, famiglia: codice })
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
  // `totale_finale` (nome storico) è la merce a prezzo del banco: lo stesso prezzo di catalogo e carrello; il 10% sta solo nel Servizio.
  res.json({ carrello, pezzi: contaCarrello(req), totale_finale: totali.totale_netto });
});

app.post('/api/carrello/aggiungi', requireRole('cliente'), async (req, res) => {
  const id = leggiId(req.body.id || req.body.product_id);
  const qty = leggiQuantita(req.body.qty || req.body.quantita);
  if (!id || !qty) return res.status(400).json({ ok: false, errore: 'Quantità non valida.' });
  const prodotto = await db.prepare('SELECT id FROM products WHERE id = ? AND attivo = 1').get(id);
  if (!prodotto) return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  const carrello = getCarrello(req);
  carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + qty);
  const pezzi = contaCarrello(req);
  res.json({ ok: true, carrello, pezzi, prodottoQty: carrello[id] });
});

app.post('/api/carrello/aggiungi-batch', requireRole('cliente'), async (req, res) => {
  // Un elemento che non è un oggetto ({id, qty}) si scarta: il destructuring di null/numeri lanciava un errore.
  const items = Array.isArray(req.body.items) ? req.body.items.filter((v) => v && typeof v === 'object') : [];
  if (!items.length) return res.status(400).json({ ok: false, errore: 'Nessun articolo.' });
  const richiesti = items
    .map(({ id, qty }) => ({ pid: leggiId(id), q: leggiQuantita(qty) }))
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
    carrello[pid] = Math.min(QUANTITA_MASSIMA, (carrello[pid] || 0) + q);
    aggiornati[pid] = carrello[pid];
  }
  res.json({ ok: true, carrello, pezzi: contaCarrello(req), aggiornati });
});

app.post('/api/carrello/imposta', requireRole('cliente'), async (req, res) => {
  const id = leggiId(req.body.id);
  const qty = leggiQuantita(req.body.qty);
  if (!id) return res.status(400).json({ ok: false, errore: 'Prodotto non valido.' });
  const carrello = getCarrello(req);
  if (qty > 0) carrello[id] = qty;
  else delete carrello[id];
  // righeCarrello legge i prodotti attivi: se quello appena impostato non c'è (id inventato, articolo
  // tolto dal catalogo) esce anche dal carrello, così il conteggio dei pezzi resta quello vero.
  const righe = await righeCarrello(req);
  if (qty > 0 && !righe.some((r) => r.prodotto.id === id)) {
    return res.status(404).json({ ok: false, errore: 'Prodotto non trovato.' });
  }
  // Gli stessi totali della pagina Carrello (flusso.riepilogoCarrello: con corriere e servizio): `riepilogo` ha le voci già in testo, con le
  // chiavi dei `[data-riep]` della vista, e `totali_righe` il totale di ogni riga a prezzo del banco. public/app.js riscrive la pagina da qui.
  const riepilogo = await flusso.riepilogoCarrello(righe);
  res.json({
    ok: true,
    carrello,
    pezzi: contaCarrello(req),
    totali: riepilogo.totali,
    righe: righe.length,
    riepilogo: riepilogo.vista,
    totali_righe: Object.fromEntries(righe.map((r) => [r.prodotto.id, pricing.euro(pricing.round2(pricing.prezzoNetto(r.prodotto) * r.quantita))])),
  });
});

// Dalla posizione del dispositivo all'indirizzo: il carrello (blocco "Carrello: indirizzo di consegna" di public/app.js) ne precompila "Consegna in cantiere".
// Senza una via trovata (o fuori dall'Italia) `indirizzo` è vuoto e il campo resta da scrivere a mano.
app.get('/api/indirizzo', requireRole('cliente'), async (req, res) => {
  const indirizzo = await geo.indirizzoDaPosizione(Number(req.query.lat), Number(req.query.lng));
  res.json({ ok: !!indirizzo, indirizzo: indirizzo || '' });
});

app.post('/carrello', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  // "Procedi" non manda più la richiesta: porta al riepilogo, dove si conferma.
  if (req.body.azione === 'procedi') return res.redirect('/carrello');
  // `ritorno` lo scrive il browser: solo un percorso di questo sito vale (percorsoInterno), mai un indirizzo esterno.
  return res.redirect(percorsoInterno(req.body.ritorno, '/carrello'));
});

// Riepilogo prima di procedere: articoli, quantità, prezzi, destinazione, note, totale da pagare.
// Da qui si paga e parte la richiesta: dopo l'installatore non sceglie più niente.
app.get('/carrello', requireRole('cliente'), async (req, res) => {
  const righe = await righeCarrello(req);
  // Il banco è aperto? Fuori dagli orari impostati nella sua "Anagrafica" il pulsante di pagamento dice quando riapre e non si può premere (lo stesso
  // controllo lo rifà il server al momento di pagare). A carrello vuoto non serve: niente query in più.
  const [riepilogo, statoBanco, cliente] = await Promise.all([
    flusso.riepilogoCarrello(righe),
    righe.length ? richieste.statoBanchiAttivi() : { aperto: true, riapre: null },
    db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id),
  ]);

  // Gli articoli che "Riordina" ha saltato (POST /storico/:id/riordina): l'avviso si mostra una volta sola.
  const saltati = Number(req.session.avvisoCarrello) || 0;
  delete req.session.avvisoCarrello;

  res.render('carrello', {
    titolo: 'Riepilogo',
    // Una chiave nuova a ogni apertura della pagina: identifica l'invio di QUESTO carrello (vedi flusso.chiaveInvioValida).
    chiaveInvio: require('crypto').randomBytes(12).toString('hex'),
    avviso: saltati === 1 ? '1 articolo non è più disponibile' : saltati > 1 ? saltati + ' articoli non sono più disponibili' : '',
    righe,
    bancoChiuso: !statoBanco.aperto,
    fraseBancoChiuso: orari.frasePerCarrello(statoBanco),
    ...riepilogo,
    cliente,
    // Solo a carrello vuoto: la scheda "Il tuo ultimo ordine" con "Rimetti nel carrello" (una lettura sola).
    ultimoOrdine: righe.length ? null : await flusso.ultimoOrdineConsegnato(req.session.user.id),
  });
});

app.post('/carrello/svuota', requireRole('cliente'), async (req, res) => {
  req.session.carrello = {};
  res.redirect('/home');
});

// ---------- Cliente: richiesta di disponibilità ----------

// Indirizzo del sito, per il ritorno da Stripe (3-D Secure e simili): APP_URL nel .env (in produzione, con il dominio
// vero); senza, quello della richiesta (va bene in locale).
function urlBase(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || req.protocol + '://' + req.get('host');
}

// Dove mandare chi ha un errore del flusso (richiesta già aperta, minimo, carrello vuoto, pagamento non disponibile).
function paginaErroreFlusso(res, e, altroLink = null) {
  const link =
    altroLink ||
    (e.codice === 'in_corso' && e.requestId
      ? { link: '/richieste/' + e.requestId, linkTesto: 'Apri la richiesta in corso' }
      : e.codice === 'vuota'
        ? { link: '/home', linkTesto: 'Torna alla home' }
        : { link: '/carrello', linkTesto: 'Torna al riepilogo' });
  return res.status(400).render('errore', { titolo: e.titolo, messaggio: e.message, ...link });
}

// "Paga e invia la richiesta": manda la richiesta ai distributori e apre l'attesa. Il pagamento è simulato, oppure
// (con STRIPE_SECRET_KEY nel .env) Stripe: allora da qui si va alla pagina di pagamento del sito (/pagamento/<id>) e
// la richiesta parte a carta autorizzata. Dal carrello arrivano le quantità visibili in pagina (modo 'imposta'): anche quelle
// scritte a mano e mai salvate, che prima andavano perse e la richiesta partiva con le vecchie.
// La logica del flusso (qui e nelle route sotto) sta in src/flusso_cliente.js, condivisa
// con l'API dell'app.
app.post('/richieste', requireRole('cliente'), async (req, res) => {
  aggiornaCarrelloDaForm(req, req.body && req.body.modo === 'imposta' ? 'imposta' : 'aggiungi');
  let requestId;
  try {
    // Non si invia senza un indirizzo di consegna (la pagina lo precompila dalla posizione, se c'è; altrimenti è vuoto e lo scrive l'installatore).
    const destinazione = String((req.body && req.body.destinazione) || '').trim();
    if (!destinazione) {
      throw new flusso.ErroreFlusso('destinazione', 'Manca l’indirizzo di consegna', 'Scrivi dove consegnare il materiale (via, numero, CAP, città) prima di pagare.');
    }
    // La posizione per il tragitto banco -> installatore è quella di questo indirizzo: le coordinate del dispositivo, se la pagina le ha mandate (indirizzo
    // preso dal pulsante "posizione" accanto al campo), altrimenti quelle dell'indirizzo scritto. Se non si trovano resta l'ultima posizione nota (o la sede provvisoria).
    const posizione = await geo.posizioneDellaDestinazione(destinazione, req.body.dest_lat, req.body.dest_lng);
    if (posizione) await geo.salvaPosizioneCliente(req.session.user.id, posizione.lat, posizione.lng, null);
    // `chiave_invio` è scritta nella pagina del carrello: la stessa pagina dà una richiesta sola, comunque si clicchi.
    const dati = {
      destinazione: req.body && req.body.destinazione,
      note: req.body && req.body.note,
      chiaveInvio: req.body && req.body.chiave_invio,
    };
    if (stripePagamenti.pagaConStripe()) {
      // Con Stripe la richiesta non parte da qui: parte quando la carta è autorizzata (vedi /pagamento/esito, il
      // webhook e il timer). Il carrello si svuota solo allora.
      const pagamentoId = await stripePagamenti.avviaPagamento(req.session.user.id, await righeCarrello(req), dati);
      return res.redirect(303, '/pagamento/' + pagamentoId);
    }
    requestId = await flusso.nuovaRichiesta(req.session.user.id, await righeCarrello(req), dati);
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    // Questo invio ha già dato una richiesta (secondo clic, o "indietro" sulla stessa pagina): si va a quella.
    if (e.codice === 'gia_inviata' && e.requestId) {
      req.session.carrello = {};
      return res.redirect('/richieste/' + e.requestId);
    }
    return paginaErroreFlusso(res, e);
  }
  req.session.carrello = {};
  res.redirect('/richieste/' + requestId);
});

// Cosa fare dopo un tentativo di pagamento (ritorno da Stripe o pagina già pagata): la richiesta è nata -> alla sua
// schermata di attesa; la sta creando qualcun altro -> pagina che si ricarica da sola; carta non autorizzata -> di nuovo
// il form; respinto -> errore con il motivo; altro -> carrello.
function esitoPagamento(req, res, esito) {
  if (esito.esito === 'ok') {
    if (esito.tipo !== 'reinvio') req.session.carrello = {};
    return res.redirect('/richieste/' + esito.requestId);
  }
  if (esito.esito === 'in_corso') return res.render('pagamento_esito', { titolo: 'Pagamento in corso' });
  if (esito.esito === 'da_pagare') return res.redirect('/pagamento/' + esito.id + '?riprova=1');
  if (esito.esito === 'rifiutato') {
    return res.status(400).render('errore', { titolo: esito.titolo, messaggio: esito.messaggio, link: '/carrello', linkTesto: 'Torna al riepilogo' });
  }
  if (esito.esito === 'non_configurato') {
    return res.status(503).render('errore', {
      titolo: 'Pagamento non disponibile',
      messaggio:
        'Il pagamento online non è ancora configurato. Non è stato addebitato nulla.' +
        // Chi sviluppa in locale deve sapere cosa guardare: ai clienti veri non si dice niente delle chiavi.
        (['localhost', '127.0.0.1', '::1'].includes(req.hostname)
          ? ' In locale: controlla le chiavi Stripe nel .env (la pubblicabile deve iniziare con pk_test_) e gli avvisi [stripe] nel log del server.'
          : ''),
      link: '/carrello',
      linkTesto: 'Torna al riepilogo',
    });
  }
  return res.redirect('/carrello'); // annullato o sconosciuto: il cliente è tornato indietro senza pagare
}

// Il cliente torna dal pagamento: da Stripe dopo il 3-D Secure (con ?payment_intent=...) o dal nostro script, subito
// dopo aver pagato senza reindirizzamenti. Se la carta è autorizzata la richiesta nasce adesso, se non è già nata
// (la crea chi arriva primo fra questa pagina, il webhook e il timer).
app.get('/pagamento/esito', requireRole('cliente'), async (req, res) => {
  if (!stripePagamenti.attivo()) return res.redirect('/carrello');
  esitoPagamento(req, res, await stripePagamenti.esitoRitorno(req.query.payment_intent, req.session.user.id));
});

// La pagina di pagamento: riepilogo e form di Stripe (Payment Element, public/pagamento.js). La carta non passa dal
// nostro server. Solo il cliente della riga; se la carta è già autorizzata, si va avanti.
app.get('/pagamento/:id', requireRole('cliente'), async (req, res) => {
  if (!stripePagamenti.attivo()) return res.redirect('/carrello');
  const pagina = await stripePagamenti.preparaPagina(Number(req.params.id), req.session.user.id);
  if (pagina.esito !== 'pagina') return esitoPagamento(req, res, pagina);
  res.render('pagamento', {
    titolo: 'Pagamento',
    ...pagina,
    ritorno: urlBase(req) + '/pagamento/esito',
    minutiRisposta: await pricing.getFinestraMinuti(),
    riprova: req.query.riprova === '1',
    // In sandbox la pagina lo dice (carta di prova, nessun addebito): su un sito pubblico lasciato per sbaglio in prova nessuno deve credere di aver pagato.
    modoProva: pagamenti.modoStripe() === 'test',
  });
});

// La striscia di schede in cima a una pagina di dettaglio del cliente (partials/striscia_ordini.ejs): solo se le voci di "Stato ordini"
// sono due o più E la pagina aperta è una di loro (`voce` = "richiesta-12" o "ordine-7"); altrimenti null (per esempio un ordine
// consegnato aperto dallo storico). Le voci sono quelle già lette dal middleware per l'icona in basso, così icona e striscia dicono
// la stessa cosa; qui si aggiunge solo il materiale (una lettura per tutte).
async function strisciaPer(req, res, voce) {
  const so = res.locals.statoOrdini;
  const voci = so && Array.isArray(so.voci) ? so.voci : [];
  if (!req.session.user || req.session.user.ruolo !== 'cliente' || voci.length < 2) return null;
  if (!voci.some((v) => v.voce === voce)) return null;
  return { voci: await flusso.conBreve(voci), attiva: voce, firma: so.firma || flusso.firmaVoci(voci) };
}

app.get('/richieste/:id', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Richiesta non trovata.' });
  }
  if (richiesta.stato === 'ordinata' && richiesta.order_id) {
    return res.redirect('/ordini/' + richiesta.order_id);
  }
  // Il cliente sta già guardando questa richiesta (schermata di attesa, che si auto-aggiorna):
  // il cambio di stato non deve anche accendere il pallino in basso.
  // dettaglioRichiesta segna lette le notifiche, ma res.locals.ordiniNonLetti è già stato
  // calcolato dal middleware prima di questa route: va azzerato qui, altrimenti questa
  // stessa risposta renderizzerebbe ancora il conteggio vecchio.
  // Dettaglio e materiale della striscia non dipendono uno dall'altro: un solo giro di rete invece di due.
  const [dati, striscia] = await Promise.all([
    flusso.dettaglioRichiesta(richiesta),
    strisciaPer(req, res, 'richiesta-' + richiesta.id),
  ]);
  res.locals.ordiniNonLetti = 0;
  // Una richiesta senza risposta resta in "Stato ordini" per 10 minuti dalla scadenza: se la si sta guardando quando finiscono, la pagina passa da
  // sola a "Stato ordini" (che mostra la prossima attività, o la pagina vuota). 0 = non è più in "Stato ordini" (aperta dallo Storico, o già oltre):
  // nessun passaggio automatico.
  const vista = { titolo: 'Richiesta #' + richiesta.id, striscia, lasciaFra: flusso.secondiAllaScomparsa(richiesta), ...dati };
  if (richiesta.stato === 'in_attesa') return res.render('richiesta_attesa', vista);
  return res.render('richiesta_chiusa', vista);
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
    // Con l'ordine già nato la pagina di attesa porta dritto all'ordine.
    order_id: richiesta.stato === 'ordinata' ? richiesta.order_id : null,
    secondi: await richieste.secondiRimasti(richiesta),
    risposte: risposte.map((r) => ({ nome: r.distributore_nome, esito: r.esito })),
    // "Annulla la richiesta" sparisce appena un banco conferma (anche se il corriere non ha ancora risposto: per l'installatore la ditta
    // risulta ancora "in attesa", ma l'annullamento non è più possibile).
    annullabile: richiesta.stato === 'in_attesa' && !risposte.some((r) => r.bancoConfermato),
  });
});

// Annulla la richiesta: solo in fase 1 (in attesa e nessun banco ha ancora accettato, vedi flusso.annullaRichiesta). Se nel frattempo un banco
// ha confermato, la richiesta resta com'è e si torna alla sua pagina.
app.post('/richieste/:id/annulla', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  if (!(await flusso.annullaRichiesta(richiesta.id))) return res.redirect('/richieste/' + richiesta.id);
  res.redirect('/ordini');
});

app.post('/richieste/:id/reinvia', requireRole('cliente'), async (req, res) => {
  const richiesta = await richieste.getRichiesta(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.session.user.id) return res.redirect('/ordini');
  // Con Stripe il blocco sulla carta è stato rilasciato alla chiusura: per rinviare si autorizza di nuovo, e la
  // richiesta si riapre a pagamento fatto.
  // Se non si può rinviare (banco chiuso fuori orario, richiesta non più rinviabile) si torna alla richiesta, non al carrello.
  const allaRichiesta = { link: '/richieste/' + richiesta.id, linkTesto: 'Torna alla richiesta' };
  if (stripePagamenti.pagaConStripe() && richiesta.stato === 'nessuna_offerta') {
    try {
      return res.redirect(303, '/pagamento/' + (await stripePagamenti.avviaPagamentoReinvio(req.session.user.id, richiesta)));
    } catch (e) {
      if (!(e instanceof flusso.ErroreFlusso)) throw e;
      return paginaErroreFlusso(res, e, allaRichiesta);
    }
  }
  try {
    res.redirect('/richieste/' + (await flusso.reinviaRichiesta(richiesta)));
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    paginaErroreFlusso(res, e, allaRichiesta);
  }
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
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e);
    throw e;
  }
  res.redirect('/home');
});

// `e` è un flusso.OrdineInLavorazione: il cliente non annulla mai un ordine, e nemmeno una richiesta su cui un banco ha già confermato
// (si annulla solo in fase 1). Niente è stato modificato.
function rifiutaEliminazioneOrdine(res, e) {
  const dellOrdine = !!(e.ordine && e.ordine.id);
  return res.status(400).render('errore', {
    titolo: 'Annullamento non possibile',
    messaggio: e.messaggioCliente,
    link: dellOrdine ? '/ordini/' + e.ordine.id : '/richieste/' + e.richiestaId,
    linkTesto: dellOrdine ? "Torna all'ordine" : 'Torna alla richiesta',
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
      // La richiesta sparisce: la carta dell'installatore non deve restare bloccata (o addebitata) per qualcosa che non esiste più.
      // Solo DB (lo esegue il giro di Stripe); no-op se la richiesta era già stata rimborsata o è del vecchio flusso.
      await pagamenti.rimborsa(richiesta.id);
      await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
      await db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
    }
  });
  await elimina();
  res.redirect('/distributore');
});

// ---------- Cliente: ordine ----------

// Non c'è più "riepilogo con il distributore scelto" né "Invia l'ordine": l'installatore paga con la
// richiesta e l'ordine nasce da solo quando il corriere prende la consegna (src/richieste.js).

// "Stato ordini": con una sola attività in corso porta dritto alla sua pagina (richiesta in attesa o ordine in consegna); con due o
// più porta a quella indicata da ?voce=<tipo>-<id> (se è fra le voci) o alla PRIMA, la più urgente: lì, sopra la pagina intera
// dell'ordine, c'è la striscia di schede per passare dall'uno all'altro (partials/striscia_ordini.ejs); senza niente, la pagina
// vuota. Le voci e il loro ordine sono quelli dell'icona in basso (flusso.vociStriscia).
// Solo il link "Stato ordini" della barra in basso, già aggiornato: lo richiede lo script di
// partials/nav_ordini.ejs mentre una richiesta è in attesa o un ordine è in consegna. Dalla home
// (?scheda=1) segue anche la scheda di stato in cima (partials/stato_home.ejs).
app.get('/nav/stato-ordini', requireRole('cliente'), (req, res) => {
  res.render('partials/nav_ordini', {
    attivo: String(req.query.attivo || ''),
    parziale: true,
    conScheda: req.query.scheda === '1',
  });
});

app.get('/ordini', requireRole('cliente'), async (req, res) => {
  const voci = await flusso.vociStriscia(req.session.user.id, { segnaLette: true, breve: false });
  if (voci.length >= 2) {
    const scelta = voci.find((v) => v.voce === String(req.query.voce || ''));
    return res.redirect((scelta || voci[0]).href);
  }
  if (voci.length === 1) return res.redirect(voci[0].href);
  res.render('ordini_cliente', { titolo: 'Stato ordini', minutiRisposta: await pricing.getFinestraMinuti() });
});

// Storico unificato (tutto: in corso, scaduto, annullato, consegnato) — raggiungibile dal
// menu account, non più dal tab "Stato ordini".
// Storico ordini dell'installatore: il materiale ordinato, con i prezzi IVA inclusa, e quanto deve al banco (a BOREA). In app paga
// solo il servizio e la consegna; il calcolo è di src/materiale.js, lo stesso che usa il banco (vedi quel file).
app.get('/storico', requireRole('cliente'), async (req, res) => {
  const materiale = await materialeModulo.materialeOrdini({
    clienteId: req.session.user.id, mese: req.query.mese, vista: req.query.vista,
  });
  res.render('storico', { titolo: 'Storico ordini', materiale });
});

// Lo stesso materiale in CSV (";" e BOM per Excel): solo gli ordini del cliente loggato.
app.get('/storico/materiale.csv', requireRole('cliente'), async (req, res) => {
  const materiale = await materialeModulo.materialeOrdini({ clienteId: req.session.user.id, mese: req.query.mese });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + materialeModulo.nomeFileCsv(materiale) + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(materialeModulo.csvMateriale(materiale));
});

// ---------- Ricevute di pagamento in PDF (src/ricevute.js) ----------
// Solo il cliente proprietario dell'ordine, e solo per un pagamento VERO e incassato (la carta si incassa quando nasce l'ordine): per un blocco annullato,
// una richiesta in attesa o un pagamento simulato non c'è nessuna ricevuta. Il PDF si apre nel browser (inline).
function inviaPdf(res, buffer, nomeFile) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + nomeFile + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

async function ricevutaPdfDellOrdine(req, res, tipo) {
  const dati = await ricevuteModulo.datiRicevuta(Number(req.params.id), { tipo, clienteId: req.session.user.id });
  if (!dati) {
    return res.status(404).render('errore', {
      titolo: 'Ricevuta non disponibile',
      messaggio: tipo === 'rimborso' ? "Per questo ordine non c'è una ricevuta di rimborso." : "Per questo ordine non c'è una ricevuta di pagamento.",
      link: '/ordini/' + req.params.id,
      linkTesto: "Torna all'ordine",
    });
  }
  inviaPdf(res, await ricevuteModulo.pdfRicevute([dati], tipo === 'rimborso' ? 'Ricevuta di rimborso' : 'Ricevuta di pagamento'), ricevuteModulo.nomeFilePdf(dati));
}
app.get('/ordini/:id/ricevuta.pdf', requireRole('cliente'), (req, res) => ricevutaPdfDellOrdine(req, res, 'pagamento'));
app.get('/ordini/:id/ricevuta-rimborso.pdf', requireRole('cliente'), (req, res) => ricevutaPdfDellOrdine(req, res, 'rimborso'));

// "Ricevute del mese" dello Storico: un solo PDF con una pagina per ricevuta, per gli ordini del mese (?mese=AAAA-MM, o "tutto") che hanno un pagamento
// incassato, dal più vecchio. Le stesse regole dello Storico per il mese: valore mancante o sbagliato = il mese corrente (o il più recente).
app.get('/storico/ricevute.pdf', requireRole('cliente'), async (req, res) => {
  const clienteId = req.session.user.id;
  const materiale = await materialeModulo.materialeOrdini({ clienteId, mese: req.query.mese });
  const idOrdini = materiale.gruppi.flatMap((g) => g.ordini).filter((o) => o.ricevuta).map((o) => o.id).sort((a, b) => a - b);
  // Poche letture alla volta: ogni ricevuta ne fa alcune, e un mese può avere molti ordini.
  const elenco = [];
  for (let i = 0; i < idOrdini.length; i += 5) {
    const dati = await Promise.all(idOrdini.slice(i, i + 5).map((id) => ricevuteModulo.datiRicevuta(id, { tipo: 'pagamento', clienteId })));
    elenco.push(...dati.filter(Boolean));
  }
  if (!elenco.length) {
    return res.status(404).render('errore', {
      titolo: 'Nessuna ricevuta',
      messaggio: 'In questo periodo non ci sono ricevute di pagamento.',
      link: '/storico?mese=' + encodeURIComponent(materiale.mese),
      linkTesto: 'Torna allo storico',
    });
  }
  inviaPdf(res, await ricevuteModulo.pdfRicevute(elenco, 'Ricevute ' + materiale.mese), `ricevute-${materiale.mese}.pdf`);
});

// "Riordina" (solo sulle schede "Consegnato"): rimette nel carrello gli stessi articoli dell'ordine, sommati a
// quelli già presenti, e porta al carrello. Gli articoli tolti dal catalogo o non più disponibili si saltano:
// il carrello lo dice con un avviso (letto una volta sola da GET /carrello).
app.post('/storico/:id/riordina', requireRole('cliente'), async (req, res) => {
  const daRiordinare = await flusso.articoliDaRiordinare(req.session.user.id, req.params.id);
  if (!daRiordinare) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  if (daRiordinare === 'altrui') {
    return res.status(403).render('errore', { titolo: 'Accesso negato', messaggio: 'Accesso non consentito.' });
  }
  const carrello = getCarrello(req);
  for (const { id, quantita } of daRiordinare.articoli) {
    carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + quantita);
  }
  if (daRiordinare.saltati) req.session.avvisoCarrello = daRiordinare.saltati;
  res.redirect('/carrello');
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
  const eCliente = req.session.user.ruolo === 'cliente';
  // Le due notifiche segnate lette, il dettaglio e il materiale della striscia non dipendono uno dall'altro: partono insieme
  // (questa pagina si apre a ogni passaggio fra gli ordini di "Stato ordini", e ogni lettura in fila è un giro di rete).
  const [, , dettaglio, striscia] = await Promise.all([
    eCliente ? notifiche.segnaLetteCategoria(req.session.user.id, 'ordini') : null,
    eCliente ? notifiche.segnaLetteCategoria(req.session.user.id, 'richieste') : null,
    flusso.dettaglioOrdine(ordine),
    strisciaPer(req, res, 'ordine-' + ordine.id),
  ]);
  if (eCliente) {
    res.locals.ordiniNonLetti = 0;
    // Il cliente vede la ditta, non la filiale; banchi e agente sì (da dove parte il pacco).
    dettaglio.distributore = flusso.senzaFiliale(dettaglio.distributore);
  }
  res.render('ordine_dettaglio', {
    titolo: 'Ordine #' + ordine.id,
    ordine,
    // Quando il corriere arriva dal banco (il tempo scritto su WhatsApp): è l'unico orario del corriere che vede il banco.
    ritiroCorriere: orariCorriere.ritiro(ordine),
    nuovo: req.query.nuovo === '1',
    striscia,
    ...dettaglio,
  });
});

app.post('/ordini/:id/consegnato', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  await flusso.segnaConsegnato(ordine);
  // Come per la rotta provvisoria qui sotto: dopo "Ordine consegnato" si va in "Stato ordini".
  res.redirect('/ordini');
});

// PROVVISORIO: "Consegnato" cliccabile sulla scheda della home, per non mostrare più l'ordine in consegna.
// Vale per qualunque stato dell'ordine (vedi flusso.segnaConsegnatoProva); da togliere quando la consegna
// verrà segnata da un evento vero.
app.post('/ordini/:id/consegnato-prova', requireRole('cliente'), async (req, res) => {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.session.user.id) {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  await flusso.segnaConsegnatoProva(ordine);
  // Dopo "Ordine consegnato" si va in "Stato ordini" (richiesta esplicita del 15/10/2026), non sulla pagina dell'ordine né in
  // catalogo: lì c'è l'altro ordine in corso, se c'è, altrimenti la pagina "nessun ordine in corso". L'ordine appena chiuso si
  // rivede dallo Storico. (Il pulsante sta solo nella pagina dell'ordine.)
  res.redirect('/ordini');
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
    if (e instanceof flusso.OrdineInLavorazione) return rifiutaEliminazioneOrdine(res, e);
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
    // L'ordine sparisce, ma l'installatore ha già pagato la consegna (con Stripe la carta è anche già stata incassata): il pagamento
    // gli torna (solo DB; lo esegue il giro di Stripe). Senza questa riga spariva l'ordine e restava addebitato.
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

// Notifiche non ancora mostrate: app.js le trasforma in notifica push del browser e, per il banco, in avvisi a comparsa. Al banco ogni notifica porta
// anche `tipo`, `request_id`, `order_id` e i dati del suo avviso (src/banco_avvisi.js: la richiesta con i secondi che mancano, il corriere...).
app.get('/api/notifiche/push', requireLogin, async (req, res) => {
  const utente = req.session.user;
  const alBanco = utente.ruolo === 'distributore' && utente.distributor_id;
  // Cliente e agente: solo le notifiche degli ultimi 10 minuti (le vecchie si segnano e basta). Il banco le riceve tutte e filtra da sé.
  const nuove = await notifiche.daMostrare(utente.id, alBanco ? {} : { massimoEtaSec: 600 });
  res.json({ notifiche: alBanco ? await bancoAvvisi.arricchisciPush(utente.distributor_id, nuove) : nuove });
});

// "Attiva" gli avvisi sul telefono: le notifiche già presenti sono storia, non devono arrivare tutte insieme.
app.post('/api/notifiche/attiva', requireLogin, async (req, res) => {
  await notifiche.segnaTutteNotificate(req.session.user.id);
  res.json({ ok: true });
});

// ---------- Notifiche ad app chiusa (Web Push, src/web_push.js) ----------

const ERRORI_PUSH = {
  spente: 'Le notifiche ad app chiusa non sono attive su questo server.',
  non_valida: 'Iscrizione del browser non valida.',
  tabella: 'Le notifiche ad app chiusa non sono ancora pronte su questo server.',
};

// Il browser si è iscritto al servizio push (public/app.js, "Notifiche anche ad app chiusa"): si salva e si ricorda in sessione, così la pagina sa che il server
// ha già questo browser (meta push-endpoint) e il logout sa quale iscrizione togliere.
app.post('/api/push/iscrivi', requireLogin, async (req, res) => {
  const esito = await webPush.registra(req.session.user.id, req.body && req.body.subscription, { userAgent: req.get('user-agent') });
  if (!esito.ok) return res.status(esito.motivo === 'non_valida' ? 400 : 503).json({ ok: false, errore: ERRORI_PUSH[esito.motivo] || ERRORI_PUSH.spente });
  req.session.pushEndpoint = esito.endpoint;
  res.json({ ok: true });
});

// Il browser non vuole più le notifiche (interruttore spento) o si è disiscritto.
app.post('/api/push/disiscrivi', requireLogin, async (req, res) => {
  const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : '';
  if (endpoint) await webPush.rimuovi(endpoint, req.session.user.id);
  if (!endpoint || req.session.pushEndpoint === endpoint) delete req.session.pushEndpoint;
  res.json({ ok: true });
});

// Notifica di prova ("Prova" nella scheda Sul telefono): passa dal server come una vera, quindi prova anche l'app chiusa. `dopoSec` (0-30) lascia il tempo di
// chiudere l'app prima che arrivi. Al massimo una ogni 10 secondi per utente.
const provePush = new Map();
app.post('/api/push/prova', requireLogin, async (req, res) => {
  const utenteId = req.session.user.id;
  const ultima = provePush.get(utenteId) || 0;
  if (Date.now() - ultima < 10000) return res.status(429).json({ ok: false, errore: 'Aspetta qualche secondo prima di riprovare.' });
  provePush.set(utenteId, Date.now());
  const dopoSec = Math.min(30, Math.max(0, Math.floor(Number(req.body && req.body.dopoSec) || 0)));
  if (!webPush.attivo()) return res.status(503).json({ ok: false, errore: ERRORI_PUSH.spente });
  const iscrizioni = await webPush.iscrizioniDi(utenteId);
  if (!iscrizioni.length) return res.status(409).json({ ok: false, errore: 'Nessun dispositivo iscritto: attiva prima le notifiche.' });
  if (dopoSec > 0) {
    setTimeout(() => webPush.inviaProva(utenteId).catch(() => {}), dopoSec * 1000).unref();
    return res.json({ ok: true, dopoSec });
  }
  const inviate = await webPush.inviaProva(utenteId);
  if (!inviate) return res.status(502).json({ ok: false, errore: 'Il servizio di notifiche del telefono non ha accettato il messaggio.' });
  res.json({ ok: true, inviate });
});

// Un avviso a comparsa del banco, aperto o chiuso, risulta letto (public/app.js, "Avvisi del banco"): il browser manda gli id delle notifiche e, perché un avviso
// sopravvive alle ricariche della pagina (che ne perdono gli id), le richieste e gli ordini a cui si riferisce.
app.post('/api/notifiche/lette', requireLogin, async (req, res) => {
  await notifiche.segnaLettePerId(req.session.user.id, req.body.ids, { richieste: req.body.richieste, ordini: req.body.ordini });
  res.json({ ok: true });
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
  return (await letturaBanco(distributorId)).contatori;
}

// I contatori e, nella stessa lettura (nessuna query in più), quanto manca alla prima richiesta da confermare: la striscia arancio sotto
// l'intestazione (partials/banco_avviso.ejs) lo scrive già al primo disegno, senza aspettare il browser. `primaScadeSec` NON sta nei contatori:
// cambia a ogni secondo, e i contatori finiscono in data-versione (la pagina si ricarica se cambiano).
async function letturaBanco(distributorId) {
  // Prima erano 5 query separate, una dopo l'altra (await in sequenza): eseguita ad ogni
  // singola pagina vista da un distributore, sommava 5 andate e ritorno verso il DB dove
  // ne bastava una per gli ordini (con FILTER) più altre due, tutte e tre in parallelo.
  const [ordini, daRispondereRow, daApprovareRow] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE stato = 'inviato' AND consegnato_il IS NULL) AS da_preparare,
         COUNT(*) FILTER (WHERE stato = 'in_evasione') AS in_preparazione,
         COALESCE(MAX(id), 0) AS ultimo
         FROM orders WHERE distributor_id = ?`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()) AS n,
              COALESCE(MAX(r.id) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()), 0) AS ultima,
              COUNT(*) FILTER (WHERE rr.corriere_stato = 'in_attesa') AS attesa_corriere,
              MIN(EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()) AS prima_scade
         FROM request_responses rr JOIN requests r ON r.id = rr.request_id
        WHERE rr.distributor_id = ?
          AND ((rr.esito = 'in_attesa' AND r.scade_il > NOW()) OR rr.corriere_stato = 'in_attesa')`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) AS n FROM client_distributors WHERE distributor_id = ? AND stato = 'in_attesa'`
    ).get(distributorId),
  ]);
  return {
    contatori: {
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
    },
    primaScadeSec: daRispondereRow.prima_scade === null || daRispondereRow.prima_scade === undefined ? null : Math.max(0, Number(daRispondereRow.prima_scade)),
  };
}

// Controllo leggero per le pagine del banco (public/app.js, data-versione): restituisce gli stessi
// numeri che la pagina ha ricevuto, e il browser si ricarica solo se sono cambiati.
app.get('/api/distributore/novita', requireRole('distributore'), (req, res) => {
  res.json(res.locals.contatori || {});
});

// I numeri della striscia arancio e del pallino su "Banco" (partials/banco_avviso.ejs, public/app.js "Avvisi del banco"): richieste da confermare e quanto manca
// alla prima, più l'elenco di quelle ancora aperte (con cliente, pezzi e scadenza) per tenere allineati gli avvisi "Nuova richiesta". Il browser la chiede ogni 15 s e
// subito quando arriva una notifica nuova.
app.get('/distributore/stato-banco', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  res.set('Cache-Control', 'no-store');
  if (!distributorId) return res.json({ daConfermare: 0, primaScadeSec: null, attesaCorriere: 0, daPreparare: 0, richieste: [] });
  res.json(await bancoAvvisi.statoBanco(distributorId, res.locals.contatori || {}));
});

// Soglie dei tempi della home del banco. Passano alla pagina come data-soglia-* (views/distributore_richieste.ejs):
// il server disegna le classi iniziali e lo script di public/app.js le aggiorna ogni secondo con gli stessi numeri.
const BACHECA = {
  urgenteSec: 180, // richiesta da confermare: negli ultimi 3 minuti anello e timer diventano rossi
  nuovaSec: 180, // ...e per i primi 3 minuti ha l'etichetta "Nuova"
  appenaSec: 20, // arrivata da meno di 20 secondi: la scheda entra con un'animazione
  arrivoVicinoMin: 15, // ordine da preparare: sotto i 15 minuti al corriere la pillola è rossa
  righeVisibili: 3, // articoli mostrati su una scheda, gli altri sono "+N altri articoli"
};

// Articoli di una scheda: conteggi per la riga "2 articoli · 3 pezzi" e le prime righe da mostrare.
function riassuntoArticoli(righe) {
  return {
    nArticoli: righe.length,
    nPezzi: righe.reduce((somma, r) => somma + Number(r.quantita || 0), 0),
    anteprima: righe.slice(0, BACHECA.righeVisibili),
    altre: Math.max(0, righe.length - BACHECA.righeVisibili),
  };
}

// Home del banco: bacheca a tre colonne, nell'ordine in cui passa una richiesta.
//   Da confermare   richieste arrivate al banco, con la finestra di risposta ancora aperta
//   Attesa corriere richieste confermate dal banco; nel gruppo WhatsApp nessun corriere ha ancora preso la consegna
//   Da preparare    ordini nati (consegna presa, o banco che ha accettato a modulo spento) non ancora presi in carico
// Il banco riceve sempre: non c'è più una pausa della ricezione.
app.get('/distributore', requireRole('distributore'), async (req, res) => {
  // Niente più sweep completo di tutte le richieste aperte del sistema ad ogni apertura
  // pagina (era una scansione system-wide, non solo di questo distributore): ci pensa già
  // il job periodico ogni 30s, e la singola richiesta si autoaggiorna quando la si apre
  // (vedi GET /distributore/richieste/:id).
  const distributorId = req.session.user.distributor_id;

  // Letture indipendenti: partono insieme (col DB su un altro server ogni query in sequenza costa ~50 ms).
  const [aperte, ordiniDaPreparare, minutiRisposta, contatori] = await Promise.all([
    // Le due colonne "di richiesta" in una query sola. Le colonne TIMESTAMP (risposto_il) sono ora UTC senza
    // fuso: si confrontano con NOW() in SQL, mai con un Date di JS.
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
    // Il banco vede solo il tempo scritto dal corriere su WhatsApp: quando arriva da lui (corriere_risposto_il + corriere_minuti, src/corriere.js; TIMESTAMPTZ,
    // un istante vero). I secondi che mancano si calcolano in SQL.
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

  // Gli articoli di tutte le schede si leggono insieme (una query per le richieste, una per gli ordini), non
  // una per scheda.
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

// Storico ordini del banco: la lista di tutti gli ordini della filiale, con filtri per stato e periodo, ricerca e
// paginazione. Sta tutto nell'URL (?stato=&periodo=&q=&pagina=), vedi src/storico_banco.js. Prende il posto di "Tutti gli
// ordini" (/distributore/ordini, che ora rimanda qui) e dello "Storico richieste".
app.get('/distributore/storico', requireRole('distributore'), async (req, res) => {
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

// Il dettaglio di una riga dello Storico: un frammento HTML (views/partials/storico_dettaglio.ejs) che la pagina carica al primo clic sulla riga e mette
// sotto di essa (public/app.js, "Storico ordini: righe che si aprono"): materiale a prezzo del banco, "Come è andata" e i pulsanti. Solo ordini del banco loggato.
// SOLA LETTURA: non chiama prendiInCarico né scrive niente, qualunque sia lo stato dell'ordine (aprire il dettaglio non lo cambia). `torna` (la pagina dello
// Storico com'è adesso, scritta dallo script) vale solo se è una pagina del banco (ritornoBanco): il pulsante "Apri ordine completo" la porta con sé,
// con l'ancora #o<id> della riga, così la freccia della pagina dell'ordine riporta allo Storico con la stessa voce aperta.
app.get('/distributore/storico/:id/dettaglio', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.status(404).type('text/plain').send('Ordine non trovato.');
  const dettaglio = await storicoDettaglio.leggiDettaglio(ordine);
  const torna = ritornoBanco(req.query.torna, '/distributore/storico').split('#')[0];
  res.render('partials/storico_dettaglio', { ...dettaglio, tornaStorico: torna + '#o' + ordine.id });
});

// Dettaglio di una richiesta al banco: a sinistra il materiale (tabella con listino, prezzo cliente e totale) e i passi dopo la
// conferma, a destra cosa fare (timer e pulsanti, oppure lo stato dopo la risposta), il cliente e "Elimina dal banco".
// Lo stato, la tabella e i passi si preparano in src/richiesta_banco.js; la vista (views/distributore_dettaglio.ejs) disegna.
app.get('/distributore/richieste/:id', requireRole('distributore'), async (req, res) => {
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
  const [cliente, offerta, distributore, ordine, secondi, minutiRisposta, legameCliente] = await Promise.all([
    db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id),
    richieste.calcolaOfferta(richiesta.id, distributorId),
    db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId),
    richiesta.order_id ? db.prepare('SELECT * FROM orders WHERE id = ?').get(richiesta.order_id) : null,
    richieste.secondiRimasti(richiesta),
    pricing.getFinestraMinuti(),
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

  // Quando l'ordine è "Da preparare" (un corriere ha accettato, o non ce n'è bisogno) la richiesta non ha più una sua pagina: si va dritti a quella dell'ordine
  // (materiale, ritiro del corriere, "Preparato"). Anche la pagina in attesa del corriere, che si ricarica da sola, arriva qui. La freccia dell'ordine riporta da dove
  // si era partiti (`daDove`: la home se non c'è), non alla richiesta.
  if (stato.chiave === 'da_preparare') return res.redirect(conRitorno('/distributore/ordini/' + ordine.id, daDove));

  const conCorriere = whatsapp.attivo();
  // "confermata alle 21:05" (ora italiana): solo se il banco ha confermato.
  const oraConferma = risposta.esito === 'confermato' && risposta.risposto_il ? format.oraSolaRoma(risposta.risposto_il) : null;

  res.render('distributore_dettaglio', {
    titolo: 'Richiesta #' + richiesta.id,
    // Non si chiama `indietro`: l'intestazione del banco (partials/banco_testa), inclusa dalla vista, ne disegnerebbe un'altra freccia.
    paginaPrecedente: daDove || '/distributore',
    minutiRisposta,
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
    // Da confermare: "Cosa succede dopo la conferma" (siamo al primo passo). In attesa del corriere: "Avanzamento", con la
    // conferma fatta e, se il modulo WhatsApp è acceso, il passo dei corrieri in corso.
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
    // finché non saranno calcolati dal corriere collegato via API. Non si leggono dal corpo della richiesta: la pagina non li
    // manda più, e un valore enorme scritto a mano finiva in una colonna intera ("out of range", 500).
    partenza_ore: 2,
    consegna_ore: 6,
  });

  // "Conferma" dall'avviso a comparsa (public/app.js, "Avvisi del banco") risponde senza lasciare la pagina: chiede JSON e lo riceve, niente redirect.
  if (vuoleJson(req)) return res.status(esitoRisposta.ok ? 200 : 409).json({ ok: !!esitoRisposta.ok, errore: esitoRisposta.ok ? null : esitoRisposta.errore });

  const base = '/distributore/richieste/' + req.params.id;
  if (!esitoRisposta.ok) return res.redirect(base + '?errore=' + encodeURIComponent(esitoRisposta.errore));
  res.redirect(req.body.torna === 'home' ? '/distributore' : base);
});

// ---------- Distributore: anagrafiche clienti da approvare ----------

// ---------- Anagrafica del banco ----------
// Pagina (richiesta esplicita del 20/10/2026) con le schede Ditta, Questa filiale, Orari, Accesso e Notifiche: logica in src/anagrafica_banco.js e
// src/orari.js, presentazione in views/distributore_anagrafica.ejs. Un solo profilo con tutti i permessi: ogni utente del banco vede e cambia le stesse cose.
// Ogni scheda ha il suo POST: con errori la pagina si ripropone (400) con la scheda aperta, i valori scritti e gli errori sotto i campi; con il salvataggio
// si torna alla pagina (`?ok=<scheda>`), che lo conferma.
const SCHEDE_ANAGRAFICA = ['ditta', 'filiale', 'orari', 'password'];
const SALVATI_ANAGRAFICA = ['ditta', 'filiale', 'orari', 'password'];

async function paginaAnagraficaBanco(req, res, extra = {}) {
  const dati = extra.dati || (await anagraficaBanco.leggi(req.session.user.distributor_id, req.session.user.id));
  if (!dati) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Banco non trovato.' });
  res.status(extra.stato || 200).render('distributore_anagrafica', {
    titolo: 'Anagrafica del banco',
    dati,
    anagraficaBanco,
    orari,
    // Quale scheda è aperta in modifica: quella con gli errori, o quella chiesta con ?modifica= (anche senza JavaScript).
    aperta: extra.aperta !== undefined ? extra.aperta : (SCHEDE_ANAGRAFICA.includes(req.query.modifica) ? req.query.modifica : null),
    valori: extra.valori || {},
    errori: extra.errori || {},
    ok: SALVATI_ANAGRAFICA.includes(req.query.ok) ? req.query.ok : '',
    riassuntoOrari: orari.riassunto(dati.orari),
    moduloOrari: extra.moduloOrari || orari.valoriPerModulo(dati.orari),
    // Senza orari salvati la casella "sempre aperto" parte spuntata (i giorni mostrano solo una proposta, spenta).
    sempreAperto: extra.sempreAperto !== undefined ? extra.sempreAperto : !dati.orari,
    // La riga "Email per ogni nuova richiesta" c'è solo quando esiste l'invio vero (email.inviaNuovaRichiesta): oggi manca e la riga resta nascosta.
    emailRichieste: typeof emailModulo.inviaNuovaRichiesta === 'function',
  });
}

app.get('/distributore/anagrafica', requireRole('distributore'), (req, res) => paginaAnagraficaBanco(req, res));

app.post('/distributore/anagrafica/ditta', requireRole('distributore'), async (req, res) => {
  const idBanco = req.session.user.distributor_id;
  const dati = await anagraficaBanco.leggi(idBanco, req.session.user.id);
  if (!dati) return paginaAnagraficaBanco(req, res, { dati });
  const { valori, errori } = anagraficaBanco.controllaDitta(req.body, { conDitta: dati.conDitta });
  if (Object.keys(errori).length) {
    return paginaAnagraficaBanco(req, res, { dati, stato: 400, aperta: 'ditta', valori: { ditta: valori }, errori: { ditta: errori } });
  }
  await anagraficaBanco.salvaDitta(idBanco, valori);
  rileggiIntestazioneBanco(idBanco);
  res.redirect('/distributore/anagrafica?ok=ditta#ditta');
});

app.post('/distributore/anagrafica/filiale', requireRole('distributore'), async (req, res) => {
  const idBanco = req.session.user.distributor_id;
  const dati = await anagraficaBanco.leggi(idBanco, req.session.user.id);
  if (!dati) return paginaAnagraficaBanco(req, res, { dati });
  const { valori, errori } = anagraficaBanco.controllaFiliale(req.body);
  const riproponi = (e) => paginaAnagraficaBanco(req, res, { dati, stato: 400, aperta: 'filiale', valori: { filiale: valori }, errori: { filiale: e } });
  if (Object.keys(errori).length) return riproponi(errori);
  // La posizione sulla mappa è fissa (quella del DB): cambiare l'indirizzo non la tocca.
  const esito = await anagraficaBanco.salvaFiliale(idBanco, valori);
  if (!esito.ok) return riproponi(esito.errori);
  rileggiIntestazioneBanco(idBanco);
  res.redirect('/distributore/anagrafica?ok=filiale#filiale');
});

app.post('/distributore/anagrafica/orari', requireRole('distributore'), async (req, res) => {
  const idBanco = req.session.user.distributor_id;
  const letti = orari.orariDaModulo(req.body);
  if (letti.errore || Object.keys(letti.errori).length) {
    const dati = await anagraficaBanco.leggi(idBanco, req.session.user.id);
    return paginaAnagraficaBanco(req, res, {
      dati, stato: 400, aperta: 'orari', moduloOrari: letti.valori, sempreAperto: false,
      errori: { orari: { ...letti.errori, _generale: letti.errore } },
    });
  }
  await anagraficaBanco.salvaOrari(idBanco, letti.orari); // null = sempre aperto
  res.redirect('/distributore/anagrafica?ok=orari#orari');
});

// Cambio password: i tentativi con la password attuale sbagliata contano nello stesso limite del login (chi ha rubato una sessione non deve poterla
// indovinare qui). Dopo il cambio le altre sessioni dello stesso utente si chiudono (anagraficaBanco.cambiaPassword).
app.post('/distributore/anagrafica/password', requireRole('distributore'), async (req, res) => {
  const chiaveLimite = 'cambio-password:' + String(req.session.user.username || req.session.user.id);
  const riproponi = (stato, errori) => paginaAnagraficaBanco(req, res, { stato, aperta: 'password', errori: { password: errori } });
  if (accessoBloccato(req, chiaveLimite)) return riproponi(429, { attuale: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  const esito = await anagraficaBanco.cambiaPassword(req.session.user.id, req.sessionID, req.body);
  if (!esito.ok) {
    if (esito.passwordSbagliata) registraAccessoFallito(req, chiaveLimite);
    return riproponi(400, esito.errori);
  }
  accessoRiuscito(req, chiaveLimite);
  res.redirect('/distributore/anagrafica?ok=password#accesso');
});

// L'interruttore "Email per ogni nuova richiesta" salva subito (fetch).
app.post('/distributore/anagrafica/email-richieste', requireRole('distributore'), async (req, res) => {
  await anagraficaBanco.salvaEmailNuoveRichieste(req.session.user.distributor_id, req.body.acceso === true || req.body.acceso === '1' || req.body.acceso === 1);
  res.json({ ok: true });
});

app.get('/distributore/clienti', requireRole('distributore'), async (req, res) => {
  // Una query sola, con l'ultimo ordine di ogni cliente (`ultimo_ordine`). Ordine per ragione sociale fatto qui, senza
  // badare alle maiuscole: quello del DB dipende dalla collazione.
  const elenco = await anagrafiche.clientiDelDistributore(req.session.user.distributor_id);
  const perNome = (a, b) => String(a.ragione_sociale).localeCompare(String(b.ragione_sociale), 'it', { sensitivity: 'base' });
  const conStato = (stato) => elenco.filter((c) => c.stato === stato).sort(perNome);
  res.render('distributore_clienti', {
    titolo: 'Clienti',
    daApprovare: conStato('in_attesa'),
    approvati: conStato('approvato'),
    rifiutati: conStato('rifiutato'),
    tipi: anagrafiche.TIPI_SOGGETTO,
  });
});

// Il materiale del cliente in CSV (stessi numeri della scheda "Materiale ordinato", ";" e BOM per Excel): solo per un cliente approvato
// di questo banco.
app.get('/distributore/clienti/:id/materiale.csv', requireRole('distributore'), async (req, res) => {
  const distributorId = req.session.user.distributor_id;
  const cliente = await db.prepare(`SELECT * FROM users WHERE id = ? AND ruolo = 'cliente'`).get(req.params.id);
  const rapporto = cliente ? await anagrafiche.legame(distributorId, cliente.id) : null;
  if (!cliente || !rapporto || rapporto.stato !== 'approvato') {
    return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Cliente non trovato.' });
  }
  const materiale = await materialeModulo.materialeCliente(distributorId, cliente.id, { mese: req.query.mese });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + materialeModulo.nomeFileCsvCliente(cliente.ragione_sociale, materiale.mese) + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(materialeModulo.csvMaterialeCliente(materiale));
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

  // Solo per i clienti approvati: TUTTI gli ordini fatti a questo banco, col materiale e i prezzi IVA inclusa (src/materiale.js,
  // gli stessi numeri dello Storico dell'installatore). Il filtro del mese e la vista (per ordine / per articolo) stanno nell'URL.
  const materiale = rapporto.stato === 'approvato'
    ? await materialeModulo.materialeCliente(distributorId, cliente.id, {
        mese: req.query.mese,
        vista: req.query.vista,
        ditta: res.locals.bancoTesta ? res.locals.bancoTesta.nome : '',
      })
    : null;

  res.render('distributore_cliente', {
    titolo: cliente.ragione_sociale,
    cliente,
    rapporto,
    materiale,
    tipi: anagrafiche.TIPI_SOGGETTO,
    indirizzoCliente: format.indirizzoCompleto(cliente),
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

// ---------- Distributore: ordini ricevuti e preparazione ----------

// La lista degli ordini è lo Storico ordini: i vecchi link (e i segnalibri) arrivano lì, con la loro query string.
// Solo la lista: il dettaglio /distributore/ordini/:id resta com'è.
app.get('/distributore/ordini', requireRole('distributore'), (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect(301, '/distributore/storico' + (i === -1 ? '' : req.originalUrl.slice(i)));
});

// Carica un ordine verificando che appartenga al banco loggato.
async function ordineDelBanco(req) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) return null;
  return ordine;
}

// Segna l'ordine come preparato dal banco (stato 'inviato' -> 'in_evasione': per il banco passa da "Da preparare" a "In consegna") e avvisa il
// cliente. Scatta SOLO con "Preparato" (POST .../preparazione, dalla card in home e dalla pagina dell'ordine): aprire la pagina dell'ordine non lo prende
// in carico. Agisce solo su 'inviato': un ordine già partito (in_evasione, evaso) o consegnato resta com'è, anche se qualcuno chiama di nuovo "Preparato"
// da una pagina rimasta aperta.
async function prendiInCarico(ordine) {
  if (ordine.stato !== 'inviato') return ordine;
  await db.prepare(
    `UPDATE orders SET stato = 'in_evasione', in_evasione_il = NOW(), preso_in_carico_il = NOW()
      WHERE id = ?`
  ).run(ordine.id);
  // Il nome della ditta come lo vede l'installatore ("BOREA"); un guasto nella lettura non deve fermare "Preparato".
  const dittaOrdine = ordine.distributor_id
    ? await db.prepare('SELECT nome FROM distributors WHERE id = ?').get(ordine.distributor_id).catch(() => null)
    : null;
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Ordine in preparazione',
    testo: `Ordine #${ordine.id} — ${format.nomeCommerciale(dittaOrdine && dittaOrdine.nome) || 'Il banco'} sta preparando il tuo materiale.`,
    link: '/ordini/' + ordine.id,
    categoria: 'ordini',
    order_id: ordine.id,
  });
  return { ...ordine, stato: 'in_evasione', in_evasione_il: new Date(), preso_in_carico_il: new Date() };
}

// La pagina dell'ordine vista dal banco (views/distributore_ordine.ejs, src/ordine_banco.js): materiale, consegna, cliente, avanzamento e, a destra, quello che serve
// in quello stato. Si adatta allo stato (storicoBanco.statoStorico, lo stesso della lista dello Storico), e "Apri ordine completo" dello Storico funziona per tutti:
//  · Da preparare: il ritiro del corriere con il conto alla rovescia (il tempo scritto dal corriere su WhatsApp) e il pulsante "Preparato", "Elimina ordine";
//  · In consegna (dopo "Preparato"): la scheda "In consegna" (partito, ritiro del corriere, corriere);
//  · Consegnato: la scheda "Consegnato" (quando, tempo di consegna).
// SOLA LETTURA in ogni stato: aprirla non cambia l'ordine. In particolare un ordine già partito o consegnato non si tocca: prendiInCarico (che lo porterebbe
// a 'in_evasione') non si chiama da qui, e comunque agisce solo su 'inviato' (vedi sotto). Prova: test "banco: pagina dell'ordine in consegna e consegnato...".
app.get('/distributore/ordini/:id', requireRole('distributore'), async (req, res) => {
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
app.post('/distributore/ordini/:id/preparazione', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/storico');
  await prendiInCarico(ordine);
  if (req.body.torna === 'home') return res.redirect('/distributore');
  res.redirect(conRitorno('/distributore/ordini/' + ordine.id, ritornoBanco(req.body.torna, '')));
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
// Vanno registrati dopo tutte le rotte (Express riconosce l'error-handler dai 4 parametri), quindi
// restano qui in fondo. Per /api/... rispondono in JSON, per il resto con la pagina `errore`; gli errori
// del client (JSON malformato, corpo troppo grande) tengono il loro 4xx. Vedi src/http.js.
app.use(gestoreNonTrovato);
app.use(gestoreErrori);

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
// Un solo giro alla volta: se il DB è lento e uno dura più di 30 s, il successivo aspetta invece di
// sovrapporsi (le scritture sono atomiche, ma due giri insieme raddoppiano inutilmente il carico).
let controlloScadenzeInCorso = false;
async function controllaScadenze() {
  if (controlloScadenzeInCorso) return;
  controlloScadenzeInCorso = true;
  try {
    // Chiude le finestre scadute (rimborso) e riprova gli ordini rimasti a metà (vedi assegnaOrdine).
    await richieste.aggiornaScadenzeAperte();
    // Incassi, rilasci e rimborsi su Stripe rimasti da fare (vedi src/stripe_pagamenti.js): senza chiave non fa niente.
    await stripePagamenti.elabora();
  } catch (err) {
    console.error('Errore nel controllo scadenze:', err.message);
  } finally {
    controlloScadenzeInCorso = false;
  }
}
controllaScadenze();
setInterval(controllaScadenze, 30 * 1000).unref();

// Stripe acceso ma con il .env incompleto: meglio dirlo subito che al primo cliente.
if (stripePagamenti.attivo()) console.log('[stripe] ' + stripePagamenti.descrizioneModo());
for (const avviso of stripePagamenti.controllaConfigurazione()) console.warn('[stripe] ' + avviso);
console.log(webPush.descriviConfigurazione());

// Gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/whatsapp.js).
whatsapp.avvia();

// Su quale indirizzo ascolta: di default solo sul computer stesso (127.0.0.1), che sulla VPS basta e avanza (davanti c'è
// il proxy). In locale, per aprire il sito dal telefono sulla stessa rete Wi-Fi, si mette HOST=0.0.0.0 nel .env.
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    // Gli indirizzi con cui lo raggiunge il telefono (IPv4 delle schede di rete, escluse quelle virtuali di loopback).
    for (const schede of Object.values(require('os').networkInterfaces())) {
      for (const s of schede || []) {
        if (s.family === 'IPv4' && !s.internal) console.log(`  dalla rete locale: http://${s.address}:${PORT}`);
      }
    }
  }
});

// pm2 (e Ctrl+C in locale) chiedono la chiusura con un segnale: si smette di accettare richieste nuove e
// si lascia finire quelle in corso, invece di troncarle a metà (un ordine o un pagamento a metà strada).
// Dopo 10 secondi si esce comunque.
function chiudiConGrazia(segnale) {
  console.log(`${segnale}: chiudo il server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10 * 1000).unref();
}
process.on('SIGTERM', () => chiudiConGrazia('SIGTERM'));
process.on('SIGINT', () => chiudiConGrazia('SIGINT'));
