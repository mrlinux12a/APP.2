// Importatore di listini ufficiali dei produttori da file Excel.
//
//   node db/importa_listino.js --marchio toshiba --file "listino.xlsx" [--sconto 30]
//
// È generico: per aggiungere un marchio basta una voce in MARCHI qui sotto con la
// mappatura delle colonne del suo file. Lo script è idempotente: rilanciato sullo stesso
// file aggiorna i prodotti esistenti invece di duplicarli.
const path = require('path');
const XLSX = require('xlsx');
const db = require('./index');

// ---------- Configurazione dei marchi ----------

const MARCHI = {
  toshiba: {
    marchio: {
      slug: 'toshiba',
      nome: 'TOSHIBA',
      descrizione: 'Climatizzazione, pompe di calore e sistemi VRF',
      colore: '#e60012',
      iniziali: 'TO',
      distributore_ufficiale: 'T-Air Solutions Italy div. di Beijer Ref Italy S.r.l.',
      listino_nome: 'Listino ufficiale 2026 Rev. 2',
      listino_aggiornato: 'marzo 2026',
      ordine: 1,
    },
    colonne: {
      codice: 'Codice',
      nome: 'Descrizione',
      famiglia: 'Super Famiglia',
      refrigerante: 'Refrigerante',
      raee: 'RAEE AirCo',
      cat_raee: 'Cat RAEE',
      ean: 'EAN',
      fgas_kg: 'FGAS kg',
      gwp: 'GWP',
      prezzo_listino: 'listino',
    },
    famiglie: {
      RAS: { nome: 'RAS — Split e multisplit residenziali', macro: 'condizionamento', ordine: 1 },
      RAV: { nome: 'RAV — Light Commercial Digital Inverter', macro: 'condizionamento', ordine: 2 },
      VRF: { nome: 'VRF — Sistemi VRF e accessori', macro: 'condizionamento', ordine: 3 },
      NEXETA: { nome: 'NEXETA — Comandi e regolazione', macro: 'condizionamento', ordine: 4 },
      ESTIA: { nome: 'ESTIA — Pompe di calore aria-acqua', macro: 'pompe-calore', ordine: 5 },
      EDEN: { nome: 'EDEN — Accessori idronici e kit', macro: 'accessori', ordine: 6 },
    },
  },
};

const MACRO_EXTRA = {
  'pompe-calore': {
    slug: 'pompe-calore',
    nome: 'Pompe di calore',
    icona: '♨',
    descrizione: 'Aria-acqua, ACS e moduli idronici',
    ordine: 4,
  },
  accessori: {
    slug: 'accessori',
    nome: 'Accessori e kit',
    icona: '🧰',
    descrizione: 'Kit idraulici, comandi, staffe e ricambi',
    ordine: 5,
  },
};

function argomenti() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i += 1) {
    if (v[i].startsWith('--')) a[v[i].slice(2)] = v[i + 1];
  }
  return a;
}

function numero(valore) {
  const s = String(valore === undefined || valore === null ? '' : valore).trim();
  if (!s) return null;
  const pulito = s.replace(/[^\d.,-]/g, '');
  if (!pulito) return null;
  const ultimoPunto = pulito.lastIndexOf('.');
  const ultimaVirgola = pulito.lastIndexOf(',');
  let normalizzato;
  if (ultimoPunto === -1 && ultimaVirgola === -1) {
    normalizzato = pulito;
  } else if (ultimoPunto > ultimaVirgola) {
    const decimali = pulito.length - ultimoPunto - 1;
    normalizzato =
      decimali > 0 && decimali <= 2
        ? pulito.replace(/,/g, '').replace(/\.(?=.*\.)/g, '')
        : pulito.replace(/[.,]/g, '');
  } else {
    const decimali = pulito.length - ultimaVirgola - 1;
    normalizzato =
      decimali > 0 && decimali <= 2
        ? pulito.replace(/\./g, '').replace(',', '.')
        : pulito.replace(/[.,]/g, '');
  }
  const n = parseFloat(normalizzato);
  return Number.isFinite(n) ? n : null;
}

function testo(valore) {
  return String(valore === undefined || valore === null ? '' : valore).trim();
}

const GRIGLIA_SCONTI = [
  [3, 6, 1],
  [5, 2, 3],
  [2, 3, 7],
];

async function importa() {
  await db.ensureInit();
  const arg = argomenti();
  const nomeMarchio = (arg.marchio || '').toLowerCase();
  const config = MARCHI[nomeMarchio];

  if (!config) {
    console.error('Marchio sconosciuto. Disponibili: ' + Object.keys(MARCHI).join(', '));
    process.exit(1);
  }
  if (!arg.file) {
    console.error('Manca --file con il percorso del listino Excel.');
    process.exit(1);
  }

  const scontoDefault = numero(arg.sconto) === null ? 30 : numero(arg.sconto);

  const wb = XLSX.readFile(path.resolve(arg.file));
  const grezze = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
  const righe = grezze.map((r) => {
    const o = {};
    Object.keys(r).forEach((k) => {
      o[k.trim()] = r[k];
    });
    return o;
  });

  console.log(`Listino: ${path.basename(arg.file)} — ${righe.length} righe`);
  console.log(`Marchio: ${config.marchio.nome} — sconto Base applicato: ${scontoDefault}%`);

  const m = config.marchio;
  await db.prepare(
    `INSERT INTO brands (slug, nome, descrizione, colore, iniziali, distributore_ufficiale,
                         listino_nome, listino_aggiornato, ordine, attivo, sconto_default_pct)
     VALUES (@slug, @nome, @descrizione, @colore, @iniziali, @distributore_ufficiale,
             @listino_nome, @listino_aggiornato, @ordine, 1, @sconto_default_pct)
     ON CONFLICT(slug) DO UPDATE SET
       nome = excluded.nome, descrizione = excluded.descrizione, colore = excluded.colore,
       iniziali = excluded.iniziali, distributore_ufficiale = excluded.distributore_ufficiale,
       listino_nome = excluded.listino_nome, listino_aggiornato = excluded.listino_aggiornato,
       ordine = excluded.ordine, attivo = 1, sconto_default_pct = excluded.sconto_default_pct`
  ).run({ ...m, sconto_default_pct: scontoDefault });

  const insMacro = db.prepare(
    `INSERT INTO macro_categorie (slug, nome, icona, descrizione, ordine)
     VALUES (@slug, @nome, @icona, @descrizione, @ordine)
     ON CONFLICT(slug) DO NOTHING`
  );
  for (const f of Object.values(config.famiglie)) {
    if (MACRO_EXTRA[f.macro]) await insMacro.run(MACRO_EXTRA[f.macro]);
  }

  const insFamiglia = db.prepare(
    `INSERT INTO brand_families (brand_slug, codice, nome, ordine)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(brand_slug, codice) DO UPDATE SET nome = excluded.nome, ordine = excluded.ordine`
  );

  const insProdotto = db.prepare(
    `INSERT INTO products (codice, nome, categoria, macro_slug, prezzo_listino, sconto_base_pct,
                           disponibilita, brand_slug, famiglia, ean, raee, cat_raee,
                           refrigerante, fgas_kg, gwp)
     VALUES (@codice, @nome, @categoria, @macro_slug, @prezzo_listino, @sconto_base_pct,
             'disponibile', @brand_slug, @famiglia, @ean, @raee, @cat_raee,
             @refrigerante, @fgas_kg, @gwp)
     ON CONFLICT(codice) DO UPDATE SET
       nome = excluded.nome, categoria = excluded.categoria, macro_slug = excluded.macro_slug,
       prezzo_listino = excluded.prezzo_listino, sconto_base_pct = excluded.sconto_base_pct,
       brand_slug = excluded.brand_slug, famiglia = excluded.famiglia, ean = excluded.ean,
       raee = excluded.raee, cat_raee = excluded.cat_raee, refrigerante = excluded.refrigerante,
       fgas_kg = excluded.fgas_kg, gwp = excluded.gwp, aggiornato_il = NOW()`
  );

  const col = config.colonne;
  const famiglieViste = new Set();
  let importati = 0;
  const scartate = [];

  const caricaProdotti = db.transaction(async () => {
    for (let i=0;i<righe.length;i++) {
      const r = righe[i];
      const codice = testo(r[col.codice]);
      const nome = testo(r[col.nome]);
      const prezzo = numero(r[col.prezzo_listino]);
      const famigliaCod = testo(r[col.famiglia]).toUpperCase();

      if (!codice || !nome || prezzo === null) {
        scartate.push({ riga: i + 2, codice, motivo: !codice ? 'codice mancante' : (!nome ? 'descrizione mancante' : 'listino non leggibile') });
        continue;
      }

      const famiglia = config.famiglie[famigliaCod] || {
        nome: famigliaCod || 'Altro',
        macro: 'accessori',
        ordine: 99,
      };
      if (famigliaCod && !famiglieViste.has(famigliaCod)) {
        famiglieViste.add(famigliaCod);
        await insFamiglia.run(m.slug, famigliaCod, famiglia.nome, famiglia.ordine);
      }

      await insProdotto.run({
        codice,
        nome,
        categoria: famiglia.nome,
        macro_slug: famiglia.macro,
        prezzo_listino: prezzo,
        sconto_base_pct: scontoDefault,
        brand_slug: m.slug,
        famiglia: famigliaCod,
        ean: testo(r[col.ean]),
        raee: numero(r[col.raee]) || 0,
        cat_raee: testo(r[col.cat_raee]),
        refrigerante: testo(r[col.refrigerante]),
        fgas_kg: numero(r[col.fgas_kg]),
        gwp: numero(r[col.gwp]),
      });
      importati += 1;
    }
  });
  await caricaProdotti();

  const distributori = await db.prepare('SELECT * FROM distributors WHERE attivo = 1 ORDER BY id').all();
  const prodottiMarchio = await db.prepare('SELECT id, prezzo_listino FROM products WHERE brand_slug = ?').all(m.slug);

  const insListino = db.prepare(
    `INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(distributor_id, product_id) DO UPDATE SET
       prezzo_listino = excluded.prezzo_listino, sconto_base_pct = excluded.sconto_base_pct`
  );

  let righeListino = 0;
  const caricaListini = db.transaction(async () => {
    for (let distIdx=0; distIdx<distributori.length; distIdx++) {
      const d = distributori[distIdx];
      for (const p of prodottiMarchio) {
        const bonus = GRIGLIA_SCONTI[p.id % 3][distIdx % 3];
        const sconto = Math.min(60, Math.round((scontoDefault + bonus) * 10) / 10);
        await insListino.run(d.id, p.id, p.prezzo_listino, sconto);
        righeListino += 1;
      }
    }
  });
  await caricaListini();

  console.log(`\nImportati ${importati} prodotti (${famiglieViste.size} famiglie).`);
  console.log(`Listini distributore aggiornati: ${righeListino} righe su ${distributori.length} banchi.`);
  if (scartate.length) {
    console.log(`\nRighe scartate: ${scartate.length}`);
    scartate.slice(0, 10).forEach((s) => console.log(`  riga ${s.riga} (${s.codice || '—'}): ${s.motivo}`));
    if (scartate.length > 10) console.log(`  ...e altre ${scartate.length - 10}`);
  }
  console.log(
    '\nATTENZIONE: lo sconto Base applicato è un valore di configurazione, non le condizioni\n' +
      'commerciali reali. Va sostituito con gli sconti veri prima di usare i prezzi con i clienti.'
  );
}

importa().catch(e=>{console.error(e);process.exit(1)});
