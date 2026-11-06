// I servizi che girano accanto al sito e partono con il server: il controllo periodico delle scadenze, il resoconto di Stripe e delle notifiche nel log e il
// gruppo WhatsApp dei corrieri. Il processo in sé (errori, porta, chiusura) sta in processo.js.
const richieste = require('../logica/ordini/richieste');
const flusso = require('../logica/ordini/flusso_cliente');
const stripePagamenti = require('../logica/pagamenti/stripe_pagamenti');
const webPush = require('../logica/notifiche/web_push');
const whatsapp = require('../logica/whatsapp/whatsapp');
const modalita = require('../logica/ordini/modalita_corrieri');
const { descriviIndirizzoDatabase } = require('../comune/indirizzo_database');

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

// Controlla, prima di partire, che i corrieri arrivino da un solo posto: l'app (CORRIERI_APP=1) o il gruppo WhatsApp (WHATSAPP_ATTIVO=1), mai tutti e due
// (ogni consegna andrebbe in due posti e due corrieri potrebbero prenderla). Ritorna il testo dell'errore, o null se va bene: se c'è, server.js non parte.
function controllaModalitaCorrieri() {
  return modalita.erroreConfigurazione();
}

// Scrive nel log come sono configurati il database, Stripe, le notifiche e i corrieri: meglio accorgersi di un .env sbagliato o incompleto all'avvio che al
// primo cliente. Il database si scrive senza utente né password: con due ambienti sulla stessa macchina (docs/ambienti.md) è la prima riga da controllare.
function descriviServizi() {
  console.log('[db] database: ' + (descriviIndirizzoDatabase(process.env.DATABASE_URL) || 'DATABASE_URL non scritta nel .env: si prova il Postgres di default sul computer'));
  if (stripePagamenti.attivo()) console.log('[stripe] ' + stripePagamenti.descrizioneModo());
  for (const avviso of stripePagamenti.controllaConfigurazione()) console.warn('[stripe] ' + avviso);
  console.log(webPush.descriviConfigurazione());
  console.log(
    '[corrieri] ' +
      (modalita.appAttiva()
        ? 'ambiente «app»: le consegne vanno ai corrieri nella loro app (CORRIERI_APP=1)'
        : whatsapp.attivo()
        ? 'ambiente «reale»: le consegne vanno al gruppo WhatsApp dei corrieri'
        : 'nessun canale per i corrieri: il banco conferma e l\'ordine nasce subito')
  );
}

// Avvia il gruppo WhatsApp dei corrieri: si collega solo con WHATSAPP_ATTIVO=1 (vedi src/logica/whatsapp/whatsapp.js).
function avviaWhatsapp() {
  // Cosa fare quando un corriere scrive "preso" o segna la consegna: lo decidono richieste.js e flusso_cliente.js, che qui si collegano al gruppo.
  whatsapp.impostaAzioni({ corriereHaPreso: richieste.corriereHaPreso, segnaConsegnatoDalCorriere: flusso.segnaConsegnatoDalCorriere });
  whatsapp.avvia();
}

module.exports = {
  avviaControlloScadenze,
  controllaModalitaCorrieri,
  descriviServizi,
  avviaWhatsapp,
};
