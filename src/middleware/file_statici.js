// File che il sito serve così come sono (foto, librerie, css, js) e due indirizzi speciali (favicon e verifica Apple Pay). Sta PRIMA della sessione e dei
// limiti: un file statico non deve costare una lettura di sessione né contare nel limite di richieste.
const express = require('express');
const path = require('path');
const { cartellaPublic } = require('../config/ambiente');

// I file con una versione nell'indirizzo (?v=<data di modifica>, scritta nelle pagine da asset()): un indirizzo con la versione non cambia mai
// contenuto, quindi il browser lo tiene un anno senza richiederlo a ogni pagina (2-3 richieste in meno a ogni apertura, su una rete da cantiere).
// Quando il file cambia cambia anche la versione e il browser lo riscarica da solo. Senza ?v= (collegamenti vecchi) resta la sola verifica ETag.
const ASSET_VERSIONATI = new Set(['/style.css', '/app.js', '/mappa.js', '/pagamento.js']);

// Dice al browser di tenere un anno il file con la versione nell'indirizzo.
function cacheAssetVersionati(req, res, next) {
  if (req.query.v && ASSET_VERSIONATI.has(req.path)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}

// Crea il pezzo di app che serve i file statici e i due indirizzi speciali.
function creaFileStatici() {
  const router = express.Router();

  // Foto e librerie cambiano di rado: il browser (e l'app) le tiene 7 giorni invece di richiederle a ogni pagina. CSS e JS restano con la sola
  // verifica (ETag), così una modifica si vede subito.
  router.use('/img', express.static(path.join(cartellaPublic, 'img'), { maxAge: '7d' }));
  // Le librerie di terze parti si tengono in cache per 7 giorni.
  router.use('/vendor', express.static(path.join(cartellaPublic, 'vendor'), { maxAge: '7d' }));
  // Gli indirizzi con ?v=... (CSS e JS versionati) si possono tenere in cache per un anno.
  router.use(cacheAssetVersionati);
  // Tutto il resto della cartella public (CSS, JS, icone, manifest).
  router.use(express.static(cartellaPublic));

  // I browser chiedono /favicon.ico da soli: risposto qui, prima della sessione e delle query del middleware delle viste, invece di far passare un
  // 404 per tutta la pagina (con le sue letture dal DB) a ogni apertura.
  router.get('/favicon.ico', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('png').sendFile(path.join(cartellaPublic, 'icons', 'icona-192.png'));
  });

  // Verifica del dominio per Apple Pay (Stripe): Apple controlla che questo sito pubblichi il file di Stripe, uguale per tutti i conti, a questo indirizzo
  // esatto, in HTTPS, senza reindirizzamenti. express.static ignora le cartelle che cominciano per punto, per questo c'è una rotta apposta. Il file sta in
  // public/.well-known/ (scripts/scarica_file_apple_pay.js lo scarica da Stripe); se manca risponde 404 e Apple Pay semplicemente non compare.
  router.get('/.well-known/apple-developer-merchantid-domain-association', (req, res) => {
    const file = path.join(cartellaPublic, '.well-known', 'apple-developer-merchantid-domain-association');
    res.set('Cache-Control', 'public, max-age=300');
    res.type('text/plain').sendFile(file, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(404).type('text/plain').send('Non trovato');
    });
  });

  return router;
}

module.exports = { creaFileStatici, cacheAssetVersionati, ASSET_VERSIONATI };
