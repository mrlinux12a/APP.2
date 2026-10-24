// Rete instabile verso il database: cosa si può riprovare in sicurezza e come rispondere subito quando non c'è proprio rete.
//
// Il caso che l'ha fatto nascere: dalla Wi-Fi dell'università (eduroam) la connessione TCP al pooler di Supabase si apre, ma il
// traffico Postgres viene tagliato (la richiesta SSL del protocollo non riceve mai risposta, o la connessione è resettata dopo ~19 s).
// Ogni richiesta restava appesa 15 secondi e finiva in "errore imprevisto", e il log si riempiva di "Connection terminated".
// Il codice non può far passare un firewall: può però (1) riprovare quello che è sicuro riprovare, (2) smettere di aspettare quando la
// rete è palesemente giù, rispondendo subito, e (3) dire chiaramente cosa sta succedendo.
//
// Cosa si riprova (mai dentro una transazione: un pezzo perso la annulla tutta, e ripartire spetta a chi l'ha aperta):
//  - la CONNESSIONE al pool: se fallisce non è partita nessuna query, quindi qualunque statement si può rimandare;
//  - le LETTURE (SELECT/WITH senza scritture) e le istruzioni sulla tabella delle sessioni (sono idempotenti: upsert, aggiornamento
//    della scadenza, cancellazione) se la connessione cade a metà. Una scrittura persa a metà NON si riprova: potrebbe essere arrivata
//    al server, e rifarla duplicherebbe un ordine o un pagamento. In quel caso l'errore sale com'è (come prima).

const CODICI_RETE = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN',
]);

// Messaggi di pg quando la connessione manca o cade (non hanno un `code` di rete).
const MESSAGGI_RETE = [
  /connection terminated/i,
  /connection timeout/i,
  /timeout exceeded when trying to connect/i,
  /timeout expired/i,
  /not queryable/i,
  /connection error/i,
  /server closed the connection/i,
  /getaddrinfo/i,
];

// SQLSTATE: classe 08 = problemi di connessione; 57P01-57P03 = server che si ferma o si riavvia.
const SQLSTATE_RETE = /^(08|57P0[123])/;

// true se l'errore dice "la rete (o il server) non c'è / è caduta", non "la query è sbagliata".
function eErroreDiRete(err) {
  if (!err) return false;
  if (err.dbNonRaggiungibile) return true;
  if (CODICI_RETE.has(err.code) || SQLSTATE_RETE.test(String(err.code || ''))) return true;
  const cause = err.cause;
  if (cause && cause !== err && eErroreDiRete(cause)) return true;
  return MESSAGGI_RETE.some((re) => re.test(String(err.message || '')));
}

const SCRITTURA = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|CALL|DO)\b/i;

// Lettura pura: SELECT/WITH/SHOW senza nessuna parola di scrittura (un `WITH ... UPDATE` non lo è).
function eLettura(sql) {
  const s = String(sql || '').trim();
  return /^(SELECT|WITH|SHOW|EXPLAIN)\b/i.test(s) && !SCRITTURA.test(s);
}

// Le istruzioni della tabella delle sessioni si possono rifare: stesso risultato alla seconda volta.
function eSessione(sql) {
  return /\b(INTO|UPDATE|FROM)\s+"?session"?\b/i.test(String(sql || ''));
}

// Dice se una query si può ripetere senza rischi in caso di rete caduta: le letture e le istruzioni di sessione sì, le scritture mai.
function eRiprovabile(sql) {
  return eLettura(sql) || eSessione(sql);
}

// L'errore che arriva a chi ha chiamato quando la rete non c'è (dopo i tentativi, o subito se l'interruttore è aperto).
// `status` 503: src/http.js lo trasforma nella pagina/JSON "servizio non raggiungibile" invece di un 500 "imprevisto".
class ErroreDbNonRaggiungibile extends Error {
  // Crea l'errore "database non raggiungibile" (503), dicendo se è stato dato subito perché la rete è giù da pochi secondi.
  constructor(causa, { subito = false } = {}) {
    super(subito ? 'database non raggiungibile (tentativo saltato: la rete è giù da pochi secondi)' : 'database non raggiungibile: ' + (causa && causa.message));
    this.name = 'ErroreDbNonRaggiungibile';
    this.status = 503;
    this.code = 'DB_NON_RAGGIUNGIBILE';
    this.dbNonRaggiungibile = true;
    if (causa) this.cause = causa;
  }
}

// Interruttore: dopo `soglia` fallimenti di rete di fila senza nessun successo in mezzo, per `pausaMs` si risponde subito con errore
// invece di far aspettare ogni richiesta il suo timeout; poi si lascia passare un nuovo tentativo. Un successo azzera il conto.
function creaInterruttore({ soglia = 3, pausaMs = 5000, adesso = Date.now } = {}) {
  let falliti = 0;
  let apertoFinoA = 0;
  return {
    aperto: () => adesso() < apertoFinoA,
    fallito() {
      falliti += 1;
      if (falliti >= soglia) apertoFinoA = adesso() + pausaMs;
    },
    riuscito() {
      falliti = 0;
      apertoFinoA = 0;
    },
    stato: () => ({ falliti, apertoFinoA }),
  };
}

// L'attesa di un posto libero nel pool scade con lo stesso messaggio di una connessione che non si apre ("timeout exceeded when
// trying to connect"): con il pool pieno di query lente non è la rete a essere giù, quindi quel timeout si riprova ma non conta per
// l'interruttore (che altrimenti trasformerebbe un momento di carico in 5 secondi di errori). I guasti veri hanno altri messaggi:
// "Connection terminated due to connection timeout", ECONNRESET, ENOTFOUND...
function contaPerInterruttore(err) {
  return !/timeout exceeded when trying to connect/i.test(String((err && err.message) || ''));
}

const ATTESA_RIPROVA_MS = 250;
const TENTATIVI = 2;

// Esegue una query sul pool (fuori da transazioni) con le regole sopra. `pool` ha `connect()` come pg.Pool; `attesa(ms)` si può
// sostituire nelle prove.
function creaEsecutore({ pool, interruttore = creaInterruttore(), attesa = (ms) => new Promise((r) => setTimeout(r, ms)), tentativi = TENTATIVI } = {}) {
  // Una connessione dal pool. Se manca, nessuna query è partita: si riprova sempre (finché l'interruttore non dice basta).
  async function collega() {
    for (let n = 1; ; n++) {
      if (interruttore.aperto()) throw new ErroreDbNonRaggiungibile(null, { subito: true });
      try {
        return await pool.connect();
      } catch (err) {
        if (!eErroreDiRete(err)) throw err;
        if (contaPerInterruttore(err)) interruttore.fallito();
        if (n >= tentativi || interruttore.aperto()) throw new ErroreDbNonRaggiungibile(err);
        await attesa(ATTESA_RIPROVA_MS * n);
      }
    }
  }

  async function interroga(testo, params) {
    const sicura = eRiprovabile(testo);
    for (let n = 1; ; n++) {
      const client = await collega(); // già con i suoi tentativi
      try {
        const risultato = await client.query(testo, params);
        client.release();
        interruttore.riuscito();
        return risultato;
      } catch (err) {
        const rete = eErroreDiRete(err);
        // Un client con la connessione caduta va buttato, non rimesso nel pool; un errore SQL normale no.
        client.release(rete ? err : undefined);
        if (!rete) throw err;
        if (contaPerInterruttore(err)) interruttore.fallito();
        if (!sicura || n >= tentativi || interruttore.aperto()) throw new ErroreDbNonRaggiungibile(err);
        await attesa(ATTESA_RIPROVA_MS * n);
      }
    }
  }

  return { collega, interroga, interruttore };
}

module.exports = {
  eErroreDiRete,
  eLettura,
  eSessione,
  eRiprovabile,
  ErroreDbNonRaggiungibile,
  creaInterruttore,
  creaEsecutore,
};
