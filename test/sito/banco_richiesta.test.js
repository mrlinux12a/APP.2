// Banco: richiesta da confermare, in attesa del corriere, "Preparato".
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38480);
const {
  banco, biscotti, chiedi, erroriServer, fa, form, oraRoma, preparaRichiesta, richiestaProva, scrittureOrdini,
} = aiuti;

test('banco: richiesta da confermare, a due colonne con timer, pulsanti, cliente e passi', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    const scadenza = new Date(Date.now() + 241 * 1000);
    preparaRichiesta({ secondi: 241 });
    const r = await chiedi('/distributore/richieste/177');
    assert.equal(r.status, 200);
    const t = await r.text();

    // intestazione del banco (con "Banco" accesa), titolo con freccia, stato e quando è arrivata; niente appbar vecchia né riga titolo
    assert.match(t, /<header class="banco-testa"[^>]*>/);
    assert.match(t, /class="banco-voce attiva" href="\/distributore" aria-current="page"/);
    assert.doesNotMatch(t, /<header class="appbar">|banco-titolo/);
    assert.match(t, /<a class="ric-indietro" href="\/distributore"[^>]*>\s*<svg/);
    assert.match(t, /<h1 class="ric-titolo">Richiesta #177<\/h1>\s*<span class="ric-stato ric-st-da_confermare"><span class="ric-punto" aria-hidden="true"><\/span>Da confermare<\/span>/);
    assert.match(t, /<span class="ric-ricevuta">Ricevuta oggi alle \d\d:\d\d<\/span>/);

    // timer: 04:01, orario limite, non ancora rosso; il timer è sulla pagina (lo muove app.js)
    assert.match(t, /<div class="ric-timer" data-ric-timer\s+data-secondi="241" data-finestra="600" data-soglia-urgente="120">/);
    assert.match(t, /data-tempo role="timer"[^>]*>04:01<\/span>/);
    assert.match(t, new RegExp('<h2 class="ric-timer-titolo">Rispondi entro le ' + oraRoma(scadenza).replace(':', ':') + '</h2>'));
    assert.match(t, /Poi la richiesta scade e il cliente non la vede più\./);

    // pulsanti: Conferma (azione prezzo_richiesto) e Non disponibile (rifiuta, neutro, non rosso)
    assert.match(t, /<form class="ric-pulsanti" method="POST" action="\/distributore\/richieste\/177\/rispondi">/);
    assert.match(t, /<button class="ric-btn ric-btn-conferma" type="submit" name="azione" value="prezzo_richiesto"><svg[\s\S]*?<\/svg>Conferma: è disponibile<\/button>/);
    assert.match(t, /<button class="ric-btn ric-btn-neutro" type="submit" name="azione" value="rifiuta">Non disponibile<\/button>/);
    assert.doesNotMatch(t, /btn-rosso|Accetta ordine|Rifiuta: merce non disponibile/);

    // materiale: una tabella con quantità, articolo e codice, listino, prezzo cliente, totale; sotto il totale per il cliente
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale richiesto<\/h2>\s*<span class="ric-conta">1 articolo · 1 pezzo<\/span>/);
    assert.match(t, /<span>Q\.tà<\/span><span>Articolo<\/span><span class="ric-num">Listino<\/span><span class="ric-num">Prezzo cliente<\/span><span class="ric-num">Totale<\/span>/);
    assert.match(t, /<span class="ric-qta">1×<\/span>\s*<span class="ric-articolo">\s*<strong class="ric-nome">87 Elemento A &#34;t&#34; 87gr Diam\. 100<\/strong>\s*<small class="ric-cod">Cod\. 12364959<\/small>/);
    assert.match(t, /ric-listino">€ 102,30</);
    assert.match(t, /<strong>€ 102,30<\/strong><small>cad\. \+ IVA<\/small>/);
    assert.match(t, /ric-num ric-tot">€ 102,30</);
    assert.match(t, /<span class="ric-totale-label">Totale per il cliente<\/span>\s*<strong class="ric-totale-cifra">€ 102,30<\/strong>\s*<small class="ric-iva">\+ IVA<\/small>/);

    // cliente: sempre in vista, con indirizzo, telefono e link alla scheda; non più nascosto in "Cliente ordinante"
    assert.doesNotMatch(t, /Cliente ordinante|<details/);
    assert.match(t, /<h2 class="ric-occhiello" id="ric-cliente-titolo">Cliente<\/h2>/);
    assert.match(t, /<strong>Prova S\.r\.l\.<\/strong>\s*<small>P\. IVA 01234567890<\/small>/);
    assert.match(t, /<span>Via Puggia 22\/3, 16131 Genova \(GE\)<\/span>/);
    assert.match(t, /<span>010 123 456<\/span>/); // il telefono è solo testo, non un collegamento tel: (richiesta esplicita del 21/10/2026)
    assert.doesNotMatch(t, /href="tel:/);
    assert.match(t, /<meta name="format-detection" content="telephone=no">/);
    assert.match(t, /<a class="ric-apri-cliente" href="\/distributore\/clienti\/1">Apri scheda cliente/);

    // "Elimina dal banco": un link di testo in fondo, dopo il cliente, con la sua conferma
    assert.ok(t.indexOf('ric-elimina-riga') > t.indexOf('ric-cliente'), 'in fondo');
    assert.match(t, /<form class="ric-elimina-riga" method="POST" action="\/distributore\/richieste\/177\/elimina" onsubmit="return confirm\([^"]*\)">\s*<button class="ric-elimina" type="submit"><svg[\s\S]*?<\/svg>Elimina dal banco<\/button>/);

    // i passi dopo la conferma: col modulo WhatsApp spento sono due (non ci sono corrieri da avvisare)
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Cosa succede dopo la conferma<\/h2>/);
    assert.deepEqual([...t.matchAll(/<li class="ric-passo ric-passo-(\w+)( corrente)?"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>/g)].map((m) => [m[1], !!m[2], m[3]]),
      [['arancio', true, 'Confermi la disponibilità'], ['verde', false, 'Prepari il materiale']]);
    assert.doesNotMatch(t, /Avvisiamo i corrieri/);

    // col modulo acceso: tre passi, e quello da non anticipare ("non preparare ancora") c'è
    process.env.WHATSAPP_ATTIVO = '1';
    try {
      const t3 = await (await chiedi('/distributore/richieste/177')).text();
      assert.deepEqual([...t3.matchAll(/<li class="ric-passo ric-passo-(\w+)( corrente)?"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>/g)].map((m) => [m[1], !!m[2], m[3]]),
        [['arancio', true, 'Confermi la disponibilità'], ['viola', false, 'Avvisiamo i corrieri'], ['verde', false, 'Prepari il materiale']]);
      assert.match(t3, /Non preparare ancora: aspetta che un corriere accetti la consegna\./);
      assert.match(t3, /L.ordine compare in Da preparare con l.ora di ritiro\./);
    } finally {
      delete process.env.WHATSAPP_ATTIVO;
    }

    // senza legame col cliente (non ha indicato questo banco) la scheda non si apre: niente link morto
    preparaRichiesta({ secondi: 241, legame: false });
    assert.doesNotMatch(await (await chiedi('/distributore/richieste/177')).text(), /ric-apri-cliente/);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta da confermare, il timer diventa rosso negli ultimi 2 minuti', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    for (const [secondi, rosso] of [[400, false], [121, false], [120, true], [45, true], [1, true]]) {
      preparaRichiesta({ secondi });
      const t = await (await chiedi('/distributore/richieste/177')).text();
      assert.match(t, new RegExp('<div class="ric-timer' + (rosso ? ' urgente' : '') + '" data-ric-timer'), secondi + ' s');
      assert.match(t, new RegExp('data-secondi="' + secondi + '"'));
    }
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta dopo la risposta (attesa corriere, confermata, nessun corriere) e chiusa senza ordine', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const stati = (t) => t.match(/<span class="ric-stato ric-st-(\w+)">[\s\S]*?<\/span>([^<]*)<\/span>/).slice(1, 3);
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // confermata, nel gruppo WhatsApp nessun corriere ha ancora risposto: scheda viola, niente timer né pulsanti, passo "corrieri" in corso
    process.env.WHATSAPP_ATTIVO = '1';
    try {
      preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa' });
      let t = await (await chiedi('/distributore/richieste/177')).text();
      assert.deepEqual(stati(t), ['attesa_corriere', 'Attesa corriere']);
      assert.match(t, /<section class="ric-scheda ric-azione ric-attesa" data-ric-attesa data-trascorsi="253"/);
      assert.doesNotMatch(t, /data-ric-timer|ric-pulsanti|Conferma: è disponibile|ric-esito-viola/);
      assert.match(t, /ric-elimina-riga/); // "Elimina dal banco" resta in fondo
    } finally {
      delete process.env.WHATSAPP_ATTIVO;
    }

    // consegna presa dal corriere e ordine di questo banco: scheda verde con il link all'ordine
    preparaRichiesta({
      secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', extra: { corriere_nome: 'Marco', corriere_minuti: 25 },
      ordine: { id: 5, distributor_id: 2, cliente_id: 1, stato: 'in_evasione', creato_il: fa(60000), consegnato_il: null },
    });
    let t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['confermata', 'Confermata']);
    assert.match(t, /ric-esito-verde[\s\S]*?Consegna presa da Marco: arriva da te in <strong>25 minuti<\/strong>\./);
    // l'ordine è già "In consegna" (Preparato): la sua pagina non c'è più, quindi niente "Gestisci l'ordine"
    assert.doesNotMatch(t, /Gestisci l'ordine|\/distributore\/ordini\//);
    assert.doesNotMatch(t, /Cosa succede dopo la conferma/); // a ordine fatto i passi non servono più

    // l'ordine l'ha preso un altro banco: chiusa
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['chiusa', 'Chiusa']);
    assert.match(t, /ric-esito-grigio[\s\S]*?Il cliente ha già chiuso l'ordine con un altro distributore\./);

    // nessun corriere ha preso la consegna in tempo
    preparaRichiesta({ secondi: 0, stato: 'nessuna_offerta', esito: 'confermato', corriere: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['senza_corriere', 'Nessun corriere']);
    assert.match(t, /ric-esito-rosso[\s\S]*?è come se non avessi accettato/);

    // rifiutata dal banco, scaduta senza risposta, annullata dal cliente: scheda neutra col perché
    preparaRichiesta({ secondi: 300, esito: 'non_disponibile' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['non_disponibile', 'Non disponibile']);
    assert.match(t, /Hai rifiutato la richiesta per indisponibilità della merce\./);
    assert.match(t, /<span class="ric-qta">1×<\/span>/); // il materiale richiesto si vede lo stesso
    preparaRichiesta({ secondi: 0, stato: 'nessuna_offerta', esito: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['scaduta', 'Scaduta']);
    assert.match(t, /Nessuna risposta entro i 10 minuti/);
    preparaRichiesta({ secondi: 0, stato: 'annullata', esito: 'in_attesa' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['annullata', 'Annullata']);
    assert.match(t, /Il cliente ha annullato la richiesta prima della tua risposta\./);

    // una richiesta che non è di questo banco
    richiestaProva.risposta = null;
    assert.equal((await chiedi('/distributore/richieste/177')).status, 404);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta in attesa del corriere, con ora di conferma, Avanzamento e tempo che sale', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  // l'ora italiana di una colonna senza fuso (come la leggerebbe pg): lo stesso istante che la pagina deve mostrare
  const oraDi = (naiveDate) => oraRoma(new Date(Date.UTC(naiveDate.getFullYear(), naiveDate.getMonth(), naiveDate.getDate(), naiveDate.getHours(), naiveDate.getMinutes(), naiveDate.getSeconds())));
  const fasi = (t) => [...t.matchAll(/<li class="ric-passo ric-passo-\w+ ric-fase-(\w+)"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>\s*<span>([^<]*)<\/span>/g)]
    .map((m) => [m[1], m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), m[3]]);
  process.env.WHATSAPP_ATTIVO = '1';
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // confermata da 4 min e 13 s, nel gruppo nessun corriere ha ancora risposto
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 253 });
    const confermataAlle = oraDi(richiestaProva.risposta.risposto_il);
    let t = await (await chiedi('/distributore/richieste/177')).text();

    // testata: stato viola con il pallino che pulsa, e a destra quando è arrivata e quando hai confermato
    assert.match(t, /<span class="ric-stato ric-st-attesa_corriere"><span class="ric-punto pulse" aria-hidden="true"><\/span>Attesa corriere<\/span>/);
    assert.match(t, new RegExp('<span class="ric-ricevuta">Ricevuta oggi alle \\d\\d:\\d\\d · confermata alle ' + confermataAlle + '</span>'));
    // la scheda del materiale: "Materiale confermato", tabella e totale come prima
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale confermato<\/h2>/);
    assert.match(t, /<strong class="ric-totale-cifra">€ 102,30<\/strong>/);

    // Avanzamento (al posto di "Cosa succede dopo la conferma"): fatto, in corso, da fare
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Avanzamento<\/h2>/);
    assert.doesNotMatch(t, /Cosa succede dopo la conferma/);
    assert.deepEqual(fasi(t), [
      ['fatto', 'Disponibilità confermata', 'Fatto alle ' + confermataAlle],
      ['corrente', 'Corriere avvisato · da 4 min', 'Aspettiamo che un corriere accetti la consegna.'],
      ['futuro', 'Da preparare', 'Quando un corriere accetta, l\u2019ordine passa in Da preparare con l\u2019ora di ritiro.'],
    ]);
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-fatto">\s*<span class="ric-passo-punto" aria-hidden="true"><svg/); // la spunta
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-corrente" aria-current="step">\s*<span class="ric-passo-punto" aria-hidden="true"><\/span>/);
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-futuro">\s*<span class="ric-passo-punto" aria-hidden="true"><\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>4 min<\/span>/); // lo tiene aggiornato app.js

    // scheda d'azione: cerchio col tempo che sale (data-trascorsi), titolo, testo e riquadro grigio; niente timer né pulsanti
    assert.match(t, /<section class="ric-scheda ric-azione ric-attesa" data-ric-attesa data-trascorsi="253" aria-label="In attesa di un corriere">/);
    assert.match(t, /<span class="ric-attesa-tempo" data-trascorso>04:13<\/span>\s*<span class="ric-attesa-sotto">in attesa<\/span>/);
    assert.match(t, /<h2 class="ric-attesa-titolo">Corriere avvisato<\/h2>\s*<p>Non preparare ancora: ti avvisiamo appena un corriere accetta\.<\/p>/);
    assert.match(t, /<p class="ric-attesa-nota">Il cliente vede la tua conferma quando un corriere prende la consegna\.<\/p>/);
    assert.doesNotMatch(t, /data-ric-timer|ric-pulsanti|ric-esito-viola|Ordine collegato|ric-attesa-parziale/);
    // cliente ed "Elimina dal banco" come prima
    assert.match(t, /<h2 class="ric-occhiello" id="ric-cliente-titolo">Cliente<\/h2>/);
    assert.match(t, /<button class="ric-elimina" type="submit">/);

    // oltre l'ora: "1 h 05" nel cerchio e nel passo; subito dopo la conferma "meno di 1 min"
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 3905 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /data-trascorsi="3905"/);
    assert.match(t, /data-trascorso>1 h 05<\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>1 h 05<\/span>/);
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 20 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /data-trascorso>00:20<\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>meno di 1 min<\/span>/);

    // copertura parziale: la nota resta sotto il riquadro
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', extra: { copertura: 'parziale' } });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /<p class="ric-attesa-parziale">Hai confermato <strong>solo una parte<\/strong> del materiale\.<\/p>/);
    assert.ok(t.indexOf('ric-attesa-nota') < t.indexOf('ric-attesa-parziale'), 'ordine delle righe');

    // "Da confermare" non cambia: niente "confermata alle", pallino fermo, "Materiale richiesto" e i passi di prima
    preparaRichiesta({ secondi: 241 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.doesNotMatch(t, /confermata alle|ric-punto pulse|Avanzamento|data-ric-attesa/);
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale richiesto<\/h2>/);
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Cosa succede dopo la conferma<\/h2>/);
    assert.match(t, /<li class="ric-passo ric-passo-arancio corrente" aria-current="step">/);

    // senza il modulo WhatsApp non c'è il passo dei corrieri: i passi sono due
    delete process.env.WHATSAPP_ATTIVO;
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 253 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.equal((t.match(/<li class="ric-passo /g) || []).length, 2);
    assert.deepEqual(fasi(t).map((f) => f[0]), ['fatto', 'corrente']);
    assert.equal(fasi(t)[1][1], 'Da preparare');
    assert.doesNotMatch(t, /<span data-da>/);
  } finally {
    delete process.env.WHATSAPP_ATTIVO;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: "Preparato" toglie l\'ordine dalla colonna (in preparazione, torna alla home) e non tocca quelli già presi o di un altro banco', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // l'ordine è 'inviato': passa in preparazione (esce da "Da preparare") e si torna alla home
    scrittureOrdini.length = 0;
    let r = await chiedi('/distributore/ordini/1280/preparazione', form({ torna: 'home' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore');
    assert.equal(scrittureOrdini.length, 1);
    assert.deepEqual(scrittureOrdini[0].p, [1280]);

    // già in preparazione: niente da scrivere, e si torna comunque alla home
    scrittureOrdini.length = 0;
    r = await chiedi('/distributore/ordini/1285/preparazione', form({ torna: 'home' }));
    assert.equal(r.headers.get('location'), '/distributore');
    assert.equal(scrittureOrdini.length, 0);

    // l'ordine di un altro banco (o inesistente) non si tocca: ripiego sullo Storico
    for (const id of [1290, 1999]) {
      r = await chiedi('/distributore/ordini/' + id + '/preparazione', form({ torna: 'home' }));
      assert.equal(r.status, 302, String(id));
      assert.equal(r.headers.get('location'), '/distributore/storico', String(id));
    }
    assert.equal(scrittureOrdini.length, 0);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
