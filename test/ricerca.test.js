// Prove della ricerca del catalogo (src/catalogo.js, cercaProdotti): il limite conta le schede (non le righe), singolare e plurale si
// trovano a vicenda, i refusi si correggono solo quando la ricerca esatta trova pochissimo e senza pescare parole senza rapporto.
// Il DB è finto: si guardano le query e si rispondono righe costruite. Nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const registro = []; // { sql, params } di ogni query
let risposte = []; // funzione (sql, params) -> righe, impostata da ogni prova
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const esegui = async (...params) => {
      registro.push({ sql: s, params });
      return risposte(s, params);
    };
    return { all: esegui, get: async (...p) => (await esegui(...p))[0] || null, run: async () => ({ changes: 0 }) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const catalogo = require('../src/catalogo');
const { radiceParola, terminiPerRefusi, corrispondeConRefusi } = catalogo._prova;

const prodotto = (id, nome, extra = {}) => ({
  id, nome, codice: 'C' + id, categoria: 'Raccordi', ean: '', macro_slug: 'raccorderia', brand_slug: null,
  prezzo_listino: 10, sconto_base_pct: 0, gruppo_id: null, disponibilita: 'disponibile', raee: 0, ...extra,
});
const prova = (f) => async () => { registro.length = 0; risposte = () => []; await f(); };

test('radiceParola: senza la vocale finale da 5 lettere, "doccia"/"docce" si incontrano; numeri e parole corte restano', () => {
  assert.equal(radiceParola('valvole'), 'valvol');
  assert.equal(radiceParola('valvola'), 'valvol');
  assert.equal(radiceParola('raccordi'), 'raccord');
  assert.equal(radiceParola('adattatori'), 'adattator');
  assert.equal(radiceParola('doccia'), 'docc');
  assert.equal(radiceParola('docce'), 'docc');
  assert.equal(radiceParola('tubi'), 'tubi', 'a 4 lettere la radice "tub" prenderebbe quasi tutto');
  assert.equal(radiceParola('ada'), 'ada');
  assert.equal(radiceParola('dn50'), 'dn50');
  assert.equal(radiceParola('3/4'), '3/4');
  assert.equal(radiceParola('adatt'), 'adatt', 'finisce per consonante: resta uguale');
});

test('terminiPerRefusi: solo parole di lettere da 4 in su, non le misure né le parole-comando', () => {
  assert.deepEqual(terminiPerRefusi('valvla sfera 3/4 dn50 ab'), ['valvla', 'sfera']);
  assert.deepEqual(terminiPerRefusi('diametro 20 pollici'), []);
  assert.deepEqual(terminiPerRefusi(''), []);
});

test('corrispondeConRefusi: un refuso vero sì, una parola senza rapporto no (era il difetto: "adattatore" trovava "contatore")', () => {
  const riga = (nome) => prodotto(1, nome);
  assert.equal(corrispondeConRefusi(riga('Valvola A Sfera 1/2'), ['valvla']), true, 'una lettera mancante');
  assert.equal(corrispondeConRefusi(riga('Raccordo Diritto'), ['racordo']), true, 'consonante doppia');
  assert.equal(corrispondeConRefusi(riga('Adattatore Femmina'), ['adatatore']), true);
  assert.equal(corrispondeConRefusi(riga('Adattatore Femmina'), ['adatattore']), true, 'lettere scambiate (2 modifiche, parola lunga)');
  assert.equal(corrispondeConRefusi(riga('Valvola A Sfera'), ['valvl']), true, 'parola scritta a metà con un errore');
  assert.equal(corrispondeConRefusi(riga('Contatore Woltmann Dn80'), ['adattatore']), false);
  assert.equal(corrispondeConRefusi(riga('Alimentatore D\'aria'), ['adattatore']), false);
  assert.equal(corrispondeConRefusi(riga('Scambiatore A Piastre'), ['adattatore']), false);
  assert.equal(corrispondeConRefusi(riga('Turbina Caldaia'), ['caldaia', 'valvola']), false, 'ogni parola deve avere il suo riscontro');
  assert.equal(corrispondeConRefusi(riga('Valvola A Sfera'), ['valvole']), true, 'plurale: la radice è nel nome');
});

test('un risultato con molte schede non tenta i refusi: una sola query, niente somiglianza', prova(async () => {
  risposte = () => Array.from({ length: 12 }, (_, i) => prodotto(i + 1, 'Adattatore ' + i));
  const r = await catalogo.cercaProdotti('adatt');
  assert.equal(r.length, 12);
  assert.equal(registro.length, 1);
  assert.ok(!/ricerca_simili|word_similarity/.test(registro[0].sql), 'ricerca esatta: parte di parola, nessuna somiglianza');
  assert.match(registro[0].sql, /ricerca_esatti/);
}));

test('il limite conta le schede: ne chiede una in più per sapere se ha tagliato, e `troncato` lo dice', prova(async () => {
  risposte = () => Array.from({ length: 101 }, (_, i) => prodotto(i + 1, 'Adattatore ' + i));
  const r = await catalogo.cercaProdotti('adatt');
  assert.equal(r.length, catalogo.LIMITE_RISULTATI);
  assert.equal(r.length, 100);
  assert.equal(r.troncato, true);
  assert.equal(registro[0].params[registro[0].params.length - 1], 101, 'LIMIT = limite + 1');
  // la deduplica per gruppo è PRIMA del limite (stessa query): una riga per gruppo, poi LIMIT
  assert.match(registro[0].sql, /ROW_NUMBER\(\) OVER \(PARTITION BY COALESCE\(s\.gruppo_id, -s\.id\)/);
  assert.match(registro[0].sql, /WHERE u\._rn = 1 ORDER BY u\._pri, u\.categoria, u\.nome, u\.prezzo_listino, u\.id LIMIT \?/);
  risposte = () => Array.from({ length: 100 }, (_, i) => prodotto(i + 1, 'Adattatore ' + i));
  assert.equal((await catalogo.cercaProdotti('adatt')).troncato, false, 'esattamente 100: non è tagliato');
  risposte = () => Array.from({ length: 7 }, (_, i) => prodotto(i + 1, 'Adattatore ' + i));
  assert.equal((await catalogo.cercaProdotti('adatt', { limite: 5 })).length, 5, 'il limite di chi chiama vale ancora');
}));

test('il plurale cerca la radice nel NOME e il termine intero ovunque (niente intera categoria "Rubinetteria" per "rubinetto")', prova(async () => {
  risposte = () => Array.from({ length: 12 }, (_, i) => prodotto(i + 1, 'Valvola ' + i));
  await catalogo.cercaProdotti('valvole');
  const q = registro[0];
  assert.ok(q.params.includes('valvol'), 'i candidati dell\'indice partono dalla radice');
  assert.match(q.sql, /\(ricerca_testo\(p\.nome, p\.codice, p\.categoria, p\.ean, p\.macro_slug, p\.brand_slug\) LIKE \? OR LOWER\(p\.nome\) LIKE \?\)/);
  assert.ok(q.params.includes('%valvole%') && q.params.includes('%valvol%'));
}));

test('pochissimi risultati esatti: si tentano i refusi, si tengono solo le parole vicine e si rileggono le righe intere dei soli tenuti', prova(async () => {
  const esatti = [prodotto(1, 'Valvla Strana')];
  const candidati = [
    { id: 10, nome: 'Valvola A Sfera 1/2', codice: 'C10', categoria: 'Valvole', ean: '', macro_slug: 'raccorderia', brand_slug: null },
    { id: 11, nome: 'Valigia Con Ganasce', codice: 'C11', categoria: 'Utensili', ean: '', macro_slug: 'utensili', brand_slug: null },
    { id: 12, nome: 'Valvola Di Ritegno', codice: 'C12', categoria: 'Valvole', ean: '', macro_slug: 'raccorderia', brand_slug: null },
  ];
  risposte = (sql) => {
    if (/ANY\(\?::int\[\]\)/.test(sql)) return [prodotto(12, 'Valvola Di Ritegno'), prodotto(10, 'Valvola A Sfera 1/2')];
    if (/ricerca_simili/.test(sql)) return candidati;
    return esatti;
  };
  const r = await catalogo.cercaProdotti('valvla');
  assert.equal(registro.length, 3, 'esatta, con i refusi (solo testo), righe intere');
  assert.ok(/ricerca_simili/.test(registro[1].sql) && /word_similarity/.test(registro[1].sql));
  assert.ok(!/JOIN products p ON p\.id = r\.id/.test(registro[1].sql), 'il secondo passo non legge righe intere');
  assert.deepEqual(registro[2].params, [[10, 12]], 'solo gli id tenuti ("Valigia" scartata), nell\'ordine in cui sono');
  assert.deepEqual(r.map((x) => x.id), [10, 12], 'nell\'ordine della ricerca, non in quello del DB');
}));

test('refusi senza niente di vicino: restano i pochi risultati esatti (e non si fa una terza query)', prova(async () => {
  risposte = (sql) => (/ricerca_simili/.test(sql)
    ? [{ id: 20, nome: 'Contatore Woltmann', codice: 'C20', categoria: 'Contatori', ean: '', macro_slug: 'x', brand_slug: null }]
    : [prodotto(1, 'Adattatore Singolo')]);
  const r = await catalogo.cercaProdotti('adattatore');
  assert.deepEqual(r.map((x) => x.id), [1]);
  assert.equal(registro.length, 2);
}));

test('misure e parole corte non cercano refusi', prova(async () => {
  risposte = () => [];
  await catalogo.cercaProdotti('dn50 3/4');
  assert.equal(registro.length, 1, 'nessun secondo tentativo');
  await catalogo.cercaProdotti('ab');
  assert.equal(registro.length, 2);
}));

test('i caratteri speciali di LIKE valgono per sé: "%" e "_" non sono jolly; la sola punteggiatura non cerca niente', prova(async () => {
  risposte = () => [prodotto(1, 'Lega 50%')];
  assert.deepEqual(await catalogo.cercaProdotti('%%'), []);
  assert.deepEqual(await catalogo.cercaProdotti('-'), []);
  assert.deepEqual(await catalogo.cercaProdotti('  .  '), []);
  assert.deepEqual(await catalogo.cercaProdotti(''), []);
  assert.equal(registro.length, 0, 'nessuna query per una ricerca senza parole (prima "%%" leggeva tutto il catalogo)');
  await catalogo.cercaProdotti('50%');
  const q = registro[0];
  assert.ok(q.params.includes('50\\%'), 'il % cercato è escapato: ' + JSON.stringify(q.params));
  assert.ok(q.params.includes('50\\%%'), 'anche nel confronto di priorità (chi inizia con il testo)');
  await catalogo.cercaProdotti('a_c');
  assert.ok(registro[1].params.includes('a\\_c'), 'anche il _');
}));

test('"ø20", "dn50", "dn 50", "ø 20mm": la misura intera con un confine dopo il numero (non "Ø200")', prova(async () => {
  risposte = () => [prodotto(1, 'Curva Ø20')];
  for (const [scritto, atteso] of [['ø20', 'ø\\s?20(?!\\d)'], ['Ø20mm', 'ø\\s?20(?!\\d)'], ['dn50', 'dn\\s?50(?!\\d)'], ['dn 50', 'dn\\s?50(?!\\d)'], ['curva ø 25', 'ø\\s?25(?!\\d)']]) {
    registro.length = 0;
    await catalogo.cercaProdotti(scritto);
    assert.ok(registro[0].params.includes(atteso), `${scritto} -> ${atteso}: ${JSON.stringify(registro[0].params)}`);
    assert.match(registro[0].sql, /p\.nome ~\* \?/);
  }
}));
