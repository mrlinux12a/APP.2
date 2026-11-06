// Gli avvisi ai corrieri dell'app (solo nell'ambiente «app», vedi docs/ambienti.md): quando un banco accetta e la consegna aspetta un corriere, a quelli
// disponibili e liberi arriva una notifica sul telefono. Non servono righe in `notifications` (sono dell'installatore e del banco): il corriere vede le richieste
// nella sua app, la notifica serve solo a dirgli di aprirla.
const db = require('../../../db');
const push = require('../notifiche/push');
const format = require('../../comune/format');

// I corrieri che possono ricevere una richiesta adesso: attivi, con «Sei disponibile» acceso e senza una consegna già in corso (né presa, né ancora senza ordine).
async function corrieriLiberi() {
  return db
    .prepare(
      `SELECT u.id
         FROM users u
        WHERE u.ruolo = 'corriere' AND u.attivo = 1 AND u.corriere_disponibile = 1
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.corriere_id = u.id AND o.consegnato_il IS NULL)
          AND NOT EXISTS (SELECT 1 FROM request_responses rr JOIN requests rq ON rq.id = rr.request_id
                           WHERE rr.corriere_id = u.id AND rr.corriere_stato = 'preso' AND rq.stato = 'in_attesa')`
    )
    .all();
}

// Avvisa i corrieri liberi che c'è una nuova consegna da prendere (la risposta `responseId` del banco). NON lancia mai: un guasto qui non deve toccare la
// conferma del banco che l'ha generato.
async function avvisaNuovaRichiesta(responseId) {
  try {
    const r = await db
      .prepare(
        `SELECT d.nome, d.filiale
           FROM request_responses rr JOIN distributors d ON d.id = rr.distributor_id
          WHERE rr.id = ?`
      )
      .get(responseId);
    if (!r) return 0;
    const banco = [format.nomeCommerciale(r.nome), r.filiale].filter(Boolean).join(' · ');
    const liberi = await corrieriLiberi();
    const esiti = await Promise.all(
      liberi.map((c) =>
        push.inviaAUtente(c.id, {
          titolo: 'Nuova richiesta di consegna',
          testo: `Ritiro da ${banco}. Apri l'app per ispezionarla e accettarla.`,
          link: '/corriere/richieste/' + responseId,
        })
      )
    );
    return esiti.reduce((tot, n) => tot + (n || 0), 0);
  } catch (err) {
    console.error('[corrieri] avviso della nuova richiesta non inviato:', err.message);
    return 0;
  }
}

module.exports = { avvisaNuovaRichiesta, corrieriLiberi };
