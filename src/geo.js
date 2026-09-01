const db = require('../db');

// Geolocalizzazione in tempo reale, sempre subordinata al consenso esplicito dell'utente:
// niente viene registrato finché non preme "Attiva la posizione", e la revoca cancella
// davvero le coordinate salvate.

async function salvaPosizione(userId, { lat, lng, precisione }) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;

  await db.prepare(
    `UPDATE users
        SET geo_consenso = 1, geo_lat = ?, geo_lng = ?, geo_precisione = ?,
            geo_aggiornata_il = NOW()
      WHERE id = ?`
  ).run(la, ln, Number.isFinite(Number(precisione)) ? Number(precisione) : null, userId);

  // Il banco eredita la posizione dell'operatore che lo presidia: è quella che il cliente
  // vede muoversi quando la merce è in consegna.
  const utente = await db.prepare('SELECT ruolo, distributor_id FROM users WHERE id = ?').get(userId);
  if (utente && utente.ruolo === 'distributore' && utente.distributor_id) {
    await db.prepare('UPDATE distributors SET geo_lat = ?, geo_lng = ? WHERE id = ?').run(
      la,
      ln,
      utente.distributor_id
    );
  }
  return { lat: la, lng: ln };
}

async function revoca(userId) {
  await db.prepare(
    `UPDATE users
        SET geo_consenso = 0, geo_lat = NULL, geo_lng = NULL, geo_precisione = NULL,
            geo_aggiornata_il = NULL
      WHERE id = ?`
  ).run(userId);
}

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

module.exports = { salvaPosizione, revoca, statoUtente, distanzaKm, formattaDistanza };
