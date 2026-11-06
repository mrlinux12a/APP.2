// API JSON dell'app nativa (cartella mobile/). Stessa logica delle pagine web — le
// funzioni di catalogo, prezzi, richieste e ordini sono quelle di src/ — ma
// autenticazione con token invece del cookie di sessione.
//
// L'app è per gli installatori (ruolo 'cliente') e, con le rotte di corrieri.js, per i corrieri (ruolo 'corriere'): il banco e l'agente
// continuano a usare il sito.
const express = require('express');
const accesso = require('./accesso');
const profilo = require('./profilo');
const catalogo = require('./catalogo');
const richieste = require('./richieste');
const ordini = require('./ordini');
const ricevute = require('./ricevute');
const storico = require('./storico');
const corrieri = require('./corrieri');

const router = express.Router();

// Nessun cookie in gioco: l'unica credenziale è l'intestazione Authorization, che un sito
// terzo non può far inviare al posto dell'utente. Aprire l'origine non espone quindi nulla
// e permette di provare l'app anche nel browser durante lo sviluppo (expo start --web).
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  // Risposte di un utente collegato: né il telefono né un proxy ne tengono copia.
  res.set('Cache-Control', 'private, no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Le rotte, una cartella per argomento. L'ordine è quello di prima della divisione: Express prova le rotte in fila.
router.use(accesso, profilo, catalogo, richieste, ordini, ricevute, storico);
// L'API dei corrieri (solo app): registrazione, accesso, password dimenticata. Tutte le rotte stanno sotto /corrieri.
router.use(corrieri);

// Qualsiasi altro indirizzo dell'API: 404 in JSON.
router.use((req, res) => {
  res.status(404).json({ errore: 'Risorsa non trovata.' });
});

// Gli errori dell'API restano JSON: il gestore generale di server.js risponde con una
// pagina HTML, che l'app non saprebbe mostrare.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Un valore che Postgres non accetta (testo con NUL, numero fuori misura...) viene dall'input, non da un guasto: 400 e non 500.
  if (err && ['22021', '22P05', '22003', '22P02', '22007', '22008'].includes(err.code)) {
    console.warn('Valore non valido (' + err.code + ') in', req.method, req.originalUrl, ':', err.message);
    return res.status(400).json({ errore: 'Alcuni dati inviati non sono validi.' });
  }
  console.error('Errore API', req.method, req.originalUrl, ':', err);
  res.status(500).json({ errore: 'Si è verificato un problema imprevisto. Riprova tra poco.' });
});

module.exports = router;
