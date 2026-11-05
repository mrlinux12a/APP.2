// Profilo dell'app: dati del cliente, dispositivi per le notifiche push ed eliminazione dell'account.
const { creaRouter } = require('../base');
const format = require('../../comune/format');
const tokenApp = require('../../logica/account/token_app');
const anagrafiche = require('../../logica/account/anagrafiche');
const account = require('../../logica/account/account');
const push = require('../../logica/notifiche/push');
const { azienda } = require('../../logica/pagamenti/azienda');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito } = require('../../logica/account/limite_login');
const { passwordValida } = require('../../logica/account/password');
const { richiedeCliente, utenteJson } = require('./ausiliari');

const router = creaRouter();

// "La mia anagrafica": gli stessi dati della pagina /profilo del sito, in sola lettura.
router.get('/profilo', richiedeCliente, async (req, res) => {
  const u = req.utente;
  const legami = await anagrafiche.legamiDelCliente(u.id);
  const riferimento = anagrafiche.distributoreDiRiferimento(legami);
  res.json({
    utente: {
      ...utenteJson(u),
      tipo_soggetto: u.tipo_soggetto,
      tipo_testo: anagrafiche.TIPI_SOGGETTO[u.tipo_soggetto] || '',
      referente: u.referente || '',
      partita_iva: u.partita_iva || '',
      codice_fiscale: u.codice_fiscale || '',
      indirizzo: u.indirizzo || '',
      cap: u.cap || '',
      citta: u.citta || '',
      provincia: u.provincia || '',
      sdi_pec: u.sdi_pec || '',
      email: u.email || '',
      telefono: u.telefono || '',
      indirizzo_consegna: u.indirizzo_consegna || '',
    },
    distributore: riferimento ? format.nomeCommerciale(riferimento.distributore) : null,
    assistenza: azienda().email || null,
  });
});

// Il telefono comunica il suo token push (Expo) appena l'utente entra nell'app.
router.post('/dispositivi', richiedeCliente, async (req, res) => {
  const body = req.body || {};
  const ok = await push.registra(req.utente.id, body.token, body.piattaforma);
  if (!ok) return res.status(400).json({ errore: 'Token delle notifiche non valido.' });
  res.json({ ok: true });
});

// Toglie un telefono dall'elenco di quelli che ricevono le notifiche push.
router.delete('/dispositivi', richiedeCliente, async (req, res) => {
  await push.rimuovi((req.body && req.body.token) || '', req.utente.id);
  res.json({ ok: true });
});

// Elimina (anonimizza) l'account: serve la password, come conferma. Vedi src/logica/account/account.js per cosa resta e cosa sparisce.
router.delete('/account', richiedeCliente, async (req, res) => {
  const username = String(req.utente.username || '');
  if (accessoBloccato(req, username)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  if (!(await passwordValida(req.body && req.body.password, req.utente))) {
    registraAccessoFallito(req, username);
    return res.status(401).json({ errore: 'Password non corretta.' });
  }
  accessoRiuscito(req, username);
  try {
    await account.eliminaAccount(req.utente);
  } catch (e) {
    if (!(e instanceof account.AccountNonEliminabile)) throw e;
    return res.status(409).json({ errore: e.messaggioCliente });
  }
  tokenApp.dimenticaUtente(req.utente.id);
  res.json({ ok: true });
});

module.exports = router;
