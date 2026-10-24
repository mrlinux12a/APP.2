// Il carrello dell'installatore sul sito: sta nella sessione (req.session.carrello = { idProdotto: quantità }), non nel database, finché non parte la richiesta.
const db = require('../../db');
const { QUANTITA_MASSIMA, leggiId, leggiQuantita } = require('../input');

// Il carrello di sessione (lo crea vuoto se non c'è ancora).
function getCarrello(req) {
  if (!req.session.carrello) req.session.carrello = {};
  return req.session.carrello;
}

// Quanti pezzi ci sono nel carrello in totale (il numero sul pallino del carrello).
function contaCarrello(req) {
  const c = req.session && req.session.carrello ? req.session.carrello : {};
  return Object.values(c).reduce((acc, q) => acc + q, 0);
}

// Trasforma il carrello di sessione in righe [{prodotto, quantita}] con i dati aggiornati. Gli articoli non più in catalogo (tolti o disattivati dopo
// essere finiti nel carrello) escono anche dal carrello di sessione: altrimenti il pallino del carrello li contava ancora, senza che la pagina li mostrasse.
async function righeCarrello(req) {
  const carrello = getCarrello(req);
  const ids = Object.keys(carrello).map(Number).filter((id) => carrello[id] > 0);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const prodotti = await db.prepare(
      `SELECT * FROM products WHERE attivo = 1 AND id IN (${placeholders}) ORDER BY macro_slug, categoria, nome`
    )
    .all(...ids);
  const presenti = new Set(prodotti.map((p) => p.id));
  for (const id of Object.keys(carrello)) {
    if (!presenti.has(Number(id))) delete carrello[id];
  }
  return prodotti.map((prodotto) => ({ prodotto, quantita: carrello[prodotto.id] }));
}

// Legge i campi quantita_<id> di un form e aggiorna il carrello di sessione.
// modo 'aggiungi' (cataloghi e ricerca): le quantità si sommano, lo zero non tocca nulla.
// modo 'imposta' (pagina carrello): le quantità sostituiscono, lo zero rimuove la riga.
// Le quantità hanno un tetto (QUANTITA_MASSIMA, src/input.js): un numero enorme o scritto male non deve arrivare al DB come quantità di una riga.
function aggiornaCarrelloDaForm(req, modo = 'aggiungi') {
  const carrello = getCarrello(req);
  for (const [chiave, valore] of Object.entries(req.body || {})) {
    if (!chiave.startsWith('quantita_')) continue;
    const id = leggiId(chiave.slice('quantita_'.length));
    if (!id) continue;
    const q = leggiQuantita(valore);
    if (modo === 'imposta') {
      if (q > 0) carrello[id] = q;
      else delete carrello[id];
    } else if (q > 0) {
      carrello[id] = Math.min(QUANTITA_MASSIMA, (carrello[id] || 0) + q);
    }
  }
}

module.exports = { getCarrello, contaCarrello, righeCarrello, aggiornaCarrelloDaForm };
