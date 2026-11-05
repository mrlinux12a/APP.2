// Catalogo dell'app: categorie, prodotti, ricerca ed elementi con foto.
const { creaRouter } = require('../base');
const catalogo = require('../../logica/catalogo/catalogo');
const pricing = require('../../logica/pagamenti/pricing');
const { prodottoJson } = require('../../logica/catalogo/prodotto_json');
const limiti = require('../../middleware/limiti');
const { richiedeCliente } = require('./ausiliari');

const router = creaRouter();

// Formato prodotto dell'app: quello già usato dalla ricerca live del sito, più i valori
// numerici del prezzo (servono all'app per il totale indicativo del carrello) e lo sconto
// di ogni variante (per il prezzo di listino barrato).
function prodottoApp(p) {
  const base = prodottoJson(p);
  return {
    ...base,
    categoria: p.categoria || null,
    prezzo_valore: pricing.prezzoNetto(p),
    varianti: base.varianti
      ? base.varianti.map((v, i) => ({
          ...v,
          sconto_base_pct: p.varianti[i].sconto_base_pct,
          prezzo_valore: pricing.prezzoNetto(p.varianti[i]),
        }))
      : null,
  };
}

// Trasforma un elenco di prodotti nella risposta dell'app: schede con i prezzi, più pagina, numero di pagine e totale.
async function elencoJson(elenco) {
  return {
    risultati: elenco.righe.map((p) => prodottoApp(p)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  };
}

// `immagine`: indirizzo ASSOLUTO dell'immagine della categoria (public/img/categorie/<slug>.svg) o null se il file non c'è (l'app resta con l'icona). APP_URL se c'è, altrimenti
// l'indirizzo con cui è stata fatta la richiesta; l'app la mostra con SvgUri (react-native-svg).
function urlAssoluto(req, percorso) {
  if (!percorso) return null;
  const base = String(process.env.APP_URL || '').trim().replace(/\/+$/, '') || req.protocol + '://' + req.get('host');
  return base + percorso;
}

// Una categoria come la vede l'app: nome, descrizione, numero di prodotti e immagine (con indirizzo completo).
function macroJson(m, req) {
  return { slug: m.slug, nome: m.nome, descrizione: m.descrizione, n_prodotti: Number(m.n_prodotti) || 0, immagine: urlAssoluto(req, m.immagine) };
}

router.get('/catalogo', richiedeCliente, async (req, res) => {
  const [{ inEvidenza, altre }, conFoto] = await Promise.all([
    catalogo.categorieHome(),
    catalogo.contaProdottiConFoto(),
  ]);
  res.json({ in_evidenza: inEvidenza.map((m) => macroJson(m, req)), altre: altre.map((m) => macroJson(m, req)), con_foto: conFoto });
});

// Ricerca mentre si digita, con lo stesso ambito delle pagine del sito (categoria,
// sottocategoria). I marchi non ci sono: nel sito /marchi non è collegato da nessuna
// pagina e oggi nessun marchio ha prodotti attivi.
router.get('/cerca', limiti.ricerca, richiedeCliente, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ risultati: [] });
  const risultati = await catalogo.cercaProdotti(q, {
    macroSlug: req.query.macro || null,
    sotto: req.query.sotto || null,
  });
  res.json({ risultati: risultati.map((p) => prodottoApp(p)), troncato: !!risultati.troncato });
});

// Una categoria con le sue sottocategorie (404 se non esiste).
router.get('/categorie/:slug', richiedeCliente, async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ errore: 'Categoria non trovata.' });
  const sottocategorie = await catalogo.sottocategorieDi(macro.slug);
  res.json({
    macro: { slug: macro.slug, nome: macro.nome, descrizione: macro.descrizione, immagine: urlAssoluto(req, macro.immagine) },
    // `foto`: indirizzo assoluto della foto della sottocategoria (public/img/sottocategorie/<slug>.webp, 4:3) o null: allora l'app ripiega sul fondo con l'icona della categoria, come il sito.
    sottocategorie: sottocategorie.map((s) => ({ slug: s.slug, nome: s.nome, n: Number(s.n) || 0, foto: urlAssoluto(req, s.foto) })),
  });
});

// I prodotti di una categoria, pagina per pagina (anche di una sola sottocategoria); ha il limite sulle ricerche.
router.get('/categorie/:slug/prodotti', limiti.ricerca, richiedeCliente, async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ errore: 'Categoria non trovata.' });
  const elenco = await catalogo.prodottiDellaCategoria(macro.slug, {
    sotto: req.query.sotto || null,
    pagina: req.query.pagina,
  });
  res.json(await elencoJson(elenco));
});

// I prodotti che hanno una foto, pagina per pagina.
router.get('/con-foto', richiedeCliente, async (req, res) => {
  res.json(await elencoJson(await catalogo.prodottiConFoto({ pagina: req.query.pagina })));
});

module.exports = router;
