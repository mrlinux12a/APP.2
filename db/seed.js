// Seed dati demo.
// Il catalogo qui è "finto ma realistico" solo per verificare il flusso:
// il caricamento vero del catalogo (CSV/form) resta da fare.
// Lo script è idempotente: si può rilanciare senza duplicare nulla.
const bcrypt = require('bcryptjs');
const db = require('./index');

const ZONA = 'Genova';

// ATTENZIONE: partite IVA, codici fiscali e indirizzi qui sotto sono valori di comodo per la
// demo, non dati reali delle aziende citate. Vanno sostituiti con le anagrafiche vere prima
// di emettere qualsiasi documento fiscale.
function upsertUser(u) {
  const dati = {
    distributor_id: null,
    zona: ZONA,
    email: '',
    telefono: '',
    partita_iva: '',
    codice_fiscale: '',
    indirizzo: '',
    cap: '',
    citta: '',
    provincia: '',
    sdi_pec: '',
    indirizzo_consegna: '',
    referente: '',
    ...u,
    password_hash: bcrypt.hashSync(u.password, 10),
  };
  delete dati.password;
  db.prepare(
    `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, email, telefono,
                        distributor_id, zona, partita_iva, codice_fiscale, indirizzo, cap,
                        citta, provincia, sdi_pec, indirizzo_consegna, referente)
     VALUES (@ruolo, @username, @password_hash, @ragione_sociale, @email, @telefono,
             @distributor_id, @zona, @partita_iva, @codice_fiscale, @indirizzo, @cap,
             @citta, @provincia, @sdi_pec, @indirizzo_consegna, @referente)
     ON CONFLICT(username) DO UPDATE SET
       ruolo = excluded.ruolo,
       password_hash = excluded.password_hash,
       ragione_sociale = excluded.ragione_sociale,
       email = excluded.email,
       telefono = excluded.telefono,
       distributor_id = excluded.distributor_id,
       zona = excluded.zona,
       partita_iva = excluded.partita_iva,
       codice_fiscale = excluded.codice_fiscale,
       indirizzo = excluded.indirizzo,
       cap = excluded.cap,
       citta = excluded.citta,
       provincia = excluded.provincia,
       sdi_pec = excluded.sdi_pec,
       indirizzo_consegna = excluded.indirizzo_consegna,
       referente = excluded.referente`
  ).run(dati);
}

function upsertMacro(m) {
  db.prepare(
    `INSERT INTO macro_categorie (slug, nome, icona, descrizione, ordine)
     VALUES (@slug, @nome, @icona, @descrizione, @ordine)
     ON CONFLICT(slug) DO UPDATE SET
       nome = excluded.nome,
       icona = excluded.icona,
       descrizione = excluded.descrizione,
       ordine = excluded.ordine`
  ).run(m);
}

function upsertProduct(p) {
  db.prepare(
    `INSERT INTO products (codice, nome, categoria, macro_slug, prezzo_listino, sconto_base_pct, disponibilita)
     VALUES (@codice, @nome, @categoria, @macro_slug, @prezzo_listino, @sconto_base_pct, @disponibilita)
     ON CONFLICT(codice) DO UPDATE SET
       nome = excluded.nome,
       categoria = excluded.categoria,
       macro_slug = excluded.macro_slug,
       prezzo_listino = excluded.prezzo_listino,
       sconto_base_pct = excluded.sconto_base_pct,
       disponibilita = excluded.disponibilita,
       aggiornato_il = datetime('now')`
  ).run(p);
}

function upsertDistributor(d) {
  db.prepare(
    `INSERT INTO distributors (nome, filiale, zona, consegna_ore_default, costo_consegna, attivo,
                               ragione_sociale, partita_iva, indirizzo, cap, citta, provincia,
                               telefono, email)
     VALUES (@nome, @filiale, @zona, @consegna_ore_default, @costo_consegna, 1,
             @ragione_sociale, @partita_iva, @indirizzo, @cap, @citta, @provincia,
             @telefono, @email)
     ON CONFLICT(nome) DO UPDATE SET
       filiale = excluded.filiale,
       zona = excluded.zona,
       consegna_ore_default = excluded.consegna_ore_default,
       costo_consegna = excluded.costo_consegna,
       attivo = 1,
       ragione_sociale = excluded.ragione_sociale,
       partita_iva = excluded.partita_iva,
       indirizzo = excluded.indirizzo,
       cap = excluded.cap,
       citta = excluded.citta,
       provincia = excluded.provincia,
       telefono = excluded.telefono,
       email = excluded.email`
  ).run(d);
  return db.prepare('SELECT * FROM distributors WHERE nome = ?').get(d.nome);
}

function upsertListino({ distributor_id, product_id, prezzo_listino, sconto_base_pct }) {
  db.prepare(
    `INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct)
     VALUES (@distributor_id, @product_id, @prezzo_listino, @sconto_base_pct)
     ON CONFLICT(distributor_id, product_id) DO UPDATE SET
       prezzo_listino = excluded.prezzo_listino,
       sconto_base_pct = excluded.sconto_base_pct`
  ).run({ distributor_id, product_id, prezzo_listino, sconto_base_pct });
}

// ---------- Macro categorie merceologiche (home cliente) ----------

const macro = [
  { slug: 'condizionamento', nome: 'Condizionamento', icona: '❄', descrizione: 'Split, multisplit, pompe di calore e accessori', ordine: 1 },
  { slug: 'caldaie', nome: 'Caldaie e scaldacqua', icona: '🔥', descrizione: 'Caldaie a condensazione, scaldabagni, kit fumi', ordine: 2 },
  { slug: 'minuteria', nome: 'Minuteria e raccorderia', icona: '🔧', descrizione: 'Raccordi, valvole, viteria, sigillanti', ordine: 3 },
];

// ---------- Catalogo ----------

const prodotti = [
  // Condizionamento
  { codice: 'CND-101', nome: 'Climatizzatore mono split 9000 BTU R32 inverter', categoria: 'Mono split', macro_slug: 'condizionamento', prezzo_listino: 690.00, sconto_base_pct: 38, disponibilita: 'disponibile' },
  { codice: 'CND-102', nome: 'Climatizzatore mono split 12000 BTU R32 inverter', categoria: 'Mono split', macro_slug: 'condizionamento', prezzo_listino: 810.00, sconto_base_pct: 38, disponibilita: 'disponibile' },
  { codice: 'CND-103', nome: 'Climatizzatore mono split 18000 BTU R32 inverter', categoria: 'Mono split', macro_slug: 'condizionamento', prezzo_listino: 1180.00, sconto_base_pct: 36, disponibilita: 'disponibile' },
  { codice: 'CND-201', nome: 'Unità esterna dual split 14000 BTU', categoria: 'Multisplit', macro_slug: 'condizionamento', prezzo_listino: 1290.00, sconto_base_pct: 35, disponibilita: 'disponibile' },
  { codice: 'CND-202', nome: 'Unità esterna trial split 21000 BTU', categoria: 'Multisplit', macro_slug: 'condizionamento', prezzo_listino: 1740.00, sconto_base_pct: 35, disponibilita: 'in_esaurimento' },
  { codice: 'CND-203', nome: 'Unità interna a parete 9000 BTU per multisplit', categoria: 'Multisplit', macro_slug: 'condizionamento', prezzo_listino: 430.00, sconto_base_pct: 36, disponibilita: 'disponibile' },
  { codice: 'CND-301', nome: 'Tubo rame coibentato 1/4"-3/8" (rotolo 25 m)', categoria: 'Accessori installazione', macro_slug: 'condizionamento', prezzo_listino: 148.00, sconto_base_pct: 22, disponibilita: 'disponibile' },
  { codice: 'CND-302', nome: 'Staffa a muro per unità esterna 450 mm', categoria: 'Accessori installazione', macro_slug: 'condizionamento', prezzo_listino: 34.00, sconto_base_pct: 25, disponibilita: 'disponibile' },
  { codice: 'CND-303', nome: 'Pompa scarico condensa silenziata', categoria: 'Accessori installazione', macro_slug: 'condizionamento', prezzo_listino: 96.00, sconto_base_pct: 24, disponibilita: 'disponibile' },
  { codice: 'CND-304', nome: 'Canalina in PVC 80x60 bianca (barra 2 m)', categoria: 'Accessori installazione', macro_slug: 'condizionamento', prezzo_listino: 21.50, sconto_base_pct: 20, disponibilita: 'disponibile' },
  { codice: 'CND-305', nome: 'Bombola gas refrigerante R32 da 9 kg', categoria: 'Accessori installazione', macro_slug: 'condizionamento', prezzo_listino: 185.00, sconto_base_pct: 18, disponibilita: 'disponibile' },
  { codice: 'CND-401', nome: 'Pompa di calore aria-acqua monoblocco 8 kW', categoria: 'Pompe di calore', macro_slug: 'condizionamento', prezzo_listino: 4250.00, sconto_base_pct: 32, disponibilita: 'disponibile' },

  // Caldaie e scaldacqua
  { codice: 'CAL-101', nome: 'Caldaia murale a condensazione 24 kW', categoria: 'Caldaie murali', macro_slug: 'caldaie', prezzo_listino: 1320.00, sconto_base_pct: 40, disponibilita: 'disponibile' },
  { codice: 'CAL-102', nome: 'Caldaia murale a condensazione 28 kW', categoria: 'Caldaie murali', macro_slug: 'caldaie', prezzo_listino: 1490.00, sconto_base_pct: 40, disponibilita: 'disponibile' },
  { codice: 'CAL-103', nome: 'Caldaia murale a condensazione 32 kW con bollitore', categoria: 'Caldaie murali', macro_slug: 'caldaie', prezzo_listino: 2180.00, sconto_base_pct: 38, disponibilita: 'in_esaurimento' },
  { codice: 'CAL-201', nome: 'Scaldabagno a gas istantaneo 11 l/min', categoria: 'Scaldacqua', macro_slug: 'caldaie', prezzo_listino: 520.00, sconto_base_pct: 35, disponibilita: 'disponibile' },
  { codice: 'CAL-202', nome: 'Scaldacqua elettrico 80 l verticale', categoria: 'Scaldacqua', macro_slug: 'caldaie', prezzo_listino: 340.00, sconto_base_pct: 33, disponibilita: 'disponibile' },
  { codice: 'CAL-301', nome: 'Kit scarico fumi coassiale 60/100 orizzontale', categoria: 'Scarico fumi', macro_slug: 'caldaie', prezzo_listino: 78.00, sconto_base_pct: 28, disponibilita: 'disponibile' },
  { codice: 'CAL-302', nome: 'Prolunga coassiale 60/100 da 1 m', categoria: 'Scarico fumi', macro_slug: 'caldaie', prezzo_listino: 32.00, sconto_base_pct: 28, disponibilita: 'disponibile' },
  { codice: 'CAL-303', nome: 'Curva 90° coassiale 60/100', categoria: 'Scarico fumi', macro_slug: 'caldaie', prezzo_listino: 26.00, sconto_base_pct: 28, disponibilita: 'disponibile' },
  { codice: 'CAL-401', nome: 'Filtro defangatore magnetico 3/4"', categoria: 'Componenti impianto', macro_slug: 'caldaie', prezzo_listino: 118.00, sconto_base_pct: 30, disponibilita: 'disponibile' },
  { codice: 'CAL-402', nome: 'Vaso di espansione 8 litri per riscaldamento', categoria: 'Componenti impianto', macro_slug: 'caldaie', prezzo_listino: 42.00, sconto_base_pct: 26, disponibilita: 'disponibile' },
  { codice: 'CAL-403', nome: 'Circolatore elettronico 25-60 130 mm', categoria: 'Componenti impianto', macro_slug: 'caldaie', prezzo_listino: 210.00, sconto_base_pct: 30, disponibilita: 'disponibile' },
  { codice: 'CAL-404', nome: 'Cronotermostato Wi-Fi da parete', categoria: 'Regolazione', macro_slug: 'caldaie', prezzo_listino: 165.00, sconto_base_pct: 27, disponibilita: 'disponibile' },
  { codice: 'CAL-405', nome: 'Valvola di sicurezza 3 bar 1/2"', categoria: 'Componenti impianto', macro_slug: 'caldaie', prezzo_listino: 18.50, sconto_base_pct: 24, disponibilita: 'disponibile' },

  // Minuteria (catalogo storico)
  { codice: 'RAC-001', nome: 'Raccordo a T 1/2" ottone', categoria: 'Raccordi', macro_slug: 'minuteria', prezzo_listino: 3.50, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'RAC-002', nome: 'Raccordo a gomito 3/4" ottone', categoria: 'Raccordi', macro_slug: 'minuteria', prezzo_listino: 4.20, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'RAC-003', nome: 'Nipplo doppio 1/2" ottone', categoria: 'Raccordi', macro_slug: 'minuteria', prezzo_listino: 2.10, sconto_base_pct: 8, disponibilita: 'disponibile' },
  { codice: 'GUA-001', nome: 'Guarnizione EPDM 3/4" (conf. 10 pz)', categoria: 'Guarnizioni', macro_slug: 'minuteria', prezzo_listino: 5.00, sconto_base_pct: 5, disponibilita: 'disponibile' },
  { codice: 'GUA-002', nome: 'Guarnizione fibra 1/2" (conf. 10 pz)', categoria: 'Guarnizioni', macro_slug: 'minuteria', prezzo_listino: 4.50, sconto_base_pct: 5, disponibilita: 'in_esaurimento' },
  { codice: 'VIT-001', nome: 'Vite autofilettante 4x30 (conf. 100 pz)', categoria: 'Viteria', macro_slug: 'minuteria', prezzo_listino: 6.90, sconto_base_pct: 12, disponibilita: 'disponibile' },
  { codice: 'VIT-002', nome: 'Tassello ad espansione 8mm (conf. 50 pz)', categoria: 'Viteria', macro_slug: 'minuteria', prezzo_listino: 8.20, sconto_base_pct: 12, disponibilita: 'disponibile' },
  { codice: 'NAS-001', nome: 'Nastro teflon PTFE 12mm', categoria: 'Sigillanti', macro_slug: 'minuteria', prezzo_listino: 1.20, sconto_base_pct: 15, disponibilita: 'disponibile' },
  { codice: 'SIL-001', nome: 'Silicone sanitario trasparente 280ml', categoria: 'Sigillanti', macro_slug: 'minuteria', prezzo_listino: 4.80, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'FAS-001', nome: 'Fascetta stringitubo inox 20-32mm (conf. 10)', categoria: 'Fascette', macro_slug: 'minuteria', prezzo_listino: 6.50, sconto_base_pct: 8, disponibilita: 'disponibile' },
  { codice: 'VAL-001', nome: 'Valvola di sfiato automatica 1/2"', categoria: 'Valvole', macro_slug: 'minuteria', prezzo_listino: 9.90, sconto_base_pct: 7, disponibilita: 'disponibile' },
  { codice: 'VAL-002', nome: 'Valvola a sfera 3/4" PN25', categoria: 'Valvole', macro_slug: 'minuteria', prezzo_listino: 7.30, sconto_base_pct: 7, disponibilita: 'disponibile' },
  { codice: 'VAL-003', nome: 'Valvola termostatica 1/2" con testa', categoria: 'Valvole', macro_slug: 'minuteria', prezzo_listino: 24.50, sconto_base_pct: 12, disponibilita: 'disponibile' },
  { codice: 'VAL-004', nome: 'Valvola di ritegno 1" ottone', categoria: 'Valvole', macro_slug: 'minuteria', prezzo_listino: 12.80, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'TUB-001', nome: 'Tubo multistrato 16mm (rotolo 50m)', categoria: 'Tubazioni', macro_slug: 'minuteria', prezzo_listino: 68.00, sconto_base_pct: 6, disponibilita: 'disponibile' },
  { codice: 'TUB-002', nome: 'Raccordo a pressare 16mm', categoria: 'Tubazioni', macro_slug: 'minuteria', prezzo_listino: 3.90, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'ELE-001', nome: 'Nastro isolante elettrico', categoria: 'Elettrico', macro_slug: 'minuteria', prezzo_listino: 1.50, sconto_base_pct: 5, disponibilita: 'disponibile' },
];

// ---------- Distributori ----------

const distributori = [
  {
    nome: 'AFIS SPA', filiale: 'Banco Genova Sampierdarena', zona: ZONA,
    consegna_ore_default: 24, costo_consegna: 12.00,
    ragione_sociale: 'AFIS S.p.A.', partita_iva: '01234567891',
    indirizzo: 'Via Sampierdarena 118', cap: '16149', citta: 'Genova', provincia: 'GE',
    telefono: '010 1112221', email: 'banco.sampierdarena@afis.example',
  },
  {
    nome: 'BOREA SRL', filiale: 'Banco Genova Bolzaneto', zona: ZONA,
    consegna_ore_default: 48, costo_consegna: 0.00,
    ragione_sociale: 'BOREA S.r.l.', partita_iva: '01234567892',
    indirizzo: 'Via Bolzaneto 42', cap: '16162', citta: 'Genova', provincia: 'GE',
    telefono: '010 1112222', email: 'banco.bolzaneto@borea.example',
  },
  {
    nome: 'CAMBIELLI SPA', filiale: 'Banco Genova Marassi', zona: ZONA,
    consegna_ore_default: 6, costo_consegna: 15.00,
    ragione_sociale: 'CAMBIELLI S.p.A.', partita_iva: '01234567893',
    indirizzo: 'Corso Marassi 7', cap: '16141', citta: 'Genova', provincia: 'GE',
    telefono: '010 1112223', email: 'banco.marassi@cambielli.example',
  },
];

// Ogni distributore applica uno sconto Base diverso, e la convenienza ruota da prodotto a
// prodotto: così il confronto tra offerte è realistico e non vince sempre lo stesso.
const GRIGLIA_SCONTI = [
  [3, 6, 1], // prodotti con id % 3 === 0 → più conveniente BOREA
  [5, 2, 3], // id % 3 === 1 → più conveniente AFIS
  [2, 3, 7], // id % 3 === 2 → più conveniente CAMBIELLI
];

// Cosa NON tratta ogni distributore (per far vedere il caso "non tutti lo trattano").
const NON_TRATTATI = {
  'AFIS SPA': [],
  'BOREA SRL': ['CND-401', 'CND-305'],
  'CAMBIELLI SPA': ['ELE-001', 'CAL-404'],
};

// ---------- Esecuzione ----------

macro.forEach(upsertMacro);
prodotti.forEach(upsertProduct);

const distributoriSalvati = distributori.map(upsertDistributor);

const prodottiDb = db.prepare('SELECT * FROM products').all();
let righeListino = 0;
distributoriSalvati.forEach((d, distIdx) => {
  const esclusi = NON_TRATTATI[d.nome] || [];
  prodottiDb.forEach((p) => {
    if (esclusi.includes(p.codice)) return;
    const bonus = GRIGLIA_SCONTI[p.id % 3][distIdx];
    const sconto = Math.min(45, Math.round((p.sconto_base_pct + bonus) * 10) / 10);
    upsertListino({
      distributor_id: d.id,
      product_id: p.id,
      prezzo_listino: p.prezzo_listino,
      sconto_base_pct: sconto,
    });
    righeListino += 1;
  });
});

const utenti = [
  {
    ruolo: 'agente', username: 'agente', password: 'agente123',
    ragione_sociale: 'Grossista Demo — Agente', email: 'agente@example.com',
  },
  {
    ruolo: 'cliente', username: 'rossi', password: 'cliente123',
    ragione_sociale: 'Rossi Impianti S.r.l.', referente: 'Marco Rossi',
    email: 'rossi@example.com', telefono: '333 0000001',
    partita_iva: '02345678911', codice_fiscale: '02345678911',
    indirizzo: 'Via Tortona 3', cap: '16139', citta: 'Genova', provincia: 'GE',
    sdi_pec: 'M5UXCR1', indirizzo_consegna: 'Cantiere Via Tortona 3, 16139 Genova (GE)',
  },
  {
    ruolo: 'cliente', username: 'bianchi', password: 'cliente123',
    ragione_sociale: 'Idraulica Bianchi S.n.c.', referente: 'Luca Bianchi',
    email: 'bianchi@example.com', telefono: '333 0000002',
    partita_iva: '02345678912', codice_fiscale: '02345678912',
    indirizzo: 'Via Canevari 55', cap: '16137', citta: 'Genova', provincia: 'GE',
    sdi_pec: 'idraulicabianchi@pec.example', indirizzo_consegna: 'Via Canevari 55, 16137 Genova (GE)',
  },
  {
    ruolo: 'cliente', username: 'verdi', password: 'cliente123',
    ragione_sociale: 'Termoidraulica Verdi S.r.l.', referente: 'Anna Verdi',
    email: 'verdi@example.com', telefono: '333 0000003',
    partita_iva: '02345678913', codice_fiscale: '02345678913',
    indirizzo: 'Via Struppa 210', cap: '16165', citta: 'Genova', provincia: 'GE',
    sdi_pec: 'KRRH6B9', indirizzo_consegna: 'Magazzino Via Struppa 210, 16165 Genova (GE)',
  },
];

// Un profilo operatore per ogni banco distributore. I due richiesti — AFIS e CAMBIELLI —
// hanno anche il referente di banco compilato.
const REFERENTI_BANCO = {
  'AFIS SPA': 'Banco AFIS — Sampierdarena',
  'CAMBIELLI SPA': 'Banco CAMBIELLI — Marassi',
  'BOREA SRL': 'Banco BOREA — Bolzaneto',
};

distributoriSalvati.forEach((d) => {
  const username = d.nome.split(' ')[0].toLowerCase();
  utenti.push({
    ruolo: 'distributore',
    username,
    password: 'banco123',
    ragione_sociale: d.ragione_sociale || d.nome,
    referente: REFERENTI_BANCO[d.nome] || d.filiale,
    email: d.email,
    telefono: d.telefono,
    distributor_id: d.id,
    partita_iva: d.partita_iva,
    indirizzo: d.indirizzo,
    cap: d.cap,
    citta: d.citta,
    provincia: d.provincia,
  });
});

utenti.forEach(upsertUser);

console.log('Seed completato:');
console.log(`  ${macro.length} macro categorie`);
console.log(`  ${prodotti.length} prodotti demo`);
console.log(`  ${distributoriSalvati.length} distributori (${righeListino} righe di listino)`);
console.log(`  ${utenti.length} utenti (1 agente, 3 clienti, ${distributoriSalvati.length} banchi distributore)`);
