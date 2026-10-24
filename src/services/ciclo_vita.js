// La vita del processo del server: i controlli periodici, l'avvio dei servizi collegati (Stripe, notifiche, WhatsApp), l'ascolto sulla porta e la chiusura
// pulita.
const os = require('os');
const richieste = require('../richieste');
const stripePagamenti = require('../stripe_pagamenti');
const webPush = require('../web_push');
const whatsapp = require('../whatsapp');
const eventi = require('../eventi');
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

// Un solo giro alla volta: se il DB è lento e uno dura più di 30 s, il successivo aspetta invece di sovrapporsi (le scritture sono atomiche, ma due giri
// insieme raddoppiano inutilmente il carico).
let controlloScadenzeInCorso = false;

// Controlla le scadenze anche se nessuno sta guardando una pagina: chiude le finestre di risposta scadute (e fa tornare i pagamenti), riprova gli ordini
// rimasti a metà e fa eseguire a Stripe incassi, rilasci e rimborsi in sospeso. Così la notifica "nessuna conferma" arriva comunque allo scadere dei 10 minuti.
async function controllaScadenze() {
  if (controlloScadenzeInCorso) return;
  controlloScadenzeInCorso = true;
  try {
    // Chiude le finestre scadute (rimborso) e riprova gli ordini rimasti a metà (vedi assegnaOrdine).
    await richieste.aggiornaScadenzeAperte();
    // Incassi, rilasci e rimborsi su Stripe rimasti da fare (vedi src/stripe_pagamenti.js): senza chiave non fa niente.
    await stripePagamenti.elabora();
  } catch (err) {
    console.error('Errore nel controllo scadenze:', err.message);
  } finally {
    controlloScadenzeInCorso = false;
  }
}

// Fa partire il controllo delle scadenze subito e poi ogni 30 secondi.
function avviaControlloScadenze() {
  controllaScadenze();
  setInterval(controllaScadenze, 30 * 1000).unref();
}

// Scrive nel log come sono configurati Stripe e le notifiche: meglio accorgersi di un .env incompleto all'avvio che al primo cliente.
function descriviServizi() {
  if (stripePagamenti.attivo()) console.log('[stripe] ' + stripePagamenti.descrizioneModo());
  for (const avviso of stripePagamenti.controllaConfigurazione()) console.warn('[stripe] ' + avviso);
  console.log(webPush.descriviConfigurazione());
}

// Avvia il gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/whatsapp.js).
function avviaWhatsapp() {
  whatsapp.avvia();
}

// Mette il server in ascolto sulla porta e, se è aperto alla rete locale, scrive gli indirizzi con cui lo raggiunge il telefono.
function ascolta(app) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server minuteria in ascolto su http://localhost:${PORT}`);
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
  controllaScadenze,
  avviaControlloScadenze,
  descriviServizi,
  avviaWhatsapp,
  ascolta,
  chiudiConGrazia,
  installaChiusura,
};
