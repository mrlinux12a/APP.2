const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Usa il modulo SQLite integrato in Node.js (>= 22.5): nessuna dipendenza nativa da compilare,
// più semplice da installare su qualsiasi hosting/ambiente per un MVP come questo.
const DB_PATH = path.join(__dirname, 'minuteria.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Piccolo helper per eseguire più operazioni in una transazione (BEGIN/COMMIT/ROLLBACK),
// equivalente minimale a db.transaction() di better-sqlite3.
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

module.exports = db;
