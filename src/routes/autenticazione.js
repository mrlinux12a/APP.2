// Entrare, uscire, registrarsi e recuperare la password: le pagine che si vedono prima di essere "dentro" il sito (e le due pagine pubbliche richieste da
// Google Play).
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const { passwordValida } = require('../password');
const anagrafiche = require('../anagrafiche');
const recuperoPassword = require('../recupero_password');
const webPush = require('../web_push');
const testiLegali = require('../testi_legali');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito, iscrizioneBloccata, registraIscrizione, recuperoBloccato, registraRecupero } = require('../limite_login');
const { avviaSessione } = require('../services/sessione_utente');
const { eLocale, urlPerEmail } = require('../services/url_sito');
const limiti = require('../middleware/limiti');

const router = creaRouter();

// ---------- Home / Login ----------

// L'indirizzo "/": manda ognuno alla sua pagina di partenza (chi non è collegato al login, l'installatore al catalogo, il banco alla sua bacheca, l'agente
// all'elenco ordini).
router.get('/', async (req, res) => {
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

// Mostra la pagina di accesso (nome utente e password). Chi è già collegato va alla sua pagina.
router.get('/login', async (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { titolo: 'Accedi', errore: null, scheda: 'accedi', avviso: AVVISI_LOGIN[req.query.avviso] || '' });
});

// Controlla nome utente e password e, se sono giusti, apre la sessione. Con credenziali sbagliate risponde 401 e conta il tentativo (dopo troppi tentativi
// risponde 429 per qualche minuto).
router.post('/login', limiti.accesso, async (req, res) => {
  // Uno spazio digitato per sbaglio (specie a fine nome, su telefono con autocorrezione) non deve far fallire l'accesso: il nome utente si confronta
  // sempre già "ripulito". Un nome utente reale è corto: il taglio evita chiavi enormi nel contatore dei tentativi.
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

// Esce: toglie la sessione e riporta al login.
router.post('/logout', async (req, res) => {
  // Chi esce non deve più ricevere le notifiche di questo account su questo telefono o computer (se poi entra qualcun altro, l'iscrizione passa a lui).
  const utenteUscente = req.session.user;
  if (utenteUscente && req.session.pushEndpoint) await webPush.rimuovi(req.session.pushEndpoint, utenteUscente.id).catch(() => {});
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Recupero della password (installatore) ----------
// "Password dimenticata?": nome utente o email -> email con un link valido un'ora (src/recupero_password.js). La risposta è sempre la stessa, che l'account
// esista o no, e l'invio non si aspetta. Il link usa APP_URL (mai l'intestazione Host, che la scrive chi chiama: un link verso un sito altrui farebbe
// rubare il codice); senza APP_URL vale solo in locale.

// Mostra il modulo "Password dimenticata?".
router.get('/password-dimenticata', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('password_dimenticata', { stato: 'modulo', identificativo: '' });
});

// Riceve il nome utente (o l'email) e manda il link per scegliere una nuova password. Risponde sempre allo stesso modo, anche se l'account non esiste.
router.post('/password-dimenticata', limiti.accesso, async (req, res) => {
  if (req.session.user) return res.redirect('/');
  const identificativo = typeof req.body.identificativo === 'string' ? req.body.identificativo.trim().slice(0, 200) : '';
  if (!identificativo) {
    return res.status(400).render('password_dimenticata', { stato: 'modulo', errore: 'Scrivi il tuo nome utente o la tua email.', identificativo: '' });
  }
  if (recuperoBloccato(req, identificativo)) return res.status(429).render('password_dimenticata', { stato: 'troppe' });
  registraRecupero(req, identificativo);
  const esito = await recuperoPassword.richiedi(identificativo, { baseUrl: urlPerEmail(req) });
  // Non si aspetta l'invio (nemmeno il tempo di risposta deve dire se l'account c'è). In locale, se l'email non è partita (niente SMTP), il link si scrive
  // nel log del server: serve a provare senza posta. Mai su un indirizzo pubblico: nel log finirebbe un link che apre un account.
  esito.consegne.then((consegne) => {
    if (!eLocale(req)) return;
    for (const c of consegne) if (!c.inviata && c.link) console.log('[recupero password] (solo in locale) link per ' + c.username + ': ' + c.link);
  });
  res.render('password_dimenticata', { stato: 'inviata', minutiValidita: recuperoPassword.VALIDITA_MIN });
});

// Il link dell'email: se è ancora buono mostra il modulo per scegliere la nuova password, altrimenti propone di chiederne uno nuovo (410).
router.get('/reimposta-password/:codice', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const accountLink = await recuperoPassword.accountDaCodice(req.params.codice);
  if (!accountLink) return res.status(410).render('password_reimposta', { stato: 'nonvalido' });
  res.render('password_reimposta', { stato: 'modulo', username: accountLink.username, codice: req.params.codice, errori: {} });
});

// Salva la nuova password scelta dal link dell'email. Se i campi non vanno ripropone il modulo senza bruciare il link; a buon fine porta al login.
router.post('/reimposta-password/:codice', limiti.accesso, async (req, res) => {
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

// ---------- Pagine pubbliche (Google Play) ----------

// Pagine pubbliche richieste da Google Play per l'app (src/testi_legali.js). Senza accesso.

// Mostra l'informativa sulla privacy.
router.get('/privacy', (req, res) => res.render('legale', { pagina: testiLegali.privacy() }));

// Mostra come eliminare il proprio account.
router.get('/elimina-account', (req, res) => res.render('legale', { pagina: testiLegali.eliminazione() }));

// ---------- Registrazione cliente ----------

// Mostra il modulo di registrazione. La pagina ha tre passi (uno script li mostra uno alla volta) ma è un unico modulo. Il distributore non si sceglie:
// ogni nuovo cliente è collegato a quello predefinito (anagrafiche.distributoriPredefiniti).
router.get('/registrati', async (req, res) => {
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

// Registra una nuova impresa: controlla i dati, crea l'account, lo collega al distributore predefinito e lo fa entrare. Con dati sbagliati ripropone il
// modulo com'è stato compilato (le password no), aperto sul primo passo che ha un campo sbagliato.
router.post('/registrati', limiti.accesso, async (req, res) => {
  const mostraErrori = (errori) =>
    res.status(400).render('registrati', {
      titolo: 'Registra la tua impresa',
      tipi: anagrafiche.TIPI_SOGGETTO,
      dati: req.body,
      errori: errori.map((e) => e.testo),
      campiErrore: errori.flatMap((e) => e.campi),
      passo: anagrafiche.primoPassoConErrori(errori),
    });

  // La registrazione è aperta a tutti e ogni iscrizione costa un hash bcrypt e una riga di anagrafica approvata da sola: senza un limite per indirizzo
  // un ciclo di richieste riempiva il database di clienti finti.
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

// Schermata dopo la registrazione: l'anagrafica è pronta e c'è il distributore di riferimento. Senza stato: se la si riapre, mostra la stessa cosa. Se il
// distributore non ha ancora approvato, lo dice.
router.get('/benvenuto', requireRole('cliente'), async (req, res) => {
  const legami = await anagrafiche.legamiDelCliente(req.session.user.id);
  res.render('benvenuto', {
    titolo: 'Benvenuto',
    distributore: anagrafiche.distributoreDiRiferimento(legami),
  });
});

module.exports = router;
