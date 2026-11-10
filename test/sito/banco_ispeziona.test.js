// Banco: il popup "Ispeziona" della home (richiesta del 10/11/2026), GET /distributore/ispeziona/:chiave, e "Ritirato dal corriere" in JSON.
// Il server vero con un DB finto in memoria: vedi test/sito/_aiuti/server_finto.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const aiuti = require('./_aiuti/server_finto');

aiuti.avvia(38489);
const {
  banco, biscotti, chiedi, form, json, ordine1295, preparaRichiesta, richiestaProva, ritiroTra, scrittureOrdini,
} = aiuti;

// La firma del contenuto (data-isp-firma): quella che dice allo script se il popup aperto va ridisegnato.
const firma = (t) => (/data-isp-firma="([0-9a-f]+)"/.exec(t) || [])[1];

// Il popup di un lavoro (la pagina intera di un frammento), con il suo codice di risposta.
async function popup(chiave) {
  const r = await chiedi('/distributore/ispeziona/' + chiave, { headers: { accept: 'text/html' } });
  return { r, t: r.status === 200 ? await r.text() : '' };
}

test('banco: popup Ispeziona "Da confermare": cliente, tempo che scorre, materiale a prezzo del banco e i due pulsanti', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    // senza accesso non si vede niente: si viene mandati al login
    assert.equal((await chiedi('/distributore/ispeziona/r177')).status, 302);
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    preparaRichiesta({ secondi: 241 });
    const { r, t } = await popup('r177');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') || '', /no-store/, 'mai dalla cache: deve dire la fase di adesso');
    assert.match(t, /<div class="isp isp-da_confermare" data-isp data-isp-chiave="r177" data-isp-fase="da_confermare" data-isp-firma="[0-9a-f]{12}">/);
    assert.match(t, /<span class="isp-pillola isp-pillola-da_confermare">Da confermare<\/span>\s*<h2 class="isp-titolo" id="isp-titolo">Ordine ORD-177<\/h2>/);
    assert.doesNotMatch(t, /isp-avviso/, 'finché è in bacheca non c\'è nessun avviso');

    // cliente: nome, P.IVA, telefono come TESTO (niente tel:), scheda cliente
    assert.match(t, /<strong class="isp-cliente-nome">Prova S\.r\.l\.<\/strong>/);
    assert.match(t, /<span class="isp-cliente-piva">P\.IVA <b>01234567890<\/b><\/span>/);
    assert.match(t, /<span class="isp-cliente-tel">[\s\S]*?<\/span>010 123 456<\/span>/);
    assert.doesNotMatch(t, /href="tel:/);
    assert.match(t, /<a class="btn-banco btn-banco-secondario isp-apri" href="\/distributore\/clienti\/1">Apri scheda cliente/);

    // tempo: i secondi del server (241 su una finestra di 600), il valore mm:ss e la barra
    assert.match(t, /<section class="isp-tempo isp-tempo-conferma" data-isp-tempo data-secondi="24[01]" data-finestra="600">/);
    assert.match(t, /Tempo per confermare/);
    assert.match(t, /<div class="isp-tempo-valore" data-isp-valore role="timer">04:0[01]<\/div>/);
    assert.match(t, /<span class="timer-barra-riempita" data-barra style="width: 40\.\d%"><\/span>/);

    // materiale: a prezzo del banco, IVA esclusa; la colonna "Prezzo cliente" è il prezzo del banco
    assert.match(t, /<h3 class="isp-eti isp-eti-tabella">Materiale richiesto<\/h3>/);
    assert.match(t, /<th class="isp-num" scope="col">Listino<\/th>\s*<th class="isp-num" scope="col">Prezzo cliente<\/th>\s*<th class="isp-num" scope="col">Totale<\/th>/);
    assert.match(t, /<span class="isp-qta">1×<\/span>/);
    assert.match(t, /<code>12364959<\/code>/);
    assert.match(t, /€ 102,30/);
    assert.match(t, /<span class="isp-piede-eti">Totale per il cliente<\/span>\s*<strong class="isp-piede-val">€ 102,30<\/strong>\s*<span class="isp-piede-iva">\+ IVA<\/span>/);
    assert.doesNotMatch(t, /giacenza|magazzino/i);

    // pulsanti: Chiudi, Non disponibile e Accetta ordine (le rotte di sempre, "rispondi" con l'azione)
    assert.match(t, /data-isp-azione="rifiuta" data-isp-url="\/distributore\/richieste\/177\/rispondi" data-isp-corpo="azione=rifiuta">Non disponibile<\/button>/);
    assert.match(t, /data-isp-azione="accetta" data-isp-url="\/distributore\/richieste\/177\/rispondi" data-isp-corpo="azione=prezzo_richiesto">[\s\S]*?Accetta ordine<\/button>/);
    assert.doesNotMatch(t, /Ritirato dal corriere/);

    // il tempo che scorre NON cambia la firma (il popup aperto non si ridisegna e il suo conto alla rovescia non ripartisce); la fase sì
    preparaRichiesta({ secondi: 200 });
    assert.equal(firma((await popup('r177')).t), firma(t));
    // negli ultimi 2 minuti diventa urgente (rosso), come la scheda della home
    preparaRichiesta({ secondi: 95 });
    assert.match((await popup('r177')).t, /isp-tempo isp-tempo-conferma urgente"/);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: popup Ispeziona "Attesa corriere": tempo che sale, "Cerco un corriere", nessun pulsante di azione; poi segue il lavoro quando diventa ordine', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, originale, extra); };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 190 });
    const attesa = (await popup('r177')).t;
    assert.match(attesa, /data-isp-fase="attesa_corriere"/);
    assert.match(attesa, /<span class="isp-pillola isp-pillola-attesa_corriere">Attesa corriere<\/span>/);
    assert.match(attesa, /<section class="isp-tempo isp-tempo-corriere" data-isp-tempo data-trascorsi="19\d">/);
    assert.match(attesa, /<span class="isp-tempo-valore" data-isp-valore>03:1\d<\/span>/); // 190 s: mm:ss che sale
    assert.match(attesa, /Cerco un corriere<span class="puntini"/);
    assert.match(attesa, /<div class="cerca-barra" aria-hidden="true"><span><\/span><\/div>/);
    assert.doesNotMatch(attesa, /data-isp-azione=/, 'solo Chiudi: il banco non deve fare niente');
    assert.match(attesa, /data-isp-chiudi>Chiudi<\/button>/);
    assert.match(attesa, /€ 102,30/, 'il materiale si vede anche qui');

    // il corriere accetta: la richiesta diventa un ordine "Da preparare" e la STESSA chiave (r177) mostra la nuova fase: è quello che fa cambiare il popup aperto
    imposta(ritiroTra(22));
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });
    const preparare = (await popup('r177')).t;
    assert.match(preparare, /data-isp-chiave="r177" data-isp-fase="da_preparare"/);
    assert.notEqual(firma(preparare), firma(attesa), 'la fase cambia: lo script ridisegna il popup');
    assert.match(preparare, /<h2 class="isp-titolo" id="isp-titolo">Ordine ORD-1295<\/h2>/, 'da richiesta a ordine: il codice è quello dell\'ordine');
    // lo stesso ordine, dalla sua chiave "o": stesso contenuto, e la scheda dice r177 (la chiave non cambia)
    const daOrdine = (await popup('o1295')).t;
    assert.match(daOrdine, /data-isp-chiave="r177"/);
    assert.equal(firma(daOrdine), firma(preparare));
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: popup Ispeziona "Da preparare": corriere in arrivo, materiale dell\'ordine (prezzi salvati), "Ritirato dal corriere"; senza corriere niente conto alla rovescia', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, originale, extra); };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    imposta(ritiroTra(22));
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });

    let t = (await popup('r177')).t;
    assert.match(t, /<span class="isp-pillola isp-pillola-da_preparare">Da preparare<\/span>/);
    // il corriere ritira fra 22 minuti: 1320 s su un totale di 26 minuti (1560 s), cioè la barra a ~15%
    assert.match(t, /<section class="isp-tempo isp-tempo-preparare" data-isp-tempo data-secondi="13[12]\d" data-totale="1560">/);
    assert.match(t, /<span data-isp-eti-testo>Corriere in arrivo tra<\/span>/);
    assert.match(t, /<div class="isp-tempo-valore" data-isp-valore role="timer">2[12]:\d\d<\/div>/);
    assert.match(t, /<span class="timer-barra-riempita" data-barra style="width: 15\.\d%"><\/span>/);

    // materiale dall'ordine: due righe, listino e prezzo del banco salvati (54,50 e 10,00), totale 64,50 + IVA
    const righe = t.split('<tr>').slice(2);
    assert.equal(righe.length, 2);
    assert.match(righe[0], /<code>12514597<\/code>/);
    assert.match(righe[0], /€ 60,50/);
    assert.match(righe[0], /<strong>€ 54,50<\/strong><small>cad\. \+ IVA<\/small>/);
    assert.match(righe[1], /<code>12697319<\/code>[\s\S]*?€ 12,00[\s\S]*?<strong>€ 10,00<\/strong>/);
    assert.match(t, /<strong class="isp-piede-val">€ 64,50<\/strong>/);

    // "Ritirato dal corriere" (il vecchio "Preparato"): la stessa rotta, chiamata dallo script
    assert.match(t, /data-isp-azione="ritirato" data-isp-url="\/distributore\/ordini\/1295\/preparazione" data-isp-corpo="">[\s\S]*?Ritirato dal corriere<\/button>/);
    assert.doesNotMatch(t, /Accetta ordine|Non disponibile/);
    // nome del cliente e scheda cliente come sempre
    assert.match(t, /<strong class="isp-cliente-nome">Prova S\.r\.l\.<\/strong>/);

    // il corriere è già al banco (il tempo è finito): il blocco dice "Corriere arrivato al banco"
    imposta(ritiroTra(-2));
    t = (await popup('r177')).t;
    assert.match(t, /isp-tempo isp-tempo-preparare arrivato" data-isp-tempo data-secondi="-1\d\d"/);
    assert.match(t, /<span data-isp-eti-testo>Corriere arrivato al banco<\/span>/);
    assert.match(t, /<div class="isp-tempo-valore" data-isp-valore role="timer">00:00<\/div>/);

    // senza corriere (modulo spento): niente conto alla rovescia, solo il promemoria
    imposta({ corriere_nome: '', corriere_arrivo_il: null, corriere_risposto_il: null, corriere_minuti: null });
    t = (await popup('r177')).t;
    assert.doesNotMatch(t, /data-isp-tempo|timer-barra/);
    assert.match(t, /isp-tempo-semplice/);
    assert.match(t, /Ritirato dal corriere<\/button>/);
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: popup Ispeziona aperto su un lavoro che esce dalla bacheca: avviso col motivo, niente pulsanti di azione, si può chiudere', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, originale, extra); };
  const chiuso = async (chiave, motivo) => {
    const { r, t } = await popup(chiave);
    assert.equal(r.status, 200, chiave);
    assert.match(t, /data-isp-fase="chiuso"/);
    assert.match(t, /<span class="isp-pillola isp-pillola-chiuso">Non più in bacheca<\/span>/);
    assert.match(t, new RegExp('<p class="isp-avviso" role="status">[\\s\\S]*?<span>' + motivo + '</span></p>'));
    assert.doesNotMatch(t, /data-isp-azione=/);
    assert.match(t, /data-isp-chiudi/);
    return t;
  };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // il banco ha segnato "Non disponibile" (da un'altra scheda): la richiesta non è più sua
    preparaRichiesta({ secondi: 300, esito: 'non_disponibile', trascorsi: 20 });
    const nonDisponibile = await chiuso('r177', 'Hai segnato la richiesta come non disponibile\\.');
    assert.match(nonDisponibile, /€ 102,30/, 'il materiale resta leggibile');

    // il tempo è scaduto
    preparaRichiesta({ secondi: 0 });
    await chiuso('r177', 'Il tempo per rispondere è scaduto\\.');

    // il cliente ha annullato
    preparaRichiesta({ secondi: 300, stato: 'annullata' });
    await chiuso('r177', 'Il cliente ha annullato la richiesta\\.');

    // l'ordine è stato ritirato dal corriere ("In consegna": lo si trova nello Storico) o consegnato
    imposta({ stato: 'in_evasione' });
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });
    let t = await chiuso('r177', 'Il corriere ha ritirato il materiale: ora l&#39;ordine è «In consegna» e lo trovi nello Storico\\.');
    assert.match(t, /€ 64,50/, 'anche qui il materiale dell\'ordine');
    imposta({ stato: 'in_evasione', consegnato_il: new Date() });
    await chiuso('r177', 'Questo ordine è già stato consegnato\\.');
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: popup Ispeziona, chiavi sbagliate e lavori di altri banchi: 404 e niente contenuto', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    preparaRichiesta({ secondi: 241 });
    for (const chiave of ['abc', 'r', 'r0x1', 'x177', '177', 'r-1', 'r1234567890', 'r999', 'o99999', 'o1290']) {
      const { r, t } = await popup(chiave);
      assert.equal(r.status, 404, chiave);
      assert.doesNotMatch(r.headers.get('content-type') || '', /html.*isp/);
      assert.doesNotMatch(t, /Prova S\.r\.l\./);
    }
    // una richiesta a cui questo banco non ha mai risposto (di un altro banco): 404
    richiestaProva.risposta = null;
    assert.equal((await popup('r177')).r.status, 404);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: "Ritirato dal corriere" dal popup: la rotta di "Preparato" risponde in JSON (ok, o 404 per un ordine non suo) senza cambiare strada', async () => {
  biscotti.cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const originale = { ...ordine1295 };
  const imposta = (extra = {}) => { for (const k of Object.keys(ordine1295)) delete ordine1295[k]; Object.assign(ordine1295, originale, extra); };
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi: 300, ordine: ordine1295 });

    scrittureOrdini.length = 0;
    let r = await chiedi('/distributore/ordini/1295/preparazione', { ...form({}), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(scrittureOrdini.length, 1);
    assert.match(scrittureOrdini[0].s, /stato = 'in_evasione'/);

    // già in consegna: ok lo stesso, e non si riscrive niente (un secondo clic, o un'altra scheda rimasta aperta)
    imposta({ stato: 'in_evasione' });
    scrittureOrdini.length = 0;
    r = await chiedi('/distributore/ordini/1295/preparazione', { ...json({}), headers: { 'content-type': 'application/json', accept: 'application/json' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(scrittureOrdini.length, 0);

    // l'ordine di un altro banco o inesistente: 404 in JSON, mai un reindirizzamento
    for (const id of [1290, 999]) {
      scrittureOrdini.length = 0;
      r = await chiedi('/distributore/ordini/' + id + '/preparazione', { ...form({}), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
      assert.equal(r.status, 404, String(id));
      assert.equal((await r.json()).ok, false);
      assert.equal(scrittureOrdini.length, 0);
    }
  } finally {
    imposta();
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});
