// Risposte di errore del sito: la pagina "errore" per chi naviga, JSON per l'API e per l'app, e i due gestori da registrare in fondo all'app
// (percorso che non esiste, errore non previsto). Nessun accesso al DB qui dentro, così si provano con un'app Express vuota.
const icone = require('../comune/icone');
const { vuoleJson } = require('../comune/http');

const MESSAGGI = {
  400: ['Richiesta non valida', 'La richiesta non è valida.'],
  401: ['Accesso scaduto', 'Accesso scaduto: entra di nuovo.'],
  403: ['Accesso negato', 'Accesso non consentito.'],
  404: ['Non trovata', 'Pagina non trovata.'],
  405: ['Non consentito', 'Operazione non consentita.'],
  413: ['Richiesta troppo grande', 'La richiesta è troppo grande.'],
  415: ['Formato non supportato', 'Il formato della richiesta non è supportato.'],
  429: ['Troppe richieste', 'Troppe richieste: riprova tra poco.'],
  500: ['Errore imprevisto', 'Si è verificato un problema imprevisto. Riprova tra poco.'],
  // Il database non risponde (rete giù: db/resilienza.js): non è un errore del sito, e riprovare tra poco serve davvero.
  503: ['Servizio non raggiungibile', 'Il servizio non riesce a collegarsi al database in questo momento. Riprova tra poco.'],
};

// Il testo di errore da mostrare per un certo codice (404, 403, 500...).
function messaggioPer(stato) {
  return MESSAGGI[stato] || MESSAGGI[stato >= 500 ? 500 : 400];
}

// Rende innocuo un testo da mettere in una pagina HTML (sostituisce i simboli speciali).
function escapaHtml(testo) {
  return String(testo).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Pagina minima che non dipende da nessuna vista: serve quando è proprio la pagina di errore a non
// riuscire a disegnarsi (database giù prima del middleware delle viste, vista rotta).
function paginaDiRipiego(titolo, messaggio) {
  return (
    '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>' + escapaHtml(titolo) + '</title></head>' +
    '<body style="font-family:sans-serif;margin:0;padding:24px;max-width:520px">' +
    '<h1 style="font-size:1.3rem">' + escapaHtml(titolo) + '</h1>' +
    '<p>' + escapaHtml(messaggio) + '</p>' +
    '<p><a href="/" style="display:inline-block;padding:14px 20px;background:#245a8f;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Torna all’inizio</a></p>' +
    '</body></html>'
  );
}

// Risponde con l'errore giusto: JSON per l'API, pagina `errore` per il resto. `extra` può portare
// link/linkTesto della pagina. Non lancia mai: il peggio che può succedere è la pagina di ripiego.
function rispondiErrore(req, res, stato, { messaggio = null, titolo = null, ...extra } = {}) {
  const [titoloBase, messaggioBase] = messaggioPer(stato);
  const testo = messaggio || messaggioBase;
  res.status(stato);
  if (vuoleJson(req)) {
    return res.json({ ok: false, errore: testo });
  }
  const vista = {
    // La vista legge currentUser e le icone anche quando il middleware che le prepara non è arrivato a girare.
    currentUser: res.locals.currentUser || null,
    asset: res.app.locals.asset || ((percorso) => percorso),
    ...icone,
    titolo: titolo || titoloBase,
    messaggio: testo,
    ...extra,
  };
  return res.render('comune/errore', vista, (err, html) => {
    if (err) {
      console.error('Pagina di errore non disegnata:', err.message);
      return res.type('html').send(paginaDiRipiego(vista.titolo, testo));
    }
    return res.send(html);
  });
}

// Da registrare dopo tutte le route: un percorso che non esiste.
function gestoreNonTrovato(req, res) {
  rispondiErrore(req, res, 404, vuoleJson(req) ? { messaggio: 'Risorsa non trovata.' } : {});
}

// Errori di Postgres che dicono "il valore che mi hai dato non è valido" (testo con un NUL, numero fuori misura, formato sbagliato): vengono da
// un input, non da un guasto del sito, quindi per chi chiama sono un 400 e non un 500. Restano nel log (come avviso) per accorgersi di un campo
// che a qualcuno dovrebbe essere già validato.
const CODICI_INPUT_NON_VALIDO = new Set(['22021', '22P05', '22003', '22P02', '22007', '22008']);

// Sceglie il codice della risposta per un errore: quello che porta con sé, 400 per i valori non validi per il database, 500 per tutto il resto.
function statoDaErrore(err) {
  const stato = Number(err && (err.status || err.statusCode));
  if (Number.isInteger(stato) && stato >= 400 && stato <= 599) return stato;
  if (err && CODICI_INPUT_NON_VALIDO.has(err.code)) return 400;
  return 500;
}

// Da registrare per ultimo. Gli errori del client (JSON malformato, corpo troppo grande...) tengono il
// loro codice 4xx invece di diventare un 500; il resto si scrive nel log e al cliente arriva un
// messaggio pulito, mai lo stack.
function gestoreErrori(err, req, res, next) {
  const stato = statoDaErrore(err);
  if (stato === 400 && err && CODICI_INPUT_NON_VALIDO.has(err.code)) {
    console.warn('Valore non valido (' + err.code + ') nella richiesta', req.method, req.originalUrl, ':', err.message);
  }
  if (stato >= 500) {
    // Database irraggiungibile: una riga sola per richiesta (lo stack dice solo "Connection terminated" e il perché sta nel log di avvio).
    if (err && err.dbNonRaggiungibile) console.error('Database non raggiungibile nella richiesta', req.method, req.originalUrl);
    else console.error('Errore non gestito nella richiesta', req.method, req.originalUrl, ':', err);
  }
  if (res.headersSent) return next(err);
  return rispondiErrore(req, res, stato);
}

module.exports = { rispondiErrore, gestoreNonTrovato, gestoreErrori };
