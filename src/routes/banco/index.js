// Tutte le pagine del banco (il distributore), una rotta per argomento. L'ordine è quello di prima della divisione: Express prova le rotte in fila.
const express = require('express');
const avvisi = require('./avvisi');
const home = require('./home');
const storico = require('./storico');
const richieste = require('./richieste');
const ordini = require('./ordini');
const anagrafica = require('./anagrafica');
const clienti = require('./clienti');

const router = express.Router();
router.use(avvisi, home, storico, richieste, ordini, anagrafica, clienti);

module.exports = router;
