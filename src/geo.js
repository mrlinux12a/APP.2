const db = require('../db');

// Posizione e distanze. La posizione di un installatore è quella dell'indirizzo di consegna che manda col pagamento (posizioneDellaDestinazione, salvata da
// salvaPosizioneCliente); finché non ne ha mandata una vale la sede fissa di src/sede_installatori.js. Quella dei banchi è del punto vendita. Qui anche la
// lettura e il calcolo delle distanze.

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

// Dall'indirizzo alla posizione sulla mappa (Nominatim, il servizio di OpenStreetMap: lo stesso con cui sono state ricavate le coordinate dei
// banchi). Serve alla pagina "Anagrafica del banco" quando cambia l'indirizzo di ritiro. Nessuna chiave: la regola d'uso di Nominatim vuole un
// User-Agent che dica chi siamo e al massimo una richiesta al secondo (fra il primo tentativo e il secondo si aspetta). Ritorna
// { lat, lng, descrizione } o null: indirizzo non trovato, rete assente, risposta fuori dall'Italia. NON lancia mai: chi salva un indirizzo non deve
// fallire perché la mappa non risponde. `opzioni.fetch` e `opzioni.pausaMs` servono alle prove.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const ATTESA_GEOCODIFICA_MS = 6000;
const PAUSA_TRA_TENTATIVI_MS = 1100;

// I tentativi, dal più preciso al più largo: l'indirizzo completo (con CAP) e poi senza CAP (un CAP scritto male non deve far perdere la via).
function ricercheGeocodifica({ indirizzo, cap, citta, provincia }) {
  const via = String(indirizzo || '').trim();
  const luogo = [String(cap || '').trim(), String(citta || '').trim()].filter(Boolean).join(' ');
  const completa = [via, luogo, String(provincia || '').trim(), 'Italia'].filter(Boolean).join(', ');
  const senzaCap = [via, String(citta || '').trim(), String(provincia || '').trim(), 'Italia'].filter(Boolean).join(', ');
  return via ? [...new Set([completa, senzaCap])] : [];
}

async function geocodifica(dati, opzioni = {}) {
  const chiama = opzioni.fetch || (typeof fetch === 'function' ? fetch : null);
  const pausaMs = opzioni.pausaMs === undefined ? PAUSA_TRA_TENTATIVI_MS : opzioni.pausaMs;
  if (!chiama) return null;
  const ricerche = ricercheGeocodifica(dati || {});
  for (let i = 0; i < ricerche.length; i++) {
    if (i > 0 && pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
    const controllo = new AbortController();
    const timer = setTimeout(() => controllo.abort(), opzioni.attesaMs || ATTESA_GEOCODIFICA_MS);
    try {
      const url = NOMINATIM_URL + '?' + new URLSearchParams({ q: ricerche[i], format: 'jsonv2', limit: '1', countrycodes: 'it' }).toString();
      const risposta = await chiama(url, {
        signal: controllo.signal,
        headers: { 'User-Agent': 'Minuteria/1.0 (anagrafica del banco)', 'Accept-Language': 'it' },
      });
      if (!risposta || !risposta.ok) continue;
      const trovati = await risposta.json();
      const primo = Array.isArray(trovati) ? trovati[0] : null;
      const lat = primo ? Number(primo.lat) : NaN;
      const lng = primo ? Number(primo.lon) : NaN;
      if (posizioneValida(lat, lng)) return { lat, lng, descrizione: String(primo.display_name || '').slice(0, 300) };
    } catch (e) {
      // rete assente, tempo scaduto, risposta non leggibile: si passa al tentativo dopo, o si rinuncia
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Una posizione che ha senso per un banco in Italia (riquadro largo: isole comprese). Serve anche a respingere i valori di un modulo scritto a mano.
function posizioneValida(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 35 && lat <= 48 && lng >= 6 && lng <= 19;
}

// Dalla posizione del dispositivo all'indirizzo (Nominatim, geocodifica inversa): serve al carrello, che con la posizione precompila "Consegna in cantiere".
// Ritorna "Via Puggia 22/3, 16131 Genova (GE)" o null (fuori dall'Italia, senza una via, rete assente). NON lancia mai. `opzioni.fetch` serve alle prove.
const NOMINATIM_INVERSA_URL = 'https://nominatim.openstreetmap.org/reverse';
async function indirizzoDaPosizione(lat, lng, opzioni = {}) {
  const chiama = opzioni.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!chiama || !posizioneValida(lat, lng)) return null;
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), opzioni.attesaMs || ATTESA_GEOCODIFICA_MS);
  try {
    const url = NOMINATIM_INVERSA_URL + '?' + new URLSearchParams({ lat: String(lat), lon: String(lng), format: 'jsonv2', zoom: '18', addressdetails: '1' }).toString();
    const risposta = await chiama(url, { signal: controllo.signal, headers: { 'User-Agent': 'Minuteria/1.0 (indirizzo di consegna)', 'Accept-Language': 'it' } });
    if (!risposta || !risposta.ok) return null;
    const a = (await risposta.json()).address;
    if (!a || a.country_code !== 'it') return null;
    const via = a.road || a.pedestrian || a.footway || a.path || '';
    if (!via) return null;
    const citta = a.city || a.town || a.village || a.municipality || '';
    const provincia = String(a['ISO3166-2-lvl6'] || '').replace(/^IT-/, '');
    const luogo = [a.postcode, citta].filter(Boolean).join(' ') + (provincia && citta ? ' (' + provincia + ')' : '');
    return [[via, a.house_number].filter(Boolean).join(' '), luogo].filter(Boolean).join(', ');
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// La posizione dell'indirizzo di consegna che l'installatore manda col pagamento: quella del dispositivo se il carrello ha mandato le coordinate (valgono solo
// se l'indirizzo è ancora quello ricavato da lei: lo script le toglie appena lo si modifica), altrimenti la ricava dall'indirizzo scritto. Ritorna { lat, lng } o null.
async function posizioneDellaDestinazione(destinazione, lat, lng, opzioni = {}) {
  const numero = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
  const la = numero(lat);
  const lo = numero(lng);
  if (posizioneValida(la, lo)) return { lat: la, lng: lo };
  const trovata = await geocodifica({ indirizzo: String(destinazione || '').trim() }, opzioni);
  return trovata ? { lat: trovata.lat, lng: trovata.lng } : null;
}

// Salva la posizione di consegna dell'installatore (users.geo_*): è da qui che si calcola il tragitto banco -> installatore. Sostituisce quella di prima (la sede
// fissa di src/sede_installatori.js, che resta solo come ripiego per chi non ne ha una). È l'ultima mandata: con due richieste insieme vale quella dell'ultima.
// Solo numeri veri (un testo o un elenco non valgono), dentro il riquadro dell'Italia. `precisione` (metri) è facoltativa. Ritorna false se non vale.
async function salvaPosizioneCliente(userId, lat, lng, precisione) {
  const numero = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
  const la = numero(lat);
  const lo = numero(lng);
  if (!posizioneValida(la, lo)) return false;
  const p = numero(precisione);
  const precisioneM = Number.isFinite(p) && p >= 0 ? Math.min(Math.round(p), 1000000) : null;
  const info = await db
    .prepare(
      `UPDATE users
          SET geo_lat = ?, geo_lng = ?, geo_precisione = ?, geo_consenso = 1, geo_aggiornata_il = NOW()
        WHERE id = ? AND ruolo = 'cliente'`
    )
    .run(la, lo, precisioneM, userId);
  return info.changes > 0;
}

module.exports = { statoUtente, distanzaKm, formattaDistanza, geocodifica, ricercheGeocodifica, posizioneValida, salvaPosizioneCliente, indirizzoDaPosizione, posizioneDellaDestinazione };
