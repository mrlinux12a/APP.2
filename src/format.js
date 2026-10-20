// Le date su Postgres arrivano già come oggetti Date (il driver pg le converte da solo);
// su SQLite invece sono testo "YYYY-MM-DD HH:MM:SS" in UTC, salvato da datetime('now').
// Qui riportiamo entrambe all'ora locale italiana per la visualizzazione.
function toDate(sqlUtc) {
  if (!sqlUtc) return null;
  if (sqlUtc instanceof Date) return isNaN(sqlUtc.getTime()) ? null : sqlUtc;
  const iso = String(sqlUtc).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function dataOra(sqlUtc) {
  const d = toDate(sqlUtc);
  if (!d) return '—';
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dataSola(sqlUtc) {
  const d = toDate(sqlUtc);
  if (!d) return '—';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function oraSola(sqlUtc) {
  const d = toDate(sqlUtc);
  if (!d) return '—';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// Ora italiana fissa, per gli orari d'arrivo dati dal corriere: la VPS può essere in UTC.
function oraRoma(data) {
  const d = toDate(data);
  if (!d) return '—';
  return d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
}

// "36 ore" -> "1 giorno e 12 ore", per rendere leggibili i tempi di consegna dichiarati.
function tempoConsegna(ore) {
  if (ore === null || ore === undefined) return '—';
  if (ore < 1) return 'meno di un\u2019ora';
  if (ore < 24) return ore === 1 ? '1 ora' : `${ore} ore`;
  const giorni = Math.floor(ore / 24);
  const resto = ore % 24;
  const parteGiorni = giorni === 1 ? '1 giorno' : `${giorni} giorni`;
  if (resto === 0) return parteGiorni;
  return `${parteGiorni} e ${resto === 1 ? '1 ora' : resto + ' ore'}`;
}

function mmss(secondi) {
  const s = Math.max(0, Math.floor(secondi || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Le colonne TIMESTAMP senza fuso dello schema (creato_il, pagato_il...) contengono l'ora UTC, ma pg le
// legge come ora locale del processo: il Date che arriva è sfasato dell'offset del fuso (2 ore a Roma
// d'estate, nessuna su una VPS in UTC). Questa rimette a posto l'istante: serve per confrontarlo con un
// orario vero (Date.now(), colonne TIMESTAMPTZ come corriere_arrivo_il) o per mostrarlo in ora italiana.
function istanteUtc(naive) {
  if (!naive) return null;
  if (!(naive instanceof Date)) return toDate(naive);
  if (isNaN(naive.getTime())) return null;
  return new Date(Date.UTC(
    naive.getFullYear(), naive.getMonth(), naive.getDate(),
    naive.getHours(), naive.getMinutes(), naive.getSeconds(), naive.getMilliseconds()
  ));
}

// "04/10/2026 alle 23:20", in ora italiana, da una colonna TIMESTAMP senza fuso. `separatore` sostituisce
// " alle " (es. ', ' per "04/10/2026, 23:20").
function dataOraRoma(naive, separatore = ' alle ') {
  const d = istanteUtc(naive);
  if (!d) return '—';
  const giorno = d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${giorno}${separatore}${oraRoma(d)}`;
}

// "04/10/2026", in ora italiana, da una colonna TIMESTAMP senza fuso: solo il giorno, senza ora. "—" se manca.
function dataSolaRoma(naive) {
  const d = istanteUtc(naive);
  if (!d) return '—';
  return d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });
}

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MESI_ESTESI = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];
const FORMATO_ROMA = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Anno, mese (1-12), giorno, ora e minuti (stringhe a due cifre) di un istante vero, in ora italiana.
function partiRoma(istante) {
  const p = {};
  for (const x of FORMATO_ROMA.formatToParts(istante)) p[x.type] = x.value;
  return { anno: Number(p.year), mese: Number(p.month), giorno: Number(p.day), ora: p.hour, minuti: p.minute };
}

// "Oggi · 21:20", "Ieri · 18:05", "12 set · 09:40" (con l'anno se non è quello corrente), in ora italiana, da
// una colonna TIMESTAMP senza fuso. `adesso` si passa solo nelle prove.
function dataBreveRoma(naive, adesso = new Date()) {
  const istante = istanteUtc(naive);
  if (!istante) return '—';
  const d = partiRoma(istante);
  const oggi = partiRoma(adesso);
  const giorni = Math.round((Date.UTC(oggi.anno, oggi.mese - 1, oggi.giorno) - Date.UTC(d.anno, d.mese - 1, d.giorno)) / 86400000);
  const quando = giorni === 0 ? 'Oggi'
    : giorni === 1 ? 'Ieri'
    : `${d.giorno} ${MESI_BREVI[d.mese - 1]}${d.anno === oggi.anno ? '' : ' ' + d.anno}`;
  return `${quando} · ${d.ora}:${d.minuti}`;
}

// "12 set" (con l'anno se non è quello corrente: "12 set 2025"), in ora italiana, da una colonna TIMESTAMP senza
// fuso. Solo il giorno, senza "Oggi"/"Ieri" né ora. `adesso` si passa solo nelle prove.
function dataCortaRoma(naive, adesso = new Date()) {
  const istante = istanteUtc(naive);
  if (!istante) return '—';
  const d = partiRoma(istante);
  return `${d.giorno} ${MESI_BREVI[d.mese - 1]}${d.anno === partiRoma(adesso).anno ? '' : ' ' + d.anno}`;
}

// "8 min", "1 h 05": una durata in minuti come la scrive la home del banco. Stessa regola in public/app.js (Minuteria.durataMinuti).
function durataMinuti(min) {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// "45′", "1h05": la stessa durata in forma breve, per il badge dell'icona "Stato ordini". Stessa regola nel blocco "Consegna in arrivo" di public/app.js.
function durataBreve(min) {
  return min < 60 ? `${min}′` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

// "meno di 1 min", "3 min", "1 h 05": quanto tempo è passato da qualcosa che si è fatto ("Corriere avvisato · da 3 min").
function daMinuti(secondi) {
  const min = Math.max(0, Math.floor((Number(secondi) || 0) / 60));
  return min < 1 ? 'meno di 1 min' : durataMinuti(min);
}

// "04:13" che sale, "1 h 05" oltre l'ora: il tempo di attesa del corriere, nel cerchio della pagina di dettaglio.
function tempoTrascorso(secondi) {
  const s = Math.max(0, Math.floor(Number(secondi) || 0));
  return s < 3600 ? mmss(s) : durataMinuti(Math.floor(s / 60));
}

// "22:29", in ora italiana, da una colonna TIMESTAMP senza fuso (solo l'ora, senza giorno). "—" se manca.
function oraSolaRoma(naive) {
  const istante = istanteUtc(naive);
  if (!istante) return '—';
  const d = partiRoma(istante);
  return `${d.ora}:${d.minuti}`;
}

// Il giorno di una colonna TIMESTAMP senza fuso, in ora italiana, per raggruppare gli elenchi:
// { chiave: '2026-10-14', etichetta: 'Oggi' | 'Ieri' | '12 ottobre' } (con l'anno se non è quello corrente:
// '12 ottobre 2025'). La chiave è uguale per tutti gli istanti dello stesso giorno italiano. `adesso` solo nelle prove.
function giornoRoma(naive, adesso = new Date()) {
  const istante = istanteUtc(naive);
  if (!istante) return { chiave: '', etichetta: '—' };
  const d = partiRoma(istante);
  const oggi = partiRoma(adesso);
  const giorni = Math.round((Date.UTC(oggi.anno, oggi.mese - 1, oggi.giorno) - Date.UTC(d.anno, d.mese - 1, d.giorno)) / 86400000);
  const etichetta = giorni === 0 ? 'Oggi'
    : giorni === 1 ? 'Ieri'
    : `${d.giorno} ${MESI_ESTESI[d.mese - 1].toLowerCase()}${d.anno === oggi.anno ? '' : ' ' + d.anno}`;
  return { chiave: `${d.anno}-${String(d.mese).padStart(2, '0')}-${String(d.giorno).padStart(2, '0')}`, etichetta };
}

// "Martedì 14 ottobre alle 20:10" (con l'anno se non è quello corrente: "Venerdì 14 marzo 2025 alle 11:40"), in ora
// italiana, da una colonna TIMESTAMP senza fuso: la data di consegna della pagina dell'ordine. `adesso` solo nelle prove.
function dataEstesaRoma(naive, adesso = new Date()) {
  const istante = istanteUtc(naive);
  if (!istante) return '—';
  const d = partiRoma(istante);
  const giorno = istante.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' });
  const anno = d.anno === partiRoma(adesso).anno ? '' : ' ' + d.anno;
  return `${giorno.charAt(0).toUpperCase()}${giorno.slice(1)} ${d.giorno} ${MESI_ESTESI[d.mese - 1].toLowerCase()}${anno} alle ${d.ora}:${d.minuti}`;
}

// { chiave: '2026-10', titolo: 'Ottobre 2026' }: il mese di una colonna TIMESTAMP senza fuso, in ora italiana.
function meseRoma(naive) {
  const istante = istanteUtc(naive);
  if (!istante) return { chiave: '', titolo: '—' };
  const d = partiRoma(istante);
  return { chiave: `${d.anno}-${String(d.mese).padStart(2, '0')}`, titolo: `${MESI_ESTESI[d.mese - 1]} ${d.anno}` };
}

// Durata in secondi della finestra di conferma di una richiesta, per far partire l'anello PIENO: di norma è `scade_il - creato_il`
// (la finestra configurata), ma una richiesta rinviata ("Rinvia richiesta") riapre la stessa riga con `scade_il` ricalcolato e
// `creato_il` di prima, e la differenza diventerebbe di ore: l'anello partirebbe quasi vuoto. Oltre la finestra si usa la finestra.
function durataFinestraSec(creato, scade, finestraMin) {
  const finestra = Number(finestraMin) > 0 ? Math.round(Number(finestraMin) * 60) : 600;
  const inizio = toDate(creato);
  const fine = toDate(scade);
  if (!inizio || !fine) return finestra;
  const diff = Math.round((fine - inizio) / 1000);
  return diff > 0 && diff <= finestra ? diff : finestra;
}

// Un ordine in consegna a 3 minuti o meno dall'arrivo "è in arrivo": al posto di "Arriva entro le HH:MM" / "Arriva tra N min" si scrive
// "In arrivo" (richiesta esplicita). `secondi` = secondi che mancano all'arrivo (anche negativi: l'orario è passato e l'ordine non è ancora
// segnato consegnato). La stessa soglia c'è in public/app.js (IN_ARRIVO_SEC, blocco "Consegna in arrivo"): vanno tenute uguali.
const SOGLIA_IN_ARRIVO_SEC = 3 * 60;
function inArrivo(secondi) {
  return Number.isFinite(secondi) && secondi <= SOGLIA_IN_ARRIVO_SEC;
}

// "15/10" (con l'anno se non è quello corrente: "15/10/2025"), in ora italiana, da una colonna TIMESTAMP senza fuso. "" se manca. `adesso` solo per le prove.
function giornoMeseRoma(naive, adesso = new Date()) {
  const istante = istanteUtc(naive);
  if (!istante) return '';
  const d = partiRoma(istante);
  const gm = `${String(d.giorno).padStart(2, '0')}/${String(d.mese).padStart(2, '0')}`;
  return d.anno === partiRoma(adesso).anno ? gm : `${gm}/${d.anno}`;
}

// "BOREA SRL" -> "BOREA": il nome di una ditta senza la forma giuridica in fondo (S.r.l., S.p.A., S.n.c., S.a.s.), per le etichette corte.
function nomeCommerciale(nome) {
  return String(nome || '').trim().replace(/\s+(s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?)$/i, '').trim();
}

// Indirizzo su una riga sola ("Via Roma 1 — 16100 Genova (GE)"), saltando i pezzi mancanti. Vale per qualunque riga con indirizzo/cap/citta/provincia
// (un cliente, un banco).
function indirizzoCompleto(a) {
  if (!a) return '';
  const riga2 = [a.cap, a.citta, a.provincia ? `(${a.provincia})` : ''].filter(Boolean).join(' ');
  return [a.indirizzo, riga2].filter(Boolean).join(' — ');
}

module.exports = { indirizzoCompleto, giornoMeseRoma, nomeCommerciale, SOGLIA_IN_ARRIVO_SEC, inArrivo, toDate, istanteUtc, dataOra, dataSola, oraSola, oraRoma, dataOraRoma, dataSolaRoma, dataBreveRoma, dataCortaRoma, dataEstesaRoma, oraSolaRoma, giornoRoma, durataMinuti, durataBreve, daMinuti, tempoTrascorso, meseRoma, tempoConsegna, mmss, durataFinestraSec };
