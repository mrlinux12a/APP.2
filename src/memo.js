// Cache in memoria con scadenza, per letture che l'app non modifica mai (configurazione,
// struttura del catalogo): ogni richiesta le rileggeva dal DB, e col DB su un altro server
// ogni lettura costa una andata e ritorno di rete. Le modifiche fatte da script (importazioni,
// assegnazioni) compaiono entro `ttlMs`.
//
// Si memorizza la promessa, non il valore: due richieste che arrivano insieme condividono la
// stessa lettura. Una lettura fallita non resta in cache. I valori restituiti sono condivisi
// fra le richieste: chi li usa non deve modificarli.
function conCache(ttlMs, leggi) {
  const voci = new Map();
  return function letturaInCache(...args) {
    const chiave = JSON.stringify(args);
    const adesso = Date.now();
    const voce = voci.get(chiave);
    if (voce && voce.scade > adesso) return voce.valore;

    const valore = Promise.resolve(leggi(...args));
    voci.set(chiave, { valore, scade: adesso + ttlMs });
    valore.catch(() => {
      if (voci.get(chiave) && voci.get(chiave).valore === valore) voci.delete(chiave);
    });
    if (voci.size > 500) {
      for (const [k, v] of voci) if (v.scade <= adesso) voci.delete(k);
    }
    return valore;
  };
}

module.exports = { conCache };
