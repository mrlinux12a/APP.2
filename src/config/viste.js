// Impostazioni generali dell'app Express: motore delle pagine (EJS), valori disponibili a tutte le pagine, lettura dell'indirizzo del client dietro il
// proxy e lettura della query string.
const fs = require('fs');
const path = require('path');
const { cartellaViste, cartellaPublic } = require('./ambiente');
const { leggiQuery, conRitorno } = require('../http');

// Per i file statici (css, js) la pagina scrive asset('/style.css') e ottiene '/style.css?v=1759660000000': l'indirizzo del file con la sua versione
// (data di modifica). La versione serve a far tenere il file al browser per un anno e a fargli scaricare il nuovo appena cambia.
// La data si rilegge al massimo ogni 5 secondi: una modifica in locale si vede quasi subito, senza riavviare il server, e in produzione costa una
// lettura ogni tanto invece di una per pagina.
function creaFunzioneAsset() {
  const versioni = new Map();
  return function asset(percorso) {
    const adesso = Date.now();
    const voce = versioni.get(percorso);
    if (voce && adesso - voce.letta < 5000) return voce.url;
    let url = percorso;
    try {
      url = percorso + '?v=' + Math.floor(fs.statSync(path.join(cartellaPublic, percorso)).mtimeMs);
    } catch (err) { /* file mancante: l'indirizzo resta senza versione */ }
    versioni.set(percorso, { url, letta: adesso });
    return url;
  };
}

// Applica le impostazioni all'app: dove stanno le pagine, cosa possono usare tutte (sede degli installatori, link di ritorno, asset), come si legge
// l'indirizzo vero del client e la query string.
function configuraApp(app) {
  app.set('view engine', 'ejs');
  app.set('views', cartellaViste);
  // Dove stanno tutti gli installatori, per ora (vedi src/sede_installatori.js).
  app.locals.sede = require('../sede_installatori');
  // Le viste del banco che portano a un ordine o a una richiesta ci aggiungono `torna` (la pagina da cui si parte): vedi ritornoBanco.
  app.locals.conRitorno = conRitorno;
  app.locals.asset = creaFunzioneAsset();
  // Necessario per leggere il vero IP del client (usato dal limite tentativi di login e dai limiti di richieste) quando l'app gira dietro un
  // proxy/load balancer: un solo proxy davanti.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Ogni parametro della query string è sempre un testo, mai un array (?q=a&q=b): vedi src/http.js.
  app.set('query parser', leggiQuery);
}

module.exports = { configuraApp, creaFunzioneAsset };
