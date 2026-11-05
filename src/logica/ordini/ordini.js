// Letture degli ordini usate da più pagine: il sito, il banco, l'agente e l'app. La nascita e il ciclo di vita di un ordine stanno in flusso_cliente.js.
const db = require('../../../db');
const orariCorriere = require('./corriere');

// L'ordine con questo id, o undefined. Chi lo chiama controlla che sia di chi lo chiede (cliente, banco).
async function ordinePerId(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

// Le righe di un ordine (il materiale), nell'ordine in cui sono state scritte.
async function righeOrdine(ordineId) {
  return db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(ordineId);
}

// Quanti secondi mancano al ritiro del corriere (l'orario che ha scritto su WhatsApp), contati dal database: `{ secondi }`, o undefined se l'ordine non c'è.
async function secondiAlRitiro(ordineId) {
  return db.prepare(`SELECT EXTRACT(EPOCH FROM (${orariCorriere.ritiroSql('')} - NOW()))::int AS secondi FROM orders WHERE id = ?`).get(ordineId);
}

// Tutti gli ordini arrivati, dal più recente, con il nome del cliente e del distributore (la pagina dell'agente).
async function ordiniConClienteEDistributore() {
  return db
    .prepare(
      `SELECT o.*, u.ragione_sociale AS cliente_nome, d.nome AS distributore_nome
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
         LEFT JOIN distributors d ON d.id = o.distributor_id
        ORDER BY o.creato_il DESC`
    )
    .all();
}

module.exports = { ordinePerId, righeOrdine, secondiAlRitiro, ordiniConClienteEDistributore };
