// "Storico ordini" del banco (GET /distributore/storico): la lista di tutti gli ordini della filiale, con filtri per stato e
// periodo, ricerca e paginazione. Tutto lato server: i filtri stanno nell'URL (?stato=&periodo=&q=&pagina=), quindi i link si
// possono condividere e "indietro" funziona. Qui sta la logica (filtri, SQL, raggruppamento per giorno); la route in
// server.js e la vista views/distributore_storico.ejs fanno solo render.
const format = require('./format');

const PER_PAGINA = 50;

// Le schede di stato, nell'ordine in cui si mostrano. `filtro` è il valore di ?stato=, `chiave` lo stato di un ordine
// (vedi statoStorico) con cui condivide colori e pallino; "Tutti" non ha né pallino né chiave.
const SCHEDE = [
  { filtro: 'tutti', chiave: null, etichetta: 'Tutti' },
  { filtro: 'da_preparare', chiave: 'da_preparare', etichetta: 'Da preparare' },
  { filtro: 'in_consegna', chiave: 'in_consegna', etichetta: 'In consegna' },
  { filtro: 'consegnati', chiave: 'consegnato', etichetta: 'Consegnati' },
];

const PERIODI = [
  { valore: 'oggi', etichetta: 'Oggi' },
  { valore: '7', etichetta: '7 giorni' },
  { valore: '30', etichetta: '30 giorni' },
  { valore: 'tutti', etichetta: 'Tutti' },
];

// Le condizioni SQL di ogni stato. SONO LA STESSA REGOLA di statoStorico, nello stesso ordine: "consegnato_il" per primo,
// perché un ordine segnato consegnato con la rotta provvisoria può restare 'inviato' (o in qualunque altro stato).
// Testo fisso, mai costruito da dati dell'utente: i conteggi delle schede e il filtro della lista le usano entrambi.
const CONDIZIONE_STATO = {
  da_preparare: "o.consegnato_il IS NULL AND o.stato = 'inviato'",
  in_consegna: "o.consegnato_il IS NULL AND o.stato IN ('in_evasione', 'evaso')",
  consegnati: 'o.consegnato_il IS NOT NULL',
};

// Lo stato di un ordine per il banco: { chiave, etichetta }. L'unico punto dove si decide: lo usano la lista dello Storico, la scheda del cliente
// e la pagina dell'ordine. Tre stati (richiesta esplicita del 19/10/2026): "Da preparare" (blu: l'ordine aspetta il banco), "In consegna" (verde: dopo
// "Preparato" la merce è del corriere) e "Consegnato". Le colonne `stato` 'in_evasione' (Preparato) ed 'evaso' (lo stato degli ordini
// vecchi: ora non lo scrive più nessuno) sono la stessa cosa per il banco: non esistono più "In preparazione" e "Partito".
function statoStorico(o) {
  if (o.consegnato_il) return { chiave: 'consegnato', etichetta: 'Consegnato' };
  if (o.stato === 'in_evasione' || o.stato === 'evaso') return { chiave: 'in_consegna', etichetta: 'In consegna' };
  return { chiave: 'da_preparare', etichetta: 'Da preparare' }; // 'inviato' (il CHECK del DB non ammette altro)
}

// Le colonne di orders che servono a pricing.importi (importiOrdine + ivaPctOrdine): le salvate alla nascita dell'ordine e, per quelli vecchi, i valori da cui si ricalcola.
// Testo fisso. "Da incassare" è `banco.totale` = merce a prezzo del banco + RAEE + IVA: NON il totale col servizio e la consegna, che sono soldi della piattaforma.
const COLONNE_IMPORTI = [
  'totale_netto', 'totale_finale', 'contributo_raee', 'costo_consegna', 'iva', 'servizio',
  'imponibile_app', 'iva_app', 'da_pagare_app', 'imponibile_banco', 'iva_banco', 'materiale_banco',
].map((c) => 'o.' + c).join(', ');

// I vecchi indirizzi (segnalibri) con ?stato=in_preparazione o ?stato=partiti portano ora a "In consegna", che li ha assorbiti.
const FILTRI_VECCHI = { in_preparazione: 'in_consegna', partiti: 'in_consegna' };

// I filtri dalla query string (ogni parametro è già una stringa, vedi leggiQuery in src/http.js). Valori sconosciuti
// tornano al default: stato=tutti, periodo=7.
function leggiFiltri(query) {
  const q = query || {};
  const richiesto = Object.hasOwn(FILTRI_VECCHI, q.stato) ? FILTRI_VECCHI[q.stato] : q.stato;
  const stato = SCHEDE.some((s) => s.filtro === richiesto) ? richiesto : 'tutti';
  const periodo = PERIODI.some((p) => p.valore === q.periodo) ? q.periodo : '7';
  const ricerca = String(q.q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const pagina = Math.min(100000, Math.max(1, parseInt(q.pagina, 10) || 1));
  return { stato, periodo, q: ricerca, pagina };
}

// L'indirizzo dello Storico con i filtri correnti, con qualche valore cambiato (`modifiche`). Stato e periodo ci sono
// sempre, la ricerca e la pagina solo se servono; cambiando stato, periodo o ricerca si torna alla prima pagina.
function urlStorico(filtri, modifiche = {}) {
  const f = { ...filtri, ...modifiche };
  if ('stato' in modifiche || 'periodo' in modifiche || 'q' in modifiche) {
    if (!('pagina' in modifiche)) f.pagina = 1;
  }
  const parti = [`stato=${encodeURIComponent(f.stato)}`, `periodo=${encodeURIComponent(f.periodo)}`];
  if (f.q) parti.push(`q=${encodeURIComponent(f.q)}`);
  if (f.pagina > 1) parti.push(`pagina=${f.pagina}`);
  return '/distributore/storico?' + parti.join('&');
}

// Il carattere % o _ scritto dall'utente vale per sé, non come jolly di LIKE.
function escapeLike(testo) {
  return testo.replace(/[\\%_]/g, '\\$&');
}

// WHERE di banco, periodo e ricerca (SENZA lo stato) con i suoi parametri, nello stesso ordine dei `?`.
// Periodo: "oggi" = da mezzanotte di oggi in Italia; 7 e 30 = ultimi N giorni da adesso. `creato_il` è un TIMESTAMP in UTC
// senza fuso, quindi i limiti si portano in UTC senza fuso prima di confrontarli.
// Ricerca: ragione sociale (ILIKE); il numero d'ordine solo se quello che si scrive, tolto un eventuale
// "#", è fatto di sole cifre.
function condizioni(distributorId, filtri) {
  const dove = ['o.distributor_id = ?'];
  const parametri = [distributorId];
  if (filtri.periodo === 'oggi') {
    dove.push("o.creato_il >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'");
  } else if (filtri.periodo === '7' || filtri.periodo === '30') {
    dove.push("o.creato_il >= (NOW() AT TIME ZONE 'UTC') - (?::int * INTERVAL '1 day')");
    parametri.push(Number(filtri.periodo));
  }
  if (filtri.q) {
    const come = '%' + escapeLike(filtri.q) + '%';
    const alternative = ['u.ragione_sociale ILIKE ?'];
    parametri.push(come);
    const numero = filtri.q.replace(/^#/, '').trim();
    if (/^\d{1,9}$/.test(numero)) {
      alternative.push('o.id = ?');
      parametri.push(Number(numero));
    }
    dove.push('(' + alternative.join(' OR ') + ')');
  }
  return { dove, parametri };
}

// "1× Nome" della prima riga e quante altre ce ne sono, per ogni ordine, da UNA lettura di order_items per tutta la pagina.
function materialeDegliOrdini(righe) {
  const perOrdine = new Map();
  for (const r of righe) {
    const id = Number(r.order_id);
    if (!perOrdine.has(id)) perOrdine.set(id, { primo: `${r.quantita}× ${r.nome_snapshot}`, altri: 0 });
    else perOrdine.get(id).altri += 1;
  }
  return perOrdine;
}

// Le righe di una pagina raggruppate per giorno italiano, nell'ordine in cui arrivano (id decrescente: i giorni più recenti
// per primi). Il conteggio "N ordini" di un giorno è quello delle righe di questa pagina.
function raggruppaPerGiorno(ordini) {
  const gruppi = [];
  for (const o of ordini) {
    let ultimo = gruppi[gruppi.length - 1];
    if (!ultimo || ultimo.chiave !== o.giorno.chiave) {
      ultimo = { chiave: o.giorno.chiave, etichetta: o.giorno.etichetta, ordini: [] };
      gruppi.push(ultimo);
    }
    ultimo.ordini.push(o);
  }
  return gruppi;
}

// La pagina dello Storico: conteggi delle schede (una query, stessi filtri di periodo e ricerca ma SENZA lo stato, così il
// numero di una scheda dice cosa si trova cliccandola), la pagina di ordini e, per quelli, il materiale.
async function storicoOrdini(distributorId, filtri) {
  const db = require('../db'); // qui e non in testa: le funzioni pure di sopra si provano senza toccare il DB
  const pricing = require('./pricing');
  const { dove, parametri } = condizioni(distributorId, filtri);

  const sqlConteggi =
    `SELECT COUNT(*) AS tutti,
            COUNT(*) FILTER (WHERE ${CONDIZIONE_STATO.da_preparare}) AS da_preparare,
            COUNT(*) FILTER (WHERE ${CONDIZIONE_STATO.in_consegna}) AS in_consegna,
            COUNT(*) FILTER (WHERE ${CONDIZIONE_STATO.consegnati}) AS consegnati
       FROM orders o
       JOIN users u ON u.id = o.cliente_id
      WHERE ${dove.join(' AND ')}`;

  const doveLista = CONDIZIONE_STATO[filtri.stato] ? dove.concat('(' + CONDIZIONE_STATO[filtri.stato] + ')') : dove;
  const leggiPagina = (pagina) =>
    db
      .prepare(
        // Le colonne degli importi servono a pricing.importi (il "Da incassare" di ogni riga): vedi COLONNE_IMPORTI.
        `SELECT o.id, o.creato_il, o.stato, o.consegnato_il,
                ${COLONNE_IMPORTI},
                u.ragione_sociale AS cliente_nome, u.citta AS cliente_citta
           FROM orders o
           JOIN users u ON u.id = o.cliente_id
          WHERE ${doveLista.join(' AND ')}
          ORDER BY o.id DESC
          LIMIT ? OFFSET ?`
      )
      .all(...parametri, PER_PAGINA, (pagina - 1) * PER_PAGINA);

  let pagina = filtri.pagina;
  // L'IVA di oggi serve solo come ripiego per gli ordini senza IVA salvata (vedi ivaPctOrdine); è in cache, quindi di norma non costa una query.
  const [riga, primaPagina, ivaConfig] = await Promise.all([db.prepare(sqlConteggi).get(...parametri), leggiPagina(pagina), pricing.getIvaPct()]);
  const conteggi = {
    tutti: Number(riga.tutti),
    da_preparare: Number(riga.da_preparare),
    in_consegna: Number(riga.in_consegna),
    consegnati: Number(riga.consegnati),
  };
  const totale = conteggi[filtri.stato];
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));
  let righe = primaPagina;
  if (pagina > pagine) {
    // Una pagina oltre l'ultima (un link vecchio, un ordine in meno): si mostra l'ultima.
    pagina = pagine;
    righe = await leggiPagina(pagina);
  }

  const materiale = righe.length
    ? materialeDegliOrdini(
        await db
          .prepare('SELECT order_id, quantita, nome_snapshot FROM order_items WHERE order_id = ANY(?::int[]) ORDER BY order_id, id')
          .all(righe.map((o) => o.id))
      )
    : new Map();

  const ordini = righe.map((o) => ({
    ...o,
    daIncassare: pricing.importi({ ordine: o, pagamento: null, ivaPct: pricing.ivaPctOrdine(o, ivaConfig) }).banco.totale,
    statoStorico: statoStorico(o),
    giorno: format.giornoRoma(o.creato_il),
    ora: format.oraSolaRoma(o.creato_il),
    materiale: materiale.get(Number(o.id)) || { primo: '', altri: 0 },
  }));

  // Nessun ordine con i filtri: se il banco non ne ha MAI avuti si dice altro ("Ancora nessun ordine.").
  let vuotoAssoluto = false;
  if (!ordini.length && conteggi.tutti === 0) {
    vuotoAssoluto = !(await db.prepare('SELECT id FROM orders WHERE distributor_id = ? LIMIT 1').get(distributorId));
  }

  return {
    gruppi: raggruppaPerGiorno(ordini),
    conteggi,
    totale,
    pagina,
    pagine,
    perPagina: PER_PAGINA,
    vuotoAssoluto,
    schede: SCHEDE,
    periodi: PERIODI,
  };
}

module.exports = {
  PER_PAGINA,
  SCHEDE,
  PERIODI,
  CONDIZIONE_STATO,
  COLONNE_IMPORTI,
  statoStorico,
  leggiFiltri,
  urlStorico,
  condizioni,
  materialeDegliOrdini,
  raggruppaPerGiorno,
  storicoOrdini,
};
