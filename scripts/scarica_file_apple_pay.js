// Scarica da Stripe il file di verifica del dominio per Apple Pay e lo mette in public/.well-known/ (dove server.js lo pubblica).
//
//   node scripts/scarica_file_apple_pay.js
//
// Il file è lo stesso per tutti i conti Stripe (https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association): è un testo che Apple legge
// per controllare che il dominio sia quello registrato su Stripe. Non contiene segreti. Dopo averlo scaricato va messo in git (o sulla VPS) e il dominio va
// aggiunto nel Dashboard di Stripe: Impostazioni > Metodi di pagamento > Apple Pay > Aggiungi un nuovo dominio.
const fs = require('fs');
const path = require('path');

const URL_FILE = 'https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association';
const DESTINAZIONE = path.join(__dirname, '..', 'public', '.well-known', 'apple-developer-merchantid-domain-association');

(async () => {
  const risposta = await fetch(URL_FILE, { headers: { 'User-Agent': 'Minuteria/1.0 (verifica dominio Apple Pay)' } });
  if (!risposta.ok) throw new Error('Stripe ha risposto ' + risposta.status);
  const testo = await risposta.text();
  // Il file è una lunga riga esadecimale: se è vuoto o ha altro dentro, qualcosa non va e non si scrive.
  if (!/^[0-9a-fA-F\s]{200,}$/.test(testo)) throw new Error('Il file scaricato non ha la forma attesa (' + testo.length + ' caratteri): non lo salvo.');
  fs.mkdirSync(path.dirname(DESTINAZIONE), { recursive: true });
  fs.writeFileSync(DESTINAZIONE, testo);
  console.log('Salvato ' + path.relative(process.cwd(), DESTINAZIONE) + ' (' + testo.length + ' caratteri).');
})().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
