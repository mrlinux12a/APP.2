// Punto d'ingresso del server: legge la configurazione, prepara il database, costruisce l'app (src/app.js) e la mette in ascolto.
// Il resto del codice sta in src/: config/ (impostazioni), middleware/ (difese e preparazione delle richieste), routes/ (le pagine e le API, per argomento),
// services/ (pezzi di logica condivisi dalle rotte) e i moduli di dominio (pricing, richieste, flusso_cliente...).

// Il .env va letto PER PRIMO: gli altri moduli leggono le variabili d'ambiente appena vengono caricati.
require('./src/config/ambiente');

const { preparaDatabase } = require('./src/services/database');
preparaDatabase();

const { creaApp } = require('./src/app');
const cicloVita = require('./src/services/ciclo_vita');

const app = creaApp();

cicloVita.installaGestoriProcesso();
// Le richieste scadono anche se nessuno sta guardando una pagina: controllo ogni 30 secondi.
cicloVita.avviaControlloScadenze();
cicloVita.descriviServizi();
// Gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/whatsapp.js).
cicloVita.avviaWhatsapp();

const server = cicloVita.ascolta(app);
cicloVita.installaChiusura(server);
