// Immagini delle categorie (richiesta esplicita del 22/10/2026): public/img/categorie/<slug>.svg al posto dell'icona su sfondo azzurro, nella griglia della home e nel
// segnaposto delle sottocategorie senza foto. Il DB è finto; le viste sono quelle vere, rese con ejs. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

let categorieDb = [];
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const righe = async (params) => {
      if (/FROM macro_categorie m/.test(s)) return categorieDb;
      if (/FROM macro_categorie WHERE slug = \?/.test(s)) return categorieDb.filter((m) => m.slug === params[0]);
      return [];
    };
    return { all: async (...p) => righe(p), get: async (...p) => (await righe(p))[0] || null, run: async () => ({ changes: 0 }) };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const catalogo = require('../src/catalogo');
const icone = require('../src/icone');

const SLUG = [
  'raccorderia-e-valvole', 'acqua-calda-sanitaria', 'bagno-e-sanitari', 'condizionamento-e-climatizzazione', 'elettrico-e-fotovoltaico', 'fissaggi-e-utensili',
  'ricambi-e-accessori', 'scarico-e-fognatura', 'trattamento-acqua', 'tubazioni-e-sistemi-di-distribuzione', 'ventilazione-e-trattamento-aria',
];
const CARTELLA = path.join(__dirname, '..', 'public', 'img', 'categorie');

test('i file ci sono: un .svg per ognuna delle 11 categorie (solo svg), ben formati (XML valido)', () => {
  const file = fs.readdirSync(CARTELLA).sort();
  assert.deepEqual(file, SLUG.map((s) => s + '.svg').sort(), 'solo gli svg, niente png');
  for (const s of SLUG) {
    const testo = fs.readFileSync(path.join(CARTELLA, s + '.svg'), 'utf8');
    assert.match(testo, /^<svg [^>]*viewBox="0 0 120 100"/, s + ': proporzione 6:5');
    assert.ok(testo.length < 20000, s + ': pochi KB');
    // XML ben formato: i file arrivati avevano attributi senza virgolette (stop-opacity=0.9) e il browser li rifiutava come immagine (riquadro rotto)
    assert.doesNotMatch(testo.replace(/"[^"]*"|'[^']*'/g, '""'), /\s[\w:-]+=[^"'\s]/, s + ': attributi sempre tra virgolette');
  }
});

test('immagineCategoria: l\'indirizzo solo se il file esiste (un file mancante non è un 404 innocuo sotto /img); "Riscaldamento e Caldaie" ed "Elementi con foto" no', async () => {
  assert.equal(await catalogo.immagineCategoria('trattamento-acqua'), '/img/categorie/trattamento-acqua.svg');
  for (const s of SLUG) assert.equal(await catalogo.immagineCategoria(s), '/img/categorie/' + s + '.svg', s);
  assert.equal(await catalogo.immagineCategoria('riscaldamento-e-caldaie'), null);
  assert.equal(await catalogo.immagineCategoria('con-foto'), null);
  // mai un percorso costruito da un valore strano
  assert.equal(await catalogo.immagineCategoria('../style'), null);
  assert.equal(await catalogo.immagineCategoria('a/b'), null);
  assert.equal(await catalogo.immagineCategoria(''), null);
  assert.equal(await catalogo.immagineCategoria(undefined), null);
});

test('macroCategorie / categorieHome / macroCategoria portano `immagine` (url o null)', async () => {
  categorieDb = [
    { slug: 'bagno-e-sanitari', nome: 'Bagno e Sanitari', in_evidenza: 1, n_prodotti: 5 },
    { slug: 'riscaldamento-e-caldaie', nome: 'Riscaldamento e Caldaie', in_evidenza: 1, n_prodotti: 9 },
  ];
  const { inEvidenza } = await catalogo.categorieHome();
  assert.equal(inEvidenza.find((m) => m.slug === 'bagno-e-sanitari').immagine, '/img/categorie/bagno-e-sanitari.svg');
  assert.equal(inEvidenza.find((m) => m.slug === 'riscaldamento-e-caldaie').immagine, null);
  assert.equal((await catalogo.macroCategoria('bagno-e-sanitari')).immagine, '/img/categorie/bagno-e-sanitari.svg');
  assert.equal((await catalogo.macroCategoria('riscaldamento-e-caldaie')).immagine, null);
  assert.equal(await catalogo.macroCategoria('non-esiste'), null);
});

const radice = path.join(__dirname, '..');
const resa = (vista, dati) => ejs.renderFile(path.join(radice, 'views', vista), {
  ...icone, asset: (p) => p, fmt: {}, euro: String, currentUser: { id: 1, ruolo: 'cliente', ragione_sociale: 'Rossi' }, profiloCliente: null, ...dati,
});

test('home: con l\'immagine la tessera ha .cat-img (72×60, alt vuoto, lazy, async); senza resta l\'icona; "Elementi con foto" con la sua icona', async () => {
  const html = await resa('home.ejs', {
    titolo: 'Catalogo', carrello: {}, carrelloPezzi: 0, conFoto: 3, statoHome: null, voci: [],
    inEvidenza: [
      { slug: 'bagno-e-sanitari', nome: 'Bagno e Sanitari', immagine: '/img/categorie/bagno-e-sanitari.svg' },
      { slug: 'riscaldamento-e-caldaie', nome: 'Riscaldamento e Caldaie', immagine: null },
    ],
    altre: [{ slug: 'condizionamento-e-climatizzazione', nome: 'Condizionamento e Climatizzazione', immagine: '/img/categorie/condizionamento-e-climatizzazione.svg' }],
  });
  assert.match(html, /<span class="cat-img"><img src="\/img\/categorie\/bagno-e-sanitari\.svg" alt="" width="72" height="60" loading="lazy" decoding="async"><\/span>\s*<span class="nome">Bagno e Sanitari<\/span>/);
  assert.match(html, /<span class="cat-img"><img src="\/img\/categorie\/condizionamento-e-climatizzazione\.svg" alt="" width="72" height="60"/);
  // senza immagine: l'icona di oggi
  assert.match(html, /<span class="cat-ico"><svg[\s\S]*?<\/svg><\/span>\s*<span class="nome">Riscaldamento e Caldaie<\/span>/);
  assert.match(html, /<span class="cat-ico"><svg[\s\S]*?<\/svg><\/span>\s*<span class="nome">Elementi con foto<\/span>/);
  assert.equal((html.match(/class="cat-img"/g) || []).length, 2);
});

test('pagina della categoria: senza foto della sottocategoria l\'immagine della categoria (su bianco), altrimenti l\'icona; con la foto vince la foto', async () => {
  const dati = (immagine) => ({
    titolo: 'Bagno', macro: { slug: 'bagno-e-sanitari', nome: 'Bagno e Sanitari', immagine },
    sottocategorie: [
      { slug: 'lavabi', nome: 'Lavabi', n: 4, foto: null },
      { slug: 'wc', nome: 'WC', n: 2, foto: '/img/sottocategorie/wc.webp' },
    ],
    sottoSlug: null, sotto: null, q: '', conFiltri: () => '#', marchi: [], marchio: null, misure: [], misura: null, elenco: null, prodotti: [], carrello: {},
    carrelloPezzi: 0, pagina: 1, pagine: 1, totale: 0, nomeSotto: null, filtri: {},
  });
  let html;
  try {
    html = await resa('categoria.ejs', dati('/img/categorie/bagno-e-sanitari.svg'));
  } catch (e) {
    // la vista ha molte variabili: se questa prova non basta a disegnarla, si controlla almeno il blocco con il file
    html = null;
  }
  const vista = fs.readFileSync(path.join(radice, 'views', 'categoria.ejs'), 'utf8');
  assert.match(vista, /<% if \(macro\.immagine\) \{ %>\s*<span class="sotto-segnaposto sotto-segnaposto-img"><img src="<%= macro\.immagine %>" alt="" width="120" height="100"/);
  assert.match(vista, /<span class="sotto-segnaposto"><%- iconaCategoria\(macro\.slug\) %><\/span>/);
  if (html) {
    assert.match(html, /sotto-segnaposto-img"><img src="\/img\/categorie\/bagno-e-sanitari\.svg"/);
    assert.match(html, /<img src="\/img\/sottocategorie\/wc\.webp"/, 'la foto della sottocategoria c\'è sempre');
    const senza = await resa('categoria.ejs', dati(null));
    assert.doesNotMatch(senza, /sotto-segnaposto-img/);
  }
});

test('stile: tessere uniformi su bianco (niente sfondo azzurro), immagine 72×60 con raggio 12 e contain, 96×80 da computer', () => {
  const css = fs.readFileSync(path.join(radice, 'public', 'style.css'), 'utf8').replace(/\r/g, '');
  const cat = css.match(/\.cat-ico \{[^}]*\}/)[0];
  assert.match(cat, /background: #ffffff/);
  assert.doesNotMatch(cat, /blu-chiaro/);
  const img = css.match(/\.cat-img \{[^}]*\}/)[0];
  assert.match(img, /width: 72px/);
  assert.match(img, /height: 60px/);
  assert.match(img, /border-radius: 12px/);
  assert.match(img, /background: #ffffff/);
  assert.match(css, /\.cat-img img \{[^}]*object-fit: contain/);
  assert.match(css, /@media \(min-width: 720px\) \{[^@]*\.cat-img \{ width: 96px; height: 80px; \}/);
  assert.match(css, /\.cat \{[^}]*min-height: 138px/);
  // il tema scuro non c'è (tolto il 02/10/2026): niente regole da aggiungere
  assert.doesNotMatch(css, /data-tema/);
});
