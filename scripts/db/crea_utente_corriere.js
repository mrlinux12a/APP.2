// Crea un utente dell'app dei corrieri: un corriere (ruolo 'corriere') o un supervisore dei corrieri (ruolo 'supervisore_corrieri'). Vedi docs/app-corrieri.md.
//
// - Si può rilanciare: se il nome utente c'è già non cambia niente (e se ha un altro ruolo si ferma con un errore: un installatore non diventa corriere per sbaglio).
// - Il DB è quello del .env (di solito il Postgres di produzione condiviso), quindi di default è una PROVA: lavora dentro una transazione, stampa il risultato e
//   annulla. Solo con --applica salva.
// - Senza --password ne sceglie una casuale e la scrive in backup/credenziali_<utente>.txt (fuori da git), non a video né nei log. Con --password la usa e basta.
//
// Uso:  node scripts/db/crea_utente_corriere.js [utente] [--nome "Nome Cognome"] [--telefono "333 1234567"] [--ruolo corriere|supervisore_corrieri]
//                                               [--supervisore <utente-del-supervisore>] [--password <password>] [--applica]
//   senza argomenti: l'utente di prova "corriere".
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { erroriNuovaPassword } = require('../../src/logica/account/password');

const RUOLI = ['corriere', 'supervisore_corrieri'];

// Legge gli argomenti: le parole sciolte sono il nome utente, `--nome valore` ecc. i campi, `--applica` conferma.
function leggiArgomenti(argv) {
  const out = { utente: null, applica: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--applica') out.applica = true;
    else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else if (!out.utente) out.utente = a;
  }
  return out;
}

// Una password casuale e leggibile (senza caratteri che si confondono), 16 caratteri.
function passwordCasuale() {
  const lettere = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(16), (b) => lettere[b % lettere.length]).join('');
}

(async () => {
  const arg = leggiArgomenti(process.argv.slice(2));
  const username = String(arg.utente || 'corriere').trim();
  const ruolo = arg.ruolo || 'corriere';
  const nome = String(arg.nome || (username === 'corriere' ? 'Corriere di prova' : username)).trim();
  const telefono = arg.telefono ? String(arg.telefono).trim() : null;
  const supervisoreUsername = arg.supervisore ? String(arg.supervisore).trim() : null;

  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Il nome utente deve avere da 3 a 30 caratteri: lettere minuscole, numeri, punto, trattino e trattino basso.');
  if (!RUOLI.includes(ruolo)) throw new Error(`Ruolo non valido: usa ${RUOLI.join(' o ')}.`);
  if (supervisoreUsername && ruolo !== 'corriere') throw new Error('Solo un corriere ha un supervisore.');
  if (arg.password !== undefined) {
    const errori = erroriNuovaPassword(arg.password, arg.password);
    if (errori.nuova) throw new Error(errori.nuova);
  }

  const locale = (process.env.DATABASE_URL || '').includes('@localhost');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: locale ? false : { rejectUnauthorized: false } });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const esistente = (await c.query('SELECT id, ruolo, username, ragione_sociale, attivo FROM users WHERE username = $1', [username])).rows[0];
    if (esistente) {
      if (esistente.ruolo !== ruolo) throw new Error(`Il nome utente "${username}" esiste già con il ruolo "${esistente.ruolo}": scegline un altro.`);
      console.log(`Esiste già, non cambio niente: #${esistente.id} ${esistente.username} (${esistente.ruolo}, ${esistente.attivo ? 'attivo' : 'DISATTIVATO'}).`);
      await c.query('ROLLBACK');
      return;
    }

    let supervisoreId = null;
    if (supervisoreUsername) {
      const sup = (await c.query(`SELECT id FROM users WHERE username = $1 AND ruolo = 'supervisore_corrieri' AND attivo = 1`, [supervisoreUsername])).rows[0];
      if (!sup) throw new Error(`Non c'è nessun supervisore attivo con il nome utente "${supervisoreUsername}".`);
      supervisoreId = sup.id;
    }

    const password = arg.password !== undefined ? arg.password : passwordCasuale();
    const [primo, ...resto] = nome.split(/\s+/);
    const r = await c.query(
      `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, nome, cognome, telefono, supervisore_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, ruolo, username, ragione_sociale, supervisore_id`,
      [ruolo, username, bcrypt.hashSync(password, 10), nome, primo, resto.join(' '), telefono, supervisoreId]
    );
    console.log('Utente da creare:');
    console.table(r.rows);

    if (!arg.applica) {
      await c.query('ROLLBACK');
      console.log('PROVA: nessuna modifica salvata. Rilancia con --applica per confermare.');
      return;
    }
    await c.query('COMMIT');
    console.log(`Creato: #${r.rows[0].id} ${username} (${ruolo}).`);
    if (arg.password === undefined) {
      const file = path.join(__dirname, '..', '..', 'backup', `credenziali_${username}.txt`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `utente: ${username}\npassword: ${password}\n`, { mode: 0o600 });
      console.log(`Password scelta a caso e salvata (fuori da git) in: ${file}`);
    }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((err) => {
  console.error('ERRORE:', err.message);
  process.exit(1);
});
