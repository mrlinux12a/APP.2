// Preparazione del database all'avvio del server.
const db = require('../../db');

// Tiene sveglie le connessioni al database (solo Postgres, vedi db/postgres/index.js) e, se il database è vuoto (dopo un clone), lo riempie con i dati di
// prova: dopo un clone/pull basta `npm start`. Non aspetta niente e non blocca l'avvio: un guasto qui si scrive nel log.
function preparaDatabase() {
  // Connessioni al DB già aperte e tenute sveglie (solo Postgres): vedi db/postgres/index.js.
  if (typeof db.mantieniCalde === 'function') db.mantieniCalde();
  (async () => {
    try {
      await db.ensureInit();
      const r1 = await db.prepare('SELECT COUNT(*) n FROM products').get();
      const nProd = r1 ? Number(r1.n) : 0;
      if (nProd === 0) {
        console.log('DB vuoto -> eseguo seed automatico...');
        await require('../../db/seed');
      }
      // Il popolamento di distributor_products (prezzo/sconto per distributore) non è più automatico: con un catalogo reale da migliaia di articoli,
      // riempirlo con sconto 0% per tutti sarebbe dato finto, non un listino vero. Va fatto deliberatamente quando sono disponibili le condizioni reali
      // negoziate con ogni distributore.
    } catch (e) { console.error('auto-seed fallito', e.message); }
  })();
}

module.exports = { preparaDatabase };
