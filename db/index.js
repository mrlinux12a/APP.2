// Dispatcher: sceglie l'ambiente in base a DATABASE_URL
// - se DATABASE_URL è settato -> Postgres (Supabase)
// - altrimenti -> SQLite locale (db/minuteria.db)
//
// Il require condizionale dentro l'if/else va male con alcuni bundler (es. quello usato
// da Vercel per le funzioni serverless): possono avvolgere il modulo CommonJS in
// { default: ... } durante l'interop ESM/CJS, facendo sparire i metodi (db.exec,
// db.prepare, ...) da "db" e facendo comparire solo "db.default". Il fallback sotto
// smaschera quel wrapping quando c'è, senza cambiare nulla quando non serve.
const scelto = process.env.DATABASE_URL ? require('./postgres') : require('./sqlite');
module.exports = scelto && typeof scelto.exec !== 'function' && scelto.default ? scelto.default : scelto;
