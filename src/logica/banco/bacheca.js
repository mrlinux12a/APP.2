// La bacheca del banco (la home `GET /distributore`): le tre colonne nell'ordine in cui passa una richiesta, già pronte per la vista views/banco/richieste.ejs.
const db = require('../../../db');
const pricing = require('../pagamenti/pricing');
const orariCorriere = require('../ordini/corriere');
const richieste = require('../ordini/richieste');
const { BACHECA } = require('../../config/bacheca');
const { contatoriBanco, riassuntoArticoli } = require('./banco');

// Prepara le tre colonne della home del banco:
//   daConfermare    richieste arrivate al banco, con la finestra di risposta ancora aperta (la scadenza più vicina per prima)
//   attesaCorriere  richieste confermate dal banco; nel gruppo WhatsApp nessun corriere ha ancora preso la consegna
//   daPreparare     ordini nati (consegna presa, o banco che ha accettato a modulo spento) non ancora ritirati dal corriere (il corriere più vicino per primo)
// Ogni scheda porta il suo `codice` ("ORD-177": il numero della richiesta finché non c'è l'ordine, poi quello dell'ordine, come in tutto il sistema) e il suo
// `lavoro`: la chiave che resta uguale quando la richiesta diventa ordine ("r177", oppure "o1281" per un ordine senza richiesta). Serve al popup "Ispeziona",
// che deve seguire lo stesso lavoro da una colonna all'altra (src/logica/banco/ispeziona.js).
// Più i `contatori` della barra e `finestraSecondi` (la durata della finestra di risposta, per gli anelli dei timer).
// Il banco riceve sempre: non c'è più una pausa della ricezione.
async function bachecaBanco(distributorId) {
  // Niente più sweep completo di tutte le richieste aperte del sistema ad ogni apertura pagina (era una scansione system-wide, non solo di questo
  // distributore): ci pensa già il job periodico ogni 30s, e la singola richiesta si autoaggiorna quando la si apre (vedi GET /distributore/richieste/:id).

  // Letture indipendenti: partono insieme (col DB su un altro server ogni query in sequenza costa ~50 ms).
  const [aperte, ordiniDaPreparare, minutiRisposta, contatori] = await Promise.all([
    // Le due colonne "di richiesta" in una query sola. Le colonne TIMESTAMP (risposto_il) sono ora UTC senza fuso: si confrontano con NOW() in SQL,
    // mai con un Date di JS.
    db
      .prepare(
        `SELECT r.id, u.ragione_sociale AS cliente_nome, rr.esito,
                EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int AS secondi,
                EXTRACT(EPOCH FROM (NOW() - rr.risposto_il))::int AS secondi_da_risposta
           FROM request_responses rr
           JOIN requests r ON r.id = rr.request_id
           JOIN users u ON u.id = r.cliente_id
          WHERE rr.distributor_id = ? AND r.scade_il > NOW()
            AND (rr.esito = 'in_attesa' OR (rr.esito = 'confermato' AND rr.corriere_stato = 'in_attesa'))
          ORDER BY r.id DESC`
      )
      .all(distributorId),
    // Il banco vede solo il tempo scritto dal corriere su WhatsApp: quando arriva da lui (corriere_risposto_il + corriere_minuti, src/logica/ordini/corriere.js;
    // TIMESTAMPTZ, un istante vero). I secondi che mancano si calcolano in SQL.
    // Un ordine segnato consegnato (rotta provvisoria) può restare 'inviato': non è "Da preparare" (come nello Storico) e la sua pagina rimanda allo Storico.
    db
      .prepare(
        `SELECT o.id, o.request_id, o.corriere_nome, o.corriere_minuti, ${orariCorriere.ritiroSql('o')} AS ritiro_il, u.ragione_sociale AS cliente_nome,
                EXTRACT(EPOCH FROM (${orariCorriere.ritiroSql('o')} - NOW()))::int AS secondi_arrivo
           FROM orders o
           JOIN users u ON u.id = o.cliente_id
          WHERE o.distributor_id = ? AND o.stato = 'inviato' AND o.consegnato_il IS NULL
          ORDER BY ${orariCorriere.ritiroSql('o')} ASC NULLS LAST, o.id ASC
          LIMIT 100`
      )
      .all(distributorId),
    pricing.getFinestraMinuti(),
    contatoriBanco(distributorId),
  ]);

  // Gli articoli di tutte le schede si leggono insieme (una query per le richieste, una per gli ordini), non una per scheda.
  const [righePerRichiesta, righeOrdini] = await Promise.all([
    richieste.righeRichieste(aperte.map((r) => r.id)),
    ordiniDaPreparare.length
      ? db
          .prepare(
            `SELECT order_id, codice_snapshot AS codice, nome_snapshot AS nome, quantita
               FROM order_items WHERE order_id = ANY(?::int[]) ORDER BY order_id, id`
          )
          .all(ordiniDaPreparare.map((o) => o.id))
      : [],
  ]);
  const righePerOrdine = new Map();
  for (const ri of righeOrdini) {
    const id = Number(ri.order_id);
    if (!righePerOrdine.has(id)) righePerOrdine.set(id, []);
    righePerOrdine.get(id).push(ri);
  }

  const finestraSecondi = Math.max(1, Math.round(minutiRisposta * 60));

  // La scadenza più vicina in alto: è la richiesta a cui rispondere per prima.
  const daConfermare = aperte
    .filter((r) => r.esito === 'in_attesa')
    .map((r) => {
      const secondi = Math.max(0, Number(r.secondi));
      const trascorsi = Math.max(0, finestraSecondi - secondi);
      return {
        ...r,
        ...riassuntoArticoli(righePerRichiesta.get(Number(r.id)) || []),
        codice: 'ORD-' + r.id,
        lavoro: 'r' + r.id,
        secondi,
        frazione: Math.min(1, secondi / finestraSecondi),
        urgente: secondi <= BACHECA.urgenteSec,
        appena: trascorsi < BACHECA.appenaSec,
      };
    })
    .sort((a, b) => a.secondi - b.secondi || b.id - a.id);

  // In attesa da più tempo per prime: è quella a cui ricordare di più il corriere.
  const attesaCorriere = aperte
    .filter((r) => r.esito === 'confermato')
    .map((r) => ({
      ...r,
      ...riassuntoArticoli(righePerRichiesta.get(Number(r.id)) || []),
      codice: 'ORD-' + r.id,
      lavoro: 'r' + r.id,
      trascorsi: Math.max(0, Number(r.secondi_da_risposta) || 0),
    }))
    .sort((a, b) => b.trascorsi - a.trascorsi);

  // Il corriere che arriva prima in alto, quelli senza corriere in fondo. `arrivo.totale` è il tempo scritto dal corriere (minuti → secondi): la barra
  // della scheda si riempie man mano che il tempo passa. Senza corriere (modulo WhatsApp spento) non c'è un orario d'arrivo da mostrare.
  const daPreparare = ordiniDaPreparare
    .map((o) => {
      const secondi = Number(o.secondi_arrivo);
      return {
        ...o,
        ...riassuntoArticoli(righePerOrdine.get(Number(o.id)) || []),
        codice: 'ORD-' + o.id,
        lavoro: o.request_id ? 'r' + o.request_id : 'o' + o.id,
        arrivo: o.ritiro_il ? { secondi, totale: Math.max(1, Math.round((Number(o.corriere_minuti) || 0) * 60), secondi) } : null,
      };
    })
    .sort((a, b) => (a.arrivo ? a.arrivo.secondi : Infinity) - (b.arrivo ? b.arrivo.secondi : Infinity) || a.id - b.id);

  return { contatori, finestraSecondi, daConfermare, attesaCorriere, daPreparare };
}

module.exports = { bachecaBanco };
