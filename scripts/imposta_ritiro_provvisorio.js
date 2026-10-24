// Ritiro merce PROVVISORIO per le due filiali di Borea (richiesta esplicita del 23/10/2026): tutte e due ritirano da
//   "Enoteca Squillari 1, Via Antonio Cantore, 266r, 16149 Genova GE"
// Cambia, per Fegino e Staglieno, l'indirizzo e la posizione sulla mappa (distributors e store_locations): da lì il corriere ritira (messaggio WhatsApp,
// "PRELIEVO MERCI"), il tempo scritto su WhatsApp è quello per arrivare fin lì e il tragitto verso l'installatore parte da lì (src/consegna.js).
//
// La posizione (44.4127894, 8.8890556) è il punto "Squillari" di OpenStreetMap (nodo 10095412676, negozio di alcolici in Via Antonio Cantore, Sampierdarena):
// il civico 266r non è nei dati di OpenStreetMap, quindi è la posizione del negozio e non del civico. Se serve più precisione si cambiano LAT e LNG qui sotto.
//
// Il DB è quello condiviso con la VPS: di default è una PROVA (transazione + ROLLBACK, stampa prima e dopo). Con --applica salva, e prima scrive una copia delle
// righe com'erano in `_tmp_backup_ritiro_provvisorio.json` (fuori da git). Se la copia esiste già NON si riscrive (conserva gli indirizzi veri anche se lo
// script si lancia due volte). Per tornare agli indirizzi di prima: --ripristina (prova a secco) e --ripristina --applica.
//
// Uso:  node scripts/imposta_ritiro_provvisorio.js [--applica]
//       node scripts/imposta_ritiro_provvisorio.js --ripristina [--applica]
//       (facoltativo: --backup=percorso.json)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const APPLICA = process.argv.includes('--applica');
const RIPRISTINA = process.argv.includes('--ripristina');
const backupArg = process.argv.find((a) => a.startsWith('--backup='));
const FILE_BACKUP = backupArg ? backupArg.slice('--backup='.length) : path.join(__dirname, '..', '_tmp_backup_ritiro_provvisorio.json');

const NOME_DITTA = 'BOREA SRL';
const FILIALI = ['Banco Genova Fegino', 'Banco Genova Staglieno'];
const SEDE = {
  indirizzo: 'Enoteca Squillari 1, Via Antonio Cantore, 266r',
  cap: '16149',
  citta: 'Genova',
  provincia: 'GE',
  lat: 44.4127894,
  lng: 8.8890556,
  geocodifica: 'manuale 23/10/2026: Enoteca Squillari, nodo OpenStreetMap 10095412676 (ritiro provvisorio)',
};

const COLONNE_DISTRIBUTORS = ['indirizzo', 'cap', 'citta', 'provincia', 'geo_lat', 'geo_lng'];
const COLONNE_PUNTI = ['indirizzo', 'cap', 'citta', 'provincia', 'geo_lat', 'geo_lng', 'geocodifica'];

if (!process.env.DATABASE_URL) {
  console.error("Manca DATABASE_URL (impostala nel .env o come variabile d'ambiente).");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 8000,
});

// Tiene di una riga solo le colonne indicate.
const scegli = (riga, colonne) => Object.fromEntries(colonne.map((c) => [c, riga[c]]));

// Legge dal database le due filiali e i loro punti vendita (errore se non sono quelle attese).
async function leggi(c) {
  const distributori = (await c.query('SELECT * FROM distributors WHERE nome = $1 AND filiale = ANY($2::text[]) ORDER BY id', [NOME_DITTA, FILIALI])).rows;
  if (distributori.length !== FILIALI.length) {
    throw new Error(`Mi aspettavo ${FILIALI.length} filiali (${FILIALI.join(', ')}) di ${NOME_DITTA}, ne ho trovate ${distributori.length}.`);
  }
  const punti = (await c.query('SELECT * FROM store_locations WHERE distributor_id = ANY($1::int[]) ORDER BY id', [distributori.map((d) => d.id)])).rows;
  return { distributori, punti };
}

// Stampa in tabella gli indirizzi e le coordinate di filiali e punti vendita, per confrontarli prima e dopo.
function stampa(titolo, { distributori, punti }) {
  console.log(`\n${titolo}`);
  console.table(distributori.map((d) => ({ id: d.id, filiale: d.filiale, indirizzo: d.indirizzo, cap: d.cap, citta: d.citta, prov: d.provincia, lat: d.geo_lat, lng: d.geo_lng })));
  console.table(punti.map((p) => ({ id: p.id, distributor_id: p.distributor_id, nome: p.nome, indirizzo: p.indirizzo, cap: p.cap, citta: p.citta, prov: p.provincia, lat: p.geo_lat, lng: p.geo_lng, attivo: p.attivo })));
}

// Scrive l'indirizzo provvisorio di ritiro su filiali e punti vendita (e crea il punto vendita se manca).
async function imposta(c, prima) {
  const creati = [];
  for (const d of prima.distributori) {
    await c.query(
      'UPDATE distributors SET indirizzo = $2, cap = $3, citta = $4, provincia = $5, geo_lat = $6, geo_lng = $7 WHERE id = $1',
      [d.id, SEDE.indirizzo, SEDE.cap, SEDE.citta, SEDE.provincia, SEDE.lat, SEDE.lng]
    );
    const suoi = prima.punti.filter((p) => p.distributor_id === d.id);
    for (const p of suoi) {
      await c.query(
        'UPDATE store_locations SET indirizzo = $2, cap = $3, citta = $4, provincia = $5, geo_lat = $6, geo_lng = $7, geocodifica = $8 WHERE id = $1',
        [p.id, SEDE.indirizzo, SEDE.cap, SEDE.citta, SEDE.provincia, SEDE.lat, SEDE.lng, SEDE.geocodifica]
      );
    }
    if (!suoi.length) {
      // Il messaggio ai corrieri legge il punto vendita (store_locations) e ripiega sulla riga del distributore solo senza: meglio averlo.
      const r = await c.query(
        `INSERT INTO store_locations (distributor_id, nome, indirizzo, cap, citta, provincia, geo_lat, geo_lng, geocodifica, attivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING id`,
        [d.id, d.filiale, SEDE.indirizzo, SEDE.cap, SEDE.citta, SEDE.provincia, SEDE.lat, SEDE.lng, SEDE.geocodifica]
      );
      creati.push(r.rows[0].id);
    }
  }
  return creati;
}

// Rimette gli indirizzi veri, leggendoli dalla copia di sicurezza fatta prima del cambio.
async function ripristina(c) {
  if (!fs.existsSync(FILE_BACKUP)) throw new Error(`Non trovo la copia di sicurezza: ${FILE_BACKUP}`);
  const copia = JSON.parse(fs.readFileSync(FILE_BACKUP, 'utf8'));
  for (const d of copia.distributori) {
    await c.query(
      'UPDATE distributors SET indirizzo = $2, cap = $3, citta = $4, provincia = $5, geo_lat = $6, geo_lng = $7 WHERE id = $1',
      [d.id, ...COLONNE_DISTRIBUTORS.map((k) => d[k])]
    );
  }
  for (const p of copia.punti) {
    await c.query(
      'UPDATE store_locations SET indirizzo = $2, cap = $3, citta = $4, provincia = $5, geo_lat = $6, geo_lng = $7, geocodifica = $8 WHERE id = $1',
      [p.id, ...COLONNE_PUNTI.map((k) => p[k])]
    );
  }
  if ((copia.creati || []).length) await c.query('DELETE FROM store_locations WHERE id = ANY($1::int[])', [copia.creati]);
  console.log(`Ripristinati ${copia.distributori.length} distributori e ${copia.punti.length} punti vendita` + ((copia.creati || []).length ? `, tolti ${copia.creati.length} punti creati dallo script.` : '.'));
}

// Esegue l'operazione scelta (imposta o ripristina) in transazione: senza --applica è una prova a secco che si annulla.
async function main() {
  let c;
  try {
    c = await pool.connect();
  } catch (e) {
    console.error(`Non riesco a collegarmi al database (${e.code || e.message}).`);
    console.error('Se il .env punta a 127.0.0.1:5433 il tunnel verso il server non è aperto: aprilo e rilancia. Se sei su eduroam: node scripts/diagnosi_rete_db.js.');
    await pool.end().catch(() => {});
    process.exit(1);
  }
  try {
    await c.query('BEGIN');
    const prima = await leggi(c);
    stampa('PRIMA', prima);

    if (RIPRISTINA) {
      await ripristina(c);
    } else {
      const creati = await imposta(c, prima);
      if (APPLICA) {
        // La copia degli indirizzi veri si scrive UNA volta: rilanciare lo script non deve sostituirla con quelli provvisori.
        if (fs.existsSync(FILE_BACKUP)) {
          const esistente = JSON.parse(fs.readFileSync(FILE_BACKUP, 'utf8'));
          esistente.creati = [...new Set([...(esistente.creati || []), ...creati])];
          fs.writeFileSync(FILE_BACKUP, JSON.stringify(esistente, null, 2));
          console.log(`Copia di sicurezza già presente, la tengo: ${FILE_BACKUP}`);
        } else {
          fs.writeFileSync(
            FILE_BACKUP,
            JSON.stringify(
              {
                fatta_il: new Date().toISOString(),
                distributori: prima.distributori.map((d) => ({ id: d.id, ...scegli(d, COLONNE_DISTRIBUTORS) })),
                punti: prima.punti.map((p) => ({ id: p.id, ...scegli(p, COLONNE_PUNTI) })),
                creati,
              },
              null,
              2
            )
          );
          console.log(`Copia di sicurezza (stato prima): ${FILE_BACKUP}`);
        }
      }
      if (creati.length) console.log(`Punti vendita creati (la filiale non ne aveva): ${creati.join(', ')}`);
    }

    stampa('DOPO', await leggi(c));

    if (APPLICA) {
      await c.query('COMMIT');
      console.log('\nAPPLICATO.');
    } else {
      await c.query('ROLLBACK');
      console.log(`\nPROVA: niente è stato salvato. Per applicare: node scripts/imposta_ritiro_provvisorio.js ${RIPRISTINA ? '--ripristina ' : ''}--applica`);
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
