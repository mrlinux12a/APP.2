// Gruppo WhatsApp dei corrieri con PIÙ ISTANZE accese insieme (la VPS e un server locale sullo stesso DB e nello stesso gruppo): ogni messaggio in coda porta il nome
// dell'istanza che l'ha creato (whatsapp_messaggi.istanza) e lo invia, lo elimina e ne legge le risposte solo lei. Più l'interruttore WHATSAPP_ATTIVO (0/1).
// DB in memoria e socket finto: nessun accesso al database vero né a WhatsApp. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const radice = path.join(__dirname, '..');

// ---------------- DB in memoria ----------------
const righe = []; // whatsapp_messaggi
const scritture = [];
const sqlViste = [];
let prossimoId = 1;

function esegui(sql, p) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqlViste.push({ s, p });
  if (/^INSERT INTO whatsapp_messaggi/.test(s)) {
    scritture.push({ s, p });
    const riga = { id: prossimoId++, stato: 'da_inviare', tentativi: 0, wa_msg_id: null, preso_il: null };
    if (/\(request_id, response_id, tipo, testo, istanza\) VALUES \(\?, \?, 'ritiro_consegna', \?, \?\)/.test(s)) {
      Object.assign(riga, { request_id: p[0], response_id: p[1], tipo: 'ritiro_consegna', testo: p[2], istanza: p[3] });
    } else if (/\(request_id, response_id, tipo, testo, istanza\) VALUES \(\?, \?, 'esito', \?, \?\)/.test(s)) {
      Object.assign(riga, { request_id: p[0], response_id: p[1], tipo: 'esito', testo: p[2], istanza: p[3] });
    } else {
      throw new Error('INSERT inatteso: ' + s);
    }
    righe.push(riga);
    return { changes: 1, lastInsertRowid: riga.id };
  }
  if (/^SELECT \* FROM whatsapp_messaggi WHERE stato = 'da_inviare' AND tentativi < \? AND \(istanza = \? OR \(istanza IS NULL AND \?::boolean\)\) ORDER BY id$/.test(s)) {
    const [max, nome, senzaNome] = p;
    return righe.filter((r) => r.stato === 'da_inviare' && r.tentativi < max && (r.istanza === nome || (r.istanza == null && senzaNome)));
  }
  if (/^SELECT \* FROM whatsapp_messaggi WHERE stato = 'da_eliminare' AND wa_msg_id IS NOT NULL AND tentativi < \? AND \(istanza = \? OR \(istanza IS NULL AND \?::boolean\)\) ORDER BY id$/.test(s)) {
    const [max, nome, senzaNome] = p;
    return righe.filter((r) => r.stato === 'da_eliminare' && r.wa_msg_id && r.tentativi < max && (r.istanza === nome || (r.istanza == null && senzaNome)));
  }
  if (/^UPDATE whatsapp_messaggi SET stato = 'inviato', wa_msg_id = \?, inviato_il = NOW\(\), errore = NULL WHERE id = \? AND stato = 'da_inviare'$/.test(s)) {
    const r = righe.find((x) => x.id === p[1] && x.stato === 'da_inviare');
    if (!r) return { changes: 0 };
    Object.assign(r, { stato: 'inviato', wa_msg_id: p[0] });
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET stato = 'eliminato', errore = NULL WHERE id = \?$/.test(s)) {
    righe.find((x) => x.id === p[0]).stato = 'eliminato';
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET preso_il = NOW\(\) WHERE id = \?$/.test(s)) {
    scritture.push({ s, p });
    righe.find((x) => x.id === p[0]).preso_il = new Date();
    return { changes: 1 };
  }
  if (/^SELECT istanza FROM whatsapp_messaggi WHERE request_id = \? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1$/.test(s)) {
    const r = righe.filter((x) => x.request_id === p[0] && x.tipo === 'ritiro_consegna').pop();
    return r ? { istanza: r.istanza } : null;
  }
  if (/^SELECT \* FROM whatsapp_messaggi WHERE wa_msg_id = \? AND tipo = 'ritiro_consegna'$/.test(s)) {
    return righe.find((x) => x.wa_msg_id === p[0] && x.tipo === 'ritiro_consegna') || null;
  }
  if (/^SELECT \* FROM whatsapp_messaggi WHERE request_id = \? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1$/.test(s)) {
    return righe.filter((x) => x.request_id === p[0] && x.tipo === 'ritiro_consegna').pop() || null;
  }
  if (/^SELECT 1 AS si FROM whatsapp_messaggi WHERE wa_msg_id = \?$/.test(s)) {
    return righe.find((x) => x.wa_msg_id === p[0]) ? { si: 1 } : null;
  }
  // il testo del "nuova consegna": la richiesta, la risposta del banco, la filiale e il cliente
  if (/^SELECT \* FROM requests WHERE id = \?$/.test(s)) return { id: p[0], cliente_id: 7 };
  if (/^SELECT \* FROM request_responses WHERE id = \?$/.test(s)) return { id: p[0], distributor_id: 2 };
  if (/^SELECT \* FROM distributors WHERE id = \?$/.test(s)) return { id: 2, nome: 'BOREA SRL', filiale: 'Fegino', indirizzo: 'Via Castel Morrone 1', zona: 'Genova', geo_lat: 44.44, geo_lng: 8.93 };
  if (/FROM store_locations/.test(s)) return null;
  if (/^SELECT \* FROM users WHERE id = \?$/.test(s)) return { id: 7, indirizzo_consegna: 'Via Puggia 22/3, 16131 Genova (GE)', geo_lat: 44.43, geo_lng: 8.95 };
  throw new Error('query inattesa: ' + s);
}

const dbFinto = {
  prepare: (sql) => ({ get: async (...p) => esegui(sql, p), all: async (...p) => esegui(sql, p), run: async (...p) => esegui(sql, p) }),
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(radice, 'db/index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

// richieste.corriereHaPreso (letto con require() al momento dell'uso): finto, registra le chiamate
const chiamatePreso = [];
const percorsoRichieste = require.resolve(path.join(radice, 'src/richieste.js'));
require.cache[percorsoRichieste] = {
  id: percorsoRichieste, filename: percorsoRichieste, loaded: true,
  exports: { corriereHaPreso: async (responseId, minuti, nome) => { chiamatePreso.push({ responseId, minuti, nome }); return { esito: 'preso' }; } },
};

const wa = require(path.join(radice, 'src/whatsapp.js'));

function ambiente(variabili) {
  for (const k of ['WHATSAPP_ATTIVO', 'WHATSAPP_ISTANZA', 'WHATSAPP_GRUPPO']) delete process.env[k];
  Object.assign(process.env, variabili);
  righe.length = 0;
  scritture.length = 0;
  sqlViste.length = 0;
  chiamatePreso.length = 0;
  prossimoId = 1;
}

function socketFinto() {
  const mandati = [];
  return {
    mandati,
    user: { name: 'Bot' },
    async sendMessage(gruppo, contenuto, opzioni) {
      mandati.push({ gruppo, contenuto, opzioni });
      return { key: { id: 'WA' + mandati.length, remoteJid: gruppo, fromMe: true } };
    },
  };
}

// ---------------- interruttore ----------------

test('interruttore: WHATSAPP_ATTIVO=1 accende, 0 o niente spengono', () => {
  for (const [valore, atteso] of [['1', true], [' 1 ', true], ['0', false], ['', false], ['true', false], ['2', false], [undefined, false]]) {
    ambiente(valore === undefined ? {} : { WHATSAPP_ATTIVO: valore });
    assert.equal(wa.attivo(), atteso, String(valore));
  }
});

test('spento: accodaRitiroConsegna non scrive niente (i banchi accettano senza corriere)', async () => {
  ambiente({ WHATSAPP_ATTIVO: '0' });
  assert.equal(await wa.accodaRitiroConsegna(5, 9), null);
  assert.equal(righe.length, 0);
  assert.equal(scritture.length, 0);
});

// ---------------- chi è l'istanza ----------------

test('nome dell\'istanza: quello scritto nel .env (senza spazi) o, se manca, il nome del computer', () => {
  ambiente({ WHATSAPP_ISTANZA: '  locale ' });
  assert.equal(wa._prova.nomeIstanza(), 'locale');
  ambiente({});
  assert.equal(wa._prova.nomeIstanza(), os.hostname());
  ambiente({ WHATSAPP_ISTANZA: '   ' });
  assert.equal(wa._prova.nomeIstanza(), os.hostname());
});

test('miaRiga: con un nome nel .env solo le righe con quel nome; senza, le righe del computer e quelle senza nome (di prima)', () => {
  ambiente({ WHATSAPP_ISTANZA: 'locale' });
  assert.equal(wa._prova.miaRiga({ istanza: 'locale' }), true);
  assert.equal(wa._prova.miaRiga({ istanza: 'vps-1' }), false);
  assert.equal(wa._prova.miaRiga({ istanza: null }), false, 'un server locale con un nome non tocca le righe senza nome: sono della VPS');
  assert.equal(wa._prova.miaRiga(null), false);
  ambiente({});
  assert.equal(wa._prova.miaRiga({ istanza: os.hostname() }), true);
  assert.equal(wa._prova.miaRiga({ istanza: 'locale' }), false);
  assert.equal(wa._prova.miaRiga({ istanza: null }), true, 'la VPS senza nome scritto tratta anche le righe di prima');
  assert.deepEqual(wa._prova.condizioneMia(), ['(istanza = ? OR (istanza IS NULL AND ?::boolean))', [os.hostname(), true]]);
  ambiente({ WHATSAPP_ISTANZA: 'locale' });
  assert.deepEqual(wa._prova.condizioneMia()[1], ['locale', false]);
});

// ---------------- accodamento e invio ----------------

test('un messaggio accodato porta il nome dell\'istanza e lo invia solo lei: due istanze, nessun messaggio doppio', async () => {
  // il server locale accoda il "nuova consegna" della richiesta 5; la VPS (senza nome nel .env) uno della richiesta 6; una riga di prima (senza nome)
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  const id1 = await wa.accodaRitiroConsegna(5, 50);
  assert.equal(righe[0].istanza, 'locale');
  assert.match(righe[0].testo, /Richiesta #5: nuova consegna/);
  assert.equal(id1, righe[0].id);
  righe.push({ id: prossimoId++, request_id: 6, response_id: 60, tipo: 'ritiro_consegna', testo: 'VPS', stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: os.hostname() });
  righe.push({ id: prossimoId++, request_id: 4, response_id: 40, tipo: 'ritiro_consegna', testo: 'di prima', stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: null });

  // il locale manda solo il suo
  let sock = socketFinto();
  wa._prova.impostaSocket(sock, 'gruppo@g.us');
  await wa._prova.inviaMessaggiInCoda();
  assert.deepEqual(sock.mandati.map((m) => m.contenuto.text.slice(0, 22)), ['🚚 Richiesta #5: nuova']);
  assert.deepEqual(righe.map((r) => [r.testo === 'VPS' ? 'vps' : r.testo === 'di prima' ? 'prima' : 'locale', r.stato]), [['locale', 'inviato'], ['vps', 'da_inviare'], ['prima', 'da_inviare']]);

  // la VPS (nessun nome scritto) manda le sue e quelle di prima, mai quella del locale (già inviata comunque)
  ambiente({ WHATSAPP_ATTIVO: '1' }); // azzera le righe: si rimettono
  righe.push({ id: 1, request_id: 5, tipo: 'ritiro_consegna', testo: 'locale', stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: 'locale' });
  righe.push({ id: 2, request_id: 6, tipo: 'ritiro_consegna', testo: 'vps', stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: os.hostname() });
  righe.push({ id: 3, request_id: 4, tipo: 'ritiro_consegna', testo: 'prima', stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: null });
  sock = socketFinto();
  wa._prova.impostaSocket(sock, 'gruppo@g.us');
  await wa._prova.inviaMessaggiInCoda();
  assert.deepEqual(sock.mandati.map((m) => m.contenuto.text).sort(), ['prima', 'vps']);
  assert.deepEqual(righe.map((r) => [r.testo, r.stato]), [['locale', 'da_inviare'], ['vps', 'inviato'], ['prima', 'inviato']]);
  wa._prova.impostaSocket(null);
});

test('l\'eliminazione di un messaggio scaduto la fa l\'istanza che l\'ha mandato, non l\'altra', async () => {
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  righe.push({ id: 1, request_id: 5, tipo: 'ritiro_consegna', testo: 'locale', stato: 'da_eliminare', tentativi: 0, wa_msg_id: 'WA_L', istanza: 'locale' });
  righe.push({ id: 2, request_id: 6, tipo: 'ritiro_consegna', testo: 'vps', stato: 'da_eliminare', tentativi: 0, wa_msg_id: 'WA_V', istanza: 'vps-1' });
  const sock = socketFinto();
  wa._prova.impostaSocket(sock, 'gruppo@g.us');
  await wa._prova.inviaMessaggiInCoda();
  assert.deepEqual(sock.mandati.map((m) => m.contenuto.delete.id), ['WA_L']);
  assert.deepEqual(righe.map((r) => r.stato), ['eliminato', 'da_eliminare']);
  wa._prova.impostaSocket(null);
});

test('un avviso (annullo) va all\'istanza del messaggio di quella richiesta, non a chi lo scrive', async () => {
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  righe.push({ id: prossimoId++, request_id: 8, tipo: 'ritiro_consegna', testo: 'x', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA8', istanza: 'vps-1' });
  assert.equal(await wa._prova.istanzaDellaRichiesta(8), 'vps-1');
  assert.equal(await wa._prova.istanzaDellaRichiesta(99), 'locale', 'senza messaggio di quella richiesta vale questa istanza');
  await wa.avvisaAnnulloOrdine({ id: 12, request_id: 8, corriere_minuti: 30 });
  const esito = righe.find((r) => r.tipo === 'esito');
  assert.equal(esito.istanza, 'vps-1');
  assert.match(esito.testo, /Ordine #12 \(richiesta #8\) annullato dal cliente/);
});

// ---------------- risposte del corriere ----------------

function rispostaCorriere(stanzaId, testo = 'preso 30') {
  return {
    key: { id: 'IN' + Math.random(), remoteJid: 'gruppo@g.us', fromMe: false },
    pushName: 'Marco',
    message: { extendedTextMessage: { text: testo, contextInfo: { stanzaId } } },
  };
}

test('risposta "preso 30": la gestisce l\'istanza proprietaria del messaggio, l\'altra la lascia stare (niente risposte doppie)', async () => {
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  righe.push({ id: 1, request_id: 5, response_id: 50, tipo: 'ritiro_consegna', testo: 'locale', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_L', istanza: 'locale' });
  righe.push({ id: 2, request_id: 6, response_id: 60, tipo: 'ritiro_consegna', testo: 'vps', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_V', istanza: 'vps-1' });
  righe.push({ id: 3, request_id: 4, response_id: 40, tipo: 'ritiro_consegna', testo: 'prima', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_P', istanza: null });
  const sock = socketFinto();
  wa._prova.impostaSocket(sock, 'gruppo@g.us');

  // un corriere risponde al messaggio del locale: lo gestisce il locale, che risponde nel gruppo
  await wa.gestisciMessaggio(rispostaCorriere('WA_L'));
  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 30, nome: 'Marco' }]);
  assert.equal(sock.mandati.length, 1);
  // i minuti sono il tempo per arrivare dal venditore, non quello fino alla consegna
  assert.match(sock.mandati[0].contenuto.text, /✅ Preso! Richiesta #5: arrivi dal venditore in 30 minuti, ritiro entro le \d\d:\d\d\./);
  assert.doesNotMatch(sock.mandati[0].contenuto.text, /in totale|consegna entro/);
  assert.ok(righe[0].preso_il, 'segnato come preso');

  // lo stesso con le risposte ai messaggi della VPS (o di prima): il locale non fa niente
  await wa.gestisciMessaggio(rispostaCorriere('WA_V'));
  await wa.gestisciMessaggio(rispostaCorriere('WA_P', 'preso 20'));
  await wa.gestisciMessaggio(rispostaCorriere('', 'preso 15 #6')); // anche citando solo il numero della richiesta
  assert.equal(chiamatePreso.length, 1);
  assert.equal(sock.mandati.length, 1);
  assert.ok(!righe[1].preso_il && !righe[2].preso_il, 'le righe degli altri non sono toccate');

  // e la VPS (senza nome scritto) gestisce le sue e quelle di prima, non quelle del locale
  ambiente({ WHATSAPP_ATTIVO: '1' });
  const vps = os.hostname();
  righe.push({ id: 1, request_id: 5, response_id: 50, tipo: 'ritiro_consegna', testo: 'locale', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_L', istanza: 'locale' });
  righe.push({ id: 2, request_id: 6, response_id: 60, tipo: 'ritiro_consegna', testo: 'vps', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_V', istanza: vps });
  righe.push({ id: 3, request_id: 4, response_id: 40, tipo: 'ritiro_consegna', testo: 'prima', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_P', istanza: null });
  const sockVps = socketFinto();
  wa._prova.impostaSocket(sockVps, 'gruppo@g.us');
  await wa.gestisciMessaggio(rispostaCorriere('WA_L'));
  assert.equal(chiamatePreso.length, 0, 'il messaggio del locale non è suo');
  await wa.gestisciMessaggio(rispostaCorriere('WA_V', 'preso 45'));
  await wa.gestisciMessaggio(rispostaCorriere('WA_P', 'preso 20'));
  assert.deepEqual(chiamatePreso.map((c) => [c.responseId, c.minuti]), [[60, 45], [40, 20]]);
  assert.equal(sockVps.mandati.length, 2);
  wa._prova.impostaSocket(null);
});

test('la risposta del bot di un\'altra istanza ("✅ Preso!", che arriva come messaggio "mio" sullo stesso numero) non viene letta come una risposta', async () => {
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  righe.push({ id: 1, request_id: 6, response_id: 60, tipo: 'ritiro_consegna', testo: 'vps', stato: 'inviato', tentativi: 0, wa_msg_id: 'WA_V', istanza: 'vps-1' });
  const sock = socketFinto();
  wa._prova.impostaSocket(sock, 'gruppo@g.us');
  const eco = {
    key: { id: 'ECO1', remoteJid: 'gruppo@g.us', fromMe: true },
    message: { extendedTextMessage: { text: '✅ Preso! Richiesta #6: arrivi dal venditore in 30 minuti, ritiro entro le 10:30.', contextInfo: { stanzaId: 'WA_V' } } },
  };
  await wa.gestisciMessaggio(eco);
  assert.equal(chiamatePreso.length, 0);
  assert.equal(sock.mandati.length, 0);
  wa._prova.impostaSocket(null);
});

test('il messaggio nel gruppo: i minuti sono il tempo per arrivare dal venditore (tappa 1), non il tempo fino alla consegna', () => {
  ambiente({ WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale' });
  const testo = wa.testoRitiroConsegna({
    richiestaId: 12,
    banco: { nome: 'BOREA SRL — Fegino', indirizzo: 'Via Castel Morrone 1', lat: 44.44, lng: 8.93 },
    consegnaA: { indirizzo: 'Via Puggia 22/3, 16131 Genova (GE)', lat: 44.43, lng: 8.95 },
  });
  // le due tappe ci sono ancora (il corriere deve sapere dove portare la merce)
  assert.match(testo, /Richiesta #12: nuova consegna/);
  assert.match(testo, /1️⃣ PRELIEVO MERCI\nBOREA SRL — Fegino/);
  assert.match(testo, /2️⃣ CONSEGNA MERCE\nVia Puggia 22\/3/);
  // ma i minuti da scrivere sono quelli per arrivare dal venditore
  assert.match(testo, /«preso <minuti>» \(es\. preso 30\)\. I minuti sono il tempo che ci metti ad arrivare dal venditore \(tappa 1, prelievo merci\)\./);
  assert.doesNotMatch(testo, /tempo totale|dal ritiro alla consegna/);
});
