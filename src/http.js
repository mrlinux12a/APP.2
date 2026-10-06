// Pezzi HTTP condivisi da server.js, dalle guardie di accesso (auth.js) e dai test: lettura della
// query string, validazione degli id nei percorsi, risposte di errore. Nessun accesso al DB qui dentro,
// così si possono provare con un'app Express vuota.
const querystring = require('querystring');
const icone = require('./icone');

// ---------- Query string ----------

// Il parser di Express 5 restituisce un array quando un parametro è ripetuto (?q=a&q=b) e le viste e le
// ricerche si aspettano testo: `(req.query.q || '').trim()` andava in errore (500) con un array. Qui ogni
// parametro è sempre una stringa: se è ripetuto vale il primo. Si installa con
// app.set('query parser', leggiQuery).
function leggiQuery(testo) {
  const grezzo = querystring.parse(testo);
  const query = Object.create(null);
  for (const chiave of Object.keys(grezzo)) {
    const valore = grezzo[chiave];
    query[chiave] = Array.isArray(valore) ? valore[0] || '' : valore;
  }
  return query;
}

// Express 5 lascia req.body undefined quando nessun parser ha letto il corpo (POST senza corpo o con un
// tipo non gestito): ogni `req.body.campo` in una route diventava un TypeError e un 500. Va montato
// subito dopo i parser del corpo.
function corpoSempreOggetto(req, res, next) {
  if (req.body === undefined || req.body === null) req.body = {};
  next();
}

// ---------- Sessione e redirect ----------

// express-session scrive la sessione nel DB DOPO aver mandato la risposta: le intestazioni e quasi tutto il corpo
// partono subito, solo l'ultimo byte aspetta il salvataggio. Una risposta JSON la legge intera chi la chiede, quindi
// va bene; un redirect invece il browser lo segue appena riceve le intestazioni, e la pagina di arrivo chiede la
// sessione prima che la scrittura sia finita: "Svuota carrello" e poi la home con il carrello ancora pieno (6 volte
// su 12 in prova sul DB vero, ~50 ms di rete per ogni scrittura).
// Questo middleware fa salvare la sessione PRIMA del redirect, ma solo se la route l'ha cambiata (confronto con com'era
// a inizio richiesta, cookie escluso: lo rinnova express-session da sé). Va montato subito dopo il middleware di sessione.
function salvaSessionePrimaDelRedirect(req, res, next) {
  const istantanea = () => {
    if (!req.session) return '';
    const { cookie, ...dati } = req.session;
    return JSON.stringify(dati);
  };
  const prima = istantanea();
  const redirect = res.redirect;
  res.redirect = function (...args) {
    if (!req.session || istantanea() === prima) return redirect.apply(res, args);
    req.session.save((err) => {
      if (err) console.error('Sessione non salvata prima del redirect:', err.message);
      redirect.apply(res, args);
    });
  };
  next();
}

// ---------- Id nei percorsi ----------

// Id numerico positivo che entra in un int4 del DB. Con `/ordini/abc` o `/ordini/99999999999` la query
// falliva ("invalid input syntax for type integer", "out of range") e l'utente vedeva un errore 500 al
// posto di "non trovato". Si usa con app.param('id', idNumerico) e router.param('id', idNumerico):
// se non è valido il percorso viene saltato e si arriva al 404.
const ID_VALIDO = /^[1-9]\d{0,8}$/;

function idNumerico(req, res, next, valore) {
  if (ID_VALIDO.test(String(valore))) return next();
  return next('route');
}

// ---------- Risposte di errore ----------

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
};

function messaggioPer(stato) {
  return MESSAGGI[stato] || MESSAGGI[stato >= 500 ? 500 : 400];
}

// Le richieste a /api/... (fetch di public/app.js, app nativa) aspettano JSON: una pagina HTML li
// manderebbe in errore al primo `.json()`. Vale anche chi chiede esplicitamente JSON.
function vuoleJson(req) {
  const percorso = String(req.originalUrl || req.url || '').split('?')[0];
  if (percorso === '/api' || percorso.startsWith('/api/')) return true;
  const accept = String(req.get('accept') || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

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
  return res.render('errore', vista, (err, html) => {
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

function statoDaErrore(err) {
  const stato = Number(err && (err.status || err.statusCode));
  return Number.isInteger(stato) && stato >= 400 && stato <= 599 ? stato : 500;
}

// Da registrare per ultimo. Gli errori del client (JSON malformato, corpo troppo grande...) tengono il
// loro codice 4xx invece di diventare un 500; il resto si scrive nel log e al cliente arriva un
// messaggio pulito, mai lo stack.
function gestoreErrori(err, req, res, next) {
  const stato = statoDaErrore(err);
  if (stato >= 500) console.error('Errore non gestito nella richiesta', req.method, req.originalUrl, ':', err);
  if (res.headersSent) return next(err);
  return rispondiErrore(req, res, stato);
}

module.exports = {
  leggiQuery,
  corpoSempreOggetto,
  salvaSessionePrimaDelRedirect,
  idNumerico,
  vuoleJson,
  rispondiErrore,
  gestoreNonTrovato,
  gestoreErrori,
  paginaDiRipiego,
};
