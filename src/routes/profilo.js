// "La mia anagrafica" dell'installatore: i suoi dati, il cambio della password e l'eliminazione dell'account.
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireRole } = require('../auth');
const { passwordValida } = require('../password');
const format = require('../format');
const anagrafiche = require('../anagrafiche');
const passwordAccount = require('../password_account');
const account = require('../account');
const tokenApp = require('../token_app');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito } = require('../limite_login');

const router = creaRouter();

// ---------- Profilo del cliente ----------

// Disegna la pagina "La mia anagrafica": dati dell'impresa, distributore di riferimento, contatti e scheda "Accesso". `extra`: stato (400/429 dopo un
// cambio password andato male) e erroriPassword (aprono la scheda "Accesso").
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

// Mostra "La mia anagrafica" (solo lettura).
router.get('/profilo', requireRole('cliente'), (req, res) => paginaProfilo(req, res));

// Cambia la password dall'interno (scheda "Accesso"). Stesse regole del banco (src/password_account.js): attuale giusta, nuova di 8-72 caratteri e diversa,
// altre sessioni chiuse e accessi dell'app revocati. La password attuale sbagliata conta nel limite dei tentativi del login.
router.post('/profilo/password', requireRole('cliente'), async (req, res) => {
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

// ---------- Eliminare l'account ----------

// Disegna la pagina "Elimina account" (src/account.js, lo stesso dell'app): spiega cosa succede e chiede la password. Si anonimizza e si disattiva, non si
// cancella (ordini e ricevute restano). Se c'è qualcosa in corso la pagina lo dice subito e il pulsante non c'è.
async function paginaEliminaAccount(req, res, extra = {}) {
  const corso = await account.attivitaInCorso(req.session.user.id);
  res.status(extra.stato || 200).render('profilo_elimina', {
    titolo: 'Elimina account',
    corso,
    inCorso: !!(corso.richieste || corso.ordini || corso.pagamenti),
    errore: extra.errore || '',
  });
}

// Mostra la pagina "Elimina account".
router.get('/profilo/elimina', requireRole('cliente'), (req, res) => paginaEliminaAccount(req, res));

// Elimina l'account (dopo aver controllato la password): lo anonimizza e lo disattiva, chiude la sessione e porta al login. Se c'è una richiesta in attesa,
// un ordine in consegna o un pagamento a metà risponde 409 e non fa niente.
router.post('/profilo/elimina', requireRole('cliente'), async (req, res) => {
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

module.exports = router;
