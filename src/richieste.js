const db = require('../db');
const { calcolaOrdine, getFinestraMinuti, getFinestraSceltaMinuti, round2 } = require('./pricing');

// ---------- Lettura ----------

async function getRichiesta(id) {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
}

async function righeRichiesta(requestId) {
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

async function risposteRichiesta(requestId) {
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

async function getRisposta(requestId, distributorId) {
  return db
    .prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?')
    .get(requestId, distributorId);
}

// Secondi che mancano alla scadenza della finestra di conferma (0 se gia' scaduta).
async function secondiRimasti(richiesta) {
  const row = await db
    .prepare(`SELECT EXTRACT(EPOCH FROM (?::timestamp - NOW()))::int AS s`)
    .get(richiesta.scade_il);
  return Math.max(0, row ? Number(row.s) : 0);
}

// ---------- Distributori candidati ----------

// Tutti i distributori attivi registrati: ogni richiesta dell'installatore arriva a tutti.
async function distributoriCandidati(productIds, zona, clienteId = null) {
  if (!productIds.length) return [];
  return db
    .prepare(`SELECT * FROM distributors WHERE attivo = 1 ORDER BY nome`)
    .all();
}

// ---------- Creazione ----------

// Crea la richiesta di disponibilita' e manda la notifica ai distributori della zona.
// Da qui parte la finestra di 10 minuti entro cui devono rispondere.
async function creaRichiesta(cliente, righeCarrello) {
  const productIds = righeCarrello.map((r) => r.prodotto.id);
  let candidati = await distributoriCandidati(productIds, cliente.zona, cliente.id);
  const minuti = await getFinestraMinuti();

  // Fallback furbo: se per qualsiasi motivo non c'è nessun candidato (DB vuoto,
  // filtro zona, import incompleto), manda comunque a TUTTI i banchi attivi.
  if (!candidati.length) {
    try {
      candidati = await db.prepare(`SELECT * FROM distributors WHERE attivo = 1 ORDER BY nome`).all();
      console.log(`[richieste] fallback broadcast: ${candidati.length} distributori per cliente ${cliente.id} zona=${cliente.zona}`);
    } catch (e) { console.error('[richieste] fallback fallito', e.message); }
  }

  // Assicura che ogni prodotto della richiesta abbia un listino per ogni distributore
  // candidato: così il calcolo prezzo non sparisce anche se l'import non ha popolato
  // distributor_products. Usa il prezzo del prodotto come base.
  if (candidati.length && productIds.length) {
    try {
      const ins = db.prepare(`INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct) VALUES (?,?,?,?) ON CONFLICT(distributor_id, product_id) DO NOTHING`);
      const ensure = db.transaction(async () => {
        for (const d of candidati) {
          for (const pid of productIds) {
            const rows = await db.prepare(`SELECT prezzo_listino, sconto_base_pct FROM products WHERE id = ?`).get(pid);
            if (!rows) continue;
            await ins.run(d.id, pid, rows.prezzo_listino, rows.sconto_base_pct);
          }
        }
      });
      await ensure();
    } catch (e) { console.error('[richieste] ensure listino fallito', e.message); }
  }

  const crea = db.transaction(async () => {
    const info = await db
      .prepare(
        `INSERT INTO requests (cliente_id, zona, stato, scade_il)
         VALUES (?, ?, ?, NOW() + (? * INTERVAL '1 minute'))`
      )
      .run(cliente.id, cliente.zona, candidati.length ? 'in_attesa' : 'nessuna_offerta', minuti);
    const requestId = Number(info.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO request_items (request_id, product_id, quantita) VALUES (?, ?, ?)`
    );
    for (const { prodotto, quantita } of righeCarrello) await insItem.run(requestId, prodotto.id, quantita);

    const insRisposta = db.prepare(
      `INSERT INTO request_responses (request_id, distributor_id, esito) VALUES (?, ?, 'in_attesa')`
    );
    for (const d of candidati) await insRisposta.run(requestId, d.id);

    return requestId;
  });

  const requestId = await crea();

  const nArticoli = righeCarrello.reduce((acc, r) => acc + r.quantita, 0);
  const { notificaDistributore, notifica } = require('./notifiche');
  for (const d of candidati) {
    await notificaDistributore(d.id, {
      titolo: 'Nuova richiesta di disponibilità',
      testo: `${cliente.ragione_sociale} — ${nArticoli} pz. Hai ${minuti} minuti per confermare.`,
      link: `/distributore/richieste/${requestId}`,
      categoria: 'richieste',
      sottostato: 'inviata',
    });
  }

  if (!candidati.length) {
    await notifica(cliente.id, {
      titolo: 'Nessun distributore in zona',
      testo: 'Nessun rivenditore della tua zona tratta tutti i prodotti richiesti.',
      link: `/richieste/${requestId}`,
    });
  }

  return { requestId, candidati };
}

// Nessuno ha confermato entro la finestra: riapre la STESSA richiesta (stesso id) con una
// finestra fresca, invece di crearne una nuova — resta un unico riferimento nel tempo, utile
// per pagamenti o altro. Riparte verso gli stessi distributori già interpellati la prima volta.
async function reinviaRichiesta(requestId) {
  const richiesta = await getRichiesta(requestId);
  if (!richiesta || richiesta.stato !== 'nessuna_offerta') return null;
  const minuti = await getFinestraMinuti();

  const fai = db.transaction(async () => {
    await db.prepare(
      `UPDATE requests
          SET stato = 'in_attesa', scade_il = NOW() + (? * INTERVAL '1 minute'),
              scelta_scade_il = NULL, assegnata_auto = 0
        WHERE id = ?`
    ).run(minuti, requestId);

    await db.prepare(
      `UPDATE request_responses
          SET esito = 'in_attesa', consegna_ore = NULL, totale = NULL, note = NULL,
              risposto_il = NULL, partenza_ore = NULL, copertura = 'totale',
              sconto_cliente_pct = NULL, consegna_minuti_stimati = NULL
        WHERE request_id = ?`
    ).run(requestId);

    await db.prepare(
      `DELETE FROM request_response_items WHERE response_id IN
        (SELECT id FROM request_responses WHERE request_id = ?)`
    ).run(requestId);
  });
  await fai();

  const righe = await righeRichiesta(requestId);
  const risposte = await risposteRichiesta(requestId);
  const nArticoli = righe.reduce((acc, r) => acc + r.quantita, 0);
  const { notificaDistributore } = require('./notifiche');
  for (const r of risposte) {
    await notificaDistributore(r.distributor_id, {
      titolo: 'Richiesta rinviata',
      testo: `${nArticoli} pz. Hai ${minuti} minuti per confermare.`,
      link: `/distributore/richieste/${requestId}`,
      categoria: 'richieste',
      sottostato: 'inviata',
    });
  }

  return requestId;
}

// ---------- Scadenza ----------

// La non risposta NON e' una disponibilita': allo scadere dei 10 minuti le risposte rimaste
// in attesa diventano 'scaduto' e la richiesta si chiude con le sole conferme arrivate.
async function aggiornaScadenza(requestId) {
  const richiesta = await getRichiesta(requestId);
  if (!richiesta) return null;
  // 'con_offerte' resta aperta fino allo scadere: anche gli altri distributori possono
  // ancora confermare, così il cliente ha più offerte da confrontare.
  if (richiesta.stato !== 'in_attesa' && richiesta.stato !== 'con_offerte') return richiesta;
  if ((await secondiRimasti(richiesta)) > 0) return richiesta;

  const rowInSospeso = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'in_attesa'`
    )
    .get(requestId);
  const inSospeso = rowInSospeso ? Number(rowInSospeso.n) : 0;
  if (richiesta.stato === 'con_offerte' && inSospeso === 0) return richiesta;

  const chiudi = db.transaction(async () => {
    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW()
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(requestId);

    const rowConf = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'confermato'`
      )
      .get(requestId);
    const conferme = rowConf ? Number(rowConf.n) : 0;

    await db.prepare(`UPDATE requests SET stato = ? WHERE id = ?`).run(
      conferme > 0 ? 'con_offerte' : 'nessuna_offerta',
      requestId
    );
    return conferme;
  });

  const conferme = await chiudi();
  // Se il cliente era già stato avvisato delle offerte, non lo avvisiamo una seconda volta.
  if (richiesta.stato === 'con_offerte') return getRichiesta(requestId);
  const { notifica } = require('./notifiche');
  await notifica(richiesta.cliente_id, {
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
async function secondiPerScegliere(richiesta) {
  if (!richiesta || !richiesta.scelta_scade_il) return null;
  const row = await db
    .prepare(`SELECT EXTRACT(EPOCH FROM (?::timestamp - NOW()))::int AS s`)
    .get(richiesta.scelta_scade_il);
  return Math.max(0, row ? Number(row.s) : 0);
}

// Offerta più veloce: vince il tempo di consegna stimato più basso.
async function offertaPiuVeloce(requestId) {
  return db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ? AND rr.esito = 'confermato'
        ORDER BY COALESCE(rr.consegna_minuti_stimati, rr.consegna_ore * 60) ASC, rr.risposto_il ASC
        LIMIT 1`
    )
    .get(requestId);
}

// Passata utile all'avvio e a ogni tanto: chiude tutte le richieste ormai scadute.
async function aggiornaScadenzeAperte() {
  const aperte = await db
    .prepare(
      `SELECT id FROM requests
        WHERE stato IN ('in_attesa', 'con_offerte') AND scade_il <= NOW()`
    )
    .all();
  for (const r of aperte) await aggiornaScadenza(r.id);
  return aperte.length;
}

// Richieste con offerte pronte e finestra di scelta scaduta: si assegnano da sole.
// Restituisce l'elenco delle richieste da chiudere automaticamente, l'ordine vero lo
// crea server.js perché condivide il codice con l'ordine scelto a mano.
async function sceltePerScadenza() {
  return db
    .prepare(
      `SELECT id, cliente_id FROM requests
        WHERE stato = 'con_offerte'
          AND assegnata_auto = 0
          AND scelta_scade_il IS NOT NULL
          AND scelta_scade_il <= NOW()
          AND scade_il <= NOW()`
    )
    .all();
}

// ---------- Risposta del distributore ----------

// `righe` è una mappa { product_id: quantita_disponibile } compilata al banco.
// Da lì si deduce l'esito: tutto coperto = conferma totale, qualcosa in meno = conferma
// parziale, niente disponibile = rifiuto per indisponibilità merce.
async function rispondi(
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
  // Controllo "veloce" solo per uscire prima nel caso comune: non è quello che decide se la
  // risposta viene accettata. La scadenza vera si controlla dentro la UPDATE più sotto,
  // nella stessa transazione — altrimenti un invio arrivato proprio sull'ultimo secondo
  // (il countdown del cliente e quello del server non sono mai perfettamente sincroni, e
  // il job periodico che chiude le richieste scadute gira ogni 30s) può passare il
  // controllo qui e poi scontrarsi con la chiusura della richiesta, lasciando la risposta
  // "confermata" ma la richiesta già segnata come scaduta senza offerte.
  const richiesta = await getRichiesta(requestId);
  if (!richiesta) return { ok: false, errore: 'Richiesta non trovata.' };
  if (richiesta.stato === 'ordinata') {
    return { ok: false, errore: 'Il cliente ha già chiuso l’ordine con un altro distributore.' };
  }
  if (richiesta.stato === 'annullata') {
    return { ok: false, errore: 'Il cliente ha annullato la richiesta.' };
  }

  const risposta = await getRisposta(requestId, distributorId);
  if (!risposta) return { ok: false, errore: 'Richiesta non assegnata a questo distributore.' };
  if (risposta.esito !== 'in_attesa') return { ok: false, errore: 'Hai già risposto a questa richiesta.' };

  // Sconto standard del banco su ogni prodotto: è il riferimento sia per il "prezzo di
  // richiesta" sia per capire se il banco ha applicato una condizione migliore.
  const righeDist = await righeDistributore(requestId, distributorId);
  const standard = new Map(righeDist.map((r) => [r.product_id, r.sconto_standard_pct]));

  function scontoApplicato(productId) {
    if (prezzoRichiesto) return null; // nessuna modifica: resta lo sconto Base del listino
    const grezzo = sconti[productId];
    if (grezzo === undefined || grezzo === null || String(grezzo).trim() === '') return null;
    const n = parseFloat(String(grezzo).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    const pulito = Math.round(Math.min(90, Math.max(0, n)) * 10) / 10;
    return pulito === standard.get(productId) ? null : pulito;
  }

  const richieste_ = await righeRichiesta(requestId);
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
  const consegnaOre = Math.max(partenza, parseInt(consegna_ore, 10) || partenza || 24);

  const profilo =
    scontoCliente === null || String(scontoCliente).trim() === ''
      ? null
      : Math.round(Math.min(90, Math.max(0, parseFloat(String(scontoCliente).replace(',', '.')) || 0)) * 10) / 10;

  const salva = db.transaction(async () => {
    // La condizione di scadenza vive qui, dentro la UPDATE, non in un controllo separato
    // prima: così l'accettazione o il rifiuto di "la finestra è ancora aperta" è atomico
    // insieme alla scrittura, e non può più essere scavalcato da aggiornaScadenza() che
    // gira in parallelo (chiamata da altre pagine, o dal job periodico ogni 30s).
    const upd = await db.prepare(
      `UPDATE request_responses
          SET esito = ?, copertura = ?, partenza_ore = ?, consegna_ore = ?, note = ?,
              sconto_cliente_pct = ?, risposto_il = NOW()
        WHERE id = ? AND esito = 'in_attesa'
          AND request_id IN (SELECT id FROM requests WHERE scade_il > NOW())`
    ).run(
      esito,
      esito === 'confermato' ? copertura : 'totale',
      esito === 'confermato' ? partenza : null,
      esito === 'confermato' ? consegnaOre : null,
      note || null,
      esito === 'confermato' && !prezzoRichiesto ? profilo : null,
      risposta.id
    );
    if (!upd.changes) return false;

    await db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    const ins = db.prepare(
      `INSERT INTO request_response_items
         (response_id, product_id, quantita_richiesta, quantita_disponibile, sconto_riga_pct)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const r of coperture)
      await ins.run(risposta.id, r.product_id, r.quantita_richiesta, r.quantita_disponibile, r.sconto_riga_pct);

    // Sconto concordato con questo cliente: resta in anagrafica e precompila le prossime
    // richieste dello stesso cliente a questo banco.
    if (salvaScontoCliente && profilo !== null && esito === 'confermato') {
      await db.prepare(
        `INSERT INTO client_discounts (distributor_id, cliente_id, sconto_pct, aggiornato_il)
         VALUES (?, ?, ?, NOW())
         ON CONFLICT(distributor_id, cliente_id) DO UPDATE SET
           sconto_pct = excluded.sconto_pct, aggiornato_il = NOW()`
      ).run(distributorId, richiesta.cliente_id, profilo);
    }
    return true;
  });
  const salvata = await salva();
  if (!salvata) {
    // La UPDATE atomica non ha trovato la riga nelle condizioni attese: capiamo il motivo
    // esatto solo per dare un messaggio preciso, la decisione è già presa.
    const fresca = await getRisposta(requestId, distributorId);
    if (fresca && fresca.esito !== 'in_attesa') {
      return { ok: false, errore: 'Hai già risposto a questa richiesta.' };
    }
    return { ok: false, errore: 'La finestra di 10 minuti è chiusa: non è più possibile rispondere.' };
  }

  // Il totale dell'offerta si calcola sulle quantità davvero disponibili.
  if (esito === 'confermato') {
    const { totali } = await calcolaOfferta(requestId, distributorId);
    await db.prepare('UPDATE request_responses SET totale = ? WHERE id = ?').run(
      totali.totale_ivato,
      risposta.id
    );
  }

  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const consegna = require('./consegna');
  const { notifica } = require('./notifiche');

  if (esito === 'confermato') {
    // Il tempo di consegna vero è partenza dichiarata + tragitto fino al cliente.
    const stima = await consegna.minutiStimati(distributorId, richiesta.cliente_id, partenza);
    await db.prepare('UPDATE request_responses SET consegna_minuti_stimati = ? WHERE id = ?').run(
      stima.minuti,
      risposta.id
    );

    // Alla prima conferma la richiesta ha gia' almeno un'offerta valida: parte la
    // finestra di 5 minuti entro cui il cliente sceglie, altrimenti si assegna da sola.
    // Include anche 'nessuna_offerta': con la UPDATE atomica qui sopra è possibile che
    // questa conferma sia arrivata un istante dopo che aggiornaScadenza() (in corsa in
    // parallelo) aveva già chiuso la richiesta senza offerte — la si "riapre" invece di
    // perdere una conferma valida.
    const finestraScelta = await getFinestraSceltaMinuti();
    await db.prepare(
      `UPDATE requests
          SET stato = 'con_offerte',
              scelta_scade_il = NOW() + (? * INTERVAL '1 minute')
        WHERE id = ? AND stato IN ('in_attesa', 'nessuna_offerta')`
    ).run(finestraScelta, requestId);
    const mancanti = coperture.filter((r) => r.quantita_disponibile < r.quantita_richiesta).length;
    await notifica(richiesta.cliente_id, {
      titolo: copertura === 'totale' ? 'Disponibilità confermata' : 'Disponibilità parziale',
      testo:
        copertura === 'totale'
          ? `${distributore.nome} ha confermato tutto il materiale. Vedi tempi e prezzo.`
          : `${distributore.nome} conferma solo una parte del materiale (${mancanti} riga/e ridotta/e). Vedi il dettaglio.`,
      link: `/richieste/${requestId}`,
      categoria: 'richieste',
    });
  } else {
    const rowRest = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'in_attesa'`
      )
      .get(requestId);
    const restano = rowRest ? Number(rowRest.n) : 0;
    const rowConf = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses WHERE request_id = ? AND esito = 'confermato'`
      )
      .get(requestId);
    const conferme = rowConf ? Number(rowConf.n) : 0;
    if (restano === 0 && richiesta.stato === 'in_attesa') {
      await db.prepare(`UPDATE requests SET stato = ? WHERE id = ? AND stato = 'in_attesa'`).run(
        conferme > 0 ? 'con_offerte' : 'nessuna_offerta',
        requestId
      );
      await notifica(richiesta.cliente_id, {
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
async function righeDistributore(requestId, distributorId) {
  const risposta = await getRisposta(requestId, distributorId);
  const richiesta = await db.prepare('SELECT cliente_id FROM requests WHERE id = ?').get(requestId);
  // Sconti concordati in anagrafica con questo cliente (generale, marchio, categoria, famiglia).
  const anagrafiche = require('./anagrafiche');
  const regole = richiesta ? await anagrafiche.regoleSconto(distributorId, richiesta.cliente_id) : [];

  const rows = await db
    .prepare(
      `SELECT ri.product_id, ri.quantita AS quantita_richiesta,
              p.codice, p.nome, p.categoria, p.brand_slug, p.famiglia, p.macro_slug, p.raee,
              COALESCE(dp.prezzo_listino, p.prezzo_listino) AS prezzo_listino,
              COALESCE(dp.sconto_base_pct, p.sconto_base_pct) AS sconto_listino_pct,
              rri.quantita_disponibile, rri.sconto_riga_pct
         FROM request_items ri
         JOIN products p ON p.id = ri.product_id
         LEFT JOIN distributor_products dp
           ON dp.product_id = ri.product_id AND dp.distributor_id = ?
         LEFT JOIN request_response_items rri
           ON rri.product_id = ri.product_id AND rri.response_id = ?
        WHERE ri.request_id = ?
        ORDER BY p.categoria, p.nome`
    )
    .all(distributorId, risposta ? risposta.id : -1, requestId);
  return rows.map((r) => {
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
async function calcolaOfferta(requestId, distributorId, { modalita = 'consegna_mezzo_grossista' } = {}) {
  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const righe = await righeDistributore(requestId, distributorId);

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
  const totali = await calcolaOrdine(carrello, { costoConsegna });
  return { distributore, righe, carrello, mancanti, totali };
}

// Tutte le offerte confermate per una richiesta, ordinate dalla più conveniente.
// Le offerte complete vengono prima di quelle parziali, a parità di convenienza.
async function offerte(requestId, { modalita = 'consegna_mezzo_grossista' } = {}) {
  const conferme = await db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome, d.filiale, d.costo_consegna
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ? AND rr.esito = 'confermato'`
    )
    .all(requestId);

  const withTotals = [];
  for (const c of conferme) {
    const { distributore, totali, mancanti, carrello } = await calcolaOfferta(requestId, c.distributor_id, {
      modalita,
    });
    withTotals.push({
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
    });
  }
  return withTotals.sort((a, b) => {
      if (a.copertura !== b.copertura) return a.copertura === 'totale' ? -1 : 1;
      return a.totali.totale_ivato - b.totali.totale_ivato;
    });
}

// Sconto concordato tra un banco e un cliente (0 se non ce n'è uno in anagrafica).
async function scontoCliente(distributorId, clienteId) {
  const r = await db
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
  reinviaRichiesta,
  aggiornaScadenza,
  aggiornaScadenzeAperte,
  rispondi,
  righeDistributore,
  calcolaOfferta,
  offerte,
  round2,
};
