const format = require('./format');

// Gli orari del corriere, in un posto solo.
//
// Su WhatsApp il corriere risponde al messaggio con «preso <minuti>»: quei minuti sono il tempo che ci mette ad ARRIVARE DAL BANCO (la tappa 1, il prelievo
// della merce). Da lì nascono due orari diversi, e ciascuno lo vede solo chi deve:
//
//  · BANCO: vede esattamente il tempo scritto su WhatsApp, cioè l'orario di ritiro = quando il corriere ha risposto (orders.corriere_risposto_il) + i minuti
//    scritti (orders.corriere_minuti). Non c'è una colonna apposta: si ricava ogni volta da queste due, con `ritiro` (JS) o `ritiroSql` (nelle query).
//  · INSTALLATORE: vede quando arriva la merce da lui = ritiro + il tempo di percorrenza dal banco che ha accettato alla sua posizione (src/consegna.js,
//    calcolato con un servizio di mappe quando il banco conferma). Sta in orders.corriere_arrivo_il, già comprensivo di tutto.
//
// Gli ordini nati prima di questa regola hanno in corriere_minuti il tempo TOTALE (dal ritiro alla consegna): per loro il "ritiro" che si ricava è
// l'orario di consegna, come il banco lo vedeva già prima.

// L'istante in cui il corriere arriva dal banco, come Date; null se l'ordine non ha i due dati (nessun corriere: modulo WhatsApp spento).
// corriere_risposto_il è TIMESTAMPTZ (un istante vero): niente conversioni di fuso.
function ritiro(ordine) {
  if (!ordine) return null;
  const risposto = format.toDate(ordine.corriere_risposto_il);
  const minuti = Number(ordine.corriere_minuti);
  if (!risposto || ordine.corriere_minuti === null || ordine.corriere_minuti === undefined || !Number.isFinite(minuti)) return null;
  return new Date(risposto.getTime() + minuti * 60 * 1000);
}

// Lo stesso istante per le query: `alias` è quello della tabella orders (default "o"). NULL se manca uno dei due dati, come `ritiro`.
function ritiroSql(alias = 'o') {
  const t = alias ? alias + '.' : '';
  return `(${t}corriere_risposto_il + ${t}corriere_minuti * INTERVAL '1 minute')`;
}

module.exports = { ritiro, ritiroSql };
