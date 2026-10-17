// Il materiale ordinato da un cliente e quanto deve a chi lo ha venduto, mese per mese. UN solo calcolo per lo Storico ordini
// dell'installatore (GET /storico), la pagina del cliente lato banco (GET /distributore/clienti/:id) e i due CSV: banco e
// installatore non possono vedere cifre diverse perché le cifre le fa questa funzione e nessun'altra.
//
// Il modello (dal 16/10/2026): in app l'installatore paga SOLO il servizio (il 10% sopra il prezzo del banco) e la consegna, IVA
// inclusa; il materiale lo paga dopo a BOREA, al prezzo del banco. Quindi qui:
//  · netto riga = subtotale + raee_riga                          (prezzo del banco + RAEE, IVA esclusa)
//  · prezzo cad. IVA inclusa = arrotonda2((prezzo_netto_unitario + raee_unitario) × (1 + iva/100))
//  · totale riga IVA inclusa = arrotonda2(netto riga × (1 + iva/100))
//  Le RIGHE (prezzo cad., totale riga) si calcolano così dai valori salvati nelle order_items. Mai prezzo_unitario_cliente né
//  subtotale_cliente: sono il prezzo con il servizio, che si paga in app.
//  Il TOTALE dell'ordine e il "servizio pagato in app" NON si ricalcolano qui: vengono da pricing.importiOrdine, la funzione unica che
//  usano anche la pagina dell'ordine e la richiesta (dal 17/10/2026), così i numeri sono uguali dappertutto: totale ordine =
//  `banco.totale` (merce a prezzo del banco + RAEE + IVA, già salvato sull'ordine o ricalcolato per quelli vecchi), servizio pagato in
//  app = `app.totale` (corriere + servizio + IVA: l'importo realmente addebitato quando torna col calcolo, altrimenti il calcolo). Le
//  righe, arrotondate una per una, possono differire dal totale di un centesimo o due. Il servizio non entra MAI nel totale del materiale.
//  L'IVA è quella dell'ordine (pricing.ivaPctOrdine).
const db = require('../db');
const format = require('./format');
const pricing = require('./pricing');

const arrotonda2 = pricing.round2;

// Stato di un ordine come lo vede chi lo legge qui. `tono` = classe colore (st-<tono>).
function statoOrdine(o) {
  if (o.consegnato_il) return { tono: 'consegnato', etichetta: 'Consegnato' };
  if (o.stato === 'evaso') return { tono: 'consegna', etichetta: 'In consegna' };
  return { tono: 'preparazione', etichetta: 'In preparazione' };
}

// Un ordine con le sue righe: righe, totale, servizio. `righe` sono le order_items dell'ordine.
function calcolaOrdine(o, righe, ivaConfig, servizioPct) {
  const iva = pricing.ivaPctOrdine(o, ivaConfig);
  const k = 1 + iva / 100;
  const righeCalcolate = righe.map((r) => {
    const nettoRiga = arrotonda2(Number(r.subtotale) + Number(r.raee_riga || 0));
    return {
      prodottoId: r.product_id,
      codice: r.codice_snapshot,
      nome: r.nome_snapshot,
      quantita: Number(r.quantita),
      cad: arrotonda2((Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)) * k),
      totale: arrotonda2(nettoRiga * k),
    };
  });
  // Totale del materiale e servizio pagato in app: la funzione unica degli importi (vedi sopra).
  const pagamento = Number(o.pagamento_importo) > 0
    ? { stato: o.pagamento_stato || 'pagato', metodo: o.pagamento_metodo || null, importo: o.pagamento_importo, pagato_il: o.pagato_il || null }
    : null;
  const importi = pricing.importiOrdine(o, pagamento, iva, servizioPct);
  return { iva, righe: righeCalcolate, totale: importi.banco.totale, servizio: importi.app.totale, importi };
}

function dataCompatta(naive) {
  return `${format.dataCortaRoma(naive)}, ${format.oraSolaRoma(naive)}`;
}

// Le voci della vista per articolo: stessa riga (codice, nome, prezzo cad.) sommata sugli ordini del periodo, dal totale più alto.
function articoliSommati(ordini) {
  const mappa = new Map();
  for (const o of ordini) {
    for (const r of o.righe) {
      const chiave = [r.codice, r.nome, r.cad].join('|');
      if (!mappa.has(chiave)) mappa.set(chiave, { codice: r.codice, nome: r.nome, cad: r.cad, quantita: 0, totale: 0, ordini: [] });
      const voce = mappa.get(chiave);
      voce.quantita += r.quantita;
      voce.totale = arrotonda2(voce.totale + r.totale);
      if (!voce.ordini.includes(o.id)) voce.ordini.push(o.id);
    }
  }
  return [...mappa.values()].sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome));
}

function riepilogoDi(ordini) {
  return {
    totale: arrotonda2(ordini.reduce((s, o) => s + o.totale, 0)),
    servizio: arrotonda2(ordini.reduce((s, o) => s + o.servizio, 0)),
    nOrdini: ordini.length,
  };
}

// materialeOrdini({ clienteId, distributorId?, mese?, vista?, hrefOrdine?, conRichiesteSenzaOrdine?, adesso? })
//  · distributorId: solo gli ordini di quel banco (la pagina del cliente lato banco). Senza, tutti (l'installatore), raggruppati per ditta.
//  · hrefOrdine(id): dove porta "Dettagli" (il banco passa () => null: aprire il dettaglio di un ordine inviato lo prende in carico).
//  · mese: 'AAAA-MM' o 'tutto'. Default: il mese corrente se ha attività, altrimenti il più recente che ne ha.
//  · vista: 'ordine' | 'articolo' (cambia solo cosa disegna la vista: i dati ci sono sempre tutti).
// Ritorna { mese, vista, mesi, ditte, riepilogo, gruppi: [{ nome, riepilogo, ordini, articoli }], senzaOrdine, vuoto }.
async function materialeOrdini({
  clienteId, distributorId = null, mese = null, vista = 'ordine',
  hrefOrdine = (id) => '/ordini/' + id, conRichiesteSenzaOrdine = distributorId === null, conRiordina = distributorId === null,
  adesso = new Date(),
}) {
  const [ordiniGrezzi, ivaConfig, servizioPct] = await Promise.all([
    db
      .prepare(
        `SELECT o.id, o.creato_il, o.stato, o.consegnato_il, o.distributor_id, o.costo_consegna, o.contributo_raee, o.iva,
                o.totale_netto, o.totale_finale, o.servizio, o.imponibile_app, o.iva_app, o.da_pagare_app,
                o.imponibile_banco, o.iva_banco, o.materiale_banco, d.nome AS distributore_nome,
                r.pagamento_importo, r.pagamento_stato, r.pagamento_metodo, r.pagato_il
           FROM orders o
           LEFT JOIN distributors d ON d.id = o.distributor_id
           LEFT JOIN requests r ON r.id = o.request_id
          WHERE o.cliente_id = ?${distributorId === null ? '' : ' AND o.distributor_id = ?'}
          ORDER BY o.id DESC`
      )
      .all(...(distributorId === null ? [clienteId] : [clienteId, distributorId])),
    pricing.getIvaPct(),
    pricing.getServizioPct(),
  ]);

  const righePerOrdine = new Map();
  if (ordiniGrezzi.length) {
    const righe = await db
      .prepare(
        `SELECT order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_netto_unitario, subtotale,
                subtotale_cliente, raee_unitario, raee_riga
           FROM order_items WHERE order_id = ANY(?::int[]) ORDER BY id`
      )
      .all(ordiniGrezzi.map((o) => o.id));
    for (const r of righe) {
      if (!righePerOrdine.has(r.order_id)) righePerOrdine.set(r.order_id, []);
      righePerOrdine.get(r.order_id).push(r);
    }
  }

  // Le richieste chiuse senza ordine (nessuna risposta, annullate): solo per l'installatore, e senza importi.
  const richiesteSenza = conRichiesteSenzaOrdine
    ? await db
        .prepare(
          `SELECT id, stato, creato_il FROM requests
            WHERE cliente_id = ? AND order_id IS NULL AND stato IN ('nessuna_offerta', 'annullata')
            ORDER BY id DESC LIMIT 200`
        )
        .all(clienteId)
    : [];

  const ordini = ordiniGrezzi.map((o) => {
    const calcolo = calcolaOrdine(o, righePerOrdine.get(o.id) || [], ivaConfig, servizioPct);
    const mesePrimo = format.meseRoma(o.creato_il);
    return {
      id: o.id,
      meseChiave: mesePrimo.chiave,
      data: dataCompatta(o.creato_il),
      dataSola: format.dataSolaRoma(o.creato_il),
      stato: statoOrdine(o),
      consegnato: !!o.consegnato_il,
      ditta: String(o.distributore_nome || '').trim() || 'il distributore',
      ...calcolo,
      primo: calcolo.righe[0] ? calcolo.righe[0].quantita + '× ' + calcolo.righe[0].nome : '',
      altri: Math.max(0, calcolo.righe.length - 1),
      href: hrefOrdine(o.id),
      riordinaId: conRiordina && o.consegnato_il ? o.id : null,
    };
  });
  const senzaOrdineTutte = richiesteSenza.map((r) => ({
    id: r.id,
    meseChiave: format.meseRoma(r.creato_il).chiave,
    data: format.dataCortaRoma(r.creato_il),
    tono: r.stato === 'annullata' ? 'annullata' : 'nessuna',
    etichetta: r.stato === 'annullata' ? 'Annullata' : 'Nessuna risposta',
    href: '/richieste/' + r.id,
  }));

  // I mesi con attività (ordini o richieste), dal più recente: per il selettore.
  const titoli = new Map();
  for (const o of ordiniGrezzi) {
    const m = format.meseRoma(o.creato_il);
    titoli.set(m.chiave, m.titolo);
  }
  for (const r of richiesteSenza) {
    const m = format.meseRoma(r.creato_il);
    titoli.set(m.chiave, m.titolo);
  }
  const mesi = [...titoli.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([chiave, titolo]) => ({ chiave, titolo }));

  const oggi = format.meseRoma(adesso).chiave;
  const scelto = mese === 'tutto' || mesi.some((m) => m.chiave === mese)
    ? mese
    : mesi.some((m) => m.chiave === oggi) ? oggi : mesi.length ? mesi[0].chiave : oggi;
  const nelPeriodo = (voce) => scelto === 'tutto' || voce.meseChiave === scelto;

  const ordiniPeriodo = ordini.filter(nelPeriodo);
  // Per ditta, nell'ordine in cui compaiono (la più recente per prima).
  const perDitta = new Map();
  for (const o of ordiniPeriodo) {
    if (!perDitta.has(o.ditta)) perDitta.set(o.ditta, []);
    perDitta.get(o.ditta).push(o);
  }
  const gruppi = [...perDitta.entries()].map(([nome, lista]) => ({
    nome,
    riepilogo: riepilogoDi(lista),
    ordini: lista,
    articoli: articoliSommati(lista),
  }));

  return {
    mese: scelto,
    vista: vista === 'articolo' ? 'articolo' : 'ordine',
    mesi,
    // Le ditte di tutti gli ordini (non solo del periodo): per intestare il riquadro anche in un mese senza ordini.
    ditte: [...new Set(ordini.map((o) => o.ditta))],
    riepilogo: riepilogoDi(ordiniPeriodo),
    gruppi,
    senzaOrdine: senzaOrdineTutte.filter(nelPeriodo),
    vuoto: !ordiniPeriodo.length && !senzaOrdineTutte.some(nelPeriodo),
  };
}

// ---------- CSV ----------

// Una cella: tra virgolette se contiene ; " o a capo, e senza che Excel la prenda per una formula (nomi come "- Materiale di
// montaggio" esistono nel catalogo).
function cella(valore) {
  let testo = String(valore === null || valore === undefined ? '' : valore);
  if (/^[=+\-@\t\r]/.test(testo)) testo = "'" + testo;
  return /[;"\r\n]/.test(testo) ? '"' + testo.replace(/"/g, '""') + '"' : testo;
}
const numeroCsv = (n) => arrotonda2(n).toFixed(2).replace('.', ',');

// Il CSV del materiale del periodo: ";" come separatore (Excel italiano), BOM UTF-8, una riga per articolo, il servizio pagato sulla
// prima riga di ogni ordine (così la somma della colonna è giusta), e in fondo i totali. Per il banco e per l'installatore uguale.
function csvMateriale(materiale) {
  const colonne = ['Data', 'Ordine', 'Stato', 'Codice', 'Articolo', 'Quantità', 'Prezzo cad. IVA incl.', 'Totale IVA incl.', 'Servizio pagato'];
  const righe = [colonne.map(cella).join(';')];
  const ordini = materiale.gruppi.flatMap((g) => g.ordini).sort((a, b) => a.id - b.id);
  for (const o of ordini) {
    o.righe.forEach((r, i) => {
      righe.push([
        o.dataSola, '#' + o.id, o.stato.etichetta, r.codice, r.nome, r.quantita, numeroCsv(r.cad), numeroCsv(r.totale),
        i === 0 ? numeroCsv(o.servizio) : '',
      ].map(cella).join(';'));
    });
  }
  righe.push(['Totale', '', '', '', '', '', '', numeroCsv(materiale.riepilogo.totale), numeroCsv(materiale.riepilogo.servizio)].map(cella).join(';'));
  return '﻿' + righe.join('\r\n') + '\r\n';
}

function nomeFileCsv(materiale) {
  return `materiale-${materiale.mese === 'tutto' ? 'tutto' : materiale.mese}.csv`;
}

module.exports = { materialeOrdini, csvMateriale, nomeFileCsv, calcolaOrdine, statoOrdine };
