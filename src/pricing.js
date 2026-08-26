const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getServizioPct() {
  const row = db.prepare(`SELECT valore FROM config WHERE chiave = 'servizio_pct'`).get();
  return row ? parseFloat(row.valore) : 10;
}

// Calcola il prezzo netto di un prodotto (listino - sconto base)
function prezzoNetto(prodotto) {
  return round2(prodotto.prezzo_listino * (1 - prodotto.sconto_base_pct / 100));
}

// A partire dalle righe carrello [{product, quantita}], calcola righe ordine e totali.
// Il servizio (%) viene incluso solo nel totale finale, mai esposto come voce separata.
function calcolaOrdine(righeCarrello) {
  const righe = righeCarrello.map(({ prodotto, quantita }) => {
    const prezzo_netto_unitario = prezzoNetto(prodotto);
    const subtotale = round2(prezzo_netto_unitario * quantita);
    return {
      product_id: prodotto.id,
      codice_snapshot: prodotto.codice,
      nome_snapshot: prodotto.nome,
      quantita,
      prezzo_listino_snapshot: prodotto.prezzo_listino,
      sconto_pct_snapshot: prodotto.sconto_base_pct,
      prezzo_netto_unitario,
      subtotale,
    };
  });

  const totale_netto = round2(righe.reduce((acc, r) => acc + r.subtotale, 0));
  const servizioPct = getServizioPct();
  const totale_finale = round2(totale_netto * (1 + servizioPct / 100));

  return { righe, totale_netto, totale_finale };
}

module.exports = { round2, getServizioPct, prezzoNetto, calcolaOrdine };
