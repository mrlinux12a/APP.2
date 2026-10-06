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

// { chiave: '2026-10', titolo: 'Ottobre 2026' }: il mese di una colonna TIMESTAMP senza fuso, in ora italiana.
function meseRoma(naive) {
  const istante = istanteUtc(naive);
  if (!istante) return { chiave: '', titolo: '—' };
  const d = partiRoma(istante);
  return { chiave: `${d.anno}-${String(d.mese).padStart(2, '0')}`, titolo: `${MESI_ESTESI[d.mese - 1]} ${d.anno}` };
}

module.exports = { toDate, istanteUtc, dataOra, dataSola, oraSola, oraRoma, dataOraRoma, dataBreveRoma, meseRoma, tempoConsegna, mmss };
