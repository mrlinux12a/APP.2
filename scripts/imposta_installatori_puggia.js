// Tutti gli installatori in Via Puggia 22/3, Genova (vedi src/sede_installatori.js).
//
// Per ogni cliente imposta l'indirizzo di consegna e la posizione (coordinate + consenso, come se
// l'avesse data) e cancella la precisione e l'ora dell'ultimo rilevamento del dispositivo: la
// posizione del telefono non si usa più. La sede legale (indirizzo, CAP, città) non si tocca.
//
// Il DB è quello di produzione condiviso, quindi di default è una PROVA: esegue tutto dentro una
// transazione, stampa il risultato e annulla. Solo con --applica conferma. Le righe com'erano prima
// restano in _tmp_backup_installatori.json (fuori da git).
//
// Uso:  node scripts/imposta_installatori_puggia.js [--applica]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sede = require('../src/sede_installatori');

const APPLICA = process.argv.includes('--applica');
const FILE_BACKUP = path.join(__dirname, '..', '_tmp_backup_installatori.json');

(async () => {
  const locale = (process.env.DATABASE_URL || '').includes('@localhost');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: locale ? false : { rejectUnauthorized: false } });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const prima = (
      await c.query(
        `SELECT id, username, indirizzo_consegna, geo_consenso, geo_lat, geo_lng, geo_precisione, geo_aggiornata_il
           FROM users WHERE ruolo = 'cliente' ORDER BY id`
      )
    ).rows;
    if (APPLICA) fs.writeFileSync(FILE_BACKUP, JSON.stringify(prima, null, 2));

    const r = await c.query(
      `UPDATE users
          SET indirizzo_consegna = $1, geo_consenso = 1, geo_lat = $2, geo_lng = $3,
              geo_precisione = NULL, geo_aggiornata_il = NULL
        WHERE ruolo = 'cliente'`,
      [sede.indirizzoConsegna, sede.lat, sede.lng]
    );
    console.log(`Installatori aggiornati: ${r.rowCount}`);
    console.table(
      (await c.query(`SELECT id, username, indirizzo_consegna, geo_consenso, geo_lat, geo_lng FROM users WHERE ruolo = 'cliente' ORDER BY id`)).rows
    );

    if (APPLICA) {
      await c.query('COMMIT');
      console.log(`Applicato. Copia di com'erano: ${FILE_BACKUP}`);
    } else {
      await c.query('ROLLBACK');
      console.log('PROVA: nessuna modifica salvata. Rilancia con --applica per confermare.');
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
