// Manda una notifica di prova ai browser iscritti di un utente (sola lettura sul DB: non crea notifiche, non cambia niente) e dice cosa è successo con ognuno.
//
//   node scripts/prova_push.js <nome-utente>            (invio vero; con il DB di produzione nel .env parla con i telefoni veri di quell'utente)
//   node scripts/prova_push.js <nome-utente> --elenco   (solo l'elenco delle iscrizioni, senza mandare niente)
//
// Serve a controllare la strada intera: chiavi VAPID del .env → servizio push (Google/Apple/Mozilla) → telefono, anche con l'app chiusa. Per provarla davvero:
// iscrivi il telefono (profilo › Sul telefono › Attiva), CHIUDI l'app, poi lancia questo comando dal server (sulla VPS, con le sue chiavi).
// Per ogni iscrizione scrive il servizio push (host) e l'esito: 201 = accettata dal servizio push (poi tocca a lui consegnarla), 404/410 = il browser
// non è più iscritto (si cancella), altro = errore. Una iscrizione nata con un'altra coppia di chiavi (un altro ambiente) si elenca ma non si usa.
require('dotenv').config();
const webpush = require('web-push');
const db = require('../db');
const webPush = require('../src/web_push');

const nome = process.argv[2];
const soloElenco = process.argv.includes('--elenco');
if (!nome || nome.startsWith('--')) {
  console.error('Uso: node scripts/prova_push.js <nome-utente> [--elenco]');
  process.exit(1);
}

(async () => {
  const cfg = webPush.configurazione();
  console.log(webPush.descriviConfigurazione());
  const utente = await db.prepare('SELECT id, username, ruolo FROM users WHERE username = ?').get(nome);
  if (!utente) throw new Error('Utente "' + nome + '" non trovato.');
  const righe = await db.prepare('SELECT id, endpoint, p256dh, auth, chiave, user_agent, aggiornato_il FROM iscrizioni_push WHERE user_id = ? ORDER BY id').all(utente.id);
  console.log('Utente ' + utente.username + ' (' + utente.ruolo + '): ' + righe.length + ' iscrizioni.');
  for (const r of righe) {
    const mia = cfg && r.chiave === cfg.pubblica;
    console.log('  #' + r.id + ' ' + new URL(r.endpoint).hostname + ' · ' + (mia ? 'chiave di questo server' : 'ALTRA chiave (altro ambiente: non si usa)') + ' · ' + String(r.user_agent || '').slice(0, 60));
  }
  if (soloElenco) return;
  if (!webPush.attivo()) throw new Error('Notifiche ad app chiusa spente su questo server (vedi sopra cosa manca nel .env).');
  const proprie = righe.filter((r) => r.chiave === cfg.pubblica);
  if (!proprie.length) throw new Error('Nessuna iscrizione di questo utente per la chiave di questo server: attiva le notifiche dal telefono (profilo › Sul telefono › Attiva).');
  const payload = JSON.stringify({ titolo: 'Notifica di prova', testo: 'Dal server: le notifiche arrivano anche ad app chiusa.', link: '/', tag: 'minuteria-prova', tipo: 'prova' });
  for (const r of proprie) {
    try {
      const esito = await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
        TTL: 300, urgency: 'high', timeout: 8000, vapidDetails: { subject: cfg.soggetto, publicKey: cfg.pubblica, privateKey: cfg.privata },
      });
      console.log('  #' + r.id + ' → ' + esito.statusCode + ' accettata dal servizio push');
    } catch (err) {
      console.log('  #' + r.id + ' → ' + (err.statusCode || err.code || err.message) + (err.statusCode === 404 || err.statusCode === 410 ? ' (il browser non è più iscritto: la riga si toglie col prossimo invio vero)' : ''));
      if (err.body) console.log('      ' + String(err.body).slice(0, 200));
    }
  }
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(), 200));
