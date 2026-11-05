// Punto d'ingresso del server: legge la configurazione, prepara il database, costruisce l'app (src/app.js) e la mette in ascolto.
// Il resto del codice sta in src/: config/ (impostazioni), middleware/ (difese e preparazione delle richieste), routes/ (le pagine e le API, per argomento),
// logica/ (la logica di business e le query al database, per area), comune/ (utilità senza database) e avvio/ (processo e servizi che partono con il server).

// Il .env va letto PER PRIMO: gli altri moduli leggono le variabili d'ambiente appena vengono caricati.
require('./src/config/ambiente');

const { preparaDatabase } = require('./src/avvio/database');
preparaDatabase();

const { creaApp } = require('./src/app');
const processo = require('./src/avvio/processo');
const servizi = require('./src/avvio/servizi');

const app = creaApp();

processo.installaGestoriProcesso();
// Le richieste scadono anche se nessuno sta guardando una pagina: controllo ogni 30 secondi.
servizi.avviaControlloScadenze();
servizi.descriviServizi();
// Gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/logica/whatsapp/whatsapp.js).
servizi.avviaWhatsapp();

const server = processo.ascolta(app);
processo.installaChiusura(server);
