// Banco: home, intestazione e clienti.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const aiuti = require('./_aiuti/server_finto');
const { leggiComposto } = require('../../src/comune/asset_composti');

aiuti.avvia(38478);
const {
  banco, biscotti, chiedi, erroriServer, form, json, radice, registro, utentiClienti,
} = aiuti;

test('home del banco: bacheca a tre colonne, senza interruttore né riquadri contatore', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);
    r = await chiedi('/distributore');
    assert.equal(r.status, 200);
    const t = await r.text();

    // intestazione: ditta e filiale, menu a schede con il pallino dei clienti da approvare, Storico ordini, niente campanella
    assert.match(t, /class="banco-ditta">BOREA SRL</);
    assert.match(t, /class="banco-filiale">Banco Genova Fegino</);
    assert.match(t, /class="banco-voce attiva" href="\/distributore" aria-current="page"/);
    assert.match(t, /href="\/distributore\/clienti">[\s\S]*?Clienti\s*<span class="banco-voce-pallino"[^>]*>2</);
    // "Storico ordini" è una scheda del menu, la terza dopo Clienti (richiesta esplicita del 19/10/2026), e non più un pulsante accanto al cerchio dell'utente
    const menu = t.match(/<nav class="banco-menu"[^>]*>[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...menu.matchAll(/<a class="banco-voce[^"]*" href="([^"]*)"/g)].map((m) => m[1]), ['/distributore', '/distributore/clienti', '/distributore/storico']);
    assert.match(menu, /<a class="banco-voce" href="\/distributore\/storico">\s*<span class="banco-voce-ico"><svg[\s\S]*?<\/svg><\/span>Storico ordini\s*<\/a>\s*<\/nav>/);
    const azioni = t.match(/<div class="banco-azioni">[\s\S]*?<\/header>/)[0];
    assert.doesNotMatch(azioni, /Storico ordini|banco-storico/, 'vicino al cerchio dell\'utente non c\'è più');
    assert.doesNotMatch(t, /banco-storico/);
    assert.doesNotMatch(t, /banco-campanella|Tutti gli ordini|Storico richieste|href="\/notifiche"/);
    assert.match(t, /<span class="avatar avatar-40"[^>]*>BG</); // iniziali di "Banco Genova Fegino"
    assert.match(t, /<nav class="navbar nav-solo-stretta">/); // da 900px in su il menu in basso non si mostra
    // sotto i 900px il menu in basso ha le stesse tre voci: Home, Clienti, Storico
    const basso = t.match(/<nav class="navbar nav-solo-stretta">[\s\S]*?<\/nav>/)[0];
    assert.deepEqual([...basso.matchAll(/<a href="([^"]*)" class="/g)].map((m) => m[1]), ['/distributore', '/distributore/clienti', '/distributore/storico']);
    assert.match(basso, /<a href="\/distributore\/storico" class="">\s*<span class="ico"><svg[\s\S]*?<\/svg><\/span>Storico\s*<\/a>/);

    // niente più interruttore, riquadri contatore né riga "filiale · zona"
    assert.doesNotMatch(t, /toggle-banco|Banco operativo|Ricezione attiva|In pausa|riquadri-conta|conta-box|zona Genova/);

    // le tre colonne, in ordine, ognuna con il numero delle sue schede
    const iConferma = t.indexOf('id="col-conferma"');
    const iCorriere = t.indexOf('id="col-corriere"');
    const iPreparare = t.indexOf('id="col-preparare"');
    assert.ok(iConferma > 0 && iConferma < iCorriere && iCorriere < iPreparare, 'ordine delle colonne');
    assert.match(t, /col-conferma">Da confermare<\/h2>\s*<span class="colonna-conta" aria-label="2 richieste">2</);
    assert.match(t, /col-corriere">Attesa corriere<\/h2>\s*<span class="colonna-conta" aria-label="1 richieste">1</);
    assert.match(t, /col-preparare">Da preparare<\/h2>\s*<span class="colonna-conta" aria-label="2 ordini">2</);
    assert.ok(t.includes('data-soglia-urgente="120"'), 'rossa negli ultimi 2 minuti');
    assert.doesNotMatch(t, /data-soglia-arrivo/, 'la scheda "Da preparare" non ha più una soglia rossa');
    // il restyling del 10/11/2026: tre colonne affiancate dentro un contenitore e un pallino di fase per colonna
    assert.match(t, /<div class="bacheca-colonne">/);
    assert.equal(t.match(/<span class="colonna-punto" aria-hidden="true"><\/span>/g).length, 3);
    // nessuna informazione di magazzino nella pagina
    assert.doesNotMatch(t, /giacenza|magazzino/i);

    // ogni scheda ha la sua identità (data-chiave) e il suo lavoro (data-lavoro: "r" + richiesta, "o" + ordine senza richiesta, uguale quando la richiesta diventa ordine):
    // la home si aggiorna sul posto e il popup "Ispeziona" segue il lavoro (assets/js). Da confermare: la scadenza più vicina in alto; Da preparare: il corriere più vicino in alto
    assert.deepEqual([...t.matchAll(/<article class="scheda scheda-(richiesta|corriere|ordine)[^"]*"\s+data-chiave="([^"]+)" data-lavoro="([^"]+)"/g)].map((m) => [m[2], m[3]]),
      [['richiesta-12', 'r12'], ['richiesta-11', 'r11'], ['corriere-21', 'r21'], ['ordine-1280', 'r177'], ['ordine-1281', 'o1281']]);

    // Da confermare: "#ORD-xxxx" e timer a pillola mm:ss con la barra che si accorcia (447 s rimasti su 600), niente "Nuova"
    assert.equal(t.match(/data-richiesta /g).length, 2);
    assert.match(t, /<span class="scheda-codice">#ORD-11<\/span>/);
    assert.match(t, /data-secondi="447" data-finestra="600"/);
    assert.match(t, /<span data-tempo>07:27<\/span>/);
    assert.match(t, /<span class="timer-barra-riempita" data-barra style="width: 74.5%"><\/span>/);
    assert.doesNotMatch(t, /data-nuova|etichetta-nuova|>Nuova</);
    assert.match(t, /scheda-richiesta urgente[^"]*"\s+data-chiave="richiesta-12"/); // 95 s: negli ultimi 2 minuti
    assert.doesNotMatch(t, /scheda-richiesta urgente[^"]*"\s+data-chiave="richiesta-11"/);
    // il materiale: SOLO il codice prodotto e la quantità (×2), niente nomi degli articoli né "Cod."
    assert.match(t, /<span class="codice-cod">12352992<\/span>\s*<span class="codice-qta">×2<\/span>/);
    assert.match(t, /<span class="codice-cod">10880380<\/span>\s*<span class="codice-qta">×1<\/span>/);
    assert.doesNotMatch(t, /Bocchettone A 90°|Valvola Deviatrice 3vie|Adattatore Ø80\/100mm|Cod\. 1\d{7}|articolo-nome|articolo-qta/);
    // nessun indirizzo né posizione del cliente sulle schede
    assert.doesNotMatch(t, /Via Puggia|posizione di consegna|destinazione/i);
    // "Accetta" conferma subito (prezzo_richiesto, torna alla home); "Non disponibile" rifiuta subito; "Ispeziona" è il collegamento alla pagina (con JS apre il popup)
    assert.equal(t.match(/>Accetta<\/button>/g).length, 2);
    assert.doesNotMatch(t, /Verifica e conferma|>Conferma<\/button>|>Preparato<\/button>/);
    assert.match(t, /<a class="btn-banco btn-banco-secondario" href="\/distributore\/richieste\/11" data-ispeziona="r11"><svg[\s\S]*?<\/svg>Ispeziona<\/a>/);
    assert.match(t, /<form method="POST" action="\/distributore\/richieste\/11\/rispondi">\s*<input type="hidden" name="azione" value="rifiuta">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-rifiuta" type="submit">Non disponibile<\/button>\s*<\/form>\s*<form class="azione-principale" method="POST" action="\/distributore\/richieste\/11\/rispondi">\s*<input type="hidden" name="azione" value="prezzo_richiesto">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-accetta" type="submit">Accetta<\/button>/);
    assert.equal(t.match(/data-ispeziona="/g).length, 5, 'un Ispeziona per scheda: due in "Da confermare", uno in "Attesa corriere" e due in "Da preparare"');
    // i nomi vengono dal DB: mai HTML grezzo
    assert.ok(t.includes('Rossi &lt;b&gt;Impianti&lt;/b&gt; S.r.l.'));
    assert.doesNotMatch(t, /<b>Impianti<\/b>/);

    // Attesa corriere: "#ORD-21", "da 03:10" (190 s, mm:ss che sale), il riquadro animato "Cerco un corriere…" con le onde, i puntini e la barra; solo "Ispeziona"
    assert.match(t, /<span class="scheda-codice">#ORD-21<\/span>\s*<span class="da-tempo">da <span data-da>03:10<\/span><\/span>/);
    assert.match(t, /<h3 class="scheda-nome">Verdi S\.n\.c\.<\/h3>/);
    assert.match(t, /<span class="cerca-onda"><\/span><span class="cerca-onda cerca-onda-2"><\/span>/);
    assert.match(t, /Cerco un corriere<span class="puntini" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>/);
    assert.match(t, /In attesa della sua conferma/);
    assert.match(t, /<div class="cerca-barra" aria-hidden="true"><span><\/span><\/div>/);
    assert.match(t, /<a class="btn-banco btn-banco-secondario btn-banco-pieno" href="\/distributore\/richieste\/21" data-ispeziona="r21" aria-label="Ispeziona l'ordine di Verdi S\.n\.c\."><svg[\s\S]*?<\/svg>Ispeziona<\/a>/);
    assert.match(t, /data-corriere data-trascorsi="190"/);
    assert.doesNotMatch(t, /Confermato da te\. Non preparare ancora|Corriere avvisato/);

    // Da preparare: etichetta scura con "ORDINE" + il codice, nome del cliente, riquadro del corriere in arrivo (mm:ss + barra) solo se c'è il corriere
    assert.match(t, /<span class="ordine-etichetta"><span class="ordine-etichetta-tit">Ordine<\/span><span class="ordine-etichetta-cod">ORD-1280<\/span><\/span>/);
    assert.match(t, /<span class="ordine-etichetta-cod">ORD-1281<\/span>/);
    assert.match(t, /<div class="arrivo" data-arrivo data-secondi="480" data-totale="900">/);
    assert.match(t, /<span class="arrivo-testo" data-arrivo-testo>Corriere in arrivo tra<\/span>\s*<span class="arrivo-punto" aria-hidden="true"><\/span>\s*<span class="arrivo-tempo" data-arrivo-tempo>08:00<\/span>/);
    assert.match(t, /<span class="timer-barra-riempita" data-barra style="width: 46.7%"><\/span>/);
    assert.equal(t.match(/data-arrivo /g).length, 1, 'senza corriere nessun riquadro d\'arrivo');
    assert.doesNotMatch(t, /pillola-arrivo|pillola-ora|ritira Marco|>ore \d\d:\d\d</);
    // "Ispeziona" (la pagina dell'ordine; con JS il popup, che segue lo stesso lavoro della richiesta: r177) e "Ritirato dal corriere" (il vecchio "Preparato", stessa rotta)
    assert.match(t, /<a class="btn-banco btn-banco-secondario" href="\/distributore\/ordini\/1280" data-ispeziona="r177"><svg[\s\S]*?<\/svg>Ispeziona<\/a>\s*<form class="azione-principale" method="POST" action="\/distributore\/ordini\/1280\/preparazione">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-ritirato" type="submit"><svg[\s\S]*?<\/svg>Ritirato dal corriere<\/button>/);
    // anche l'ordine 1281, che non ha una richiesta, ha il suo Ispeziona (l'ordine c'è sempre) con la chiave dell'ordine
    assert.match(t, /<a class="btn-banco btn-banco-secondario" href="\/distributore\/ordini\/1281" data-ispeziona="o1281">[\s\S]*?<form class="azione-principale" method="POST" action="\/distributore\/ordini\/1281\/preparazione">/);
    assert.equal(t.match(/>Ritirato dal corriere<\/button>/g).length, 2);
    // "Da preparare" (colonna e contatore) esclude gli ordini segnati consegnati: restano 'inviato' ma la loro pagina rimanda allo Storico, quindi "Ispeziona" non porterebbe da nessuna parte
    assert.match(banco.sqlHome.colonna, /o\.stato = 'inviato' AND o\.consegnato_il IS NULL/);
    assert.match(banco.sqlHome.contatore, /stato = 'inviato' AND consegnato_il IS NULL\) AS da_preparare/);

    // il popup: il contenitore è nella pagina, nascosto e vuoto (lo riempie lo script con GET /distributore/ispeziona/<lavoro>)
    assert.match(t, /<div class="isp-overlay" data-isp-overlay hidden>\s*<div class="isp-pannello" role="dialog" aria-modal="true" aria-labelledby="isp-titolo" tabindex="-1" data-isp-pannello><\/div>\s*<\/div>/);

    // la pausa della ricezione non esiste più
    r = await chiedi('/api/distributore/stato', json({ attivo: false }));
    assert.equal(r.status, 404);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: stessa intestazione e stessa tendina su ogni pagina, senza "Punti vendita"', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  // intestazione e tendina così come stanno nella pagina (la voce attiva cambia da pagina a pagina)
  const testa = (t) => t.match(/<header class="banco-testa"[^>]*>[\s\S]*?<\/header>/)[0];
  const tendina = (t) => t.match(/<div class="tendina" data-menu-tendina hidden>[\s\S]*?<\/form>\s*<\/div>/)[0];
  const senzaAttiva = (h) => h.replace(/ attiva"/g, '"').replace(/ aria-current="page"/g, '');
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    const pagine = {};
    for (const [nome, percorso, stato] of [
      ['home', '/distributore', 200],
      ['clienti', '/distributore/clienti', 200],
      ['storico', '/distributore/storico', 200],
      ['notifiche', '/notifiche', 200],
      ['errore', '/distributore/ordini/999', 404],
    ]) {
      r = await chiedi(percorso);
      assert.equal(r.status, stato, percorso);
      pagine[nome] = await r.text();
      assert.match(pagine[nome], /<header class="banco-testa"[^>]*>/, nome);
      assert.doesNotMatch(pagine[nome], /<header class="appbar">/, nome + ': niente appbar vecchia');
    }

    // la barra e la scheda dell'utente sono identiche (a parte la voce attiva) su tutte le pagine
    for (const nome of Object.keys(pagine)) {
      assert.equal(senzaAttiva(testa(pagine[nome])), senzaAttiva(testa(pagine.home)), nome + ': intestazione');
      assert.equal(tendina(pagine[nome]), tendina(pagine.home), nome + ': tendina');
    }
    assert.match(testa(pagine.home), /class="banco-voce attiva" href="\/distributore"/);
    assert.match(testa(pagine.clienti), /class="banco-voce attiva" href="\/distributore\/clienti"/);
    // "Storico ordini" è accesa sullo storico e dentro un ordine (qui un ordine inesistente: la pagina d'errore ha la stessa barra)
    assert.match(testa(pagine.storico), /class="banco-voce attiva" href="\/distributore\/storico" aria-current="page"/);
    assert.match(testa(pagine.errore), /class="banco-voce attiva" href="\/distributore\/storico" aria-current="page"/);
    assert.doesNotMatch(testa(pagine.home), /class="banco-voce attiva" href="\/distributore\/storico"/);
    assert.doesNotMatch(testa(pagine.notifiche), /class="banco-voce attiva" href="\/distributore\/storico"/);
    // e nel menu in basso, la voce "Storico" è accesa sullo storico
    assert.match(pagine.storico, /<a href="\/distributore\/storico" class="attivo">\s*<span class="ico">/);
    assert.doesNotMatch(pagine.home, /<a href="\/distributore\/storico" class="attivo">/);

    // le pagine interne hanno sotto la barra la freccia e il loro titolo; la home no. "Clienti" è una scheda del
    // menu, non una pagina interna: ha il suo titolo con la ricerca e nessuna freccia indietro.
    assert.doesNotMatch(pagine.home, /banco-titolo/);
    assert.doesNotMatch(pagine.clienti, /banco-titolo|banco-indietro/);
    assert.match(pagine.clienti, /<h1 class="cli-titolo">Clienti<\/h1>/);
    // lo storico è una scheda dell'intestazione come Clienti: il suo titolo sta nella pagina, senza freccia indietro
    assert.doesNotMatch(pagine.storico, /banco-titolo|banco-indietro/);
    assert.match(pagine.storico, /<h1 class="sto-titolo">Storico ordini<\/h1>/);
    assert.match(pagine.notifiche, /<h1 class="banco-titolo-testo">Notifiche<\/h1>/);
    assert.match(pagine.errore, /<h1 class="banco-titolo-testo">Non trovato<\/h1>/);

    // la tendina: niente "Punti vendita" né in pagina né come indirizzo, e niente più "Storico ordini" (è una scheda del menu, in alto e in basso)
    const t = tendina(pagine.home);
    assert.doesNotMatch(t, /Storico|voce-solo-piccola|Tutti gli ordini/);
    assert.match(t, /class="voce-esci">Esci</);
    for (const nome of Object.keys(pagine)) assert.doesNotMatch(pagine[nome], /Punti vendita|\/punti-vendita/, nome);

    // /punti-vendita: per il banco è come se non esistesse
    r = await chiedi('/punti-vendita');
    assert.equal(r.status, 404);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: elenco clienti con tabella e campo di ricerca, senza freccia indietro', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    const prima = registro.length;
    r = await chiedi('/distributore/clienti');
    assert.equal(r.status, 200);
    const t = await r.text();
    // l'ultimo ordine di ogni cliente arriva con la query dell'elenco: una sola, non una per riga
    assert.equal(registro.slice(prima).filter((q) => /^SELECT cd\.\*, u\.id AS cliente_id/.test(q)).length, 1);

    // testata: scheda Clienti attiva, titolo e campo di ricerca; niente freccia, niente frase lunga sotto la sezione
    assert.match(t, /class="banco-voce attiva" href="\/distributore\/clienti"/);
    assert.doesNotMatch(t, /banco-titolo|banco-indietro|Approva solo le anagrafiche|inviarti richieste e vedere/);
    assert.match(t, /<h1 class="cli-titolo">Clienti<\/h1>/);
    assert.match(t, /<input type="search" data-cerca-clienti placeholder="Cerca per nome, P\. IVA o codice"/);
    assert.match(t, /data-cerca-nessuno role="status" hidden>Nessun cliente trovato\.</);

    // da approvare: pillola col numero, nota corta, scheda con le iniziali, etichetta, dati separati e "Verifica"
    assert.match(t, /id="cli-titolo-approvare">Da approvare<\/h2>\s*<span class="cli-pillola"[^>]*>1<\/span>\s*<span class="cli-sezione-nota">Approva solo chi riconosci come tuo cliente\.</);
    assert.match(t, /<span class="avatar avatar-48 avatar-arancio"[^>]*>AX</);
    assert.match(t, /Agenzia xxx<\/strong>\s*<span class="cli-etichetta cli-etichetta-arancio">Da verificare</);
    assert.match(t, /<span>Ditta individuale<\/span>\s*<span>P\. IVA <strong>00000000000<\/strong><\/span>\s*<span>Genova \(GE\)<\/span>/);
    assert.match(t, /Iscritto il 08\/09\/2026, 19:09</); // ora italiana (la colonna è UTC)
    assert.match(t, /class="cli-verifica" href="\/distributore\/clienti\/31"[^>]*>Verifica <svg/);
    assert.doesNotMatch(t, /stato-badge/);

    // approvati: tabella a cinque colonne, in ordine di ragione sociale (il DB finto li dà alla rinfusa)
    assert.match(t, /id="cli-titolo-approvati">Clienti approvati<\/h2>\s*<span class="cli-conta"[^>]*>2</);
    assert.match(t, /<span>Cliente<\/span><span>Codice cliente<\/span><span>Città<\/span><span>Ultimo ordine<\/span><span><\/span>/);
    const iBianchi = t.indexOf('Bianchi Idraulica S.n.c.');
    const iRossi = t.indexOf('Rossi &lt;b&gt;Impianti&lt;/b&gt; S.r.l.');
    assert.ok(iBianchi > 0 && iBianchi < iRossi, 'ordinati per ragione sociale');
    assert.doesNotMatch(t, /<b>Impianti<\/b>/);
    assert.match(t, /<a class="cli-tab-riga" href="\/distributore\/clienti\/32">[\s\S]*?<span class="avatar avatar-40"[^>]*>RO</);
    assert.match(t, /<span class="cli-c-codice"><span class="cli-solo-stretta">Cod\. <\/span>DEMO-ROSSI<\/span>/);
    assert.match(t, /<span class="cli-c-citta">GENOVA \(GE\)<\/span>/); // la città com'è salvata, senza correggerla
    assert.match(t, /<span class="cli-solo-stretta">Ultimo ordine <\/span>10\/10\/2026<\/span>/);
    // senza codice né ordini: trattino, e su schermo stretto la voce del codice si nasconde
    assert.match(t, /<span class="cli-c-codice cli-c-manca"><span class="cli-solo-stretta">Cod\. <\/span>—<\/span>/);
    assert.match(t, /<span class="cli-solo-stretta">Ultimo ordine <\/span>—<\/span>/);
    // la ricerca confronta ragione sociale, partita IVA e codice cliente
    assert.match(t, /data-cerca="Rossi &lt;b&gt;Impianti&lt;\/b&gt; S\.r\.l\. 12345678901 DEMO-ROSSI"/);

    // non riconosciuti: restano raggiungibili (da lì si può ripensarci)
    assert.match(t, /id="cli-titolo-rifiutati">Non riconosciuti<\/h2>/);
    assert.match(t, /href="\/distributore\/clienti\/34">[\s\S]*?avatar-grigio[\s\S]*?Neri Impianti[\s\S]*?cli-etichetta-rosso">Rifiutato</);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: pagina del cliente a due colonne (da verificare, approvato, rifiutato) e decisione', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  banco.decisioni.length = 0;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    // ----- da verificare -----
    r = await chiedi('/distributore/clienti/31');
    assert.equal(r.status, 200);
    let t = await r.text();
    assert.match(t, /class="banco-voce attiva" href="\/distributore\/clienti"/);
    assert.doesNotMatch(t, /banco-titolo|banco-indietro/);
    assert.match(t, /<a class="cli-indietro" href="\/distributore\/clienti">[\s\S]*?<\/svg>Clienti<\/a>/);
    // testata: cerchio arancio da 56, nome, etichetta e riga "tipo · referente · iscritto il ... alle ..."
    assert.match(t, /<span class="avatar avatar-56 avatar-arancio"[^>]*>AX</);
    assert.match(t, /<h1 class="cli-nome-grande">Agenzia xxx<\/h1>\s*<span class="cli-etichetta cli-etichetta-arancio">Da verificare</);
    assert.match(t, /Ditta individuale · referente Fra · iscritto il 08\/09\/2026 alle 19:09</);
    assert.equal((t.match(/iscritto il/gi) || []).length, 1, 'la data sta solo nella testata');
    // dati di fatturazione in tre colonne, VIES in una nuova scheda, poi sede legale e consegna abituale
    assert.match(t, /Dati di fatturazione<\/h2>\s*<dl class="cli-dati cli-dati-3">/);
    assert.match(t, /Partita IVA<\/dt>\s*<dd class="cli-dato-val cli-cifre">00000000000</);
    assert.match(t, /Codice fiscale<\/dt>\s*<dd class="cli-dato-val cli-cifre">00000000000</);
    assert.match(t, /Codice SDI \/ PEC<\/dt>\s*<dd class="cli-dato-val cli-cifre">N92glon</);
    assert.match(t, /href="https:\/\/ec\.europa\.eu\/taxation_customs\/vies\/[^"]*"\s+target="_blank" rel="noopener">Controlla su VIES/);
    assert.match(t, /Sede legale<\/dt>\s*<dd class="cli-dato-val">Pio 21<\/dd>\s*<dd class="cli-dato-det">16100 Genova \(GE\)<\/dd>/);
    assert.match(t, /Consegna abituale<\/dt>\s*<dd class="cli-dato-val">Via Puggia 22\/3<\/dd>\s*<dd class="cli-dato-det">16131 Genova \(GE\)<\/dd>/);
    // contatti: il telefono è un riquadro che NON si può toccare (richiesta esplicita del 21/10/2026), l'email resta un collegamento
    assert.match(t, /<div class="cli-contatto cli-contatto-fisso">[\s\S]*?Telefono<\/span>\s*<span class="cli-contatto-val cli-cifre">010 123 456</);
    assert.doesNotMatch(t, /href="tel:/);
    assert.match(t, /<meta name="format-detection" content="telephone=no">/);
    assert.match(t, /<a class="cli-contatto" href="mailto:fra@example\.com">[\s\S]*?Email<\/span>\s*<span class="cli-contatto-val">fra@example\.com</);
    // riquadro di approvazione: stessi campi e stessi valori di sempre; la conferma c'è solo sul rifiuto
    assert.match(t, /<h2 id="cli-titolo-decisione">È un tuo cliente\?<\/h2>\s*<p>Se lo approvi potrà mandarti richieste e vedrà le condizioni che imposti\.<\/p>/);
    assert.match(t, /<form method="POST" action="\/distributore\/clienti\/31\/decidi">/);
    assert.match(t, /Codice cliente nel tuo gestionale <span>· facoltativo<\/span>/);
    assert.match(t, /<input class="cli-campo" type="text" id="codice_cliente" name="codice_cliente" placeholder="es\. 004512"/);
    assert.match(t, /Note interne <span>· le vedi solo tu<\/span>/);
    assert.match(t, /<textarea class="cli-campo" id="note" name="note" rows="3"/);
    assert.match(t, /<button class="cli-approva" type="submit" name="azione" value="approva">\s*<svg[\s\S]*?<\/svg>Sì, approva\s*<\/button>/);
    assert.match(t, /<button class="cli-rifiuta" type="submit" name="azione" value="rifiuta"\s+onclick="return confirm\([^"]*"[^>]*>\s*<svg[\s\S]*?<\/svg>Non lo riconosco: rifiuta/);
    assert.equal((t.match(/onclick="return confirm/g) || []).length, 1, 'la conferma è solo sul rifiuto');
    assert.doesNotMatch(t, /\/sconti|Sconti concordati/);
    // il layout nuovo è solo dell'approvato: gli altri stati restano com'erano (decisione a destra, nessuna scheda materiale)
    assert.match(t, /<div class="cli-layout cli-layout-decisione">/);
    assert.doesNotMatch(t, /cli-layout-approvato|cli-indietro-tondo|cli-barra|cli-dati-det|mc-card|Materiale ordinato/);

    // ----- approvato: poche informazioni, le voci vuote non si disegnano -----
    r = await chiedi('/distributore/clienti/32');
    assert.equal(r.status, 200);
    t = await r.text();
    // la barra del cliente (22/10/2026): iniziali da 40 (blu), nome con la pillola "● Approvato", sotto "tipo · cod. cliente · P.IVA" (le voci vuote non si scrivono)
    assert.match(t, /<span class="avatar avatar-40"[^>]*>RO</);
    assert.match(t, /cli-etichetta cli-etichetta-verde">Approvato</);
    assert.match(t, /<p class="cli-barra-sotto">Impresa · cod\. cliente DEMO-ROSSI · P\.IVA 12345678901<\/p>/);
    assert.doesNotMatch(t, /iscritto il|referente|Codice fiscale|Codice SDI|Consegna abituale|Telefono|href="tel:/);
    // niente telefono: nessuna pillola del telefono; l'email c'è, come collegamento
    assert.doesNotMatch(t, /cli-pill-fissa/);
    assert.match(t, /<a class="cli-pill" href="mailto:rossi@example\.com"><span class="cli-pill-ico" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span class="cli-pill-testo">rossi@example\.com<\/span><\/a>/);
    assert.match(t, /Sede legale<\/dt>\s*<dd class="cli-dato-val">Via Roma 1<\/dd>\s*<dd class="cli-dato-det">16121 GENOVA \(GE\)<\/dd>/);
    // la barra sta SOTTO l'intestazione del banco e PRIMA del contenuto, a tutta larghezza: freccia tonda, iniziali, testi; niente colonna dei dati a sinistra
    assert.match(t, /<div class="cli-barra" role="region" aria-label="Cliente">\s*<div class="cli-barra-riga">\s*<a class="cli-indietro-tondo" href="\/distributore\/clienti" aria-label="Torna ai clienti">/);
    assert.ok(t.indexOf('class="banco-testa') < t.indexOf('class="cli-barra"') && t.indexOf('class="cli-barra"') < t.indexOf('<main'), 'intestazione del banco, barra, poi la pagina');
    assert.doesNotMatch(t, /<div class="cli-intesta"|cli-intesta-app|cli-intesta-testi|<div class="cli-colonna">|cli-scheda/, 'né la vecchia testata né la colonna di sinistra');
    assert.doesNotMatch(t, /<a class="cli-indietro"/, 'la riga "← Clienti" c\'è solo per gli altri stati');
    // "Dati cliente ▾": un <details> CHIUSO all'arrivo (senza `open`), il pulsante è il suo <summary>; dentro tutto ciò che stava a sinistra
    assert.match(t, /<details class="cli-dati-det">\s*<summary class="cli-dati-btn">Dati cliente <span class="cli-dati-chev" aria-hidden="true"><svg/);
    assert.doesNotMatch(t, /<details class="cli-dati-det" open/);
    assert.match(t, /Codice cliente<\/dt>\s*<dd class="cli-dato-val cli-cifre">DEMO-ROSSI</);
    assert.match(t, /Note interne<\/dt>\s*<dd class="cli-dato-val cli-dato-note">Paga a 30 giorni</);
    // la data d'iscrizione e quella d'approvazione si leggono nel pannello (sotto il nome non c'è più "iscritto il …")
    assert.match(t, /Iscritto il<\/dt>\s*<dd class="cli-dato-val">08\/09\/2026 alle 19:09<\/dd>/);
    assert.match(t, /Approvato il<\/dt>\s*<dd class="cli-dato-val">09\/09\/2026 alle 10:30<\/dd>/);
    const dove = (testo) => t.indexOf(testo);
    assert.ok(dove('id="cli-fatturazione"') < dove('id="cli-titolo-approvato"') && dove('id="cli-titolo-approvato"') < dove('id="materiale"'), 'dati, "Cliente approvato", poi il materiale');
    assert.match(t, /<div class="cli-colonna cli-colonna-destra cli-colonna-materiale">/);
    assert.match(t, /<main class="cli-pagina cli-pagina-larga">/);
    // gli sconti non stanno più nella pagina (la rotta POST resta, senza modulo)
    assert.doesNotMatch(t, /\/sconti|Sconti concordati|Salva gli sconti|name="sconto\d_|cli-elenco-sconti|barra-azione/);
    assert.doesNotMatch(t, /È un tuo cliente\?|cli-approva|\/decidi/);
    // la scheda "Materiale ordinato" c'è (qui il DB finto dà due ordini senza prezzi: il contenuto è provato nel test dedicato, lo stato vuoto in ordini/materiale.test.js)
    assert.match(t, /<h2 class="mc-titolo" id="mc-titolo">Materiale ordinato<\/h2>/);

    // ----- rifiutato: si può ripensarci con lo stesso POST -----
    r = await chiedi('/distributore/clienti/34');
    assert.equal(r.status, 200);
    t = await r.text();
    assert.match(t, /<span class="avatar avatar-56 avatar-grigio"[^>]*>NI</);
    assert.match(t, /cli-etichetta cli-etichetta-rosso">Rifiutato</);
    assert.match(t, /Hai rifiutato questa anagrafica: Mai visto\./);
    assert.match(t, /<div class="cli-layout cli-layout-decisione">/);
    assert.match(t, /<a class="cli-indietro" href="\/distributore\/clienti">/);
    assert.doesNotMatch(t, /cli-layout-approvato|mc-card|Materiale ordinato/);
    assert.match(t, /action="\/distributore\/clienti\/34\/decidi">\s*<input type="hidden" name="codice_cliente" value="">\s*<button class="cli-approva" type="submit" name="azione" value="approva">/);

    // ----- un cliente che non è del banco: 404 -----
    r = await chiedi('/distributore/clienti/999');
    assert.equal(r.status, 404);

    // ----- la decisione non è cambiata: stessi campi, stessi valori, stesso redirect -----
    r = await chiedi('/distributore/clienti/31/decidi', form({ azione: 'approva', codice_cliente: '004512', note: 'Cliente storico' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/clienti/31');
    r = await chiedi('/distributore/clienti/31/decidi', form({ azione: 'rifiuta', codice_cliente: '', note: '' }));
    assert.equal(r.status, 302);
    assert.deepEqual(banco.decisioni, [
      ['approvato', '004512', 'Cliente storico', 131],
      ['rifiutato', '', '', 131],
    ]);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: cliente approvato con tutti i dati: barra con telefono (non cliccabile) ed email, pannello "Dati cliente" senza perdere niente; gli ordini scorrono con la pagina', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const prima = { ...utentiClienti[32] };
  try {
    await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    Object.assign(utentiClienti[32], { referente: 'Mario Rossi', telefono: '010 123 456', codice_fiscale: 'RSSMRA80A01D969Z', sdi_pec: 'ABC1234', indirizzo_consegna: 'Via Puggia 22/3, 16131 Genova (GE)' });
    const t = await (await chiedi('/distributore/clienti/32')).text();

    // barra: il nome (escapato), la pillola, "tipo · cod. cliente · P.IVA"
    assert.match(t, /<h1 class="cli-nome-grande">Rossi &lt;b&gt;Impianti&lt;\/b&gt; S\.r\.l\.<\/h1>\s*<span class="cli-etichetta cli-etichetta-verde">Approvato<\/span>/);
    assert.match(t, /<p class="cli-barra-sotto">Impresa · cod\. cliente DEMO-ROSSI · P\.IVA 12345678901<\/p>/);
    // a destra le due pillole: il telefono NON è un collegamento (richiesta esplicita del 21/10/2026; l'app non lo trasforma da sola: format-detection), l'email sì; il telefono prima
    assert.match(t, /<span class="cli-pill cli-pill-fissa"><span class="cli-pill-ico" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span class="cli-pill-testo cli-cifre">010 123 456<\/span><\/span>\s*<a class="cli-pill" href="mailto:rossi@example\.com">/);
    assert.doesNotMatch(t, /href="tel:/);
    assert.match(t, /<meta name="format-detection" content="telephone=no">/);

    // il pannello ha TUTTO quello che stava nella colonna di sinistra: fatturazione (con VIES), indirizzi, "Cliente approvato" (codice, referente, date, note)
    const pannello = t.slice(t.indexOf('<div class="cli-pannello">'), t.indexOf('<main'));
    assert.match(pannello, /id="cli-fatturazione">Dati di fatturazione<\/h2>/);
    assert.match(pannello, /Partita IVA<\/dt>\s*<dd class="cli-dato-val cli-cifre">12345678901</);
    assert.match(pannello, /Codice fiscale<\/dt>\s*<dd class="cli-dato-val cli-cifre">RSSMRA80A01D969Z</);
    assert.match(pannello, /Codice SDI \/ PEC<\/dt>\s*<dd class="cli-dato-val cli-cifre">ABC1234</);
    assert.match(pannello, /href="https:\/\/ec\.europa\.eu\/taxation_customs\/vies\/[^"]*"\s+target="_blank" rel="noopener">Controlla su VIES/);
    assert.match(pannello, /Sede legale<\/dt>\s*<dd class="cli-dato-val">Via Roma 1<\/dd>\s*<dd class="cli-dato-det">16121 GENOVA \(GE\)<\/dd>/);
    assert.match(pannello, /Consegna abituale<\/dt>\s*<dd class="cli-dato-val">Via Puggia 22\/3<\/dd>\s*<dd class="cli-dato-det">16131 Genova \(GE\)<\/dd>/);
    assert.match(pannello, /id="cli-titolo-approvato">Cliente approvato<\/h2>/);
    assert.match(pannello, /Codice cliente<\/dt>\s*<dd class="cli-dato-val cli-cifre">DEMO-ROSSI</);
    assert.match(pannello, /Referente<\/dt>\s*<dd class="cli-dato-val">Mario Rossi</);
    assert.match(pannello, /Iscritto il<\/dt>\s*<dd class="cli-dato-val">08\/09\/2026 alle 19:09</);
    assert.match(pannello, /Approvato il<\/dt>\s*<dd class="cli-dato-val">09\/09\/2026 alle 10:30</);
    assert.match(pannello, /Note interne<\/dt>\s*<dd class="cli-dato-val cli-dato-note">Paga a 30 giorni</);
    assert.match(pannello, /<p class="cli-nota">Può inviarti richieste di disponibilità\.<\/p>/);
    // il pannello è dentro il <details> chiuso: senza JS si apre e si chiude da sé
    assert.ok(t.indexOf('<details class="cli-dati-det">') < t.indexOf('<div class="cli-pannello">'));

    // ----- il CSS: scorre la pagina, non la scheda; la testata del materiale è sticky solo da 900px; la barra e il pannello hanno le loro regole -----
    const css = leggiComposto('/style.css').testo;
    const scheda = (css.match(/\n\.mc-card \{([^}]*)\}/) || [])[1];
    assert.ok(scheda, 'la regola .mc-card c\'è');
    assert.doesNotMatch(scheda, /max-height|overflow:\s*(hidden|auto|scroll)|overflow-y/, 'nessuna altezza massima né scorrimento nella scheda');
    assert.match(scheda, /overflow: clip/, 'clip, non hidden: hidden ne farebbe un contenitore di scorrimento e lo sticky non funzionerebbe');
    assert.doesNotMatch(css, /\.mc-card \{ max-height/);
    assert.doesNotMatch(css, /\.mc-elenco\s*\{[^}]*overflow/, 'l\'elenco non scorre più dentro la scheda');
    assert.match(css, /@media \(min-width: 900px\) \{\s*\.mc-fisso \{ position: sticky; top: 64px;/);
    assert.doesNotMatch(css.slice(css.indexOf('@media (max-width: 899.98px) {\n  .mc-seg'), css.indexOf('Telefono stretto: i mesi')), /sticky/, 'sotto i 900px la testata non è sticky');
    assert.doesNotMatch(css, /\.mc-box|\.mc-riepilogo|\.mc-fondo|\.cli-intesta-app/);
    // l'ombra "staccata" la mette lo script, solo sulla testata
    const js = leggiComposto('/app.js').testo;
    assert.match(js, /document\.querySelector\('\[data-mc-fisso\]'\)/);
    assert.match(js, /classList\.toggle\('staccato'/);
    assert.match(css, /\.mc-fisso\.staccato \{ box-shadow:/);
  } finally {
    for (const k of Object.keys(utentiClienti[32])) delete utentiClienti[32][k];
    Object.assign(utentiClienti[32], prima);
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
