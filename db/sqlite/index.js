const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Usa il modulo SQLite integrato in Node.js (>= 22.5): nessuna dipendenza nativa da compilare,
// più semplice da installare su qualsiasi hosting/ambiente per un MVP come questo.
const DB_PATH = path.join(__dirname, '..', 'minuteria.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ---------- Migrazioni leggere ----------
// schema.sql usa CREATE TABLE IF NOT EXISTS: sulle tabelle già esistenti le colonne nuove
// non verrebbero aggiunte. Qui allineiamo un DB creato con una versione precedente.

function colonneDi(tabella) {
  return db.prepare(`PRAGMA table_info(${tabella})`).all().map((c) => c.name);
}

function aggiungiColonna(tabella, colonna, ddl) {
  if (!colonneDi(tabella).includes(colonna)) {
    db.exec(`ALTER TABLE ${tabella} ADD COLUMN ${colonna} ${ddl}`);
  }
}

aggiungiColonna('products', 'macro_slug', "TEXT NOT NULL DEFAULT 'minuteria'");
aggiungiColonna('users', 'distributor_id', 'INTEGER');
aggiungiColonna('users', 'zona', "TEXT NOT NULL DEFAULT 'Genova'");
aggiungiColonna('orders', 'request_id', 'INTEGER');
aggiungiColonna('orders', 'distributor_id', 'INTEGER');
aggiungiColonna('orders', 'consegna_ore', 'INTEGER');
aggiungiColonna('orders', 'costo_consegna', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('orders', 'iva', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('orders', 'totale_ivato', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('order_items', 'prezzo_unitario_cliente', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('order_items', 'subtotale_cliente', 'REAL NOT NULL DEFAULT 0');

// Anagrafica completa del cliente: serve per intestare la bolla / DDT.
aggiungiColonna('users', 'partita_iva', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'codice_fiscale', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'indirizzo', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'cap', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'citta', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'provincia', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'sdi_pec', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'indirizzo_consegna', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('users', 'referente', "TEXT NOT NULL DEFAULT ''");

// Anagrafica del distributore: mittente del DDT.
aggiungiColonna('distributors', 'ragione_sociale', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'partita_iva', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'indirizzo', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'cap', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'citta', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'provincia', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'telefono', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('distributors', 'email', "TEXT NOT NULL DEFAULT ''");

// Risposta del banco: tempo di partenza e copertura (totale o parziale).
aggiungiColonna('request_responses', 'partenza_ore', 'INTEGER');
aggiungiColonna('request_responses', 'copertura', "TEXT NOT NULL DEFAULT 'totale'");

// Ordine: partenza stimata, destinazione merce e dati della bolla / DDT.
aggiungiColonna('orders', 'partenza_ore', 'INTEGER');
aggiungiColonna('orders', 'destinazione', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('orders', 'ddt_numero', 'TEXT');
aggiungiColonna('orders', 'ddt_data', 'TEXT');
aggiungiColonna('orders', 'ddt_colli', 'INTEGER');
aggiungiColonna('orders', 'ddt_aspetto', "TEXT NOT NULL DEFAULT 'Colli'");
aggiungiColonna('orders', 'ddt_trasporto', "TEXT NOT NULL DEFAULT 'mittente'");
aggiungiColonna('orders', 'ddt_causale', "TEXT NOT NULL DEFAULT 'Vendita'");
aggiungiColonna('orders', 'ddt_note', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('orders', 'preso_in_carico_il', 'TEXT');

// Geolocalizzazione: attiva solo con consenso esplicito, revocabile in qualsiasi momento.
aggiungiColonna('users', 'geo_consenso', 'INTEGER NOT NULL DEFAULT 0');
aggiungiColonna('users', 'geo_lat', 'REAL');
aggiungiColonna('users', 'geo_lng', 'REAL');
aggiungiColonna('users', 'geo_precisione', 'REAL');
aggiungiColonna('users', 'geo_aggiornata_il', 'TEXT');
aggiungiColonna('distributors', 'geo_lat', 'REAL');
aggiungiColonna('distributors', 'geo_lng', 'REAL');
aggiungiColonna('orders', 'tracciamento_attivo', 'INTEGER NOT NULL DEFAULT 0');
aggiungiColonna('orders', 'geo_lat_consegna', 'REAL');
aggiungiColonna('orders', 'geo_lng_consegna', 'REAL');

// Marchi e dati di listino del produttore (EAN, RAEE, F-GAS...).
aggiungiColonna('products', 'brand_slug', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'famiglia', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'ean', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'raee', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('products', 'cat_raee', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'refrigerante', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'fgas_kg', 'REAL');
aggiungiColonna('products', 'gwp', 'REAL');

// Sconto deciso dal banco sulla singola riga: se valorizzato sostituisce lo sconto Base
// del distributore per quel prodotto, solo per quella richiesta.
aggiungiColonna('request_response_items', 'sconto_riga_pct', 'REAL');
aggiungiColonna('request_responses', 'sconto_cliente_pct', 'REAL');

// Sconti a scalare: nel settore si scrivono come 40+10+5, non come un unico valore.
// sconto_pct resta come sconto effettivo calcolato, per non rompere i dati esistenti.
['sconto1', 'sconto2', 'sconto3', 'sconto4', 'sconto5'].forEach((c) =>
  aggiungiColonna('client_discount_rules', c, 'REAL')
);

// Centro notifiche raggruppato: categoria, sottostato e ordine collegato.
aggiungiColonna('notifications', 'categoria', "TEXT NOT NULL DEFAULT 'generale'");
aggiungiColonna('notifications', 'sottostato', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('notifications', 'order_id', 'INTEGER');

// Finestra di 5 minuti per scegliere fra più offerte, e assegnazione automatica.
aggiungiColonna('requests', 'scelta_scade_il', 'TEXT');
aggiungiColonna('requests', 'assegnata_auto', 'INTEGER NOT NULL DEFAULT 0');
aggiungiColonna('request_responses', 'consegna_minuti_stimati', 'INTEGER');

// Classificazione per frequenza d'uso: sottocategoria e misura del prodotto.
aggiungiColonna('products', 'sottocategoria', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('products', 'misura', "TEXT NOT NULL DEFAULT ''");
aggiungiColonna('macro_categorie', 'priorita', 'INTEGER NOT NULL DEFAULT 99');
aggiungiColonna('macro_categorie', 'in_evidenza', 'INTEGER NOT NULL DEFAULT 0');

// Lo sconto unico di anagrafica non esiste più: ogni marchio ha condizioni sue.
// Le regole 'generale' rimaste da prima non verrebbero comunque più applicate.
db.exec(`DELETE FROM client_discount_rules WHERE ambito = 'generale'`);

// Anagrafica cliente creata in autonomia: forma giuridica e stato dell'iscrizione.
aggiungiColonna('users', 'tipo_soggetto', "TEXT NOT NULL DEFAULT 'impresa'");
aggiungiColonna('users', 'stato_anagrafica', "TEXT NOT NULL DEFAULT 'attivo'");
aggiungiColonna('users', 'iscritto_il', 'TEXT');

// Il contributo RAEE è escluso dai prezzi di listino: viaggia come voce separata.
aggiungiColonna('orders', 'contributo_raee', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('order_items', 'raee_unitario', 'REAL NOT NULL DEFAULT 0');
aggiungiColonna('order_items', 'raee_riga', 'REAL NOT NULL DEFAULT 0');

// Il CHECK sul ruolo nasceva con solo ('cliente','agente'): va riscritto per accettare
// anche 'distributore'. In SQLite un CHECK si cambia solo ricreando la tabella.
const usersDdl = db
  .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
  .get();
if (usersDdl && !usersDdl.sql.includes("'distributore'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE users_nuova (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruolo TEXT NOT NULL CHECK (ruolo IN ('cliente', 'agente', 'distributore')),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      ragione_sociale TEXT NOT NULL,
      email TEXT,
      telefono TEXT,
      attivo INTEGER NOT NULL DEFAULT 1,
      creato_il TEXT NOT NULL DEFAULT (datetime('now')),
      distributor_id INTEGER,
      zona TEXT NOT NULL DEFAULT 'Genova'
    );
    INSERT INTO users_nuova
      (id, ruolo, username, password_hash, ragione_sociale, email, telefono, attivo, creato_il, distributor_id, zona)
      SELECT id, ruolo, username, password_hash, ragione_sociale, email, telefono, attivo, creato_il, distributor_id, zona
      FROM users;
    DROP TABLE users;
    ALTER TABLE users_nuova RENAME TO users;
    COMMIT;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

// Gli indici sulle colonne aggiunte per migrazione vanno creati dopo le ALTER,
// non dentro schema.sql: su un DB vecchio la colonna non esiste ancora.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_slug);
  CREATE INDEX IF NOT EXISTS idx_products_famiglia ON products(brand_slug, famiglia);
`);

// Piccolo helper per eseguire più operazioni in una transazione (BEGIN/COMMIT/ROLLBACK),
// equivalente minimale a db.transaction() di better-sqlite3.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

// compat pg: ensureInit no-op async, prepare async wrapper
db.ensureInit = async () => {};
const _origPrepare = db.prepare.bind(db);
db.prepare = (sql) => {
  const stmt = _origPrepare(sql);
  return {
    get: async (...p) => stmt.get(...p),
    all: async (...p) => stmt.all(...p),
    run: async (...p) => stmt.run(...p),
  };
};
const _origExec = db.exec.bind(db);
db.exec = async (sql, ...p) => _origExec(sql, ...p);
const _origTrans = db.transaction.bind(db);
db.transaction = (fn) => {
  const tx = _origTrans(fn);
  return async (...a) => tx(...a);
};

module.exports = db;
