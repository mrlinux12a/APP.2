// Il server vero (middleware, route, viste, sessioni) con un DB finto in memoria, per le prove end-to-end di test/sito/*.test.js.
// Non tocca MAI il database di produzione: il modulo db/index.js viene sostituito prima di caricare il server, quindi nessuna connessione
// a Postgres viene aperta. Ogni file di prove chiama `avvia(porta)` e prende da qui quello che gli serve: `chiedi`/`form`/`json` per parlare
// col server, i dati di prova e gli interruttori che cambiano cosa risponde il DB finto (`banco`, `registrazione`, `materialeProva`...).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const bcrypt = require('bcryptjs');

const radice = path.join(__dirname, '..', '..', '..');

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
// Un corriere (account dell'app dei corrieri, docs/app-corrieri.md): il suo nome utente è l'email, e il sito non lo fa entrare.
const utenteCorriere = {
  id: 3, ruolo: 'corriere', username: 'corriere@example.com', email: 'corriere@example.com', nome: 'Marco', cognome: 'Bianchi', ragione_sociale: 'Marco Bianchi',
  zona: 'Genova', distributor_id: null, attivo: 1, password_hash: bcrypt.hashSync('password-corriere', 4),
};
const config = { servizio_pct: '10', iva_pct: '22', finestra_conferma_min: '10', ordine_minimo: '33', spedizione_fissa: '5' };
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
// Pagina dell'ordine (cliente 1): 70 consegnato dal banco (stato evaso, con pagamento di prova), 71 "consegnato"
// con la rotta provvisoria ma rimasto 'inviato' (il caso che prima si poteva annullare), 72 ancora in consegna e annullabile.
// Si accende solo nelle prove che la usano.
const ordiniProva = {
  attivo: false,
  base: {
    cliente_id: 1, modalita: 'consegna_mezzo_grossista', note: null, totale_netto: 112.53, totale_finale: 112.53, request_id: 80, distributor_id: 2,
    consegna_ore: 6, costo_consegna: 10, iva: 26.96, totale_ivato: 149.49, destinazione: 'Via Puggia 22/3, 16131 Genova (GE)',
    partenza_ore: null, corriere_arrivo_il: null, corriere_nome: '', contributo_raee: 0,
  },
};
// 13 ottobre 2026, 18:10 UTC = mercoledì 14 ottobre 2026, 20:10 a Roma
const consegnatoIl = naive(new Date(Date.UTC(2026, 9, 14, 18, 10)));
ordiniProva.ordini = {
  70: { ...ordiniProva.base, id: 70, stato: 'evaso', creato_il: fa(3 * 86400000), consegnato_il: consegnatoIl },
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
  73: { ...ordiniProva.base, ...importiNuovi, id: 73, request_id: 81, stato: 'evaso', creato_il: fa(3 * 86400000), consegnato_il: consegnatoIl },
  74: { ...ordiniProva.base, ...importiNuovi, id: 74, request_id: 81, stato: 'inviato', creato_il: fa(3600000), consegnato_il: null },
  75: { ...ordiniProva.base, ...importiNuovi, id: 75, request_id: 82, stato: 'inviato', creato_il: fa(3600000), consegnato_il: null },
  // gli orari sotto i passi di "Consegnato": 76 inviato, confermato e consegnato lo stesso giorno; 77 inviato la sera e consegnato il giorno dopo; 78 vecchio, senza richiesta
  76: { ...ordiniProva.base, ...importiNuovi, id: 76, request_id: 83, stato: 'evaso', creato_il: naive(new Date(Date.UTC(2026, 9, 14, 17, 40))), consegnato_il: consegnatoIl },
  77: { ...ordiniProva.base, ...importiNuovi, id: 77, request_id: 84, stato: 'evaso', creato_il: naive(new Date(Date.UTC(2026, 9, 21, 21, 55))), consegnato_il: naive(new Date(Date.UTC(2026, 9, 22, 6, 30))) },
  78: { ...ordiniProva.base, ...importiNuovi, id: 78, request_id: null, stato: 'evaso', creato_il: naive(new Date(Date.UTC(2026, 9, 14, 17, 40))), consegnato_il: consegnatoIl },
  // gli stessi ordini 97 e 91 della fixture del materiale (Storico di ottobre), per la ricevuta in PDF del singolo ordine e di "Ricevute del mese"
  97: { ...ordiniProva.base, ...importiNuovi, id: 97, request_id: 197, stato: 'evaso', creato_il: new Date(Date.UTC(2026, 9, 15, 17, 15)), consegnato_il: consegnatoIl },
  91: { ...ordiniProva.base, ...importiNuovi, id: 91, request_id: 191, stato: 'evaso', creato_il: new Date(Date.UTC(2026, 9, 14, 20, 29)), consegnato_il: consegnatoIl },
});
const righeOrdineNuovo = [
  { id: 11, quantita: 1, codice_snapshot: '12514597', nome_snapshot: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', prezzo_netto_unitario: 54.5, subtotale: 54.5, raee_unitario: 0, raee_riga: 0, subtotale_cliente: 59.95 },
  { id: 12, quantita: 1, codice_snapshot: '12697319', nome_snapshot: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', prezzo_netto_unitario: 10, subtotale: 10, raee_unitario: 0, raee_riga: 0, subtotale_cliente: 11 },
];
const pagatoIlProva = naive(new Date(Date.UTC(2026, 9, 15, 10, 0))); // 15 ottobre 2026
// Gli istanti delle richieste di prova (`creato_il` e, per una richiesta rinviata, `pagato_il` riscritto dal rinvio): servono alla pagina "Consegnato" (orario di "Inviata"
// e pillola "Arrivato in … dall'invio"). Le richieste che non sono qui non hanno `creato_il`: la pagina allora non scrive l'orario né la pillola.
const richiesteTempiProva = {};
const utc = (g, m, o, min) => naive(new Date(Date.UTC(2026, g, m, o, min))); // (mese 0-11, giorno, ora UTC, minuti)
function eseguiOrdineProva(s, p, modo) {
  if (/^SELECT \* FROM orders WHERE id = \?/.test(s)) return ordiniProva.ordini[p[0]] || null;
  if (/^SELECT \* FROM order_items WHERE order_id = \?/.test(s)) {
    if (!(Number(p[0]) in ordiniProva.ordini)) return [];
    return [73, 74, 75, 76, 77].includes(Number(p[0])) ? righeOrdineNuovo : righeOrdineProva;
  }
  if (/^SELECT \* FROM distributors WHERE id = \?/.test(s)) return { id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino' };
  if (/FROM requests WHERE id = \?/.test(s) && /pagamento_stato, pagamento_metodo/.test(s)) {
    // 81: consegna pagata con Stripe (20,07); 82: la stessa, poi rimborsata; le altre: l'ordine di prima, pagato tutto in app (149,49)
    const tempi = richiesteTempiProva[Number(p[0])] || {};
    if ([81, 191, 197].includes(Number(p[0])) || tempi.stripe) return { pagamento_stato: 'pagato', pagamento_metodo: 'stripe', pagamento_importo: 20.07, pagato_il: pagatoIlProva, ...tempi.colonne };
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
// Materiale ordinato (Storico ordini dell'installatore e pagina cliente del banco: src/logica/ordini/materiale.js). Si accende solo nelle prove che
// lo usano. Le query rispondono con queste righe per QUALUNQUE cliente: la stessa lettura serve a /storico (cliente 1, tutti i banchi) e a
// /distributore/clienti/32 (filtrata sulla filiale 2), così si può confrontare quello che vedono i due.
// Ordini di ottobre 2026 (il prezzo del banco è il netto, il cliente-con-servizio il +10%; IVA 22%):
//   #98 in preparazione, 1× valvola: netto 50 -> materiale 61,00; addebitato in app (servizio 5 + consegna 10) × 1,22 = 18,30
//   #97 consegnato, 1× elemento con RAEE 2: netto 100 + 2 -> materiale 124,44; pagato TUTTO in app prima (148,84), quindi si calcola:
//       (10 + 10) × 1,22 = 24,40
//   #91 consegnato, 2× bocchettone + 1× raccordo -> materiale 73,20 + 12,81 = 86,01; servizio (6 + 1,05 + 10) × 1,22 = 20,80
// e #30 di settembre (consegnato, 3 × netto 100 -> materiale 366,00; addebitato non salvato, quindi servizio calcolato (30 + 10) × 1,22 = 48,80).
// Totale ottobre: 271,45; servizio ottobre: 63,50.
const materialeProva = { attivo: false, chiamate: [], ricevute: [] }; // chiamate: con quale cliente e filiale si sono lette le righe; ricevute: id delle richieste con un incasso Stripe vero
const dataProva = (anno, mese, giorno, ore, minuti) => naive(new Date(Date.UTC(anno, mese - 1, giorno, ore, minuti)));
materialeProva.ordini = [
  { id: 98, totale_netto: 50, creato_il: dataProva(2026, 10, 16, 7, 12), stato: 'in_evasione', consegnato_il: null, distributor_id: 2, costo_consegna: 10, contributo_raee: 0, iva: 14.3, totale_finale: 55, distributore_nome: 'BOREA SRL', pagamento_importo: 18.3 },
  { id: 97, request_id: 197, totale_netto: 100, creato_il: dataProva(2026, 10, 15, 17, 15), stato: 'evaso', consegnato_il: dataProva(2026, 10, 15, 20, 0), distributor_id: 2, costo_consegna: 10, contributo_raee: 2, iva: 26.84, totale_finale: 110, distributore_nome: 'BOREA SRL', pagamento_importo: 148.84 },
  { id: 91, request_id: 191, totale_netto: 70.5, creato_il: dataProva(2026, 10, 14, 20, 29), stato: 'evaso', consegnato_il: dataProva(2026, 10, 14, 22, 0), distributor_id: 2, costo_consegna: 10, contributo_raee: 0, iva: 19.26, totale_finale: 77.55, distributore_nome: 'BOREA SRL', pagamento_importo: 20.8 },
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
// le righe delle richieste chiuse senza ordine (quantità e nome, nessun prezzo)
materialeProva.righeRichieste = [
  { request_id: 4, quantita: 2, nome: 'Valvola a sfera 1/2' },
  { request_id: 4, quantita: 1, nome: 'Raccordo a T' },
  { request_id: 2, quantita: 3, nome: 'Sifone doccia' },
];
function eseguiMaterialeProva(s, p) {
  if (/FROM request_items ri JOIN products p ON p\.id = ri\.product_id WHERE ri\.request_id IN \(/.test(s)) return materialeProva.righeRichieste;
  if (/FROM orders o LEFT JOIN distributors d ON d\.id = o\.distributor_id LEFT JOIN requests r ON r\.id = o\.request_id WHERE o\.cliente_id = \?/.test(s)) {
    const filiale = /AND o\.distributor_id = \?/.test(s) ? p[1] : null;
    materialeProva.chiamate.push({ cliente: p[0], filiale });
    return materialeProva.ordini.filter((o) => filiale === null || o.distributor_id === filiale);
  }
  if (/FROM order_items WHERE order_id = ANY/.test(s)) return materialeProva.righe.filter((r) => p[0].includes(r.order_id));
  if (/SELECT DISTINCT request_id FROM stripe_pagamenti/.test(s)) return materialeProva.ricevute.filter((id) => p[0].includes(id)).map((id) => ({ request_id: id }));
  if (/FROM requests WHERE cliente_id = \? AND order_id IS NULL AND stato IN/.test(s)) return materialeProva.richieste;
  return undefined;
}
// daRispondere e primaScade: le richieste da confermare e quanto manca alla prima (il pallino su "Banco" e la striscia sotto l'intestazione).
const banco = { attivo: false, decisioni: [], sqlHome: { contatore: '', colonna: '' }, daRispondere: 2, primaScade: 98 };
// Avvisi del banco (src/logica/banco/avvisi.js): le richieste ancora da confermare, le notifiche nuove con gli ordini a cui si riferiscono e gli id segnati letti.
const avvisiBanco = { richieste: [], notifiche: [], ordini: [], ordiniDaPreparare: [{ id: 1280 }, { id: 1281 }], lette: [], viste: [] };
// Notifiche non lette dell'installatore nella categoria "ordini" (quelle del pallino "+N" sotto "Stato ordini"): `segnaLetteCategoria` le azzera, come nel DB vero.
const notificheCliente = { nonLette: 0 };
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
// Posizioni del dispositivo dell'installatore salvate da POST /api/posizione (parametri di ogni UPDATE users SET geo_lat ...).
const posizioniProva = [];
// Account dell'installatore (recupero password, cambio password, eliminazione): clienti di prova, la tabella dei link di recupero, le scritture e cosa c'è "in corso".
// Il cliente "prova" è quello degli altri test (stesso id 1): qui si aggiungono solo i dati per cercarlo per email.
const accountProva = {
  clienti: [{ id: 1, ruolo: 'cliente', attivo: 1, username: 'prova', email: 'prova@example.com', referente: 'Prova', ragione_sociale: 'Prova S.r.l.' }],
  link: [],
  scritture: [],
  corso: { richieste: 0, ordini: 0, pagamenti: 0 },
  mail: [],
};
// Anagrafica del banco (filiale 2): la riga di distributors, la ditta e l'utente; le scritture che la pagina fa si registrano in `scrittureAnagrafica`.
const anagraficaProva = {
  filiale: {
    id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', zona: 'Genova e provincia', attivo: 1, ditta_id: 6, ragione_sociale: '', partita_iva: '',
    indirizzo: 'Via Castel Morrone 1/7 rosso', cap: '16161', citta: 'Genova', provincia: 'GE', telefono: '010 123456', email: 'fegino@borea.example',
    geo_lat: 44.4521, geo_lng: 8.9055, geo_manuale: 0, orari: null, email_nuove_richieste: 0,
  },
  ditta: { id: 6, nome: 'BOREA SRL', ragione_sociale: 'BOREA SRL', partita_iva: '', sdi_pec: '', indirizzo: '', cap: '', citta: '', provincia: '' },
  utente: { id: 9, username: 'banco', email: 'banco.fegino@borea.example' },
};
const scrittureAnagrafica = [];
// Le filiali attive come le legge il carrello per gli orari (richieste.statoBanchiAttivi): aperte tutto il giorno (24 ore: una filiale senza orari impostati non riceve richieste).
const banchiAttiviProva = { righe: [{ id: 2, nome: 'BOREA SRL', filiale: 'Banco Genova Fegino', orari: Object.fromEntries(['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'].map((g) => [g, [['00:00', '23:59']]])) }] };
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
  { id: 1280, request_id: 177, cliente_nome: 'Rossi Impianti S.r.l.', corriere_nome: 'Marco', ritiro_il: new Date(Date.now() + 8 * 60000), secondi_arrivo: 480 },
  { id: 1281, cliente_nome: 'Neri Impianti', corriere_nome: '', ritiro_il: null, secondi_arrivo: null },
];
// Storico ordini del banco (filiale 2): quattro ordini in due giorni, uno "consegnato" pur essendo rimasto 'inviato'. Si tengono
// SQL e parametri delle query viste (`viste`), per controllare i filtri; i conteggi e le righe sono quelli che il DB darebbe.
const storicoBanco = {
  viste: [],
  assoluto: true, // false = il banco ha ordini (solo che i filtri non ne trovano): cambia il messaggio dello stato vuoto
  conteggi: { tutti: 4, da_preparare: 1, in_consegna: 2, consegnati: 1 },
  // "Da incassare" = il materiale del banco con RAEE e IVA (importiNuovi: 64,50 + 14,19 = 78,69), NON il totale con la consegna pagata in app (98,76).
  // #90 è un ordine vecchio (importi non salvati: si ricalcolano dalla merce 54,00 con l'IVA di oggi: 54 + 11,88 = 65,88).
  righe: [
    { ...importiNuovi, id: 91, creato_il: fa(5000), stato: 'inviato', consegnato_il: null, cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', cliente_citta: 'Genova' },
    { id: 90, creato_il: fa(6000), stato: 'in_evasione', consegnato_il: null, totale_netto: 54, totale_finale: 54, costo_consegna: 0, contributo_raee: 0, iva: 0, cliente_nome: 'Termoidraulica Verdi S.r.l.', cliente_citta: null },
    { ...importiNuovi, id: 89, creato_il: new Date(2025, 2, 12, 10, 40), stato: 'evaso', consegnato_il: null, cliente_nome: 'Idraulica Bianchi S.n.c.', cliente_citta: 'Savona' },
    { ...importiNuovi, id: 88, creato_il: new Date(2025, 2, 12, 9, 18), stato: 'inviato', consegnato_il: new Date(2025, 2, 12, 14, 0), cliente_nome: 'Rossi <b>Impianti</b> S.r.l.', cliente_citta: 'Genova' },
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
// L'ordine 1295 della pagina dell'ordine del banco (come nel disegno), "Da preparare": Rossi Impianti, due articoli da 54,50 + 10,00 (merce 64,50, IVA 14,19,
// totale 78,69; il prezzo col servizio sarebbe 59,95 + 11,00) e il corriere Marco che ritira fra 22 minuti (ha risposto 4 minuti fa scrivendo "preso 26"; l'arrivo dal cliente, 12 minuti di strada dopo, il banco non lo vede).
const ordine1295 = {
  ...importiNuovi, id: 1295, cliente_id: 1, distributor_id: 2, stato: 'inviato', request_id: 177, modalita: 'consegna_mezzo_grossista', note: null,
  destinazione: 'Via Castel Morrone 1/7r, 16161 Genova (GE)', creato_il: fa(60000), consegnato_il: null, in_evasione_il: null, evaso_il: null,
  corriere_nome: 'Marco', corriere_risposto_il: new Date(Date.now() - 4 * 60000), corriere_minuti: 26, corriere_arrivo_il: new Date(Date.now() + 34 * 60000),
};
// Fa arrivare il corriere dal banco fra `minuti` minuti da adesso (ha risposto 4 minuti fa): i campi dell'ordine che lo dicono.
const ritiroTra = (minuti) => ({ corriere_risposto_il: new Date(Date.now() - 4 * 60000), corriere_minuti: minuti + 4 });
ordiniDelBanco[1295] = ordine1295;
const righeOrdineBanco = {
  1295: [
    { id: 11, order_id: 1295, quantita: 1, codice_snapshot: '12514597', nome_snapshot: 'Adattatore Ø80/100mm Per Caldaia 45-65kw', prezzo_netto_unitario: 54.5, subtotale: 54.5, raee_unitario: 0, raee_riga: 0, prezzo_unitario_cliente: 59.95, subtotale_cliente: 59.95 },
    { id: 12, order_id: 1295, quantita: 1, codice_snapshot: '12697319', nome_snapshot: 'Adattatore Ø80/60mm Sistema Sdoppiato Condensazione', prezzo_netto_unitario: 10, subtotale: 10, raee_unitario: 0, raee_riga: 0, prezzo_unitario_cliente: 11, subtotale_cliente: 11 },
  ],
};
function eseguiBanco(s, p, modo) {
  // Anagrafica del banco (src/logica/banco/anagrafica.js)
  if (/^SELECT \* FROM distributors WHERE id = \?/.test(s) && Number(p[0]) === 2) return anagraficaProva.filiale;
  if (/^SELECT id, username, email FROM users WHERE id = \?/.test(s)) return anagraficaProva.utente;
  if (/^SELECT \* FROM ditte WHERE id = \?/.test(s)) return anagraficaProva.ditta;
  if (/^SELECT ditta_id FROM distributors WHERE id = \?/.test(s)) return { ditta_id: anagraficaProva.filiale.ditta_id };
  if (/^(UPDATE (ditte|distributors|store_locations) SET|DELETE FROM session WHERE \(sess::jsonb)/.test(s)) { scrittureAnagrafica.push({ s, p }); return { changes: 1 }; }
  if (/^SELECT id, password_hash FROM users WHERE id = \?/.test(s)) return { id: 9, password_hash: utenteBanco.password_hash };
  if (/^UPDATE users SET password_hash = \?/.test(s)) { scrittureAnagrafica.push({ s, p }); return { changes: 1 }; }
  if (/n_articoli/.test(s) && /FROM request_responses rr JOIN requests r ON r\.id = rr\.request_id JOIN users u/.test(s)) { avvisiBanco.viste.push({ s, p }); return avvisiBanco.richieste; }
  if (/FROM notifications WHERE user_id = \? AND notificata = 0/.test(s)) return avvisiBanco.notifiche;
  if (/^SELECT id FROM orders WHERE distributor_id = \? AND stato = 'inviato' AND consegnato_il IS NULL ORDER BY id$/.test(s)) return avvisiBanco.ordiniDaPreparare;
  if (/o\.corriere_nome, o\.corriere_risposto_il, o\.corriere_minuti, u\.ragione_sociale AS cliente_nome/.test(s) && /o\.id = ANY/.test(s)) { avvisiBanco.viste.push({ s, p }); return avvisiBanco.ordini; }
  if (/^UPDATE notifications SET letta = 1 WHERE user_id = \? AND letta = 0 AND \(id = ANY\(\?::int\[\]\) OR \(tipo = 'nuova_richiesta' AND request_id = ANY\(\?::int\[\]\)\) OR \(tipo = 'corriere_trovato' AND order_id = ANY\(\?::int\[\]\)\)\)$/.test(s)) { avvisiBanco.lette.push(p); return { changes: (p[1] || []).length }; }
  if (/^SELECT \* FROM orders WHERE id = \?/.test(s)) return ordiniDelBanco[p[0]] || null;
  if (/^SELECT \* FROM order_items WHERE order_id = \?/.test(s)) return righeOrdineBanco[p[0]] || [];
  // I secondi che mancano al ritiro del corriere: il momento in cui ha risposto su WhatsApp + i minuti che ha scritto (src/logica/ordini/corriere.js)
  if (/^SELECT EXTRACT\(EPOCH FROM \(\(corriere_risposto_il \+ corriere_minuti \* INTERVAL '1 minute'\) - NOW\(\)\)\)::int AS secondi FROM orders WHERE id = \?/.test(s)) {
    const o = ordiniDelBanco[p[0]];
    return o && o.corriere_risposto_il && o.corriere_minuti !== null && o.corriere_minuti !== undefined
      ? { secondi: Math.round((o.corriere_risposto_il.getTime() + o.corriere_minuti * 60000 - Date.now()) / 1000) }
      : null;
  }
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
  if (/COUNT\(\*\) FILTER \(WHERE stato = 'inviato'[^)]*\) AS da_preparare/.test(s)) { banco.sqlHome.contatore = s; return { da_preparare: 2, in_preparazione: 0, ultimo: 1281 }; }
  if (/COUNT\(\*\) FILTER \(WHERE rr\.esito = 'in_attesa'/.test(s)) return { n: banco.daRispondere, ultima: 12, attesa_corriere: 1, prima_scade: banco.daRispondere > 0 ? banco.primaScade : null };
  if (/FROM client_distributors WHERE distributor_id = \? AND stato = 'in_attesa'/.test(s)) return { n: 2 };
  if (/FROM client_distributors cd JOIN users u ON u\.id = cd\.cliente_id/.test(s)) return elencoClienti();
  if (/^SELECT \* FROM users WHERE id = \? AND ruolo = 'cliente'/.test(s)) return utentiClienti[p[0]] || null;
  if (/^SELECT \* FROM client_distributors WHERE distributor_id = \? AND cliente_id = \?/.test(s)) return legamiClienti[p[1]] || null;
  if (/^UPDATE client_distributors SET stato = \?/.test(s)) { banco.decisioni.push(p); return { changes: 1 }; }
  if (/^SELECT nome FROM distributors WHERE id = \?/.test(s)) return { nome: distributoreBanco.nome };
  if (/FROM request_responses rr JOIN requests r ON r\.id = rr\.request_id JOIN users u/.test(s)) return richiesteBanco;
  if (/FROM orders o JOIN users u ON u\.id = o\.cliente_id WHERE o\.distributor_id/.test(s)) { banco.sqlHome.colonna = s; return ordiniBanco; }
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
  if (/FROM stripe_pagamenti WHERE request_id = \? AND stato IN/.test(s)) {
    const viste = stripeRighe.filter((r) => r.request_id === Number(p[0]) && ['autorizzato', 'da_incassare', 'incassato', 'da_rilasciare', 'rilasciato', 'scaduto', 'da_rimborsare', 'rimborsato'].includes(r.stato));
    return viste.length ? viste[viste.length - 1] : null;
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
  // L'ordine della richiesta (richiestaProva.ordine); gli altri id passano al DB finto del banco (ordiniDelBanco).
  if (/^SELECT \* FROM orders WHERE id = \?/.test(s) && richiestaProva.ordine && Number(p[0]) === richiestaProva.ordine.id) return richiestaProva.ordine;
  if (/^SELECT cliente_id FROM requests WHERE id = \?/.test(s)) return { cliente_id: 1 };
  if (/FROM request_items ri JOIN products p ON p\.id = ri\.product_id LEFT JOIN distributor_products dp/.test(s)) return [rigaRichiestaProva];
  if (/^SELECT \* FROM client_distributors WHERE distributor_id = \? AND cliente_id = \?/.test(s)) return richiestaProva.legame ? { id: 1, stato: 'approvato' } : null;
  return undefined;
}
// Ricevute (src/logica/pagamenti/ricevute.js): la tabella in memoria, con la stessa regola di numerazione dell'INSERT vero.
const ricevuteFinte = [];
function eseguiRicevute(s, p) {
  if (/^SELECT \* FROM ricevute WHERE ordine_id = \? AND tipo = \?/.test(s)) return ricevuteFinte.find((r) => r.ordine_id === Number(p[0]) && r.tipo === p[1]) || null;
  if (/^INSERT INTO ricevute/.test(s)) {
    const [ordineId, tipo] = p;
    if (ricevuteFinte.some((r) => r.ordine_id === Number(ordineId) && r.tipo === tipo)) return { changes: 0 };
    const numero = Math.max(0, ...ricevuteFinte.filter((r) => r.tipo === tipo).map((r) => r.numero)) + 1;
    ricevuteFinte.push({ id: ricevuteFinte.length + 1, anno: 2026, numero, ordine_id: Number(ordineId), tipo, creato_il: new Date() });
    return { changes: 1 };
  }
  return undefined;
}
// Iscrizioni alle notifiche push dei browser (src/logica/notifiche/web_push.js): la tabella in memoria, con le stesse regole delle query vere (endpoint unico, utente, chiave).
const iscrizioniPush = [];
function eseguiIscrizioniPush(s, p) {
  if (/^INSERT INTO iscrizioni_push/.test(s)) {
    const [userId, endpoint, p256dh, auth, chiave, userAgent] = p;
    const esistente = iscrizioniPush.find((r) => r.endpoint === endpoint);
    if (esistente) Object.assign(esistente, { user_id: userId, p256dh, auth, chiave, user_agent: userAgent });
    else iscrizioniPush.push({ id: iscrizioniPush.length + 1, user_id: userId, endpoint, p256dh, auth, chiave, user_agent: userAgent });
    return { changes: 1, lastInsertRowid: 1 };
  }
  if (/^SELECT id, endpoint, p256dh, auth FROM iscrizioni_push WHERE user_id = \? AND chiave = \?/.test(s)) return iscrizioniPush.filter((r) => r.user_id === p[0] && r.chiave === p[1]);
  const tolte = (fn) => { const prima = iscrizioniPush.length; for (let i = iscrizioniPush.length - 1; i >= 0; i--) if (fn(iscrizioniPush[i])) iscrizioniPush.splice(i, 1); return { changes: prima - iscrizioniPush.length }; };
  if (/^DELETE FROM iscrizioni_push WHERE endpoint = \? AND user_id = \?/.test(s)) return tolte((r) => r.endpoint === p[0] && r.user_id === p[1]);
  if (/^DELETE FROM iscrizioni_push WHERE endpoint = \?/.test(s)) return tolte((r) => r.endpoint === p[0]);
  if (/^DELETE FROM iscrizioni_push WHERE user_id = \? AND id NOT IN/.test(s)) return { changes: 0 }; // il tetto delle dieci iscrizioni: provato in test/notifiche/web_push.test.js
  if (/^DELETE FROM iscrizioni_push WHERE user_id = \?/.test(s)) return tolte((r) => r.user_id === p[0]);
  return undefined;
}
function esegui(sql, p, modo) {
  const s = sql.replace(/\s+/g, ' ');
  registro.push(s.slice(0, 90));
  if (/\biscrizioni_push\b/.test(s)) {
    const r = eseguiIscrizioniPush(s, p);
    if (r !== undefined) return modo === 'all' ? (Array.isArray(r) ? r : []) : Array.isArray(r) ? r[0] || null : r;
  }
  if (/\bricevute\b/.test(s)) {
    const r = eseguiRicevute(s, p);
    if (r !== undefined) return r;
  }
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
  // Recupero password, cambio password ed eliminazione dell'account (src/logica/account/recupero_password.js, src/logica/account/password_account.js, src/logica/account/account.js)
  if (/^SELECT id, username, email, referente, ragione_sociale FROM users WHERE ruolo = \? AND attivo = 1/.test(s)) {
    // p[0] = il ruolo cercato: il sito cerca solo fra i clienti.
    return accountProva.clienti.filter((u) => p[0] === 'cliente' && u.attivo === 1 && (u.username.toLowerCase() === String(p[1]).toLowerCase() || (u.email !== '' && u.email.toLowerCase() === String(p[2]).toLowerCase())));
  }
  if (/^UPDATE recupero_password SET usato_il = NOW\(\) WHERE user_id = \? AND usato_il IS NULL/.test(s)) {
    for (const l of accountProva.link) if (l.user_id === p[0]) l.usato = true;
    return { changes: 1 };
  }
  if (/^INSERT INTO recupero_password \(user_id, token_hash, scade_il\)/.test(s)) { accountProva.link.push({ id: accountProva.link.length + 1, user_id: p[0], token_hash: p[1], usato: false }); return { changes: 1 }; }
  if (/^SELECT r\.id AS recupero_id, u\.id, u\.username FROM recupero_password r JOIN users u/.test(s)) {
    const l = accountProva.link.find((x) => x.token_hash === p[0] && !x.usato);
    const u = l && accountProva.clienti.find((x) => x.id === l.user_id && x.attivo === 1);
    return u ? { recupero_id: l.id, id: u.id, username: u.username } : null;
  }
  if (/^UPDATE recupero_password SET usato_il = NOW\(\) WHERE id = \? AND usato_il IS NULL AND scade_il > NOW\(\)/.test(s)) {
    const l = accountProva.link.find((x) => x.id === p[0]);
    if (!l || l.usato) return { changes: 0 };
    l.usato = true;
    return { changes: 1 };
  }
  if (/^SELECT \(SELECT COUNT\(\*\) FROM requests WHERE cliente_id = \? AND stato = 'in_attesa'\) AS richieste/.test(s)) return accountProva.corso;
  if (/^(UPDATE users SET password_hash = \?|UPDATE users SET attivo = 0|UPDATE app_tokens SET revocato_il|DELETE FROM app_tokens WHERE user_id|DELETE FROM session WHERE \(sess::jsonb)/.test(s)) {
    accountProva.scritture.push({ s, p });
    return { changes: 1 };
  }
  if (/^UPDATE users SET geo_lat = \?, geo_lng = \?, geo_precisione = \?, geo_consenso = 1, geo_aggiornata_il = NOW\(\) WHERE id = \? AND ruolo = 'cliente'$/.test(s)) {
    posizioniProva.push(p);
    return { changes: 1 };
  }
  if (/FROM config WHERE chiave/.test(s)) return config[p[0]] !== undefined ? { valore: config[p[0]] } : null;
  if (/^SELECT \* FROM distributors WHERE attivo = 1 ORDER BY nome/.test(s)) return modo === 'all' ? banchiAttiviProva.righe : banchiAttiviProva.righe[0] || null;
  if (/FROM users WHERE username/.test(s)) return p[0] === 'prova' ? utente : p[0] === utenteCorriere.username ? utenteCorriere : null;
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
  if (/^SELECT COUNT\(\*\) AS n FROM notifications WHERE user_id = \? AND categoria = \? AND letta = 0$/.test(s)) return { n: p[1] === 'ordini' ? notificheCliente.nonLette : 0 };
  if (/^UPDATE notifications SET letta = 1 WHERE user_id = \? AND categoria = \?$/.test(s)) {
    if (p[1] === 'ordini') notificheCliente.nonLette = 0;
    return { changes: 1 };
  }
  if (/COUNT\(\*\)/.test(s)) return modo === 'get' ? { n: 0 } : [];
  return modo === 'all' ? [] : modo === 'get' ? null : { changes: 0, lastInsertRowid: null };
}
const dbFinto = {
  prepare: (sql) => ({ get: async (...p) => esegui(sql, p, 'get'), all: async (...p) => esegui(sql, p, 'all'), run: async (...p) => esegui(sql, p, 'run') }),
  exec: async () => {}, ensureInit: async () => {}, mantieniCalde() {}, transaction: (fn) => (...a) => fn(...a),
  query: async () => ({ rows: [] }), pool: {},
};

// ---------------- pezzi usati da più file di prove ----------------
// ---------------- Storico ordini: il materiale e quanto si deve a BOREA (src/logica/ordini/materiale.js) ----------------

const pagina = async (percorso) => {
  const r = await chiedi(percorso);
  assert.equal(r.status, 200, percorso);
  return r.text();
};

// ---- Registrazione a tre passi, collegamento automatico al distributore predefinito, benvenuto ----

const iscrizione = {
  tipo_soggetto: 'impresa', ragione_sociale: 'Rossi Impianti S.r.l.', referente: 'Mario Rossi', email: 'info@rossi.it',
  telefono: '333 1234567', partita_iva: '01234567890', codice_fiscale: '', indirizzo: 'Via Roma 1', cap: '16100',
  citta: 'Genova', provincia: 'GE', sdi_pec: '', username: 'rossimpianti', password: 'password-lunga', password2: 'password-lunga',
};

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

// ---------------- il server vero ----------------
const erroriServer = []; // gli errori che il server scrive nel log durante le prove
const chiaviVapidProva = require('web-push').generateVAPIDKeys(); // generate qui: le prove non usano mai quelle del .env

// Nominatim finto: la posizione dell'indirizzo di consegna (cerca) e l'indirizzo dalla posizione (inversa) non escono mai sulla rete. Il resto passa al fetch vero
// (le prove parlano col server su 127.0.0.1). `nominatim.cerca`/`inversa` si cambiano nelle prove; `chiamate` dice cosa è stato chiesto.
const nominatim = {
  chiamate: [],
  cerca: [{ lat: '44.4056', lon: '8.9463', display_name: 'Via Prova 1, Genova' }],
  inversa: { address: { country_code: 'it', road: 'Via Puggia', house_number: '22/3', postcode: '16131', city: 'Genova', 'ISO3166-2-lvl6': 'IT-GE' } },
};

// Il browser di prova: tiene il cookie di sessione. Le prove lo azzerano (`biscotti.cookie = ''`) per presentarsi senza accesso.
const biscotti = { cookie: '' };
let base = ''; // l'indirizzo del server di questo file, deciso da avvia()
async function chiedi(percorso, opzioni = {}) {
  const r = await fetch(base + percorso, { redirect: 'manual', ...opzioni, headers: { ...(biscotti.cookie ? { cookie: biscotti.cookie } : {}), ...(opzioni.headers || {}) } });
  const nuovo = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (nuovo.length) biscotti.cookie = nuovo.map((c) => c.split(';')[0]).join('; ');
  return r;
}
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const json = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

// Avvia il server vero su `porta` con l'ambiente di prova e il DB finto. Si chiama una volta, in cima al file di prove, PRIMA di prendere `base` da questo modulo.
// Ogni file di prove ha la sua porta: node --test li fa girare in parallelo, in processi separati.
function avvia(porta) {
  process.env.PORT = String(porta);
  process.env.SESSION_SECRET = 'segreto-di-prova';
  // Spento ESPLICITAMENTE ('0', non cancellata): dotenv non sovrascrive le variabili già definite, ma una cancellata la rimetteva dal .env, e con WHATSAPP_ATTIVO=1
  // nel .env del PC le prove avviavano il vero WhatsApp (sessione locale, rischio di scollegare il bot con un 440) e due prove fallivano.
  process.env.WHATSAPP_ATTIVO = '0';
  // Nessuna chiamata di rete dalle prove: il tragitto sulla mappa (src/logica/ordini/percorso.js) è spento, come ogni altro servizio esterno.
  process.env.ROUTING_ATTIVO = '0';
  // I limiti di richieste per indirizzo (express-rate-limit) restano spenti qui: le prove fanno centinaia di richieste dallo stesso indirizzo. Si provano a parte (test/middleware/limiti_richieste.test.js).
  process.env.LIMITE_RICHIESTE_DISATTIVATO = '1';
  const percorsoDb = require.resolve(path.join(radice, 'db/index.js'));
  require.cache[percorsoDb] = { id: percorsoDb, filename: percorsoDb, loaded: true, exports: dbFinto };

  // Le prove non dipendono dal .env vero (che server.js carica con dotenv, senza sovrascrivere le variabili già definite):
  // chiavi Stripe e indirizzo del sito vuoti = spenti, come su un PC senza configurazione.
  for (const nome of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MODO',
    'STRIPE_LIVE_SECRET_KEY', 'STRIPE_LIVE_PUBLISHABLE_KEY', 'STRIPE_LIVE_PUBLIC_KEY', 'STRIPE_LIVE_WEBHOOK_SECRET',
    'STRIPE_TEST_SECRET_KEY', 'STRIPE_TEST_PUBLISHABLE_KEY', 'STRIPE_TEST_PUBLIC_KEY', 'STRIPE_TEST_WEBHOOK_SECRET', 'APP_URL', 'APPROVAZIONE_AUTOMATICA', 'DISTRIBUTORE_PREDEFINITO', 'PAGAMENTO_SIMULATO', 'PAGAMENTO_SIMULATO_FORZA', 'PAGAMENTO_APP_PROVA', 'PAGAMENTO_APP_PROVA_LIVE', 'FINESTRA_CONFERMA_SEC']) {
    process.env[nome] = '';
  }
  // Notifiche ad app chiusa: chiavi VAPID di prova (`chiaviVapidProva`, mai quelle del .env) e un contatto, così le rotte /api/push/... funzionano; l'invio vero è
  // sostituito da un finto nelle prove che lo usano (impostaInvio) e nessuna prova esce sulla rete.
  process.env.VAPID_PUBLIC_KEY = chiaviVapidProva.publicKey;
  process.env.VAPID_PRIVATE_KEY = chiaviVapidProva.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:prova@example.com';
  process.env.PUSH_ATTIVO = '';
  process.env.HOST = '127.0.0.1'; // il .env del PC può avere 0.0.0.0 (telefono sulla stessa rete): le prove restano sul computer

  const consoleOriginale = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = (...a) => erroriServer.push(a.map(String).join(' ').slice(0, 200));
  require(path.join(radice, 'server.js'));

  const fetchVero = globalThis.fetch;
  globalThis.fetch = (url, opzioni) => {
    if (!/nominatim\.openstreetmap\.org/.test(String(url))) return fetchVero(url, opzioni);
    nominatim.chiamate.push(String(url));
    const corpo = /\/reverse\?/.test(String(url)) ? nominatim.inversa : nominatim.cerca;
    return Promise.resolve({ ok: !!corpo, json: async () => corpo });
  };

  base = 'http://127.0.0.1:' + porta;
  module.exports.base = base;
  module.exports.PORTA = porta;

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
}

module.exports = {
  FILIALI, accountProva, anagraficaProva, articoliOrdine10, avvia, avvisiBanco, banchiAttiviProva, banco, bcrypt, biscotti, catalogo,
  chiaviVapidProva, chiedi, config, consegnatoIl, dataProva, dbFinto, distributoreBanco, elencoClienti, erroriServer, esegui, eseguiBanco,
  eseguiIscrizioniPush, eseguiMaterialeProva, eseguiOrdineProva, eseguiRegistrazione, eseguiRicevute, eseguiRichiestaProva, eseguiStorico,
  eseguiStripe, fa, form, importiNuovi, iscritto, iscrizione, iscrizioniPush, json, legamiClienti, materialeProva, naive, nominatim,
  notificheCliente, oraRoma, ordine1295, ordiniBanco, ordiniDelBanco, ordiniProva, pagatoIlProva, pagina, posizioniProva, preparaRichiesta, radice,
  registrazione, registro, ricevuteFinte, richiestaProva, richiesteBanco, richiesteTempiProva, rigaRichiestaProva, righeOrdineBanco,
  righeOrdineNuovo, righeOrdineProva, righeRichiesteBanco, ritiroTra, scrittureAnagrafica, scrittureOrdini, sessioni, storico,
  storicoBanco, stripeRighe, ultimiOrdini, ultimoOrdineRighe, utc, utente, utenteBanco, utenteCorriere, utentiClienti,
};
