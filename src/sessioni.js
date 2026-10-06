const session = require('express-session');
const db = require('../db');

// Archivio di sessione su Postgres.
// Usa la tabella "session" creata da schema.pg.sql (connect-pg-simple compatibile).

const DURATA_PREDEFINITA = 1000 * 60 * 60 * 24 * 30; // 30 giorni

const INTERVALLO_TOUCH_MS = 10 * 60 * 1000;

class ArchivioSqlite extends session.Store {
  constructor() {
    super();
    this.ultimoTouch = new Map(); // sid -> istante dell'ultimo rinnovo scritto sul DB
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
    // then(esito, errore) e non then(...).catch(...): se la callback lancia, un .catch la richiamerebbe
    // una seconda volta con l'errore.
    db.prepare(sql).get(sid)
      .then(row => {
        if (!row) return callback(null, null);
        const sess = row.sess;
        if (typeof sess === 'string') {
          let letta;
          try { letta = JSON.parse(sess); } catch (e) { return callback(e); }
          return callback(null, letta);
        }
        return callback(null, sess);
      }, err => callback(err));
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
      .then(() => callback(null), err => callback(err));
  }

  // Con rolling: true express-session chiama touch a ogni richiesta e ASPETTA che finisca prima di
  // chiudere la risposta: un UPDATE sul DB (un giro di rete, ~50 ms) su ogni pagina. La scadenza
  // è a 30 giorni: rinnovarla al massimo ogni 10 minuti per sessione cambia solo di pochi
  // minuti quando scade, e toglie quell'attesa dal 99% delle richieste.
  touch(sid, sess, callback) {
    const adesso = Date.now();
    const ultimo = this.ultimoTouch.get(sid);
    if (ultimo && adesso - ultimo < INTERVALLO_TOUCH_MS) return callback(null);

    const isPg = !!process.env.DATABASE_URL;
    const expire = this.scadenza(sess);
    const expireParam = isPg ? expire : this.formatoSqlite(expire);
    db.prepare('UPDATE session SET expire = ? WHERE sid = ?').run(expireParam, sid)
      .then(() => {
        this.ultimoTouch.set(sid, adesso);
        if (this.ultimoTouch.size > 5000) {
          for (const [k, v] of this.ultimoTouch) if (adesso - v >= INTERVALLO_TOUCH_MS) this.ultimoTouch.delete(k);
        }
        callback(null);
      }, err => callback(err));
  }

  destroy(sid, callback) {
    // express-session può chiamarla senza callback (req.session.destroy()): senza questa riga, il
    // `callback(null)` sotto lanciava un TypeError dentro la promessa.
    const fine = typeof callback === 'function' ? callback : () => {};
    this.ultimoTouch.delete(sid);
    db.prepare('DELETE FROM session WHERE sid = ?').run(sid)
      .then(() => fine(null), err => fine(err || null));
  }

  pulisci() {
    const isPg = !!process.env.DATABASE_URL;
    const sql = isPg ? 'DELETE FROM session WHERE expire < NOW()' : "DELETE FROM session WHERE expire < datetime('now')";
    db.prepare(sql).run().catch(() => {});
  }
}

module.exports = { ArchivioSqlite };
