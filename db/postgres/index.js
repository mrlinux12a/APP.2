const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://minuteria:minuteria@localhost:5432/minuteria';

const isSupabase = DATABASE_URL.includes('supabase.co');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
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

function esecutore() {
  const store = contestoTransazione.getStore();
  return store ? store.client : pool;
}

// Tabelle senza colonna "id" (chiave primaria naturale): un INSERT su queste tabelle
// non può chiedere "RETURNING id", altrimenti Postgres dà errore "column id does not exist".
const TABELLE_SENZA_ID = new Set(['session', 'config', 'macro_categorie', 'brands', 'ddt_counters']);

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
    await pool.query('SELECT 1 FROM config LIMIT 1');
  } catch (e) {
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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await contestoTransazione.run({ client }, () => fn(...args));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      client.release();
    }
  };
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
  pool,
  ensureInit,
};

module.exports = db;
