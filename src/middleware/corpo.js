// Lettura di quello che il browser manda nel corpo della richiesta (moduli e JSON).
const express = require('express');
const { ripulisciNul } = require('../comune/http');

// Express 5 lascia req.body undefined quando nessun parser ha letto il corpo (POST senza corpo o con un
// tipo non gestito): ogni `req.body.campo` in una route diventava un TypeError e un 500. Va montato
// subito dopo i parser del corpo. Toglie anche i NUL (vedi src/comune/http.js).
function corpoSempreOggetto(req, res, next) {
  if (req.body === undefined || req.body === null) req.body = {};
  else req.body = ripulisciNul(req.body);
  next();
}

// I tre pezzi, da montare nell'ordine: moduli (urlencoded), JSON, e `req.body` sempre un oggetto (mai undefined) e senza caratteri NUL.
function leggiCorpo() {
  return [express.urlencoded({ extended: true }), express.json(), corpoSempreOggetto];
}

module.exports = { leggiCorpo, corpoSempreOggetto };
