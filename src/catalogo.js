const db = require('../db');

const PER_PAGINA = 40;

function etichettaVariante(variante_valori) {
  try {
    const arr = typeof variante_valori === 'string' ? JSON.parse(variante_valori) : variante_valori;
    return Array.isArray(arr) && arr.length ? arr.join(' ') : null;
  } catch (e) {
    return null;
  }
}

// Prodotti con lo stesso gruppo_id (stesso nome principale, misure diverse) vengono
// mostrati come una sola card con un selettore di varianti, invece che una riga per
// ciascuna misura. Un prodotto senza gruppo (o i cui "fratelli" non sono più attivi)
// resta invariato: zero rischio per il catalogo esistente.
async function raggruppaVarianti(righe) {
  const idGruppi = [...new Set(righe.filter((r) => r.gruppo_id).map((r) => r.gruppo_id))];
  if (!idGruppi.length) return righe;

  const placeholders = idGruppi.map(() => '?').join(',');
  const gruppi = await db
    .prepare(
      `SELECT g.id, g.nome_rappresentativo,
              p.id AS prodotto_id, p.nome, p.codice, p.variante_valori,
              p.prezzo_listino, p.sconto_base_pct, p.disponibilita, p.raee
         FROM product_groups g
         JOIN products p ON p.gruppo_id = g.id
        WHERE g.id IN (${placeholders}) AND p.attivo = 1`
    )
    .all(...idGruppi);

  const perGruppo = new Map();
  for (const m of gruppi) {
    if (!perGruppo.has(m.id)) perGruppo.set(m.id, { nome_rappresentativo: m.nome_rappresentativo, membri: [] });
    perGruppo.get(m.id).membri.push(m);
  }

  const giaMostrati = new Set();
  const risultato = [];
  for (const r of righe) {
    if (!r.gruppo_id) {
      risultato.push(r);
      continue;
    }
    if (giaMostrati.has(r.gruppo_id)) continue; // già rappresentato da un'altra riga dello stesso gruppo
    const gruppo = perGruppo.get(r.gruppo_id);
    if (!gruppo || gruppo.membri.length < 2) {
      risultato.push(r); // fratelli non più attivi: si comporta come un prodotto singolo
      continue;
    }
    giaMostrati.add(r.gruppo_id);
    const membriOrdinati = gruppo.membri.slice().sort((a, b) => a.prezzo_listino - b.prezzo_listino);
    const rappresentante = membriOrdinati.find((m) => m.prodotto_id === r.id) || membriOrdinati[0];
    risultato.push({
      ...r,
      id: rappresentante.prodotto_id,
      nome: gruppo.nome_rappresentativo || r.nome,
      codice: rappresentante.codice,
      prezzo_listino: rappresentante.prezzo_listino,
      sconto_base_pct: rappresentante.sconto_base_pct,
      disponibilita: rappresentante.disponibilita,
      varianti: membriOrdinati.map((m) => ({
        id: m.prodotto_id,
        etichetta: etichettaVariante(m.variante_valori) || m.nome,
        codice: m.codice,
        prezzo_listino: m.prezzo_listino,
        sconto_base_pct: m.sconto_base_pct,
        disponibilita: m.disponibilita,
        raee: m.raee,
      })),
    });
  }
  return risultato;
}

// Parole materiale riconosciute nel nome: non è una colonna (nessun campo "materiale"
// esiste nello schema), è una lista fissa validata sui dati reali del catalogo — nessuna
// di queste genera falsi positivi come sottostringa (verificato: le uniche occorrenze
// "senza spazio prima" sono composti legittimi come "inox-rame", "ppe-inox", mai rumore).
const MATERIALI_RICONOSCIUTI = [
  'ottone', 'inox', 'acciaio', 'rame', 'cromo', 'bronzo', 'polipropilene',
  'zincato', 'alluminio', 'plastica', 'pvc', 'ghisa', 'nichelato',
];

// Equivalenze pollici -> mm SOLO per le taglie gas/impianti a pressione: verificato sui
// dati che il catalogo non usa mai "DN", e che i diametri mm "tondi" più grandi (90, 110,
// 125, 160) appartengono a tubi di scarico/pluviale senza un vero equivalente in pollici
// in questo catalogo — non vanno mai aggiunti qui.
const EQUIVALENZE_POLLICI_MM = {
  '1/2': [15, 20],
  '3/4': [20, 22, 25], // 22 = misura rame comune per 3/4", sempre inclusa (non solo se il materiale è rame)
  '1': [25, 32],
  '1.1/4': [32, 40],
  '1.1/2': [40, 50],
  '2': [50, 63],
};

// "3/4"" -> "3/4": la stessa forma con cui è scritta la chiave delle equivalenze sopra.
function chiaveEquivalenza(termine) {
  return String(termine || '').replace(/"$/, '');
}

// Pattern Postgres (operatore ~*) per un diametro in mm ancorato a un confine non
// numerico: "20" non deve mai intercettare "Ø200" o "120". Uno o più valori insieme,
// es. frammentiDiametroMm([20,22,25]) -> 'ø\s?(20|22|25)(?!\d)'.
function frammentoDiametroMm(valoriMm) {
  return `ø\\s?(${valoriMm.join('|')})(?!\\d)`;
}

// Ricerca "parziale": ogni parola digitata deve comparire, anche solo come frammento,
// dentro nome / codice / categoria / marchio del prodotto. Scrivendo "valv" escono tutte
// le valvole; scrivendo "toshiba estia" escono le pompe di calore ESTIA.
async function cercaProdotti(
  query,
  {
    macroSlug = null, brandSlug = null, famiglia = null, sotto = null, misura = null,
    materiale = null, diametro = null, limite = 100,
  } = {}
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
  // Chip "Materiale" già scelta: stesso confronto sostanziale della ricerca per termine,
  // isolato come filtro esplicito invece che mescolato al testo digitato.
  if (materiale) {
    where.push('LOWER(p.nome) LIKE ?');
    params.push(`%${materiale.toLowerCase()}%`);
  }
  // Chip "Diametro" già scelta: valore preso 1:1 da uno dei tag calcolati da
  // tagRaffinamento() (es. "20 mm" o '3/4"'), quindi già nella forma giusta per il
  // pattern corrispondente.
  if (diametro) {
    const mm = diametro.match(/^(\d{2,3})\s?mm$/i);
    if (mm) {
      where.push('p.nome ~* ?');
      params.push(frammentoDiametroMm([mm[1]]));
    } else {
      const pollici = chiaveEquivalenza(diametro).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.push('p.nome ~* ?');
      params.push(`${pollici}\\s*"`);
    }
  }

  for (const t of termini) {
    const bloccoBase = `(LOWER(p.nome) LIKE ? OR LOWER(p.codice) LIKE ? OR LOWER(COALESCE(p.categoria, '')) LIKE ?
        OR LOWER(COALESCE(m.nome, '')) LIKE ? OR LOWER(COALESCE(b.nome, '')) LIKE ?
        OR LOWER(COALESCE(p.ean, '')) LIKE ?)`;
    const like = `%${t}%`;
    const paramsBase = [like, like, like, like, like, like];

    // Il termine digitato è una misura in pollici riconosciuta (es. "3/4", '3/4"'): oltre
    // al confronto testuale letterale di sempre, si prova anche il match sui millimetri
    // equivalenti scritti nel nome — solo su nome (mai su codice/categoria/marchio/ean,
    // per non allargare la superficie di falsi positivi a campi dove un "20" nudo
    // significherebbe altro).
    const equivalenti = EQUIVALENZE_POLLICI_MM[chiaveEquivalenza(t)];
    if (equivalenti) {
      where.push(`(${bloccoBase} OR p.nome ~* ?)`);
      params.push(...paramsBase, frammentoDiametroMm(equivalenti));
    } else {
      where.push(bloccoBase);
      params.push(...paramsBase);
    }
  }

  // Chi inizia con il testo digitato viene prima (cercando "valv" prima le "Valvola ...").
  const primoTermine = termini[0] ? `${termini[0]}%` : null;
  const ordinePrefisso = primoTermine
    ? 'CASE WHEN LOWER(p.nome) LIKE ? THEN 0 WHEN LOWER(p.codice) LIKE ? THEN 1 ELSE 2 END,'
    : '';
  const paramsOrdine = primoTermine ? [primoTermine, primoTermine] : [];

  const righeGrezze = await db
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
  return raggruppaVarianti(righeGrezze);
}

// ---------- Tag di raffinamento (diametro, materiale) ----------
//
// Diametro e materiale non sono colonne del DB (niente "materiale", e "misura" è di
// fatto vuota su tutto il catalogo): a differenza di misureDisponibili()/
// marchiNellaCategoria() qui sotto, che fanno un GROUP BY su una colonna reale,
// l'aggregazione va fatta in JS sui risultati già recuperati — nessuna query aggiuntiva.

const RE_DIAMETRO_POLLICI = /(\d+(?:\.\d+)?\/\d+|\d+)\s*"/g;
const RE_DIAMETRO_MM = /ø\s?(\d{2,3})(?!\d)/gi;
const RE_DIAMETRO_MM_NUDO = /(?<![a-z0-9])(\d{2,3})\s?mm(?![a-z])/gi;

function estraiTagDaTesto(testoGrezzo) {
  const testo = String(testoGrezzo || '');
  const bassa = testo.toLowerCase();

  const diametri = new Set();
  let m;
  RE_DIAMETRO_POLLICI.lastIndex = 0;
  while ((m = RE_DIAMETRO_POLLICI.exec(testo))) diametri.add(m[1] + '"');
  RE_DIAMETRO_MM.lastIndex = 0;
  while ((m = RE_DIAMETRO_MM.exec(testo))) diametri.add(m[1] + ' mm');
  RE_DIAMETRO_MM_NUDO.lastIndex = 0;
  while ((m = RE_DIAMETRO_MM_NUDO.exec(testo))) diametri.add(m[1] + ' mm');

  const materiali = MATERIALI_RICONOSCIUTI.filter((parola) => bassa.includes(parola));
  return { diametri: [...diametri], materiali };
}

// Diametri e materiali più frequenti in un elenco di prodotti già recuperato (risultato
// di una ricerca o di una pagina categoria) — pensati come chip di raffinamento rapido,
// non come conteggio esaustivo. Sui prodotti raggruppati per varianti (raggruppaVarianti())
// "nome" è il nome rappresentativo del gruppo e spesso NON contiene la misura (che vive
// nell'etichetta di ogni singola variante, es. 'Ø3/4"ff') — verificato che senza includere
// anche le etichette il chip "Diametro" può sparire del tutto su risultati dominati da
// prodotti raggruppati (oltre un terzo del catalogo). Si estrae quindi da nome + tutte le
// etichette varianti insieme, non solo da nome.
function tagRaffinamento(righe, { limiteDiametri = 8, limiteMateriali = 8 } = {}) {
  const contaD = new Map();
  const contaM = new Map();
  for (const r of righe || []) {
    const testo = r.nome + (Array.isArray(r.varianti) ? ' ' + r.varianti.map((v) => v.etichetta).join(' ') : '');
    const { diametri, materiali } = estraiTagDaTesto(testo);
    for (const d of diametri) contaD.set(d, (contaD.get(d) || 0) + 1);
    for (const mat of materiali) contaM.set(mat, (contaM.get(mat) || 0) + 1);
  }
  const top = (mappa, limite) =>
    [...mappa.entries()]
      .map(([valore, n]) => ({ valore, n }))
      .sort((a, b) => b.n - a.n || a.valore.localeCompare(b.valore))
      .slice(0, limite);
  return { diametri: top(contaD, limiteDiametri), materiali: top(contaM, limiteMateriali) };
}

// ---------- Macro categorie ----------

async function macroCategorie() {
  return db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM products p WHERE p.macro_slug = m.slug AND p.attivo = 1) AS n_prodotti
         FROM macro_categorie m
        ORDER BY m.priorita, m.ordine, m.nome`
    )
    .all();
}

// Le categorie che in cantiere si cercano più spesso: vanno in cima alla home.
async function categorieInEvidenza() {
  const cats = await macroCategorie();
  return cats.filter((m) => m.in_evidenza === 1);
}

async function altreCategorie() {
  const cats = await macroCategorie();
  return cats.filter((m) => m.in_evidenza !== 1 && m.n_prodotti > 0);
}

// ---------- Sottocategorie e misure ----------

async function sottocategorieDi(macroSlug) {
  const rows = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM products p
                     WHERE p.macro_slug = s.macro_slug AND p.sottocategoria = s.slug AND p.attivo = 1) AS n
         FROM sottocategorie s
        WHERE s.macro_slug = ?
        ORDER BY s.ordine, s.nome`
    )
    .all(macroSlug);
  return rows.filter((s) => s.n > 0);
}

async function sottocategoria(macroSlug, slug) {
  return db
    .prepare('SELECT * FROM sottocategorie WHERE macro_slug = ? AND slug = ?')
    .get(macroSlug, slug);
}

// Misure realmente presenti fra i prodotti di un elenco: è il primo filtro che serve
// a un installatore, prima ancora della marca.
async function misureDisponibili({ macroSlug = null, sotto = null, brandSlug = null } = {}) {
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
async function marchiNellaCategoria({ macroSlug = null, sotto = null } = {}) {
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

async function macroCategoria(slug) {
  return db.prepare('SELECT * FROM macro_categorie WHERE slug = ?').get(slug);
}

// ---------- Elenchi paginati ----------

async function paginato({ where, params, pagina = 1, perPagina = PER_PAGINA }) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM products p WHERE ${where}`
    )
    .get(...params);
  const totale = row ? Number(row.n) : 0;

  const pagine = Math.max(1, Math.ceil(totale / perPagina));
  const p = Math.min(Math.max(1, parseInt(pagina, 10) || 1), pagine);

  const righeGrezze = await db
    .prepare(
      `SELECT p.*, b.nome AS brand_nome, b.colore AS brand_colore
         FROM products p
         LEFT JOIN brands b ON b.slug = p.brand_slug
        WHERE ${where}
        ORDER BY p.nome
        LIMIT ? OFFSET ?`
    )
    .all(...params, perPagina, (p - 1) * perPagina);
  const righe = await raggruppaVarianti(righeGrezze);

  return { righe, totale, pagina: p, pagine, perPagina };
}

// Prodotti di una categoria, filtrabili per sottocategoria, misura e marchio.
// materiale/diametro accettati per simmetria con cercaProdotti() (stessa logica di
// estrazione dal testo, vedi sopra) — non ancora collegati a un filtro visibile in
// categoria.ejs, pronti per quando si deciderà di estenderla.
async function prodottiDellaCategoria(
  macroSlug,
  { sotto = null, misura = null, marchio = null, materiale = null, diametro = null, pagina = 1 } = {}
) {
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
  if (materiale) {
    where.push('LOWER(p.nome) LIKE ?');
    params.push(`%${materiale.toLowerCase()}%`);
  }
  if (diametro) {
    const mm = diametro.match(/^(\d{2,3})\s?mm$/i);
    if (mm) {
      where.push('p.nome ~* ?');
      params.push(frammentoDiametroMm([mm[1]]));
    } else {
      const pollici = chiaveEquivalenza(diametro).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      where.push('p.nome ~* ?');
      params.push(`${pollici}\\s*"`);
    }
  }
  return paginato({ where: where.join(' AND '), params, pagina });
}

// ---------- Marchi ----------

async function marchi() {
  return db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_slug = b.slug AND p.attivo = 1) AS n_prodotti
         FROM brands b
        WHERE b.attivo = 1
        ORDER BY b.ordine, b.nome`
    )
    .all();
}

async function marchio(slug) {
  return db.prepare('SELECT * FROM brands WHERE slug = ? AND attivo = 1').get(slug);
}

async function famiglieDelMarchio(slug) {
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

async function famigliaDelMarchio(slug, codice) {
  return db
    .prepare('SELECT * FROM brand_families WHERE brand_slug = ? AND codice = ?')
    .get(slug, codice);
}

async function prodottiDelMarchio(slug, famiglia, pagina) {
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
  tagRaffinamento,
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
