const db = require('../db');
const { calcolaOrdine, getFinestraMinuti, getSpedizioneFissa, round2 } = require('./pricing');
const whatsapp = require('./whatsapp');
const pagamenti = require('./pagamenti');

// Con il corriere via WhatsApp il banco accetta, ma l'offerta esiste per l'installatore solo quando
// nel gruppo qualcuno prende la consegna (corriere_stato 'preso'). NULL = nessun corriere richiesto.
// Da usare nelle query sulle offerte che l'installatore vede (alias rr su request_responses).
const OFFERTA_VISIBILE = `(rr.corriere_stato IS NULL OR rr.corriere_stato = 'preso')`;

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

// Le righe di più richieste con una sola lettura: Map id richiesta -> righe, nello stesso
// ordine di righeRichiesta(). Chi elenca molte richieste (storico) non deve fare una query
// ciascuna: con il DB su un altro server erano oltre 3 secondi per 50 richieste.
async function righeRichieste(requestIds) {
  const perRichiesta = new Map(requestIds.map((id) => [Number(id), []]));
  if (!requestIds.length) return perRichiesta;
  const righe = await db
    .prepare(
      `SELECT ri.*, p.codice, p.nome, p.categoria
         FROM request_items ri
         JOIN products p ON p.id = ri.product_id
        WHERE ri.request_id IN (${requestIds.map(() => '?').join(',')})
        ORDER BY ri.request_id, p.categoria, p.nome`
    )
    .all(...requestIds);
  for (const r of righe) perRichiesta.get(Number(r.request_id)).push(r);
  return perRichiesta;
}

async function risposteRichiesta(requestId) {
  return db
    .prepare(
      `SELECT rr.*, d.nome AS distributore_nome, d.filiale, d.zona, d.costo_consegna, d.ditta_id
         FROM request_responses rr
         JOIN distributors d ON d.id = rr.distributor_id
        WHERE rr.request_id = ?
        ORDER BY d.nome, d.id`
    )
    .all(requestId);
}

// Per l'installatore una ditta è una voce sola, anche se la richiesta è partita verso più
// filiali: vale la risposta "migliore" (confermata, poi in attesa, poi non disponibile, poi
// scaduta) e la filiale non si mostra. Senza ditta (ditta_id vuoto) ogni riga resta a sé.
const PRIORITA_ESITO = { confermato: 0, in_attesa: 1, non_disponibile: 2, scaduto: 3 };

// Per l'installatore un banco che ha accettato ma non ha ancora un corriere non ha risposto: resta
// "in attesa", e se il corriere non arriva in tempo è "nessuna risposta".
function esitoPerInstallatore(r) {
  if (r.esito === 'confermato' && r.corriere_stato === 'in_attesa') return 'in_attesa';
  if (r.esito === 'confermato' && r.corriere_stato === 'scaduto') return 'scaduto';
  return r.esito;
}

function raggruppaRisposteDitta(risposte) {
  const gruppi = new Map();
  for (const r of risposte) {
    const chiave = r.ditta_id ? 'd' + r.ditta_id : 'f' + r.distributor_id;
    const esito = esitoPerInstallatore(r);
    const attuale = gruppi.get(chiave);
    if (!attuale || (PRIORITA_ESITO[esito] ?? 9) < (PRIORITA_ESITO[attuale.esito] ?? 9)) {
      gruppi.set(chiave, { ...r, esito, filiale: '' });
    }
  }
  return [...gruppi.values()];
}

async function getRisposta(requestId, distributorId) {
  return db
    .prepare('SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ?')
    .get(requestId, distributorId);
}

// Un'altra filiale della stessa ditta ha già confermato questa richiesta? (Una ditta con più
// filiali risponde una volta sola: vince la prima che conferma.)
async function altraFilialeHaConfermato(requestId, distributorId, rispostaId) {
  const gia = await db
    .prepare(
      `SELECT 1 AS x
         FROM request_responses o
         JOIN distributors od ON od.id = o.distributor_id
         JOIN distributors md ON md.id = ?
        WHERE o.request_id = ? AND o.esito = 'confermato' AND o.id <> ?
          AND md.ditta_id IS NOT NULL AND od.ditta_id = md.ditta_id
        LIMIT 1`
    )
    .get(distributorId, requestId, rispostaId);
  return !!gia;
}

const ERRORE_ALTRA_FILIALE = 'Un’altra filiale della tua ditta ha già confermato questa richiesta.';

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
    .prepare(`SELECT * FROM distributors WHERE attivo = 1 AND ricezione_attiva = 1 ORDER BY nome`)
    .all();
}

// ---------- Creazione ----------

// Crea la richiesta di disponibilita' e manda la notifica ai distributori della zona.
// Da qui parte la finestra di 10 minuti entro cui devono rispondere.
// `destinazione`, `note` e `importo` (totale IVA inclusa già pagato, vedi pagamenti.js) arrivano dal
// carrello: da qui l'ordine nasce da solo, senza altre scelte dell'installatore.
async function creaRichiesta(cliente, righeCarrello, { destinazione = null, note = '', importo = null } = {}) {
  const productIds = righeCarrello.map((r) => r.prodotto.id);
  let candidati = await distributoriCandidati(productIds, cliente.zona, cliente.id);
  const minuti = await getFinestraMinuti();

  // Fallback furbo: se per qualsiasi motivo non c'è nessun candidato (DB vuoto,
  // filtro zona, import incompleto), manda comunque a TUTTI i banchi attivi.
  if (!candidati.length) {
    try {
      candidati = await db.prepare(`SELECT * FROM distributors WHERE attivo = 1 AND ricezione_attiva = 1 ORDER BY nome`).all();
      console.log(`[richieste] fallback broadcast: ${candidati.length} distributori per cliente ${cliente.id} zona=${cliente.zona}`);
    } catch (e) { console.error('[richieste] fallback fallito', e.message); }
  }

  // Assicura che ogni prodotto della richiesta abbia un listino per ogni distributore
  // candidato: così il calcolo prezzo non sparisce anche se l'import non ha popolato
  // distributor_products. Usa il prezzo del prodotto come base.
  // Prima era un doppio ciclo con una SELECT + INSERT per ogni coppia (distributore,
  // prodotto), eseguite una alla volta dentro una transazione: con 5 distributori e 10
  // articoli in carrello sono 50 andate e ritorno sequenziali verso il DB, e più a lungo
  // resta aperta la transazione più cresce la finestra in cui un'altra transazione
  // concorrente può interferire. Un solo INSERT...SELECT sostituisce tutte le coppie
  // in una query sola.
  if (candidati.length && productIds.length) {
    try {
      await db.prepare(
        `INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct)
         SELECT d.id, p.id, p.prezzo_listino, p.sconto_base_pct
           FROM distributors d
           CROSS JOIN products p
          WHERE d.id = ANY(?::int[]) AND p.id = ANY(?::int[])
         ON CONFLICT (distributor_id, product_id) DO NOTHING`
      ).run(candidati.map((d) => d.id), productIds);
    } catch (e) { console.error('[richieste] ensure listino fallito', e.message); }
  }

  const incasso = importo === null ? null : pagamenti.incassoSimulato(importo);
  const crea = db.transaction(async () => {
    const info = await db
      .prepare(
        `INSERT INTO requests (cliente_id, zona, stato, scade_il, destinazione, note,
                               pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il)
         VALUES (?, ?, ?, NOW() + (? * INTERVAL '1 minute'), ?, ?, ?, ?, ?, ${incasso ? 'NOW()' : 'NULL'})`
      )
      .run(
        cliente.id,
        cliente.zona,
        candidati.length ? 'in_attesa' : 'nessuna_offerta',
        minuti,
        destinazione,
        note || '',
        incasso ? (candidati.length ? incasso.stato : 'rimborsato') : null,
        incasso ? incasso.metodo : null,
        incasso ? incasso.importo : null
      );
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
      testo: `${cliente.ragione_sociale} — ${nArticoli} pz. Hai ${Math.round(minuti)} minuti per confermare.`,
      link: `/distributore/richieste/${requestId}`,
      categoria: 'richieste',
      sottostato: 'inviata',
    });
  }

  if (!candidati.length) {
    await notifica(cliente.id, {
      titolo: 'Nessun distributore disponibile',
      testo:
        'Nessun distributore attivo può ricevere la richiesta in questo momento.' +
        (incasso ? ' Il pagamento è stato rimborsato.' : ''),
      link: `/richieste/${requestId}`,
    });
  }

  return { requestId, candidati };
}

// Nessuno ha confermato (o preso la consegna) entro la finestra: riapre la STESSA richiesta (stesso id)
// con una finestra fresca, invece di crearne una nuova — resta un unico riferimento nel tempo, utile
// per pagamenti o altro. Riparte verso gli stessi distributori già interpellati la prima volta. Il
// pagamento, rimborsato alla chiusura, si addebita di nuovo (vedi pagamenti.incassaDiNuovo).
async function reinviaRichiesta(requestId) {
  const richiesta = await getRichiesta(requestId);
  if (!richiesta || richiesta.stato !== 'nessuna_offerta') return null;
  const minuti = await getFinestraMinuti();

  const fai = db.transaction(async () => {
    await db.prepare(
      `UPDATE requests
          SET stato = 'in_attesa', scade_il = NOW() + (? * INTERVAL '1 minute')
        WHERE id = ?`
    ).run(minuti, requestId);
    await pagamenti.incassaDiNuovo(requestId);

    await db.prepare(
      `UPDATE request_responses
          SET esito = 'in_attesa', consegna_ore = NULL, totale = NULL, note = NULL,
              risposto_il = NULL, partenza_ore = NULL, copertura = 'totale',
              sconto_cliente_pct = NULL, consegna_minuti_stimati = NULL,
              corriere_stato = NULL, corriere_minuti = NULL, corriere_nome = '', corriere_preso_il = NULL
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
      testo: `${nArticoli} pz. Hai ${Math.round(minuti)} minuti per confermare.`,
      link: `/distributore/richieste/${requestId}`,
      categoria: 'richieste',
      sottostato: 'inviata',
    });
  }

  return requestId;
}

// ---------- Scadenza e ordine ----------

// Crea l'ordine a partire da una risposta del banco: lo imposta flusso_cliente.js, che ha la logica
// degli ordini. Riceve la richiesta e la risposta, restituisce l'id dell'ordine o null (la richiesta
// non era più aperta).
let assegnatore = null;
function impostaAssegnatore(fn) {
  assegnatore = fn;
}

// La risposta del banco da cui nasce l'ordine: confermata e già "valida" per l'installatore (senza
// corriere, o con la consegna presa). Con più risposte valide vince chi copre tutto il materiale, poi
// la consegna più veloce, poi la prima arrivata.
async function rispostaPerOrdine(requestId) {
  return db
    .prepare(
      `SELECT rr.*
         FROM request_responses rr
        WHERE rr.request_id = ? AND rr.esito = 'confermato' AND ${OFFERTA_VISIBILE}
        ORDER BY CASE WHEN rr.copertura = 'totale' THEN 0 ELSE 1 END,
                 COALESCE(rr.consegna_minuti_stimati, rr.consegna_ore * 60) ASC, rr.risposto_il ASC
        LIMIT 1`
    )
    .get(requestId);
}

// Se la richiesta è ancora aperta e ha una risposta valida, ne fa l'ordine: l'installatore non sceglie
// più, ha già pagato. Si chiama appena un banco accetta (senza corriere) o un corriere prende la
// consegna, e di nuovo dal timer: se la creazione è fallita (DB irraggiungibile...) si riprova al giro
// dopo, invece di lasciare la richiesta ferma. `rispostaScelta`: la risposta da cui far nascere l'ordine
// (quella del corriere che ha appena preso la consegna); senza, vale la migliore fra le valide.
// Ritorna l'id dell'ordine, o null se non c'era niente da fare.
async function assegnaOrdine(requestId, rispostaScelta = null) {
  if (!assegnatore) return null;
  const richiesta = await getRichiesta(requestId);
  if (!richiesta || richiesta.stato !== 'in_attesa') return null;
  const risposta = rispostaScelta || (await rispostaPerOrdine(requestId));
  if (!risposta) return null;
  return assegnatore(richiesta, risposta);
}

// La richiesta non porta a nessun ordine: si chiude e il pagamento torna all'installatore (se c'era).
// `notificaCliente` { titolo, testo } è facoltativa. false se nel frattempo è cambiata (ordinata, annullata).
async function chiudiSenzaOrdine(richiesta, notificaCliente = null) {
  const chiusa = await db
    .prepare(`UPDATE requests SET stato = 'nessuna_offerta' WHERE id = ? AND stato IN ('in_attesa', 'con_offerte')`)
    .run(richiesta.id);
  if (!chiusa.changes) return false;
  const rimborsato = await pagamenti.rimborsa(richiesta.id);
  if (notificaCliente) {
    const { notifica } = require('./notifiche');
    await notifica(richiesta.cliente_id, {
      titolo: notificaCliente.titolo,
      testo: notificaCliente.testo + (rimborsato ? ' Il pagamento è stato rimborsato.' : ''),
      link: `/richieste/${richiesta.id}`,
      categoria: 'richieste',
    });
  }
  return true;
}

// Porta avanti una richiesta aperta: allo scadere della finestra chiude quella rimasta senza ordine.
// Si chiama a ogni lettura della richiesta, non solo dal timer.
async function aggiornaScadenza(requestId) {
  const richiesta = await getRichiesta(requestId);
  if (!richiesta) return null;
  if (richiesta.stato === 'con_offerte') {
    // Lasciata così dal vecchio flusso, in cui l'installatore sceglieva fra le offerte: ora non c'è
    // più niente da scegliere (e l'ordine nasce da solo), quindi si chiude.
    return (await chiudiSenzaOrdine(richiesta)) ? getRichiesta(requestId) : richiesta;
  }
  if (richiesta.stato !== 'in_attesa') return richiesta;
  return (await chiudiFinestraRisposte(richiesta)) ? getRichiesta(requestId) : richiesta;
}

// La non risposta NON e' una disponibilita': allo scadere della finestra le risposte rimaste in
// attesa diventano 'scaduto'. Se nessun banco ha accettato, o nessun corriere ha preso la consegna,
// la richiesta si chiude senza ordine e il pagamento torna all'installatore.
async function chiudiFinestraRisposte(richiesta) {
  const requestId = richiesta.id;
  if ((await secondiRimasti(richiesta)) > 0) return false;

  const chiudi = db.transaction(async () => {
    // Prima la richiesta, in UPDATE atomica come il resto: una risposta già valida (un corriere ha
    // scritto "preso" un istante prima, o il banco ha accettato senza corriere) sta per diventare un
    // ordine e vince, quindi la richiesta non si chiude (la creazione si riprova dal timer).
    const chiusa = await db.prepare(
      `UPDATE requests SET stato = 'nessuna_offerta'
        WHERE id = ? AND stato = 'in_attesa'
          AND NOT EXISTS (SELECT 1 FROM request_responses rr
                           WHERE rr.request_id = requests.id AND rr.esito = 'confermato' AND ${OFFERTA_VISIBILE})`
    ).run(requestId);
    if (!chiusa.changes) return null;

    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW()
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(requestId);
    // Il timer è finito e nessun corriere ha risposto: per l'installatore è come se il banco non
    // avesse accettato.
    const corrieri = await db.prepare(
      `UPDATE request_responses SET corriere_stato = 'scaduto'
        WHERE request_id = ? AND corriere_stato = 'in_attesa'`
    ).run(requestId);
    const rimborsato = await pagamenti.rimborsa(requestId);
    return { corrieriScaduti: corrieri.changes, rimborsato };
  });

  const esito = await chiudi();
  if (!esito) return false;
  // Il messaggio nel gruppo sparisce, così nessuno può più rispondere "preso".
  if (esito.corrieriScaduti) {
    await whatsapp.ritiraRichiesta(requestId).catch((err) => console.error('[richieste] WhatsApp, ritiro messaggio:', err.message));
  }
  const minuti = await getFinestraMinuti();
  const { notifica } = require('./notifiche');
  await notifica(richiesta.cliente_id, {
    titolo: 'Nessuna conferma ricevuta',
    testo:
      `Nessun distributore ha confermato entro i ${Math.round(minuti)} minuti.` +
      (esito.rimborsato ? ' Il pagamento è stato rimborsato.' : '') +
      ' Puoi ripetere la richiesta.',
    link: `/richieste/${requestId}`,
    categoria: 'richieste',
  });
  return true;
}

// Un corriere ha preso la consegna nel gruppo WhatsApp: la risposta del banco diventa valida e
// l'ordine nasce subito, con il tempo scritto dal corriere come tempo di consegna. Vale solo finché la
// finestra della richiesta è aperta (la condizione è dentro la UPDATE, atomica come in rispondi).
// Esiti:
//   { esito: 'preso' }              l'ordine è partito (o parte al prossimo giro del timer)
//   { esito: 'gia_preso', nome }    un altro l'aveva già presa
//   { esito: 'scaduta' }            finestra chiusa, richiesta annullata o messaggio ritirato
async function corriereHaPreso(responseId, minuti, nome) {
  const preso = await db
    .prepare(
      `UPDATE request_responses
          SET corriere_stato = 'preso', corriere_minuti = ?, corriere_nome = ?, corriere_preso_il = NOW(),
              consegna_minuti_stimati = ?
        WHERE id = ? AND esito = 'confermato' AND corriere_stato = 'in_attesa'
          AND request_id IN (SELECT id FROM requests WHERE scade_il > NOW() AND stato = 'in_attesa')`
    )
    .run(minuti, nome || '', minuti, responseId);

  const risposta = await db.prepare('SELECT * FROM request_responses WHERE id = ?').get(responseId);
  if (!preso.changes) {
    if (risposta && risposta.corriere_stato === 'preso') return { esito: 'gia_preso', nome: risposta.corriere_nome };
    return { esito: 'scaduta' };
  }

  let ordineId;
  try {
    ordineId = await assegnaOrdine(risposta.request_id, risposta);
  } catch (err) {
    // Il corriere ha già la sua conferma: l'ordine si ricrea dal timer (aggiornaScadenzeAperte).
    console.error(`[richieste] ordine non creato per la richiesta ${risposta.request_id}:`, err.message);
    return { esito: 'preso' };
  }
  if (ordineId === null) {
    // La richiesta si è chiusa (annullata, ordinata altrove) un istante dopo: la consegna non serve più.
    await db
      .prepare(`UPDATE request_responses SET corriere_stato = 'scaduto' WHERE id = ? AND corriere_stato = 'preso'`)
      .run(responseId);
    return { esito: 'scaduta' };
  }
  return { esito: 'preso', ordineId };
}

// Passata utile all'avvio e a ogni tanto: chiude le finestre scadute e riprova gli ordini rimasti a
// metà (una risposta valida senza ordine).
async function aggiornaScadenzeAperte() {
  const aperte = await db
    .prepare(
      `SELECT r.id FROM requests r
        WHERE r.stato IN ('in_attesa', 'con_offerte')
          AND (r.scade_il <= NOW() OR r.stato = 'con_offerte'
               OR EXISTS (SELECT 1 FROM request_responses rr
                           WHERE rr.request_id = r.id AND rr.esito = 'confermato' AND ${OFFERTA_VISIBILE}))`
    )
    .all();
  for (const r of aperte) {
    await assegnaOrdine(r.id).catch((err) => console.error(`[richieste] ordine non creato per la richiesta ${r.id}:`, err.message));
    await aggiornaScadenza(r.id);
  }
  return aperte.length;
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
    // Il dipendente che risponde (per sapere chi, dentro la filiale, ha accettato).
    utenteId = null,
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
  if (risposta.esito !== 'in_attesa') {
    // Chiusa perché un'altra filiale della ditta ha confermato: non è che questa abbia già risposto.
    if (risposta.esito === 'scaduto' && (await altraFilialeHaConfermato(requestId, distributorId, risposta.id))) {
      return { ok: false, errore: ERRORE_ALTRA_FILIALE };
    }
    return { ok: false, errore: 'Hai già risposto a questa richiesta.' };
  }

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
    // "Accetta ordine" (prezzoRichiesto) copre sempre tutto il richiesto: non c'è più un
    // modulo con cui il banco dichiara una disponibilità parziale riga per riga.
    const disponibile = rifiuta
      ? 0
      : prezzoRichiesto
      ? chiesta
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
  // Con il gruppo WhatsApp acceso la conferma aspetta un corriere prima di arrivare all'installatore.
  const attesaCorriere = esito === 'confermato' && whatsapp.attivo();

  // Il tempo di consegna non può precedere quello di partenza.
  const partenza = Math.max(0, parseInt(partenza_ore, 10) || 0);
  const consegnaOre = Math.max(partenza, parseInt(consegna_ore, 10) || partenza || 24);

  const profilo =
    scontoCliente === null || String(scontoCliente).trim() === ''
      ? null
      : Math.round(Math.min(90, Math.max(0, parseFloat(String(scontoCliente).replace(',', '.')) || 0)) * 10) / 10;

  const salva = db.transaction(async () => {
    // Le risposte della stessa richiesta si mettono in fila: "vince la prima filiale della
    // ditta" vale anche se due dipendenti premono nello stesso istante (senza il blocco,
    // entrambe vedrebbero "nessuno ha ancora confermato" e confermerebbero tutte e due).
    await db.prepare('SELECT id FROM requests WHERE id = ? FOR UPDATE').get(requestId);

    // Una ditta con più filiali risponde una volta sola: la prima che conferma tiene la
    // richiesta (e da lì parte l'ordine), le altre filiali della stessa ditta si chiudono.
    if (esito === 'confermato' && (await altraFilialeHaConfermato(requestId, distributorId, risposta.id))) {
      return 'altra_filiale';
    }

    // La condizione di scadenza vive qui, dentro la UPDATE, non in un controllo separato
    // prima: così l'accettazione o il rifiuto di "la finestra è ancora aperta" è atomico
    // insieme alla scrittura, e non può più essere scavalcato da aggiornaScadenza() che
    // gira in parallelo (chiamata da altre pagine, o dal job periodico ogni 30s).
    const upd = await db.prepare(
      `UPDATE request_responses
          SET esito = ?, copertura = ?, partenza_ore = ?, consegna_ore = ?, note = ?,
              sconto_cliente_pct = ?, risposto_il = NOW(), risposto_da = ?, corriere_stato = ?
        WHERE id = ? AND esito = 'in_attesa'
          AND request_id IN (SELECT id FROM requests WHERE scade_il > NOW())`
    ).run(
      esito,
      esito === 'confermato' ? copertura : 'totale',
      esito === 'confermato' ? partenza : null,
      esito === 'confermato' ? consegnaOre : null,
      note || null,
      esito === 'confermato' && !prezzoRichiesto ? profilo : null,
      utenteId,
      attesaCorriere ? 'in_attesa' : null,
      risposta.id
    );
    if (!upd.changes) return false;

    if (esito === 'confermato') {
      await db.prepare(
        `UPDATE request_responses
            SET esito = 'scaduto', risposto_il = NOW()
          WHERE request_id = ? AND esito = 'in_attesa' AND id <> ?
            AND distributor_id IN (SELECT id FROM distributors
                                    WHERE ditta_id IS NOT NULL
                                      AND ditta_id = (SELECT ditta_id FROM distributors WHERE id = ?))`
      ).run(requestId, risposta.id, distributorId);
    }

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
  if (salvata === 'altra_filiale') return { ok: false, errore: ERRORE_ALTRA_FILIALE };
  if (!salvata) {
    // La UPDATE atomica non ha trovato la riga nelle condizioni attese: capiamo il motivo
    // esatto solo per dare un messaggio preciso, la decisione è già presa.
    const fresca = await getRisposta(requestId, distributorId);
    if (fresca && fresca.esito !== 'in_attesa') {
      return { ok: false, errore: 'Hai già risposto a questa richiesta.' };
    }
    const minuti = await getFinestraMinuti();
    return { ok: false, errore: `La finestra di ${Math.round(minuti)} minuti è chiusa: non è più possibile rispondere.` };
  }

  // Il totale dell'offerta si calcola sulle quantità davvero disponibili.
  if (esito === 'confermato') {
    const { totali } = await calcolaOfferta(requestId, distributorId);
    await db.prepare('UPDATE request_responses SET totale = ? WHERE id = ?').run(
      totali.totale_ivato,
      risposta.id
    );
  }

  const consegna = require('./consegna');

  if (esito === 'confermato') {
    // Il tempo di consegna vero è partenza dichiarata + tragitto fino al cliente.
    const stima = await consegna.minutiStimati(distributorId, richiesta.cliente_id, partenza);
    await db.prepare('UPDATE request_responses SET consegna_minuti_stimati = ? WHERE id = ?').run(
      stima.minuti,
      risposta.id
    );

    // Con il corriere l'installatore non sa ancora niente: nessun ordine e nessuna notifica finché
    // nel gruppo qualcuno non scrive "preso <minuti>" (corriereHaPreso). Se la finestra scade prima,
    // la risposta si ritira da sola e il pagamento torna all'installatore.
    if (attesaCorriere) {
      try {
        await whatsapp.accodaRitiroConsegna(requestId, risposta.id);
      } catch (err) {
        console.error(`[richieste] WhatsApp: messaggio non accodato per la richiesta ${requestId}:`, err.message);
      }
      return { ok: true, esito, copertura, attesaCorriere: true };
    }

    // Senza corriere (modulo spento) la risposta del banco è già valida: l'installatore ha pagato e
    // non sceglie più, quindi l'ordine nasce subito. Se la creazione fallisce si riprova dal timer.
    let ordineId = null;
    try {
      ordineId = await assegnaOrdine(requestId);
    } catch (err) {
      console.error(`[richieste] ordine non creato per la richiesta ${requestId}:`, err.message);
    }
    return { ok: true, esito, copertura, ordineId };
  } else {
    // Chi ha accettato e aspetta un corriere non ha ancora "risposto" per l'installatore: la
    // richiesta non si chiude finché non si sa come va a finire.
    const rowRest = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses
          WHERE request_id = ? AND (esito = 'in_attesa' OR corriere_stato = 'in_attesa')`
      )
      .get(requestId);
    const restano = rowRest ? Number(rowRest.n) : 0;
    const rowConf = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM request_responses rr
          WHERE rr.request_id = ? AND rr.esito = 'confermato' AND ${OFFERTA_VISIBILE}`
      )
      .get(requestId);
    const conferme = rowConf ? Number(rowConf.n) : 0;
    // Hanno risposto tutti e nessuno ha accettato: la richiesta si chiude subito (se c'è una risposta
    // valida l'ordine è già nato o nasce dal timer, quindi non si chiude).
    if (restano === 0 && conferme === 0 && richiesta.stato === 'in_attesa') {
      await chiudiSenzaOrdine(richiesta, {
        titolo: 'Materiale non disponibile',
        testo: 'Nessun distributore ha il materiale disponibile.',
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

// Righe e totali della richiesta calcolati sul listino del singolo distributore. La consegna c'è
// sempre (con il corriere): il ritiro al banco non esiste più.
async function calcolaOfferta(requestId, distributorId) {
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

  // La consegna è la spedizione fissa che l'installatore ha già pagato con la richiesta (la stessa cifra del
  // carrello), non il costo del singolo banco: al momento di pagare non sapeva quale banco avrebbe accettato.
  // Così il totale dell'ordine coincide con il pagamento (prima, con `distributors.costo_consegna` a 0, l'ordine
  // diceva "consegna inclusa" e il totale restava di 12,20 € sotto a quanto pagato).
  const totali = await calcolaOrdine(carrello, { costoConsegna: await getSpedizioneFissa() });
  return { distributore, righe, carrello, mancanti, totali };
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
  righeRichieste,
  risposteRichiesta,
  raggruppaRisposteDitta,
  getRisposta,
  secondiRimasti,
  impostaAssegnatore,
  assegnaOrdine,
  distributoriCandidati,
  creaRichiesta,
  reinviaRichiesta,
  aggiornaScadenza,
  aggiornaScadenzeAperte,
  rispondi,
  corriereHaPreso,
  righeDistributore,
  calcolaOfferta,
  round2,
};
