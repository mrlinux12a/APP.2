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
const { statoStorico } = require('./storico_banco');

const arrotonda2 = pricing.round2;

// Stato di un ordine come lo vede chi lo legge qui. `tono` = classe colore (st-<tono>). Due soli stati (richiesta esplicita del
// 18/10/2026): finché l'installatore non conferma di aver ricevuto il materiale l'ordine è "In preparazione", anche dopo il "Preparato" del
// banco (`in_evasione`): dopo il "preso" del corriere su WhatsApp il bot non scrive più e nel DB non c'è nessun evento di ritiro o di partenza
// del corriere da cui ricavare un "In consegna" affidabile.
function statoOrdine(o) {
  if (o.consegnato_il) return { tono: 'consegnato', etichetta: 'Consegnato' };
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
  // `netto` = somma dei netti di riga (prezzo del banco + RAEE, IVA esclusa): serve al "di cui IVA" della pagina del banco.
  const netto = arrotonda2(righe.reduce((s, r) => s + Number(r.subtotale) + Number(r.raee_riga || 0), 0));
  return { iva, righe: righeCalcolate, totale: importi.banco.totale, servizio: importi.app.totale, importi, netto };
}

// Data breve e ora di un istante, in ora italiana (tipo "12 set, 14:30").
function dataCompatta(naive) {
  return `${format.dataCortaRoma(naive)}, ${format.oraSolaRoma(naive)}`;
}

// Le voci della vista per articolo: stessa riga (codice, nome, prezzo cad.) sommata sugli ordini del periodo, dal totale più alto.
// `perPrezzo: false` (pagina del cliente lato banco) somma per (codice, nome) anche con prezzi cad. diversi: allora `cad` è null e
// `prezziDiversi` è true se i prezzi non sono tutti uguali.
function articoliSommati(ordini, { perPrezzo = true } = {}) {
  const mappa = new Map();
  for (const o of ordini) {
    for (const r of o.righe) {
      const chiave = (perPrezzo ? [r.codice, r.nome, r.cad] : [r.codice, r.nome]).join('|');
      if (!mappa.has(chiave)) mappa.set(chiave, { codice: r.codice, nome: r.nome, cad: r.cad, prezziDiversi: false, quantita: 0, totale: 0, ordini: [] });
      const voce = mappa.get(chiave);
      if (voce.cad !== r.cad) {
        voce.cad = null;
        voce.prezziDiversi = true;
      }
      voce.quantita += r.quantita;
      voce.totale = arrotonda2(voce.totale + r.totale);
      if (!voce.ordini.includes(o.id)) voce.ordini.push(o.id);
    }
  }
  return [...mappa.values()].sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome));
}

// I totali di un elenco di ordini: quanto si deve per il materiale, quanto è stato pagato in app per il servizio e quanti sono.
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
//  · conRicevute: legge quali ordini hanno una ricevuta di pagamento (`ricevuta` su ogni ordine); di default solo per l'installatore.
// Ritorna { mese, vista, mesi, ditte, riepilogo, gruppi: [{ nome, riepilogo, ordini, articoli }], elenco (ordini e richieste chiuse, cronologico), senzaOrdine, vuoto }.
async function materialeOrdini({
  clienteId, distributorId = null, mese = null, vista = 'ordine',
  hrefOrdine = (id) => '/ordini/' + id, conRichiesteSenzaOrdine = distributorId === null, conRiordina = distributorId === null,
  conRicevute = distributorId === null, adesso = new Date(),
}) {
  const [ordiniGrezzi, ivaConfig, servizioPct, richiesteSenza, righeRichiesteGrezze] = await Promise.all([
    db
      .prepare(
        `SELECT o.id, o.creato_il, o.stato, o.consegnato_il, o.distributor_id, o.costo_consegna, o.contributo_raee, o.iva,
                o.totale_netto, o.totale_finale, o.servizio, o.imponibile_app, o.iva_app, o.da_pagare_app,
                o.imponibile_banco, o.iva_banco, o.materiale_banco, o.request_id, d.nome AS distributore_nome,
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
    // Le richieste chiuse senza ordine (nessuna risposta, annullate): solo per l'installatore, senza importi, e le loro righe (quantità e nome: le richieste
    // non salvano i prezzi) con UNA sola lettura per tutte, nelle stesse 200 della prima.
    conRichiesteSenzaOrdine
      ? db
          .prepare(
            `SELECT id, stato, creato_il FROM requests
              WHERE cliente_id = ? AND order_id IS NULL AND stato IN ('nessuna_offerta', 'annullata')
              ORDER BY id DESC LIMIT 200`
          )
          .all(clienteId)
      : [],
    conRichiesteSenzaOrdine
      ? db
          .prepare(
            `SELECT ri.request_id, ri.quantita, p.nome
               FROM request_items ri JOIN products p ON p.id = ri.product_id
              WHERE ri.request_id IN (
                SELECT id FROM requests
                 WHERE cliente_id = ? AND order_id IS NULL AND stato IN ('nessuna_offerta', 'annullata')
                 ORDER BY id DESC LIMIT 200)
              ORDER BY ri.request_id, ri.id`
          )
          .all(clienteId)
      : [],
  ]);

  const righePerOrdine = new Map();
  const richiesteConRicevuta = new Set();
  if (ordiniGrezzi.length) {
    const idRichieste = ordiniGrezzi.map((o) => o.request_id).filter(Boolean);
    // Le righe e le ricevute non dipendono una dall'altra. Una ricevuta c'è per un pagamento incassato (stripe_pagamenti: incassato, o poi rimborsato) e anche
    // per quello con l'ordine già nato e la capture ancora da fare ('da_incassare': è l'ordine in consegna appena partito, già "pagato" per chi lo guarda: vedi
    // pagamenti.calcolaStatoPagamento): niente per i blocchi annullati. Una lettura sola per tutti gli ordini, solo per l'installatore.
    const [righe, ricevute] = await Promise.all([
      db
        .prepare(
          `SELECT order_id, product_id, codice_snapshot, nome_snapshot, quantita, prezzo_netto_unitario, subtotale,
                  subtotale_cliente, raee_unitario, raee_riga
             FROM order_items WHERE order_id = ANY(?::int[]) ORDER BY id`
        )
        .all(ordiniGrezzi.map((o) => o.id)),
      conRicevute && idRichieste.length
        ? db
            .prepare(
              `SELECT DISTINCT request_id FROM stripe_pagamenti
                WHERE request_id = ANY(?::int[]) AND incasso_cent > 0 AND stato IN ('da_incassare', 'incassato', 'da_rimborsare', 'rimborsato')`
            )
            .all(idRichieste)
        : [],
    ]);
    for (const r of righe) {
      if (!righePerOrdine.has(r.order_id)) righePerOrdine.set(r.order_id, []);
      righePerOrdine.get(r.order_id).push(r);
    }
    for (const r of ricevute) richiesteConRicevuta.add(Number(r.request_id));
  }

  const ordini = ordiniGrezzi.map((o) => {
    const calcolo = calcolaOrdine(o, righePerOrdine.get(o.id) || [], ivaConfig, servizioPct);
    const mesePrimo = format.meseRoma(o.creato_il);
    return {
      id: o.id,
      meseChiave: mesePrimo.chiave,
      data: dataCompatta(o.creato_il),
      dataSola: format.dataSolaRoma(o.creato_il),
      stato: statoOrdine(o),
      // Lo stato come lo chiama il banco (Da preparare / In consegna / Consegnato), la colonna `stato` grezza (serve a
      // sapere se il banco ha già preso in carico l'ordine) e la richiesta da cui nasce.
      statoBanco: statoStorico(o),
      statoDb: o.stato,
      creatoIl: o.creato_il,
      requestId: o.request_id || null,
      // Esiste una ricevuta di pagamento (incassato con Stripe, o pagato in simulato: la sandbox ha la sua ricevuta "di prova"): il link "Ricevuta" e
      // "Ricevute del mese". Solo per l'installatore.
      ricevuta: conRicevute && !!o.request_id && (richiesteConRicevuta.has(Number(o.request_id)) || (o.pagamento_metodo === 'simulato' && o.pagamento_stato === 'pagato')),
      consegnato: !!o.consegnato_il,
      ditta: String(o.distributore_nome || '').trim() || 'il distributore',
      ...calcolo,
      primo: calcolo.righe[0] ? calcolo.righe[0].quantita + '× ' + calcolo.righe[0].nome : '',
      altri: Math.max(0, calcolo.righe.length - 1),
      href: hrefOrdine(o.id),
      riordinaId: conRiordina && o.consegnato_il ? o.id : null,
    };
  });
  const righePerRichiesta = new Map();
  for (const x of righeRichiesteGrezze) {
    const id = Number(x.request_id);
    if (!righePerRichiesta.has(id)) righePerRichiesta.set(id, []);
    righePerRichiesta.get(id).push({ quantita: x.quantita, nome: x.nome });
  }
  // Le richieste hanno la stessa forma di un ordine (data compatta, primo articolo e "+altri"): la scheda è la stessa, senza importi.
  const senzaOrdineTutte = richiesteSenza.map((r) => {
    const righeRichiesta = righePerRichiesta.get(Number(r.id)) || [];
    return {
      id: r.id,
      meseChiave: format.meseRoma(r.creato_il).chiave,
      data: dataCompatta(r.creato_il),
      tono: r.stato === 'annullata' ? 'annullata' : 'nessuna',
      etichetta: r.stato === 'annullata' ? 'Annullata' : 'Nessuna risposta',
      // Una richiesta ANNULLATA (da lui) non apre nessuna pagina: la scheda resta nello Storico ma non si apre e non è un link (richiesta esplicita del
      // 19/10/2026). Una chiusa per "nessuna risposta" sì: dalla sua pagina si può rinviare.
      href: r.stato === 'annullata' ? null : '/richieste/' + r.id,
      istante: new Date(r.creato_il).getTime(),
      righe: righeRichiesta,
      primo: righeRichiesta[0] ? righeRichiesta[0].quantita + '× ' + righeRichiesta[0].nome : '',
      altri: Math.max(0, righeRichiesta.length - 1),
    };
  });

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

  // L'elenco della vista "Per ordine": ordini e richieste chiuse senza ordine (nessuna risposta, annullate) INSIEME, dal più recente per data di creazione
  // (richiesta esplicita del 19/10/2026: niente sezione "Senza ordine"). A parità di istante, prima l'ordine. Ogni voce è
  // { tipo: 'ordine', ordine } oppure { tipo: 'richiesta', richiesta }.
  const senzaOrdinePeriodo = senzaOrdineTutte.filter(nelPeriodo);
  const elenco = [
    ...ordiniPeriodo.map((o) => ({ tipo: 'ordine', quando: new Date(o.creatoIl).getTime(), ordine: o })),
    ...senzaOrdinePeriodo.map((r) => ({ tipo: 'richiesta', quando: r.istante, richiesta: r })),
  ].sort((a, b) => b.quando - a.quando || (a.tipo === b.tipo ? 0 : a.tipo === 'ordine' ? -1 : 1));

  return {
    mese: scelto,
    vista: vista === 'articolo' ? 'articolo' : 'ordine',
    mesi,
    // Le ditte di tutti gli ordini (non solo del periodo): per intestare il riquadro anche in un mese senza ordini.
    ditte: [...new Set(ordini.map((o) => o.ditta))],
    riepilogo: riepilogoDi(ordiniPeriodo),
    gruppi,
    elenco,
    senzaOrdine: senzaOrdinePeriodo,
    vuoto: !ordiniPeriodo.length && !senzaOrdinePeriodo.length,
  };
}

// ---------- Pagina del cliente lato banco ----------

// Il materiale ordinato da un cliente a UN banco, per la scheda "Materiale ordinato" della sua pagina (GET /distributore/clienti/:id).
// Non rifà nessun conto: prende materialeOrdini (gli stessi numeri dello Storico dell'installatore, e dei suoi due CSV) e li dispone come
// serve al banco: elenco piatto degli ordini del periodo, stato "del banco", righe sommate per articolo e riepilogo. Prezzi dai
// valori salvati nell'ordine (mai il listino di oggi); niente servizio, che il cliente ha già pagato in app.
//  · riepilogo.totale = somma dei totali di ordine (pricing.importiOrdine: con le righe arrotondate una per una può differire di un
//    centesimo o due); riepilogo.iva = totale − somma dei netti di riga; nArticoli = articoli distinti, pezzi = somma delle quantità.
//  · `ditta`: nome mostrato nella frase "lo paga a …", se il cliente non ha ordini (nessun nome da leggere) vale quello passato.
async function materialeCliente(distributorId, clienteId, { mese = null, vista = 'ordine', ditta = '', adesso } = {}) {
  const m = await materialeOrdini({
    clienteId, distributorId, mese, vista, hrefOrdine: () => null, conRichiesteSenzaOrdine: false, conRiordina: false,
    ...(adesso ? { adesso } : {}),
  });
  // Dal più recente per data di creazione (a parità, l'id più alto): materialeOrdini li dà per id, che di norma è lo stesso ordine.
  const istante = (o) => (o.creatoIl ? new Date(o.creatoIl).getTime() : 0);
  const grezzi = m.gruppi.flatMap((g) => g.ordini).sort((a, b) => istante(b) - istante(a) || b.id - a.id);
  const ordini = grezzi.map((o) => ({
    id: o.id,
    data: o.data,
    dataSola: o.dataSola,
    nArticoli: o.righe.length,
    stato: o.statoBanco,
    totale: o.totale,
    righe: o.righe,
  }));
  const articoli = articoliSommati(grezzi, { perPrezzo: false });
  const netto = arrotonda2(grezzi.reduce((s, o) => s + o.netto, 0));
  const totale = arrotonda2(grezzi.reduce((s, o) => s + o.totale, 0));
  // Il mese scelto è 'tutto', uno con ordini, oppure (nessun ordine) il corrente: lo stesso `oggi` di materialeOrdini.
  const titolo = m.mese === 'tutto' ? '' : (m.mesi.find((x) => x.chiave === m.mese) || format.meseRoma(adesso || new Date())).titolo;
  return {
    mese: m.mese,
    vista: m.vista,
    // "Ottobre 2026" → "ottobre" per "Totale di ottobre"
    meseNome: String(titolo || '').split(' ')[0].toLowerCase(),
    mesi: m.mesi,
    mesiRecenti: m.mesi.slice(0, 2),
    mesiAltri: m.mesi.slice(2),
    ordini,
    articoli,
    riepilogo: {
      nOrdini: ordini.length,
      nArticoli: articoli.length,
      pezzi: grezzi.reduce((s, o) => s + o.righe.reduce((p, r) => p + r.quantita, 0), 0),
      totale,
      iva: arrotonda2(totale - netto),
    },
    ditta: format.nomeCommerciale(m.ditte[0] || ditta),
    vuoto: !ordini.length,
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
// Scrive un numero per il file CSV: due decimali con la virgola, come vuole Excel in italiano.
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

// Il nome del file CSV del materiale, con il mese scelto (o "tutto").
function nomeFileCsv(materiale) {
  return `materiale-${materiale.mese === 'tutto' ? 'tutto' : materiale.mese}.csv`;
}

// Il CSV del banco (da materialeCliente): ";" e BOM come l'altro, una riga per articolo, dal più vecchio al più recente, SENZA il
// servizio (il banco non lo incassa); l'ultima riga è il totale del periodo (quello della scheda).
function csvMaterialeCliente(mc) {
  const colonne = ['Data', 'Ordine', 'Stato', 'Codice', 'Articolo', 'Quantità', 'Prezzo cad. IVA incl.', 'Totale IVA incl.'];
  const righe = [colonne.map(cella).join(';')];
  for (const o of [...mc.ordini].reverse()) { // mc.ordini è dal più recente

    for (const r of o.righe) {
      righe.push([o.dataSola, '#' + o.id, o.stato.etichetta, r.codice, r.nome, r.quantita, numeroCsv(r.cad), numeroCsv(r.totale)].map(cella).join(';'));
    }
  }
  righe.push(['Totale', '', '', '', '', '', '', numeroCsv(mc.riepilogo.totale)].map(cella).join(';'));
  return '﻿' + righe.join('\r\n') + '\r\n';
}

// materiale_<ragione-sociale>_<AAAA-MM>.csv (o _tutto): solo lettere minuscole, cifre e trattini, così l'intestazione HTTP è sicura.
function nomeFileCsvCliente(ragioneSociale, mese) {
  const slug = String(ragioneSociale || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cliente';
  return `materiale_${slug}_${mese === 'tutto' ? 'tutto' : mese}.csv`;
}

module.exports = {
  materialeOrdini, materialeCliente, csvMateriale, csvMaterialeCliente, nomeFileCsv, nomeFileCsvCliente, calcolaOrdine, statoOrdine,
};
