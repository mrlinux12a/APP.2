const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const { creaEsecutore, eErroreDiRete, ErroreDbNonRaggiungibile } = require('./resilienza');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://minuteria:minuteria@localhost:5432/minuteria';

const isSupabase = DATABASE_URL.includes('supabase.co');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
  // Di default pg chiude i client rimasti fermi 10 secondi: con traffico a scatti (una
  // persona che tocca lo schermo ogni tanto) la richiesta dopo ogni pausa apriva una
  // connessione nuova verso il pooler, TCP + TLS + login = ~330-420 ms misurati, contro ~45 ms
  // di una query su una connessione già aperta. Il pooler di Supabase tiene aperte quelle
  // inattive per minuti (provato fino a 90 s), quindi le teniamo anche noi.
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
// con i connection pooler gestiti come quello di Supabase) emette un evento 'error' non
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

function esecutore() {
  const store = contestoTransazione.getStore();
  return store ? store.client : sulPool;
}

// Tabelle senza colonna "id" (chiave primaria naturale): un INSERT su queste tabelle
// non può chiedere "RETURNING id", altrimenti Postgres dà errore "column id does not exist".
const TABELLE_SENZA_ID = new Set(['session', 'config', 'macro_categorie', 'brands', 'ddt_counters', 'product_sottocategorie']);

function tabellaInsert(sql) {
  const m = sql.match(/^\s*INSERT INTO\s+"?(\w+)"?/i);
  return m ? m[1] : null;
}

function toPg(sql) {
  let s = sql;
  // sqlite -> pg translations
  s = s.replace(/datetime\('now',\s*'\+'\s*\|\|\s*\?\s*\|\|\s*'\s*minutes'\)/g, "NOW() + (? * INTERVAL '1 minute')");
  s = s.replace(/datetime\('now',\s*'\+'\s*\|\|\s*\?\s*\|\|\s*'\s*minutes'\)/gi, "NOW() + (? * INTERVAL '1 minute')");
  s = s.replace(/datetime\('now'\)/g, 'NOW()');
  s = s.replace(/strftime\('%Y',\s*'now'\)/g, 'EXTRACT(YEAR FROM NOW())');
  s = s.replace(/CAST\(\(julianday\(r\.scade_il\) - julianday\('now'\)\) \* 86400 AS INTEGER\)/g, 'EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int');
  s = s.replace(/CAST\(\(julianday\(\?\) - julianday\('now'\)\) \* 86400 AS INTEGER\)/g, "EXTRACT(EPOCH FROM (?::timestamp - NOW()))::int");
  s = s.replace(/julianday\('now'\)/g, 'NOW()');
  s = s.replace(/julianday\(([^)]+)\)/g, '$1');
  s = s.replace(/\bIFNULL\(/g, 'COALESCE(');
  // handle @named params and ?
  // We will replace ? with $n later, but need to handle mixed
  return s;
}

function prepare(sql) {
  // keep original for named detection
  const translated = toPg(sql);
  // detect named params @xxx
  const named = [];
  let m;
  const re = /@(\w+)/g;
  while ((m = re.exec(translated)) !== null) named.push(m[1]);
  let pgSql;
  if (named.length) {
    let idx = 0;
    pgSql = translated.replace(/@\w+/g, () => `$${++idx}`);
    // also replace remaining ? with $n continuing count
    pgSql = pgSql.replace(/\?/g, () => `$${++idx}`);
    return {
      get: async (...params) => {
        let arr;
        if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && named.length) {
          const obj = params[0];
          arr = named.map(k => obj[k] ?? obj['@'+k]);
          // if there are extra ? params after named, they would be in same object? not needed
        } else {
          // positional: flatten if single object with no named? fallback
          arr = params;
          if (params.length===1 && typeof params[0]==='object' && !Array.isArray(params[0]) && !named.length) {
            // shouldn't happen
            arr = Object.values(params[0]);
          }
        }
        const res = await esecutore().query(pgSql, arr);
        return res.rows[0] || null;
      },
      all: async (...params) => {
        let arr;
        if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && named.length) {
          const obj = params[0];
          arr = named.map(k => obj[k] ?? obj['@'+k]);
        } else {
          arr = params;
        }
        const res = await esecutore().query(pgSql, arr);
        return res.rows;
      },
      run: async (...params) => {
        let arr;
        if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && named.length) {
          const obj = params[0];
          arr = named.map(k => obj[k]);
          // also handle extra positional after
          if (params.length>1) arr = arr.concat(params.slice(1));
        } else {
          arr = params;
          // handle case where object passed with @ keys but we already handled
        }
        let q = pgSql;
        const isInsert = /^\s*INSERT/i.test(q) && !/RETURNING/i.test(q) && !TABELLE_SENZA_ID.has(tabellaInsert(q));
        if (isInsert) q += ' RETURNING id';
        const res = await esecutore().query(q, arr);
        const row = res.rows[0];
        return { lastInsertRowid: row ? row.id : null, lastInsertId: row ? row.id : null, changes: res.rowCount, rowCount: res.rowCount };
      },
    };
  }
  // positional only
  let i=0;
  let pgSql2 = translated.replace(/\?/g, () => `$${++i}`);
  return {
    get: async (...params) => {
      const res = await esecutore().query(pgSql2, params);
      return res.rows[0] || null;
    },
    all: async (...params) => {
      const res = await esecutore().query(pgSql2, params);
      return res.rows;
    },
    run: async (...params) => {
      let q = pgSql2;
      const isInsert = /^\s*INSERT/i.test(q) && !/RETURNING/i.test(q) && !TABELLE_SENZA_ID.has(tabellaInsert(q));
      if (isInsert) q += ' RETURNING id';
      const res = await esecutore().query(q, params);
      const row = res.rows[0];
      return { lastInsertRowid: row ? row.id : null, lastInsertId: row ? row.id : null, changes: res.rowCount, rowCount: res.rowCount };
    },
  };
}

async function exec(sql) {
  if (/^\s*PRAGMA/i.test(sql.trim())) return;
  const pgSql = toPg(sql);
  await esecutore().query(pgSql);
}

// ensureInit() NON applica più lo schema in automatico ad ogni avvio. L'avevamo protetto
// con un lucchetto (pg_advisory_lock) per evitare che due istanze serverless partite
// insieme si scontrassero, ma su Supabase in modalità "transaction pooler" (porta 6543)
// quel lucchetto non è affidabile: ogni comando può finire su una connessione fisica
// diversa dietro le quinte, quindi non protegge davvero nulla — il deadlock si è
// ripresentato lo stesso nei test.
//
// Lo schema va applicato una volta sola, deliberatamente, con:
//   node scripts/apply_schema_pg.js
// non ad ogni richiesta/avvio. Qui resta solo un controllo economico (una SELECT) per
// intercettare un database vuoto e avvisare, senza mai eseguire DDL in automatico.
let inited = false;
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
              '     Su una rete universitaria o aziendale (eduroam) il traffico Postgres verso il pooler Supabase viene spesso bloccato:\n' +
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

const db = {
  prepare,
  exec,
  query: (sql, params=[]) => esecutore().query(toPg(sql).replace(/\?/g, (()=>{let i=0; return ()=>`$${++i}`})()), params),
  get: async (sql, ...p) => {
    await ensureInit();
    const prep = prepare(sql);
    return prep.get(...p);
  },
  all: async (sql, ...p) => {
    await ensureInit();
    const prep = prepare(sql);
    return prep.all(...p);
  },
  run: async (sql, ...p) => {
    await ensureInit();
    const prep = prepare(sql);
    return prep.run(...p);
  },
  transaction,
  fuoriDallaTransazione,
  pool,
  ensureInit,
  mantieniCalde,
};

module.exports = db;
