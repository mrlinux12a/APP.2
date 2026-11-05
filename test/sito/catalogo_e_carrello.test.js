// Carrello, posizione di consegna, profilo, ricerca nel catalogo e invio con tutti i banchi chiusi.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38472);
const {
  banchiAttiviProva, biscotti, catalogo, chiedi, erroriServer, form, json, nominatim, posizioniProva, radice, registro, storico,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

test('carrello: imposta, tetto sulla quantità, id non valido o inesistente', async () => {
  let r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 5 }));
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.pezzi, 5);
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 99999999999 }));
  d = await r.json();
  assert.equal(d.carrello['1'], 9999);
  assert.equal(d.pezzi, 9999);
  r = await chiedi('/api/carrello/imposta', json({ id: 'abc', qty: 3 }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
  r = await chiedi('/api/carrello/imposta', json({ id: 999, qty: 3 }));
  assert.equal(r.status, 404);
  r = await chiedi('/api/carrello');
  d = await r.json();
  assert.deepEqual(Object.keys(d.carrello), ['1']);
  assert.equal(d.pezzi, 9999, "l'id inventato non resta nel carrello");
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 0 }));
  assert.equal((await r.json()).pezzi, 0);
});

test('posizione di consegna: l\'indirizzo del carrello parte VUOTO, due modi per darlo (scriverlo o il pulsante accanto al campo che usa la posizione del dispositivo); non si invia senza un indirizzo', async () => {
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 5 }));
  const t = await (await chiedi('/carrello')).text();
  // il campo non è precompilato (nemmeno con l'indirizzo dell'account): vuoto e obbligatorio, aperto, con il pulsante accanto e le coordinate nascoste
  assert.match(t, /<input type="text" id="destinazione" name="destinazione" value="" required/);
  assert.doesNotMatch(t, /value="Via Puggia 22\/3, Genova"/);
  assert.match(t, /<div class="consegna-input-riga">\s*<input type="text" id="destinazione"[^>]*>\s*<button type="button" class="consegna-pos-btn" data-consegna-pos-usa\s+aria-label="Usa la mia posizione" title="Usa la mia posizione"><svg/, 'il pulsante sta accanto al campo');
  assert.match(t, /<input type="hidden" name="dest_lat" value="" data-dest-lat>/);
  assert.match(t, /<input type="hidden" name="dest_lng" value="" data-dest-lng>/);
  assert.match(t, /<div class="consegna-pos" data-consegna-pos role="status" hidden>/);
  assert.match(t, /<button type="button" class="btn-cambia" data-consegna-cambia>Fatto<\/button>/, 'senza indirizzo il campo è aperto');
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 0 }));

  // dalla posizione all'indirizzo: la geocodifica inversa, già nel formato del campo ("Via, civico, CAP città (provincia)", col CAP di OpenStreetMap)
  nominatim.chiamate.length = 0;
  let r = await chiedi('/api/indirizzo?lat=44.4019&lng=8.9742');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, indirizzo: 'Via Puggia 22/3, 16131 Genova (GE)', civico: true, precisa: true });
  assert.match(nominatim.chiamate[0], /\/reverse\?.*lat=44\.4019.*lon=8\.9742/);
  assert.match(nominatim.chiamate[0], /zoom=18/, 'senza la precisione del dispositivo ci si fida: la casa più vicina');
  // con la precisione dichiarata dal dispositivo: fino a 30 m il civico vale; oltre sarebbe quello di un'altra casa (da Via Puggia 22 usciva il 17, 106 m più in là),
  // quindi si prende solo la via più vicina (zoom 17), senza numero, e si dice che la posizione non bastava
  for (const [precisione, giusto] of [['5', true], ['30', true], ['31', false], ['100', false], ['5000', false]]) {
    nominatim.chiamate.length = 0;
    r = await chiedi('/api/indirizzo?lat=44.4019&lng=8.9742&precisione=' + precisione);
    assert.deepEqual(await r.json(), giusto
      ? { ok: true, indirizzo: 'Via Puggia 22/3, 16131 Genova (GE)', civico: true, precisa: true }
      : { ok: true, indirizzo: 'Via Puggia, 16131 Genova (GE)', civico: false, precisa: false }, 'precisione ' + precisione);
    assert.match(nominatim.chiamate[0], giusto ? /zoom=18/ : /zoom=17/, 'precisione ' + precisione);
  }
  // una precisione che non è un numero non cambia nulla (come se mancasse)
  assert.equal((await (await chiedi('/api/indirizzo?lat=44.4019&lng=8.9742&precisione=abc')).json()).civico, true);
  // senza una via, fuori dall'Italia o con coordinate che non valgono: nessun indirizzo, il campo resta da scrivere
  const inversaPrima = nominatim.inversa;
  try {
    nominatim.inversa = { address: { country_code: 'it', city: 'Genova' } };
    assert.deepEqual(await (await chiedi('/api/indirizzo?lat=44.4&lng=8.9')).json(), { ok: false, indirizzo: '' });
    nominatim.inversa = { address: { country_code: 'fr', road: 'Rue X', city: 'Nice' } };
    assert.deepEqual(await (await chiedi('/api/indirizzo?lat=44.4&lng=8.9')).json(), { ok: false, indirizzo: '' });
    nominatim.inversa = null; // il servizio non risponde bene
    assert.deepEqual(await (await chiedi('/api/indirizzo?lat=44.4&lng=8.9')).json(), { ok: false, indirizzo: '' });
  } finally {
    nominatim.inversa = inversaPrima;
  }
  nominatim.chiamate.length = 0;
  for (const q of ['', '?lat=abc&lng=8.9', '?lat=51.5&lng=-0.12', '?lat=0&lng=0']) {
    assert.deepEqual(await (await chiedi('/api/indirizzo' + q)).json(), { ok: false, indirizzo: '' }, q);
  }
  assert.deepEqual(nominatim.chiamate, [], 'coordinate che non valgono non arrivano nemmeno al servizio');
  // solo il cliente loggato
  const conSessione = biscotti.cookie;
  biscotti.cookie = '';
  try {
    assert.equal((await chiedi('/api/indirizzo?lat=44.4&lng=8.9')).status, 401);
  } finally {
    biscotti.cookie = conSessione;
  }

  // lo script: la posizione si legge SOLO al clic sul pulsante (mai all'apertura della pagina), tenendo il rilevamento migliore di qualche secondo (non il primo,
  // spesso grossolano o in cache) e con un secondo tentativo meno preciso; la precisione parte col server; coordinate tolte se si modifica l'indirizzo; messaggi
  // per permesso negato, HTTPS mancante, iPhone e Android; nessun invio senza indirizzo (il civico mancante invece non blocca)
  const js = await (await chiedi('/app.js')).text();
  assert.match(js, /navigator\.geolocation\.getCurrentPosition\(ok, no, opzioni\)/);
  assert.match(js, /navigator\.geolocation\.watchPosition\([\s\S]*?\{ enableHighAccuracy: true, maximumAge: 0, timeout: ATTESA_MASSIMA_MS \}\)/, 'si ascolta il GPS, mai una posizione in cache');
  assert.match(js, /navigator\.geolocation\.clearWatch\(sorveglianza\)/, 'e si smette di ascoltare');
  assert.match(js, /migliore = p;/);
  assert.match(js, /if \(metri <= PRECISIONE_OTTIMA_M\) concludi\(\);/);
  assert.match(js, /encodeURIComponent\(lng\) \+ '&precisione=' \+ encodeURIComponent\(metri\)/, 'il server sa quanto è incerta la posizione');
  assert.doesNotMatch(js, /maximumAge: 300000/, 'niente posizioni vecchie di cinque minuti');
  assert.match(js, /setTimeout\(function \(\) \{\s*\/\/[^\n]*\n\s*if \(e\.defaultPrevented\) return;\s*bottoni\.forEach/, 'un invio fermato (manca il civico) non lascia il pulsante "Paga" disabilitato');
  assert.match(js, /if \(dati\.civico !== false\) \{/);
  assert.match(js, /aggiungi il numero civico\./);
  assert.doesNotMatch(js, /senzaCivico/, 'nessun blocco del pagamento per il civico mancante: chi scrive "via puggia" paga lo stesso');
  assert.match(js, /bottonePos\.addEventListener\('click', cercaPosizione\)/);
  assert.doesNotMatch(js, /\n\s*cercaPosizione\(\);?\s*\n/, 'mai chiamata da sola all\'apertura');
  assert.doesNotMatch(js, /if \(!campo\.value\.trim\(\)\) cercaPosizione/);
  assert.match(js, /enableHighAccuracy: true[\s\S]*?enableHighAccuracy: false/, 'prima preciso, poi approssimato');
  assert.match(js, /fetch\('\/api\/indirizzo\?lat='/);
  assert.match(js, /if \(campo\.value\.trim\(\) !== daPosizione\) \{ destLat\.value = ''; destLng\.value = ''; \}/);
  assert.match(js, /!window\.isSecureContext/);
  assert.match(js, /Impostazioni › Privacy e sicurezza › Localizzazione/, 'come riattivare il permesso su iPhone');
  assert.match(js, /lucchetto accanto all’indirizzo/, 'e su Android');
  assert.match(js, /form\.addEventListener\('submit'[\s\S]*?if \(campo\.value\.trim\(\)\) return;[\s\S]*?e\.preventDefault\(\);/);
  assert.doesNotMatch(js, /\/api\/posizione/, 'la posizione non si legge più in background: viaggia solo col pagamento');
});

test('posizione di consegna: col pagamento vale la posizione dell\'account se l\'indirizzo è il suo, altrimenti quella ricavata dall\'indirizzo scritto; senza indirizzo non si invia nulla', async () => {
  const conCarrello = async (prova) => {
    await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));
    try { await prova(); } finally { await chiedi('/api/carrello/imposta', json({ id: 3, qty: 0 })); }
  };
  const nuove = (da) => registro.slice(da).filter((q) => /^INSERT INTO requests/.test(q));
  await conCarrello(async () => {
    // 1. nessun indirizzo (vuoto o solo spazi, con o senza coordinate): errore, niente richiesta, niente posizione
    posizioniProva.length = 0;
    nominatim.chiamate.length = 0;
    let prima = registro.length;
    for (const corpo of [{ modo: 'imposta' }, { modo: 'imposta', destinazione: '   ' }, { modo: 'imposta', destinazione: '', dest_lat: '44.4', dest_lng: '8.9' }]) {
      const r = await chiedi('/richieste', form(corpo));
      assert.equal(r.status, 400, JSON.stringify(corpo));
      const t = await r.text();
      assert.match(t, /Manca l’indirizzo di consegna/);
      assert.match(t, /Torna al riepilogo/);
    }
    assert.deepEqual(nuove(prima), [], 'nessuna richiesta');
    assert.deepEqual(posizioniProva, []);
    assert.deepEqual(nominatim.chiamate, []);

    // 2. indirizzo ricavato dalla posizione del dispositivo (pulsante accanto al campo): le sue coordinate vanno salvate così come sono, senza altre chiamate alla mappa
    prima = registro.length;
    let r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'pos-dispositivo-1', destinazione: 'Via Puggia 22/3, 16131 Genova (GE)', dest_lat: '44.4019', dest_lng: '8.9742' }));
    assert.equal(r.status, 302);
    assert.deepEqual(posizioniProva, [[44.4019, 8.9742, null, 1]], 'lat, lng, nessuna precisione, id del cliente');
    assert.deepEqual(nominatim.chiamate, []);
    assert.equal(nuove(prima).length, 1, 'la richiesta parte');
    await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));

    // 3. indirizzo scritto a mano (nessuna coordinata): la posizione si ricava dall'indirizzo
    posizioniProva.length = 0;
    r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'pos-scritto-1', destinazione: 'Via Prova 1, 16100 Genova' }));
    assert.equal(r.status, 302);
    assert.deepEqual(posizioniProva, [[44.4056, 8.9463, null, 1]]);
    assert.equal(nominatim.chiamate.length, 1);
    assert.match(nominatim.chiamate[0], /\/search\?.*q=Via\+Prova\+1%2C\+16100\+Genova%2C\+Italia/);
    await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));

    // 4. coordinate che non valgono (fuori Italia, testo): si ignorano e si ricava dall'indirizzo
    posizioniProva.length = 0;
    r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'pos-strane-1', destinazione: 'Via Prova 1, Genova', dest_lat: '51.5', dest_lng: '-0.12' }));
    assert.equal(r.status, 302);
    assert.deepEqual(posizioniProva, [[44.4056, 8.9463, null, 1]]);
    await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));

    // 5. la mappa non trova l'indirizzo: la richiesta parte comunque e la posizione resta quella di prima (nessuna scrittura)
    posizioniProva.length = 0;
    const cercaPrima = nominatim.cerca;
    nominatim.cerca = [];
    try {
      prima = registro.length;
      r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'pos-introvabile-1', destinazione: 'Via Che Non Esiste 99' }));
      assert.equal(r.status, 302);
      assert.deepEqual(posizioniProva, []);
      assert.equal(nuove(prima).length, 1);
    } finally {
      nominatim.cerca = cercaPrima;
    }
  });
});

test('carrello: aggiungi e batch con valori strani', async () => {
  let r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 3 }));
  let d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.prodottoQty, 3);
  r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 99999 }));
  assert.equal((await r.json()).prodottoQty, 9999);
  assert.equal((await chiedi('/api/carrello/aggiungi', json({ id: 'x', qty: 1 }))).status, 400);
  r = await chiedi('/api/carrello/aggiungi-batch', json({ items: [null, 5, 'a', { id: 1, qty: 2 }, { id: 'zz', qty: 1 }, { id: 999, qty: 1 }] }));
  d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(d.aggiornati), ['1']);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({ items: 'niente' }))).status, 400);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({}))).status, 400);
});

test('carrello: pagina con articoli e totali', async () => {
  const r = await chiedi('/carrello');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Valvola a sfera/);
  assert.match(t, /max="9999"/);
});

test('carrello: "Cosa paghi e a chi" — Consegna in cantiere (ORA, in app) e Materiale (DOPO a BOREA), a prezzo del banco: i numeri della specifica', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));
  await chiedi('/api/carrello/imposta', json({ id: 4, qty: 1 }));
  const t = await (await chiedi('/carrello')).text();
  const riep = (chiave) => [...t.matchAll(new RegExp('data-riep="' + chiave + '">([^<]*)<', 'g'))].map((m) => m[1]);

  // le righe mostrano il PREZZO DEL BANCO (niente 10%), e il loro totale è netto × quantità
  assert.match(t, /<div class="art-prezzo">€ 54,50 cad\. · IVA esclusa · prezzo del banco<\/div>/);
  assert.match(t, /data-totale-riga="3">€ 54,50</);
  assert.match(t, /data-totale-riga="4">€ 10,00</);
  assert.doesNotMatch(t, /59,95|11,00/, 'il prezzo col 10% non si vede più');

  // A) la paghi ora: corriere 5,00 + servizio con l'IVA dentro 7,87 (10% di 64,50 = 6,45, più IVA) = 12,87; nessuna riga IVA a parte
  assert.match(t, /<section class="cp-riquadro cp-ora"/);
  assert.match(t, /<span class="cp-badge cp-badge-ora">Paghi ora<\/span>/);
  assert.match(t, /Il nostro servizio: lo addebitiamo quando premi "Paga e invia richiesta"./);
  assert.deepEqual(riep('app_corriere'), ['5,00']);
  assert.deepEqual(riep('app_servizio'), ['7,87']);
  assert.deepEqual(riep('app_totale'), ['12,87', '12,87'], 'nel riquadro e nella barra');
  assert.match(t, /Servizio<\/span> <span class="cp-sp">· <span data-riep="servizio_pct">10<\/span>% della merce \(€ <span data-riep="banco_merce">64,50<\/span>\) \+ IVA<\/span>/);
  assert.match(t, /Totale da pagare ora<span class="cp-sp cp-nota-iva">IVA inclusa<\/span>/);
  // richiesta esplicita del 23/10/2026: il servizio ha l'IVA dentro, nel riquadro "paghi ora" non c'è più la riga IVA (resta quella del materiale)
  assert.deepEqual(riep('app_imponibile'), [], 'niente riga IVA nel riquadro "paghi ora"');
  assert.deepEqual(riep('app_iva'), []);
  assert.deepEqual(riep('iva_pct'), ['22'], 'una sola riga IVA in pagina: quella del materiale');

  // B) la paghi dopo a BOREA: merce 64,50 (= somma delle righe) + IVA 14,19 = 78,69; nessun RAEE
  assert.match(t, /<span class="cp-badge cp-badge-dopo">Paghi dopo (a [^<]+|al banco)<\/span>/);
  assert.match(t, /Non lo paghi ora: te lo fattura [^<]+\./);
  assert.deepEqual(riep('banco_merce'), ['64,50', '64,50']);
  assert.deepEqual(riep('articoli'), ['2 articoli']);
  assert.deepEqual(riep('banco_imponibile'), ['64,50']);
  assert.deepEqual(riep('banco_iva'), ['14,19']);
  assert.deepEqual(riep('banco_totale'), ['78,69']);
  assert.match(t, /<div class="cp-riga" data-riga-raee hidden>/, 'senza RAEE la riga c\'è ma è nascosta');
  // C) spesa complessiva = i due totali
  assert.deepEqual(riep('spesa'), ['91,56']);
  assert.equal(Math.round((12.87 + 78.69) * 100) / 100, 91.56);
  // la barra: "Paghi ora · consegna" e l'importo addebitato
  assert.match(t, /<span class="bp-label">Paghi ora · consegna<\/span>\s*<span class="bp-importo">€ <span data-riep="app_totale">12,87<\/span>/);
  assert.match(t, /<span>Se nessun banco accetta, ti rimborsiamo<\/span>/);
  // ordine minimo: 64,50 di merce ≥ 33
  assert.match(t, /data-minimo-avviso hidden>/);
  assert.doesNotMatch(t, /data-btn-paga disabled/);
  // niente più il vecchio riepilogo
  assert.doesNotMatch(t, /Materiale, da pagare al banco|Paghi ora in app|riepilogo-card/);
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello: l\'articolo con RAEE — il contributo sta solo nel Materiale (con la sua IVA), mai nella consegna', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 5, qty: 2 }));
  const t = await (await chiedi('/carrello')).text();
  const riep = (chiave) => [...t.matchAll(new RegExp('data-riep="' + chiave + '">([^<]*)<', 'g'))].map((m) => m[1]);
  // merce 200,00 (2 × 100) + RAEE 5,00 = 205,00 → IVA 45,10 → materiale 250,10
  assert.match(t, /<div class="cp-riga" data-riga-raee><dt><span class="cp-et">Contributo RAEE<\/span><\/dt><dd>€ <span data-riep="banco_raee">5,00<\/span>/);
  assert.deepEqual(riep('banco_merce'), ['200,00', '200,00']);
  assert.deepEqual(riep('banco_imponibile'), ['205,00']);
  assert.deepEqual(riep('banco_iva'), ['45,10']);
  assert.deepEqual(riep('banco_totale'), ['250,10']);
  // in app: corriere 5 + servizio 20 (10% di 200, senza RAEE) con la sua IVA = 24,40 → 29,40
  assert.deepEqual(riep('app_servizio'), ['24,40']);
  assert.deepEqual(riep('app_totale'), ['29,40', '29,40']);
  assert.deepEqual(riep('spesa'), ['279,50']); // 29,40 + 250,10
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello: l\'ordine minimo si misura sul prezzo del banco (non su quello col servizio)', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  // 8 × 4,00 = 32,00 di merce a prezzo del banco: sotto il minimo di 33 (col 10% sarebbero 35,20: sopra)
  await chiedi('/api/carrello/imposta', json({ id: 2, qty: 8 }));
  let t = await (await chiedi('/carrello')).text();
  assert.match(t, /data-minimo-avviso>\s*<strong>Ordine minimo € 33,00<\/strong>[\s\S]*?Ti mancano <strong>€ <span data-riep="manca">1,00<\/span>/);
  assert.match(t, /data-btn-paga disabled/);
  // 9 × 4,00 = 36,00: raggiunto
  await chiedi('/api/carrello/imposta', json({ id: 2, qty: 9 }));
  t = await (await chiedi('/carrello')).text();
  assert.match(t, /data-minimo-avviso hidden>/);
  assert.doesNotMatch(t, /data-btn-paga disabled/);
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello dal vivo: /api/carrello/imposta restituisce tutte le voci già pronte (stesse chiavi della pagina) e i totali di riga', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));
  await chiedi('/api/carrello/imposta', json({ id: 4, qty: 1 }));
  const r = await (await chiedi('/api/carrello/imposta', json({ id: 3, qty: 2 }))).json();
  assert.equal(r.ok, true);
  // merce 119,00 (109 + 10): servizio 11,90 → con IVA 14,52; app 5 + 14,52 = 19,52 (di cui imponibile 16,00 e IVA 3,52); materiale 119 + IVA 26,18 = 145,18; spesa 164,70
  assert.deepEqual(
    [r.riepilogo.banco_merce, r.riepilogo.app_servizio, r.riepilogo.app_imponibile, r.riepilogo.app_iva, r.riepilogo.app_totale, r.riepilogo.banco_iva, r.riepilogo.banco_totale, r.riepilogo.spesa],
    ['119,00', '14,52', '16,00', '3,52', '19,52', '26,18', '145,18', '164,70']
  );
  assert.deepEqual([r.riepilogo.articoli, r.riepilogo.con_raee, r.riepilogo.raggiunto, r.riepilogo.manca], ['2 articoli', false, true, '0,00']);
  assert.deepEqual(r.totali_righe, { 3: '109,00', 4: '10,00' });
  assert.equal(r.totali.da_pagare_app, 19.52, 'l\'addebito è proprio app.totale');
  assert.equal(r.totali.materiale_banco, 145.18);
  assert.equal(r.totali.totale_ivato, 164.7);
  assert.equal(r.pezzi, 3);
  // la pagina ricaricata dice le stesse cose: le voci sono le stesse, scritte dalla stessa funzione
  const t = await (await chiedi('/carrello')).text();
  for (const chiave of ['app_totale', 'app_servizio', 'banco_totale', 'spesa', 'banco_iva', 'banco_merce']) {
    assert.equal((t.match(new RegExp('data-riep="' + chiave + '">([^<]*)<')) || [])[1], r.riepilogo[chiave], chiave);
  }
  assert.match(t, /data-totale-riga="3">€ 109,00</);
  // tolta una riga (quantità 0) la risposta ha comunque i totali di quelle che restano
  const senza = await (await chiedi('/api/carrello/imposta', json({ id: 4, qty: 0 }))).json();
  assert.equal(senza.righe, 1);
  assert.equal(senza.riepilogo.banco_merce, '109,00');
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('profilo: scheda "Sul telefono" con installazione (sempre disponibile, senza ×) e avvisi del browser', async () => {
  const t = await (await chiedi('/profilo')).text();
  assert.match(t, /<h2 class="an-titolo">Sul telefono<\/h2>/);
  assert.match(t, /<section class="installa installa-profilo" data-installa data-installa-sempre hidden/);
  assert.doesNotMatch(t.slice(t.indexOf('Sul telefono')), /data-installa-chiudi/, 'nel profilo non scompare mai');
  assert.match(t, /data-notifiche-stato>Ricevi un avviso quando un banco risponde alla tua richiesta\.<\/div>/);
  // un interruttore on/off, niente "Prova" né notifica di prova
  assert.match(t, /<button type="button" class="ab-switch" role="switch" aria-checked="false" aria-label="Avvisi sul telefono" data-abilita-notifiche>/);
  assert.doesNotMatch(t, /data-prova-notifica/);
  // permesso negato dal telefono: riquadro giallo con i passi (nascosto finché serve, lo riempie app.js)
  assert.match(t, /<div class="an-blocco-notifiche" data-notifiche-blocco hidden role="note">[\s\S]*data-notifiche-passi><\/span>/);
  const js = await (await chiedi('/app.js')).text();
  assert.match(js, /addEventListener\('visibilitychange', controllaPermessoTornando\)/);
});

test('menu del profilo (cliente): niente voce "Notifiche"', async () => {
  const t = await (await chiedi('/home')).text();
  assert.match(t, /La mia anagrafica/);
  assert.match(t, /Storico ordini/);
  assert.doesNotMatch(t, /href="\/notifiche"/);
});

test('ricerca, "Elementi con foto" e home: righe compatte come nella categoria (−/+ salva subito, niente "Aggiungi"), con la foto a sinistra', async () => {
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); // i test di prima possono aver chiuso la sessione
  const catalogoModulo = require(path.join(radice, 'src/logica/catalogo/catalogo.js'));
  const prodotto = { ...catalogo[1], foto_url: '/img/prodotti/valvola.webp', brand_nome: null, categoria: 'Raccordi' };
  const originali = { cercaProdotti: catalogoModulo.cercaProdotti, prodottiConFoto: catalogoModulo.prodottiConFoto };
  catalogoModulo.cercaProdotti = async () => [prodotto];
  catalogoModulo.prodottiConFoto = async () => ({ righe: [prodotto], pagina: 1, pagine: 1, totale: 1 });
  try {
    const comuni = (t) => {
      assert.match(t, /<div id="risultati" data-righe-compatte/);
      assert.match(t, /<div class="card card-fitta elenco-righe">\s*<div class="riga-prod" data-prodotto="1" data-riga-compatta/);
      assert.match(t, /<img class="prodotto-foto riga-foto" src="\/img\/prodotti\/valvola\.webp"/);
      assert.match(t, /data-riga-stepper="1"/);
      assert.match(t, /<div class="barra-vai" data-barra-vai/);
      // niente più card classica con "Aggiungi (N)": né stepper [data-passo], né barra del carrello con il pulsante
      assert.doesNotMatch(t, /data-aggiungi-tutti|data-passo="|griglia-prodotti|data-barra-carrello/);
    };
    const cerca = await (await chiedi('/cerca?q=valvola')).text();
    comuni(cerca);
    // prezzo del banco: 10,00 meno il 30% = 7,00 (col 10% di servizio erano 7,70), lo stesso del carrello e della ricerca live
    assert.match(cerca, /<span class="importo">€ 7,00<\/span> <span class="iva">\+ IVA<\/span>/);
    assert.doesNotMatch(cerca, /7,70/);
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).risultati[0].prezzo, '7,00');
    assert.doesNotMatch(await (await chiedi('/cerca?q=valvola')).text(), /data-troncato/, 'elenco completo: nessun avviso');
    // risultati tagliati dal limite: la pagina lo dice (e la ricerca live manda `troncato` nel JSON)
    catalogoModulo.cercaProdotti = async () => Object.defineProperty([prodotto], 'troncato', { value: true });
    assert.match(await (await chiedi('/cerca?q=valvola')).text(), /<p class="nota nota-troncato" data-troncato>Mostrati i primi risultati/);
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).troncato, true);
    catalogoModulo.cercaProdotti = async () => [prodotto];
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).troncato, false);
    const foto = await (await chiedi('/con-foto')).text();
    comuni(foto);
    assert.match(foto, /data-url="\/api\/con-foto\/prodotti"/, 'lo scroll infinito resta');
    // la home: l'elenco di partenza sono le categorie, ma cercando si disegnano righe compatte (attributi e barra pronti)
    const home = await (await chiedi('/home')).text();
    assert.match(home, /<div id="risultati" data-righe-compatte\s+data-carrello="\{[^"]*\}"/);
    assert.match(home, /<div class="barra-vai" data-barra-vai/);
    assert.doesNotMatch(home, /data-aggiungi-tutti|data-barra-carrello/);
  } finally {
    Object.assign(catalogoModulo, originali);
  }
});

test('carrello: con TUTTI i banchi chiusi (orari) il pulsante dice quando riapre e resta spento; il server rifiuta comunque e non crea la richiesta', async () => {
  biscotti.cookie = '';
  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 50 }));
  const orari = require('../../src/logica/ordini/orari');
  const originale = banchiAttiviProva.righe;
  // Aperto solo "fra due giorni" (a Roma): chiuso adesso, qualunque giorno sia oggi.
  const oggi = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', weekday: 'short' }).format(new Date())];
  const apre = orari.GIORNI[(oggi + 2) % 7];
  const nomeGiorno = orari.NOMI[apre].toLowerCase();
  const soloQuelGiorno = () => [{ id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', orari: Object.fromEntries(orari.GIORNI.map((g) => [g, g === apre ? [['07:30', '12:30']] : []])) }];
  try {
    banchiAttiviProva.righe = soloQuelGiorno();
    let t = await (await chiedi('/carrello')).text();
    // richiesta del 22/10/2026: riquadro "Ordini chiusi" in cima, pulsante di sempre ma spento, nota con la luna sotto il pulsante; il nome del banco viene dal DB
    assert.match(t, /<h2 class="cc-titolo" id="cc-titolo">Ordini chiusi per oggi<\/h2>/);
    assert.match(t, new RegExp('<p class="cc-sotto">BOREA riapre <strong>' + nomeGiorno + ' alle 07:30</strong></p>'));
    assert.match(t, /Puoi continuare ad aggiungere materiale: il carrello resta salvato e lo invii appena riapre\./);
    assert.match(t, /<a class="cc-orari" href="\/orari">[\s\S]*?Vedi orari/);
    assert.match(t, /<button class="btn-paga btn-paga-chiuso" type="submit" form="form-invia" data-btn-paga data-banco-chiuso disabled>Paga e invia richiesta<\/button>/);
    assert.match(t, new RegExp('<span>Ordini chiusi · BOREA riapre <strong>' + nomeGiorno + ' alle 07:30</strong></span>'));
    assert.doesNotMatch(t, /Se nessun banco accetta, ti rimborsiamo/, 'niente promessa di rimborso: non si paga');
    assert.doesNotMatch(t, /bp-chiusura/, 'la striscia "Ancora N min" è solo per quando è aperto e sta per chiudere');

    // la pagina "Orari di BOREA": stato adesso e sette giorni, dagli orari del DB (qui solo "fra due giorni")
    const pagOrari = await chiedi('/orari');
    assert.equal(pagOrari.status, 200);
    const to = await pagOrari.text();
    assert.match(to, /<div class="titolo">Orari di BOREA<\/div>/);
    assert.match(to, /<h1 class="ob-titolo"><span class="ob-punto" aria-hidden="true"><\/span>Chiuso ora<\/h1>/);
    assert.match(to, new RegExp('BOREA riapre <strong>' + nomeGiorno + ' alle 07:30</strong>'));
    assert.equal((to.match(/<li class="ob-giorno/g) || []).length, 7);
    assert.equal((to.match(/<span class="ob-badge ob-badge-oggi">Oggi<\/span>/g) || []).length, 1);
    assert.match(to, /<span class="ob-badge ob-badge-riapre">Riapre<\/span>/);
    assert.match(to, /<span>07:30 – 12:30<\/span>/);
    assert.match(to, /Fuori da questi orari puoi preparare il carrello, ma la richiesta si invia solo quando BOREA è aperto\./);
    assert.doesNotMatch(to, /profilo-btn/, 'solo freccia e titolo');
    assert.match(to, /href="\/carrello" aria-label="Indietro"/);

    // il server rifiuta lo stesso (la pagina può essere rimasta aperta): errore, nessun INSERT, il carrello resta
    const prima = registro.length;
    const r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'prova-banco-chiuso', destinazione: 'Via Puggia 22/3' }));
    assert.equal(r.status, 400);
    t = await r.text();
    assert.match(t, /Il banco è chiuso/);
    assert.match(t, new RegExp('Riapre ' + nomeGiorno + ' alle 07:30\\. Non è stato addebitato nulla'));
    assert.equal(registro.slice(prima).some((q) => /INSERT INTO requests/.test(q)), false);
    assert.match(await (await chiedi('/carrello')).text(), /Valvola a sfera/);

    // basta UNA filiale aperta: il pulsante torna quello di sempre
    banchiAttiviProva.righe = [...soloQuelGiorno(), { id: 3, nome: 'BOREA SRL', filiale: 'Banco Genova Staglieno', orari: Object.fromEntries(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((g) => [g, [['00:00', '23:59']]])) }];
    t = await (await chiedi('/carrello')).text();
    assert.match(t, /<button class="btn-paga" type="submit" form="form-invia" data-btn-paga >Paga e invia richiesta<\/button>/);
    assert.doesNotMatch(t, /btn-paga-chiuso|data-banco-chiuso|cc-chiuso/);
    assert.match(t, /Se nessun banco accetta, ti rimborsiamo/);

    // aperto ma sta per chiudere: striscia sopra la barra di pagamento ("Ancora 9 min per inviare: alle HH:MM chiudiamo"), il pulsante resta quello di sempre.
    // Gli orari si costruiscono sull'ora di Roma di adesso (chiude fra 9 minuti): vicino alla mezzanotte non si può, e quel pezzo si salta.
    const romaOra = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const adessoMin = Number(romaOra.find((p) => p.type === 'hour').value) * 60 + Number(romaOra.find((p) => p.type === 'minute').value);
    if (adessoMin >= 5 && adessoMin <= 1440 - 20) {
      const testoOra = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const chiudeAlle = testoOra(adessoMin + 9);
      banchiAttiviProva.righe = [{ id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', orari: Object.fromEntries(orari.GIORNI.map((g) => [g, [[testoOra(adessoMin - 5), chiudeAlle]]])) }];
      t = await (await chiedi('/carrello')).text();
      assert.match(t, new RegExp('<div class="bp-chiusura" role="status" data-chiusura-sec="\\d+" data-chiusura-ora="' + chiudeAlle + '">'));
      assert.match(t, new RegExp('Ancora <strong data-chiusura-min>(9|10) min</strong> per inviare: alle ' + chiudeAlle + ' chiudiamo'));
      assert.match(t, /<button class="btn-paga" type="submit" form="form-invia" data-btn-paga >Paga e invia richiesta<\/button>/);
      assert.doesNotMatch(t, /cc-chiuso|btn-paga-chiuso/);
      // più lontano dalla chiusura (oltre la soglia): niente striscia
      banchiAttiviProva.righe = [{ id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', orari: Object.fromEntries(orari.GIORNI.map((g) => [g, [['00:00', '23:59']]])) }];
      if (adessoMin <= 1440 - 40) assert.doesNotMatch(await (await chiedi('/carrello')).text(), /bp-chiusura/);
    }
  } finally {
    banchiAttiviProva.righe = originale;
  }

  // "Rinvia richiesta" non parte neanche lui a banco chiuso (ritorna alla richiesta, non al carrello)
  storico.attivo = true;
  try {
    banchiAttiviProva.righe = soloQuelGiorno();
    const r = await chiedi('/richieste/4/reinvia', { method: 'POST' });
    assert.equal(r.status, 400);
    const t = await r.text();
    assert.match(t, /Il banco è chiuso/);
    assert.match(t, /<a[^>]*href="\/richieste\/4"[^>]*>\s*Torna alla richiesta\s*<\/a>/);
  } finally {
    banchiAttiviProva.righe = originale;
    storico.attivo = false;
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
