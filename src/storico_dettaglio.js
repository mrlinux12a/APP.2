// Il dettaglio che si apre sotto una riga dello Storico ordini del banco (GET /distributore/storico/:id/dettaglio, views/partials/storico_dettaglio.ejs).
// Tre colonne: il materiale a prezzo del banco con il totale da incassare, "Come è andata" (i momenti dell'ordine) e i pulsanti.
// Qui sta la preparazione dei dati: `cronologia` e `costruisciDettaglio` sono pure (si provano senza DB), `leggiDettaglio` fa le letture.
// Aprire il dettaglio NON cambia l'ordine: è una lettura, niente prendiInCarico (vedi server.js).
const format = require('./format');
const orariCorriere = require('./corriere');
const ordineBanco = require('./ordine_banco');
const pricing = require('./pricing');
const { statoStorico } = require('./storico_banco');

// "Come è andata": i momenti dell'ordine, nell'ordine in cui accadono. Ogni passo: { chiave, fase: 'fatto' | 'corrente' | 'futuro', ora, giorno, completo, testo }
// (ora vuota se non si conosce o il passo deve ancora venire: la vista scrive "—").
//  · Ricevuto (creato_il), Confermato da te (risposta.risposto_il), Corriere {nome} ha accettato (corriere_risposto_il): sempre fatti, se c'è il dato.
//    Un passo senza dati (niente corriere: modulo WhatsApp spento) non si scrive.
//  · Da preparare: "Partito" e "Consegnato" devono ancora venire.
//  · In consegna: "Partito · in viaggio" è il passo in corso; "Consegnato" deve ancora venire. Il banco non vede quando arriva la merce dal cliente: per lui
//    conta solo il tempo scritto dal corriere su WhatsApp (arriva al banco), che sta già nel passo "Corriere ... ha accettato".
//  · Consegnato: "Partito" (se c'è un momento di partenza) e "Consegnato · confermato dal cliente", fatti.
function cronologia(o, { risposta = null, corriereNome = '' } = {}) {
  const passo = (chiave, fase, valore, testo, opzioni) => {
    const m = valore ? ordineBanco.momento(valore, o.creato_il, opzioni) : null;
    return { chiave, fase, ora: m ? m.ora : '', giorno: m ? m.giorno : '', completo: m ? m.completo : '', testo };
  };
  const passi = [passo('ricevuto', 'fatto', o.creato_il, 'Ricevuto')];
  if (risposta && risposta.risposto_il) passi.push(passo('conferma', 'fatto', risposta.risposto_il, 'Confermato da te'));
  if (o.corriere_risposto_il || o.corriere_nome) {
    const nome = corriereNome || o.corriere_nome || '';
    // Il tempo che il corriere ha scritto su WhatsApp: quando arriva dal banco ("ritira alle 09:40", con il giorno se non è quello dell'ordine).
    const istanteRitiro = orariCorriere.ritiro(o);
    const ritiro = istanteRitiro ? ordineBanco.momento(istanteRitiro, o.creato_il, { reale: true }) : null;
    const quandoRitira = ritiro ? `, ritira ${ritiro.giorno ? 'il ' + ritiro.giorno + ' ' : ''}alle ${ritiro.ora}` : '';
    passi.push(passo('corriere', 'fatto', o.corriere_risposto_il, (nome ? `Corriere ${nome} ha accettato` : 'Un corriere ha accettato') + quandoRitira, { reale: true }));
  }

  const stato = statoStorico(o).chiave;
  const partenza = ordineBanco.partenza(o);
  if (stato === 'da_preparare') {
    passi.push(passo('partito', 'futuro', null, 'Partito'), passo('consegnato', 'futuro', null, 'Consegnato'));
  } else if (stato === 'in_consegna') {
    passi.push(passo('partito', 'corrente', partenza, 'Partito · in viaggio'), passo('consegnato', 'futuro', null, 'Consegnato'));
  } else {
    if (partenza) passi.push(passo('partito', 'fatto', partenza, 'Partito'));
    passi.push(passo('consegnato', 'fatto', o.consegnato_il, 'Consegnato · confermato dal cliente'));
  }
  return passi;
}

// "2 articoli · 2 pezzi", "1 articolo · 1 pezzo".
function contaMateriale(righe) {
  const articoli = righe.length;
  const pezzi = righe.reduce((somma, r) => somma + (Number(r.quantita) || 0), 0);
  return `${articoli} ${articoli === 1 ? 'articolo' : 'articoli'} · ${pezzi} ${pezzi === 1 ? 'pezzo' : 'pezzi'}`;
}

// La riga col furgone sotto i momenti: "Corriere Marco" (solo se c'è un corriere con un nome; senza nome ma con corriere "Corriere"), oppure il ritiro del cliente.
function rigaCorriere(o, corriereNome) {
  if (o.modalita === 'ritiro') return 'Ritiro al banco da parte del cliente';
  if (corriereNome) return `Corriere ${corriereNome}`;
  return o.corriere_risposto_il ? 'Corriere' : '';
}

// Tutto quello che serve al frammento HTML, già pronto: la vista non fa conti.
//   `ordine`: la riga di orders; `righe`: le sue order_items; `risposta`: la risposta del banco alla richiesta (o null); `mancanti`: le righe confermate a metà
//   (richieste.calcolaOfferta, solo con copertura parziale); `destinazione`: dove si consegna (quella dell'ordine o, per i vecchi, l'indirizzo del cliente);
//   `ivaConfig`: l'IVA di oggi (ripiego); `legame`: se il cliente ha indicato questo banco (altrimenti la sua scheda risponde 404: niente link morto).
function costruisciDettaglio({ ordine, righe, risposta = null, mancanti = [], destinazione = '', ivaConfig, legame = false }) {
  const importi = pricing.importi({ ordine, pagamento: null, ivaPct: pricing.ivaPctOrdine(ordine, ivaConfig) });
  const materiale = ordineBanco.righeMateriale(righe, mancanti);
  const corriereNome = ordine.corriere_nome || (risposta && risposta.corriere_nome) || '';
  return {
    id: ordine.id,
    clienteId: ordine.cliente_id,
    schedaClienteAperta: !!legame,
    stato: statoStorico(ordine),
    materiale,
    conta: contaMateriale(materiale.righe),
    banco: importi.banco,
    ivaPct: importi.ivaPct,
    passi: cronologia(ordine, { risposta, corriereNome }),
    destinazione,
    corriere: rigaCorriere(ordine, corriereNome),
  };
}

// Le letture del dettaglio di un ordine che il banco ha già verificato essere suo: righe e risposta insieme (e, se servono, l'indirizzo del cliente e il legame
// per il link alla sua scheda), poi i "mancanti" solo per una risposta con copertura parziale. Niente scritture.
async function leggiDettaglio(ordine) {
  const db = require('../db'); // qui e non in testa: le funzioni pure di sopra si provano senza toccare il DB
  const richieste = require('./richieste');
  const anagrafiche = require('./anagrafiche');
  const [righe, risposta, cliente, legame, ivaConfig] = await Promise.all([
    db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(ordine.id),
    ordine.request_id ? richieste.getRisposta(ordine.request_id, ordine.distributor_id) : null,
    ordine.destinazione ? null : db.prepare('SELECT * FROM users WHERE id = ?').get(ordine.cliente_id),
    anagrafiche.legame(ordine.distributor_id, ordine.cliente_id),
    pricing.getIvaPct(),
  ]);
  const mancanti = risposta && risposta.copertura === 'parziale' ? (await richieste.calcolaOfferta(ordine.request_id, ordine.distributor_id)).mancanti : [];
  // Come la pagina dell'ordine: la destinazione dell'ordine, altrimenti l'indirizzo di consegna del cliente (gli ordini più vecchi non l'hanno salvata).
  const destinazione = ordine.destinazione || (cliente && (cliente.indirizzo_consegna || format.indirizzoCompleto(cliente))) || '';
  return costruisciDettaglio({ ordine, righe, risposta, mancanti, destinazione, ivaConfig, legame });
}

module.exports = { cronologia, contaMateriale, rigaCorriere, costruisciDettaglio, leggiDettaglio };
