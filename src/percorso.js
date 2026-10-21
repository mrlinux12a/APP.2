// Tempo di guida fra due punti, preso da un servizio di mappe.
//
// Serve a dire all'installatore quando arriva la merce: i minuti che il corriere scrive su WhatsApp (da lui al banco) più il tragitto dal banco che ha
// accettato fino alla posizione dell'installatore (vedi src/consegna.js e src/corriere.js). Il tragitto deve essere quello che direbbe Google Maps in auto:
// per questo i servizi si provano IN ORDINE e vale il primo che risponde.
//
//   1. Google Maps (Routes API, con il traffico del momento): solo se nel .env c'è GOOGLE_MAPS_API_KEY. È il numero che si vede su Maps.
//   2. OSRM proprio: solo se nel .env c'è ROUTING_URL (un server vostro, con la vostra configurazione). Il server pubblico di OSRM NON si usa più: dà tempi da
//      strada libera, senza semafori né incroci, in città un terzo più brevi di Maps (Fegino → Via Dodecaneso, Genova: 21 min contro i 31 di Maps).
//   3. Valhalla (https://valhalla1.openstreetmap.de, senza chiave; VALHALLA_URL per un server proprio): conta incroci e limiti di velocità, scarto da Maps
//      di pochi minuti (stesso percorso: 34 min). Il server pubblico è di una fondazione, a uso leggero e senza garanzie: per questo c'è il passo 4.
//   4. Se nessuno risponde, chi chiama (src/consegna.js) ripiega sulla stima in linea d'aria × fattore strada a velocità media di città.
//
// Variabili d'ambiente:
//   GOOGLE_MAPS_API_KEY   chiave di Google Maps Platform con la "Routes API" abilitata (solo sul server, mai nel browser)
//   ROUTING_URL           indirizzo di un OSRM proprio, per esempio http://osrm.interno:5000
//   VALHALLA_URL          indirizzo di un Valhalla proprio, default https://valhalla1.openstreetmap.de
//   ROUTING_ATTIVO        0 per non chiamare nessun servizio (si ricade subito sulla stima)
//
// NON lancia mai: chi lo chiama (la conferma del banco, il "preso" del corriere) non deve fallire perché le mappe non rispondono. Ritorna null e chi chiama
// usa la stima. La chiave di Google viaggia in un'intestazione e non si scrive mai nei log.

const URL_VALHALLA = 'https://valhalla1.openstreetmap.de';
const URL_GOOGLE = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ATTESA_MS = 3500; // per ogni servizio: con due servizi lenti il banco aspetta al massimo ~7 s, poi c'è comunque la stima

function attivo() {
  return String(process.env.ROUTING_ATTIVO === undefined ? '1' : process.env.ROUTING_ATTIVO).trim() !== '0';
}

const senzaBarra = (u) => String(u || '').trim().replace(/\/+$/, '');

function puntoValido(p) {
  return !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null;
}

// Ogni servizio ritorna { secondi, metri } o null; ricevono i due punti e un `chiama(url, opzioni)` che ha già il limite di attesa.
const SERVIZI = {
  // Google Routes API: duration è un testo come "1860s". TRAFFIC_AWARE = il tempo con il traffico di adesso, senza `departureTime` (partire "adesso").
  async google(da, a, chiama) {
    const chiave = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
    if (!chiave) return null;
    const punto = (p) => ({ location: { latLng: { latitude: Number(p.lat), longitude: Number(p.lng) } } });
    const risposta = await chiama(URL_GOOGLE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': chiave,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
      },
      body: JSON.stringify({
        origin: punto(da),
        destination: punto(a),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        regionCode: 'IT',
        languageCode: 'it-IT',
        units: 'METRIC',
      }),
    });
    if (!risposta || !risposta.ok) return null;
    const dati = await risposta.json();
    const tratta = dati && Array.isArray(dati.routes) ? dati.routes[0] : null;
    const letto = tratta && /^(\d+(?:\.\d+)?)s$/.exec(String(tratta.duration || ''));
    return letto ? { secondi: Number(letto[1]), metri: Number(tratta.distanceMeters) } : null;
  },

  // OSRM proprio: vuole longitudine,latitudine (l'opposto del solito). Solo se ROUTING_URL è scritto.
  async osrm(da, a, chiama) {
    const base = senzaBarra(process.env.ROUTING_URL);
    if (!base) return null;
    const url = `${base}/route/v1/driving/${Number(da.lng)},${Number(da.lat)};${Number(a.lng)},${Number(a.lat)}?overview=false&alternatives=false&steps=false`;
    const risposta = await chiama(url, {});
    if (!risposta || !risposta.ok) return null;
    const dati = await risposta.json();
    const tratta = dati && dati.code === 'Ok' && Array.isArray(dati.routes) ? dati.routes[0] : null;
    return tratta ? { secondi: Number(tratta.duration), metri: Number(tratta.distance) } : null;
  },

  // Valhalla: summary.time in secondi e length in chilometri.
  async valhalla(da, a, chiama) {
    const base = senzaBarra(process.env.VALHALLA_URL) || URL_VALHALLA;
    const risposta = await chiama(`${base}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [{ lat: Number(da.lat), lon: Number(da.lng) }, { lat: Number(a.lat), lon: Number(a.lng) }],
        costing: 'auto',
        directions_type: 'none',
      }),
    });
    if (!risposta || !risposta.ok) return null;
    const dati = await risposta.json();
    const riassunto = dati && dati.trip && dati.trip.summary;
    return riassunto ? { secondi: Number(riassunto.time), metri: Number(riassunto.length) * 1000 } : null;
  },
};

// I servizi che valgono ADESSO, nell'ordine in cui si provano.
function elencoServizi() {
  const elenco = [];
  if (String(process.env.GOOGLE_MAPS_API_KEY || '').trim()) elenco.push('google');
  if (senzaBarra(process.env.ROUTING_URL)) elenco.push('osrm');
  elenco.push('valhalla');
  return elenco;
}

// Un solo servizio, con il suo limite di attesa. { minuti, km, servizio } o null (mai un errore: rete assente, tempo scaduto, risposta non leggibile; l'errore
// non si scrive da nessuna parte, potrebbe contenere l'indirizzo con la chiave).
async function conServizio(nome, da, a, funzione, attesaMs) {
  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), attesaMs || ATTESA_MS);
  try {
    const chiama = (url, extra) =>
      funzione(url, { ...extra, signal: controllo.signal, headers: { 'User-Agent': 'Minuteria/1.0 (tempo di consegna)', ...((extra && extra.headers) || {}) } });
    const tratta = await SERVIZI[nome](da, a, chiama);
    const secondi = tratta ? Number(tratta.secondi) : NaN;
    if (!Number.isFinite(secondi) || secondi < 0) return null;
    const metri = Number(tratta.metri);
    return {
      minuti: Math.max(1, Math.round(secondi / 60)),
      km: Number.isFinite(metri) ? Math.round(metri / 100) / 10 : null,
      servizio: nome,
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// { minuti, km, servizio } in auto da `da` a `a` (ognuno { lat, lng }), o null se nessun servizio risponde o non trova la strada. `servizio` dice chi ha
// risposto ('google', 'osrm', 'valhalla'). `opzioni.fetch` e `opzioni.attesaMs` servono alle prove; `opzioni.solo` ('google', 'osrm' o 'valhalla') prova un
// servizio solo, senza passare agli altri (lo usa scripts/prova_tragitto.js per confrontarli).
async function minutiInAuto(da, a, opzioni = {}) {
  if (!attivo() || !puntoValido(da) || !puntoValido(a)) return null;
  const funzione = opzioni.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!funzione) return null;

  for (const nome of opzioni.solo ? [opzioni.solo] : elencoServizi()) {
    if (!Object.hasOwn(SERVIZI, nome)) continue;
    const risultato = await conServizio(nome, da, a, funzione, opzioni.attesaMs);
    if (risultato) return risultato;
  }
  return null;
}

module.exports = { minutiInAuto, attivo, elencoServizi };
