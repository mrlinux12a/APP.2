// Tutte le pagine e le API dell'installatore (il ruolo "cliente" nella sessione), una rotta per argomento. L'ordine è quello di prima della divisione:
// Express prova le rotte in fila.
const express = require('express');
const profilo = require('./profilo');
const catalogo = require('./catalogo');
const carrello = require('./carrello');
const richieste = require('./richieste');
const pagamenti = require('./pagamenti');
const ordini = require('./ordini');

const router = express.Router();
router.use(profilo, catalogo, carrello, richieste, pagamenti, ordini);

module.exports = router;
