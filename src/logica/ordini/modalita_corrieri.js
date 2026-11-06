// Come la richiesta arriva ai corrieri in QUESTA installazione del programma (docs/ambienti.md).
//
// Lo stesso codice gira in due ambienti separati, ognuno col suo database e il suo .env:
//   · ambiente «reale»: i corrieri stanno nel gruppo WhatsApp (WHATSAPP_ATTIVO=1), oppure non ci sono (modulo spento: il banco accetta e l'ordine nasce subito);
//   · ambiente «app»: i corrieri usano la loro app (CORRIERI_APP=1). Le richieste confermate dai banchi vanno lì, mai su WhatsApp.
// Non c'è nessuna scelta per singola richiesta: il modo lo decide l'installazione. I due modi non si mescolano (con tutti e due accesi il server non parte,
// vedi erroreConfigurazione) e senza CORRIERI_APP le rotte dei corrieri dell'app rispondono 404: il codice di prima si comporta come prima.
const whatsapp = require('../whatsapp/whatsapp');

// L'app dei corrieri è accesa in questa installazione? (CORRIERI_APP=1 nel .env)
function appAttiva() {
  return String(process.env.CORRIERI_APP || '').trim() === '1';
}

// La conferma del banco deve aspettare un corriere prima di arrivare all'installatore? Sì con l'app dei corrieri o con il gruppo WhatsApp acceso.
function conCorriere() {
  return appAttiva() || whatsapp.attivo();
}

// Se la configurazione non regge (l'app dei corrieri e WhatsApp accesi insieme) ritorna il testo dell'errore, altrimenti null.
function erroreConfigurazione() {
  if (appAttiva() && whatsapp.attivo()) {
    return (
      'CORRIERI_APP=1 e WHATSAPP_ATTIVO=1 sono accesi insieme: ogni consegna andrebbe sia nell\'app dei corrieri sia nel gruppo WhatsApp. ' +
      'Ne serve uno solo per ambiente (docs/ambienti.md).'
    );
  }
  return null;
}

module.exports = { appAttiva, conCorriere, erroreConfigurazione };
