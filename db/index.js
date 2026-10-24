// Il database dell'app: Postgres (db/postgres/index.js). L'indirizzo si legge da DATABASE_URL (.env); se manca si prova un Postgres sul computer stesso
// (postgres://minuteria:minuteria@localhost:5432/minuteria). Gli altri moduli usano solo `db.prepare(sql).get/all/run(...valori)`, `db.transaction(...)`
// e `db.exec(sql)`: i valori non entrano mai nel testo della query (vedi db/postgres/index.js).
module.exports = require('./postgres');
