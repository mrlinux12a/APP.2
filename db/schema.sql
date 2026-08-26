-- Schema minimo per MVP ordini minuteria (Blocco 1: users, products, orders, order_items, config)

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codice TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  categoria TEXT,
  macro_slug TEXT NOT NULL DEFAULT 'minuteria',
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
  evaso_il TEXT,
  request_id INTEGER,
  distributor_id INTEGER,
  consegna_ore INTEGER,
  costo_consegna REAL NOT NULL DEFAULT 0,
  iva REAL NOT NULL DEFAULT 0,
  totale_ivato REAL NOT NULL DEFAULT 0
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
  subtotale REAL NOT NULL,
  prezzo_unitario_cliente REAL NOT NULL DEFAULT 0,
  subtotale_cliente REAL NOT NULL DEFAULT 0
);

-- Config chiave/valore: usata per il servizio consegna (%), non esposta al cliente come percentuale
CREATE TABLE IF NOT EXISTS config (
  chiave TEXT PRIMARY KEY,
  valore TEXT NOT NULL
);

INSERT OR IGNORE INTO config (chiave, valore) VALUES ('servizio_pct', '10');

-- ============================================================
-- Blocco 2 — Vista cliente mobile: macro categorie, distributori,
-- richieste di disponibilità, offerte, notifiche.
-- ============================================================

-- Macro categorie merceologiche mostrate in home (Condizionamento, Caldaie, ...)
CREATE TABLE IF NOT EXISTS macro_categorie (
  slug TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  icona TEXT NOT NULL DEFAULT '',
  descrizione TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0
);

-- Distributori / rivenditori che possono confermare la disponibilità al banco
CREATE TABLE IF NOT EXISTS distributors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE,
  filiale TEXT NOT NULL,               -- banco di riferimento (in futuro: filiale)
  zona TEXT NOT NULL,                  -- zona geografica servita
  consegna_ore_default INTEGER NOT NULL DEFAULT 24,
  costo_consegna REAL NOT NULL DEFAULT 0,
  attivo INTEGER NOT NULL DEFAULT 1
);

-- Listino per distributore: quali prodotti tratta e a che condizioni
CREATE TABLE IF NOT EXISTS distributor_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  prezzo_listino REAL NOT NULL,
  sconto_base_pct REAL NOT NULL DEFAULT 0,
  UNIQUE (distributor_id, product_id)
);

-- Richiesta di disponibilità inviata ai distributori della zona (finestra 10 minuti)
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  zona TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (stato IN ('in_attesa', 'con_offerte', 'nessuna_offerta', 'ordinata', 'annullata')),
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  scade_il TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantita INTEGER NOT NULL
);

-- Risposta del singolo distributore. La non risposta entro i 10 minuti diventa 'scaduto'
-- e NON vale come disponibilità confermata.
CREATE TABLE IF NOT EXISTS request_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  esito TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (esito IN ('in_attesa', 'confermato', 'non_disponibile', 'scaduto')),
  consegna_ore INTEGER,
  totale REAL,
  note TEXT,
  risposto_il TEXT,
  UNIQUE (request_id, distributor_id)
);

-- Notifiche in-app (usate anche come sorgente per la notifica push del browser)
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  titolo TEXT NOT NULL,
  testo TEXT NOT NULL,
  link TEXT,
  letta INTEGER NOT NULL DEFAULT 0,
  notificata INTEGER NOT NULL DEFAULT 0,   -- già mostrata come push dal browser
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, letta);
CREATE INDEX IF NOT EXISTS idx_request_responses_req ON request_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_distributor_products_prod ON distributor_products(product_id);

INSERT OR IGNORE INTO config (chiave, valore) VALUES ('iva_pct', '22');
INSERT OR IGNORE INTO config (chiave, valore) VALUES ('finestra_conferma_min', '10');

-- ============================================================
-- Blocco 3 — Vista distributore: disponibilità parziale, tempo di partenza,
-- anagrafica completa del cliente e DDT / bolla intestata.
-- ============================================================

-- Righe della risposta: quante quantità il banco riesce davvero a coprire.
-- Se per una riga la quantità disponibile è minore di quella richiesta, la conferma
-- è parziale; se sono tutte a zero è un rifiuto per indisponibilità.
CREATE TABLE IF NOT EXISTS request_response_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id INTEGER NOT NULL REFERENCES request_responses(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantita_richiesta INTEGER NOT NULL,
  quantita_disponibile INTEGER NOT NULL,
  UNIQUE (response_id, product_id)
);

-- Numerazione progressiva del DDT, per distributore e per anno.
CREATE TABLE IF NOT EXISTS ddt_counters (
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  anno INTEGER NOT NULL,
  ultimo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (distributor_id, anno)
);

CREATE INDEX IF NOT EXISTS idx_response_items ON request_response_items(response_id);

-- ============================================================
-- Blocco 4 — Marchi (listini ufficiali dei produttori) e mappa.
-- La struttura è generica: TOSHIBA è il primo marchio caricato, ne possono
-- seguire quanti se ne vuole con lo stesso importatore.
-- ============================================================

CREATE TABLE IF NOT EXISTS brands (
  slug TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  colore TEXT NOT NULL DEFAULT '#1d4e89',
  iniziali TEXT NOT NULL DEFAULT '',
  distributore_ufficiale TEXT NOT NULL DEFAULT '',
  listino_nome TEXT NOT NULL DEFAULT '',
  listino_aggiornato TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0,
  attivo INTEGER NOT NULL DEFAULT 1,
  sconto_default_pct REAL NOT NULL DEFAULT 0
);

-- Famiglie di prodotto dentro un marchio (RAS, ESTIA, VRF... per Toshiba).
CREATE TABLE IF NOT EXISTS brand_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0,
  UNIQUE (brand_slug, codice)
);

-- Sconto concordato tra un banco e un singolo cliente: precompila il modulo di risposta
-- quando arriva una richiesta da quel cliente.
CREATE TABLE IF NOT EXISTS client_discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  sconto_pct REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (distributor_id, cliente_id)
);
