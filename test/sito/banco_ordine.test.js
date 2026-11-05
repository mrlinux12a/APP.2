// Banco: pagina dell'ordine, dettaglio dello Storico, "Preparato".
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38482);
const {
  banco, biscotti, chiedi, erroriServer, fa, form, json, naive, oraRoma, ordine1295, preparaRichiesta, registro, richiestaProva,
  rigaRichiestaProva, righeOrdineBanco, ritiroTra, scrittureOrdini,
} = aiuti;

test('banco: pagina dell\'ordine a due colonne: materiale a prezzo del banco, consegna, cliente, avanzamento, ritiro del corriere e "Preparato"', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const ripristina = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, ripristina, extra); };
  const pagina = async () => { const r = await chiedi('/distributore/ordini/1295'); assert.equal(r.status, 200); return r.text(); };
  const fasi = (t) => [...t.matchAll(/<li class="ric-passo ric-passo-(\w+) ric-fase-(\w+)"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/g)].map((m) => [m[3], m[2], m[1], m[4]]);
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    // istanti del corriere freschi (il disegno li vuole a 22 minuti dal ritiro: la prova gira qualche secondo dopo il caricamento del file)
    imposta(ritiroTra(22));
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 900, ordine: ordine1295 });
    const rispostoIl = richiestaProva.risposta.risposto_il; // TIMESTAMP UTC senza fuso, letto come ora locale
    const confermatoAlle = oraRoma(new Date(Date.UTC(rispostoIl.getFullYear(), rispostoIl.getMonth(), rispostoIl.getDate(), rispostoIl.getHours(), rispostoIl.getMinutes(), rispostoIl.getSeconds())));
    scrittureOrdini.length = 0;
    let t = await pagina();
    assert.equal(scrittureOrdini.length, 0, 'aprire la pagina non scrive niente: l\'ordine resta "Da preparare" finché non si preme Preparato');

    // ----- testata: freccia, titolo, stato (da preparare: blu, col pallino che pulsa), cliente e quando è arrivato -----
    assert.match(t, /<header class="banco-testa"[^>]*>/);
    assert.match(t, /class="banco-voce attiva" href="\/distributore\/storico" aria-current="page"/, '"Storico ordini" resta accesa');
    assert.match(t, /<a class="ric-indietro" href="\/distributore"/);
    assert.match(t, /<h1 class="ric-titolo">Ordine #1295<\/h1>\s*<span class="ric-stato ric-st-da_preparare"><span class="ric-punto pulse" aria-hidden="true"><\/span>Da preparare<\/span>\s*<span class="ord-cliente-nome">Prova S\.r\.l\.<\/span>/);
    assert.match(t, /<span class="ric-ricevuta">Ricevuto oggi alle \d\d:\d\d · da richiesta #177<\/span>/);
    // niente delle vecchie righe: partenza e consegna dichiarate, "Consegna con mezzo del distributore", "Cliente ordinante", imponibile col servizio
    assert.doesNotMatch(t, /Partenza dichiarata|Consegna dichiarata|mezzo del distributore|Cliente ordinante|Dove consegnare|Imponibile|80,95/);

    // ----- materiale da preparare: righe a PREZZO DEL BANCO (mai 59,95 / 11,00); niente spunte né "Lista di prelievo" -----
    assert.match(t, /<h2 class="ric-h2" id="ord-mat-titolo">Materiale da preparare<\/h2>/);
    assert.match(t, /<span>Q\.tà<\/span><span>Articolo<\/span><span class="ric-num">Prezzo cad\.<\/span><span class="ric-num">Totale<\/span>/);
    assert.doesNotMatch(t, /Preso|presi|data-preso|ord-check|ord-presi|Lista di prelievo|ord-stampa|<label class="ord-riga/);
    const righe = t.split('<div class="ord-riga">').slice(1).map((x) => x.slice(0, x.indexOf('</div>')));
    assert.equal(righe.length, 2);
    assert.match(righe[0], /<span class="ric-qta">1×<\/span>[\s\S]*?<strong class="ric-nome">Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/strong>\s*<small class="ric-cod">Cod\. 12514597<span class="ord-cad-sub"> · € 54,50 cad\.<\/span><\/small>/);
    assert.match(righe[0], /<span class="ric-num ord-cad">€ 54,50<\/span>\s*<span class="ric-num ric-tot">€ 54,50<\/span>/);
    assert.match(righe[1], /<span class="ric-num ord-cad">€ 10,00<\/span>\s*<span class="ric-num ric-tot">€ 10,00<\/span>/);
    assert.doesNotMatch(t.slice(t.indexOf('ord-materiale'), t.indexOf('ord-coppia')), /59,95|11,00|richiesti/);
    // piede: la nota e Merce, IVA e Totale del banco (importi(ordine).banco: 64,50 + 14,19 = 78,69)
    assert.match(t, /<p class="ord-piede-nota">Il materiale lo incassi tu dal cliente, con la tua fattura\. Prezzi del banco\.<\/p>/);
    assert.match(t, /<dt>Merce<\/dt><dd>€ 64,50<\/dd><\/div>\s*<div><dt>IVA 22%<\/dt><dd>€ 14,19<\/dd><\/div>\s*<div class="ord-totale"><dt>Totale<\/dt><dd>€ 78,69<\/dd>/);
    assert.doesNotMatch(t, /<dt>RAEE<\/dt>/);

    // ----- ritiro del corriere: verde (22 min, più della soglia di 15), l'ora e chi ha accettato -----
    // l'orario che vede il banco è esattamente quello scritto dal corriere su WhatsApp (ha risposto + i suoi minuti), NON corriere_arrivo_il (l'arrivo dal cliente)
    const ritira = oraRoma(new Date(ordine1295.corriere_risposto_il.getTime() + ordine1295.corriere_minuti * 60000));
    assert.notEqual(ritira, oraRoma(ordine1295.corriere_arrivo_il), 'ritiro dal banco e arrivo dal cliente sono due orari diversi');
    assert.match(t, /<section class="ric-scheda ord-ritiro" aria-label="Ritiro del corriere">\s*<div class="ric-arrivo-testa" data-ric-arrivo\s+data-secondi="13[12]\d" data-soglia-arrivo="15">/);
    assert.match(t, /<span class="ric-arrivo-min" data-arrivo-min>22 min<\/span>\s*<span class="ric-arrivo-sotto">al ritiro<\/span>/);
    assert.match(t, new RegExp('<h2 class="ric-arrivo-titolo">Il corriere ritira alle ' + ritira + '</h2>\\s*<p>Marco ha accettato alle ' + oraRoma(ordine1295.corriere_risposto_il) + '\\. Prepara la merce\\.</p>'));

    // ----- consegna: via in grassetto, sotto CAP e città; furgone; niente link a Maps. E cliente: iniziali, referente e P. IVA, telefono, scheda -----
    assert.match(t, /<h2 class="ric-occhiello" id="ord-cons-et">Consegna<\/h2>/);
    assert.match(t, /<strong>Via Castel Morrone 1\/7r<\/strong>\s*<small>16161 Genova \(GE\)<\/small>/);
    assert.match(t, /<span>Corriere Marco · ritiro al banco<\/span>/);
    assert.doesNotMatch(t, /Apri in Maps|google\.com\/maps/);
    assert.match(t, /<h2 class="ric-occhiello" id="ord-cli-et">Cliente<\/h2>\s*<div class="ric-cliente-testa">\s*<span class="avatar avatar-42" aria-hidden="true">PR<\/span>/);
    assert.match(t, /<strong>Prova S\.r\.l\.<\/strong>\s*<small>referente Mario · P\. IVA 01234567890<\/small>/);
    assert.match(t, /<span>010 123 456<\/span>/); // telefono non cliccabile
    assert.doesNotMatch(t, /href="tel:/);
    assert.match(t, /<a class="ric-apri-cliente" href="\/distributore\/clienti\/1">Apri scheda cliente/);

    // ----- avanzamento: confermato (con l'ora), corriere trovato, da preparare (attuale, blu, "Ritiro alle"), in consegna, consegnato -----
    assert.deepEqual(fasi(t), [
      ['Confermato da te', 'fatto', 'verde', 'Alle ' + confermatoAlle],
      ['Corriere trovato', 'fatto', 'verde', 'Marco ha accettato alle ' + oraRoma(ordine1295.corriere_risposto_il)],
      ['Da preparare', 'corrente', 'blu', 'Ritiro alle ' + ritira],
      ['In consegna', 'futuro', 'verde', 'La merce passa al corriere'],
      ['Consegnato', 'futuro', 'verde', 'Lo conferma il cliente'],
    ]);

    // ----- "Preparato": un form che porta l'ordine "In consegna" e riporta qui (con la pagina da cui si è arrivati); nessuna traccia della bolla -----
    assert.match(t, /<section class="ric-scheda ord-prepara" aria-labelledby="ord-prepara-titolo">\s*<h2 class="ric-h2 ord-prepara-titolo" id="ord-prepara-titolo">Materiale pronto\?<\/h2>\s*<form method="POST" action="\/distributore\/ordini\/1295\/preparazione">\s*<input type="hidden" name="torna" value="\/distributore">\s*<button class="ord-prepara-btn" type="submit"><svg[\s\S]*?<\/svg>Preparato<\/button>/);
    assert.doesNotMatch(t, /bolla|DDT|\/ddt|ord-stepper|ord-segmenti|Emetti|Annotazioni/i);

    // ----- "Elimina ordine" in fondo, com'era -----
    assert.match(t, /<form class="ric-elimina-riga" method="POST" action="\/distributore\/ordini\/1295\/elimina" onsubmit="return confirm\([^"]*\)">\s*<button class="ric-elimina" type="submit"><svg[\s\S]*?<\/svg>Elimina ordine<\/button>/);
    assert.ok(t.indexOf('ric-elimina-riga') > t.indexOf('ric-passi'), 'in fondo alla colonna di sinistra');

    // ----- la spunta "preso" non esiste più: la rotta che la salvava risponde 404 e non scrive niente -----
    scrittureOrdini.length = 0;
    let r = await chiedi('/distributore/ordini/1295/righe/11/preso', json({ preso: true }));
    assert.equal(r.status, 404);
    assert.equal(scrittureOrdini.length, 0);

    // ----- con il corriere vicino (8 min) il cerchio è rosso; in ritardo, "In ritardo"; poi, partita la merce, il riquadro sparisce -----
    imposta(ritiroTra(8));
    t = await pagina();
    assert.match(t, /<div class="ric-arrivo-testa vicino" data-ric-arrivo\s+data-secondi="4[78]\d"/);
    assert.match(t, /data-arrivo-min>8 min</);
    imposta(ritiroTra(-2));
    t = await pagina();
    assert.match(t, /ric-arrivo-testa vicino/);
    assert.match(t, /data-arrivo-min>In ritardo</);

    // ----- senza corriere (modulo WhatsApp spento): niente riquadro Ritiro né "Corriere trovato"; nessuna riga "Consegna con mezzo del banco"; "Preparato" c'è lo stesso -----
    imposta({ corriere_nome: '', corriere_arrivo_il: null, corriere_risposto_il: null, corriere_minuti: null });
    t = await pagina();
    assert.doesNotMatch(t, /ord-ritiro|data-ric-arrivo|Corriere trovato/);
    assert.doesNotMatch(t, /mezzo del banco|ord-furgone/);
    assert.match(t, /<h2 class="ric-occhiello" id="ord-cons-et">Consegna<\/h2>\s*<div class="ord-indirizzo">/);
    assert.deepEqual(fasi(t).map((f) => [f[0], f[1], f[3]]), [
      ['Confermato da te', 'fatto', fasi(t)[0][3]], ['Da preparare', 'corrente', 'Prepara la merce'], ['In consegna', 'futuro', 'La merce passa al corriere'], ['Consegnato', 'futuro', 'Lo conferma il cliente'],
    ]);
    assert.match(t, /action="\/distributore\/ordini\/1295\/preparazione"/);
    assert.doesNotMatch(t, /bolla|DDT/i);

    // (Le versioni "In consegna" e "Consegnato" della stessa pagina: test "banco: pagina dell'ordine in consegna e consegnato...".)
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: pagina dell\'ordine, disponibilità parziale e RAEE, e aprirla non lo prende in carico', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const righeOriginali = righeOrdineBanco[1295];
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // Aprire la pagina NON prende più in carico l'ordine (prima lo portava in preparazione e avvisava il cliente): resta "Da preparare", da qualunque parte
    // si arrivi (Storico, scheda cliente, home, un altro sito). "In consegna" viene solo da "Preparato".
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });
    for (const intestazioni of [{}, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'cross-site' }]) {
      scrittureOrdini.length = 0;
      const r = await chiedi('/distributore/ordini/1295', { headers: intestazioni });
      assert.equal(r.status, 200);
      assert.equal(scrittureOrdini.length, 0, JSON.stringify(intestazioni));
      assert.match(await r.text(), /ric-st-da_preparare"><span class="ric-punto pulse" aria-hidden="true"><\/span>Da preparare/);
    }
    assert.equal(ordine1295.stato, 'inviato');

    // Contributo RAEE: dentro prezzo cad. e totale di riga, e una voce a parte nel piede; Totale = merce + RAEE + IVA
    righeOrdineBanco[1295] = [
      { id: 21, order_id: 1295, quantita: 2, codice_snapshot: 'C1', nome_snapshot: 'Scaldabagno', prezzo_netto_unitario: 100, subtotale: 200, raee_unitario: 1.5, raee_riga: 3 },
    ];
    Object.assign(ordine1295, { totale_netto: 200, contributo_raee: 3, imponibile_banco: 203, iva_banco: 44.66, materiale_banco: 247.66, da_pagare_app: 20.07 });
    let t = await (await chiedi('/distributore/ordini/1295')).text();
    assert.match(t, /<span class="ric-num ord-cad">€ 101,50<\/span>\s*<span class="ric-num ric-tot">€ 203,00<\/span>/);
    assert.match(t, /<dt>Merce<\/dt><dd>€ 200,00<\/dd><\/div>\s*<div><dt>RAEE<\/dt><dd>€ 3,00<\/dd><\/div>\s*<div><dt>IVA 22%<\/dt><dd>€ 44,66<\/dd><\/div>\s*<div class="ord-totale"><dt>Totale<\/dt><dd>€ 247,66<\/dd>/);
    Object.assign(ordine1295, originale);
    righeOrdineBanco[1295] = righeOriginali;

    // Disponibilità parziale (il banco ha confermato meno del richiesto): sotto il codice "richiesti 3, ne hai confermati 1"; un articolo confermato a zero
    // non è una riga dell'ordine, e si legge sotto la tabella perché non si perda di vista
    const rigaSalvata = { ...rigaRichiestaProva };
    try {
      preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295, extra: { copertura: 'parziale' } });
      Object.assign(rigaRichiestaProva, { codice: '12514597', quantita_richiesta: 3, quantita_disponibile: 1 });
      t = await (await chiedi('/distributore/ordini/1295')).text();
      assert.match(t, /Cod\. 12514597<span class="ord-cad-sub">[^<]*<\/span><\/small>\s*<small class="ord-mancano">richiesti 3, ne hai confermati 1<\/small>/);
      assert.equal((t.match(/class="ord-mancano"/g) || []).length, 1, 'solo la riga confermata a metà');
      assert.doesNotMatch(t, /Non confermati, quindi/);
      Object.assign(rigaRichiestaProva, { codice: 'ZZ9', nome: 'Pompa', quantita_richiesta: 2, quantita_disponibile: 0 });
      t = await (await chiedi('/distributore/ordini/1295')).text();
      assert.match(t, /Non confermati, quindi non in questo ordine:\s*2 pz di Pompa\./);
      assert.doesNotMatch(t, /class="ord-mancano"/);
    } finally {
      Object.assign(rigaRichiestaProva, rigaSalvata);
    }
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });

    // Senza articoli: la pagina lo dice e il pulsante "Preparato" c'è lo stesso
    righeOrdineBanco[1295] = [];
    t = await (await chiedi('/distributore/ordini/1295')).text();
    assert.match(t, /Nessun articolo in questo ordine/);
    assert.match(t, /<button class="ord-prepara-btn" type="submit">\s*<svg/);
    righeOrdineBanco[1295] = righeOriginali;
  } finally {
    for (const k of Object.keys(ordine1295)) delete ordine1295[k];
    Object.assign(ordine1295, originale);
    righeOrdineBanco[1295] = righeOriginali;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

// Istanti fissi (19/10/2026, ora legale: UTC+2) per le prove di "In consegna" e "Consegnato": così nessuna dipende dall'ora o dal giorno in cui gira. Le colonne TIMESTAMP
// (creato_il, evaso_il, consegnato_il, risposto_il) sono UTC senza fuso, come le legge pg (naive); corriere_risposto_il e corriere_arrivo_il sono TIMESTAMPTZ (istanti veri).
const alle = (h, m) => new Date(Date.UTC(2026, 9, 19, h, m)); // hh:mm UTC = hh+2:mm a Roma

// Il corriere ha risposto alle 08:34 UTC (10:34 a Roma) scrivendo "preso 30": arriva dal banco alle 09:04 UTC (11:04). L'arrivo dal cliente (09:21 UTC, 11:21: ritiro + 17 minuti
// di strada) lo vede solo l'installatore.
const ordinePartito = (extra = {}) => ({
  stato: 'in_evasione', creato_il: naive(alle(8, 28)), in_evasione_il: naive(alle(8, 47)), evaso_il: null, consegnato_il: null,
  corriere_risposto_il: alle(8, 34), corriere_minuti: 30, corriere_arrivo_il: alle(9, 21), ...extra,
});

// Le scritture viste dal DB finto (tutto tranne la sessione): una lettura non ne deve produrre nessuna.
const scrittureDa = (prima) => registro.slice(prima).filter((q) => /^(UPDATE|INSERT|DELETE)/.test(q) && !/session/i.test(q));

test('banco: pagina dell\'ordine "In consegna" e "Consegnato": si adatta allo stato, "Apri ordine completo" funziona per tutti e non scrive niente', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const ripristina = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, ripristina, extra); };
  const fasi = (t) => [...t.matchAll(/<li class="ric-passo ric-passo-(\w+) ric-fase-(\w+)"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/g)].map((m) => [m[3], m[2], m[1], m[4]]);
  const prepara = () => preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 900, ordine: ordine1295, extra: { risposto_il: naive(alle(8, 29)) } });
  const pagina = async (torna = '') => {
    const prima = registro.length;
    scrittureOrdini.length = 0;
    const r = await chiedi('/distributore/ordini/1295' + torna);
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.equal(scrittureOrdini.length, 0, 'aprire la pagina non cambia l\'ordine');
    assert.deepEqual(scrittureDa(prima), [], 'nessuna scrittura (né UPDATE, né INSERT, né DELETE)');
    return t;
  };
  const materiale = (t) => t.slice(t.indexOf('ord-materiale'), t.indexOf('ord-coppia'));
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // ----- IN CONSEGNA (Preparato premuto: in_evasione) -----
    imposta(ordinePartito());
    prepara();
    let t = await pagina();
    // testata: pillola azzurra "In consegna" (senza il pallino che pulsa), come sempre il cliente e quando è arrivato
    assert.match(t, /<h1 class="ric-titolo">Ordine #1295<\/h1>\s*<span class="ric-stato ric-st-in_consegna"><span class="ric-punto" aria-hidden="true"><\/span>In consegna<\/span>/);
    assert.match(t, /<span class="ric-ricevuta">Ricevuto (?:oggi|ieri|il \d+ \w+) alle 10:28 · da richiesta #177<\/span>/);
    // materiale: "Materiale partito", senza caselle, con "N articoli · M pezzi" e "Stampa" (che stampa testata e materiale)
    assert.match(t, /<h2 class="ric-h2" id="ord-mat-titolo">Materiale partito<\/h2>/);
    assert.match(t, /<span class="ric-conta">2 articoli · 2 pezzi<\/span>\s*<button class="ord-stampa-btn" type="button" data-stampa><svg[\s\S]*?<\/svg>Stampa<\/button>/);
    assert.match(t, /<span>Q\.tà<\/span><span>Articolo<\/span><span class="ric-num">Prezzo cad\.<\/span><span class="ric-num">Totale<\/span>/);
    assert.doesNotMatch(t, /Preso|presi|data-preso|ord-check|Lista di prelievo/);
    assert.equal(materiale(t).split('<div class="ord-riga">').length - 1, 2);
    assert.match(materiale(t), /<span class="ric-num ord-cad">€ 54,50<\/span>\s*<span class="ric-num ric-tot">€ 54,50<\/span>/);
    assert.doesNotMatch(materiale(t), /59,95|11,00/);
    assert.match(t, /<p class="ord-piede-nota">Il materiale lo incassi tu dal cliente, con la tua fattura\. Prezzi del banco\.<\/p>/);
    assert.match(t, /<div class="ord-totale"><dt>Totale<\/dt><dd>€ 78,69<\/dd>/);
    // scheda azzurra: quando è partito, il ritiro del corriere (il tempo scritto su WhatsApp: 11:04, NON l'arrivo dal cliente delle 11:21) e il corriere
    assert.match(t, /<section class="ric-scheda ord-stato ord-stato-consegna" aria-label="Stato dell'ordine">\s*<div class="ord-stato-testa">\s*<span class="ord-stato-cerchio" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>\s*<div class="ord-stato-testi">\s*<h2 class="ord-stato-titolo">In consegna<\/h2>\s*<p>Partito alle 10:47 · ritiro alle 11:04<\/p>\s*<p class="ord-stato-corriere">Corriere Marco<\/p>/);
    // nessuna traccia della bolla e di quello che serviva solo da preparare: il ritiro, "Preparato", "Elimina ordine"
    assert.doesNotMatch(t, /bolla|DDT|\/ddt\/|ord-ritiro|data-ric-arrivo|ord-prepara|Elimina ordine|ric-elimina/i);
    assert.doesNotMatch(t, /11:21|arrivo previsto/, 'il banco non vede quando la merce arriva dal cliente');
    // consegna e cliente come sempre; avanzamento: partito fatto, consegnato ancora da venire
    assert.match(t, /<strong>Via Castel Morrone 1\/7r<\/strong>/);
    assert.match(t, /<a class="ric-apri-cliente" href="\/distributore\/clienti\/1">Apri scheda cliente/);
    assert.deepEqual(fasi(t), [
      ['Confermato da te', 'fatto', 'verde', 'Alle 10:29'],
      ['Corriere trovato', 'fatto', 'verde', 'Marco ha accettato alle 10:34'],
      ['Partito', 'fatto', 'verde', 'Alle 10:47'],
      ['Consegnato', 'futuro', 'verde', 'Lo conferma il cliente'],
    ]);

    // la freccia torna da dove si è arrivati, come nella versione da preparare (dallo Storico, con la voce aperta)
    const storico = '/distributore/storico?stato=tutti&periodo=7#o1295';
    t = await pagina('?torna=' + encodeURIComponent(storico));
    assert.match(t, /<a class="ric-indietro" href="\/distributore\/storico\?stato=tutti&amp;periodo=7#o1295"/);

    // ----- IN CONSEGNA, senza i minuti del corriere (niente ritiro da dire) -----
    imposta(ordinePartito({ in_evasione_il: naive(alle(8, 50)), corriere_minuti: null, corriere_arrivo_il: null }));
    prepara();
    t = await pagina();
    assert.match(t, /ric-st-in_consegna"><span class="ric-punto" aria-hidden="true"><\/span>In consegna/);
    assert.match(t, /<p>Partito alle 10:50<\/p>/, 'senza orario del corriere, solo quando è partito (il momento del "Preparato")');
    assert.doesNotMatch(t, /arrivo previsto|ritiro alle/);
    assert.deepEqual(fasi(t).map((f) => [f[0], f[1], f[3]]), [
      ['Confermato da te', 'fatto', 'Alle 10:29'], ['Corriere trovato', 'fatto', 'Marco ha accettato alle 10:34'], ['Partito', 'fatto', 'Alle 10:50'], ['Consegnato', 'futuro', 'Lo conferma il cliente'],
    ]);
    // un ordine vecchio (`evaso`, partito con un momento solo suo) è "In consegna" come gli altri
    imposta(ordinePartito({ stato: 'evaso', in_evasione_il: null, evaso_il: naive(alle(8, 47)) }));
    prepara();
    t = await pagina();
    assert.match(t, /ric-st-in_consegna"><span class="ric-punto" aria-hidden="true"><\/span>In consegna/);
    assert.match(t, /<p>Partito alle 10:47 · ritiro alle 11:04<\/p>/);

    // ----- CONSEGNATO -----
    imposta(ordinePartito({ consegnato_il: naive(alle(9, 21)) }));
    prepara();
    t = await pagina();
    // testata: pillola grigia; un ordine consegnato non è più "di oggi": "Ricevuto il 19/10 alle 10:28"
    assert.match(t, /<span class="ric-stato ric-st-consegnato"><span class="ric-punto" aria-hidden="true"><\/span>Consegnato<\/span>/);
    assert.match(t, /<span class="ric-ricevuta">Ricevuto il 19\/10(?:\/2026)? alle 10:28 · da richiesta #177<\/span>/);
    // materiale consegnato, con la nota sull'incasso e Merce / IVA / Totale
    assert.match(t, /<h2 class="ric-h2" id="ord-mat-titolo">Materiale consegnato<\/h2>/);
    assert.match(t, /<span class="ric-conta">2 articoli · 2 pezzi<\/span>[\s\S]*?data-stampa/);
    assert.match(t, /<p class="ord-piede-nota">Da incassare dal cliente con la tua fattura\. Prezzi del banco\.<\/p>/);
    assert.match(t, /<dt>Merce<\/dt><dd>€ 64,50<\/dd><\/div>\s*<div><dt>IVA 22%<\/dt><dd>€ 14,19<\/dd><\/div>\s*<div class="ord-totale"><dt>Totale<\/dt><dd>€ 78,69<\/dd>/);
    assert.doesNotMatch(t, /98,76/);
    // scheda verde: quando, e i due mini riquadri (partito 19/10 · 10:47; consegnato 34 minuti dopo)
    assert.match(t, /<section class="ric-scheda ord-stato ord-stato-consegnato" aria-label="Stato dell'ordine">[\s\S]*?<h2 class="ord-stato-titolo">Consegnato<\/h2>\s*<p>Il 19\/10(?:\/2026)? alle 11:21 · confermato dal cliente<\/p>/);
    assert.match(t, /<div class="ord-stato-mini">\s*<div><span>Partito<\/span><strong>19\/10(?:\/2026)? · 10:47<\/strong><\/div>\s*<div><span>Tempo di consegna<\/span><strong>34 min<\/strong><\/div>\s*<\/div>/);
    assert.doesNotMatch(t, /bolla|DDT|\/ddt\//i);
    assert.doesNotMatch(t, /ord-ritiro|Elimina ordine|ric-elimina|ord-prepara|data-ric-arrivo/);
    // avanzamento: tutto fatto, con le ore
    assert.deepEqual(fasi(t), [
      ['Confermato da te', 'fatto', 'verde', 'Alle 10:29'],
      ['Corriere trovato', 'fatto', 'verde', 'Marco ha accettato alle 10:34'],
      ['Partito', 'fatto', 'verde', 'Alle 10:47'],
      ['Consegnato', 'fatto', 'verde', 'Confermato dal cliente alle 11:21'],
    ]);

    // oltre l'ora: "1 h 05"
    imposta(ordinePartito({ consegnato_il: naive(alle(9, 52)) }));
    prepara();
    assert.match(await pagina(), /<span>Tempo di consegna<\/span><strong>1 h 05<\/strong>/);

    // consegnato con la conferma provvisoria senza essere mai partito (ancora 'inviato', senza orario di partenza): la pagina c'è, senza "Partito" né "Tempo"
    imposta({ stato: 'inviato', creato_il: naive(alle(8, 28)), consegnato_il: naive(alle(9, 21)), in_evasione_il: null, evaso_il: null, corriere_risposto_il: alle(8, 34), corriere_arrivo_il: alle(9, 21) });
    prepara();
    t = await pagina();
    assert.match(t, /ric-st-consegnato"><span class="ric-punto" aria-hidden="true"><\/span>Consegnato/);
    assert.doesNotMatch(t, /ord-stato-mini|Tempo di consegna|Elimina ordine|bolla/i);
    assert.deepEqual(fasi(t).map((f) => [f[0], f[1]]), [['Confermato da te', 'fatto'], ['Corriere trovato', 'fatto'], ['Consegnato', 'fatto']]);

    // ----- DA PREPARARE: pillola blu che pulsa, ritiro, "Preparato", "Elimina ordine", e nessun "Stampa" -----
    imposta();
    prepara();
    t = await pagina();
    assert.match(t, /ric-st-da_preparare"><span class="ric-punto pulse" aria-hidden="true"><\/span>Da preparare/);
    assert.match(t, /<h2 class="ric-h2" id="ord-mat-titolo">Materiale da preparare<\/h2>/);
    assert.match(t, /ord-ritiro/);
    assert.match(t, /action="\/distributore\/ordini\/1295\/preparazione"/);
    assert.match(t, /Elimina ordine/);
    assert.doesNotMatch(t, /data-stampa|ord-stato/);

    // l'ordine di un altro banco, o che non c'è: 404, non una pagina vuota
    assert.equal((await chiedi('/distributore/ordini/1290')).status, 404);
    assert.equal((await chiedi('/distributore/ordini/1999')).status, 404);
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: dettaglio di una riga dello Storico (frammento): materiale a prezzo del banco, "Come è andata" per ogni stato, pulsanti; sola lettura', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const ripristina = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, ripristina, extra); };
  const prepara = (extra = {}) => preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 900, ordine: ordine1295, extra: { risposto_il: naive(alle(8, 29)), ...extra } });
  const passi = (t) => [...t.matchAll(/<li class="sto-d-passo sto-d-(\w+)"[^>]*>\s*<span class="sto-d-pallino" aria-hidden="true"><\/span>\s*<span class="sto-d-ora"[^>]*>([^<]*)(?:<small>([^<]*)<\/small>)?<\/span>\s*<span class="sto-d-testo">([^<]*)<\/span>/g)]
    .map((m) => [m[4], m[1], m[2], m[3] || '']);
  const dettaglio = async (query = '', id = 1295) => {
    const prima = registro.length;
    scrittureOrdini.length = 0;
    const r = await chiedi('/distributore/storico/' + id + '/dettaglio' + query);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const t = await r.text();
    assert.doesNotMatch(t, /<html|<body|<head/i, 'è un frammento, non una pagina');
    // SOLA LETTURA: aprire il dettaglio non cambia lo stato dell'ordine (né prende in carico, né scrive altro)
    assert.equal(scrittureOrdini.length, 0);
    assert.deepEqual(scrittureDa(prima), []);
    return t;
  };
  const href = (t, classe) => ((t.match(new RegExp('<a class="' + classe + '" href="([^"]*)"')) || [])[1] || '').replace(/&amp;/g, '&');
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // ----- CONSEGNATO: tutto verde, con le ore -----
    imposta(ordinePartito({ consegnato_il: naive(alle(9, 21)) }));
    prepara();
    let t = await dettaglio();
    // materiale: due righe a prezzo del banco (mai 59,95 / 11,00), "2 articoli · 2 pezzi", piede con Merce / IVA / Da incassare dal cliente = 78,69 (non 98,76)
    assert.match(t, /<h3 class="sto-d-occhiello">Materiale<\/h3>\s*<span class="sto-d-conta">2 articoli · 2 pezzi<\/span>/);
    const righe = t.split('<div class="sto-d-riga">').slice(1).map((x) => x.slice(0, x.indexOf('</section>')));
    assert.equal(righe.length, 2);
    assert.match(righe[0], /<span class="sto-d-qta">1×<\/span>\s*<span class="sto-d-articolo">\s*<strong class="sto-d-nome">Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/strong>\s*<small class="sto-d-cod">Cod\. 12514597<span class="sto-d-cad-sub"> · € 54,50 cad\.<\/span><\/small>/);
    assert.match(righe[0], /<span class="sto-d-cad">€ 54,50<\/span>\s*<span class="sto-d-tot">€ 54,50<\/span>/);
    assert.match(righe[1], /<span class="sto-d-cad">€ 10,00<\/span>\s*<span class="sto-d-tot">€ 10,00<\/span>/);
    assert.doesNotMatch(t, /59,95|11,00|98,76/);
    assert.match(t, /<div class="sto-d-piede">\s*<span>Merce <strong>€ 64,50<\/strong><\/span>\s*<span>IVA 22% <strong>€ 14,19<\/strong><\/span>\s*<span class="sto-d-incasso">Da incassare dal cliente <strong>€ 78,69<\/strong><\/span>/);
    assert.doesNotMatch(t, /RAEE/);
    // come è andata: i momenti in ora italiana (10:28, 10:29, 10:34, 10:47, 11:21), tutti fatti
    assert.deepEqual(passi(t), [
      ['Ricevuto', 'fatto', '10:28', ''],
      ['Confermato da te', 'fatto', '10:29', ''],
      ['Corriere Marco ha accettato, ritira alle 11:04', 'fatto', '10:34', ''],
      ['Partito', 'fatto', '10:47', ''],
      ['Consegnato · confermato dal cliente', 'fatto', '11:21', ''],
    ]);
    assert.match(t, /<span class="sto-d-ora" title="19\/10\/2026 alle 10:28">10:28<\/span>/);
    // sotto, la destinazione e il corriere
    assert.match(t, /<div class="sto-d-dove">\s*<p><span class="sto-d-icona" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span>Via Castel Morrone 1\/7r, 16161 Genova \(GE\)<\/span><\/p>\s*<p><span class="sto-d-icona" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span>Corriere Marco<\/span><\/p>/);
    // nessuna bolla; solo i pulsanti
    assert.doesNotMatch(t, /bolla|DDT|\/ddt\//i);
    assert.match(t, /<a class="sto-d-sec" href="\/distributore\/clienti\/1">Scheda cliente/);
    // "Apri ordine completo": senza `torna` riporta allo Storico con la voce aperta
    assert.equal(href(t, 'sto-d-vai'), '/distributore/ordini/1295?torna=' + encodeURIComponent('/distributore/storico#o1295'));

    // `torna` (la pagina dello Storico com'è, scritta dallo script): con i suoi filtri e l'ancora della riga; un indirizzo che non è una pagina del banco non passa
    const lista = '/distributore/storico?stato=consegnati&periodo=30&q=rossi&pagina=2';
    assert.equal(href(await dettaglio('?torna=' + encodeURIComponent(lista)), 'sto-d-vai'), '/distributore/ordini/1295?torna=' + encodeURIComponent(lista + '#o1295'));
    assert.equal(href(await dettaglio('?torna=' + encodeURIComponent(lista + '#o77')), 'sto-d-vai'), '/distributore/ordini/1295?torna=' + encodeURIComponent(lista + '#o1295'), 'un\'ancora vecchia non si somma');
    for (const no of ['https://altro.it', '//altro.it', '/carrello', '/distributore/ordini/1285/elimina', 'javascript:alert(1)']) {
      assert.equal(href(await dettaglio('?torna=' + encodeURIComponent(no)), 'sto-d-vai'), '/distributore/ordini/1295?torna=' + encodeURIComponent('/distributore/storico#o1295'), no);
    }

    // ----- IN CONSEGNA: "Partito" è il passo in corso (il banco non vede l'arrivo dal cliente); "Consegnato" ancora da venire (ora "—") -----
    imposta(ordinePartito());
    prepara();
    t = await dettaglio();
    assert.deepEqual(passi(t), [
      ['Ricevuto', 'fatto', '10:28', ''],
      ['Confermato da te', 'fatto', '10:29', ''],
      ['Corriere Marco ha accettato, ritira alle 11:04', 'fatto', '10:34', ''],
      ['Partito · in viaggio', 'corrente', '10:47', ''],
      ['Consegnato', 'futuro', '—', ''],
    ]);
    assert.match(t, /<li class="sto-d-passo sto-d-corrente" aria-current="step">/);

    // ----- DA PREPARARE, senza corriere: "Partito" e "Consegnato" ancora da venire -----
    imposta({ stato: 'inviato', in_evasione_il: null, corriere_nome: '', corriere_arrivo_il: null, corriere_risposto_il: null, corriere_minuti: null });
    prepara();
    t = await dettaglio();
    assert.deepEqual(passi(t).map((p) => [p[0], p[1], p[2]]), [
      ['Ricevuto', 'fatto', passi(t)[0][2]], ['Confermato da te', 'fatto', '10:29'], ['Partito', 'futuro', '—'], ['Consegnato', 'futuro', '—'],
    ]);
    assert.doesNotMatch(t, /bolla|DDT|\/ddt\//i);
    assert.doesNotMatch(t, /Corriere/, 'senza corriere la riga col furgone non c\'è');

    // ----- senza la risposta del banco (ordine senza richiesta) il passo "Confermato da te" non c'è; la scheda cliente solo se il cliente ha indicato questo banco -----
    imposta({ request_id: null, corriere_nome: '', corriere_arrivo_il: null, corriere_risposto_il: null, corriere_minuti: null });
    richiestaProva.legame = false;
    t = await dettaglio();
    assert.deepEqual(passi(t).map((p) => p[0]), ['Ricevuto', 'Partito', 'Consegnato']);
    assert.doesNotMatch(t, /sto-d-sec|Scheda cliente/);
    richiestaProva.legame = true;

    // ----- risposta parziale: "richiesti 3, confermati 1" sulla riga; un articolo confermato a zero, in una riga a parte -----
    imposta();
    const rigaSalvata = { ...rigaRichiestaProva };
    try {
      prepara({ copertura: 'parziale' });
      Object.assign(rigaRichiestaProva, { codice: '12514597', quantita_richiesta: 3, quantita_disponibile: 1 });
      t = await dettaglio();
      assert.match(t, /<small class="sto-d-mancano">richiesti 3, confermati 1<\/small>/);
      assert.equal((t.match(/class="sto-d-mancano"/g) || []).length, 1);
      Object.assign(rigaRichiestaProva, { codice: 'ZZ9', nome: 'Pompa', quantita_richiesta: 2, quantita_disponibile: 0 });
      t = await dettaglio();
      assert.match(t, /Non confermati, quindi non in questo ordine:\s*2 pz di Pompa\./);
    } finally {
      Object.assign(rigaRichiestaProva, rigaSalvata);
    }

    // ----- accesso: l'ordine di un altro banco, che non c'è o con un id che non è un numero: 404 senza pagina; senza accesso: al login; un cliente: 403 -----
    for (const id of [1290, 1999]) {
      const r = await chiedi('/distributore/storico/' + id + '/dettaglio');
      assert.equal(r.status, 404, String(id));
      assert.doesNotMatch(await r.text(), /<html/i);
    }
    assert.equal((await chiedi('/distributore/storico/abc/dettaglio')).status, 404);
    biscotti.cookie = '';
    let r = await chiedi('/distributore/storico/1295/dettaglio');
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/login/);
    banco.attivo = false;
    assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
    r = await chiedi('/distributore/storico/1295/dettaglio');
    assert.equal(r.status, 403);
  } finally {
    imposta();
    richiestaProva.legame = true;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: "Preparato" dalla pagina dell\'ordine lo porta "In consegna" e riporta lì (con la pagina da cui si era arrivati); la bolla non ha più rotte', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, originale, extra); };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });

    // dalla pagina dell'ordine: l'ordine passa "In consegna" (UPDATE di orders) e si resta sull'ordine; la freccia riporta ancora da dove si era arrivati
    scrittureOrdini.length = 0;
    const storico = '/distributore/storico?stato=da_preparare';
    let r = await chiedi('/distributore/ordini/1295/preparazione', form({ torna: storico }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/ordini/1295?torna=' + encodeURIComponent(storico));
    assert.equal(scrittureOrdini.length, 1);
    assert.match(scrittureOrdini[0].s, /stato = 'in_evasione'/);
    // senza altra indicazione, o con un indirizzo che non è del banco: si resta sull'ordine, senza ritorno (la freccia va alla home)
    r = await chiedi('/distributore/ordini/1295/preparazione', form({}));
    assert.equal(r.headers.get('location'), '/distributore/ordini/1295');
    r = await chiedi('/distributore/ordini/1295/preparazione', form({ torna: 'https://altro.example/x' }));
    assert.equal(r.headers.get('location'), '/distributore/ordini/1295', 'mai un indirizzo esterno');
    // dalla card della home: torna alla home
    r = await chiedi('/distributore/ordini/1295/preparazione', form({ torna: 'home' }));
    assert.equal(r.headers.get('location'), '/distributore');

    // già in consegna (Preparato premuto da un'altra scheda rimasta aperta): non si riscrive niente
    imposta({ stato: 'in_evasione' });
    scrittureOrdini.length = 0;
    r = await chiedi('/distributore/ordini/1295/preparazione', form({ torna: 'home' }));
    assert.equal(r.status, 302);
    assert.equal(scrittureOrdini.length, 0);

    // la bolla non ha più rotte: né per emetterla, né per vederla
    assert.equal((await chiedi('/distributore/ordini/1295/ddt', form({ colli: '2' }))).status, 404);
    assert.equal((await chiedi('/ddt/1295')).status, 404);
    // l'ordine di un altro banco: come sempre, allo Storico
    r = await chiedi('/distributore/ordini/1290/preparazione', form({}));
    assert.equal(r.headers.get('location'), '/distributore/storico');
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: la richiesta con l\'ordine "Da preparare" non ha una pagina: porta a quella dell\'ordine (da dove si era partiti), e dopo "Preparato" torna una richiesta normale', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const ordine = (extra = {}) => ({
    id: 5, distributor_id: 2, cliente_id: 1, stato: 'inviato', creato_il: fa(60000), consegnato_il: null,
    corriere_nome: 'Marco', corriere_arrivo_il: new Date(Date.now() + 8 * 60000), ...extra,
  });
  const prepara = (ord, trascorsi = 300) => preparaRichiesta({
    secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi, ordine: ord, extra: { corriere_nome: 'Marco', corriere_minuti: 25 },
  });
  process.env.WHATSAPP_ATTIVO = '1';
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // il corriere ha accettato: la pagina della richiesta (anche quella in attesa del corriere, che si ricarica da sola) rimanda all'ordine, senza scrivere niente
    prepara(ordine());
    scrittureOrdini.length = 0;
    let r = await chiedi('/distributore/richieste/177');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/ordini/5'); // senza `torna`: la freccia dell'ordine va alla home
    assert.equal(scrittureOrdini.length, 0);
    // con `torna` la pagina di partenza passa all'ordine (la richiesta non è un passaggio: la freccia non ci riporta)
    const storico = '/distributore/storico?stato=da_preparare&periodo=7';
    r = await chiedi('/distributore/richieste/177?torna=' + encodeURIComponent(storico));
    assert.equal(r.headers.get('location'), '/distributore/ordini/5?torna=' + encodeURIComponent(storico));
    // anche con la finestra dell'ordine in ritardo, o senza corriere (modulo spento): è sempre l'ordine "Da preparare"
    prepara(ordine({ corriere_arrivo_il: new Date(Date.now() - 2 * 60000) }));
    assert.equal((await chiedi('/distributore/richieste/177')).headers.get('location'), '/distributore/ordini/5');
    delete process.env.WHATSAPP_ATTIVO;
    prepara(ordine({ corriere_arrivo_il: null, corriere_nome: '' }));
    assert.equal((await chiedi('/distributore/richieste/177')).headers.get('location'), '/distributore/ordini/5');

    // niente redirect se l'ordine non è "Da preparare": preparato (In consegna), segnato consegnato con la rotta provvisoria, o di un altro banco
    for (const [nome, extra] of [
      ['preparato', { stato: 'in_evasione' }],
      ['consegnato', { consegnato_il: fa(0) }],
      ['di un altro banco', { distributor_id: 181 }],
    ]) {
      prepara(ordine(extra));
      r = await chiedi('/distributore/richieste/177');
      assert.equal(r.status, 200, nome);
      const t = await r.text();
      assert.doesNotMatch(t, /ric-st-da_preparare|ric-arrivo|\/preparazione|Apri l'ordine|Gestisci l'ordine/, nome);
    }
    prepara(ordine({ stato: 'in_evasione' }));
    assert.match(await (await chiedi('/distributore/richieste/177')).text(), /ric-st-confermata/);
  } finally {
    delete process.env.WHATSAPP_ATTIVO;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
