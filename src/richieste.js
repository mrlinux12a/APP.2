const db = require('../db');
const { calcolaOrdine, getFinestraMinuti, round2 } = require('./pricing');
const { notifica, notificaDistributore } = require('./notifiche');

// ---------- Lettura ----------

function getRichiesta(id) {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
}

function righeRichiesta(requestId) {
  return db
    .prepare(
      `SELECT ri.*, p.codice, p.nome, p.categoria
         FROM request_items ri
         JOIN products p ON p.id = ri.product_id
        WHERE ri.request_id = ?
        ORDER BY p.categoria, p.nome`
    )
    .all(requestId);
}

function risposteRichiesta(requestId) {
  return db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome, d.filiale, d.zona, d.costo_consegna
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ?
        ORDER BY d.nome`
    )
    .all(requestId);
}

function getRisposta(requestId, distributorId) {
  return db
    .prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?')
    .get(requestId, distributorId);
}

// Secondi che mancano alla scadenza della finestra di conferma (0 se gia' scaduta).
function secondiRimasti(richiesta) {
  const row = db
    .prepare(`SELECT CAST((julianday(?) - julianday('now')) * 86400 AS INTEGER) AS s`)
    .get(richiesta.scade_il);
  return Math.max(0, row ? row.s : 0);
}

// ---------- Distributori candidati ----------

// Sono i rivenditori attivi della zona che trattano TUTTI i prodotti richiesti:
// solo loro possono confermare l'intera richiesta al banco.
function distributoriCandidati(productIds, zona) {
  if (!productIds.length) return [];
  const placeholders = productIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT d.*
         FROM distributors d
        WHERE d.attivo = 1 AND d.zona = ?
          AND (
            SELECT COUNT(DISTINCT dp.product_id)
              FROM distributor_products dp
             WHERE dp.distributor_id = d.id AND dp.product_id IN (${placeholders})
          ) = ?
        ORDER BY d.nome`
    )
    .all(zona, ...productIds, productIds.length);
}

// ---------- Creazione ----------

// Crea la richiesta di disponibilita' e manda la notifica ai distributori della zona.
// Da qui parte la finestra di 10 minuti entro cui devono rispondere.
function creaRichiesta(cliente, righeCarrello) {
  const productIds = righeCarrello.map((r) => r.prodotto.id);
  const candidati = distributoriCandidati(productIds, cliente.zona);
  const minuti = getFinestraMinuti();

  const crea = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO requests (cliente_id, zona, stato, scade_il)
         VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'))`
      )
      .run(cliente.id, cliente.zona, candidati.length ? 'in_attesa' : 'nessuna_offerta', minuti);
    const requestId = Number(info.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO request_items (request_id, product_id, quantita) VALUES (?, ?, ?)`
    );
    righeCarrello.forEach(({ prodotto, quantita }) => insItem.run(requestId, prodotto.id, quantita));

    const insRisposta = db.prepare(
      `INSERT INTO request_responses (request_id, distributor_id, esito) VALUES (?, ?, 'in_attesa')`
    );
    candidati.forEach((d) => insRisposta.run(requestId, d.id));

    return requestId;
  });

  const requestId = crea();

  const nArticoli = righeCarrello.reduce((acc, r) => acc + r.quantita, 0);
  candidati.forEach((d) =>
    notificaDistributore(d.id, {
      titolo: 'Nuova richiesta di disponibilità',
      testo: `${cliente.ragione_sociale} — ${nArticoli} pz. Hai ${minuti} minuti per confermare.`,
      link: `/distributore/richieste/${requestId}`,
    })
  );

  if (!candidati.length) {
    notifica(cliente.id, {
      titolo: 'Nessun distributore in zona',
      testo: 'Nessun rivenditore della tua zona tratta tutti i prodotti richiesti.',
      link: `/richieste/${requestId}`,
    });
  }

  return { requestId, candidati };
}

// ---------- Scadenza ----------

// La non risposta NON e' una disponibilita': allo scadere dei 10 minuti le risposte rimaste
// in attesa diventano 'scaduto' e la richiesta si chiude con le sole conferme arrivate.
function aggiornaScadenza(requestId) {
  const richiesta = getRichiesta(requestId);
  if (!richiesta) return null;
  // 'con_offerte' resta aperta fino allo scadere: anche gli altri distributori possono
  // ancora confermare, così il cliente ha più offerte da confrontare.
  if (richiesta.stato !== 'in_attesa' && richiesta.stato !== 'con_offerte') return richiesta;
  if (secondiRimasti(richiesta) > 0) return richiesta;

  const inSospeso = db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'in_attesa'`
    )
    .get(requestId).n;
  if (richiesta.stato === 'con_offerte' && inSospeso === 0) return richiesta;

  const chiudi = db.transaction(() => {
    db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = datetime('now')
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(requestId);

    const conferme = db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'confermato'`
      )
      .get(requestId).n;

    db.prepare(`UPDATE requests SET stato = ? WHERE id = ?`).run(
      conferme > 0 ? 'con_offerte' : 'nessuna_offerta',
      requestId
    );
    return conferme;
  });

  const conferme = chiudi();
  // Se il cliente era già stato avvisato delle offerte, non lo avvisiamo una seconda volta.
  if (richiesta.stato === 'con_offerte') return getRichiesta(requestId);
  notifica(richiesta.cliente_id, {
    titolo: conferme > 0 ? 'Offerte disponibili' : 'Nessuna conferma ricevuta',
    testo:
      conferme > 0
        ? `${conferme} distributore/i ha confermato la disponibilità. Scegli con chi ordinare.`
        : 'Nessun distributore ha confermato entro i 10 minuti. Puoi ripetere la richiesta.',
    link: `/richieste/${requestId}`,
  });

  return getRichiesta(requestId);
}

// Passata utile all'avvio e a ogni tanto: chiude tutte le richieste ormai scadute.
function aggiornaScadenzeAperte() {
  const aperte = db
    .prepare(
      `SELECT id FROM requests
        WHERE stato IN ('in_attesa', 'con_offerte') AND scade_il <= datetime('now')`
    )
    .all();
  aperte.forEach((r) => aggiornaScadenza(r.id));
  return aperte.length;
}

// ---------- Risposta del distributore ----------

// `righe` è una mappa { product_id: quantita_disponibile } compilata al banco.
// Da lì si deduce l'esito: tutto coperto = conferma totale, qualcosa in meno = conferma
// parziale, niente disponibile = rifiuto per indisponibilità merce.
function rispondi(requestId, distributorId, { righe = {}, partenza_ore, consegna_ore, note, rifiuta = false }) {
  const richiesta = aggiornaScadenza(requestId);
  if (!richiesta) return { ok: false, errore: 'Richiesta non trovata.' };
  if (richiesta.stato === 'ordinata') {
    return { ok: false, errore: 'Il cliente ha già chiuso l’ordine con un altro distributore.' };
  }
  if (richiesta.stato === 'annullata') {
    return { ok: false, errore: 'Il cliente ha annullato la richiesta.' };
  }
  if (secondiRimasti(richiesta) <= 0) {
    return { ok: false, errore: 'La finestra di 10 minuti è chiusa: non è più possibile rispondere.' };
  }

  const risposta = getRisposta(requestId, distributorId);
  if (!risposta) return { ok: false, errore: 'Richiesta non assegnata a questo distributore.' };
  if (risposta.esito !== 'in_attesa') return { ok: false, errore: 'Hai già risposto a questa richiesta.' };

  const richieste_ = righeRichiesta(requestId);
  const coperture = richieste_.map((r) => {
    const chiesta = r.quantita;
    const disponibile = rifiuta
      ? 0
      : Math.max(0, Math.min(chiesta, parseInt(righe[r.product_id], 10) || 0));
    return { product_id: r.product_id, nome: r.nome, quantita_richiesta: chiesta, quantita_disponibile: disponibile };
  });

  const pezziDisponibili = coperture.reduce((acc, r) => acc + r.quantita_disponibile, 0);
  const tuttoCoperto = coperture.every((r) => r.quantita_disponibile === r.quantita_richiesta);
  const esito = pezziDisponibili === 0 ? 'non_disponibile' : 'confermato';
  const copertura = tuttoCoperto ? 'totale' : 'parziale';

  // Il tempo di consegna non può precedere quello di partenza.
  const partenza = Math.max(0, parseInt(partenza_ore, 10) || 0);
  const consegna = Math.max(partenza, parseInt(consegna_ore, 10) || partenza || 24);

  const salva = db.transaction(() => {
    db.prepare(
      `UPDATE request_responses
          SET esito = ?, copertura = ?, partenza_ore = ?, consegna_ore = ?, note = ?,
              risposto_il = datetime('now')
        WHERE id = ?`
    ).run(
      esito,
      esito === 'confermato' ? copertura : 'totale',
      esito === 'confermato' ? partenza : null,
      esito === 'confermato' ? consegna : null,
      note || null,
      risposta.id
    );

    db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    const ins = db.prepare(
      `INSERT INTO request_response_items (response_id, product_id, quantita_richiesta, quantita_disponibile)
       VALUES (?, ?, ?, ?)`
    );
    coperture.forEach((r) =>
      ins.run(risposta.id, r.product_id, r.quantita_richiesta, r.quantita_disponibile)
    );
  });
  salva();

  // Il totale dell'offerta si calcola sulle quantità davvero disponibili.
  if (esito === 'confermato') {
    const { totali } = calcolaOfferta(requestId, distributorId);
    db.prepare('UPDATE request_responses SET totale = ? WHERE id = ?').run(
      totali.totale_ivato,
      risposta.id
    );
  }

  const distributore = db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);

  if (esito === 'confermato') {
    // Alla prima conferma la richiesta ha gia' almeno un'offerta valida: il cliente puo'
    // scegliere subito, senza aspettare la fine dei 10 minuti.
    db.prepare(`UPDATE requests SET stato = 'con_offerte' WHERE id = ? AND stato = 'in_attesa'`).run(
      requestId
    );
    const mancanti = coperture.filter((r) => r.quantita_disponibile < r.quantita_richiesta).length;
    notifica(richiesta.cliente_id, {
      titolo: copertura === 'totale' ? 'Disponibilità confermata' : 'Disponibilità parziale',
      testo:
        copertura === 'totale'
          ? `${distributore.nome} ha confermato tutto il materiale. Vedi tempi e prezzo.`
          : `${distributore.nome} conferma solo una parte del materiale (${mancanti} riga/e ridotta/e). Vedi il dettaglio.`,
      link: `/richieste/${requestId}`,
    });
  } else {
    const restano = db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'in_attesa'`
      )
      .get(requestId).n;
    const conferme = db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'confermato'`
      )
      .get(requestId).n;
    if (restano === 0 && richiesta.stato === 'in_attesa') {
      db.prepare(`UPDATE requests SET stato = ? WHERE id = ? AND stato = 'in_attesa'`).run(
        conferme > 0 ? 'con_offerte' : 'nessuna_offerta',
        requestId
      );
      notifica(richiesta.cliente_id, {
        titolo: conferme > 0 ? 'Offerte disponibili' : 'Materiale non disponibile',
        testo:
          conferme > 0
            ? 'Tutti i distributori hanno risposto. Scegli con chi ordinare.'
            : 'Nessun distributore della zona ha il materiale disponibile.',
        link: `/richieste/${requestId}`,
      });
    }
  }

  return { ok: true, esito, copertura };
}

// ---------- Offerte ----------

// Righe della richiesta viste con il listino di un distributore. Se il banco ha già
// risposto, la quantità è quella che ha dichiarato disponibile.
function righeDistributore(requestId, distributorId) {
  const risposta = getRisposta(requestId, distributorId);
  return db
    .prepare(
      `SELECT ri.product_id, ri.quantita AS quantita_richiesta,
              p.codice, p.nome, p.categoria,
              dp.prezzo_listino, dp.sconto_base_pct,
              rri.quantita_disponibile
         FROM request_items ri
         JOIN products p ON p.id = ri.product_id
         JOIN distributor_products dp
           ON dp.product_id = ri.product_id AND dp.distributor_id = ?
         LEFT JOIN request_response_items rri
           ON rri.product_id = ri.product_id AND rri.response_id = ?
        WHERE ri.request_id = ?
        ORDER BY p.categoria, p.nome`
    )
    .all(distributorId, risposta ? risposta.id : -1, requestId)
    .map((r) => ({
      ...r,
      quantita: r.quantita_disponibile === null ? r.quantita_richiesta : r.quantita_disponibile,
    }));
}

// Righe e totali della richiesta calcolati sul listino del singolo distributore.
function calcolaOfferta(requestId, distributorId, { modalita = 'consegna_mezzo_grossista' } = {}) {
  const distributore = db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const righe = righeDistributore(requestId, distributorId);

  const carrello = righe
    .filter((r) => r.quantita > 0)
    .map((r) => ({
      prodotto: {
        id: r.product_id,
        codice: r.codice,
        nome: r.nome,
        prezzo_listino: r.prezzo_listino,
        sconto_base_pct: r.sconto_base_pct,
      },
      quantita: r.quantita,
    }));

  const mancanti = righe
    .filter((r) => r.quantita < r.quantita_richiesta)
    .map((r) => ({
      codice: r.codice,
      nome: r.nome,
      quantita_richiesta: r.quantita_richiesta,
      quantita_disponibile: r.quantita,
      mancano: r.quantita_richiesta - r.quantita,
    }));

  const costoConsegna = modalita === 'ritiro' ? 0 : distributore.costo_consegna;
  const totali = calcolaOrdine(carrello, { costoConsegna });
  return { distributore, righe, carrello, mancanti, totali };
}

// Tutte le offerte confermate per una richiesta, ordinate dalla più conveniente.
// Le offerte complete vengono prima di quelle parziali, a parità di convenienza.
function offerte(requestId, { modalita = 'consegna_mezzo_grossista' } = {}) {
  const conferme = db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome, d.filiale, d.costo_consegna
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ? AND rr.esito = 'confermato'`
    )
    .all(requestId);

  return conferme
    .map((c) => {
      const { distributore, totali, mancanti, carrello } = calcolaOfferta(requestId, c.distributor_id, {
        modalita,
      });
      return {
        distributore,
        copertura: c.copertura,
        partenza_ore: c.partenza_ore,
        consegna_ore: c.consegna_ore,
        note: c.note,
        risposto_il: c.risposto_il,
        mancanti,
        n_articoli: carrello.length,
        totali,
      };
    })
    .sort((a, b) => {
      if (a.copertura !== b.copertura) return a.copertura === 'totale' ? -1 : 1;
      return a.totali.totale_ivato - b.totali.totale_ivato;
    });
}

module.exports = {
  getRichiesta,
  righeRichiesta,
  risposteRichiesta,
  getRisposta,
  secondiRimasti,
  distributoriCandidati,
  creaRichiesta,
  aggiornaScadenza,
  aggiornaScadenzeAperte,
  rispondi,
  righeDistributore,
  calcolaOfferta,
  offerte,
  round2,
};
