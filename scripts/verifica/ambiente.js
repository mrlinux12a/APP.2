// Controlla il .env di un'installazione e il suo database, e dice se è un ambiente «reale» o «app» ben configurato (vedi docs/ambienti.md).
// Non scrive niente, non stampa mai chiavi o password: solo se ci sono, di che modo sono e cosa non torna. Esce con 1 se trova almeno un ERRORE.
//
// Uso:  node scripts/verifica/ambiente.js [--atteso app|reale] [--env percorso/del/.env] [--senza-database]
//   --atteso   dice che ambiente dovrebbe essere: se il .env è dell'altro, è un errore (utile per non confondere le due cartelle sulla VPS);
//   --env      un altro file al posto del .env della cartella;
//   --senza-database  controlla solo il .env (per quando il database nuovo non esiste ancora).
const fs = require('fs');
const path = require('path');

// Gli argomenti si leggono per primi: il file .env va caricato PRIMA dei moduli del programma, che leggono l'ambiente.
function leggiArgomenti(argv) {
  const out = { atteso: null, env: null, senzaDatabase: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--senza-database') out.senzaDatabase = true;
    else if (a === '--atteso' || a === '--env') {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`Argomento non riconosciuto: ${a}`);
  }
  if (out.atteso && !['app', 'reale'].includes(out.atteso)) throw new Error('--atteso vuole «app» oppure «reale».');
  return out;
}

const arg = leggiArgomenti(process.argv.slice(2));
if (arg.env && !fs.existsSync(path.resolve(arg.env))) {
  console.error(`ERRORE: il file ${arg.env} non esiste.`);
  process.exit(1);
}
require('dotenv').config({ path: arg.env ? path.resolve(arg.env) : undefined, quiet: true });

const { Client } = require('pg');
const { descriviIndirizzoDatabase } = require('../../src/comune/indirizzo_database');
const modalita = require('../../src/logica/ordini/modalita_corrieri');
const whatsapp = require('../../src/logica/whatsapp/whatsapp');
const stripeConfig = require('../../src/logica/pagamenti/stripe_config');

const TABELLE_NECESSARIE = ['users', 'products', 'distributors', 'ditte', 'orders', 'order_items', 'requests', 'request_responses', 'config', 'session', 'app_tokens', 'dispositivi_push', 'iscrizioni_push', 'stripe_pagamenti'];
// Le colonne che servono solo all'ambiente «app» (blocco «App dei corrieri» di db/schema.sql).
const COLONNE_APP = [
  ['users', 'corriere_disponibile'],
  ['users', 'supervisore_id'],
  ['request_responses', 'corriere_id'],
  ['request_responses', 'consegna_km'],
  ['request_responses', 'corriere_km'],
  ['orders', 'corriere_id'],
  ['orders', 'ritirato_il'],
];

// Gli utenti del seed demo (db/seed.js): hanno password scritte nel README e non devono esistere in un ambiente raggiungibile da Internet.
const UTENTI_DEMO = ['agente', 'rossi', 'bianchi', 'verdi', 'afis', 'borea', 'cambielli', 'fidra', 'fegino', 'staglieno'];

const env = (nome) => String(process.env[nome] || '').trim();
const risultati = [];
// Aggiunge una riga al referto: stato = ok | avviso | errore.
const dici = (stato, testo) => risultati.push({ stato, testo });

// «server:porta/database» di un indirizzo di connessione, senza utente né password.
const descrivi = (indirizzo) => descriviIndirizzoDatabase(indirizzo) || '(indirizzo non valido)';

// Che ambiente è questo .env: «app» (CORRIERI_APP=1), «reale» (gruppo WhatsApp) oppure «nessuno» (né l'uno né l'altro).
function ambienteDichiarato() {
  if (modalita.appAttiva()) return 'app';
  if (whatsapp.attivo()) return 'reale';
  return 'nessuno';
}

// I corrieri arrivano da un solo posto, e dal posto giusto.
function controllaCorrieri() {
  const errore = modalita.erroreConfigurazione();
  if (errore) return dici('errore', errore);
  const ambiente = ambienteDichiarato();
  if (ambiente === 'app') dici('ok', 'Corrieri: ambiente «app» (CORRIERI_APP=1), WhatsApp spento: le consegne vanno ai corrieri nella loro app.');
  else if (ambiente === 'reale') dici('ok', 'Corrieri: ambiente «reale» (WHATSAPP_ATTIVO=1): le consegne vanno al gruppo WhatsApp.');
  else dici('avviso', 'Corrieri: né CORRIERI_APP=1 né WHATSAPP_ATTIVO=1: nessun canale, il banco conferma e l\'ordine nasce subito (va bene solo per provare il sito).');
  if (arg.atteso === 'app' && ambiente !== 'app') dici('errore', 'Doveva essere l\'ambiente «app» ma nel .env manca CORRIERI_APP=1: sei nella cartella sbagliata?');
  if (arg.atteso === 'reale' && ambiente === 'app') dici('errore', 'Doveva essere l\'ambiente «reale» ma nel .env c\'è CORRIERI_APP=1: sei nella cartella sbagliata?');
}

// Pagamenti, indirizzo pubblico, sessioni e notifiche.
function controllaServizi(ambiente) {
  const pagamenti = stripeConfig.descrizione();
  if (ambiente === 'app' && stripeConfig.attivo() && stripeConfig.modo() === 'live') {
    dici('errore', 'Pagamenti: l\'ambiente «app» è in modalità REALE (carte vere). Deve usare solo la sandbox: STRIPE_MODO=test con le chiavi STRIPE_TEST_...');
  } else {
    dici('ok', 'Pagamenti: ' + pagamenti);
  }
  for (const problema of stripeConfig.configurazione().problemi) dici('avviso', 'Pagamenti: ' + problema);
  if (ambiente === 'app' && stripeConfig.attivo() && stripeConfig.modo() === 'test' && !stripeConfig.configurazione().webhook) {
    dici('avviso', 'Pagamenti: manca STRIPE_TEST_WEBHOOK_SECRET: i pagamenti partono ma il webhook di prova non viene riconosciuto (docs/guide/stripe-setup.md).');
  }
  // Nell'ambiente «app» non deve esserci nessuna chiave reale: neanche ferma, così una riga sbagliata non può mai incassare soldi veri.
  if (ambiente === 'app') {
    const nomiStripe = Object.keys(process.env).filter((k) => k.startsWith('STRIPE_') && env(k));
    const chiaveRealeFuoriPosto = nomiStripe.some((k) => !k.startsWith('STRIPE_LIVE_') && /^(sk|rk|pk)_live_/.test(env(k)));
    if (chiaveRealeFuoriPosto) dici('errore', 'Pagamenti: una variabile STRIPE_ contiene una chiave REALE (sk_live_...): nell\'ambiente «app» non ce ne deve essere nessuna.');
    else if (nomiStripe.some((k) => k.startsWith('STRIPE_LIVE_'))) dici('avviso', 'Pagamenti: nel .env ci sono chiavi STRIPE_LIVE_...: nell\'ambiente «app» non servono, meglio toglierle.');
  }
  if (/^(1|true|si|sì|yes)$/i.test(env('PAGAMENTO_SIMULATO_FORZA'))) dici('avviso', 'Pagamenti: PAGAMENTO_SIMULATO_FORZA=1 salta Stripe anche qui: da usare solo di proposito.');

  const appUrl = env('APP_URL');
  if (!appUrl) dici('avviso', 'APP_URL manca: il ritorno dal pagamento e i link nelle email non sapranno l\'indirizzo del sito.');
  else if (!/^https:\/\//i.test(appUrl)) dici('avviso', `APP_URL (${appUrl}) non è https: Stripe, le notifiche push e l'app sul telefono vogliono HTTPS.`);
  else dici('ok', `Indirizzo pubblico: ${appUrl} (nell'app mobile deve essere lo stesso: EXPO_PUBLIC_API_URL).`);

  if (!env('SESSION_SECRET')) dici('avviso', 'SESSION_SECRET manca: senza, le sessioni del sito non sono firmate con un segreto tuo.');
  else dici('ok', 'SESSION_SECRET presente (ogni ambiente deve averne uno suo).');

  const push = require('../../src/logica/notifiche/web_push').descriviConfigurazione();
  dici(/accese/.test(push) ? 'ok' : 'avviso', 'Notifiche: ' + push.replace(/^\[web push\]\s*/, ''));
}

// Il database: si apre, è in UTC, ha lo schema giusto e (nell'ambiente app) ha dentro il catalogo.
async function controllaDatabase(ambiente) {
  const indirizzo = env('DATABASE_URL');
  if (!indirizzo) {
    return dici('errore', 'DATABASE_URL manca nel .env: senza, il programma proverebbe un Postgres di default sul computer (postgres://minuteria@localhost). Scrivi l\'indirizzo del database di QUESTO ambiente.');
  }
  const c = new Client({ connectionString: indirizzo, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
  } catch (e) {
    return dici('errore', `Database ${descrivi(indirizzo)}: non riesco a collegarmi (${e.message || e.code}).`);
  }
  try {
    const { db, fuso } = (await c.query("SELECT current_database() AS db, current_setting('TimeZone') AS fuso")).rows[0];
    dici('ok', `Database: ${descrivi(indirizzo)} (${db}).`);
    if (['UTC', 'Etc/UTC'].includes(fuso)) dici('ok', 'Database: fuso orario UTC.');
    else dici('errore', `Database: fuso orario "${fuso}", deve essere UTC: ALTER DATABASE ${db} SET timezone TO 'UTC'; (i campi data senza fuso si leggerebbero sfasati di qualche ora).`);

    const presenti = new Set((await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r) => r.table_name));
    const mancanti = TABELLE_NECESSARIE.filter((t) => !presenti.has(t));
    if (mancanti.length) {
      return dici('errore', `Schema: mancano le tabelle ${mancanti.join(', ')}: applica db/schema.sql (node scripts/db/apply_schema_pg.js).`);
    }
    dici('ok', 'Schema: tabelle principali presenti.');

    const colonne = new Set((await c.query("SELECT table_name || '.' || column_name AS nome FROM information_schema.columns WHERE table_schema = 'public'")).rows.map((r) => r.nome));
    const senzaColonne = COLONNE_APP.map(([t, col]) => `${t}.${col}`).filter((n) => !colonne.has(n));
    if (ambiente === 'app') {
      if (senzaColonne.length) dici('errore', `Schema: mancano le colonne dell'app dei corrieri (${senzaColonne.join(', ')}): applica il blocco «App dei corrieri» di db/schema.sql.`);
      else dici('ok', 'Schema: colonne dell\'app dei corrieri presenti.');
    } else if (senzaColonne.length) {
      dici('ok', `Schema: ${senzaColonne.length} colonne dell'app dei corrieri non ci sono, e va bene: l'ambiente senza app non le usa.`);
    }

    const n = async (sql) => (await c.query(sql)).rows[0].n;
    const prodotti = await n('SELECT COUNT(*)::int AS n FROM products');
    const banchi = await n('SELECT COUNT(*)::int AS n FROM distributors WHERE attivo = 1');
    const utentiBanco = await n("SELECT COUNT(*)::int AS n FROM users WHERE ruolo = 'distributore' AND attivo = 1");
    dici(prodotti > 0 ? 'ok' : 'errore', `Catalogo: ${prodotti} prodotti, ${banchi} banchi attivi, ${utentiBanco} utenti banco attivi.${prodotti === 0 ? ' Il catalogo è vuoto: scripts/ambiente_app/prepara_database.js.' : ''}`);
    if (banchi > 0 && utentiBanco === 0) dici('avviso', 'Nessun utente banco attivo: nessuno potrà confermare le richieste (scripts/ambiente_app/prepara_database.js li crea).');
    const persone = (await c.query("SELECT ruolo, COUNT(*)::int AS n FROM users WHERE attivo = 1 GROUP BY ruolo ORDER BY ruolo")).rows;
    dici('ok', 'Utenti attivi: ' + (persone.map((r) => `${r.n} ${r.ruolo}`).join(', ') || 'nessuno'));

    const demo = (await c.query('SELECT username FROM users WHERE username = ANY($1::text[]) ORDER BY username', [UTENTI_DEMO])).rows.map((r) => r.username);
    if (demo.length && ambiente === 'app') {
      dici('errore', `Utenti demo del seed con password note (README): ${demo.join(', ')}. Nell'ambiente «app» non devono esserci: crea il database di nuovo con scripts/ambiente_app/prepara_database.js.`);
    } else if (demo.length) {
      dici('avviso', `Ci sono utenti con i nomi del seed demo (${demo.join(', ')}): se hanno ancora le password del README vanno cambiate prima di far provare il sito a qualcuno.`);
    }
  } finally {
    await c.end().catch(() => {});
  }
}

async function main() {
  controllaCorrieri();
  const ambiente = ambienteDichiarato();
  controllaServizi(ambiente);
  if (!arg.senzaDatabase) await controllaDatabase(ambiente);

  const etichetta = { ok: 'OK ', avviso: '!! ', errore: 'KO ' };
  console.log(`Ambiente: «${ambiente}»${arg.env ? ' (file ' + arg.env + ')' : ''}`);
  for (const r of risultati) console.log(`${etichetta[r.stato]} ${r.testo}`);
  const errori = risultati.filter((r) => r.stato === 'errore').length;
  const avvisi = risultati.filter((r) => r.stato === 'avviso').length;
  const parole = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;
  console.log(
    errori
      ? `\nTROVATI ${parole(errori, 'ERRORE', 'ERRORI')} (e ${parole(avvisi, 'avviso', 'avvisi')}): sistemali prima di accendere l'ambiente.`
      : `\nNessun errore${avvisi ? `, ${parole(avvisi, 'avviso', 'avvisi')} da guardare` : ''}.`
  );
  process.exitCode = errori ? 1 : 0;
}

main().catch((e) => {
  console.error('ERRORE:', e.message);
  process.exit(1);
});
