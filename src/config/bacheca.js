// Soglie dei tempi della home del banco. Passano alla pagina come data-soglia-* (views/distributore_richieste.ejs): il server disegna le classi
// iniziali e lo script di public/app.js le aggiorna ogni secondo con gli stessi numeri.
const BACHECA = {
  urgenteSec: 180, // richiesta da confermare: negli ultimi 3 minuti anello e timer diventano rossi
  nuovaSec: 180, // ...e per i primi 3 minuti ha l'etichetta "Nuova"
  appenaSec: 20, // arrivata da meno di 20 secondi: la scheda entra con un'animazione
  arrivoVicinoMin: 15, // pagina dell'ordine: sotto i 15 minuti al ritiro il riquadro "Ritiro" è rosso (la scheda "Da preparare" della home è sempre verde dal 21/10/2026)
  righeVisibili: 3, // articoli mostrati su una scheda, gli altri sono "+N altri articoli"
};

module.exports = { BACHECA };
