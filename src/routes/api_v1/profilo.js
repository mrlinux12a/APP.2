// Profilo dell'app: dati del cliente, cambio della password, dispositivi per le notifiche push ed eliminazione dell'account.
const { creaRouter } = require('../base');
const format = require('../../comune/format');
const tokenApp = require('../../logica/account/token_app');
const anagrafiche = require('../../logica/account/anagrafiche');
const account = require('../../logica/account/account');
const passwordAccount = require('../../logica/account/password_account');
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
      // 'in_attesa' = nessun distributore lo ha ancora approvato: la pagina avvisa che il catalogo si sfoglia ma non si inviano richieste (come sul sito).
      stato_anagrafica: u.stato_anagrafica || '',
    },
    distributore: riferimento ? format.nomeCommerciale(riferimento.distributore) : null,
    // Il codice con cui il distributore ti ha registrato, solo se ti ha approvato ("Codice cliente" sotto il suo nome, come sul sito).
    codice_cliente: riferimento && riferimento.stato === 'approvato' ? String(riferimento.codice_cliente || '') : '',
    assistenza: azienda().email || null,
  });
});

// Cambia la password dall'app: stesse regole e stesso limite di tentativi della pagina "La mia anagrafica" del sito (src/logica/account/password_account.js:
// attuale giusta, nuova di 8-72 caratteri e diversa). Il cambio revoca TUTTI gli accessi dell'app, compreso quello di questo telefono: per non far uscire
// chi l'ha appena cambiata, a questo telefono si dà subito un accesso nuovo (`token`), che l'app tiene al posto del vecchio.
router.post('/password', richiedeCliente, async (req, res) => {
  const chiaveLimite = 'cambio-password:' + String(req.utente.username || req.utente.id);
  if (accessoBloccato(req, chiaveLimite)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const esito = await passwordAccount.cambiaPassword(req.utente.id, '', req.body);
  if (!esito.ok) {
    // La password attuale sbagliata conta nel limite dei tentativi; un campo scritto male (nuova troppo corta, ripetizione diversa) no.
    if (esito.passwordSbagliata) registraAccessoFallito(req, chiaveLimite);
    return res.status(400).json({ errore: Object.values(esito.errori)[0], errori: esito.errori });
  }
  accessoRiuscito(req, chiaveLimite);
  const token = await tokenApp.creaToken(req.utente.id, req.body && req.body.dispositivo);
  res.json({ ok: true, token });
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
