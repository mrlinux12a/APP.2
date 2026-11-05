// Aggiornamento in tempo reale (Server-Sent Events): eventi, orari e notifiche.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38475);
const {
  banco, base, biscotti, chiedi, erroriServer, form, json,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

test('eventi in tempo reale: GET /api/eventi è una connessione che resta aperta e riceve gli eventi del server (senza compressione); solo il cliente collegato', async () => {
  const eventi = require('../../src/logica/notifiche/eventi');
  // senza sessione: 401, non una connessione
  assert.equal((await fetch(base + '/api/eventi')).status, 401);

  const ac = new AbortController();
  const r = await chiedi('/api/eventi', { signal: ac.signal });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(r.headers.get('content-encoding'), null, 'compressa tratterrebbe i messaggi');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(r.headers.get('x-accel-buffering'), 'no');
  const lettore = r.body.getReader();
  const decodifica = new TextDecoder();
  let testo = '';
  const leggiFinche = async (modello) => {
    const scade = Date.now() + 3000;
    while (!modello.test(testo) && Date.now() < scade) {
      const { value, done } = await Promise.race([lettore.read(), new Promise((ok) => setTimeout(() => ok({ done: true }), 3000))]);
      if (done) break;
      testo += decodifica.decode(value);
    }
  };
  await leggiFinche(/retry: 5000/);
  assert.match(testo, /retry: 5000/);
  assert.equal(eventi.connessioniAperte(1), 1, 'il cliente di prova ha id 1');
  // il server scrive solo quando succede qualcosa: arriva subito
  assert.equal(eventi.emetti(1, 'consegnato', { ordine: 72 }), 1);
  await leggiFinche(/event: consegnato\ndata: \{"ordine":72\}\n\n/);
  assert.match(testo, /event: consegnato\ndata: \{"ordine":72\}\n\n/);
  assert.equal(eventi.emetti(999, 'consegnato', {}), 0, 'un altro utente non riceve niente');
  ac.abort();
  const scade = Date.now() + 2000;
  while (eventi.connessioniAperte(1) > 0 && Date.now() < scade) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(eventi.connessioniAperte(1), 0, 'chiusa la pagina, la connessione si toglie');
});

test('orari in tempo reale: quando il banco salva gli orari ogni installatore collegato riceve l\'evento "orari" (il banco no); le viste hanno le parti da sostituire e il timer', async () => {
  const eventi = require('../../src/logica/notifiche/eventi');
  const anagraficaBanco = require('../../src/logica/banco/anagrafica');
  biscotti.cookie = '';
  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  const ac = new AbortController();
  const r = await chiedi('/api/eventi', { signal: ac.signal });
  assert.equal(r.status, 200);
  const lettore = r.body.getReader();
  const decodifica = new TextDecoder();
  let testo = '';
  const leggiFinche = async (modello) => {
    const scade = Date.now() + 3000;
    while (!modello.test(testo) && Date.now() < scade) {
      const { value, done } = await Promise.race([lettore.read(), new Promise((ok) => setTimeout(() => ok({ done: true }), 3000))]);
      if (done) break;
      testo += decodifica.decode(value);
    }
  };
  try {
    await leggiFinche(/retry: 5000/);
    // il banco (altra sessione, qui una connessione finta registrata col suo ruolo) non riceve l'evento degli installatori
    const delBanco = [];
    const togliBanco = eventi.iscrivi(9, { write: (m) => delBanco.push(m), end() {} }, 'distributore');
    const tutti = { lun: [['07:30', '12:30']], mar: [], mer: [], gio: [], ven: [], sab: [], dom: [] };
    await anagraficaBanco.salvaOrari(2, tutti);
    await leggiFinche(/event: orari\ndata: \{\}\n\n/);
    assert.match(testo, /event: orari\ndata: \{\}\n\n/, 'l\'installatore collegato lo riceve subito');
    assert.deepEqual(delBanco, [], 'il banco no');
    togliBanco();

    // lo script lo ascolta e rilegge la pagina sostituendo solo le parti marcate
    const js = await (await fetch(base + '/app.js')).text();
    assert.match(js, /sorgente\.addEventListener\('orari', function \(\) \{ window\.dispatchEvent\(new Event\('minuteria:orari'\)\); \}\);/);
    assert.match(js, /window\.addEventListener\('minuteria:orari', rinfresca\);/);
    assert.match(js, /document\.querySelector\('\[data-orari-sync="' \+ nuova\.getAttribute\('data-orari-sync'\) \+ '"\]'\)/);
  } finally {
    ac.abort();
  }
  assert.equal(eventi.emettiARuolo('cliente', 'orari', {}) >= 0, true);

  // le viste: il carrello e la pagina degli orari hanno le parti da sostituire e, se lo stato cambia da solo, i secondi che mancano
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 50 }));
  let t = await (await chiedi('/carrello')).text();
  assert.match(t, /<div data-orari-sync="banner"( data-cambia-sec="\d+")?>/);
  assert.match(t, /<div class="barra-paga[^"]*" data-orari-sync="barra">/);
  const orariPagina = await (await chiedi('/orari')).text();
  assert.match(orariPagina, /<div data-orari-sync="pagina"/);
});

test('eventi in tempo reale: anche il banco apre la connessione e riceve l\'evento "notifica" (suono subito, anche a scheda nascosta); un agente no', async () => {
  const eventi = require('../../src/logica/notifiche/eventi');
  const salvato = biscotti.cookie;
  biscotti.cookie = '';
  banco.attivo = true;
  const ac = new AbortController();
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    const r = await chiedi('/api/eventi', { signal: ac.signal });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/event-stream/);
    const lettore = r.body.getReader();
    const decodifica = new TextDecoder();
    let testo = '';
    const leggiFinche = async (modello) => {
      const scade = Date.now() + 3000;
      while (!modello.test(testo) && Date.now() < scade) {
        const { value, done } = await Promise.race([lettore.read(), new Promise((ok) => setTimeout(() => ok({ done: true }), 3000))]);
        if (done) break;
        testo += decodifica.decode(value);
      }
    };
    await leggiFinche(/retry: 5000/);
    assert.equal(eventi.connessioniAperte(9), 1, 'l\'utente del banco di prova ha id 9');
    assert.equal(eventi.emetti(9, 'notifica', { id: 5, tipo: 'corriere_trovato' }), 1);
    await leggiFinche(/event: notifica\ndata: \{"id":5,"tipo":"corriere_trovato"\}\n\n/);
    assert.match(testo, /event: notifica\ndata: \{"id":5,"tipo":"corriere_trovato"\}\n\n/);
  } finally {
    ac.abort();
    const scade = Date.now() + 2000;
    while (eventi.connessioniAperte(9) > 0 && Date.now() < scade) await new Promise((ok) => setTimeout(ok, 20));
    await chiedi('/logout', { method: 'POST' });
    banco.attivo = false;
    biscotti.cookie = salvato;
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
