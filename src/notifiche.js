const db = require('../db');

// Notifiche in-app, raggruppate per categoria con i relativi sottostati.
// Il browser le trasforma in notifica push di sistema (public/app.js): il flag
// `notificata` evita che la stessa notifica venga mostrata due volte.

const CATEGORIE = {
  ordini: {
    nome: 'Ordini',
    icona: '📦',
    sottostati: {
      in_approvazione: 'In approvazione dal cliente',
      spedito: 'Spedito',
      consegnato: 'Consegnato',
      perso: 'Perso',
    },
  },
  richieste: {
    nome: 'Richieste',
    icona: '⏳',
    sottostati: {
      inviata: 'Inviata',
      senza_risposta: 'Senza risposta',
      offerte: 'Offerte disponibili',
    },
  },
  approvazioni: {
    nome: 'Approvazioni',
    icona: '👥',
    sottostati: {
      in_sospeso: 'In sospeso',
      confermata: 'Confermata',
      negata: 'Negata',
    },
  },
  generale: { nome: 'Altro', icona: '🔔', sottostati: {} },
};

async function notifica(userId, { titolo, testo, link = null, categoria = 'generale', sottostato = '', order_id = null }) {
  await db.prepare(
    `INSERT INTO notifications (user_id, titolo, testo, link, categoria, sottostato, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, titolo, testo, link, CATEGORIE[categoria] ? categoria : 'generale', sottostato, order_id);
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

// Notifiche non ancora mostrate come push dal browser; le marca come mostrate.
async function daMostrare(userId) {
  const righe = await db
    .prepare(
      `SELECT id, titolo, testo, link FROM notifications
        WHERE user_id = ? AND notificata = 0 ORDER BY id`
    )
    .all(userId);
  if (righe.length) {
    await db.prepare(
      `UPDATE notifications SET notificata = 1 WHERE user_id = ? AND notificata = 0`
    ).run(userId);
  }
  return righe;
}

async function segnaLette(userId) {
  await db.prepare(`UPDATE notifications SET letta = 1 WHERE user_id = ?`).run(userId);
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
  daMostrare,
  segnaLette,
};
