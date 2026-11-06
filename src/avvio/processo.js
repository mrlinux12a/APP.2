// Il processo Node del server: le reti di sicurezza per gli errori, l'ascolto sulla porta e la chiusura pulita. I servizi che girano accanto al sito
// (controllo delle scadenze, Stripe, WhatsApp) stanno in servizi.js.
const os = require('os');
const eventi = require('../logica/notifiche/eventi');
const { PORT, HOST } = require('../config/ambiente');

// Reti di sicurezza a livello di processo: prima non c'erano, quindi un errore sfuggito (es. una Promise rifiutata senza .catch) poteva passare
// inosservato nei log, o — nel caso di un'eccezione davvero non gestita — lasciare il processo in uno stato incerto senza che nessuno se ne accorgesse.
// Sull'eccezione non gestita si esce deliberatamente (invece di continuare a girare in uno stato che potrebbe essere corrotto): se l'app è tenuta in vita
// da un process manager/hosting che la riavvia, è la scelta più sicura.
function installaGestoriProcesso() {
  process.on('unhandledRejection', (motivo) => {
    console.error('Promise rifiutata senza gestione:', motivo);
  });
  process.on('uncaughtException', (err) => {
    console.error('Eccezione non gestita, arresto il processo:', err);
    process.exit(1);
  });
}

// Mette il server in ascolto sulla porta e, se è aperto alla rete locale, scrive gli indirizzi con cui lo raggiunge il telefono.
function ascolta(app) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server Flash Delivery in ascolto su http://localhost:${PORT}`);
    if (HOST === '0.0.0.0' || HOST === '::') {
      // Gli indirizzi con cui lo raggiunge il telefono (IPv4 delle schede di rete, escluse quelle virtuali di loopback).
      for (const schede of Object.values(os.networkInterfaces())) {
        for (const s of schede || []) {
          if (s.family === 'IPv4' && !s.internal) console.log(`  dalla rete locale: http://${s.address}:${PORT}`);
        }
      }
    }
  });
  return server;
}

// Chiude il server in modo pulito: pm2 (e Ctrl+C in locale) chiedono la chiusura con un segnale: si smette di accettare richieste nuove e si lascia
// finire quelle in corso, invece di troncarle a metà (un ordine o un pagamento a metà strada). Dopo 10 secondi si esce comunque.
function chiudiConGrazia(server, segnale) {
  console.log(`${segnale}: chiudo il server...`);
  eventi.chiudiTutti(); // le connessioni degli eventi non finiscono da sole e terrebbero aperto il server
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10 * 1000).unref();
}

// Collega la chiusura pulita ai segnali di arresto.
function installaChiusura(server) {
  process.on('SIGTERM', () => chiudiConGrazia(server, 'SIGTERM'));
  process.on('SIGINT', () => chiudiConGrazia(server, 'SIGINT'));
}

module.exports = {
  installaGestoriProcesso,
  ascolta,
  installaChiusura,
};
