// Sondaggio nel gruppo dei corrieri (src/whatsapp.js, WHATSAPP_SONDAGGIO=1): il messaggio "nuova consegna" si accompagna a un sondaggio WhatsApp con i minuti; il primo voto
// prende la consegna. I voti arrivano CIFRATI: qui si cifrano con lo stesso algoritmo di WhatsApp (quello che Baileys decifra con decryptPollVote), con la chiave che il
// modulo ha scelto e salvato. DB in memoria e socket finto: nessun accesso al database vero né a WhatsApp. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const radice = path.join(__dirname, '..');

// ---------------- DB in memoria ----------------
const righe = []; // whatsapp_messaggi
let prossimoId = 1;
let colonnaPresente = true; // la colonna del blocco di schema c'è?
let insertSondaggioFallisce = false;
let destinazioneRichiesta = undefined; // requests.destinazione (l'indirizzo scritto nel carrello)
const interrogazioniSchema = [];

function esegui(sql, p) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/^SELECT 1 AS si FROM information_schema\.columns WHERE table_schema = current_schema\(\) AND table_name = 'whatsapp_messaggi' AND column_name = 'segreto_sondaggio'$/.test(s)) {
    interrogazioniSchema.push(s);
    return colonnaPresente ? { si: 1 } : null;
  }
  let m;
  if ((m = /^INSERT INTO whatsapp_messaggi \(request_id, response_id, tipo, testo, istanza(?:, segreto_sondaggio)?\) VALUES \(\?, \?, '(ritiro_consegna|sondaggio)', \?, \?(?:, \?)?\)$/.exec(s))) {
    if (m[1] === 'sondaggio' && insertSondaggioFallisce) throw new Error('INSERT rifiutato');
    const riga = { id: prossimoId++, stato: 'da_inviare', tentativi: 0, wa_msg_id: null, preso_il: null, tipo: m[1], request_id: p[0], response_id: p[1], testo: p[2], istanza: p[3], segreto_sondaggio: p[4] || null };
    righe.push(riga);
    return { changes: 1, lastInsertRowid: riga.id };
  }
  if ((m = /^INSERT INTO whatsapp_messaggi \(request_id, response_id, order_id, tipo, testo, istanza, segreto_sondaggio\) VALUES \(\?, \?, \?, 'consegna', \?, \?, \?\)$/.exec(s))) {
    const riga = { id: prossimoId++, stato: 'da_inviare', tentativi: 0, wa_msg_id: null, preso_il: null, tipo: 'consegna', request_id: p[0], response_id: p[1], order_id: p[2], testo: p[3], istanza: p[4], segreto_sondaggio: p[5] };
    righe.push(riga);
    return { changes: 1, lastInsertRowid: riga.id };
  }
  if (/^INSERT INTO whatsapp_messaggi \(request_id, response_id, tipo, testo, istanza\) VALUES \(\?, \?, 'esito', \?, \?\)$/.test(s)) {
    const riga = { id: prossimoId++, stato: 'da_inviare', tentativi: 0, wa_msg_id: null, preso_il: null, tipo: 'esito', request_id: p[0], response_id: p[1], testo: p[2], istanza: p[3], segreto_sondaggio: null };
    righe.push(riga);
    return { changes: 1, lastInsertRowid: riga.id };
  }
  if (/^SELECT istanza FROM whatsapp_messaggi WHERE request_id = \? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1$/.test(s)) return righe.filter((x) => x.request_id === p[0] && x.tipo === 'ritiro_consegna').pop() || null;
  // dopo il "preso": il sondaggio dei minuti sparisce dal gruppo
  if (/^UPDATE whatsapp_messaggi SET stato = CASE WHEN stato = 'da_inviare' THEN 'annullato' ELSE 'da_eliminare' END WHERE response_id = \? AND tipo = 'sondaggio' AND stato IN \('da_inviare', 'inviato'\)$/.test(s)) {
    const toccate = righe.filter((r) => r.response_id === p[0] && r.tipo === 'sondaggio' && ['da_inviare', 'inviato'].includes(r.stato));
    for (const r of toccate) r.stato = r.stato === 'da_inviare' ? 'annullato' : 'da_eliminare';
    return { changes: toccate.length };
  }
  // voto sul sondaggio "consegna"
  if (/^UPDATE whatsapp_messaggi SET preso_il = NOW\(\) WHERE id = \? AND preso_il IS NULL$/.test(s)) {
    const r = righe.find((x) => x.id === p[0] && !x.preso_il);
    if (!r) return { changes: 0 };
    r.preso_il = new Date();
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET preso_il = NULL WHERE id = \?$/.test(s)) {
    righe.find((x) => x.id === p[0]).preso_il = null;
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET stato = 'da_eliminare' WHERE id = \? AND stato = 'inviato'$/.test(s)) {
    const r = righe.find((x) => x.id === p[0] && x.stato === 'inviato');
    if (r) r.stato = 'da_eliminare';
    return { changes: r ? 1 : 0 };
  }
  if (/^SELECT \* FROM orders WHERE id = \?$/.test(s)) return { id: p[0], cliente_id: 7, request_id: 5, distributor_id: 2, consegnato_il: null };
  if (/^UPDATE whatsapp_messaggi SET testo = \? WHERE id = \?$/.test(s)) {
    righe.find((x) => x.id === p[1]).testo = p[0];
    return { changes: 1 };
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
  if (/^UPDATE whatsapp_messaggi SET tentativi = tentativi \+ 1, errore = \? WHERE id = \?$/.test(s)) {
    const r = righe.find((x) => x.id === p[1]);
    r.tentativi += 1;
    r.errore = p[0];
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET stato = 'eliminato', errore = NULL WHERE id = \?$/.test(s)) {
    righe.find((x) => x.id === p[0]).stato = 'eliminato';
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET preso_il = NOW\(\) WHERE id = \?$/.test(s)) {
    righe.find((x) => x.id === p[0]).preso_il = new Date();
    return { changes: 1 };
  }
  if (/^UPDATE whatsapp_messaggi SET preso_il = NOW\(\) WHERE response_id = \? AND tipo IN \('ritiro_consegna', 'sondaggio'\) AND preso_il IS NULL$/.test(s)) {
    for (const r of righe) if (r.response_id === p[0] && ['ritiro_consegna', 'sondaggio'].includes(r.tipo) && !r.preso_il) r.preso_il = new Date();
    return { changes: 1 };
  }
  // ritiraRichiesta: la richiesta non serve più, i messaggi (e il sondaggio) non presi spariscono dal gruppo
  if (/^UPDATE whatsapp_messaggi SET stato = CASE WHEN stato = 'da_inviare' THEN 'annullato' ELSE 'da_eliminare' END WHERE request_id = \? AND tipo IN \('ritiro_consegna', 'sondaggio'\) AND preso_il IS NULL AND stato IN \('da_inviare', 'inviato'\) AND \(\?::int IS NULL OR response_id IS DISTINCT FROM \?::int\)$/.test(s)) {
    const toccate = righe.filter((r) => r.request_id === p[0] && ['ritiro_consegna', 'sondaggio'].includes(r.tipo) && !r.preso_il && ['da_inviare', 'inviato'].includes(r.stato) && (p[1] == null || r.response_id !== p[1]));
    for (const r of toccate) r.stato = r.stato === 'da_inviare' ? 'annullato' : 'da_eliminare';
    return { changes: toccate.length };
  }
  if (/^SELECT \* FROM whatsapp_messaggi WHERE wa_msg_id = \? AND tipo IN \('sondaggio', 'consegna'\)$/.test(s)) return righe.find((x) => x.wa_msg_id === p[0] && ['sondaggio', 'consegna'].includes(x.tipo)) || null;
  if (/^SELECT \* FROM whatsapp_messaggi WHERE wa_msg_id = \? AND tipo = 'ritiro_consegna'$/.test(s)) return righe.find((x) => x.wa_msg_id === p[0] && x.tipo === 'ritiro_consegna') || null;
  if (/^SELECT \* FROM whatsapp_messaggi WHERE request_id = \? AND tipo = 'ritiro_consegna' ORDER BY id DESC LIMIT 1$/.test(s)) return righe.filter((x) => x.request_id === p[0] && x.tipo === 'ritiro_consegna').pop() || null;
  if (/^SELECT 1 AS si FROM whatsapp_messaggi WHERE wa_msg_id = \?$/.test(s)) return righe.find((x) => x.wa_msg_id === p[0]) ? { si: 1 } : null;
  if (/^SELECT \* FROM requests WHERE id = \?$/.test(s)) return { id: p[0], cliente_id: 7, destinazione: destinazioneRichiesta };
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

// richieste.corriereHaPreso: finto, registra le chiamate; `esitoPreso` decide cosa risponde
const chiamatePreso = [];
let esitoPreso = { esito: 'preso', ordineId: 300 };
const percorsoRichieste = require.resolve(path.join(radice, 'src/richieste.js'));
require.cache[percorsoRichieste] = {
  id: percorsoRichieste, filename: percorsoRichieste, loaded: true,
  exports: { corriereHaPreso: async (responseId, minuti, nome) => { chiamatePreso.push({ responseId, minuti, nome }); return esitoPreso; } },
};

// flusso_cliente.segnaConsegnatoDalCorriere: finto, registra gli ordini segnati; `consegnaFallisce` lo fa lanciare
const ordiniSegnati = [];
let consegnaFallisce = false;
const percorsoFlusso = require.resolve(path.join(radice, 'src/flusso_cliente.js'));
require.cache[percorsoFlusso] = {
  id: percorsoFlusso, filename: percorsoFlusso, loaded: true,
  exports: { segnaConsegnatoDalCorriere: async (ordine) => { if (consegnaFallisce) throw new Error('database non raggiungibile'); ordiniSegnati.push(ordine.id); } },
};

const wa = require(path.join(radice, 'src/whatsapp.js'));
let baileys;
test.before(async () => { baileys = await import('baileys'); });

const GRUPPO = 'gruppo@g.us';
const IO = '39000111222:5@s.whatsapp.net'; // il numero del bot (con il dispositivo)
const IO_LID = '123456789:5@lid';
const MARCO = '39333444555@s.whatsapp.net';
const MARCO_LID = '987654321@lid';

function ambiente(variabili = {}) {
  wa._prova.impostaSocket(null); // un test fallito a metà non deve lasciare il suo socket al successivo
  for (const k of ['WHATSAPP_ATTIVO', 'WHATSAPP_ISTANZA', 'WHATSAPP_GRUPPO', 'WHATSAPP_SONDAGGIO', 'WHATSAPP_SONDAGGIO_MINUTI']) delete process.env[k];
  Object.assign(process.env, { WHATSAPP_ATTIVO: '1', WHATSAPP_ISTANZA: 'locale', WHATSAPP_SONDAGGIO: '1' }, variabili);
  righe.length = 0;
  chiamatePreso.length = 0;
  interrogazioniSchema.length = 0;
  prossimoId = 1;
  colonnaPresente = true;
  insertSondaggioFallisce = false;
  esitoPreso = { esito: 'preso', ordineId: 300 };
  ordiniSegnati.length = 0;
  consegnaFallisce = false;
  destinazioneRichiesta = undefined;
  wa._prova.azzeraControlloColonna();
  wa._prova.votiGestiti.clear();
}

function socketFinto() {
  const mandati = [];
  return {
    mandati,
    user: { id: IO, lid: IO_LID, name: 'Bot' },
    async sendMessage(gruppo, contenuto, opzioni) {
      mandati.push({ gruppo, contenuto, opzioni });
      return { key: { id: 'WA' + mandati.length, remoteJid: gruppo, fromMe: true } };
    },
  };
}

// Il voto come lo manda WhatsApp: PollVoteMessage con gli SHA-256 delle opzioni scelte, cifrato (AES-256-GCM) con una chiave derivata dal segreto del sondaggio, dall'id del
// sondaggio e dagli indirizzi di chi l'ha creato e di chi vota (lo stesso calcolo di Baileys: decryptPollVote).
function cifraVoto(etichette, { segreto, pollId, creatore, votante }) {
  const { proto, aesEncryptGCM, hmacSign, sha256 } = baileys;
  const chiaro = proto.Message.PollVoteMessage.encode({ selectedOptions: etichette.map((e) => sha256(Buffer.from(e))) }).finish();
  const firma = Buffer.concat([Buffer.from(pollId), Buffer.from(creatore), Buffer.from(votante), Buffer.from('Poll Vote'), Buffer.from([1])]);
  const chiave0 = hmacSign(segreto, new Uint8Array(32), 'sha256');
  const chiave = hmacSign(firma, chiave0, 'sha256');
  const iv = crypto.randomBytes(12);
  return { encPayload: aesEncryptGCM(chiaro, chiave, iv, Buffer.from(`${pollId}\u0000${votante}`)), encIv: iv };
}

// Un voto in arrivo nel gruppo. `votoCifrato` = { encPayload, encIv }.
function votoInArrivo(votoCifrato, { pollId, partecipante = MARCO, partecipanteAlt, fromMe = false, nome = 'Marco' } = {}) {
  return {
    key: { id: 'VOTO' + Math.random(), remoteJid: GRUPPO, fromMe, ...(fromMe ? {} : { participant: partecipante, participantAlt: partecipanteAlt }) },
    pushName: fromMe ? undefined : nome,
    message: { pollUpdateMessage: { pollCreationMessageKey: { id: pollId, remoteJid: GRUPPO, fromMe: true }, vote: votoCifrato, senderTimestampMs: Date.now() } },
  };
}

// Mette in coda la richiesta 5 (risposta 50), la manda nel gruppo e dà indietro il necessario per votare.
async function consegnaMandata(sock) {
  await wa.accodaRitiroConsegna(5, 50);
  wa._prova.impostaSocket(sock, GRUPPO);
  await wa._prova.inviaMessaggiInCoda();
  const sondaggio = righe.find((r) => r.tipo === 'sondaggio');
  return { sondaggio, segreto: Buffer.from(sondaggio.segreto_sondaggio, 'base64'), pollId: sondaggio.wa_msg_id, etichette: JSON.parse(sondaggio.testo).opzioni.map((o) => o.etichetta) };
}

// ---------------- impostazioni ----------------

test('il sondaggio è spento di default e si accende solo con WHATSAPP_SONDAGGIO=1', () => {
  for (const [valore, atteso] of [[undefined, false], ['', false], ['0', false], ['true', false], ['1', true], [' 1 ', true]]) {
    ambiente(valore === undefined ? { WHATSAPP_SONDAGGIO: undefined } : { WHATSAPP_SONDAGGIO: valore });
    if (valore === undefined) delete process.env.WHATSAPP_SONDAGGIO;
    assert.equal(wa._prova.sondaggioAcceso(), atteso, String(valore));
  }
});

test('le opzioni: 5, 10, 15, 20, 30, 45, 60, 90 minuti; WHATSAPP_SONDAGGIO_MINUTI le cambia (senza doppioni né valori fuori misura, al massimo 12, almeno 2)', () => {
  ambiente();
  assert.deepEqual(wa._prova.minutiDelSondaggio(), [5, 10, 15, 20, 30, 45, 60, 90]);
  ambiente({ WHATSAPP_SONDAGGIO_MINUTI: '10, 20 ,30,20,0,-5,abc,601,120' });
  assert.deepEqual(wa._prova.minutiDelSondaggio(), [10, 20, 30, 120]);
  ambiente({ WHATSAPP_SONDAGGIO_MINUTI: Array.from({ length: 20 }, (_, i) => i + 1).join(',') });
  assert.equal(wa._prova.minutiDelSondaggio().length, 12, 'il massimo di WhatsApp');
  ambiente({ WHATSAPP_SONDAGGIO_MINUTI: '30' });
  assert.deepEqual(wa._prova.minutiDelSondaggio(), [5, 10, 15, 20, 30, 45, 60, 90], 'una sola opzione non è un sondaggio: valgono quelle di default');
  ambiente({ WHATSAPP_SONDAGGIO_MINUTI: 'niente' });
  assert.equal(wa._prova.minutiDelSondaggio().length, 8);
});

test('etichette delle opzioni: leggibili e tutte diverse (il testo identifica l\'opzione votata)', () => {
  const e = wa._prova.etichettaMinuti;
  assert.deepEqual([1, 5, 45, 59, 60, 75, 90, 120, 150, 135].map(e), ['1 minuto', '5 minuti', '45 minuti', '59 minuti', '1 ora', '1 ora e 15 minuti', '1 ora e mezza', '2 ore', '2 ore e mezza', '2 ore e 15 minuti']);
  const tutte = Array.from({ length: 600 }, (_, i) => e(i + 1));
  assert.equal(new Set(tutte).size, 600);
});

// ---------------- accodamento e invio ----------------

test('spento: nessun sondaggio e il messaggio è quello di sempre (nemmeno una query sulla colonna)', async () => {
  ambiente({ WHATSAPP_SONDAGGIO: '0' });
  await wa.accodaRitiroConsegna(5, 50);
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna']);
  assert.match(righe[0].testo, /Per prenderla rispondi a questo messaggio con «preso <minuti>» \(es\. preso 30\)\. I minuti sono il tempo/);
  assert.doesNotMatch(righe[0].testo, /sondaggio/);
  assert.equal(interrogazioniSchema.length, 0);
});

test('acceso: due righe, il messaggio (con le istruzioni per votare) e poi il sondaggio con la sua chiave a 32 byte e domanda e opzioni in JSON', async () => {
  ambiente();
  await wa.accodaRitiroConsegna(5, 50);
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna', 'sondaggio'], 'il sondaggio dopo il messaggio: le righe partono in ordine di id');
  assert.match(righe[0].testo, /Richiesta #5: nuova consegna/);
  assert.match(righe[0].testo, /1️⃣ PRELIEVO MERCI\nBOREA SRL — Fegino/);
  assert.match(righe[0].testo, /vota nel sondaggio qui sotto.*Oppure rispondi a questo messaggio con «preso <minuti>»/);
  const sondaggio = righe[1];
  assert.deepEqual([sondaggio.request_id, sondaggio.response_id, sondaggio.istanza, sondaggio.stato], [5, 50, 'locale', 'da_inviare']);
  assert.equal(Buffer.from(sondaggio.segreto_sondaggio, 'base64').length, 32);
  assert.notEqual(sondaggio.segreto_sondaggio, righe[0].segreto_sondaggio);
  const dati = JSON.parse(sondaggio.testo);
  assert.equal(dati.domanda, 'Richiesta #5: in quanti minuti arrivi dal venditore?');
  assert.deepEqual(dati.opzioni.map((o) => o.minuti), [5, 10, 15, 20, 30, 45, 60, 90]);
  assert.equal(dati.opzioni[6].etichetta, '1 ora');
  // due richieste, due chiavi diverse
  await wa.accodaRitiroConsegna(6, 60);
  assert.notEqual(righe[3].segreto_sondaggio, sondaggio.segreto_sondaggio);
});

test('senza la colonna del blocco di schema il sondaggio non parte, il messaggio non lo promette e si riguarda dopo 5 minuti', async () => {
  ambiente();
  colonnaPresente = false;
  const errori = [];
  const originale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await wa.accodaRitiroConsegna(5, 50);
    await wa.accodaRitiroConsegna(6, 60);
  } finally {
    console.error = originale;
  }
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna', 'ritiro_consegna']);
  assert.doesNotMatch(righe[0].testo, /sondaggio/);
  assert.equal(interrogazioniSchema.length, 1, 'la colonna si guarda una volta, non a ogni messaggio');
  assert.equal(errori.length, 1);
  assert.match(errori[0], /manca la colonna whatsapp_messaggi\.segreto_sondaggio.*"WhatsApp: sondaggio per prendere la consegna"/);
  // applicato lo schema, il ricontrollo (azzerato qui al posto dei 5 minuti) lo trova e il sondaggio parte da solo
  colonnaPresente = true;
  wa._prova.azzeraControlloColonna();
  await wa.accodaRitiroConsegna(7, 70);
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna', 'ritiro_consegna', 'ritiro_consegna', 'sondaggio']);
});

test('se la riga del sondaggio non si scrive il messaggio torna quello di sempre', async () => {
  ambiente();
  insertSondaggioFallisce = true;
  const originale = console.error;
  console.error = () => {};
  try {
    await wa.accodaRitiroConsegna(5, 50);
  } finally {
    console.error = originale;
  }
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna']);
  assert.doesNotMatch(righe[0].testo, /sondaggio/);
  assert.match(righe[0].testo, /rispondi a questo messaggio con «preso <minuti>»/);
});

test('l\'invio: prima il testo, poi il sondaggio a scelta singola con le opzioni e la chiave salvata; l\'id del sondaggio nel gruppo si ricorda', async () => {
  ambiente();
  const sock = socketFinto();
  const { sondaggio, segreto } = await consegnaMandata(sock);
  assert.equal(sock.mandati.length, 2);
  assert.match(sock.mandati[0].contenuto.text, /Richiesta #5: nuova consegna/);
  const poll = sock.mandati[1].contenuto.poll;
  assert.equal(poll.name, 'Richiesta #5: in quanti minuti arrivi dal venditore?');
  assert.deepEqual(poll.values, ['5 minuti', '10 minuti', '15 minuti', '20 minuti', '30 minuti', '45 minuti', '1 ora', '1 ora e mezza']);
  assert.equal(poll.selectableCount, 1, 'si sceglie una sola opzione');
  assert.ok(Buffer.isBuffer(poll.messageSecret) && poll.messageSecret.equals(segreto), 'Baileys usa la chiave che abbiamo salvato, non una a caso');
  assert.deepEqual([sondaggio.stato, sondaggio.wa_msg_id], ['inviato', 'WA2']);
  wa._prova.impostaSocket(null);
});

test('un sondaggio senza chiave non parte (si riprova, senza mandare niente)', async () => {
  ambiente();
  const sock = socketFinto();
  righe.push({ id: prossimoId++, request_id: 5, response_id: 50, tipo: 'sondaggio', testo: JSON.stringify(wa._prova.datiSondaggio(5)), stato: 'da_inviare', tentativi: 0, wa_msg_id: null, istanza: 'locale', segreto_sondaggio: null });
  wa._prova.impostaSocket(sock, GRUPPO);
  const originale = console.error;
  console.error = () => {};
  try {
    await wa._prova.inviaMessaggiInCoda();
  } finally {
    console.error = originale;
  }
  assert.equal(sock.mandati.length, 0);
  assert.equal(righe[0].tentativi, 1);
  wa._prova.impostaSocket(null);
});

// ---------------- voti ----------------

test('un voto: il primo che sceglie "30 minuti" prende la consegna con quei minuti; la risposta nomina chi ha votato e non cita niente; messaggio e sondaggio risultano presi', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock);
  const votoCifrato = cifraVoto(['30 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO });
  await wa.gestisciMessaggio(votoInArrivo(votoCifrato, { pollId }));

  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 30, nome: 'Marco' }]);
  const risposta = sock.mandati[2];
  assert.match(risposta.contenuto.text, /^✅ Preso da Marco! Richiesta #5: arrivi dal venditore in 30 minuti, ritiro entro le \d\d:\d\d\.$/);
  assert.equal(risposta.opzioni, undefined, 'una risposta a un voto non cita il voto');
  assert.deepEqual(righe.filter((r) => r.tipo !== 'consegna' && r.tipo !== 'esito').map((r) => !!r.preso_il), [true, true], 'il messaggio e il sondaggio della stessa risposta sono presi insieme');
  wa._prova.impostaSocket(null);
});

test('ogni opzione dà i suoi minuti, anche "1 ora" e "1 ora e mezza"', async () => {
  const attesi = { '5 minuti': 5, '10 minuti': 10, '45 minuti': 45, '1 ora': 60, '1 ora e mezza': 90 };
  for (const [etichetta, minuti] of Object.entries(attesi)) {
    ambiente();
    const sock = socketFinto();
    const { segreto, pollId } = await consegnaMandata(sock);
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto([etichetta], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));
    assert.equal(chiamatePreso.at(-1).minuti, minuti, etichetta);
    wa._prova.impostaSocket(null);
  }
});

test('indirizzi "nuovi" (LID): chi vota o ha creato il sondaggio può comparire in due forme, si provano tutte', async () => {
  // il votante cifra con l'indirizzo LID (che arriva come `participant`), il numero normale è in participantAlt
  ambiente();
  let sock = socketFinto();
  let { segreto, pollId } = await consegnaMandata(sock);
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['20 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO_LID }), { pollId, partecipante: MARCO_LID, partecipanteAlt: MARCO }));
  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 20, nome: 'Marco' }]);
  wa._prova.impostaSocket(null);

  // il votante cifra con il numero normale, che arriva solo come participantAlt, e il creatore con il suo LID
  ambiente();
  sock = socketFinto();
  ({ segreto, pollId } = await consegnaMandata(sock));
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['15 minuti'], { segreto, pollId, creatore: '123456789@lid', votante: MARCO }), { pollId, partecipante: MARCO_LID, partecipanteAlt: MARCO }));
  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 15, nome: 'Marco' }]);
  wa._prova.impostaSocket(null);
});

test('il voto del telefono del bot stesso (messaggio "mio") vale come quello di un corriere', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock);
  const voto = cifraVoto(['10 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: '39000111222@s.whatsapp.net' });
  await wa.gestisciMessaggio(votoInArrivo(voto, { pollId, fromMe: true }));
  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 10, nome: 'Bot' }]);
  assert.match(sock.mandati[2].contenuto.text, /^✅ Preso da Bot! Richiesta #5/);
  wa._prova.impostaSocket(null);
});

test('chi vota dopo trova "già presa da Marco"; chi cambia o ripete il voto non fa rispondere due volte', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock);
  const creatore = '39000111222@s.whatsapp.net';
  const LUCA = '39320000001@s.whatsapp.net';

  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['30 minuti'], { segreto, pollId, creatore, votante: MARCO }), { pollId }));
  assert.equal(chiamatePreso.length, 1);

  // Luca vota dopo: la consegna è di Marco
  esitoPreso = { esito: 'gia_preso', nome: 'Marco' };
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore, votante: LUCA }), { pollId, partecipante: LUCA, nome: 'Luca' }));
  assert.equal(chiamatePreso.length, 2);
  assert.equal(sock.mandati.at(-1).contenuto.text, 'La richiesta #5 è già stata presa da Marco.');
  assert.equal(sock.mandati.at(-1).opzioni, undefined);

  // Marco cambia idea (o il voto arriva due volte) e Luca anche: niente di nuovo, né chiamate né risposte
  const prima = sock.mandati.length;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['45 minuti'], { segreto, pollId, creatore, votante: MARCO }), { pollId }));
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['60 minuti'.replace('60 minuti', '1 ora')], { segreto, pollId, creatore, votante: LUCA }), { pollId, partecipante: LUCA, nome: 'Luca' }));
  assert.equal(chiamatePreso.length, 2);
  assert.equal(sock.mandati.length, prima);
  wa._prova.impostaSocket(null);
});

test('richiesta già scaduta: chi vota riceve "scaduta"', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock);
  esitoPreso = { esito: 'scaduta' };
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['20 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));
  assert.equal(sock.mandati.at(-1).contenuto.text, 'La richiesta #5 è scaduta: non è più disponibile.');
  assert.deepEqual(righe.map((r) => !!r.preso_il), [false, false], 'non è presa');
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna', 'sondaggio'], 'e il sondaggio "consegnato" non parte');
  assert.deepEqual(righe.map((r) => r.stato), ['inviato', 'inviato'], 'il sondaggio dei minuti resta');
  wa._prova.impostaSocket(null);
});

test('voti da ignorare: voto ritirato, opzione sconosciuta, sondaggio che non è nostro, altra istanza, voto che non si decifra', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock);
  const creatore = '39000111222@s.whatsapp.net';
  const prima = sock.mandati.length;
  const errori = [];
  const originale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    // voto ritirato (nessuna opzione scelta)
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto([], { segreto, pollId, creatore, votante: MARCO }), { pollId }));
    // un'opzione che nel sondaggio non c'è
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['7 minuti'], { segreto, pollId, creatore, votante: MARCO }), { pollId }));
    // un altro sondaggio del gruppo (non è nostro)
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId: 'ALTRO', creatore, votante: MARCO }), { pollId: 'ALTRO' }));
    // cifrato con la chiave sbagliata, per un altro votante, senza `vote`
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto: crypto.randomBytes(32), pollId, creatore, votante: MARCO }), { pollId }));
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore, votante: '39999999999@s.whatsapp.net' }), { pollId }));
    await wa.gestisciMessaggio(votoInArrivo(undefined, { pollId }));
    // il sondaggio è di un'altra istanza (la VPS, o un server locale): la lascia stare
    righe.find((r) => r.tipo === 'sondaggio').istanza = 'vps-1';
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore, votante: MARCO }), { pollId }));
  } finally {
    console.error = originale;
  }
  assert.equal(chiamatePreso.length, 0, 'nessuna consegna presa');
  assert.equal(sock.mandati.length, prima, 'nessuna risposta nel gruppo');
  assert.equal(errori.length, 2, 'i due voti che non si decifrano (chiave e votante sbagliati) si scrivono nel log; il voto senza contenuto no');
  assert.match(errori[0], /voto del sondaggio della richiesta #5 non leggibile/);
  wa._prova.impostaSocket(null);
});

test('"preso 30" scritto a mano funziona ancora e segna preso anche il sondaggio', async () => {
  ambiente();
  const sock = socketFinto();
  const { sondaggio } = await consegnaMandata(sock);
  await wa.gestisciMessaggio({
    key: { id: 'IN1', remoteJid: GRUPPO, fromMe: false, participant: MARCO },
    pushName: 'Marco',
    message: { extendedTextMessage: { text: 'preso 30', contextInfo: { stanzaId: 'WA1' } } },
  });
  assert.deepEqual(chiamatePreso, [{ responseId: 50, minuti: 30, nome: 'Marco' }]);
  assert.match(sock.mandati[2].contenuto.text, /^✅ Preso! Richiesta #5: arrivi dal venditore in 30 minuti/);
  assert.deepEqual(sock.mandati[2].opzioni && Object.keys(sock.mandati[2].opzioni), ['quoted'], 'qui la risposta cita il messaggio del corriere, come prima');
  assert.ok(sondaggio.preso_il, 'il sondaggio della stessa risposta è preso: non sparisce dal gruppo alla chiusura');
  wa._prova.impostaSocket(null);
});

// ---------------- chiusura ----------------

test('richiesta scaduta o annullata: messaggio e sondaggio spariscono dal gruppo insieme; se uno è già preso restano entrambi', async () => {
  ambiente();
  const sock = socketFinto();
  await consegnaMandata(sock);
  await wa.ritiraRichiesta(5); // mette le righe da eliminare e fa partire da sé la coda (senza aspettarla)
  await wa.svuotaCoda();
  assert.deepEqual(sock.mandati.slice(2).map((m) => m.contenuto.delete.id), ['WA1', 'WA2']);
  assert.deepEqual(righe.map((r) => r.stato), ['eliminato', 'eliminato']);
  wa._prova.impostaSocket(null);

  // preso da qualcuno: né il messaggio né il sondaggio si toccano
  ambiente();
  const sock2 = socketFinto();
  const { segreto, pollId } = await consegnaMandata(sock2);
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['30 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));
  await wa.ritiraRichiesta(5);
  assert.deepEqual(righe.filter((r) => r.tipo === 'ritiro_consegna' || r.tipo === 'consegna').map((r) => r.stato), ['inviato', 'inviato']);
  wa._prova.impostaSocket(null);
});

// ---------------- dopo il "preso": il sondaggio dei minuti sparisce, compare quello della consegna ----------------

test('dopo il "preso": risposta nel gruppo, il sondaggio dei minuti viene eliminato (il messaggio resta) e subito dopo parte il sondaggio "Ordine #N: consegna"', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId, sondaggio } = await consegnaMandata(sock);
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));

  assert.match(sock.mandati[2].contenuto.text, /^✅ Preso da Marco! Richiesta #5: arrivi dal venditore in 10 minuti, ritiro entro le \d\d:\d\d\.$/);
  const poll = sock.mandati[3].contenuto.poll;
  assert.equal(poll.name, 'Ordine #300: consegna');
  assert.deepEqual(poll.values, ['🚀 Segna come Consegnato', '⏳ Ancora in viaggio']);
  assert.equal(poll.selectableCount, 1);
  assert.deepEqual(sock.mandati[4].contenuto.delete, { remoteJid: GRUPPO, fromMe: true, id: pollId }, 'il sondaggio dei minuti sparisce dal gruppo');
  assert.equal(sock.mandati.length, 5, 'il messaggio "nuova consegna" non si tocca');
  assert.equal(sondaggio.stato, 'eliminato');
  const consegna = righe.find((r) => r.tipo === 'consegna');
  assert.deepEqual([consegna.request_id, consegna.response_id, consegna.order_id, consegna.istanza, consegna.stato, consegna.wa_msg_id], [5, 50, 300, 'locale', 'inviato', 'WA4']);
  assert.ok(poll.messageSecret.equals(Buffer.from(consegna.segreto_sondaggio, 'base64')) && poll.messageSecret.length === 32);
  assert.notEqual(consegna.segreto_sondaggio, sondaggio.segreto_sondaggio);
  assert.equal(righe.find((r) => r.tipo === 'ritiro_consegna').stato, 'inviato');
  wa._prova.impostaSocket(null);
});

test('anche con "preso 30" scritto a mano il sondaggio dei minuti sparisce e parte quello della consegna', async () => {
  ambiente();
  const sock = socketFinto();
  const { sondaggio } = await consegnaMandata(sock);
  await wa.gestisciMessaggio({
    key: { id: 'IN1', remoteJid: GRUPPO, fromMe: false, participant: MARCO },
    pushName: 'Marco',
    message: { extendedTextMessage: { text: 'preso 30', contextInfo: { stanzaId: 'WA1' } } },
  });
  assert.equal(sondaggio.stato, 'eliminato');
  assert.equal(sock.mandati.some((m) => m.contenuto.poll && m.contenuto.poll.name === 'Ordine #300: consegna'), true);
  wa._prova.impostaSocket(null);
});

test('senza ordine (non è ancora nato) il sondaggio dei minuti sparisce lo stesso ma quello della consegna non parte, e si scrive nel log', async () => {
  ambiente();
  esitoPreso = { esito: 'preso' };
  const sock = socketFinto();
  const { segreto, pollId, sondaggio } = await consegnaMandata(sock);
  const errori = [];
  const originale = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));
  } finally {
    console.error = originale;
  }
  assert.equal(sondaggio.stato, 'eliminato');
  assert.equal(righe.some((r) => r.tipo === 'consegna'), false);
  assert.match(errori.join('\n'), /l'ordine non è ancora nato/);
  wa._prova.impostaSocket(null);
});

test('con i sondaggi spenti "preso 30" funziona come prima: nessun sondaggio, né dei minuti né della consegna', async () => {
  ambiente({ WHATSAPP_SONDAGGIO: '0' });
  const sock = socketFinto();
  await wa.accodaRitiroConsegna(5, 50);
  wa._prova.impostaSocket(sock, GRUPPO);
  await wa._prova.inviaMessaggiInCoda();
  await wa.gestisciMessaggio({
    key: { id: 'IN1', remoteJid: GRUPPO, fromMe: false, participant: MARCO },
    pushName: 'Marco',
    message: { extendedTextMessage: { text: 'preso 30', contextInfo: { stanzaId: 'WA1' } } },
  });
  assert.deepEqual(righe.map((r) => r.tipo), ['ritiro_consegna']);
  assert.equal(sock.mandati.length, 2, 'il messaggio e la risposta');
  wa._prova.impostaSocket(null);
});

// ---------------- sondaggio della consegna ----------------

// Fino al sondaggio "consegna" mandato nel gruppo: ritorna quello che serve per votarlo.
async function consegnaPresa(sock) {
  const { segreto, pollId } = await consegnaMandata(sock);
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['10 minuti'], { segreto, pollId, creatore: '39000111222@s.whatsapp.net', votante: MARCO }), { pollId }));
  const consegna = righe.find((r) => r.tipo === 'consegna');
  return { consegna, segreto: Buffer.from(consegna.segreto_sondaggio, 'base64'), pollId: consegna.wa_msg_id };
}
const CREATORE = '39000111222@s.whatsapp.net';

test('"🚀 Segna come Consegnato": l\'ordine risulta consegnato, il sondaggio sparisce e il bot scrive ora e indirizzo', async () => {
  ambiente();
  destinazioneRichiesta = 'Via Dodecaneso 35, 16146 Genova (GE)';
  const sock = socketFinto();
  const { consegna, segreto, pollId } = await consegnaPresa(sock);
  const prima = sock.mandati.length;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));

  assert.deepEqual(ordiniSegnati, [300], "l'ordine è segnato consegnato");
  const dopo = sock.mandati.slice(prima);
  assert.match(dopo[0].contenuto.text, /^📦 Ordine #300 consegnato alle \d\d:\d\d — Via Dodecaneso 35, 16146 Genova \(GE\)\.$/);
  assert.deepEqual(dopo[1].contenuto.delete, { remoteJid: GRUPPO, fromMe: true, id: pollId }, 'il sondaggio sparisce dal gruppo');
  assert.equal(dopo.length, 2);
  assert.equal(consegna.stato, 'eliminato');
  assert.ok(consegna.preso_il);
  // chi vota dopo (o ripete) non fa niente di nuovo
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: '39320000001@s.whatsapp.net' }), { pollId, partecipante: '39320000001@s.whatsapp.net', nome: 'Luca' }));
  assert.deepEqual(ordiniSegnati, [300]);
  assert.equal(sock.mandati.length, prima + 2);
  wa._prova.impostaSocket(null);
});

test('senza indirizzo nella richiesta vale quello di consegna del cliente', async () => {
  ambiente();
  const sock = socketFinto();
  const { segreto, pollId } = await consegnaPresa(sock);
  const prima = sock.mandati.length;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  assert.match(sock.mandati[prima].contenuto.text, /^📦 Ordine #300 consegnato alle \d\d:\d\d — Via Puggia 22\/3, 16131 Genova \(GE\)\.$/);
  wa._prova.impostaSocket(null);
});

test('"⏳ Ancora in viaggio" non fa niente e si può ancora scegliere "Consegnato" dopo', async () => {
  ambiente();
  const sock = socketFinto();
  const { consegna, segreto, pollId } = await consegnaPresa(sock);
  const prima = sock.mandati.length;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['⏳ Ancora in viaggio'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  assert.deepEqual(ordiniSegnati, []);
  assert.equal(sock.mandati.length, prima);
  assert.equal(consegna.preso_il, null);
  // lo stesso corriere cambia voto: ora è consegnato
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  assert.deepEqual(ordiniSegnati, [300]);
  assert.equal(sock.mandati.length, prima + 2);
  wa._prova.impostaSocket(null);
});

test('voto ritirato, o sondaggio di un\'altra istanza: niente', async () => {
  ambiente();
  const sock = socketFinto();
  const { consegna, segreto, pollId } = await consegnaPresa(sock);
  const prima = sock.mandati.length;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto([], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  consegna.istanza = 'vps-1';
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  assert.deepEqual(ordiniSegnati, []);
  assert.equal(sock.mandati.length, prima);
  wa._prova.impostaSocket(null);
});

test('se l\'ordine non si riesce a segnare il bot non dice "consegnato": libera il voto e chiede di riprovare', async () => {
  ambiente();
  const sock = socketFinto();
  const { consegna, segreto, pollId } = await consegnaPresa(sock);
  const prima = sock.mandati.length;
  consegnaFallisce = true;
  const originale = console.error;
  console.error = () => {};
  try {
    await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  } finally {
    console.error = originale;
  }
  assert.equal(sock.mandati.length, prima + 1);
  assert.match(sock.mandati[prima].contenuto.text, /^Non sono riuscito a segnare l'ordine #300 come consegnato: togli il voto e votalo di nuovo\.$/);
  assert.equal(consegna.preso_il, null, 'il voto è di nuovo libero');
  assert.equal(consegna.stato, 'inviato', 'il sondaggio resta nel gruppo');
  // riprovando funziona
  consegnaFallisce = false;
  await wa.gestisciMessaggio(votoInArrivo(cifraVoto(['🚀 Segna come Consegnato'], { segreto, pollId, creatore: CREATORE, votante: MARCO }), { pollId }));
  assert.deepEqual(ordiniSegnati, [300]);
  wa._prova.impostaSocket(null);
});

test('il sondaggio della consegna non sparisce con la chiusura della richiesta (ritiraRichiesta non lo tocca)', async () => {
  ambiente();
  const sock = socketFinto();
  const { consegna } = await consegnaPresa(sock);
  await wa.ritiraRichiesta(5);
  assert.equal(consegna.stato, 'inviato');
  wa._prova.impostaSocket(null);
});
