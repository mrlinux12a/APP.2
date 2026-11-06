// Un indirizzo di connessione a Postgres (postgres://utente:password@server:porta/database) scritto SENZA utente né password: si può mostrare a video e nei log.
// Serve a far vedere a quale database si collega un processo (l'avvio del server, gli script degli ambienti: docs/ambienti.md) senza far uscire il segreto.
// Ritorna «server:porta/database», o una stringa vuota se l'indirizzo manca o non si capisce.
function descriviIndirizzoDatabase(indirizzo) {
  try {
    const u = new URL(String(indirizzo || ''));
    if (!u.hostname) return '';
    return `${u.hostname}:${u.port || 5432}/${decodeURIComponent(u.pathname.replace(/^\//, ''))}`;
  } catch {
    return '';
  }
}

module.exports = { descriviIndirizzoDatabase };
