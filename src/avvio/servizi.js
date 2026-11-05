// I servizi che girano accanto al sito e partono con il server: il controllo periodico delle scadenze, il resoconto di Stripe e delle notifiche nel log e il
// gruppo WhatsApp dei corrieri. Il processo in sé (errori, porta, chiusura) sta in processo.js.
const richieste = require('../logica/ordini/richieste');
const flusso = require('../logica/ordini/flusso_cliente');
const stripePagamenti = require('../logica/pagamenti/stripe_pagamenti');
const webPush = require('../logica/notifiche/web_push');
const whatsapp = require('../logica/whatsapp/whatsapp');

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
    // Incassi, rilasci e rimborsi su Stripe rimasti da fare (vedi src/logica/pagamenti/stripe_pagamenti.js): senza chiave non fa niente.
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

// Avvia il gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/logica/whatsapp/whatsapp.js).
function avviaWhatsapp() {
  // Cosa fare quando un corriere scrive "preso" o segna la consegna: lo decidono richieste.js e flusso_cliente.js, che qui si collegano al gruppo.
  whatsapp.impostaAzioni({ corriereHaPreso: richieste.corriereHaPreso, segnaConsegnatoDalCorriere: flusso.segnaConsegnatoDalCorriere });
  whatsapp.avvia();
}

module.exports = {
  avviaControlloScadenze,
  descriviServizi,
  avviaWhatsapp,
};
