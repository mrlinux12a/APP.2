// Soglie dei limiti di richieste per indirizzo (express-rate-limit, vedi src/middleware/limiti.js). Ogni numero si può cambiare dal .env senza toccare il
// codice. I valori di partenza sono larghi di proposito: i telefoni di un cantiere o di un ufficio escono con lo stesso indirizzo di rete, e le pagine
// "chiedono" spesso (conti alla rovescia, notifiche): il limite serve a fermare chi inonda il sito, non chi lo usa.

// Legge un numero intero positivo dal .env; se manca o è scritto male vale `ripiego`.
function numeroDaAmbiente(nome, ripiego) {
  const n = Number(String(process.env[nome] || '').trim());
  return Number.isInteger(n) && n > 0 ? n : ripiego;
}

module.exports = {
  // Solo per le prove automatiche: LIMITE_RICHIESTE_DISATTIVATO=1 spegne tutti i limiti. Non va mai impostato sul server vero.
  disattivati: process.env.LIMITE_RICHIESTE_DISATTIVATO === '1',
  // Tutte le pagine e le API (non i file statici, non il webhook di Stripe): richieste al minuto per indirizzo.
  generale: { finestraMs: 60 * 1000, massimo: numeroDaAmbiente('LIMITE_RICHIESTE_AL_MINUTO', 1000) },
  // Accesso e registrazione (login, registrazione, recupero password; anche quelli dell'app): contano solo i tentativi andati male, in 15 minuti.
  // Si aggiunge ai limiti per nome utente di src/limite_login.js.
  accesso: { finestraMs: 15 * 60 * 1000, massimo: numeroDaAmbiente('LIMITE_ACCESSI_FALLITI', 60) },
  // Ricerche nel catalogo (ogni digitazione è una query sul database): richieste al minuto per indirizzo.
  ricerca: { finestraMs: 60 * 1000, massimo: numeroDaAmbiente('LIMITE_RICERCHE_AL_MINUTO', 300) },
  // Indirizzo dalla posizione (si appoggia a un servizio esterno, Nominatim, che chiede di non esagerare): richieste al minuto per indirizzo.
  indirizzo: { finestraMs: 60 * 1000, massimo: numeroDaAmbiente('LIMITE_INDIRIZZI_AL_MINUTO', 30) },
};
