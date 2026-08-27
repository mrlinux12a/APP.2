const db = require('../db');

const PER_PAGINA = 40;

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria / marchio del prodotto. Scrivendo "valv" escono tutte
// le valvole; scrivendo "toshiba estia" escono le pompe di calore ESTIA.
function cercaProdotti(
  query,
  { macroSlug = null, brandSlug = null, famiglia = null, sotto = null, misura = null, limite = 100 } = {}
) {
  const termini = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const where = ['p.attivo = 1'];
  const params = [];

  // Gli stessi filtri della pagina da cui si cerca: chi sta sfogliando una famiglia
  // cerca dentro quella famiglia, non in tutto il catalogo.
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (brandSlug) {
    where.push('p.brand_slug = ?');
    params.push(brandSlug);
  }
  if (famiglia) {
    where.push('p.famiglia = ?');
    params.push(famiglia);
  }
  if (sotto) {
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  if (misura) {
    where.push('p.misura = ?');
    params.push(misura);
  }

  for (const t of termini) {
    where.push(
      `(LOWER(p.nome) LIKE ? OR LOWER(p.codice) LIKE ? OR LOWER(IFNULL(p.categoria, '')) LIKE ?
        OR LOWER(IFNULL(m.nome, '')) LIKE ? OR LOWER(IFNULL(b.nome, '')) LIKE ?
        OR LOWER(IFNULL(p.ean, '')) LIKE ?)`
    );
    const like = `%${t}%`;
    params.push(like, like, like, like, like, like);
  }

  // Chi inizia con il testo digitato viene prima (cercando "valv" prima le "Valvola ...").
  const primoTermine = termini[0] ? `${termini[0]}%` : null;
  const ordinePrefisso = primoTermine
    ? 'CASE WHEN LOWER(p.nome) LIKE ? THEN 0 WHEN LOWER(p.codice) LIKE ? THEN 1 ELSE 2 END,'
    : '';
  const paramsOrdine = primoTermine ? [primoTermine, primoTermine] : [];

  return db
    .prepare(
      `SELECT p.*, m.nome AS macro_nome, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN macro_categorie m ON m.slug = p.macro_slug
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where.join(' AND ')}
        ORDER BY ${ordinePrefisso} p.categoria, p.nome
        LIMIT ?`
    )
    .all(...params, ...paramsOrdine, limite);
}

// ---------- Macro categorie ----------

function macroCategorie() {
  return db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.macro_slug = m.slug AND p.attivo = 1) AS n_prodotti
         FROM macro_categorie m
        ORDER BY m.priorita, m.ordine, m.nome`
    )
    .all();
}

// Le categorie che in cantiere si cercano più spesso: vanno in cima alla home.
function categorieInEvidenza() {
  return macroCategorie().filter((m) => m.in_evidenza === 1);
}

function altreCategorie() {
  return macroCategorie().filter((m) => m.in_evidenza !== 1 && m.n_prodotti > 0);
}

// ---------- Sottocategorie e misure ----------

function sottocategorieDi(macroSlug) {
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM products p
                     WHERE p.macro_slug = s.macro_slug AND p.sottocategoria = s.slug AND p.attivo = 1) AS n
         FROM sottocategorie s
        WHERE s.macro_slug = ?
        ORDER BY s.ordine, s.nome`
    )
    .all(macroSlug)
    .filter((s) => s.n > 0);
}

function sottocategoria(macroSlug, slug) {
  return db
    .prepare('SELECT * FROM sottocategorie WHERE macro_slug = ? AND slug = ?')
    .get(macroSlug, slug);
}

// Misure realmente presenti fra i prodotti di un elenco: è il primo filtro che serve
// a un installatore, prima ancora della marca.
function misureDisponibili({ macroSlug = null, sotto = null, brandSlug = null } = {}) {
  const where = ["p.attivo = 1", "p.misura <> ''"];
  const params = [];
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (sotto) {
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  if (brandSlug) {
    where.push('p.brand_slug = ?');
    params.push(brandSlug);
  }
  return db
    .prepare(
      `SELECT p.misura, COUNT(*) AS n FROM products p
        WHERE ${where.join(' AND ')}
        GROUP BY p.misura
        ORDER BY n DESC, p.misura
        LIMIT 24`
    )
    .all(...params);
}

// Marchi presenti dentro una categoria: la categoria è il livello principale,
// il marchio è un filtro che sta sotto.
function marchiNellaCategoria({ macroSlug = null, sotto = null } = {}) {
  const where = ["p.attivo = 1", "p.brand_slug <> ''"];
  const params = [];
  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }
  if (sotto) {
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  return db
    .prepare(
      `SELECT b.slug, b.nome, b.colore, b.iniziali, COUNT(*) AS n
         FROM products p JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where.join(' AND ')}
        GROUP BY b.slug, b.nome, b.colore, b.iniziali
        ORDER BY n DESC`
    )
    .all(...params);
}

function macroCategoria(slug) {
  return db.prepare('SELECT * FROM macro_categorie WHERE slug = ?').get(slug);
}

// ---------- Elenchi paginati ----------

function paginato({ where, params, pagina = 1, perPagina = PER_PAGINA }) {
  const totale = db
    .prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE ${where}`
    )
    .get(...params).n;

  const pagine = Math.max(1, Math.ceil(totale / perPagina));
  const p = Math.min(Math.max(1, parseInt(pagina, 10) || 1), pagine);

  const righe = db
    .prepare(
      `SELECT p.*, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where}
        ORDER BY p.nome
        LIMIT ? OFFSET ?`
    )
    .all(...params, perPagina, (p - 1) * perPagina);

  return { righe, totale, pagina: p, pagine, perPagina };
}

// Prodotti di una categoria, filtrabili per sottocategoria, misura e marchio.
function prodottiDellaCategoria(macroSlug, { sotto = null, misura = null, marchio = null, pagina = 1 } = {}) {
  const where = ['p.attivo = 1', 'p.macro_slug = ?'];
  const params = [macroSlug];
  if (sotto) {
    where.push('p.sottocategoria = ?');
    params.push(sotto);
  }
  if (misura) {
    where.push('p.misura = ?');
    params.push(misura);
  }
  if (marchio) {
    where.push('p.brand_slug = ?');
    params.push(marchio);
  }
  return paginato({ where: where.join(' AND '), params, pagina });
}

// ---------- Marchi ----------

function marchi() {
  return db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_slug = b.slug AND p.attivo = 1) AS n_prodotti
         FROM brands b
        WHERE b.attivo = 1
        ORDER BY b.ordine, b.nome`
    )
    .all();
}

function marchio(slug) {
  return db.prepare('SELECT * FROM brands WHERE slug = ? AND attivo = 1').get(slug);
}

function famiglieDelMarchio(slug) {
  return db
    .prepare(
      `SELECT f.*,
              (SELECT COUNT(*) FROM products p
                WHERE p.brand_slug = f.brand_slug AND p.famiglia = f.codice AND p.attivo = 1) AS n_prodotti
         FROM brand_families f
        WHERE f.brand_slug = ?
        ORDER BY f.ordine, f.nome`
    )
    .all(slug);
}

function famigliaDelMarchio(slug, codice) {
  return db
    .prepare('SELECT * FROM brand_families WHERE brand_slug = ? AND codice = ?')
    .get(slug, codice);
}

function prodottiDelMarchio(slug, famiglia, pagina) {
  if (famiglia) {
    return paginato({
      where: 'p.attivo = 1 AND p.brand_slug = ? AND p.famiglia = ?',
      params: [slug, famiglia],
      pagina,
    });
  }
  return paginato({
    where: 'p.attivo = 1 AND p.brand_slug = ?',
    params: [slug],
    pagina,
  });
}

module.exports = {
  PER_PAGINA,
  cercaProdotti,
  macroCategorie,
  categorieInEvidenza,
  altreCategorie,
  macroCategoria,
  sottocategorieDi,
  sottocategoria,
  misureDisponibili,
  marchiNellaCategoria,
  prodottiDellaCategoria,
  marchi,
  marchio,
  famiglieDelMarchio,
  famigliaDelMarchio,
  prodottiDelMarchio,
};
