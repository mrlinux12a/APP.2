-- Schema minimo per MVP ordini minuteria (Blocco 1: users, products, orders, order_items, config)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('cliente', 'agente')),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  ragione_sociale TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  categoria TEXT,
  prezzo_listino REAL NOT NULL,
  sconto_base_pct REAL NOT NULL DEFAULT 0,
  disponibilita TEXT NOT NULL DEFAULT 'disponibile'
    CHECK (disponibilita IN ('disponibile', 'in_esaurimento', 'non_disponibile')),
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  stato TEXT NOT NULL DEFAULT 'inviato' CHECK (stato IN ('inviato', 'in_evasione', 'evaso')),
  modalita TEXT NOT NULL CHECK (modalita IN ('ritiro', 'consegna_mezzo_grossista', 'consegna_esterna')),
  note TEXT,
  totale_netto REAL NOT NULL,
  totale_finale REAL NOT NULL,
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  in_evasione_il TEXT,
  evaso_il TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  codice_snapshot TEXT NOT NULL,
  nome_snapshot TEXT NOT NULL,
  quantita INTEGER NOT NULL,
  prezzo_listino_snapshot REAL NOT NULL,
  sconto_pct_snapshot REAL NOT NULL,
  prezzo_netto_unitario REAL NOT NULL,
  subtotale REAL NOT NULL
);

-- Config chiave/valore: usata per il servizio consegna (%), non esposta al cliente come percentuale
CREATE TABLE IF NOT EXISTS config (
  chiave TEXT PRIMARY KEY,
  valore TEXT NOT NULL
);

INSERT OR IGNORE INTO config (chiave, valore) VALUES ('servizio_pct', '10');
