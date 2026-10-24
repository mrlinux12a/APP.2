const session = require('express-session');
const db = require('../db');

// Archivio delle sessioni su Postgres (compatibile con connect-pg-simple): ogni utente collegato è una riga della tabella "session" (db/postgres/schema.sql),
// così un riavvio del server non scollega nessuno.

const DURATA_PREDEFINITA = 1000 * 60 * 60 * 24 * 30; // 30 giorni

const INTERVALLO_TOUCH_MS = 10 * 60 * 1000;

// Dice a express-session come leggere, scrivere, rinnovare ed eliminare le sessioni nel database.
class ArchivioSessioni extends session.Store {
  // Prepara l'archivio: crea la tabella se manca, toglie le sessioni scadute e ripete la pulizia ogni ora.
  constructor() {
    super();
    this.ultimoTouch = new Map(); // sid -> istante dell'ultimo rinnovo scritto sul DB
    db.exec('CREATE TABLE IF NOT EXISTS session (sid VARCHAR PRIMARY KEY, sess JSON NOT NULL, expire TIMESTAMP NOT NULL)')
      .catch(() => {})
      .finally(() => this.pulisci());
    this.timer = setInterval(() => this.pulisci(), 60 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
  }

  // Dice fino a quando vale una sessione: la scadenza del suo cookie, o 30 giorni da adesso.
  scadenza(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires);
    }
    return new Date(Date.now() + DURATA_PREDEFINITA);
  }

  // Legge una sessione ancora valida dal database (o null se non c'è o è scaduta).
  get(sid, callback) {
    // then(esito, errore) e non then(...).catch(...): se la callback lancia, un .catch la richiamerebbe una seconda volta con l'errore.
    db.prepare('SELECT sess FROM session WHERE sid = ? AND expire > NOW()').get(sid)
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

  // Salva (o aggiorna) una sessione nel database, con la sua scadenza.
  set(sid, sess, callback) {
    db.prepare(
      `INSERT INTO session (sid, sess, expire) VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`
    ).run(sid, JSON.stringify(sess), this.scadenza(sess))
      .then(() => callback(null), err => callback(err));
  }

  // Rinnova la scadenza di una sessione. Con rolling: true express-session chiama touch a ogni richiesta e ASPETTA che finisca prima di chiudere la
  // risposta: un UPDATE sul DB (un giro di rete, ~50 ms) su ogni pagina. La scadenza è a 30 giorni: rinnovarla al massimo ogni 10 minuti per sessione
  // cambia solo di pochi minuti quando scade, e toglie quell'attesa dal 99% delle richieste.
  touch(sid, sess, callback) {
    const adesso = Date.now();
    const ultimo = this.ultimoTouch.get(sid);
    if (ultimo && adesso - ultimo < INTERVALLO_TOUCH_MS) return callback(null);

    db.prepare('UPDATE session SET expire = ? WHERE sid = ?').run(this.scadenza(sess), sid)
      .then(() => {
        this.ultimoTouch.set(sid, adesso);
        if (this.ultimoTouch.size > 5000) {
          for (const [k, v] of this.ultimoTouch) if (adesso - v >= INTERVALLO_TOUCH_MS) this.ultimoTouch.delete(k);
        }
        callback(null);
      }, err => callback(err));
  }

  // Cancella una sessione (uscita dall'account).
  destroy(sid, callback) {
    // express-session può chiamarla senza callback (req.session.destroy()): senza questa riga, il `callback(null)` sotto lanciava un TypeError dentro la
    // promessa.
    const fine = typeof callback === 'function' ? callback : () => {};
    this.ultimoTouch.delete(sid);
    db.prepare('DELETE FROM session WHERE sid = ?').run(sid)
      .then(() => fine(null), err => fine(err || null));
  }

  // Toglie dal database le sessioni scadute.
  pulisci() {
    db.prepare('DELETE FROM session WHERE expire < NOW()').run().catch(() => {});
  }
}

module.exports = { ArchivioSessioni };
