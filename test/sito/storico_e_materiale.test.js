// Storico dell'installatore, CSV del materiale e "Materiale ordinato" visto dal banco.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38473);
const {
  banco, biscotti, chiedi, dataProva, erroriServer, form, materialeProva, ordiniProva, pagatoIlProva, pagina, stripeRighe,
} = aiuti;

// Il totale mostrato nel riquadro blu ("€ 271,45") di una pagina.
const totaleRiquadro = (t) => (t.match(/<span class="sm-importo">€ ([\d.,]+)<\/span>/) || [])[1];

test('storico: riquadro "Da pagare a BOREA SRL", chip dei mesi, servizio fuori dal totale, ordini tutti chiusi', async () => {
  biscotti.cookie = '';
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  materialeProva.attivo = true;
  try {
    const t = await pagina('/storico?mese=2026-10');
    assert.match(t, /<title>[^<]*Storico ordini/);
    // a) il riquadro: totale del materiale (61,00 + 124,44 + 86,01), IVA inclusa, numero di ordini, servizio a parte
    assert.match(t, /<div class="sm-occhiello">Da pagare a BOREA SRL<\/div>/);
    assert.equal(totaleRiquadro(t), '271,45');
    assert.match(t, /<span class="sm-iva">IVA inclusa<\/span>/);
    assert.match(t, /Materiale di 3 ordini/);
    assert.match(t, /Consegne pagate in app: <strong>€ 63,50<\/strong>/);
    assert.doesNotMatch(t, /334,95|€ 271,45 ?\+/, 'il servizio (18,30 + 24,40 + 20,80) NON è dentro il totale');
    assert.match(t, /<a class="sm-esporta" href="\/storico\/materiale\.csv\?mese=2026-10"><svg[\s\S]*?<\/svg>Esporta elenco<\/a>/);
    assert.doesNotMatch(t, /Ricevute del mese|class="sm-ricevuta"/, 'senza pagamenti incassati non ci sono ricevute (né pulsante né link)');
    // chip: i mesi con attività dal più recente + "Tutto", l'attivo è ottobre
    const chip = [...t.matchAll(/<a class="sm-chip( attivo)?" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[3], !!m[1], m[2]]);
    assert.deepEqual(chip.map((c) => c[0]), ['Ottobre 2026', 'Settembre 2026', 'Tutto']);
    assert.deepEqual(chip.map((c) => c[1]), [true, false, false]);
    assert.equal(chip[1][2], '/storico?mese=2026-09&amp;vista=ordine');
    // b) il selettore: "Per ordine" attivo
    assert.match(t, /<a class="attiva" href="\/storico\?mese=2026-10&amp;vista=ordine" aria-current="page">Per ordine<\/a>\s*<a class="" href="\/storico\?mese=2026-10&amp;vista=articolo">Per articolo<\/a>/);
    // c) tre schede ordine, tutte chiuse all'arrivo (si aprono al tocco); più la richiesta senza risposta (#4), che ha la stessa scheda
    assert.equal((t.match(/<strong>Ordine #/g) || []).length, 3);
    assert.equal((t.match(/<details class="sm-ordine"/g) || []).length, 4);
    assert.equal((t.match(/<details class="sm-ordine" open/g) || []).length, 0);
    // chiusa: numero, data, totale IVA inclusa; stato, primo articolo e " +N"
    assert.match(t, /<strong>Ordine #98<\/strong> <span class="sm-data">16 ott, 09:12<\/span>[\s\S]*?<span class="sm-tot">€ 61,00<\/span>/);
    assert.match(t, /<span class="st-stato st-preparazione">In preparazione<\/span>\s*<span class="sm-primo">1× Valvola Deviatrice 3vie Per Easy<\/span>/);
    assert.match(t, /<span class="st-stato st-consegnato">Consegnato<\/span>\s*<span class="sm-primo">2× Bocchettone A 90° Sanpress<\/span>\s*<span class="sm-altri">\+1<\/span>/);
    // aperta: righe con quantità, prezzo cad. IVA inclusa e totale di riga (netto + RAEE) × 1,22, poi il servizio pagato
    assert.match(t, /<span class="sm-qta">1×<\/span>[\s\S]*?87 Elemento A &#34;t&#34; 87gr Diam\. 100[\s\S]*?€ 124,44 cad\.[\s\S]*?<span class="sm-riga-totale">€ 124,44<\/span>/);
    assert.match(t, /Bocchettone A 90° Sanpress<\/div>\s*<div class="sm-riga-sotto">€ 36,60 cad\.<\/div>[\s\S]*?<span class="sm-riga-totale">€ 73,20<\/span>/);
    // il servizio per ordine: l'addebitato quando torna (98, 91), il calcolato quando in app si pagava tutto (97: 148,84 non è un servizio)
    const servizi = [...t.matchAll(/<div class="sm-servizio"><span>Consegna pagata in app · corriere \+ 10% \+ IVA<\/span><span>€ ([\d,]+)<\/span><\/div>/g)].map((m) => m[1]);
    assert.deepEqual(servizi, ['18,30', '24,40', '20,80']);
    assert.doesNotMatch(t, /148,84/);
    // Riordina solo sui consegnati (97 e 91), come form fuori dal <summary>; "Dettagli ›" per tutti
    const riordina = [...t.matchAll(/<form class="st-riordina" method="POST" action="\/storico\/(\d+)\/riordina">/g)].map((m) => m[1]);
    assert.deepEqual(riordina.sort(), ['91', '97']);
    assert.doesNotMatch(t, /<summary>(?:(?!<\/summary>)[\s\S])*<form/);
    // (e la richiesta senza risposta, nella sua scheda aperta, porta alla sua pagina: da lì si rinvia)
    assert.deepEqual([...t.matchAll(/<a class="sm-dettagli" href="([^"]+)">Dettagli ›<\/a>/g)].map((m) => m[1]), ['/ordini/98', '/ordini/97', '/ordini/91', '/richieste/4']);
    // le richieste senza ordine: "Nessun costo", e a ottobre solo la 4
    // ...nello STESSO formato di una scheda ordine: <details> chiuso con "Richiesta #4", data, "Nessun costo", stato, primo articolo e "+1"; aperta, le righe e "Dettagli ›"
    assert.match(t, /<details class="sm-ordine">\s*<summary>\s*<span class="sm-riga1">\s*<span class="sm-nome"><strong>Richiesta #4<\/strong> <span class="sm-data">13 ott, 11:00<\/span><\/span>\s*<span class="sm-tot sm-tot-zero">Nessun costo<\/span>\s*<\/span>\s*<span class="sm-riga2">\s*<span class="st-stato st-nessuna">Nessuna risposta<\/span>\s*<span class="sm-primo">2× Valvola a sfera 1\/2<\/span>\s*<span class="sm-altri">\+1<\/span>\s*<span class="sm-freccia"/);
    const richiesta4 = t.match(/<strong>Richiesta #4<\/strong>[\s\S]*?<\/details>/)[0];
    assert.match(richiesta4, /<span class="sm-qta">2×<\/span>\s*<div class="sm-riga-corpo">\s*<div class="sm-riga-nome">Valvola a sfera 1\/2<\/div>/);
    assert.match(richiesta4, /<span class="sm-qta">1×<\/span>\s*<div class="sm-riga-corpo">\s*<div class="sm-riga-nome">Raccordo a T<\/div>/);
    assert.doesNotMatch(richiesta4, /€ \d+,\d\d cad\.|sm-riga-totale/); // le richieste non hanno prezzi
    assert.match(richiesta4, /Nessun addebito sulla carta/);
    assert.match(richiesta4, /<a class="sm-dettagli" href="\/richieste\/4">Dettagli ›<\/a>/);
    assert.doesNotMatch(t, /sm-senza|Richiesta #2 ·|Richiesta #2</);
    // UN solo elenco cronologico: niente intestazione "Senza ordine", la richiesta #4 (13 ott) viene dopo gli ordini 98, 97, 91 (16, 15 e 14 ott)
    assert.doesNotMatch(t, /Senza ordine|st-titolo/);
    assert.deepEqual([...t.matchAll(/<strong>Ordine #(\d+)<\/strong>|<strong>Richiesta #(\d+)<\/strong>/g)].map((m) => (m[1] ? 'O' + m[1] : 'R' + m[2])), ['O98', 'O97', 'O91', 'R4']);
    // niente più "In corso" né le schede del vecchio elenco
    assert.doesNotMatch(t, />In corso<|class="st-link"|class="st-scheda"/);
    // il fondo lascia spazio al menu flottante
    assert.match(t, /<div class="app app-storico">/);
  } finally {
    materialeProva.attivo = false;
  }
});

test('storico: cambio mese, "Tutto", mese non valido e vista per articolo', async () => {
  materialeProva.attivo = true;
  try {
    // settembre: un solo ordine (#30, 3 × 122,00 = 366,00), servizio calcolato (10 × 1,22 + ...), la richiesta annullata #2
    let t = await pagina('/storico?mese=2026-09');
    assert.equal(totaleRiquadro(t), '366,00');
    assert.match(t, /Materiale di 1 ordine</);
    assert.match(t, /Consegne pagate in app: <strong>€ 48,80<\/strong>/); // addebitato non salvato: (30 + 10) × 1,22
    assert.match(t, /<strong>Richiesta #2<\/strong> <span class="sm-data">25 set, 10:00<\/span>/);
    assert.match(t, /class="st-stato st-annullata">Annullata/);
    // in ordine cronologico, mescolata agli ordini: la richiesta annullata (25 set) viene prima dell'ordine #30 (12 set), senza sezioni a parte
    assert.ok(t.indexOf('<strong>Richiesta #2</strong>') < t.indexOf('<strong>Ordine #30</strong>'));
    assert.doesNotMatch(t, /Senza ordine/);
    // la richiesta annullata si vede ma NON apre nessuna pagina: niente link (né dalla scheda né da altro)
    // (stessa scheda dell'ordine ma un <div> fisso: niente <details>, niente freccia, niente "Dettagli")
    assert.match(t, /<div class="sm-ordine sm-ordine-chiusa">\s*<div class="sm-fissa">\s*<span class="sm-riga1">\s*<span class="sm-nome"><strong>Richiesta #2<\/strong> <span class="sm-data">25 set, 10:00<\/span><\/span>\s*<span class="sm-tot sm-tot-zero">Nessun costo<\/span>\s*<\/span>\s*<span class="sm-riga2">\s*<span class="st-stato st-annullata">Annullata<\/span>\s*<span class="sm-primo">3× Sifone doccia<\/span>\s*<\/span>\s*<\/div>\s*<\/div>/);
    assert.doesNotMatch(t, /href="\/richieste\/2"/);
    assert.doesNotMatch(t, /Richiesta #4</);
    // "Tutto": ottobre + settembre
    t = await pagina('/storico?mese=tutto');
    assert.equal(totaleRiquadro(t), '637,45'); // 271,45 + 366,00
    assert.match(t, /Materiale di 4 ordini/);
    assert.match(t, /<a class="sm-chip attivo" href="\/storico\?mese=tutto&amp;vista=ordine" aria-current="true">Tutto<\/a>/);
    // un mese senza attività (o scritto male) torna al più recente (o al corrente se ne ha)
    for (const mese of ['2025-01', 'ciao', "2026-10'", '']) {
      const x = await pagina('/storico?mese=' + encodeURIComponent(mese));
      assert.equal(totaleRiquadro(x), '271,45', 'mese=' + mese);
    }
    assert.ok(totaleRiquadro(await pagina('/storico?mese=2026-10&mese=2026-09')), 'parametro ripetuto: nessun errore');
    // per articolo: righe sommate dal totale più alto, con gli ordini, e in fondo il totale
    t = await pagina('/storico?mese=tutto&vista=articolo');
    assert.match(t, /<a class="attiva" href="\/storico\?mese=tutto&amp;vista=articolo" aria-current="page">Per articolo<\/a>/);
    assert.doesNotMatch(t, /<details class="sm-ordine"/);
    const righe = [...t.matchAll(/<span class="sm-qta">(\d+)×<\/span>\s*<div class="sm-art-corpo">\s*<div class="sm-art-nome">([^<]+)<\/div>\s*<div class="sm-art-sotto">€ ([\d,]+) cad\. · ordini ([^<]+)<\/div>\s*<\/div>\s*<span class="sm-art-totale">€ ([\d,]+)<\/span>/g)]
      .map((m) => [Number(m[1]), m[2].replace(/&#34;/g, '"'), m[3], m[4], m[5]]);
    assert.deepEqual(righe, [
      [3, '87 Elemento A "t" 87gr Diam. 100', '122,00', '#30', '366,00'], // settembre: stesso articolo ma altro prezzo (senza RAEE): riga a parte
      [1, '87 Elemento A "t" 87gr Diam. 100', '124,44', '#97', '124,44'],
      [2, 'Bocchettone A 90° Sanpress', '36,60', '#91', '73,20'],
      [1, 'Valvola Deviatrice 3vie Per Easy', '61,00', '#98', '61,00'],
      [1, 'Raccordo a T', '12,81', '#91', '12,81'],
    ]);
    assert.match(t, /<div class="sm-art sm-art-somma">\s*<span class="sm-art-nome">Totale<\/span>\s*<span class="sm-art-totale">€ 637,45<\/span>/);
  } finally {
    materialeProva.attivo = false;
  }
});

test('storico: nessun ordine nel mese e nessun ordine ancora', async () => {
  materialeProva.attivo = true;
  const { ordini, righe } = materialeProva;
  try {
    // solo richieste senza ordine in un mese: l'elenco dice "Nessun costo", non "Nessun ordine"
    materialeProva.ordini = [];
    materialeProva.righe = [];
    let t = await pagina('/storico?mese=2026-10');
    assert.equal(totaleRiquadro(t), '0,00');
    assert.match(t, /Materiale di 0 ordini/);
    assert.doesNotMatch(t, /Ordine #/);
    assert.match(t, /<strong>Richiesta #4<\/strong> <span class="sm-data">13 ott, 11:00<\/span>/);
    // né ordini né richieste: la pagina vuota di sempre
    materialeProva.richieste = [];
    t = await pagina('/storico');
    assert.match(t, /Nessun ordine ancora\./);
    assert.match(t, /href="\/home">Vai al catalogo/);
    assert.doesNotMatch(t, /sm-riquadro/);
  } finally {
    materialeProva.attivo = false;
    materialeProva.ordini = ordini;
    materialeProva.righe = righe;
    materialeProva.richieste = [
      { id: 4, stato: 'nessuna_offerta', creato_il: dataProva(2026, 10, 13, 9, 0) },
      { id: 2, stato: 'annullata', creato_il: dataProva(2026, 9, 25, 8, 0) },
    ];
  }
});

test('storico: CSV del materiale (";" e BOM), solo del cliente loggato, righe per articolo e totali in fondo', async () => {
  biscotti.cookie = '';
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  materialeProva.attivo = true;
  try {
    materialeProva.chiamate.length = 0;
    const r = await chiedi('/storico/materiale.csv?mese=2026-10');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="materiale-2026-10.csv"');
    assert.match(r.headers.get('cache-control'), /no-store/);
    const byte = new Uint8Array(await r.clone().arrayBuffer());
    assert.deepEqual([...byte.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
    const testo = await r.text(); // text() toglie il BOM
    assert.deepEqual(testo.split('\r\n'), [
      'Data;Ordine;Stato;Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl.;Servizio pagato',
      '14/10/2026;#91;Consegnato;C91A;Bocchettone A 90° Sanpress;2;36,60;73,20;20,80',
      '14/10/2026;#91;Consegnato;C91B;Raccordo a T;1;12,81;12,81;', // il servizio sta sulla prima riga dell'ordine: la somma è giusta
      '15/10/2026;#97;Consegnato;C97;"87 Elemento A ""t"" 87gr Diam. 100";1;124,44;124,44;24,40',
      '16/10/2026;#98;In preparazione;C98;Valvola Deviatrice 3vie Per Easy;1;61,00;61,00;18,30',
      'Totale;;;;;;;271,45;63,50',
      '',
    ]);
    // "Tutto" comprende anche settembre; solo il cliente loggato (id 1) è nelle query
    const tutto = await (await chiedi('/storico/materiale.csv?mese=tutto')).text();
    assert.match(tutto, /\r\nTotale;;;;;;;637,45;112,30\r\n/);
    assert.ok(materialeProva.chiamate.length >= 2);
    assert.ok(materialeProva.chiamate.every((c) => c.cliente === 1 && c.filiale === null), 'solo il cliente loggato, senza filtro sul banco');
    // senza sessione di un cliente non si esporta niente
    biscotti.cookie = '';
    assert.notEqual((await chiedi('/storico/materiale.csv?mese=2026-10')).status, 200);
  } finally {
    materialeProva.attivo = false;
  }
});

test('storico con pagamenti incassati: "Ricevute del mese" e "Esporta elenco" affiancati, link "Ricevuta" solo sugli ordini con un incasso vero, PDF del mese con una pagina per ricevuta', async () => {
  biscotti.cookie = '';
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  materialeProva.attivo = true;
  ordiniProva.attivo = true;
  materialeProva.ricevute = [197, 191]; // gli ordini 97 e 91 di ottobre hanno un incasso Stripe; il 98 (in preparazione) e il 30 di settembre no
  const riga = (id, requestId) => ({
    id, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'incassato', payment_intent_id: 'pi_prova_' + requestId, importo_cent: 2007, incasso_cent: 2007, request_id: requestId,
    carta_marca: 'mastercard', carta_ultime4: '5555', incassato_il: pagatoIlProva, aggiornato_il: pagatoIlProva,
  });
  stripeRighe.push(riga(910, 197), riga(911, 191));
  try {
    const t = await pagina('/storico?mese=2026-10');
    // in fondo al riquadro blu: la riga "Consegne pagate in app" e due pulsanti affiancati
    assert.match(t, /Consegne pagate in app: <strong>€ 63,50<\/strong>/);
    assert.match(t, /<div class="sm-bottoni">\s*<a class="sm-esporta sm-ricevute" href="\/storico\/ricevute\.pdf\?mese=2026-10" target="_blank" rel="noopener"><svg[\s\S]*?<\/svg>Ricevute del mese<\/a>\s*<a class="sm-esporta" href="\/storico\/materiale\.csv\?mese=2026-10"><svg[\s\S]*?<\/svg>Esporta elenco<\/a>\s*<\/div>/);
    // in ogni ordine aperto, accanto a "Dettagli ›": "Ricevuta" solo dove l'incasso c'è (97 e 91, non il 98)
    assert.deepEqual([...t.matchAll(/<a class="sm-ricevuta" href="\/ordini\/(\d+)\/ricevuta\.pdf" target="_blank" rel="noopener">[\s\S]*?<\/svg>Ricevuta<\/a>/g)].map((m) => m[1]), ['97', '91']);
    assert.match(t, /<span class="sm-destra">\s*<a class="sm-ricevuta"[^>]*>[\s\S]*?Ricevuta<\/a>\s*<a class="sm-dettagli" href="\/ordini\/97">Dettagli ›<\/a>\s*<\/span>/);
    // la riga sotto il materiale: la consegna pagata in app (corriere + 10% + IVA)
    assert.match(t, /<div class="sm-servizio"><span>Consegna pagata in app · corriere \+ 10% \+ IVA<\/span><span>€ 18,30<\/span><\/div>/);

    // un mese senza incassi: né il pulsante né i link (il PDF sarebbe vuoto), e il PDF risponde 404
    const sett = await pagina('/storico?mese=2026-09');
    assert.doesNotMatch(sett, /Ricevute del mese|class="sm-ricevuta"/);
    assert.match(sett, /<a class="sm-esporta" href="\/storico\/materiale\.csv\?mese=2026-09">/);
    const vuoto = await chiedi('/storico/ricevute.pdf?mese=2026-09');
    assert.equal(vuoto.status, 404);
    assert.match(await vuoto.text(), /In questo periodo non ci sono ricevute di pagamento/);

    // il PDF del mese: un solo file, una pagina per ricevuta (97 e 91), numerate nell'ordine in cui sono nati gli ordini
    const r = await chiedi('/storico/ricevute.pdf?mese=2026-10');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(r.headers.get('content-disposition'), 'inline; filename="ricevute-2026-10.pdf"');
    const pdf = Buffer.from(await r.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length, 2, 'due pagine');
    // senza accesso niente PDF del mese
    const cookiePrima = biscotti.cookie;
    biscotti.cookie = '';
    assert.ok([302, 401, 403].includes((await chiedi('/storico/ricevute.pdf?mese=2026-10')).status));
    biscotti.cookie = cookiePrima;
  } finally {
    materialeProva.attivo = false;
    ordiniProva.attivo = false;
    materialeProva.ricevute = [];
    stripeRighe.splice(stripeRighe.length - 2, 2);
  }
});

test('banco e installatore vedono le STESSE cifre: totale, servizio e CSV identici per lo stesso cliente e lo stesso mese', async () => {
  materialeProva.attivo = true;
  banco.attivo = true;
  try {
    // installatore
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    const lato = await pagina('/storico?mese=2026-10');
    const csvInstallatore = await (await chiedi('/storico/materiale.csv?mese=2026-10')).text();
    // banco (filiale 2), cliente 32 approvato
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    const latoBanco = await pagina('/distributore/clienti/32?mese=2026-10');
    const csvBanco = await (await chiedi('/distributore/clienti/32/materiale.csv?mese=2026-10')).text();

    // Il markup è diverso (il banco ha la sua scheda "Materiale ordinato", senza servizio), i NUMERI sono gli stessi: li fa un calcolo solo.
    assert.equal(totaleRiquadro(lato), '271,45');
    const totaleBanco = (t) => (t.match(/<strong class="mc-totale-val">€ ([\d.,]+)<\/strong>/) || [])[1];
    assert.equal(totaleBanco(latoBanco), totaleRiquadro(lato), 'lo stesso totale del materiale');
    // gli stessi ordini con gli stessi totali (l'installatore: Ordine #N … sm-tot; il banco: mc-num … mc-tot)
    const totaliInstallatore = [...lato.matchAll(/<strong>Ordine #(\d+)<\/strong>[\s\S]*?<span class="sm-tot">€ ([\d.,]+)<\/span>/g)].map((m) => m[1] + '=' + m[2]);
    const totaliBanco = [...latoBanco.matchAll(/<span class="mc-num">Ordine #(\d+)<\/span>[\s\S]*?<span class="mc-tot">€ ([\d.,]+)<\/span>/g)].map((m) => m[1] + '=' + m[2]);
    assert.deepEqual(totaliBanco, totaliInstallatore);
    assert.deepEqual(totaliInstallatore, ['98=61,00', '97=124,44', '91=86,01']);
    // il CSV: stesse righe (ordine, codice, quantità, prezzo cad., totale), colonne diverse (il banco NON ha il servizio)
    const celle = (csv) => csv.replace(/^\uFEFF/, '').trim().split('\r\n').map((r) => r.split(';'));
    const [testaInst, ...righeInst] = celle(csvInstallatore);
    const [testaBanco, ...righeBanco] = celle(csvBanco);
    assert.equal(testaInst.at(-1), 'Servizio pagato');
    assert.deepEqual(testaBanco, ['Data', 'Ordine', 'Stato', 'Codice', 'Articolo', 'Quantità', 'Prezzo cad. IVA incl.', 'Totale IVA incl.']);
    assert.deepEqual(
      righeBanco.slice(0, -1).map((r) => [r[1], r[3], r[5], r[6], r[7]]),
      righeInst.slice(0, -1).map((r) => [r[1], r[3], r[5], r[6], r[7]]),
    );
    assert.equal(righeBanco.at(-1).at(-1), '271,45');
    assert.equal(righeInst.at(-1)[7], '271,45');
    // il servizio (18,30 + 24,40 + 20,80 = 63,50) non è mai nella pagina del banco: né come riquadro né come cifra
    assert.doesNotMatch(latoBanco, /Servizio (già )?pagat|63,50|18,30|24,40|20,80/);
    // il banco non ha Riordina, né le richieste senza ordine
    assert.doesNotMatch(latoBanco, /st-riordina|Richiesta #|sm-senza|sm-riquadro/);
    // un cliente da verificare non ha la scheda, e il suo CSV non esiste
    const nonApprovato = await pagina('/distributore/clienti/31');
    assert.doesNotMatch(nonApprovato, /mc-card|Materiale ordinato/);
    assert.equal((await chiedi('/distributore/clienti/31/materiale.csv')).status, 404);
  } finally {
    materialeProva.attivo = false;
    banco.attivo = false;
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  }
});

test('banco: "Materiale ordinato" del cliente approvato: tutti gli ordini, IVA e RAEE nei totali, mesi, "Tutto", per articolo, niente servizio', async () => {
  biscotti.cookie = '';
  materialeProva.attivo = true;
  banco.attivo = true;
  try {
    await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));

    // ----- ottobre, per ordine -----
    let t = await pagina('/distributore/clienti/32?mese=2026-10');
    // la nota sta nella striscia del riepilogo (accorciata: il "servizio" non si nomina più qui) e la testata è una sola, `.mc-fisso`, con la riga dei filtri sopra la striscia
    assert.match(t, /<span class="mc-nota">Prezzi IVA inclusa · il cliente li paga a BOREA<\/span>/);
    assert.doesNotMatch(t, /ha pagato solo il servizio|mc-box|mc-riepilogo|mc-fondo|mc-sotto/);
    assert.match(t, /<div class="mc-fisso" data-mc-fisso>\s*<div class="mc-testa">\s*<h2 class="mc-titolo" id="mc-titolo">Materiale ordinato<\/h2>[\s\S]*?<div class="mc-striscia">/);
    assert.match(t, /<a class="mc-esporta" href="\/distributore\/clienti\/32\/materiale\.csv\?mese=2026-10">/);
    // la riga dei filtri, da sinistra: mesi, vista e "Esporta" (a destra)
    assert.ok(t.indexOf('aria-label="Periodo"') < t.indexOf('aria-label="Vista"') && t.indexOf('aria-label="Vista"') < t.indexOf('class="mc-esporta"'), 'mesi, vista, Esporta');
    // riepilogo: 3 ordini, 4 articoli distinti, 5 pezzi (1 + 1 + 2 + 1); totale 61,00 + 124,44 (RAEE dentro) + 86,01 = 271,45;
    // di cui IVA = totale − netti di riga (50 + 102 + 70,50 = 222,50) = 48,95
    assert.match(t, /<span class="mc-conta"><strong>3<\/strong> ordini<\/span>\s*<span class="mc-conta"><strong>4<\/strong> articoli · <strong>5<\/strong> pezzi<\/span>/);
    assert.match(t, /<div class="mc-totale">\s*<span class="mc-totale-eti">Totale ottobre<\/span>\s*<strong class="mc-totale-val">€ 271,45<\/strong>\s*<span class="mc-totale-iva">di cui IVA € 48,95<\/span>/);
    // TUTTI gli ordini (anche quello ancora in preparazione), dal più recente; aperto SOLO il primo
    assert.deepEqual([...t.matchAll(/<span class="mc-num">Ordine #(\d+)<\/span>/g)].map((m) => m[1]), ['98', '97', '91']);
    assert.equal((t.match(/<details class="mc-ordine"/g) || []).length, 3);
    assert.equal((t.match(/<details class="mc-ordine" open>/g) || []).length, 1);
    assert.ok(t.indexOf('<details class="mc-ordine" open>') < t.indexOf('Ordine #98') && t.indexOf('Ordine #98') < t.indexOf('<details class="mc-ordine">'), 'il primo è aperto, il secondo no');
    assert.ok(t.indexOf('Ordine #97') > t.indexOf('<details class="mc-ordine">') && t.indexOf('Ordine #91') > t.indexOf('Ordine #97'), 'il secondo e il terzo sono chiusi');
    // riga dell'ordine: numero, data e ora, "N articoli" (singolare con 1), pillola dello stato del banco, totale IVA inclusa
    assert.match(t, /<span class="mc-num">Ordine #98<\/span>\s*<span class="mc-meta"><span class="mc-data">16 ott, 09:12<\/span><span class="mc-narticoli">1 articolo<\/span><\/span>\s*<span class="sto-pillola sto-st-in_consegna mc-stato"><span class="sto-punto" aria-hidden="true"><\/span>In consegna<\/span>\s*<span class="mc-tot">€ 61,00<\/span>/);
    assert.match(t, /<span class="mc-num">Ordine #91<\/span>\s*<span class="mc-meta"><span class="mc-data">14 ott, 22:29<\/span><span class="mc-narticoli">2 articoli<\/span><\/span>\s*<span class="sto-pillola sto-st-consegnato mc-stato"><span class="sto-punto" aria-hidden="true"><\/span>Consegnato<\/span>\s*<span class="mc-tot">€ 86,01<\/span>/);
    // nell'ordine il nome e "Cod. …" stanno nella stessa riga (`mc-art-riga`)
    assert.match(t, /<div class="mc-art-riga">\s*<div class="mc-art">[^<]+<\/div>\s*<div class="mc-cod">Cod\. /);
    // righe: prezzo cad. = (netto + RAEE) × 1,22, totale riga = (netto riga + RAEE riga) × 1,22; mai il prezzo col servizio
    assert.match(t, /<span class="mc-qta">1×<\/span>[\s\S]*?87 Elemento A &#34;t&#34; 87gr Diam\. 100<\/div>\s*<div class="mc-cod">Cod\. C97[\s\S]*?<td class="mc-c-num mc-c-cad">€ 124,44<\/td>\s*<td class="mc-c-num mc-c-tot">€ 124,44<\/td>/);
    assert.match(t, /<span class="mc-qta">2×<\/span>[\s\S]*?Bocchettone A 90° Sanpress<\/div>[\s\S]*?<td class="mc-c-num mc-c-cad">€ 36,60<\/td>\s*<td class="mc-c-num mc-c-tot">€ 73,20<\/td>/);
    assert.doesNotMatch(t, /110,00|134,20|€ 55,00|€ 66,00/, 'né subtotale_cliente né il prezzo col servizio');
    // niente "Vedi ordine #N ›" (richiesta esplicita del 19/10/2026: la pagina dell'ordine si apre dalla home o dallo Storico) e nessuna traccia della bolla
    assert.doesNotMatch(t, /Vedi ordine|mc-vedi|\/distributore\/ordini\/|DDT|bolla|\/ddt\//i);
    // il totale in fondo (`mc-fondo`) non c'è più: ripeteva quello della striscia
    assert.equal((t.match(/271,45/g) || []).length, 1, 'il totale compare una volta sola, nella striscia');
    // il servizio pagato in app non si vede né come voce né come cifra; niente richieste senza ordine
    assert.doesNotMatch(t, /Servizio (già )?pagat|63,50|18,30|24,40|20,80|Richiesta #|st-riordina/);
    // filtri: i due mesi più recenti con ordini + "Tutto", poi "Per ordine | Per articolo"; senza "Altri mesi" (non ce ne sono)
    const voci = [...t.matchAll(/<a class="mc-seg-voce( attiva)?" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[3], !!m[1], m[2]]);
    assert.deepEqual(voci.map((v) => v[0]), ['Ottobre 2026', 'Settembre 2026', 'Tutto', 'Per ordine', 'Per articolo']);
    assert.deepEqual(voci.map((v) => v[1]), [true, false, false, true, false]);
    assert.equal(voci[1][2], '/distributore/clienti/32?mese=2026-09&amp;vista=ordine#materiale');
    assert.equal(voci[4][2], '/distributore/clienti/32?mese=2026-10&amp;vista=articolo#materiale');
    assert.doesNotMatch(t, /mc-altri/);

    // ----- settembre: un ordine, IVA 66,00 (366,00 − 300,00) -----
    t = await pagina('/distributore/clienti/32?mese=2026-09');
    assert.deepEqual([...t.matchAll(/<span class="mc-num">Ordine #(\d+)<\/span>/g)].map((m) => m[1]), ['30']);
    assert.match(t, /<span class="mc-totale-eti">Totale settembre<\/span>\s*<strong class="mc-totale-val">€ 366,00<\/strong>\s*<span class="mc-totale-iva">di cui IVA € 66,00<\/span>/);
    assert.match(t, /<span class="mc-conta"><strong>1<\/strong> ordine<\/span>/, 'un solo ordine: singolare');
    assert.doesNotMatch(t, /Ordine #98|Ordine #97/);

    // ----- "Tutto" (ottobre + settembre): 4 ordini, 8 pezzi; il totale di tutti -----
    t = await pagina('/distributore/clienti/32?mese=tutto');
    assert.deepEqual([...t.matchAll(/<span class="mc-num">Ordine #(\d+)<\/span>/g)].map((m) => m[1]), ['98', '97', '91', '30']);
    assert.match(t, /<strong>4<\/strong> articoli · <strong>8<\/strong> pezzi/);
    assert.match(t, /<span class="mc-totale-eti">Totale<\/span>\s*<strong class="mc-totale-val">€ 637,45<\/strong>\s*<span class="mc-totale-iva">di cui IVA € 114,95<\/span>/, '"Tutto": "Totale" senza il mese');
    // un mese senza ordini torna al default (ottobre), un valore sbagliato pure
    for (const mese of ['2026-02', 'ciao']) {
      assert.match(await pagina('/distributore/clienti/32?mese=' + mese), /<strong class="mc-totale-val">€ 271,45<\/strong>/, 'mese=' + mese);
    }

    // ----- per articolo: righe sommate per codice e nome (anche con prezzi diversi), dal totale più alto -----
    t = await pagina('/distributore/clienti/32?mese=tutto&vista=articolo');
    assert.doesNotMatch(t, /<details class="mc-ordine"/);
    assert.deepEqual([...t.matchAll(/<div class="mc-art">([^<]+)<\/div>/g)].map((m) => m[1]),
      ['87 Elemento A &#34;t&#34; 87gr Diam. 100', 'Bocchettone A 90° Sanpress', 'Valvola Deviatrice 3vie Per Easy', 'Raccordo a T']);
    // l'elemento: 1 (#97, 124,44) + 3 (#30, 122,00 l'uno) = 4 pezzi, 490,44; due prezzi cad. diversi → "prezzi diversi"
    assert.match(t, /<span class="mc-qta">4×<\/span>[\s\S]*?Cod\. C97 · prezzi diversi<span class="mc-negli-sub"> · #97, #30<\/span>[\s\S]*?<td class="mc-c-ordini">#97, #30<\/td>\s*<td class="mc-c-num mc-c-tot">€ 490,44<\/td>/);
    // un articolo con un solo prezzo mostra "€ X cad."
    assert.match(t, /Cod\. C91A · € 36,60 cad\./);
    assert.match(t, /<th class="mc-c-qta" scope="col">Q\.tà totale<\/th>/);
    assert.match(t, /<th class="mc-c-ordini" scope="col">Negli ordini<\/th>/);
    assert.match(t, /<a class="mc-seg-voce attiva" href="[^"]+"[^>]*>Per articolo<\/a>/);

    // ----- la bolla non esiste: nemmeno un ordine vecchio (`evaso`) ha un numero di DDT o un link; uno ancora "Da preparare" nemmeno -----
    const o98 = materialeProva.ordini.find((o) => o.id === 98);
    const prima = { stato: o98.stato, request_id: o98.request_id };
    try {
      Object.assign(o98, { stato: 'evaso', request_id: 555 });
      t = await pagina('/distributore/clienti/32?mese=2026-10');
      assert.match(t, /<span class="mc-data">16 ott, 09:12<\/span><span class="mc-narticoli">1 articolo<\/span><\/span>\s*<span class="sto-pillola sto-st-in_consegna mc-stato"><span class="sto-punto" aria-hidden="true"><\/span>In consegna<\/span>/);
      assert.doesNotMatch(t, /DDT|bolla|\/ddt\/|mc-vedi|Vedi ordine|\/distributore\/ordini\/|\/distributore\/richieste\/555/i);
      Object.assign(o98, { stato: 'inviato' });
      t = await pagina('/distributore/clienti/32?mese=2026-10');
      assert.match(t, /sto-st-da_preparare mc-stato"><span class="sto-punto" aria-hidden="true"><\/span>Da preparare<\/span>/);
      assert.doesNotMatch(t, /mc-vedi|Vedi ordine|\/distributore\/ordini\//);
    } finally {
      Object.assign(o98, prima);
    }

    // ----- CSV: ";" e BOM, dal più vecchio, stato (nessuna colonna DDT), nessun servizio, totale in fondo, nome del file dal cliente e dal mese -----
    const r = await chiedi('/distributore/clienti/32/materiale.csv?mese=2026-10');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv/);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="materiale_rossi-b-impianti-b-s-r-l_2026-10.csv"');
    // il BOM si vede dai byte: Response.text() lo toglie da sé (decodifica UTF-8 della specifica Fetch)
    const byte = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...byte.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8: Excel in italiano legge le lettere accentate');
    const csv = byte.toString('utf8');
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.deepEqual(csv.slice(1).trim().split('\r\n'), [
      'Data;Ordine;Stato;Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl.',
      '14/10/2026;#91;Consegnato;C91A;Bocchettone A 90° Sanpress;2;36,60;73,20',
      '14/10/2026;#91;Consegnato;C91B;Raccordo a T;1;12,81;12,81',
      '15/10/2026;#97;Consegnato;C97;"87 Elemento A ""t"" 87gr Diam. 100";1;124,44;124,44',
      '16/10/2026;#98;In consegna;C98;Valvola Deviatrice 3vie Per Easy;1;61,00;61,00',
      'Totale;;;;;;;271,45',
    ]);
    // "Tutto" nel nome del file
    assert.match((await chiedi('/distributore/clienti/32/materiale.csv?mese=tutto')).headers.get('content-disposition'), /_tutto\.csv"$/);
  } finally {
    materialeProva.attivo = false;
    banco.attivo = false;
    biscotti.cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  }
});

test('storico vuoto: icona, "Nessun ordine ancora." e pulsante verso il catalogo', async () => {
  const t = await (await chiedi('/storico')).text();
  assert.match(t, /Nessun ordine ancora\./);
  assert.match(t, /<a class="btn btn-primary btn-blocco" href="\/home">Vai al catalogo<\/a>/);
  assert.doesNotMatch(t, /st-titolo/);
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
