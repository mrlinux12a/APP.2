const db = require('../db');
const { calcolaOrdine, getFinestraMinuti, getFinestraSceltaMinuti, round2 } = require('./pricing');
const consegna = require('./consegna');
const { notifica, notificaDistributore } = require('./notifiche');
const anagrafiche = require('./anagrafiche');

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
function distributoriCandidati(productIds, zona, clienteId = null) {
  if (!productIds.length) return [];
  const placeholders = productIds.map(() => '?').join(',');

  // Se il cliente ha un'anagrafica approvata, la richiesta va solo ai banchi che lo hanno
  // riconosciuto come proprio cliente.
  const soloApprovati = clienteId
    ? `AND EXISTS (
         SELECT 1 FROM client_distributors cd
          WHERE cd.distributor_id = d.id AND cd.cliente_id = ? AND cd.stato = 'approvato'
       )`
    : '';
  const paramsCliente = clienteId ? [clienteId] : [];

  return db
    .prepare(
      `SELECT d.*
         FROM distributors d
        WHERE d.attivo = 1 AND d.zona = ?
          ${soloApprovati}
          AND (
            SELECT COUNT(DISTINCT dp.product_id)
              FROM distributor_products dp
             WHERE dp.distributor_id = d.id AND dp.product_id IN (${placeholders})
          ) = ?
        ORDER BY d.nome`
    )
    .all(zona, ...paramsCliente, ...productIds, productIds.length);
}

// ---------- Creazione ----------

// Crea la richiesta di disponibilita' e manda la notifica ai distributori della zona.
// Da qui parte la finestra di 10 minuti entro cui devono rispondere.
function creaRichiesta(cliente, righeCarrello) {
  const productIds = righeCarrello.map((r) => r.prodotto.id);
  const candidati = distributoriCandidati(productIds, cliente.zona, cliente.id);
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
      categoria: 'richieste',
      sottostato: 'inviata',
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
    categoria: 'richieste',
  });

  return getRichiesta(requestId);
}

// Secondi che restano al cliente per scegliere fra più offerte confermate.
function secondiPerScegliere(richiesta) {
  if (!richiesta || !richiesta.scelta_scade_il) return null;
  const row = db
    .prepare(`SELECT CAST((julianday(?) - julianday('now')) * 86400 AS INTEGER) AS s`)
    .get(richiesta.scelta_scade_il);
  return Math.max(0, row ? row.s : 0);
}

// Offerta più veloce: vince il tempo di consegna stimato più basso.
function offertaPiuVeloce(requestId) {
  return db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ? AND rr.esito = 'confermato'
        ORDER BY IFNULL(rr.consegna_minuti_stimati, rr.consegna_ore * 60) ASC, rr.risposto_il ASC
        LIMIT 1`
    )
    .get(requestId);
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

// Richieste con offerte pronte e finestra di scelta scaduta: si assegnano da sole.
// Restituisce l'elenco delle richieste da chiudere automaticamente, l'ordine vero lo
// crea server.js perché condivide il codice con l'ordine scelto a mano.
function sceltePerScadenza() {
  return db
    .prepare(
      `SELECT id, cliente_id FROM requests
        WHERE stato = 'con_offerte'
          AND assegnata_auto = 0
          AND scelta_scade_il IS NOT NULL
          AND scelta_scade_il <= datetime('now')
          AND scade_il <= datetime('now')`
    )
    .all();
}

// ---------- Risposta del distributore ----------

// `righe` è una mappa { product_id: quantita_disponibile } compilata al banco.
// Da lì si deduce l'esito: tutto coperto = conferma totale, qualcosa in meno = conferma
// parziale, niente disponibile = rifiuto per indisponibilità merce.
function rispondi(
  requestId,
  distributorId,
  {
    righe = {},
    sconti = {},
    partenza_ore,
    consegna_ore,
    note,
    rifiuta = false,
    // "Accetta al prezzo di richiesta": conferma senza toccare gli sconti, il cliente paga
    // esattamente il prezzo che ha visto quando ha fatto la richiesta.
    prezzoRichiesto = false,
    scontoCliente = null,
    salvaScontoCliente = false,
  }
) {
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

  // Sconto standard del banco su ogni prodotto: è il riferimento sia per il "prezzo di
  // richiesta" sia per capire se il banco ha applicato una condizione migliore.
  const standard = new Map(
    righeDistributore(requestId, distributorId).map((r) => [r.product_id, r.sconto_standard_pct])
  );

  function scontoApplicato(productId) {
    if (prezzoRichiesto) return null; // nessuna modifica: resta lo sconto Base del listino
    const grezzo = sconti[productId];
    if (grezzo === undefined || grezzo === null || String(grezzo).trim() === '') return null;
    const n = parseFloat(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const pulito = Math.round(Math.min(90, Math.max(0, n)) * 10) / 10;
    return pulito === standard.get(productId) ? null : pulito;
  }

  const richieste_ = righeRichiesta(requestId);
  const coperture = richieste_.map((r) => {
    const chiesta = r.quantita;
    const disponibile = rifiuta
      ? 0
      : Math.max(0, Math.min(chiesta, parseInt(righe[r.product_id], 10) || 0));
    return {
      product_id: r.product_id,
      nome: r.nome,
      quantita_richiesta: chiesta,
      quantita_disponibile: disponibile,
      sconto_riga_pct: rifiuta ? null : scontoApplicato(r.product_id),
    };
  });

  const pezziDisponibili = coperture.reduce((acc, r) => acc + r.quantita_disponibile, 0);
  const tuttoCoperto = coperture.every((r) => r.quantita_disponibile === r.quantita_richiesta);
  const esito = pezziDisponibili === 0 ? 'non_disponibile' : 'confermato';
  const copertura = tuttoCoperto ? 'totale' : 'parziale';

  // Il tempo di consegna non può precedere quello di partenza.
  const partenza = Math.max(0, parseInt(partenza_ore, 10) || 0);
  const consegna = Math.max(partenza, parseInt(consegna_ore, 10) || partenza || 24);

  const profilo =
    scontoCliente === null || String(scontoCliente).trim() === ''
      ? null
      : Math.round(Math.min(90, Math.max(0, parseFloat(String(scontoCliente).replace(',', '.')) || 0)) * 10) / 10;

  const salva = db.transaction(() => {
    db.prepare(
      `UPDATE request_responses
          SET esito = ?, copertura = ?, partenza_ore = ?, consegna_ore = ?, note = ?,
              sconto_cliente_pct = ?, risposto_il = datetime('now')
        WHERE id = ?`
    ).run(
      esito,
      esito === 'confermato' ? copertura : 'totale',
      esito === 'confermato' ? partenza : null,
      esito === 'confermato' ? consegna : null,
      note || null,
      esito === 'confermato' && !prezzoRichiesto ? profilo : null,
      risposta.id
    );

    db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    const ins = db.prepare(
      `INSERT INTO request_response_items
         (response_id, product_id, quantita_richiesta, quantita_disponibile, sconto_riga_pct)
       VALUES (?, ?, ?, ?, ?)`
    );
    coperture.forEach((r) =>
      ins.run(risposta.id, r.product_id, r.quantita_richiesta, r.quantita_disponibile, r.sconto_riga_pct)
    );

    // Sconto concordato con questo cliente: resta in anagrafica e precompila le prossime
    // richieste dello stesso cliente a questo banco.
    if (salvaScontoCliente && profilo !== null && esito === 'confermato') {
      db.prepare(
        `INSERT INTO client_discounts (distributor_id, cliente_id, sconto_pct, aggiornato_il)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(distributor_id, cliente_id) DO UPDATE SET
           sconto_pct = excluded.sconto_pct, aggiornato_il = datetime('now')`
      ).run(distributorId, richiesta.cliente_id, profilo);
    }
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
    // Il tempo di consegna vero è partenza dichiarata + tragitto fino al cliente.
    const stima = consegna.minutiStimati(distributorId, richiesta.cliente_id, partenza);
    db.prepare('UPDATE request_responses SET consegna_minuti_stimati = ? WHERE id = ?').run(
      stima.minuti,
      risposta.id
    );

    // Alla prima conferma la richiesta ha gia' almeno un'offerta valida: parte la
    // finestra di 5 minuti entro cui il cliente sceglie, altrimenti si assegna da sola.
    db.prepare(
      `UPDATE requests
          SET stato = 'con_offerte',
              scelta_scade_il = datetime('now', '+' || ? || ' minutes')
        WHERE id = ? AND stato = 'in_attesa'`
    ).run(getFinestraSceltaMinuti(), requestId);
    const mancanti = coperture.filter((r) => r.quantita_disponibile < r.quantita_richiesta).length;
    notifica(richiesta.cliente_id, {
      titolo: copertura === 'totale' ? 'Disponibilità confermata' : 'Disponibilità parziale',
      testo:
        copertura === 'totale'
          ? `${distributore.nome} ha confermato tutto il materiale. Vedi tempi e prezzo.`
          : `${distributore.nome} conferma solo una parte del materiale (${mancanti} riga/e ridotta/e). Vedi il dettaglio.`,
      link: `/richieste/${requestId}`,
      categoria: 'richieste',
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
        categoria: 'richieste',
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
  const richiesta = db.prepare('SELECT cliente_id FROM requests WHERE id = ?').get(requestId);
  // Sconti concordati in anagrafica con questo cliente (generale, marchio, categoria, famiglia).
  const regole = richiesta ? anagrafiche.regoleSconto(distributorId, richiesta.cliente_id) : [];

  return db
    .prepare(
      `SELECT ri.product_id, ri.quantita AS quantita_richiesta,
              p.codice, p.nome, p.categoria, p.brand_slug, p.famiglia, p.macro_slug, p.raee,
              dp.prezzo_listino, dp.sconto_base_pct AS sconto_listino_pct,
              rri.quantita_disponibile, rri.sconto_riga_pct
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
    .map((r) => {
      // Ordine di precedenza: sconto deciso ora sulla riga → sconto in anagrafica per
      // famiglia/marchio/categoria → sconto Base del listino del banco.
      const daAnagrafica = anagrafiche.scontoPerProdotto(regole, r);
      const standard = daAnagrafica ? daAnagrafica.pct : r.sconto_listino_pct;
      const applicato = r.sconto_riga_pct === null ? standard : r.sconto_riga_pct;
      return {
        ...r,
        quantita: r.quantita_disponibile === null ? r.quantita_richiesta : r.quantita_disponibile,
        sconto_standard_pct: standard,
        sconto_anagrafica: daAnagrafica ? daAnagrafica.ambito : null,
        sconto_base_pct: applicato,
        sconto_personalizzato: r.sconto_riga_pct !== null && r.sconto_riga_pct !== standard,
      };
    });
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
        raee: r.raee,
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
        consegna_minuti_stimati: c.consegna_minuti_stimati,
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

// Sconto concordato tra un banco e un cliente (0 se non ce n'è uno in anagrafica).
function scontoCliente(distributorId, clienteId) {
  const r = db
    .prepare('SELECT sconto_pct, aggiornato_il FROM client_discounts WHERE distributor_id = ? AND cliente_id = ?')
    .get(distributorId, clienteId);
  return r || null;
}

module.exports = {
  scontoCliente,
  getRichiesta,
  righeRichiesta,
  risposteRichiesta,
  getRisposta,
  secondiRimasti,
  secondiPerScegliere,
  offertaPiuVeloce,
  sceltePerScadenza,
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
