// Dispatcher: sceglie l'ambiente in base a DATABASE_URL
// - se DATABASE_URL è settato -> Postgres (Supabase)
// - altrimenti -> SQLite locale (db/minuteria.db)
if (process.env.DATABASE_URL) {
  module.exports = require('./postgres');
} else {
  module.exports = require('./sqlite');
}
