// Pezzi HTTP "puri" condivisi da app, middleware, route e prove: lettura della query string, tolta dei caratteri NUL, redirect interni, e il
// riconoscimento delle richieste che aspettano JSON. Nessun accesso al DB e nessun middleware qui dentro: i middleware stanno in src/middleware/
// (errori.js per le risposte di errore, percorso.js per %00 e :id, corpo.js, sessione.js).
const querystring = require('querystring');

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
    query[chiave] = senzaNul(Array.isArray(valore) ? valore[0] || '' : valore);
  }
  return query;
}

// ---------- Caratteri che Postgres non accetta ----------

// Un carattere NUL (%00, \u0000) dentro un testo non è un testo valido per Postgres: la query falliva con "invalid byte
// sequence for encoding UTF8: 0x00" e chi lo mandava (anche senza nessuna ragione, basta un `?q=a%00b`) otteneva un 500 e una
// riga di errore nel log. Non serve a nessuno: si toglie da query, corpo e percorso prima che arrivi a una query.
const RE_NUL = /\u0000/g;
// Toglie i caratteri NUL da un testo (il database li rifiuta); gli altri valori restano com'erano.
function senzaNul(valore) {
  return typeof valore === 'string' ? valore.replace(RE_NUL, '') : valore;
}

// Toglie i NUL da un valore qualunque letto dal corpo (testo, array, oggetti annidati: `extended` e JSON li permettono). La
// profondità è limitata: un corpo annidato all'infinito non deve fermare il processo.
function ripulisciNul(valore, profondita = 0) {
  if (typeof valore === 'string') return valore.replace(RE_NUL, '');
  if (profondita > 8 || valore === null || typeof valore !== 'object') return valore;
  if (Array.isArray(valore)) {
    for (let i = 0; i < valore.length; i++) valore[i] = ripulisciNul(valore[i], profondita + 1);
    return valore;
  }
  for (const chiave of Object.keys(valore)) {
    const pulita = chiave.replace(RE_NUL, '');
    const v = ripulisciNul(valore[chiave], profondita + 1);
    if (pulita !== chiave) delete valore[chiave];
    valore[pulita] = v;
  }
  return valore;
}

// ---------- Redirect interni ----------

// Un indirizzo in cui rimandare l'utente, preso da un campo che scrive il browser (`ritorno`): vale solo se è un PERCORSO di questo
// sito ("/carrello", "/categoria/x?p=2"). Un indirizzo assoluto ("https://altro.it"), senza schema ("//altro.it"), con la barra
// rovesciata ("/\altro.it", che alcuni browser leggono come "//") o con caratteri di controllo manderebbe l'utente su un sito
// scelto da chi ha costruito il modulo (open redirect, comodo al phishing). Il ripiego è `ripiego`.
function percorsoInterno(valore, ripiego = '/') {
  const testo = typeof valore === 'string' ? valore.trim() : '';
  if (!testo.startsWith('/') || testo.startsWith('//')) return ripiego;
  if (/[\u0000-\u001f\u007f\\]/.test(testo)) return ripiego;
  return testo;
}

// Dove riporta la freccia "indietro" delle pagine interne del banco (ordine, richiesta): la pagina da cui si è arrivati, che i link
// che portano lì scrivono nel parametro `torna` (conRitorno). Come `ritorno`, lo scrive chi costruisce l'indirizzo: vale solo un percorso
// di questo sito (percorsoInterno) E solo una delle pagine del banco da cui si arriva (Storico con i suoi filtri, elenco e scheda
// cliente, dettaglio di una richiesta, home), con query e ancora; il resto vale `ripiego`.
const PAGINE_DI_RITORNO_BANCO = /^\/distributore(?:\/storico|\/clienti(?:\/\d+)?|\/richieste\/\d+)?(?:[?#].*)?$/;
// Controlla la pagina a cui far tornare il banco: vale solo una pagina del banco, tutto il resto (anche un sito esterno) ripiega sulla home.
function ritornoBanco(valore, ripiego = '/distributore') {
  const percorso = percorsoInterno(valore, '');
  return percorso && percorso.length <= 1000 && PAGINE_DI_RITORNO_BANCO.test(percorso) ? percorso : ripiego;
}

// `href` con il parametro `torna` = la pagina a cui far tornare la freccia (senza `ritorno` l'indirizzo resta com'è).
function conRitorno(href, ritorno) {
  if (!ritorno) return href;
  return href + (href.includes('?') ? '&' : '?') + 'torna=' + encodeURIComponent(ritorno);
}

// ---------- Chi vuole JSON ----------

// Le richieste a /api/... (fetch di assets/js, app nativa) aspettano JSON: una pagina HTML li
// manderebbe in errore al primo `.json()`. Vale anche chi chiede esplicitamente JSON.
function vuoleJson(req) {
  const percorso = String(req.originalUrl || req.url || '').split('?')[0];
  if (percorso === '/api' || percorso.startsWith('/api/')) return true;
  const accept = String(req.get('accept') || '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

module.exports = {
  leggiQuery,
  senzaNul,
  ripulisciNul,
  percorsoInterno,
  ritornoBanco,
  conRitorno,
  vuoleJson,
};
