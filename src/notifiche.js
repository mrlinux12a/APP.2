const db = require('../db');

// Notifiche in-app. Il browser le trasforma in notifica push di sistema (public/app.js):
// il flag `notificata` evita che la stessa notifica venga mostrata due volte.
function notifica(userId, { titolo, testo, link = null }) {
  db.prepare(
    `INSERT INTO notifications (user_id, titolo, testo, link) VALUES (?, ?, ?, ?)`
  ).run(userId, titolo, testo, link);
}

function notificaDistributore(distributorId, payload) {
  const utenti = db
    .prepare(`SELECT id FROM users WHERE distributor_id = ? AND attivo = 1`)
    .all(distributorId);
  utenti.forEach((u) => notifica(u.id, payload));
}

function elenco(userId, limite = 50) {
  return db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`)
    .all(userId, limite);
}

function nonLette(userId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND letta = 0`)
    .get(userId);
  return row ? row.n : 0;
}

// Notifiche non ancora mostrate come push dal browser; le marca come mostrate.
function daMostrare(userId) {
  const righe = db
    .prepare(
      `SELECT id, titolo, testo, link FROM notifications
        WHERE user_id = ? AND notificata = 0 ORDER BY id`
    )
    .all(userId);
  if (righe.length) {
    db.prepare(
      `UPDATE notifications SET notificata = 1 WHERE user_id = ? AND notificata = 0`
    ).run(userId);
  }
  return righe;
}

function segnaLette(userId) {
  db.prepare(`UPDATE notifications SET letta = 1 WHERE user_id = ?`).run(userId);
}

module.exports = { notifica, notificaDistributore, elenco, nonLette, daMostrare, segnaLette };
