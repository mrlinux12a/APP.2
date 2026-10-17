// Prova end-to-end di server.js: l'app vera (middleware, route, viste, sessioni) con un DB finto in memoria.
// Non tocca MAI il database di produzione: il modulo db/index.js viene sostituito prima di caricare il
// server, quindi nessuna connessione a Postgres viene aperta. Si lancia con `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const radice = path.join(__dirname, '..');
const PORTA = 38471;
const bcrypt = require('bcryptjs');

// ---------------- DB finto ----------------
const sessioni = new Map();
const catalogo = {
  1: { id: 1, codice: 'C1', nome: 'Valvola a sfera', categoria: 'Raccordi', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 10, sconto_base_pct: 30, raee: 0, attivo: 1, disponibilita: 'disponibile' },
  2: { id: 2, codice: 'C2', nome: 'Raccordo a T', categoria: 'Raccordi', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 5, sconto_base_pct: 20, raee: 0, attivo: 1, disponibilita: 'disponibile' },
  // Gli esempi del carrello a prezzo del banco: 54,50 + 10,00 di merce; e un articolo con RAEE (2,50 a pezzo)
  3: { id: 3, codice: 'C3', nome: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', categoria: 'Fumisteria', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 54.5, sconto_base_pct: 0, raee: 0, attivo: 1, disponibilita: 'disponibile' },
  4: { id: 4, codice: 'C4', nome: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', categoria: 'Fumisteria', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 10, sconto_base_pct: 0, raee: 0, attivo: 1, disponibilita: 'disponibile' },
  5: { id: 5, codice: 'C5', nome: 'Scaldabagno elettrico 80 l', categoria: 'Elettrico', macro_slug: 'idraulica', brand_slug: null, prezzo_listino: 100, sconto_base_pct: 0, raee: 2.5, attivo: 1, disponibilita: 'disponibile' },
};
const utente = {
  id: 1, ruolo: 'cliente', username: 'prova', ragione_sociale: 'Prova S.r.l.', zona: 'Genova', distributor_id: null, attivo: 1,
  password_hash: bcrypt.hashSync('password-di-prova', 4), indirizzo_consegna: 'Via Puggia 22/3, Genova',
};
const config = { servizio_pct: '10', iva_pct: '22', finestra_conferma_min: '10', ordine_minimo: '33', spedizione_fissa: '10' };
const registro = []; // le query viste, per controllare cosa NON è stato eseguito

// Storico del cliente 1: richieste, righe e ordini. Si accende solo nelle prove che lo usano (storico.attivo), così
// le altre pagine (barra in basso, home) restano come prima. pg legge le colonne TIMESTAMP (UTC senza fuso) come ora
// locale: `naive` costruisce lo stesso tipo di Date, e funziona qualunque sia il fuso del PC.
const naive = (d) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
const fa = (ms) => naive(new Date(Date.now() - ms));
const storico = {
  attivo: false,
  // Le risposte dei banchi per id di richiesta (request_responses + distributors), per le pagine delle richieste chiuse.
  risposte: {},
  richieste: [
    { id: 6, stato: 'in_attesa', creato_il: fa(60000), scade_il: naive(new Date(Date.now() + 300000)), order_id: null, pagamento_stato: 'pagato', pagamento_importo: 66.9 },
    { id: 5, stato: 'ordinata', creato_il: fa(2 * 3600000), scade_il: fa(3600000), order_id: 50, pagamento_stato: 'pagato', pagamento_importo: 66.9 },
    { id: 4, stato: 'nessuna_offerta', creato_il: new Date(2025, 2, 20, 9, 0), scade_il: new Date(2025, 2, 20, 9, 10), order_id: null, pagamento_stato: 'rimborsato', pagamento_importo: 85.34 },
    { id: 3, stato: 'ordinata', creato_il: new Date(2025, 2, 12, 10, 40), scade_il: new Date(2025, 2, 12, 10, 50), order_id: 30, pagamento_stato: 'pagato', pagamento_importo: 120.5 },
    { id: 2, stato: 'annullata', creato_il: new Date(2025, 1, 25, 8, 0), scade_il: new Date(2025, 1, 25, 8, 10), order_id: null, pagamento_stato: 'rimborsato', pagamento_importo: 20 },
    { id: 1, stato: 'ordinata', creato_il: new Date(2025, 1, 10, 15, 0), scade_il: new Date(2025, 1, 10, 15, 10), order_id: 10, pagamento_stato: null, pagamento_importo: null },
  ].map((r) => ({ cliente_id: 1, zona: 'Genova', ...r })),
  righe: {
    6: [{ nome: 'Bocchettone A 90°', quantita: 2, product_id: 6, codice: 'C6', prezzo_listino: 40, sconto_base_pct: 0, raee: 0 }],
    5: [{ nome: 'Adattatore Ø80/100mm', quantita: 1 }],
    4: [{ nome: 'Sifone doccia', quantita: 1, product_id: 4, codice: 'C4', prezzo_listino: 20, sconto_base_pct: 0, raee: 0 }],
    3: [{ nome: 'Valvola a sfera', quantita: 4 }],
    2: [{ nome: 'Raccordo a T', quantita: 1 }],
    1: [{ nome: 'Valvola a sfera', quantita: 2 }, { nome: 'Raccordo a T', quantita: 3 }],
  },
  ordini: {
    50: { id: 50, cliente_id: 1, stato: 'inviato', creato_il: fa(2 * 3600000), consegnato_il: null, totale_ivato: 66.9, totale_finale: 54.84, distributore_nome: 'Borea' },
    30: { id: 30, cliente_id: 1, stato: 'evaso', creato_il: new Date(2025, 2, 12, 10, 45), consegnato_il: new Date(2025, 2, 12, 14, 0), totale_ivato: 120.5, totale_finale: 98.77, distributore_nome: 'Borea' },
    // ordine di prima delle offerte per distributore: niente IVA calcolata, si mostra totale_finale
    10: { id: 10, cliente_id: 1, stato: 'evaso', creato_il: new Date(2025, 1, 10, 15, 5), consegnato_il: new Date(2025, 1, 11, 9, 0), totale_ivato: 0, totale_finale: 40, distributore_nome: 'Cambielli' },
  },
};
// Gli articoli dell'ordine 10 per "Riordina": due buoni, uno disattivato, uno non più nel catalogo, uno non disponibile.
const articoliOrdine10 = [
  { product_id: 1, quantita: 2, prodotto_id: 1, attivo: 1, disponibilita: 'disponibile' },
  { product_id: 2, quantita: 3, prodotto_id: 2, attivo: 1, disponibilita: 'in_esaurimento' },
  { product_id: 3, quantita: 1, prodotto_id: 3, attivo: 0, disponibilita: 'disponibile' },
  { product_id: 77, quantita: 1, prodotto_id: null, attivo: null, disponibilita: null },
  { product_id: 4, quantita: 1, prodotto_id: 4, attivo: 1, disponibilita: 'non_disponibile' },
];

// L'ordine consegnato più recente del cliente 1 con le sue righe (una lettura sola), per il carrello vuoto: quattro righe,
// così se ne vedono tre e "+ 1 altro".
const ultimoOrdineRighe = [
  { ordine_id: 10, creato_il: new Date(2025, 1, 10, 15, 5), quantita: 2, nome_snapshot: 'Valvola a sfera' },
  { ordine_id: 10, creato_il: new Date(2025, 1, 10, 15, 5), quantita: 3, nome_snapshot: 'Raccordo a T' },
  { ordine_id: 10, creato_il: new Date(2025, 1, 10, 15, 5), quantita: 1, nome_snapshot: 'Adattatore Ø80/100mm Per Caldaia 45-65kw' },
  { ordine_id: 10, creato_il: new Date(2025, 1, 10, 15, 5), quantita: 4, nome_snapshot: 'Sifone doccia' },
];

function eseguiStorico(s, p, modo) {
  if (/FROM orders o JOIN order_items oi/.test(s)) return ultimoOrdineRighe;
  if (/SELECT \* FROM requests WHERE cliente_id = \? ORDER BY id DESC LIMIT 50/.test(s)) return storico.richieste;
  // Le richieste recenti dell'icona e di "Stato ordini": la query porta anche i secondi che mancano alla fine della
  // finestra di conferma (qui calcolati da scade_il, che è un TIMESTAMP UTC letto come ora locale).
  if (/SELECT id, stato, creato_il, scade_il, order_id, EXTRACT\(EPOCH FROM \(scade_il - NOW\(\)\)\)::int AS secondi_rimasti FROM requests WHERE cliente_id/.test(s)) {
    const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    return storico.richieste.slice(0, 30).map((r) => ({ ...r, secondi_rimasti: Math.round((utc(r.scade_il) - Date.now()) / 1000) }));
  }
  // Gli ordini delle richieste "ordinata" per l'icona e per "Stato ordini": si accendono con storico.conOrdini, così le
  // altre prove vedono la sola richiesta in attesa (l'ordine 50 è in consegna, gli altri sono consegnati).
  if (storico.conOrdini && /SELECT id, stato, consegnato_il, creato_il, corriere_arrivo_il, corriere_risposto_il, corriere_nome, consegna_ore FROM orders WHERE id IN/.test(s)) {
    return p.map((id) => storico.ordini[id]).filter(Boolean);
  }
  if (/SELECT \* FROM requests WHERE id = \?/.test(s)) return storico.richieste.find((r) => r.id === Number(p[0])) || null;
  if (/FROM request_responses rr JOIN distributors d ON d\.id = rr\.distributor_id WHERE rr\.request_id = \?/.test(s)) return storico.risposte[Number(p[0])] || [];
  if (/EXTRACT\(EPOCH FROM/.test(s)) return { s: 300 };
  if (/FROM request_items ri JOIN products p/.test(s)) return p.flatMap((id) => (storico.righe[id] || []).map((x) => ({ request_id: id, ...x })));
  if (/FROM orders o LEFT JOIN distributors d/.test(s)) return p.map((id) => storico.ordini[id]).filter(Boolean);
  if (/SELECT id, cliente_id FROM orders WHERE id = \?/.test(s)) {
    return Number(p[0]) === 10 ? { id: 10, cliente_id: 1 } : Number(p[0]) === 99 ? { id: 99, cliente_id: 2 } : null;
  }
  if (/FROM order_items oi LEFT JOIN products p/.test(s)) return Number(p[0]) === 10 ? articoliOrdine10 : [];
  return undefined; // non è una query dello storico
}

// Pagina dell'ordine (cliente 1): 70 consegnato dal banco (stato evaso, con bolla e pagamento di prova), 71 "consegnato"
// con la rotta provvisoria ma rimasto 'inviato' (il caso che prima si poteva annullare), 72 ancora in consegna e annullabile.
// Si accende solo nelle prove che la usano.
const ordiniProva = {
  attivo: false,
  base: {
    cliente_id: 1, modalita: 'consegna_mezzo_grossista', note: null, totale_netto: 112.53, totale_finale: 112.53, request_id: 80, distributor_id: 2,
    consegna_ore: 6, costo_consegna: 10, iva: 26.96, totale_ivato: 149.49, destinazione: 'Via Puggia 22/3, 16131 Genova (GE)',
    partenza_ore: null, ddt_numero: null, ddt_data: null, corriere_arrivo_il: null, corriere_nome: '', contributo_raee: 0,
  },
};
// 13 ottobre 2026, 18:10 UTC = mercoledì 14 ottobre 2026, 20:10 a Roma
const consegnatoIl = naive(new Date(Date.UTC(2026, 9, 14, 18, 10)));
ordiniProva.ordini = {
  70: { ...ordiniProva.base, id: 70, stato: 'evaso', creato_il: fa(3 * 86400000), consegnato_il: consegnatoIl, ddt_numero: 'A/12', ddt_data: fa(3 * 86400000) },
  71: { ...ordiniProva.base, id: 71, stato: 'inviato', creato_il: fa(3600000), consegnato_il: consegnatoIl },
  72: { ...ordiniProva.base, id: 72, stato: 'inviato', creato_il: fa(3600000), consegnato_il: null },
  // l'ordine 50 dello storico (richiesta 5, in consegna, senza orario del corriere): la sua pagina per la prova della striscia
  50: { ...ordiniProva.base, id: 50, stato: 'inviato', creato_il: fa(2 * 3600000), consegnato_il: null, request_id: 5 },
};
const righeOrdineProva = [{ id: 1, quantita: 1, codice_snapshot: '12364959', nome_snapshot: '87 Elemento A "t" 87gr Diam. 100', prezzo_netto_unitario: 112.53, subtotale: 112.53, raee_unitario: 0, raee_riga: 0, subtotale_cliente: 112.53 }];

// Il modello nuovo (consegna pagata in app + materiale a BOREA): 54,50 + 10,00 di merce. In app: corriere 10,00 + servizio 6,45 (10% di 64,50) +
// IVA 3,62 = 20,07; materiale 64,50 + IVA 14,19 = 78,69; spesa complessiva 98,76. Gli ordini 73 (consegnato), 74 (in consegna) e 75 (pagamento
// rimborsato) hanno le colonne nuove salvate; il 70 è "vecchio" (colonne a 0: gli importi si ricalcolano dai valori di prima).
const importiNuovi = {
  totale_netto: 64.5, totale_finale: 70.95, costo_consegna: 10, contributo_raee: 0, iva: 17.81, totale_ivato: 98.76,
  servizio: 6.45, imponibile_app: 16.45, iva_app: 3.62, da_pagare_app: 20.07, imponibile_banco: 64.5, iva_banco: 14.19, materiale_banco: 78.69,
};
Object.assign(ordiniProva.ordini, {
  73: { ...ordiniProva.base, ...importiNuovi, id: 73, request_id: 81, stato: 'evaso', creato_il: fa(3 * 86400000), consegnato_il: consegnatoIl, ddt_numero: 'A/12', ddt_data: fa(3 * 86400000) },
  74: { ...ordiniProva.base, ...importiNuovi, id: 74, request_id: 81, stato: 'inviato', creato_il: fa(3600000), consegnato_il: null },
  75: { ...ordiniProva.base, ...importiNuovi, id: 75, request_id: 82, stato: 'inviato', creato_il: fa(3600000), consegnato_il: null },
});
const righeOrdineNuovo = [
  { id: 11, quantita: 1, codice_snapshot: '12514597', nome_snapshot: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', prezzo_netto_unitario: 54.5, subtotale: 54.5, raee_unitario: 0, raee_riga: 0, subtotale_cliente: 59.95 },
  { id: 12, quantita: 1, codice_snapshot: '12697319', nome_snapshot: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', prezzo_netto_unitario: 10, subtotale: 10, raee_unitario: 0, raee_riga: 0, subtotale_cliente: 11 },
];
const pagatoIlProva = naive(new Date(Date.UTC(2026, 9, 15, 10, 0))); // 15 ottobre 2026

function eseguiOrdineProva(s, p, modo) {
  if (/^SELECT \* FROM orders WHERE id = \?/.test(s)) return ordiniProva.ordini[p[0]] || null;
  if (/^SELECT \* FROM order_items WHERE order_id = \?/.test(s)) {
    if (!(Number(p[0]) in ordiniProva.ordini)) return [];
    return [73, 74, 75].includes(Number(p[0])) ? righeOrdineNuovo : righeOrdineProva;
  }
  if (/^SELECT \* FROM distributors WHERE id = \?/.test(s)) return { id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino' };
  if (/FROM requests WHERE id = \?/.test(s) && /pagamento_stato, pagamento_metodo/.test(s)) {
    // 81: consegna pagata con Stripe (20,07); 82: la stessa, poi rimborsata; le altre: l'ordine di prima, pagato tutto in app (149,49)
    if (Number(p[0]) === 81) return { pagamento_stato: 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: pagatoIlProva };
    if (Number(p[0]) === 82) return { pagamento_stato: 'rimborsato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: pagatoIlProva };
    return { pagamento_stato: 'pagato', pagamento_metodo: 'simulato', pagamento_importo: 149.49, pagato_il: fa(3 * 86400000) };
  }
  return undefined;
}

// Registrazione: il distributore predefinito (BOREA SRL, due filiali: 2 e 181) e i legami che la prova ha visto creare.
// Come lo storico, si accende solo nelle prove che lo usano.
const registrazione = { attiva: false, cercato: null, legamiCreati: [], stato: 'approvato', sql: [] };
const FILIALI = [2, 181];

function eseguiRegistrazione(s, p, modo) {
  if (/SELECT id FROM distributors WHERE attivo = 1 AND LOWER\(nome\) = LOWER/.test(s)) {
    registrazione.cercato = p[0];
    return String(p[0]).toLowerCase() === 'borea srl' ? [{ id: 2 }] : [];
  }
  if (/SELECT id FROM distributors WHERE attivo = 1 AND id = \?/.test(s)) {
    registrazione.cercato = Number(p[0]);
    return FILIALI.includes(Number(p[0])) ? [{ id: Number(p[0]) }] : [];
  }
  if (/SELECT d\.id FROM distributors d/.test(s)) return p[0].some((id) => FILIALI.includes(id)) ? FILIALI.map((id) => ({ id })) : [];
  if (/INSERT INTO users/.test(s)) { registrazione.sql.push({ s, p }); return { changes: 1, lastInsertRowid: utente.id }; }
  if (/INSERT INTO client_distributors/.test(s)) { registrazione.legamiCreati.push([p[0], p[1]]); registrazione.sql.push({ s, p }); return { changes: 1 }; }
  if (/INSERT INTO notifications/.test(s)) { registrazione.sql.push({ s, p }); return { changes: 1 }; }
  if (/FROM client_distributors cd JOIN distributors d/.test(s)) {
    return registrazione.legamiCreati.map(([, d]) => ({ cliente_id: utente.id, distributor_id: d, stato: registrazione.stato, distributore: 'BOREA SRL', filiale: 'Banco', ditta_id: 6 }));
  }
  return undefined;
}

// Home del banco: un utente distributore (filiale 2) con due richieste da confermare, una confermata in attesa del
// corriere e due ordini da preparare. Si accende solo nella prova che la usa.
// Materiale ordinato (Storico ordini dell'installatore e pagina cliente del banco: src/materiale.js). Si accende solo nelle prove che
// lo usano. Le query rispondono con queste righe per QUALUNQUE cliente: la stessa lettura serve a /storico (cliente 1, tutti i banchi) e a
// /distributore/clienti/32 (filtrata sulla filiale 2), così si può confrontare quello che vedono i due.
// Ordini di ottobre 2026 (il prezzo del banco è il netto, il cliente-con-servizio il +10%; IVA 22%):
//   #98 in preparazione, 1× valvola: netto 50 -> materiale 61,00; addebitato in app (servizio 5 + consegna 10) × 1,22 = 18,30
//   #97 consegnato, 1× elemento con RAEE 2: netto 100 + 2 -> materiale 124,44; pagato TUTTO in app prima (148,84), quindi si calcola:
//       (10 + 10) × 1,22 = 24,40
//   #91 consegnato, 2× bocchettone + 1× raccordo -> materiale 73,20 + 12,81 = 86,01; servizio (6 + 1,05 + 10) × 1,22 = 20,80
// e #30 di settembre (consegnato, 3 × netto 100 -> materiale 366,00; addebitato non salvato, quindi servizio calcolato (30 + 10) × 1,22 = 48,80).
// Totale ottobre: 271,45; servizio ottobre: 63,50.
const materialeProva = { attivo: false, chiamate: [] }; // chiamate: con quale cliente e filiale si sono lette le righe
const dataProva = (anno, mese, giorno, ore, minuti) => naive(new Date(Date.UTC(anno, mese - 1, giorno, ore, minuti)));
materialeProva.ordini = [
  { id: 98, totale_netto: 50, creato_il: dataProva(2026, 10, 16, 7, 12), stato: 'in_evasione', consegnato_il: null, distributor_id: 2, costo_consegna: 10, contributo_raee: 0, iva: 14.3, totale_finale: 55, distributore_nome: 'BOREA SRL', pagamento_importo: 18.3 },
  { id: 97, totale_netto: 100, creato_il: dataProva(2026, 10, 15, 17, 15), stato: 'evaso', consegnato_il: dataProva(2026, 10, 15, 20, 0), distributor_id: 2, costo_consegna: 10, contributo_raee: 2, iva: 26.84, totale_finale: 110, distributore_nome: 'BOREA SRL', pagamento_importo: 148.84 },
  { id: 91, totale_netto: 70.5, creato_il: dataProva(2026, 10, 14, 20, 29), stato: 'evaso', consegnato_il: dataProva(2026, 10, 14, 22, 0), distributor_id: 2, costo_consegna: 10, contributo_raee: 0, iva: 19.26, totale_finale: 77.55, distributore_nome: 'BOREA SRL', pagamento_importo: 20.8 },
  { id: 30, totale_netto: 300, creato_il: dataProva(2026, 9, 12, 8, 0), stato: 'evaso', consegnato_il: dataProva(2026, 9, 12, 12, 0), distributor_id: 2, costo_consegna: 10, contributo_raee: 0, iva: 74.8, totale_finale: 330, distributore_nome: 'BOREA SRL', pagamento_importo: null },
];
materialeProva.righe = [
  { order_id: 98, product_id: 1, codice_snapshot: 'C98', nome_snapshot: 'Valvola Deviatrice 3vie Per Easy', quantita: 1, prezzo_netto_unitario: 50, subtotale: 50, subtotale_cliente: 55, raee_unitario: 0, raee_riga: 0 },
  { order_id: 97, product_id: 2, codice_snapshot: 'C97', nome_snapshot: '87 Elemento A "t" 87gr Diam. 100', quantita: 1, prezzo_netto_unitario: 100, subtotale: 100, subtotale_cliente: 110, raee_unitario: 2, raee_riga: 2 },
  { order_id: 91, product_id: 3, codice_snapshot: 'C91A', nome_snapshot: 'Bocchettone A 90° Sanpress', quantita: 2, prezzo_netto_unitario: 30, subtotale: 60, subtotale_cliente: 66, raee_unitario: 0, raee_riga: 0 },
  { order_id: 91, product_id: 4, codice_snapshot: 'C91B', nome_snapshot: 'Raccordo a T', quantita: 1, prezzo_netto_unitario: 10.5, subtotale: 10.5, subtotale_cliente: 11.55, raee_unitario: 0, raee_riga: 0 },
  { order_id: 30, product_id: 2, codice_snapshot: 'C97', nome_snapshot: '87 Elemento A "t" 87gr Diam. 100', quantita: 3, prezzo_netto_unitario: 100, subtotale: 300, subtotale_cliente: 330, raee_unitario: 0, raee_riga: 0 },
];
// richieste chiuse senza ordine: una a ottobre (nessuna risposta), una a settembre (annullata)
materialeProva.richieste = [
  { id: 4, stato: 'nessuna_offerta', creato_il: dataProva(2026, 10, 13, 9, 0) },
  { id: 2, stato: 'annullata', creato_il: dataProva(2026, 9, 25, 8, 0) },
];

function eseguiMaterialeProva(s, p) {
  if (/FROM orders o LEFT JOIN distributors d ON d\.id = o\.distributor_id LEFT JOIN requests r ON r\.id = o\.request_id WHERE o\.cliente_id = \?/.test(s)) {
    const filiale = /AND o\.distributor_id = \?/.test(s) ? p[1] : null;
    materialeProva.chiamate.push({ cliente: p[0], filiale });
    return materialeProva.ordini.filter((o) => filiale === null || o.distributor_id === filiale);
  }
  if (/FROM order_items WHERE order_id = ANY/.test(s)) return materialeProva.righe.filter((r) => p[0].includes(r.order_id));
  if (/FROM requests WHERE cliente_id = \? AND order_id IS NULL AND stato IN/.test(s)) return materialeProva.richieste;
  return undefined;
}

const banco = { attivo: false, decisioni: [] };

// Clienti del banco (filiale 2): uno da verificare, due approvati (uno senza codice e senza ordini, uno con poche
// informazioni) e uno rifiutato. `utentiClienti` sono le righe di users, `legamiClienti` quelle di client_distributors.
const iscritto = naive(new Date(Date.UTC(2026, 8, 8, 17, 9)));
const utentiClienti = {
  31: { id: 31, ruolo: 'cliente', ragione_sociale: 'Agenzia xxx', partita_iva: '00000000000', codice_fiscale: '00000000000', sdi_pec: 'N92glon', tipo_soggetto: 'ditta_individuale', referente: 'Fra', indirizzo: 'Pio 21', cap: '16100', citta: 'Genova', provincia: 'GE', indirizzo_consegna: 'Via Puggia 22/3, 16131 Genova (GE)', telefono: '010 123 456', email: 'fra@example.com' },
  32: { id: 32, ruolo: 'cliente', ragione_sociale: 'Rossi <b>Impianti</b> S.r.l.', partita_iva: '12345678901', codice_fiscale: null, sdi_pec: null, tipo_soggetto: 'impresa', referente: null, indirizzo: 'Via Roma 1', cap: '16121', citta: 'GENOVA', provincia: 'GE', indirizzo_consegna: null, telefono: '', email: 'rossi@example.com' },
  33: { id: 33, ruolo: 'cliente', ragione_sociale: 'Bianchi Idraulica S.n.c.', partita_iva: '10987654321', codice_fiscale: null, sdi_pec: null, tipo_soggetto: 'impresa', referente: 'Anna', indirizzo: 'Via Dante 5', cap: '16100', citta: 'Genova', provincia: 'GE', indirizzo_consegna: null, telefono: '333 111 2222', email: '' },
  34: { id: 34, ruolo: 'cliente', ragione_sociale: 'Neri Impianti', partita_iva: '11122233344', codice_fiscale: null, sdi_pec: null, tipo_soggetto: 'ditta_individuale', referente: 'Luca', indirizzo: 'Via Neri 9', cap: '16100', citta: 'Savona', provincia: 'SV', indirizzo_consegna: null, telefono: '', email: '' },
};
const legamiClienti = {
  31: { id: 131, distributor_id: 2, cliente_id: 31, stato: 'in_attesa', codice_cliente: null, note: null, richiesto_il: iscritto, deciso_il: null },
  32: { id: 132, distributor_id: 2, cliente_id: 32, stato: 'approvato', codice_cliente: 'DEMO-ROSSI', note: 'Paga a 30 giorni', richiesto_il: iscritto, deciso_il: naive(new Date(Date.UTC(2026, 8, 9, 8, 30))) },
  33: { id: 133, distributor_id: 2, cliente_id: 33, stato: 'approvato', codice_cliente: null, note: null, richiesto_il: iscritto, deciso_il: null },
  34: { id: 134, distributor_id: 2, cliente_id: 34, stato: 'rifiutato', codice_cliente: null, note: 'Mai visto', richiesto_il: iscritto, deciso_il: naive(new Date(Date.UTC(2026, 8, 9, 8, 30))) },
};
const ultimiOrdini = { 32: naive(new Date(Date.UTC(2026, 9, 10, 12, 0))) };
// L'elenco esce dalla query come la restituirebbe il DB, qui volutamente non in ordine di ragione sociale.
const elencoClienti = () => [34, 32, 33, 31].map((id) => ({ ...utentiClienti[id], ...legamiClienti[id], cliente_id: id, ultimo_ordine: ultimiOrdini[id] || null }));

const utenteBanco = {
  id: 9, ruolo: 'distributore', username: 'banco', ragione_sociale: 'Borea Fegino', zona: 'Genova', distributor_id: 2, attivo: 1,
  password_hash: bcrypt.hashSync('password-di-prova', 4),
};
const distributoreBanco = { id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', zona: 'Genova', attivo: 1 };
const richiesteBanco = [
  { id: 11, cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', esito: 'in_attesa', secondi: 447, secondi_da_risposta: null },
  { id: 12, cliente_nome: 'Bianchi Termoidraulica', esito: 'in_attesa', secondi: 95, secondi_da_risposta: null },
  { id: 21, cliente_nome: 'Verdi S.n.c.', esito: 'confermato', secondi: 300, secondi_da_risposta: 190 },
];
const righeRichiesteBanco = {
  11: [{ quantita: 2, nome: 'Bocchettone A 90°', codice: '12352992' }, { quantita: 1, nome: 'Valvola Deviatrice 3vie', codice: '10880380' }],
  12: [{ quantita: 1, nome: 'Valvola Deviatrice 3vie', codice: '10880380' }],
  21: [{ quantita: 1, nome: 'Adattatore Ø80/100mm', codice: '12514597' }],
};
const ordiniBanco = [
  { id: 1280, request_id: 177, cliente_nome: 'Rossi Impianti S.r.l.', corriere_nome: 'Marco', corriere_arrivo_il: new Date(Date.now() + 8 * 60000), secondi_arrivo: 480 },
  { id: 1281, cliente_nome: 'Neri Impianti', corriere_nome: '', corriere_arrivo_il: null, secondi_arrivo: null },
];

// Storico ordini del banco (filiale 2): quattro ordini in due giorni, uno "consegnato" pur essendo rimasto 'inviato'. Si tengono
// SQL e parametri delle query viste (`viste`), per controllare i filtri; i conteggi e le righe sono quelli che il DB darebbe.
const storicoBanco = {
  viste: [],
  assoluto: true, // false = il banco ha ordini (solo che i filtri non ne trovano): cambia il messaggio dello stato vuoto
  conteggi: { tutti: 4, da_preparare: 1, in_preparazione: 1, partiti: 1, consegnati: 1 },
  righe: [
    { id: 91, creato_il: fa(5000), stato: 'inviato', consegnato_il: null, totale_finale: 100.43, totale_ivato: 122.53, ddt_numero: null, cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', cliente_citta: 'Genova' },
    { id: 90, creato_il: fa(6000), stato: 'in_evasione', consegnato_il: null, totale_finale: 54, totale_ivato: 0, ddt_numero: null, cliente_nome: 'Termoidraulica Verdi S.r.l.', cliente_citta: null },
    { id: 89, creato_il: new Date(2025, 2, 12, 10, 40), stato: 'evaso', consegnato_il: null, totale_finale: 80, totale_ivato: 97.6, ddt_numero: 'A/89', cliente_nome: 'Idraulica Bianchi S.n.c.', cliente_citta: 'Savona' },
    { id: 88, creato_il: new Date(2025, 2, 12, 9, 18), stato: 'inviato', consegnato_il: new Date(2025, 2, 12, 14, 0), totale_finale: 66.9, totale_ivato: 66.9, ddt_numero: null, cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', cliente_citta: 'Genova' },
  ],
  materiale: {
    91: [{ quantita: 1, nome_snapshot: '87 Elemento A "t" 87gr Diam. 100' }],
    90: [{ quantita: 2, nome_snapshot: 'Bocchettone A 90°' }, { quantita: 1, nome_snapshot: 'Valvola Deviatrice 3vie' }],
    89: [{ quantita: 4, nome_snapshot: 'Sifone doccia' }, { quantita: 1, nome_snapshot: 'Raccordo a T' }, { quantita: 1, nome_snapshot: 'Valvola a sfera' }],
    88: [],
  },
};

// Ordini che "Preparato" può prendere in carico (POST .../preparazione) e le scritture viste su orders.
const ordiniDelBanco = {
  1280: { id: 1280, cliente_id: 1, distributor_id: 2, stato: 'inviato', request_id: 177, creato_il: fa(60000), consegnato_il: null },
  1285: { id: 1285, cliente_id: 1, distributor_id: 2, stato: 'in_evasione', request_id: null, creato_il: fa(60000), consegnato_il: null },
  1290: { id: 1290, cliente_id: 1, distributor_id: 181, stato: 'inviato', request_id: null, creato_il: fa(60000), consegnato_il: null },
};
const scrittureOrdini = [];

function eseguiBanco(s, p, modo) {
  if (/^SELECT \* FROM orders WHERE id = \?/.test(s)) return ordiniDelBanco[p[0]] || null;
  if (/^UPDATE orders SET stato = 'in_evasione'/.test(s)) { scrittureOrdini.push({ s, p }); return { changes: 1 }; }
  if (/COUNT\(\*\) AS tutti,/.test(s)) { storicoBanco.viste.push({ tipo: 'conteggi', s, p }); return storicoBanco.conteggi; }
  if (/^SELECT o\.id, o\.creato_il, o\.stato, o\.consegnato_il/.test(s)) { storicoBanco.viste.push({ tipo: 'lista', s, p }); return storicoBanco.righe; }
  if (/^SELECT order_id, quantita, nome_snapshot FROM order_items WHERE order_id = ANY/.test(s)) {
    storicoBanco.viste.push({ tipo: 'materiale', s, p });
    return (p[0] || []).flatMap((id) => (storicoBanco.materiale[id] || []).map((r) => ({ order_id: id, ...r })));
  }
  if (/^SELECT id FROM orders WHERE distributor_id = \? LIMIT 1/.test(s)) return storicoBanco.assoluto ? null : { id: 1 };
  if (/FROM users WHERE username/.test(s)) return p[0] === 'banco' ? utenteBanco : undefined;
  if (/^SELECT nome, filiale FROM distributors WHERE id = \?/.test(s)) return { nome: distributoreBanco.nome, filiale: distributoreBanco.filiale };
  if (/COUNT\(\*\) FILTER \(WHERE stato = 'inviato'\) AS da_preparare/.test(s)) return { da_preparare: 2, in_preparazione: 0, ultimo: 1281 };
  if (/COUNT\(\*\) FILTER \(WHERE rr\.esito = 'in_attesa'/.test(s)) return { n: 2, ultima: 12, attesa_corriere: 1 };
  if (/FROM client_distributors WHERE distributor_id = \? AND stato = 'in_attesa'/.test(s)) return { n: 2 };
  if (/FROM client_distributors cd JOIN users u ON u\.id = cd\.cliente_id/.test(s)) return elencoClienti();
  if (/^SELECT \* FROM users WHERE id = \? AND ruolo = 'cliente'/.test(s)) return utentiClienti[p[0]] || null;
  if (/^SELECT \* FROM client_distributors WHERE distributor_id = \? AND cliente_id = \?/.test(s)) return legamiClienti[p[1]] || null;
  if (/^UPDATE client_distributors SET stato = \?/.test(s)) { banco.decisioni.push(p); return { changes: 1 }; }
  if (/^SELECT nome FROM distributors WHERE id = \?/.test(s)) return { nome: distributoreBanco.nome };
  if (/FROM request_responses rr JOIN requests r ON r\.id = rr\.request_id JOIN users u/.test(s)) return richiesteBanco;
  if (/FROM orders o JOIN users u ON u\.id = o\.cliente_id WHERE o\.distributor_id/.test(s)) return ordiniBanco;
  if (/FROM request_items ri JOIN products p/.test(s)) return p.flatMap((id) => (righeRichiesteBanco[id] || []).map((x) => ({ request_id: id, ...x })));
  if (/FROM order_items WHERE order_id = ANY/.test(s)) {
    return (p[0] || []).map((id) => ({ order_id: id, codice: '12514597', nome: 'Adattatore Ø80/100mm', quantita: 1 }));
  }
  return undefined;
}

// Pagamenti Stripe (stripe_pagamenti): solo le istruzioni che le rotte del sito usano prima del pagamento.
const stripeRighe = [];
function eseguiStripe(s, p) {
  if (/^INSERT INTO stripe_pagamenti/.test(s)) {
    const [cliente_id, tipo, modoRiga, importo_cent, righeJson, destinazione, note, request_id] = p;
    stripeRighe.push({ id: stripeRighe.length + 1, cliente_id, tipo, modo: modoRiga, stato: 'da_pagare', payment_intent_id: null, importo_cent, righe: righeJson, destinazione, note, request_id, motivo: null, eta_sec: 0 });
    return { changes: 1, lastInsertRowid: stripeRighe.length };
  }
  if (/^UPDATE stripe_pagamenti SET payment_intent_id = \?/.test(s)) {
    stripeRighe.find((r) => r.id === Number(p[1])).payment_intent_id = p[0];
    return { changes: 1 };
  }
  if (/FROM stripe_pagamenti WHERE id = \? AND cliente_id = \?/.test(s)) return stripeRighe.find((r) => r.id === Number(p[0]) && r.cliente_id === p[1]) || null;
  if (/FROM stripe_pagamenti WHERE payment_intent_id = \? AND cliente_id = \?/.test(s)) return stripeRighe.find((r) => r.payment_intent_id === p[0] && r.cliente_id === p[1]) || null;
  return undefined;
}

// Dettaglio di una richiesta al banco (filiale 2): la richiesta 177 di "Prova S.r.l." con un articolo da 102,30 di listino
// (prezzo del banco 102,30; con il 10% di servizio erano 112,53). Ogni prova imposta richiesta, risposta e secondi rimasti.
const richiestaProva = {
  attivo: false,
  secondi: 241,
  legame: true,
  ordine: null,
  richiesta: null,
  risposta: null,
  cliente: {
    id: 1, ruolo: 'cliente', ragione_sociale: 'Prova S.r.l.', referente: 'Mario', partita_iva: '01234567890', telefono: '010 123 456',
    indirizzo_consegna: 'Via Puggia 22/3, 16131 Genova (GE)', indirizzo: 'Via Roma 1', cap: '16121', citta: 'Genova', provincia: 'GE',
  },
};
const rigaRichiestaProva = {
  product_id: 1, quantita_richiesta: 1, codice: '12364959', nome: '87 Elemento A "t" 87gr Diam. 100', categoria: 'Raccordi',
  brand_slug: null, famiglia: null, macro_slug: 'idraulica', raee: 0, prezzo_listino: 102.3, sconto_listino_pct: 0,
  quantita_disponibile: null, sconto_riga_pct: null,
};
function eseguiRichiestaProva(s, p) {
  if (/^SELECT \* FROM requests WHERE id = \?/.test(s)) return Number(p[0]) === 177 ? richiestaProva.richiesta : null;
  if (/^SELECT rr\.\*, EXTRACT\(EPOCH FROM \(NOW\(\) - rr\.risposto_il\)\)::int AS secondi_da_risposta FROM request_responses rr WHERE rr\.request_id = \? AND rr\.distributor_id = \?/.test(s)) return Number(p[0]) === 177 ? richiestaProva.risposta : null;
  if (/^SELECT \* FROM request_responses WHERE request_id = \? AND distributor_id = \?/.test(s)) return Number(p[0]) === 177 ? richiestaProva.risposta : null;
  if (/EXTRACT\(EPOCH FROM \(\?::timestamp - NOW\(\)\)\)/.test(s)) return { s: richiestaProva.secondi };
  if (/^SELECT \* FROM users WHERE id = \?/.test(s) && Number(p[0]) === 1) return richiestaProva.cliente;
  if (/^SELECT \* FROM distributors WHERE id = \?/.test(s)) return { id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', zona: 'Genova', attivo: 1 };
  if (/^SELECT o\.\*, EXTRACT\(EPOCH FROM \(o\.corriere_arrivo_il - NOW\(\)\)\)::int AS secondi_arrivo FROM orders o WHERE o\.id = \?/.test(s)) return richiestaProva.ordine;
  if (/^SELECT cliente_id FROM requests WHERE id = \?/.test(s)) return { cliente_id: 1 };
  if (/FROM request_items ri JOIN products p ON p\.id = ri\.product_id LEFT JOIN distributor_products dp/.test(s)) return [rigaRichiestaProva];
  if (/^SELECT \* FROM client_distributors WHERE distributor_id = \? AND cliente_id = \?/.test(s)) return richiestaProva.legame ? { id: 1, stato: 'approvato' } : null;
  return undefined;
}

function esegui(sql, p, modo) {
  const s = sql.replace(/\s+/g, ' ');
  registro.push(s.slice(0, 90));
  if (/stripe_pagamenti/.test(s)) {
    const r = eseguiStripe(s, p);
    if (r !== undefined) return r;
  }
  if (richiestaProva.attivo) {
    const r = eseguiRichiestaProva(s, p);
    if (r !== undefined) return modo === 'all' ? (Array.isArray(r) ? r : []) : Array.isArray(r) ? r[0] : r;
  }
  if (ordiniProva.attivo) {
    const r = eseguiOrdineProva(s, p, modo);
    if (r !== undefined) return modo === 'all' ? (Array.isArray(r) ? r : []) : Array.isArray(r) ? r[0] : r;
  }
  if (materialeProva.attivo) {
    const r = eseguiMaterialeProva(s, p);
    if (r !== undefined) return modo === 'all' ? r : r[0] || null;
  }
  if (banco.attivo) {
    const r = eseguiBanco(s, p, modo);
    if (r !== undefined) return r;
  }
  if (registrazione.attiva) {
    const r = eseguiRegistrazione(s, p, modo);
    if (r !== undefined) return r;
  }
  if (storico.attivo) {
    const r = eseguiStorico(s, p, modo);
    if (r !== undefined) return modo === 'all' ? (Array.isArray(r) ? r : []) : Array.isArray(r) ? r[0] : r;
  }
  if (/^DELETE FROM session WHERE sid/.test(s)) { sessioni.delete(p[0]); return { changes: 1 }; }
  if (/^SELECT sess FROM session WHERE sid/.test(s)) { const r = sessioni.get(p[0]); return modo === 'get' ? (r ? { sess: JSON.parse(r.sess) } : null) : []; }
  if (/INSERT INTO session/.test(s)) { sessioni.set(p[0], { sess: p[1], expire: p[2] }); return { changes: 1 }; }
  if (/UPDATE session SET expire/.test(s)) return { changes: 1 };
  if (/DELETE FROM session WHERE expire/.test(s)) return { changes: 0 };
  if (/COUNT\(\*\) n FROM products/.test(s)) return { n: 1 }; // catalogo "non vuoto": niente seed automatico
  if (/FROM config WHERE chiave/.test(s)) return config[p[0]] !== undefined ? { valore: config[p[0]] } : null;
  if (/FROM users WHERE username/.test(s)) return p[0] === 'prova' ? utente : null;
  if (/FROM users WHERE id/.test(s)) return modo === 'get' ? utente : [];
  if (/FROM products WHERE attivo = 1 AND id IN/.test(s)) return p.map((id) => catalogo[id]).filter(Boolean);
  if (/FROM products WHERE attivo = 1 AND id = ANY/.test(s)) return (p[0] || []).filter((id) => catalogo[id]).map((id) => ({ id }));
  if (/SELECT id FROM products WHERE id = \? AND attivo = 1/.test(s)) return catalogo[p[0]] ? { id: p[0] } : null;
  // "Un invio, una richiesta": la chiave 'chiave-esistente-1' è quella di un invio che ha già dato la richiesta 321.
  if (/SELECT id, stato FROM requests WHERE cliente_id = \? AND chiave_invio = \?/.test(s)) {
    return p[1] === 'chiave-esistente-1' ? { id: 321, stato: 'in_attesa' } : null;
  }
  if (/FROM macro_categorie m/.test(s)) return [{ slug: 'idraulica', nome: 'Idraulica', in_evidenza: 1, n_prodotti: 2 }, { slug: 'scarichi', nome: 'Scarichi', in_evidenza: 0, n_prodotti: 1 }];
  if (/COUNT\(\*\) AS n FROM products WHERE attivo = 1 AND foto_url/.test(s)) return { n: 0 };
  if (/COUNT\(\*\)/.test(s)) return modo === 'get' ? { n: 0 } : [];
  return modo === 'all' ? [] : modo === 'get' ? null : { changes: 0, lastInsertRowid: null };
}
const dbFinto = {
  prepare: (sql) => ({ get: async (...p) => esegui(sql, p, 'get'), all: async (...p) => esegui(sql, p, 'all'), run: async (...p) => esegui(sql, p, 'run') }),
  exec: async () => {}, ensureInit: async () => {}, mantieniCalde() {}, transaction: (fn) => (...a) => fn(...a),
  query: async () => ({ rows: [] }), pool: {},
};

// ---------------- avvio del server vero ----------------
process.env.PORT = String(PORTA);
process.env.SESSION_SECRET = 'segreto-di-prova';
delete process.env.WHATSAPP_ATTIVO;
const percorsoDb = require.resolve(path.join(radice, 'db/index.js'));
require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

// Le prove non dipendono dal .env vero (che server.js carica con dotenv, senza sovrascrivere le variabili già definite):
// chiavi Stripe e indirizzo del sito vuoti = spenti, come su un PC senza configurazione.
for (const nome of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_WEBHOOK_SECRET', 'APP_URL', 'APPROVAZIONE_AUTOMATICA', 'DISTRIBUTORE_PREDEFINITO', 'PAGAMENTO_SIMULATO', 'PAGAMENTO_SIMULATO_FORZA', 'FINESTRA_CONFERMA_SEC']) {
  process.env[nome] = '';
}
process.env.HOST = '127.0.0.1'; // il .env del PC può avere 0.0.0.0 (telefono sulla stessa rete): le prove restano sul computer

const consoleOriginale = { log: console.log, warn: console.warn, error: console.error };
const erroriServer = [];
console.log = () => {};
console.warn = () => {};
console.error = (...a) => erroriServer.push(a.map(String).join(' ').slice(0, 200));
require(path.join(radice, 'server.js'));

const base = 'http://127.0.0.1:' + PORTA;
let cookie = '';
async function chiedi(percorso, opzioni = {}) {
  const r = await fetch(base + percorso, { redirect: 'manual', ...opzioni, headers: { ...(cookie ? { cookie } : {}), ...(opzioni.headers || {}) } });
  const nuovo = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (nuovo.length) cookie = nuovo.map((c) => c.split(';')[0]).join('; ');
  return r;
}
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const json = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

test.before(async () => {
  // Una guardia in più: se per qualunque motivo il DB finto non fosse quello in uso, meglio fermarsi.
  assert.equal(require.cache[percorsoDb].exports, dbFinto, 'il DB deve essere quello finto');
  await new Promise((r) => setTimeout(r, 800)); // il server parte
});

test.after(() => {
  Object.assign(console, consoleOriginale);
  // Il server continua ad ascoltare: si esce a mano, node:test non lo farebbe da solo.
  setTimeout(() => process.exit(process.exitCode || 0), 100).unref();
});

test('login: pagina con icone, manifest e intestazioni di sicurezza', async () => {
  const r = await chiedi('/login');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /rel="manifest"/);
  assert.match(t, /icona-192\.png/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.match(r.headers.get('cache-control'), /no-cache/);
});

test('accedi: testata, pillola, campi con occhio; senza la vecchia nota sui distributori', async () => {
  const t = await (await chiedi('/login')).text();
  assert.match(t, /Il pezzo che ti manca, in cantiere\./);
  assert.match(t, /acc-occhiello">Ordini Minuteria</);
  assert.match(t, /Chiedi la disponibilità al banco e ricevi il materiale dove lavori\./);
  assert.doesNotMatch(t, /confronta tempi|distributori che indichi|i distributori dovranno/);
  assert.match(t, /<nav class="acc-schede"[^>]*>\s*<a href="\/login" class="attiva"[^>]*>Accedi<\/a>\s*<a href="\/registrati">Registrati<\/a>/);
  assert.match(t, /<input type="text" id="username" name="username"[^>]*placeholder="es\. rossimpianti"[^>]*autocomplete="username"/);
  assert.match(t, /<input type="password" id="password" name="password"[^>]*autocomplete="current-password"/);
  assert.match(t, /data-mostra-password hidden aria-label="Mostra password" aria-pressed="false"/);
  assert.match(t, /Non hai un account\? <a href="\/registrati">Registra la tua impresa<\/a>/);
  // l'errore resta sopra i campi
  const r = await chiedi('/login', form({ username: 'prova', password: 'sbagliata' }));
  const e = await r.text();
  assert.equal(r.status, 401);
  assert.ok(e.indexOf('Credenziali non valide.') < e.indexOf('<form'), 'errore sopra il modulo');
});

test('asset versionati: ?v=<data di modifica> con cache lunga, senza ?v solo ETag', async () => {
  const t = await (await chiedi('/login')).text();
  const css = t.match(/href="(\/style\.css\?v=\d+)"/);
  assert.ok(css, 'link css versionato');
  const js = t.match(/src="(\/app\.js\?v=\d+)"/);
  assert.ok(js, 'script versionato');
  let r = await chiedi(css[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /max-age=31536000, immutable/);
  r = await chiedi(js[1]);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /immutable/);
  r = await chiedi('/style.css');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.headers.get('cache-control') || '', /immutable/);
  assert.ok(r.headers.get('etag'));
  // un file che non è nell'elenco non prende la cache lunga, nemmeno con ?v=
  r = await chiedi('/manifest.webmanifest?v=1');
  assert.doesNotMatch(r.headers.get('cache-control') || '', /immutable/);

  // la versione segue la data di modifica del file (si rilegge al massimo ogni 5 secondi)
  const file = path.join(radice, 'public', 'style.css');
  const originale = fs.statSync(file);
  fs.utimesSync(file, originale.atime, new Date(originale.mtimeMs + 60000));
  try {
    await new Promise((x) => setTimeout(x, 5200));
    const t2 = await (await chiedi('/login')).text();
    assert.notEqual(t2.match(/href="(\/style\.css\?v=\d+)"/)[1], css[1], 'la versione cambia con il file');
  } finally {
    fs.utimesSync(file, originale.atime, originale.mtime);
  }
});

test('file statici della PWA: favicon, manifest, service worker, icone', async () => {
  let r = await chiedi('/favicon.ico');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);
  r = await chiedi('/manifest.webmanifest');
  assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.length >= 3);
  r = await chiedi('/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  assert.match(await r.text(), /notificationclick/);
  for (const i of m.icons) assert.equal((await chiedi(i.src)).status, 200, i.src);
  assert.equal((await chiedi('/icons/apple-touch-icon.png')).status, 200);
});

test('percorso inesistente: 404 con pagina, /api: 404 JSON', async () => {
  let r = await chiedi('/non-esiste');
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Pagina non trovata/);
  r = await chiedi('/api/non-esiste');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /json/);
  assert.equal((await r.json()).ok, false);
});

test('id non numerico: 404 e nessuna query al DB', async () => {
  const prima = registro.length;
  assert.equal((await chiedi('/ordini/abc')).status, 404);
  assert.equal((await chiedi('/richieste/1e3')).status, 404);
  assert.equal((await chiedi('/ddt/99999999999')).status, 404);
  assert.ok(!registro.slice(prima).some((q) => /FROM orders|FROM requests WHERE id/.test(q)), 'nessuna query con un id non valido');
});

test('API senza sessione: 401 JSON (non un redirect HTML)', async () => {
  for (const [metodo, percorso] of [['GET', '/api/carrello'], ['POST', '/api/carrello/imposta'], ['GET', '/api/cerca?q=ab'], ['GET', '/api/notifiche/push'], ['GET', '/api/distributore/novita']]) {
    const r = await chiedi(percorso, { method: metodo });
    assert.equal(r.status, 401, percorso);
    assert.match(r.headers.get('content-type'), /json/);
    assert.equal((await r.json()).ok, false);
  }
});

test('login: password come array o corpo assente non danno errori 500', async () => {
  let r = await chiedi('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=prova&password[]=a&password[]=b' });
  assert.equal(r.status, 401);
  r = await chiedi('/login', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('login: credenziali sbagliate o utente inesistente -> 401', async () => {
  let r = await chiedi('/login', form({ username: 'prova', password: 'sbagliata' }));
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Credenziali non valide/);
  r = await chiedi('/login', form({ username: 'nessuno', password: 'x' }));
  assert.equal(r.status, 401);
});

test('login: credenziali giuste -> sessione, redirect, cookie HttpOnly', async () => {
  cookie = '';
  const r = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const impostati = r.headers.getSetCookie().join(' ');
  assert.match(impostati, /HttpOnly/i);
  assert.match(impostati, /SameSite=Lax/i);
  assert.ok(cookie, 'cookie ricevuto');
  assert.equal((await chiedi('/')).headers.get('location'), '/home');
});

test('home cliente: pagina completa', async () => {
  const r = await chiedi('/home');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Cosa ti serve/);
  assert.match(t, /Idraulica/);
});

test('query ripetuta (?q=a&q=b) e filtri come array: niente 500', async () => {
  assert.equal((await chiedi('/cerca?q=a&q=b')).status, 200);
  assert.equal((await chiedi('/cerca?q=valvola&diametro=1&diametro=2&materiale=x&materiale=y')).status, 200);
  assert.equal((await chiedi('/api/cerca?q=ab&q=cd')).status, 200);
  assert.notEqual((await chiedi('/categoria/idraulica?p=99999999999999999999&sotto=a&sotto=b')).status, 500);
});

test('carrello: imposta, tetto sulla quantità, id non valido o inesistente', async () => {
  let r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 5 }));
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.pezzi, 5);
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 99999999999 }));
  d = await r.json();
  assert.equal(d.carrello['1'], 9999);
  assert.equal(d.pezzi, 9999);
  r = await chiedi('/api/carrello/imposta', json({ id: 'abc', qty: 3 }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
  r = await chiedi('/api/carrello/imposta', json({ id: 999, qty: 3 }));
  assert.equal(r.status, 404);
  r = await chiedi('/api/carrello');
  d = await r.json();
  assert.deepEqual(Object.keys(d.carrello), ['1']);
  assert.equal(d.pezzi, 9999, "l'id inventato non resta nel carrello");
  r = await chiedi('/api/carrello/imposta', json({ id: 1, qty: 0 }));
  assert.equal((await r.json()).pezzi, 0);
});

test('carrello: aggiungi e batch con valori strani', async () => {
  let r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 3 }));
  let d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.prodottoQty, 3);
  r = await chiedi('/api/carrello/aggiungi', json({ id: 2, qty: 99999 }));
  assert.equal((await r.json()).prodottoQty, 9999);
  assert.equal((await chiedi('/api/carrello/aggiungi', json({ id: 'x', qty: 1 }))).status, 400);
  r = await chiedi('/api/carrello/aggiungi-batch', json({ items: [null, 5, 'a', { id: 1, qty: 2 }, { id: 'zz', qty: 1 }, { id: 999, qty: 1 }] }));
  d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(d.aggiornati), ['1']);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({ items: 'niente' }))).status, 400);
  assert.equal((await chiedi('/api/carrello/aggiungi-batch', json({}))).status, 400);
});

test('carrello: pagina con articoli e totali', async () => {
  const r = await chiedi('/carrello');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /Valvola a sfera/);
  assert.match(t, /max="9999"/);
});

test('carrello: "Cosa paghi e a chi" — Consegna in cantiere (ORA, in app) e Materiale (DOPO a BOREA), a prezzo del banco: i numeri della specifica', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));
  await chiedi('/api/carrello/imposta', json({ id: 4, qty: 1 }));
  const t = await (await chiedi('/carrello')).text();
  const riep = (chiave) => [...t.matchAll(new RegExp('data-riep="' + chiave + '">([^<]*)<', 'g'))].map((m) => m[1]);

  // le righe mostrano il PREZZO DEL BANCO (niente 10%), e il loro totale è netto × quantità
  assert.match(t, /<div class="art-prezzo">€ 54,50 cad\. · IVA esclusa · prezzo del banco<\/div>/);
  assert.match(t, /data-totale-riga="3">€ 54,50</);
  assert.match(t, /data-totale-riga="4">€ 10,00</);
  assert.doesNotMatch(t, /59,95|11,00/, 'il prezzo col 10% non si vede più');

  // A) la paghi ora: corriere 10,00 + servizio 6,45 (10% di 64,50) + IVA 3,62 (22% di 16,45) = 20,07
  assert.match(t, /<section class="cp-riquadro cp-ora"/);
  assert.match(t, /<span class="cp-badge cp-badge-ora">Paghi ora<\/span>/);
  assert.match(t, /Il nostro servizio: lo addebitiamo quando premi "Paga e invia richiesta"./);
  assert.deepEqual(riep('app_corriere'), ['10,00']);
  assert.deepEqual(riep('app_servizio'), ['6,45']);
  assert.deepEqual(riep('app_imponibile'), ['16,45']);
  assert.deepEqual(riep('app_iva'), ['3,62']);
  assert.deepEqual(riep('app_totale'), ['20,07', '20,07'], 'nel riquadro e nella barra');
  assert.match(t, /Servizio<\/span> <span class="cp-sp">· <span data-riep="servizio_pct">10<\/span>% della merce \(€ <span data-riep="banco_merce">64,50<\/span>\)/);
  assert.match(t, /IVA <span data-riep="iva_pct">22<\/span>%<\/span> <span class="cp-sp">· su € <span data-riep="app_imponibile">16,45<\/span>/);

  // B) la paghi dopo a BOREA: merce 64,50 (= somma delle righe) + IVA 14,19 = 78,69; nessun RAEE
  assert.match(t, /<span class="cp-badge cp-badge-dopo">Paghi dopo (a [^<]+|al banco)<\/span>/);
  assert.match(t, /Non lo paghi ora: te lo fattura [^<]+\./);
  assert.deepEqual(riep('banco_merce'), ['64,50', '64,50']);
  assert.deepEqual(riep('articoli'), ['2 articoli']);
  assert.deepEqual(riep('banco_imponibile'), ['64,50']);
  assert.deepEqual(riep('banco_iva'), ['14,19']);
  assert.deepEqual(riep('banco_totale'), ['78,69']);
  assert.match(t, /<div class="cp-riga" data-riga-raee hidden>/, 'senza RAEE la riga c\'è ma è nascosta');
  // C) spesa complessiva = i due totali
  assert.deepEqual(riep('spesa'), ['98,76']);
  assert.equal(Math.round((20.07 + 78.69) * 100) / 100, 98.76);
  // la barra: "Paghi ora · consegna" e l'importo addebitato
  assert.match(t, /<span class="bp-label">Paghi ora · consegna<\/span>\s*<span class="bp-importo">€ <span data-riep="app_totale">20,07<\/span>/);
  assert.match(t, /<span>Se nessun banco accetta, ti rimborsiamo<\/span>/);
  // ordine minimo: 64,50 di merce ≥ 33
  assert.match(t, /data-minimo-avviso hidden>/);
  assert.doesNotMatch(t, /data-btn-paga disabled/);
  // niente più il vecchio riepilogo
  assert.doesNotMatch(t, /Materiale, da pagare al banco|Paghi ora in app|riepilogo-card/);
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello: l\'articolo con RAEE — il contributo sta solo nel Materiale (con la sua IVA), mai nella consegna', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 5, qty: 2 }));
  const t = await (await chiedi('/carrello')).text();
  const riep = (chiave) => [...t.matchAll(new RegExp('data-riep="' + chiave + '">([^<]*)<', 'g'))].map((m) => m[1]);
  // merce 200,00 (2 × 100) + RAEE 5,00 = 205,00 → IVA 45,10 → materiale 250,10
  assert.match(t, /<div class="cp-riga" data-riga-raee><dt><span class="cp-et">Contributo RAEE<\/span><\/dt><dd>€ <span data-riep="banco_raee">5,00<\/span>/);
  assert.deepEqual(riep('banco_merce'), ['200,00', '200,00']);
  assert.deepEqual(riep('banco_imponibile'), ['205,00']);
  assert.deepEqual(riep('banco_iva'), ['45,10']);
  assert.deepEqual(riep('banco_totale'), ['250,10']);
  // in app: corriere 10 + servizio 20 (10% di 200, senza RAEE) = 30 → IVA 6,60 → 36,60
  assert.deepEqual(riep('app_servizio'), ['20,00']);
  assert.deepEqual(riep('app_imponibile'), ['30,00']);
  assert.deepEqual(riep('app_totale'), ['36,60', '36,60']);
  assert.deepEqual(riep('spesa'), ['286,70']); // 36,60 + 250,10
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello: l\'ordine minimo si misura sul prezzo del banco (non su quello col servizio)', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  // 8 × 4,00 = 32,00 di merce a prezzo del banco: sotto il minimo di 33 (col 10% sarebbero 35,20: sopra)
  await chiedi('/api/carrello/imposta', json({ id: 2, qty: 8 }));
  let t = await (await chiedi('/carrello')).text();
  assert.match(t, /data-minimo-avviso>\s*<strong>Ordine minimo € 33,00<\/strong>[\s\S]*?Ti mancano <strong>€ <span data-riep="manca">1,00<\/span>/);
  assert.match(t, /data-btn-paga disabled/);
  // 9 × 4,00 = 36,00: raggiunto
  await chiedi('/api/carrello/imposta', json({ id: 2, qty: 9 }));
  t = await (await chiedi('/carrello')).text();
  assert.match(t, /data-minimo-avviso hidden>/);
  assert.doesNotMatch(t, /data-btn-paga disabled/);
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('carrello dal vivo: /api/carrello/imposta restituisce tutte le voci già pronte (stesse chiavi della pagina) e i totali di riga', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 3, qty: 1 }));
  await chiedi('/api/carrello/imposta', json({ id: 4, qty: 1 }));
  const r = await (await chiedi('/api/carrello/imposta', json({ id: 3, qty: 2 }))).json();
  assert.equal(r.ok, true);
  // merce 119,00 (109 + 10): servizio 11,90; app 10 + 11,90 = 21,90 + IVA 4,82 = 26,72; materiale 119 + IVA 26,18 = 145,18; spesa 171,90
  assert.deepEqual(
    [r.riepilogo.banco_merce, r.riepilogo.app_servizio, r.riepilogo.app_imponibile, r.riepilogo.app_iva, r.riepilogo.app_totale, r.riepilogo.banco_iva, r.riepilogo.banco_totale, r.riepilogo.spesa],
    ['119,00', '11,90', '21,90', '4,82', '26,72', '26,18', '145,18', '171,90']
  );
  assert.deepEqual([r.riepilogo.articoli, r.riepilogo.con_raee, r.riepilogo.raggiunto, r.riepilogo.manca], ['2 articoli', false, true, '0,00']);
  assert.deepEqual(r.totali_righe, { 3: '109,00', 4: '10,00' });
  assert.equal(r.totali.da_pagare_app, 26.72, 'l\'addebito è proprio app.totale');
  assert.equal(r.totali.materiale_banco, 145.18);
  assert.equal(r.totali.totale_ivato, 171.9);
  assert.equal(r.pezzi, 3);
  // la pagina ricaricata dice le stesse cose: le voci sono le stesse, scritte dalla stessa funzione
  const t = await (await chiedi('/carrello')).text();
  for (const chiave of ['app_totale', 'banco_totale', 'spesa', 'app_iva', 'banco_iva', 'banco_merce']) {
    assert.equal((t.match(new RegExp('data-riep="' + chiave + '">([^<]*)<')) || [])[1], r.riepilogo[chiave], chiave);
  }
  assert.match(t, /data-totale-riga="3">€ 109,00</);
  // tolta una riga (quantità 0) la risposta ha comunque i totali di quelle che restano
  const senza = await (await chiedi('/api/carrello/imposta', json({ id: 4, qty: 0 }))).json();
  assert.equal(senza.righe, 1);
  assert.equal(senza.riepilogo.banco_merce, '109,00');
  await chiedi('/carrello/svuota', { method: 'POST' });
});

test('menu del profilo (cliente): niente voce "Notifiche"', async () => {
  const t = await (await chiedi('/home')).text();
  assert.match(t, /La mia anagrafica/);
  assert.match(t, /Storico ordini/);
  assert.doesNotMatch(t, /href="\/notifiche"/);
});

// ---------------- Storico ordini: il materiale e quanto si deve a BOREA (src/materiale.js) ----------------

const pagina = async (percorso) => {
  const r = await chiedi(percorso);
  assert.equal(r.status, 200, percorso);
  return r.text();
};
// Il totale mostrato nel riquadro blu ("€ 271,45") di una pagina.
const totaleRiquadro = (t) => (t.match(/<span class="sm-importo">€ ([\d.,]+)<\/span>/) || [])[1];

test('storico: riquadro "Da pagare a BOREA SRL", chip dei mesi, servizio fuori dal totale, un ordine aperto solo il primo', async () => {
  cookie = '';
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  materialeProva.attivo = true;
  try {
    const t = await pagina('/storico?mese=2026-10');
    assert.match(t, /<title>[^<]*Storico ordini/);
    // a) il riquadro: totale del materiale (61,00 + 124,44 + 86,01), IVA inclusa, numero di ordini, servizio a parte
    assert.match(t, /<div class="sm-occhiello">Da pagare a BOREA SRL<\/div>/);
    assert.equal(totaleRiquadro(t), '271,45');
    assert.match(t, /<span class="sm-iva">IVA inclusa<\/span>/);
    assert.match(t, /Materiale di 3 ordini/);
    assert.match(t, /Servizio già pagato in app: <strong>€ 63,50<\/strong>/);
    assert.doesNotMatch(t, /334,95|€ 271,45 ?\+/, 'il servizio (18,30 + 24,40 + 20,80) NON è dentro il totale');
    assert.match(t, /<a class="sm-esporta" href="\/storico\/materiale\.csv\?mese=2026-10">/);
    // chip: i mesi con attività dal più recente + "Tutto", l'attivo è ottobre
    const chip = [...t.matchAll(/<a class="sm-chip( attivo)?" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[3], !!m[1], m[2]]);
    assert.deepEqual(chip.map((c) => c[0]), ['Ottobre 2026', 'Settembre 2026', 'Tutto']);
    assert.deepEqual(chip.map((c) => c[1]), [true, false, false]);
    assert.equal(chip[1][2], '/storico?mese=2026-09&amp;vista=ordine');
    // b) il selettore: "Per ordine" attivo
    assert.match(t, /<a class="attiva" href="\/storico\?mese=2026-10&amp;vista=ordine" aria-current="page">Per ordine<\/a>\s*<a class="" href="\/storico\?mese=2026-10&amp;vista=articolo">Per articolo<\/a>/);
    // c) tre schede ordine, aperta solo la prima (la più recente, #98)
    assert.equal((t.match(/<details class="sm-ordine"/g) || []).length, 3);
    assert.equal((t.match(/<details class="sm-ordine" open>/g) || []).length, 1);
    assert.ok(t.indexOf('<details class="sm-ordine" open>') < t.indexOf('Ordine #97'), 'la aperta è la prima');
    // chiusa: numero, data, totale IVA inclusa; stato, primo articolo e " +N"
    assert.match(t, /<strong>Ordine #98<\/strong> <span class="sm-data">16 ott, 09:12<\/span>[\s\S]*?<span class="sm-tot">€ 61,00<\/span>/);
    assert.match(t, /<span class="st-stato st-preparazione">In preparazione<\/span>\s*<span class="sm-primo">1× Valvola Deviatrice 3vie Per Easy<\/span>/);
    assert.match(t, /<span class="st-stato st-consegnato">Consegnato<\/span>\s*<span class="sm-primo">2× Bocchettone A 90° Sanpress<\/span>\s*<span class="sm-altri">\+1<\/span>/);
    // aperta: righe con quantità, prezzo cad. IVA inclusa e totale di riga (netto + RAEE) × 1,22, poi il servizio pagato
    assert.match(t, /<span class="sm-qta">1×<\/span>[\s\S]*?87 Elemento A &#34;t&#34; 87gr Diam\. 100[\s\S]*?€ 124,44 cad\.[\s\S]*?<span class="sm-riga-totale">€ 124,44<\/span>/);
    assert.match(t, /Bocchettone A 90° Sanpress<\/div>\s*<div class="sm-riga-sotto">€ 36,60 cad\.<\/div>[\s\S]*?<span class="sm-riga-totale">€ 73,20<\/span>/);
    // il servizio per ordine: l'addebitato quando torna (98, 91), il calcolato quando in app si pagava tutto (97: 148,84 non è un servizio)
    const servizi = [...t.matchAll(/<div class="sm-servizio"><span>Servizio pagato in app<\/span><span>€ ([\d,]+)<\/span><\/div>/g)].map((m) => m[1]);
    assert.deepEqual(servizi, ['18,30', '24,40', '20,80']);
    assert.doesNotMatch(t, /148,84/);
    // Riordina solo sui consegnati (97 e 91), come form fuori dal <summary>; "Dettagli ›" per tutti
    const riordina = [...t.matchAll(/<form class="st-riordina" method="POST" action="\/storico\/(\d+)\/riordina">/g)].map((m) => m[1]);
    assert.deepEqual(riordina.sort(), ['91', '97']);
    assert.doesNotMatch(t, /<summary>(?:(?!<\/summary>)[\s\S])*<form/);
    assert.deepEqual([...t.matchAll(/<a class="sm-dettagli" href="([^"]+)">Dettagli ›<\/a>/g)].map((m) => m[1]), ['/ordini/98', '/ordini/97', '/ordini/91']);
    // le richieste senza ordine: "Nessun costo", e a ottobre solo la 4
    assert.match(t, /<a class="sm-senza" href="\/richieste\/4">\s*<span class="st-stato st-nessuna">Nessuna risposta<\/span>\s*<span class="sm-senza-testo">Richiesta #4 · 13 ott<\/span>\s*<span class="sm-senza-costo">Nessun costo<\/span>/);
    assert.doesNotMatch(t, /Richiesta #2 ·/);
    // niente più "In corso" né le schede del vecchio elenco
    assert.doesNotMatch(t, />In corso<|class="st-link"|class="st-scheda"/);
    // il fondo lascia spazio al menu flottante
    assert.match(t, /<div class="app app-storico">/);
  } finally {
    materialeProva.attivo = false;
  }
});

test('storico: cambio mese, "Tutto", mese non valido e vista per articolo', async () => {
  materialeProva.attivo = true;
  try {
    // settembre: un solo ordine (#30, 3 × 122,00 = 366,00), servizio calcolato (10 × 1,22 + ...), la richiesta annullata #2
    let t = await pagina('/storico?mese=2026-09');
    assert.equal(totaleRiquadro(t), '366,00');
    assert.match(t, /Materiale di 1 ordine</);
    assert.match(t, /Servizio già pagato in app: <strong>€ 48,80<\/strong>/); // addebitato non salvato: (30 + 10) × 1,22
    assert.match(t, /Richiesta #2 · 25 set/);
    assert.match(t, /class="st-stato st-annullata">Annullata/);
    assert.doesNotMatch(t, /Richiesta #4 ·/);
    // "Tutto": ottobre + settembre
    t = await pagina('/storico?mese=tutto');
    assert.equal(totaleRiquadro(t), '637,45'); // 271,45 + 366,00
    assert.match(t, /Materiale di 4 ordini/);
    assert.match(t, /<a class="sm-chip attivo" href="\/storico\?mese=tutto&amp;vista=ordine" aria-current="true">Tutto<\/a>/);
    // un mese senza attività (o scritto male) torna al più recente (o al corrente se ne ha)
    for (const mese of ['2025-01', 'ciao', "2026-10'", '']) {
      const x = await pagina('/storico?mese=' + encodeURIComponent(mese));
      assert.equal(totaleRiquadro(x), '271,45', 'mese=' + mese);
    }
    assert.ok(totaleRiquadro(await pagina('/storico?mese=2026-10&mese=2026-09')), 'parametro ripetuto: nessun errore');
    // per articolo: righe sommate dal totale più alto, con gli ordini, e in fondo il totale
    t = await pagina('/storico?mese=tutto&vista=articolo');
    assert.match(t, /<a class="attiva" href="\/storico\?mese=tutto&amp;vista=articolo" aria-current="page">Per articolo<\/a>/);
    assert.doesNotMatch(t, /<details class="sm-ordine"/);
    const righe = [...t.matchAll(/<span class="sm-qta">(\d+)×<\/span>\s*<div class="sm-art-corpo">\s*<div class="sm-art-nome">([^<]+)<\/div>\s*<div class="sm-art-sotto">€ ([\d,]+) cad\. · ordini ([^<]+)<\/div>\s*<\/div>\s*<span class="sm-art-totale">€ ([\d,]+)<\/span>/g)]
      .map((m) => [Number(m[1]), m[2].replace(/&#34;/g, '"'), m[3], m[4], m[5]]);
    assert.deepEqual(righe, [
      [3, '87 Elemento A "t" 87gr Diam. 100', '122,00', '#30', '366,00'], // settembre: stesso articolo ma altro prezzo (senza RAEE): riga a parte
      [1, '87 Elemento A "t" 87gr Diam. 100', '124,44', '#97', '124,44'],
      [2, 'Bocchettone A 90° Sanpress', '36,60', '#91', '73,20'],
      [1, 'Valvola Deviatrice 3vie Per Easy', '61,00', '#98', '61,00'],
      [1, 'Raccordo a T', '12,81', '#91', '12,81'],
    ]);
    assert.match(t, /<div class="sm-art sm-art-somma">\s*<span class="sm-art-nome">Totale<\/span>\s*<span class="sm-art-totale">€ 637,45<\/span>/);
  } finally {
    materialeProva.attivo = false;
  }
});

test('storico: nessun ordine nel mese e nessun ordine ancora', async () => {
  materialeProva.attivo = true;
  const { ordini, righe } = materialeProva;
  try {
    // solo richieste senza ordine in un mese: l'elenco dice "Nessun costo", non "Nessun ordine"
    materialeProva.ordini = [];
    materialeProva.righe = [];
    let t = await pagina('/storico?mese=2026-10');
    assert.equal(totaleRiquadro(t), '0,00');
    assert.match(t, /Materiale di 0 ordini/);
    assert.doesNotMatch(t, /<details class="sm-ordine"/);
    assert.match(t, /Richiesta #4 · 13 ott/);
    // né ordini né richieste: la pagina vuota di sempre
    materialeProva.richieste = [];
    t = await pagina('/storico');
    assert.match(t, /Nessun ordine ancora\./);
    assert.match(t, /href="\/home">Vai al catalogo/);
    assert.doesNotMatch(t, /sm-riquadro/);
  } finally {
    materialeProva.attivo = false;
    materialeProva.ordini = ordini;
    materialeProva.righe = righe;
    materialeProva.richieste = [
      { id: 4, stato: 'nessuna_offerta', creato_il: dataProva(2026, 10, 13, 9, 0) },
      { id: 2, stato: 'annullata', creato_il: dataProva(2026, 9, 25, 8, 0) },
    ];
  }
});

test('storico: CSV del materiale (";" e BOM), solo del cliente loggato, righe per articolo e totali in fondo', async () => {
  cookie = '';
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  materialeProva.attivo = true;
  try {
    materialeProva.chiamate.length = 0;
    const r = await chiedi('/storico/materiale.csv?mese=2026-10');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.equal(r.headers.get('content-disposition'), 'attachment; filename="materiale-2026-10.csv"');
    assert.match(r.headers.get('cache-control'), /no-store/);
    const byte = new Uint8Array(await r.clone().arrayBuffer());
    assert.deepEqual([...byte.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
    const testo = await r.text(); // text() toglie il BOM
    assert.deepEqual(testo.split('\r\n'), [
      'Data;Ordine;Stato;Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl.;Servizio pagato',
      '14/10/2026;#91;Consegnato;C91A;Bocchettone A 90° Sanpress;2;36,60;73,20;20,80',
      '14/10/2026;#91;Consegnato;C91B;Raccordo a T;1;12,81;12,81;', // il servizio sta sulla prima riga dell'ordine: la somma è giusta
      '15/10/2026;#97;Consegnato;C97;"87 Elemento A ""t"" 87gr Diam. 100";1;124,44;124,44;24,40',
      '16/10/2026;#98;In preparazione;C98;Valvola Deviatrice 3vie Per Easy;1;61,00;61,00;18,30',
      'Totale;;;;;;;271,45;63,50',
      '',
    ]);
    // "Tutto" comprende anche settembre; solo il cliente loggato (id 1) è nelle query
    const tutto = await (await chiedi('/storico/materiale.csv?mese=tutto')).text();
    assert.match(tutto, /\r\nTotale;;;;;;;637,45;112,30\r\n/);
    assert.ok(materialeProva.chiamate.length >= 2);
    assert.ok(materialeProva.chiamate.every((c) => c.cliente === 1 && c.filiale === null), 'solo il cliente loggato, senza filtro sul banco');
    // senza sessione di un cliente non si esporta niente
    cookie = '';
    assert.notEqual((await chiedi('/storico/materiale.csv?mese=2026-10')).status, 200);
  } finally {
    materialeProva.attivo = false;
  }
});

test('banco e installatore vedono le STESSE cifre: totale, servizio e CSV identici per lo stesso cliente e lo stesso mese', async () => {
  materialeProva.attivo = true;
  banco.attivo = true;
  try {
    // installatore
    cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    const lato = await pagina('/storico?mese=2026-10');
    const csvInstallatore = await (await chiedi('/storico/materiale.csv?mese=2026-10')).text();
    // banco (filiale 2), cliente 32 approvato
    cookie = '';
    await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    const latoBanco = await pagina('/distributore/clienti/32?mese=2026-10');
    const csvBanco = await (await chiedi('/distributore/clienti/32/materiale.csv?mese=2026-10')).text();

    assert.equal(totaleRiquadro(lato), '271,45');
    assert.equal(totaleRiquadro(latoBanco), totaleRiquadro(lato), 'lo stesso totale del materiale');
    assert.match(latoBanco, /<div class="sm-occhiello">Da incassare<\/div>/);
    const servizio = (t) => (t.match(/Servizio già pagato in app: <strong>€ ([\d,]+)<\/strong>/) || [])[1];
    assert.equal(servizio(latoBanco), servizio(lato));
    assert.equal(servizio(latoBanco), '63,50');
    // gli stessi ordini con gli stessi totali di riga
    const totaliOrdini = (t) => [...t.matchAll(/<strong>Ordine #(\d+)<\/strong>[\s\S]*?<span class="sm-tot">€ ([\d,]+)<\/span>/g)].map((m) => m[1] + '=' + m[2]);
    assert.deepEqual(totaliOrdini(latoBanco), totaliOrdini(lato));
    assert.deepEqual(totaliOrdini(lato), ['98=61,00', '97=124,44', '91=86,01']);
    assert.equal(csvBanco, csvInstallatore, 'il CSV è lo stesso');
    // il banco non ha Riordina, né il link al dettaglio (aprirlo prende in carico un ordine inviato), né le richieste senza ordine
    assert.doesNotMatch(latoBanco, /st-riordina|class="sm-dettagli"|Richiesta #|sm-senza/);
    assert.match(latoBanco, /<a class="sm-esporta" href="\/distributore\/clienti\/32\/materiale\.csv\?mese=2026-10">/);
    assert.match(latoBanco, /href="\/distributore\/clienti\/32\?mese=2026-09#materiale"/);
    // un cliente da verificare non ha il blocco, e il suo CSV non esiste
    const nonApprovato = await pagina('/distributore/clienti/31');
    assert.doesNotMatch(nonApprovato, /sm-riquadro/);
    assert.equal((await chiedi('/distributore/clienti/31/materiale.csv')).status, 404);
  } finally {
    materialeProva.attivo = false;
    banco.attivo = false;
    cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
  }
});

test('storico vuoto: icona, "Nessun ordine ancora." e pulsante verso il catalogo', async () => {
  const t = await (await chiedi('/storico')).text();
  assert.match(t, /Nessun ordine ancora\./);
  assert.match(t, /<a class="btn btn-primary btn-blocco" href="\/home">Vai al catalogo<\/a>/);
  assert.doesNotMatch(t, /st-titolo/);
});

test('Stato ordini vuoto: furgone, "Come funziona" in tre passaggi, catalogo e riga dello storico', async () => {
  const r = await chiedi('/ordini');
  assert.equal(r.status, 200);
  const t = await r.text();
  assert.match(t, /<div class="app app-vuoto">/);
  assert.match(t, /class="titolo">Stato ordini</); // intestazione di sempre
  assert.match(t, /<div class="vuoto-fig" aria-hidden="true">\s*<span class="vuoto-fig-tratt"><\/span>\s*<svg/);
  assert.match(t, /<h1 class="vuoto-titolo">Nessun ordine in corso<\/h1>/);
  assert.match(t, /<p class="vuoto-sotto">Quando mandi una richiesta, qui segui ogni passaggio fino al cantiere\.<\/p>/);
  assert.match(t, /<h2 class="cf-occhiello" id="cf-occhiello">Come funziona<\/h2>/);
  assert.equal((t.match(/<li class="cf-passo">/g) || []).length, 3);
  for (const [colore, titolo, spiegazione] of [
    ['cf-blu', 'Mandi la richiesta', 'Scegli i pezzi e paghi dal carrello.'],
    ['cf-arancio', 'Il banco conferma', 'Entro 10 minuti, o ti rimborsiamo.'], // la finestra viene dalla configurazione (10 nel DB finto)
    ['cf-verde', 'Arriva in cantiere', 'Vedi chi lo porta e quanto manca.'],
  ]) {
    assert.match(t, new RegExp(`<span class="cf-ico ${colore}" aria-hidden="true"><svg[\\s\\S]*?</svg></span>\\s*<span class="cf-testi">\\s*<strong>${titolo}</strong>\\s*<span>${spiegazione.replace(/\./g, '\\.')}</span>`));
  }
  assert.match(t, /<a class="btn-vuoto-pieno" href="\/home"><svg[\s\S]*?<\/svg><span>Vai al catalogo<\/span><\/a>/);
  assert.match(t, /<a class="riga-storico" href="\/storico">[\s\S]*?<strong>Storico ordini<\/strong>\s*<span>Richieste e ordini passati<\/span>/);
  // niente più la frase che mandava al menu account, né la scatola e il pulsante di prima
  assert.doesNotMatch(t, /menu account|Crea il tuo ordine dal catalogo|class="btn btn-primary btn-blocco"/);
  // con una sola richiesta in corso la pagina non c'è: si va dritti alla richiesta
  storico.attivo = true;
  try {
    const r2 = await chiedi('/ordini');
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.get('location'), '/richieste/6');
  } finally {
    storico.attivo = false;
  }
});

test('Stato ordini con più attività: /ordini porta alla più urgente, ?voce= sceglie, e sopra la pagina c\'è la striscia di schede', async () => {
  storico.attivo = true;
  storico.conOrdini = true;
  ordiniProva.attivo = true;
  try {
    // le voci, nell'ordine dell'icona: la richiesta 6 in attesa e l'ordine 50 in consegna
    let r = await chiedi('/ordini');
    assert.equal(r.status, 302, 'non si rende più una lista');
    assert.equal(r.headers.get('location'), '/richieste/6', 'la più urgente');
    assert.equal((await chiedi('/ordini?voce=ordine-50')).headers.get('location'), '/ordini/50');
    assert.equal((await chiedi('/ordini?voce=richiesta-6')).headers.get('location'), '/richieste/6');
    // una voce che non c'è (o scritta male): la prima
    for (const voce of ['ordine-999', 'richiesta-5', 'qualcosa', '', 'ordine-50x']) {
      assert.equal((await chiedi('/ordini?voce=' + voce)).headers.get('location'), '/richieste/6', voce);
    }

    // la pagina della richiesta 6: titolo "Stato ordini" senza freccia indietro, striscia con la sua scheda attiva
    let t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<body data-loggato="1" class="con-striscia">/);
    assert.match(t, /class="titolo">Stato ordini</);
    assert.doesNotMatch(t, /aria-label="Indietro"/);
    assert.match(t, /<section class="striscia" data-striscia data-firma="ordine-50-consegna,richiesta-6-richiesta">/);
    assert.match(t, /<span class="striscia-conta">2 in corso<\/span>\s*<span class="striscia-pos">1 di 2<\/span>/);
    assert.match(t, /<nav class="striscia-schede" aria-label="Ordini in corso" style="--n: 2">/);
    const schede = (testo) => [...testo.matchAll(/<a class="str-scheda str-(\w+)( str-attiva)?" href="([^"]+)" data-voce="([^"]+)"( aria-current="page")?/g)]
      .map((m) => [m[1], !!m[2], m[3], m[4], !!m[5]]);
    assert.deepEqual(schede(t), [
      ['richiesta', true, '/richieste/6', 'richiesta-6', true],
      ['consegna', false, '/ordini/50', 'ordine-50', false],
    ]);
    // la scheda della richiesta ha il suo timer; quella della consegna il suo valore; ognuna il suo articolo
    assert.match(t, /data-voce="richiesta-6" aria-current="page" data-secondi="\d+" data-durata="360">/);
    assert.match(t, /<span data-countdown>0[45]:\d\d<\/span><\/span>\s*<span class="str-breve">Bocchettone A 90°<\/span>/);
    assert.match(t, /<span class="str-valore">In consegna<\/span>\s*<span class="str-breve">Adattatore Ø80\/100mm<\/span>/);
    // il blocco in alto della pagina c'è ancora (qui nella versione compatta, a carico del CSS)
    assert.match(t, /<div class="card att-card att-timer">/);

    // la pagina dell'ordine 50 (in consegna): stessa striscia, scheda attiva l'ordine
    t = await (await chiedi('/ordini/50')).text();
    assert.match(t, /<body data-loggato="1" class="con-striscia">/);
    assert.match(t, /class="titolo">Stato ordini</);
    assert.doesNotMatch(t, /aria-label="Indietro"/);
    assert.match(t, /<span class="striscia-pos">2 di 2<\/span>/);
    assert.deepEqual(schede(t), [
      ['richiesta', false, '/richieste/6', 'richiesta-6', false],
      ['consegna', true, '/ordini/50', 'ordine-50', true],
    ]);

    // la barra in basso alterna le due attività e il suo tocco porta DRITTO alla pagina della voce mostrata (la prima all'inizio):
    // niente passaggio da /ordini?voce=, che costava un giro in più a ogni cambio di ordine
    const nav = t.slice(t.indexOf('<a href="/richieste/6" class="nav-ordini multi'), t.indexOf('</a>', t.indexOf('<a href="/richieste/6" class="nav-ordini multi')));
    assert.match(nav, /^<a href="\/richieste\/6" class="nav-ordini multi fase-richiesta attivo" data-fase="richiesta" data-fasi="richiesta,consegna" data-attivo="ordini" data-firma="ordine-50-consegna,richiesta-6-richiesta" aria-label="Stato ordini: 2 attivi\. In attesa, 0[45]:\d\d rimasti\. In consegna\.">/);
    assert.deepEqual([...nav.matchAll(/<span class="fotogramma fase-(\w+)( attivo)?" data-voce="([^"]+)" data-href="([^"]+)"/g)].map((m) => [m[1], !!m[2], m[3], m[4]]),
      [['richiesta', true, 'richiesta-6', '/richieste/6'], ['consegna', false, 'ordine-50', '/ordini/50']]);
    assert.match(nav, /<span class="punto attivo"><\/span><span class="punto"><\/span>/);
    assert.match(nav, /<span class="conteggio">2<\/span>/);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
    ordiniProva.attivo = false;
  }
});

test('striscia: con una sola attività niente striscia e tutto come prima; neanche per un ordine consegnato aperto dallo storico', async () => {
  storico.attivo = true; // c'è solo la richiesta 6 in attesa
  try {
    let r = await chiedi('/ordini');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/richieste/6');
    let t = await (await chiedi('/richieste/6')).text();
    assert.doesNotMatch(t, /<section class="striscia"|striscia-schede"|class="con-striscia"/);
    assert.match(t, /class="titolo">Verifica disponibilità</);
    assert.match(t, /<a class="icona-btn" href="\/home" aria-label="Indietro">/);

    // con due attività, un ordine consegnato aperto dallo storico non fa parte delle voci: niente striscia
    storico.conOrdini = true;
    ordiniProva.attivo = true;
    t = await (await chiedi('/ordini/71')).text();
    assert.doesNotMatch(t, /<section class="striscia"|striscia-schede"|class="con-striscia"/);
    assert.match(t, /<a class="icona-btn" href="\/home" aria-label="Indietro">/);
    // lo stesso per una richiesta che non è una delle voci (la 5, ormai ordine)
    r = await chiedi('/richieste/4');
    assert.doesNotMatch(await r.text(), /<section class="striscia"|class="con-striscia"/);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
    ordiniProva.attivo = false;
  }
});

test('richiesta scaduta: "Nessun corriere ha confermato" se il banco aveva accettato, "Nessun banco ha confermato" negli altri casi', async () => {
  storico.attivo = true; // la richiesta 4 è chiusa senza ordine (nessuna_offerta), rimborsata
  try {
    const riga = (extra) => ({ id: 1, request_id: 4, distributor_id: 2, distributore_nome: 'Borea', filiale: 'Fegino', ditta_id: 6, esito: 'scaduto', corriere_stato: null, ...extra });
    const titolo = (t) => (t.match(/<h2 class="att-titolo">([^<]*)<\/h2>/) || [])[1];
    const pagina = async () => (await chiedi('/richieste/4')).text();

    // il banco non ha risposto in tempo: la scritta di sempre, e il suo stato "Nessuna risposta"
    storico.risposte[4] = [riga({})];
    let t = await pagina();
    assert.equal(titolo(t), 'Nessun banco ha confermato');
    assert.match(t, /<span class="att-chip-no">Nessuna risposta<\/span>/);

    // il banco ha rifiutato: ancora "nessun banco"
    storico.risposte[4] = [riga({ esito: 'non_disponibile' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun banco ha confermato');
    assert.match(t, /<span class="att-chip-no">Non disponibile<\/span>/);

    // il banco ha accettato ma nessun corriere ha preso la consegna: la causa è il corriere, e il banco risulta disponibile
    storico.risposte[4] = [riga({ esito: 'confermato', corriere_stato: 'scaduto' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun corriere ha confermato');
    assert.match(t, /<span class="att-chip-ok">[\s\S]*?Disponibile<\/span>/);
    assert.doesNotMatch(t, /Nessun banco ha confermato/);
    assert.match(t, /<p class="att-sotto">Il tempo per rispondere è scaduto\.<\/p>/);

    // due filiali della stessa ditta: vale quella che aveva accettato, anche se l'altra (chiusa) viene prima nell'elenco
    storico.risposte[4] = [riga({ id: 1, distributor_id: 2, esito: 'scaduto' }), riga({ id: 2, distributor_id: 181, filiale: 'Staglieno', esito: 'confermato', corriere_stato: 'scaduto' })];
    t = await pagina();
    assert.equal(titolo(t), 'Nessun corriere ha confermato');
    assert.equal((t.match(/class="card att-card att-banco"/g) || []).length, 1, 'una ditta, una voce');
  } finally {
    storico.attivo = false;
    storico.risposte = {};
  }
});

// Le richieste di prova (fixture `storico`) con articoli e importi della specifica: 54,50 + 10,00 di merce a prezzo del banco ->
// consegna 20,07 (10,00 + servizio 6,45 + IVA 3,62) pagata in app, materiale 78,69 (64,50 + IVA 14,19) da pagare a BOREA solo se confermano.
const DUE_ARTICOLI = () => [
  { nome: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', quantita: 1, product_id: 101, codice: '12514597', prezzo_listino: 54.5, sconto_base_pct: 0, raee: 0 },
  { nome: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', quantita: 1, product_id: 102, codice: '12697319', prezzo_listino: 10, sconto_base_pct: 0, raee: 0 },
];
const IMPORTI_SALVATI = { corriere: 10, servizio: 6.45, iva_app: 3.62, da_pagare_app: 20.07, merce_banco: 64.5, raee_banco: 0, iva_banco: 14.19, materiale_banco: 78.69 };
const IMPORTI_A_ZERO = { corriere: 0, servizio: 0, iva_app: 0, da_pagare_app: 0, merce_banco: 0, raee_banco: 0, iva_banco: 0, materiale_banco: 0 };
const rispostaProva = (idRichiesta, extra) => ({ id: 1, request_id: idRichiesta, distributor_id: 2, distributore_nome: 'BOREA SRL', filiale: 'Fegino', ditta_id: 6, esito: 'in_attesa', corriere_stato: null, ...extra });
// Applica i campi alla richiesta di prova (e gli articoli), esegue la prova e rimette tutto com'era.
async function conRichiesta(id, campi, articoli, prova) {
  const r = storico.richieste.find((x) => x.id === id);
  const prima = { ...r };
  const righePrima = storico.righe[id];
  Object.assign(r, campi);
  if (articoli) storico.righe[id] = articoli;
  storico.attivo = true;
  try {
    await prova(r);
  } finally {
    for (const k of Object.keys(r)) delete r[k];
    Object.assign(r, prima);
    if (righePrima === undefined) delete storico.righe[id]; else storico.righe[id] = righePrima;
    storico.attivo = false;
    storico.risposte = {};
  }
}

test('richiesta in attesa: righe e "Merce" a prezzo del banco, scheda "Pagamenti" (consegna pagata, materiale in sospeso) e solo "Annulla la richiesta"', async () => {
  await conRichiesta(6, { ...IMPORTI_SALVATI, pagamento_importo: 20.07, pagamento_metodo: 'stripe', pagato_il: fa(60000) }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    let t = await (await chiedi('/richieste/6')).text();
    // 1. "Materiale richiesto": quantità, nome, "Cod. … · € cad.", totale di riga; sotto la merce IVA esclusa a prezzi del banco
    assert.match(t, /<div class="att-occhiello">Materiale richiesto<\/div>/);
    assert.match(t, /<span class="att-qta">1×<\/span>\s*<div class="att-desc">\s*<div class="att-nome">Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/div>\s*<div class="att-cod">Cod\. 12514597 · € 54,50 cad\.<\/div>/);
    assert.match(t, /<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /<div class="att-cod">Cod\. 12697319 · € 10,00 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 10,00<\/span>/);
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /att-pagato|<span>Pagato<\/span>|Richiesta del|prezzi IVA esclusa/);
    // 2. "Pagamenti": consegna pagata (verde), materiale in sospeso (tratteggiato, grigio)
    assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="attesa">\s*<h2 class="pg-titolo">Pagamenti<\/h2>/);
    assert.match(t, /<div class="pg-riga pg-consegna">[\s\S]*?Consegna in cantiere[\s\S]*?Pagata in app · rimborsata se nessuno accetta[\s\S]*?<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /<div class="pg-riga pg-materiale pg-sospeso">[\s\S]*?<div class="pg-nome">Materiale<\/div>\s*<div class="pg-sub">Lo paghi a BOREA solo se conferma<\/div>[\s\S]*?<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/);
    // 3. il dettaglio (chiuso): consegna 10,00 / 6,45 / 3,62 e materiale 64,50 / 14,19, senza RAEE
    assert.match(t, /<details class="pg-dettaglio">/);
    assert.doesNotMatch(t, /<details class="pg-dettaglio" open/);
    assert.match(t, /<h3>Consegna · pagata<\/h3>/);
    assert.match(t, /Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>/);
    assert.match(t, /Servizio<\/span> <span class="pg-sp">· 10% della merce<\/span><\/dt><dd>€ 6,45<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 16,45<\/span><\/dt><dd>€ 3,62<\/dd>/);
    assert.match(t, /<h3>Materiale · se BOREA conferma<\/h3>/);
    assert.match(t, /Merce<\/span> <span class="pg-sp">· prezzo del banco<\/span><\/dt><dd>€ 64,50<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
    assert.doesNotMatch(t, /Contributo RAEE/);
    // 4. si può solo annullare: niente "Elimina definitivamente" (la rotta c'è, si usa dalla richiesta chiusa)
    assert.match(t, /action="\/richieste\/6\/annulla"/);
    assert.match(t, /Annulla la richiesta/);
    assert.doesNotMatch(t, /Elimina definitivamente|\/richieste\/6\/elimina/);
    // con più ditte interpellate non c'è un nome solo: "al banco"
    storico.risposte[6] = [rispostaProva(6), rispostaProva(6, { id: 2, distributore_nome: 'AFIS SPA', ditta_id: 7 })];
    t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /Lo paghi al banco solo se conferma/);
    assert.match(t, /<h3>Materiale · se il banco conferma<\/h3>/);
  });
});

test('richiesta in attesa VECCHIA (importi non salvati): si ricalcolano sulle righe, e la consegna è quanto è stato davvero addebitato', async () => {
  await conRichiesta(6, { ...IMPORTI_A_ZERO, pagamento_importo: 66.9, pagamento_metodo: 'simulato', pagato_il: fa(60000) }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    const t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.match(t, /<div class="pg-importo" data-importo-app>€ 66,90<\/div>/, 'la consegna è il pagamento_importo');
    assert.match(t, /<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/, 'il materiale è ricalcolato');
    // le voci del dettaglio sono quelle del calcolo di oggi, come nel carrello
    assert.match(t, /Servizio<\/span> <span class="pg-sp">· 10% della merce<\/span><\/dt><dd>€ 6,45<\/dd>/);
    assert.match(t, /IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
  });
});

test('richiesta in attesa del vecchio flusso (mai pagata): righe e materiale, ma nessuna scheda "Pagamenti"', async () => {
  await conRichiesta(6, { ...IMPORTI_A_ZERO, pagamento_stato: null, pagamento_importo: null }, DUE_ARTICOLI(), async () => {
    storico.risposte[6] = [rispostaProva(6)];
    const t = await (await chiedi('/richieste/6')).text();
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /data-pagamenti/);
  });
});

test('richiesta scaduta: "Rimborsata il …", materiale "Niente da pagare" e la nota col ricalcolo di OGGI; Rinvia ed Elimina', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'rimborsato', pagamento_importo: 20.07, pagamento_metodo: 'stripe', rimborsato_il: new Date(2025, 2, 20, 9, 10) };
  await conRichiesta(4, campi, DUE_ARTICOLI(), async () => {
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' })];
    let t = await (await chiedi('/richieste/4')).text();
    // in alto: il testo non dipende dalla durata della finestra, la pillola è quanto è tornato indietro
    assert.match(t, /<p class="att-sotto">Il tempo per rispondere è scaduto\.<\/p>/);
    assert.doesNotMatch(t, /Il tempo di/);
    assert.match(t, /<span class="att-rimborso">[\s\S]*?€ 20,07 rimborsati<\/span>/);
    // materiale richiesto: prezzi del banco, niente più "Richiesta del …"
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /Richiesta del|prezzi IVA esclusa/);
    // Pagamenti: la consegna rimborsata (verde, con la freccia di ritorno) e il materiale a zero
    assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="chiusa">/);
    assert.match(t, /<div class="pg-riga pg-consegna">[\s\S]*?<span class="pg-tondo">[\s\S]*?<\/span>Rimborsata il 20\/03\/2025 sulla tua carta<\/div>[\s\S]*?<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /<div class="pg-riga pg-materiale pg-nullo">[\s\S]*?<div class="pg-sub">Niente da pagare: BOREA non ha confermato<\/div>[\s\S]*?<div class="pg-importo" data-importo-banco>€ 0,00<\/div>/);
    assert.doesNotMatch(t, /<details class="pg-dettaglio">/, 'niente link al dettaglio');
    // la nota: gli stessi prezzi di oggi di quando si preme "Rinvia" (qui non sono cambiati: 20,07 e 78,69)
    assert.match(t, /<p class="pg-nota" data-nota-rinvio>Se rinvii la richiesta paghi di nuovo solo la consegna \(€ 20,07\)\. Il materiale resta € 78,69, da pagare a BOREA se conferma\.<\/p>/);
    // Rinvia (blu) ed Elimina, come prima
    assert.match(t, /action="\/richieste\/4\/reinvia"[\s\S]*?Rinvia richiesta/);
    assert.match(t, /action="\/richieste\/4\/elimina"[\s\S]*?Elimina richiesta/);

    // i prezzi sono cambiati dopo la chiusura: la nota usa quelli di oggi (articolo da 104,50: merce 114,50 -> 26,17 e 139,69); quanto è stato
    // rimborsato resta quello pagato
    storico.righe[4][0].prezzo_listino = 104.5;
    t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /consegna \(€ 26,17\)\. Il materiale resta € 139,69, da pagare a BOREA se conferma\./);
    assert.match(t, /<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /€ 20,07 rimborsati<\/span>/);

    // più ditte: "al banco"
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' }), rispostaProva(4, { id: 2, distributore_nome: 'AFIS SPA', ditta_id: 7, esito: 'scaduto' })];
    t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /Niente da pagare: nessun banco ha confermato/);
    assert.match(t, /da pagare al banco se conferma\./);
  });
});

test('richiesta scaduta: rimborso ancora in corso, banco che aveva accettato ma senza corriere, e metodo che non è una carta', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'pagato', pagamento_importo: 20.07, pagamento_metodo: 'stripe' };
  await conRichiesta(4, campi, DUE_ARTICOLI(), async (r) => {
    storico.risposte[4] = [rispostaProva(4, { esito: 'confermato', corriere_stato: 'scaduto' })];
    let t = await (await chiedi('/richieste/4')).text();
    assert.match(t, /<span class="att-rimborso att-rimborso-attesa">Rimborso in corso · € 20,07<\/span>/);
    assert.match(t, /<div class="pg-riga pg-rimborso-corso">[\s\S]*?<div class="pg-sub">Rimborso in corso<\/div>[\s\S]*?data-importo-app>€ 20,07<\/div>/);
    // il banco ha accettato e nessun corriere ha preso la consegna: la causa è il corriere
    assert.match(t, /<div class="pg-sub">Niente da pagare: nessun corriere ha accettato la consegna<\/div>/);
    // rimborsata, ma il metodo non è una carta (e non c'è la data): "sul tuo metodo di pagamento"
    Object.assign(r, { pagamento_stato: 'rimborsato', pagamento_metodo: null, rimborsato_il: null });
    storico.risposte[4] = [rispostaProva(4, { esito: 'scaduto' })];
    t = await (await chiedi('/richieste/4')).text();
    // senza `rimborsato_il` (rimborsi di prima della colonna) la data è quella della scadenza della richiesta
    assert.match(t, /Rimborsata il 20\/03\/2025 sul tuo metodo di pagamento<\/div>/);
  });
});

test('richiesta annullata: stessa scheda "Pagamenti" (consegna rimborsata, materiale "Niente da pagare") e righe a prezzo del banco', async () => {
  const campi = { ...IMPORTI_SALVATI, pagamento_stato: 'rimborsato', pagamento_importo: 20.07, pagamento_metodo: 'simulato', rimborsato_il: null };
  await conRichiesta(2, campi, DUE_ARTICOLI(), async () => {
    storico.risposte[2] = [rispostaProva(2, { esito: 'scaduto' })];
    const t = await (await chiedi('/richieste/2')).text();
    assert.match(t, /Hai annullato questa richiesta\./);
    assert.match(t, /<dt>Merce · IVA esclusa · prezzi del banco<\/dt><dd>€ 64,50<\/dd>/);
    assert.doesNotMatch(t, /già comprensivi del servizio|Richiesta del/);
    assert.match(t, /<div class="card att-card pg-card" data-pagamenti data-stato="chiusa">/);
    // annullata dal cliente non ha data di rimborso (nessuna scadenza da usare): niente "il …"
    assert.match(t, /Rimborsata sulla tua carta<\/div>/);
    assert.match(t, /<div class="pg-sub">Niente da pagare: hai annullato la richiesta<\/div>/);
    assert.match(t, /<div class="pg-importo" data-importo-banco>€ 0,00<\/div>/);
    assert.doesNotMatch(t, /data-nota-rinvio/, 'una richiesta annullata non si rinvia');
  });
});

test('"Ordine consegnato" riporta in "Stato ordini" (altro ordine in corso o pagina vuota), non sull\'ordine né in catalogo', async () => {
  ordiniProva.attivo = true;
  try {
    // rotta provvisoria (qualunque stato): sempre /ordini, qualunque cosa dica il corpo
    for (const corpo of [{}, { ritorno: '/ordini/72' }, { ritorno: '/home' }, { ritorno: '//sito.esempio/x' }]) {
      const r = await chiedi('/ordini/72/consegnato-prova', form(corpo));
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), '/ordini', JSON.stringify(corpo));
    }
    // rotta vera (ordine partito dal banco): lo stesso
    const r = await chiedi('/ordini/70/consegnato', form({}));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/ordini');
    // la pagina dell'ordine in consegna ha il pulsante, senza campi per scegliere dove tornare
    const inConsegna = await (await chiedi('/ordini/72')).text();
    assert.match(inConsegna, /action="\/ordini\/72\/consegnato-prova"/);
    assert.doesNotMatch(inConsegna, /name="ritorno"/);
    // l'ordine già consegnato resta consultabile (dallo Storico): la sua pagina "Consegnato" c'è ancora
    const t = await (await chiedi('/ordini/71')).text();
    assert.match(t, /<h2 class="att-titolo">Consegnato<\/h2>/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('catalogo: la testata porta l\'utente collegato (le quantità scelte e non ancora aggiunte si legano a lui)', async () => {
  const t = await (await chiedi('/home')).text();
  assert.match(t, /<meta name="utente" content="1">/);
  // senza sessione non c'è
  const anonimo = await fetch(base + '/login');
  assert.doesNotMatch(await anonimo.text(), /<meta name="utente"/);
});

test('icona con una sola attività: quella di sempre, senza fotogrammi né puntini; la scheda della home ha il suo conto', async () => {
  storico.attivo = true; // senza conOrdini: c'è solo la richiesta 6 in attesa
  try {
    const t = await (await chiedi('/home')).text();
    // con una sola attività il tocco porta dritto alla sua pagina (non da /ordini, che la rimanderebbe lì con un giro in più)
    const a = t.indexOf('<a href="/richieste/6" class="nav-ordini');
    const nav = t.slice(a, t.indexOf('</a>', a));
    assert.match(nav, /^<a href="\/richieste\/6" class="nav-ordini fase-richiesta " data-fase="richiesta" data-attivo="home" data-firma="richiesta-6-richiesta" data-secondi="\d+" data-durata="360">/);
    assert.doesNotMatch(nav, /multi|fotogramm|puntini|data-fasi|aria-label/);
    assert.match(nav, /<span class="etichetta">In attesa · <span data-countdown>0[45]:\d\d<\/span><\/span>/);
    // il conto dell'icona è quello del suo link; la scheda in cima alla home ha il suo [data-secondi]
    const scheda = t.slice(t.indexOf('<a class="stato-home stato-richiesta"'), t.indexOf('</a>', t.indexOf('<a class="stato-home stato-richiesta"')));
    assert.match(scheda, /^<a class="stato-home stato-richiesta" href="\/richieste\/6" data-secondi="\d+" data-durata="360">/);
  } finally {
    storico.attivo = false;
  }
});

test('home: una scheda per ogni richiesta in attesa e ordine in consegna, nello stesso formato, una sotto l\'altra', async () => {
  storico.attivo = true;
  storico.conOrdini = true; // la richiesta 6 in attesa e l'ordine 50 in consegna (senza orario del corriere)
  try {
    const t = await (await chiedi('/home')).text();
    const inizio = t.indexOf('<div class="stato-home-slot" data-stato-home>');
    assert.ok(inizio > -1);
    const slot = t.slice(inizio, t.indexOf('<h1 class="domanda">', inizio)); // fino alla ricerca che segue le schede
    // le schede, nell'ordine dell'icona: prima la richiesta, poi la consegna
    const schede = [...slot.matchAll(/<(?:a|div) class="stato-home stato-(richiesta|consegna)"/g)].map((m) => m[1]);
    assert.deepEqual(schede, ['richiesta', 'consegna']);
    // ognuna porta alla pagina della sua attività
    assert.match(slot, /<a class="stato-home stato-richiesta" href="\/richieste\/6" data-secondi="\d+" data-durata="360">/);
    assert.match(slot, /<a class="stato-corpo" href="\/ordini\/50">/);
    // formato di sempre: la richiesta con anello, conto alla rovescia e frase del rimborso; la consegna con furgone, barra e tappe
    assert.match(slot, /<span class="stato-tempo" data-countdown>0[45]:\d\d<\/span>/);
    assert.match(slot, /<span class="stato-occhiello">Richiesta inviata<\/span>\s*<span class="stato-titolo">Aspettiamo che un banco accetti<\/span>\s*<span class="stato-sub">Se nessuno accetta entro 6 min, ti rimborsiamo\.<\/span>/);
    assert.match(slot, /<span class="stato-occhiello">Accettato · In consegna<\/span>\s*<span class="stato-titolo">In consegna<\/span>/);
    assert.match(slot, /<div class="stato-barra" aria-hidden="true"><span style="width: 50%"><\/span><\/div>/);
    assert.match(slot, /<div class="stato-tappe" aria-hidden="true">\s*<span>Accettato<\/span>\s*<span>In viaggio<\/span>\s*<span>Consegnato<\/span>/);
    // un solo conto alla rovescia (una sola richiesta): le consegne non ne hanno
    assert.equal((slot.match(/data-countdown/g) || []).length, 1);
  } finally {
    storico.attivo = false;
    storico.conOrdini = false;
  }
});

test('si può inviare una nuova richiesta anche con una già in attesa: nessun "Richiesta già in corso"', async () => {
  storico.attivo = true;
  try {
    await chiedi('/carrello/svuota', { method: 'POST' });
    await chiedi('/api/carrello/imposta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, qty: 50 }),
    });
    const r = await chiedi('/richieste', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'destinazione=Via+Prova+1' });
    const t = await r.text();
    assert.doesNotMatch(t, /Richiesta già in corso|già una richiesta in attesa/);
  } finally {
    storico.attivo = false;
  }
});

test('un invio, una richiesta: ogni apertura del carrello ha la sua chiave; un invio già partito riporta alla sua richiesta', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });
  await chiedi('/api/carrello/imposta', json({ id: 1, qty: 50 }));
  const chiavi = [];
  for (let i = 0; i < 2; i++) {
    const t = await (await chiedi('/carrello')).text();
    const m = t.match(/<input type="hidden" name="chiave_invio" value="([0-9a-f]{24})">/);
    assert.ok(m, 'la chiave è nel modulo di invio');
    assert.ok(t.indexOf(m[0]) > t.indexOf('id="form-invia"'), 'dentro il modulo che invia la richiesta');
    chiavi.push(m[1]);
  }
  assert.notEqual(chiavi[0], chiavi[1], 'un carrello riaperto è un invio nuovo');

  // secondo clic (o "indietro") sullo stesso invio: si va alla richiesta già partita, e non se ne scrive un'altra
  const prima = registro.length;
  const r = await chiedi('/richieste', form({ modo: 'imposta', chiave_invio: 'chiave-esistente-1', destinazione: 'Via Prova 1' }));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/richieste/321');
  assert.ok(!registro.slice(prima).some((q) => /INSERT INTO requests/.test(q)), 'nessuna richiesta nuova');
  // il carrello di quell'invio non serve più
  assert.match(await (await chiedi('/carrello')).text(), /Il carrello è vuoto/);
});

test('carrello vuoto: figura, ricerca come la home, catalogo; l\'ultimo ordine solo se consegnato', async () => {
  await chiedi('/carrello/svuota', { method: 'POST' });

  // senza ordini consegnati: niente scheda
  let t = await (await chiedi('/carrello')).text();
  assert.match(t, /<div class="app app-vuoto">/);
  assert.match(t, /<h1 class="vuoto-titolo">Il carrello è vuoto<\/h1>/);
  assert.match(t, /<p class="vuoto-sotto">Cerca il pezzo che ti manca o sfoglia le categorie\.<\/p>/);
  assert.match(t, /<div class="vuoto-fig" aria-hidden="true">\s*<span class="vuoto-fig-tratt"><\/span>\s*<svg/);
  // la stessa ricerca della home: GET /cerca?q=
  assert.match(t, /<form class="barra-ricerca barra-home barra-vuoto" method="GET" action="\/cerca" role="search">/);
  assert.match(t, /type="search" name="q"[^>]*placeholder="Nome o misura: valv 3\/4"/);
  assert.match(t, /<button type="submit" class="btn-cerca">Cerca<\/button>/);
  assert.match(t, /<a class="btn-vuoto-bordo" href="\/home"><svg[\s\S]*?<\/svg><span>Sfoglia il catalogo<\/span><\/a>/);
  assert.doesNotMatch(t, /uo-scheda|Rimetti nel carrello|Vai al catalogo|Aggiungi articoli dalle categorie/);

  // con un ordine consegnato: la scheda, tre righe, "+ 1 altro" e il POST di Riordina; una sola lettura
  storico.attivo = true;
  try {
    const prima = registro.length;
    t = await (await chiedi('/carrello')).text();
    assert.equal(registro.slice(prima).filter((q) => /AS ordine_id, o.creato_il, oi.quantita/.test(q)).length, 1);
    assert.match(t, /<h2 class="uo-occhiello" id="uo-occhiello">Il tuo ultimo ordine<\/h2>\s*<span class="uo-data">10 feb 2025<\/span>/);
    assert.deepEqual(
      [...t.matchAll(/<span class="uo-qta">(\d+)×<\/span>\s*<span class="uo-nome">([^<]*)<\/span>/g)].map((m) => m[1] + '× ' + m[2]),
      ['2× Valvola a sfera', '3× Raccordo a T', '1× Adattatore Ø80/100mm Per Caldaia 45-65kw']
    );
    assert.match(t, /<p class="uo-altri">\+ 1 altro<\/p>/);
    assert.match(t, /<form class="uo-form" method="POST" action="\/storico\/10\/riordina">\s*<button type="submit" class="uo-btn"><svg[\s\S]*?<\/svg><span>Rimetti nel carrello<\/span>/);

    // con qualcosa nel carrello la pagina è quella di sempre e la lettura dell'ultimo ordine non parte nemmeno
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 2 }));
    const prima2 = registro.length;
    t = await (await chiedi('/carrello')).text();
    assert.equal(registro.slice(prima2).filter((q) => /AS ordine_id, o.creato_il, oi.quantita/.test(q)).length, 0);
    assert.match(t, /carrello-layout/);
    assert.doesNotMatch(t, /uo-scheda|vuoto-pagina/);
  } finally {
    storico.attivo = false;
    await chiedi('/carrello/svuota', { method: 'POST' });
  }
});

test('riordina: somma al carrello, salta gli articoli non disponibili e lo dice una sola volta', async () => {
  storico.attivo = true;
  try {
    await chiedi('/carrello/svuota', { method: 'POST' });
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 1 })); // già nel carrello: le quantità si sommano
    let r = await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/carrello');
    const carrello = (await (await chiedi('/api/carrello')).json()).carrello;
    assert.deepEqual(carrello, { 1: 3, 2: 3 });

    r = await chiedi('/carrello');
    const t = await r.text();
    assert.match(t, /class="avviso avviso-attenzione"[^>]*>3 articoli non sono più disponibili</);
    assert.ok(t.indexOf('avviso-attenzione') < t.indexOf('carrello-layout'), 'avviso in cima');
    assert.doesNotMatch(await (await chiedi('/carrello')).text(), /non sono più disponibili/, 'solo una volta');

    // un secondo riordino somma ancora
    await chiedi('/storico/10/riordina', { method: 'POST' });
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 });

    // l'ordine di un altro cliente e uno inesistente non si riordinano; un id non valido è 404
    assert.equal((await chiedi('/storico/99/riordina', { method: 'POST' })).status, 403);
    assert.equal((await chiedi('/storico/98/riordina', { method: 'POST' })).status, 404);
    assert.equal((await chiedi('/storico/abc/riordina', { method: 'POST' })).status, 404);
    assert.deepEqual((await (await chiedi('/api/carrello')).json()).carrello, { 1: 5, 2: 6 }, 'carrello intatto');
  } finally {
    storico.attivo = false;
    await chiedi('/carrello/svuota', { method: 'POST' });
  }
});

// ---------------- Pagina dell'ordine: consegna pagata in app e materiale da pagare a BOREA ----------------

test('ordine in consegna: righe a prezzo del banco, "Merce · IVA esclusa", scheda Pagamenti (consegna 20,07 pagata, materiale 78,69), niente Totale', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/74')).text();
    // la parte alta (anello che si svuota, titolo, passi) non cambia
    assert.match(t, /att-timer att-verde/);
    assert.match(t, /<span class="att-etichetta">In consegna<\/span>/);
    // materiale in arrivo: prezzo del BANCO (54,50 e 10,00, non 59,95 e 11,00), "Cod. … · € … cad." e totale di riga
    assert.match(t, /<div class="att-occhiello">Materiale in arrivo<\/div>/);
    assert.match(t, /Adattatore Ø80\/100mm Per Caldaia 45-65kw<\/div>\s*<div class="att-cod">Cod\. 12514597 · € 54,50 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /Cod\. 12697319 · € 10,00 cad\.<\/div>\s*<\/div>\s*<span class="att-prezzo-riga">€ 10,00<\/span>/);
    assert.doesNotMatch(t, /59,95|11,00/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 64,50<\/dd><\/div>/);
    // niente più le righe consegna / IVA / totale nella scheda materiale, né la sezione "Dettagli", né la nota sul prezzo
    assert.doesNotMatch(t, /att-totale|<dt>Totale<\/dt>|<dt>Consegna in cantiere<\/dt>|<dt>IVA 22%<\/dt>/);
    assert.doesNotMatch(t, /Dettagli consegna|att-dettagli|Prezzo definitivo, con eventuale sconto/);
    // Pagamenti: la consegna pagata in app (con la data) e il materiale da pagare a BOREA, in fattura
    assert.match(t, /<h2 class="pg-titolo">Pagamenti<\/h2>/);
    assert.match(t, /<div class="pg-nome">Consegna in cantiere<\/div>\s*<div class="pg-sub"><span class="pg-spunta">[\s\S]*?<\/span>Pagata in app il 15\/10(?:\/2026)?<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /<div class="pg-nome">Materiale<\/div>\s*<div class="pg-sub">Da pagare a BOREA, in fattura<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-banco>€ 78,69<\/div>/);
    assert.doesNotMatch(t, /98,76/, 'mai la somma dei due in un totale unico');
    // il dettaglio degli importi: <details> chiuso, due riquadri piccoli
    assert.match(t, /<details class="pg-dettaglio">\s*<summary><span class="pg-apri">Vedi il dettaglio degli importi<\/span><span class="pg-chiudi">Nascondi il dettaglio<\/span>/);
    const dettaglio = t.slice(t.indexOf('pg-riquadri'));
    assert.match(dettaglio, /Consegna · pagata<\/h3>[\s\S]*?Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>[\s\S]*?Servizio<\/span> <span class="pg-sp">· 10% della merce<\/span><\/dt><dd>€ 6,45<\/dd>[\s\S]*?IVA 22%<\/span> <span class="pg-sp">· su € 16,45<\/span><\/dt><dd>€ 3,62<\/dd>/);
    assert.match(dettaglio, /Materiale · a BOREA<\/h3>[\s\S]*?Merce<\/span> <span class="pg-sp">· prezzo del banco<\/span><\/dt><dd>€ 64,50<\/dd>[\s\S]*?IVA 22%<\/span> <span class="pg-sp">· su € 64,50<\/span><\/dt><dd>€ 14,19<\/dd>/);
    assert.doesNotMatch(dettaglio, /Contributo RAEE/, 'senza RAEE la riga non c\'è');
    // il pulsante: stessa azione, nuovo testo
    assert.match(t, /<form method="POST" action="\/ordini\/74\/consegnato-prova">\s*<button class="btn btn-primary btn-blocco" type="submit" title="[^"]*">Ho ricevuto il materiale<\/button>/);
    assert.doesNotMatch(t, />Ordine consegnato</);
    // l'annullo resta (ordine inviato, non consegnato)
    assert.match(t, /Annulla ordine/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine consegnato: stessa struttura in verde (materiale consegnato, DDT, Pagamenti), Riordina, niente "Annulla ordine"', async () => {
  ordiniProva.attivo = true;
  try {
    const r = await chiedi('/ordini/73');
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /<div class="app app-consegnato">/);
    assert.match(t, /class="titolo">Ordine</); // intestazione di sempre
    assert.doesNotMatch(t, /ordine-hero|class="badge"/);
    // 1. scheda di stato: invariata
    assert.match(t, /<h2 class="att-titolo">Consegnato<\/h2>\s*<p class="att-sotto">Mercoledì 14 ottobre(?: 2026)? alle 20:10<\/p>/);
    const passi = [...t.matchAll(/<li class="att-passo ([^"]*)">[\s\S]*?<\/svg><\/span>(\w+)<\/span>/g)].map((m) => m[1] + ':' + m[2]);
    assert.deepEqual(passi, ['att-fatto:Inviata', 'att-fatto:Confermata', 'att-fatto:Consegnata']);
    assert.doesNotMatch(t, /att-corrente|data-viaggio|att-anello|att-furgone/); // niente anello né animazioni
    // 2. Riordina: lo stesso POST dello storico
    assert.match(t, /<form class="att-riordina" method="POST" action="\/storico\/73\/riordina">/);
    // 3. una scheda: la ditta (mai la filiale), "Materiale consegnato", "Ordine #73", righe a prezzo del banco, "Merce · IVA esclusa"
    assert.match(t, /<div class="att-occhiello">Materiale consegnato<\/div>\s*<div class="att-banco-nome">BOREA SRL<\/div>[\s\S]*?<span class="att-ordine-id">Ordine #73<\/span>/);
    assert.doesNotMatch(t, /Banco Genova Fegino/);
    assert.match(t, /Cod\. 12514597 · € 54,50 cad\.[\s\S]*?<span class="att-prezzo-riga">€ 54,50<\/span>/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 64,50<\/dd><\/div>/);
    // il DDT (e solo quello) in una riga "Documenti" in fondo alla scheda del materiale
    assert.match(t, /<a class="att-documenti" href="\/ddt\/73">[\s\S]*?Documenti · DDT n° A\/12<\/span>/);
    // Pagamenti: come nell'ordine in consegna
    assert.match(t, /Pagata in app il 15\/10(?:\/2026)?<\/div>\s*<\/div>\s*<div class="pg-importo" data-importo-app>€ 20,07<\/div>/);
    assert.match(t, /data-importo-banco>€ 78,69<\/div>/);
    // tolti: Totale, la sezione dettagli (consegna, destinazione, pagamento, note), la nota sul prezzo, Annulla e il pulsante vecchio
    assert.doesNotMatch(t, /att-totale|<dt>Totale<\/dt>|Dettagli consegna|att-dettagli|att-dett-|Prezzo definitivo|Annulla ordine|att-annulla|\/elimina|consegnato-prova|>Ordine consegnato</);
    assert.doesNotMatch(t, /sezione-titolo/); // niente titolo "Prodotti"
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine VECCHIO (senza le colonne nuove): gli importi si ricalcolano dai valori di prima; un addebito che comprendeva il materiale non è una consegna', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/70')).text();
    // merce = totale_netto 112,53; servizio = totale_finale − totale_netto = 0; corriere 10,00 -> IVA 2,20 -> in app 12,20; materiale 112,53 + IVA 24,76 = 137,29
    assert.match(t, /Cod\. 12364959 · € 112,53 cad\.[\s\S]*?<span class="att-prezzo-riga">€ 112,53<\/span>/);
    assert.match(t, /<div class="att-voce"><dt>Merce · IVA esclusa<\/dt><dd>€ 112,53<\/dd><\/div>/);
    // l'ordine di prima fu pagato TUTTO in app (149,49): non è la consegna, vale il calcolo
    assert.match(t, /data-importo-app>€ 12,20<\/div>/);
    assert.match(t, /data-importo-banco>€ 137,29<\/div>/);
    assert.doesNotMatch(t, /149,49/);
    const dettaglio = t.slice(t.indexOf('pg-riquadri'));
    assert.match(dettaglio, /Corriere<\/span> <span class="pg-sp">· costo fisso<\/span><\/dt><dd>€ 10,00<\/dd>/);
    assert.match(dettaglio, /IVA 22%<\/span> <span class="pg-sp">· su € 10,00<\/span><\/dt><dd>€ 2,20<\/dd>/);
    assert.match(dettaglio, /IVA 22%<\/span> <span class="pg-sp">· su € 112,53<\/span><\/dt><dd>€ 24,76<\/dd>/);
    assert.match(t, /<a class="att-documenti" href="\/ddt\/70">/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine con il pagamento rimborsato: la consegna è grigia e dice "Rimborsata", senza "pagata"', async () => {
  ordiniProva.attivo = true;
  try {
    const t = await (await chiedi('/ordini/75')).text();
    assert.match(t, /<div class="pg-riga pg-consegna pg-rimborsata">/);
    assert.match(t, /<div class="pg-sub">Rimborsata<\/div>/);
    assert.doesNotMatch(t, /Pagata in app/);
    assert.match(t, /data-importo-app>€ 20,07<\/div>/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('ordine consegnato ma rimasto "inviato" (rotta provvisoria): niente "Annulla", e la rotta rifiuta senza toccare niente', async () => {
  ordiniProva.attivo = true;
  try {
    // la pagina: nessun link, nemmeno per un ordine che a DB è ancora 'inviato'
    const t = await (await chiedi('/ordini/71')).text();
    assert.match(t, /<h2 class="att-titolo">Consegnato<\/h2>/);
    assert.doesNotMatch(t, /Annulla ordine|\/elimina/);

    // chiamando l'URL a mano: errore chiaro, nessuna scrittura
    const prima = registro.length;
    const r = await chiedi('/ordini/71/elimina', { method: 'POST' });
    assert.equal(r.status, 400);
    const e = await r.text();
    assert.match(e, /Ordine già consegnato/);
    assert.match(e, /già stato consegnato e non si può più annullare/);
    assert.match(e, /href="\/ordini\/71"/);
    const dopo = registro.slice(prima);
    assert.deepEqual(dopo.filter((q) => /^(DELETE|UPDATE|INSERT)/.test(q) && !/session|notifications/.test(q)), [], 'nessuna modifica');

    // anche dalla richiesta dell'ordine (/richieste/:id/elimina) vale la stessa regola: stessa funzione
    // un ordine consegnato di un altro cliente o inesistente resta 404 come prima
    assert.equal((await chiedi('/ordini/99/elimina', { method: 'POST' })).status, 404);

    // controllo: un ordine 'inviato' non consegnato resta annullabile (link presente)
    const t72 = await (await chiedi('/ordini/72')).text();
    assert.match(t72, /<button class="att-annulla" type="submit">Annulla ordine<\/button>/);
  } finally {
    ordiniProva.attivo = false;
  }
});

test('JSON malformato: 400 pulito (non 500); corpo enorme: 413', async () => {
  let r = await chiedi('/api/carrello/imposta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{rotto' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
  r = await chiedi('/carrello', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'x'.repeat(200000) }) });
  assert.equal(r.status, 413);
});

test('CSRF: un POST da un altro sito è respinto', async () => {
  const r = await chiedi('/logout', { method: 'POST', headers: { origin: 'http://sito-cattivo.example' } });
  assert.equal(r.status, 403);
});

test('ruolo sbagliato: la pagina del banco a un cliente -> 403', async () => {
  const r = await chiedi('/distributore');
  assert.equal(r.status, 403);
  assert.match(await r.text(), /Accesso non consentito/);
  const j = await chiedi('/api/distributore/novita');
  assert.equal(j.status, 403);
  assert.match(j.headers.get('content-type'), /json/);
});

test('registrazione: "constructor" non è una forma giuridica valida', async () => {
  const r = await chiedi('/registrati', form({ tipo_soggetto: 'constructor', ragione_sociale: 'X' }));
  assert.equal(r.status, 400);
  assert.match(await r.text(), /impresa o una ditta individuale/);
});

test('registrazione: campi troppo lunghi e password oltre 72 caratteri respinti', async () => {
  const r = await chiedi('/registrati', form({
    tipo_soggetto: 'impresa', ragione_sociale: 'x'.repeat(300), username: 'nuovo.utente',
    password: 'p'.repeat(80), password2: 'p'.repeat(80),
  }));
  assert.equal(r.status, 400);
  const t = await r.text();
  assert.match(t, /Nessun campo può superare i 200 caratteri/);
  assert.match(t, /al massimo 72 caratteri/);
});

test('logout: la sessione è distrutta', async () => {
  assert.equal((await chiedi('/logout', { method: 'POST' })).status, 302);
  const dopo = await chiedi('/home');
  assert.equal(dopo.status, 302);
  assert.equal(dopo.headers.get('location'), '/login');
});

// ---- Registrazione a tre passi, collegamento automatico al distributore predefinito, benvenuto ----

const iscrizione = {
  tipo_soggetto: 'impresa', ragione_sociale: 'Rossi Impianti S.r.l.', referente: 'Mario Rossi', email: 'info@rossi.it',
  telefono: '333 1234567', partita_iva: '01234567890', codice_fiscale: '', indirizzo: 'Via Roma 1', cap: '16100',
  citta: 'Genova', provincia: 'GE', sdi_pec: '', username: 'rossimpianti', password: 'password-lunga', password2: 'password-lunga',
};

test('registrati: un solo modulo in tre passi, senza scelta del distributore né note vecchie', async () => {
  cookie = '';
  const t = await (await chiedi('/registrati')).text();
  assert.equal(t.match(/<form /g).length, 1);
  assert.match(t, /<form method="POST" action="\/registrati" data-reg-form>/);
  assert.equal(t.match(/data-reg-passo/g).length, 3);
  for (const x of ['La tua impresa', 'Dati di fatturazione', 'Accesso', 'Passo 1 di 3', 'Passo 2 di 3', 'Passo 3 di 3', 'Registra la tua impresa']) {
    assert.ok(t.includes(x), x);
  }
  assert.match(t, /data-passo-iniziale="1"/);
  // forma giuridica: i due valori, "Impresa" già scelta
  assert.match(t, /value="impresa" checked required/);
  assert.match(t, /value="ditta_individuale"\s+required/);
  // autocomplete corretti
  for (const a of ['username', 'new-password', 'organization', 'email', 'tel', 'street-address', 'postal-code']) {
    assert.ok(t.includes('autocomplete="' + a + '"'), a);
  }
  // hint al posto degli asterischi
  assert.match(t, /Tutto attaccato: lettere, numeri, punto o trattino\./);
  assert.match(t, /Almeno 8 caratteri\./);
  assert.match(t, /Facoltativo, se diverso dalla Partita IVA/);
  assert.match(t, /Facoltativo: serve per la fattura elettronica/);
  assert.match(t, /I dati fiscali servono per intestare bolle e fatture\./);
  assert.doesNotMatch(t, /<label[^>]*>[^<]*\*/);
  // via le sezioni e le note sui distributori
  assert.doesNotMatch(t, /name="distributori"|I tuoi distributori|Per ora tutte le consegne|ai distributori che indichi/);
  // due password con l'occhio e fascia fissa con il pulsante
  assert.equal(t.match(/data-mostra-password/g).length, 2);
  assert.match(t, /Hai già un account\? <a href="\/login">Accedi<\/a>/);
});

test('registrati: dopo un errore si riapre sul primo passo sbagliato e i dati restano', async () => {
  const casi = [
    [{ tipo_soggetto: 'constructor' }, 1, 'impresa o una ditta individuale'],
    [{ email: 'non-una-email' }, 1, "L&#39;email non sembra valida"],
    [{ partita_iva: '123' }, 2, 'La partita IVA deve avere 11 cifre'],
    [{ cap: '12' }, 2, 'Il CAP deve avere 5 cifre'],
    [{ username: 'ab' }, 3, 'Il nome utente può avere da 3 a 30 caratteri'],
    [{ password2: 'un-altra-password' }, 3, 'Le due password non coincidono'],
    // errori in più passi: vale il primo
    [{ partita_iva: '123', password2: 'diversa' }, 2, 'La partita IVA deve avere 11 cifre'],
    [{ email: 'x', partita_iva: '123', username: 'ab' }, 1, 'Controlla questi punti'],
  ];
  for (const [modifica, passo, testo] of casi) {
    const r = await chiedi('/registrati', form({ ...iscrizione, ...modifica }));
    const t = await r.text();
    const descrizione = JSON.stringify(modifica);
    assert.equal(r.status, 400, descrizione);
    assert.match(t, new RegExp(`data-passo-iniziale="${passo}"`), descrizione);
    assert.ok(t.includes(testo), descrizione + ' -> ' + testo);
    assert.match(t, /Controlla questi punti/, descrizione);
    // i campi già compilati restano pieni (le password no)
    assert.match(t, /value="Rossi Impianti S\.r\.l\."/, descrizione);
    assert.match(t, /value="Mario Rossi"/, descrizione);
    assert.doesNotMatch(t, /value="password-lunga"/, descrizione);
  }
  // il campo sbagliato è segnato
  const t = await (await chiedi('/registrati', form({ ...iscrizione, partita_iva: '123' }))).text();
  assert.match(t, /id="partita_iva"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(t, /id="ragione_sociale"[^>]*aria-invalid/);
});

test('registrati: collegamento automatico a BOREA SRL (tutte le filiali) e schermata di benvenuto', async () => {
  registrazione.attiva = true;
  Object.assign(registrazione, { cercato: null, legamiCreati: [], stato: 'approvato', sql: [] });
  try {
    // "distributori" nel corpo non conta più: il legame è sempre quello predefinito
    let r = await chiedi('/registrati', form({ ...iscrizione, distributori: '99' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/benvenuto');
    assert.equal(registrazione.cercato, 'BOREA SRL');
    assert.deepEqual(registrazione.legamiCreati, [[utente.id, 2], [utente.id, 181]]);

    // approvazione automatica: legami già approvati su tutte le filiali, anagrafica attiva, nessuna notifica da confermare
    const legami = registrazione.sql.filter((q) => /INSERT INTO client_distributors/.test(q.s));
    assert.equal(legami.length, 2);
    for (const q of legami) assert.match(q.s, /VALUES \(\?, \?, 'approvato', NOW\(\)\)/);
    const nuovoUtente = registrazione.sql.find((q) => /INSERT INTO users/.test(q.s));
    assert.ok(nuovoUtente.p.includes('attivo') && !nuovoUtente.p.includes('in_attesa'), 'anagrafica attiva');
    assert.equal(registrazione.sql.filter((q) => /INSERT INTO notifications/.test(q.s)).length, 0, 'niente notifiche');

    r = await chiedi('/benvenuto');
    assert.equal(r.status, 200);
    let t = await r.text();
    assert.match(t, /Benvenuto in Ordini Minuteria/);
    assert.match(t, /L’anagrafica di <strong>Prova S\.r\.l\.<\/strong> è pronta\./);
    assert.match(t, /Il tuo distributore<\/div>\s*<div class="ben-nome">BOREA SRL</);
    assert.doesNotMatch(t, /confermerà a breve/); // già approvato
    assert.match(t, /<a class="acc-btn" href="\/home">Vai al catalogo<\/a>/);
    assert.match(t, /<a class="ben-link" href="\/profilo">Vedi la mia anagrafica<\/a>/);
    assert.doesNotMatch(t, /class="navbar"|class="appbar"/);

    // APPROVAZIONE_AUTOMATICA=0: si torna alla conferma a mano (legame in attesa, notifica al cliente, riga "confermerà a breve")
    process.env.APPROVAZIONE_AUTOMATICA = '0';
    Object.assign(registrazione, { legamiCreati: [], stato: 'in_attesa', sql: [] });
    await chiedi('/logout', { method: 'POST' });
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    for (const q of registrazione.sql.filter((x) => /INSERT INTO client_distributors/.test(x.s))) {
      assert.match(q.s, /'in_attesa'\)/);
      assert.doesNotMatch(q.s, /approvato/);
    }
    assert.ok(registrazione.sql.find((q) => /INSERT INTO users/.test(q.s)).p.includes('in_attesa'));
    assert.ok(registrazione.sql.some((q) => /INSERT INTO notifications/.test(q.s)), 'notifica "iscrizione inviata"');
    t = await (await chiedi('/benvenuto')).text();
    assert.match(t, /BOREA SRL confermerà a breve che sei suo cliente\./);
    delete process.env.APPROVAZIONE_AUTOMATICA;
    registrazione.stato = 'approvato';

    // il distributore predefinito si cambia dal .env: id di una filiale, o nome della ditta
    registrazione.legamiCreati = [];
    process.env.DISTRIBUTORE_PREDEFINITO = '181';
    await chiedi('/logout', { method: 'POST' });
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    assert.equal(registrazione.cercato, 181);
    assert.deepEqual(registrazione.legamiCreati, [[utente.id, 2], [utente.id, 181]], 'con tutte le filiali della ditta');

    // un distributore che non esiste non blocca la registrazione: nessun legame, e un errore nel log
    registrazione.legamiCreati = [];
    process.env.DISTRIBUTORE_PREDEFINITO = '999';
    await chiedi('/logout', { method: 'POST' });
    const prima = erroriServer.length;
    r = await chiedi('/registrati', form(iscrizione));
    assert.equal(r.status, 302);
    assert.deepEqual(registrazione.legamiCreati, []);
    assert.match(erroriServer[prima], /distributore predefinito "999" non trovato/);
    erroriServer.splice(prima, 1); // atteso: non è un errore inatteso per la prova finale
    t = await (await chiedi('/benvenuto')).text();
    assert.match(t, /Benvenuto in Ordini Minuteria/);
    assert.doesNotMatch(t, /Il tuo distributore/);
  } finally {
    delete process.env.DISTRIBUTORE_PREDEFINITO;
    delete process.env.APPROVAZIONE_AUTOMATICA;
    registrazione.attiva = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('benvenuto: senza accesso si va al login', async () => {
  const r = await chiedi('/benvenuto');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
});

test('home del banco: bacheca a tre colonne, senza interruttore né riquadri contatore', async () => {
  cookie = '';
  banco.attivo = true;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);
    r = await chiedi('/distributore');
    assert.equal(r.status, 200);
    const t = await r.text();

    // intestazione: ditta e filiale, menu a schede con il pallino dei clienti da approvare, Storico ordini, niente campanella
    assert.match(t, /class="banco-ditta">BOREA SRL</);
    assert.match(t, /class="banco-filiale">Banco Genova Fegino</);
    assert.match(t, /class="banco-voce attiva" href="\/distributore" aria-current="page"/);
    assert.match(t, /href="\/distributore\/clienti">[\s\S]*?Clienti\s*<span class="banco-voce-pallino"[^>]*>2</);
    assert.match(t, /class="banco-storico" href="\/distributore\/storico">Storico ordini</);
    assert.doesNotMatch(t, /banco-campanella|Tutti gli ordini|Storico richieste|href="\/notifiche"/);
    assert.match(t, /<span class="avatar avatar-40"[^>]*>BG</); // iniziali di "Banco Genova Fegino"
    assert.match(t, /<nav class="navbar nav-solo-stretta">/); // da 900px in su il menu in basso non si mostra

    // niente più interruttore, riquadri contatore né riga "filiale · zona"
    assert.doesNotMatch(t, /toggle-banco|Banco operativo|Ricezione attiva|In pausa|riquadri-conta|conta-box|zona Genova/);

    // le tre colonne, in ordine, ognuna con il numero delle sue schede
    const iConferma = t.indexOf('id="col-conferma"');
    const iCorriere = t.indexOf('id="col-corriere"');
    const iPreparare = t.indexOf('id="col-preparare"');
    assert.ok(iConferma > 0 && iConferma < iCorriere && iCorriere < iPreparare, 'ordine delle colonne');
    assert.match(t, /col-conferma">Da confermare<\/h2>\s*<span class="colonna-conta" aria-label="2 richieste">2</);
    assert.match(t, /col-corriere">Attesa corriere<\/h2>\s*<span class="colonna-conta" aria-label="1 richieste">1</);
    assert.match(t, /col-preparare">Da preparare<\/h2>\s*<span class="colonna-conta" aria-label="2 ordini">2</);
    for (const soglia of ['data-soglia-urgente="180"', 'data-soglia-arrivo="15"']) assert.ok(t.includes(soglia), soglia);

    // Da confermare: anello, timer, "Nuova" (447 s rimasti su 600: arrivata da 2 min 33 s), articoli, due pulsanti
    assert.equal(t.match(/data-richiesta /g).length, 2);
    assert.match(t, /data-secondi="447" data-finestra="600"/);
    assert.match(t, /data-tempo>07:27</);
    assert.equal(t.match(/data-nuova>Nuova</g).length, 1, 'solo la prima è ancora "Nuova"');
    assert.match(t, /scheda-richiesta urgente/); // la seconda: 95 s
    assert.match(t, /2 articoli · 3 pezzi/);
    assert.match(t, /1 articolo · 1 pezzo/);
    assert.match(t, /<span class="articolo-qta">2×<\/span>[\s\S]*?Bocchettone A 90°[\s\S]*?Cod\. 12352992/);
    assert.doesNotMatch(t, /Verifica e conferma/);
    // "Conferma": un form che risponde subito (prezzo_richiesto) e torna alla home, senza passare dal dettaglio
    assert.equal(t.match(/>Conferma<\/button>/g).length, 2);
    assert.match(t, /<form class="scheda-azione-conferma" method="POST" action="\/distributore\/richieste\/11\/rispondi">\s*<input type="hidden" name="azione" value="prezzo_richiesto">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-conferma btn-banco-medio" type="submit">Conferma<\/button>/);
    // sotto, affiancati: "Ispeziona" (un link al dettaglio, con l'occhio) e "Non disponibile" (rifiuta subito)
    assert.match(t, /<div class="scheda-azioni-secondarie">\s*<a class="btn-banco btn-banco-secondario btn-banco-piccolo" href="\/distributore\/richieste\/11"><svg[\s\S]*?<\/svg>Ispeziona<\/a>/);
    assert.match(t, /action="\/distributore\/richieste\/11\/rispondi">\s*<input type="hidden" name="azione" value="rifiuta">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-secondario btn-banco-piccolo" type="submit">Non disponibile</);
    assert.equal(t.match(/>Ispeziona<\/a>/g).length, 4, 'due in "Da confermare", uno in "Attesa corriere" e uno in "Da preparare" (l\'ordine con la richiesta)');
    // i nomi vengono dal DB: mai HTML grezzo
    assert.ok(t.includes('Rossi &lt;b&gt;Impianti&lt;/b&gt; S.r.l.'));
    assert.doesNotMatch(t, /<b>Impianti<\/b>/);

    // Attesa corriere: "da 3 min" (190 s), nota grigia; "Ispeziona" nella riga del titolo, il nome non è più un link
    assert.match(t, /Corriere avvisato · da <span data-da>3 min</);
    assert.match(t, /<h3 class="scheda-nome">Verdi S\.n\.c\.<\/h3>/);
    assert.match(t, /<a class="btn-ispeziona" href="\/distributore\/richieste\/21" aria-label="Ispeziona la richiesta di Verdi S\.n\.c\."><svg[\s\S]*?<\/svg>Ispeziona<\/a>/);
    assert.doesNotMatch(t, /<a href="\/distributore\/richieste\/21">/);
    // "Da preparare": Ispeziona solo sull'ordine che ha una richiesta da aprire
    assert.equal(t.slice(t.indexOf('id="col-preparare"')).match(/>Ispeziona<\/a>/g).length, 1);
    assert.match(t, /Confermato da te\. Non preparare ancora: aspetta che un corriere prenda la consegna\./);
    assert.match(t, /data-corriere data-trascorsi="190"/);

    // Da preparare: pillola con minuti e ora solo se c'è il corriere; "Prepara" porta all'ordine
    assert.match(t, /Ordine #1280 · ritira Marco/);
    assert.match(t, /data-arrivo data-secondi="480">\s*<span class="pillola-min" data-arrivo-min>8 min</);
    assert.match(t, /pillola-arrivo vicino/); // 8 minuti: sotto i 15
    assert.match(t, /Ordine #1281\s*<\/div>/); // senza corriere nessun "ritira", nessuna pillola
    assert.equal(t.match(/data-arrivo /g).length, 1);
    // ... con "Ispeziona" (la richiesta dell'ordine, col timer del corriere) e "Preparato" (toglie l'ordine dalla colonna)
    assert.doesNotMatch(t, /btn-banco-prepara"[^>]*href|>\s*<svg[^>]*>[\s\S]*?<\/svg>Prepara\s*</);
    assert.match(t, /<a class="btn-banco btn-banco-secondario btn-banco-piccolo" href="\/distributore\/richieste\/177"><svg[\s\S]*?<\/svg>Ispeziona<\/a>\s*<form method="POST" action="\/distributore\/ordini\/1280\/preparazione">\s*<input type="hidden" name="torna" value="home">\s*<button class="btn-banco btn-banco-prepara btn-banco-piccolo" type="submit"><svg[\s\S]*?<\/svg>Preparato<\/button>/);
    // l'ordine 1281 non ha una richiesta: niente Ispeziona, solo Preparato
    assert.match(t, /<div class="scheda-azioni-ordine">\s*<form method="POST" action="\/distributore\/ordini\/1281\/preparazione">/);
    assert.equal(t.match(/>Preparato<\/button>/g).length, 2);

    // la pausa della ricezione non esiste più
    r = await chiedi('/api/distributore/stato', json({ attivo: false }));
    assert.equal(r.status, 404);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: stessa intestazione e stessa tendina su ogni pagina, senza "Punti vendita"', async () => {
  cookie = '';
  banco.attivo = true;
  // intestazione e tendina così come stanno nella pagina (la voce attiva cambia da pagina a pagina)
  const testa = (t) => t.match(/<header class="banco-testa">[\s\S]*?<\/header>/)[0];
  const tendina = (t) => t.match(/<div class="tendina" data-menu-tendina hidden>[\s\S]*?<\/form>\s*<\/div>/)[0];
  const senzaAttiva = (h) => h.replace(/ attiva"/g, '"').replace(/ aria-current="page"/g, '');
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    const pagine = {};
    for (const [nome, percorso, stato] of [
      ['home', '/distributore', 200],
      ['clienti', '/distributore/clienti', 200],
      ['storico', '/distributore/storico', 200],
      ['notifiche', '/notifiche', 200],
      ['errore', '/distributore/ordini/999', 404],
    ]) {
      r = await chiedi(percorso);
      assert.equal(r.status, stato, percorso);
      pagine[nome] = await r.text();
      assert.match(pagine[nome], /<header class="banco-testa">/, nome);
      assert.doesNotMatch(pagine[nome], /<header class="appbar">/, nome + ': niente appbar vecchia');
    }

    // la barra e la scheda dell'utente sono identiche (a parte la voce attiva) su tutte le pagine
    for (const nome of Object.keys(pagine)) {
      assert.equal(senzaAttiva(testa(pagine[nome])), senzaAttiva(testa(pagine.home)), nome + ': intestazione');
      assert.equal(tendina(pagine[nome]), tendina(pagine.home), nome + ': tendina');
    }
    assert.match(testa(pagine.home), /class="banco-voce attiva" href="\/distributore"/);
    assert.match(testa(pagine.clienti), /class="banco-voce attiva" href="\/distributore\/clienti"/);
    // "Storico ordini" è accesa sullo storico e dentro un ordine (qui un ordine inesistente: la pagina d'errore ha la stessa barra)
    assert.match(testa(pagine.storico), /class="banco-storico attiva" href="\/distributore\/storico" aria-current="page"/);
    assert.match(testa(pagine.errore), /class="banco-storico attiva" href="\/distributore\/storico" aria-current="page"/);
    assert.doesNotMatch(testa(pagine.home), /banco-storico attiva/);
    assert.doesNotMatch(testa(pagine.notifiche), /banco-storico attiva/);

    // le pagine interne hanno sotto la barra la freccia e il loro titolo; la home no. "Clienti" è una scheda del
    // menu, non una pagina interna: ha il suo titolo con la ricerca e nessuna freccia indietro.
    assert.doesNotMatch(pagine.home, /banco-titolo/);
    assert.doesNotMatch(pagine.clienti, /banco-titolo|banco-indietro/);
    assert.match(pagine.clienti, /<h1 class="cli-titolo">Clienti<\/h1>/);
    // lo storico è una scheda dell'intestazione come Clienti: il suo titolo sta nella pagina, senza freccia indietro
    assert.doesNotMatch(pagine.storico, /banco-titolo|banco-indietro/);
    assert.match(pagine.storico, /<h1 class="sto-titolo">Storico ordini<\/h1>/);
    assert.match(pagine.notifiche, /<h1 class="banco-titolo-testo">Notifiche<\/h1>/);
    assert.match(pagine.errore, /<h1 class="banco-titolo-testo">Non trovato<\/h1>/);

    // la tendina: niente "Punti vendita" né in pagina né come indirizzo
    const t = tendina(pagine.home);
    assert.match(t, /<a class="voce-solo-piccola" href="\/distributore\/storico">Storico ordini<\/a>/);
    assert.doesNotMatch(t, /Storico richieste|Tutti gli ordini/);
    assert.match(t, /class="voce-esci">Esci</);
    for (const nome of Object.keys(pagine)) assert.doesNotMatch(pagine[nome], /Punti vendita|\/punti-vendita/, nome);

    // /punti-vendita: per il banco è come se non esistesse
    r = await chiedi('/punti-vendita');
    assert.equal(r.status, 404);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: elenco clienti con tabella e campo di ricerca, senza freccia indietro', async () => {
  cookie = '';
  banco.attivo = true;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    const prima = registro.length;
    r = await chiedi('/distributore/clienti');
    assert.equal(r.status, 200);
    const t = await r.text();
    // l'ultimo ordine di ogni cliente arriva con la query dell'elenco: una sola, non una per riga
    assert.equal(registro.slice(prima).filter((q) => /^SELECT cd\.\*, u\.id AS cliente_id/.test(q)).length, 1);

    // testata: scheda Clienti attiva, titolo e campo di ricerca; niente freccia, niente frase lunga sotto la sezione
    assert.match(t, /class="banco-voce attiva" href="\/distributore\/clienti"/);
    assert.doesNotMatch(t, /banco-titolo|banco-indietro|Approva solo le anagrafiche|inviarti richieste e vedere/);
    assert.match(t, /<h1 class="cli-titolo">Clienti<\/h1>/);
    assert.match(t, /<input type="search" data-cerca-clienti placeholder="Cerca per nome, P\. IVA o codice"/);
    assert.match(t, /data-cerca-nessuno role="status" hidden>Nessun cliente trovato\.</);

    // da approvare: pillola col numero, nota corta, scheda con le iniziali, etichetta, dati separati e "Verifica"
    assert.match(t, /id="cli-titolo-approvare">Da approvare<\/h2>\s*<span class="cli-pillola"[^>]*>1<\/span>\s*<span class="cli-sezione-nota">Approva solo chi riconosci come tuo cliente\.</);
    assert.match(t, /<span class="avatar avatar-48 avatar-arancio"[^>]*>AX</);
    assert.match(t, /Agenzia xxx<\/strong>\s*<span class="cli-etichetta cli-etichetta-arancio">Da verificare</);
    assert.match(t, /<span>Ditta individuale<\/span>\s*<span>P\. IVA <strong>00000000000<\/strong><\/span>\s*<span>Genova \(GE\)<\/span>/);
    assert.match(t, /Iscritto il 08\/09\/2026, 19:09</); // ora italiana (la colonna è UTC)
    assert.match(t, /class="cli-verifica" href="\/distributore\/clienti\/31"[^>]*>Verifica <svg/);
    assert.doesNotMatch(t, /stato-badge/);

    // approvati: tabella a cinque colonne, in ordine di ragione sociale (il DB finto li dà alla rinfusa)
    assert.match(t, /id="cli-titolo-approvati">Clienti approvati<\/h2>\s*<span class="cli-conta"[^>]*>2</);
    assert.match(t, /<span>Cliente<\/span><span>Codice cliente<\/span><span>Città<\/span><span>Ultimo ordine<\/span><span><\/span>/);
    const iBianchi = t.indexOf('Bianchi Idraulica S.n.c.');
    const iRossi = t.indexOf('Rossi &lt;b&gt;Impianti&lt;/b&gt; S.r.l.');
    assert.ok(iBianchi > 0 && iBianchi < iRossi, 'ordinati per ragione sociale');
    assert.doesNotMatch(t, /<b>Impianti<\/b>/);
    assert.match(t, /<a class="cli-tab-riga" href="\/distributore\/clienti\/32">[\s\S]*?<span class="avatar avatar-40"[^>]*>RO</);
    assert.match(t, /<span class="cli-c-codice"><span class="cli-solo-stretta">Cod\. <\/span>DEMO-ROSSI<\/span>/);
    assert.match(t, /<span class="cli-c-citta">GENOVA \(GE\)<\/span>/); // la città com'è salvata, senza correggerla
    assert.match(t, /<span class="cli-solo-stretta">Ultimo ordine <\/span>10\/10\/2026<\/span>/);
    // senza codice né ordini: trattino, e su schermo stretto la voce del codice si nasconde
    assert.match(t, /<span class="cli-c-codice cli-c-manca"><span class="cli-solo-stretta">Cod\. <\/span>—<\/span>/);
    assert.match(t, /<span class="cli-solo-stretta">Ultimo ordine <\/span>—<\/span>/);
    // la ricerca confronta ragione sociale, partita IVA e codice cliente
    assert.match(t, /data-cerca="Rossi &lt;b&gt;Impianti&lt;\/b&gt; S\.r\.l\. 12345678901 DEMO-ROSSI"/);

    // non riconosciuti: restano raggiungibili (da lì si può ripensarci)
    assert.match(t, /id="cli-titolo-rifiutati">Non riconosciuti<\/h2>/);
    assert.match(t, /href="\/distributore\/clienti\/34">[\s\S]*?avatar-grigio[\s\S]*?Neri Impianti[\s\S]*?cli-etichetta-rosso">Rifiutato</);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: pagina del cliente a due colonne (da verificare, approvato, rifiutato) e decisione', async () => {
  cookie = '';
  banco.attivo = true;
  banco.decisioni.length = 0;
  try {
    let r = await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }));
    assert.equal(r.status, 302);

    // ----- da verificare -----
    r = await chiedi('/distributore/clienti/31');
    assert.equal(r.status, 200);
    let t = await r.text();
    assert.match(t, /class="banco-voce attiva" href="\/distributore\/clienti"/);
    assert.doesNotMatch(t, /banco-titolo|banco-indietro/);
    assert.match(t, /<a class="cli-indietro" href="\/distributore\/clienti">[\s\S]*?<\/svg>Clienti<\/a>/);
    // testata: cerchio arancio da 56, nome, etichetta e riga "tipo · referente · iscritto il ... alle ..."
    assert.match(t, /<span class="avatar avatar-56 avatar-arancio"[^>]*>AX</);
    assert.match(t, /<h1 class="cli-nome-grande">Agenzia xxx<\/h1>\s*<span class="cli-etichetta cli-etichetta-arancio">Da verificare</);
    assert.match(t, /Ditta individuale · referente Fra · iscritto il 08\/09\/2026 alle 19:09</);
    assert.equal((t.match(/iscritto il/gi) || []).length, 1, 'la data sta solo nella testata');
    // dati di fatturazione in tre colonne, VIES in una nuova scheda, poi sede legale e consegna abituale
    assert.match(t, /Dati di fatturazione<\/h2>\s*<dl class="cli-dati cli-dati-3">/);
    assert.match(t, /Partita IVA<\/dt>\s*<dd class="cli-dato-val cli-cifre">00000000000</);
    assert.match(t, /Codice fiscale<\/dt>\s*<dd class="cli-dato-val cli-cifre">00000000000</);
    assert.match(t, /Codice SDI \/ PEC<\/dt>\s*<dd class="cli-dato-val cli-cifre">N92glon</);
    assert.match(t, /href="https:\/\/ec\.europa\.eu\/taxation_customs\/vies\/[^"]*"\s+target="_blank" rel="noopener">Controlla su VIES/);
    assert.match(t, /Sede legale<\/dt>\s*<dd class="cli-dato-val">Pio 21<\/dd>\s*<dd class="cli-dato-det">16100 Genova \(GE\)<\/dd>/);
    assert.match(t, /Consegna abituale<\/dt>\s*<dd class="cli-dato-val">Via Puggia 22\/3<\/dd>\s*<dd class="cli-dato-det">16131 Genova \(GE\)<\/dd>/);
    // contatti: due riquadri cliccabili
    assert.match(t, /<a class="cli-contatto" href="tel:010123456">[\s\S]*?Telefono<\/span>\s*<span class="cli-contatto-val cli-cifre">010 123 456</);
    assert.match(t, /<a class="cli-contatto" href="mailto:fra@example\.com">[\s\S]*?Email<\/span>\s*<span class="cli-contatto-val">fra@example\.com</);
    // riquadro di approvazione: stessi campi e stessi valori di sempre; la conferma c'è solo sul rifiuto
    assert.match(t, /<h2 id="cli-titolo-decisione">È un tuo cliente\?<\/h2>\s*<p>Se lo approvi potrà mandarti richieste e vedrà le condizioni che imposti\.<\/p>/);
    assert.match(t, /<form method="POST" action="\/distributore\/clienti\/31\/decidi">/);
    assert.match(t, /Codice cliente nel tuo gestionale <span>· facoltativo<\/span>/);
    assert.match(t, /<input class="cli-campo" type="text" id="codice_cliente" name="codice_cliente" placeholder="es\. 004512"/);
    assert.match(t, /Note interne <span>· le vedi solo tu<\/span>/);
    assert.match(t, /<textarea class="cli-campo" id="note" name="note" rows="3"/);
    assert.match(t, /<button class="cli-approva" type="submit" name="azione" value="approva">\s*<svg[\s\S]*?<\/svg>Sì, approva\s*<\/button>/);
    assert.match(t, /<button class="cli-rifiuta" type="submit" name="azione" value="rifiuta"\s+onclick="return confirm\([^"]*"[^>]*>\s*<svg[\s\S]*?<\/svg>Non lo riconosco: rifiuta/);
    assert.equal((t.match(/onclick="return confirm/g) || []).length, 1, 'la conferma è solo sul rifiuto');
    assert.doesNotMatch(t, /\/sconti|Sconti concordati/);

    // ----- approvato: poche informazioni, le voci vuote non si disegnano -----
    r = await chiedi('/distributore/clienti/32');
    assert.equal(r.status, 200);
    t = await r.text();
    assert.match(t, /<span class="avatar avatar-56"[^>]*>RO</); // blu
    assert.match(t, /cli-etichetta cli-etichetta-verde">Approvato</);
    assert.match(t, /Impresa · iscritto il 08\/09\/2026 alle 19:09</); // senza referente
    assert.doesNotMatch(t, /referente|Codice fiscale|Codice SDI|Consegna abituale|Telefono|href="tel:/);
    assert.match(t, /href="mailto:rossi@example\.com"/);
    assert.match(t, /Sede legale<\/dt>\s*<dd class="cli-dato-val">Via Roma 1<\/dd>\s*<dd class="cli-dato-det">16121 GENOVA \(GE\)<\/dd>/);
    // a destra codice, note e sconti, con gli stessi campi di prima
    assert.match(t, /Codice cliente<\/dt>\s*<dd class="cli-dato-val cli-cifre">DEMO-ROSSI</);
    assert.match(t, /Note interne<\/dt>\s*<dd class="cli-dato-val cli-dato-note">Paga a 30 giorni</);
    assert.match(t, /<form method="POST" action="\/distributore\/clienti\/32\/sconti">/);
    assert.match(t, /name="sconto1_macro_idraulica"/);
    assert.match(t, /name="sconto5_macro_scarichi"/);
    assert.match(t, /Salva gli sconti/);
    assert.doesNotMatch(t, /È un tuo cliente\?|cli-approva|\/decidi/);

    // ----- rifiutato: si può ripensarci con lo stesso POST -----
    r = await chiedi('/distributore/clienti/34');
    assert.equal(r.status, 200);
    t = await r.text();
    assert.match(t, /<span class="avatar avatar-56 avatar-grigio"[^>]*>NI</);
    assert.match(t, /cli-etichetta cli-etichetta-rosso">Rifiutato</);
    assert.match(t, /Hai rifiutato questa anagrafica: Mai visto\./);
    assert.match(t, /action="\/distributore\/clienti\/34\/decidi">\s*<input type="hidden" name="codice_cliente" value="">\s*<button class="cli-approva" type="submit" name="azione" value="approva">/);

    // ----- un cliente che non è del banco: 404 -----
    r = await chiedi('/distributore/clienti/999');
    assert.equal(r.status, 404);

    // ----- la decisione non è cambiata: stessi campi, stessi valori, stesso redirect -----
    r = await chiedi('/distributore/clienti/31/decidi', form({ azione: 'approva', codice_cliente: '004512', note: 'Cliente storico' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore/clienti/31');
    r = await chiedi('/distributore/clienti/31/decidi', form({ azione: 'rifiuta', codice_cliente: '', note: '' }));
    assert.equal(r.status, 302);
    assert.deepEqual(banco.decisioni, [
      ['approvato', '004512', 'Cliente storico', 131],
      ['rifiutato', '', '', 131],
    ]);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: Storico ordini con schede, periodo, righe raggruppate per giorno e stati', async () => {
  cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    storicoBanco.viste.length = 0;
    const r = await chiedi('/distributore/storico');
    assert.equal(r.status, 200);
    const t = await r.text();

    // titolo, ricerca (con i filtri in campi nascosti), segmenti del periodo (di default 7 giorni), nessuna freccia indietro
    assert.match(t, /<title>[^<]*Storico ordini/);
    assert.match(t, /<h1 class="sto-titolo">Storico ordini<\/h1>/);
    assert.match(t, /<form class="sto-cerca" method="get" action="\/distributore\/storico" role="search">\s*<input type="hidden" name="stato" value="tutti">\s*<input type="hidden" name="periodo" value="7">/);
    assert.match(t, /type="search" name="q" value=""[^>]*data-non-ricaricare[^>]*placeholder="Cliente, n° ordine o DDT"/);
    assert.match(t, /data-storico-svuota aria-label="Svuota la ricerca" hidden>/); // senza testo la "×" non c'è
    assert.deepEqual(
      [...t.matchAll(/<a href="(\/distributore\/storico\?[^"]*)" class="(attivo)?"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[3], m[1], m[2] || '']),
      [
        ['Oggi', '/distributore/storico?stato=tutti&amp;periodo=oggi', ''],
        ['7 giorni', '/distributore/storico?stato=tutti&amp;periodo=7', 'attivo'],
        ['30 giorni', '/distributore/storico?stato=tutti&amp;periodo=30', ''],
        ['Tutti', '/distributore/storico?stato=tutti&amp;periodo=tutti', ''],
      ]
    );

    // schede: numeri dai conteggi, "Tutti" attiva e senza pallino, le altre con il pallino del loro stato
    const schede = [...t.matchAll(/<a class="sto-scheda( attiva)?( vuota)?" href="([^"]*)"[^>]*>\s*(?:<span class="sto-punto sto-st-(\w+)"[^>]*><\/span>)?\s*<span class="sto-scheda-nome">([^<]*)<\/span>\s*<span class="sto-scheda-num">(\d+)<\/span>/g)]
      .map((m) => [m[5], Number(m[6]), !!m[1], m[4] || '', m[3]]);
    assert.deepEqual(schede, [
      ['Tutti', 4, true, '', '/distributore/storico?stato=tutti&amp;periodo=7'],
      ['Da preparare', 1, false, 'da_preparare', '/distributore/storico?stato=da_preparare&amp;periodo=7'],
      ['In preparazione', 1, false, 'in_preparazione', '/distributore/storico?stato=in_preparazione&amp;periodo=7'],
      ['Partiti', 1, false, 'partito', '/distributore/storico?stato=partiti&amp;periodo=7'],
      ['Consegnati', 1, false, 'consegnato', '/distributore/storico?stato=consegnati&amp;periodo=7'],
    ]);

    // tabella: intestazione, due giorni (Oggi e una data fissa con l'anno), i conteggi del giorno, nessuna "Flusso del banco"
    assert.match(t, /<span>Ordine<\/span><span>Ora<\/span><span>Cliente<\/span><span>Materiale<\/span>\s*<span class="sto-c-totale">Totale<\/span><span>DDT<\/span><span>Stato<\/span>/);
    const giorni = [...t.matchAll(/<div class="sto-giorno">\s*<strong>([^<]*)<\/strong>\s*<span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(giorni, [['Oggi', '2 ordini'], ['12 marzo 2025', '2 ordini']]);
    assert.doesNotMatch(t, /Flusso del banco/);

    // ogni riga è un solo link al dettaglio dell'ordine; ordine decrescente
    const righe = t.split('<a class="sto-riga"').slice(1).map((x) => x.slice(0, x.indexOf('</a>')));
    assert.equal(righe.length, 4);
    assert.deepEqual(righe.map((x) => x.match(/^ href="([^"]*)"/)[1]), ['/distributore/ordini/91', '/distributore/ordini/90', '/distributore/ordini/89', '/distributore/ordini/88']);
    const [r91, r90, r89, r88] = righe;
    // #91: da preparare, cliente (con il nome escapato) e città, un solo articolo, totale con IVA, nessun DDT
    assert.match(r91, /sto-c-ordine">#91</);
    assert.match(r91, /sto-c-ora">\d\d:\d\d</);
    assert.match(r91, /sto-cliente-nome">Rossi &lt;b&gt;Impianti&lt;\/b&gt; S\.r\.l\.<\/strong>\s*<small class="sto-cliente-citta">Genova</);
    assert.match(r91, /sto-mat-nome">1× 87 Elemento A &#34;t&#34; 87gr Diam\. 100<\/span>\s*<\/span>/);
    assert.doesNotMatch(r91, /sto-mat-altri/);
    assert.match(r91, /sto-c-totale">€ 122,53</);
    assert.match(r91, /sto-c-ddt sto-senza">\s*<span class="sto-nessuno">—<\/span>/);
    assert.match(r91, /<span class="sto-pillola sto-st-da_preparare"><span class="sto-punto" aria-hidden="true"><\/span>Da preparare<\/span>/);
    // #90: in preparazione, "+ 1 articolo", senza città; il totale vecchio (totale_ivato 0) è la merce
    assert.match(r90, /<span class="sto-pillola sto-st-in_preparazione">[\s\S]*?In preparazione<\/span>/);
    assert.match(r90, /sto-mat-nome">2× Bocchettone A 90°<\/span><span class="sto-mat-altri">\+ 1 articolo<\/span>/);
    assert.doesNotMatch(r90, /sto-cliente-citta/);
    assert.match(r90, /sto-c-totale">€ 54,00</);
    // #89: partito, "+ 2 articoli", DDT, ora italiana (10:40 UTC = 11:40 a Roma d'inverno)
    assert.match(r89, /sto-st-partito">[\s\S]*?Partito<\/span>/);
    assert.match(r89, /sto-mat-altri">\+ 2 articoli</);
    assert.match(r89, /sto-c-ddt">\s*<span class="sto-ddt-sigla">DDT <\/span>A\/89\s*</);
    assert.match(r89, /sto-c-ora">11:40</);
    // #88: consegnato_il vale più dello stato: resta 'inviato' ma è Consegnato; senza righe "—"
    assert.match(r88, /sto-st-consegnato">[\s\S]*?Consegnato<\/span>/);
    assert.doesNotMatch(r88, /Da preparare/);
    assert.match(r88, /sto-c-materiale">\s*<span class="sto-nessuno">—</);

    // le query: una per i conteggi, una per la pagina, UNA per il materiale di tutta la pagina; periodo 7 -> parametro 7
    const viste = storicoBanco.viste.map((v) => v.tipo).sort();
    assert.deepEqual(viste, ['conteggi', 'lista', 'materiale']);
    const conteggi = storicoBanco.viste.find((v) => v.tipo === 'conteggi');
    const lista = storicoBanco.viste.find((v) => v.tipo === 'lista');
    assert.deepEqual(conteggi.p, [2, 7]);
    assert.deepEqual(lista.p, [2, 7, 50, 0]);
    assert.deepEqual(storicoBanco.viste.find((v) => v.tipo === 'materiale').p, [[91, 90, 89, 88]]);
    assert.match(lista.s, /ORDER BY o\.id DESC LIMIT \? OFFSET \?/);
    // stato "tutti": niente condizione di stato sulla lista; i conteggi non ne hanno mai nel WHERE
    assert.doesNotMatch(lista.s.slice(lista.s.indexOf('WHERE o.distributor_id')), /o\.stato|consegnato_il/);
    assert.doesNotMatch(conteggi.s.slice(conteggi.s.indexOf('WHERE o.distributor_id')), /o\.stato|consegnato_il/);
    assert.match(t, /<nav class="navbar nav-solo-stretta">/); // il menu in basso (Home e Clienti) c'è, com'era
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: Storico ordini, filtri nell\'URL (stato, periodo, ricerca per nome, #numero, numero e DDT) e pagine', async () => {
  cookie = '';
  banco.attivo = true;
  const vista = async (percorso) => {
    storicoBanco.viste.length = 0;
    const r = await chiedi(percorso);
    assert.equal(r.status, 200, percorso);
    const testo = await r.text();
    return {
      testo,
      conteggi: storicoBanco.viste.find((v) => v.tipo === 'conteggi'),
      lista: storicoBanco.viste.find((v) => v.tipo === 'lista'),
    };
  };
  const dopoWhere = (v) => v.s.slice(v.s.indexOf('WHERE o.distributor_id')); // salta i FILTER (WHERE ...) dei conteggi
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // stato: la lista prende la condizione dello stato scelto, i conteggi no (così i numeri delle schede restano quelli veri)
    let v = await vista('/distributore/storico?stato=consegnati&periodo=30');
    assert.deepEqual(v.conteggi.p, [2, 30]);
    assert.match(dopoWhere(v.lista), /\(o\.consegnato_il IS NOT NULL\) ORDER BY/);
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.stato|consegnato_il/);
    assert.match(v.testo, /<a class="sto-scheda attiva" href="[^"]*stato=consegnati[^"]*"[^>]*>\s*<span class="sto-punto sto-st-consegnato"/);
    assert.match(v.testo, /class="attivo" aria-current="true">30 giorni</);
    for (const [stato, condizione] of [
      ['da_preparare', /\(o\.consegnato_il IS NULL AND o\.stato = 'inviato'\)/],
      ['in_preparazione', /\(o\.consegnato_il IS NULL AND o\.stato = 'in_evasione'\)/],
      ['partiti', /\(o\.consegnato_il IS NULL AND o\.stato = 'evaso'\)/],
    ]) {
      v = await vista('/distributore/storico?stato=' + stato);
      assert.match(dopoWhere(v.lista), condizione, stato);
    }

    // valori sconosciuti: tornano ai predefiniti (tutti, 7 giorni) senza errori
    v = await vista('/distributore/storico?stato=boh&periodo=3&pagina=zzz');
    assert.deepEqual(v.lista.p, [2, 7, 50, 0]);
    assert.doesNotMatch(dopoWhere(v.lista), /o\.stato/);

    // periodo: oggi = mezzanotte italiana (nessun parametro), tutti = nessun limite
    v = await vista('/distributore/storico?periodo=oggi');
    assert.match(dopoWhere(v.conteggi), /DATE_TRUNC\('day', NOW\(\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'Europe\/Rome'\) AT TIME ZONE 'UTC'/);
    assert.deepEqual(v.conteggi.p, [2]);
    v = await vista('/distributore/storico?periodo=tutti');
    assert.deepEqual(v.conteggi.p, [2]);
    assert.doesNotMatch(dopoWhere(v.conteggi), /creato_il/);

    // ricerca per nome: ILIKE su cliente e DDT, mai concatenata; un % scritto dall'utente vale per sé
    v = await vista('/distributore/storico?q=rossi');
    assert.match(dopoWhere(v.conteggi), /\(u\.ragione_sociale ILIKE \? OR o\.ddt_numero ILIKE \?\)/);
    assert.deepEqual(v.conteggi.p, [2, 7, '%rossi%', '%rossi%']);
    assert.doesNotMatch(v.conteggi.s, /rossi/);
    assert.match(v.testo, /name="q" value="rossi"/);
    assert.doesNotMatch(v.testo, /data-storico-svuota[^>]* hidden>/); // con una ricerca la "×" si vede
    assert.match(v.testo, /href="\/distributore\/storico\?stato=tutti&amp;periodo=7" data-storico-svuota/); // e svuota la ricerca
    v = await vista('/distributore/storico?q=' + encodeURIComponent('50%_x'));
    assert.deepEqual(v.conteggi.p.slice(2), ['%50\\%\\_x%', '%50\\%\\_x%']);

    // ricerca per numero: "#91" e "91" cercano anche l'ordine 91; un testo con le cifre mischiate no; troppe cifre no
    for (const q of ['#91', '91', ' # 91 ']) {
      v = await vista('/distributore/storico?q=' + encodeURIComponent(q));
      assert.match(dopoWhere(v.conteggi), /\(u\.ragione_sociale ILIKE \? OR o\.ddt_numero ILIKE \? OR o\.id = \?\)/, q);
      assert.equal(v.conteggi.p[v.conteggi.p.length - 1], 91, q);
    }
    v = await vista('/distributore/storico?q=A%2F89'); // numero di DDT
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.id = \?/);
    assert.deepEqual(v.conteggi.p.slice(2), ['%A/89%', '%A/89%']);
    v = await vista('/distributore/storico?q=' + '9'.repeat(20));
    assert.doesNotMatch(dopoWhere(v.conteggi), /o\.id = \?/);
    // con la ricerca i link di stato e periodo la mantengono
    v = await vista('/distributore/storico?q=rossi&stato=partiti&periodo=30');
    assert.match(v.testo, /href="\/distributore\/storico\?stato=consegnati&amp;periodo=30&amp;q=rossi"/);
    assert.match(v.testo, /href="\/distributore\/storico\?stato=partiti&amp;periodo=oggi&amp;q=rossi"/);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: Storico ordini, paginazione da 50 e stati vuoti', async () => {
  cookie = '';
  banco.attivo = true;
  const conteggiPrima = storicoBanco.conteggi;
  const righePrima = storicoBanco.righe;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // 120 ordini = 3 pagine da 50, con i filtri nei link; la pagina 2 parte dal 51° (OFFSET 50)
    storicoBanco.conteggi = { tutti: 120, da_preparare: 20, in_preparazione: 30, partiti: 40, consegnati: 30 };
    storicoBanco.viste.length = 0;
    let t = await (await chiedi('/distributore/storico?stato=partiti&periodo=30&q=rossi&pagina=2')).text();
    // "partiti" = 40 ordini: una sola pagina, quindi la pagina 2 chiesta a mano (OFFSET 50) si porta sull'ultima (OFFSET 0)
    assert.deepEqual(storicoBanco.viste.filter((v) => v.tipo === 'lista').map((v) => v.p.slice(-1)[0]), [50, 0]);
    assert.doesNotMatch(t, /class="paginazione"/);

    storicoBanco.viste.length = 0;
    t = await (await chiedi('/distributore/storico?stato=tutti&periodo=tutti&q=rossi&pagina=2')).text();
    assert.match(t, /<span class="conta-pagina">\s*Pagina 2 di 3 · 120 ordini\s*<\/span>/);
    assert.match(t, /href="\/distributore\/storico\?stato=tutti&amp;periodo=tutti&amp;q=rossi&amp;pagina=1">‹ Precedente</);
    assert.match(t, /href="\/distributore\/storico\?stato=tutti&amp;periodo=tutti&amp;q=rossi&amp;pagina=3">Successiva ›</);
    assert.equal(storicoBanco.viste.filter((v) => v.tipo === 'lista').length, 1);
    // oltre l'ultima: si mostra l'ultima (una seconda lettura con OFFSET 100)
    storicoBanco.viste.length = 0;
    t = await (await chiedi('/distributore/storico?stato=tutti&periodo=tutti&pagina=99')).text();
    assert.match(t, /Pagina 3 di 3 · 120 ordini/);
    assert.deepEqual(storicoBanco.viste.filter((v) => v.tipo === 'lista').map((v) => v.p.slice(-1)[0]), [98 * 50, 100]);

    // nessun risultato con i filtri (ma il banco ha ordini): messaggio e link per mostrare tutto, schede ancora cliccabili
    storicoBanco.conteggi = { tutti: 0, da_preparare: 0, in_preparazione: 0, partiti: 0, consegnati: 0 };
    storicoBanco.righe = [];
    storicoBanco.assoluto = false;
    t = await (await chiedi('/distributore/storico?periodo=oggi&q=zzz')).text();
    assert.match(t, /<p>Nessun ordine con questo filtro\.<\/p>\s*<a class="btn btn-chiaro" href="\/distributore\/storico\?periodo=tutti">Mostra tutti<\/a>/);
    assert.doesNotMatch(t, /Ancora nessun ordine/);
    assert.match(t, /<a class="sto-scheda attiva vuota"/); // zero: la scheda resta un link, col numero grigio
    assert.doesNotMatch(t, /class="sto-tabella"/);

    // nessun ordine in assoluto
    storicoBanco.assoluto = true;
    t = await (await chiedi('/distributore/storico?periodo=tutti')).text();
    assert.match(t, /<p>Ancora nessun ordine\.<\/p>/);
    assert.doesNotMatch(t, /Mostra tutti|Nessun ordine con questo filtro/);
  } finally {
    storicoBanco.conteggi = conteggiPrima;
    storicoBanco.righe = righePrima;
    storicoBanco.assoluto = true;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: /distributore/ordini porta allo Storico (301, con i filtri); il dettaglio e i POST restano, i ripieghi vanno allo Storico', async () => {
  cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    let r = await chiedi('/distributore/ordini');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/distributore/storico');
    r = await chiedi('/distributore/ordini?stato=consegnati&periodo=30&q=%2391');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/distributore/storico?stato=consegnati&periodo=30&q=%2391');
    // il dettaglio non è una lista: un ordine che non c'è è 404, non un redirect
    assert.equal((await chiedi('/distributore/ordini/999')).status, 404);
    // i POST su un ordine che non è del banco tornano allo Storico (prima alla vecchia lista)
    for (const azione of ['preparazione', 'ddt']) {
      r = await chiedi('/distributore/ordini/999/' + azione, form({}));
      assert.equal(r.status, 302, azione);
      assert.equal(r.headers.get('location'), '/distributore/storico', azione);
    }
    // senza accesso: come ogni pagina del banco, al login
    cookie = '';
    r = await chiedi('/distributore/storico');
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /\/login/);
  } finally {
    banco.attivo = false;
    cookie = '';
  }
});

// Imposta la richiesta 177 e la risposta del banco 2: `secondi` rimasti, stato della richiesta e della risposta.
function preparaRichiesta({ secondi = 241, stato = 'in_attesa', esito = 'in_attesa', corriere = null, ordine = null, legame = true, trascorsi = 253, extra = {} } = {}) {
  richiestaProva.secondi = secondi;
  richiestaProva.legame = legame;
  richiestaProva.ordine = ordine;
  richiestaProva.richiesta = {
    id: 177, cliente_id: 1, zona: 'Genova', stato, creato_il: fa(5000), scade_il: naive(new Date(Date.now() + secondi * 1000)),
    order_id: ordine ? ordine.id : null, destinazione: null,
  };
  // risposto_il (UTC senza fuso) e i secondi da allora: contano solo se il banco ha già risposto
  const conferma = esito === 'confermato';
  richiestaProva.risposta = {
    id: 1, request_id: 177, distributor_id: 2, esito, corriere_stato: corriere, copertura: 'totale', note: null,
    risposto_il: conferma ? naive(new Date(Date.now() - trascorsi * 1000)) : null, secondi_da_risposta: conferma ? trascorsi : null, ...extra,
  };
  return naive(new Date(Date.now() + secondi * 1000));
}
const oraRoma = (d) => d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });

test('banco: richiesta da confermare, a due colonne con timer, pulsanti, cliente e passi', async () => {
  cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    const scadenza = new Date(Date.now() + 241 * 1000);
    preparaRichiesta({ secondi: 241 });
    const r = await chiedi('/distributore/richieste/177');
    assert.equal(r.status, 200);
    const t = await r.text();

    // intestazione del banco (con "Banco" accesa), titolo con freccia, stato e quando è arrivata; niente appbar vecchia né riga titolo
    assert.match(t, /<header class="banco-testa">/);
    assert.match(t, /class="banco-voce attiva" href="\/distributore" aria-current="page"/);
    assert.doesNotMatch(t, /<header class="appbar">|banco-titolo/);
    assert.match(t, /<a class="ric-indietro" href="\/distributore"[^>]*>\s*<svg/);
    assert.match(t, /<h1 class="ric-titolo">Richiesta #177<\/h1>\s*<span class="ric-stato ric-st-da_confermare"><span class="ric-punto" aria-hidden="true"><\/span>Da confermare<\/span>/);
    assert.match(t, /<span class="ric-ricevuta">Ricevuta oggi alle \d\d:\d\d<\/span>/);

    // timer: 04:01, orario limite, non ancora rosso; il timer è sulla pagina (lo muove app.js)
    assert.match(t, /<div class="ric-timer" data-ric-timer\s+data-secondi="241" data-finestra="600" data-soglia-urgente="120">/);
    assert.match(t, /data-tempo role="timer"[^>]*>04:01<\/span>/);
    assert.match(t, new RegExp('<h2 class="ric-timer-titolo">Rispondi entro le ' + oraRoma(scadenza).replace(':', ':') + '</h2>'));
    assert.match(t, /Poi la richiesta scade e il cliente non la vede più\./);

    // pulsanti: Conferma (azione prezzo_richiesto) e Non disponibile (rifiuta, neutro, non rosso)
    assert.match(t, /<form class="ric-pulsanti" method="POST" action="\/distributore\/richieste\/177\/rispondi">/);
    assert.match(t, /<button class="ric-btn ric-btn-conferma" type="submit" name="azione" value="prezzo_richiesto"><svg[\s\S]*?<\/svg>Conferma: è disponibile<\/button>/);
    assert.match(t, /<button class="ric-btn ric-btn-neutro" type="submit" name="azione" value="rifiuta">Non disponibile<\/button>/);
    assert.doesNotMatch(t, /btn-rosso|Accetta ordine|Rifiuta: merce non disponibile/);

    // materiale: una tabella con quantità, articolo e codice, listino, prezzo cliente, totale; sotto il totale per il cliente
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale richiesto<\/h2>\s*<span class="ric-conta">1 articolo · 1 pezzo<\/span>/);
    assert.match(t, /<span>Q\.tà<\/span><span>Articolo<\/span><span class="ric-num">Listino<\/span><span class="ric-num">Prezzo cliente<\/span><span class="ric-num">Totale<\/span>/);
    assert.match(t, /<span class="ric-qta">1×<\/span>\s*<span class="ric-articolo">\s*<strong class="ric-nome">87 Elemento A &#34;t&#34; 87gr Diam\. 100<\/strong>\s*<small class="ric-cod">Cod\. 12364959<\/small>/);
    assert.match(t, /ric-listino">€ 102,30</);
    assert.match(t, /<strong>€ 102,30<\/strong><small>cad\. \+ IVA<\/small>/);
    assert.match(t, /ric-num ric-tot">€ 102,30</);
    assert.match(t, /<span class="ric-totale-label">Totale per il cliente<\/span>\s*<strong class="ric-totale-cifra">€ 102,30<\/strong>\s*<small class="ric-iva">\+ IVA<\/small>/);

    // cliente: sempre in vista, con indirizzo, telefono e link alla scheda; non più nascosto in "Cliente ordinante"
    assert.doesNotMatch(t, /Cliente ordinante|<details/);
    assert.match(t, /<h2 class="ric-occhiello" id="ric-cliente-titolo">Cliente<\/h2>/);
    assert.match(t, /<strong>Prova S\.r\.l\.<\/strong>\s*<small>P\. IVA 01234567890<\/small>/);
    assert.match(t, /<span>Via Puggia 22\/3, 16131 Genova \(GE\)<\/span>/);
    assert.match(t, /<a href="tel:010123456">010 123 456<\/a>/);
    assert.match(t, /<a class="ric-apri-cliente" href="\/distributore\/clienti\/1">Apri scheda cliente/);

    // "Elimina dal banco": un link di testo in fondo, dopo il cliente, con la sua conferma
    assert.ok(t.indexOf('ric-elimina-riga') > t.indexOf('ric-cliente'), 'in fondo');
    assert.match(t, /<form class="ric-elimina-riga" method="POST" action="\/distributore\/richieste\/177\/elimina" onsubmit="return confirm\([^"]*\)">\s*<button class="ric-elimina" type="submit"><svg[\s\S]*?<\/svg>Elimina dal banco<\/button>/);

    // i passi dopo la conferma: col modulo WhatsApp spento sono due (non ci sono corrieri da avvisare)
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Cosa succede dopo la conferma<\/h2>/);
    assert.deepEqual([...t.matchAll(/<li class="ric-passo ric-passo-(\w+)( corrente)?"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>/g)].map((m) => [m[1], !!m[2], m[3]]),
      [['arancio', true, 'Confermi la disponibilità'], ['verde', false, 'Prepari il materiale']]);
    assert.doesNotMatch(t, /Avvisiamo i corrieri/);

    // col modulo acceso: tre passi, e quello da non anticipare ("non preparare ancora") c'è
    process.env.WHATSAPP_ATTIVO = '1';
    try {
      const t3 = await (await chiedi('/distributore/richieste/177')).text();
      assert.deepEqual([...t3.matchAll(/<li class="ric-passo ric-passo-(\w+)( corrente)?"[^>]*>[\s\S]*?<strong>([^<]*)<\/strong>/g)].map((m) => [m[1], !!m[2], m[3]]),
        [['arancio', true, 'Confermi la disponibilità'], ['viola', false, 'Avvisiamo i corrieri'], ['verde', false, 'Prepari il materiale']]);
      assert.match(t3, /Non preparare ancora: aspetta che un corriere accetti la consegna\./);
      assert.match(t3, /L.ordine compare in Da preparare con l.ora di ritiro\./);
    } finally {
      delete process.env.WHATSAPP_ATTIVO;
    }

    // senza legame col cliente (non ha indicato questo banco) la scheda non si apre: niente link morto
    preparaRichiesta({ secondi: 241, legame: false });
    assert.doesNotMatch(await (await chiedi('/distributore/richieste/177')).text(), /ric-apri-cliente/);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta da confermare, il timer diventa rosso negli ultimi 2 minuti', async () => {
  cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);
    for (const [secondi, rosso] of [[400, false], [121, false], [120, true], [45, true], [1, true]]) {
      preparaRichiesta({ secondi });
      const t = await (await chiedi('/distributore/richieste/177')).text();
      assert.match(t, new RegExp('<div class="ric-timer' + (rosso ? ' urgente' : '') + '" data-ric-timer'), secondi + ' s');
      assert.match(t, new RegExp('data-secondi="' + secondi + '"'));
    }
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta dopo la risposta (attesa corriere, confermata, nessun corriere) e chiusa senza ordine', async () => {
  cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const stati = (t) => t.match(/<span class="ric-stato ric-st-(\w+)">[\s\S]*?<\/span>([^<]*)<\/span>/).slice(1, 3);
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // confermata, nel gruppo WhatsApp nessun corriere ha ancora risposto: scheda viola, niente timer né pulsanti, passo "corrieri" in corso
    process.env.WHATSAPP_ATTIVO = '1';
    try {
      preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa' });
      let t = await (await chiedi('/distributore/richieste/177')).text();
      assert.deepEqual(stati(t), ['attesa_corriere', 'Attesa corriere']);
      assert.match(t, /<section class="ric-scheda ric-azione ric-attesa" data-ric-attesa data-trascorsi="253"/);
      assert.doesNotMatch(t, /data-ric-timer|ric-pulsanti|Conferma: è disponibile|ric-esito-viola/);
      assert.match(t, /ric-elimina-riga/); // "Elimina dal banco" resta in fondo
    } finally {
      delete process.env.WHATSAPP_ATTIVO;
    }

    // consegna presa dal corriere e ordine di questo banco: scheda verde con il link all'ordine
    preparaRichiesta({
      secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', extra: { corriere_nome: 'Marco', corriere_minuti: 25 },
      ordine: { id: 5, distributor_id: 2, cliente_id: 1, stato: 'in_evasione', creato_il: fa(60000), consegnato_il: null },
    });
    let t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['confermata', 'Confermata']);
    assert.match(t, /ric-esito-verde[\s\S]*?Consegna presa da Marco: <strong>25 minuti<\/strong> in totale/);
    assert.match(t, /<a class="ric-btn ric-btn-ordine" href="\/distributore\/ordini\/5">Gestisci l'ordine #5<\/a>/);
    assert.doesNotMatch(t, /Cosa succede dopo la conferma/); // a ordine fatto i passi non servono più

    // l'ordine l'ha preso un altro banco: chiusa
    preparaRichiesta({ secondi: 0, stato: 'ordinata', esito: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['chiusa', 'Chiusa']);
    assert.match(t, /ric-esito-grigio[\s\S]*?Il cliente ha già chiuso l'ordine con un altro distributore\./);

    // nessun corriere ha preso la consegna in tempo
    preparaRichiesta({ secondi: 0, stato: 'nessuna_offerta', esito: 'confermato', corriere: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['senza_corriere', 'Nessun corriere']);
    assert.match(t, /ric-esito-rosso[\s\S]*?è come se non avessi accettato/);

    // rifiutata dal banco, scaduta senza risposta, annullata dal cliente: scheda neutra col perché
    preparaRichiesta({ secondi: 300, esito: 'non_disponibile' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['non_disponibile', 'Non disponibile']);
    assert.match(t, /Hai rifiutato la richiesta per indisponibilità della merce\./);
    assert.match(t, /<span class="ric-qta">1×<\/span>/); // il materiale richiesto si vede lo stesso
    preparaRichiesta({ secondi: 0, stato: 'nessuna_offerta', esito: 'scaduto' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['scaduta', 'Scaduta']);
    assert.match(t, /Nessuna risposta entro i 10 minuti/);
    preparaRichiesta({ secondi: 0, stato: 'annullata', esito: 'in_attesa' });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(stati(t), ['annullata', 'Annullata']);
    assert.match(t, /Il cliente ha annullato la richiesta prima della tua risposta\./);

    // una richiesta che non è di questo banco
    richiestaProva.risposta = null;
    assert.equal((await chiedi('/distributore/richieste/177')).status, 404);
  } finally {
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta in attesa del corriere, con ora di conferma, Avanzamento e tempo che sale', async () => {
  cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  // l'ora italiana di una colonna senza fuso (come la leggerebbe pg): lo stesso istante che la pagina deve mostrare
  const oraDi = (naiveDate) => oraRoma(new Date(Date.UTC(naiveDate.getFullYear(), naiveDate.getMonth(), naiveDate.getDate(), naiveDate.getHours(), naiveDate.getMinutes(), naiveDate.getSeconds())));
  const fasi = (t) => [...t.matchAll(/<li class="ric-passo ric-passo-\w+ ric-fase-(\w+)"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>\s*<span>([^<]*)<\/span>/g)]
    .map((m) => [m[1], m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), m[3]]);
  process.env.WHATSAPP_ATTIVO = '1';
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // confermata da 4 min e 13 s, nel gruppo nessun corriere ha ancora risposto
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 253 });
    const confermataAlle = oraDi(richiestaProva.risposta.risposto_il);
    let t = await (await chiedi('/distributore/richieste/177')).text();

    // testata: stato viola con il pallino che pulsa, e a destra quando è arrivata e quando hai confermato
    assert.match(t, /<span class="ric-stato ric-st-attesa_corriere"><span class="ric-punto pulse" aria-hidden="true"><\/span>Attesa corriere<\/span>/);
    assert.match(t, new RegExp('<span class="ric-ricevuta">Ricevuta oggi alle \\d\\d:\\d\\d · confermata alle ' + confermataAlle + '</span>'));
    // la scheda del materiale: "Materiale confermato", tabella e totale come prima
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale confermato<\/h2>/);
    assert.match(t, /<strong class="ric-totale-cifra">€ 102,30<\/strong>/);

    // Avanzamento (al posto di "Cosa succede dopo la conferma"): fatto, in corso, da fare
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Avanzamento<\/h2>/);
    assert.doesNotMatch(t, /Cosa succede dopo la conferma/);
    assert.deepEqual(fasi(t), [
      ['fatto', 'Disponibilità confermata', 'Fatto alle ' + confermataAlle],
      ['corrente', 'Corriere avvisato · da 4 min', 'Aspettiamo che un corriere accetti la consegna.'],
      ['futuro', 'Da preparare', 'Quando un corriere accetta, l\u2019ordine passa in Da preparare con l\u2019ora di ritiro.'],
    ]);
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-fatto">\s*<span class="ric-passo-punto" aria-hidden="true"><svg/); // la spunta
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-corrente" aria-current="step">\s*<span class="ric-passo-punto" aria-hidden="true"><\/span>/);
    assert.match(t, /<li class="ric-passo ric-passo-\w+ ric-fase-futuro">\s*<span class="ric-passo-punto" aria-hidden="true"><\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>4 min<\/span>/); // lo tiene aggiornato app.js

    // scheda d'azione: cerchio col tempo che sale (data-trascorsi), titolo, testo e riquadro grigio; niente timer né pulsanti
    assert.match(t, /<section class="ric-scheda ric-azione ric-attesa" data-ric-attesa data-trascorsi="253" aria-label="In attesa di un corriere">/);
    assert.match(t, /<span class="ric-attesa-tempo" data-trascorso>04:13<\/span>\s*<span class="ric-attesa-sotto">in attesa<\/span>/);
    assert.match(t, /<h2 class="ric-attesa-titolo">Corriere avvisato<\/h2>\s*<p>Non preparare ancora: ti avvisiamo appena un corriere accetta\.<\/p>/);
    assert.match(t, /<p class="ric-attesa-nota">Il cliente vede la tua conferma quando un corriere prende la consegna\.<\/p>/);
    assert.doesNotMatch(t, /data-ric-timer|ric-pulsanti|ric-esito-viola|Ordine collegato|ric-attesa-parziale/);
    // cliente ed "Elimina dal banco" come prima
    assert.match(t, /<h2 class="ric-occhiello" id="ric-cliente-titolo">Cliente<\/h2>/);
    assert.match(t, /<button class="ric-elimina" type="submit">/);

    // oltre l'ora: "1 h 05" nel cerchio e nel passo; subito dopo la conferma "meno di 1 min"
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 3905 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /data-trascorsi="3905"/);
    assert.match(t, /data-trascorso>1 h 05<\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>1 h 05<\/span>/);
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 20 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /data-trascorso>00:20<\/span>/);
    assert.match(t, /Corriere avvisato · da <span data-da>meno di 1 min<\/span>/);

    // copertura parziale: la nota resta sotto il riquadro; un ordine già collegato compare come riga con il link
    preparaRichiesta({
      secondi: 400, esito: 'confermato', corriere: 'in_attesa', extra: { copertura: 'parziale' },
      ordine: { id: 5, distributor_id: 2, cliente_id: 1, stato: 'inviato', creato_il: fa(60000), consegnato_il: null },
    });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /<p class="ric-attesa-parziale">Hai confermato <strong>solo una parte<\/strong> del materiale\.<\/p>/);
    assert.match(t, /<div class="ric-attesa-ordine"><span>Ordine collegato<\/span><a href="\/distributore\/ordini\/5">Ordine #5 /);
    assert.ok(t.indexOf('ric-attesa-nota') < t.indexOf('ric-attesa-parziale') && t.indexOf('ric-attesa-parziale') < t.indexOf('ric-attesa-ordine'), 'ordine delle righe');

    // "Da confermare" non cambia: niente "confermata alle", pallino fermo, "Materiale richiesto" e i passi di prima
    preparaRichiesta({ secondi: 241 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.doesNotMatch(t, /confermata alle|ric-punto pulse|Avanzamento|data-ric-attesa/);
    assert.match(t, /<h2 class="ric-h2" id="ric-mat-titolo">Materiale richiesto<\/h2>/);
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Cosa succede dopo la conferma<\/h2>/);
    assert.match(t, /<li class="ric-passo ric-passo-arancio corrente" aria-current="step">/);

    // senza il modulo WhatsApp non c'è il passo dei corrieri: i passi sono due
    delete process.env.WHATSAPP_ATTIVO;
    preparaRichiesta({ secondi: 400, esito: 'confermato', corriere: 'in_attesa', trascorsi: 253 });
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.equal((t.match(/<li class="ric-passo /g) || []).length, 2);
    assert.deepEqual(fasi(t).map((f) => f[0]), ['fatto', 'corrente']);
    assert.equal(fasi(t)[1][1], 'Da preparare');
    assert.doesNotMatch(t, /<span data-da>/);
  } finally {
    delete process.env.WHATSAPP_ATTIVO;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: "Preparato" toglie l\'ordine dalla colonna (in preparazione, torna alla home) e non tocca quelli già presi o di un altro banco', async () => {
  cookie = '';
  banco.attivo = true;
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // l'ordine è 'inviato': passa in preparazione (esce da "Da preparare") e si torna alla home
    scrittureOrdini.length = 0;
    let r = await chiedi('/distributore/ordini/1280/preparazione', form({ torna: 'home' }));
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/distributore');
    assert.equal(scrittureOrdini.length, 1);
    assert.deepEqual(scrittureOrdini[0].p, [1280]);

    // già in preparazione: niente da scrivere, e si torna comunque alla home
    scrittureOrdini.length = 0;
    r = await chiedi('/distributore/ordini/1285/preparazione', form({ torna: 'home' }));
    assert.equal(r.headers.get('location'), '/distributore');
    assert.equal(scrittureOrdini.length, 0);

    // l'ordine di un altro banco (o inesistente) non si tocca: ripiego sullo Storico
    for (const id of [1290, 1999]) {
      r = await chiedi('/distributore/ordini/' + id + '/preparazione', form({ torna: 'home' }));
      assert.equal(r.status, 302, String(id));
      assert.equal(r.headers.get('location'), '/distributore/storico', String(id));
    }
    assert.equal(scrittureOrdini.length, 0);
  } finally {
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('banco: richiesta con l\'ordine da preparare, timer del corriere e Preparato', async () => {
  cookie = '';
  banco.attivo = true;
  richiestaProva.attivo = true;
  const oraDi = (naiveDate) => oraRoma(new Date(Date.UTC(naiveDate.getFullYear(), naiveDate.getMonth(), naiveDate.getDate(), naiveDate.getHours(), naiveDate.getMinutes(), naiveDate.getSeconds())));
  const fasi = (t) => [...t.matchAll(/<li class="ric-passo ric-passo-\w+ ric-fase-(\w+)"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>\s*<span>([^<]*)<\/span>/g)]
    .map((m) => [m[1], m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), m[3]]);
  const ordine = (extra = {}) => ({
    id: 5, distributor_id: 2, cliente_id: 1, stato: 'inviato', creato_il: fa(60000), consegnato_il: null,
    corriere_nome: 'Marco', corriere_arrivo_il: new Date(Date.now() + 8 * 60000), secondi_arrivo: 480, ...extra,
  });
  const prepara = (ord, trascorsi = 300) => preparaRichiesta({
    secondi: 0, stato: 'ordinata', esito: 'confermato', corriere: 'preso', trascorsi, ordine: ord, extra: { corriere_nome: 'Marco', corriere_minuti: 25 },
  });
  process.env.WHATSAPP_ATTIVO = '1';
  try {
    assert.equal((await chiedi('/login', form({ username: 'banco', password: 'password-di-prova' }))).status, 302);

    // il corriere ha accettato (arriva fra 8 minuti): "Da preparare", con il suo timer e "Preparato"
    const ord = ordine();
    prepara(ord);
    const confermataAlle = oraDi(richiestaProva.risposta.risposto_il);
    const consegnaAlle = oraRoma(ord.corriere_arrivo_il);
    let t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /<span class="ric-stato ric-st-da_preparare"><span class="ric-punto" aria-hidden="true"><\/span>Da preparare<\/span>/);
    assert.match(t, new RegExp('Ricevuta oggi alle \\d\\d:\\d\\d · confermata alle ' + confermataAlle));
    // il timer del corriere: minuti all'arrivo e ora (rosso sotto i 15 minuti, come la pillola della home); si muove con app.js
    assert.match(t, /<div class="ric-arrivo-testa vicino" data-ric-arrivo\s+data-secondi="480" data-soglia-arrivo="15">/);
    assert.match(t, /<span class="ric-arrivo-min" data-arrivo-min>8 min<\/span>\s*<span class="ric-arrivo-sotto">ore \d\d:\d\d<\/span>/);
    assert.match(t, new RegExp('<h2 class="ric-arrivo-titolo">Corriere Marco</h2>\\s*<p>Consegna dal cliente entro le ' + consegnaAlle));
    // "Preparato": lo stesso POST del pulsante della home, che torna alla home; niente timer della risposta né Conferma
    assert.match(t, /<form class="ric-pulsanti" method="POST" action="\/distributore\/ordini\/5\/preparazione">\s*<input type="hidden" name="torna" value="home">\s*<button class="ric-btn ric-btn-ordine" type="submit"><svg[\s\S]*?<\/svg>Preparato<\/button>/);
    assert.doesNotMatch(t, /data-ric-timer|Conferma: è disponibile|Gestisci l'ordine|data-ric-attesa/);
    assert.match(t, /Con &#34;Preparato&#34; l'ordine esce da &#34;Da preparare&#34;|Con "Preparato" l.ordine esce da/);
    // Avanzamento: conferma e corriere fatti, "Da preparare" in corso
    assert.match(t, /<h2 class="ric-h2" id="ric-passi-titolo">Avanzamento<\/h2>/);
    assert.deepEqual(fasi(t), [
      ['fatto', 'Disponibilità confermata', 'Fatto alle ' + confermataAlle],
      ['fatto', 'Consegna presa da Marco', 'Dal cliente entro le ' + consegnaAlle + '.'],
      ['corrente', 'Da preparare', 'Quando hai finito, premi "Preparato".'.replace(/"/g, '&#34;')],
    ]);
    assert.match(t, /<li class="ric-passo ric-passo-verde ric-fase-corrente" aria-current="step">/);

    // più lontano di 15 minuti non è rosso; in ritardo (arrivo passato) lo è, con "In ritardo"
    prepara(ordine({ secondi_arrivo: 2400 }));
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /<div class="ric-arrivo-testa" data-ric-arrivo\s+data-secondi="2400"/);
    assert.match(t, /data-arrivo-min>40 min</);
    prepara(ordine({ secondi_arrivo: -120 }));
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /ric-arrivo-testa vicino/);
    assert.match(t, /data-arrivo-min>In ritardo</);

    // senza corriere (nessun orario d'arrivo): niente timer, resta "Preparato"
    prepara(ordine({ corriere_arrivo_il: null, corriere_nome: '', secondi_arrivo: null }));
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.doesNotMatch(t, /data-ric-arrivo/);
    assert.match(t, /<h2 class="ric-arrivo-titolo">Da preparare<\/h2>/);
    assert.match(t, />Preparato<\/button>/);

    // senza il modulo WhatsApp i passi sono due: conferma fatta e "Da preparare" in corso
    delete process.env.WHATSAPP_ATTIVO;
    prepara(ordine());
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.deepEqual(fasi(t).map((f) => [f[0], f[1]]), [['fatto', 'Disponibilità confermata'], ['corrente', 'Da preparare']]);

    // dopo "Preparato" (l'ordine è in preparazione) la richiesta torna "Confermata", con il link all'ordine e senza Preparato
    prepara(ordine({ stato: 'in_evasione' }));
    t = await (await chiedi('/distributore/richieste/177')).text();
    assert.match(t, /ric-st-confermata/);
    assert.doesNotMatch(t, /ric-arrivo|\/preparazione/);
    assert.match(t, /<a class="ric-btn ric-btn-ordine" href="\/distributore\/ordini\/5">Gestisci l'ordine #5<\/a>/);
  } finally {
    delete process.env.WHATSAPP_ATTIVO;
    richiestaProva.attivo = false;
    banco.attivo = false;
    await chiedi('/logout', { method: 'POST' });
  }
});

test('Stripe: webhook con firma sul corpo grezzo, "Paga e invia" verso la pagina di pagamento del sito, ritorno senza pagare', async () => {
  const stripePagamenti = require(path.join(radice, 'src/stripe_pagamenti'));
  const corpoWebhook = JSON.stringify({ id: 'evt_1', type: 'payment_intent.canceled', livemode: false, data: { object: { id: 'pi_test_sconosciuto' } } });
  const webhook = (firma) => chiedi('/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(firma ? { 'stripe-signature': firma } : {}) },
    body: corpoWebhook,
  });
  const intentiCreati = [];
  const corpiVisti = [];
  const finto = {
    paymentIntents: {
      create: async (p, o) => {
        intentiCreati.push([p, o]);
        return { id: 'pi_test_abc', client_secret: 'pi_test_abc_secret_xyz', status: 'requires_payment_method', amount: p.amount, metadata: p.metadata };
      },
      retrieve: async () => ({ id: 'pi_test_abc', client_secret: 'pi_test_abc_secret_xyz', status: 'requires_payment_method', amount: 0, metadata: {} }),
    },
    webhooks: {
      constructEvent: (corpo, firma) => {
        corpiVisti.push(corpo);
        if (firma !== 'firma-buona') throw new Error('firma non valida');
        return JSON.parse(corpo.toString());
      },
    },
  };

  // senza chiave Stripe il webhook non esiste (503) e "Paga e invia" resta quello simulato (provato dalle altre prove)
  assert.equal((await webhook('firma-buona')).status, 503);

  process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
  stripePagamenti.impostaStripe(finto);
  try {
    // chiave ma niente segreto del webhook: ancora 503
    assert.equal((await webhook('firma-buona')).status, 503);
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_finto';

    // la firma si controlla sul corpo grezzo (un Buffer, non un oggetto già interpretato)
    assert.equal((await webhook(null)).status, 400);
    assert.equal((await webhook('firma-sbagliata')).status, 400);
    const r = await webhook('firma-buona');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ricevuto: true });
    assert.ok(corpiVisti.every((c) => Buffer.isBuffer(c) && c.toString() === corpoWebhook));

    // cliente con qualcosa nel carrello: "Paga e invia richiesta" porta alla pagina di pagamento DEL SITO e NON crea la richiesta
    cookie = '';
    let risposta = await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    assert.equal(risposta.status, 302);
    await chiedi('/api/carrello/imposta', json({ id: 1, qty: 10 }));
    const prima = registro.length;
    risposta = await chiedi('/richieste', form({ modo: 'imposta', destinazione: 'Via Puggia 22/3' }));
    assert.equal(risposta.status, 303);
    assert.equal(risposta.headers.get('location'), '/pagamento/1');
    assert.equal(intentiCreati.length, 1);
    assert.equal(intentiCreati[0][0].capture_method, 'manual');
    assert.equal(registro.slice(prima).some((q) => /INSERT INTO requests/.test(q)), false, 'la richiesta nasce solo a carta autorizzata');
    assert.match(await (await chiedi('/carrello')).text(), /Valvola a sfera/); // il carrello resta com'era

    // la pagina: form di Stripe nel sito, con chiave pubblica e client secret (mai la chiave segreta)
    risposta = await chiedi('/pagamento/1');
    assert.equal(risposta.status, 200);
    let t = await risposta.text();
    assert.match(t, /<title>Pagamento/);
    assert.match(t, /data-pagamento\s+data-chiave="pk_test_finta" data-segreto="pi_test_abc_secret_xyz" data-ritorno="http:\/\/127\.0\.0\.1:\d+\/pagamento\/esito"/);
    assert.match(t, /<div id="elemento-pagamento"/);
    assert.match(t, /<button class="btn-paga pag-paga" type="button" data-pag-paga disabled>Paga € /);
    assert.match(t, /<script src="https:\/\/js\.stripe\.com\/v3\/"><\/script>/);
    assert.match(t, /src="\/pagamento\.js\?v=\d+"/);
    assert.doesNotMatch(t, /sk_test|whsec_/);
    assert.doesNotMatch(t, /class="navbar"/);
    assert.doesNotMatch(t, /non è andato a buon fine/);

    // APP_URL, se c'è, vince sull'indirizzo della richiesta (per il ritorno da Stripe)
    process.env.APP_URL = 'https://sito.test/';
    t = await (await chiedi('/pagamento/1')).text();
    assert.match(t, /data-ritorno="https:\/\/sito\.test\/pagamento\/esito"/);

    // ritorno senza carta autorizzata (pagamento non riuscito): di nuovo il form, con l'avviso
    risposta = await chiedi('/pagamento/esito?payment_intent=pi_test_abc');
    assert.equal(risposta.status, 302);
    assert.equal(risposta.headers.get('location'), '/pagamento/1?riprova=1');
    t = await (await chiedi('/pagamento/1?riprova=1')).text();
    assert.match(t, /Il pagamento non è andato a buon fine\./);

    // un pagamento che non esiste (o di un altro) e un ritorno senza parametri: si torna al carrello
    for (const percorso of ['/pagamento/999', '/pagamento/esito', '/pagamento/esito?payment_intent=pi_di_altri']) {
      risposta = await chiedi(percorso);
      assert.equal(risposta.status, 302, percorso);
      assert.equal(risposta.headers.get('location'), '/carrello', percorso);
    }

    // senza chiave pubblica il form non si può mostrare: errore chiaro, non una pagina rotta
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    risposta = await chiedi('/pagamento/1');
    assert.equal(risposta.status, 503);
    assert.match(await risposta.text(), /Il pagamento online non è ancora configurato/);
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';

    // Sul PC di sviluppo, con PAGAMENTO_SIMULATO=1, "Paga e invia" salta Stripe: la richiesta parte con il pagamento simulato
    // e non si apre nessuna pagina di pagamento. Sulla VPS non deve valere MAI: né con la chiave reale né con NODE_ENV=production.
    // (Si ripete il carrello perché la richiesta simulata lo svuota.)
    const nuovoCarrello = async () => {
      await chiedi('/carrello/svuota', { method: 'POST' });
      await chiedi('/api/carrello/imposta', json({ id: 1, qty: 10 }));
    };
    const pagaDalCarrello = () => chiedi('/richieste', form({ modo: 'imposta', destinazione: 'Via Puggia 22/3' }));
    const nodeEnvPrima = process.env.NODE_ENV;
    cookie = '';
    await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' }));
    process.env.PAGAMENTO_SIMULATO = '1';
    try {
      await nuovoCarrello();
      const intentiPrima = intentiCreati.length;
      const registroPrima = registro.length;
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 302, 'con il bypass non si va a /pagamento (303)');
      assert.match(risposta.headers.get('location'), /^\/richieste\//);
      assert.equal(intentiCreati.length, intentiPrima, 'nessun PaymentIntent');
      assert.ok(registro.slice(registroPrima).some((q) => /INSERT INTO requests/.test(q)), 'la richiesta nasce subito');

      // con NODE_ENV=production il bypass è ignorato: si paga con Stripe
      process.env.NODE_ENV = 'production';
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.match(risposta.headers.get('location'), /^\/pagamento\/\d+$/);
      assert.equal(intentiCreati.length, intentiPrima + 1);
      delete process.env.NODE_ENV;

      // con la chiave reale (sk_live_) idem
      process.env.STRIPE_SECRET_KEY = 'sk_live_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_finta';
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.match(risposta.headers.get('location'), /^\/pagamento\/\d+$/);
      assert.equal(intentiCreati.length, intentiPrima + 2);
      process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';

      // senza la riga nel .env: Stripe come sempre
      delete process.env.PAGAMENTO_SIMULATO;
      await nuovoCarrello();
      risposta = await pagaDalCarrello();
      assert.equal(risposta.status, 303);
      assert.equal(intentiCreati.length, intentiPrima + 3);
    } finally {
      delete process.env.PAGAMENTO_SIMULATO;
      if (nodeEnvPrima === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvPrima;
      process.env.STRIPE_SECRET_KEY = 'sk_test_finta';
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_finta';
    }

    // senza accesso, al login
    await chiedi('/logout', { method: 'POST' });
    for (const percorso of ['/pagamento/1', '/pagamento/esito?payment_intent=pi_test_abc']) {
      risposta = await chiedi(percorso);
      assert.equal(risposta.status, 302, percorso);
      assert.equal(risposta.headers.get('location'), '/login', percorso);
    }
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.APP_URL;
    stripePagamenti.impostaStripe(null);
    await chiedi('/logout', { method: 'POST' });
  }
});

test('nessun errore inatteso nel log del server durante le prove', () => {
  assert.deepEqual(erroriServer, []);
});

test('ricerca, "Elementi con foto" e home: righe compatte come nella categoria (−/+ salva subito, niente "Aggiungi"), con la foto a sinistra', async () => {
  await chiedi('/login', form({ username: 'prova', password: 'password-di-prova' })); // i test di prima possono aver chiuso la sessione
  const catalogoModulo = require(path.join(radice, 'src/catalogo.js'));
  const prodotto = { ...catalogo[1], foto_url: '/img/prodotti/valvola.webp', brand_nome: null, categoria: 'Raccordi' };
  const originali = { cercaProdotti: catalogoModulo.cercaProdotti, prodottiConFoto: catalogoModulo.prodottiConFoto };
  catalogoModulo.cercaProdotti = async () => [prodotto];
  catalogoModulo.prodottiConFoto = async () => ({ righe: [prodotto], pagina: 1, pagine: 1, totale: 1 });
  try {
    const comuni = (t) => {
      assert.match(t, /<div id="risultati" data-righe-compatte/);
      assert.match(t, /<div class="card card-fitta elenco-righe">\s*<div class="riga-prod" data-prodotto="1" data-riga-compatta/);
      assert.match(t, /<img class="prodotto-foto riga-foto" src="\/img\/prodotti\/valvola\.webp"/);
      assert.match(t, /data-riga-stepper="1"/);
      assert.match(t, /<div class="barra-vai" data-barra-vai/);
      // niente più card classica con "Aggiungi (N)": né stepper [data-passo], né barra del carrello con il pulsante
      assert.doesNotMatch(t, /data-aggiungi-tutti|data-passo="|griglia-prodotti|data-barra-carrello/);
    };
    const cerca = await (await chiedi('/cerca?q=valvola')).text();
    comuni(cerca);
    // prezzo del banco: 10,00 meno il 30% = 7,00 (col 10% di servizio erano 7,70), lo stesso del carrello e della ricerca live
    assert.match(cerca, /<span class="importo">€ 7,00<\/span> <span class="iva">\+ IVA<\/span>/);
    assert.doesNotMatch(cerca, /7,70/);
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).risultati[0].prezzo, '7,00');
    assert.doesNotMatch(await (await chiedi('/cerca?q=valvola')).text(), /data-troncato/, 'elenco completo: nessun avviso');
    // risultati tagliati dal limite: la pagina lo dice (e la ricerca live manda `troncato` nel JSON)
    catalogoModulo.cercaProdotti = async () => Object.defineProperty([prodotto], 'troncato', { value: true });
    assert.match(await (await chiedi('/cerca?q=valvola')).text(), /<p class="nota nota-troncato" data-troncato>Mostrati i primi risultati/);
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).troncato, true);
    catalogoModulo.cercaProdotti = async () => [prodotto];
    assert.equal((await (await chiedi('/api/cerca?q=valvola')).json()).troncato, false);
    const foto = await (await chiedi('/con-foto')).text();
    comuni(foto);
    assert.match(foto, /data-url="\/api\/con-foto\/prodotti"/, 'lo scroll infinito resta');
    // la home: l'elenco di partenza sono le categorie, ma cercando si disegnano righe compatte (attributi e barra pronti)
    const home = await (await chiedi('/home')).text();
    assert.match(home, /<div id="risultati" data-righe-compatte\s+data-carrello="\{[^"]*\}"/);
    assert.match(home, /<div class="barra-vai" data-barra-vai/);
    assert.doesNotMatch(home, /data-aggiungi-tutti|data-barra-carrello/);
  } finally {
    Object.assign(catalogoModulo, originali);
  }
});
