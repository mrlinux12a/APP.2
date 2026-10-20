// Prove del recupero della password (src/recupero_password.js) e della sua email (src/email.js). DB finto in memoria con la tabella dei link e un trasporto
// di posta finto: nessun accesso al database vero e nessuna email vera. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bcrypt = require('bcryptjs');

// ---------------- DB finto ----------------
let utenti = [];
let link = []; // righe di recupero_password: { id, user_id, token_hash, usato, scaduto }
const scritture = []; // le altre scritture che ci interessano
let prossimoId = 1;
let concorrente = false; // simula un secondo invio che usa il link un istante prima

const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = (modo, p) => {
      if (/^SELECT id, username, email, referente, ragione_sociale FROM users WHERE ruolo = 'cliente' AND attivo = 1/.test(s)) {
        const cerca = String(p[0]).toLowerCase();
        return utenti
          .filter((u) => u.ruolo === 'cliente' && u.attivo === 1 && (u.username.toLowerCase() === cerca || (u.email !== '' && u.email.toLowerCase() === String(p[1]).toLowerCase())))
          .sort((a, b) => a.id - b.id)
          .slice(0, Number((/LIMIT (\d+)/.exec(s) || [])[1] || 99));
      }
      if (/^UPDATE recupero_password SET usato_il = NOW\(\) WHERE user_id = \? AND usato_il IS NULL/.test(s)) {
        let n = 0;
        for (const l of link) if (l.user_id === p[0] && !l.usato) { l.usato = true; n++; }
        return { changes: n };
      }
      if (/^INSERT INTO recupero_password \(user_id, token_hash, scade_il\)/.test(s)) {
        link.push({ id: prossimoId++, user_id: p[0], token_hash: p[1], usato: false, scaduto: false, scade_sql: s });
        return { changes: 1 };
      }
      if (/^SELECT r\.id AS recupero_id, u\.id, u\.username FROM recupero_password r JOIN users u/.test(s)) {
        const l = link.find((x) => x.token_hash === p[0] && !x.usato && !x.scaduto);
        const u = l && utenti.find((x) => x.id === l.user_id && x.attivo === 1 && x.ruolo === 'cliente');
        return u ? { recupero_id: l.id, id: u.id, username: u.username } : null;
      }
      if (/^UPDATE recupero_password SET usato_il = NOW\(\) WHERE id = \? AND usato_il IS NULL AND scade_il > NOW\(\)/.test(s)) {
        const l = link.find((x) => x.id === p[0]);
        if (concorrente) { l.usato = true; concorrente = false; }
        if (!l || l.usato || l.scaduto) return { changes: 0 };
        l.usato = true;
        return { changes: 1 };
      }
      if (/^(UPDATE users SET password_hash|DELETE FROM session|UPDATE app_tokens)/.test(s)) { scritture.push({ s, p }); return { changes: 1 }; }
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 110));
    };
    return { get: async (...p) => esegui('get', p) || null, all: async (...p) => esegui('all', p), run: async (...p) => esegui('run', p) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const recupero = require('../src/recupero_password');
const email = require('../src/email');

const utente = (id, extra = {}) => ({ id, ruolo: 'cliente', attivo: 1, username: 'utente' + id, email: `utente${id}@example.com`, referente: 'Mario Rossi', ragione_sociale: 'Rossi Impianti', ...extra });
function prepara(lista = [utente(1)]) {
  utenti = lista;
  link = [];
  scritture.length = 0;
  prossimoId = 1;
  concorrente = false;
}
const BASE = 'https://minuteria.example';
const inviate = [];
const invia = async (d) => { inviate.push(d); return { inviata: true }; };
const codiceDi = (d) => d.link.slice((BASE + '/reimposta-password/').length);

// ---------------- richiedi ----------------

test('richiedi: per ogni account che corrisponde parte UNA email, all\'indirizzo SALVATO, con un link a /reimposta-password/<codice>; nel DB solo l\'hash', async () => {
  prepara([utente(1), utente(2, { username: 'altro', email: 'altro@example.com' })]);
  inviate.length = 0;
  const { trovati, consegne } = await recupero.richiedi('utente1', { baseUrl: BASE, invia });
  assert.equal(trovati, 1);
  assert.deepEqual((await consegne).map((c) => [c.username, c.inviata]), [['utente1', true]]);
  assert.equal(inviate.length, 1);
  const d = inviate[0];
  assert.equal(d.a, 'utente1@example.com', 'sempre l\'indirizzo dell\'account, mai uno scritto da chi chiede');
  assert.equal(d.username, 'utente1');
  assert.equal(d.nome, 'Mario Rossi');
  assert.equal(d.validitaMin, 60);
  assert.match(d.link, /^https:\/\/minuteria\.example\/reimposta-password\/[A-Za-z0-9_-]{43}$/);
  // sul DB: l'hash SHA-256 del codice, MAI il codice; scade fra un'ora
  assert.equal(link.length, 1);
  assert.equal(link[0].token_hash, recupero.hashCodice(codiceDi(d)));
  assert.notEqual(link[0].token_hash, codiceDi(d));
  assert.match(link[0].scade_sql, /NOW\(\) \+ INTERVAL '60 minutes'/);
});

test('richiedi: si trova anche per email (maiuscole comprese); una mail per account, al massimo tre; i link vecchi non valgono più', async () => {
  prepara([utente(1, { email: 'Condivisa@Example.com' }), utente(2, { email: 'condivisa@example.com' }), utente(3, { email: 'condivisa@example.com' }), utente(4, { email: 'condivisa@example.com' })]);
  inviate.length = 0;
  const { trovati, consegne } = await recupero.richiedi('CONDIVISA@example.COM', { baseUrl: BASE, invia });
  assert.equal(trovati, 3, 'tre account al massimo: niente inondazione');
  assert.deepEqual((await consegne).map((c) => c.username), ['utente1', 'utente2', 'utente3']);
  assert.equal(link.length, 3);
  // una seconda richiesta annulla i link precedenti dello stesso account
  const primo = link[0];
  await (await recupero.richiedi('utente1', { baseUrl: BASE, invia })).consegne;
  assert.equal(primo.usato, true, 'il link di prima non vale più');
  assert.equal(link.filter((l) => l.user_id === 1 && !l.usato).length, 1, 'vale solo l\'ultimo');
});

test('richiedi: account che non esiste, senza email, disattivato, di un altro ruolo, o senza APP_URL: nessuna email e nessuna differenza per chi chiede', async () => {
  prepara([utente(1, { email: '' }), utente(2, { attivo: 0 }), utente(3, { ruolo: 'distributore' }), utente(4, { email: 'non-valida' })]);
  inviate.length = 0;
  for (const chi of ['nessuno', 'utente1', 'utente2', 'utente3', 'utente4', '', '   ', null, undefined, ['utente1'], { username: 'x' }]) {
    const r = await recupero.richiedi(chi, { baseUrl: BASE, invia });
    assert.equal(r.trovati, 0, String(chi));
    assert.deepEqual(await r.consegne, []);
  }
  assert.equal(inviate.length, 0);
  assert.equal(link.length, 0);

  // senza indirizzo del sito (APP_URL) il link si genera ma NON si manda: un host scelto da chi chiede permetterebbe di rubare il codice
  prepara();
  const errori = [];
  const errOriginale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    const r = await recupero.richiedi('utente1', { baseUrl: '', invia });
    assert.deepEqual(await r.consegne, [{ username: 'utente1', link: '', inviata: false }]);
  } finally {
    console.error = errOriginale;
  }
  assert.equal(inviate.length, 0);
  assert.match(errori[0], /APP_URL/);
});

test('richiedi: se l\'invio fallisce, chi chiede non lo sa (mai un\'eccezione) e il guasto va nel log', async () => {
  prepara();
  const errori = [];
  const errOriginale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    const r = await recupero.richiedi('utente1', { baseUrl: BASE, invia: async () => { throw new Error('SMTP giù'); } });
    assert.equal(r.trovati, 1);
    assert.deepEqual(await r.consegne, []);
  } finally {
    console.error = errOriginale;
  }
  assert.match(errori[0], /SMTP giù/);
});

// ---------------- accountDaCodice / reimposta ----------------

async function nuovoLink(userId = 1) {
  inviate.length = 0;
  await (await recupero.richiedi('utente' + userId, { baseUrl: BASE, invia })).consegne;
  return codiceDi(inviate[inviate.length - 1]);
}

test('accountDaCodice: vale solo un codice fatto come i nostri, non scaduto, non usato, di un cliente attivo', async () => {
  prepara();
  const codice = await nuovoLink();
  assert.deepEqual(await recupero.accountDaCodice(codice), { recupero_id: 1, id: 1, username: 'utente1' });
  // inventato, troppo corto/lungo, con caratteri strani, non testo: non si cerca nemmeno nel DB
  for (const cattivo of ['', 'abc', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '!', "' OR 1=1 --", null, undefined, 123, ['x'], { a: 1 }]) {
    assert.equal(await recupero.accountDaCodice(cattivo), null, String(cattivo));
  }
  assert.equal(await recupero.accountDaCodice('A'.repeat(43)), null, 'ben fatto ma sconosciuto');
  link[0].scaduto = true;
  assert.equal(await recupero.accountDaCodice(codice), null, 'scaduto');
  link[0].scaduto = false;
  utenti[0].attivo = 0;
  assert.equal(await recupero.accountDaCodice(codice), null, 'account eliminato dopo la richiesta');
});

test('reimposta: cambia la password, chiude TUTTE le sessioni e gli accessi dell\'app, e il link non vale più', async () => {
  prepara();
  const codice = await nuovoLink();
  scritture.length = 0;
  const r = await recupero.reimposta(codice, { nuova: 'nuovapass123', ripeti: 'nuovapass123' });
  assert.deepEqual(r, { ok: true, username: 'utente1' });
  assert.equal(scritture.length, 3);
  assert.match(scritture[0].s, /^UPDATE users SET password_hash = \? WHERE id = \?/);
  assert.ok(bcrypt.compareSync('nuovapass123', scritture[0].p[0]));
  assert.equal(scritture[0].p[1], 1);
  assert.deepEqual(scritture[1].p, ['1', ''], 'nessuna sessione da tenere: escono tutte');
  assert.match(scritture[2].s, /^UPDATE app_tokens SET revocato_il = NOW\(\) WHERE user_id = \?/);
  assert.equal(link[0].usato, true);
  // un secondo uso dello stesso link (o di un altro link dello stesso account): non vale, nessuna scrittura
  scritture.length = 0;
  assert.deepEqual(await recupero.reimposta(codice, { nuova: 'altra-pass-456', ripeti: 'altra-pass-456' }), { ok: false, nonValido: true });
  assert.equal(scritture.length, 0);
});

test('reimposta: con campi che non vanno il link NON si consuma (si riprova), e un link non valido non rivela niente', async () => {
  prepara();
  const codice = await nuovoLink();
  scritture.length = 0;
  let r = await recupero.reimposta(codice, { nuova: 'corta', ripeti: 'corta' });
  assert.equal(r.ok, false);
  assert.match(r.errori.nuova, /almeno 8/);
  r = await recupero.reimposta(codice, { nuova: 'nuovapass123', ripeti: 'diversa456789' });
  assert.match(r.errori.ripeti, /non coincidono/);
  r = await recupero.reimposta(codice, undefined);
  assert.equal(r.ok, false);
  r = await recupero.reimposta(codice, { nuova: ['nuovapass123'], ripeti: ['nuovapass123'] });
  assert.equal(r.ok, false, 'un array dal modulo non vale come password');
  assert.equal(scritture.length, 0);
  assert.equal(link[0].usato, false, 'ancora valido');
  assert.deepEqual(await recupero.reimposta('inventato', { nuova: 'nuovapass123', ripeti: 'nuovapass123' }), { ok: false, nonValido: true });
  // il link buono funziona ancora dopo gli errori
  assert.equal((await recupero.reimposta(codice, { nuova: 'nuovapass123', ripeti: 'nuovapass123' })).ok, true);
});

test('reimposta: due invii insieme non cambiano la password due volte (il link si consuma nella stessa transazione)', async () => {
  prepara();
  const codice = await nuovoLink();
  scritture.length = 0;
  concorrente = true; // un altro invio ha usato il link fra il controllo e la scrittura
  const r = await recupero.reimposta(codice, { nuova: 'nuovapass123', ripeti: 'nuovapass123' });
  assert.deepEqual(r, { ok: false, nonValido: true });
  assert.equal(scritture.length, 0, 'la password non è stata toccata');
});

// ---------------- Email ----------------

test('email di recupero: link, nome utente e validità nelle due versioni; niente HTML dai dati; non lancia mai', async () => {
  const d = { a: 'utente1@example.com', username: 'rossi<b>', nome: 'Mario "Rossi" <script>', link: BASE + '/reimposta-password/' + 'A'.repeat(43), validitaMin: 60 };
  const html = email.htmlRecuperoPassword(d);
  const testo = email.testoRecuperoPassword(d);
  assert.match(html, /<a href="https:\/\/minuteria\.example\/reimposta-password\/A{43}"[^>]*>Scegli una nuova password<\/a>/);
  assert.match(html, /Nome utente: rossi&lt;b&gt;/);
  assert.doesNotMatch(html, /<script>|<b>/, 'i dati arrivano da fuori: escapati');
  assert.match(html, /Il link vale 60 minuti e si può usare una volta sola/);
  assert.match(html, /Se non l’hai chiesto tu, ignora questa email/);
  assert.match(testo, /^Reimposta la password/);
  assert.match(testo, new RegExp('Nome utente: rossi<b>'));
  assert.ok(testo.includes(d.link));
  assert.match(email.oggettoRecuperoPassword(), /^Reimposta la password · /);

  // invio con un trasporto finto: parte con oggetto, html e testo
  const spedite = [];
  email.impostaTrasporto({ sendMail: async (o) => { spedite.push(o); } });
  try {
    const r = await email.inviaRecuperoPassword(d);
    assert.equal(r.inviata, true);
    assert.equal(spedite[0].to, 'utente1@example.com');
    assert.match(spedite[0].subject, /Reimposta la password/);
    assert.ok(spedite[0].html.includes('/reimposta-password/'));
    // indirizzo non valido: niente invio, niente eccezione
    assert.equal((await email.inviaRecuperoPassword({ ...d, a: 'non-valido' })).inviata, false);
    assert.equal(spedite.length, 1);
    // un trasporto che esplode non fa esplodere chi chiama
    email.impostaTrasporto({ sendMail: async () => { throw new Error('rifiutata'); } });
    const errOriginale = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await email.inviaRecuperoPassword(d), { inviata: false, motivo: 'rifiutata' });
    } finally {
      console.error = errOriginale;
    }
  } finally {
    email.impostaTrasporto(null);
  }
});
