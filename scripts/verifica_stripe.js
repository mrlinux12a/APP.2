// Controlla la configurazione di Stripe senza fare nessun pagamento: SOLA LETTURA.
//
//   node scripts/verifica_stripe.js              controlla il modo scritto nel .env (STRIPE_MODO, o la chiave se non c'è)
//   node scripts/verifica_stripe.js --modo=live  controlla la serie REALE senza cambiare il .env
//   node scripts/verifica_stripe.js --modo=test  controlla la serie SANDBOX
//
// Cosa fa: mostra quale modo e quali chiavi (mascherate, mai intere), segnala quelle nel posto sbagliato, chiede a Stripe di che account sono (chiave valida,
// carte e bonifici abilitati) e se esiste il webhook verso APP_URL con gli eventi giusti. Non crea, non cambia e non incassa niente. Serve la rete verso
// api.stripe.com (dalla Wi-Fi dell'università potrebbe non arrivare: hotspot del telefono).
const argomento = process.argv.slice(2).find((a) => a.startsWith('--modo='));
require('dotenv').config({ quiet: true });
if (argomento) process.env.STRIPE_MODO = argomento.slice('--modo='.length);

const config = require('../src/stripe_config');

// Nasconde una chiave quasi per intero, così nel terminale se ne vedono solo l'inizio e la fine.
const maschera = (k) => (k ? (k.length > 14 ? k.slice(0, 8) + '…' + k.slice(-4) : k.slice(0, 4) + '…') : '(manca)');
const OK = '  ✔ ';
const NO = '  ✘ ';
const AVV = '  ! ';
const EVENTI_ATTESI = ['payment_intent.amount_capturable_updated', 'payment_intent.canceled'];

(async () => {
  const c = config.configurazione();
  console.log('Modo: ' + (c.modo === 'live' ? 'REALE (live)' : 'PROVA (sandbox)') + (c.dichiarato ? ' — scelto da STRIPE_MODO' : ' — dalla chiave segreta (nessun STRIPE_MODO)'));
  console.log(config.descrizione());
  console.log('');
  console.log('Chiave segreta:    ' + maschera(c.segreta));
  console.log('Chiave pubblicabile: ' + maschera(c.pubblicabile));
  console.log('Segreto webhook:   ' + maschera(c.webhook) + (c.altroWebhook ? '   (e quello dell\'altro modo: ' + maschera(c.altroWebhook) + ')' : ''));
  console.log('APP_URL:           ' + (process.env.APP_URL || '(manca)'));
  console.log('');

  let problemi = 0;
  for (const p of c.problemi) { console.log(NO + p); problemi++; }
  if (!c.segreta) { console.log(NO + 'Manca la chiave segreta per questo modo: nessun pagamento può partire.'); problemi++; }
  if (!c.pubblicabile) { console.log(NO + 'Manca la chiave pubblicabile: la pagina di pagamento non si apre.'); problemi++; }
  else if (!/^pk_(test|live)_/.test(c.pubblicabile)) console.log(AV_(`La chiave pubblicabile è senza prefisso: il sito la completa da solo (pk_${c.modo}_...), ma meglio scriverla intera.`));
  if (!c.webhook) { console.log(AV_('Manca il segreto del webhook: i pagamenti si raccolgono dal ritorno del cliente o dal timer (entro un minuto), senza webhook.')); }
  if (c.modo === 'live' && !/^https:\/\//i.test(process.env.APP_URL || '')) { console.log(NO + 'Con il pagamento REALE APP_URL deve essere un indirizzo https:// (Stripe.js e il webhook reale non accettano HTTP).'); problemi++; }
  if (/^(1|true|si|sì|yes)$/i.test(process.env.PAGAMENTO_SIMULATO_FORZA || '') && /^(1|true|si|sì|yes)$/i.test(process.env.PAGAMENTO_SIMULATO || '')) {
    console.log(NO + 'PAGAMENTO_SIMULATO=1 + PAGAMENTO_SIMULATO_FORZA=1: "Paga e invia" SALTA Stripe e i clienti ordinano senza pagare. Toglile dal .env per incassare davvero.'); problemi++;
  }
  if (!c.segreta) return fine(problemi);

  const Stripe = require('stripe');
  const stripe = new Stripe(c.segreta, { maxNetworkRetries: 1, timeout: 15000, appInfo: { name: 'Minuteria (verifica)' } });

  // 1) Di chi è la chiave
  try {
    const conto = await stripe.accounts.retrieve();
    const nome = (conto.business_profile && conto.business_profile.name) || (conto.settings && conto.settings.dashboard && conto.settings.dashboard.display_name) || '(senza nome)';
    console.log(OK + `Chiave valida: conto ${conto.id}, ${nome}, paese ${conto.country}.`);
    if (c.modo === 'live') {
      console.log((conto.charges_enabled ? OK : NO) + 'Pagamenti con carta ' + (conto.charges_enabled ? 'abilitati.' : 'NON ancora abilitati: completa l\'attivazione dell\'account nel Dashboard.'));
      if (conto.payouts_enabled) console.log(OK + 'Bonifici verso la tua banca abilitati.');
      else console.log(AV_('Bonifici verso la tua banca non ancora abilitati (IBAN o dati mancanti nel Dashboard).'));
      if (!conto.charges_enabled) problemi++;
    }
  } catch (e) {
    console.log(NO + 'Stripe non accetta la chiave segreta o non risponde: ' + e.message); problemi++;
    return fine(problemi);
  }

  // 2) Il webhook verso questo sito
  try {
    const lista = await stripe.webhookEndpoints.list({ limit: 30 });
    const atteso = (process.env.APP_URL || '').replace(/\/+$/, '') + '/webhooks/stripe';
    const nostro = lista.data.filter((w) => w.url === atteso);
    if (!process.env.APP_URL) console.log(AV_('APP_URL manca: non so quale webhook cercare.'));
    else if (!nostro.length) {
      console.log(NO + `Nessun webhook verso ${atteso} in questo modo di Stripe. Dashboard > Sviluppatori > Webhook > Aggiungi endpoint (eventi: ${EVENTI_ATTESI.join(', ')}).`);
      if (lista.data.length) console.log('    Webhook trovati: ' + lista.data.map((w) => w.url).join(', '));
      problemi++;
    } else {
      for (const w of nostro) {
        const mancanti = EVENTI_ATTESI.filter((e) => !(w.enabled_events.includes(e) || w.enabled_events.includes('*')));
        console.log((w.status === 'enabled' ? OK : NO) + `Webhook ${atteso}: ${w.status === 'enabled' ? 'attivo' : 'DISABILITATO'}.`);
        console.log((mancanti.length ? NO : OK) + (mancanti.length ? 'Mancano gli eventi: ' + mancanti.join(', ') + '.' : 'Eventi giusti (' + EVENTI_ATTESI.join(', ') + ').'));
        if (w.status !== 'enabled' || mancanti.length) problemi++;
      }
      console.log('    Il segreto whsec_ nel .env deve essere quello di QUESTO webhook (Dashboard > Webhook > Segreto di firma): non lo posso confrontare da qui.');
    }
  } catch (e) {
    console.log(AV_('Non riesco a leggere i webhook (la chiave potrebbe essere "ristretta" senza permesso di lettura): ' + e.message));
  }

  // 3) Apple Pay: il dominio del sito deve essere registrato su Stripe e il file di verifica deve essere pubblicato (solo avvisi: senza Apple Pay si paga con carta)
  try {
    const dominio = (() => { try { return new URL(process.env.APP_URL || '').hostname; } catch (e) { return ''; } })();
    const registrati = await stripe.applePayDomains.list({ limit: 100 });
    if (!dominio) console.log(AV_('APP_URL manca: non so quale dominio cercare per Apple Pay.'));
    else if (registrati.data.some((d) => d.domain_name === dominio)) console.log(OK + `Apple Pay: il dominio ${dominio} è registrato su Stripe.`);
    else console.log(AV_(`Apple Pay: il dominio ${dominio} NON è registrato su Stripe (Dashboard > Impostazioni > Metodi di pagamento > Apple Pay > Aggiungi un nuovo dominio). Senza, Apple Pay non compare.`));
    if (dominio && /^https:/i.test(process.env.APP_URL || '')) {
      const r = await fetch(process.env.APP_URL.replace(/\/+$/, '') + '/.well-known/apple-developer-merchantid-domain-association', { redirect: 'manual' }).catch(() => null);
      console.log(r && r.status === 200 ? OK + 'Il file di verifica per Apple Pay è pubblicato.' : AV_('Il file di verifica per Apple Pay NON è raggiungibile su ' + process.env.APP_URL + '/.well-known/apple-developer-merchantid-domain-association' + (r ? ' (risposta ' + r.status + ')' : '') + '. Lancia scripts/scarica_file_apple_pay.js, fai commit e deploy.'));
    }
  } catch (e) {
    console.log(AV_('Non riesco a leggere i domini di Apple Pay: ' + e.message));
  }
  fine(problemi);
})().catch((e) => { console.error('ERRORE', e.message); process.exit(1); });

// Aggiunge il segno degli avvisi davanti a una frase.
function AV_(testo) { return AVV + testo; }

// Scrive il riepilogo finale e termina con un codice che dice se c'è qualcosa da sistemare.
function fine(problemi) {
  console.log('');
  console.log(problemi ? `${problemi} cosa/e da sistemare prima di incassare.` : 'Tutto a posto per questo modo.');
  process.exit(problemi ? 2 : 0);
}
