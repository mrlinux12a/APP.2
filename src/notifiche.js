const db = require('../db');
const icone = require('./icone');

// Notifiche in-app, raggruppate per categoria con i relativi sottostati.
// Il browser le trasforma in notifica push di sistema (public/app.js): il flag
// `notificata` evita che la stessa notifica venga mostrata due volte.

const CATEGORIE = {
  ordini: {
    nome: 'Ordini',
    icona: icone.iconaOrdini,
    sottostati: {
      in_approvazione: 'In approvazione dal cliente',
      spedito: 'Spedito',
      consegnato: 'Consegnato',
      perso: 'Perso',
    },
  },
  richieste: {
    nome: 'Richieste',
    icona: icone.iconaOrario,
    sottostati: {
      inviata: 'Inviata',
      senza_risposta: 'Senza risposta',
      offerte: 'Offerte disponibili',
    },
  },
  approvazioni: {
    nome: 'Approvazioni',
    icona: icone.iconaClienti,
    sottostati: {
      in_sospeso: 'In sospeso',
      confermata: 'Confermata',
      negata: 'Negata',
    },
  },
  generale: { nome: 'Altro', icona: icone.iconaNotifiche, sottostati: {} },
};

// `tipo` e `request_id` servono agli avvisi a comparsa del banco (public/app.js, "Avvisi del banco"): il browser sa così di che genere è la
// notifica e a quale richiesta si riferisce. Senza `tipo` la notifica è una notifica e basta, com'era.
async function notifica(userId, { titolo, testo, link = null, categoria = 'generale', sottostato = '', order_id = null, tipo = null, request_id = null }) {
  await db.prepare(
    `INSERT INTO notifications (user_id, titolo, testo, link, categoria, sottostato, order_id, tipo, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, titolo, testo, link, CATEGORIE[categoria] ? categoria : 'generale', sottostato, order_id, tipo, request_id);
  // Se l'utente ha l'app Android installata, la notifica arriva anche sul telefono (src/push.js). Senza aspettare e senza mai far fallire
  // chi ha generato la notifica: un guasto di Expo o della rete finisce nel log e basta.
  // (Fuori da un'eventuale transazione in corso: il lavoro differito non deve ereditarne la connessione, vedi db.fuoriDallaTransazione.)
  const fuori = typeof db.fuoriDallaTransazione === 'function' ? db.fuoriDallaTransazione : (fn) => fn();
  fuori(() => require('./push').inviaAUtente(userId, { titolo, testo, link, orderId: order_id }).catch(() => {}));
}

async function notificaDistributore(distributorId, payload) {
  const utenti = await db
    .prepare(`SELECT id FROM users WHERE distributor_id = ? AND attivo = 1`)
    .all(distributorId);
  for (const u of utenti) await notifica(u.id, payload);
}

// Una richiesta confermata non resta una richiesta: quando diventa ordine, le sue
// notifiche si spostano nella categoria Ordini invece di restare doppie.
async function spostaInOrdini(userId, requestId, orderId) {
  await db.prepare(
    `UPDATE notifications
        SET categoria = 'ordini', sottostato = 'in_approvazione', order_id = ?
      WHERE user_id = ? AND categoria = 'richieste' AND link = ?`
  ).run(orderId, userId, '/richieste/' + requestId);
}

// Aggiorna il sottostato delle notifiche già emesse per un ordine (spedito, consegnato...).
async function aggiornaStatoOrdine(orderId, sottostato) {
  await db.prepare(`UPDATE notifications SET sottostato = ? WHERE order_id = ?`).run(sottostato, orderId);
}

async function elenco(userId, { categoria = null, sottostato = null, limite = 100 } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (categoria && CATEGORIE[categoria]) {
    where.push('categoria = ?');
    params.push(categoria);
  }
  if (sottostato) {
    where.push('sottostato = ?');
    params.push(sottostato);
  }
  return db
    .prepare(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
    .all(...params, limite);
}

// Quante notifiche per categoria: serve ai filtri in cima al centro notifiche.
async function conteggiPerCategoria(userId) {
  const righe = await db
    .prepare(
      `SELECT categoria, COUNT(*) AS n, SUM(CASE WHEN letta = 0 THEN 1 ELSE 0 END) AS non_lette
         FROM notifications WHERE user_id = ? GROUP BY categoria`
    )
    .all(userId);
  const mappa = {};
  righe.forEach((r) => {
    mappa[r.categoria] = { n: Number(r.n), non_lette: Number(r.non_lette) };
  });
  return mappa;
}

async function conteggiPerSottostato(userId, categoria) {
  return db
    .prepare(
      `SELECT sottostato, COUNT(*) AS n FROM notifications
        WHERE user_id = ? AND categoria = ? AND sottostato <> ''
        GROUP BY sottostato`
    )
    .all(userId, categoria);
}

async function nonLette(userId) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND letta = 0`)
    .get(userId);
  return row ? Number(row.n) : 0;
}

// Notifiche non ancora mostrate come push dal browser; le marca come mostrate. `massimoEtaSec`: se c'è, quelle nate da più tempo si marcano come mostrate
// ma NON si restituiscono (una notifica di ieri non deve suonare adesso: succedeva appena si attivava il permesso, perché fino a lì nessuno le aveva mai
// segnate). Senza, si restituiscono tutte (il banco filtra da sé le vecchie, vedi public/app.js "Avvisi del banco").
async function daMostrare(userId, { massimoEtaSec = null } = {}) {
  const righe = await db
    .prepare(
      `SELECT id, titolo, testo, link, tipo, request_id, order_id, EXTRACT(EPOCH FROM (NOW() - creato_il))::int AS eta_sec FROM notifications
        WHERE user_id = ? AND notificata = 0 ORDER BY id`
    )
    .all(userId);
  if (righe.length) {
    // Solo quelle appena lette: una notifica nata fra la SELECT e questa UPDATE resta da mostrare al giro dopo.
    await db.prepare(
      `UPDATE notifications SET notificata = 1 WHERE user_id = ? AND notificata = 0 AND id = ANY(?::int[])`
    ).run(userId, righe.map((r) => r.id));
  }
  return massimoEtaSec ? righe.filter((r) => Number(r.eta_sec) <= massimoEtaSec) : righe;
}

// Si attivano gli avvisi sul telefono: tutto quello che c'è già è storia e non deve arrivare come notifica.
async function segnaTutteNotificate(userId) {
  await db.prepare(`UPDATE notifications SET notificata = 1 WHERE user_id = ? AND notificata = 0`).run(userId);
}

async function segnaLette(userId) {
  await db.prepare(`UPDATE notifications SET letta = 1 WHERE user_id = ?`).run(userId);
}

async function segnaLetteCategoria(userId, categoria) {
  await db.prepare(`UPDATE notifications SET letta = 1 WHERE user_id = ? AND categoria = ?`).run(userId, categoria);
}

async function nonLetteCategoria(userId, categoria) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND categoria = ? AND letta = 0`)
    .get(userId, categoria);
  return row ? Number(row.n) : 0;
}

// Gli avvisi a comparsa del banco (aperti o chiusi) risultano letti. Si segnano per id e, perché un avviso sopravvive alle ricariche della pagina (che perdono gli id
// delle notifiche da cui è nato), anche per richiesta ("Nuova richiesta") e per ordine ("Corriere trovato"). Solo quelle dell'utente: un id altrui non conta.
const idValido = (n) => Number.isInteger(n) && n > 0 && n < 2147483647;
async function segnaLettePerId(userId, ids, { richieste = [], ordini = [] } = {}) {
  const lista = (v) => (Array.isArray(v) ? v : []).map(Number).filter(idValido).slice(0, 50);
  const perId = lista(ids);
  const perRichiesta = lista(richieste);
  const perOrdine = lista(ordini);
  if (!perId.length && !perRichiesta.length && !perOrdine.length) return 0;
  const info = await db.prepare(
    `UPDATE notifications SET letta = 1
      WHERE user_id = ? AND letta = 0
        AND (id = ANY(?::int[])
             OR (tipo = 'nuova_richiesta' AND request_id = ANY(?::int[]))
             OR (tipo = 'corriere_trovato' AND order_id = ANY(?::int[])))`
  ).run(userId, perId, perRichiesta, perOrdine);
  return info.changes;
}

module.exports = {
  CATEGORIE,
  notifica,
  notificaDistributore,
  spostaInOrdini,
  aggiornaStatoOrdine,
  elenco,
  conteggiPerCategoria,
  conteggiPerSottostato,
  nonLette,
  nonLetteCategoria,
  daMostrare,
  segnaTutteNotificate,
  segnaLette,
  segnaLettePerId,
  segnaLetteCategoria,
};
