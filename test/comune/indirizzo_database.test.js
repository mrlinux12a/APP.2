// L'indirizzo del database scritto senza utente né password (src/comune/indirizzo_database.js): è quello che l'avvio del server scrive nel log e che gli script
// degli ambienti (docs/ambienti.md) mostrano a video. Nessun accesso al database né alla rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');

const { descriviIndirizzoDatabase } = require('../../src/comune/indirizzo_database');

test('mostra server, porta e nome del database', () => {
  assert.equal(descriviIndirizzoDatabase('postgres://utente:segreta@127.0.0.1:5433/minuteria'), '127.0.0.1:5433/minuteria');
  assert.equal(descriviIndirizzoDatabase('postgresql://utente:segreta@db.esempio.it/flash_app?sslmode=require'), 'db.esempio.it:5432/flash_app');
});

test('non lascia mai uscire utente né password', () => {
  const testo = descriviIndirizzoDatabase('postgres://flash_app:Segreta%21123@db.esempio.it:5432/flash_app');
  assert.ok(!testo.includes('Segreta'), testo);
  assert.ok(!testo.includes('flash_app:'), testo);
});

test('un indirizzo mancante o non valido dà una stringa vuota (chi la usa scrive il suo avviso)', () => {
  assert.equal(descriviIndirizzoDatabase(undefined), '');
  assert.equal(descriviIndirizzoDatabase(''), '');
  assert.equal(descriviIndirizzoDatabase('non è un indirizzo'), '');
});
