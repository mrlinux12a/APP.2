const db = require('../db');
const format = require('./format');
const pricing = require('./pricing');

// Avvisi del banco quando non è sulla home (public/app.js, "Avvisi del banco"): pallino su "Banco", striscia arancio sotto l'intestazione,
// notifiche a comparsa in basso a destra. Qui i dati che il browser chiede al server:
//   - GET /distributore/stato-banco: i numeri della striscia e del pallino, più le richieste ancora da confermare (con quanto manca a ognuna);
//   - GET /api/notifiche/push: le notifiche nuove, ognuna con i dati che servono a disegnare il suo avviso (arricchisciPush).
// Sono tutte letture e partono con le richieste in parallelo: ogni query in fila è un giro di rete verso il database.

// Le richieste che il banco deve ancora confermare (finestra aperta, nessuna risposta di questa filiale), la più vicina alla scadenza per prima.
// `ids` limita a quelle richieste (le notifiche nuove). Il tempo che manca si calcola in SQL (NOW()), mai con un Date di JS sulle colonne
// TIMESTAMP: sono ora UTC senza fuso (vedi CLAUDE.md, "Script e file temporanei").
async function richiesteInAttesa(distributorId, ids = null) {
  if (ids && !ids.length) return [];
  const righe = await db
    .prepare(
      `SELECT r.id, u.ragione_sociale AS cliente_nome,
              EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int AS secondi,
              (SELECT COUNT(*) FROM request_items ri WHERE ri.request_id = r.id) AS n_articoli,
              (SELECT COALESCE(SUM(ri.quantita), 0) FROM request_items ri WHERE ri.request_id = r.id) AS n_pezzi
         FROM request_responses rr
         JOIN requests r ON r.id = rr.request_id
         JOIN users u ON u.id = r.cliente_id
        WHERE rr.distributor_id = ? AND rr.esito = 'in_attesa' AND r.scade_il > NOW()
          ${ids ? 'AND r.id = ANY(?::int[])' : ''}
        ORDER BY r.scade_il ASC, r.id ASC`
    )
    .all(...(ids ? [distributorId, ids] : [distributorId]));
  const adesso = Date.now();
  // La finestra intera di risposta (di norma 10 minuti): serve all'anello dell'avviso, che si svuota da pieno a zero.
  const finestraSec = Math.max(1, Math.round((await pricing.getFinestraMinuti()) * 60));
  return righe.map((r) => {
    const secondi = Math.max(0, Number(r.secondi) || 0);
    return {
      id: Number(r.id),
      cliente: r.cliente_nome,
      articoli: Number(r.n_articoli) || 0,
      pezzi: Number(r.n_pezzi) || 0,
      secondi,
      finestraSec,
      // "rispondi entro le 09:38", in ora italiana (la VPS può essere in UTC).
      scadeAlle: format.oraRoma(new Date(adesso + secondi * 1000)),
    };
  });
}

// I numeri della striscia e del pallino. `contatori` sono quelli che il middleware di server.js ha già letto per questa richiesta
// (contatoriBanco): niente query in più per i conteggi. `richieste` serve al browser per tenere allineati gli avvisi "Nuova richiesta":
// una richiesta che non c'è più (risposta di un collega, scaduta, annullata dal cliente) fa sparire il suo avviso. `ordini` sono gli ordini ancora da preparare: un avviso
// "Corriere trovato" che sopravvive a un cambio di pagina sparisce quando il suo ordine è già partito.
async function statoBanco(distributorId, contatori) {
  const [richieste, ordiniDaPreparare] = await Promise.all([
    richiesteInAttesa(distributorId),
    db.prepare(`SELECT id FROM orders WHERE distributor_id = ? AND stato = 'inviato' AND consegnato_il IS NULL ORDER BY id`).all(distributorId),
  ]);
  return {
    daConfermare: Number(contatori.daRispondere) || 0,
    primaScadeSec: richieste.length ? richieste[0].secondi : null,
    attesaCorriere: Number(contatori.inAttesaCorriere) || 0,
    daPreparare: Number(contatori.daPreparare) || 0,
    richieste,
    ordini: ordiniDaPreparare.map((o) => Number(o.id)),
  };
}

// Aggiunge a ogni notifica nuova i dati dell'avviso a comparsa, secondo il suo `tipo`:
//   nuova_richiesta    -> `richiesta` { id, cliente, articoli, pezzi, secondi, scadeAlle }, o null se non è più da confermare
//   corriere_trovato   -> `ordine` { id, corriere, ritiroAlle, daPreparare }
//   ordine_consegnato  -> `ordine` { id, cliente, alle }
// nessun_corriere e richiesta_scaduta bastano col loro request_id. Le notifiche senza tipo passano com'erano (la notifica di sistema).
async function arricchisciPush(distributorId, notifiche) {
  const idsDi = (tipi, campo) => [...new Set(notifiche.filter((n) => tipi.includes(n.tipo) && n[campo]).map((n) => Number(n[campo])))];
  const idRichieste = idsDi(['nuova_richiesta'], 'request_id');
  const idOrdini = idsDi(['corriere_trovato', 'ordine_consegnato'], 'order_id');
  if (!idRichieste.length && !idOrdini.length) return notifiche.map((n) => ({ ...n }));

  const [richieste, ordini] = await Promise.all([
    idRichieste.length ? richiesteInAttesa(distributorId, idRichieste) : [],
    idOrdini.length
      ? db
          .prepare(
            `SELECT o.id, o.stato, o.consegnato_il, o.corriere_nome, o.corriere_arrivo_il, u.ragione_sociale AS cliente_nome
               FROM orders o JOIN users u ON u.id = o.cliente_id
              WHERE o.distributor_id = ? AND o.id = ANY(?::int[])`
          )
          .all(distributorId, idOrdini)
      : [],
  ]);
  const richiestaPer = new Map(richieste.map((r) => [r.id, r]));
  const ordinePer = new Map(ordini.map((o) => [Number(o.id), o]));

  return notifiche.map((n) => {
    const fuori = { ...n };
    if (n.tipo === 'nuova_richiesta') fuori.richiesta = richiestaPer.get(Number(n.request_id)) || null;
    if (n.tipo === 'corriere_trovato' || n.tipo === 'ordine_consegnato') {
      const o = ordinePer.get(Number(n.order_id));
      if (!o) fuori.ordine = null;
      else if (n.tipo === 'corriere_trovato') {
        fuori.ordine = {
          id: Number(o.id),
          corriere: o.corriere_nome || '',
          // corriere_arrivo_il è TIMESTAMPTZ (un istante vero): oraRoma lo scrive in ora italiana.
          ritiroAlle: o.corriere_arrivo_il ? format.oraRoma(o.corriere_arrivo_il) : null,
          // L'ordine può essere già partito (o consegnato) quando l'avviso arriva: allora non c'è più niente da preparare.
          daPreparare: o.stato === 'inviato' && !o.consegnato_il,
        };
      } else {
        fuori.ordine = {
          id: Number(o.id),
          cliente: o.cliente_nome,
          alle: o.consegnato_il ? format.oraSolaRoma(o.consegnato_il) : null,
        };
      }
    }
    return fuori;
  });
}

module.exports = { richiesteInAttesa, statoBanco, arricchisciPush };
