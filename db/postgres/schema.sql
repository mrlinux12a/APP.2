-- Postgres schema per Minuteria (equivalente a schema.sql)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('cliente', 'agente', 'distributore')),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  ragione_sociale TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  distributor_id INTEGER,
  zona TEXT NOT NULL DEFAULT 'Genova'
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  codice TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  categoria TEXT,
  macro_slug TEXT NOT NULL DEFAULT 'minuteria',
  prezzo_listino DOUBLE PRECISION NOT NULL,
  sconto_base_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  disponibilita TEXT NOT NULL DEFAULT 'disponibile'
    CHECK (disponibilita IN ('disponibile', 'in_esaurimento', 'non_disponibile')),
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  aggiornato_il TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  stato TEXT NOT NULL DEFAULT 'inviato' CHECK (stato IN ('inviato', 'in_evasione', 'evaso')),
  modalita TEXT NOT NULL CHECK (modalita IN ('ritiro', 'consegna_mezzo_grossista', 'consegna_esterna')),
  note TEXT,
  totale_netto DOUBLE PRECISION NOT NULL,
  totale_finale DOUBLE PRECISION NOT NULL,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  in_evasione_il TIMESTAMP,
  evaso_il TIMESTAMP,
  request_id INTEGER,
  distributor_id INTEGER,
  consegna_ore INTEGER,
  costo_consegna DOUBLE PRECISION NOT NULL DEFAULT 0,
  iva DOUBLE PRECISION NOT NULL DEFAULT 0,
  totale_ivato DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  codice_snapshot TEXT NOT NULL,
  nome_snapshot TEXT NOT NULL,
  quantita INTEGER NOT NULL,
  prezzo_listino_snapshot DOUBLE PRECISION NOT NULL,
  sconto_pct_snapshot DOUBLE PRECISION NOT NULL,
  prezzo_netto_unitario DOUBLE PRECISION NOT NULL,
  subtotale DOUBLE PRECISION NOT NULL,
  prezzo_unitario_cliente DOUBLE PRECISION NOT NULL DEFAULT 0,
  subtotale_cliente DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS config (
  chiave TEXT PRIMARY KEY,
  valore TEXT NOT NULL
);

INSERT INTO config (chiave, valore) VALUES ('servizio_pct', '10') ON CONFLICT (chiave) DO NOTHING;

CREATE TABLE IF NOT EXISTS macro_categorie (
  slug TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  icona TEXT NOT NULL DEFAULT '',
  descrizione TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS distributors (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  filiale TEXT NOT NULL,
  zona TEXT NOT NULL,
  consegna_ore_default INTEGER NOT NULL DEFAULT 24,
  costo_consegna DOUBLE PRECISION NOT NULL DEFAULT 0,
  attivo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS distributor_products (
  id SERIAL PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  prezzo_listino DOUBLE PRECISION NOT NULL,
  sconto_base_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (distributor_id, product_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  zona TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (stato IN ('in_attesa', 'con_offerte', 'nessuna_offerta', 'ordinata', 'annullata')),
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  scade_il TIMESTAMP NOT NULL,
  order_id INTEGER REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS request_items (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantita INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS request_responses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  esito TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (esito IN ('in_attesa', 'confermato', 'non_disponibile', 'scaduto')),
  consegna_ore INTEGER,
  totale DOUBLE PRECISION,
  note TEXT,
  risposto_il TIMESTAMP,
  UNIQUE (request_id, distributor_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  titolo TEXT NOT NULL,
  testo TEXT NOT NULL,
  link TEXT,
  letta INTEGER NOT NULL DEFAULT 0,
  notificata INTEGER NOT NULL DEFAULT 0,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, letta);
CREATE INDEX IF NOT EXISTS idx_request_responses_req ON request_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_distributor_products_prod ON distributor_products(product_id);

INSERT INTO config (chiave, valore) VALUES ('iva_pct', '22') ON CONFLICT (chiave) DO NOTHING;
INSERT INTO config (chiave, valore) VALUES ('finestra_conferma_min', '10') ON CONFLICT (chiave) DO NOTHING;

CREATE TABLE IF NOT EXISTS request_response_items (
  id SERIAL PRIMARY KEY,
  response_id INTEGER NOT NULL REFERENCES request_responses(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantita_richiesta INTEGER NOT NULL,
  quantita_disponibile INTEGER NOT NULL,
  UNIQUE (response_id, product_id)
);

CREATE TABLE IF NOT EXISTS ddt_counters (
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  anno INTEGER NOT NULL,
  ultimo INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (distributor_id, anno)
);

CREATE INDEX IF NOT EXISTS idx_response_items ON request_response_items(response_id);

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
  sconto_default_pct DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brand_families (
  id SERIAL PRIMARY KEY,
  brand_slug TEXT NOT NULL REFERENCES brands(slug),
  codice TEXT NOT NULL,
  nome TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0,
  UNIQUE (brand_slug, codice)
);

CREATE TABLE IF NOT EXISTS client_discounts (
  id SERIAL PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  sconto_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  aggiornato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (distributor_id, cliente_id)
);

CREATE TABLE IF NOT EXISTS store_locations (
  id SERIAL PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  nome TEXT NOT NULL,
  indirizzo TEXT NOT NULL,
  cap TEXT NOT NULL DEFAULT '',
  citta TEXT NOT NULL DEFAULT '',
  provincia TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  geo_lat DOUBLE PRECISION,
  geo_lng DOUBLE PRECISION,
  geocodifica TEXT NOT NULL DEFAULT '',
  attivo INTEGER NOT NULL DEFAULT 1,
  UNIQUE (distributor_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_store_locations_citta ON store_locations(citta);

CREATE TABLE IF NOT EXISTS client_distributors (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (stato IN ('in_attesa', 'approvato', 'rifiutato')),
  codice_cliente TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  richiesto_il TIMESTAMP NOT NULL DEFAULT NOW(),
  deciso_il TIMESTAMP,
  UNIQUE (cliente_id, distributor_id)
);

CREATE TABLE IF NOT EXISTS client_discount_rules (
  id SERIAL PRIMARY KEY,
  distributor_id INTEGER NOT NULL REFERENCES distributors(id),
  cliente_id INTEGER NOT NULL REFERENCES users(id),
  ambito TEXT NOT NULL CHECK (ambito IN ('generale', 'marchio', 'macro', 'famiglia')),
  chiave TEXT NOT NULL DEFAULT '',
  sconto_pct DOUBLE PRECISION NOT NULL,
  aggiornato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (distributor_id, cliente_id, ambito, chiave)
);

CREATE INDEX IF NOT EXISTS idx_client_distributors_dist ON client_distributors(distributor_id, stato);
CREATE INDEX IF NOT EXISTS idx_discount_rules ON client_discount_rules(distributor_id, cliente_id);

CREATE TABLE IF NOT EXISTS sottocategorie (
  id SERIAL PRIMARY KEY,
  macro_slug TEXT NOT NULL,
  slug TEXT NOT NULL,
  nome TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  misure TEXT NOT NULL DEFAULT '',
  ordine INTEGER NOT NULL DEFAULT 0,
  UNIQUE (macro_slug, slug)
);

CREATE INDEX IF NOT EXISTS idx_sottocategorie_macro ON sottocategorie(macro_slug);

INSERT INTO config (chiave, valore) VALUES ('finestra_scelta_min', '5') ON CONFLICT (chiave) DO NOTHING;
INSERT INTO config (chiave, valore) VALUES ('ordine_minimo', '33') ON CONFLICT (chiave) DO NOTHING;
INSERT INTO config (chiave, valore) VALUES ('spedizione_fissa', '10') ON CONFLICT (chiave) DO NOTHING;
INSERT INTO config (chiave, valore) VALUES ('velocita_media_kmh', '25') ON CONFLICT (chiave) DO NOTHING;

-- colonne aggiunte via migrazioni (già in schema base per pg)
ALTER TABLE products ADD COLUMN IF NOT EXISTS unita_misura TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS marca TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS serie TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_slug TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS famiglia TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS ean TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS raee DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cat_raee TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS refrigerante TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fgas_kg DOUBLE PRECISION;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gwp DOUBLE PRECISION;
ALTER TABLE products ADD COLUMN IF NOT EXISTS misura TEXT;
ALTER TABLE request_responses ADD COLUMN IF NOT EXISTS partenza_ore INTEGER;
ALTER TABLE request_responses ADD COLUMN IF NOT EXISTS copertura TEXT NOT NULL DEFAULT 'totale';
ALTER TABLE request_responses ADD COLUMN IF NOT EXISTS sconto_cliente_pct DOUBLE PRECISION;
ALTER TABLE request_responses ADD COLUMN IF NOT EXISTS consegna_minuti_stimati INTEGER;
ALTER TABLE request_response_items ADD COLUMN IF NOT EXISTS sconto_riga_pct DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS partenza_ore INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS destinazione TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_numero TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_data TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_colli INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_aspetto TEXT NOT NULL DEFAULT 'Colli';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_trasporto TEXT NOT NULL DEFAULT 'mittente';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_causale TEXT NOT NULL DEFAULT 'Vendita';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ddt_note TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preso_in_carico_il TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contributo_raee DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_consenso INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_precisione DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_aggiornata_il TIMESTAMP;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracciamento_attivo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS scelta_scade_il TIMESTAMP;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS assegnata_auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS ragione_sociale TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS partita_iva TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS indirizzo TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS cap TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS citta TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS provincia TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS telefono TEXT NOT NULL DEFAULT '';
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS partita_iva TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS codice_fiscale TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS indirizzo TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cap TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS citta TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provincia TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS sdi_pec TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS indirizzo_consegna TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS referente TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS raee_unitario DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS raee_riga DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS categoria TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sottostato TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS order_id INTEGER;

-- colonne trovate mancanti confrontando con lo schema sqlite effettivo (allineamento pre-import)
ALTER TABLE macro_categorie ADD COLUMN IF NOT EXISTS priorita INTEGER NOT NULL DEFAULT 99;
ALTER TABLE macro_categorie ADD COLUMN IF NOT EXISTS in_evidenza INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tipo_soggetto TEXT NOT NULL DEFAULT 'impresa';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stato_anagrafica TEXT NOT NULL DEFAULT 'attivo';
ALTER TABLE users ADD COLUMN IF NOT EXISTS iscritto_il TIMESTAMP;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sottocategoria TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS geo_lat_consegna DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS geo_lng_consegna DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto1 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto2 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto3 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto4 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto5 DOUBLE PRECISION;

-- session store per postgres
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);
