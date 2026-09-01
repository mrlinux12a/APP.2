// Dispatcher seed - sceglie postgres o sqlite in base a DATABASE_URL
if (process.env.DATABASE_URL) {
  module.exports = require('./postgres/seed.js');
  // esegui se chiamato direttamente (node db/seed.js)
  if (require.main === module) require('./postgres/seed.js');
} else {
  module.exports = require('./sqlite/seed.js');
  if (require.main === module) require('./sqlite/seed.js');
}
