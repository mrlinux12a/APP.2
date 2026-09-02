const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://minuteria:minuteria@localhost:5432/minuteria';

const isSupabase = DATABASE_URL.includes('supabase.co');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
});

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
        const res = await pool.query(pgSql, arr);
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
        const res = await pool.query(pgSql, arr);
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
        const res = await pool.query(q, arr);
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
      const res = await pool.query(pgSql2, params);
      return res.rows[0] || null;
    },
    all: async (...params) => {
      const res = await pool.query(pgSql2, params);
      return res.rows;
    },
    run: async (...params) => {
      let q = pgSql2;
      const isInsert = /^\s*INSERT/i.test(q) && !/RETURNING/i.test(q) && !TABELLE_SENZA_ID.has(tabellaInsert(q));
      if (isInsert) q += ' RETURNING id';
      const res = await pool.query(q, params);
      const row = res.rows[0];
      return { lastInsertRowid: row ? row.id : null, lastInsertId: row ? row.id : null, changes: res.rowCount, rowCount: res.rowCount };
    },
  };
}

async function exec(sql) {
  if (/^\s*PRAGMA/i.test(sql.trim())) return;
  const pgSql = toPg(sql);
  await pool.query(pgSql);
}

let inited = false;
async function ensureInit() {
  if (inited) return;
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  try {
    await pool.query(schema);
  } catch (e) {
    if (!e.message.includes('already exists')) console.error('schema error', e.message);
  }
  inited = true;
}

// avvia init in background (non blocca require)
ensureInit().catch(e => console.error('db init failed', e.message));

function transaction(fn) {
  return async (...args) => {
    const client = await pool.connect();
    const origQuery = pool.query.bind(pool);
    try {
      await client.query('BEGIN');
      pool.query = client.query.bind(client);
      const result = await fn(...args);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch {}
      throw e;
    } finally {
      pool.query = origQuery;
      client.release();
    }
  };
}

const db = {
  prepare,
  exec,
  query: (sql, params=[]) => pool.query(toPg(sql).replace(/\?/g, (()=>{let i=0; return ()=>`$${++i}`})()), params),
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
