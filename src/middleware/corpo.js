// Lettura di quello che il browser manda nel corpo della richiesta (moduli e JSON).
const express = require('express');
const { corpoSempreOggetto } = require('../http');

// I tre pezzi, da montare nell'ordine: moduli (urlencoded), JSON, e `req.body` sempre un oggetto (mai undefined) e senza caratteri NUL.
function leggiCorpo() {
  return [express.urlencoded({ extended: true }), express.json(), corpoSempreOggetto];
}

module.exports = { leggiCorpo };
