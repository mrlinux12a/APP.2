const db = require('../db');

// Documento di trasporto (bolla / DDT) intestato al cliente ordinante.
// Il documento è emesso dal distributore che evade l'ordine: mittente il suo banco,
// destinatario e intestatario il cliente con la sua anagrafica completa.

// Progressivo per distributore e per anno, assegnato una sola volta per ordine.
async function prossimoNumero(distributorId, anno) {
  await db.prepare(
    `INSERT INTO ddt_counters (distributor_id, anno, ultimo) VALUES (?, ?, 0)
     ON CONFLICT(distributor_id, anno) DO NOTHING`
  ).run(distributorId, anno);
  await db.prepare(
    'UPDATE ddt_counters SET ultimo = ultimo + 1 WHERE distributor_id = ? AND anno = ?'
  ).run(distributorId, anno);
  const row = await db
    .prepare('SELECT ultimo FROM ddt_counters WHERE distributor_id = ? AND anno = ?')
    .get(distributorId, anno);
  return `${row.ultimo}/${anno}`;
}

// Emette la bolla e segna la merce come partita. Idempotente: se il DDT esiste già non viene
// rinumerato. Ritorna { numero, nuovo }: `nuovo` è false se la bolla c'era già.
//
// Il controllo "esiste già?" si rifà dentro la transazione, con la riga dell'ordine bloccata: due invii
// quasi contemporanei (doppio tocco su "Emetti bolla") passavano entrambi il controllo sull'oggetto letto
// all'inizio della richiesta e assegnavano due numeri, lasciando un buco nella numerazione progressiva
// del distributore (che per le bolle va tenuta senza salti).
async function emetti(ordine, { colli, aspetto, trasporto, causale, note }) {
  if (ordine.ddt_numero) return { numero: ordine.ddt_numero, nuovo: false };

  const row = await db.prepare("SELECT EXTRACT(YEAR FROM NOW())::int AS a").get();
  const anno = Number(row.a);

  const esegui = db.transaction(async () => {
    const attuale = await db.prepare('SELECT ddt_numero FROM orders WHERE id = ? FOR UPDATE').get(ordine.id);
    if (!attuale) throw new Error('Ordine non trovato: ' + ordine.id);
    if (attuale.ddt_numero) return { numero: attuale.ddt_numero, nuovo: false };

    const numero = await prossimoNumero(ordine.distributor_id, anno);
    await db.prepare(
      `UPDATE orders
          SET ddt_numero = ?, ddt_data = NOW(), ddt_colli = ?, ddt_aspetto = ?,
              ddt_trasporto = ?, ddt_causale = ?, ddt_note = ?,
              stato = 'evaso', evaso_il = NOW()
        WHERE id = ?`
    ).run(
      numero,
      Math.max(1, Math.min(999, parseInt(colli, 10) || 1)),
      String(aspetto || 'Colli').slice(0, 100),
      String(trasporto || 'mittente').slice(0, 100),
      String(causale || 'Vendita').slice(0, 100),
      String(note || '').trim().slice(0, 500),
      ordine.id
    );
    return { numero, nuovo: true };
  });

  return esegui();
}

// Tutti i dati che servono a stampare la bolla.
async function documento(orderId) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!ordine) return null;

  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id);
  const distributore = ordine.distributor_id
    ? await db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id)
    : null;
  const righe = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ordine.id);

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
