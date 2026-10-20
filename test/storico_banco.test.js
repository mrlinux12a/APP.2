// Storico ordini del banco: le parti che non toccano il DB (stato di un ordine, filtri dall'URL, indirizzi, condizioni SQL,
// raggruppamento per giorno). Le pagine intere si provano in test/server.test.js, con il DB finto.
const test = require('node:test');
const assert = require('node:assert/strict');
const sb = require('../src/storico_banco');
const { giornoRoma, oraSolaRoma } = require('../src/format');

test('statoStorico: consegnato_il vale per primo; poi Da preparare (inviato) e In consegna (Preparato, o `evaso` degli ordini vecchi: niente più "In preparazione" né "Partito")', () => {
  assert.deepEqual(sb.statoStorico({ stato: 'inviato', consegnato_il: null }), { chiave: 'da_preparare', etichetta: 'Da preparare' });
  assert.deepEqual(sb.statoStorico({ stato: 'in_evasione', consegnato_il: null }), { chiave: 'in_consegna', etichetta: 'In consegna' });
  assert.deepEqual(sb.statoStorico({ stato: 'evaso', consegnato_il: null }), { chiave: 'in_consegna', etichetta: 'In consegna' });
  // un ordine segnato consegnato con la rotta provvisoria può restare in qualunque stato: è Consegnato
  for (const stato of ['inviato', 'in_evasione', 'evaso']) {
    assert.deepEqual(sb.statoStorico({ stato, consegnato_il: new Date() }), { chiave: 'consegnato', etichetta: 'Consegnato' }, stato);
  }
});

test('leggiFiltri: predefiniti (tutti, 7 giorni), valori sconosciuti scartati, ricerca ripulita, pagina limitata', () => {
  assert.deepEqual(sb.leggiFiltri({}), { stato: 'tutti', periodo: '7', q: '', pagina: 1 });
  assert.deepEqual(sb.leggiFiltri(undefined), { stato: 'tutti', periodo: '7', q: '', pagina: 1 });
  assert.deepEqual(sb.leggiFiltri({ stato: 'consegnati', periodo: 'oggi', q: '  rossi   impianti ', pagina: '3' }),
    { stato: 'consegnati', periodo: 'oggi', q: 'rossi impianti', pagina: 3 });
  for (const stato of ['da_preparare', 'in_consegna', 'consegnati', 'tutti']) assert.equal(sb.leggiFiltri({ stato }).stato, stato);
  // i segnalibri vecchi (?stato=in_preparazione, ?stato=partiti) portano a "In consegna", che li ha assorbiti; i nomi di Object.prototype non passano
  assert.equal(sb.leggiFiltri({ stato: 'in_preparazione' }).stato, 'in_consegna');
  assert.equal(sb.leggiFiltri({ stato: 'partiti' }).stato, 'in_consegna');
  assert.equal(sb.leggiFiltri({ stato: 'constructor' }).stato, 'tutti');
  assert.equal(sb.leggiFiltri({ stato: '__proto__' }).stato, 'tutti');
  for (const periodo of ['oggi', '7', '30', 'tutti']) assert.equal(sb.leggiFiltri({ periodo }).periodo, periodo);
  assert.equal(sb.leggiFiltri({ stato: "x'; DROP TABLE orders; --", periodo: '365' }).stato, 'tutti');
  assert.equal(sb.leggiFiltri({ periodo: '365' }).periodo, '7');
  assert.equal(sb.leggiFiltri({ pagina: '0' }).pagina, 1);
  assert.equal(sb.leggiFiltri({ pagina: '-4' }).pagina, 1);
  assert.equal(sb.leggiFiltri({ pagina: 'abc' }).pagina, 1);
  assert.equal(sb.leggiFiltri({ pagina: '99999999999' }).pagina, 100000);
  assert.equal(sb.leggiFiltri({ q: 'x'.repeat(500) }).q.length, 80);
});

test('urlStorico: stato e periodo sempre, ricerca e pagina solo se servono; cambiando un filtro si torna alla prima pagina', () => {
  const f = { stato: 'tutti', periodo: '7', q: '', pagina: 1 };
  assert.equal(sb.urlStorico(f), '/distributore/storico?stato=tutti&periodo=7');
  assert.equal(sb.urlStorico(f, { stato: 'in_consegna' }), '/distributore/storico?stato=in_consegna&periodo=7');
  assert.equal(sb.urlStorico({ ...f, q: '#91 & co' }), '/distributore/storico?stato=tutti&periodo=7&q=%2391%20%26%20co');
  const alla3 = { stato: 'consegnati', periodo: '30', q: 'rossi', pagina: 3 };
  assert.equal(sb.urlStorico(alla3), '/distributore/storico?stato=consegnati&periodo=30&q=rossi&pagina=3');
  assert.equal(sb.urlStorico(alla3, { stato: 'tutti' }), '/distributore/storico?stato=tutti&periodo=30&q=rossi');
  assert.equal(sb.urlStorico(alla3, { periodo: 'oggi' }), '/distributore/storico?stato=consegnati&periodo=oggi&q=rossi');
  assert.equal(sb.urlStorico(alla3, { q: '' }), '/distributore/storico?stato=consegnati&periodo=30');
  assert.equal(sb.urlStorico(alla3, { pagina: 1 }), '/distributore/storico?stato=consegnati&periodo=30&q=rossi');
  assert.equal(sb.urlStorico(alla3, { pagina: 2 }), '/distributore/storico?stato=consegnati&periodo=30&q=rossi&pagina=2');
});

test('condizioni: banco, periodo (mezzanotte italiana o ultimi N giorni) e ricerca, sempre con segnaposto', () => {
  let c = sb.condizioni(2, { stato: 'tutti', periodo: 'tutti', q: '', pagina: 1 });
  assert.deepEqual(c.dove, ['o.distributor_id = ?']);
  assert.deepEqual(c.parametri, [2]);

  c = sb.condizioni(2, { stato: 'tutti', periodo: 'oggi', q: '', pagina: 1 });
  assert.equal(c.dove.length, 2);
  assert.match(c.dove[1], /DATE_TRUNC\('day', NOW\(\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'UTC'/);
  assert.deepEqual(c.parametri, [2]);

  c = sb.condizioni(2, { stato: 'tutti', periodo: '30', q: '', pagina: 1 });
  assert.match(c.dove[1], /\(NOW\(\) AT TIME ZONE 'UTC'\) - \(\?::int \* INTERVAL '1 day'\)/);
  assert.deepEqual(c.parametri, [2, 30]);

  // i segnaposto sono tanti quanti i parametri, in ordine, qualunque filtro
  for (const filtri of [
    { periodo: '7', q: 'rossi' }, { periodo: '30', q: '#91' }, { periodo: 'oggi', q: '91' }, { periodo: 'tutti', q: 'A/12' },
  ]) {
    const x = sb.condizioni(2, { stato: 'tutti', pagina: 1, ...filtri });
    assert.equal(x.dove.join(' AND ').split('?').length - 1, x.parametri.length, JSON.stringify(filtri));
  }
});

test('condizioni: la ricerca copre il cliente, il numero d\'ordine solo con sole cifre (anche dopo un #), mai concatenata', () => {
  let c = sb.condizioni(2, { periodo: 'tutti', q: 'Rossi', stato: 'tutti', pagina: 1 });
  assert.equal(c.dove[1], '(u.ragione_sociale ILIKE ?)');
  assert.deepEqual(c.parametri, [2, '%Rossi%']);

  for (const q of ['91', '#91', '# 91']) {
    c = sb.condizioni(2, { periodo: 'tutti', q, stato: 'tutti', pagina: 1 });
    assert.equal(c.dove[1], '(u.ragione_sociale ILIKE ? OR o.id = ?)', q);
    assert.equal(c.parametri[c.parametri.length - 1], 91, q);
  }
  // non è un numero: niente confronto con l'id (e niente errore per numeri più grandi di un int4)
  for (const q of ['91a', 'A/91', '9'.repeat(10), '12 34']) {
    c = sb.condizioni(2, { periodo: 'tutti', q, stato: 'tutti', pagina: 1 });
    assert.doesNotMatch(c.dove[1], /o\.id/, q);
  }
  // i caratteri jolly di LIKE scritti dall'utente valgono per sé; il testo non finisce mai nell'SQL
  c = sb.condizioni(2, { periodo: 'tutti', q: "50%_\\x'; --", stato: 'tutti', pagina: 1 });
  assert.deepEqual(c.parametri.slice(1), ["%50\\%\\_\\\\x'; --%"]);
  assert.doesNotMatch(c.dove.join(' '), /50|DROP|--/);
});

test('le condizioni SQL degli stati sono le stesse di statoStorico (conteggi e filtro della lista non possono divergere)', () => {
  assert.equal(sb.CONDIZIONE_STATO.consegnati, 'o.consegnato_il IS NOT NULL');
  // gli altri due escludono i consegnati: un ordine consegnato non è anche "da preparare"
  assert.equal(sb.CONDIZIONE_STATO.da_preparare, "o.consegnato_il IS NULL AND o.stato = 'inviato'");
  assert.equal(sb.CONDIZIONE_STATO.in_consegna, "o.consegnato_il IS NULL AND o.stato IN ('in_evasione', 'evaso')");
  assert.deepEqual(Object.keys(sb.CONDIZIONE_STATO).sort(), ['consegnati', 'da_preparare', 'in_consegna']);
  assert.deepEqual(sb.SCHEDE.map((s) => s.filtro), ['tutti', 'da_preparare', 'in_consegna', 'consegnati']);
  assert.deepEqual(sb.SCHEDE.map((s) => s.chiave), [null, 'da_preparare', 'in_consegna', 'consegnato']);
  assert.deepEqual(sb.SCHEDE.map((s) => s.etichetta), ['Tutti', 'Da preparare', 'In consegna', 'Consegnati']);
  // la stessa regola in JS e in SQL: ogni combinazione (stato, consegnato) cade in UNA sola condizione, quella della sua chiave
  const vale = (condizione, o) => {
    const consegnato = !!o.consegnato_il;
    if (condizione === sb.CONDIZIONE_STATO.consegnati) return consegnato;
    if (condizione === sb.CONDIZIONE_STATO.da_preparare) return !consegnato && o.stato === 'inviato';
    if (condizione === sb.CONDIZIONE_STATO.in_consegna) return !consegnato && ['in_evasione', 'evaso'].includes(o.stato);
    throw new Error('condizione sconosciuta');
  };
  const filtroDi = { da_preparare: 'da_preparare', in_consegna: 'in_consegna', consegnato: 'consegnati' };
  for (const stato of ['inviato', 'in_evasione', 'evaso']) {
    for (const consegnato_il of [null, new Date()]) {
      const o = { stato, consegnato_il };
      const cadute = Object.keys(sb.CONDIZIONE_STATO).filter((k) => vale(sb.CONDIZIONE_STATO[k], o));
      assert.deepEqual(cadute, [filtroDi[sb.statoStorico(o).chiave]], stato + ' ' + (consegnato_il ? 'consegnato' : ''));
    }
  }
  assert.deepEqual(sb.PERIODI.map((p) => p.valore), ['oggi', '7', '30', 'tutti']);
});

test('materialeDegliOrdini: la prima riga con la quantità e quante altre', () => {
  const m = sb.materialeDegliOrdini([
    { order_id: 91, quantita: 1, nome_snapshot: 'Elemento A' },
    { order_id: 90, quantita: 2, nome_snapshot: 'Bocchettone' },
    { order_id: 90, quantita: 1, nome_snapshot: 'Valvola' },
    { order_id: 90, quantita: 5, nome_snapshot: 'Sifone' },
  ]);
  assert.deepEqual(m.get(91), { primo: '1× Elemento A', altri: 0 });
  assert.deepEqual(m.get(90), { primo: '2× Bocchettone', altri: 2 });
  assert.equal(m.get(89), undefined);
});

test('raggruppaPerGiorno: gruppi di giorni consecutivi nell\'ordine in cui arrivano', () => {
  const o = (id, chiave, etichetta) => ({ id, giorno: { chiave, etichetta } });
  const gruppi = sb.raggruppaPerGiorno([o(5, '2026-10-14', 'Oggi'), o(4, '2026-10-14', 'Oggi'), o(3, '2026-10-13', 'Ieri'), o(2, '2026-10-12', '12 ottobre')]);
  assert.deepEqual(gruppi.map((g) => [g.etichetta, g.ordini.map((x) => x.id)]), [['Oggi', [5, 4]], ['Ieri', [3]], ['12 ottobre', [2]]]);
  assert.deepEqual(sb.raggruppaPerGiorno([]), []);
});

test('giornoRoma e oraSolaRoma: il giorno e l\'ora sono quelli italiani, non UTC', () => {
  const adesso = new Date('2026-10-14T10:00:00Z'); // mercoledì 14 ottobre, 12:00 a Roma
  assert.deepEqual(giornoRoma('2026-10-14 08:00:00', adesso), { chiave: '2026-10-14', etichetta: 'Oggi' });
  assert.deepEqual(giornoRoma('2026-10-13 15:00:00', adesso), { chiave: '2026-10-13', etichetta: 'Ieri' });
  assert.deepEqual(giornoRoma('2026-10-12 09:00:00', adesso), { chiave: '2026-10-12', etichetta: '12 ottobre' });
  assert.deepEqual(giornoRoma('2025-03-12 09:00:00', adesso), { chiave: '2025-03-12', etichetta: '12 marzo 2025' });
  // 22:30 UTC del 13 ottobre sono già le 00:30 del 14 a Roma: è "Oggi", e l'ora è 00:30
  assert.deepEqual(giornoRoma('2026-10-13 22:30:00', adesso), { chiave: '2026-10-14', etichetta: 'Oggi' });
  assert.equal(oraSolaRoma('2026-10-13 22:30:00'), '00:30');
  // 21:59 UTC del 13 ottobre sono le 23:59 del 13: "Ieri"
  assert.deepEqual(giornoRoma('2026-10-13 21:59:00', adesso), { chiave: '2026-10-13', etichetta: 'Ieri' });
  assert.equal(oraSolaRoma('2026-10-13 21:59:00'), '23:59');
  // una Date come la leggerebbe pg (colonna senza fuso letta come ora locale)
  assert.equal(oraSolaRoma(new Date(2026, 9, 14, 8, 5)), '10:05');
  assert.deepEqual(giornoRoma(null), { chiave: '', etichetta: '—' });
  assert.equal(oraSolaRoma(null), '—');
});
