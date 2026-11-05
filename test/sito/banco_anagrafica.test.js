// Banco: Anagrafica, orari e cambio password.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38484);
const {
  anagraficaProva, banco, bcrypt, biscotti, chiedi, erroriServer, form, json, scrittureAnagrafica,
} = aiuti;

// ---------- Anagrafica del banco (richiesta esplicita del 20/10/2026) ----------

test('banco: "Anagrafica del banco": schede a sinistra e a destra, dati in lettura, cerchio con l\'anello pieno, nessuna scheda del menu accesa', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    const r = await chiedi('/distributore/anagrafica');
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /<title>Anagrafica del banco<\/title>/);
    // testata: cerchio da 56px con le iniziali della filiale, titolo e "ditta · filiale"
    assert.match(t, /<span class="avatar avatar-56" aria-hidden="true">BG<\/span>/);
    assert.match(t, /<h1 class="ab-h1">Anagrafica del banco<\/h1>\s*<p class="ab-sotto">BOREA SRL · Banco Genova Fegino<\/p>/);
    // intestazione unica: il cerchio ha la classe "attivo" (anello blu pieno), nessuna scheda del menu è accesa, la tendina ha la voce in cima
    assert.match(t, /<button class="banco-avatar-btn attivo"/);
    assert.doesNotMatch(t, /class="banco-voce attiva"/);
    assert.match(t, /<a class="voce-anagrafica" href="\/distributore\/anagrafica" aria-current="page">Anagrafica del banco<\/a>/);
    // nessun aggiornamento automatico (si ricaricherebbe mentre si scrive in un modulo)
    assert.doesNotMatch(t, /data-auto-refresh/);

    // le cinque schede nell'ordine: Ditta, Questa filiale, Orari | Accesso, Notifiche, e "Esci"
    const ordine = ['id="ditta"', 'id="filiale"', 'id="orari"', 'id="accesso"', 'id="notifiche"', 'class="ab-esci"'].map((x) => t.indexOf(x));
    assert.ok(ordine.every((n, i) => n > 0 && (i === 0 || n > ordine[i - 1])), 'ordine delle schede: ' + ordine);
    assert.match(t, /<h2 class="ab-titolo">Ditta<\/h2>\s*<p class="ab-spiega">Valgono per tutte le filiali e finiscono nelle fatture del materiale\.<\/p>/);
    assert.match(t, /<p class="ab-spiega">È il banco che riceve le richieste e da cui parte il materiale\.<\/p>/);
    assert.match(t, /<p class="ab-spiega">Fuori orario le richieste non arrivano\.<\/p>/);
    assert.match(t, /<p class="ab-spiega">Il profilo del banco: uno solo, con tutti i permessi\.<\/p>/);
    assert.match(t, /<p class="ab-spiega">Valgono solo per te, su questo computer\.<\/p>/);
    // Ditta in lettura: i dati della tabella ditte, vuoti con "—"
    assert.match(t, /<dt>Ragione sociale<\/dt><dd>BOREA SRL<\/dd>/);
    assert.match(t, /<dt>Partita IVA<\/dt><dd>—<\/dd>/);
    assert.match(t, /<dt>Codice SDI \/ PEC<\/dt><dd>—<\/dd>/);
    assert.match(t, /<dt>Sede legale<\/dt><dd>—<\/dd>/);
    // Questa filiale: nome, telefono, indirizzo di ritiro, email e zona; la posizione c'è: riga verde in SOLA LETTURA (è fissa: niente "Sposta", niente mappa)
    assert.match(t, /<dt>Nome del banco<\/dt><dd>Banco Genova Fegino<\/dd>/);
    assert.match(t, /<dt>Telefono del banco<\/dt><dd>010 123456<\/dd>/);
    assert.match(t, /<dt>Indirizzo di ritiro \(dove passa il corriere\)<\/dt><dd>Via Castel Morrone 1\/7 rosso, 16161 Genova \(GE\)<\/dd>/);
    assert.match(t, /<dt>Email per gli avvisi<\/dt><dd>fegino@borea\.example<\/dd>/);
    assert.match(t, /<dt>Zona servita<\/dt><dd>Genova e provincia<\/dd>/);
    assert.match(t, /<div class="ab-posizione ab-posizione-ok">[\s\S]*?<strong>Posizione sulla mappa impostata\.<\/strong> Serve ai corrieri e per calcolare le distanze\.<\/span>\s*<\/div>/);
    assert.doesNotMatch(t, /data-sposta|data-mappa-sposta|data-mappa-dialog|mappa\.js|Sposta/);
    // Orari: senza orari impostati NON esiste "sempre aperto" (22/10/2026): avviso e scheda già aperta in modifica, con la proposta da salvare
    assert.doesNotMatch(t, /Sempre aperto/);
    assert.match(t, /<p class="ab-avviso" role="alert"><strong>Orari non impostati\.<\/strong> Finché non li salvi questa filiale non riceve richieste\./);
    assert.match(t, /<section class="ab-card" id="orari" data-scheda="orari" data-aperta>/);
    assert.match(t, /name="da1_lun" value="07:30"/, 'il modulo parte dalla proposta');
    // Accesso: email dell'utente e password nascosta, e il pulsante "Cambia password"
    assert.match(t, /<dt>Email di accesso<\/dt><dd>banco\.fegino@borea\.example<\/dd>/);
    assert.match(t, /<dd class="ab-punti" aria-label="Password nascosta">••••••••••<\/dd>/);
    assert.match(t, /data-modifica>Cambia password<\/a>/);
    // Notifiche: suoni e notifiche del computer (interruttori), NON l'email finché non esiste l'invio
    assert.match(t, /<button type="button" class="ab-switch" role="switch" aria-checked="true" aria-label="Suoni" data-suoni-voce>/);
    assert.match(t, /aria-label="Notifiche del computer" data-notifiche-sistema>/);
    assert.doesNotMatch(t, /data-email-richieste|Email per ogni nuova richiesta/);
    // "Esci": lo stesso modulo della tendina
    assert.match(t, /<form class="ab-esci-form" method="POST" action="\/logout">\s*<button type="submit" class="ab-esci"><span class="ab-esci-ico" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>Esci dal banco<\/button>/);
    // moduli: ogni scheda ha il suo POST, tutti nascosti finché non si preme "Modifica"
    for (const azione of ['ditta', 'filiale', 'password']) {
      assert.match(t, new RegExp('<form class="ab-modulo[^"]*" method="POST" action="/distributore/anagrafica/' + azione + '"[^>]* hidden>'), azione);
    }
    // (quello degli orari è già aperto: questa filiale non ha orari impostati)
    assert.doesNotMatch(t, /<form class="ab-modulo[^"]*" method="POST" action="\/distributore\/anagrafica\/orari"[^>]* hidden>/);
    // senza orari impostati si apre da sola solo la scheda Orari: le altre restano chiuse
    assert.doesNotMatch(t, /data-scheda="(ditta|filiale|accesso|notifiche)" data-aperta/);
    // ?modifica=filiale apre quella scheda già col modulo (anche senza JavaScript)
    const aperta = await (await chiedi('/distributore/anagrafica?modifica=filiale')).text();
    assert.match(aperta, /<section class="ab-card" id="filiale" data-scheda="filiale" data-aperta>/);
    assert.match(aperta, /<form class="ab-modulo" method="POST" action="\/distributore\/anagrafica\/filiale" data-modulo novalidate>/);
    // un valore sconosciuto non apre niente (a parte la scheda Orari, che senza orari impostati è aperta da sola)
    assert.doesNotMatch(await (await chiedi('/distributore/anagrafica?modifica=boh')).text(), /data-scheda="(ditta|filiale|accesso|notifiche)" data-aperta/);
  } finally {
    banco.attivo = false;
  }
});

test('banco: anagrafica, la posizione manca: riga arancio senza pulsanti; il cliente e chi non ha fatto l\'accesso non entrano', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const senza = { geo_lat: anagraficaProva.filiale.geo_lat, geo_lng: anagraficaProva.filiale.geo_lng };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    anagraficaProva.filiale.geo_lat = null;
    anagraficaProva.filiale.geo_lng = null;
    const t = await (await chiedi('/distributore/anagrafica')).text();
    assert.match(t, /<div class="ab-posizione ab-posizione-manca">[\s\S]*?<strong>Posizione non impostata:<\/strong> i corrieri non vedono dove ritirare\.<\/span>\s*<\/div>/);
    assert.doesNotMatch(t, /data-sposta|Imposta<\/button>/);
  } finally {
    Object.assign(anagraficaProva.filiale, senza);
    banco.attivo = false;
  }
  // un cliente non vede la pagina (e non può salvare niente)
  biscotti.cookie = '';
  assert.equal((await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }))).status, 302);
  assert.equal((await chiedi('/distributore/anagrafica')).status, 403);
  assert.equal((await chiedi('/distributore/anagrafica/ditta', form({ ragione_sociale: 'X' }))).status, 403);
  biscotti.cookie = '';
  assert.equal((await chiedi('/distributore/anagrafica')).status, 302, 'senza accesso: al login');
});

test('banco: anagrafica, "Ditta" e "Questa filiale" salvano e tornano in lettura; gli errori restano sotto i campi, senza scrivere niente', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const geoModulo = require('../../src/logica/ordini/geo');
  const geocodificaOriginale = geoModulo.geocodifica;
  const ricerche = [];
  const originale = { ...anagraficaProva.filiale };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    scrittureAnagrafica.length = 0;
    const messaggi = (t) => [...t.matchAll(/<p class="ab-errore" id="[^"]+-err" role="alert">([^<]*)<\/p>/g)].map((m) => m[1]);

    // ---- Ditta: P. IVA, SDI/PEC, CAP e provincia sbagliati -> 400, scheda aperta, valori scritti e messaggi sotto i campi
    let r = await chiedi('/distributore/anagrafica/ditta', form({ ragione_sociale: '', partita_iva: '123', sdi_pec: 'xx', indirizzo: 'Via Roma 1', cap: '1616', citta: 'Genova', provincia: 'G' }));
    assert.equal(r.status, 400);
    let t = await r.text();
    assert.deepEqual(messaggi(t), ['Scrivi la ragione sociale.', 'La partita IVA ha 11 cifre.', 'Scrivi il codice SDI (7 caratteri) oppure un indirizzo PEC valido.', 'Il CAP ha 5 cifre.', 'La provincia si scrive con 2 lettere (per esempio GE).']);
    assert.match(t, /<section class="ab-card" id="ditta" data-scheda="ditta" data-aperta>/);
    assert.match(t, /id="ab-ditta-partita_iva" name="partita_iva" type="text" value="123"[^>]*aria-invalid="true" aria-describedby="ab-ditta-partita_iva-err">/);
    assert.match(t, /id="ab-ditta-indirizzo" name="indirizzo" type="text" value="Via Roma 1"/, 'quello che era giusto resta scritto');
    assert.equal(scrittureAnagrafica.length, 0, 'con errori non si scrive niente');
    assert.match(t, /<button class="banco-avatar-btn attivo"/, 'anche con gli errori (indirizzo del modulo) è la stessa pagina: anello pieno');

    // ---- Ditta giusta: P. IVA, SDI in maiuscolo, provincia in maiuscolo -> torna alla pagina con "salvato"
    r = await chiedi('/distributore/anagrafica/ditta', form({ ragione_sociale: 'BOREA SRL', partita_iva: '12345678901', sdi_pec: 'abcdefg', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'ge' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/anagrafica?ok=ditta#ditta');
    assert.equal(scrittureAnagrafica.length, 1);
    assert.match(scrittureAnagrafica[0].s, /^UPDATE ditte SET ragione_sociale = \?, partita_iva = \?, sdi_pec = \?, indirizzo = \?, cap = \?, citta = \?, provincia = \? WHERE id = \?/);
    assert.deepEqual(scrittureAnagrafica[0].p, ['BOREA SRL', '12345678901', 'ABCDEFG', 'Via Roma 1', '16121', 'Genova', 'GE', 6]);
    t = await (await chiedi('/distributore/anagrafica?ok=ditta')).text();
    assert.match(t, /<p class="ab-ok" role="status">Dati della ditta salvati\.<\/p>/);
    // una PEC al posto del codice SDI va bene
    scrittureAnagrafica.length = 0;
    r = await chiedi('/distributore/anagrafica/ditta', form({ ragione_sociale: 'BOREA SRL', partita_iva: '', sdi_pec: 'borea@pec.it' }));
    assert.equal(r.status, 302);
    assert.equal(scrittureAnagrafica[0].p[2], 'borea@pec.it');

    // ---- Questa filiale: errori
    scrittureAnagrafica.length = 0;
    r = await chiedi('/distributore/anagrafica/filiale', form({ filiale: '', telefono: 'abc', email: 'nope', zona: '', indirizzo: '', cap: '12', citta: 'Genova', provincia: 'GE' }));
    assert.equal(r.status, 400);
    t = await r.text();
    assert.deepEqual(messaggi(t), ['Scrivi il nome del banco.', 'Il telefono può avere solo cifre, spazi e + ( ) - /.', 'Scrivi la via e il numero civico.', 'Il CAP ha 5 cifre.', 'Scrivi un indirizzo email valido.', 'Scrivi la zona servita.']);
    assert.match(t, /<section class="ab-card" id="filiale" data-scheda="filiale" data-aperta>/);
    assert.equal(scrittureAnagrafica.length, 0);

    // ---- LA POSIZIONE DI BOREA È FISSA (la solita, nel DB): né con l'indirizzo uguale né con uno cambiato si ricalcola o si scrive, e la geocodifica non parte
    geoModulo.geocodifica = async (dati) => { ricerche.push(dati); return { lat: 44.405, lng: 8.941, descrizione: 'Via XX Settembre, Genova' }; };
    const uguale = { filiale: 'Banco Genova Fegino', telefono: '010 999999', email: 'fegino@borea.example', zona: 'Genova e provincia', indirizzo: 'Via Castel Morrone 1/7 rosso', cap: '16161', citta: 'Genova', provincia: 'GE' };
    r = await chiedi('/distributore/anagrafica/filiale', form(uguale));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/anagrafica?ok=filiale#filiale');
    assert.deepEqual(scrittureAnagrafica.map((w) => w.s.split(' SET ')[0]), ['UPDATE distributors', 'UPDATE store_locations'], 'la filiale e il suo punto vendita insieme');
    assert.deepEqual(scrittureAnagrafica[0].p, ['Banco Genova Fegino', '010 999999', 'fegino@borea.example', 'Genova e provincia', 'Via Castel Morrone 1/7 rosso', '16161', 'Genova', 'GE', 2]);

    scrittureAnagrafica.length = 0;
    r = await chiedi('/distributore/anagrafica/filiale', form({ ...uguale, indirizzo: 'Via XX Settembre 10', cap: '16121' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/anagrafica?ok=filiale#filiale');
    assert.equal(ricerche.length, 0, 'indirizzo cambiato: nessuna geocodifica');
    assert.deepEqual(scrittureAnagrafica.map((w) => w.s.split(' SET ')[0]), ['UPDATE distributors', 'UPDATE store_locations']);
    assert.equal(scrittureAnagrafica.filter((w) => /geo_lat|geo_lng|geo_manuale|geocodifica/.test(w.s)).length, 0, 'la posizione non si tocca');
    assert.equal(scrittureAnagrafica[0].p[4], 'Via XX Settembre 10', 'l\'indirizzo di ritiro sì');
    t = await (await chiedi('/distributore/anagrafica?ok=filiale')).text();
    assert.match(t, /Dati della filiale salvati\./);
    assert.doesNotMatch(t, /Posizione sulla mappa aggiornata|Sposta|resta quella che hai scelto tu/);
    assert.match(t, /Cambiare l'indirizzo non sposta il punto sulla mappa: la posizione del banco è fissa\./);
  } finally {
    geoModulo.geocodifica = geocodificaOriginale;
    Object.assign(anagraficaProva.filiale, originale);
    banco.attivo = false;
  }
});

test('banco: anagrafica, la posizione è FISSA: nessuna rotta la sposta; l\'interruttore dell\'email salva subito', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    scrittureAnagrafica.length = 0;
    // la rotta "Sposta" non esiste più: né con coordinate giuste né con altro, e non si scrive niente
    for (const corpo of [{ lat: 44.4056, lng: 8.9463 }, { lat: 0, lng: 0 }, {}]) {
      const sposta = await chiedi('/distributore/anagrafica/posizione', json(corpo));
      assert.equal(sposta.status, 404, JSON.stringify(corpo));
    }
    assert.equal(scrittureAnagrafica.length, 0, 'la posizione del banco non si tocca');
    // l'interruttore dell'email salva subito (la riga non si vede ancora, ma la rotta c'è)
    const r = await chiedi('/distributore/anagrafica/email-richieste', json({ acceso: true }));
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(scrittureAnagrafica[0].p, [1, 2]);
  } finally {
    banco.attivo = false;
  }
});

test('banco: anagrafica, orari: salva le fasce, raggruppa i giorni uguali e segnala gli errori giorno per giorno', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  const originale = anagraficaProva.filiale.orari;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    scrittureAnagrafica.length = 0;
    const feriali = {};
    for (const g of ['lun', 'mar', 'mer', 'gio', 'ven']) Object.assign(feriali, { ['aperto_' + g]: '1', ['da1_' + g]: '07:30', ['a1_' + g]: '12:30', ['da2_' + g]: '14:00', ['a2_' + g]: '18:00' });
    const modulo = { ...feriali, aperto_sab: '1', da1_sab: '07:30', a1_sab: '12:00' };
    let r = await chiedi('/distributore/anagrafica/orari', form(modulo));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/anagrafica?ok=orari#orari');
    assert.match(scrittureAnagrafica[0].s, /^UPDATE distributors SET orari = \?::jsonb WHERE id = \?/);
    assert.deepEqual(JSON.parse(scrittureAnagrafica[0].p[0]), {
      lun: [['07:30', '12:30'], ['14:00', '18:00']], mar: [['07:30', '12:30'], ['14:00', '18:00']], mer: [['07:30', '12:30'], ['14:00', '18:00']],
      gio: [['07:30', '12:30'], ['14:00', '18:00']], ven: [['07:30', '12:30'], ['14:00', '18:00']], sab: [['07:30', '12:00']], dom: [],
    });
    assert.equal(scrittureAnagrafica[0].p[1], 2);

    // le righe in lettura: i giorni consecutivi con gli stessi orari su una riga sola (come nel mockup)
    anagraficaProva.filiale.orari = JSON.parse(scrittureAnagrafica[0].p[0]);
    let t = await (await chiedi('/distributore/anagrafica?ok=orari')).text();
    assert.match(t, /<span class="ab-orari-giorni">Lunedì – Venerdì<\/span><span class="ab-orari-fasce">07:30 – 12:30 · 14:00 – 18:00<\/span>/);
    assert.match(t, /<span class="ab-orari-giorni">Sabato<\/span><span class="ab-orari-fasce">07:30 – 12:00<\/span>/);
    assert.match(t, /<span class="ab-orari-giorni">Domenica<\/span><span class="ab-orari-fasce ab-orari-chiuso">Chiuso<\/span>/);
    assert.match(t, /<p class="ab-ok" role="status">Orari salvati\.<\/p>/);
    // il modulo ha i valori salvati e l'interruttore dei giorni aperti; niente "sempre aperto" né "Copia su tutti i giorni feriali" (tolti il 21/10/2026)
    t = await (await chiedi('/distributore/anagrafica?modifica=orari')).text();
    assert.match(t, /name="aperto_lun" value="1" data-aperto checked/);
    assert.doesNotMatch(t, /name="aperto_dom" value="1" data-aperto checked/);
    assert.match(t, /name="da2_lun" value="14:00"/);
    assert.doesNotMatch(t, /sempre_aperto|data-sempre-aperto|Nessun orario: sempre aperto/);
    assert.doesNotMatch(t, /data-copia-feriali|Copia su tutti i giorni feriali/);

    // errori: fine prima dell'inizio, ora scritta male, giorno aperto senza fasce: sotto il giorno giusto, nulla viene scritto
    scrittureAnagrafica.length = 0;
    r = await chiedi('/distributore/anagrafica/orari', form({ ...modulo, da1_lun: '13:00', a1_lun: '12:00', da1_sab: '7.30', aperto_dom: '1' }));
    assert.equal(r.status, 400);
    t = await r.text();
    assert.match(t, /<section class="ab-card" id="orari" data-scheda="orari" data-aperta>/);
    assert.match(t, /data-giorno="lun">[\s\S]*?<p class="ab-errore" role="alert">Ogni fascia deve finire dopo l’inizio \(13:00 – 12:00\)\.<\/p>/);
    assert.match(t, /data-giorno="sab">[\s\S]*?<p class="ab-errore" role="alert">Orari non validi: scrivi ore e minuti, per esempio 07:30\.<\/p>/);
    assert.match(t, /data-giorno="dom">[\s\S]*?<p class="ab-errore" role="alert">Scrivi gli orari della prima fascia, oppure segna il giorno come chiuso\.<\/p>/);
    assert.match(t, /name="da1_lun" value="13:00"/, 'i valori scritti tornano nel modulo');
    assert.equal(scrittureAnagrafica.length, 0);
    // tutto chiuso: non si salva (il banco non riceverebbe mai niente)
    r = await chiedi('/distributore/anagrafica/orari', form({}));
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Segna almeno un giorno come aperto\./);
    assert.equal(scrittureAnagrafica.length, 0);
    // un `sempre_aperto` scritto a mano non rimette gli orari a NULL: si salvano quelli del modulo
    r = await chiedi('/distributore/anagrafica/orari', form({ sempre_aperto: '1', ...modulo }));
    assert.equal(r.status, 302);
    assert.notEqual(scrittureAnagrafica[0].p[0], null);
  } finally {
    anagraficaProva.filiale.orari = originale;
    banco.attivo = false;
  }
});

test('banco: anagrafica, cambio password: attuale sbagliata, nuova che non va, poi riesce, salva l\'hash e chiude le ALTRE sessioni', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    scrittureAnagrafica.length = 0;
    const messaggi = (t) => [...t.matchAll(/<p class="ab-errore" id="ab-password-[a-z]+-err" role="alert">([^<]*)<\/p>/g)].map((m) => m[1]);
    const cambia = (attuale, nuova, ripeti) => chiedi('/distributore/anagrafica/password', form({ attuale, nuova, ripeti }));

    let r = await cambia('sbagliata!', 'nuovapassword1', 'nuovapassword1');
    assert.equal(r.status, 400);
    let t = await r.text();
    assert.deepEqual(messaggi(t), ['La password attuale non è corretta.']);
    assert.match(t, /<section class="ab-card" id="accesso" data-scheda="password" data-aperta>/);
    assert.doesNotMatch(t, /value="sbagliata!"/, 'le password non tornano mai nel modulo');
    r = await cambia('password-di-prova', 'corta', 'corta');
    assert.deepEqual(messaggi(await r.text()), ['La password deve avere almeno 8 caratteri.']);
    r = await cambia('password-di-prova', 'nuovapassword1', 'diversa123456');
    assert.deepEqual(messaggi(await r.text()), ['Le due password non coincidono.']);
    r = await cambia('password-di-prova', 'password-di-prova', 'password-di-prova');
    assert.deepEqual(messaggi(await r.text()), ['La nuova password deve essere diversa da quella attuale.']);
    r = await cambia('', '', '');
    assert.deepEqual(messaggi(await r.text()), ['Scrivi la password attuale.', 'La password deve avere almeno 8 caratteri.']);
    assert.equal(scrittureAnagrafica.length, 0, 'finora non è stato scritto niente');

    r = await cambia('password-di-prova', 'nuovapassword1', 'nuovapassword1');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/anagrafica?ok=password#accesso');
    const [hash, chiusura] = scrittureAnagrafica;
    assert.match(hash.s, /^UPDATE users SET password_hash = \? WHERE id = \?/);
    assert.ok(bcrypt.compareSync('nuovapassword1', hash.p[0]), 'si salva l\'hash bcrypt della nuova password');
    assert.equal(hash.p[1], 9);
    // chiude le altre sessioni dello stesso utente (id dentro sess -> user -> id) e tiene quella da cui si cambia
    assert.match(chiusura.s, /^DELETE FROM session WHERE \(sess::jsonb #>> '\{user,id\}'\) = \? AND sid <> \?/);
    assert.equal(chiusura.p[0], '9');
    assert.ok(chiusura.p[1].length > 10, 'sid della sessione corrente: ' + chiusura.p[1]);
    t = await (await chiedi('/distributore/anagrafica?ok=password')).text();
    assert.match(t, /<p class="ab-ok" role="status">Password cambiata\.<\/p>/);
  } finally {
    banco.attivo = false;
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});
