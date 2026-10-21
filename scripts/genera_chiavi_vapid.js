// Genera una coppia di chiavi VAPID per le notifiche ad app chiusa (src/web_push.js) e dice cosa scrivere nel .env.
//
//   node scripts/genera_chiavi_vapid.js
//
// Le due chiavi vanno nel .env del server e NON si cambiano più (se cambiano, i telefoni già iscritti si riscrivono da soli alla prossima apertura
// dell'app, ma finché non l'aprono non ricevono niente). Una coppia DIVERSA per ogni ambiente: il PC di sviluppo parla col database di produzione, e con
// chiavi diverse non può mandare niente ai telefoni dei clienti veri (src/web_push.js usa solo le iscrizioni nate con la propria chiave pubblica).
// La chiave privata è un segreto come SESSION_SECRET: non va in git, non va incollata in chat.
const webpush = require('web-push');

const chiavi = webpush.generateVAPIDKeys();
console.log('Copia queste righe nel .env di questo server (poi riavvia):\n');
console.log('VAPID_PUBLIC_KEY=' + chiavi.publicKey);
console.log('VAPID_PRIVATE_KEY=' + chiavi.privateKey);
console.log('VAPID_SUBJECT=mailto:indirizzo-di-contatto@tuo-dominio.it');
console.log('\nVAPID_SUBJECT è il contatto che i servizi push (Google, Apple, Mozilla) possono usare per scrivere al gestore del sito: un indirizzo email');
console.log('(mailto:...) oppure l\'indirizzo https del sito. Se APP_URL è https puoi anche non scriverlo.');
console.log('\nSul PC di sviluppo serve https://localhost oppure mailto:..., non http (https richiesto da Apple e Google).');
