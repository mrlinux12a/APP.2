// Applica db/postgres/schema.sql al database Postgres puntato da DATABASE_URL.
// Va lanciato a mano, una volta, quando si modifica lo schema (nuova colonna/tabella) —
// NON gira più in automatico ad ogni avvio dell'app (vedi db/postgres/index.js: su Supabase
// in modalità "transaction pooler" un lucchetto applicato ad ogni richiesta non è affidabile
// e rischiava un deadlock se più istanze partivano in contemporanea, es. su Vercel).
//
// Uso:  node scripts/apply_schema_pg.js
// Richiede DATABASE_URL nell'ambiente (o nel file .env).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Manca DATABASE_URL (impostala nel .env o come variabile d\'ambiente).');
  process.exit(1);
}

const isSupabase = DATABASE_URL.includes('supabase.co');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isSupabase ? { rejectUnauthorized: false } : false,
});

const schemaPath = path.join(__dirname, '..', 'db', 'postgres', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

pool
  .query(schema)
  .then(() => {
    console.log('Schema applicato correttamente.');
    return pool.end();
  })
  .catch((e) => {
    console.error('Errore applicando lo schema:', e.message);
    return pool.end().finally(() => process.exit(1));
  });
