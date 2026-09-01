// Riporta il catalogo sulla tassonomia per frequenza d'uso (db/tassonomia.js):
// crea categorie e sottocategorie, poi assegna a ogni prodotto la sua sottocategoria e
// la misura ricavata dalla descrizione.
//
//   node db/riclassifica.js
//
// È idempotente: si può rilanciare dopo ogni import di listino.
const db = require('./index');
const tassonomia = require('./tassonomia');

function slugifica(testo) {
  return String(testo)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------- Misure ----------

// Le misure come le scrive il settore: 1/2", 3/4", 16mm, DN25, 110.
const REGOLE_MISURA = [
  { re: /(\d+)\s*"\s*(\d+)\/(\d+)/, formato: (m) => `${m[1]}"${m[2]}/${m[3]}` }, // 1"1/4
  { re: /(\d+)\/(\d+)\s*"/, formato: (m) => `${m[1]}/${m[2]}"` }, // 1/2"
  { re: /\bDN\s*(\d+)/i, formato: (m) => `DN${m[1]}` },
  { re: /\b(\d+(?:[.,]\d+)?)\s*mm\b/i, formato: (m) => `${m[1].replace(',', '.')}mm` },
  { re: /\b(\d+)\s*x\s*(\d+)\b/, formato: (m) => `${m[1]}x${m[2]}` },
  { re: /\b(\d+)\s*(?:lt|litri|l)\b/i, formato: (m) => `${m[1]} l` },
  { re: /\b(\d+(?:[.,]\d+)?)\s*kw\b/i, formato: (m) => `${m[1].replace(',', '.')} kW` },
];

function estraiMisura(nome) {
  for (const regola of REGOLE_MISURA) {
    const m = String(nome).match(regola.re);
    if (m) return regola.formato(m);
  }
  return '';
}

// ---------- Classificazione ----------

// Le famiglie dei listini di marca hanno una destinazione naturale: la usiamo quando
// le parole chiave non bastano.
const FAMIGLIE_MARCHIO = {
  RAS: 'climatizzazione',
  RAV: 'climatizzazione',
  VRF: 'climatizzazione',
  NEXETA: 'climatizzazione',
  ESTIA: 'riscaldamento',
  EDEN: 'riscaldamento',
};

function perRegex(testo) {
  return String(testo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function costruisciIndice() {
  const voci = [];
  tassonomia
    .slice()
    .sort((a, b) => a.priorita - b.priorita)
    .forEach((cat) => {
      cat.sottocategorie.forEach((sub) => {
        sub.keywords.forEach((k) => {
          const chiave = k.toLowerCase().trim();
          if (!chiave) return;
          voci.push({
            chiave,
            re: new RegExp('(^|[^a-z0-9àèéìòù])' + perRegex(chiave) + '($|[^a-z0-9àèéìòù])', 'i'),
            macro: cat.slug,
            sotto: slugifica(sub.nome),
          });
        });
      });
    });
  return voci.sort((a, b) => b.chiave.length - a.chiave.length);
}

function classifica(prodotto, indice) {
  const testo = `${prodotto.nome} ${prodotto.categoria || ''}`.toLowerCase();
  const trovato = indice.find((v) => v.re.test(testo));
  if (trovato) return { macro: trovato.macro, sotto: trovato.sotto };

  const famiglia = String(prodotto.famiglia || '').toUpperCase();
  const perFamiglia = FAMIGLIE_MARCHIO[famiglia];
  if (perFamiglia) {
    return { macro: perFamiglia, sotto: slugifica(famiglia), nomeSotto: nomeFamigliaSync(prodotto), daFamiglia: true };
  }

  return null;
}

// sync cache for classifica (will be overridden by async version if needed)
const nomiFamiglia = new Map();
function nomeFamigliaSync(prodotto) {
  const chiave = `${prodotto.brand_slug}:${prodotto.famiglia}`;
  if (nomiFamiglia.has(chiave)) return nomiFamiglia.get(chiave);
  // fallback sync not available in async mode - return famiglia
  return prodotto.famiglia;
}
async function nomeFamiglia(prodotto) {
  const chiave = `${prodotto.brand_slug}:${prodotto.famiglia}`;
  if (nomiFamiglia.has(chiave)) return nomiFamiglia.get(chiave);
  const riga = await db.prepare('SELECT nome FROM brand_families WHERE brand_slug = ? AND codice = ?').get(prodotto.brand_slug, prodotto.famiglia);
  const nome = riga ? riga.nome : prodotto.famiglia;
  nomiFamiglia.set(chiave, nome);
  return nome;
}

// ---------- Esecuzione ----------

async function principale() {
  await db.ensureInit();
  const insMacro = db.prepare(
    `INSERT INTO macro_categorie (slug, nome, icona, descrizione, ordine, priorita, in_evidenza)
     VALUES (@slug, @nome, @icona, @descrizione, @priorita, @priorita, @in_evidenza)
     ON CONFLICT(slug) DO UPDATE SET
       nome = excluded.nome, icona = excluded.icona, descrizione = excluded.descrizione,
       ordine = excluded.ordine, priorita = excluded.priorita, in_evidenza = excluded.in_evidenza`
  );
  const insSotto = db.prepare(
    `INSERT INTO sottocategorie (macro_slug, slug, nome, keywords, misure, ordine)
     VALUES (@macro_slug, @slug, @nome, @keywords, @misure, @ordine)
     ON CONFLICT(macro_slug, slug) DO UPDATE SET
       nome = excluded.nome, keywords = excluded.keywords, misure = excluded.misure,
       ordine = excluded.ordine`
  );

  const carica = db.transaction(async () => {
    for (const cat of tassonomia) {
      await insMacro.run({
        slug: cat.slug,
        nome: cat.nome,
        icona: cat.icona,
        descrizione: cat.descrizione,
        priorita: cat.priorita,
        in_evidenza: cat.inEvidenza ? 1 : 0,
      });
      let i=0;
      for (const sub of cat.sottocategorie) {
        await insSotto.run({
          macro_slug: cat.slug,
          slug: slugifica(sub.nome),
          nome: sub.nome,
          keywords: sub.keywords.join('|'),
          misure: (sub.misure || []).join('|'),
          ordine: i++,
        });
      }
    }
  });
  await carica();

  const indice = costruisciIndice();
  const prodotti = await db.prepare('SELECT id, nome, categoria, famiglia, brand_slug FROM products').all();
  const aggiorna = db.prepare('UPDATE products SET macro_slug = ?, sottocategoria = ?, misura = ? WHERE id = ?');

  const conteggi = {};
  let perKeyword = 0;
  let perFamiglia = 0;
  let senzaSotto = 0;
  const sottoDaFamiglia = new Map();

  const applica = db.transaction(async () => {
    for (const p of prodotti) {
      let esito = classifica(p, indice);
      // if esito needs async nomeFamiglia, resolve
      if (esito && esito.daFamiglia) {
        esito.nomeSotto = await nomeFamiglia(p);
      }
      const macro = esito ? esito.macro : 'minuteria';
      const sotto = esito ? esito.sotto : '';

      if (!esito || !esito.sotto) senzaSotto += 1;
      else if (esito.daFamiglia) {
        perFamiglia += 1;
        sottoDaFamiglia.set(`${macro}|${sotto}`, esito.nomeSotto);
      } else perKeyword += 1;

      conteggi[macro] = (conteggi[macro] || 0) + 1;
      await aggiorna.run(macro, sotto, estraiMisura(p.nome), p.id);
    }

    let ordine = 50;
    for (const [chiave, nome] of sottoDaFamiglia) {
      const taglio = chiave.indexOf('|');
      await insSotto.run({
        macro_slug: chiave.slice(0, taglio),
        slug: chiave.slice(taglio + 1),
        nome,
        keywords: '',
        misure: '',
        ordine: (ordine += 1),
      });
    }
  });
  await applica();

  const slugValidi = new Set(tassonomia.map((c) => c.slug));
  const macros = await db.prepare('SELECT slug FROM macro_categorie').all();
  for (const m of macros) {
    if (slugValidi.has(m.slug)) continue;
    const row = await db.prepare('SELECT COUNT(*) AS n FROM products WHERE macro_slug = ?').get(m.slug);
    const n = row ? Number(row.n) : 0;
    if (n === 0) await db.prepare('DELETE FROM macro_categorie WHERE slug = ?').run(m.slug);
  }

  console.log(`Prodotti riclassificati: ${prodotti.length}`);
  console.log(`  per parola chiave: ${perKeyword}`);
  console.log(`  per famiglia di listino: ${perFamiglia}`);
  console.log(`  senza sottocategoria: ${senzaSotto}`);
  console.log('\nDistribuzione per categoria:');
  tassonomia.forEach((c) => {
    if (conteggi[c.slug]) console.log(`  ${String(c.priorita).padStart(2)}. ${c.nome.padEnd(28)} ${conteggi[c.slug]}`);
  });

  const row = await db.prepare("SELECT COUNT(*) AS n FROM products WHERE misura <> ''").get();
  const conMisura = row ? Number(row.n) : 0;
  console.log(`\nProdotti con misura riconosciuta: ${conMisura} / ${prodotti.length}`);
}

principale().catch(e=>{console.error(e);process.exit(1)});
