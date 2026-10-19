// Prove di src/ricevute.js: numero della ricevuta (progressivo per anno e per tipo, una per ordine), quando una ricevuta NON esiste, cosa c'è scritto
// (modelloRicevuta, funzione pura) e il PDF (pdfkit). DB in memoria: nessun accesso al database vero. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ---------------- DB in memoria ----------------
const tabellaRicevute = [];
const stato = {
  anno: 2026,
  conflittiNumero: 0, // quante INSERT l'indice unico (anno, numero, tipo) scarta prima di riuscire: due ricevute nate insieme che prendono lo stesso numero
  inserimenti: 0,
  ordine: null,
  richiesta: null,
  riga: null,
  cliente: null,
  distributore: { id: 2, nome: 'BOREA SRL' },
};
const dbFinto = {
  prepare: (sql) => {
    const s = sql.replace(/\s+/g, ' ');
    const esegui = async (...p) => {
      if (/^SELECT \* FROM ricevute WHERE ordine_id = \? AND tipo = \?/.test(s)) return tabellaRicevute.find((r) => r.ordine_id === Number(p[0]) && r.tipo === p[1]) || null;
      if (/^INSERT INTO ricevute \(anno, numero, ordine_id, tipo\) SELECT .* ON CONFLICT DO NOTHING/.test(s)) {
        stato.inserimenti++;
        const [ordineId, tipo] = p;
        if (stato.conflittiNumero > 0) { stato.conflittiNumero--; return { changes: 0 }; }
        if (tabellaRicevute.some((r) => r.ordine_id === Number(ordineId) && r.tipo === tipo)) return { changes: 0 };
        const numero = Math.max(0, ...tabellaRicevute.filter((r) => r.anno === stato.anno && r.tipo === tipo).map((r) => r.numero)) + 1;
        tabellaRicevute.push({ id: tabellaRicevute.length + 1, anno: stato.anno, numero, ordine_id: Number(ordineId), tipo, creato_il: new Date(2026, 9, 15, 19, 20) });
        return { changes: 1 };
      }
      if (/^SELECT \* FROM orders WHERE id = \?/.test(s)) return stato.ordine && stato.ordine.id === Number(p[0]) ? stato.ordine : null;
      if (/FROM requests WHERE id = \?/.test(s)) return stato.richiesta;
      if (/FROM stripe_pagamenti WHERE request_id = \? AND stato IN/.test(s)) return stato.riga;
      if (/^SELECT \* FROM users WHERE id = \?/.test(s)) return stato.cliente;
      if (/^SELECT \* FROM distributors WHERE id = \?/.test(s)) return stato.distributore;
      if (/FROM config WHERE chiave/.test(s)) return { valore: p[0] === 'iva_pct' ? '22' : p[0] === 'servizio_pct' ? '10' : p[0] === 'spedizione_fissa' ? '10' : '33' };
      throw new Error('query non prevista dal DB finto: ' + s.slice(0, 110));
    };
    return { get: esegui, all: esegui, run: esegui };
  },
  transaction: (fn) => (...a) => fn(...a),
};
const percorsoDb = require.resolve(path.join(__dirname, '..', 'db', 'index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

const ricevute = require('../src/ricevute');

// Le variabili d'ambiente dell'azienda: si impostano per prova e si rimettono com'erano.
const CHIAVI_AZIENDA = ['AZIENDA_NOME', 'AZIENDA_SOTTOTITOLO', 'AZIENDA_RAGIONE_SOCIALE', 'AZIENDA_INDIRIZZO', 'AZIENDA_PIVA', 'AZIENDA_EMAIL', 'RICEVUTA_NOTA_FISCALE', 'APP_URL'];
function conAzienda(valori, prova) {
  const prima = Object.fromEntries(CHIAVI_AZIENDA.map((k) => [k, process.env[k]]));
  for (const k of CHIAVI_AZIENDA) delete process.env[k];
  Object.assign(process.env, valori);
  const ripristina = () => { for (const k of CHIAVI_AZIENDA) { if (prima[k] === undefined) delete process.env[k]; else process.env[k] = prima[k]; } };
  const r = prova();
  return r && typeof r.then === 'function' ? r.finally(ripristina) : (ripristina(), r);
}

// Date come le legge pg dalle colonne TIMESTAMP (UTC senza fuso, lette come ora locale): 15/10/2026 19:16 UTC = 21:16 a Roma.
const incassoUtc = new Date(2026, 9, 15, 19, 16);
const rimborsoUtc = new Date(2026, 9, 16, 8, 30);

// Un ordine pagato con Stripe: merce 64,50 + corriere 10,00 -> in app 20,07 (6,45 di servizio + IVA 3,62), materiale 78,69.
function scenario({ id = 97, clienteId = 1, rigaStato = 'incassato', rimborso = false } = {}) {
  tabellaRicevute.length = 0;
  stato.anno = 2026;
  stato.conflittiNumero = 0;
  stato.inserimenti = 0;
  stato.ordine = {
    id, cliente_id: clienteId, request_id: 177, distributor_id: 2, destinazione: 'Via Puggia 22/3, 16131 Genova (GE)',
    totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81,
    servizio: 6.45, imponibile_app: 16.45, iva_app: 3.62, da_pagare_app: 20.07, imponibile_banco: 64.5, iva_banco: 14.19, materiale_banco: 78.69,
  };
  stato.richiesta = { id: 177, stato: 'ordinata', order_id: id, destinazione: 'Via Puggia 22/3, 16131 Genova (GE)', pagamento_stato: rimborso ? 'rimborsato' : 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: incassoUtc, rimborsato_il: rimborso ? rimborsoUtc : null };
  stato.riga = {
    stato: rimborso ? 'rimborsato' : rigaStato, importo_cent: 2007, incasso_cent: ['incassato', 'rimborsato', 'da_rimborsare'].includes(rimborso ? 'rimborsato' : rigaStato) ? 2007 : null,
    payment_intent_id: 'pi_3QxExample0123456789', request_id: 177, carta_marca: 'visa', carta_ultime4: '4242', receipt_url: 'https://pay.stripe.com/receipts/x',
    incassato_il: incassoUtc, aggiornato_il: rimborso ? rimborsoUtc : incassoUtc,
  };
  stato.cliente = { id: clienteId, ragione_sociale: 'Rossi Impianti S.r.l.', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'GE', partita_iva: '12345678901', sdi_pec: 'KRRH6B9', email: 'rossi@example.com' };
  stato.distributore = { id: 2, nome: 'BOREA SRL' };
}

test('numeroTesto: R-AAAA-NNNNNN', () => {
  assert.equal(ricevute.numeroTesto({ anno: 2026, numero: 123 }), 'R-2026-000123');
  assert.equal(ricevute.numeroTesto({ anno: 2027, numero: 1 }), 'R-2027-000001');
  assert.equal(ricevute.numeroTesto({ anno: 2026, numero: 1234567 }), 'R-2026-1234567');
});

test('numerazione: progressiva, una ricevuta per ordine e tipo (rigenerare il PDF non cambia il numero), separata per tipo e per anno', async () => {
  scenario();
  const a = await ricevute.assegna(10);
  const b = await ricevute.assegna(11);
  assert.deepEqual([a.numero, b.numero, a.anno], [1, 2, 2026]);
  const ancora = await ricevute.assegna(10);
  assert.equal(ancora.numero, 1, 'lo stesso ordine ha lo stesso numero');
  assert.equal(tabellaRicevute.length, 2, 'nessuna riga in più');
  // il rimborso ha la sua numerazione
  assert.equal((await ricevute.assegna(10, 'rimborso')).numero, 1);
  assert.equal((await ricevute.assegna(11, 'rimborso')).numero, 2);
  assert.equal((await ricevute.assegna(12)).numero, 3);
  // un anno nuovo riparte da 1
  stato.anno = 2027;
  assert.equal((await ricevute.assegna(13)).numero, 1);
  assert.equal((await ricevute.assegna(14)).numero, 2);
  assert.equal((await ricevute.assegna(10)).anno, 2026, 'la ricevuta già emessa resta del suo anno');
  // tipo sconosciuto
  await assert.rejects(() => ricevute.assegna(10, 'altro'), /tipo di ricevuta sconosciuto/);
});

test('numerazione: due ricevute che prendono lo stesso numero insieme (l\'indice unico ne scarta una) si risolvono riprovando; senza fine, un errore', async () => {
  scenario();
  stato.conflittiNumero = 2; // le prime due INSERT sono scartate dall'indice, la terza riesce
  const r = await ricevute.assegna(20);
  assert.equal(r.numero, 1);
  assert.equal(stato.inserimenti, 3);
  // se non riesce mai: errore chiaro, non un ciclo infinito
  scenario();
  stato.conflittiNumero = 100;
  await assert.rejects(() => ricevute.assegna(21), /numero di ricevuta non assegnato per l'ordine 21/);
  assert.equal(stato.inserimenti, 6);
});

test('datiRicevuta: tutto quello che serve, con la data dell\'incasso e lo stesso numero a ogni apertura', async () => {
  scenario();
  const d = await conAzienda({ AZIENDA_NOME: 'Minuteria' }, () => ricevute.datiRicevuta(97, { clienteId: 1 }));
  assert.equal(d.tipo, 'pagamento');
  assert.equal(d.numero, 'R-2026-000001');
  assert.equal(d.data, incassoUtc, 'la data è quella dell\'incasso');
  assert.deepEqual([d.ordineId, d.richiestaId, d.ditta, d.destinazione], [97, 177, 'BOREA SRL', 'Via Puggia 22/3, 16131 Genova (GE)']);
  assert.equal(d.cliente.ragione_sociale, 'Rossi Impianti S.r.l.');
  assert.deepEqual([d.importi.app.corriere, d.importi.app.servizio, d.importi.app.imponibile, d.importi.app.iva, d.importi.app.totale], [10, 6.45, 16.45, 3.62, 20.07]);
  assert.deepEqual([d.importi.banco.merce, d.importi.banco.totale], [64.5, 78.69]);
  assert.deepEqual([d.carta.testo, d.transazione], ['Visa •••• 4242', 'pi_3QxExample0123456789']);
  assert.equal(d.azienda.nome, 'Minuteria');
  assert.equal((await ricevute.datiRicevuta(97, { clienteId: 1 })).numero, 'R-2026-000001');
  assert.equal(tabellaRicevute.length, 1);
});

test('datiRicevuta: NESSUNA ricevuta se il pagamento non è incassato (bloccato, annullato), né per l\'ordine di un altro cliente', async () => {
  // l'ordine non esiste / è di un altro cliente
  scenario();
  assert.equal(await ricevute.datiRicevuta(999), null);
  assert.equal(await ricevute.datiRicevuta(97, { clienteId: 2 }), null);
  // carta solo bloccata (autorizzata, nessun banco ha ancora confermato): niente ricevuta
  scenario({ rigaStato: 'autorizzato' });
  assert.equal(await ricevute.datiRicevuta(97, { clienteId: 1 }), null, 'autorizzato');
  // con l'ordine già nato e la capture ancora da fare ('da_incassare': il corriere ha accettato, Stripe incassa fra pochi secondi) è già pagato, e la ricevuta
  // si può aprire (19/10/2026): con l'importo dell'ordine e la data in cui è nato, senza la carta (arriva con la capture), e lo stesso numero dopo l'incasso
  scenario({ rigaStato: 'da_incassare' });
  stato.riga.carta_marca = null;
  stato.riga.carta_ultime4 = null;
  stato.riga.incassato_il = null;
  const inCorso = await ricevute.datiRicevuta(97, { clienteId: 1 });
  assert.ok(inCorso, 'da_incassare con l\'ordine nato');
  assert.deepEqual([inCorso.numero, inCorso.importi.app.totale, inCorso.carta, inCorso.data], ['R-2026-000001', 20.07, null, incassoUtc]);
  stato.riga.stato = 'incassato';
  stato.riga.incasso_cent = 2007;
  assert.equal((await ricevute.datiRicevuta(97, { clienteId: 1 })).numero, 'R-2026-000001', 'il numero assegnato prima dell\'incasso resta lo stesso');
  // blocco annullato: nessun addebito, nessuna ricevuta
  for (const rigaStato of ['da_rilasciare', 'rilasciato', 'scaduto']) {
    scenario({ rigaStato });
    assert.equal(await ricevute.datiRicevuta(97, { clienteId: 1 }), null, rigaStato);
  }
  // pagato con Stripe ma senza la riga di Stripe (non si sa se la carta è stata incassata): nessuna ricevuta, e nessun numero assegnato a vuoto
  scenario();
  stato.riga = null;
  stato.richiesta.pagamento_metodo = 'stripe';
  assert.equal(await ricevute.datiRicevuta(97, { clienteId: 1 }), null);
  assert.equal(tabellaRicevute.length, 0);
  // la ricevuta di rimborso non c'è se non è stato rimborsato
  scenario();
  assert.equal(await ricevute.datiRicevuta(97, { tipo: 'rimborso', clienteId: 1 }), null);
});

test('datiRicevuta: la ricevuta di rimborso (ordine rimborsato) ha la sua numerazione e la data del rimborso', async () => {
  scenario({ rimborso: true });
  const pagamento = await ricevute.datiRicevuta(97, { clienteId: 1 });
  const rimborso = await ricevute.datiRicevuta(97, { tipo: 'rimborso', clienteId: 1 });
  assert.equal(pagamento.numero, 'R-2026-000001');
  assert.equal(rimborso.numero, 'R-2026-000001', 'una numerazione per ogni tipo');
  assert.equal(rimborso.tipo, 'rimborso');
  assert.equal(rimborso.data, rimborsoUtc);
  assert.equal(ricevute.nomeFilePdf(pagamento), 'ricevuta-R-2026-000001.pdf');
  assert.equal(ricevute.nomeFilePdf(rimborso), 'ricevuta-rimborso-R-2026-000001.pdf');
});

test('modelloRicevuta: cosa c\'è scritto (titolo, numero, emessa da / intestata a, ordine, voci, totale, pagamento, nota sul materiale)', async () => {
  scenario();
  const d = await conAzienda(
    { AZIENDA_NOME: 'Minuteria', AZIENDA_RAGIONE_SOCIALE: 'Esempio Servizi S.r.l.', AZIENDA_INDIRIZZO: 'Via dell\'Esempio 1, 16100 Genova (GE)', AZIENDA_PIVA: '01234567890', AZIENDA_EMAIL: 'assistenza@example.com', RICEVUTA_NOTA_FISCALE: 'La fattura elettronica è inviata tramite SDI.' },
    () => ricevute.datiRicevuta(97, { clienteId: 1 })
  );
  const m = ricevute.modelloRicevuta(d);
  assert.equal(m.titolo, 'Ricevuta di pagamento');
  assert.equal(m.numeroData, 'N. R-2026-000001 · 15/10/2026');
  assert.deepEqual([m.marchio, m.nomeAzienda, m.sottotitolo], ['M', 'Minuteria', 'Consegna materiale in cantiere']);
  assert.deepEqual(m.emessaDa, ['Esempio Servizi S.r.l.', 'Via dell\'Esempio 1, 16100 Genova (GE)', 'P. IVA 01234567890']);
  assert.deepEqual(m.intestataA, ['Rossi Impianti S.r.l.', 'Via Roma 1, 16121 Genova (GE)', 'P. IVA 12345678901 · SDI KRRH6B9']);
  assert.equal(m.ordine, 'Ordine #97 (richiesta #177) · materiale da BOREA SRL');
  assert.equal(m.consegna, 'Consegna in cantiere: Via Puggia 22/3, 16131 Genova (GE)');
  assert.deepEqual(m.voci, [
    { testo: 'Corriere · consegna in cantiere (costo fisso)', importo: '€ 10,00', grassetto: false },
    { testo: 'Servizio · 10% sulla merce di € 64,50', importo: '€ 6,45', grassetto: false },
    { testo: 'Imponibile', importo: '€ 16,45', grassetto: true },
    { testo: 'IVA 22%', importo: '€ 3,62', grassetto: false },
  ]);
  assert.deepEqual(m.totale, { etichetta: 'Totale pagato', importo: '€ 20,07' });
  assert.deepEqual(m.pagamento, { etichetta: 'PAGAMENTO', righe: ['Carta Visa •••• 4242 · 15/10/2026, 21:16', 'Transazione pi_3QxExample0123456789'] });
  // il materiale lo fattura il banco: mai dentro la ricevuta
  assert.deepEqual(m.notaMateriale, { prima: 'Il materiale (€ 64,50 + IVA = € 78,69) ', evidenza: 'non è compreso', dopo: ' in questa ricevuta: te lo fattura direttamente BOREA SRL.' });
  assert.doesNotMatch(JSON.stringify(m.voci), /78,69|14,19/, 'né il materiale né la sua IVA tra le voci pagate');
  // piè di pagina: i dati dell'azienda e, se c'è, la nota fiscale
  assert.deepEqual(m.piede, ['Minuteria · Via dell\'Esempio 1, 16100 Genova (GE) · P. IVA 01234567890 · assistenza@example.com', 'La fattura elettronica è inviata tramite SDI.']);
});

test('modelloRicevuta: i dati dell\'azienda vengono dal .env, mai dal codice; quello che manca non si stampa (nemmeno la nota fiscale)', async () => {
  scenario();
  const d = await conAzienda({}, () => ricevute.datiRicevuta(97, { clienteId: 1 }));
  const m = ricevute.modelloRicevuta(d);
  assert.equal(m.nomeAzienda, 'Minuteria', 'il nome di default è quello dell\'app');
  assert.deepEqual(m.emessaDa, ['Minuteria'], 'senza ragione sociale, indirizzo e partita IVA resta il solo nome');
  assert.deepEqual(m.piede, ['Minuteria'], 'e nessuna riga di nota fiscale');
  // un'azienda con un altro nome e la sola nota fiscale
  const e = await conAzienda({ AZIENDA_NOME: 'Cantiere Facile', RICEVUTA_NOTA_FISCALE: 'Nota da confermare.' }, () => ricevute.datiRicevuta(97, { clienteId: 1 }));
  const m2 = ricevute.modelloRicevuta(e);
  assert.deepEqual([m2.marchio, m2.nomeAzienda], ['C', 'Cantiere Facile']);
  assert.deepEqual(m2.piede, ['Cantiere Facile', 'Nota da confermare.']);
  // senza carta (un pagamento di cui Stripe non ha dato i dettagli) e senza destinazione
  scenario();
  stato.riga.carta_marca = null;
  stato.riga.carta_ultime4 = null;
  stato.ordine.destinazione = '';
  stato.richiesta.destinazione = '';
  const senza = ricevute.modelloRicevuta(await ricevute.datiRicevuta(97, { clienteId: 1 }));
  assert.equal(senza.pagamento.righe[0], 'Pagato · 15/10/2026, 21:16');
  assert.equal(senza.consegna, '');
});

test('modelloRicevuta, ricevuta di rimborso: stessa grafica, titolo e totale di rimborso, nessuna nota sul materiale', async () => {
  scenario({ rimborso: true });
  const m = ricevute.modelloRicevuta(await ricevute.datiRicevuta(97, { tipo: 'rimborso', clienteId: 1 }));
  assert.equal(m.titolo, 'Ricevuta di rimborso');
  assert.equal(m.totale.etichetta, 'Totale rimborsato');
  assert.equal(m.pagamento.etichetta, 'RIMBORSO');
  assert.equal(m.pagamento.righe[0], 'Su carta Visa •••• 4242 · 16/10/2026, 10:30');
  assert.equal(m.notaMateriale, null);
  assert.equal(m.voci.length, 4);
});

test('PDF: un file valido con una pagina per ricevuta; nomi e indirizzi lunghissimi non aprono pagine in più', async () => {
  scenario();
  const d = await conAzienda({ AZIENDA_RAGIONE_SOCIALE: 'Esempio Servizi S.r.l.', AZIENDA_PIVA: '01234567890', RICEVUTA_NOTA_FISCALE: 'Nota.' }, () => ricevute.datiRicevuta(97, { clienteId: 1 }));
  const pagine = (pdf) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
  const uno = await ricevute.pdfRicevute([d], 'Ricevuta di pagamento');
  assert.ok(Buffer.isBuffer(uno));
  assert.equal(uno.subarray(0, 5).toString(), '%PDF-');
  assert.equal(uno.subarray(-6).toString().trim(), '%%EOF');
  assert.ok(uno.length > 1500);
  assert.equal(pagine(uno), 1);
  // "Ricevute del mese": tre ricevute, tre pagine, un solo file
  assert.equal(pagine(await ricevute.pdfRicevute([d, d, d], 'Ricevute 2026-10')), 3);
  // testi molto lunghi (destinazione, ragione sociale, ditta) vanno a capo senza uscire dalla pagina
  const lunga = { ...d, destinazione: 'Via ' + 'Lunghissima '.repeat(40), ditta: 'BOREA ' + 'DISTRIBUZIONE '.repeat(10), cliente: { ...d.cliente, ragione_sociale: 'Rossi '.repeat(30), indirizzo: 'Via '.repeat(60) } };
  assert.equal(pagine(await ricevute.pdfRicevute([lunga])), 1, 'una pagina anche con testi lunghissimi');
  // ricevuta di rimborso
  scenario({ rimborso: true });
  const r = await ricevute.datiRicevuta(97, { tipo: 'rimborso', clienteId: 1 });
  assert.equal(pagine(await ricevute.pdfRicevute([r], 'Ricevuta di rimborso')), 1);
});

test('datiRicevuta: la ricevuta c\'è anche per un pagamento NON reale (simulato, o Stripe con la chiave di prova) ed è segnata "di prova"', async () => {
  // simulato (sandbox dell'app e del PC): nessuna riga di Stripe, ordine nato -> ricevuta con numero, senza carta né transazione
  scenario();
  stato.riga = null;
  stato.richiesta.pagamento_metodo = 'simulato';
  const simulata = await ricevute.datiRicevuta(97, { clienteId: 1 });
  assert.ok(simulata, 'la ricevuta del pagamento simulato c\'è');
  assert.equal(simulata.numero, 'R-2026-000001');
  assert.equal(simulata.prova, true);
  assert.equal(simulata.carta, null);
  assert.equal(simulata.transazione, '');
  assert.equal(simulata.data, incassoUtc, 'la data è quella del pagamento sulla richiesta');
  assert.equal(simulata.importi.app.totale, 20.07);
  const m = ricevute.modelloRicevuta(simulata);
  assert.deepEqual(m.pagamento.righe, ['Pagato · 15/10/2026, 21:16', 'Pagamento di prova (sandbox): nessun addebito reale.']);
  // il PDF si disegna (nessun errore) e ha il numero assegnato una volta sola
  const pdf = await ricevute.pdfRicevute([simulata]);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await ricevute.datiRicevuta(97, { clienteId: 1 })).numero, 'R-2026-000001');
  assert.equal(tabellaRicevute.length, 1);
  // anche rimborsato (con l'ordine): le due ricevute, di prova
  scenario({ rimborso: true });
  stato.riga = null;
  stato.richiesta.pagamento_metodo = 'simulato';
  const rimborso = await ricevute.datiRicevuta(97, { tipo: 'rimborso', clienteId: 1 });
  assert.ok(rimborso && rimborso.prova);
  assert.equal(rimborso.data, rimborsoUtc);
  assert.match(ricevute.modelloRicevuta(rimborso).pagamento.righe.join('|'), /Pagamento di prova/);
  // Stripe con la chiave di prova (modo test): la ricevuta dice "di prova" anche lei; con la chiave vera no
  scenario();
  stato.riga.modo = 'test';
  assert.equal((await ricevute.datiRicevuta(97, { clienteId: 1 })).prova, true);
  assert.match(ricevute.modelloRicevuta(await ricevute.datiRicevuta(97, { clienteId: 1 })).pagamento.righe.join('|'), /Visa •••• 4242.*Pagamento di prova/);
  scenario();
  stato.riga.modo = 'live';
  const vera = await ricevute.datiRicevuta(97, { clienteId: 1 });
  assert.equal(vera.prova, false);
  assert.doesNotMatch(ricevute.modelloRicevuta(vera).pagamento.righe.join('|'), /prova/);
});
