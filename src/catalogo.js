const db = require('../db');

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria del prodotto. Scrivendo "valv" escono tutte le valvole.
function cercaProdotti(query, { macroSlug = null, limite = 100 } = {}) {
  const termini = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const where = ['p.attivo = 1'];
  const params = [];

  if (macroSlug) {
    where.push('p.macro_slug = ?');
    params.push(macroSlug);
  }

  for (const t of termini) {
    where.push(
      '(LOWER(p.nome) LIKE ? OR LOWER(p.codice) LIKE ? OR LOWER(IFNULL(p.categoria, \'\')) LIKE ? OR LOWER(IFNULL(m.nome, \'\')) LIKE ?)'
    );
    const like = `%${t}%`;
    params.push(like, like, like, like);
  }

  // Chi inizia con il testo digitato viene prima (cercando "valv" prima le "Valvola ...").
  const primoTermine = termini[0] ? `${termini[0]}%` : null;
  const ordinePrefisso = primoTermine
    ? 'CASE WHEN LOWER(p.nome) LIKE ? THEN 0 WHEN LOWER(p.codice) LIKE ? THEN 1 ELSE 2 END,'
    : '';
  const paramsOrdine = primoTermine ? [primoTermine, primoTermine] : [];

  return db
    .prepare(
      `SELECT p.*, m.nome AS macro_nome
         FROM products p
         LEFT JOIN macro_categorie m ON m.slug = p.macro_slug
        WHERE ${where.join(' AND ')}
        ORDER BY ${ordinePrefisso} p.categoria, p.nome
        LIMIT ?`
    )
    .all(...params, ...paramsOrdine, limite);
}

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

// Prodotti di una macro categoria, raggruppati per categoria di dettaglio.
function prodottiPerMacro(slug) {
  const prodotti = db
    .prepare(
      `SELECT * FROM products
        WHERE attivo = 1 AND macro_slug = ?
        ORDER BY categoria, nome`
    )
    .all(slug);

  const gruppi = [];
  for (const p of prodotti) {
    const nome = p.categoria || 'Altro';
    let gruppo = gruppi.find((g) => g.nome === nome);
    if (!gruppo) {
      gruppo = { nome, prodotti: [] };
      gruppi.push(gruppo);
    }
    gruppo.prodotti.push(p);
  }
  return gruppi;
}

module.exports = { cercaProdotti, macroCategorie, macroCategoria, prodottiPerMacro };
