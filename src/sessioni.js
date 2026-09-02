const session = require('express-session');
const db = require('../db');

// Archivio di sessione su Postgres.
// Usa la tabella "session" creata da schema.pg.sql (connect-pg-simple compatibile).

const DURATA_PREDEFINITA = 1000 * 60 * 60 * 24 * 30; // 30 giorni

class ArchivioSqlite extends session.Store {
  constructor() {
    super();
    // crea tabella session se manca (per sqlite e postgres)
    const isPg = !!process.env.DATABASE_URL;
    const createSql = isPg
      ? `CREATE TABLE IF NOT EXISTS session (sid VARCHAR PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP NOT NULL)`
      : `CREATE TABLE IF NOT EXISTS session (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire TEXT NOT NULL)`;
    db.exec(createSql).catch(()=>{}).finally(()=> this.pulisci());
    this.timer = setInterval(() => this.pulisci(), 60 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  scadenza(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires);
    }
    return new Date(Date.now() + DURATA_PREDEFINITA);
  }

  // Formato compatibile con datetime('now') di SQLite ("YYYY-MM-DD HH:MM:SS"), così i
  // confronti WHERE expire > datetime('now') restano corretti anche testuali.
  formatoSqlite(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  get(sid, callback) {
    const isPg = !!process.env.DATABASE_URL;
    const sql = isPg ? 'SELECT sess FROM session WHERE sid = ? AND expire > NOW()' : "SELECT sess FROM session WHERE sid = ? AND expire > datetime('now')";
    db.prepare(sql).get(sid)
      .then(row => {
        if (!row) return callback(null, null);
        const sess = row.sess;
        if (typeof sess === 'string') {
          try { return callback(null, JSON.parse(sess)); } catch (e) { return callback(e); }
        }
        return callback(null, sess);
      })
      .catch(err => callback(err));
  }

  set(sid, sess, callback) {
    const isPg = !!process.env.DATABASE_URL;
    const expire = this.scadenza(sess);
    const expireParam = isPg ? expire : this.formatoSqlite(expire);
    const sessJson = JSON.stringify(sess);
    const sql = isPg
      ? `INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`
      : `INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`;
    db.prepare(sql).run(sid, sessJson, expireParam)
      .then(() => callback(null))
      .catch(err => callback(err));
  }

  touch(sid, sess, callback) {
    const isPg = !!process.env.DATABASE_URL;
    const expire = this.scadenza(sess);
    const expireParam = isPg ? expire : this.formatoSqlite(expire);
    db.prepare('UPDATE session SET expire = ? WHERE sid = ?').run(expireParam, sid)
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
    const isPg = !!process.env.DATABASE_URL;
    const sql = isPg ? 'DELETE FROM session WHERE expire < NOW()' : "DELETE FROM session WHERE expire < datetime('now')";
    db.prepare(sql).run().catch(() => {});
  }
}

module.exports = { ArchivioSqlite };
