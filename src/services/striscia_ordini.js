// La striscia di schede in cima alle pagine di dettaglio del cliente (richiesta in attesa, richiesta chiusa, ordine).
const flusso = require('../flusso_cliente');

// Prepara la striscia di schede in cima a una pagina di dettaglio del cliente (partials/striscia_ordini.ejs): solo se le voci di "Stato ordini" sono due
// o più E la pagina aperta è una di loro (`voce` = "richiesta-12" o "ordine-7"); altrimenti null (per esempio un ordine consegnato aperto dallo storico).
// Le voci sono quelle già lette dal middleware per l'icona in basso, così icona e striscia dicono la stessa cosa; qui si aggiunge solo il materiale
// (una lettura per tutte).
async function strisciaPer(req, res, voce) {
  const so = res.locals.statoOrdini;
  const voci = so && Array.isArray(so.voci) ? so.voci : [];
  if (!req.session.user || req.session.user.ruolo !== 'cliente' || voci.length < 2) return null;
  if (!voci.some((v) => v.voce === voce)) return null;
  return { voci: await flusso.conBreve(voci), attiva: voce, firma: so.firma || flusso.firmaVoci(voci) };
}

module.exports = { strisciaPer };
