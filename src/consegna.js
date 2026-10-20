const db = require('../db');
const geo = require('./geo');
const percorso = require('./percorso');
const sede = require('./sede_installatori');

// Quanto ci mette la merce ad arrivare dal banco all'installatore.
//
// Il tragitto vero (banco che ha accettato -> posizione dell'installatore) lo calcola un servizio di mappe (src/percorso.js). Se non risponde, o se
// manca una delle due posizioni, si ripiega sulla stima di sempre: distanza in linea d'aria corretta di un fattore che tiene conto delle strade reali,
// divisa per una velocità media urbana (config `velocita_media_kmh`).
//
// Non è il tempo che vede il banco: quello è solo il tempo scritto dal corriere su WhatsApp (src/corriere.js). All'installatore si mostra la somma dei due.

const FATTORE_STRADA = 1.35; // le strade non vanno in linea d'aria

async function velocitaMedia() {
  const row = await db.prepare("SELECT valore FROM config WHERE chiave = 'velocita_media_kmh'").get();
  const v = row ? parseFloat(row.valore) : 25;
  return Number.isFinite(v) && v > 0 ? v : 25;
}

// Punto di partenza del distributore: il punto vendita più vicino al cliente, se
// conosciamo le posizioni; altrimenti la sede del banco.
async function partenzaPiuVicina(distributorId, posizioneCliente) {
  const punti = await db
    .prepare(
      `SELECT geo_lat AS lat, geo_lng AS lng, nome FROM store_locations
        WHERE distributor_id = ? AND attivo = 1 AND geo_lat IS NOT NULL`
    )
    .all(distributorId);

  if (!punti.length || !posizioneCliente) {
    const d = await db.prepare('SELECT geo_lat AS lat, geo_lng AS lng FROM distributors WHERE id = ?').get(distributorId);
    return d && d.lat !== null ? { ...d, nome: '' } : null;
  }

  return punti
    .map((p) => ({ ...p, km: geo.distanzaKm(posizioneCliente, p) }))
    .filter((p) => p.km !== null)
    .sort((a, b) => a.km - b.km)[0] || null;
}

// Minuti stimati fra la partenza dichiarata dal banco e l'arrivo dal cliente.
// `viaggio` è il solo tragitto dal banco (il più vicino al cliente, se la filiale ha più punti vendita) alla posizione dell'installatore; `fonte` dice da dove
// viene: 'mappa' (servizio di routing) o 'stima' (linea d'aria). Senza le posizioni resta solo il tempo dichiarato dal banco (`stimato: false`).
async function minutiStimati(distributorId, clienteId, partenzaOre) {
  const partenzaMinuti = Math.max(0, Math.round((parseFloat(partenzaOre) || 0) * 60));

  // La posizione è l'ultima mandata dal dispositivo dell'installatore (POST /api/posizione). Un account che non ne ha ancora mandata nessuna (o ha negato il
  // permesso) usa la sede provvisoria di tutti gli installatori (src/sede_installatori.js): meglio un tragitto approssimato che nessun tragitto, perché
  // senza questo all'installatore si direbbe solo il tempo del corriere.
  const cliente = await db
    .prepare('SELECT geo_lat AS lat, geo_lng AS lng, geo_consenso FROM users WHERE id = ?')
    .get(clienteId);
  const dalDispositivo = cliente && cliente.geo_consenso && cliente.lat !== null ? cliente : null;
  const posizione = dalDispositivo || (cliente ? { lat: sede.lat, lng: sede.lng } : null);
  const partenza = await partenzaPiuVicina(distributorId, posizione);

  const km = geo.distanzaKm(posizione, partenza);
  if (km === null) {
    // Senza posizioni note resta solo il tempo dichiarato dal banco.
    return { minuti: partenzaMinuti, km: null, viaggio: null, stimato: false };
  }

  // Il tragitto sulle strade vere. Non lancia mai: se il servizio non risponde si ripiega sulla stima qui sotto.
  const dallaMappa = await percorso.minutiInAuto(partenza, posizione);
  if (dallaMappa) {
    return {
      minuti: partenzaMinuti + dallaMappa.minuti,
      km: dallaMappa.km,
      viaggio: dallaMappa.minuti,
      stimato: true,
      fonte: 'mappa',
      partenzaDa: partenza.nome || '',
    };
  }

  const kmStrada = km * FATTORE_STRADA;
  const v = await velocitaMedia();
  const viaggio = Math.max(5, Math.round((kmStrada / v) * 60));
  return {
    minuti: partenzaMinuti + viaggio,
    km: Math.round(kmStrada * 10) / 10,
    viaggio,
    stimato: true,
    fonte: 'stima',
    partenzaDa: partenza.nome || '',
  };
}

// "2 ore e 10 minuti", "45 minuti".
function inParole(minuti) {
  if (minuti === null || minuti === undefined) return '—';
  const m = Math.max(0, Math.round(minuti));
  if (m < 60) return `${m} minuti`;
  const ore = Math.floor(m / 60);
  const resto = m % 60;
  const parteOre = ore === 1 ? '1 ora' : `${ore} ore`;
  if (!resto) return parteOre;
  return `${parteOre} e ${resto} minuti`;
}

module.exports = { minutiStimati, inParole, velocitaMedia, FATTORE_STRADA };
