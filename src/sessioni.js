const session = require('express-session');
const db = require('../db');

// Archivio di sessione su Postgres.
// Usa la tabella "session" creata da schema.pg.sql (connect-pg-simple compatibile).

const DURATA_PREDEFINITA = 1000 * 60 * 60 * 24 * 30; // 30 giorni

class ArchivioSqlite extends session.Store {
  constructor() {
    super();
    this.pulisci();
    this.timer = setInterval(() => this.pulisci(), 60 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  scadenza(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires);
    }
    return new Date(Date.now() + DURATA_PREDEFINITA);
  }

  get(sid, callback) {
    db.prepare('SELECT sess FROM session WHERE sid = ? AND expire > NOW()').get(sid)
      .then(row => {
        if (!row) return callback(null, null);
        const sess = row.sess;
        // pg may return json object or string
        if (typeof sess === 'string') {
          try { return callback(null, JSON.parse(sess)); } catch (e) { return callback(e); }
        }
        return callback(null, sess);
      })
      .catch(err => callback(err));
  }

  set(sid, sess, callback) {
    const expire = this.scadenza(sess);
    // Use JSON stringify for pg JSON column
    const sessJson = JSON.stringify(sess);
    db.prepare(
      `INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`
    ).run(sid, sessJson, expire)
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  touch(sid, sess, callback) {
    const expire = this.scadenza(sess);
    db.prepare('UPDATE session SET expire = ? WHERE sid = ?').run(expire, sid)
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  destroy(sid, callback) {
    db.prepare('DELETE FROM session WHERE sid = ?').run(sid)
      .then(() => callback(null))
      .catch(err => callback(err || null));
    if (!callback) return;
  }

  pulisci() {
    db.prepare('DELETE FROM session WHERE expire < NOW()').run().catch(() => {});
  }
}

module.exports = { ArchivioSqlite };
