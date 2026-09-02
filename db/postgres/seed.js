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
async function upsertUser(u) {
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
  await db.prepare(
    `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, email, telefono,
                        distributor_id, zona, partita_iva, codice_fiscale, indirizzo, cap,
                        citta, provincia, sdi_pec, indirizzo_consegna, referente)
     VALUES (?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?)
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
  ).run(dati.ruolo, dati.username, dati.password_hash, dati.ragione_sociale, dati.email, dati.telefono, dati.distributor_id, dati.zona, dati.partita_iva, dati.codice_fiscale, dati.indirizzo, dati.cap, dati.citta, dati.provincia, dati.sdi_pec, dati.indirizzo_consegna, dati.referente);
}

async function upsertDistributor(d) {
  await db.prepare(
    `INSERT INTO distributors (nome, filiale, zona, consegna_ore_default, costo_consegna, attivo,
                               ragione_sociale, partita_iva, indirizzo, cap, citta, provincia,
                               telefono, email)
     VALUES (?, ?, ?, ?, ?, 1,
             ?, ?, ?, ?, ?, ?,
             ?, ?)
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
  ).run(d.nome, d.filiale, d.zona, d.consegna_ore_default, d.costo_consegna, d.ragione_sociale, d.partita_iva, d.indirizzo, d.cap, d.citta, d.provincia, d.telefono, d.email);
  return db.prepare('SELECT * FROM distributors WHERE nome = ?').get(d.nome);
}

// ---------- Distributori ----------

const distributori = [
  {
    nome: 'AFIS SPA', filiale: 'Banco Genova Spataro', zona: ZONA,
    consegna_ore_default: 24, costo_consegna: 12.00,
    ragione_sociale: 'AFIS G. Clerici S.p.A.', partita_iva: '01234567891',
    indirizzo: 'Via Spataro 44 rosso', cap: '16151', citta: 'Genova', provincia: 'GE',
    telefono: '010 518601', email: 'banco.spataro@afis.example',
  },
  {
    nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', zona: ZONA,
    consegna_ore_default: 48, costo_consegna: 0.00,
    ragione_sociale: 'BOREA S.r.l.', partita_iva: '01234567892',
    indirizzo: 'Via Castel Morrone 1', cap: '16161', citta: 'Genova', provincia: 'GE',
    telefono: '010 716871', email: 'banco.fegino@borea.example',
  },
  {
    nome: 'CAMBIELLI SPA', filiale: 'Banco Genova Campi', zona: ZONA,
    consegna_ore_default: 6, costo_consegna: 15.00,
    ragione_sociale: 'Cambielli Edilfriuli S.p.A.', partita_iva: '01234567893',
    indirizzo: 'Corso Ferdinando Maria Perrone 23/H', cap: '16152', citta: 'Genova', provincia: 'GE',
    telefono: '010 6509509', email: 'banco.campi@cambielli.example',
  },
  {
    nome: 'FIDRA SPA', filiale: 'Banco Genova Pegli', zona: ZONA,
    consegna_ore_default: 24, costo_consegna: 10.00,
    ragione_sociale: 'FIDRA S.p.A.', partita_iva: '01234567894',
    indirizzo: 'Via Multedo di Pegli 4', cap: '16155', citta: 'Genova', provincia: 'GE',
    telefono: '010 61731', email: 'banco.pegli@fidra.example',
  },
];

// ---------- Esecuzione ----------

async function main() {
  await db.ensureInit();

  const distributoriSalvati = [];
  for (const d of distributori) {
    const saved = await upsertDistributor(d);
    distributoriSalvati.push(saved);
  }

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
    'AFIS SPA': 'Banco AFIS — Spataro',
    'CAMBIELLI SPA': 'Banco CAMBIELLI — Campi',
    'BOREA SRL': 'Banco BOREA — Fegino',
    'FIDRA SPA': 'Banco FIDRA — Pegli',
  };

  for (const d of distributoriSalvati) {
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
  }

  for (const u of utenti) await upsertUser(u);

  // I clienti demo risultano già approvati da tutti i banchi, altrimenti non potrebbero
  // inviare richieste. Le anagrafiche create dalla registrazione partono da 'in_attesa'.
  const insLegame = db.prepare(
    `INSERT INTO client_distributors (cliente_id, distributor_id, stato, codice_cliente, deciso_il)
     VALUES (?, ?, 'approvato', ?, NOW())
     ON CONFLICT(cliente_id, distributor_id) DO NOTHING`
  );
  let legami = 0;
  const clienti = await db.prepare(`SELECT id, username FROM users WHERE ruolo = 'cliente'`).all();
  for (const c of clienti) {
    for (const d of distributoriSalvati) {
      await insLegame.run(c.id, d.id, 'DEMO-' + c.username.toUpperCase());
      legami += 1;
    }
  }

  console.log('Seed completato:');
  console.log(`  ${distributoriSalvati.length} distributori`);
  console.log(`  ${legami} legami cliente-distributore (demo: già approvati)`);
  console.log(`  ${utenti.length} utenti (1 agente, 3 clienti, ${distributoriSalvati.length} banchi distributore)`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
} else {
  // keep backward compat when required from server.js auto-seed
  main().catch(e => console.error('seed error', e.message));
}
