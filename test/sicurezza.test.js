// Prove delle difese aggiunte dopo il test di sicurezza del 19/10/2026: redirect solo interni, caratteri NUL, limiti di tentativi e registrazioni,
// errori di input del database. Nessun DB né rete. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const radice = path.join(__dirname, '..');
const express = require('express');
const {
  leggiQuery, senzaNul, ripulisciNul, rifiutaNulNelPercorso, percorsoInterno, corpoSempreOggetto, gestoreNonTrovato, gestoreErrori,
} = require(path.join(radice, 'src/http'));
const limiti = require(path.join(radice, 'src/limite_login'));

test('percorsoInterno: solo percorsi di questo sito', () => {
  assert.equal(percorsoInterno('/carrello', '/x'), '/carrello');
  assert.equal(percorsoInterno('/categoria/raccorderia?sotto=a&p=2', '/x'), '/categoria/raccorderia?sotto=a&p=2');
  assert.equal(percorsoInterno('  /home ', '/x'), '/home');
  // Indirizzi assoluti, senza schema, con la barra rovesciata o con caratteri di controllo: ripiego.
  for (const cattivo of ['https://evil.example', 'http://evil.example/x', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example', 'evil.example',
    'javascript:alert(1)', '/ok\r\nLocation: https://evil.example', '/a\u0000b', '', '   ', null, undefined, 5, {}, ['/a']]) {
    assert.equal(percorsoInterno(cattivo, '/x'), '/x', JSON.stringify(cattivo));
  }
  assert.equal(percorsoInterno('https://evil.example'), '/', 'ripiego di default');
});

test('NUL: tolto da testi, query e corpo (anche annidato) prima di arrivare al database', () => {
  assert.equal(senzaNul('a\u0000b'), 'ab');
  assert.equal(senzaNul(5), 5);
  assert.deepEqual(ripulisciNul({ a: 'x\u0000y', 'k\u0000': ['1\u00002', { z: 'q\u0000' }], n: 3, v: null }), { a: 'xy', k: ['12', { z: 'q' }], n: 3, v: null });
  // Una profondità enorme non fa cadere il processo.
  let profondo = { v: 'a\u0000' };
  for (let i = 0; i < 5000; i++) profondo = { f: profondo };
  assert.doesNotThrow(() => ripulisciNul(profondo));
  const q = leggiQuery('q=a%00b&x=1');
  assert.equal(q.q, 'ab');
});

async function avvia() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(radice, 'views'));
  app.use(rifiutaNulNelPercorso);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(corpoSempreOggetto);
  app.get('/cat/:slug', (req, res) => res.json({ slug: req.params.slug }));
  app.post('/corpo', (req, res) => res.json({ corpo: req.body }));
  // Un errore di Postgres "valore non valido" (NUL, numero fuori misura): viene dall'input, quindi 400 e non 500.
  app.get('/pg/:codice', () => { const e = new Error('invalid input'); e.code = 'x'; throw e; });
  app.get('/pg22021', () => { const e = new Error('invalid byte sequence for encoding "UTF8": 0x00'); e.code = '22021'; throw e; });
  app.get('/pg22003', () => { const e = new Error('value out of range'); e.code = '22003'; throw e; });
  app.get('/pg23505', () => { const e = new Error('duplicate'); e.code = '23505'; throw e; });
  app.use(gestoreNonTrovato);
  app.use(gestoreErrori);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { base: 'http://127.0.0.1:' + server.address().port, chiudi: () => new Promise((r) => server.close(r)) };
}

test('%00 nel percorso = 400; nel corpo viene tolto', async () => {
  const { base, chiudi } = await avvia();
  try {
    assert.equal((await fetch(base + '/cat/a%00b')).status, 400);
    assert.equal((await fetch(base + '/cat/a%00')).status, 400);
    assert.equal((await fetch(base + '/cat/ok')).status, 200);
    const r = await fetch(base + '/corpo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x\u0000y', b: ['\u0000z'] }) });
    assert.deepEqual((await r.json()).corpo, { a: 'xy', b: ['z'] });
    const f = await fetch(base + '/corpo', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=x%00y' });
    assert.deepEqual((await f.json()).corpo, { a: 'xy' });
  } finally {
    await chiudi();
  }
});

test('errori di Postgres per un valore non valido = 400; gli altri restano 500', async () => {
  const { base, chiudi } = await avvia();
  const errori = console.error;
  const avvisi = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    assert.equal((await fetch(base + '/pg22021')).status, 400);
    assert.equal((await fetch(base + '/pg22003')).status, 400);
    assert.equal((await fetch(base + '/pg23505')).status, 500);
  } finally {
    console.error = errori;
    console.warn = avvisi;
    await chiudi();
  }
});

const richiesta = (ip) => ({ ip });

test('accesso: otto errori per utente e indirizzo, poi si blocca; l’accesso riuscito azzera solo quella coppia', () => {
  limiti.svuotaTutto();
  const r = richiesta('10.0.0.1');
  for (let i = 0; i < 7; i++) limiti.registraAccessoFallito(r, 'rossi');
  assert.equal(limiti.accessoBloccato(r, 'rossi'), false);
  limiti.registraAccessoFallito(r, 'rossi');
  assert.equal(limiti.accessoBloccato(r, 'rossi'), true, 'ottavo errore: bloccato');
  assert.equal(limiti.accessoBloccato(r, 'ROSSI'), true, 'maiuscole e minuscole contano uguale');
  assert.equal(limiti.accessoBloccato(r, 'bianchi'), false, 'un altro utente dallo stesso indirizzo non è bloccato');
  assert.equal(limiti.accessoBloccato(richiesta('10.0.0.2'), 'rossi'), false, 'un altro indirizzo non è bloccato');
  limiti.accessoRiuscito(r, 'rossi');
  assert.equal(limiti.accessoBloccato(r, 'rossi'), false);
});

test('accesso: password spraying (una password su molti utenti dallo stesso indirizzo) si ferma al limite per indirizzo', () => {
  limiti.svuotaTutto();
  const r = richiesta('10.0.0.9');
  for (let i = 0; i < limiti.MAX_TENTATIVI_PER_INDIRIZZO - 1; i++) limiti.registraAccessoFallito(r, 'utente' + i);
  assert.equal(limiti.accessoBloccato(r, 'utente-nuovo'), false);
  limiti.registraAccessoFallito(r, 'ultimo');
  assert.equal(limiti.accessoBloccato(r, 'utente-nuovo'), true, 'tutto l’indirizzo è bloccato, anche per un utente mai provato');
  assert.equal(limiti.accessoBloccato(richiesta('10.0.0.10'), 'utente-nuovo'), false);
  // Un accesso riuscito non ripulisce i tentativi sugli altri utenti.
  limiti.accessoRiuscito(r, 'utente0');
  assert.equal(limiti.accessoBloccato(r, 'utente-nuovo'), true);
});

test('registrazioni: dodici all’ora per indirizzo', () => {
  limiti.svuotaTutto();
  const r = richiesta('10.0.0.20');
  for (let i = 0; i < limiti.MAX_ISCRIZIONI_PER_INDIRIZZO - 1; i++) limiti.registraIscrizione(r);
  assert.equal(limiti.iscrizioneBloccata(r), false);
  limiti.registraIscrizione(r);
  assert.equal(limiti.iscrizioneBloccata(r), true);
  assert.equal(limiti.iscrizioneBloccata(richiesta('10.0.0.21')), false);
  limiti.svuotaTutto();
});

test('creaLimite: la finestra scade e il contatore riparte', async () => {
  const l = limiti.creaLimite({ finestraMs: 40, massimo: 2 });
  l.registra('k');
  l.registra('k');
  assert.equal(l.colpito('k'), true);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(l.colpito('k'), false);
  l.registra('k');
  assert.equal(l.colpito('k'), false);
});
