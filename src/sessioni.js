const session = require('express-session');
const db = require('../db');

// Archivio di sessione su SQLite.
// Quello predefinito di express-session tiene tutto in memoria: a ogni riavvio del
// server gli utenti si ritrovano scollegati (ed era il motivo per cui l'accesso "non
// restava"). Qui le sessioni vivono nello stesso file del resto dei dati.

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    dati TEXT NOT NULL,
    scade_il INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_scadenza ON sessions(scade_il);
`);

const DURATA_PREDEFINITA = 1000 * 60 * 60 * 24 * 30; // 30 giorni

class ArchivioSqlite extends session.Store {
  constructor() {
    super();
    this.pulisci();
    // Una passata di pulizia ogni ora basta e avanza.
    this.timer = setInterval(() => this.pulisci(), 60 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  scadenza(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return Date.now() + DURATA_PREDEFINITA;
  }

  get(sid, callback) {
    try {
      const riga = db.prepare('SELECT dati, scade_il FROM sessions WHERE sid = ?').get(sid);
      if (!riga) return callback(null, null);
      if (riga.scade_il < Date.now()) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }
      return callback(null, JSON.parse(riga.dati));
    } catch (err) {
      return callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      db.prepare(
        `INSERT INTO sessions (sid, dati, scade_il) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET dati = excluded.dati, scade_il = excluded.scade_il`
      ).run(sid, JSON.stringify(sess), this.scadenza(sess));
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      db.prepare('UPDATE sessions SET scade_il = ? WHERE sid = ?').run(this.scadenza(sess), sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  pulisci() {
    try {
      db.prepare('DELETE FROM sessions WHERE scade_il < ?').run(Date.now());
    } catch (err) {
      // La pulizia non è critica: se fallisce si riprova al giro dopo.
    }
  }
}

module.exports = { ArchivioSqlite };
