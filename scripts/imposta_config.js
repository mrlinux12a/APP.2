// Cambia UN valore della tabella `config` del database (quello condiviso con la VPS). Di default è una PROVA: mostra il valore di adesso e quello nuovo e non
// salva niente; con --applica scrive. Il server legge la configurazione con una cache di 60 secondi (src/pricing.js): il nuovo valore vale entro un minuto, senza
// riavvio. Non crea chiavi nuove (se il nome è sbagliato lo dice) e stampa il valore com'era, così si può rimettere.
//
// Uso:  node scripts/imposta_config.js <chiave> <valore> [--applica]
//       es. node scripts/imposta_config.js spedizione_fissa 5 --applica
require('dotenv').config();
const { Pool } = require('pg');

const argomenti = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APPLICA = process.argv.includes('--applica');
const [chiave, valore] = argomenti;

if (!chiave || valore === undefined) {
  console.error('Uso: node scripts/imposta_config.js <chiave> <valore> [--applica]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Manca DATABASE_URL (impostala nel .env o come variabile d'ambiente).");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8000,
});

async function main() {
  let c;
  try {
    c = await pool.connect();
  } catch (e) {
    console.error(`Non riesco a collegarmi al database (${e.code || e.message}).`);
    console.error('Se il .env punta a 127.0.0.1:5433 il tunnel verso il server non è aperto: aprilo e rilancia. Se sei su eduroam: node scripts/diagnosi_rete_db.js.');
    await pool.end().catch(() => {});
    process.exit(1);
  }
  try {
    await c.query('BEGIN');
    const prima = (await c.query('SELECT chiave, valore FROM config WHERE chiave = $1', [chiave])).rows[0];
    if (!prima) throw new Error(`La chiave "${chiave}" non c'è in config: non la creo da qui.`);
    console.log(`config.${chiave}: ${prima.valore}  →  ${valore}`);
    await c.query('UPDATE config SET valore = $2 WHERE chiave = $1', [chiave, String(valore)]);
    const dopo = (await c.query('SELECT chiave, valore FROM config WHERE chiave = $1', [chiave])).rows[0];
    console.log(`Dopo: ${dopo.valore}`);
    if (APPLICA) {
      await c.query('COMMIT');
      console.log('APPLICATO (vale entro un minuto, la configurazione sta in cache).');
    } else {
      await c.query('ROLLBACK');
      console.log(`PROVA: niente è stato salvato. Per applicare aggiungi --applica.`);
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERRORE:', e.message);
  process.exit(1);
});
