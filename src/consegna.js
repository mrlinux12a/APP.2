const db = require('../db');
const geo = require('./geo');

// Tempo di consegna stimato = quando il mezzo parte dalla filiale + quanto ci mette
// ad arrivare dal cliente.
//
// Il tragitto è calcolato sulla distanza in linea d'aria fra il punto vendita e la
// posizione del cliente, corretta di un fattore che tiene conto delle strade reali, e
// divisa per una velocità media urbana (config `velocita_media_kmh`).
// È una stima volutamente semplice e senza dipendenze esterne: per avere il tempo di
// percorrenza vero servirebbe un servizio di routing (Google, Mapbox, OSRM), e va deciso
// se introdurre quella dipendenza.

const FATTORE_STRADA = 1.35; // le strade non vanno in linea d'aria

function velocitaMedia() {
  const row = db.prepare("SELECT valore FROM config WHERE chiave = 'velocita_media_kmh'").get();
  const v = row ? parseFloat(row.valore) : 25;
  return Number.isFinite(v) && v > 0 ? v : 25;
}

// Punto di partenza del distributore: il punto vendita più vicino al cliente, se
// conosciamo le posizioni; altrimenti la sede del banco.
function partenzaPiuVicina(distributorId, posizioneCliente) {
  const punti = db
    .prepare(
      `SELECT geo_lat AS lat, geo_lng AS lng, nome FROM store_locations
        WHERE distributor_id = ? AND attivo = 1 AND geo_lat IS NOT NULL`
    )
    .all(distributorId);

  if (!punti.length || !posizioneCliente) {
    const d = db.prepare('SELECT geo_lat AS lat, geo_lng AS lng FROM distributors WHERE id = ?').get(distributorId);
    return d && d.lat !== null ? { ...d, nome: '' } : null;
  }

  return punti
    .map((p) => ({ ...p, km: geo.distanzaKm(posizioneCliente, p) }))
    .filter((p) => p.km !== null)
    .sort((a, b) => a.km - b.km)[0] || null;
}

// Minuti stimati fra la partenza dichiarata dal banco e l'arrivo dal cliente.
function minutiStimati(distributorId, clienteId, partenzaOre) {
  const partenzaMinuti = Math.max(0, Math.round((parseFloat(partenzaOre) || 0) * 60));

  const cliente = db
    .prepare('SELECT geo_lat AS lat, geo_lng AS lng, geo_consenso FROM users WHERE id = ?')
    .get(clienteId);
  const posizione = cliente && cliente.geo_consenso && cliente.lat !== null ? cliente : null;
  const partenza = partenzaPiuVicina(distributorId, posizione);

  const km = geo.distanzaKm(posizione, partenza);
  if (km === null) {
    // Senza posizioni note resta solo il tempo dichiarato dal banco.
    return { minuti: partenzaMinuti, km: null, viaggio: null, stimato: false };
  }

  const kmStrada = km * FATTORE_STRADA;
  const viaggio = Math.max(5, Math.round((kmStrada / velocitaMedia()) * 60));
  return {
    minuti: partenzaMinuti + viaggio,
    km: Math.round(kmStrada * 10) / 10,
    viaggio,
    stimato: true,
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
