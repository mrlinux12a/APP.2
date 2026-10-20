// Configurazione di Stripe dal .env: pagamento REALE e pagamento in SANDBOX (prova) con le chiavi di entrambi nello stesso .env e UN interruttore.
//
//   STRIPE_MODO=live            pagamenti veri (soldi veri, carte vere)
//   STRIPE_MODO=test            sandbox di Stripe (carta 4242 4242 4242 4242, nessun addebito)
//   (STRIPE_MODO non scritto)   come prima: vale l'unica serie STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_WEBHOOK_SECRET, e il modo lo dice
//                               la chiave (sk_live_ = reale, altrimenti prova); senza chiavi il pagamento resta SIMULATO (sviluppo sul PC)
//
// Con STRIPE_MODO le chiavi si scrivono a coppie, una serie per modo (si cambia modo con una riga e un riavvio):
//   STRIPE_LIVE_SECRET_KEY=sk_live_...   STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_...   STRIPE_LIVE_WEBHOOK_SECRET=whsec_...
//   STRIPE_TEST_SECRET_KEY=sk_test_...   STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...   STRIPE_TEST_WEBHOOK_SECRET=whsec_...
// (sono accettati anche i vecchi nomi STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY / STRIPE_PUBLIC_KEY come ripiego, MA solo se sono del modo scelto: una chiave
// reale non si usa mai con STRIPE_MODO=test, né il contrario. Il vecchio STRIPE_WEBHOOK_SECRET vale solo insieme alla vecchia chiave segreta: un whsec_ non
// dice di che modo è, quindi con le serie separate ogni modo vuole il suo.)
//
// Sicurezza: una chiave nel posto sbagliato (sk_test_ in STRIPE_LIVE_SECRET_KEY) NON si usa e si scrive nel log all'avvio. E con STRIPE_MODO scritto
// Stripe resta ACCESO anche se la chiave manca: allora i pagamenti danno errore, NON ricadono nel pagamento simulato (che farebbe ordinare senza pagare).
//
// Il modo di ogni pagamento si salva sulla riga (stripe_pagamenti.modo) e ogni istanza lavora solo i suoi: passando da reale a prova (o viceversa) i
// pagamenti dell'altro modo restano fermi finché non si torna. Vedi README, "Pagamenti con Stripe".

const MODI = ['live', 'test'];
const NOMI_MODO = { live: 'live', reale: 'live', produzione: 'live', prod: 'live', test: 'test', prova: 'test', sandbox: 'test' };
const PREFISSO_SEGRETA = { live: /^(sk|rk)_live_/, test: /^(sk|rk)_test_/ };
const PREFISSO_PUBBLICA = { live: /^pk_live_/, test: /^pk_test_/ };
const DESCRIZIONE_CHIAVE = { live: 'reale (sk_live_...)', test: 'di prova (sk_test_...)' };

const env = (nome) => String(process.env[nome] || '').trim();

// Cosa c'è scritto in STRIPE_MODO: { modo: 'live' | 'test' | null, nonValido: testo | null }.
function modoDichiarato() {
  const grezzo = env('STRIPE_MODO');
  if (!grezzo) return { modo: null, nonValido: null };
  const chiave = grezzo.toLowerCase();
  const normalizzato = Object.hasOwn(NOMI_MODO, chiave) ? NOMI_MODO[chiave] : undefined; // hasOwn: "constructor" non è un modo
  return normalizzato ? { modo: normalizzato, nonValido: null } : { modo: null, nonValido: grezzo };
}

// La configurazione in uso: { dichiarato, modo, segreta, pubblicabile, webhook, altroWebhook, problemi }.
//  · `dichiarato`: STRIPE_MODO è scritto (e valido);
//  · `modo`: 'live' o 'test';
//  · `segreta`, `pubblicabile`, `webhook`: i valori da usare ('' se mancano o sono del modo sbagliato);
//  · `altroWebhook`: il segreto del webhook dell'ALTRO modo (se c'è), per accettare senza errori anche gli eventi di quell'endpoint e poi scartarli;
//  · `problemi`: testi per il log all'avvio, già pronti.
function configurazione() {
  const { modo: dichiarato, nonValido } = modoDichiarato();
  const problemi = [];
  if (nonValido) problemi.push(`STRIPE_MODO="${nonValido}" non è valido: scrivi live (reale) oppure test (sandbox). La riga è ignorata.`);

  // Vecchio modo: una sola serie di chiavi, il modo lo dice la chiave.
  if (!dichiarato) {
    const segreta = env('STRIPE_SECRET_KEY');
    return {
      dichiarato: false,
      modo: PREFISSO_SEGRETA.live.test(segreta) ? 'live' : 'test',
      segreta,
      pubblicabile: env('STRIPE_PUBLISHABLE_KEY') || env('STRIPE_PUBLIC_KEY'),
      webhook: env('STRIPE_WEBHOOK_SECRET'),
      altroWebhook: '',
      problemi,
    };
  }

  const M = dichiarato.toUpperCase();
  const altro = dichiarato === 'live' ? 'test' : 'live';

  // Chiave segreta: quella del modo; in sua mancanza la vecchia STRIPE_SECRET_KEY, ma solo se è di questo modo.
  let segreta = env(`STRIPE_${M}_SECRET_KEY`);
  if (segreta && !PREFISSO_SEGRETA[dichiarato].test(segreta)) {
    problemi.push(`STRIPE_${M}_SECRET_KEY non è una chiave ${DESCRIZIONE_CHIAVE[dichiarato]}: non la uso.`);
    segreta = '';
  }
  let segretaDaVecchia = false;
  if (!segreta) {
    const vecchia = env('STRIPE_SECRET_KEY');
    if (vecchia && PREFISSO_SEGRETA[dichiarato].test(vecchia)) { segreta = vecchia; segretaDaVecchia = true; }
    else if (vecchia) problemi.push(`STRIPE_MODO=${dichiarato} ma STRIPE_SECRET_KEY è di un altro modo: non la uso.`);
  }

  // Chiave pubblicabile: stessa regola (senza prefisso, copiata male, la completa stripe_pagamenti.chiavePubblica con quello della segreta).
  const haPrefissoAltro = (k) => PREFISSO_PUBBLICA[altro].test(k);
  let pubblicabile = env(`STRIPE_${M}_PUBLISHABLE_KEY`) || env(`STRIPE_${M}_PUBLIC_KEY`);
  if (pubblicabile && haPrefissoAltro(pubblicabile)) {
    problemi.push(`La chiave pubblicabile di STRIPE_${M}_ è dell'altro modo (pk_${altro}_...): non la uso.`);
    pubblicabile = '';
  }
  if (!pubblicabile) {
    const vecchia = env('STRIPE_PUBLISHABLE_KEY') || env('STRIPE_PUBLIC_KEY');
    if (vecchia && !haPrefissoAltro(vecchia)) pubblicabile = vecchia;
    else if (vecchia) problemi.push(`STRIPE_MODO=${dichiarato} ma la chiave pubblicabile senza serie è di un altro modo: non la uso.`);
  }

  return {
    dichiarato: true,
    modo: dichiarato,
    segreta,
    pubblicabile,
    // Il segreto del webhook (whsec_) NON ha un prefisso di modo: il vecchio STRIPE_WEBHOOK_SECRET si usa solo se anche la chiave segreta è quella vecchia (stessa
    // serie "senza modo"). Altrimenti un segreto di prova potrebbe finire a controllare i webhook reali, che da lì in poi verrebbero tutti respinti.
    webhook: env(`STRIPE_${M}_WEBHOOK_SECRET`) || (segretaDaVecchia ? env('STRIPE_WEBHOOK_SECRET') : ''),
    altroWebhook: env(`STRIPE_${altro.toUpperCase()}_WEBHOOK_SECRET`),
    problemi,
  };
}

// 'live' o 'test'.
const modo = () => configurazione().modo;

// Stripe è "acceso"? Sì se c'è la chiave segreta, OPPURE se STRIPE_MODO è scritto: in quel caso una chiave mancante è un errore da vedere, non un motivo per
// ricadere nel pagamento simulato (i clienti ordinerebbero senza pagare).
function attivo() {
  const c = configurazione();
  return c.dichiarato || c.segreta !== '';
}

const chiaveSegreta = () => configurazione().segreta;
const chiavePubblicabileGrezza = () => configurazione().pubblicabile;

// I segreti con cui si controlla la firma di un webhook: prima quello del modo in uso, poi (se c'è) quello dell'altro. Un endpoint di Stripe per modo può
// puntare allo stesso indirizzo: gli eventi dell'altro modo si firmano con l'altro segreto, vengono riconosciuti e poi scartati, senza errori che si accumulano.
function segretiWebhook() {
  const c = configurazione();
  return [c.webhook, c.altroWebhook].filter((segreto, i, tutti) => segreto && tutti.indexOf(segreto) === i);
}

// Una riga per il log all'avvio: in che modo sono i pagamenti.
function descrizione() {
  const c = configurazione();
  if (!attivo()) return 'spento: i pagamenti sono SIMULATI (nessun provider).';
  const origine = c.dichiarato ? `STRIPE_MODO=${c.modo}` : 'dalla chiave';
  return c.modo === 'live'
    ? `modalità REALE (live, ${origine}): i clienti pagano davvero, carte vere.`
    : `modalità PROVA (sandbox, ${origine}): nessun addebito reale, carta di prova 4242 4242 4242 4242.`;
}

module.exports = { MODI, configurazione, modo, attivo, chiaveSegreta, chiavePubblicabileGrezza, segretiWebhook, descrizione };
