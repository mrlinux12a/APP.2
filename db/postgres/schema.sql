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
ALTER TABLE orders ADD COLUMN IF NOT EXISTS geo_lat_consegna DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS geo_lng_consegna DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto1 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto2 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto3 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto4 DOUBLE PRECISION;
ALTER TABLE client_discount_rules ADD COLUMN IF NOT EXISTS sconto5 DOUBLE PRECISION;

-- Presa in carico firmata dal cliente: 'evaso' resta lo stato DB, 'consegnato' si deriva
-- da questa colonna valorizzata, senza toccare il CHECK su stato.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS consegnato_il TIMESTAMP;

-- Codice articolo ufficiale del produttore (diverso dal nostro "codice" interno): serve
-- per trovare schede tecniche e foto sul sito del produttore.
ALTER TABLE products ADD COLUMN IF NOT EXISTS codice_fornitore TEXT;

-- URL della foto prodotto (path locale sotto /public o URL esterno). NULL = nessuna foto,
-- la card mostra lo spazio vuoto: nessuna rottura per i prodotti non ancora fotografati.
ALTER TABLE products ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- session store per postgres
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session(expire);

-- Gruppi di prodotti identici a parte le misure (raggruppamento automatico per nome +
-- marca + categoria, verificato con soglia di prezzo prima di essere assegnato). Un
-- prodotto con gruppo_id NULL resta un articolo indipendente come oggi: nessuna rottura
-- per il catalogo esistente.
CREATE TABLE IF NOT EXISTS product_groups (
  id SERIAL PRIMARY KEY,
  marca TEXT NOT NULL,
  categoria TEXT,
  nome_rappresentativo TEXT NOT NULL,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS gruppo_id INTEGER REFERENCES product_groups(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS variante_valori TEXT;
CREATE INDEX IF NOT EXISTS idx_products_gruppo ON products(gruppo_id);

-- Pausa operativa del banco: distinta da "attivo" (che è l'attivazione della sede sulla
-- piattaforma). Un banco in pausa non riceve nuove richieste, ma resta visibile ovunque
-- altrove (punti vendita, clienti già approvati, storico).
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS ricezione_attiva INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------------
-- Indici aggiunti in audit: il catalogo (50k+ prodotti) non aveva indici sui campi con
-- cui si sfoglia (categoria/marchio/sottocategoria/misura) — ogni pagina faceva una
-- scansione sequenziale completa. Idem per i contatori del banco, ricalcolati ad ogni
-- pagina vista da un distributore filtrando orders/request_responses per distributor_id
-- senza indice dedicato.
-- ---------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_macro_attivo ON products(macro_slug, attivo);
CREATE INDEX IF NOT EXISTS idx_products_brand_attivo ON products(brand_slug, attivo);
CREATE INDEX IF NOT EXISTS idx_products_misura ON products(misura);
CREATE INDEX IF NOT EXISTS idx_orders_distributor_stato ON orders(distributor_id, stato);
CREATE INDEX IF NOT EXISTS idx_request_responses_distributor ON request_responses(distributor_id, esito);

-- Un solo ordine per richiesta: senza questo vincolo, una corsa fra la scelta manuale del
-- cliente e l'assegnazione automatica (o un doppio invio dello stesso click su "Invia
-- l'ordine") poteva creare due ordini per la stessa richiesta, anche verso due
-- distributori diversi. La vera barriera è applicativa (creaOrdineDaOfferta in server.js
-- reclama la richiesta con una UPDATE atomica prima di creare l'ordine); questo indice è
-- il ripiego a livello DB nel caso quella barriera venisse aggirata o rimossa per errore
-- in futuro. Verificato prima di crearlo: nessuna riga esistente lo violava.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_unico ON orders(request_id) WHERE request_id IS NOT NULL;

-- Una sola richiesta aperta per cliente alla volta: senza questo vincolo un doppio tap su
-- "Procedi" poteva creare due richieste 'in_attesa' per lo stesso cliente (il controllo
-- applicativo richiestaBloccante() legge e poi scrive, non è atomico). Verificato prima
-- di crearlo: nessuna riga esistente lo violava.
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_cliente_aperta ON requests(cliente_id)
  WHERE stato IN ('in_attesa', 'con_offerte');

-- Ricerca prodotti: LOWER(nome) LIKE '%termine%' con jolly iniziale non può usare un
-- indice B-tree, quindi ogni ricerca (richiamata ad ogni digitazione, catalogo.js
-- cercaProdotti) faceva una scansione sequenziale su 50k+ righe. pg_trgm accelera
-- automaticamente LIKE/ILIKE con jolly su entrambi i lati una volta creato l'indice GIN
-- sull'espressione — nessuna modifica alla query in catalogo.js, che già usa esattamente
-- LOWER(nome)/LOWER(codice).
-- NOTA operativa: node scripts/apply_schema_pg.js manda tutto questo file in una sola
-- query multi-istruzione, che Postgres esegue come un'unica transazione implicita — se
-- CREATE EXTENSION fallisse per mancanza di privilegi, andrebbe in rollback anche tutto
-- il resto del file. Va quindi applicata con una passata separata (aggiungendo queste
-- righe solo dopo aver già applicato ed eseguito con successo il resto della migrazione).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_nome_trgm ON products USING GIN (LOWER(nome) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_codice_trgm ON products USING GIN (LOWER(codice) gin_trgm_ops);

-- sottocategoria era una singola colonna testo: non può rappresentare un prodotto a
-- cavallo di due sottocategorie (caso reale, gestito assegnando entrambe). Sostituita da
-- questa relazione molti-a-molti — la colonna non era mai stata popolata, nessun dato
-- perso nel passaggio. Vedi scripts/assegna_sottocategorie.js per il popolamento.
ALTER TABLE products DROP COLUMN IF EXISTS sottocategoria;

CREATE TABLE IF NOT EXISTS product_sottocategorie (
  product_id INTEGER NOT NULL REFERENCES products(id),
  macro_slug TEXT NOT NULL,
  sottocategoria_slug TEXT NOT NULL,
  PRIMARY KEY (product_id, macro_slug, sottocategoria_slug)
);
CREATE INDEX IF NOT EXISTS idx_product_sottocat_lookup ON product_sottocategorie(macro_slug, sottocategoria_slug);

-- Accessi dell'app nativa (src/token_app.js): il telefono conserva il token, qui ne resta
-- solo l'hash. revocato_il si imposta al logout dall'app; un token non usato da 60 giorni
-- smette comunque di valere (controllo sulla data di usato_il, nessuna pulizia necessaria).
CREATE TABLE IF NOT EXISTS app_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  dispositivo TEXT,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  usato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  revocato_il TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_tokens_user ON app_tokens(user_id);

-- Ricerca veloce (catalogo.js, cercaProdotti). Prima ogni ricerca faceva una scansione di tutte
-- le 27.676 righe (~220 ms nel DB): le condizioni erano messe in OR su sei colonne e sulla
-- somiglianza, e in quella forma gli indici pg_trgm sopra non si possono usare.
-- Qui: (1) un testo unico cercabile con il suo indice GIN, (2) due funzioni che restituiscono
-- gli id dei prodotti che contengono un termine. La ricerca interseca gli id dei termini
-- sull'indice e applica gli altri filtri alle poche righe rimaste: ~45 ms invece di ~220.
-- Stessi risultati di prima (verificato su 25 ricerche), con una differenza voluta: il
-- marchio e la categoria si cercano dallo slug (stesse parole del nome) e non più dalla
-- tabella brands.
-- ATTENZIONE: ricerca_testo è nell'indice: se si cambia il suo corpo l'indice va ricreato.
CREATE OR REPLACE FUNCTION ricerca_testo(nome text, codice text, categoria text, ean text, macro text, brand text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT lower(coalesce(nome, '') || ' ' || coalesce(codice, '') || ' ' || coalesce(categoria, '') || ' ' || coalesce(ean, '') || ' ' || coalesce(macro, '') || ' ' || coalesce(brand, '')) $$;

CREATE INDEX IF NOT EXISTS idx_products_ricerca_trgm ON products
  USING GIN (ricerca_testo(nome, codice, categoria, ean, macro_slug, brand_slug) gin_trgm_ops);

-- Prodotti che contengono il termine (anche a metà parola), termine di almeno 3 caratteri.
CREATE OR REPLACE FUNCTION ricerca_esatti(termine text) RETURNS SETOF integer
LANGUAGE sql STABLE
AS $$ SELECT id FROM public.products
       WHERE attivo = 1
         AND public.ricerca_testo(nome, codice, categoria, ean, macro_slug, brand_slug) LIKE '%' || termine || '%' $$;

-- Come sopra, più i refusi di battitura: parola del nome simile al termine (soglia 0.45, la
-- stessa di sempre). L'operatore %> può usare l'indice, ma legge la soglia dall'impostazione
-- pg_trgm.word_similarity_threshold: con il pooler in modalità transazione una SET di
-- sessione non è affidabile, invece la clausola SET di una funzione vale per la sola durata
-- della chiamata, senza stato condiviso. 0.450001 e non 0.45: %> confronta con >=, la
-- funzione word_similarity() usata prima con >.
CREATE OR REPLACE FUNCTION ricerca_simili(termine text) RETURNS SETOF integer
LANGUAGE sql STABLE
SET pg_trgm.word_similarity_threshold = '0.450001'
AS $$ SELECT id FROM public.products
       WHERE attivo = 1
         AND (public.ricerca_testo(nome, codice, categoria, ean, macro_slug, brand_slug) LIKE '%' || termine || '%'
              OR lower(nome) %> termine) $$;

-- ---------- Ditte e filiali ----------
-- Una ditta (es. Borea) ha più filiali; ogni filiale è una riga di `distributors` (ditta_id) e i
-- suoi dipendenti sono utenti `users` con ruolo 'distributore' e distributor_id = la filiale.
-- L'installatore vede solo la ditta: la filiale conta per chi risponde e da dove parte l'ordine.
CREATE TABLE IF NOT EXISTS ditte (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ragione_sociale TEXT NOT NULL DEFAULT '',
  partita_iva TEXT NOT NULL DEFAULT '',
  indirizzo TEXT NOT NULL DEFAULT '',
  cap TEXT NOT NULL DEFAULT '',
  citta TEXT NOT NULL DEFAULT '',
  provincia TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  sdi_pec TEXT NOT NULL DEFAULT '',
  attivo INTEGER NOT NULL DEFAULT 1,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE distributors ADD COLUMN IF NOT EXISTS ditta_id INTEGER REFERENCES ditte(id);
-- `nome` è il nome della ditta e si ripete per ogni sua filiale: unica è la coppia nome + filiale.
ALTER TABLE distributors DROP CONSTRAINT IF EXISTS distributors_nome_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_distributors_nome_filiale ON distributors(nome, filiale);
CREATE INDEX IF NOT EXISTS idx_distributors_ditta ON distributors(ditta_id);

-- Nome e cognome del dipendente (per gli altri ruoli restano vuoti: lì vale ragione_sociale).
ALTER TABLE users ADD COLUMN IF NOT EXISTS nome TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS cognome TEXT NOT NULL DEFAULT '';

-- Chi, fra i dipendenti della filiale, ha risposto alla richiesta.
ALTER TABLE request_responses ADD COLUMN IF NOT EXISTS risposto_da INTEGER REFERENCES users(id);

-- Gruppo WhatsApp dei corrieri: coda dei messaggi (da inviare / inviati) e risposta del corriere.
CREATE TABLE IF NOT EXISTS whatsapp_messaggi (
  id SERIAL PRIMARY KEY,
  order_id INTEGER,
  tipo TEXT NOT NULL DEFAULT 'ordine',
  testo TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'da_inviare' CHECK (stato IN ('da_inviare', 'inviato')),
  wa_msg_id TEXT,
  tentativi INTEGER NOT NULL DEFAULT 0,
  errore TEXT,
  creato_il TIMESTAMP NOT NULL DEFAULT NOW(),
  inviato_il TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messaggi_wa_id ON whatsapp_messaggi(wa_msg_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messaggi_order ON whatsapp_messaggi(order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messaggi_coda ON whatsapp_messaggi(id) WHERE stato = 'da_inviare';

-- Tempo di consegna scritto dal corriere nel gruppo (TIMESTAMPTZ: l'orario d'arrivo è un istante vero).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS corriere_minuti INTEGER;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS corriere_arrivo_il TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS corriere_risposto_il TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS corriere_nome TEXT NOT NULL DEFAULT '';
