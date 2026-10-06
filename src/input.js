// Lettura "a prova di valori strani" dei numeri che arrivano da form, query string e JSON. Un id o una
// quantità fuori misura (testo, array, 99999999999999) non deve arrivare al DB: lì diventa un errore
// "out of range" e l'utente vede un 500.

// Massimo di un int4 di Postgres: le colonne id sono di questo tipo.
const ID_MASSIMO = 2147483647;

// Tetto per la quantità di una riga di carrello. Per un articolo di minuteria è molto più di quanto si
// ordini in un colpo solo; serve a non scrivere nel DB (e nel totale) cifre senza senso.
const QUANTITA_MASSIMA = 9999;

// Id intero positivo, o 0 se il valore non lo è.
function leggiId(valore) {
  const id = parseInt(valore, 10);
  return Number.isInteger(id) && id > 0 && id <= ID_MASSIMO ? id : 0;
}

// Quantità intera tra 0 e QUANTITA_MASSIMA (0 se non è un numero).
function leggiQuantita(valore) {
  const n = parseInt(valore, 10);
  return Number.isFinite(n) ? Math.min(QUANTITA_MASSIMA, Math.max(0, n)) : 0;
}

module.exports = { ID_MASSIMO, QUANTITA_MASSIMA, leggiId, leggiQuantita };
