// Flusso dell'installatore: richiesta pagata -> banco accetta -> corriere prende la consegna -> ordine.
// L'installatore paga e manda la richiesta, poi non decide più niente: l'ordine nasce da solo.
// Prima stava dentro le route di server.js; spostato qui perché lo usano sia le pagine del
// sito sia l'API dell'app (src/api_v1.js), che devono seguire esattamente le stesse regole.
// Qui solo la logica: come rispondere (pagina, redirect o JSON) lo decide chi chiama.
const db = require('../db');
const pricing = require('./pricing');
const richieste = require('./richieste');
const notifiche = require('./notifiche');
const ddt = require('./ddt');
const whatsapp = require('./whatsapp');
const pagamenti = require('./pagamenti');
const consegna = require('./consegna');
const format = require('./format');
const { QUANTITA_MASSIMA, leggiId, leggiQuantita } = require('./input');

// Errore "previsto" del flusso (ordine minimo, richiesta già aperta...): il chiamante lo
// mostra così com'è. codice serve a chi deve decidere dove mandare l'utente.
class ErroreFlusso extends Error {
  constructor(codice, titolo, messaggio, extra = {}) {
    super(messaggio);
    this.codice = codice;
    this.titolo = titolo;
    Object.assign(this, extra);
  }
}

// ---------- Invio della richiesta ----------

// Un solo processo di richiesta alla volta: non se ne può inviare una nuova finché una
// precedente dello stesso cliente è ancora in attesa di risposta. Un ordine già confermato
// (in consegna) invece non blocca: la nuova richiesta prende il suo posto in "Stato ordini".
// Ritorna la richiesta bloccante (aggiornata) se ce n'è una, altrimenti null. 'con_offerte' è
// lo stato del vecchio flusso: aggiornaScadenza la chiude.
async function richiestaBloccante(clienteId) {
  const aperta = await db
    .prepare(
      `SELECT id FROM requests WHERE cliente_id = ? AND stato IN ('in_attesa','con_offerte') ORDER BY id DESC LIMIT 1`
    )
    .get(clienteId);
  if (!aperta) return null;
  const aggiornata = await richieste.aggiornaScadenza(aperta.id);
  if (aggiornata && (aggiornata.stato === 'in_attesa' || aggiornata.stato === 'con_offerte')) return aggiornata;
  return null;
}

// Righe [{prodotto, quantita}] a partire da coppie {id, quantita} (il carrello dell'app,
// che vive sul telefono): prodotti riletti dal DB, solo quelli ancora attivi.
async function righeDaQuantita(voci) {
  const quantita = new Map();
  // `voci` viene dal corpo JSON della richiesta: se non è un elenco si tratta come vuoto.
  for (const v of Array.isArray(voci) ? voci : []) {
    const id = leggiId(v && v.id);
    const q = leggiQuantita(v && v.quantita);
    if (id && q > 0) quantita.set(id, Math.min(QUANTITA_MASSIMA, (quantita.get(id) || 0) + q));
  }
  if (!quantita.size) return [];
  const ids = [...quantita.keys()];
  const prodotti = await db
    .prepare(
      `SELECT * FROM products WHERE attivo = 1 AND id IN (${ids.map(() => '?').join(',')})
        ORDER BY macro_slug, categoria, nome`
    )
    .all(...ids);
  return prodotti.map((prodotto) => ({ prodotto, quantita: quantita.get(prodotto.id) }));
}

// Totali del carrello come li mostra la pagina Carrello del sito (merce, RAEE, spedizione, IVA,
// totale da pagare, ordine minimo). `totali` include la spedizione: totale_ivato è quello che
// l'installatore paga.
async function riepilogoCarrello(righe) {
  const spedizione = await pricing.getSpedizioneFissa();
  const totali = await pricing.calcolaOrdine(righe, { costoConsegna: spedizione });
  const minimo = await pricing.getOrdineMinimo();
  return {
    totali,
    minimo,
    spedizione,
    ivaPct: await pricing.getIvaPct(),
    // La soglia si misura sulla sola merce: la spedizione si somma dopo.
    mancaAlMinimo: pricing.round2(Math.max(0, minimo - totali.totale_finale)),
    raggiunto: totali.totale_finale >= minimo,
    minutiRisposta: await pricing.getFinestraMinuti(),
  };
}

// Paga e invia la richiesta ai distributori. Ritorna l'id creato. `destinazione` e `note` sono quelle
// del carrello (la destinazione, se vuota, è l'indirizzo di consegna abituale del cliente): da qui
// l'ordine nasce da solo, senza altre scelte. Il pagamento è simulato (vedi pagamenti.js) e vale il
// totale IVA inclusa che il carrello ha mostrato.
async function nuovaRichiesta(clienteId, righe, { destinazione = '', note = '' } = {}) {
  // L'ordine minimo si misura sulla merce già maggiorata, spedizione esclusa.
  const totali = await pricing.calcolaOrdine(righe, { costoConsegna: await pricing.getSpedizioneFissa() });
  const minimo = await pricing.getOrdineMinimo();
  if (righe.length && totali.totale_finale < minimo) {
    throw new ErroreFlusso(
      'ordine_minimo',
      'Ordine minimo non raggiunto',
      `L'ordine minimo è di € ${pricing.euro(minimo)} di merce (IVA esclusa). Ti mancano € ${pricing.euro(minimo - totali.totale_finale)}.`
    );
  }
  if (!righe.length) {
    throw new ErroreFlusso('vuota', 'Nessun materiale', 'Seleziona almeno un prodotto prima di procedere.');
  }

  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);

  const bloccante = await richiestaBloccante(cliente.id);
  if (bloccante) {
    throw new ErroreFlusso(
      'in_corso',
      'Richiesta già in corso',
      "Hai già una richiesta in attesa di risposta: aspetta che si chiuda prima di inviarne un'altra.",
      { requestId: bloccante.id }
    );
  }

  try {
    const { requestId } = await richieste.creaRichiesta(cliente, righe, {
      destinazione: String(destinazione || '').trim().slice(0, 300) || cliente.indirizzo_consegna || ddt.indirizzoCompleto(cliente),
      note: String(note || '').trim().slice(0, 500),
      importo: totali.totale_ivato,
    });
    return requestId;
  } catch (e) {
    // 23505 = violazione del vincolo unico che ammette una sola richiesta aperta per
    // cliente (vedi schema.sql, idx_requests_cliente_aperta): un doppio tap sullo stesso
    // invio può far passare entrambe le chiamate oltre il controllo di richiestaBloccante
    // qui sopra (è una lettura-poi-scrittura, non atomica) prima che la seconda arrivi
    // all'INSERT — a quel punto è il DB stesso a fermarla. Si porta comunque il cliente
    // sulla richiesta che è realmente stata creata, invece di un errore 500.
    if (e && e.code === '23505') {
      const bloccante2 = await richiestaBloccante(cliente.id);
      if (bloccante2) return bloccante2.id;
    }
    throw e;
  }
}

// ---------- Richiesta: lettura, annullamento, reinvio, eliminazione ----------

// L'installatore vede solo la ditta (es. "Borea"): la filiale che risponde e da cui parte
// l'ordine conta per i banchi, non per lui. Copia di una riga `distributors` senza filiale.
function senzaFiliale(distributore) {
  return distributore ? { ...distributore, filiale: '' } : distributore;
}

// Tutto quello che serve per mostrare una richiesta (attesa, chiusa senza ordine, annullata). Segna
// anche come lette le notifiche di richieste/ordini: il cliente sta guardando proprio questa. Il
// pagamento (pagamento_stato, pagamento_importo...) sta sulla riga `richiesta`.
async function dettaglioRichiesta(richiesta) {
  await notifiche.segnaLetteCategoria(richiesta.cliente_id, 'richieste');
  await notifiche.segnaLetteCategoria(richiesta.cliente_id, 'ordini');

  return {
    richiesta,
    righe: await richieste.righeRichiesta(richiesta.id),
    // Una ditta con più filiali è una voce sola.
    risposte: richieste.raggruppaRisposteDitta(await richieste.risposteRichiesta(richiesta.id)),
    secondi: await richieste.secondiRimasti(richiesta),
    minutiRisposta: await pricing.getFinestraMinuti(),
  };
}

// Ritorna false se la richiesta non era più annullabile (es. l'ordine è nato un istante prima).
async function annullaRichiesta(requestId) {
  // Condizione dentro la UPDATE: se l'ordine è nato un istante prima, l'annullamento non deve
  // sovrascrivere 'ordinata' lasciando un ordine vivo su una richiesta che il cliente crede annullata.
  const upd = await db
    .prepare(`UPDATE requests SET stato = 'annullata' WHERE id = ? AND stato IN ('in_attesa', 'con_offerte', 'nessuna_offerta')`)
    .run(requestId);
  if (!upd.changes) return false;
  // Il pagamento torna all'installatore (se era già stato rimborsato perché la richiesta era chiusa
  // senza ordine, non succede niente).
  await pagamenti.rimborsa(requestId);
  // Chiude anche le risposte ancora "in attesa" dal lato banco: altrimenti la
  // richiesta annullata dal cliente resta a intasare la dashboard dei distributori
  // come se ci fosse ancora qualcosa da confermare.
  await db.prepare(
    `UPDATE request_responses SET esito = 'scaduto' WHERE request_id = ? AND esito = 'in_attesa'`
  ).run(requestId);
  await db.prepare(
    `UPDATE request_responses SET corriere_stato = 'scaduto' WHERE request_id = ? AND corriere_stato = 'in_attesa'`
  ).run(requestId);
  // Nel gruppo WhatsApp il messaggio sparisce (o, se un corriere l'aveva già preso, gli si scrive
  // che la richiesta è annullata).
  await whatsapp
    .ritiraRichiesta(requestId, { motivo: 'il cliente ha annullato la richiesta' })
    .catch((err) => console.error('WhatsApp, ritiro messaggio:', err.message));
  return true;
}

// Nessuno ha confermato entro la finestra: riapre la STESSA richiesta (stesso id, per
// distributori e installatore) con una finestra fresca, invece di crearne una nuova — così
// resta un riferimento unico nel tempo, utile per pagamenti o altro.
// Ritorna l'id della richiesta da mostrare (quella riaperta, o quella che blocca).
async function reinviaRichiesta(richiesta) {
  if (richiesta.stato !== 'nessuna_offerta') return richiesta.id;
  const bloccante = await richiestaBloccante(richiesta.cliente_id);
  if (bloccante) return bloccante.id;
  await richieste.reinviaRichiesta(richiesta.id);
  return richiesta.id;
}

// Il cliente può togliere un ordine solo finché il banco non l'ha preso in carico: dopo, la
// merce è in preparazione o partita e cancellarlo lo farebbe sparire anche al distributore.
function ordineAnnullabileDalCliente(ordine) {
  return ordine.stato === 'inviato';
}

class OrdineInLavorazione extends Error {
  constructor(ordine) {
    super('ordine già preso in carico');
    this.ordine = ordine;
  }
}

async function avvisaOrdineAnnullato(ordine) {
  // Se un corriere aveva già preso la consegna, nel gruppo si scrive che non serve più.
  await whatsapp.avvisaAnnulloOrdine(ordine).catch((err) => console.error('WhatsApp, annullo ordine:', err.message));
  if (!ordine.distributor_id) return;
  const cliente = await db.prepare('SELECT ragione_sociale FROM users WHERE id = ?').get(ordine.cliente_id);
  await notifiche.notificaDistributore(ordine.distributor_id, {
    titolo: 'Ordine annullato dal cliente',
    testo: `${cliente ? cliente.ragione_sociale : 'Il cliente'} ha annullato l'ordine #${ordine.id} prima della presa in carico.`,
    link: '/distributore',
    categoria: 'ordini',
  });
}

// Elimina richiesta (cliente) — globale: sparisce anche per tutti i distributori (da
// confermare + storico). Lancia OrdineInLavorazione se l'ordine collegato è già preso in carico.
async function eliminaRichiesta(requestId) {
  const elimina = db.transaction(async () => {
    // Righe bloccate fino alla fine: un ordine creato o preso in carico nel frattempo non
    // può più essere cancellato "sotto" al distributore.
    const attuale = await db.prepare('SELECT order_id FROM requests WHERE id = ? FOR UPDATE').get(requestId);
    if (!attuale) return null;
    // La riga della richiesta sparisce, ma il pagamento prima si restituisce: con un provider vero il
    // rimborso va chiesto qui, prima della cancellazione.
    await pagamenti.rimborsa(requestId);
    let ordineEliminato = null;
    if (attuale.order_id) {
      const ordine = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').get(attuale.order_id);
      if (ordine && !ordineAnnullabileDalCliente(ordine)) throw new OrdineInLavorazione(ordine);
      await db.prepare('UPDATE requests SET order_id = NULL WHERE id = ?').run(requestId);
      await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(attuale.order_id);
      await db.prepare('DELETE FROM orders WHERE id = ?').run(attuale.order_id);
      ordineEliminato = ordine;
    }
    await db.prepare(
      `DELETE FROM request_response_items
        WHERE response_id IN (SELECT id FROM request_responses WHERE request_id = ?)`
    ).run(requestId);
    await db.prepare('DELETE FROM request_responses WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
    return ordineEliminato;
  });
  const ordineEliminato = await elimina();
  if (ordineEliminato) {
    // I messaggi della richiesta erano già a posto quando è nato l'ordine: ora basta dire che è annullato.
    await avvisaOrdineAnnullato(ordineEliminato);
  } else {
    await whatsapp
      .ritiraRichiesta(requestId, { motivo: 'il cliente ha eliminato la richiesta' })
      .catch((err) => console.error('WhatsApp, ritiro messaggio:', err.message));
  }
}

// ---------- Ordine ----------

// L'installatore non sceglie niente dopo aver pagato: l'ordine nasce da solo quando una risposta del
// banco diventa valida, cioè quando il corriere prende la consegna nel gruppo WhatsApp (o, a modulo
// spento, appena il banco accetta). Destinazione e note sono quelle scritte nel carrello, salvate
// sulla richiesta; il pagamento è già sulla richiesta (vedi pagamenti.js).
async function creaOrdineDaRisposta(richiesta, risposta) {
  const distributorId = risposta.distributor_id;
  const modalita = 'consegna_mezzo_grossista';
  const note = (richiesta.note || '').trim();
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const destinazione = (richiesta.destinazione || '').trim() || cliente.indirizzo_consegna || ddt.indirizzoCompleto(cliente);
  const { totali } = await richieste.calcolaOfferta(richiesta.id, distributorId);

  const insertOrder = db.prepare(
    `INSERT INTO orders
       (cliente_id, stato, modalita, note, totale_netto, totale_finale,
        request_id, distributor_id, consegna_ore, partenza_ore, destinazione,
        costo_consegna, contributo_raee, iva, totale_ivato)
     VALUES (?, 'inviato', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items
       (order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_listino_snapshot,
        sconto_pct_snapshot, prezzo_netto_unitario, subtotale, prezzo_unitario_cliente,
        subtotale_cliente, raee_unitario, raee_riga)
     VALUES (?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?,
             ?, ?, ?)`
  );

  const creaOrdine = db.transaction(async () => {
    // Blocco atomico "solo il primo vince": la richiesta passa a 'ordinata' una volta sola, anche se
    // un corriere e il timer (o due corrieri) arrivano nello stesso istante. Chi non riesce a far
    // passare questa UPDATE (changes=0) si ferma senza scrivere nulla.
    const claim = await db.prepare(
      `UPDATE requests SET stato = 'ordinata' WHERE id = ? AND stato = 'in_attesa'`
    ).run(richiesta.id);
    if (!claim.changes) return null;

    const info = await insertOrder.run(
      richiesta.cliente_id,
      modalita,
      note,
      totali.totale_netto,
      totali.totale_finale,
      richiesta.id,
      distributorId,
      risposta.consegna_ore,
      risposta.partenza_ore,
      destinazione,
      totali.costo_consegna,
      totali.contributo_raee,
      totali.iva,
      totali.totale_ivato
    );
    const orderId = Number(info.lastInsertRowid);
    for (const riga of totali.righe) await insertItem.run(orderId, riga.product_id, riga.codice_snapshot, riga.nome_snapshot, riga.quantita, riga.prezzo_listino_snapshot, riga.sconto_pct_snapshot, riga.prezzo_netto_unitario, riga.subtotale, riga.prezzo_unitario_cliente, riga.subtotale_cliente, riga.raee_unitario, riga.raee_riga);
    await db.prepare(`UPDATE requests SET order_id = ? WHERE id = ?`).run(orderId, richiesta.id);
    // Con il corriere il tempo di consegna è quello scritto nel gruppo ("preso 30"): conta da adesso,
    // cioè da quando l'ordine è confermato.
    if (risposta.corriere_stato === 'preso') {
      await db.prepare(
        `UPDATE orders
            SET corriere_minuti = ?, corriere_nome = ?, corriere_risposto_il = ?,
                corriere_arrivo_il = NOW() + (? * INTERVAL '1 minute')
          WHERE id = ?`
      ).run(risposta.corriere_minuti, risposta.corriere_nome || '', risposta.corriere_preso_il, risposta.corriere_minuti, orderId);
    }
    // Chiuso l'ordine, gli altri banchi non devono più poter rispondere.
    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW()
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(richiesta.id);
    await db.prepare(
      `UPDATE request_responses SET corriere_stato = 'scaduto'
        WHERE request_id = ? AND corriere_stato = 'in_attesa'`
    ).run(richiesta.id);
    return orderId;
  });

  const orderId = await creaOrdine();
  if (orderId === null) return null;

  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const conCorriere = risposta.corriere_stato === 'preso' && risposta.corriere_minuti;
  const arrivo = conCorriere ? format.oraRoma(new Date(Date.now() + risposta.corriere_minuti * 60 * 1000)) : null;

  // Al banco l'ordine arriva già pagato: deve solo prepararlo.
  await notifiche.notificaDistributore(distributorId, {
    titolo: 'Nuovo ordine da preparare',
    testo: `${cliente.ragione_sociale} — ordine #${orderId}, già pagato.${arrivo ? ` Consegna prevista entro le ${arrivo}.` : ''}`,
    link: '/distributore/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  // La richiesta confermata non resta una richiesta: diventa un ordine, e la notifica del cliente lo
  // dice con il tempo stimato.
  await notifiche.notifica(richiesta.cliente_id, {
    titolo: 'Ordine confermato',
    testo: conCorriere
      ? `${distributore.nome} prepara il tuo ordine #${orderId}. Consegna prevista entro le ${arrivo} (${consegna.inParole(risposta.corriere_minuti)}).`
      : `${distributore.nome} prepara il tuo ordine #${orderId}. Consegna stimata in ${consegna.inParole(risposta.consegna_minuti_stimati)}.`,
    link: '/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  // Gruppo WhatsApp dei corrieri: i messaggi degli altri banchi spariscono. Al corriere che ha preso la
  // consegna non si scrive altro. Un guasto lì non deve far fallire un ordine già creato.
  try {
    await whatsapp.ritiraRichiesta(richiesta.id, { tranne: risposta.id });
  } catch (err) {
    console.error('WhatsApp, ordine #' + orderId + ' non comunicato al gruppo:', err.message);
  }

  return orderId;
}

// L'ordine nasce quando una risposta del banco diventa valida (vedi richieste.assegnaOrdine), subito e
// poi dal timer in server.js se la prima volta è fallito: l'assegnatore si registra qui. Uno script che
// usa solo src/richieste.js non lo ha.
richieste.impostaAssegnatore(creaOrdineDaRisposta);

// ---------- Ordine: lettura, consegna, annullamento ----------

async function dettaglioOrdine(ordine) {
  const righe = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = ordine.distributor_id
    ? await db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id)
    : null;
  const richiestaOrdine = ordine.request_id
    ? await db
        .prepare('SELECT pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il FROM requests WHERE id = ?')
        .get(ordine.request_id)
    : null;
  return {
    righe,
    cliente,
    distributore,
    // Il pagamento fatto all'invio della richiesta (null per gli ordini del vecchio flusso).
    pagamento:
      richiestaOrdine && richiestaOrdine.pagamento_stato
        ? {
            stato: richiestaOrdine.pagamento_stato,
            metodo: richiestaOrdine.pagamento_metodo,
            importo: richiestaOrdine.pagamento_importo,
            pagato_il: richiestaOrdine.pagato_il,
          }
        : null,
    annullabile: ordineAnnullabileDalCliente(ordine),
    ivaPct: await pricing.getIvaPct(),
  };
}

// Il cliente conferma di aver ricevuto la merce: non cambia lo stato DB (resta 'evaso'),
// valorizza solo consegnato_il, che è quanto basta per mostrare "Consegnato".
async function segnaConsegnato(ordine) {
  if (ordine.stato === 'evaso' && !ordine.consegnato_il) {
    await db.prepare('UPDATE orders SET consegnato_il = NOW() WHERE id = ?').run(ordine.id);
  }
}

// PROVVISORIO (prova della home): l'installatore chiude l'ordine come consegnato qualunque sia il suo
// stato, così la scheda "in consegna" sparisce. Non tocca lo stato dell'ordine per il banco. A regime la
// consegna la segnerà un evento vero (corriere, GPS...): da collegare, poi questa funzione va tolta.
async function segnaConsegnatoProva(ordine) {
  if (!ordine.consegnato_il) {
    await db.prepare('UPDATE orders SET consegnato_il = NOW() WHERE id = ?').run(ordine.id);
  }
}

// Elimina ordine (cliente) — globale. Lancia OrdineInLavorazione se già preso in carico.
async function eliminaOrdine(orderId) {
  const elimina = db.transaction(async () => {
    const attuale = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').get(orderId);
    if (!attuale) return null;
    if (!ordineAnnullabileDalCliente(attuale)) throw new OrdineInLavorazione(attuale);
    if (attuale.request_id) {
      await db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', attuale.request_id);
      // L'ordine era già pagato: annullandolo il pagamento torna all'installatore.
      await pagamenti.rimborsa(attuale.request_id);
    }
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(attuale.id);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(attuale.id);
    return attuale;
  });
  const eliminato = await elimina();
  if (eliminato) await avvisaOrdineAnnullato(eliminato);
}

// ---------- Stato ordini e storico ----------

// Tutte le richieste del cliente (più un ordine associato, quando c'è) con lo step 1 (in attesa)
// o 3 (ordine) già calcolato — solo i campi che lo Storico mostra davvero (data, materiale,
// stato): niente risposte dei distributori, che lì non servono.
// aggiornaScadenza si chiama solo sulle richieste ancora aperte, non su tutte e 50: su
// quelle già chiuse (la maggioranza, in uno storico) costerebbe una query a vuoto.
async function richiesteClienteConStato(clienteId) {
  const tutte = await db
    .prepare(`SELECT * FROM requests WHERE cliente_id = ? ORDER BY id DESC LIMIT 50`)
    .all(clienteId);
  if (!tutte.length) return [];

  // La scadenza si aggiorna solo per le richieste ancora aperte (di solito zero o una).
  const aggiornate = [];
  for (const r of tutte) {
    aggiornate.push(
      r.stato === 'in_attesa' || r.stato === 'con_offerte' ? (await richieste.aggiornaScadenza(r.id)) || r : r
    );
  }

  // Righe e ordini di tutte le richieste con due letture in tutto, non due per richiesta:
  // erano circa 100 query di fila, oltre 3 secondi per aprire lo storico.
  const righePerRichiesta = await richieste.righeRichieste(aggiornate.map((r) => r.id));
  const idOrdini = aggiornate.filter((r) => r.stato === 'ordinata' && r.order_id).map((r) => r.order_id);
  const ordiniPerId = new Map();
  if (idOrdini.length) {
    // Il nome del banco (la ditta, mai la filiale: l'installatore non la vede) viaggia nella stessa lettura.
    const ordini = await db
      .prepare(
        `SELECT o.*, d.nome AS distributore_nome
           FROM orders o
           LEFT JOIN distributors d ON d.id = o.distributor_id
          WHERE o.id IN (${idOrdini.map(() => '?').join(',')})`
      )
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'ordinata') {
      step = 3;
      if (rAgg.order_id) ordine = ordiniPerId.get(Number(rAgg.order_id)) || null;
    }
    return { richiesta: rAgg, righe: righePerRichiesta.get(Number(rAgg.id)) || [], ordine, step };
  });
}

// Una riga della pagina Storico (views/storico.ejs), da una card di richiesteClienteConStato.
// `tono` sceglie icona e colori: consegna, attesa, consegnato, nessuna (nessuna risposta), annullata.
// Le etichette sono sempre quelle di sotto: "Inviato", "In preparazione" e "Partito" sono tutti "In consegna".
function voceStorico(c) {
  const r = c.richiesta;
  const o = c.ordine;
  let tono;
  let etichetta;
  if (o && o.consegnato_il) [tono, etichetta] = ['consegnato', 'Consegnato'];
  else if (r.stato === 'in_attesa') [tono, etichetta] = ['attesa', 'In attesa'];
  else if (r.stato === 'ordinata') [tono, etichetta] = ['consegna', 'In consegna'];
  else if (r.stato === 'nessuna_offerta') [tono, etichetta] = ['nessuna', 'Nessuna risposta'];
  else [tono, etichetta] = ['annullata', r.stato === 'annullata' ? 'Annullata' : r.stato];

  // Al centro: il banco dell'ordine. Una richiesta chiusa senza ordine non ne ha: lì conta il rimborso. Chi non
  // aveva pagato (richiesta del vecchio flusso, pagamento_stato NULL) non ha niente da vedersi rimborsare.
  let banco = '';
  if (o) banco = o.distributore_nome || '';
  else if (tono === 'nessuna' || tono === 'annullata') {
    banco = r.pagamento_stato === 'rimborsato' ? 'Rimborsato' : r.pagamento_stato === 'pagato' ? 'Rimborso in corso' : '';
  }

  return {
    href: c.step === 3 && o ? '/ordini/' + o.id : '/richieste/' + r.id,
    tono,
    etichetta,
    data: format.dataBreveRoma(r.creato_il),
    primo: c.righe[0] ? c.righe[0].quantita + '× ' + c.righe[0].nome : '',
    altri: Math.max(0, c.righe.length - 1),
    banco,
    // A destra: il totale dell'ordine (la vista usa totaleOrdine(ordine)) o, senza ordine, quanto è stato pagato.
    ordine: o,
    pagato: Number(r.pagamento_importo) > 0 ? Number(r.pagamento_importo) : null,
    // Il pulsante "Riordina" c'è solo sugli ordini consegnati.
    riordinaId: o && o.consegnato_il ? o.id : null,
  };
}

// Lo Storico dell'installatore: in cima "In corso" (richieste in attesa e ordini in consegna, con le stesse
// regole di attivitaCorrente: un ordine mai segnato come consegnato non resta "in corso" per sempre), poi
// tutto il resto raggruppato per mese di creazione, dal più recente. Le richieste arrivano già dalla più
// recente (id decrescente).
async function storicoCliente(clienteId) {
  const inCorso = [];
  const perMese = new Map();
  for (const c of await richiesteClienteConStato(clienteId)) {
    const voce = voceStorico(c);
    if (c.step === 1 || eInConsegna(c)) {
      inCorso.push(voce);
      continue;
    }
    const { chiave, titolo } = format.meseRoma(c.richiesta.creato_il);
    if (!perMese.has(chiave)) perMese.set(chiave, { titolo, voci: [] });
    perMese.get(chiave).voci.push(voce);
  }
  return { inCorso, mesi: [...perMese.values()] };
}

// "Riordina": gli articoli di un ordine del cliente che si possono rimettere nel carrello, e quanti no
// (tolti dal catalogo o non più disponibili). Ritorna null se l'ordine non esiste, 'altrui' se è di un altro.
async function articoliDaRiordinare(clienteId, ordineId) {
  const ordine = await db.prepare('SELECT id, cliente_id FROM orders WHERE id = ?').get(ordineId);
  if (!ordine) return null;
  if (Number(ordine.cliente_id) !== Number(clienteId)) return 'altrui';
  const righe = await db
    .prepare(
      `SELECT oi.product_id, oi.quantita, p.id AS prodotto_id, p.attivo, p.disponibilita
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ?`
    )
    .all(ordine.id);
  const articoli = [];
  let saltati = 0;
  for (const r of righe) {
    const quantita = leggiQuantita(r.quantita);
    if (r.prodotto_id && Number(r.attivo) === 1 && r.disponibilita !== 'non_disponibile' && quantita > 0) {
      articoli.push({ id: Number(r.product_id), quantita });
    } else {
      saltati++;
    }
  }
  return { articoli, saltati };
}

// "Stato ordini": mostra sempre e solo UNA cosa, mai un elenco — quella più rilevante, in
// ordine di priorità: in attesa > in consegna > scaduta senza conferme. Ogni
// livello ha una finestra oltre la quale non conta più come "attivo" (resta comunque
// raggiungibile dallo Storico). Se ce ne fosse più di una allo stesso livello (es. account
// demo condiviso da più persone) si prende sempre la più recente.
const PROGRESSO_IN_VIAGGIO = 0.5; // metà barra: "In viaggio"
const TRE_ORE_MS = 3 * 60 * 60 * 1000;
const VENTIQUATTRO_ORE_MS = 24 * 60 * 60 * 1000;

// Millisecondi passati da un istante scritto in una colonna TIMESTAMP (UTC senza fuso). pg la legge come
// ora locale del processo: `new Date(colonna)` confrontato con Date.now() sbagliava dell'offset del fuso
// (2 ore sul PC a Roma, niente sulla VPS in UTC), e le finestre di 3 e 24 ore non erano quelle vere.
// istanteUtc rimette a posto l'istante.
function eta(naive) {
  const istante = format.istanteUtc(naive);
  return istante ? Date.now() - istante.getTime() : Infinity;
}

// Ordine ancora in viaggio: non consegnato e nato da meno di 24 ore (oltre, non conta più come "attivo").
function eInConsegna(c) {
  if (c.step !== 3 || !c.ordine || c.ordine.consegnato_il) return false;
  return eta(c.ordine.creato_il) <= VENTIQUATTRO_ORE_MS;
}

function piuRecente(elenco) {
  return elenco.length ? elenco.reduce((a, b) => (b.richiesta.id > a.richiesta.id ? b : a)) : null;
}

// Versione "leggera" di richiesteClienteConStato, solo per scegliere l'attività corrente:
// qui non serve MAI il dettaglio (righe, risposte) di ogni richiesta — solo stato
// e id. Le ultime 5 bastano abbondantemente (il blocco "un solo invio alla volta" impedisce
// comunque di avere più di una richiesta in_attesa insieme), ed è l'unico stato
// che ha bisogno del controllo di scadenza lazy (aggiornaScadenza scrive sul DB solo se
// necessario). Passa da ~150 query a poche sole per apertura pagina.
function leggiRichiesteRecenti(clienteId) {
  return db
    .prepare(
      `SELECT id, stato, creato_il, scade_il, order_id
         FROM requests WHERE cliente_id = ? ORDER BY id DESC LIMIT 5`
    )
    .all(clienteId);
}

async function richiesteAttiveClienteLeggere(recenti) {
  // La scadenza si aggiorna solo per le richieste ancora aperte (di solito zero o una).
  const aggiornate = [];
  for (const r of recenti) {
    aggiornate.push(
      r.stato === 'in_attesa' || r.stato === 'con_offerte' ? (await richieste.aggiornaScadenza(r.id)) || r : r
    );
  }

  // Gli ordini delle richieste già ordinate con una sola lettura, non una per richiesta.
  const idOrdini = aggiornate.filter((r) => r.stato === 'ordinata' && r.order_id).map((r) => r.order_id);
  const ordiniPerId = new Map();
  if (idOrdini.length) {
    const ordini = await db
      .prepare(`SELECT id, stato, consegnato_il, creato_il, corriere_arrivo_il, corriere_risposto_il, corriere_nome FROM orders WHERE id IN (${idOrdini.map(() => '?').join(',')})`)
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'ordinata') {
      step = 3;
      if (rAgg.order_id) ordine = ordiniPerId.get(Number(rAgg.order_id)) || null;
    }
    return { richiesta: rAgg, step, ordine };
  });
}

// L'attività da mostrare in "Stato ordini": { tipo: 'ordine'|'richiesta', id } o null.
// Segna anche come lette le notifiche di richieste/ordini.
async function attivitaCorrente(clienteId) {
  // I due "segna come lette" e la lettura delle ultime richieste non dipendono l'uno
  // dall'altro: partono insieme (un giro al DB invece di tre). Le scadenze si aggiornano DOPO,
  // come prima: le notifiche che possono creare (es. "nessuna conferma") restano da leggere.
  const [, , recenti] = await Promise.all([
    notifiche.segnaLetteCategoria(clienteId, 'ordini'),
    notifiche.segnaLetteCategoria(clienteId, 'richieste'),
    leggiRichiesteRecenti(clienteId),
  ]);
  const cardsAll = await richiesteAttiveClienteLeggere(recenti);

  const inAttesa = cardsAll.filter((c) => c.step === 1);
  const inConsegna = cardsAll.filter(eInConsegna);
  const scadute = cardsAll.filter((c) => {
    if (c.step !== 0 || c.richiesta.stato !== 'nessuna_offerta') return false;
    return eta(c.richiesta.scade_il) <= TRE_ORE_MS;
  });

  const attivo = piuRecente(inAttesa) || piuRecente(inConsegna) || piuRecente(scadute);
  if (!attivo) return null;
  return attivo.step === 3 ? { tipo: 'ordine', id: attivo.ordine.id } : { tipo: 'richiesta', id: attivo.richiesta.id };
}

// Stato dell'icona "Stato ordini" nella barra in basso. Stesse priorità di attivitaCorrente
// (in attesa > in consegna > scaduta), ma in sola lettura: NON segna le notifiche come lette,
// perché gira su ogni pagina del cliente e ogni 15 secondi mentre una richiesta è in attesa.
//   { fase: 'nessuna' }
//   { fase: 'richiesta', secondi, durata }   -> conto alla rovescia della finestra (10 min)
//   { fase: 'consegna', ordineId, minuti, corriere, progresso } -> minuti all'arrivo (null se non scritto),
//                                                nome del corriere ('' se manca), avanzamento 0-1 per la home
//   { fase: 'scaduta' }                       -> nessun banco ha accettato in tempo
async function statoIconaOrdini(clienteId) {
  const cards = await richiesteAttiveClienteLeggere(await leggiRichiesteRecenti(clienteId));

  const inAttesa = piuRecente(cards.filter((c) => c.step === 1));
  if (inAttesa) {
    const r = inAttesa.richiesta;
    const inizio = format.toDate(r.creato_il);
    const fine = format.toDate(r.scade_il);
    const durata = inizio && fine ? Math.max(1, Math.round((fine - inizio) / 1000)) : 600;
    return { fase: 'richiesta', secondi: await richieste.secondiRimasti(r), durata };
  }

  const inConsegna = piuRecente(cards.filter(eInConsegna));
  if (inConsegna) {
    // corriere_arrivo_il è TIMESTAMPTZ (un istante vero), a differenza degli altri orari dello schema.
    const arrivo = format.toDate(inConsegna.ordine.corriere_arrivo_il);
    const minuti = arrivo ? Math.max(1, Math.ceil((arrivo.getTime() - Date.now()) / 60000)) : null;
    return {
      fase: 'consegna',
      ordineId: inConsegna.ordine.id,
      minuti,
      corriere: String(inConsegna.ordine.corriere_nome || '').trim(),
      // Barra della home: ferma a metà ("In viaggio") finché non ci sarà l'evento che segna la consegna
      // vera (ancora da collegare): solo allora arriva a 1 ("Consegnato").
      progresso: PROGRESSO_IN_VIAGGIO,
    };
  }

  const scaduta = cards.some((c) => {
    if (c.step !== 0 || c.richiesta.stato !== 'nessuna_offerta') return false;
    return eta(c.richiesta.scade_il) <= TRE_ORE_MS;
  });
  return { fase: scaduta ? 'scaduta' : 'nessuna' };
}

module.exports = {
  ErroreFlusso,
  statoIconaOrdini,
  senzaFiliale,
  OrdineInLavorazione,
  richiestaBloccante,
  righeDaQuantita,
  riepilogoCarrello,
  nuovaRichiesta,
  dettaglioRichiesta,
  annullaRichiesta,
  reinviaRichiesta,
  eliminaRichiesta,
  creaOrdineDaRisposta,
  dettaglioOrdine,
  segnaConsegnato,
  segnaConsegnatoProva,
  eliminaOrdine,
  ordineAnnullabileDalCliente,
  richiesteClienteConStato,
  storicoCliente,
  articoliDaRiordinare,
  attivitaCorrente,
};
