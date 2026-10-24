// Il canale "in tempo reale" dal server alla pagina (Server-Sent Events).
const { creaRouter } = require('./base');
const eventi = require('../eventi');

const router = creaRouter();

// Tiene aperta una connessione con la pagina di un installatore o di un banco e ci scrive solo quando succede qualcosa (installatore: il corriere ha segnato
// la consegna; banco: è nata una notifica, e il suono parte subito anche con la scheda nascosta). Un messaggio vuoto ogni 25 secondi tiene viva la
// connessione attraverso proxy e reti mobili. Per gli altri ruoli risponde 401.
// Sta PRIMA del middleware che prepara le viste, che a ogni richiesta fa una decina di query per disegnare le pagine.
router.get('/api/eventi', (req, res) => {
  const utente = req.session && req.session.user;
  if (!utente || (utente.ruolo !== 'cliente' && utente.ruolo !== 'distributore')) return res.status(401).json({ errore: 'non autorizzato' });
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx: non trattenere
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const togli = eventi.iscrivi(utente.id, res, utente.ruolo);
  const cuore = setInterval(() => {
    try { res.write(': \n\n'); } catch (e) { /* chiusa: la toglie 'close' */ }
  }, 25000);
  cuore.unref();
  req.on('close', () => { clearInterval(cuore); togli(); });
});

module.exports = router;
