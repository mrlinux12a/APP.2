// Le ricevute di pagamento dell'installatore: numerazione, dati e PDF (pdfkit).
//
// Una ricevuta esiste solo per un pagamento incassato: la carta è autorizzata all'invio e incassata quando nasce l'ordine (regole in cima a
// src/pagamenti.js). Niente ricevuta per un blocco annullato o scaduto né per una richiesta ancora in attesa. Per un ordine rimborsato c'è anche la
// "Ricevuta di rimborso". Dal 19/10/2026 la ricevuta c'è anche per i pagamenti NON reali (simulato dell'app e del PC, Stripe con la chiave di prova):
// il PDF dice "Pagamento di prova (sandbox): nessun addebito reale." (`prova`, da calcolaStatoPagamento).
//
// Numero: R-AAAA-NNNNNN, progressivo per anno e per tipo ('pagamento' | 'rimborso'), tabella `ricevute` (indice unico su anno + numero + tipo).
// Un ordine ha UNA ricevuta per tipo (indice unico su ordine_id + tipo): rigenerare il PDF non cambia il numero. Il numero si assegna
// all'incasso (src/stripe_pagamenti.js: serve anche all'email); se per un guasto non c'è, lo assegna la prima apertura del PDF.
// L'azienda che emette la ricevuta viene dal .env (src/azienda.js): mai scritta nel codice.
const db = require('../db');
const pricing = require('./pricing');
const pagamenti = require('./pagamenti');
const format = require('./format');
const { azienda } = require('./azienda');

const TIPI = ['pagamento', 'rimborso'];

// R-2026-000123
function numeroTesto({ anno, numero }) {
  return `R-${anno}-${String(numero).padStart(6, '0')}`;
}

// Il numero di ricevuta di un ordine, assegnandolo se manca (idempotente). L'INSERT calcola il prossimo numero dell'anno (ora italiana)
// in una sola istruzione; se due ricevute nascono insieme e prendono lo stesso numero, l'indice unico ne scarta una (ON CONFLICT DO NOTHING)
// e si riprova. Ritorna { id, anno, numero, ordine_id, tipo, creato_il }.
async function assegna(ordineId, tipo = 'pagamento') {
  if (!TIPI.includes(tipo)) throw new Error('tipo di ricevuta sconosciuto: ' + tipo);
  for (let tentativo = 0; tentativo < 6; tentativo++) {
    const esistente = await db.prepare('SELECT * FROM ricevute WHERE ordine_id = ? AND tipo = ?').get(ordineId, tipo);
    if (esistente) return esistente;
    await db
      .prepare(
        `INSERT INTO ricevute (anno, numero, ordine_id, tipo)
         SELECT a.anno, COALESCE(MAX(r.numero), 0) + 1, ?, ?
           FROM (SELECT EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Europe/Rome'))::int AS anno) a
           LEFT JOIN ricevute r ON r.anno = a.anno AND r.tipo = ?
          GROUP BY a.anno
         ON CONFLICT DO NOTHING`
      )
      .run(ordineId, tipo, tipo);
  }
  throw new Error('numero di ricevuta non assegnato per l\'ordine ' + ordineId);
}

// Scrive l'indirizzo di un utente su una riga: via, CAP, città e provincia.
const indirizzoDi = (u) =>
  [String(u.indirizzo || '').trim(), [u.cap, u.citta, u.provincia ? '(' + u.provincia + ')' : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// Tutto quello che serve a disegnare una ricevuta (PDF ed email), o null se per questo ordine una ricevuta di questo tipo NON c'è: ordine
// inesistente o di un altro cliente (`clienteId`), pagamento non incassato o annullato. Assegna il numero se manca.
async function datiRicevuta(ordineId, { tipo = 'pagamento', clienteId = null } = {}) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(ordineId);
  if (!ordine || (clienteId !== null && ordine.cliente_id !== clienteId)) return null;
  const [richiesta, riga, cliente, distributore, ivaConfig, servizioPct] = await Promise.all([
    ordine.request_id
      ? db
          .prepare('SELECT id, stato, order_id, destinazione, pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il, rimborsato_il FROM requests WHERE id = ?')
          .get(ordine.request_id)
      : null,
    pagamenti.rigaPagamento(ordine.request_id),
    db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id),
    ordine.distributor_id ? db.prepare('SELECT * FROM distributors WHERE id = ?').get(ordine.distributor_id) : null,
    pricing.getIvaPct(),
    pricing.getServizioPct(),
  ]);
  const stato = pagamenti.calcolaStatoPagamento({ riga, richiesta, ordine });
  if (!stato || !(tipo === 'rimborso' ? stato.ricevutaRimborso : stato.ricevuta)) return null;

  const pagamento = richiesta && richiesta.pagamento_stato
    ? { stato: richiesta.pagamento_stato, metodo: richiesta.pagamento_metodo, importo: richiesta.pagamento_importo, pagato_il: richiesta.pagato_il, rimborsato_il: richiesta.rimborsato_il }
    : null;
  const importi = pricing.importiOrdine(ordine, pagamento, pricing.ivaPctOrdine(ordine, ivaConfig), servizioPct);
  const numero = await assegna(ordine.id, tipo);
  return {
    tipo,
    numero: numeroTesto(numero),
    // La data della ricevuta è quella dell'evento: l'incasso (o il rimborso), non il giorno in cui si scarica il PDF.
    data: stato.data || numero.creato_il,
    ordineId: ordine.id,
    richiestaId: ordine.request_id || null,
    ditta: String((distributore && distributore.nome) || '').trim(),
    destinazione: String(ordine.destinazione || (richiesta && richiesta.destinazione) || '').trim(),
    cliente: cliente || {},
    importi,
    carta: stato.carta,
    transazione: riga ? riga.payment_intent_id || '' : '',
    // Pagamento NON reale (simulato, o Stripe con la chiave di prova): la ricevuta lo dichiara.
    prova: !!stato.prova,
    azienda: azienda(),
  };
}

// ---------- PDF ----------

const COL = { blu: '#245A8F', testo: '#1C1917', grigio: '#6B6A5F', riga: '#ECE9E2', bordo: '#E2DED3', riquadro: '#F7F6F2' };
const MARGINE_X = 48;
const MARGINE_Y = 44;
// Scrive un importo con il simbolo dell'euro e due decimali.
const euro = (n) => '€ ' + pricing.euro(n);
// Data e ora scritte per la ricevuta, in ora italiana.
const dataOra = (d) => `${format.dataSolaRoma(d)}, ${format.oraSolaRoma(d)}`;

// Tutto quello che c'è scritto sulla ricevuta, senza disegnare niente (funzione pura: si prova da sola). `d` = datiRicevuta. Il disegno (disegnaRicevuta) non
// aggiunge né toglie parole: la ricevuta di rimborso è la stessa, con il titolo "Ricevuta di rimborso", "Totale rimborsato" e senza la nota sul materiale.
function modelloRicevuta(d) {
  const az = d.azienda;
  const rimborso = d.tipo === 'rimborso';
  const c = d.cliente || {};
  const app = d.importi.app;
  const quando = dataOra(d.data);
  const fiscaliCliente = [c.partita_iva ? 'P. IVA ' + c.partita_iva : '', c.sdi_pec ? 'SDI ' + c.sdi_pec : ''].filter(Boolean).join(' · ');
  const rigaCarta = d.carta ? `${rimborso ? 'Su carta' : 'Carta'} ${d.carta.testo} · ${quando}` : `${rimborso ? 'Rimborsato' : 'Pagato'} · ${quando}`;
  return {
    rimborso,
    marchio: (az.nome.charAt(0) || 'M').toUpperCase(),
    nomeAzienda: az.nome,
    sottotitolo: az.sottotitolo,
    titolo: rimborso ? 'Ricevuta di rimborso' : 'Ricevuta di pagamento',
    numeroData: `N. ${d.numero} · ${format.dataSolaRoma(d.data)}`,
    emessaDa: [az.ragioneSociale || az.nome, az.indirizzo, az.partitaIva ? 'P. IVA ' + az.partitaIva : ''].filter(Boolean),
    intestataA: [c.ragione_sociale, indirizzoDi(c), fiscaliCliente].filter(Boolean),
    ordine: `Ordine #${d.ordineId}${d.richiestaId ? ` (richiesta #${d.richiestaId})` : ''}${d.ditta ? ` · materiale da ${d.ditta}` : ''}`,
    consegna: d.destinazione ? `Consegna in cantiere: ${d.destinazione}` : '',
    // Dal 23/10/2026 il servizio ha l'IVA dentro: le voci sommano al totale e imponibile e IVA sono "di cui". Le ricevute degli importi nati prima
    // (app.ivaInclusa false) restano com'erano, con l'IVA sopra.
    voci: app.ivaInclusa
      ? [
          { testo: 'Corriere · consegna in cantiere (costo fisso)', importo: euro(app.corriere), grassetto: false },
          { testo: `Servizio · ${d.importi.servizioPct}% sulla merce di ${euro(d.importi.banco.merce)} + IVA`, importo: euro(app.servizioIva), grassetto: false },
          { testo: 'Di cui imponibile', importo: euro(app.imponibile), grassetto: false },
          { testo: `Di cui IVA ${d.importi.ivaPct}%`, importo: euro(app.iva), grassetto: false },
        ]
      : [
          { testo: 'Corriere · consegna in cantiere (costo fisso)', importo: euro(app.corriere), grassetto: false },
          { testo: `Servizio · ${d.importi.servizioPct}% sulla merce di ${euro(d.importi.banco.merce)}`, importo: euro(app.servizio), grassetto: false },
          { testo: 'Imponibile', importo: euro(app.imponibile), grassetto: true },
          { testo: `IVA ${d.importi.ivaPct}%`, importo: euro(app.iva), grassetto: false },
        ],
    totale: { etichetta: rimborso ? 'Totale rimborsato' : 'Totale pagato', importo: euro(app.totale) },
    pagamento: {
      etichetta: rimborso ? 'RIMBORSO' : 'PAGAMENTO',
      righe: [rigaCarta, d.transazione ? `Transazione ${d.transazione}` : '', d.prova ? 'Pagamento di prova (sandbox): nessun addebito reale.' : ''].filter(Boolean),
    },
    // Il materiale lo fattura il banco: non è mai dentro questa ricevuta.
    notaMateriale: rimborso
      ? null
      : {
          prima: `Il materiale (${euro(d.importi.banco.imponibile)} + IVA = ${euro(d.importi.banco.totale)}) `,
          evidenza: 'non è compreso',
          dopo: ` in questa ricevuta: te lo fattura direttamente ${d.ditta || 'il banco'}.`,
        },
    piede: [[az.nome, az.indirizzo, az.partitaIva ? 'P. IVA ' + az.partitaIva : '', az.email].filter(Boolean).join(' · '), az.notaFiscale].filter(Boolean),
  };
}

// Una ricevuta su una pagina del documento (`doc` è un PDFDocument con la pagina già aggiunta; `m` viene da modelloRicevuta). Font standard del PDF
// (Helvetica): niente file da caricare.
function disegnaRicevuta(doc, m) {
  const L = MARGINE_X;
  const W = doc.page.width - 2 * MARGINE_X;
  const etichetta = (testo, x, y, larghezza) =>
    doc.fillColor(COL.grigio).font('Helvetica-Bold').fontSize(7.5).text(testo, x, y, { width: larghezza, characterSpacing: 0.9, lineBreak: false });
  // Un blocco di righe (la prima in grassetto se `primaGrassetto`), ritorna dove finisce.
  const righe = (linee, x, y, larghezza, primaGrassetto) => {
    let yy = y;
    linee.forEach((t, i) => {
      doc.fillColor(COL.testo).font(primaGrassetto && i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
      doc.text(t, x, yy, { width: larghezza });
      yy += doc.heightOfString(t, { width: larghezza }) + 3;
    });
    return yy;
  };

  // --- intestazione: logo e nome, titolo e numero ---
  let y = MARGINE_Y;
  doc.roundedRect(L, y, 36, 36, 8).fill(COL.blu);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16).text(m.marchio, L, y + 10, { width: 36, align: 'center', lineBreak: false });
  doc.fillColor(COL.testo).font('Helvetica-Bold').fontSize(14).text(m.nomeAzienda, L + 46, y + 3, { width: 230, lineBreak: false });
  doc.fillColor(COL.grigio).font('Helvetica').fontSize(8.5).text(m.sottotitolo, L + 46, y + 22, { width: 230, lineBreak: false });
  doc.fillColor(COL.testo).font('Helvetica-Bold').fontSize(20).text(m.titolo, L, y + 2, { width: W, align: 'right', lineBreak: false });
  doc.fillColor(COL.grigio).font('Helvetica').fontSize(8.5).text(m.numeroData, L, y + 28, { width: W, align: 'right', lineBreak: false });

  // --- emessa da / intestata a ---
  y = 112;
  const metà = W / 2 - 12;
  const xDestra = L + W / 2 + 4;
  etichetta('EMESSA DA', L, y, metà);
  etichetta('INTESTATA A', xDestra, y, metà);
  y = Math.max(righe(m.emessaDa, L, y + 14, metà, true), righe(m.intestataA, xDestra, y + 14, metà, true)) + 10;

  // --- riquadro grigio: ordine e consegna ---
  doc.font('Helvetica-Bold').fontSize(9.5);
  const altOrdine = doc.heightOfString(m.ordine, { width: W - 28 });
  doc.font('Helvetica').fontSize(9.5);
  const altConsegna = m.consegna ? doc.heightOfString(m.consegna, { width: W - 28 }) + 3 : 0;
  const altBox = altOrdine + altConsegna + 22;
  doc.roundedRect(L, y, W, altBox, 8).lineWidth(0.8).fillAndStroke(COL.riquadro, COL.bordo);
  doc.fillColor(COL.testo).font('Helvetica-Bold').fontSize(9.5).text(m.ordine, L + 14, y + 11, { width: W - 28 });
  if (m.consegna) doc.fillColor(COL.testo).font('Helvetica').fontSize(9.5).text(m.consegna, L + 14, y + 11 + altOrdine + 3, { width: W - 28 });
  y += altBox + 22;

  // --- tabella descrizione / importo ---
  etichetta('DESCRIZIONE', L, y, 300);
  doc.fillColor(COL.grigio).font('Helvetica-Bold').fontSize(7.5).text('IMPORTO', L, y, { width: W, align: 'right', characterSpacing: 0.9, lineBreak: false });
  y += 15;
  for (const voce of m.voci) {
    doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor(COL.riga).stroke();
    doc.fillColor(COL.testo).font(voce.grassetto ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(voce.testo, L, y + 10, { width: W - 100, lineBreak: false });
    doc.text(voce.importo, L, y + 10, { width: W, align: 'right', lineBreak: false });
    y += 31;
  }
  doc.moveTo(L, y).lineTo(L + W, y).lineWidth(1.3).strokeColor(COL.testo).stroke();
  doc.fillColor(COL.testo).font('Helvetica-Bold').fontSize(11).text(m.totale.etichetta, L, y + 11, { width: W - 100, lineBreak: false });
  doc.text(m.totale.importo, L, y + 11, { width: W, align: 'right', lineBreak: false });
  y += 46;

  // --- pagamento (o rimborso) ---
  etichetta(m.pagamento.etichetta, L, y, 300);
  y = righe(m.pagamento.righe, L, y + 14, W, false) + 10;

  // --- il materiale non è compreso (solo ricevuta di pagamento) ---
  if (m.notaMateriale) {
    const n = m.notaMateriale;
    doc.font('Helvetica').fontSize(9.5);
    const altNota = doc.heightOfString(n.prima + n.evidenza + n.dopo, { width: W - 32 }) + 26;
    doc.roundedRect(L, y, W, altNota, 10).lineWidth(0.8).strokeColor(COL.bordo).stroke();
    doc.fillColor(COL.testo).font('Helvetica').fontSize(9.5).text(n.prima, L + 16, y + 13, { width: W - 32, continued: true });
    doc.font('Helvetica-Bold').text(n.evidenza, { continued: true });
    doc.font('Helvetica').text(n.dopo);
    y += altNota + 12;
  }

  // --- piè di pagina: dati dell'azienda e nota fiscale (se configurata). Margine inferiore azzerato un attimo: scrivere qui non deve aprire una pagina. ---
  doc.font('Helvetica').fontSize(7.5);
  const altPiede = m.piede.reduce((somma, t) => somma + doc.heightOfString(t, { width: W }) + 2, 0);
  const yPiede = doc.page.height - MARGINE_Y - altPiede;
  const margineBasso = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(L, yPiede - 10).lineTo(L + W, yPiede - 10).lineWidth(0.6).strokeColor(COL.riga).stroke();
  let yy = yPiede;
  for (const t of m.piede) {
    doc.fillColor(COL.grigio).text(t, L, yy, { width: W });
    yy += doc.heightOfString(t, { width: W }) + 2;
  }
  doc.page.margins.bottom = margineBasso;
}

// Un PDF con una pagina per ricevuta (la ricevuta singola ne ha una, "Ricevute del mese" tante). `elenco` = dati di datiRicevuta. Ritorna un Buffer.
function pdfRicevute(elenco, titolo = 'Ricevuta') {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGINE_Y, bottom: MARGINE_Y, left: MARGINE_X, right: MARGINE_X },
      autoFirstPage: false,
      info: { Title: titolo, Author: (elenco[0] && elenco[0].azienda.nome) || 'Minuteria' },
    });
    const pezzi = [];
    doc.on('data', (p) => pezzi.push(p));
    doc.on('end', () => resolve(Buffer.concat(pezzi)));
    doc.on('error', reject);
    try {
      for (const d of elenco) {
        doc.addPage();
        disegnaRicevuta(doc, modelloRicevuta(d));
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Nome del file: ricevuta-R-2026-000123.pdf
const nomeFilePdf = (d) => `ricevuta${d.tipo === 'rimborso' ? '-rimborso' : ''}-${d.numero}.pdf`;

module.exports = { assegna, numeroTesto, datiRicevuta, modelloRicevuta, disegnaRicevuta, pdfRicevute, nomeFilePdf };
