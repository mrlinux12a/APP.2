// Le notifiche: l'elenco per banco e agente, quelle da mostrare nel browser e le notifiche ad app chiusa (Web Push, src/web_push.js).
const { creaRouter } = require('./base');
const { requireLogin } = require('../auth');
const notifiche = require('../notifiche');
const webPush = require('../web_push');
const bancoAvvisi = require('../banco_avvisi');

const router = creaRouter();

// ---------- Elenco ----------

// Mostra l'elenco delle notifiche (banco e agente; il cliente non ha più un elenco e va a "Stato ordini"). Aprendola le segna tutte lette.
router.get('/notifiche', requireLogin, async (req, res) => {
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

// ---------- Notifiche nel browser ----------

// Dà le notifiche non ancora mostrate: app.js le trasforma in notifica push del browser e, per il banco, in avvisi a comparsa. Al banco ogni notifica
// porta anche `tipo`, `request_id`, `order_id` e i dati del suo avviso (src/banco_avvisi.js: la richiesta con i secondi che mancano, il corriere...).
router.get('/api/notifiche/push', requireLogin, async (req, res) => {
  const utente = req.session.user;
  const alBanco = utente.ruolo === 'distributore' && utente.distributor_id;
  // Cliente e agente: solo le notifiche degli ultimi 10 minuti (le vecchie si segnano e basta). Il banco le riceve tutte e filtra da sé.
  const nuove = await notifiche.daMostrare(utente.id, alBanco ? {} : { massimoEtaSec: 600 });
  res.json({ notifiche: alBanco ? await bancoAvvisi.arricchisciPush(utente.distributor_id, nuove) : nuove });
});

// "Attiva" gli avvisi sul telefono: le notifiche già presenti sono storia, non devono arrivare tutte insieme.
router.post('/api/notifiche/attiva', requireLogin, async (req, res) => {
  await notifiche.segnaTutteNotificate(req.session.user.id);
  res.json({ ok: true });
});

// Un avviso a comparsa del banco, aperto o chiuso, risulta letto (public/app.js, "Avvisi del banco"): il browser manda gli id delle notifiche e, perché un
// avviso sopravvive alle ricariche della pagina (che ne perdono gli id), le richieste e gli ordini a cui si riferisce.
router.post('/api/notifiche/lette', requireLogin, async (req, res) => {
  await notifiche.segnaLettePerId(req.session.user.id, req.body.ids, { richieste: req.body.richieste, ordini: req.body.ordini });
  res.json({ ok: true });
});

// ---------- Notifiche ad app chiusa (Web Push, src/web_push.js) ----------

// Le frasi che si possono mostrare quando l'iscrizione alle notifiche non riesce (scelte da noi, mai il testo di un errore tecnico).
const ERRORI_PUSH = {
  spente: 'Le notifiche ad app chiusa non sono attive su questo server.',
  non_valida: 'Iscrizione del browser non valida.',
  tabella: 'Le notifiche ad app chiusa non sono ancora pronte su questo server.',
};

// Registra questo browser per le notifiche ad app chiusa (public/app.js, "Notifiche anche ad app chiusa"): si salva e si ricorda in sessione, così la
// pagina sa che il server ha già questo browser (meta push-endpoint) e il logout sa quale iscrizione togliere.
router.post('/api/push/iscrivi', requireLogin, async (req, res) => {
  const esito = await webPush.registra(req.session.user.id, req.body && req.body.subscription, { userAgent: req.get('user-agent') });
  if (!esito.ok) return res.status(esito.motivo === 'non_valida' ? 400 : 503).json({ ok: false, errore: ERRORI_PUSH[esito.motivo] || ERRORI_PUSH.spente });
  req.session.pushEndpoint = esito.endpoint;
  res.json({ ok: true });
});

// Toglie questo browser dalle notifiche ad app chiusa (interruttore spento, o disiscrizione dal browser).
router.post('/api/push/disiscrivi', requireLogin, async (req, res) => {
  const endpoint = req.body && typeof req.body.endpoint === 'string' ? req.body.endpoint : '';
  if (endpoint) await webPush.rimuovi(endpoint, req.session.user.id);
  if (!endpoint || req.session.pushEndpoint === endpoint) delete req.session.pushEndpoint;
  res.json({ ok: true });
});

// Quando è stata chiesta l'ultima notifica di prova, per utente (per non farne troppe).
const provePush = new Map();

// Manda una notifica di prova ("Prova" nella scheda Sul telefono): passa dal server come una vera, quindi prova anche l'app chiusa. `dopoSec` (0-30) lascia
// il tempo di chiudere l'app prima che arrivi. Al massimo una ogni 10 secondi per utente.
router.post('/api/push/prova', requireLogin, async (req, res) => {
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

module.exports = router;
