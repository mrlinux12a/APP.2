// Banco: avvisi, suono, stato del banco, notifiche e freccia indietro.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const aiuti = require('./_aiuti/server_finto');
const { leggiComposto } = require('../../src/comune/asset_composti');

aiuti.avvia(38481);
const {
  avvisiBanco, banco, base, biscotti, chiedi, erroriServer, fa, form, json, ordine1295, preparaRichiesta, radice, richiestaProva,
} = aiuti;

// ---------- Avvisi del banco: pallino su "Banco", striscia sotto l'intestazione, stato-banco, notifiche nuove con i dati dell'avviso ----------

test('banco: pallino arancio su "Banco" in ogni pagina, striscia arancio solo fuori dalla home (col tempo della prima richiesta), icone; suoni e notifiche del computer NON stanno più nella tendina', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    const pagina = async (percorso) => (await chiedi(percorso)).text();
    const home = await pagina('/distributore');
    const clienti = await pagina('/distributore/clienti');
    const storico = await pagina('/distributore/storico');
    const richiesta = await pagina('/distributore/richieste/177'); // anche una pagina della richiesta non è la home

    // il pallino sta su "Banco" e c'è dappertutto, home compresa (lì le colonne mostrano già tutto, ma il numero resta sulla scheda)
    for (const [nome, t] of Object.entries({ home, clienti, storico })) {
      assert.match(t, /Banco\s*<span class="banco-voce-pallino banco-voce-pallino-ordini" data-banco-pallino aria-label="2 da confermare">2<\/span>/, nome);
      assert.match(t, /<header class="banco-testa" data-banco-testa data-ditta="BOREA">/, nome + ': lo script riconosce la pagina del banco');
      // la tendina ha "Anagrafica del banco" in cima; gli interruttori dei suoni e delle notifiche del computer sono nella pagina dell'anagrafica
      assert.match(t, /<a class="voce-anagrafica" href="\/distributore\/anagrafica">Anagrafica del banco<\/a>/, nome);
      assert.doesNotMatch(t, /data-suoni-voce|data-notifiche-sistema|Suoni notifiche|Attiva le notifiche del computer/, nome);
    }
    // sulla home niente striscia e niente icone degli avvisi a comparsa
    assert.doesNotMatch(home, /data-banco-avviso/);
    assert.doesNotMatch(home, /data-banco-avvisi-icone/);
    // fuori dalla home la striscia c'è, già col tempo scritto dal server (98 s = 01:38) e il pulsante "Vai al banco"
    for (const [nome, t] of Object.entries({ clienti, storico })) {
      assert.match(t, /<div class="banco-avviso" data-banco-avviso data-urgente-sec="120" role="status">/, nome);
      assert.match(t, /<strong data-avviso-conta>2 richieste da confermare<\/strong><span aria-hidden="true"> · la prima scade tra <strong class="banco-avviso-tempo" data-avviso-tempo data-secondi="98">01:38<\/strong><\/span>/, nome);
      assert.match(t, /<a class="banco-avviso-vai" href="\/distributore">Vai al banco /, nome);
      for (const icona of ['furgone', 'esclamativo', 'spunta', 'occhio', 'chiudi']) assert.match(t, new RegExp('<span data-icona="' + icona + '"><svg'), nome + ': icona ' + icona);
      // la striscia sta subito sotto l'intestazione
      assert.ok(t.indexOf('</header>') < t.indexOf('data-banco-avviso'), nome);
    }
    assert.match(richiesta, /data-banco-avviso/);

    // una richiesta sola: singolare; nessuna: pallino e striscia nascosti (ci sono nella pagina, lo script li accende quando arriva una richiesta)
    banco.daRispondere = 1;
    assert.match(await pagina('/distributore/clienti'), /<strong data-avviso-conta>1 richiesta da confermare<\/strong>/);
    banco.daRispondere = 0;
    const vuota = await pagina('/distributore/clienti');
    assert.match(vuota, /data-banco-pallino aria-label="0 da confermare" hidden>0<\/span>/);
    assert.match(vuota, /<div class="banco-avviso" data-banco-avviso data-urgente-sec="120" role="status" hidden>/);
    assert.match(await pagina('/distributore'), /data-banco-pallino aria-label="0 da confermare" hidden>0<\/span>/);
  } finally {
    banco.daRispondere = 2;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: GET /distributore/stato-banco dà numeri, prima scadenza e richieste ancora da confermare (solo per il banco, in JSON)', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    // senza accesso: 401 in JSON (non un redirect al login: il browser chiede ogni 15 secondi)
    let r = await chiedi('/distributore/stato-banco', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 401);
    // un installatore non ha il banco: 403
    assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
    r = await chiedi('/distributore/stato-banco', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 403);

    biscotti.cookie = '';
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    avvisiBanco.richieste = [
      { id: 12, cliente_nome: 'Bianchi Termoidraulica', secondi: 95, n_articoli: 1, n_pezzi: 1 },
      { id: 11, cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', secondi: 447, n_articoli: 2, n_pezzi: 3 },
    ];
    avvisiBanco.viste.length = 0;
    r = await chiedi('/distributore/stato-banco', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /json/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const d = await r.json();
    assert.equal(d.daConfermare, 2);
    assert.equal(d.primaScadeSec, 95, 'la più vicina alla scadenza');
    assert.equal(d.attesaCorriere, 1);
    assert.equal(d.daPreparare, 2);
    assert.deepEqual(d.ordini, [1280, 1281], 'gli ordini ancora da preparare: un avviso "Corriere trovato" sparisce quando il suo ordine è già partito');
    assert.equal(d.richieste.length, 2);
    assert.deepEqual(
      { ...d.richieste[0], scadeAlle: undefined },
      { id: 12, cliente: 'Bianchi Termoidraulica', articoli: 1, pezzi: 1, secondi: 95, finestraSec: 600, scadeAlle: undefined }
    );
    assert.match(d.richieste[0].scadeAlle, /^\d\d:\d\d$/);
    assert.equal(d.richieste[1].cliente, 'Rossi <b>Impianti</b> S.r.l.', 'i nomi viaggiano come testo: è lo script a non farne mai HTML');
    assert.deepEqual(avvisiBanco.viste[0].p, [2], 'solo le richieste della filiale dell\'utente');

    // nessuna richiesta: null, non zero
    avvisiBanco.richieste = [];
    banco.daRispondere = 0;
    const vuoto = await (await chiedi('/distributore/stato-banco', { headers: { accept: 'application/json' } })).json();
    assert.deepEqual([vuoto.daConfermare, vuoto.primaScadeSec, vuoto.richieste], [0, null, []]);
    assert.deepEqual(vuoto.ordini, [1280, 1281]);
  } finally {
    banco.daRispondere = 2;
    avvisiBanco.richieste = [];
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: /api/notifiche/push porta tipo, richiesta, ordine e i dati di ogni avviso; /api/notifiche/lette segna lette quelle dell\'utente', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    avvisiBanco.richieste = [{ id: 12, cliente_nome: 'Bianchi Termoidraulica', secondi: 95, n_articoli: 1, n_pezzi: 1 }];
    avvisiBanco.ordini = [
      // il corriere ha risposto alle 07:15 UTC scrivendo "preso 30": arriva dal banco alle 07:45 UTC (09:45 a Roma)
      { id: 1280, stato: 'inviato', consegnato_il: null, corriere_nome: 'Marco', corriere_risposto_il: new Date(Date.UTC(2026, 9, 19, 7, 15)), corriere_minuti: 30, cliente_nome: 'Rossi' },
      { id: 1281, stato: 'evaso', consegnato_il: '2026-10-19 19:21:00', corriere_nome: '', corriere_risposto_il: null, corriere_minuti: null, cliente_nome: 'Neri Impianti' },
    ];
    avvisiBanco.notifiche = [
      { id: 901, titolo: 'Nuova richiesta di disponibilità', testo: 'x', link: '/distributore/richieste/12', tipo: 'nuova_richiesta', request_id: 12, order_id: null, eta_sec: 2 },
      { id: 902, titolo: 'Nuovo ordine da preparare', testo: 'y', link: '/distributore/ordini/1280', tipo: 'corriere_trovato', request_id: 10, order_id: 1280, eta_sec: 3 },
      { id: 903, titolo: 'Ordine #1281 consegnato', testo: 'z', link: '/distributore/ordini/1281', tipo: 'ordine_consegnato', request_id: null, order_id: 1281, eta_sec: 4 },
      { id: 904, titolo: 'Altro', testo: 'w', link: null, tipo: null, request_id: null, order_id: null, eta_sec: 5 },
    ];
    let r = await chiedi('/api/notifiche/push', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 200);
    const n = (await r.json()).notifiche;
    assert.equal(n.length, 4);
    assert.deepEqual([n[0].tipo, n[0].request_id, n[0].richiesta.id, n[0].richiesta.cliente, n[0].richiesta.finestraSec], ['nuova_richiesta', 12, 12, 'Bianchi Termoidraulica', 600]);
    assert.deepEqual(n[1].ordine, { id: 1280, corriere: 'Marco', ritiroAlle: '09:45', daPreparare: true });
    assert.equal(n[1].order_id, 1280);
    assert.deepEqual(n[2].ordine, { id: 1281, cliente: 'Neri Impianti', alle: '21:21' });
    assert.equal(n[3].tipo, null);
    assert.equal(n[3].titolo, 'Altro');

    // "lette": solo id interi positivi, passati alla UPDATE insieme all'utente (un id altrui non conta: la UPDATE ha user_id). Oltre agli id delle
    // notifiche, la richiesta e l'ordine a cui si riferiscono: l'avviso sopravvive alle ricariche della pagina, che ne perdono gli id.
    avvisiBanco.lette.length = 0;
    r = await chiedi('/api/notifiche/lette', json({ ids: [901, 'x', -3, 903, 1.5], richieste: [12, 'y'], ordini: [1280] }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(avvisiBanco.lette.length, 1);
    assert.deepEqual(avvisiBanco.lette[0].slice(1), [[901, 903], [12], [1280]]);
    // solo la richiesta (avviso ricaricato, id perso)
    avvisiBanco.lette.length = 0;
    await chiedi('/api/notifiche/lette', json({ richieste: [12] }));
    assert.deepEqual(avvisiBanco.lette[0].slice(1), [[], [12], []]);
    // senza id validi non scrive niente
    avvisiBanco.lette.length = 0;
    assert.equal((await chiedi('/api/notifiche/lette', json({ ids: 'no' }))).status, 200);
    assert.equal(avvisiBanco.lette.length, 0);
    // senza accesso: 401
    biscotti.cookie = '';
    assert.equal((await chiedi('/api/notifiche/lette', json({ ids: [901] }))).status, 401);
  } finally {
    avvisiBanco.notifiche = [];
    avvisiBanco.ordini = [];
    avvisiBanco.richieste = [];
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: "Conferma" dall\'avviso a comparsa chiede JSON e non fa redirect; i form della home restano com\'erano', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const richiesteModulo = require(path.join(radice, 'src/logica/ordini/richieste'));
  const originale = richiesteModulo.rispondi;
  const chiamate = [];
  let esito = { ok: true };
  richiesteModulo.rispondi = async (id, distributorId, opzioni) => { chiamate.push({ id: String(id), distributorId, opzioni }); return esito; };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // dall'avviso: Accept JSON -> 200 con { ok: true }, risposta data al prezzo di richiesta
    let r = await chiedi('/distributore/richieste/12/rispondi', { ...form({ azione: 'prezzo_richiesto' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, errore: null });
    assert.equal(chiamate.length, 1);
    assert.equal(chiamate[0].id, '12');
    assert.equal(chiamate[0].distributorId, 2);
    assert.equal(chiamate[0].opzioni.prezzoRichiesto, true);
    assert.equal(chiamate[0].opzioni.rifiuta, false);

    // rifiutata (finestra chiusa, ha già risposto un collega): 409 con il motivo, che l'avviso mostra sotto i pulsanti
    esito = { ok: false, errore: 'Hai già risposto a questa richiesta.' };
    r = await chiedi('/distributore/richieste/12/rispondi', { ...form({ azione: 'prezzo_richiesto' }), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { ok: false, errore: 'Hai già risposto a questa richiesta.' });

    // dai form della pagina (Accept html): redirect come prima: alla home con torna=home, altrimenti al dettaglio; con l'errore, al dettaglio
    esito = { ok: true };
    r = await chiedi('/distributore/richieste/12/rispondi', form({ azione: 'prezzo_richiesto', torna: 'home' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore');
    r = await chiedi('/distributore/richieste/12/rispondi', form({ azione: 'prezzo_richiesto' }));
    assert.equal(r.headers.get('location'), '/distributore/richieste/12');
    esito = { ok: false, errore: 'Chiusa.' };
    r = await chiedi('/distributore/richieste/12/rispondi', form({ azione: 'prezzo_richiesto', torna: 'home' }));
    assert.equal(r.headers.get('location'), '/distributore/richieste/12?errore=Chiusa.');
  } finally {
    richiesteModulo.rispondi = originale;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('avvisi del banco: lo script e gli stili ci sono, il suono è un MP3 leggero e gli avvisi non si stampano', async () => {
  const fs = require('fs');
  const js = leggiComposto('/app.js').testo;
  const css = leggiComposto('/style.css').testo;
  // il blocco c'è, parla con le due rotte e con quella delle notifiche lette
  assert.match(js, /Avvisi del banco/);
  for (const url of ['/distributore/stato-banco', '/api/notifiche/push', '/api/notifiche/lette', '/suoni/avviso.mp3']) assert.ok(js.includes("'" + url + "'"), url);
  // i cinque tipi e le loro durate: 10 s (nessun corriere, scaduta) e 6 s (consegnato); niente "×" sulla nuova richiesta
  for (const tipo of ['nuova_richiesta', 'corriere_trovato', 'nessun_corriere', 'richiesta_scaduta', 'ordine_consegnato']) {
    assert.ok(js.includes("'" + tipo + "'"), tipo);
    assert.match(css, new RegExp('\\.avv-' + tipo + ' \\{'), 'colori di ' + tipo);
  }
  assert.match(js, /tipo: 'nessun_corriere'[\s\S]*?durataMs: 10000/);
  assert.match(js, /tipo: 'richiesta_scaduta'[\s\S]*?durataMs: 10000/);
  assert.match(js, /tipo: 'ordine_consegnato'[\s\S]*?durataMs: 6000/);
  assert.match(js, /tipo: 'nuova_richiesta'[\s\S]*?chiudibile: false/);
  // il vecchio blocco delle notifiche del browser non gira sulle pagine del banco (le gestisce il nuovo)
  assert.match(js, /!document\.querySelector\('\[data-banco-testa\]'\)/);
  // stili: contenitore in basso a destra, tre visibili, strip a 48px, niente stampa, niente animazioni con "riduci movimento"
  assert.match(css, /\.banco-avvisi \{[^}]*right: 24px;[^}]*bottom: 24px;[^}]*width: 400px;/);
  assert.match(css, /\.banco-avviso \{[^}]*min-height: 48px;[^}]*background: #fbe6da;[^}]*border-bottom: 1px solid #f1c9b3;[^}]*color: #8a3a14;/);
  assert.match(css, /@media print \{\s*\.banco-avviso, \.banco-avvisi, \.banco-config \{ display: none !important; \}/);
  // il suono si riproduce con la Web Audio API (una sorgente nuova a ogni suono: non si taglia) e la ricarica automatica lo aspetta (richiesta esplicita del 21/10/2026:
  // "a volte arriva solo un pezzo dello squillo", "il suono arriva solo se sono sopra Banco")
  assert.match(js, /new ContestoAudio\(\)/);
  assert.match(js, /createBufferSource\(\)/);
  assert.match(js, /decodeAudioData/);
  assert.match(js, /Minuteria\.banco = \{ primaDiRicaricare: primaDiRicaricare/);
  assert.match(js, /const prima = typeof Minuteria !== 'undefined' && Minuteria\.banco \? Minuteria\.banco\.primaDiRicaricare : null;/);
  assert.doesNotMatch(js, /window\.Minuteria/, '`Minuteria` è una const del file: window.Minuteria sarebbe sempre undefined');
  assert.match(js, /Promise\.race\(\[daiPush\(\)\.then\(attendiFineSuono\), pausa\(4500\)\]\)/);
  // e arriva anche da una scheda nascosta: connessione in tempo reale del server (src/logica/notifiche/eventi.js), con l'evento 'notifica'
  assert.match(js, /new EventSource\('\/api\/eventi'\)/);
  assert.match(js, /sorgente\.addEventListener\('notifica'/);
  // audio bloccato dal browser + notifiche del computer attive: suona la notifica di sistema al posto del sito
  assert.match(js, /esito === 'bloccato' && notificheSistemaConsentite\(\)/);
  // la HOME non si ricarica: le colonne si aggiornano sul posto (scheda, suono e numero sul tab "Banco" insieme: "arriva prima il suono e il numeretto rispetto alla card")
  assert.match(js, /Minuteria\.homeBanco = \{ rinfresca: rinfresca \};/);
  assert.match(js, /new CustomEvent\('minuteria:bacheca'/);
  assert.match(js, /window\.addEventListener\('minuteria:bacheca'/);
  assert.match(js, /home && aggiornare \? Promise\.race\(\[home\.rinfresca\(\), pausa\(2500\)\]\)/);
  assert.match(js, /function homeBanco\(\) \{\s*return typeof Minuteria !== 'undefined' && Minuteria\.homeBanco \? Minuteria\.homeBanco : null;/);
  assert.match(js, /const versioneAttuale = function \(\) \{ return document\.body\.dataset\.versione \|\| null; \};/);
  assert.doesNotMatch(js, /versionePagina/, 'i numeri della pagina si rileggono a ogni controllo: la home li riscrive aggiornandosi');
  // gli avvisi azzurri "Attiva il suono" / "Attiva le notifiche" (nascosti di default) e i loro stili
  assert.match(js, /Attiva il suono/);
  assert.match(js, /Attiva le notifiche/);
  assert.match(css, /\.banco-config \{ background: #e8f0f8;/);
  assert.match(css, /\.banco-config\[hidden\], \.banco-config-riga\[hidden\] \{ display: none; \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.banco-voce-pallino-ordini, \.banco-avviso-punto, \.avv \{ animation: none; \}/);
  // il suono: un MP3 vero (ID3 o frame sync) e sotto i 30 KB
  const mp3 = fs.readFileSync(path.join(radice, 'public', 'suoni', 'avviso.mp3'));
  assert.ok(mp3.length > 1000 && mp3.length < 30 * 1024, 'dimensione ' + mp3.length);
  assert.ok(mp3.slice(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), 'intestazione MP3');
  // e il server lo serve
  const r = await fetch(base + '/suoni/avviso.mp3');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /audio\/mpeg/);
});

test('banco: la freccia di ordine e richiesta riporta alla pagina da cui si arriva (Storico, scheda cliente, richiesta), mai fuori dal sito', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  // gli href escono con le `&` come `&amp;`
  // la pagina dell'ordine e quella della richiesta hanno la stessa testata: la freccia è `ric-indietro` (e l'intestazione del banco non ne ha una sua)
  const freccia = (t) => ((t.match(/<a class="ric-indietro" href="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&');
  const frecciaRichiesta = freccia;
  const storicoCon = '/distributore/storico?stato=consegnati&periodo=30&q=rossi&pagina=2';
  const clienteCon = '/distributore/clienti/32?mese=2026-10&vista=ordine#materiale';
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // ----- pagina dell'ordine (1295: da preparare): senza `torna` la home; con `torna` la pagina di partenza, filtri e ancora compresi -----
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });
    let r = await chiedi('/distributore/ordini/1295');
    assert.equal(r.status, 200);
    assert.equal(freccia(await r.text()), '/distributore');
    for (const da of [storicoCon, clienteCon, '/distributore/clienti', '/distributore/richieste/177']) {
      r = await chiedi('/distributore/ordini/1295?torna=' + encodeURIComponent(da));
      assert.equal(r.status, 200, da);
      assert.equal(freccia(await r.text()), da, da);
    }
    // un `torna` che non è una pagina del banco (indirizzo esterno, altro percorso, pagina con effetti) non porta fuori: home
    for (const no of ['https://altro.it/storico', '//altro.it', '/carrello', '/distributore/ordini/1285/elimina', '/distributore/clienti/32/materiale.csv', 'javascript:alert(1)']) {
      r = await chiedi('/distributore/ordini/1295?torna=' + encodeURIComponent(no));
      assert.equal(freccia(await r.text()), '/distributore', no);
    }
    // e non si inietta nel markup: il valore esce con le virgolette escapate
    r = await chiedi('/distributore/ordini/1295?torna=' + encodeURIComponent('/distributore/storico?q="><script>x</script>'));
    const t = await r.text();
    assert.doesNotMatch(t, /<script>x<\/script>/);

    // ----- richiesta con l'ordine "Da preparare" (177 → ordine 1295): non ha una sua pagina, porta a quella dell'ordine, e la freccia dell'ordine riporta da dove si è
    // partiti (la home se la richiesta si è aperta senza `torna`), non alla richiesta -----
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295, extra: { corriere_nome: 'Marco', corriere_minuti: 25 } });
    r = await chiedi('/distributore/richieste/177');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/ordini/1295');
    r = await chiedi(r.headers.get('location'));
    assert.equal(freccia(await r.text()), '/distributore', 'aperta dalla home: la freccia torna alla home');

    r = await chiedi('/distributore/richieste/177?torna=' + encodeURIComponent(storicoCon));
    assert.equal(r.status, 302);
    const verso = r.headers.get('location');
    assert.equal(verso, '/distributore/ordini/1295?torna=' + encodeURIComponent(storicoCon));
    r = await chiedi(verso);
    assert.equal(freccia(await r.text()), storicoCon, 'aperta dallo Storico: la freccia torna allo Storico');

    // un `torna` che non è una pagina del banco: l'ordine non lo riceve, la freccia va alla home
    r = await chiedi('/distributore/richieste/177?torna=' + encodeURIComponent('https://altro.it'));
    assert.equal(r.headers.get('location'), '/distributore/ordini/1295');

    // ----- pagina della richiesta senza ordine da preparare (confermata, ordine già "In consegna"): la freccia torna da dove si è arrivati -----
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', ordine: { id: 5, distributor_id: 2, cliente_id: 1, stato: 'in_evasione', creato_il: fa(60000), consegnato_il: null }, extra: { corriere_nome: 'Marco', corriere_minuti: 25 } });
    r = await chiedi('/distributore/richieste/177');
    assert.equal(r.status, 200);
    let pagina = await r.text();
    assert.equal(frecciaRichiesta(pagina), '/distributore');
    assert.doesNotMatch(pagina, /banco-indietro/, 'una sola freccia: quella della richiesta');
    r = await chiedi('/distributore/richieste/177?torna=' + encodeURIComponent(storicoCon));
    pagina = await r.text();
    assert.equal(frecciaRichiesta(pagina), storicoCon);
    assert.doesNotMatch(pagina, /banco-indietro/);
    r = await chiedi('/distributore/richieste/177?torna=' + encodeURIComponent('https://altro.it'));
    assert.equal(frecciaRichiesta(await r.text()), '/distributore');
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
