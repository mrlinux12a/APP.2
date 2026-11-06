// Stato ordini e richieste dell'installatore: in attesa, scadute, annullate.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38474);
const {
  chiedi, erroriServer, fa, form, notificheCliente, ordiniProva, storico, stripeRighe,
} = aiuti;

// Si comincia già entrati come installatore: le prime prove contano su una sessione aperta (nel file unico di prima la lasciavano le prove di accesso).
test.before(async () => { await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); });

test('Stato ordini vuoto: furgone, "Come funziona" in tre passaggi, catalogo e riga dello storico', async () => {
  const r = await chiedi('/ordini');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /<div class="app app-vuoto">/);
  assert.match(t, /class="titolo">Stato ordini</); // intestazione di sempre
  assert.match(t, /<div class="vuoto-fig" aria-hidden="true">\s*<span class="vuoto-fig-tratt"><\/span>\s*<svg/);
  assert.match(t, /<h1 class="vuoto-titolo">Nessun ordine in corso<\/h1>/);
  assert.match(t, /<p class="vuoto-sotto">Quando mandi una richiesta, qui segui ogni passaggio fino al cantiere\.<\/p>/);
  assert.match(t, /<h2 class="cf-occhiello" id="cf-occhiello">Come funziona<\/h2>/);
  assert.equal((t.match(/<li class="cf-passo">/g) || []).length, 3);
  for (const [colore, titolo, spiegazione] of [
    ['cf-blu', 'Mandi la richiesta', 'Scegli i pezzi e paghi dal carrello.'],
    ['cf-arancio', 'Il banco conferma', 'Entro 10 minuti, o ti rimborsiamo.'], // la finestra viene dalla configurazione (10 nel DB finto)
    ['cf-verde', 'Arriva in cantiere', 'Vedi chi lo porta e quanto manca.'],
  ]) {
    assert.match(t, new RegExp(`<span class="cf-ico ${colore}" aria-hidden="true"><svg[\\s\\S]*?</svg></span>\\s*<span class="cf-testi">\\s*<strong>${titolo}</strong>\\s*<span>${spiegazione.replace(/\./g, '\\.')}</span>`));
  }
  assert.match(t, /<a class="btn-vuoto-pieno" href="\/home"><svg[\s\S]*?<\/svg><span>Vai al catalogo<\/span><\/a>/);
  assert.match(t, /<a class="riga-storico" href="\/storico">[\s\S]*?<strong>Storico ordini<\/strong>\s*<span>Richieste e ordini passati<\/span>/);
  // niente più la frase che mandava al menu account, né la scatola e il pulsante di prima
  assert.doesNotMatch(t, /menu account|Crea il tuo ordine dal catalogo|class="btn btn-primary btn-blocco"/);
  // con una sola richiesta in corso la pagina non c'è: si va dritti alla richiesta
  storico.attivo = true;
  try {
    const r2 = await chiedi('/ordini');
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.get('location'), '/richieste/6');
  } finally {
    storico.attivo = false;
  }
});

test('Stato ordini vuoto: le notifiche appena lette non lasciano il "+N" sull\'icona (il contatore è calcolato prima che la pagina le segni lette)', async () => {
  notificheCliente.nonLette = 1;
  try {
    // senza attività in corso l'icona mostra quante notifiche di ordini e richieste non sono state lette...
    let t = await (await chiedi('/home')).text();
    assert.match(t, /<span class="pallino pallino-azzurro">\+1<\/span>/);
    // ...ma aprendo "Stato ordini" vuoto si segnano lette e il pallino non deve restare nemmeno in quella pagina
    const r = await chiedi('/ordini');
    assert.equal(r.status, 200);
    t = await r.text();
    assert.doesNotMatch(t, /pallino-azzurro/);
    assert.equal(notificheCliente.nonLette, 0);
    t = await (await chiedi('/home')).text();
    assert.doesNotMatch(t, /pallino-azzurro/);
  } finally {
    notificheCliente.nonLette = 0;
  }
});

test('Stato ordini con più attività: /ordini porta alla più urgente, ?voce= sceglie, e sopra la pagina c\'è la striscia di schede', async () => {
  storico.attivo = true;
  storico.conOrdini = true;
  ordiniProva.attivo = true;
  try {
    // le voci, nell'ordine dell'icona: la richiesta 6 in attesa e l'ordine 50 in consegna
    let r = await chiedi('/ordini');
    assert.equal(r.status, 302, 'non si rende più una lista');
    assert.equal(r.headers.get('location'), '/richieste/6', 'la più urgente');
    assert.equal((await chiedi('/ordini?voce=ordine-50')).headers.get('location'), '/ordini/50');
    assert.equal((await chiedi('/ordini?voce=richiesta-6')).headers.get('location'), '/richieste/6');
    // una voce che non c'è (o scritta male): la prima
    for (const voce of ['ordine-999', 'richiesta-5', 'qualcosa', '', 'ordine-50x']) {
      assert.equal((await chiedi('/ordini?voce=' + voce)).headers.get('location'), '/richieste/6', voce);
    }

    // la pagina della richiesta 6: titolo "Stato ordini" senza freccia indietro, striscia con la sua scheda attiva
    let t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<body data-loggato="1" class="con-striscia">/);
    assert.match(t, /class="titolo">Stato ordini</);
    assert.doesNotMatch(t, /aria-label="Indietro"/);
    assert.match(t, /<section class="striscia" data-striscia data-firma="ordine-50-consegna,richiesta-6-richiesta">/);
    assert.match(t, /<span class="striscia-conta">2 in corso<\/span>\s*<span class="striscia-pos">1 di 2<\/span>/);
    assert.match(t, /<nav class="striscia-schede" aria-label="Ordini in corso" style="--n: 2">/);
    const schede = (testo) => [...testo.matchAll(/<a class="str-scheda str-(\w+)( str-attiva)?" href="([^"]+)" data-voce="([^"]+)"( aria-current="page")?/g)]
      .map((m) => [m[1], !!m[2], m[3], m[4], !!m[5]]);
    assert.deepEqual(schede(t), [
      ['richiesta', true, '/richieste/6', 'richiesta-6', true],
      ['consegna', false, '/ordini/50', 'ordine-50', false],
    ]);
    // la scheda della richiesta ha il suo timer; quella della consegna il suo valore; ognuna il suo articolo
    assert.match(t, /data-voce="richiesta-6" aria-current="page" data-secondi="\d+" data-durata="360">/);
    assert.match(t, /<span data-countdown>0[45]:\d\d<\/span><\/span>\s*<span class="str-breve">Bocchettone A 90°<\/span>/);
    assert.match(t, /<span class="str-valore">In consegna<\/span>\s*<span class="str-breve">Adattatore Ø80\/100mm<\/span>/);
    // il blocco in alto della pagina c'è ancora (qui nella versione compatta, a carico del CSS)
    assert.match(t, /<div class="card att-card att-timer">/);

    // la pagina dell'ordine 50 (in consegna): stessa striscia, scheda attiva l'ordine
    t = await (await chiedi('/ordini/50')).text();
    assert.match(t, /<body data-loggato="1" class="con-striscia">/);
    assert.match(t, /class="titolo">Stato ordini</);
    assert.doesNotMatch(t, /aria-label="Indietro"/);
    assert.match(t, /<span class="striscia-pos">2 di 2<\/span>/);
    assert.deepEqual(schede(t), [
      ['richiesta', false, '/richieste/6', 'richiesta-6', false],
      ['consegna', true, '/ordini/50', 'ordine-50', true],
    ]);

    // la barra in basso alterna le due attività e il suo tocco porta DRITTO alla pagina della voce mostrata (la prima all'inizio):
    // niente passaggio da /ordini?voce=, che costava un giro in più a ogni cambio di ordine
    const nav = t.slice(t.indexOf('<a href="/richieste/6" class="nav-ordini multi'), t.indexOf('</a>', t.indexOf('<a href="/richieste/6" class="nav-ordini multi')));
    assert.match(nav, /^<a href="\/richieste\/6" class="nav-ordini multi fase-richiesta attivo" data-fase="richiesta" data-fasi="richiesta,consegna" data-attivo="ordini" data-firma="ordine-50-consegna,richiesta-6-richiesta" aria-label="Stato ordini: 2 attivi\. In attesa, 0[45]:\d\d rimasti\. In consegna\.">/);
    assert.deepEqual([...nav.matchAll(/<span class="fotogramma fase-(\w+)( attivo)?" data-voce="([^"]+)" data-href="([^"]+)"/g)].map((m) => [m[1], !!m[2], m[3], m[4]]),
      [['richiesta', true, 'richiesta-6', '/richieste/6'], ['consegna', false, 'ordine-50', '/ordini/50']]);
    assert.match(nav, /<span class="punto attivo"><\/span><span class="punto"><\/span>/);
    assert.match(nav, /<span class="conteggio">2<\/span>/);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
    ordiniProva.attivo = false;
  }
});

test('striscia: con una sola attività niente striscia e tutto come prima; neanche per un ordine consegnato aperto dallo storico', async () => {
  storico.attivo = true; // c'è solo la richiesta 6 in attesa
  try {
    let r = await chiedi('/ordini');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/richieste/6');
    let t = await (await chiedi('/richieste/6')).text();
    assert.doesNotMatch(t, /<section class="striscia"|striscia-schede"|class="con-striscia"/);
    assert.match(t, /class="titolo">Verifica disponibilità</);
    assert.match(t, /<a class="icona-btn" href="\/home" aria-label="Indietro">/);

    // con due attività, un ordine consegnato aperto dallo storico non fa parte delle voci: niente striscia
    storico.conOrdini = true;
    ordiniProva.attivo = true;
    t = await (await chiedi('/ordini/71')).text();
    assert.doesNotMatch(t, /<section class="striscia"|striscia-schede"|class="con-striscia"/);
    assert.match(t, /<a class="icona-btn" href="\/home" aria-label="Indietro">/);
    // lo stesso per una richiesta che non è una delle voci (la 5, ormai ordine)
    r = await chiedi('/richieste/4');
    assert.doesNotMatch(await r.text(), /<section class="striscia"|class="con-striscia"/);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
    ordiniProva.attivo = false;
  }
});

test('richiesta senza risposta: resta in "Stato ordini" 10 minuti dalla scadenza anche con un\'altra richiesta aperta, poi si passa alla prossima attività o alla pagina vuota', async () => {
  storico.attivo = true; // la 6 è in attesa; la 4 è chiusa senza ordine (la scadenza di fabbrica è del 2025: la si sposta a ogni passo)
  const r4 = storico.richieste.find((r) => r.id === 4);
  const r6 = storico.richieste.find((r) => r.id === 6);
  const scadenza4 = r4.scade_il;
  const stato6 = r6.stato;
  const schede = (testo) => [...testo.matchAll(/<a class="str-scheda str-(\w+)( str-attiva)?" href="([^"]+)" data-voce="([^"]+)"/g)].map((m) => [m[1], !!m[2], m[4]]);
  try {
    // scaduta da 3 minuti, con la 6 ancora in attesa: prima la 4 spariva subito (non era l'ultima richiesta inviata)
    r4.scade_il = fa(3 * 60000);
    let r = await chiedi('/ordini');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/richieste/4', 'la senza risposta per prima: il cliente deve rinviarla');
    assert.equal((await chiedi('/ordini?voce=richiesta-6')).headers.get('location'), '/richieste/6');

    // la pagina della 4: striscia con le due schede, il conto per l'icona e il passaggio automatico fra ~7 minuti
    let t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /<body data-loggato="1" class="con-striscia">/);
    assert.deepEqual(schede(t), [['scaduta', true, 'richiesta-4'], ['richiesta', false, 'richiesta-6']]);
    const m = /var fine = Date\.now\(\) \+ (\d+) \* 1000 \+ 1000;/.exec(t);
    assert.ok(m && Math.abs(Number(m[1]) - 420) <= 3, 'mancano ~7 minuti: ' + (m && m[1]));
    assert.match(t, /location\.replace\('\/ordini'\)/);
    assert.match(t, /data-voce="richiesta-4" data-href="\/richieste\/4" data-scompare-sec="\d+"/);

    // dalla 6 la scheda della 4 si vede ancora, e quella pagina non va da nessuna parte
    t = await (await chiedi('/richieste/6')).text();
    assert.deepEqual(schede(t), [['scaduta', false, 'richiesta-4'], ['richiesta', true, 'richiesta-6']]);
    assert.doesNotMatch(t, /window.minuteriaLasciaIl = fine/);

    // passati i 10 minuti: la 4 non è più in "Stato ordini" (resta la 6), la sua pagina si apre ancora (dallo Storico) ma senza striscia né passaggio
    r4.scade_il = fa(11 * 60000);
    assert.equal((await chiedi('/ordini')).headers.get('location'), '/richieste/6');
    t = await (await chiedi('/richieste/4')).text();
    assert.doesNotMatch(t, /window.minuteriaLasciaIl = fine|class="con-striscia"/);
    assert.match(t, /<h2 class="att-titolo">/);

    // senza altro in corso: finché la 4 è nei suoi 10 minuti ci porta lì; poi la pagina vuota
    r6.stato = 'annullata';
    r4.scade_il = fa(2 * 60000);
    r = await chiedi('/ordini');
    assert.equal(r.headers.get('location'), '/richieste/4');
    r4.scade_il = fa(11 * 60000);
    r = await chiedi('/ordini');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<h1 class="vuoto-titolo">Nessun ordine in corso<\/h1>/);
  } finally {
    r4.scade_il = scadenza4;
    r6.stato = stato6;
    storico.attivo = false;
  }
});

test('richiesta scaduta: "Nessun corriere ha confermato" se il banco aveva accettato, "Nessun banco ha confermato" negli altri casi', async () => {
  storico.attivo = true; // la richiesta 4 è chiusa senza ordine (nessuna_offerta), rimborsata
  try {
    const riga = (extra) => ({ id: 1, request_id: 4, distributor_id: 2, distributore_nome: 'Borea', filiale: 'Fegino', ditta_id: 6, esito: 'scaduto', corriere_stato: null, ...extra });
    const titolo = (t) => (t.match(/<h2 class="att-titolo">([^<]*)<\/h2>/) || [])[1];
    const pagina = async () => (await chiedi('/richieste/4')).text();

    // il banco non ha risposto in tempo: la scritta di sempre, e il suo stato "Nessuna risposta"
    storico.risposte[4] = [riga({})];
    let t = await pagina();
    assert.equal(titolo(t), 'Nessun banco ha confermato');
    assert.match(t, /<span class="att-chip-no">Nessuna risposta<\/span>/);

    // il banco ha rifiutato: ancora "nessun banco"
    storico.risposte[4] = [riga({ esito: 'non_disponibile' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun banco ha confermato');
    assert.match(t, /<span class="att-chip-no">Non disponibile<\/span>/);

    // il banco ha accettato ma nessun corriere ha preso la consegna: la causa è il corriere, e il banco risulta disponibile
    storico.risposte[4] = [riga({ esito: 'confermato', corriere_stato: 'scaduto' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun corriere ha confermato');
    assert.match(t, /<span class="att-chip-ok">[\s\S]*?Disponibile<\/span>/);
    assert.doesNotMatch(t, /Nessun banco ha confermato/);
    assert.match(t, /<p class="att-sotto">Il tempo per rispondere è scaduto\.<\/p>/);

    // due filiali della stessa ditta: vale quella che aveva accettato, anche se l'altra (chiusa) viene prima nell'elenco
    storico.risposte[4] = [riga({ id: 1, distributor_id: 2, esito: 'scaduto' }), riga({ id: 2, distributor_id: 181, filiale: 'Staglieno', esito: 'confermato', corriere_stato: 'scaduto' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun corriere ha confermato');
    assert.equal((t.match(/class="card att-card att-banco"/g) || []).length, 1, 'una ditta, una voce');
  } finally {
    storico.attivo = false;
    storico.risposte = {};
  }
});

// Le richieste di prova (fixture `storico`) con articoli e importi della specifica: 54,50 + 10,00 di merce a prezzo del banco ->
// consegna 12,87 (5,00 + servizio 6,45 con la sua IVA = 7,87, di cui IVA 2,32) pagata in app, materiale 78,69 (64,50 + IVA 14,19) da pagare a BOREA solo se confermano.
const DUE_ARTICOLI = () => [
  { nome: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', quantita: 1, product_id: 101, codice: '12514597', prezzo_listino: 54.5, sconto_base_pct: 0, raee: 0 },
  { nome: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', quantita: 1, product_id: 102, codice: '12697319', prezzo_listino: 10, sconto_base_pct: 0, raee: 0 },
];

const IMPORTI_SALVATI = { corriere: 5, servizio: 6.45, iva_app: 2.32, da_pagare_app: 12.87, merce_banco: 64.5, raee_banco: 0, iva_banco: 14.19, materiale_banco: 78.69 };

// Una richiesta nata COL MODELLO DI PRIMA (IVA sopra corriere e servizio: 10 + 6,45 + 3,62 = 20,07): resta com'era, con la sua riga IVA.
const IMPORTI_SALVATI_PRIMA = { corriere: 10, servizio: 6.45, iva_app: 3.62, da_pagare_app: 20.07, merce_banco: 64.5, raee_banco: 0, iva_banco: 14.19, materiale_banco: 78.69 };

const IMPORTI_A_ZERO = { corriere: 0, servizio: 0, iva_app: 0, da_pagare_app: 0, merce_banco: 0, raee_banco: 0, iva_banco: 0, materiale_banco: 0 };

const rispostaProva = (idRichiesta, extra) => ({ id: 1, request_id: idRichiesta, distributor_id: 2, distributore_nome: 'BOREA SRL', filiale: 'Fegino', ditta_id: 6, esito: 'in_attesa', corriere_stato: null, ...extra });

// Applica i campi alla richiesta di prova (e gli articoli), esegue la prova e rimette tutto com'era.
async function conRichiesta(id, campi, articoli, prova) {
  const r = storico.richieste.find((x) => x.id === id);
  const prima = { ...r };
  const righePrima = storico.righe[id];
  Object.assign(r, campi);
  if (articoli) storico.righe[id] = articoli;
  storico.attivo = true;
  try {
    await prova(r);
  } finally {
    for (const k of Object.keys(r)) delete r[k];
    Object.assign(r, prima);
    if (righePrima === undefined) delete storico.righe[id]; else storico.righe[id] = righePrima;
    storico.attivo = false;
    storico.risposte = {};
  }
}

test('richiesta in attesa: righe e "Merce" a prezzo del banco, scheda "Pagamenti" (carta BLOCCATA, materiale in sospeso) e "Annulla la richiesta" solo finché nessun banco conferma', async () => {
  await conRichiesta(6, { ...IMPORTI_SALVATI, pagamento_importo: 12.87, pagamento_metodo: 'stripe', pagato_il: fa(60000) }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    let t = await (await chiedi('/richieste/6')).text();
    // 1. "Materiale richiesto": quantità, nome, "Cod. … · € cad.", totale di riga; sotto la merce IVA esclusa a prezzi del banco
    assert.match(t, /<div class="att-occhiello">Materiale richiesto<\/div>/);
    assert.match(t, /<span class="att-qta">1×<\/span>\s*<div class="att-desc">\s*<div class="att-nome">Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/div>\s*<div class="att-cod">Cod\. 12514597 · € 54,50 cad\.<\/div>/);
    assert.match(t, /<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /<div class="att-cod">Cod\. 12697319 · € 10,00 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 10,00<\/span>/);
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /att-pagato|<span>Pagato<\/span>|Richiesta del|prezzi IVA esclusa/);
    // 2. "Pagamenti", stato 'bloccato': la carta è solo AUTORIZZATA. Consegna azzurra con il lucchetto, materiale tratteggiato "solo se conferma"
    assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="attesa" data-pagamento="bloccato">\s*<h2 class="pg-titolo">Pagamenti<\/h2>/);
    assert.match(t, /<div class="pg-riga pg-bloccata">[\s\S]*?Consegna in cantiere[\s\S]*?<span class="pg-lucchetto"[\s\S]*?<\/span>Bloccati sulla carta · addebitati solo se BOREA conferma[\s\S]*?<div class="pg-importo" data-importo-app>€ 12,87<\/div>/);
    assert.match(t, /<div class="pg-riga pg-materiale pg-sospeso">[\s\S]*?<div class="pg-nome">Materiale<\/div>\s*<div class="pg-sub">Lo paghi a BOREA solo se conferma<\/div>[\s\S]*?<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/);
    assert.doesNotMatch(t, /Pagata|rimborsata se nessuno accetta|pg-consegna|Rimborso/, 'non è pagata: è bloccata');
    assert.doesNotMatch(t, /Ricevuta|ricevuta\.pdf/, 'la ricevuta nasce con l\'ordine, non prima');
    // 3. il dettaglio (chiuso): consegna bloccata 5,00 / 7,87 (servizio con la sua IVA, nessuna riga IVA) e materiale 64,50 / 14,19, senza RAEE
    assert.match(t, /<details class="pg-dettaglio">/);
    assert.doesNotMatch(t, /<details class="pg-dettaglio" open/);
    assert.match(t, /<h3>Consegna · bloccata sulla carta<\/h3>/);
    assert.match(t, /Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 5,00<\/dd>/);
    assert.match(t, /Servizio<\/span> <span class="pg-sp">· 10% della merce \+ IVA<\/span><\/dt><dd>€ 7,87<\/dd>/);
    assert.equal((t.match(/<span class="pg-et">IVA 22%<\/span>/g) || []).length, 1, 'una sola riga IVA: quella del materiale');
    assert.doesNotMatch(t, /IVA 22%<\/span> <span class="pg-sp">· su € (10,55|11,45)/);
    assert.match(t, /<h3>Materiale · se BOREA conferma<\/h3>/);
    assert.match(t, /Merce<\/span> <span class="pg-sp">· prezzo del banco<\/span><\/dt><dd>€ 64,50<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
    assert.doesNotMatch(t, /Contributo RAEE/);
    // 4. si può solo annullare (fase 1: nessun banco ha ancora accettato): niente "Elimina definitivamente" (la rotta c'è, si usa dalla richiesta chiusa)
    assert.match(t, /<form method="POST" action="\/richieste\/6\/annulla" data-annulla-richiesta>/);
    assert.match(t, /Annulla la richiesta/);
    assert.doesNotMatch(t, /Elimina definitivamente|\/richieste\/6\/elimina/);
    let api = await (await chiedi('/api/richieste/6')).json();
    assert.equal(api.annullabile, true);
    // un banco ha confermato (anche se il corriere non ha ancora risposto: all'installatore risulta ancora "in attesa"): "Annulla la richiesta"
    // non c'è più, e il controllo periodico della pagina lo dice (la pagina lo nasconde da sola)
    storico.risposte[6] = [rispostaProva(6, { esito: 'confermato', corriere_stato: 'in_attesa' })];
    t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<form method="POST" action="\/richieste\/6\/annulla" data-annulla-richiesta hidden>/);
    api = await (await chiedi('/api/richieste/6')).json();
    assert.equal(api.annullabile, false);
    storico.risposte[6] = [rispostaProva(6)];
    // con più ditte interpellate non c'è un nome solo: "al banco"
    storico.risposte[6] = [rispostaProva(6), rispostaProva(6, { id: 2, distributore_nome: 'AFIS SPA', ditta_id: 7 })];
    t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /addebitati solo se il banco conferma/);
    assert.match(t, /Lo paghi al banco solo se conferma/);
    assert.match(t, /<h3>Materiale · se il banco conferma<\/h3>/);
  });
});

test('richiesta in attesa VECCHIA (importi non salvati): si ricalcolano sulle righe, e la consegna è quanto è stato davvero addebitato', async () => {
  await conRichiesta(6, { ...IMPORTI_A_ZERO, pagamento_importo: 66.9, pagamento_metodo: 'simulato', pagato_il: fa(60000) }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    const t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.match(t, /<div class="pg-importo" data-importo-app>€ 66,90<\/div>/, 'la consegna è il pagamento_importo');
    assert.match(t, /<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/, 'il materiale è ricalcolato');
    // le voci del dettaglio sono quelle del calcolo di oggi, come nel carrello
    assert.match(t, /Servizio<\/span> <span class="pg-sp">· 10% della merce \+ IVA<\/span><\/dt><dd>€ 7,87<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
  });
});

test('richiesta in attesa nata COL MODELLO DI PRIMA (IVA sopra: 10,00 + 6,45 + IVA 3,62 = 20,07): resta com\'era, con la sua riga IVA', async () => {
  await conRichiesta(6, { ...IMPORTI_SALVATI_PRIMA, pagamento_importo: 20.07, pagamento_metodo: 'stripe', pagato_il: fa(60000) }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    const t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>/);
    assert.match(t, /Servizio<\/span> <span class="pg-sp">· 10% della merce<\/span><\/dt><dd>€ 6,45<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 16,45<\/span><\/dt><dd>€ 3,62<\/dd>/);
  });
});

test('richiesta in attesa del vecchio flusso (mai pagata): righe e materiale, ma nessuna scheda "Pagamenti"', async () => {
  await conRichiesta(6, { ...IMPORTI_A_ZERO, pagamento_stato: null, pagamento_importo: null }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    const t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /data-pagamenti/);
  });
});

test('richiesta scaduta: UNA sola riga grigia "Nessun addebito € 0,00" (niente furgone, niente verde), pillola "Nessun addebito sulla carta", la nota col blocco di OGGI; Rinvia ed Elimina', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'rimborsato', pagamento_importo: 12.87, pagamento_metodo: 'stripe', rimborsato_il: new Date(2025, 2, 20, 9, 10) };
  await conRichiesta(4, campi, DUE_ARTICOLI(), async () => {
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' })];
    let t = await (await chiedi('/richieste/4')).text();
    // in alto: il testo non dipende dalla durata della finestra; la pillola dice che la carta non è stata addebitata (era solo bloccata: non c'è un rimborso)
    assert.match(t, /<p class="att-sotto">Il tempo per rispondere è scaduto\.<\/p>/);
    assert.doesNotMatch(t, /Il tempo di/);
    assert.match(t, /<span class="att-rimborso">[\s\S]*?Nessun addebito sulla carta<\/span>/);
    assert.doesNotMatch(t, /rimborsati|Rimborso in corso|Rimborsata/);
    // materiale richiesto: prezzi del banco, niente più "Richiesta del …"
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /Richiesta del|prezzi IVA esclusa/);
    // Pagamenti, stato 'annullato': UNA riga grigia con la carta di credito; niente consegna, materiale, dettaglio né ricevuta
    assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="chiusa" data-pagamento="annullato">/);
    assert.match(t, /<div class="pg-riga pg-nessuno">[\s\S]*?<div class="pg-nome">Nessun addebito<\/div>\s*<div class="pg-sub">Il blocco di € 12,87 sulla carta è stato annullato\. Nessuna consegna, niente da pagare a BOREA\.<\/div>[\s\S]*?<div class="pg-importo" data-importo-app>€ 0,00<\/div>/);
    assert.equal((t.match(/class="pg-riga/g) || []).length, 1, 'una sola riga');
    assert.doesNotMatch(t, /pg-consegna|pg-materiale|pg-bloccata|<details class="pg-dettaglio">|Ricevuta|data-importo-banco/);
    // la nota: gli stessi prezzi di oggi di quando si preme "Rinvia" (qui non sono cambiati: 12,87 e 78,69)
    assert.match(t, /<p class="pg-nota" data-nota-rinvio>Se rinvii la richiesta blocchiamo di nuovo € 12,87 sulla carta, addebitati solo se BOREA conferma\. Il materiale \(€ 78,69\) lo paghi a BOREA\.<\/p>/);
    // Rinvia (blu) ed Elimina, come prima
    assert.match(t, /action="\/richieste\/4\/reinvia"[\s\S]*?Rinvia richiesta/);
    assert.match(t, /action="\/richieste\/4\/elimina"[\s\S]*?Elimina richiesta/);

    // i prezzi sono cambiati dopo la chiusura: la nota usa quelli di oggi (articolo da 104,50: merce 114,50 -> 18,97 e 139,69)
    storico.righe[4][0].prezzo_listino = 104.5;
    t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /blocchiamo di nuovo € 18,97 sulla carta, addebitati solo se BOREA conferma\. Il materiale \(€ 139,69\) lo paghi a BOREA\./);
    assert.match(t, /<div class="pg-importo" data-importo-app>€ 0,00<\/div>/);
    assert.match(t, /Il blocco di € 12,87 sulla carta è stato annullato/, 'il blocco annullato è quello che era stato fatto');

    // più ditte: "al banco"
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' }), rispostaProva(4, { id: 2, distributore_nome: 'AFIS SPA', ditta_id: 7, esito: 'scaduto' })];
    t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /Nessuna consegna, niente da pagare al banco\./);
    assert.match(t, /addebitati solo se il banco conferma\. Il materiale \(€ 139,69\) lo paghi al banco\./);
  });
});

test('richiesta scaduta con carta già rilasciata su Stripe, e banco che aveva accettato ma senza corriere: sempre "Nessun addebito" (mai "rimborso in corso")', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'pagato', pagamento_importo: 12.87, pagamento_metodo: 'stripe' };
  await conRichiesta(4, campi, DUE_ARTICOLI(), async (r) => {
    storico.risposte[4] = [rispostaProva(4, { esito: 'confermato', corriere_stato: 'scaduto' })];
    // il giro di Stripe non ha ancora rilasciato il blocco (la richiesta si è appena chiusa): per chi guarda è già annullato
    let t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /<span class="att-rimborso">[\s\S]*?Nessun addebito sulla carta<\/span>/);
    assert.doesNotMatch(t, /Rimborso in corso|att-rimborso-attesa|pg-rimborso-corso/);
    assert.match(t, /<div class="pg-riga pg-nessuno">[\s\S]*?Il blocco di € 12,87 sulla carta è stato annullato\. Nessuna consegna, niente da pagare a BOREA\./);
    // la riga di Stripe dice la stessa cosa (blocco rilasciato)
    stripeRighe.push({ id: 901, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'rilasciato', payment_intent_id: 'pi_prova_4', importo_cent: 2007, incasso_cent: null, request_id: 4, aggiornato_il: fa(60000) });
    try {
      t = await (await chiedi('/richieste/4')).text();
      assert.match(t, /data-pagamento="annullato"/);
      assert.match(t, /<span class="att-rimborso">[\s\S]*?Nessun addebito sulla carta<\/span>/);
    } finally {
      stripeRighe.pop();
    }
    // metodo che non è una carta, già "rimborsata" nel vecchio senso: stessa cosa
    Object.assign(r, { pagamento_stato: 'rimborsato', pagamento_metodo: null, rimborsato_il: null });
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' })];
    t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /<div class="pg-riga pg-nessuno">[\s\S]*?<div class="pg-nome">Nessun addebito<\/div>/);
  });
});

test('richiesta annullata da te in fase 1: UNA riga grigia "Hai annullato la richiesta: il blocco … è stato tolto dalla carta", nessun addebito', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'rimborsato', pagamento_importo: 12.87, pagamento_metodo: 'stripe', rimborsato_il: null };
  await conRichiesta(2, campi, DUE_ARTICOLI(), async () => {
    storico.risposte[2] = [rispostaProva(2, { esito: 'scaduto' })];
    stripeRighe.push({ id: 902, cliente_id: 1, tipo: 'richiesta', modo: 'test', stato: 'rilasciato', payment_intent_id: 'pi_prova_2', importo_cent: 2007, incasso_cent: null, request_id: 2, aggiornato_il: fa(60000) });
    try {
      const t = await (await chiedi('/richieste/2')).text();
      assert.match(t, /Hai annullato questa richiesta\.\s*Nessun addebito sulla carta\./);
      assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
      assert.doesNotMatch(t, /già comprensivi del servizio|Richiesta del|rimborsato/);
      assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="chiusa" data-pagamento="annullato">/);
      assert.match(t, /<div class="pg-riga pg-nessuno">[\s\S]*?<div class="pg-nome">Nessun addebito<\/div>\s*<div class="pg-sub">Hai annullato la richiesta: il blocco di € 12,87 è stato tolto dalla carta\.<\/div>[\s\S]*?<div class="pg-importo" data-importo-app>€ 0,00<\/div>/);
      assert.equal((t.match(/class="pg-riga/g) || []).length, 1, 'una sola riga: niente materiale');
      assert.doesNotMatch(t, /data-nota-rinvio|pg-materiale|Ricevuta/, 'una richiesta annullata non si rinvia e non ha ricevuta');
    } finally {
      stripeRighe.pop();
    }
  });
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
