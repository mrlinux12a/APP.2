// Applica a un DB solo una parte di db/postgres/schema.sql: dal commento indicato fino in fondo, in
// un'unica transazione (se un pezzo fallisce non cambia niente). Serve perché l'intero file non si
// applica col ruolo attuale ("permission denied" sulla funzione ricerca_simili), mentre i blocchi
// nuovi in fondo sì. I blocchi sono scritti per poter essere rilanciati (IF NOT EXISTS).
//
// Uso:  node scripts/applica_blocco_schema.js "-- WhatsApp: il corriere prende" [--applica]
//   senza --applica stampa il blocco e prova ad eseguirlo, poi annulla (prova a secco).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Il commento comincia con "--" come il flag: l'unico flag è --applica.
const inizio = process.argv.slice(2).find((a) => a !== '--applica');
const APPLICA = process.argv.includes('--applica');
if (!inizio) {
  console.error('Manca l\'inizio del blocco: il commento di schema.sql da cui partire.');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'db', 'postgres', 'schema.sql');
const schema = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const i = schema.indexOf(inizio);
if (i === -1 || schema.indexOf(inizio, i + 1) !== -1) {
  console.error(i === -1 ? 'Commento non trovato in schema.sql.' : 'Il commento compare più volte: scrivine uno più lungo.');
  process.exit(1);
}
const blocco = schema.slice(i);

(async () => {
  const locale = (process.env.DATABASE_URL || '').includes('@localhost');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: locale ? false : { rejectUnauthorized: false } });
  const c = await pool.connect();
  try {
    console.log(`${blocco.split('\n').length} righe, da: ${inizio}\n`);
    await c.query('BEGIN');
    await c.query(blocco);
    if (APPLICA) {
      await c.query('COMMIT');
      console.log('Blocco applicato.');
    } else {
      await c.query('ROLLBACK');
      console.log('PROVA: il blocco gira senza errori, nessuna modifica salvata. Rilancia con --applica.');
    }
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((err) => {
  console.error('ERRORE:', err.message);
  process.exit(1);
});
