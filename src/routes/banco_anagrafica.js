// "Anagrafica del banco": le schede Ditta, Questa filiale, Orari, Accesso e Notifiche che il banco può leggere e cambiare (richiesta esplicita del
// 20/10/2026). Logica in src/anagrafica_banco.js e src/orari.js, presentazione in views/distributore_anagrafica.ejs. Un solo profilo con tutti i
// permessi: ogni utente del banco vede e cambia le stesse cose.
// Ogni scheda ha il suo POST: con errori la pagina si ripropone (400) con la scheda aperta, i valori scritti e gli errori sotto i campi; con il
// salvataggio si torna alla pagina (`?ok=<scheda>`), che lo conferma.
const { creaRouter } = require('./base');
const { requireRole } = require('../auth');
const orari = require('../orari');
const anagraficaBanco = require('../anagrafica_banco');
const emailModulo = require('../email');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito } = require('../limite_login');
const { rileggiIntestazioneBanco } = require('../services/banco');

const router = creaRouter();

// Le schede che si possono aprire in modifica, e quelle di cui si può mostrare "salvato".
const SCHEDE_ANAGRAFICA = ['ditta', 'filiale', 'orari', 'password'];
const SALVATI_ANAGRAFICA = ['ditta', 'filiale', 'orari', 'password'];

// Disegna la pagina "Anagrafica del banco". `extra` porta dati già letti, lo stato (400/429), la scheda da aprire, i valori scritti e gli errori.
async function paginaAnagraficaBanco(req, res, extra = {}) {
  const dati = extra.dati || (await anagraficaBanco.leggi(req.session.user.distributor_id, req.session.user.id));
  if (!dati) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Banco non trovato.' });
  res.status(extra.stato || 200).render('distributore_anagrafica', {
    titolo: 'Anagrafica del banco',
    dati,
    anagraficaBanco,
    orari,
    // Quale scheda è aperta in modifica: quella con gli errori, o quella chiesta con ?modifica= (anche senza JavaScript).
    // Una filiale senza orari impostati NON riceve richieste (dal 22/10/2026): la scheda "Orari" si apre da sola in modifica, con l'avviso.
    aperta: extra.aperta !== undefined ? extra.aperta : (SCHEDE_ANAGRAFICA.includes(req.query.modifica) ? req.query.modifica : (dati.orari ? null : 'orari')),
    orariNonImpostati: !dati.orari,
    valori: extra.valori || {},
    errori: extra.errori || {},
    ok: SALVATI_ANAGRAFICA.includes(req.query.ok) ? req.query.ok : '',
    riassuntoOrari: orari.riassunto(dati.orari),
    moduloOrari: extra.moduloOrari || orari.valoriPerModulo(dati.orari),
    // La riga "Email per ogni nuova richiesta" c'è solo quando esiste l'invio vero (email.inviaNuovaRichiesta): oggi manca e la riga resta nascosta.
    emailRichieste: typeof emailModulo.inviaNuovaRichiesta === 'function',
  });
}

// Mostra la pagina "Anagrafica del banco".
router.get('/distributore/anagrafica', requireRole('distributore'), (req, res) => paginaAnagraficaBanco(req, res));

// Salva la scheda "Ditta" (ragione sociale, partita IVA, SDI/PEC, sede legale) dopo averla controllata.
router.post('/distributore/anagrafica/ditta', requireRole('distributore'), async (req, res) => {
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

// Salva la scheda "Questa filiale" (nome, telefono, email, indirizzo di ritiro) dopo averla controllata. Non sposta il punto sulla mappa.
router.post('/distributore/anagrafica/filiale', requireRole('distributore'), async (req, res) => {
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

// Salva gli orari di apertura del banco (fuori orario le richieste non arrivano e gli installatori non possono inviare). Avvisa subito tutti gli
// installatori collegati.
router.post('/distributore/anagrafica/orari', requireRole('distributore'), async (req, res) => {
  const idBanco = req.session.user.distributor_id;
  const letti = orari.orariDaModulo(req.body);
  if (letti.errore || Object.keys(letti.errori).length) {
    const dati = await anagraficaBanco.leggi(idBanco, req.session.user.id);
    return paginaAnagraficaBanco(req, res, {
      dati, stato: 400, aperta: 'orari', moduloOrari: letti.valori,
      errori: { orari: { ...letti.errori, _generale: letti.errore } },
    });
  }
  await anagraficaBanco.salvaOrari(idBanco, letti.orari);
  res.redirect('/distributore/anagrafica?ok=orari#orari');
});

// Cambia la password del banco. I tentativi con la password attuale sbagliata contano nello stesso limite del login (chi ha rubato una sessione non deve
// poterla indovinare qui). Dopo il cambio le altre sessioni dello stesso utente si chiudono (anagraficaBanco.cambiaPassword).
router.post('/distributore/anagrafica/password', requireRole('distributore'), async (req, res) => {
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
router.post('/distributore/anagrafica/email-richieste', requireRole('distributore'), async (req, res) => {
  await anagraficaBanco.salvaEmailNuoveRichieste(req.session.user.distributor_id, req.body.acceso === true || req.body.acceso === '1' || req.body.acceso === 1);
  res.json({ ok: true });
});

module.exports = router;
