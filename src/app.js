// L'app Express: mette in fila, nell'ordine giusto, impostazioni, difese, lettura delle richieste, sessione e rotte. Non apre nessuna porta (lo fa server.js):
// così l'app si può costruire anche altrove, per esempio nelle prove.
//
// L'ORDINE CONTA. In breve, ogni richiesta passa da:
//   1. controllo del percorso (niente caratteri NUL) e intestazioni di sicurezza (helmet);
//   2. compressione;
//   3. webhook di Stripe (legge il corpo "grezzo" per verificare la firma: per questo viene prima dei parser);
//   4. file statici e favicon (non costano sessione né contano nei limiti);
//   5. limite generale di richieste per indirizzo;
//   6. lettura del corpo (moduli e JSON);
//   7. API dell'app nativa (/api/v1: token, niente cookie, niente sessione);
//   8. controllo dell'origine (difesa dal CSRF) e sessione;
//   9. canale degli eventi in tempo reale (prima del middleware che prepara le viste, che fa una decina di query);
//  10. preparazione delle viste e, infine, le rotte e i gestori degli errori.
const express = require('express');
const { rifiutaNulNelPercorso, gestoreNonTrovato, gestoreErrori } = require('./http');
const { configuraApp } = require('./config/viste');
const { intestazioniSicurezza } = require('./middleware/sicurezza');
const { comprimiRisposte } = require('./middleware/compressione');
const { creaFileStatici } = require('./middleware/file_statici');
const { leggiCorpo } = require('./middleware/corpo');
const { controlloOrigine } = require('./middleware/origine');
const { creaSessione } = require('./middleware/sessione');
const { contestoViste } = require('./middleware/contesto_viste');
const limiti = require('./middleware/limiti');
const webhookStripe = require('./routes/webhook_stripe');
const eventi = require('./routes/eventi');
const { montaRotte } = require('./routes');
const apiV1 = require('./api_v1');

// Costruisce l'app completa, pronta ad ascoltare.
function creaApp() {
  const app = express();
  configuraApp(app);

  // Un %00 nel percorso non è mai valido (Postgres lo rifiuta): 400 subito, prima di qualunque route.
  app.use(rifiutaNulNelPercorso);
  // Intestazioni di sicurezza su ogni risposta (helmet e regole del sito).
  app.use(intestazioniSicurezza());
  // Comprime le risposte per farle viaggiare più leggere.
  app.use(comprimiRisposte());

  // Webhook di Stripe: prima dei parser del corpo (la firma si verifica sul testo grezzo).
  app.use(webhookStripe);

  // File statici e favicon: prima della sessione e dei limiti.
  app.use(creaFileStatici());
  // Tetto generale di richieste al minuto per indirizzo (sotto, limiti più stretti su login, registrazione e ricerca).
  app.use(limiti.generale);

  // Legge il corpo delle richieste (moduli e JSON).
  app.use(leggiCorpo());

  // API dell'app nativa: autenticazione con token (Authorization: Bearer), niente cookie. Montata prima del controllo di origine, della sessione e del
  // middleware che prepara i dati delle viste: nessuno dei tre serve (né vale) per richieste che non vengono da un browser e non portano credenziali
  // "ambientali" sfruttabili da un sito terzo.
  app.use('/api/v1', apiV1);

  // Rifiuta le scritture che arrivano da un altro sito (protezione dagli invii falsi).
  app.use(controlloOrigine);
  // Riconosce chi è collegato (cookie di sessione salvato nel database).
  app.use(creaSessione());
  // Canale degli eventi in tempo reale: prima del middleware pesante delle viste, perché non ne ha bisogno.
  app.use(eventi);
  // Prepara i dati comuni a tutte le pagine (utente, carrello, contatori, icone).
  app.use(contestoViste);
  // Tutte le pagine e le API del sito, divise per argomento (src/routes).
  montaRotte(app);

  // Senza un gestore dedicato, un errore lanciato da una rotta finiva nel gestore di default di Express: fuori da NODE_ENV=production può restituire lo
  // stack trace al client, e comunque non è coerente con le pagine di errore già esistenti nell'app. Vanno registrati dopo tutte le rotte (Express
  // riconosce il gestore d'errore dai 4 parametri). Per /api/... rispondono in JSON, per il resto con la pagina `errore`; gli errori del client (JSON
  // malformato, corpo troppo grande) tengono il loro 4xx. Vedi src/http.js.
  // Indirizzo che non esiste: pagina o JSON di "non trovato".
  app.use(gestoreNonTrovato);
  // Ultima rete: ogni errore diventa una risposta pulita, senza dettagli tecnici.
  app.use(gestoreErrori);
  return app;
}

module.exports = { creaApp };
