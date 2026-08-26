const db = require('../db');

const PER_PAGINA = 40;

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria / marchio del prodotto. Scrivendo "valv" escono tutte
// le valvole; scrivendo "toshiba estia" escono le pompe di calore ESTIA.
function cercaProdotti(
  query,
  { macroSlug = null, brandSlug = null, famiglia = null, gruppo = null, limite = 100 } = {}
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
  if (gruppo) {
    where.push(`IFNULL(NULLIF(p.categoria, ''), 'Altro') = ?`);
    params.push(gruppo);
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
        ORDER BY m.ordine, m.nome`
    )
    .all();
}

function macroCategoria(slug) {
  return db.prepare('SELECT * FROM macro_categorie WHERE slug = ?').get(slug);
}

// Sottocategorie di una macro, con il numero di prodotti: con listini da migliaia di
// articoli si sceglie prima il gruppo, poi si sfogliano i prodotti.
function gruppiPerMacro(slug) {
  return db
    .prepare(
      `SELECT IFNULL(NULLIF(categoria, ''), 'Altro') AS nome, COUNT(*) AS n
         FROM products
        WHERE attivo = 1 AND macro_slug = ?
        GROUP BY IFNULL(NULLIF(categoria, ''), 'Altro')
        ORDER BY nome`
    )
    .all(slug);
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

function prodottiDelGruppo(macroSlug, gruppo, pagina) {
  return paginato({
    where: `p.attivo = 1 AND p.macro_slug = ? AND IFNULL(NULLIF(p.categoria, ''), 'Altro') = ?`,
    params: [macroSlug, gruppo],
    pagina,
  });
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
  macroCategoria,
  gruppiPerMacro,
  prodottiDelGruppo,
  marchi,
  marchio,
  famiglieDelMarchio,
  famigliaDelMarchio,
  prodottiDelMarchio,
};
