const db = require('../db');

// Posizione e distanze. La posizione del dispositivo non si raccoglie più: quella di ogni
// installatore è fissa (src/sede_installatori.js) e quella dei banchi è del punto vendita, quindi
// qui restano solo la lettura e il calcolo delle distanze.

async function statoUtente(userId) {
  const u = await db
    .prepare(
      'SELECT geo_consenso, geo_lat, geo_lng, geo_precisione, geo_aggiornata_il FROM users WHERE id = ?'
    )
    .get(userId);
  if (!u) return { consenso: false };
  return {
    consenso: u.geo_consenso === 1,
    lat: u.geo_lat,
    lng: u.geo_lng,
    precisione: u.geo_precisione,
    aggiornata_il: u.geo_aggiornata_il,
  };
}

// Distanza in linea d'aria (formula dell'emisenoverso), in chilometri.
function distanzaKm(a, b) {
  if (!a || !b) return null;
  if (![a.lat, a.lng, b.lat, b.lng].every((v) => Number.isFinite(v))) return null;
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

function formattaDistanza(km) {
  if (km === null || km === undefined) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toString().replace('.', ',')} km`;
}

module.exports = { statoUtente, distanzaKm, formattaDistanza };
