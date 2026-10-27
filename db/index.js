// Il database dell'app: Postgres. L'indirizzo si legge da DATABASE_URL (.env); se manca si prova un Postgres sul computer stesso
// (postgres://minuteria:minuteria@localhost:5432/minuteria). Gli altri moduli usano solo `db.prepare(sql).get/all/run(...valori)`, `db.transaction(...)`
// e `db.exec(sql)`: i valori non entrano mai nel testo della query, viaggiano a parte come parametri.
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const { creaEsecutore, eErroreDiRete, ErroreDbNonRaggiungibile } = require('./resilienza');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://minuteria:minuteria@localhost:5432/minuteria';

const pool = new Pool({
  // Nessuna opzione SSL: il Postgres sul server (e il tunnel SSH per arrivarci) non la usa. Con un database che la richiede basta scriverlo
  // nell'indirizzo, `DATABASE_URL=...?sslmode=require`.
  connectionString: DATABASE_URL,
  // Di default pg chiude i client rimasti fermi 10 secondi: con traffico a scatti (una
  // persona che tocca lo schermo ogni tanto) la richiesta dopo ogni pausa apriva una
  // connessione nuova, TCP + TLS + login = ~330-420 ms misurati (verso un database remoto), contro ~45 ms
  // di una query su una connessione già aperta. Tenere aperte quelle inattive per qualche minuto toglie l'attesa.
  idleTimeoutMillis: 5 * 60 * 1000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10 * 1000,
  // Senza un limite una connessione che non si stabilisce lasciava la richiesta appesa. Con il pooler una connessione che
  // funziona si apre in meno di un secondo (~400 ms da un PC): oltre 5 s non sta andando a buon fine (rete che blocca il
  // traffico Postgres, come eduroam) e conviene fallire, riprovare e poi rispondere con un errore chiaro (vedi resilienza.js).
  connectionTimeoutMillis: 5 * 1000,
  // Gli script (importazioni, seed) escono appena finiscono, senza aspettare i client fermi.
  allowExitOnIdle: true,
});

// Senza questo handler, un client idle del pool che perde la connessione (capita spesso
// con i database remoti, i pooler di connessioni e i tunnel SSH) emette un evento 'error' non
// intercettato: Node lo tratta come eccezione non gestita e fa cadere l'intero processo,
// non solo la richiesta interessata.
pool.on('error', (err) => {
  console.error('[db] connessione del pool interrotta:', err.message);
});

// Contesto per-transazione: prima si affidava l'esecuzione durante una transazione a una
// riassegnazione diretta di pool.query, ma è uno stato GLOBALE condiviso — con due
// transazioni concorrenti (normale in un'app multi-utente) la seconda sovrascriveva il
// client della prima, e al termine ne resettava la query "sotto i piedi" della prima
// ancora in corso: le sue istruzioni successive finivano fuori dalla transazione (o su
// quella sbagliata), rendendo falsa ogni garanzia di atomicità. AsyncLocalStorage lega il
// client al contesto asincrono della singola chiamata, quindi ogni transazione (anche se
// interlacciata con altre) resta isolata per tutta la sua catena di await.
const contestoTransazione = new AsyncLocalStorage();

// Fuori da una transazione le query passano da resilienza.js: riprova delle letture se la connessione cade e risposta
// immediata (503) quando la rete verso il database è giù. Dentro una transazione si usa il suo client, senza riprove.
const rete = creaEsecutore({ pool });
const sulPool = { query: (testo, params) => rete.interroga(testo, params) };

// Sceglie dove eseguire una query: nella transazione in corso se c'è, altrimenti sul gruppo di connessioni.
function esecutore() {
  const store = contestoTransazione.getStore();
  return store ? store.client : sulPool;
}

// Tabelle senza colonna "id" (chiave primaria naturale): un INSERT su queste tabelle
// non può chiedere "RETURNING id", altrimenti Postgres dà errore "column id does not exist".
const TABELLE_SENZA_ID = new Set(['session', 'config', 'macro_categorie', 'brands', 'product_sottocategorie']);

// Ricava da un INSERT il nome della tabella in cui scrive.
function tabellaInsert(sql) {
  const m = sql.match(/^\s*INSERT INTO\s+"?(\w+)"?/i);
  return m ? m[1] : null;
}

// Prepara una query. I valori non entrano MAI nel testo SQL: nel testo ci sono i segnaposto `?`, che qui diventano $1, $2, ... e i valori viaggiano a parte,
// come parametri della query (Postgres non li interpreta mai come SQL). Ritorna { get, all, run }: get = la prima riga (o null), all = tutte le righe,
// run = esegue e dice quante righe ha toccato (`changes`) e l'id dell'ultimo INSERT (`lastInsertRowid`: a ogni INSERT si aggiunge da sé `RETURNING id`,
// tranne sulle tabelle senza colonna id o se la query ha già un suo RETURNING).
function prepare(sql) {
  let n = 0;
  const testo = sql.replace(/\?/g, () => `$${++n}`);
  const chiedeId = /^\s*INSERT/i.test(testo) && !/RETURNING/i.test(testo) && !TABELLE_SENZA_ID.has(tabellaInsert(testo));
  return {
    get: async (...valori) => {
      const res = await esecutore().query(testo, valori);
      return res.rows[0] || null;
    },
    all: async (...valori) => {
      const res = await esecutore().query(testo, valori);
      return res.rows;
    },
    run: async (...valori) => {
      const res = await esecutore().query(chiedeId ? testo + ' RETURNING id' : testo, valori);
      const riga = res.rows[0];
      return { lastInsertRowid: riga ? riga.id : null, changes: res.rowCount };
    },
  };
}

// Esegue un'istruzione senza parametri (per esempio un CREATE TABLE IF NOT EXISTS).
async function exec(sql) {
  await esecutore().query(sql);
}

let inited = false;
// Controlla una volta sola che lo schema del database esista (una SELECT leggera) e, se manca, lo scrive nel log. Non lo crea MAI da sé: lo schema si applica
// una volta, a mano, con `node scripts/apply_schema_pg.js` (un lucchetto automatico all'avvio non è affidabile se più istanze partono insieme o c'è un
// pooler di mezzo). Se la rete è giù non segna il controllo come fatto.
async function ensureInit() {
  if (inited) return;
  try {
    await sulPool.query('SELECT 1 FROM config LIMIT 1');
  } catch (e) {
    // Rete giù: non c'entra lo schema. Non si segna come controllato: si rifà alla prossima chiamata.
    if (eErroreDiRete(e)) throw e;
    console.error(
      'Schema Postgres non trovato o incompleto. Applicalo una volta con: node scripts/apply_schema_pg.js',
      e.message
    );
  }
  inited = true;
}

// Trasforma una funzione in una transazione: tutte le query al suo interno riescono insieme o vengono annullate insieme. Se è già dentro una
// transazione usa quella.
function transaction(fn) {
  return async (...args) => {
    // Transazione già in corso su questa stessa catena di chiamate (una funzione
    // transazionale che ne invoca un'altra): Postgres non supporta transazioni annidate
    // vere, quindi si riusa lo stesso client invece di aprirne una seconda che
    // resterebbe in attesa di una connessione mai rilasciata.
    if (contestoTransazione.getStore()) return fn(...args);

    const client = await rete.collega(); // la connessione si riprova (nessuna query è ancora partita); la transazione no
    let rotto = null;
    try {
      await client.query('BEGIN');
      const result = await contestoTransazione.run({ client }, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      // Connessione caduta a metà: il server annulla da sé la transazione non confermata. Il client va buttato, non rimesso
      // nel pool, e a chi ha chiamato arriva lo stesso errore "database non raggiungibile" delle query fuori transazione.
      if (eErroreDiRete(e)) {
        rotto = e;
        throw e.dbNonRaggiungibile ? e : new ErroreDbNonRaggiungibile(e);
      }
      throw e;
    } finally {
      client.release(rotto || undefined);
    }
  };
}

// Apre subito qualche connessione e la tiene sveglia con una query minuscola ogni minuto:
// le prime richieste dopo l'avvio (o dopo una lunga pausa) trovano già connessioni pronte.
// Si chiama dal server, non dagli script: a loro non serve.
const CONNESSIONI_CALDE = 3;
// Tiene sveglie alcune connessioni al database con una query minuscola ogni minuto, e scrive nel log quando il database smette di rispondere e quando
// torna.
function mantieniCalde() {
  // Una riga di log quando il database smette di rispondere e una quando torna: senza, il log si riempie di "Connection
  // terminated" uno per richiesta e non si capisce che è la rete (o il database) il problema, non il codice.
  let raggiungibile = null;
  const scalda = () =>
    Promise.all(Array.from({ length: CONNESSIONI_CALDE }, () => sulPool.query('SELECT 1')))
      .then(() => {
        if (raggiungibile === false) console.log('[db] di nuovo raggiungibile.');
        raggiungibile = true;
      })
      .catch((err) => {
        if (raggiungibile !== false) {
          console.error(
            '[db] database NON raggiungibile da questa rete (' + (err.cause ? err.cause.message : err.message) + ').\n' +
              '     Su una rete universitaria o aziendale (eduroam) il traffico Postgres verso il database (o verso il tunnel SSH) può essere bloccato:\n' +
              '     il TCP si apre ma il server non risponde. Non è un errore dell\'app: usa l\'hotspot del telefono o una VPN.\n' +
              '     Per vedere a che punto si ferma: node scripts/diagnosi_rete_db.js'
          );
        }
        raggiungibile = false;
      });
  scalda();
  setInterval(scalda, 60 * 1000).unref();
}

// Esegue `fn` FUORI da qualunque transazione in corso. Un timer o un'operazione "senza aspettare" avviata DENTRO una transazione eredita il suo client
// (AsyncLocalStorage): quando poi gira, la transazione è chiusa e il client è già tornato nel pool, quindi le sue query andrebbero su una connessione
// che nel frattempo può servire un'altra richiesta (avviso di pg "Calling client.query() when the client is already executing a query", e nel
// caso peggiore scritture dentro la transazione di un altro). Chi avvia lavoro differito da dentro una transazione lo fa passare da qui.
function fuoriDallaTransazione(fn) {
  return contestoTransazione.exit(fn);
}

module.exports = {
  prepare,
  exec,
  transaction,
  fuoriDallaTransazione,
  ensureInit,
  mantieniCalde,
};
