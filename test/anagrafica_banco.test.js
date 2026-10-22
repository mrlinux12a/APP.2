// Prove di src/anagrafica_banco.js e della geocodifica (src/geo.js): controlli dei moduli, salvataggio di filiale/orari (la posizione del banco è fissa), cambio password.
// DB e rete sono finti: nessun accesso al database vero né a Nominatim. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bcrypt = require('bcryptjs');

// ---------------- DB finto: registra le istruzioni e risponde con le righe di prova ----------------
const scritture = [];
let righe = {};
let erroreSulProssimoUpdate = null;
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const esegui = (modo, p) => {
      if (/^SELECT \* FROM distributors WHERE id = \?/.test(s)) return righe.filiale || null;
      if (/^SELECT ditta_id FROM distributors WHERE id = \?/.test(s)) return righe.filiale ? { ditta_id: righe.filiale.ditta_id } : null;
      if (/^SELECT \* FROM ditte WHERE id = \?/.test(s)) return righe.ditta || null;
      if (/^SELECT id, username, email FROM users WHERE id = \?/.test(s)) return righe.utente || null;
      if (/^SELECT id, password_hash FROM users WHERE id = \?/.test(s)) return righe.utentePassword || null;
      if (/^(UPDATE|DELETE)/.test(s)) {
        if (erroreSulProssimoUpdate && /^UPDATE distributors SET filiale/.test(s)) { const e = erroreSulProssimoUpdate; erroreSulProssimoUpdate = null; throw e; }
        scritture.push({ s, p });
        return { changes: 1 };
      }
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 100));
    };
    return { get: async (...p) => esegui('get', p) || null, all: async (...p) => esegui('all', p), run: async (...p) => esegui('run', p) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const banco = require('../src/anagrafica_banco');
const geo = require('../src/geo');

const FILIALE = {
  id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', zona: 'Genova', ditta_id: 6, ragione_sociale: '', partita_iva: '',
  indirizzo: 'Via Castel Morrone 1/7 rosso', cap: '16161', citta: 'Genova', provincia: 'GE', telefono: '010 123456', email: 'fegino@borea.example',
  geo_lat: 44.4521, geo_lng: 8.9055, geo_manuale: 0, orari: null, email_nuove_richieste: 0,
};
const VALORI = {
  filiale: 'Banco Genova Fegino', telefono: '010 123456', email: 'fegino@borea.example', zona: 'Genova',
  indirizzo: 'Via Castel Morrone 1/7 rosso', cap: '16161', citta: 'Genova', provincia: 'GE',
};
function prepara(extra = {}) {
  scritture.length = 0;
  erroreSulProssimoUpdate = null;
  righe = { filiale: { ...FILIALE }, ...extra };
}

// ---------------- Controlli ----------------

test('controllaDitta: ragione sociale obbligatoria; P. IVA 11 cifre, SDI 7 caratteri o PEC, CAP 5 cifre, provincia 2 lettere; i campi vuoti vanno bene', () => {
  let r = banco.controllaDitta({ ragione_sociale: 'BOREA SRL', partita_iva: '12345678901', sdi_pec: 'abcdefg', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'ge' });
  assert.deepEqual(r.errori, {});
  assert.deepEqual(r.valori, { ragione_sociale: 'BOREA SRL', partita_iva: '12345678901', sdi_pec: 'ABCDEFG', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'GE' });
  // oggi partita IVA, SDI e sede sono vuoti: si può salvare lo stesso
  assert.deepEqual(banco.controllaDitta({ ragione_sociale: 'BOREA SRL' }).errori, {});

  r = banco.controllaDitta({ ragione_sociale: '  ', partita_iva: '1234567890', sdi_pec: 'abcdef', cap: '1612', provincia: 'GEN' });
  assert.deepEqual(Object.keys(r.errori).sort(), ['cap', 'partita_iva', 'provincia', 'ragione_sociale', 'sdi_pec']);
  assert.match(r.errori.partita_iva, /11 cifre/);
  assert.match(r.errori.cap, /5 cifre/);
  assert.match(r.errori.provincia, /2 lettere/);

  assert.equal(banco.controllaDitta({ ragione_sociale: 'X', partita_iva: '1234567890a' }).errori.partita_iva !== undefined, true, 'le lettere non vanno');
  assert.equal(banco.controllaDitta({ ragione_sociale: 'X', partita_iva: '123 4567 8901' }).errori.partita_iva, undefined, 'gli spazi si tolgono');
  // PEC valida o no
  assert.deepEqual(banco.controllaDitta({ ragione_sociale: 'X', sdi_pec: 'borea@pec.it' }).errori, {});
  assert.ok(banco.controllaDitta({ ragione_sociale: 'X', sdi_pec: 'borea@pec' }).errori.sdi_pec);
  assert.ok(banco.controllaDitta({ ragione_sociale: 'X', sdi_pec: 'abc defg' }).errori.sdi_pec);
  // senza ditta (conDitta: false) contano solo ragione sociale e partita IVA
  const senza = banco.controllaDitta({ ragione_sociale: 'X', sdi_pec: 'xx', cap: '1' }, { conDitta: false });
  assert.deepEqual(senza.errori, {});
  assert.deepEqual(Object.keys(senza.valori), ['ragione_sociale', 'partita_iva']);
  // corpo sbagliato: nessuna eccezione
  assert.ok(banco.controllaDitta(null).errori.ragione_sociale);
  assert.ok(banco.controllaDitta({ ragione_sociale: ['a'] }).errori.ragione_sociale);
});

test('controllaFiliale: nome, indirizzo di ritiro e zona obbligatori; telefono ed email se scritti devono essere validi', () => {
  assert.deepEqual(banco.controllaFiliale(VALORI).errori, {});
  assert.deepEqual(banco.controllaFiliale({ ...VALORI, telefono: '', email: '' }).errori, {}, 'telefono ed email sono facoltativi');
  assert.deepEqual(banco.controllaFiliale({ ...VALORI, telefono: '+39 010 123456' }).errori, {});
  assert.deepEqual(banco.controllaFiliale({ ...VALORI, telefono: '010/123.456' }).errori, {});
  const r = banco.controllaFiliale({ filiale: '', telefono: 'abc', email: 'nope', zona: '', indirizzo: '', cap: '12', citta: '', provincia: 'G' });
  assert.deepEqual(Object.keys(r.errori).sort(), ['cap', 'email', 'filiale', 'indirizzo', 'provincia', 'telefono', 'zona']);
  assert.equal(banco.controllaFiliale({ ...VALORI, provincia: 'ge' }).valori.provincia, 'GE');
  assert.equal(banco.controllaFiliale({ ...VALORI, filiale: '  Banco  ' }).valori.filiale, 'Banco');
  assert.ok(banco.controllaFiliale(undefined).errori.filiale);
});

test('controllaCambioPassword: attuale obbligatoria, nuova come in registrazione (8-72), uguali fra loro, diversa dall\'attuale', () => {
  assert.deepEqual(banco.controllaCambioPassword({ attuale: 'vecchia123', nuova: 'nuovapass1', ripeti: 'nuovapass1' }).errori, {});
  assert.deepEqual(Object.keys(banco.controllaCambioPassword({}).errori).sort(), ['attuale', 'nuova']);
  assert.match(banco.controllaCambioPassword({ attuale: 'a', nuova: 'corta', ripeti: 'corta' }).errori.nuova, /almeno 8/);
  assert.match(banco.controllaCambioPassword({ attuale: 'a', nuova: 'x'.repeat(73), ripeti: 'x'.repeat(73) }).errori.nuova, /al massimo 72/);
  assert.match(banco.controllaCambioPassword({ attuale: 'a', nuova: 'nuovapass1', ripeti: 'altrapass12' }).errori.ripeti, /non coincidono/);
  assert.match(banco.controllaCambioPassword({ attuale: 'stessapass1', nuova: 'stessapass1', ripeti: 'stessapass1' }).errori.nuova, /diversa/);
  // un'array o un oggetto da un modulo "extended" non vale come password
  assert.ok(banco.controllaCambioPassword({ attuale: ['a'], nuova: { x: 1 }, ripeti: 'x' }).errori.attuale);
});

test('indirizzoInRiga: "Via X 1, 16131 Genova (GE)"; vuoto se non c\'è niente', () => {
  assert.equal(banco.indirizzoInRiga({ indirizzo: 'Via X 1', cap: '16131', citta: 'Genova', provincia: 'GE' }), 'Via X 1, 16131 Genova (GE)');
  assert.equal(banco.indirizzoInRiga({ indirizzo: 'Via X 1', cap: '', citta: 'Genova', provincia: '' }), 'Via X 1, Genova');
  assert.equal(banco.indirizzoInRiga({ indirizzo: '', cap: '', citta: '', provincia: '' }), '');
});

// ---------------- Lettura ----------------

test('leggi: con la ditta valgono i dati di `ditte`; senza ditta ragione sociale e partita IVA della filiale (e niente SDI/sede)', async () => {
  prepara({ ditta: { id: 6, ragione_sociale: 'BOREA SRL', partita_iva: '123', sdi_pec: 'ABCDEFG', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'GE' }, utente: { id: 9, username: 'fegino', email: 'a@b.it' } });
  let l = await banco.leggi(2, 9);
  assert.equal(l.conDitta, true);
  assert.equal(l.ditta.sdi_pec, 'ABCDEFG');
  assert.equal(l.utente.email, 'a@b.it');
  assert.equal(l.orari, null);
  assert.equal(l.posizioneImpostata, true);
  assert.equal(l.emailNuoveRichieste, false);

  prepara({ utente: null });
  righe.filiale = { ...FILIALE, ditta_id: null, ragione_sociale: 'BOREA DI PROVA', partita_iva: '98765432109', geo_lat: null, geo_lng: null, email_nuove_richieste: 1, orari: { lun: [['07:30', '12:30']] } };
  l = await banco.leggi(2, 9);
  assert.equal(l.conDitta, false);
  assert.deepEqual([l.ditta.ragione_sociale, l.ditta.partita_iva, l.ditta.sdi_pec], ['BOREA DI PROVA', '98765432109', '']);
  assert.equal(l.posizioneImpostata, false, 'senza coordinate la posizione manca');
  assert.equal(l.emailNuoveRichieste, true);
  assert.deepEqual(l.orari.lun, [['07:30', '12:30']]);
  assert.deepEqual(l.utente, { email: '', username: '' });
  // il nome della filiale vuoto in ragione sociale: ripiega sul nome
  righe.filiale = { ...FILIALE, ditta_id: null, ragione_sociale: '' };
  assert.equal((await banco.leggi(2, 9)).ditta.ragione_sociale, 'BOREA SRL');
  righe.filiale = null;
  assert.equal(await banco.leggi(2, 9), null);
});

// ---------------- Salvataggi ----------------

test('salvaDitta: scrive su `ditte`; senza ditta solo ragione sociale e partita IVA della filiale', async () => {
  prepara();
  await banco.salvaDitta(2, { ragione_sociale: 'BOREA', partita_iva: '123', sdi_pec: 'X', indirizzo: 'V', cap: '1', citta: 'C', provincia: 'GE' });
  assert.match(scritture[0].s, /^UPDATE ditte SET/);
  assert.deepEqual(scritture[0].p, ['BOREA', '123', 'X', 'V', '1', 'C', 'GE', 6]);

  prepara();
  righe.filiale.ditta_id = null;
  await banco.salvaDitta(2, { ragione_sociale: 'BOREA', partita_iva: '123' });
  assert.equal(scritture[0].s, 'UPDATE distributors SET ragione_sociale = ?, partita_iva = ? WHERE id = ?');
  assert.deepEqual(scritture[0].p, ['BOREA', '123', 2]);
  assert.equal(await banco.salvaDitta(99, {}), true, 'con la riga trovata dal DB finto');
});

test('salvaFiliale: la posizione è FISSA — con l\'indirizzo uguale o cambiato non si ricalcola, non si scrive e non parte nessuna geocodifica', async () => {
  // se qualcuno richiamasse la geocodifica per sbaglio, la prova lo vede: ogni chiamata a fetch fa fallire il test
  const fetchOriginale = global.fetch;
  global.fetch = async () => { throw new Error('la posizione del banco non si cerca sulla mappa'); };
  try {
    prepara();
    let r = await banco.salvaFiliale(2, { ...VALORI, telefono: '010 1' });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(scritture.map((w) => w.s.split(' SET ')[0]), ['UPDATE distributors', 'UPDATE store_locations']);

    prepara();
    r = await banco.salvaFiliale(2, { ...VALORI, indirizzo: 'Via XX Settembre 10', cap: '16121' });
    assert.deepEqual(r, { ok: true });
    // niente scritture di posizione: né geo_lat/geo_lng, né geo_manuale, né la descrizione della geocodifica
    assert.equal(scritture.filter((w) => /geo_lat|geo_lng|geo_manuale|geocodifica/.test(w.s)).length, 0);
    // il punto vendita prende il nuovo indirizzo, telefono ed email; il nome solo se era quello della filiale
    const punto = scritture.find((w) => /^UPDATE store_locations SET nome = CASE/.test(w.s));
    assert.deepEqual(punto.p, ['Banco Genova Fegino', 'Banco Genova Fegino', 'Via XX Settembre 10', '16121', 'Genova', 'GE', '010 123456', 'fegino@borea.example', 2]);

    // anche con un banco che in passato l'aveva spostata a mano: stesso comportamento, la posizione resta quella del DB
    prepara();
    righe.filiale.geo_manuale = 1;
    r = await banco.salvaFiliale(2, { ...VALORI, indirizzo: 'Via Balbi 5' });
    assert.deepEqual(r, { ok: true });
    assert.equal(scritture.filter((w) => /geo_lat|geo_lng|geo_manuale|geocodifica/.test(w.s)).length, 0);
  } finally {
    global.fetch = fetchOriginale;
  }

  // un'altra filiale della stessa ditta ha già il nome (indice unico): errore sotto il campo, non un 500
  prepara();
  erroreSulProssimoUpdate = Object.assign(new Error('duplicate key'), { code: '23505' });
  let r = await banco.salvaFiliale(2, { ...VALORI, filiale: 'Banco Genova Staglieno' });
  assert.equal(r.ok, false);
  assert.match(r.errori.filiale, /già questo nome/);
  // qualunque altro errore del DB sale
  prepara();
  erroreSulProssimoUpdate = Object.assign(new Error('rete caduta'), { code: '08006' });
  await assert.rejects(banco.salvaFiliale(2, VALORI), /rete caduta/);
  // banco che non esiste
  righe.filiale = null;
  assert.equal((await banco.salvaFiliale(2, VALORI)).ok, false);
});

test('la posizione del banco non ha più modi di essere spostata da qui (niente spostaPosizione)', () => {
  assert.equal(banco.spostaPosizione, undefined);
});

test('salvaOrari avvisa subito gli installatori collegati (evento "orari" a tutto il ruolo "cliente"), non il banco', async () => {
  const eventi = require('../src/eventi');
  prepara();
  const installatore1 = [];
  const installatore2 = [];
  const delBanco = [];
  const togli = [
    eventi.iscrivi(1, { write: (m) => installatore1.push(m), end() {} }, 'cliente'),
    eventi.iscrivi(2, { write: (m) => installatore2.push(m), end() {} }, 'cliente'),
    eventi.iscrivi(9, { write: (m) => delBanco.push(m), end() {} }, 'distributore'),
  ];
  try {
    await banco.salvaOrari(2, null);
    assert.deepEqual(installatore1, ['event: orari\ndata: {}\n\n']);
    assert.deepEqual(installatore2, ['event: orari\ndata: {}\n\n']);
    assert.deepEqual(delBanco, []);
    // una connessione che non risponde più non fa fallire il salvataggio
    togli.push(eventi.iscrivi(3, { write: () => { throw new Error('chiusa'); }, end() {} }, 'cliente'));
    await banco.salvaOrari(2, null);
    assert.equal(scritture.length >= 2, true);
  } finally {
    togli.forEach((f) => f());
  }
  // chiuse le pagine, non c'è nessuno da avvisare
  assert.equal(eventi.emettiARuolo('cliente', 'orari', {}), 0);
});

test('salvaOrari e salvaEmailNuoveRichieste', async () => {
  prepara();
  await banco.salvaOrari(2, { lun: [['07:30', '12:30']], mar: [], mer: [], gio: [], ven: [], sab: [], dom: [] });
  assert.equal(scritture[0].s, 'UPDATE distributors SET orari = ?::jsonb WHERE id = ?');
  assert.deepEqual(JSON.parse(scritture[0].p[0]).lun, [['07:30', '12:30']]);
  await banco.salvaOrari(2, null);
  assert.equal(scritture[1].p[0], null, '"sempre aperto" = NULL');
  await banco.salvaEmailNuoveRichieste(2, true);
  await banco.salvaEmailNuoveRichieste(2, false);
  assert.deepEqual([scritture[2].p, scritture[3].p], [[1, 2], [0, 2]]);
});

test('cambiaPassword: controlla l\'attuale, salva l\'hash e chiude le altre sessioni (non quella da cui si cambia)', async () => {
  prepara({ utentePassword: { id: 9, password_hash: bcrypt.hashSync('vecchiapass1', 4) } });
  let r = await banco.cambiaPassword(9, 'sid-corrente', { attuale: 'sbagliata12', nuova: 'nuovapass12', ripeti: 'nuovapass12' });
  assert.deepEqual([r.ok, r.passwordSbagliata, Object.keys(r.errori)], [false, true, ['attuale']]);
  assert.equal(scritture.length, 0);

  // campi che non vanno: errore, e NON conta come password sbagliata (non si è nemmeno guardata)
  r = await banco.cambiaPassword(9, 'sid-corrente', { attuale: 'vecchiapass1', nuova: 'corta', ripeti: 'corta' });
  assert.deepEqual([r.ok, r.passwordSbagliata], [false, undefined]);
  assert.equal(scritture.length, 0);

  r = await banco.cambiaPassword(9, 'sid-corrente', { attuale: 'vecchiapass1', nuova: 'nuovapass12', ripeti: 'nuovapass12' });
  assert.deepEqual(r, { ok: true });
  assert.equal(scritture.length, 3);
  assert.ok(bcrypt.compareSync('nuovapass12', scritture[0].p[0]));
  assert.equal(scritture[0].p[1], 9);
  assert.equal(scritture[1].s, "DELETE FROM session WHERE (sess::jsonb #>> '{user,id}') = ? AND sid <> ?");
  assert.deepEqual(scritture[1].p, ['9', 'sid-corrente']);
  // e gli accessi dell'app nativa si revocano (la password nuova non lascia aperto niente di vecchio)
  assert.equal(scritture[2].s, 'UPDATE app_tokens SET revocato_il = NOW() WHERE user_id = ? AND revocato_il IS NULL');
  assert.deepEqual(scritture[2].p, [9]);

  righe.utentePassword = null;
  assert.equal((await banco.cambiaPassword(9, 'x', { attuale: 'a', nuova: 'nuovapass12', ripeti: 'nuovapass12' })).ok, false);
});

// ---------------- Geocodifica ----------------

const rispostaNominatim = (elenco, ok = true) => ({ ok, json: async () => elenco });

test('ricercheGeocodifica: indirizzo completo e poi senza CAP; senza via niente ricerche', () => {
  assert.deepEqual(geo.ricercheGeocodifica({ indirizzo: 'Via XX Settembre 10', cap: '16121', citta: 'Genova', provincia: 'GE' }), [
    'Via XX Settembre 10, 16121 Genova, GE, Italia',
    'Via XX Settembre 10, Genova, GE, Italia',
  ]);
  assert.deepEqual(geo.ricercheGeocodifica({ indirizzo: 'Via Balbi 5', cap: '', citta: 'Genova', provincia: '' }), ['Via Balbi 5, Genova, Italia'], 'senza CAP i due tentativi coincidono');
  assert.deepEqual(geo.ricercheGeocodifica({ indirizzo: '', cap: '16121', citta: 'Genova', provincia: 'GE' }), []);
});

test('geocodifica: legge lat/lng, ritenta senza CAP, non lancia mai e rifiuta posizioni fuori dall\'Italia', async () => {
  const visti = [];
  const fetchFinto = (risposte) => async (url, opzioni) => {
    visti.push({ url, ua: opzioni.headers['User-Agent'] });
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const indirizzo = { indirizzo: 'Via XX Settembre 10', cap: '16121', citta: 'Genova', provincia: 'GE' };

  // trovato al primo colpo: Nominatim restituisce lat/lon come testo
  let r = await geo.geocodifica(indirizzo, { fetch: fetchFinto([rispostaNominatim([{ lat: '44.4052876', lon: '8.9417002', display_name: 'Via Venti Settembre, Genova' }])]), pausaMs: 0 });
  assert.deepEqual(r, { lat: 44.4052876, lng: 8.9417002, descrizione: 'Via Venti Settembre, Genova' });
  assert.equal(visti.length, 1);
  assert.match(visti[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(visti[0].url, /countrycodes=it/);
  assert.match(visti[0].url, /format=jsonv2/);
  assert.match(visti[0].url, /limit=1/);
  assert.match(visti[0].ua, /Minuteria/, 'un User-Agent che dice chi siamo: lo vuole Nominatim');

  // il primo tentativo non trova niente, il secondo (senza CAP) sì
  visti.length = 0;
  r = await geo.geocodifica(indirizzo, { fetch: fetchFinto([rispostaNominatim([]), rispostaNominatim([{ lat: '44.4', lon: '8.9' }])]), pausaMs: 0 });
  assert.deepEqual([r.lat, r.lng], [44.4, 8.9]);
  assert.equal(visti.length, 2);
  assert.doesNotMatch(decodeURIComponent(visti[1].url), /16121/, 'il secondo tentativo è senza CAP');

  // rete assente / risposta di errore / JSON rovinato: null, mai un'eccezione
  assert.equal(await geo.geocodifica(indirizzo, { fetch: fetchFinto([new Error('rete'), new Error('rete')]), pausaMs: 0 }), null);
  assert.equal(await geo.geocodifica(indirizzo, { fetch: fetchFinto([rispostaNominatim([], false), rispostaNominatim([], false)]), pausaMs: 0 }), null);
  assert.equal(await geo.geocodifica(indirizzo, { fetch: async () => ({ ok: true, json: async () => { throw new Error('non json'); } }), pausaMs: 0 }), null);
  // un risultato fuori dall'Italia o senza coordinate non vale
  assert.equal(await geo.geocodifica(indirizzo, { fetch: fetchFinto([rispostaNominatim([{ lat: '51.5', lon: '-0.12' }]), rispostaNominatim([{ lat: 'x', lon: 'y' }])]), pausaMs: 0 }), null);
  assert.equal(await geo.geocodifica({ indirizzo: '' }, { fetch: async () => { throw new Error('non deve chiamare'); }, pausaMs: 0 }), null);
  assert.equal(await geo.geocodifica(null, { fetch: async () => { throw new Error('non deve chiamare'); }, pausaMs: 0 }), null);

  // tempo scaduto: la richiesta si interrompe (AbortController) e si passa oltre
  let interrotta = false;
  const lenta = (url, opzioni) => new Promise((_, rifiuta) => opzioni.signal.addEventListener('abort', () => { interrotta = true; rifiuta(new Error('abortita')); }));
  assert.equal(await geo.geocodifica({ indirizzo: 'Via Balbi 5', cap: '', citta: 'Genova', provincia: '' }, { fetch: lenta, attesaMs: 20, pausaMs: 0 }), null);
  assert.equal(interrotta, true);
});

test('indirizzoDaPosizione: il civico si scrive solo se la posizione è abbastanza precisa; altrimenti la sola via (zoom 17)', async () => {
  const visti = [];
  const inversa = (address) => async (url) => {
    visti.push(String(url));
    return { ok: true, json: async () => ({ address }) };
  };
  const puggia = { country_code: 'it', road: 'Via Puggia', house_number: '22', postcode: '16141', city: 'Genova', 'ISO3166-2-lvl6': 'IT-GE' };
  const p = [44.4019645, 8.9742339];

  // senza la precisione, o entro 30 m: la casa più vicina, con il CAP di OpenStreetMap
  for (const opzioni of [{}, { precisioneM: 5 }, { precisioneM: 30 }, { precisioneM: NaN }]) {
    visti.length = 0;
    assert.deepEqual(await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: inversa(puggia), ...opzioni }), { indirizzo: 'Via Puggia 22, 16141 Genova (GE)', civico: true, precisa: true }, JSON.stringify(opzioni));
    assert.match(visti[0], /^https:\/\/nominatim\.openstreetmap\.org\/reverse\?/);
    assert.match(visti[0], /zoom=18/);
  }
  assert.equal(await geo.indirizzoDaPosizione(...p, { fetch: inversa(puggia) }), 'Via Puggia 22, 16141 Genova (GE)', 'la versione solo testo');

  // il CAP c'è solo se è uno di cinque cifre: assente, scritto male o più d'uno (una via che attraversa due CAP) non si scrive, e il resto dell'indirizzo non cambia
  for (const postcode of [undefined, '', '1614', '161411', '16141;16142', '16141, 16142']) {
    assert.equal(await geo.indirizzoDaPosizione(...p, { fetch: inversa({ ...puggia, postcode }) }), 'Via Puggia 22, Genova (GE)', String(postcode));
  }
  assert.equal(await geo.indirizzoDaPosizione(...p, { fetch: inversa({ ...puggia, postcode: ' 16138 ' }) }), 'Via Puggia 22, 16138 Genova (GE)', 'spazi attorno');
  assert.equal(await geo.indirizzoDaPosizione(...p, { fetch: inversa({ ...puggia, city: undefined, town: undefined, village: undefined, municipality: undefined }) }), 'Via Puggia 22, 16141', 'senza città il CAP resta');

  // oltre 30 m il numero sarebbe quello di un'altra casa (da Via Puggia 22, 106 m più in là c'è il 17): niente numero, via più vicina
  for (const precisioneM of [31, 100, 4000]) {
    visti.length = 0;
    const r = await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: inversa({ ...puggia, house_number: '17' }), precisioneM });
    assert.deepEqual(r, { indirizzo: 'Via Puggia, 16141 Genova (GE)', civico: false, precisa: false }, String(precisioneM));
    assert.match(visti[0], /zoom=17/);
    assert.doesNotMatch(r.indirizzo, /17/);
  }
  assert.equal(geo.PRECISIONE_CIVICO_M, 30);

  // posizione precisa ma OpenStreetMap non ha un numero lì: via sola, e `precisa` resta vero (il messaggio è un altro)
  assert.deepEqual(await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: inversa({ ...puggia, house_number: undefined }), precisioneM: 8 }), { indirizzo: 'Via Puggia, 16141 Genova (GE)', civico: false, precisa: true });

  // senza una via, fuori dall'Italia, con coordinate che non valgono, con la rete giù: null, mai un'eccezione
  assert.equal(await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: inversa({ country_code: 'it', city: 'Genova' }) }), null);
  assert.equal(await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: inversa({ country_code: 'fr', road: 'Rue X' }) }), null);
  assert.equal(await geo.indirizzoDaPosizioneDettaglio(51.5, -0.12, { fetch: async () => { throw new Error('non deve chiamare'); } }), null);
  assert.equal(await geo.indirizzoDaPosizioneDettaglio(...p, { fetch: async () => { throw new Error('rete'); } }), null);
});

test('posizioneValida: un punto in Italia (isole comprese)', () => {
  assert.equal(geo.posizioneValida(44.4, 8.9), true);
  assert.equal(geo.posizioneValida(37.5, 15.1), true, 'Catania');
  assert.equal(geo.posizioneValida(0, 0), false);
  assert.equal(geo.posizioneValida(51.5, -0.12), false);
  assert.equal(geo.posizioneValida(NaN, 9), false);
  assert.equal(geo.posizioneValida('44', '9'), false, 'solo numeri veri');
});
