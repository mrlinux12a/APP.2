// Le date sono salvate da SQLite con datetime('now'), quindi in UTC: qui le riportiamo
// all'ora locale italiana per la visualizzazione.
function toDate(sqlUtc) {
  if (!sqlUtc) return null;
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

module.exports = { dataOra, dataSola, oraSola, tempoConsegna, mmss };
