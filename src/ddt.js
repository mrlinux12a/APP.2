const db = require('../db');

// Documento di trasporto (bolla / DDT) intestato al cliente ordinante.
// Il documento è emesso dal distributore che evade l'ordine: mittente il suo banco,
// destinatario e intestatario il cliente con la sua anagrafica completa.

// Progressivo per distributore e per anno, assegnato una sola volta per ordine.
function prossimoNumero(distributorId, anno) {
  db.prepare(
    `INSERT INTO ddt_counters (distributor_id, anno, ultimo) VALUES (?, ?, 0)
     ON CONFLICT(distributor_id, anno) DO NOTHING`
  ).run(distributorId, anno);
  db.prepare(
    'UPDATE ddt_counters SET ultimo = ultimo + 1 WHERE distributor_id = ? AND anno = ?'
  ).run(distributorId, anno);
  const row = db
    .prepare('SELECT ultimo FROM ddt_counters WHERE distributor_id = ? AND anno = ?')
    .get(distributorId, anno);
  return `${row.ultimo}/${anno}`;
}

// Emette la bolla e segna la merce come partita. Idempotente: se il DDT esiste già
// non viene rinumerato.
function emetti(ordine, { colli, aspetto, trasporto, causale, note }) {
  if (ordine.ddt_numero) return ordine.ddt_numero;

  const anno = Number(
    db.prepare("SELECT strftime('%Y', 'now') AS a").get().a
  );

  const esegui = db.transaction(() => {
    const numero = prossimoNumero(ordine.distributor_id, anno);
    db.prepare(
      `UPDATE orders
          SET ddt_numero = ?, ddt_data = datetime('now'), ddt_colli = ?, ddt_aspetto = ?,
              ddt_trasporto = ?, ddt_causale = ?, ddt_note = ?,
              stato = 'evaso', evaso_il = datetime('now')
        WHERE id = ?`
    ).run(
      numero,
      Math.max(1, parseInt(colli, 10) || 1),
      aspetto || 'Colli',
      trasporto || 'mittente',
      causale || 'Vendita',
      (note || '').trim(),
      ordine.id
    );
    return numero;
  });

  return esegui();
}

// Tutti i dati che servono a stampare la bolla.
function documento(orderId) {
  const ordine = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine) return null;

  const cliente = db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = ordine.distributor_id
    ? db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id)
    : null;
  const righe = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);

  const colli = ordine.ddt_colli || Math.max(1, Math.ceil(righe.length / 3));
  const pezzi = righe.reduce((acc, r) => acc + r.quantita, 0);

  return { ordine, cliente, distributore, righe, colli, pezzi };
}

// Indirizzo su una riga sola, saltando i pezzi mancanti.
function indirizzoCompleto(a) {
  if (!a) return '';
  const riga2 = [a.cap, a.citta, a.provincia ? `(${a.provincia})` : ''].filter(Boolean).join(' ');
  return [a.indirizzo, riga2].filter(Boolean).join(' — ');
}

module.exports = { emetti, documento, indirizzoCompleto };
