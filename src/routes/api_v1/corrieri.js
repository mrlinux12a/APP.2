// L'API dell'app per i corrieri (`/api/v1/corrieri/...`): registrazione, accesso, "chi sono" e password dimenticata, più il lavoro vero e proprio (richieste,
// accettazione, ritiro, consegna) che sta in corrieri_consegne.js. Esiste SOLO per l'app nativa: il sito non ha nessuna pagina per i corrieri (vedi
// docs/app-corrieri.md). Stesso token (`app_tokens`), stessi limiti di tentativi e stessi messaggi dell'accesso degli installatori; l'uscita è la `/logout` comune.
//
// Esiste SOLO nell'ambiente «app» (CORRIERI_APP=1, docs/ambienti.md): nell'ambiente reale i corrieri stanno su WhatsApp e tutto `/corrieri/...` risponde 404, come
// un indirizzo qualsiasi.
const { creaRouter } = require('../base');
const modalita = require('../../logica/ordini/modalita_corrieri');
const corrieri = require('../../logica/account/corrieri');
const tokenApp = require('../../logica/account/token_app');
const recuperoPassword = require('../../logica/account/recupero_password');
const { passwordValida } = require('../../logica/account/password');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito, iscrizioneBloccata, registraIscrizione, recuperoBloccato, registraRecupero } = require('../../logica/account/limite_login');
const { urlPerEmail, eLocale } = require('../../comune/url_sito');
const limiti = require('../../middleware/limiti');
const { richiedeCorriere, utenteCorriereJson } = require('./ausiliari');

const router = creaRouter();

// Il cancello: senza CORRIERI_APP=1 nessuna rotta dei corrieri esiste (nemmeno registrazione e accesso). Si legge a ogni richiesta, non una volta all'avvio.
router.use('/corrieri', (req, res, next) => {
  if (modalita.appAttiva()) return next();
  res.status(404).json({ errore: 'Risorsa non trovata.' });
});

// Registrazione: nome, cognome, email e password. Si entra subito (arriva il token), senza un secondo passaggio dall'accesso. Con dati sbagliati risponde
// 400 con `errori` ([{ testo, campi }]) e l'app segna i campi.
router.post('/corrieri/registrati', limiti.accesso, async (req, res) => {
  // La registrazione è aperta a tutti e ogni iscrizione costa un hash bcrypt: stesso limite per indirizzo di quella degli installatori.
  if (iscrizioneBloccata(req)) {
    return res.status(429).json({ errore: 'Da questo dispositivo sono state fatte troppe registrazioni. Riprova più tardi.' });
  }
  const dati = req.body && typeof req.body === 'object' ? req.body : {};
  const errori = await corrieri.validaRegistrazione(dati);
  if (errori.length) return res.status(400).json({ errore: errori[0].testo, errori });

  let corriere;
  try {
    corriere = await corrieri.registra(dati);
  } catch (e) {
    // 23505 = email (unica) presa da qualcun altro fra il controllo e l'inserimento.
    if (e && e.code === '23505') {
      const errore = { testo: 'Questa email è già registrata.', campi: ['email'] };
      return res.status(400).json({ errore: errore.testo, errori: [errore] });
    }
    throw e;
  }
  registraIscrizione(req);
  const token = await tokenApp.creaToken(corriere.id, dati.dispositivo);
  res.json({ token, utente: utenteCorriereJson(corriere) });
});

// Accesso con email e password. Credenziali sbagliate: lo stesso messaggio generico dell'installatore. Se la password è giusta ma l'account è di un altro
// ruolo lo dice (solo dopo aver controllato la password: prima, la risposta direbbe a chiunque chi è iscritto).
router.post('/corrieri/accedi', limiti.accesso, async (req, res) => {
  const email = corrieri.normalizzaEmail(req.body && req.body.email).slice(0, 200);

  if (accessoBloccato(req, email)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const utente = await corrieri.utenteDaEmail(email);
  if (!(await passwordValida(req.body && req.body.password, utente))) {
    registraAccessoFallito(req, email);
    return res.status(401).json({ errore: 'Credenziali non valide.' });
  }
  accessoRiuscito(req, email);
  if (utente.ruolo !== corrieri.RUOLO_CORRIERE) {
    return res.status(403).json({ errore: 'Questo account non è un account corriere' });
  }
  const token = await tokenApp.creaToken(utente.id, req.body && req.body.dispositivo);
  res.json({ token, utente: utenteCorriereJson(utente) });
});

// Chi è collegato (serve all'app per controllare che il token valga ancora, come `/me` degli installatori).
router.get('/corrieri/me', richiedeCorriere, async (req, res) => {
  res.json({ utente: utenteCorriereJson(req.utente) });
});

// "Password dimenticata?" dell'app: stesso recupero via email degli installatori (src/logica/account/recupero_password.js, tabella `recupero_password`), ma solo
// per gli account corriere. Risponde SEMPRE allo stesso modo, che l'account esista o no. Il link nell'email porta alla pagina del sito che sceglie la nuova
// password; poi si torna nell'app e si entra con quella.
router.post('/corrieri/password-dimenticata', limiti.accesso, async (req, res) => {
  const email = corrieri.normalizzaEmail(req.body && req.body.email).slice(0, 200);
  if (!corrieri.emailValida(email)) return res.status(400).json({ errore: 'Scrivi la tua email.' });
  if (recuperoBloccato(req, email)) {
    return res.status(429).json({ errore: 'Troppe richieste. Riprova tra un po’.' });
  }
  registraRecupero(req, email);
  const esito = await recuperoPassword.richiedi(email, { baseUrl: urlPerEmail(req), ruolo: corrieri.RUOLO_CORRIERE });
  // L'invio non si aspetta (nemmeno il tempo di risposta deve dire se l'account c'è). In locale, se l'email non è partita (niente SMTP), il link si scrive nel
  // log del server per poter provare senza posta; mai su un indirizzo pubblico.
  esito.consegne.then((consegne) => {
    if (!eLocale(req)) return;
    for (const c of consegne) if (!c.inviata && c.link) console.log('[recupero password] (solo in locale) link per ' + c.username + ': ' + c.link);
  });
  res.json({ ok: true, minuti_validita: recuperoPassword.VALIDITA_MIN });
});

// Il lavoro del corriere: disponibilità, richieste, accettazione, ritiro, consegna, notifiche sul telefono.
router.use(require('./corrieri_consegne'));

module.exports = router;
