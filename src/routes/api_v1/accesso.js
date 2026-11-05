// Accesso dell'app: login, registrazione, logout e "chi sono" (`/api/v1/login`, `/registrazione`, `/logout`, `/me`).
const { creaRouter } = require('../base');
const utenti = require('../../logica/account/utenti');
const tokenApp = require('../../logica/account/token_app');
const anagrafiche = require('../../logica/account/anagrafiche');
const push = require('../../logica/notifiche/push');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito, iscrizioneBloccata, registraIscrizione } = require('../../logica/account/limite_login');
const { passwordValida } = require('../../logica/account/password');
const limiti = require('../../middleware/limiti');
const { richiedeCliente, tokenDellaRichiesta, utenteJson } = require('./ausiliari');

const router = creaRouter();

router.post('/login', limiti.accesso, async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim().slice(0, 100);

  if (accessoBloccato(req, username)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const user = await utenti.utenteAttivoPerUsername(username);
  if (!(await passwordValida(req.body && req.body.password, user))) {
    registraAccessoFallito(req, username);
    return res.status(401).json({ errore: 'Credenziali non valide.' });
  }
  accessoRiuscito(req, username);
  if (user.ruolo !== 'cliente') {
    return res.status(403).json({ errore: "Per ora l'app è riservata agli installatori: accedi dal sito." });
  }
  const token = await tokenApp.creaToken(user.id, req.body && req.body.dispositivo);
  res.json({ token, utente: utenteJson(user) });
});

// Registrazione dall'app: gli stessi controlli e la stessa iscrizione del sito (anagrafiche.validaIscrizione / iscriviCliente), poi si entra
// subito, senza un secondo passaggio dal login. Con gli errori per campo (`errori`) l'app evidenzia i campi sbagliati.
router.post('/registrazione', limiti.accesso, async (req, res) => {
  if (iscrizioneBloccata(req)) {
    return res.status(429).json({ errore: 'Da questo dispositivo sono state fatte troppe registrazioni. Riprova più tardi.' });
  }
  const dati = req.body || {};
  const errori = await anagrafiche.validaIscrizione(dati);
  if (errori.length) return res.status(400).json({ errore: errori[0].testo, errori });

  let cliente;
  try {
    cliente = await anagrafiche.iscriviCliente(dati, await anagrafiche.distributoriPredefiniti());
  } catch (e) {
    // 23505 = nome utente (unico) preso da qualcun altro fra il controllo e l'inserimento.
    if (e && e.code === '23505') {
      const errore = { testo: 'Questo nome utente è già in uso.', campi: ['username'] };
      return res.status(400).json({ errore: errore.testo, errori: [errore] });
    }
    throw e;
  }
  registraIscrizione(req);
  const token = await tokenApp.creaToken(cliente.id, dati.dispositivo);
  res.json({ token, utente: utenteJson(cliente) });
});

// Uscita dell'app: rende inutilizzabile il token e toglie il telefono dalle notifiche di questo utente.
router.post('/logout', async (req, res) => {
  const token = tokenDellaRichiesta(req);
  // Il telefono che esce non deve più ricevere le notifiche di questo utente (se manda il suo token push).
  const utente = token ? await tokenApp.utenteDaToken(token) : null;
  const tokenPush = req.body && req.body.token_push;
  if (utente && tokenPush) await push.rimuovi(tokenPush, utente.id).catch(() => {});
  await tokenApp.revocaToken(token);
  res.json({ ok: true });
});

// Dice all'app chi è collegato (serve a controllare che il token valga ancora).
router.get('/me', richiedeCliente, async (req, res) => {
  res.json({ utente: utenteJson(req.utente) });
});

module.exports = router;
