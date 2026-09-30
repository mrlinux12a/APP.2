// Flusso dell'installatore: richiesta di disponibilità -> offerte dei banchi -> ordine.
// Prima stava dentro le route di server.js; spostato qui perché lo usano sia le pagine del
// sito sia l'API dell'app (src/api_v1.js), che devono seguire esattamente le stesse regole.
// Qui solo la logica: come rispondere (pagina, redirect o JSON) lo decide chi chiama.
const db = require('../db');
const pricing = require('./pricing');
const richieste = require('./richieste');
const notifiche = require('./notifiche');
const ddt = require('./ddt');

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
// precedente dello stesso cliente è ancora in attesa di risposta o da scegliere. Un ordine
// già confermato (in consegna) invece non blocca: la nuova richiesta prende il suo posto in
// "Stato ordini". Ritorna la richiesta bloccante (aggiornata) se ce n'è una, altrimenti null.
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
  for (const v of voci || []) {
    const id = parseInt(v && v.id, 10);
    const q = Math.max(0, parseInt(v && v.quantita, 10) || 0);
    if (id && q > 0) quantita.set(id, (quantita.get(id) || 0) + q);
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

// Totali del carrello come li mostra la pagina Carrello del sito (merce, RAEE, spedizione,
// ordine minimo).
async function riepilogoCarrello(righe) {
  const totali = await pricing.calcolaOrdine(righe);
  const minimo = await pricing.getOrdineMinimo();
  const spedizione = await pricing.getSpedizioneFissa();
  return {
    totali,
    minimo,
    spedizione,
    // La soglia si misura sulla sola merce: la spedizione si somma dopo.
    mancaAlMinimo: pricing.round2(Math.max(0, minimo - totali.totale_finale)),
    raggiunto: totali.totale_finale >= minimo,
    minutiRisposta: await pricing.getFinestraMinuti(),
  };
}

// Crea la richiesta di disponibilità e la manda ai distributori. Ritorna l'id creato.
async function nuovaRichiesta(clienteId, righe) {
  // L'ordine minimo si misura sulla merce già maggiorata, spedizione esclusa.
  const totali = await pricing.calcolaOrdine(righe);
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
      "Hai già una richiesta in attesa di risposta o da scegliere: aspetta che si chiuda prima di inviarne un'altra.",
      { requestId: bloccante.id }
    );
  }

  try {
    const { requestId } = await richieste.creaRichiesta(cliente, righe);
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

// Tutto quello che serve per mostrare una richiesta (attesa o offerte). Segna anche come
// lette le notifiche di richieste/ordini: il cliente sta guardando proprio questa.
async function dettaglioRichiesta(richiesta) {
  await notifiche.segnaLetteCategoria(richiesta.cliente_id, 'richieste');
  await notifiche.segnaLetteCategoria(richiesta.cliente_id, 'ordini');

  const dati = {
    richiesta,
    righe: await richieste.righeRichiesta(richiesta.id),
    risposte: await richieste.risposteRichiesta(richiesta.id),
    secondi: await richieste.secondiRimasti(richiesta),
    minutiRisposta: await pricing.getFinestraMinuti(),
    offerte: [],
    secondiScelta: null,
    nomeAssegnazione: null,
    idPiuVeloce: null,
  };
  if (richiesta.stato === 'in_attesa' || richiesta.stato === 'ordinata') return dati;

  const offerte = await richieste.offerte(richiesta.id);
  const piuVeloce = await richieste.offertaPiuVeloce(richiesta.id);
  const perAssegnazione = await richieste.offertaPerAssegnazione(richiesta.id);
  return {
    ...dati,
    offerte,
    // Il conto alla rovescia vale anche con UNA sola offerta: prima compariva solo con due
    // o più, ma l'ordine automatico partiva comunque e il cliente non ne sapeva niente.
    secondiScelta: offerte.length ? await richieste.secondiAllAssegnazione(richiesta) : null,
    nomeAssegnazione: perAssegnazione ? perAssegnazione.distributore_nome : null,
    idPiuVeloce: piuVeloce ? piuVeloce.distributor_id : null,
  };
}

// Ritorna false se la richiesta non era più annullabile (es. l'ordine automatico è
// partito un istante prima).
async function annullaRichiesta(requestId) {
  // Condizione dentro la UPDATE: se l'ordine automatico è partito un istante prima,
  // l'annullamento non deve sovrascrivere 'ordinata' lasciando un ordine vivo su una
  // richiesta che il cliente crede annullata.
  const upd = await db
    .prepare(`UPDATE requests SET stato = 'annullata' WHERE id = ? AND stato IN ('in_attesa', 'con_offerte', 'nessuna_offerta')`)
    .run(requestId);
  if (!upd.changes) return false;
  // Chiude anche le risposte ancora "in attesa" dal lato banco: altrimenti la
  // richiesta annullata dal cliente resta a intasare la dashboard dei distributori
  // come se ci fosse ancora qualcosa da confermare.
  await db.prepare(
    `UPDATE request_responses SET esito = 'scaduto' WHERE request_id = ? AND esito = 'in_attesa'`
  ).run(requestId);
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
    let ordineEliminato = null;
    if (attuale.order_id) {
      const ordine = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').get(attuale.order_id);
      if (ordine && !ordineAnnullabileDalCliente(ordine)) throw new OrdineInLavorazione(ordine);
      await db.prepare('UPDATE requests SET order_id = NULL WHERE id = ?').run(requestId);
      await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(attuale.order_id);
      await db.prepare('DELETE FROM orders WHERE id = ?').run(attuale.order_id);
      ordineEliminato = ordine;
    }
    const rows = await db.prepare('SELECT id FROM request_responses WHERE request_id = ?').all(requestId);
    const rids = rows.map(r => r.id);
    for (const rid of rids) await db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(rid);
    await db.prepare('DELETE FROM request_responses WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
    return ordineEliminato;
  });
  const ordineEliminato = await elimina();
  if (ordineEliminato) await avvisaOrdineAnnullato(ordineEliminato);
}

// ---------- Scelta dell'offerta e ordine ----------

// Riepilogo dell'ordine con il distributore scelto. null se quel distributore non ha
// confermato la disponibilità.
async function riepilogoOfferta(richiesta, distributorId, modalita) {
  const risposta = await db
    .prepare(
      `SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ? AND esito = 'confermato'`
    )
    .get(richiesta.id, distributorId);
  if (!risposta) return null;

  const offerta = await richieste.calcolaOfferta(richiesta.id, distributorId, { modalita });
  const perAssegnazione = await richieste.offertaPerAssegnazione(richiesta.id);
  return {
    risposta,
    offerta,
    ivaPct: await pricing.getIvaPct(),
    // Anche qui il cliente deve vedere quanto manca all'ordine automatico: mentre compila
    // note e destinazione il tempo corre.
    secondiScelta: await richieste.secondiAllAssegnazione(richiesta),
    nomeAssegnazione: perAssegnazione ? perAssegnazione.distributore_nome : null,
  };
}

// Creazione dell'ordine a partire da un'offerta confermata: la usano sia la scelta
// manuale del cliente sia l'assegnazione automatica allo scadere dei 5 minuti.
async function creaOrdineDaOfferta(richiesta, distributorId, risposta, opzioni = {}) {
  const modalita = opzioni.modalita === 'ritiro' ? 'ritiro' : 'consegna_mezzo_grossista';
  const note = (opzioni.note || '').trim();
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(richiesta.cliente_id);
  const destinazione =
    modalita === 'ritiro'
      ? 'Ritiro al banco'
      : (opzioni.destinazione || '').trim() || cliente.indirizzo_consegna || ddt.indirizzoCompleto(cliente);
  const { totali } = await richieste.calcolaOfferta(richiesta.id, distributorId, { modalita });

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
    // Blocco atomico "solo il primo vince": prima questa UPDATE non esisteva e l'ordine
    // veniva sempre creato senza controllare se la richiesta era già stata chiusa da
    // un'altra chiamata concorrente — un doppio tap sullo stesso invio, o l'assegnazione
    // automatica dei 5 minuti scattata nello stesso istante di una scelta manuale,
    // potevano creare due ordini (anche con due distributori diversi) per la stessa
    // richiesta. Ora solo la chiamata che riesce a far passare questa UPDATE (changes=1)
    // prosegue; l'altra trova stato già 'ordinata' e si ferma senza scrivere nulla.
    // Vale solo da 'con_offerte' (prima bastava "non ordinata": passava anche un'annullata),
    // e assegnata_auto si scrive qui, insieme all'ordine: prima si scriveva prima, a parte,
    // e se la creazione si interrompeva la richiesta restava bloccata per sempre.
    const claim = await db.prepare(
      `UPDATE requests SET stato = 'ordinata', assegnata_auto = ?
        WHERE id = ? AND stato = 'con_offerte'`
    ).run(opzioni.automatico ? 1 : 0, richiesta.id);
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
    // Chiuso l'ordine, gli altri banchi non devono più poter rispondere.
    await db.prepare(
      `UPDATE request_responses SET esito = 'scaduto', risposto_il = NOW()
        WHERE request_id = ? AND esito = 'in_attesa'`
    ).run(richiesta.id);
    return orderId;
  });

  const orderId = await creaOrdine();
  if (orderId === null) return null;

  const distributore = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  await notifiche.notificaDistributore(distributorId, {
    titolo: 'Nuovo ordine da preparare',
    testo: `${cliente.ragione_sociale} ha scelto ${distributore.nome} — ordine #${orderId}.`,
    link: '/distributore/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  // La richiesta confermata non resta una richiesta: diventa un ordine, e la notifica
  // del cliente lo dice esplicitamente.
  await notifiche.notifica(richiesta.cliente_id, {
    titolo: opzioni.automatico ? 'Ordine assegnato automaticamente' : 'Ordine inviato',
    testo: opzioni.automatico
      ? `Non hai scelto in tempo: l'ordine #${orderId} è andato a ${distributore.nome}, con la consegna più veloce.`
      : `Ordine #${orderId} inviato a ${distributore.nome}.`,
    link: '/ordini/' + orderId,
    categoria: 'ordini',
    sottostato: 'in_approvazione',
    order_id: orderId,
  });

  return orderId;
}

// Il cliente sceglie un'offerta e invia l'ordine. Esiti:
//   { esito: 'creato', orderId }
//   { esito: 'gia_ordinata', richiesta }  (chiusa da un doppio tap o dall'ordine automatico)
//   { esito: 'non_aperta', richiesta }    (annullata o offerte scadute)
//   { esito: 'offerta_non_valida' }       (quel distributore non ha confermato)
async function ordinaDaOfferta(richiesta, distributorId, opzioni) {
  if (richiesta.stato === 'ordinata') return { esito: 'gia_ordinata', richiesta };
  if (!(await richieste.sceltaAncoraValida(richiesta.id))) return { esito: 'non_aperta', richiesta };

  const risposta = await db
    .prepare(
      `SELECT * FROM request_responses WHERE request_id = ? AND distributor_id = ? AND esito = 'confermato'`
    )
    .get(richiesta.id, distributorId);
  if (!risposta) return { esito: 'offerta_non_valida' };

  const orderId = await creaOrdineDaOfferta(richiesta, distributorId, risposta, opzioni);
  if (orderId === null) {
    // Un'altra chiamata concorrente ha chiuso questa richiesta un istante prima (doppio
    // tap sullo stesso "Invia l'ordine", o l'assegnazione automatica scattata nello stesso
    // momento): non è stato creato un secondo ordine duplicato.
    const aggiornata = await richieste.getRichiesta(richiesta.id);
    if (aggiornata && aggiornata.stato === 'ordinata') return { esito: 'gia_ordinata', richiesta: aggiornata };
    return { esito: 'non_aperta', richiesta: aggiornata || richiesta };
  }
  return { esito: 'creato', orderId };
}

// Finita la scelta senza decisione, l'ordine va a chi copre tutto il materiale con la
// consegna più veloce. Lo chiama richieste.aggiornaScadenza() a ogni lettura della
// richiesta (su Vercel i timer non girano fra una visita e l'altra) e il timer in server.js.
richieste.impostaAssegnatore(async (requestId) => {
  const richiesta = await richieste.getRichiesta(requestId);
  const migliore = await richieste.offertaPerAssegnazione(requestId);
  if (!richiesta || !migliore) return null;
  return creaOrdineDaOfferta(richiesta, migliore.distributor_id, migliore, { automatico: true });
});

// ---------- Ordine: lettura, consegna, annullamento ----------

async function dettaglioOrdine(ordine) {
  const righe = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = ordine.distributor_id
    ? await db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id)
    : null;
  const richiestaOrdine = ordine.request_id
    ? await db.prepare('SELECT assegnata_auto FROM requests WHERE id = ?').get(ordine.request_id)
    : null;
  return {
    righe,
    cliente,
    distributore,
    // Un ordine partito da solo deve dirlo: senza, sembrava che qualcun altro l'avesse inviato.
    assegnataAuto: !!(richiestaOrdine && richiestaOrdine.assegnata_auto),
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

// Elimina ordine (cliente) — globale. Lancia OrdineInLavorazione se già preso in carico.
async function eliminaOrdine(orderId) {
  const elimina = db.transaction(async () => {
    const attuale = await db.prepare('SELECT * FROM orders WHERE id = ? FOR UPDATE').get(orderId);
    if (!attuale) return null;
    if (!ordineAnnullabileDalCliente(attuale)) throw new OrdineInLavorazione(attuale);
    if (attuale.request_id) await db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', attuale.request_id);
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(attuale.id);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(attuale.id);
    return attuale;
  });
  const eliminato = await elimina();
  if (eliminato) await avvisaOrdineAnnullato(eliminato);
}

// ---------- Stato ordini e storico ----------

// Tutte le richieste del cliente (più un ordine associato, quando c'è) con lo step 1-2-3
// già calcolato — solo i campi che lo Storico mostra davvero (data, materiale, stato):
// niente risposte dei distributori né calcolo delle offerte, che lì non servono e sono
// il grosso del costo (offerte() da sola fa una query per ogni distributore confermato).
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
    const ordini = await db
      .prepare(`SELECT * FROM orders WHERE id IN (${idOrdini.map(() => '?').join(',')})`)
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'con_offerte') step = 2;
    else if (rAgg.stato === 'ordinata') {
      step = 3;
      if (rAgg.order_id) ordine = ordiniPerId.get(Number(rAgg.order_id)) || null;
    }
    return { richiesta: rAgg, righe: righePerRichiesta.get(Number(rAgg.id)) || [], ordine, step };
  });
}

// "Stato ordini": mostra sempre e solo UNA cosa, mai un elenco — quella più rilevante, in
// ordine di priorità: in attesa > da scegliere > in consegna > scaduta senza conferme. Ogni
// livello ha una finestra oltre la quale non conta più come "attivo" (resta comunque
// raggiungibile dallo Storico). Se ce ne fosse più di una allo stesso livello (es. account
// demo condiviso da più persone) si prende sempre la più recente.
const TRE_ORE_MS = 3 * 60 * 60 * 1000;
const VENTIQUATTRO_ORE_MS = 24 * 60 * 60 * 1000;

function piuRecente(elenco) {
  return elenco.length ? elenco.reduce((a, b) => (b.richiesta.id > a.richiesta.id ? b : a)) : null;
}

// Versione "leggera" di richiesteClienteConStato, solo per scegliere l'attività corrente:
// qui non serve MAI il dettaglio (righe, risposte, offerte) di ogni richiesta — solo stato
// e id. Le ultime 5 bastano abbondantemente (il blocco "un solo invio alla volta" impedisce
// comunque di avere più di una richiesta in_attesa/con_offerte insieme), ed è l'unico stato
// che ha bisogno del controllo di scadenza lazy (aggiornaScadenza scrive sul DB solo se
// necessario). Passa da ~150 query a poche sole per apertura pagina.
function leggiRichiesteRecenti(clienteId) {
  return db
    .prepare(
      `SELECT id, stato, creato_il, scade_il, scelta_scade_il, order_id
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
      .prepare(`SELECT id, stato, consegnato_il, creato_il FROM orders WHERE id IN (${idOrdini.map(() => '?').join(',')})`)
      .all(...idOrdini);
    for (const o of ordini) ordiniPerId.set(Number(o.id), o);
  }

  return aggiornate.map((rAgg) => {
    let step = 0;
    let ordine = null;
    if (rAgg.stato === 'in_attesa') step = 1;
    else if (rAgg.stato === 'con_offerte') step = 2;
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
  const daScegliere = cardsAll.filter((c) => {
    if (c.step !== 2) return false;
    // scelta_scade_il si fissa una sola volta, all'ingresso in "con_offerte": è il
    // riferimento esatto di quando la richiesta è entrata in questo stato.
    if (!c.richiesta.scelta_scade_il) return true;
    return Date.now() - new Date(c.richiesta.scelta_scade_il).getTime() <= TRE_ORE_MS;
  });
  const inConsegna = cardsAll.filter((c) => {
    if (c.step !== 3 || !c.ordine || c.ordine.consegnato_il) return false;
    return Date.now() - new Date(c.ordine.creato_il).getTime() <= VENTIQUATTRO_ORE_MS;
  });
  const scadute = cardsAll.filter((c) => {
    if (c.step !== 0 || c.richiesta.stato !== 'nessuna_offerta') return false;
    return Date.now() - new Date(c.richiesta.scade_il).getTime() <= TRE_ORE_MS;
  });

  const attivo = piuRecente(inAttesa) || piuRecente(daScegliere) || piuRecente(inConsegna) || piuRecente(scadute);
  if (!attivo) return null;
  return attivo.step === 3 ? { tipo: 'ordine', id: attivo.ordine.id } : { tipo: 'richiesta', id: attivo.richiesta.id };
}

module.exports = {
  ErroreFlusso,
  OrdineInLavorazione,
  richiestaBloccante,
  righeDaQuantita,
  riepilogoCarrello,
  nuovaRichiesta,
  dettaglioRichiesta,
  annullaRichiesta,
  reinviaRichiesta,
  eliminaRichiesta,
  riepilogoOfferta,
  ordinaDaOfferta,
  dettaglioOrdine,
  segnaConsegnato,
  eliminaOrdine,
  ordineAnnullabileDalCliente,
  richiesteClienteConStato,
  attivitaCorrente,
};
