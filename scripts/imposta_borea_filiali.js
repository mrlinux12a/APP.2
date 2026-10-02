// Struttura ditta → filiali → dipendenti, per ora solo per Borea (vedi CLAUDE.md, "Ditte e filiali").
//
//  - crea una ditta per ogni riga di `distributors` (distributors.ditta_id);
//  - Borea: indirizzo della filiale di Fegino, nuova filiale Staglieno con lo stesso listino e gli
//    stessi legami cliente, e due dipendenti (utenti `fegino` e `staglieno`, password banco123);
//  - le altre ditte vengono DISATTIVATE (attivo = 0, distributore e utenti), non cancellate: il loro
//    storico di richieste e ordini resta e si riattivano rimettendo attivo = 1.
//
// Va lanciato DOPO aver applicato lo schema (node scripts/apply_schema_pg.js).
// Il DB è quello di produzione condiviso, quindi di default è una PROVA: esegue tutto dentro una
// transazione, stampa il risultato e annulla. Solo con --applica conferma.
//
// Uso:  node scripts/imposta_borea_filiali.js [--applica] [--backup=percorso.json]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const APPLICA = process.argv.includes('--applica');
const backupArg = process.argv.find((a) => a.startsWith('--backup='));
const FILE_BACKUP = backupArg ? backupArg.slice('--backup='.length) : path.join(__dirname, '..', '_tmp_backup_borea.json');

const NOME_DITTA = 'BOREA SRL';
const PASSWORD_DIPENDENTI = 'banco123';
const FEGINO = { filiale: 'Banco Genova Fegino', indirizzo: 'Via Castel Morrone, 1', cap: '16161', citta: 'Genova', provincia: 'GE' };
const STAGLIENO = { filiale: 'Banco Genova Staglieno', indirizzo: 'Lungobisagno Istria, 11R', cap: '16139', citta: 'Genova', provincia: 'GE' };
const DIPENDENTI = [
  { username: 'fegino', nome: 'Fegino', ragione: 'Borea Fegino', filiale: FEGINO.filiale },
  { username: 'staglieno', nome: 'Staglieno', ragione: 'Borea Staglieno', filiale: STAGLIENO.filiale },
];

if (!process.env.DATABASE_URL) {
  console.error("Manca DATABASE_URL (impostala nel .env o come variabile d'ambiente).");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false,
});

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // ---- Copia di sicurezza delle righe che si toccano ----
    const prima = {
      distributors: (await c.query('SELECT * FROM distributors ORDER BY id')).rows,
      users_distributori: (await c.query("SELECT id, ruolo, username, ragione_sociale, attivo, distributor_id FROM users WHERE ruolo = 'distributore' ORDER BY id")).rows,
      client_distributors_borea: (await c.query("SELECT cd.* FROM client_distributors cd JOIN distributors d ON d.id = cd.distributor_id WHERE d.nome = $1", [NOME_DITTA])).rows,
    };
    fs.writeFileSync(FILE_BACKUP, JSON.stringify(prima, null, 2));
    console.log('Copia di sicurezza (stato prima):', FILE_BACKUP);

    const fe = (await c.query('SELECT * FROM distributors WHERE nome = $1 AND filiale = $2', [NOME_DITTA, FEGINO.filiale])).rows[0];
    if (!fe) throw new Error(`Non trovo la filiale ${NOME_DITTA} / ${FEGINO.filiale}.`);

    // ---- Una ditta per ogni riga di distributors (copiando i dati dalla prima filiale) ----
    await c.query(
      `INSERT INTO ditte (nome, ragione_sociale, partita_iva, indirizzo, cap, citta, provincia, telefono, email)
       SELECT DISTINCT ON (nome) nome, ragione_sociale, partita_iva, indirizzo, cap, citta, provincia, telefono, email
         FROM distributors ORDER BY nome, id
       ON CONFLICT (nome) DO NOTHING`
    );
    await c.query('UPDATE distributors d SET ditta_id = t.id FROM ditte t WHERE t.nome = d.nome AND d.ditta_id IS NULL');
    const dittaBorea = (await c.query('SELECT id FROM ditte WHERE nome = $1', [NOME_DITTA])).rows[0].id;

    // ---- Borea Fegino: indirizzo ----
    await c.query(
      'UPDATE distributors SET indirizzo = $2, cap = $3, citta = $4, provincia = $5, ricezione_attiva = 1, attivo = 1 WHERE id = $1',
      [fe.id, FEGINO.indirizzo, FEGINO.cap, FEGINO.citta, FEGINO.provincia]
    );

    // ---- Borea Staglieno: stessa ditta, stesse condizioni della sede di Fegino ----
    // Coordinate vuote: finché non si geocodifica l'indirizzo il tempo di consegna resta quello
    // dichiarato dal banco (vedi src/consegna.js), senza stima del tragitto.
    await c.query(
      `INSERT INTO distributors (nome, filiale, zona, consegna_ore_default, costo_consegna, attivo, ricezione_attiva,
                                 ragione_sociale, partita_iva, indirizzo, cap, citta, provincia, telefono, email, ditta_id)
       SELECT nome, $2, zona, consegna_ore_default, costo_consegna, 1, 1,
              ragione_sociale, partita_iva, $3, $4, $5, $6, telefono, email, ditta_id
         FROM distributors WHERE id = $1
       ON CONFLICT (nome, filiale) DO NOTHING`,
      [fe.id, STAGLIENO.filiale, STAGLIENO.indirizzo, STAGLIENO.cap, STAGLIENO.citta, STAGLIENO.provincia]
    );
    const st = (await c.query('SELECT * FROM distributors WHERE nome = $1 AND filiale = $2', [NOME_DITTA, STAGLIENO.filiale])).rows[0];

    // Stessi prezzi per entrambe le filiali: il listino di Staglieno è una copia di quello di Fegino.
    const listino = await c.query(
      `INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct)
       SELECT $2, product_id, prezzo_listino, sconto_base_pct FROM distributor_products WHERE distributor_id = $1
       ON CONFLICT (distributor_id, product_id) DO NOTHING`,
      [fe.id, st.id]
    );
    // Stessi legami cliente (approvazioni) anche per la nuova filiale.
    const legami = await c.query(
      `INSERT INTO client_distributors (cliente_id, distributor_id, stato, codice_cliente, note, richiesto_il, deciso_il)
       SELECT cliente_id, $2, stato, codice_cliente, note, richiesto_il, deciso_il FROM client_distributors WHERE distributor_id = $1
       ON CONFLICT (cliente_id, distributor_id) DO NOTHING`,
      [fe.id, st.id]
    );

    // ---- Dipendenti ----
    const hash = bcrypt.hashSync(PASSWORD_DIPENDENTI, 10);
    for (const d of DIPENDENTI) {
      const filialeId = d.filiale === FEGINO.filiale ? fe.id : st.id;
      // Se l'utente esiste già si riallacciano filiale e nome, la password non si tocca.
      await c.query(
        `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, nome, cognome, distributor_id, zona, attivo)
         VALUES ('distributore', $1, $2, $3, $4, '', $5, 'Genova', 1)
         ON CONFLICT (username) DO UPDATE SET distributor_id = excluded.distributor_id, nome = excluded.nome, attivo = 1`,
        [d.username, hash, d.ragione, d.nome, filialeId]
      );
    }

    // ---- Le altre ditte: disattivate, non cancellate ----
    const altri = (await c.query('SELECT id FROM distributors WHERE ditta_id <> $1', [dittaBorea])).rows.map((r) => r.id);
    await c.query('UPDATE distributors SET attivo = 0 WHERE id = ANY($1::int[])', [altri]);
    const utentiOff = await c.query(
      "UPDATE users SET attivo = 0 WHERE ruolo = 'distributore' AND distributor_id = ANY($1::int[]) RETURNING username",
      [altri]
    );
    // Il login controlla `attivo`, ma una sessione web già aperta continua a funzionare: si chiudono.
    // (I token dell'app no: si controllano a ogni richiesta, e i banchi non usano ancora l'app.)
    let sessioniChiuse = 0;
    for (const { username } of utentiOff.rows) {
      const r = await c.query('DELETE FROM session WHERE sess::text LIKE $1', ['%"username":"' + username + '"%']);
      sessioniChiuse += r.rowCount;
    }

    // ---- Resoconto ----
    console.log('\nDistributori (filiali):');
    console.table((await c.query(
      `SELECT d.id, t.nome AS ditta, d.filiale, d.attivo, d.ricezione_attiva AS ricez, d.indirizzo, d.cap,
              (SELECT COUNT(*)::int FROM distributor_products WHERE distributor_id = d.id) AS prodotti,
              (SELECT COUNT(*)::int FROM client_distributors WHERE distributor_id = d.id) AS legami
         FROM distributors d LEFT JOIN ditte t ON t.id = d.ditta_id ORDER BY d.id`
    )).rows);
    console.log('Utenti banco:');
    console.table((await c.query(
      "SELECT id, username, nome, ragione_sociale, distributor_id AS filiale_id, attivo FROM users WHERE ruolo = 'distributore' ORDER BY id"
    )).rows);
    console.log(`Listino copiato su Staglieno: ${listino.rowCount} righe. Legami cliente copiati: ${legami.rowCount}. Utenti disattivati: ${utentiOff.rowCount} (sessioni web chiuse: ${sessioniChiuse}).`);

    if (APPLICA) {
      await c.query('COMMIT');
      console.log('\nAPPLICATO.');
    } else {
      await c.query('ROLLBACK');
      console.log('\nPROVA: niente è stato salvato. Per applicare: node scripts/imposta_borea_filiali.js --applica');
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
