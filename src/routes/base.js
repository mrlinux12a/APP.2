// Il mattoncino di partenza di ogni gruppo di rotte.
const express = require('express');
const { idNumerico } = require('../http');

// Crea un gruppo di rotte (router) con la regola comune a tutto il sito: un `:id` nell'indirizzo (/ordini/:id, /richieste/:id...) è un numero intero
// positivo; con qualsiasi altra cosa il percorso non esiste (404) invece di far fallire la query sul database e dare un errore 500.
// (La regola va ripetuta in ogni gruppo: i router di Express non ereditano quella dell'app.)
function creaRouter() {
  const router = express.Router();
  router.param('id', idNumerico);
  return router;
}

module.exports = { creaRouter };
