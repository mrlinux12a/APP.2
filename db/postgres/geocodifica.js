// Carica i punti vendita di db/punti_vendita.js e ne ricava le coordinate con Nominatim
// (il geocodificatore di OpenStreetMap).
//
//   node db/geocodifica.js            aggiorna solo i punti senza coordinate
//   node db/geocodifica.js --tutti    rigeocodifica tutto
//
// Nominatim chiede al massimo una richiesta al secondo e uno User-Agent che identifichi
// l'applicazione: rispettiamo entrambe le cose. È idempotente e si può rilanciare.
const db = require('./index');
const punti = require('./punti_vendita');

const USER_AGENT = 'OrdiniMinuteria/1.0 (app gestionale ordini termoidraulica)';
const ATTESA_MS = 1100;

function pausa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A Genova i civici commerciali hanno il suffisso "R" (rosso) e alcune vie sono
// registrate senza "Via" davanti: proviamo qualche variante prima di arrendersi.
function varianti(indirizzo, cap, citta) {
  const senzaRosso = indirizzo.replace(/\s*\d*\s*(rosso|R)\b/i, (m) => m.replace(/(rosso|R)\b/i, '')).trim();
  const senzaVia = indirizzo.replace(/^(Via|Corso|Piazza|Viale)\s+/i, '').trim();
  const soloStrada = indirizzo.replace(/\s+\S*\d+\S*\s*$/, '').trim();

  const insieme = [
    `${indirizzo}, ${cap} ${citta}, Italia`,
    `${senzaRosso}, ${cap} ${citta}, Italia`,
    `${senzaVia}, ${cap} ${citta}, Italia`,
    `${soloStrada}, ${citta}, Italia`,
  ];
  return [...new Set(insieme.filter(Boolean))];
}

async function geocodifica(query) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=it&q=' +
    encodeURIComponent(query);
  const risposta = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!risposta.ok) throw new Error('HTTP ' + risposta.status);
  const dati = await risposta.json();
  if (!dati.length) return null;
  return {
    lat: parseFloat(dati[0].lat),
    lng: parseFloat(dati[0].lon),
    etichetta: dati[0].display_name,
  };
}

async function principale() {
  await db.ensureInit();
  const tutti = process.argv.includes('--tutti');

  // Allinea l'elenco dei punti vendita al database.
  const insPunto = db.prepare(
    `INSERT INTO store_locations
       (distributor_id, nome, indirizzo, cap, citta, provincia, telefono, email)
     VALUES (@distributor_id, @nome, @indirizzo, @cap, @citta, @provincia, @telefono, @email)
     ON CONFLICT(distributor_id, nome) DO UPDATE SET
       indirizzo = excluded.indirizzo, cap = excluded.cap, citta = excluded.citta,
       provincia = excluded.provincia, telefono = excluded.telefono, email = excluded.email`
  );

  let mancanti = 0;
  for (const p of punti) {
    const d = await db.prepare('SELECT id FROM distributors WHERE nome = ?').get(p.distributore);
    if (!d) {
      console.warn(`  ! distributore non trovato nel DB: ${p.distributore} (${p.nome})`);
      mancanti += 1;
      continue;
    }
    const { distributore, ...campi } = p;
    await insPunto.run({ ...campi, distributor_id: d.id });
  }
  if (mancanti) console.warn(`  ${mancanti} punti saltati: lancia prima "npm run seed".\n`);

  const daFare = await db
    .prepare(
      `SELECT s.*, d.nome AS distributore
         FROM store_locations s JOIN distributors d ON d.id = s.distributor_id
        WHERE ${tutti ? '1 = 1' : 's.geo_lat IS NULL'}
        ORDER BY d.nome, s.nome`
    )
    .all();

  console.log(`Punti vendita da geocodificare: ${daFare.length}`);

  const aggiorna = db.prepare(
    'UPDATE store_locations SET geo_lat = ?, geo_lng = ?, geocodifica = ? WHERE id = ?'
  );

  let ok = 0;
  for (const p of daFare) {
    const query = varianti(p.indirizzo, p.cap, p.citta);
    let trovato = null;
    let usata = '';
    for (const q of query) {
      try {
        trovato = await geocodifica(q);
      } catch (err) {
        console.log(`  ! ${p.nome}: ${err.message}`);
      }
      await pausa(ATTESA_MS);
      if (trovato) {
        usata = q;
        break;
      }
    }

    if (trovato) {
      await aggiorna.run(trovato.lat, trovato.lng, trovato.etichetta, p.id);
      ok += 1;
      const approssimata = usata !== query[0] ? ' (indirizzo approssimato)' : '';
      console.log(
        `  ✓ ${p.distributore} — ${p.nome}: ${trovato.lat.toFixed(5)}, ${trovato.lng.toFixed(5)}${approssimata}`
      );
    } else {
      console.log(`  ✗ ${p.distributore} — ${p.nome}: nessun risultato per "${p.indirizzo}"`);
    }
  }

  const totali = await db
    .prepare(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN geo_lat IS NULL THEN 1 ELSE 0 END) AS senza
         FROM store_locations`
    )
    .get();
  console.log(`\nGeocodificati ora: ${ok}. In archivio: ${totali.n} punti, ${totali.senza} ancora senza coordinate.`);
}

principale().catch((e) => {
  console.error('Errore: ' + e.message);
  process.exit(1);
});
