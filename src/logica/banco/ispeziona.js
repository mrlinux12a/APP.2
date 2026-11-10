// Il popup "Ispeziona" della home del banco (richiesta del 10/11/2026): cliente, tempo e materiale di UN lavoro, in qualunque fase si trovi.
// Un lavoro ha una chiave che non cambia quando la richiesta diventa ordine: "r177" (la richiesta 177, e poi l'ordine nato da lei) oppure "o1281" (un ordine
// senza richiesta). Così il popup aperto segue il lavoro da una colonna all'altra: la home lo rilegge a ogni cambiamento della bacheca e la fase si aggiorna
// da sola (assets/js "Popup Ispeziona del banco"). Qui si decide solo cosa dire; il disegno è views/partials/banco/ispeziona.ejs.
// Legge e basta: niente scritture (le azioni del popup usano le rotte di sempre: "rispondi" e "preparazione").
const crypto = require('crypto');
const pricing = require('../pagamenti/pricing');
const richieste = require('../ordini/richieste');
const datiOrdini = require('../ordini/ordini');
const orariCorriere = require('../ordini/corriere');
const utenti = require('../account/utenti');
const anagrafiche = require('../account/anagrafiche');
const richiestaBanco = require('./richiesta');
const storicoBanco = require('./storico');
const { rispostaConTempi } = require('./banco');

// Le quattro fasi del popup: le tre colonne della home più "chiuso" (il lavoro non è più in bacheca: ritirato, scaduto, rifiutato, annullato...).
const FASI = {
  da_confermare: { etichetta: 'Da confermare' },
  attesa_corriere: { etichetta: 'Attesa corriere' },
  da_preparare: { etichetta: 'Da preparare' },
  chiuso: { etichetta: 'Non più in bacheca' },
};

// Perché un lavoro non è più in bacheca, in parole semplici (la chiave è quella di statoRichiestaBanco).
const MOTIVI_CHIUSURA = {
  non_disponibile: 'Hai segnato la richiesta come non disponibile.',
  annullata: 'Il cliente ha annullato la richiesta.',
  chiusa: 'Il cliente ha già ordinato da un altro banco.',
  scaduta: 'Il tempo per rispondere è scaduto.',
  senza_corriere: 'Nessun corriere ha preso la consegna in tempo: la richiesta è chiusa.',
  confermata: 'Questa richiesta non è più in bacheca.',
};

// Legge la chiave di un lavoro: { tipo: 'r' | 'o', id }, o null se non è fatta così.
function leggiChiave(chiave) {
  const m = /^([ro])(\d{1,9})$/.exec(String(chiave || ''));
  return m ? { tipo: m[1], id: Number(m[2]) } : null;
}

// Le righe di un ordine nella forma che vuole `tabellaMateriale` (la stessa tabella della richiesta: nome, codice, listino, prezzo per il cliente, totale).
// Il prezzo è quello salvato nell'ordine (il prezzo del banco, IVA esclusa), non il listino di oggi.
function tabellaDaOrdine(righe) {
  return richiestaBanco.tabellaMateriale(
    righe.map((r) => ({
      nome: r.nome_snapshot,
      codice: r.codice_snapshot,
      quantita: r.quantita,
      quantita_richiesta: r.quantita,
      prezzo_listino: Number(r.prezzo_listino_snapshot) || Number(r.prezzo_netto_unitario) || 0,
      prezzo_netto: r.prezzo_netto_unitario,
      raee: r.raee_unitario,
    })),
    (riga) => Number(riga.prezzo_netto) || 0,
    { confermata: true }
  );
}

// Il popup di un lavoro del banco, o null se il lavoro non esiste o non è di questo banco (la route risponde 404).
//   { chiave, fase, etichetta, codice, motivo, cliente, tempo, materiale, richiestaId, ordineId, firma }
// `tempo` dipende dalla fase: da_confermare { secondi, finestra }, attesa_corriere { trascorsi }, da_preparare { arrivo: { secondi, totale } | null, corriere }.
// `firma` riassume tutto tranne i secondi che scorrono: finché non cambia, il popup aperto non si ridisegna (e i suoi conti alla rovescia non ripartono).
async function schedaIspeziona(distributorId, chiave) {
  const k = leggiChiave(chiave);
  if (!k) return null;

  let richiesta = null;
  let risposta = null;
  let ordine = null;
  if (k.tipo === 'r') {
    richiesta = await richieste.getRichiesta(k.id);
    risposta = richiesta ? await rispostaConTempi(richiesta.id, distributorId) : null;
    if (!richiesta || !risposta) return null;
    ordine = richiesta.order_id ? await datiOrdini.ordinePerId(richiesta.order_id) : null;
  } else {
    ordine = await datiOrdini.ordinePerId(k.id);
    if (!ordine || ordine.distributor_id !== distributorId) return null;
    richiesta = ordine.request_id ? await richieste.getRichiesta(ordine.request_id) : null;
    risposta = richiesta ? await rispostaConTempi(richiesta.id, distributorId) : null;
  }
  const ordineMio = !!ordine && ordine.distributor_id === distributorId;

  // La fase: la stessa logica delle colonne della home (bacheca.js).
  const secondi = richiesta ? Math.max(0, Number(await richieste.secondiRimasti(richiesta)) || 0) : 0;
  let fase;
  let motivo = '';
  if (ordineMio) {
    const stato = storicoBanco.statoStorico(ordine);
    if (stato.chiave === 'da_preparare') fase = 'da_preparare';
    else {
      fase = 'chiuso';
      motivo = stato.chiave === 'consegnato' ? 'Questo ordine è già stato consegnato.' : 'Il corriere ha ritirato il materiale: ora l\'ordine è «In consegna» e lo trovi nello Storico.';
    }
  } else if (risposta) {
    const apribile = risposta.esito === 'in_attesa' && secondi > 0 && richiesta.stato !== 'ordinata' && richiesta.stato !== 'annullata';
    const stato = richiestaBanco.statoRichiestaBanco({ richiesta, risposta, apribile });
    if (stato.chiave === 'da_confermare') fase = 'da_confermare';
    else if (stato.chiave === 'attesa_corriere' && secondi > 0) fase = 'attesa_corriere';
    else {
      fase = 'chiuso';
      motivo = MOTIVI_CHIUSURA[stato.chiave] || MOTIVI_CHIUSURA.confermata;
    }
  } else {
    return null;
  }

  const clienteId = (ordine || richiesta).cliente_id;
  const [cliente, legame] = await Promise.all([utenti.utentePerId(clienteId), anagrafiche.legame(distributorId, clienteId)]);
  if (!cliente) return null;

  // Il materiale: dall'ordine (prezzi salvati) quando c'è, dalla richiesta (prezzi calcolati sul listino del banco) prima. Nel popup "chiuso" lo si mostra
  // se si riesce a leggerlo, così chi lo aveva aperto non perde di vista cosa c'era; se la lettura fallisce resta solo l'avviso.
  let materiale = null;
  try {
    if (ordineMio) materiale = tabellaDaOrdine(await datiOrdini.righeOrdine(ordine.id));
    else if (richiesta) {
      const offerta = await richieste.calcolaOfferta(richiesta.id, distributorId);
      materiale = richiestaBanco.tabellaMateriale(offerta.righe, (riga) => pricing.prezzoNetto(riga), { confermata: risposta.esito === 'confermato' });
    }
  } catch (err) {
    if (fase !== 'chiuso') throw err;
  }

  let tempo = null;
  if (fase === 'da_confermare') {
    tempo = { secondi, finestra: Math.max(1, Math.round((await pricing.getFinestraMinuti()) * 60)) };
  } else if (fase === 'attesa_corriere') {
    tempo = { trascorsi: Math.max(0, Number(risposta.secondi_da_risposta) || 0) };
  } else if (fase === 'da_preparare') {
    // Il tempo scritto dal corriere (WhatsApp o app dei corrieri): è l'unico orario del corriere che il banco vede. Senza corriere non c'è conto alla rovescia.
    const ritiro = orariCorriere.ritiro(ordine);
    const alRitiro = ritiro ? await datiOrdini.secondiAlRitiro(ordine.id) : null;
    const rimasti = Number(alRitiro && alRitiro.secondi) || 0;
    tempo = {
      arrivo: ritiro ? { secondi: rimasti, totale: Math.max(1, Math.round((Number(ordine.corriere_minuti) || 0) * 60), rimasti) } : null,
      corriere: ordine.corriere_nome || '',
    };
  }

  const scheda = {
    chiave: ordineMio && richiesta ? 'r' + richiesta.id : ordineMio ? 'o' + ordine.id : 'r' + richiesta.id,
    fase,
    etichetta: FASI[fase].etichetta,
    // Il numero della richiesta finché non c'è l'ordine, poi quello dell'ordine: come nelle schede della home e come in Storico.
    codice: 'ORD-' + (ordineMio ? ordine.id : richiesta.id),
    motivo,
    cliente: {
      nome: cliente.ragione_sociale,
      piva: cliente.partita_iva || '',
      telefono: cliente.telefono || '',
      scheda: legame ? '/distributore/clienti/' + cliente.id : '',
    },
    tempo,
    materiale,
    richiestaId: richiesta ? richiesta.id : null,
    ordineId: ordineMio ? ordine.id : null,
  };
  // Tutto tranne i secondi che scorrono: di `tempo` contano solo la durata totale del ritiro e il nome del corriere.
  const { fase: f, codice, motivo: m, cliente: c, materiale: mat, richiestaId, ordineId } = scheda;
  const fisso = { f, codice, m, c, mat, richiestaId, ordineId, totale: tempo && tempo.arrivo ? tempo.arrivo.totale : null, corriere: tempo ? tempo.corriere || '' : '' };
  scheda.firma = crypto.createHash('md5').update(JSON.stringify(fisso)).digest('hex').slice(0, 12);
  return scheda;
}

module.exports = { schedaIspeziona, leggiChiave, tabellaDaOrdine, FASI };
