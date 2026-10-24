// Il catalogo che sfoglia l'installatore: home con le categorie, ricerca, categorie e sottocategorie, "Elementi con foto", marchi e punti vendita sulla mappa.
const { creaRouter } = require('./base');
const db = require('../../db');
const { requireLogin, requireRole } = require('../auth');
const catalogo = require('../catalogo');
const geo = require('../geo');
const { prodottoJson } = require('../prodotto_json');
const { getCarrello } = require('../services/carrello_sessione');
const limiti = require('../middleware/limiti');

const router = creaRouter();

// ---------- Home, ricerca, categorie ----------

// Mostra la home dell'installatore: la ricerca e la griglia delle categorie.
router.get('/home', requireRole('cliente'), async (req, res) => {
  const [{ inEvidenza, altre }, prodottiConFotoConta] = await Promise.all([
    catalogo.categorieHome(),
    catalogo.contaProdottiConFoto(),
  ]);
  res.render('home', { titolo: 'Ordini Minuteria', inEvidenza, altre, prodottiConFotoConta, carrello: getCarrello(req) });
});

// Una ricerca dentro una categoria o un marchio, nella forma dell'elenco delle pagine ({ righe, ricerca, troncato }).
async function cercaComeElenco(q, ambito) {
  const righe = await catalogo.cercaProdotti(q, ambito);
  return { righe, ricerca: true, troncato: !!righe.troncato };
}

// Mostra la pagina dei risultati di una ricerca (/cerca?q=...).
router.get('/cerca', limiti.ricerca, requireRole('cliente'), async (req, res) => {
  const q = (req.query.q || '').trim();
  const diametro = req.query.diametro || null;
  const materiale = req.query.materiale || null;
  const risultati = q ? await catalogo.cercaProdotti(q, { diametro, materiale }) : [];
  res.render('cerca', {
    titolo: 'Cerca',
    q,
    diametro,
    materiale,
    risultati,
    troncato: !!risultati.troncato,
    carrello: getCarrello(req),
  });
});

// Ricerca mentre si digita: stessa logica parziale della pagina /cerca, ma risponde con i risultati in JSON (da 2 lettere in su).
router.get('/api/cerca', limiti.ricerca, requireRole('cliente'), async (req, res) => {
  const q = (req.query.q || '').trim();
  // L'ambito arriva dalla pagina che sta cercando: categoria, marchio, famiglia, gruppo.
  const ambito = {
    macroSlug: req.query.macro || null,
    brandSlug: req.query.marchio || null,
    famiglia: req.query.famiglia || null,
    sotto: req.query.sotto || null,
    misura: req.query.misura || null,
    materiale: req.query.materiale || null,
    diametro: req.query.diametro || null,
  };
  const risultati = q.length >= 2 ? await catalogo.cercaProdotti(q, ambito) : [];
  res.json({ risultati: risultati.map((p) => prodottoJson(p)), troncato: !!risultati.troncato });
});

// Mostra la vetrina "Elementi con foto": trasversale alle categorie, cresce da sola man mano che i prodotti guadagnano una foto (vedi
// catalogo.prodottiConFoto).
router.get('/con-foto', requireRole('cliente'), async (req, res) => {
  const elenco = await catalogo.prodottiConFoto({ pagina: req.query.p });
  res.render('con_foto', {
    titolo: 'Elementi con foto',
    elenco,
    carrello: getCarrello(req),
  });
});

// Dà la pagina successiva di "Elementi con foto" in JSON, per lo scroll infinito.
router.get('/api/con-foto/prodotti', limiti.ricerca, requireRole('cliente'), async (req, res) => {
  const elenco = await catalogo.prodottiConFoto({ pagina: req.query.pagina });
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  });
});

// Dà la pagina successiva di una categoria/sottocategoria in JSON, per lo scroll infinito: stessi filtri di /categoria/:slug, ma restituisce solo i
// prodotti da accodare.
router.get('/api/categoria/:slug/prodotti', limiti.ricerca, requireRole('cliente'), async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ risultati: [] });
  const elenco = await catalogo.prodottiDellaCategoria(macro.slug, {
    sotto: req.query.sotto || null,
    misura: req.query.misura || null,
    marchio: req.query.marchio || null,
    pagina: req.query.pagina,
  });
  res.json({
    risultati: elenco.righe.map((p) => prodottoJson(p)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  });
});

// Mostra una categoria: le sue sottocategorie, oppure (scelta una sottocategoria, o se non ce ne sono) l'elenco dei prodotti con la ricerca dentro la
// categoria.
router.get('/categoria/:slug', requireRole('cliente'), async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).render('errore', { titolo: 'Non trovata', messaggio: 'Categoria non trovata.' });

  const sottocategorie = await catalogo.sottocategorieDi(macro.slug);
  const sottoSlug = req.query.sotto || (sottocategorie.length === 1 ? sottocategorie[0].slug : null);
  const sotto = sottoSlug ? await catalogo.sottocategoria(macro.slug, sottoSlug) : null;
  // Senza sottocategorie censite si sfoglia direttamente tutta la macro categoria, invece di mostrare un elenco di sottocategorie vuoto.
  const sfogliaDiretto = sottocategorie.length === 0;
  const misura = req.query.misura || null;
  const marchio = req.query.marchio || null;
  const q = (req.query.q || '').trim();

  // Con una ricerca attiva l'elenco è quello dei risultati, senza paginazione.
  const elenco = q
    ? await cercaComeElenco(q, { macroSlug: macro.slug, sotto: sottoSlug })
    : sottoSlug || sfogliaDiretto
    ? await catalogo.prodottiDellaCategoria(macro.slug, { sotto: sottoSlug, misura, marchio, pagina: req.query.p })
    : null;

  res.render('categoria', {
    titolo: macro.nome,
    macro,
    sottocategorie,
    sotto,
    sottoSlug,
    marchi: sottoSlug || sfogliaDiretto ? await catalogo.marchiNellaCategoria({ macroSlug: macro.slug, sotto: sottoSlug }) : [],
    marchio,
    misura,
    q,
    elenco,
    carrello: getCarrello(req),
  });
});

// ---------- Punti vendita sulla mappa ----------

// Mostra i punti vendita sulla mappa, con la distanza se l'utente ha condiviso la posizione. Il banco non ha più questa pagina (tolta dal suo menu il
// 14/10/2026): per lui è come se non esistesse (404).
router.get('/punti-vendita', requireLogin, async (req, res, next) => {
  if (req.session.user.ruolo === 'distributore') return next();
  const punti = await db
    .prepare(
      `SELECT s.*, d.nome AS distributore, d.zona
         FROM store_locations s
         JOIN distributors d ON d.id = s.distributor_id
        WHERE s.attivo = 1 AND s.geo_lat IS NOT NULL
        ORDER BY d.nome, s.nome`
    )
    .all();

  const mia = await geo.statoUtente(req.session.user.id);
  const conDistanza = punti.map((p) => {
    const km = mia.consenso ? geo.distanzaKm({ lat: mia.lat, lng: mia.lng }, { lat: p.geo_lat, lng: p.geo_lng }) : null;
    return { ...p, km, distanza: geo.formattaDistanza(km) };
  });
  // Con la posizione condivisa l'elenco parte dal punto vendita più vicino.
  if (mia.consenso) conDistanza.sort((a, b) => (a.km === null ? 1 : b.km === null ? -1 : a.km - b.km));

  const insegne = [...new Set(punti.map((p) => p.distributore))];

  res.render('punti_vendita', {
    titolo: 'Punti vendita',
    punti: conDistanza,
    insegne,
    citta: [...new Set(punti.map((p) => p.citta))],
  });
});

// ---------- Marchi ----------

// Mostra l'elenco dei marchi.
router.get('/marchi', requireRole('cliente'), async (req, res) => {
  res.render('marchi', { titolo: 'Marchi', marchi: await catalogo.marchi() });
});

// Mostra un marchio: le sue famiglie di prodotti, oppure (scelta una famiglia) i prodotti, con la ricerca dentro il marchio.
router.get('/marchi/:slug', requireRole('cliente'), async (req, res) => {
  const marca = await catalogo.marchio(req.params.slug);
  if (!marca) return res.status(404).render('errore', { titolo: 'Non trovato', messaggio: 'Marchio non trovato.' });

  const famiglie = await catalogo.famiglieDelMarchio(marca.slug);
  const codice = req.query.famiglia || null;
  const famiglia = codice ? await catalogo.famigliaDelMarchio(marca.slug, codice) : null;
  const q = (req.query.q || '').trim();

  // Cercando dentro un marchio i risultati restano dentro quel marchio (e, se si sta sfogliando una famiglia, dentro quella famiglia).
  const elenco = q
    ? await cercaComeElenco(q, { brandSlug: marca.slug, famiglia: codice })
    : codice
    ? await catalogo.prodottiDelMarchio(marca.slug, codice, req.query.p)
    : null;

  res.render('marchio', { titolo: marca.nome, marca, famiglie, famiglia, q, elenco, carrello: getCarrello(req) });
});

module.exports = router;
