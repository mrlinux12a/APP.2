// Pagina dell'ordine vista dal banco (src/ordine_banco.js): le parti che non toccano il DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ob = require(path.join(__dirname, '..', 'src/ordine_banco'));

const riga = (id, extra = {}) => ({
  id, quantita: 1, codice_snapshot: 'C' + id, nome_snapshot: 'Articolo ' + id, prezzo_netto_unitario: 54.5, subtotale: 54.5,
  raee_unitario: 0, raee_riga: 0, prezzo_unitario_cliente: 59.95, subtotale_cliente: 59.95, preso_il: null, ...extra,
});

test('righeMateriale: prezzo del banco (netto + RAEE), mai quello col servizio; niente spunte', () => {
  const m = ob.righeMateriale([
    riga(1),
    riga(2, { quantita: 2, prezzo_netto_unitario: 100, subtotale: 200, raee_unitario: 1.5, raee_riga: 3 }),
  ]);
  assert.deepEqual(m.righe.map((r) => [r.id, r.quantita, r.cad, r.totale]), [[1, 1, 54.5, 54.5], [2, 2, 101.5, 203]]);
  assert.deepEqual(m.fuori, []);
  assert.ok(m.righe.every((r) => r.richiesti === null && r.confermati === null));
  // la bolla è su tutto il materiale: le righe non portano più nessuna spunta
  assert.deepEqual(Object.keys(m).sort(), ['fuori', 'righe']);
  assert.ok(m.righe.every((r) => !('preso' in r)));
  // non esistono i prezzi col servizio fra i valori restituiti
  assert.doesNotMatch(JSON.stringify(m), /59[.,]95/);
});

test('righeMateriale: senza righe, nessun errore', () => {
  assert.deepEqual(ob.righeMateriale([]).righe, []);
  assert.deepEqual(ob.righeMateriale(undefined).righe, []);
});

test('righeMateriale: le righe confermate a metà portano "richiesti / confermati"; quelle a zero vanno in `fuori`', () => {
  const mancanti = [
    { codice: 'C1', nome: 'Articolo 1', quantita_richiesta: 3, quantita_disponibile: 1, mancano: 2 },
    { codice: 'ZZ9', nome: 'Pompa', quantita_richiesta: 2, quantita_disponibile: 0, mancano: 2 },
  ];
  const m = ob.righeMateriale([riga(1), riga(2)], mancanti);
  assert.deepEqual(m.righe.map((r) => [r.richiesti, r.confermati]), [[3, 1], [null, null]]);
  assert.deepEqual(m.fuori.map((x) => x.codice), ['ZZ9']);
});

test('trasportoPredefinito: vettore col corriere; senza, mittente o destinatario secondo la modalità', () => {
  assert.equal(ob.trasportoPredefinito({ conCorriere: true, modalita: 'consegna_mezzo_grossista' }), 'vettore');
  assert.equal(ob.trasportoPredefinito({ conCorriere: true, modalita: 'ritiro' }), 'vettore');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false, modalita: 'consegna_mezzo_grossista' }), 'mittente');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false, modalita: 'ritiro' }), 'destinatario');
  assert.equal(ob.trasportoPredefinito({ conCorriere: false }), 'mittente');
  assert.deepEqual(ob.ASPETTI, ['Colli', 'Bancali', 'Scatole', 'Sfuso']);
  assert.deepEqual(ob.CAUSALI, ['Vendita', 'Conto visione', 'Reso', 'Conto lavorazione']);
});

test('indirizzoDiviso, descrizioneConsegna (vuota con il mezzo del banco) e sottotitoloCliente', () => {
  assert.deepEqual(ob.indirizzoDiviso('Via Castel Morrone 1/7r, 16161 Genova (GE)'), { via: 'Via Castel Morrone 1/7r', resto: '16161 Genova (GE)' });
  assert.deepEqual(ob.indirizzoDiviso('Via Roma 3'), { via: 'Via Roma 3', resto: '' });
  assert.deepEqual(ob.indirizzoDiviso('Via A, 1, Genova'), { via: 'Via A', resto: '1, Genova' });
  assert.deepEqual(ob.indirizzoDiviso(null), { via: '', resto: '' });
  assert.equal('linkMaps' in ob, false); // niente più link a Maps nella pagina dell'ordine
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: true, corriereNome: 'Marco' }), 'Corriere Marco · ritiro al banco');
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: true, corriereNome: '' }), 'Corriere · ritiro al banco');
  assert.equal(ob.descrizioneConsegna({ modalita: 'consegna_mezzo_grossista', conCorriere: false }), ''); // "Consegna con mezzo del banco" non si scrive più
  assert.equal(ob.descrizioneConsegna({ modalita: 'ritiro', conCorriere: false }), 'Ritiro al banco da parte del cliente');
  assert.equal(ob.sottotitoloCliente({ referente: 'Mario', partita_iva: '012' }), 'referente Mario · P. IVA 012');
  assert.equal(ob.sottotitoloCliente({ referente: '', partita_iva: '012' }), 'P. IVA 012');
  assert.equal(ob.sottotitoloCliente({ referente: 'Mario', partita_iva: null }), 'referente Mario');
  assert.equal(ob.sottotitoloCliente({}), '');
});

const riassunto = (passi) => passi.map((p) => [p.chiave, p.fase]);
const corriere = { nome: 'Marco', ora: '09:24' };

test('passiOrdine: la pagina è per un ordine "Da preparare" — conferma e corriere fatti, "Da preparare" (blu) in corso, poi In consegna e Consegnato', () => {
  const passi = ob.passiOrdine({ oraConferma: '09:20', corriere, oraRitiro: '09:45' });
  assert.deepEqual(riassunto(passi), [['conferma', 'fatto'], ['corriere', 'fatto'], ['preparare', 'corrente'], ['consegna', 'futuro'], ['consegnato', 'futuro']]);
  assert.deepEqual(passi.map((p) => [p.titolo, p.testo]), [
    ['Confermato da te', 'Alle 09:20'],
    ['Corriere trovato', 'Marco ha accettato alle 09:24'],
    ['Da preparare', 'Ritiro alle 09:45'],
    ['In consegna', 'La merce passa al corriere'],
    ['Consegnato', 'Lo conferma il cliente'],
  ]);
  // i toni: verde per ciò che è fatto e per la consegna, blu per "Da preparare" (come la pillola)
  assert.deepEqual(passi.map((p) => p.tono), ['verde', 'verde', 'blu', 'verde', 'verde']);
  // niente più "In preparazione" né "Partito"
  assert.doesNotMatch(JSON.stringify(passi), /In preparazione|Partito/);
});

test('passiOrdine: senza corriere (WhatsApp spento) quel passo non c\'è e "Da preparare" non promette un orario', () => {
  const passi = ob.passiOrdine({ oraConferma: '09:20' });
  assert.deepEqual(riassunto(passi), [['conferma', 'fatto'], ['preparare', 'corrente'], ['consegna', 'futuro'], ['consegnato', 'futuro']]);
  assert.equal(passi[1].testo, 'Prepara la merce e la bolla');
  assert.equal(passi[0].testo, 'Alle 09:20');
  // senza nemmeno l'ora della conferma
  assert.equal(ob.passiOrdine({ oraConferma: '—' })[0].testo, 'Fatto');
  assert.equal(ob.passiOrdine({})[0].testo, 'Fatto');
});

test('passiOrdine: il testo del corriere con i pezzi che mancano', () => {
  const testo = (c) => ob.passiOrdine({ corriere: c })[1].testo;
  assert.equal(testo({ nome: 'Marco', ora: '' }), 'Marco ha accettato');
  assert.equal(testo({ nome: '', ora: '09:24' }), 'Un corriere ha accettato alle 09:24');
  assert.equal(testo({ nome: '', ora: '' }), 'Un corriere ha accettato');
  assert.equal(testo({ nome: 'Marco', ora: '—' }), 'Marco ha accettato');
});

// ---------- La pagina si adatta allo stato (In consegna, Consegnato): momenti, bolla, tempo di consegna, passi ----------

// Istanti fissi: 19/10/2026 hh:mm UTC = hh+2:mm a Roma (ora legale). Le colonne TIMESTAMP si leggono "naive" (l'ora UTC come ora locale del processo, vedi format.istanteUtc).
const alle = (h, m, g = 19) => new Date(Date.UTC(2026, 9, g, h, m));
const naive = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());

test('momento: ora italiana da una colonna TIMESTAMP (UTC senza fuso) o da una TIMESTAMPTZ; il giorno solo se non è quello dell\'ordine', () => {
  const nascita = naive(alle(8, 28));
  assert.deepEqual(ob.momento(naive(alle(8, 47)), nascita), { ora: '10:47', giorno: '', completo: '19/10/2026 alle 10:47' });
  // TIMESTAMPTZ (corriere_*): un istante vero, `reale`
  assert.deepEqual(ob.momento(alle(8, 34), nascita, { reale: true }), { ora: '10:34', giorno: '', completo: '19/10/2026 alle 10:34' });
  // il giorno dopo: "20/10" (la mezzanotte si conta a Roma: 22:30 UTC del 19 = 00:30 del 20)
  assert.equal(ob.momento(naive(alle(22, 30)), nascita).giorno, '20/10');
  assert.equal(ob.momento(naive(alle(21, 30)), nascita).giorno, '', '21:30 UTC = 23:30 del 19 a Roma: ancora lo stesso giorno');
  assert.equal(ob.momento(null, nascita), null);
  assert.equal(ob.momento(undefined, nascita), null);
  assert.equal(ob.quando({ ora: '10:47', giorno: '' }), 'alle 10:47');
  assert.equal(ob.quando({ ora: '10:47', giorno: '20/10' }), 'il 20/10 alle 10:47');
  assert.equal(ob.quando(null), '');
});

test('partenza: la bolla (evaso_il) o, per un ordine solo "Preparato", il momento del Preparato; altrimenti niente', () => {
  assert.equal(ob.partenza({ evaso_il: 'A', in_evasione_il: 'B' }), 'A');
  assert.equal(ob.partenza({ evaso_il: null, in_evasione_il: 'B' }), 'B');
  assert.equal(ob.partenza({}), null);
});

test('bollaOrdine: numero e dettagli ("del 19/10/2026 · 1 collo · Vendita · trasporto a cura del vettore"); null senza bolla', () => {
  assert.equal(ob.bollaOrdine({ ddt_numero: null }), null);
  assert.deepEqual(
    ob.bollaOrdine({ ddt_numero: '1/2026', ddt_data: naive(alle(8, 47)), ddt_colli: 1, ddt_causale: 'Vendita', ddt_trasporto: 'vettore' }),
    { numero: '1/2026', dettagli: 'del 19/10/2026 · 1 collo · Vendita · trasporto a cura del vettore' }
  );
  assert.equal(ob.bollaOrdine({ ddt_numero: '2/2026', ddt_data: naive(alle(8, 47)), ddt_colli: 3, ddt_causale: 'Reso', ddt_trasporto: 'destinatario' }).dettagli,
    'del 19/10/2026 · 3 colli · Reso · trasporto a cura del destinatario');
  assert.equal(ob.bollaOrdine({ ddt_numero: '3/2026', ddt_trasporto: 'mittente' }).dettagli, 'trasporto a cura del mittente', 'le parti che mancano non si scrivono');
  assert.equal(ob.bollaOrdine({ ddt_numero: '4/2026', ddt_trasporto: 'boh' }).dettagli, '');
});

test('testoInConsegna: "Partito alle HH:MM · arrivo previsto alle HH:MM", con le parti che ci sono', () => {
  const base = { creato_il: naive(alle(8, 28)) };
  assert.equal(ob.testoInConsegna({ ...base, evaso_il: naive(alle(8, 47)), corriere_arrivo_il: alle(9, 21) }), 'Partito alle 10:47 · arrivo previsto alle 11:21');
  assert.equal(ob.testoInConsegna({ ...base, evaso_il: naive(alle(8, 47)) }), 'Partito alle 10:47');
  assert.equal(ob.testoInConsegna({ ...base, in_evasione_il: naive(alle(8, 50)) }), 'Partito alle 10:50', 'senza bolla, il momento del "Preparato"');
  assert.equal(ob.testoInConsegna({ ...base, corriere_arrivo_il: alle(9, 21) }), 'arrivo previsto alle 11:21');
  assert.equal(ob.testoInConsegna(base), 'La merce è in viaggio');
  assert.equal(ob.testoInConsegna({ ...base, evaso_il: naive(alle(8, 47)), corriere_arrivo_il: alle(22, 30) }), 'Partito alle 10:47 · arrivo previsto il 20/10 alle 00:30');
});

test('tempoDiConsegna: da quando è partito a quando il cliente ha confermato; "1 h 05" oltre l\'ora; null se non si può dire', () => {
  const t = (partito, consegnato) => ob.tempoDiConsegna({ evaso_il: partito && naive(partito), consegnato_il: consegnato && naive(consegnato) });
  assert.equal(t(alle(8, 47), alle(9, 21)), '34 min');
  assert.equal(t(alle(8, 47), alle(9, 52)), '1 h 05');
  assert.equal(t(alle(8, 47), alle(9, 47)), '1 h 00');
  assert.equal(t(alle(8, 47), alle(8, 47)), 'meno di 1 min');
  assert.equal(t(null, alle(9, 21)), null, 'mai partito (consegna provvisoria)');
  assert.equal(t(alle(8, 47), null), null);
  assert.equal(t(alle(9, 21), alle(8, 47)), null, 'consegnato prima di partire: niente tempo negativo');
  assert.equal(ob.tempoDiConsegna({ in_evasione_il: naive(alle(8, 47)), consegnato_il: naive(alle(9, 21)) }), '34 min', 'senza bolla vale il "Preparato"');
});

test('consegnatoTesto e ricevutoIl: la data scritta come "19/10" (con l\'anno se non è quello corrente)', () => {
  const gm = new Date().getFullYear() === 2026 ? '19/10' : '19/10/2026';
  assert.equal(ob.consegnatoTesto({ consegnato_il: naive(alle(9, 21)) }), `Il ${gm} alle 11:21 · confermato dal cliente`);
  assert.equal(ob.consegnatoTesto({ consegnato_il: null }), 'Confermato dal cliente');
  assert.equal(ob.ricevutoIl({ creato_il: naive(alle(8, 28)) }), `il ${gm} alle 10:28`);
});

test('passiOrdine "In consegna": conferma, corriere e Partito (con la bolla) fatti, Consegnato ancora da venire; senza corriere né bolla', () => {
  const partito = { quando: ob.momento(naive(alle(8, 47)), naive(alle(8, 28))), bolla: '12/2026' };
  const passi = ob.passiOrdine({ stato: 'in_consegna', oraConferma: '10:29', corriere, partito });
  assert.deepEqual(passi.map((p) => [p.chiave, p.fase, p.tono, p.titolo, p.testo]), [
    ['conferma', 'fatto', 'verde', 'Confermato da te', 'Alle 10:29'],
    ['corriere', 'fatto', 'verde', 'Corriere trovato', 'Marco ha accettato alle 09:24'],
    ['partito', 'fatto', 'verde', 'Partito', 'Bolla n. 12/2026 alle 10:47'],
    ['consegnato', 'futuro', 'verde', 'Consegnato', 'Lo conferma il cliente'],
  ]);
  assert.doesNotMatch(JSON.stringify(passi), /Da preparare|corrente/, 'nessun passo in corso e nessun "Da preparare"');
  // senza bolla (Preparato): solo l'ora; senza nemmeno quella: "Fatto"; senza corriere quel passo non c'è
  assert.equal(ob.passiOrdine({ stato: 'in_consegna', partito: { quando: partito.quando, bolla: '' } })[1].testo, 'Alle 10:47');
  assert.equal(ob.passiOrdine({ stato: 'in_consegna', partito: { quando: null, bolla: '' } })[1].testo, 'Fatto');
  assert.deepEqual(riassunto(ob.passiOrdine({ stato: 'in_consegna', partito })), [['conferma', 'fatto'], ['partito', 'fatto'], ['consegnato', 'futuro']]);
});

test('passiOrdine "Consegnato": tutto fatto, con le ore; un Partito senza momento (consegna provvisoria) non si scrive; il giorno se è un altro', () => {
  const nascita = naive(alle(8, 28));
  const partito = { quando: ob.momento(naive(alle(8, 47)), nascita), bolla: '12/2026' };
  const consegnato = { quando: ob.momento(naive(alle(9, 21)), nascita) };
  const passi = ob.passiOrdine({ stato: 'consegnato', oraConferma: '10:29', corriere, partito, consegnato });
  assert.deepEqual(passi.map((p) => [p.titolo, p.fase, p.testo]), [
    ['Confermato da te', 'fatto', 'Alle 10:29'],
    ['Corriere trovato', 'fatto', 'Marco ha accettato alle 09:24'],
    ['Partito', 'fatto', 'Bolla n. 12/2026 alle 10:47'],
    ['Consegnato', 'fatto', 'Confermato dal cliente alle 11:21'],
  ]);
  assert.ok(passi.every((p) => p.fase === 'fatto' && p.tono === 'verde'), 'tutti verdi');
  const senzaPartenza = ob.passiOrdine({ stato: 'consegnato', partito: { quando: null, bolla: '' }, consegnato });
  assert.deepEqual(senzaPartenza.map((p) => p.chiave), ['conferma', 'consegnato']);
  // il giorno dopo: "il 20/10 alle 00:30"
  const dopo = ob.passiOrdine({ stato: 'consegnato', partito: { quando: ob.momento(naive(alle(22, 30)), nascita), bolla: '' }, consegnato: { quando: ob.momento(naive(alle(22, 40)), nascita) } });
  assert.deepEqual(dopo.slice(-2).map((p) => p.testo), ['Il 20/10 alle 00:30', 'Confermato dal cliente il 20/10 alle 00:40']);
  // senza dati sul momento della consegna: resta "Confermato dal cliente"
  assert.equal(ob.passiOrdine({ stato: 'consegnato' }).slice(-1)[0].testo, 'Confermato dal cliente');
});
