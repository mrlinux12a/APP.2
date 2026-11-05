// Home dell'installatore, riordina, ordine in consegna e ordine consegnato.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38476);
const {
  base, biscotti, chiedi, consegnatoIl, erroriServer, fa, form, json, naive, ordiniProva, pagatoIlProva, registro, richiesteTempiProva,
  storico, stripeRighe,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

test('l\'installatore NON conferma la consegna: nessun pulsante né rotta; la pagina in consegna attende da sola il corriere (WhatsApp)', async () => {
  ordiniProva.attivo = true;
  try {
    // le vecchie rotte di conferma non esistono più
    for (const url of ['/ordini/72/consegnato-prova', '/ordini/70/consegnato']) {
      const r = await chiedi(url, form({}));
      assert.equal(r.status, 404, url);
    }
    // la pagina dell'ordine in consegna non ha nessun pulsante di conferma, ma l'attesa della consegna (script di app.js)
    const inConsegna = await (await chiedi('/ordini/72')).text();
    assert.doesNotMatch(inConsegna, /consegnato-prova|Ho ricevuto il materiale|\/ordini\/72\/consegnato"/);
    assert.match(inConsegna, /<span data-attendi-consegna="72" hidden><\/span>/);
    // lo stato che la pagina interroga: non consegnato -> false, consegnato -> true, ordine di un altro -> 404
    ordiniProva.ordini[72].consegnato_il = null;
    let s = await chiedi('/api/ordini/72/consegnato');
    assert.equal(s.status, 200);
    assert.deepEqual(await s.json(), { consegnato: false });
    assert.equal(s.headers.get('cache-control'), 'no-store');
    ordiniProva.ordini[72].consegnato_il = consegnatoIl;
    try {
      assert.deepEqual(await (await chiedi('/api/ordini/72/consegnato')).json(), { consegnato: true });
    } finally {
      ordiniProva.ordini[72].consegnato_il = null;
    }
    assert.equal((await chiedi('/api/ordini/9999/consegnato')).status, 404);
    // lo script che ricarica la pagina c'è
    const js = await (await chiedi('/app.js')).text();
    assert.match(js, /querySelector\('\[data-attendi-consegna\]'\)/);
    // nessun pulsante nemmeno nella pagina "Consegnato" né nella vista dell'ordine consegnato
    assert.doesNotMatch(await (await chiedi('/ordini/71')).text(), /Ho ricevuto il materiale/);
    // l'ordine già consegnato resta consultabile (dallo Storico): la sua pagina "Consegnato" c'è ancora
    const t = await (await chiedi('/ordini/71')).text();
    assert.match(t, /<h2 class="att-titolo">Consegnato<\/h2>/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('catalogo: la testata porta l\'utente collegato (le quantità scelte e non ancora aggiunte si legano a lui)', async () => {
  const t = await (await chiedi('/home')).text();
  assert.match(t, /<meta name="utente" content="1">/);
  // senza sessione non c'è
  const anonimo = await fetch(base + '/login');
  assert.doesNotMatch(await anonimo.text(), /<meta name="utente"/);
});

test('icona con una sola attività: quella di sempre, senza fotogrammi né puntini; la scheda della home ha il suo conto', async () => {
  storico.attivo = true; // senza conOrdini: c'è solo la richiesta 6 in attesa
  try {
    const t = await (await chiedi('/home')).text();
    // con una sola attività il tocco porta dritto alla sua pagina (non da /ordini, che la rimanderebbe lì con un giro in più)
    const a = t.indexOf('<a href="/richieste/6" class="nav-ordini');
    const nav = t.slice(a, t.indexOf('</a>', a));
    assert.match(nav, /^<a href="\/richieste\/6" class="nav-ordini fase-richiesta " data-fase="richiesta" data-attivo="home" data-firma="richiesta-6-richiesta" data-secondi="\d+" data-durata="360">/);
    assert.doesNotMatch(nav, /multi|fotogramm|puntini|data-fasi|aria-label/);
    assert.match(nav, /<span class="etichetta">In attesa · <span data-countdown>0[45]:\d\d<\/span><\/span>/);
    // il conto dell'icona è quello del suo link; la scheda in cima alla home ha il suo [data-secondi]
    const scheda = t.slice(t.indexOf('<a class="stato-home stato-richiesta"'), t.indexOf('</a>', t.indexOf('<a class="stato-home stato-richiesta"')));
    assert.match(scheda, /^<a class="stato-home stato-richiesta" href="\/richieste\/6" data-secondi="\d+" data-durata="360">/);
  } finally {
    storico.attivo = false;
  }
});

test('home: una scheda per ogni richiesta in attesa e ordine in consegna, nello stesso formato, una sotto l\'altra', async () => {
  storico.attivo = true;
  storico.conOrdini = true; // la richiesta 6 in attesa e l'ordine 50 in consegna (senza orario del corriere)
  try {
    const t = await (await chiedi('/home')).text();
    const inizio = t.indexOf('<div class="stato-home-slot" data-stato-home>');
    assert.ok(inizio > -1);
    const slot = t.slice(inizio, t.indexOf('<h1 class="domanda">', inizio)); // fino alla ricerca che segue le schede
    // le schede, nell'ordine dell'icona: prima la richiesta, poi la consegna
    const schede = [...slot.matchAll(/<(?:a|div) class="stato-home stato-(richiesta|consegna)"/g)].map((m) => m[1]);
    assert.deepEqual(schede, ['richiesta', 'consegna']);
    // ognuna porta alla pagina della sua attività
    assert.match(slot, /<a class="stato-home stato-richiesta" href="\/richieste\/6" data-secondi="\d+" data-durata="360">/);
    assert.match(slot, /<a class="stato-corpo" href="\/ordini\/50">/);
    // formato di sempre: la richiesta con anello, conto alla rovescia e frase del rimborso; la consegna con furgone, barra e tappe
    assert.match(slot, /<span class="stato-tempo" data-countdown>0[45]:\d\d<\/span>/);
    assert.match(slot, /<span class="stato-occhiello">Richiesta inviata<\/span>\s*<span class="stato-titolo">Aspettiamo che un banco accetti<\/span>\s*<span class="stato-sub">Se nessuno accetta entro 10 min, ti rimborsiamo\.<\/span>/); // 10 = la configurazione, anche se l'anello di questa richiesta dura 6 min (data-durata="360"): il testo non segue il timer accorciato per le prove
    assert.match(slot, /<span class="stato-occhiello">Accettato · In consegna<\/span>\s*<span class="stato-titolo">In consegna<\/span>/);
    assert.match(slot, /<div class="stato-barra" aria-hidden="true"><span style="width: 50%"><\/span><\/div>/);
    assert.match(slot, /<div class="stato-tappe" aria-hidden="true">\s*<span>Accettato<\/span>\s*<span>In viaggio<\/span>\s*<span>Consegnato<\/span>/);
    // un solo conto alla rovescia (una sola richiesta): le consegne non ne hanno
    assert.equal((slot.match(/data-countdown/g) || []).length, 1);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
  }
});

test('si può inviare una nuova richiesta anche con una già in attesa: nessun "Richiesta già in corso"', async () => {
  storico.attivo = true;
  try {
    await chiedi('/carrello/svuota', { method: 'POST' });
    await chiedi('/api/carrello/imposta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, qty: 50 }),
    });
    const r = await chiedi('/richieste', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'destinazione=Via+Prova+1' });
    const t = await r.text();
    assert.doesNotMatch(t, /Richiesta già in corso|già una richiesta in attesa/);
  } finally {
    storico.attivo = false;
  }
});

test('un invio, una richiesta: ogni apertura del carrello ha la sua chiave; un invio già partito riporta alla sua richiesta', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 50 }));
  const chiavi = [];
  for (let i = 0; i < 2; i++) {
    const t = await (await chiedi('/carrello')).text();
    const m = t.match(/<input type="hidden" name="chiave_invio" value="([0-9a-f]{24})">/);
    assert.ok(m, 'la chiave è nel modulo di invio');
    assert.ok(t.indexOf(m[0]) > t.indexOf('id="form-invia"'), 'dentro il modulo che invia la richiesta');
    chiavi.push(m[1]);
  }
  assert.notEqual(chiavi[0], chiavi[1], 'un carrello riaperto è un invio nuovo');

  // secondo clic (o "indietro") sullo stesso invio: si va alla richiesta già partita, e non se ne scrive un'altra
  const prima = registro.length;
  const r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'chiave-esistente-1', destinazione: 'Via Prova 1' }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/richieste/321');
  assert.ok(!registro.slice(prima).some((q) => /INSERT INTO requests/.test(q)), 'nessuna richiesta nuova');
  // il carrello di quell'invio non serve più
  assert.match(await (await chiedi('/carrello')).text(), /Il carrello è vuoto/);
});

test('carrello vuoto: figura, ricerca come la home, catalogo; l\'ultimo ordine solo se consegnato', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });

  // senza ordini consegnati: niente scheda
  let t = await (await chiedi('/carrello')).text();
  assert.match(t, /<div class="app app-vuoto">/);
  assert.match(t, /<h1 class="vuoto-titolo">Il carrello è vuoto<\/h1>/);
  assert.match(t, /<p class="vuoto-sotto">Cerca il pezzo che ti manca o sfoglia le categorie\.<\/p>/);
  assert.match(t, /<div class="vuoto-fig" aria-hidden="true">\s*<span class="vuoto-fig-tratt"><\/span>\s*<svg/);
  // la stessa ricerca della home: GET /cerca?q=
  assert.match(t, /<form class="barra-ricerca barra-home barra-vuoto" method="GET" action="\/cerca" role="search">/);
  assert.match(t, /type="search" name="q"[^>]*placeholder="Nome o misura: valv 3\/4"/);
  assert.match(t, /<button type="submit" class="btn-cerca">Cerca<\/button>/);
  assert.match(t, /<a class="btn-vuoto-bordo" href="\/home"><svg[\s\S]*?<\/svg><span>Sfoglia il catalogo<\/span><\/a>/);
  assert.doesNotMatch(t, /uo-scheda|Rimetti nel carrello|Vai al catalogo|Aggiungi articoli dalle categorie/);

  // con un ordine consegnato: la scheda, tre righe, "+ 1 altro" e il POST di Riordina; una sola lettura
  storico.attivo = true;
  try {
    const prima = registro.length;
    t = await (await chiedi('/carrello')).text();
    assert.equal(registro.slice(prima).filter((q) => /AS ordine_id, o.creato_il, oi.quantita/.test(q)).length, 1);
    assert.match(t, /<h2 class="uo-occhiello" id="uo-occhiello">Il tuo ultimo ordine<\/h2>\s*<span class="uo-data">10 feb 2025<\/span>/);
    assert.deepEqual(
      [...t.matchAll(/<span class="uo-qta">(\d+)×<\/span>\s*<span class="uo-nome">([^<]*)<\/span>/g)].map((m) => m[1] + '× ' + m[2]),
      ['2× Valvola a sfera', '3× Raccordo a T', '1× Adattatore Ø80/100mm Per Caldaia 45-65kw']
    );
    assert.match(t, /<p class="uo-altri">\+ 1 altro<\/p>/);
    assert.match(t, /<form class="uo-form" method="POST" action="\/storico\/10\/riordina">\s*<button type="submit" class="uo-btn"><svg[\s\S]*?<\/svg><span>Rimetti nel carrello<\/span>/);

    // con qualcosa nel carrello la pagina è quella di sempre e la lettura dell'ultimo ordine non parte nemmeno
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 2 }));
    const prima2 = registro.length;
    t = await (await chiedi('/carrello')).text();
    assert.equal(registro.slice(prima2).filter((q) => /AS ordine_id, o.creato_il, oi.quantita/.test(q)).length, 0);
    assert.match(t, /carrello-layout/);
    assert.doesNotMatch(t, /uo-scheda|vuoto-pagina/);
  } finally {
    storico.attivo = false;
    await chiedi('/carrello/svuota', { method: 'POST' });
  }
});

test('riordina: somma al carrello, salta gli articoli non disponibili e lo dice una sola volta', async () => {
  storico.attivo = true;
  try {
    await chiedi('/carrello/svuota', { method: 'POST' });
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 1 })); // già nel carrello: le quantità si sommano
    let r = await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/carrello');
    const carrello = (await (await chiedi('/api/carrello')).json()).carrello;
    assert.deepEqual(carrello, { 1: 3, 2: 3 });

    r = await chiedi('/carrello');
    const t = await r.text();
    assert.match(t, /class="avviso avviso-attenzione"[^>]*>3 articoli non sono più disponibili</);
    assert.ok(t.indexOf('avviso-attenzione') < t.indexOf('carrello-layout'), 'avviso in cima');
    assert.doesNotMatch(await (await chiedi('/carrello')).text(), /non sono più disponibili/, 'solo una volta');

    // un secondo riordino somma ancora
    await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 });

    // l'ordine di un altro cliente e uno inesistente non si riordinano; un id non valido è 404
    assert.equal((await chiedi('/storico/99/riordina', { method: 'POST' })).status, 403);
    assert.equal((await chiedi('/storico/98/riordina', { method: 'POST' })).status, 404);
    assert.equal((await chiedi('/storico/abc/riordina', { method: 'POST' })).status, 404);
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 }, 'carrello intatto');
  } finally {
    storico.attivo = false;
    await chiedi('/carrello/svuota', { method: 'POST' });
  }
});

// ---------------- Pagina dell'ordine: consegna pagata in app e materiale da pagare a BOREA ----------------

test('ordine in consegna: righe a prezzo del banco, "Merce · IVA esclusa", scheda Pagamenti (consegna 20,07 pagata, materiale 78,69), niente Totale', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/74')).text();
    // la parte alta (anello che si svuota, titolo, passi) non cambia
    assert.match(t, /att-timer att-verde/);
    assert.match(t, /<span class="att-etichetta">In consegna<\/span>/);
    // materiale in arrivo: prezzo del BANCO (54,50 e 10,00, non 59,95 e 11,00), "Cod. … · € … cad." e totale di riga
    assert.match(t, /<div class="att-occhiello">Materiale in arrivo<\/div>/);
    assert.match(t, /Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/div>\s*<div class="att-cod">Cod\. 12514597 · € 54,50 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /Cod\. 12697319 · € 10,00 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 10,00<\/span>/);
    assert.doesNotMatch(t, /59,95|11,00/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 64,50<\/dd><\/div>/);
    // niente più le righe consegna / IVA / totale nella scheda materiale, né la sezione "Dettagli", né la nota sul prezzo
    assert.doesNotMatch(t, /att-totale|<dt>Totale<\/dt>|<dt>Consegna in cantiere<\/dt>|<dt>IVA 22%<\/dt>/);
    assert.doesNotMatch(t, /Dettagli consegna|att-dettagli|Prezzo definitivo, con eventuale sconto/);
    // Pagamenti: la consegna pagata in app (con la data) e il materiale da pagare a BOREA, in fattura
    assert.match(t, /<h2 class="pg-titolo">Pagamenti<\/h2>/);
    assert.match(t, /<div class="pg-nome">Consegna in cantiere<\/div>\s*<div class="pg-sub"><span class="pg-spunta">[\s\S]*?<\/span>Pagata il 15\/10<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /<div class="pg-nome">Materiale<\/div>\s*<div class="pg-sub">Lo paghi a BOREA con la sua fattura<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/);
    assert.doesNotMatch(t, /98,76/, 'mai la somma dei due in un totale unico');
    // il dettaglio degli importi: <details> chiuso, due riquadri piccoli
    assert.match(t, /<details class="pg-dettaglio">\s*<summary><span class="pg-apri">Vedi il dettaglio degli importi<\/span><span class="pg-chiudi">Nascondi il dettaglio<\/span>/);
    const dettaglio = t.slice(t.indexOf('pg-riquadri'));
    assert.match(dettaglio, /Consegna · pagata<\/h3>[\s\S]*?Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>[\s\S]*?Servizio<\/span> <span class="pg-sp">· 10% della merce<\/span><\/dt><dd>€ 6,45<\/dd>[\s\S]*?IVA 22%<\/span> <span class="pg-sp">· su € 16,45<\/span><\/dt><dd>€ 3,62<\/dd>/);
    assert.match(dettaglio, /Materiale · a BOREA<\/h3>[\s\S]*?Merce<\/span> <span class="pg-sp">· prezzo del banco<\/span><\/dt><dd>€ 64,50<\/dd>[\s\S]*?IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
    assert.doesNotMatch(dettaglio, /Contributo RAEE/, 'senza RAEE la riga non c\'è');
    // nessun pulsante di conferma: la consegna la segna il corriere da WhatsApp
    assert.doesNotMatch(t, /Ho ricevuto il materiale|consegnato-prova/);
    assert.match(t, /data-attendi-consegna="74"/);
    assert.doesNotMatch(t, />Ordine consegnato</);
    // niente "Annulla ordine": il banco ha già confermato e la carta è stata incassata, quindi l'ordine non si annulla più
    assert.doesNotMatch(t, /Annulla ordine|att-annulla|\/elimina/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine in consegna: oltre all\'orario ("Arriva entro le HH:MM") i minuti che mancano ("Mancano N min"), che scendono da soli e spariscono a 3 minuti o meno', async () => {
  ordiniProva.attivo = true;
  const ordine = ordiniProva.ordini[74];
  const prima = { corriere_arrivo_il: ordine.corriere_arrivo_il, corriere_nome: ordine.corriere_nome };
  try {
    // senza corriere: l'arrivo è la stima del banco (6 ore dalla nascita, nata 1 ora fa): titolo in ore e sotto quanto manca
    let t = await (await chiedi('/ordini/74')).text();
    assert.match(t, /<p class="att-minuti" data-eta-testo="Mancano \{t\}" data-eta-nascondi>Mancano [45] h(?: \d+)?<\/p>/);

    // con il corriere: titolo con l'orario e i minuti sotto, nello stesso blocco che li fa scendere ogni secondo (data-eta-sec)
    ordine.corriere_nome = 'Marco';
    ordine.corriere_arrivo_il = new Date(Date.now() + 18 * 60000 + 30000);
    t = await (await chiedi('/ordini/74')).text();
    assert.match(t, /<span data-eta-testo="Arriva entro le \d\d:\d\d">Arriva entro le \d\d:\d\d<\/span><\/h2>\s*<p class="att-minuti" data-eta-testo="Mancano \{t\}" data-eta-nascondi>Mancano 19 min<\/p>/);
    assert.match(t, /att-timer att-verde" data-eta-sec="\d+"/);

    // a 3 minuti o meno il titolo dice solo "In arrivo" e la riga dei minuti non si vede (display: none: il blocco di app.js la tiene nascosta)
    ordine.corriere_arrivo_il = new Date(Date.now() + 2 * 60000);
    t = await (await chiedi('/ordini/74')).text();
    assert.match(t, /<span data-eta-testo="Arriva entro le \d\d:\d\d">In arrivo<\/span>/);
    assert.match(t, /<p class="att-minuti" data-eta-testo="Mancano \{t\}" data-eta-nascondi style="display: none">Mancano 2 min<\/p>/);
  } finally {
    Object.assign(ordine, prima);
    ordiniProva.attivo = false;
  }
});

test('ordine consegnato: stessa struttura in verde (materiale consegnato, Pagamenti), Riordina, niente "Annulla ordine" né bolla', async () => {
  ordiniProva.attivo = true;
  try {
    const r = await chiedi('/ordini/73');
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /<div class="app app-consegnato">/);
    assert.match(t, /class="titolo">Ordine</); // intestazione di sempre
    assert.doesNotMatch(t, /ordine-hero|class="badge"/);
    // 1. scheda di stato: invariata
    assert.match(t, /<h2 class="att-titolo">Consegnato<\/h2>\s*<p class="att-sotto">Mercoledì 14 ottobre(?: 2026)? alle 20:10<\/p>/);
    const passi = [...t.matchAll(/<li class="att-passo ([^"]*)">[\s\S]*?<\/svg><\/span>(\w+)<\/span>/g)].map((m) => m[1] + ':' + m[2]);
    assert.deepEqual(passi, ['att-fatto:Inviata', 'att-fatto:Confermata', 'att-fatto:Consegnata']);
    assert.doesNotMatch(t, /att-corrente|data-viaggio|att-anello|att-furgone/); // niente anello né animazioni
    // 2. Riordina: lo stesso POST dello storico
    assert.match(t, /<form class="att-riordina" method="POST" action="\/storico\/73\/riordina">/);
    // 3. una scheda: la ditta (mai la filiale), "Materiale consegnato", "Ordine #73", righe a prezzo del banco, "Merce · IVA esclusa"
    assert.match(t, /<div class="att-occhiello">Materiale consegnato<\/div>\s*<div class="att-banco-nome">BOREA SRL<\/div>[\s\S]*?<span class="att-ordine-id">Ordine #73<\/span>/);
    assert.doesNotMatch(t, /Banco Genova Fegino/);
    assert.match(t, /Cod\. 12514597 · € 54,50 cad\.[\s\S]*?<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 64,50<\/dd><\/div>/);
    // nessun documento in fondo alla scheda del materiale: la bolla non esiste
    assert.doesNotMatch(t, /att-documenti|Documenti|DDT|bolla|\/ddt\//i);
    // Pagamenti: come nell'ordine in consegna
    assert.match(t, /Pagata il 15\/10<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /data-importo-banco>€ 78,69<\/div>/);
    // tolti: Totale, la sezione dettagli (consegna, destinazione, pagamento, note), la nota sul prezzo, Annulla e il pulsante vecchio
    assert.doesNotMatch(t, /att-totale|<dt>Totale<\/dt>|Dettagli consegna|att-dettagli|att-dett-|Prezzo definitivo|Annulla ordine|att-annulla|\/elimina|consegnato-prova|>Ordine consegnato</);
    assert.doesNotMatch(t, /sezione-titolo/); // niente titolo "Prodotti"
  } finally {
    ordiniProva.attivo = false;
  }
});

// Gli orari sotto i passi della pagina "Consegnato" e la pillola "Arrivato in … dall'invio".
const orariPassi = (t) => [...t.matchAll(/<li class="att-passo att-fatto">[\s\S]*?<\/svg><\/span>(\w+)<\/span>(?:\s*<span class="att-ora">([^<]*)<\/span>)?/g)].map((m) => m[1] + ':' + (m[2] || ''));

test('ordine consegnato lo stesso giorno: tre orari "HH:MM" sotto i passi e la pillola con i minuti giusti', async () => {
  ordiniProva.attivo = true;
  const inviata = naive(new Date(Date.UTC(2026, 9, 14, 17, 23))); // 19:23 a Roma
  richiesteTempiProva[83] = { stripe: true, colonne: { creato_il: inviata, pagato_il: inviata } }; // inviata 19:23, confermata 19:40, consegnata 20:10
  try {
    const t = await (await chiedi('/ordini/76')).text();
    assert.deepEqual(orariPassi(t), ['Inviata:19:23', 'Confermata:19:40', 'Consegnata:20:10']);
    assert.match(t, /<p class="att-sotto att-sotto-pillola">Mercoledì 14 ottobre(?: 2026)? alle 20:10<\/p>\s*<p class="att-arrivato-riga"><span class="att-arrivato" data-arrivato>Arrivato in 47 min dall'invio<\/span><\/p>/);
    assert.doesNotMatch(t, /att-ora">(—|-|\s*)</, 'mai trattini');
  } finally {
    delete richiesteTempiProva[83];
    ordiniProva.attivo = false;
  }
});

test('ordine inviato la sera e consegnato il giorno dopo: "21 ott · 23:50" sotto Inviata, e la pillola dice "8 h 40 min"', async () => {
  ordiniProva.attivo = true;
  const inviata = naive(new Date(Date.UTC(2026, 9, 21, 21, 50))); // 23:50 a Roma
  // rinviata: creato_il è del giorno prima e non conta, vale pagato_il riscritto dal rinvio (l'ultimo invio, quello che ha fatto nascere l'ordine)
  richiesteTempiProva[84] = { stripe: true, colonne: { creato_il: naive(new Date(Date.UTC(2026, 9, 19, 9, 0))), pagato_il: inviata } };
  try {
    const t = await (await chiedi('/ordini/77')).text();
    assert.deepEqual(orariPassi(t), ['Inviata:21 ott · 23:50', 'Confermata:21 ott · 23:55', 'Consegnata:08:30']);
    assert.match(t, /Arrivato in 8 h 40 min dall'invio/);
  } finally {
    delete richiesteTempiProva[84];
    ordiniProva.attivo = false;
  }
});

test('ordine consegnato vecchio, senza richiesta: niente orario sotto Inviata e niente pillola; il resto della pagina invariato', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/78')).text();
    assert.deepEqual(orariPassi(t), ['Inviata:', 'Confermata:19:40', 'Consegnata:20:10']);
    assert.doesNotMatch(t, /att-arrivato|Arrivato in/);
    assert.match(t, /<p class="att-sotto">Mercoledì 14 ottobre(?: 2026)? alle 20:10<\/p>/, 'senza pillola il sottotitolo ha il suo margine di sempre');
    assert.match(t, /<form class="att-riordina"/);
    assert.match(t, /data-importo-banco>€ 78,69<\/div>/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine VECCHIO (senza le colonne nuove): gli importi si ricalcolano dai valori di prima; un addebito che comprendeva il materiale non è una consegna', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/70')).text();
    // merce = totale_netto 112,53; servizio = totale_finale − totale_netto = 0; corriere 10,00 -> IVA 2,20 -> in app 12,20; materiale 112,53 + IVA 24,76 = 137,29
    assert.match(t, /Cod\. 12364959 · € 112,53 cad\.[\s\S]*?<span class="att-prezzo-riga">€ 112,53<\/span>/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 112,53<\/dd><\/div>/);
    // l'ordine di prima fu pagato TUTTO in app (149,49): non è la consegna, vale il calcolo
    assert.match(t, /data-importo-app>€ 12,20<\/div>/);
    assert.match(t, /data-importo-banco>€ 137,29<\/div>/);
    assert.doesNotMatch(t, /149,49/);
    const dettaglio = t.slice(t.indexOf('pg-riquadri'));
    assert.match(dettaglio, /Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>/);
    assert.match(dettaglio, /IVA 22%<\/span> <span class="pg-sp">· su € 10,00<\/span><\/dt><dd>€ 2,20<\/dd>/);
    assert.match(dettaglio, /IVA 22%<\/span> <span class="pg-sp">· su € 112,53<\/span><\/dt><dd>€ 24,76<\/dd>/);
    assert.doesNotMatch(t, /att-documenti|DDT|\/ddt\//i);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine con il pagamento rimborsato (caso raro): UNA riga grigia "Rimborsata il … su Visa •••• 4242" con "Ricevuta" e "Ricevuta rimborso", niente furgone', async () => {
  ordiniProva.attivo = true;
  stripeRighe.push({
    id: 903, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'rimborsato', payment_intent_id: 'pi_prova_82', importo_cent: 2007, incasso_cent: 2007, request_id: 82,
    carta_marca: 'visa', carta_ultime4: '4242', incassato_il: pagatoIlProva, aggiornato_il: new Date(Date.UTC(2026, 9, 16, 9, 0)),
  });
  try {
    const t = await (await chiedi('/ordini/75')).text();
    assert.match(t, /data-pagamento="rimborsato"/);
    assert.match(t, /<div class="pg-riga pg-nessuno">[\s\S]*?<div class="pg-nome">Rimborsata il 16\/10 su <span class="pg-nowrap">Visa •••• 4242<\/span><\/div>/);
    assert.match(t, /<a class="pg-ricevuta" href="\/ordini\/75\/ricevuta\.pdf"[^>]*>[\s\S]*?<\/svg>Ricevuta<\/a>\s*<a class="pg-ricevuta" href="\/ordini\/75\/ricevuta-rimborso\.pdf"[^>]*>[\s\S]*?<\/svg>Ricevuta rimborso<\/a>/);
    assert.match(t, /data-importo-app>€ 20,07<\/div>/);
    assert.doesNotMatch(t, /Pagata|pg-consegna|pg-materiale|<details class="pg-dettaglio">/);
    assert.equal((t.match(/class="pg-riga/g) || []).length, 1);
    // le due ricevute in PDF: pagamento e rimborso, numerate a parte (R-2026-… per tipo)
    const pagamento = await chiedi('/ordini/75/ricevuta.pdf');
    const rimborso = await chiedi('/ordini/75/ricevuta-rimborso.pdf');
    assert.equal(pagamento.status, 200);
    assert.equal(rimborso.status, 200);
    assert.match(rimborso.headers.get('content-disposition'), /filename="ricevuta-rimborso-R-2026-\d{6}\.pdf"/);
  } finally {
    stripeRighe.pop();
    ordiniProva.attivo = false;
  }
});

test('ordine pagato con Stripe: "Pagata il 15/10 · Visa •••• 4242", link "Ricevuta"; la ricevuta in PDF è solo del proprietario e solo di un incasso vero', async () => {
  ordiniProva.attivo = true;
  stripeRighe.push({
    id: 904, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'incassato', payment_intent_id: 'pi_prova_81', importo_cent: 2007, incasso_cent: 2007, request_id: 81,
    carta_marca: 'visa', carta_ultime4: '4242', receipt_url: 'https://pay.stripe.com/receipts/prova', incassato_il: pagatoIlProva, aggiornato_il: pagatoIlProva,
  });
  try {
    const t = await (await chiedi('/ordini/74')).text();
    assert.match(t, /data-pagamento="pagato"/);
    assert.match(t, /<div class="pg-riga pg-consegna">[\s\S]*?<span class="pg-spunta">[\s\S]*?<\/span>Pagata il 15\/10 · <span class="pg-nowrap">Visa •••• 4242<\/span><\/div>/);
    // a destra, in colonna: l'importo e il link sottolineato "Ricevuta", che apre il PDF in una nuova scheda
    assert.match(t, /<div class="pg-destra">\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>\s*<a class="pg-ricevuta" href="\/ordini\/74\/ricevuta\.pdf" target="_blank" rel="noopener">[\s\S]*?<\/svg>Ricevuta<\/a>/);
    assert.match(t, /Lo paghi a BOREA con la sua fattura/);
    assert.doesNotMatch(t, /Ricevuta rimborso|Bloccati sulla carta|pg-bloccata/);

    // la ricevuta in PDF: stesso numero a ogni apertura (una per ordine e tipo), nome del file col numero
    const r = await chiedi('/ordini/74/ricevuta.pdf');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const nome = (r.headers.get('content-disposition').match(/^inline; filename="(ricevuta-R-2026-\d{6}\.pdf)"$/) || [])[1];
    assert.ok(nome, r.headers.get('content-disposition'));
    const pdf = Buffer.from(await r.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1500);
    const ancora = await chiedi('/ordini/74/ricevuta.pdf');
    assert.match(ancora.headers.get('content-disposition'), new RegExp(nome.replace(/\./g, '\\.')), 'stesso numero la seconda volta');
    // un pagamento SIMULATO (sandbox: ordine 72, nessuna riga di Stripe) ha la sua ricevuta, "di prova"
    const simulata = await chiedi('/ordini/72/ricevuta.pdf');
    assert.equal(simulata.status, 200);
    assert.equal(simulata.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await simulata.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    // non c'è una ricevuta di rimborso (non è stato rimborsato), né per un blocco annullato (la richiesta 80 con la carta rilasciata), né per un ordine che non esiste
    assert.equal((await chiedi('/ordini/74/ricevuta-rimborso.pdf')).status, 404);
    stripeRighe.push({ id: 905, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'rilasciato', payment_intent_id: 'pi_prova_80', importo_cent: 2007, incasso_cent: null, request_id: 80, aggiornato_il: fa(60000) });
    const senza = await chiedi('/ordini/72/ricevuta.pdf');
    stripeRighe.pop();
    assert.equal(senza.status, 404);
    assert.match(await senza.text(), /Per questo ordine non c(?:'|&#39;)è una ricevuta di pagamento/);
    assert.equal((await chiedi('/ordini/99/ricevuta.pdf')).status, 404);
    // e senza essere collegati si va al login
    const cookiePrima = biscotti.cookie;
    biscotti.cookie = '';
    const anonimo = await chiedi('/ordini/74/ricevuta.pdf');
    assert.ok([302, 401, 403].includes(anonimo.status), 'senza accesso niente PDF: ' + anonimo.status);
    biscotti.cookie = cookiePrima;
  } finally {
    stripeRighe.pop();
    ordiniProva.attivo = false;
  }
});

test('ordine appena nato (corriere accettato) con la capture ancora da fare: la scheda dice "Pagata", non "Bloccati sulla carta", e la ricevuta si apre già, anche se l\'ordine non è consegnato', async () => {
  ordiniProva.attivo = true;
  // riga 'da_incassare': l'ha segnata la transazione che ha creato l'ordine (importo già deciso); Stripe non ha ancora fatto la capture, quindi niente carta
  stripeRighe.push({
    id: 906, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'da_incassare', payment_intent_id: 'pi_prova_81', importo_cent: 2007, incasso_cent: 2007, request_id: 81,
    carta_marca: null, carta_ultime4: null, receipt_url: null, incassato_il: null, aggiornato_il: pagatoIlProva,
  });
  try {
    // l'ordine 74 è "inviato", non consegnato
    const t = await (await chiedi('/ordini/74')).text();
    assert.match(t, /data-pagamento="pagato"/);
    assert.match(t, /<div class="pg-riga pg-consegna">[\s\S]*?<span class="pg-spunta">[\s\S]*?<\/span>Pagata il 15\/10<\/div>/);
    assert.doesNotMatch(t, /Bloccati sulla carta|pg-bloccata|pg-sospeso|solo se BOREA conferma/);
    assert.match(t, /<div class="pg-destra">\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>\s*<a class="pg-ricevuta" href="\/ordini\/74\/ricevuta\.pdf" target="_blank" rel="noopener">[\s\S]*?<\/svg>Ricevuta<\/a>/);
    assert.match(t, /Lo paghi a BOREA con la sua fattura/);
    // e la ricevuta in PDF si apre (senza la carta: arriva con la capture)
    const r = await chiedi('/ordini/74/ricevuta.pdf');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    // una riga ancora solo 'autorizzata' (nessun incasso deciso: l'ordine lo porta a 'da_incassare' nella stessa transazione che lo crea) resta com'era
    stripeRighe[stripeRighe.length - 1].stato = 'autorizzato';
    const bloccata = await (await chiedi('/ordini/74')).text();
    assert.match(bloccata, /data-pagamento="bloccato"/, 'autorizzato: nessun incasso deciso, resta com\'era');
  } finally {
    stripeRighe.pop();
    ordiniProva.attivo = false;
  }
});

test('il cliente non annulla MAI un ordine: nessun pulsante, e la rotta rifiuta (anche per un ordine "inviato" non consegnato) senza toccare niente', async () => {
  ordiniProva.attivo = true;
  try {
    const MESSAGGIO = /Il banco ha già confermato: l(?:'|&#39;)ordine non si può più annullare\. Per problemi contatta l(?:'|&#39;)assistenza\./;
    // la pagina: nessun link, né per un ordine consegnato rimasto 'inviato' (71), né per uno 'inviato' non consegnato (72), né per uno in consegna (74)
    for (const id of [71, 72, 74]) {
      const t = await (await chiedi('/ordini/' + id)).text();
      assert.doesNotMatch(t, /Annulla ordine|att-annulla|\/elimina/, 'ordine ' + id);
    }
    // chiamando l'URL a mano: errore chiaro, nessuna scrittura
    for (const id of [71, 72]) {
      const prima = registro.length;
      const r = await chiedi('/ordini/' + id + '/elimina', { method: 'POST' });
      assert.equal(r.status, 400, 'ordine ' + id);
      const e = await r.text();
      assert.match(e, /Annullamento non possibile/);
      assert.match(e, MESSAGGIO);
      assert.match(e, new RegExp('href="/ordini/' + id + '"'));
      const dopo = registro.slice(prima);
      assert.deepEqual(dopo.filter((q) => /^(DELETE|UPDATE|INSERT)/.test(q) && !/session|notifications/.test(q)), [], 'nessuna modifica per l\'ordine ' + id);
    }
    // un ordine di un altro cliente o inesistente resta 404 come prima
    assert.equal((await chiedi('/ordini/99/elimina', { method: 'POST' })).status, 404);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
