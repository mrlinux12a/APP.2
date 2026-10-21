// Prova del tragitto banco -> installatore, per confrontarlo con Google Maps. NON scrive niente (nessun DB, nessuna richiesta): chiede ai servizi di mappe
// il tempo in auto fra due punti e lo mostra servizio per servizio, più quello che vedrebbe l'installatore (tempo del corriere + tragitto).
//
//   node scripts/prova_tragitto.js "Via Dodecaneso, 16131 Genova (GE)"            dal banco di Borea (Fegino) a quell'indirizzo
//   node scripts/prova_tragitto.js 44.4025,8.9715                                  a una coppia lat,lng
//   node scripts/prova_tragitto.js "Via Puggia 22/3, Genova" --corriere 10         con i minuti che il corriere scrive su WhatsApp
//   node scripts/prova_tragitto.js "Via X, Genova" --da 44.4471,8.8891             da un altro punto di partenza (lat,lng)
//
// Parte da Fegino (Borea, la posizione fissa del DB: Via Castel Morrone 1/7 rosso). Legge GOOGLE_MAPS_API_KEY, ROUTING_URL e VALHALLA_URL dal .env: i servizi
// senza chiave non compaiono. Le due righe da confrontare sono quella di "Google" (se c'è la chiave: è il numero di Maps) e quella finale, "Mostrato".
require('dotenv').config({ quiet: true });
const geo = require('../src/geo');
const percorso = require('../src/percorso');
const consegna = require('../src/consegna');

const FEGINO = { lat: 44.4470549, lng: 8.8890734 };

function coppia(testo) {
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(String(testo || ''));
  return m ? { lat: Number(m[1].replace(',', '.')), lng: Number(m[2].replace(',', '.')) } : null;
}

(async () => {
  const args = process.argv.slice(2);
  const valore = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
  const destinazione = args.find((x, i) => !x.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!destinazione) {
    console.log('Uso: node scripts/prova_tragitto.js "<indirizzo | lat,lng>" [--corriere <minuti>] [--da <lat,lng>]');
    process.exit(1);
  }
  const corriere = Number(valore('--corriere')) || 0;
  const da = coppia(valore('--da')) || FEGINO;

  let a = coppia(destinazione);
  if (!a) {
    const trovata = await geo.geocodifica({ indirizzo: destinazione });
    if (!trovata) { console.log(`Indirizzo non trovato sulla mappa: "${destinazione}"`); process.exit(2); }
    a = { lat: trovata.lat, lng: trovata.lng };
    console.log(`Destinazione: ${trovata.descrizione || destinazione} (${a.lat}, ${a.lng})`);
  } else {
    console.log(`Destinazione: ${a.lat}, ${a.lng}`);
  }
  console.log(`Partenza:     ${da.lat}, ${da.lng}${da === FEGINO ? '  (Borea, Fegino)' : ''}`);
  console.log('');

  const nomi = { google: 'Google Maps (col traffico)', osrm: 'OSRM proprio (ROUTING_URL)', valhalla: 'Valhalla (OpenStreetMap)' };
  const inUso = percorso.elencoServizi();
  console.log('Servizi attivi, in ordine:', inUso.map((n) => nomi[n]).join(' → '));
  for (const nome of inUso) {
    const r = await percorso.minutiInAuto(da, a, { solo: nome });
    console.log(`  ${nomi[nome].padEnd(30)} ${r ? `${String(r.minuti).padStart(3)} min  ${r.km === null ? '' : r.km + ' km'}` : 'nessuna risposta'}`);
  }
  if (!inUso.includes('google')) console.log('  (senza GOOGLE_MAPS_API_KEY il tempo è quello di Valhalla, che può scostarsi di qualche minuto da Maps)');

  const finale = await percorso.minutiInAuto(da, a);
  console.log('');
  if (finale) {
    console.log(`Tragitto usato: ${finale.minuti} min (${nomi[finale.servizio]}${finale.km === null ? '' : ', ' + finale.km + ' km'})`);
    console.log(`Mostrato all'installatore: ${corriere} (corriere) + ${finale.minuti} (tragitto) = ${corriere + finale.minuti} minuti`);
  } else {
    // come fa src/consegna.js quando nessun servizio risponde: linea d'aria × fattore strada, a velocità media di città (qui 25 km/h come da config di default)
    const km = geo.distanzaKm(da, a);
    const stima = Math.max(5, Math.round(((km * consegna.FATTORE_STRADA) / 25) * 60));
    console.log(`Nessun servizio ha risposto: si userebbe la stima in linea d'aria, circa ${stima} min.`);
    console.log(`Mostrato all'installatore: ${corriere} + ${stima} = ${corriere + stima} minuti`);
  }
  process.exit(0);
})().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
