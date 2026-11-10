// Soglie dei tempi della home del banco. Passano alla pagina come data-soglia-* (views/banco/richieste.ejs): il server disegna le classi
// iniziali e lo script di assets/js le aggiorna ogni secondo con gli stessi numeri.
const BACHECA = {
  urgenteSec: 120, // richiesta da confermare: negli ultimi 2 minuti timer e barra diventano rossi (restyling del 10/11/2026: prima 3 minuti, e per i primi 3 c'era l'etichetta "Nuova", tolta)
  appenaSec: 20, // arrivata da meno di 20 secondi: la scheda entra con un'animazione
  arrivoVicinoMin: 15, // pagina dell'ordine: sotto i 15 minuti al ritiro il riquadro "Ritiro" è rosso (la scheda "Da preparare" della home è sempre verde dal 21/10/2026)
  righeVisibili: 3, // articoli mostrati su una scheda, gli altri sono "+N altri articoli"
};

module.exports = { BACHECA };
