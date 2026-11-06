// L'API di lavoro dei corrieri (`/api/v1/corrieri/...`, solo nell'ambiente «app»): disponibilità, richieste da prendere, accettazione, le due fasi della consegna
// e il riepilogo finale. L'accesso (registrazione, login, password) sta in corrieri.js; la logica in src/logica/corrieri/consegne.js; la spiegazione in
// docs/app-corrieri.md.
//
// Regole comuni:
//  · tutte le rotte vogliono il token di un corriere (richiedeCorriere);
//  · la posizione del telefono arriva a ogni chiamata che ne ha bisogno (`lat` e `lng`: nell'indirizzo per le letture, nel corpo per le scritture) e non si salva;
//  · gli errori «previsti» (richiesta già presa, posizione mancante...) hanno un codice che l'app riconosce, oltre al testo da mostrare:
//    { errore: "testo", codice: "gia_accettata" }.
const { creaRouter } = require('../base');
const consegne = require('../../logica/corrieri/consegne');
const push = require('../../logica/notifiche/push');
const { richiedeCorriere } = require('./ausiliari');

const router = creaRouter();

// Trasforma un errore previsto della logica dei corrieri nella risposta JSON giusta (stato, testo e codice); gli altri errori vanno al gestore generale dell'API.
function conErroriPrevisti(gestore) {
  return async (req, res, next) => {
    try {
      await gestore(req, res);
    } catch (err) {
      if (err instanceof consegne.ErroreCorriere) {
        return res.status(err.stato).json({ ...err.dati, errore: err.message, codice: err.codice });
      }
      next(err);
    }
  };
}

// La posizione del telefono: dall'indirizzo (?lat=..&lng=..) per le letture, dal corpo per le scritture. null se manca o non è valida.
function posizioneDellaRichiesta(req) {
  const fonte = req.method === 'GET' ? req.query : req.body && typeof req.body === 'object' ? req.body : {};
  return consegne.leggiPosizione(fonte.lat, fonte.lng);
}

// «Sei disponibile»: com'è adesso (letto dal database, mai dalla copia in memoria del token).
router.get('/corrieri/disponibilita', richiedeCorriere, async (req, res) => {
  res.json({ disponibile: await consegne.leggiDisponibilita(req.utente.id) });
});

// Accende o spegne «Sei disponibile». Corpo: { disponibile: true | false }. Da spento il corriere non vede richieste e non riceve notifiche di nuove richieste.
router.put('/corrieri/disponibilita', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  const valore = req.body && req.body.disponibile;
  if (typeof valore !== 'boolean') return res.status(400).json({ errore: 'Indica se sei disponibile (true o false).', codice: 'dato_non_valido' });
  res.json({ disponibile: await consegne.impostaDisponibilita(req.utente.id, valore) });
}));

// La home «Richieste»: { disponibile, in_corso, richieste: [...] }. Con una consegna già in corso, o da spento, l'elenco è vuoto e la risposta dice perché. Con la
// posizione le richieste sono ordinate dalla più vicina.
router.get('/corrieri/richieste', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.elencoRichieste(req.utente.id, posizioneDellaRichiesta(req)));
}));

// «Dettaglio richiesta» (l'id è quello della scheda dell'elenco). 410 con un codice se nel frattempo non si può più prendere: 'gia_accettata' (un altro corriere),
// 'scaduta', oppure 'tua' (l'ha già presa lui: l'app lo porta alla consegna in corso).
router.get('/corrieri/richieste/:id', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.dettaglioRichiesta(req.utente.id, Number(req.params.id), posizioneDellaRichiesta(req)));
}));

// «Accetta richiesta». Corpo: { lat, lng } (obbligatori: senza posizione 400 'posizione_mancante'). Il primo che accetta vince; un corriere ha una consegna sola alla
// volta (409 'gia_in_consegna'). Ripetere la stessa accettazione non fa danni. Risposta: { ok: true, ordine_id }.
router.post('/corrieri/richieste/:id/accetta', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.accetta(req.utente, Number(req.params.id), posizioneDellaRichiesta(req)));
}));

// La consegna in corso: { consegna: {...} } con la fase (1 «Vai al ritiro», 2 «Vai al cantiere»), { consegna: null } se non ne ha una, o
// { consegna: null, in_preparazione: true } nell'istante fra l'accettazione e la nascita dell'ordine (l'app riprova dopo un attimo).
router.get('/corrieri/in-corso', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.inCorso(req.utente.id));
}));

// «Ho ritirato il materiale»: porta la consegna alla fase 2 e l'ordine del banco a «In consegna». Risposta: { consegna } aggiornata.
router.post('/corrieri/consegne/:id/ritirato', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.segnaRitirato(req.utente, Number(req.params.id)));
}));

// «Consegna confermata»: un tocco, senza foto né codici. Solo dopo il ritiro (409 'non_ritirato'). Risposta: { ok, riepilogo }.
router.post('/corrieri/consegne/:id/consegnato', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.segnaConsegnato(req.utente, Number(req.params.id)));
}));

// Il riepilogo di una consegna completata (schermata «Consegna completata»), anche a distanza di tempo.
router.get('/corrieri/consegne/:id/riepilogo', richiedeCorriere, conErroriPrevisti(async (req, res) => {
  res.json(await consegne.riepilogo(req.utente.id, Number(req.params.id)));
}));

// Il telefono comunica il suo token push (Expo): è così che arriva la notifica «Nuova richiesta di consegna». Gemello di POST /dispositivi degli installatori.
router.post('/corrieri/dispositivi', richiedeCorriere, async (req, res) => {
  const corpo = req.body || {};
  const ok = await push.registra(req.utente.id, corpo.token, corpo.piattaforma);
  if (!ok) return res.status(400).json({ errore: 'Token delle notifiche non valido.' });
  res.json({ ok: true });
});

// Toglie un telefono dalle notifiche del corriere.
router.delete('/corrieri/dispositivi', richiedeCorriere, async (req, res) => {
  await push.rimuovi((req.body && req.body.token) || '', req.utente.id);
  res.json({ ok: true });
});

module.exports = router;
