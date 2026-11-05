// Banco: Storico ordini.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38479);
const {
  banco, biscotti, chiedi, erroriServer, form, storicoBanco,
} = aiuti;

test('banco: Storico ordini con schede, periodo, righe raggruppate per giorno e stati', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    storicoBanco.viste.length = 0;
    const r = await chiedi('/distributore/storico');
    assert.equal(r.status, 200);
    const t = await r.text();

    // titolo, ricerca (con i filtri in campi nascosti), segmenti del periodo (di default 7 giorni), nessuna freccia indietro
    assert.match(t, /<title>[^<]*Storico ordini/);
    assert.match(t, /<h1 class="sto-titolo">Storico ordini<\/h1>/);
    assert.match(t, /<form class="sto-cerca" method="get" action="\/distributore\/storico" role="search">\s*<input type="hidden" name="stato" value="tutti">\s*<input type="hidden" name="periodo" value="7">/);
    assert.match(t, /type="search" name="q" value=""[^>]*data-non-ricaricare[^>]*placeholder="Cliente o n° ordine"/);
    assert.doesNotMatch(t, /DDT|bolla/i, 'nessuna traccia della bolla nello Storico');
    assert.match(t, /data-storico-svuota aria-label="Svuota la ricerca" hidden>/); // senza testo la "×" non c'è
    assert.deepEqual(
      [...t.matchAll(/<a href="(\/distributore\/storico\?[^"]*)" class="(attivo)?"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[3], m[1], m[2] || '']),
      [
        ['Oggi', '/distributore/storico?stato=tutti&amp;periodo=oggi', ''],
        ['7 giorni', '/distributore/storico?stato=tutti&amp;periodo=7', 'attivo'],
        ['30 giorni', '/distributore/storico?stato=tutti&amp;periodo=30', ''],
        ['Tutti', '/distributore/storico?stato=tutti&amp;periodo=tutti', ''],
      ]
    );

    // schede: numeri dai conteggi, "Tutti" attiva e senza pallino, le altre con il pallino del loro stato
    const schede = [...t.matchAll(/<a class="sto-scheda( attiva)?( vuota)?" href="([^"]*)"[^>]*>\s*(?:<span class="sto-punto sto-st-(\w+)"[^>]*><\/span>)?\s*<span class="sto-scheda-nome">([^<]*)<\/span>\s*<span class="sto-scheda-num">(\d+)<\/span>/g)]
      .map((m) => [m[5], Number(m[6]), !!m[1], m[4] || '', m[3]]);
    assert.deepEqual(schede, [
      ['Tutti', 4, true, '', '/distributore/storico?stato=tutti&amp;periodo=7'],
      ['Da preparare', 1, false, 'da_preparare', '/distributore/storico?stato=da_preparare&amp;periodo=7'],
      ['In consegna', 2, false, 'in_consegna', '/distributore/storico?stato=in_consegna&amp;periodo=7'],
      ['Consegnati', 1, false, 'consegnato', '/distributore/storico?stato=consegnati&amp;periodo=7'],
    ]);

    // tabella: intestazione, due giorni (Oggi e una data fissa con l'anno), i conteggi del giorno, nessuna "Flusso del banco"
    assert.match(t, /<span>Ordine<\/span><span>Ora<\/span><span>Cliente<\/span><span>Materiale<\/span>\s*<span class="sto-c-totale">Da incassare<\/span><span>Stato<\/span>/);
    assert.doesNotMatch(t, />Totale</);
    const giorni = [...t.matchAll(/<div class="sto-giorno">\s*<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(giorni, [['Oggi', '2 ordini'], ['12 marzo 2025', '2 ordini']]);
    assert.doesNotMatch(t, /Flusso del banco/);

    // ordine decrescente. OGNI riga si apre nella stessa pagina: un <button type="button" aria-expanded="false" aria-controls="dett-N"> (non più un link, e non più
    // "riga fissa" per gli ordini già partiti), con il pannello vuoto e nascosto sotto di sé, da riempire al clic con GET /distributore/storico/N/dettaglio.
    const trovate = [...t.matchAll(/<div class="sto-voce" id="o(\d+)" data-voce="\d+">\s*<button type="button" class="sto-riga" aria-expanded="false" aria-controls="dett-(\d+)" data-sto-apri>([\s\S]*?)<\/button>\s*<div class="sto-dettaglio" id="dett-(\d+)" role="region" aria-label="Dettagli dell'ordine #(\d+)"\s+data-url="([^"]*)" hidden><\/div>\s*<\/div>/g)];
    const righe = trovate.map((m) => m[3]);
    assert.equal(righe.length, 4);
    assert.deepEqual(trovate.map((m) => [m[1], m[2], m[4], m[5], m[6]]), [91, 90, 89, 88].map((n) => [String(n), String(n), String(n), String(n), '/distributore/storico/' + n + '/dettaglio']));
    assert.doesNotMatch(t, /sto-riga-fissa|class="sto-riga" href|<a class="sto-riga/);
    assert.equal(t.match(/\/distributore\/ordini\//g), null, 'nessun link alla pagina dell\'ordine nella lista: ci si arriva dal pannello ("Apri ordine completo")');
    for (const riga of righe) assert.match(riga, /<span class="sto-c-freccia" aria-hidden="true"><svg/, 'chevron verso il basso su tutte le righe');
    const [r91, r90, r89, r88] = righe;
    // #91: da preparare, cliente (con il nome escapato) e città, un solo articolo, totale con IVA
    assert.match(r91, /sto-c-ordine">#91</);
    assert.match(r91, /sto-c-ora">\d\d:\d\d</);
    assert.match(r91, /sto-cliente-nome">Rossi &lt;b&gt;Impianti&lt;\/b&gt; S\.r\.l\.<\/strong>\s*<small class="sto-cliente-citta">Genova</);
    assert.match(r91, /sto-mat-nome">1× 87 Elemento A &#34;t&#34; 87gr Diam\. 100<\/span>\s*<\/span>/);
    assert.doesNotMatch(r91, /sto-mat-altri/);
    assert.match(r91, /sto-c-totale">€ 78,69</, '"Da incassare": materiale del banco + IVA, non il totale con la consegna pagata in app');
    assert.doesNotMatch(t, /98,76|122,53/);
    assert.match(r91, /<span class="sto-pillola sto-st-da_preparare"><span class="sto-punto" aria-hidden="true"><\/span>Da preparare<\/span>/);
    // #90: in consegna (Preparato), "+ 1 articolo", senza città; ordine vecchio (importi non salvati): "Da incassare" si ricalcola dalla merce, con l'IVA di oggi
    assert.match(r90, /<span class="sto-pillola sto-st-in_consegna">[\s\S]*?In consegna<\/span>/);
    assert.match(r90, /sto-mat-nome">2× Bocchettone A 90°<\/span><span class="sto-mat-altri">\+ 1 articolo<\/span>/);
    assert.doesNotMatch(r90, /sto-cliente-citta/);
    assert.match(r90, /sto-c-totale">€ 65,88</);
    // #89: `evaso` (ordine vecchio), anche lui "In consegna" (non c'è più "Partito"), "+ 2 articoli", ora italiana (10:40 UTC = 11:40 a Roma d'inverno)
    assert.match(r89, /sto-st-in_consegna">[\s\S]*?In consegna<\/span>/);
    assert.doesNotMatch(t, /In preparazione|Partito|Partiti|sto-st-partito|sto-st-in_preparazione/);
    assert.match(r89, /sto-mat-altri">\+ 2 articoli</);
    assert.doesNotMatch(r89, /<a /);
    assert.match(r89, /sto-c-ora">11:40</);
    // #88: consegnato_il vale più dello stato: resta 'inviato' ma è Consegnato; senza righe "—"
    assert.match(r88, /sto-st-consegnato">[\s\S]*?Consegnato<\/span>/);
    assert.doesNotMatch(r88, /Da preparare/);
    assert.match(r88, /sto-c-materiale">\s*<span class="sto-nessuno">—</);

    // le query: una per i conteggi, una per la pagina, UNA per il materiale di tutta la pagina; periodo 7 -> parametro 7
    const viste = storicoBanco.viste.map((v) => v.tipo).sort();
    assert.deepEqual(viste, ['conteggi', 'lista', 'materiale']);
    const conteggi = storicoBanco.viste.find((v) => v.tipo === 'conteggi');
    const lista = storicoBanco.viste.find((v) => v.tipo === 'lista');
    assert.deepEqual(conteggi.p, [2, 7]);
    assert.deepEqual(lista.p, [2, 7, 50, 0]);
    assert.deepEqual(storicoBanco.viste.find((v) => v.tipo === 'materiale').p, [[91, 90, 89, 88]]);
    assert.match(lista.s, /ORDER BY o\.id DESC LIMIT \? OFFSET \?/);
    // stato "tutti": niente condizione di stato sulla lista; i conteggi non ne hanno mai nel WHERE
    assert.doesNotMatch(lista.s.slice(lista.s.indexOf('WHERE o.distributor_id')), /o\.stato|consegnato_il/);
    assert.doesNotMatch(conteggi.s.slice(conteggi.s.indexOf('WHERE o.distributor_id')), /o\.stato|consegnato_il/);
    assert.match(t, /<nav class="navbar nav-solo-stretta">/); // il menu in basso (Home e Clienti) c'è, com'era
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: Storico ordini, filtri nell\'URL (stato, periodo, ricerca per nome, #numero) e pagine', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const vista = async (percorso) => {
    storicoBanco.viste.length = 0;
    const r = await chiedi(percorso);
    assert.equal(r.status, 200, percorso);
    const testo = await r.text();
    return {
      testo,
      conteggi: storicoBanco.viste.find((v) => v.tipo === 'conteggi'),
      lista: storicoBanco.viste.find((v) => v.tipo === 'lista'),
    };
  };
  const dopoWhere = (v) => v.s.slice(v.s.indexOf('WHERE o.distributor_id')); // salta i FILTER (WHERE ...) dei conteggi
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // stato: la lista prende la condizione dello stato scelto, i conteggi no (così i numeri delle schede restano quelli veri)
    let v = await vista('/distributore/storico?stato=consegnati&periodo=30');
    assert.deepEqual(v.conteggi.p, [2, 30]);
    assert.match(dopoWhere(v.lista), /\(o\.consegnato_il IS NOT NULL\) ORDER BY/);
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.stato|consegnato_il/);
    assert.match(v.testo, /<a class="sto-scheda attiva" href="[^"]*stato=consegnati[^"]*"[^>]*>\s*<span class="sto-punto sto-st-consegnato"/);
    assert.match(v.testo, /class="attivo" aria-current="true">30 giorni</);
    for (const [stato, condizione] of [
      ['da_preparare', /\(o\.consegnato_il IS NULL AND o\.stato = 'inviato'\)/],
      ['in_consegna', /\(o\.consegnato_il IS NULL AND o\.stato IN \('in_evasione', 'evaso'\)\)/],
      // i segnalibri vecchi (In preparazione e Partiti) portano a "In consegna", che li ha assorbiti
      ['in_preparazione', /\(o\.consegnato_il IS NULL AND o\.stato IN \('in_evasione', 'evaso'\)\)/],
      ['partiti', /\(o\.consegnato_il IS NULL AND o\.stato IN \('in_evasione', 'evaso'\)\)/],
    ]) {
      v = await vista('/distributore/storico?stato=' + stato);
      assert.match(dopoWhere(v.lista), condizione, stato);
    }
    assert.match((await vista('/distributore/storico?stato=partiti')).testo, /<a class="sto-scheda attiva" href="[^"]*stato=in_consegna[^"]*"/);

    // valori sconosciuti: tornano ai predefiniti (tutti, 7 giorni) senza errori
    v = await vista('/distributore/storico?stato=boh&periodo=3&pagina=zzz');
    assert.deepEqual(v.lista.p, [2, 7, 50, 0]);
    assert.doesNotMatch(dopoWhere(v.lista), /o\.stato/);

    // periodo: oggi = mezzanotte italiana (nessun parametro), tutti = nessun limite
    v = await vista('/distributore/storico?periodo=oggi');
    assert.match(dopoWhere(v.conteggi), /DATE_TRUNC\('day', NOW\(\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'UTC'/);
    assert.deepEqual(v.conteggi.p, [2]);
    v = await vista('/distributore/storico?periodo=tutti');
    assert.deepEqual(v.conteggi.p, [2]);
    assert.doesNotMatch(dopoWhere(v.conteggi), /creato_il/);

    // ricerca per nome: ILIKE sul cliente, mai concatenata; un % scritto dall'utente vale per sé
    v = await vista('/distributore/storico?q=rossi');
    assert.match(dopoWhere(v.conteggi), /\(u\.ragione_sociale ILIKE \?\)/);
    assert.deepEqual(v.conteggi.p, [2, 7, '%rossi%']);
    assert.doesNotMatch(v.conteggi.s, /rossi/);
    assert.match(v.testo, /name="q" value="rossi"/);
    assert.doesNotMatch(v.testo, /data-storico-svuota[^>]* hidden>/); // con una ricerca la "×" si vede
    assert.match(v.testo, /href="\/distributore\/storico\?stato=tutti&amp;periodo=7" data-storico-svuota/); // e svuota la ricerca
    v = await vista('/distributore/storico?q=' + encodeURIComponent('50%_x'));
    assert.deepEqual(v.conteggi.p.slice(2), ['%50\\%\\_x%']);

    // ricerca per numero: "#91" e "91" cercano anche l'ordine 91; un testo con le cifre mischiate no; troppe cifre no
    for (const q of ['#91', '91', ' # 91 ']) {
      v = await vista('/distributore/storico?q=' + encodeURIComponent(q));
      assert.match(dopoWhere(v.conteggi), /\(u\.ragione_sociale ILIKE \? OR o\.id = \?\)/, q);
      assert.equal(v.conteggi.p[v.conteggi.p.length - 1], 91, q);
    }
    v = await vista('/distributore/storico?q=A%2F89'); // non è un numero d'ordine
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.id = \?/);
    assert.deepEqual(v.conteggi.p.slice(2), ['%A/89%']);
    v = await vista('/distributore/storico?q=' + '9'.repeat(20));
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.id = \?/);
    // con la ricerca i link di stato e periodo la mantengono
    v = await vista('/distributore/storico?q=rossi&stato=in_consegna&periodo=30');
    assert.match(v.testo, /href="\/distributore\/storico\?stato=consegnati&amp;periodo=30&amp;q=rossi"/);
    assert.match(v.testo, /href="\/distributore\/storico\?stato=in_consegna&amp;periodo=oggi&amp;q=rossi"/);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: Storico ordini, paginazione da 50 e stati vuoti', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const conteggiPrima = storicoBanco.conteggi;
  const righePrima = storicoBanco.righe;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // 120 ordini = 3 pagine da 50, con i filtri nei link; la pagina 2 parte dal 51° (OFFSET 50)
    storicoBanco.conteggi = { tutti: 120, da_preparare: 20, in_consegna: 40, consegnati: 60 };
    storicoBanco.viste.length = 0;
    let t = await (await chiedi('/distributore/storico?stato=in_consegna&periodo=30&q=rossi&pagina=2')).text();
    // "in consegna" = 40 ordini: una sola pagina, quindi la pagina 2 chiesta a mano (OFFSET 50) si porta sull'ultima (OFFSET 0)
    assert.deepEqual(storicoBanco.viste.filter((v) => v.tipo === 'lista').map((v) => v.p.slice(-1)[0]), [50, 0]);
    assert.doesNotMatch(t, /class="paginazione"/);

    storicoBanco.viste.length = 0;
    t = await (await chiedi('/distributore/storico?stato=tutti&periodo=tutti&q=rossi&pagina=2')).text();
    assert.match(t, /<span class="conta-pagina">\s*Pagina 2 di 3 · 120 ordini\s*<\/span>/);
    assert.match(t, /href="\/distributore\/storico\?stato=tutti&amp;periodo=tutti&amp;q=rossi&amp;pagina=1">‹ Precedente</);
    assert.match(t, /href="\/distributore\/storico\?stato=tutti&amp;periodo=tutti&amp;q=rossi&amp;pagina=3">Successiva ›</);
    assert.equal(storicoBanco.viste.filter((v) => v.tipo === 'lista').length, 1);
    // oltre l'ultima: si mostra l'ultima (una seconda lettura con OFFSET 100)
    storicoBanco.viste.length = 0;
    t = await (await chiedi('/distributore/storico?stato=tutti&periodo=tutti&pagina=99')).text();
    assert.match(t, /Pagina 3 di 3 · 120 ordini/);
    assert.deepEqual(storicoBanco.viste.filter((v) => v.tipo === 'lista').map((v) => v.p.slice(-1)[0]), [98 * 50, 100]);

    // nessun risultato con i filtri (ma il banco ha ordini): messaggio e link per mostrare tutto, schede ancora cliccabili
    storicoBanco.conteggi = { tutti: 0, da_preparare: 0, in_consegna: 0, consegnati: 0 };
    storicoBanco.righe = [];
    storicoBanco.assoluto = false;
    t = await (await chiedi('/distributore/storico?periodo=oggi&q=zzz')).text();
    assert.match(t, /<p>Nessun ordine con questo filtro\.<\/p>\s*<a class="btn btn-chiaro" href="\/distributore\/storico\?periodo=tutti">Mostra tutti<\/a>/);
    assert.doesNotMatch(t, /Ancora nessun ordine/);
    assert.match(t, /<a class="sto-scheda attiva vuota"/); // zero: la scheda resta un link, col numero grigio
    assert.doesNotMatch(t, /class="sto-tabella"/);

    // nessun ordine in assoluto
    storicoBanco.assoluto = true;
    t = await (await chiedi('/distributore/storico?periodo=tutti')).text();
    assert.match(t, /<p>Ancora nessun ordine\.<\/p>/);
    assert.doesNotMatch(t, /Mostra tutti|Nessun ordine con questo filtro/);
  } finally {
    storicoBanco.conteggi = conteggiPrima;
    storicoBanco.righe = righePrima;
    storicoBanco.assoluto = true;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: /distributore/ordini porta allo Storico (301, con i filtri); il dettaglio e i POST restano, i ripieghi vanno allo Storico', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    let r = await chiedi('/distributore/ordini');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/distributore/storico');
    r = await chiedi('/distributore/ordini?stato=consegnati&periodo=30&q=%2391');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/distributore/storico?stato=consegnati&periodo=30&q=%2391');
    // il dettaglio non è una lista: un ordine che non c'è è 404, non un redirect
    assert.equal((await chiedi('/distributore/ordini/999')).status, 404);
    // i POST su un ordine che non è del banco tornano allo Storico (prima alla vecchia lista)
    r = await chiedi('/distributore/ordini/999/preparazione', form({}));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/storico');
    // la bolla non esiste più: non c'è nessuna rotta per emetterla
    assert.equal((await chiedi('/distributore/ordini/999/ddt', form({}))).status, 404);
    // senza accesso: come ogni pagina del banco, al login
    biscotti.cookie = '';
    r = await chiedi('/distributore/storico');
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/login/);
  } finally {
    banco.attivo = false;
    biscotti.cookie = '';
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
