// Tempo di guida fra due punti, preso da un servizio di mappe.
//
// Serve a dire all'installatore quando arriva la merce: i minuti che il corriere scrive su WhatsApp (da lui al banco) più il tragitto dal banco che ha
// accettato fino alla posizione dell'installatore (vedi src/consegna.js e src/corriere.js). Il tragitto lo calcola OSRM sulle strade di OpenStreetMap
// (lo stesso OpenStreetMap di Nominatim e della mappa del sito), senza chiave. Il server pubblico di OSRM è di prova e va usato con moderazione: con molte
// richieste conviene un OSRM proprio (ROUTING_URL) o un servizio a pagamento con lo stesso formato di risposta.
//
// Variabili d'ambiente:
//   ROUTING_URL      indirizzo del servizio OSRM, default https://router.project-osrm.org
//   ROUTING_ATTIVO   0 per non chiamare nessun servizio (si ricade sulla stima in linea d'aria di consegna.js)
//
// NON lancia mai: chi lo chiama (la conferma del banco) non deve fallire perché le mappe non rispondono. Ritorna null e chi chiama usa la stima.

const URL_PREDEFINITO = 'https://router.project-osrm.org';
const ATTESA_MS = 4000;

function attivo() {
  return String(process.env.ROUTING_ATTIVO === undefined ? '1' : process.env.ROUTING_ATTIVO).trim() !== '0';
}

function baseUrl() {
  return (process.env.ROUTING_URL || URL_PREDEFINITO).trim().replace(/\/+$/, '');
}

function puntoValido(p) {
  return !!p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null;
}

// { minuti, km } in auto da `da` a `a` (ognuno { lat, lng }), o null se il servizio non risponde o non trova la strada.
// `opzioni.fetch` e `opzioni.attesaMs` servono alle prove.
async function minutiInAuto(da, a, opzioni = {}) {
  if (!attivo() || !puntoValido(da) || !puntoValido(a)) return null;
  const chiama = opzioni.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!chiama) return null;

  const controllo = new AbortController();
  const timer = setTimeout(() => controllo.abort(), opzioni.attesaMs || ATTESA_MS);
  try {
    // OSRM vuole longitudine,latitudine (l'opposto del solito).
    const url = `${baseUrl()}/route/v1/driving/${Number(da.lng)},${Number(da.lat)};${Number(a.lng)},${Number(a.lat)}?overview=false&alternatives=false&steps=false`;
    const risposta = await chiama(url, { signal: controllo.signal, headers: { 'User-Agent': 'Minuteria/1.0 (tempo di consegna)' } });
    if (!risposta || !risposta.ok) return null;
    const dati = await risposta.json();
    const tratta = dati && dati.code === 'Ok' && Array.isArray(dati.routes) ? dati.routes[0] : null;
    const secondi = tratta ? Number(tratta.duration) : NaN;
    if (!Number.isFinite(secondi) || secondi < 0) return null;
    const metri = Number(tratta.distance);
    return {
      minuti: Math.max(1, Math.round(secondi / 60)),
      km: Number.isFinite(metri) ? Math.round(metri / 100) / 10 : null,
    };
  } catch (e) {
    // rete assente, tempo scaduto, risposta non leggibile: si rinuncia e chi chiama ripiega sulla stima
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { minutiInAuto, attivo };
