// Etichette delle varianti (src/catalogo.js, etichettaVariante / infoVarianti / raggruppaVarianti): "H108xl60xp44cm"
// diventa "108 × 60 × 44 cm" e l'occhiello dice l'ordine delle lettere; qualunque altra forma resta com'è, con "Variante".
// Il DB è finto: catalogo.js lo carica ma questa prova non fa mai una query.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const percorsoDb = require.resolve(path.join(__dirname, '..', 'db/index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: { prepare() { throw new Error('nessuna query'); } } };
const { etichettaVariante, infoVarianti, raggruppaVarianti } = require('../src/catalogo');

test('etichettaVariante: altezza × larghezza × profondità con l\'unità una volta sola', () => {
  assert.equal(etichettaVariante('["H108xl60xp44cm"]'), '108 × 60 × 44 cm');
  assert.equal(etichettaVariante(['H80xl48xp30cm']), '80 × 48 × 30 cm');
  assert.equal(etichettaVariante('["h12,5XL6xP3MM"]'), '12,5 × 6 × 3 mm'); // maiuscole e minuscole, virgola decimale
});

test('etichettaVariante: l\'ordine delle lettere è quello scritto, senza unità resta senza', () => {
  assert.equal(etichettaVariante('["L1000xh400xp180"]'), '1000 × 400 × 180');
  assert.equal(etichettaVariante('["H40xl60"]'), '40 × 60');
});

test('etichettaVariante: le forme che non sono dimensioni restano quelle del catalogo', () => {
  assert.equal(etichettaVariante('["Ø1.1/2\\""]'), 'Ø1.1/2"');
  assert.equal(etichettaVariante('["Ø110","L.0,25m"]'), 'Ø110 L.0,25m');
  assert.equal(etichettaVariante('["135°","Ø44"]'), '135° Ø44');
  assert.equal(etichettaVariante('["H10xh20"]'), 'H10xh20'); // stessa lettera due volte: non sono tre misure
  assert.equal(etichettaVariante('["H108xl60xp44cm","Sp.30mm"]'), 'H108xl60xp44cm Sp.30mm'); // più valori
  assert.equal(etichettaVariante('["H108xl60xp44cm"]', false), 'H108xl60xp44cm'); // formatta = false
  assert.equal(etichettaVariante(null), null);
  assert.equal(etichettaVariante('non json'), null);
  assert.equal(etichettaVariante('[]'), null);
});

test('infoVarianti: occhiello con l\'ordine se TUTTE le varianti sono dimensioni nello stesso ordine', () => {
  const m = (v) => ({ variante_valori: JSON.stringify([v]) });
  assert.deepEqual(infoVarianti([m('H80xl48xp30cm'), m('H87xl50xp35cm')]), {
    voce: 'Misura', ordine: 'H × L × P', occhiello: 'Misura · H × L × P', titolo: 'Scegli la misura',
  });
  assert.equal(infoVarianti([m('L1000xh400xp180'), m('L800xh400xp180')]).occhiello, 'Misura · L × H × P');
  // ordine diverso, o una variante che non è una misura: occhiello generico e niente "H × L × P" sopra roba che non lo è
  assert.equal(infoVarianti([m('H80xl48xp30cm'), m('L1000xh400xp180')]).occhiello, 'Variante');
  assert.deepEqual(infoVarianti([m('H80xl48xp30cm'), m('Ø110')]), {
    voce: 'Variante', ordine: '', occhiello: 'Variante', titolo: 'Scegli la variante',
  });
});

test('raggruppaVarianti: etichette riscritte e varianti_info sul prodotto, ordinate per prezzo', async () => {
  const membro = (id, valori, prezzo) => ({ prodotto_id: id, nome: 'Cassone ' + valori, codice: 'C' + id, variante_valori: JSON.stringify([valori]), prezzo_listino: prezzo, sconto_base_pct: 0, disponibilita: 'disponibile', raee: 0 });
  const riga = (id, gruppo, membri) => ({ id, gruppo_id: gruppo, nome: 'Cassone', _gruppo: { nome_rappresentativo: 'Cassone Copricaldaia', membri } });
  const [misure, miste] = await raggruppaVarianti([
    riga(2, 1, [membro(2, 'H108xl60xp44cm', 149.88), membro(1, 'H80xl48xp30cm', 120), membro(3, 'H122xl65xp44cm', 180)]),
    riga(5, 2, [membro(5, 'H80xl48xp30cm', 10), membro(6, 'Ø110', 20)]),
  ]);
  assert.deepEqual(misure.varianti.map((v) => v.etichetta), ['80 × 48 × 30 cm', '108 × 60 × 44 cm', '122 × 65 × 44 cm']);
  assert.equal(misure.varianti_info.occhiello, 'Misura · H × L × P');
  assert.equal(misure.nome, 'Cassone Copricaldaia');
  assert.deepEqual(miste.varianti.map((v) => v.etichetta), ['H80xl48xp30cm', 'Ø110']);
  assert.equal(miste.varianti_info.occhiello, 'Variante');
});
