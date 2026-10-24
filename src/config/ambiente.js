// Configurazione dell'ambiente: legge il file .env e prepara porta, indirizzo, cartelle del progetto e segreto delle sessioni.
// Va caricato PER PRIMO da server.js: gli altri moduli leggono le variabili d'ambiente (chiavi Stripe, WhatsApp...) appena vengono caricati,
// quindi il .env deve essere già letto.
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

// La cartella principale del progetto (quella con server.js, views/ e public/).
const radice = path.join(__dirname, '..', '..');
const cartellaViste = path.join(radice, 'views');
const cartellaPublic = path.join(radice, 'public');

// Su quale porta e su quale indirizzo ascolta il server. Di default solo sul computer stesso (127.0.0.1), che sulla VPS basta e avanza (davanti c'è il
// proxy). In locale, per aprire il sito dal telefono sulla stessa rete Wi-Fi, si mette HOST=0.0.0.0 nel .env.
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Sceglie il segreto con cui si firmano i cookie di sessione. Prima qui c'era un segreto fisso ('minuteria-mvp-demo-secret') usato come ripiego: era
// scritto nel sorgente, quindi pubblico per chiunque leggesse il repository — con quello chiunque può firmare cookie di sessione validi. La correzione
// giusta è impostare SESSION_SECRET nell'ambiente (.env in locale, variabili d'ambiente in produzione).
// Se manca, un valore casuale nuovo a ogni avvio invaliderebbe tutti i cookie già emessi (ogni deploy disconnetterebbe tutti, anche chi era a metà
// azione): meglio un ripiego STABILE, derivato da DATABASE_URL (che non cambia da un riavvio all'altro). Non è un segreto in più da proteggere: chi ha già
// DATABASE_URL ha accesso diretto al DB, ben oltre quello che potrebbe fare forgiando un cookie di sessione.
function scegliSegretoSessione() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  console.warn(
    'ATTENZIONE: SESSION_SECRET non impostata nell\'ambiente. Uso un valore derivato da ' +
    'DATABASE_URL (stabile fra i riavvii, ma meglio impostare SESSION_SECRET esplicitamente ' +
    'in .env e, in produzione, nelle variabili d\'ambiente del servizio di hosting).'
  );
  return crypto
    .createHash('sha256')
    .update('minuteria-session|' + (process.env.DATABASE_URL || 'sviluppo-locale'))
    .digest('hex');
}

const segretoSessione = scegliSegretoSessione();

module.exports = { radice, cartellaViste, cartellaPublic, PORT, HOST, segretoSessione };
