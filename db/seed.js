// Seed dati demo per test Blocco 1.
// Il catalogo qui è "finto ma realistico" solo per verificare il flusso:
// il caricamento vero del catalogo (CSV/form) è il Blocco 2.
const bcrypt = require('bcryptjs');
const db = require('./index');

function upsertUser({ ruolo, username, password, ragione_sociale, email, telefono }) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, email, telefono)
     VALUES (@ruolo, @username, @password_hash, @ragione_sociale, @email, @telefono)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       ragione_sociale = excluded.ragione_sociale,
       email = excluded.email,
       telefono = excluded.telefono`
  ).run({ ruolo, username, password_hash: hash, ragione_sociale, email, telefono });
}

function upsertProduct(p) {
  db.prepare(
    `INSERT INTO products (codice, nome, categoria, prezzo_listino, sconto_base_pct, disponibilita)
     VALUES (@codice, @nome, @categoria, @prezzo_listino, @sconto_base_pct, @disponibilita)
     ON CONFLICT(codice) DO UPDATE SET
       nome = excluded.nome,
       categoria = excluded.categoria,
       prezzo_listino = excluded.prezzo_listino,
       sconto_base_pct = excluded.sconto_base_pct,
       disponibilita = excluded.disponibilita,
       aggiornato_il = datetime('now')`
  ).run(p);
}

const utenti = [
  { ruolo: 'agente', username: 'agente', password: 'agente123', ragione_sociale: 'Grossista Demo — Agente', email: 'agente@example.com', telefono: '' },
  { ruolo: 'cliente', username: 'rossi', password: 'cliente123', ragione_sociale: 'Rossi Impianti Srl', email: 'rossi@example.com', telefono: '333 0000001' },
  { ruolo: 'cliente', username: 'bianchi', password: 'cliente123', ragione_sociale: 'Idraulica Bianchi', email: 'bianchi@example.com', telefono: '333 0000002' },
  { ruolo: 'cliente', username: 'verdi', password: 'cliente123', ragione_sociale: 'Termoidraulica Verdi', email: 'verdi@example.com', telefono: '333 0000003' },
];

const prodotti = [
  { codice: 'RAC-001', nome: 'Raccordo a T 1/2" ottone', categoria: 'Raccordi', prezzo_listino: 3.50, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'RAC-002', nome: 'Raccordo a gomito 3/4" ottone', categoria: 'Raccordi', prezzo_listino: 4.20, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'RAC-003', nome: 'Nipplo doppio 1/2" ottone', categoria: 'Raccordi', prezzo_listino: 2.10, sconto_base_pct: 8, disponibilita: 'disponibile' },
  { codice: 'GUA-001', nome: 'Guarnizione EPDM 3/4" (conf. 10 pz)', categoria: 'Guarnizioni', prezzo_listino: 5.00, sconto_base_pct: 5, disponibilita: 'disponibile' },
  { codice: 'GUA-002', nome: 'Guarnizione fibra 1/2" (conf. 10 pz)', categoria: 'Guarnizioni', prezzo_listino: 4.50, sconto_base_pct: 5, disponibilita: 'in_esaurimento' },
  { codice: 'VIT-001', nome: 'Vite autofilettante 4x30 (conf. 100 pz)', categoria: 'Viteria', prezzo_listino: 6.90, sconto_base_pct: 12, disponibilita: 'disponibile' },
  { codice: 'VIT-002', nome: 'Tassello ad espansione 8mm (conf. 50 pz)', categoria: 'Viteria', prezzo_listino: 8.20, sconto_base_pct: 12, disponibilita: 'disponibile' },
  { codice: 'NAS-001', nome: 'Nastro teflon PTFE 12mm', categoria: 'Sigillanti', prezzo_listino: 1.20, sconto_base_pct: 15, disponibilita: 'disponibile' },
  { codice: 'SIL-001', nome: 'Silicone sanitario trasparente 280ml', categoria: 'Sigillanti', prezzo_listino: 4.80, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'FAS-001', nome: 'Fascetta stringitubo inox 20-32mm (conf. 10)', categoria: 'Fascette', prezzo_listino: 6.50, sconto_base_pct: 8, disponibilita: 'disponibile' },
  { codice: 'VAL-001', nome: 'Valvola di sfiato automatica 1/2"', categoria: 'Valvole', prezzo_listino: 9.90, sconto_base_pct: 7, disponibilita: 'disponibile' },
  { codice: 'VAL-002', nome: 'Valvola a sfera 3/4" PN25', categoria: 'Valvole', prezzo_listino: 7.30, sconto_base_pct: 7, disponibilita: 'non_disponibile' },
  { codice: 'TUB-001', nome: 'Tubo multistrato 16mm (rotolo 50m)', categoria: 'Tubazioni', prezzo_listino: 68.00, sconto_base_pct: 6, disponibilita: 'disponibile' },
  { codice: 'TUB-002', nome: 'Raccordo a pressare 16mm', categoria: 'Tubazioni', prezzo_listino: 3.90, sconto_base_pct: 10, disponibilita: 'disponibile' },
  { codice: 'ELE-001', nome: 'Nastro isolante elettrico', categoria: 'Elettrico', prezzo_listino: 1.50, sconto_base_pct: 5, disponibilita: 'disponibile' },
];

utenti.forEach(upsertUser);
prodotti.forEach(upsertProduct);

console.log('Seed completato:');
console.log(`  ${utenti.length} utenti (1 agente, ${utenti.length - 1} clienti)`);
console.log(`  ${prodotti.length} prodotti demo`);
