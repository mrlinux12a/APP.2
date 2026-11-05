// app.js e style.css del sito non sono due file interi: si scrivono a pezzi, uno per argomento, in assets/js/ e assets/css/, e il server li riunisce in un solo
// file che serve come /app.js e /style.css. Il browser fa quindi una richiesta sola per ognuno (su una rete da cantiere conta), come se fossero interi.
// Il testo riunito è la giunzione dei pezzi in ordine di nome, byte per byte: niente da compilare, niente da lanciare dopo una modifica.
// Il numero davanti al nome del pezzo è l'ordine: nel CSS conta (a parità di peso vince la regola scritta dopo) e nel JS è l'ordine in cui partono i blocchi.
const fs = require('fs');
const path = require('path');

// Dove stanno i pezzi: assets/ nella cartella principale del progetto (accanto a public/, che invece si serve così com'è).
const cartellaAssets = path.join(__dirname, '..', '..', 'assets');

const COMPOSTI = {
  '/app.js': { cartella: 'js', estensione: '.js', tipo: 'application/javascript; charset=utf-8' },
  '/style.css': { cartella: 'css', estensione: '.css', tipo: 'text/css; charset=utf-8' },
};

const cache = new Map(); // indirizzo -> { firma, testo, mtimeMs, tipo }

// Dice se un indirizzo (`/app.js`, `/style.css`) è un file composto da pezzi.
function eComposto(percorso) {
  return Object.prototype.hasOwnProperty.call(COMPOSTI, percorso);
}

// I pezzi di un file composto, in ordine di nome, ciascuno con la sua data di modifica.
function elencaPezzi(definizione) {
  const cartella = path.join(cartellaAssets, definizione.cartella);
  return fs
    .readdirSync(cartella)
    .filter((nome) => nome.endsWith(definizione.estensione))
    .sort()
    .map((nome) => {
      const file = path.join(cartella, nome);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    });
}

// Il file composto: `testo` (i pezzi uno dopo l'altro), `mtimeMs` (la modifica più recente fra i pezzi, che fa da versione) e `tipo` (Content-Type).
// Si rilegge dal disco solo se un pezzo è stato aggiunto, tolto o modificato.
function leggiComposto(percorso) {
  const definizione = COMPOSTI[percorso];
  const pezzi = elencaPezzi(definizione);
  if (!pezzi.length) throw new Error('nessun pezzo in assets/' + definizione.cartella);
  const firma = pezzi.map((p) => p.file + ':' + p.mtimeMs).join('|');
  const salvato = cache.get(percorso);
  if (salvato && salvato.firma === firma) return salvato;
  const voce = {
    firma,
    testo: pezzi.map((p) => fs.readFileSync(p.file, 'utf8')).join(''),
    mtimeMs: Math.max(...pezzi.map((p) => p.mtimeMs)),
    tipo: definizione.tipo,
  };
  cache.set(percorso, voce);
  return voce;
}

module.exports = { eComposto, leggiComposto };
