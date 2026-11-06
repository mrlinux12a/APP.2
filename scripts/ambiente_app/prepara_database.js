// Prepara il database dell'ambiente «app» (vedi docs/ambienti.md): copia dal database REALE solo il catalogo, i listini e le filiali dei banchi attivi, e crea
// gli accessi di prova dei banchi. NON copia clienti, ordini, richieste, pagamenti, sessioni, token né notifiche: l'ambiente app parte senza persone vere.
//
//  - Il database reale si legge soltanto: la connessione è aperta in sola lettura (una sola fotografia coerente di tutte le tabelle) e il programma si
//    rifiuta di partire se origine e destinazione sono lo stesso database.
//  - Il database nuovo deve esistere già, con lo schema applicato (`node scripts/db/apply_schema_pg.js`), il fuso orario UTC e le tabelle del catalogo
//    vuote: si copia solo in un database appena creato (docs/ambienti.md, «Il database nuovo», «Lo schema» e «La copia del catalogo»).
//  - Di default è una PROVA: copia tutto dentro una transazione, stampa il confronto delle righe e annulla. Solo con --applica salva.
//  - I banchi veri non si copiano: per ogni filiale attiva si crea un accesso di prova (utente `banco-...`) con una password casuale, scritta in
//    backup/credenziali_ambiente_app.txt (fuori da git), non a video né nei log. Con --senza-banchi non se ne crea nessuno.
//
// Uso, dalla cartella dell'ambiente app (il suo .env ha il DATABASE_URL del database NUOVO):
//   ORIGINE_DATABASE_URL="postgres://...database reale..." node scripts/ambiente_app/prepara_database.js [--applica] [--senza-banchi] [--password-banchi <pw>]
//   In alternativa alle due variabili: --origine <indirizzo> e --destinazione <indirizzo> (gli indirizzi con la password restano nella cronologia della shell).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Client, types } = require('pg');
const { erroriNuovaPassword } = require('../../src/logica/account/password');
const { descriviIndirizzoDatabase } = require('../../src/comune/indirizzo_database');

// Quante righe si inviano al database nuovo per volta.
const LOTTO = 1000;

// Date e orari restano TESTO come li scrive Postgres: lasciati a `pg` diventerebbero date JavaScript lette nel fuso del computer, e i campi senza fuso
// (creato_il...) si sposterebbero di qualche ora nel passaggio.
const TIPI_COME_TESTO = new Set([1082, 1083, 1114, 1184, 1186, 1266]); // date, time, timestamp, timestamptz, interval, timetz
const tipiGrezzi = { getTypeParser: (oid, formato) => (TIPI_COME_TESTO.has(oid) ? (valore) => valore : types.getTypeParser(oid, formato)) };

// Le tabelle da copiare, nell'ordine in cui si possono scrivere (prima quelle a cui le altre rimandano). `dove` filtra le righe: solo i banchi attivi
// (e quello che dipende da loro) passano nell'ambiente app.
const BANCHI_ATTIVI = 'SELECT id FROM distributors WHERE attivo = 1';
const TABELLE = [
  { nome: 'macro_categorie', ordine: 'slug' },
  { nome: 'brands', ordine: 'slug' },
  { nome: 'brand_families', ordine: 'id' },
  { nome: 'sottocategorie', ordine: 'id' },
  { nome: 'ditte', dove: `id IN (SELECT ditta_id FROM distributors WHERE attivo = 1 AND ditta_id IS NOT NULL)`, ordine: 'id' },
  { nome: 'distributors', dove: 'attivo = 1', ordine: 'id' },
  { nome: 'store_locations', dove: `distributor_id IN (${BANCHI_ATTIVI})`, ordine: 'id' },
  { nome: 'product_groups', ordine: 'id' },
  { nome: 'products', ordine: 'id' },
  { nome: 'distributor_products', dove: `distributor_id IN (${BANCHI_ATTIVI})`, ordine: 'id' },
  { nome: 'product_sottocategorie', ordine: 'product_id, macro_slug, sottocategoria_slug' },
];

// Legge gli argomenti: `--applica` e `--senza-banchi` sono interruttori, le altre `--opzione valore`.
function leggiArgomenti(argv) {
  const out = { applica: false, senzaBanchi: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--applica') out.applica = true;
    else if (a === '--senza-banchi') out.senzaBanchi = true;
    else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`Argomento non riconosciuto: ${a}`);
  }
  return out;
}

// «server:porta/database» di un indirizzo di connessione, senza utente né password (si può scrivere a video).
const descrivi = (indirizzo) => descriviIndirizzoDatabase(indirizzo) || '(indirizzo non valido)';

// Il nome di un computer può essere scritto in modi diversi: localhost, 127.0.0.1 e ::1 sono lo stesso.
function stessoComputer(a, b) {
  const locale = (h) => (['localhost', '127.0.0.1', '::1', '[::1]'].includes(h) ? 'locale' : h);
  return locale(a) === locale(b);
}

// Prima controllo (sull'indirizzo): origine e destinazione sono lo stesso database?
function stessoIndirizzo(a, b) {
  const x = new URL(a);
  const y = new URL(b);
  return stessoComputer(x.hostname, y.hostname) && String(x.port || 5432) === String(y.port || 5432) && x.pathname === y.pathname;
}

// Una password casuale e leggibile (senza caratteri che si confondono), 16 caratteri.
function passwordCasuale() {
  const lettere = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(16), (b) => lettere[b % lettere.length]).join('');
}

// Il nome utente di prova di una filiale: «banco-» + il nome della filiale in minuscolo, senza accenti né simboli (max 30 caratteri).
function nomeUtenteBanco(filiale) {
  const corpo = String(filiale || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^banco-/, '');
  return ('banco-' + (corpo || 'filiale')).slice(0, 30).replace(/-+$/, '');
}

const citato = (nome) => '"' + String(nome).replace(/"/g, '""') + '"';

// Le colonne di una tabella che si possono scrivere (niente colonne calcolate), nell'ordine della tabella.
async function colonneScrivibili(c, tabella) {
  const r = await c.query(
    `SELECT column_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' AND identity_generation IS NULL
      ORDER BY ordinal_position`,
    [tabella]
  );
  return r.rows;
}

// Copia una tabella: legge le righe dalla fotografia del database reale e le scrive a lotti nel database nuovo. Ritorna quante righe ha copiato.
async function copiaTabella(origine, destinazione, def) {
  const colOrigine = (await colonneScrivibili(origine, def.nome)).map((c) => c.column_name);
  const colDestinazione = await colonneScrivibili(destinazione, def.nome);
  if (colDestinazione.length === 0) throw new Error(`Nel database nuovo non c'è la tabella ${def.nome}: applica prima lo schema (node scripts/db/apply_schema_pg.js).`);
  const comuni = colDestinazione.map((c) => c.column_name).filter((n) => colOrigine.includes(n));
  const mancanti = colDestinazione.filter((c) => !colOrigine.includes(c.column_name) && c.is_nullable === 'NO' && c.column_default === null).map((c) => c.column_name);
  if (mancanti.length) throw new Error(`La tabella ${def.nome} del database nuovo ha colonne obbligatorie che nel database reale non ci sono (${mancanti.join(', ')}): lo schema reale è troppo vecchio per questa copia.`);
  const soloOrigine = colOrigine.filter((n) => !comuni.includes(n));
  if (soloOrigine.length) console.log(`  (${def.nome}: colonne del reale che qui non esistono, ignorate: ${soloOrigine.join(', ')})`);

  const elenco = comuni.map(citato).join(', ');
  const righe = (await origine.query(`SELECT ${elenco} FROM ${citato(def.nome)}${def.dove ? ' WHERE ' + def.dove : ''} ORDER BY ${def.ordine}`)).rows;
  for (let i = 0; i < righe.length; i += LOTTO) {
    const lotto = righe.slice(i, i + LOTTO);
    await destinazione.query(`INSERT INTO ${citato(def.nome)} (${elenco}) SELECT ${elenco} FROM json_populate_recordset(NULL::${citato(def.nome)}, $1::json)`, [JSON.stringify(lotto)]);
  }
  return righe.length;
}

// Dopo aver scritto gli id a mano la «prossima numerazione» della tabella va portata dopo l'ultimo: altrimenti il primo inserimento nuovo ripartirebbe da 1.
async function allineaNumerazione(destinazione, tabella) {
  const colonna = (await colonneScrivibili(destinazione, tabella)).some((c) => c.column_name === 'id');
  if (!colonna) return false;
  const seq = (await destinazione.query('SELECT pg_get_serial_sequence($1, $2) AS nome', ['public.' + tabella, 'id'])).rows[0].nome;
  if (!seq) return false;
  await destinazione.query(`SELECT setval($1, COALESCE((SELECT MAX(id) FROM ${citato(tabella)}), 1), (SELECT COUNT(*) FROM ${citato(tabella)}) > 0)`, [seq]);
  return true;
}

// Apre una connessione (con date e orari come testo).
async function collega(indirizzo) {
  const c = new Client({ connectionString: indirizzo, types: tipiGrezzi });
  await c.connect();
  return c;
}

async function main() {
  const arg = leggiArgomenti(process.argv.slice(2));
  const indirizzoOrigine = String(arg.origine || process.env.ORIGINE_DATABASE_URL || '').trim();
  const indirizzoDestinazione = String(arg.destinazione || process.env.DATABASE_URL || '').trim();
  if (!indirizzoOrigine) throw new Error('Manca l\'indirizzo del database REALE da cui copiare: scrivilo in ORIGINE_DATABASE_URL (o con --origine).');
  if (!indirizzoDestinazione) throw new Error('Manca l\'indirizzo del database NUOVO: scrivilo in DATABASE_URL nel .env di questo ambiente (o con --destinazione).');
  if (stessoIndirizzo(indirizzoOrigine, indirizzoDestinazione)) {
    throw new Error('Origine e destinazione sono lo STESSO database: mi fermo. L\'origine è il database reale, la destinazione quello nuovo dell\'ambiente app.');
  }
  if (arg['password-banchi'] !== undefined) {
    const errori = erroriNuovaPassword(arg['password-banchi'], arg['password-banchi']);
    if (errori.nuova) throw new Error(errori.nuova);
  }

  console.log(arg.applica ? 'MODO: SCRIVE davvero (--applica).' : 'MODO: PROVA, non salva niente (con --applica salva).');
  console.log(`Origine (solo lettura): ${descrivi(indirizzoOrigine)}`);
  console.log(`Destinazione:           ${descrivi(indirizzoDestinazione)}`);

  const origine = await collega(indirizzoOrigine);
  let destinazione;
  let fileAccessi = null;
  try {
    // Una sola fotografia coerente del database reale, in sola lettura: niente può essere scritto per sbaglio e le tabelle sono tutte dello stesso istante.
    await origine.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    destinazione = await collega(indirizzoDestinazione);

    // Secondo controllo (sui server): stesso database anche se raggiunto con indirizzi diversi (tunnel, alias).
    const chi = async (c) => (await c.query('SELECT current_database() AS db, pg_postmaster_start_time()::text AS avvio')).rows[0];
    const a = await chi(origine);
    const b = await chi(destinazione);
    if (a.db === b.db && a.avvio === b.avvio) throw new Error('Origine e destinazione sono lo STESSO database (stesso server, stesso nome): mi fermo.');

    const fuso = (await destinazione.query("SELECT current_setting('TimeZone') AS fuso")).rows[0].fuso;
    if (!['UTC', 'Etc/UTC'].includes(fuso)) {
      throw new Error(`Il database nuovo è nel fuso orario "${fuso}", deve essere UTC (come quello reale): ALTER DATABASE ${b.db} SET timezone TO 'UTC'; e poi rilancia (docs/ambienti.md, «Il database nuovo»).`);
    }

    // Si copia solo in un database appena creato: se il catalogo c'è già, una seconda copia raddoppierebbe tutto o si fermerebbe a metà.
    const pieni = [];
    for (const def of TABELLE) {
      const { n } = (await destinazione.query(`SELECT COUNT(*)::int AS n FROM ${citato(def.nome)}`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0];
      if (n < 0) throw new Error(`Nel database nuovo non c'è la tabella ${def.nome}: applica prima lo schema (node scripts/db/apply_schema_pg.js).`);
      if (n > 0) pieni.push(`${def.nome} (${n})`);
    }
    if (pieni.length) {
      throw new Error(`Il database nuovo ha già dei dati nel catalogo: ${pieni.join(', ')}. La copia parte solo da un database appena creato con lo schema e basta: crealo di nuovo (docs/ambienti.md).`);
    }

    await destinazione.query('BEGIN');
    const conteggi = [];
    for (const def of TABELLE) {
      const copiate = await copiaTabella(origine, destinazione, def);
      const { n } = (await destinazione.query(`SELECT COUNT(*)::int AS n FROM ${citato(def.nome)}`)).rows[0];
      if (n !== copiate) throw new Error(`${def.nome}: lette ${copiate} righe ma nel database nuovo ce ne sono ${n}. Annullo.`);
      conteggi.push({ tabella: def.nome, righe_copiate: copiate });
      console.log(`  ${def.nome}: ${copiate} righe`);
    }

    // I valori di configurazione (ordine minimo, IVA, finestre di risposta...) sono quelli del reale; le righe di partenza dello schema si sovrascrivono.
    const configurazione = (await origine.query('SELECT chiave, valore FROM config ORDER BY chiave')).rows;
    for (const riga of configurazione) {
      await destinazione.query('INSERT INTO config (chiave, valore) VALUES ($1, $2) ON CONFLICT (chiave) DO UPDATE SET valore = EXCLUDED.valore', [riga.chiave, riga.valore]);
    }
    conteggi.push({ tabella: 'config', righe_copiate: configurazione.length });
    console.log(`  config: ${configurazione.length} valori`);

    // Gli accessi di prova dei banchi (uno per filiale attiva).
    const accessi = [];
    if (!arg.senzaBanchi) {
      const filiali = (await destinazione.query('SELECT id, nome, filiale, zona FROM distributors WHERE attivo = 1 ORDER BY id')).rows;
      const usati = new Set((await destinazione.query('SELECT username FROM users')).rows.map((r) => r.username));
      for (const f of filiali) {
        let username = nomeUtenteBanco(f.filiale);
        for (let n = 2; usati.has(username); n += 1) username = nomeUtenteBanco(f.filiale).slice(0, 27) + '-' + n;
        usati.add(username);
        const password = arg['password-banchi'] !== undefined ? arg['password-banchi'] : passwordCasuale();
        await destinazione.query(
          `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, nome, cognome, distributor_id, zona, attivo)
           VALUES ('distributore', $1, $2, $3, $4, '', $5, $6, 1)`,
          [username, bcrypt.hashSync(password, 10), `${f.nome} - ${f.filiale}`, f.filiale, f.id, f.zona]
        );
        accessi.push({ utente: username, password, banco: `${f.nome} - ${f.filiale}` });
      }
      console.log(`  accessi di prova dei banchi: ${accessi.length}`);
      for (const x of accessi) console.log(`    ${x.utente}  →  ${x.banco}`);
    }

    console.log('');
    console.table(conteggi);

    if (!arg.applica) {
      await destinazione.query('ROLLBACK');
      console.log('PROVA: tutto è andato bene ma NON è stato salvato niente. Rilancia con --applica per salvare.');
      return;
    }

    // Le password si scrivono PRIMA di confermare: se il salvataggio fallisse resta un file inutile, ma non si perdono mai password di utenti che esistono.
    if (accessi.length) {
      fileAccessi = path.join(__dirname, '..', '..', 'backup', 'credenziali_ambiente_app.txt');
      fs.mkdirSync(path.dirname(fileAccessi), { recursive: true });
      const testo = ['Accessi di prova dei banchi dell\'ambiente «app» (creati ' + new Date().toISOString() + ').', 'Cambiali o cancella questo file quando non servono più.', '']
        .concat(accessi.map((x) => `${x.utente}\t${x.password}\t${x.banco}`))
        .join('\n');
      fs.writeFileSync(fileAccessi, testo + '\n', { mode: 0o600 });
    }
    await destinazione.query('COMMIT');
    // Da qui i dati sono salvati: il file delle password non si cancella più, qualunque cosa succeda dopo.
    const fileSalvato = fileAccessi;
    fileAccessi = null;
    console.log('FATTO: catalogo, listini e filiali copiati nel database nuovo.');
    if (fileSalvato) console.log(`Le password dei banchi sono (fuori da git) in: ${fileSalvato}`);
    try {
      for (const def of TABELLE) await allineaNumerazione(destinazione, def.nome);
      await destinazione.query('ANALYZE');
    } catch (e) {
      console.warn('ATTENZIONE: la copia è salvata ma non sono riuscito a rifinire il database (numerazione degli id e statistiche):', e.message);
    }
  } catch (errore) {
    if (destinazione) await destinazione.query('ROLLBACK').catch(() => {});
    if (fileAccessi) fs.rmSync(fileAccessi, { force: true });
    throw errore;
  } finally {
    await origine.query('ROLLBACK').catch(() => {});
    await origine.end().catch(() => {});
    if (destinazione) await destinazione.end().catch(() => {});
  }
}

// Lanciato da riga di comando fa il lavoro (e legge il .env della cartella: DATABASE_URL è l'indirizzo del database NUOVO); importato dalle prove
// (test/ambiente_app) espone solo i pezzi senza database e non tocca l'ambiente.
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  main().catch((errore) => {
    console.error('ERRORE:', errore.message);
    process.exit(1);
  });
}

module.exports = { TABELLE, nomeUtenteBanco, stessoIndirizzo };
