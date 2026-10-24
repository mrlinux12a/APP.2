// Guardia contro le iniezioni SQL: i valori che arrivano da fuori (indirizzo della richiesta, moduli, JSON, cookie) vanno SEMPRE nei parametri della query
// (`?` nel testo, trasformato in $1, $2... da db/postgres/index.js e mandato a Postgres come parametro), mai incollati nel testo SQL.
// Questa prova guarda tutto il backend: ogni `${...}` dentro una stringa SQL deve essere una di quelle verificate a mano qui sotto, cioè pezzi di query fatti
// SOLO di testo scritto da noi (nomi di colonna, condizioni con i loro `?`, costanti numeriche). Chi aggiunge un'interpolazione nuova fa fallire la prova e
// deve guardare con calma se dentro può finire qualcosa che arriva da fuori: se sì, usare un `?` e passare il valore come parametro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const radice = path.join(__dirname, '..');

// Le interpolazioni verificate. Ogni voce è il testo esatto dentro ${ ... }.
const PEZZI_DI_QUERY_VERIFICATI = new Set([
  // condizioni costruite aggiungendo testo scritto da noi, ognuna con i suoi `?` (i valori vanno nei parametri)
  "ids ? 'AND r.id = ANY(?::int[])' : ''",
  "distributorId === null ? '' : ' AND o.distributor_id = ?'",
  "incasso ? 'NOW()' : 'NULL'",
  "incasso && !candidati.length ? 'NOW()' : 'NULL'",
  "where.join(' AND ')",
  "dove.join(' AND ')",
  "doveLista.join(' AND ')",
  "candidati.join(' INTERSECT ')",
  "filtri.length ? 'WHERE ' + filtri.join(' AND ') : ''",
  "[...where, ...filtri].join(' AND ')",
  'where',
  // elenchi di `?` per `IN (...)`: un segnaposto per ogni valore, che resta nei parametri
  "ids.map(() => '?').join(',')",
  "idOrdini.map(() => '?').join(',')",
  "requestIds.map(() => '?').join(',')",
  'placeholders',
  // frammenti di SQL fissi (colonne, join, ordinamenti, condizioni di stato, orari del corriere)
  'alias',
  'colonne',
  'sorgente',
  'join',
  'interna',
  'ordine',
  "membriDelGruppo('r')",
  'OFFERTA_VISIBILE',
  'COLONNE_IMPORTI',
  'CONDIZIONE_STATO.da_preparare',
  'CONDIZIONE_STATO.in_consegna',
  'CONDIZIONE_STATO.consegnati',
  "orariCorriere.ritiroSql('o')",
  "orariCorriere.ritiroSql('')",
  // costanti numeriche del modulo (verificate sotto: devono essere `const NOME = <numero>`)
  'RICHIESTE_RECENTI',
  'MAX_ACCOUNT_PER_RICHIESTA',
  'VALIDITA_MIN',
  'TENTATIVI_MASSIMI',
  'LIMITE_LAVORI',
  'GIORNI_INATTIVITA',
  'MASSIMO_PER_UTENTE',
]);
const COSTANTI_NUMERICHE = ['RICHIESTE_RECENTI', 'MAX_ACCOUNT_PER_RICHIESTA', 'VALIDITA_MIN', 'TENTATIVI_MASSIMI', 'LIMITE_LAVORI', 'GIORNI_INATTIVITA', 'MASSIMO_PER_UTENTE'];

// Tutti i file JS del backend (server, src, db), senza node_modules.
function filesBackend(percorso) {
  const st = fs.statSync(percorso);
  if (st.isFile()) return /\.js$/.test(percorso) ? [percorso] : [];
  return fs.readdirSync(percorso).flatMap((nome) => (nome === 'node_modules' ? [] : filesBackend(path.join(percorso, nome))));
}

// Le interpolazioni dentro le stringhe SQL (template literal con SELECT / INSERT INTO / UPDATE x SET / DELETE FROM / WITH x AS).
function interpolazioniSql() {
  const trovate = [];
  const sorgenti = [path.join(radice, 'server.js'), path.join(radice, 'src'), path.join(radice, 'db')];
  for (const base of sorgenti) {
    for (const file of filesBackend(base)) {
      const testo = fs.readFileSync(file, 'utf8');
      const stringhe = /`((?:[^`\\]|\\.)*)`/gs;
      let m;
      while ((m = stringhe.exec(testo))) {
        const corpo = m[1];
        if (!/\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|WITH\s+\w+\s+AS)\b/i.test(corpo)) continue;
        for (const x of corpo.matchAll(/\$\{([^}]*)\}/g)) {
          trovate.push({ file: path.relative(radice, file).replace(/\\/g, '/'), riga: testo.slice(0, m.index).split('\n').length, espressione: x[1].trim() });
        }
      }
    }
  }
  return trovate;
}

test('nessuna query SQL incolla dentro il testo qualcosa che non sia un pezzo di query verificato', () => {
  const sconosciute = interpolazioniSql().filter((i) => !PEZZI_DI_QUERY_VERIFICATI.has(i.espressione));
  assert.deepEqual(
    sconosciute.map((i) => `${i.file}:${i.riga}  \${${i.espressione}}`),
    [],
    'Un valore che arriva da fuori non va mai dentro il testo SQL: usa un `?` e passalo come parametro. Se questo pezzo è fatto solo di testo scritto da noi, aggiungilo all\'elenco di questa prova.'
  );
});

test('le costanti numeriche usate dentro le query sono davvero numeri scritti nel codice', () => {
  const tutti = filesBackend(path.join(radice, 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const nome of COSTANTI_NUMERICHE) {
    assert.match(tutti, new RegExp('\\b(?:const|let)\\s+' + nome + '\\s*=\\s*[\\d_*\\s+()./-]+;'), nome + ' deve essere una costante numerica');
  }
});

test('db/postgres/index.js manda i valori come parametri: ogni ? diventa $1, $2... e i valori restano a parte', async () => {
  // Il wrapper è quello vero; la connessione è finta. Si guarda cosa arriva a pg: testo con $n e array di valori.
  const percorso = require.resolve('pg');
  const originale = require.cache[percorso];
  const chiamate = [];
  class PoolFinto {
    constructor() {}
    on() {}
    query(testo, valori) { chiamate.push({ testo, valori }); return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 }); }
    async connect() { return { query: (t, v) => { chiamate.push({ testo: t, valori: v }); return Promise.resolve({ rows: [], rowCount: 0 }); }, release() {} }; }
  }
  require.cache[percorso] = { id: percorso, filename: percorso, loaded: true, exports: { Pool: PoolFinto } };
  const wrapper = require.resolve('../db/postgres/index.js');
  delete require.cache[wrapper];
  try {
    const db = require('../db/postgres/index.js');
    const cattivo = "x'; DROP TABLE users; --";
    await db.prepare('SELECT * FROM users WHERE username = ? AND attivo = ?').get(cattivo, 1);
    await db.prepare('UPDATE users SET zona = ? WHERE id = ?').run(cattivo, 7);
    const viste = chiamate.filter((c) => /users/.test(c.testo));
    assert.equal(viste.length, 2);
    assert.match(viste[0].testo, /username = \$1 AND attivo = \$2/);
    assert.deepEqual(viste[0].valori, [cattivo, 1]);
    assert.match(viste[1].testo, /zona = \$1 WHERE id = \$2/);
    assert.deepEqual(viste[1].valori, [cattivo, 7]);
    for (const c of viste) assert.ok(!c.testo.includes('DROP TABLE'), 'il testo della query non contiene mai il valore');
  } finally {
    if (originale) require.cache[percorso] = originale; else delete require.cache[percorso];
    delete require.cache[wrapper];
  }
});
