const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const sqlitePath = path.join(__dirname, '..', 'db', 'minuteria.db');
const outPath = path.join(__dirname, '..', 'db', 'supabase_dump.sql');
const schemaPgPath = path.join(__dirname, '..', 'db', 'schema.pg.sql');

const db = new DatabaseSync(sqlitePath);

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

let out = fs.readFileSync(schemaPgPath, 'utf8') + '\n\n-- DATI\nBEGIN;\n';

// Ordine scelto per rispettare le foreign key: "requests" ha order_id -> orders(id),
// quindi "orders" deve essere popolata prima di "requests" (dipendenza circolare
// richiesta<->ordine nel modello dati: orders non ha invece FK reali verso requests).
const tables = [
  'config','macro_categorie','distributors','users','products','distributor_products',
  'orders','requests','request_items','request_responses','request_response_items',
  'order_items','notifications','brands','brand_families',
  'client_discounts','store_locations','client_distributors','client_discount_rules',
  'sottocategorie','ddt_counters','session'
];

for (const t of tables) {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!exists) { out += `-- skip ${t} (no table)\n`; continue; }
    const rows = db.prepare(`SELECT * FROM "${t}"`).all();
    if (!rows.length) { out += `-- ${t} vuoto\n`; continue; }
    const cols = Object.keys(rows[0]);
    out += `-- ${t} (${rows.length} righe)\n`;
    // batch 500 per INSERT
    for (let i=0;i<rows.length;i+=500) {
      const batch = rows.slice(i,i+500);
      const vals = batch.map(r => '(' + cols.map(c => esc(r[c])).join(', ') + ')').join(',\n');
      out += `INSERT INTO "${t}" ("${cols.join('","')}") VALUES\n${vals}\nON CONFLICT DO NOTHING;\n`;
    }
  } catch(e){ out += `-- errore ${t}: ${e.message}\n`; }
}

out += 'COMMIT;\n';
out += `\n-- reset sequence per SERIAL\n`;
for (const t of ['users','products','orders','order_items','distributors','distributor_products','requests','request_items','request_responses','request_response_items','notifications','ddt_counters','brands','brand_families','client_discounts','store_locations','client_distributors','client_discount_rules','sottocategorie']) {
  try{
    const max = db.prepare(`SELECT MAX(id) as m FROM "${t}"`).get();
    if (max && max.m !== null) out += `SELECT setval('"${t}_id_seq"', ${max.m}, true);\n`;
  }catch{}
}

fs.writeFileSync(outPath, out, 'utf8');
console.log(`Scritto ${outPath} ${(fs.statSync(outPath).size/1024/1024).toFixed(2)} MB`);
