// Dettaglio di una richiesta al banco (GET /distributore/richieste/:id, views/distributore_dettaglio.ejs): lo stato da mostrare
// accanto al titolo, la tabella del materiale con i totali e i passi di "Cosa succede dopo la conferma". Solo presentazione,
// niente DB: la route legge, la vista disegna.

// Negli ultimi 2 minuti il timer passa dall'arancio al rosso. (La home del banco usa 3 minuti, BACHECA.urgenteSec in server.js:
// qui la soglia è quella chiesta per questa pagina.)
const SOGLIA_URGENTE_SEC = 120;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Lo stato della richiesta per il banco: { chiave, etichetta }. La chiave sceglie il colore (classe ric-st-<chiave>).
//   da_confermare   la finestra è aperta e il banco non ha ancora risposto
//   attesa_corriere il banco ha confermato, nel gruppo WhatsApp nessun corriere ha ancora preso la consegna
//   da_preparare    l'ordine è nato (consegna presa, o senza corriere) e il banco non l'ha ancora preparato
//   confermata      confermata e consegna presa (o senza corriere), ordine già preparato o in arrivo
//   senza_corriere  confermata ma nessun corriere ha preso la consegna in tempo
//   non_disponibile il banco ha rifiutato
//   annullata       l'ha annullata il cliente
//   chiusa          il cliente ha già ordinato da un altro banco
//   scaduta         nessuna risposta entro la finestra
// `ordineMio`: l'ordine della richiesta è di questo banco; `ordineDaPreparare`: ed è ancora nella colonna "Da preparare" della home.
function statoRichiestaBanco({ richiesta, risposta, apribile, ordineMio = false, ordineDaPreparare = false }) {
  if (apribile) return { chiave: 'da_confermare', etichetta: 'Da confermare' };
  if (risposta.esito === 'confermato') {
    if (richiesta.stato === 'annullata') return { chiave: 'annullata', etichetta: 'Annullata' };
    if (richiesta.stato === 'ordinata' && !ordineMio) return { chiave: 'chiusa', etichetta: 'Chiusa' };
    if (risposta.corriere_stato === 'scaduto' || (richiesta.stato === 'nessuna_offerta' && risposta.corriere_stato === 'in_attesa')) {
      return { chiave: 'senza_corriere', etichetta: 'Nessun corriere' };
    }
    if (risposta.corriere_stato === 'in_attesa') return { chiave: 'attesa_corriere', etichetta: 'Attesa corriere' };
    if (ordineMio && ordineDaPreparare) return { chiave: 'da_preparare', etichetta: 'Da preparare' };
    return { chiave: 'confermata', etichetta: 'Confermata' };
  }
  if (risposta.esito === 'non_disponibile') return { chiave: 'non_disponibile', etichetta: 'Non disponibile' };
  if (richiesta.stato === 'annullata') return { chiave: 'annullata', etichetta: 'Annullata' };
  if (richiesta.stato === 'ordinata') return { chiave: 'chiusa', etichetta: 'Chiusa' };
  return { chiave: 'scaduta', etichetta: 'Scaduta' };
}

// La tabella del materiale: quantità, articolo e codice, listino, prezzo per il cliente (dal 16/10/2026 il PREZZO DEL BANCO: listino meno lo
// sconto del banco, IVA esclusa; il 10% di servizio non c'è più nei prezzi, lo paga il cliente alla piattaforma) e totale di riga, più il totale per il cliente (merce + contributo RAEE, IVA esclusa). Prima della risposta e se il banco
// ha rifiutato si contano le quantità richieste; se ha confermato, quelle che ha confermato (le mancanti si vedono: `mancano`).
// `prezzoClienteDi(riga)` è il prezzo unitario per il cliente.
function tabellaMateriale(righe, prezzoClienteDi, { confermata = false } = {}) {
  const lista = righe.map((r) => {
    const richiesta = Number(r.quantita_richiesta);
    const quantita = confermata ? Number(r.quantita) : richiesta;
    const unitario = prezzoClienteDi(r);
    return {
      nome: r.nome,
      codice: r.codice,
      quantita,
      richiesta,
      mancano: Math.max(0, richiesta - quantita),
      listino: Number(r.prezzo_listino),
      unitario,
      totale: round2(unitario * quantita),
      raee: round2((Number(r.raee) || 0) * quantita),
    };
  });
  const raee = round2(lista.reduce((somma, r) => somma + r.raee, 0));
  return {
    righe: lista,
    nArticoli: lista.length,
    nPezzi: lista.reduce((somma, r) => somma + r.quantita, 0),
    raee,
    totale: round2(lista.reduce((somma, r) => somma + r.totale, 0) + raee),
  };
}

// I passi della richiesta, in due versioni:
//  - "Cosa succede dopo la conferma" (da confermare): i tre passi spiegati prima di rispondere;
//  - "Avanzamento" (attesa corriere, con `avanzamento`): gli stessi passi con a che punto si è: fatto, in corso, da fare.
// Col modulo WhatsApp spento l'ordine nasce subito alla conferma e non c'è il passo dei corrieri (sarebbe falso): restano due passi.
// `corrente` è la chiave del passo in cui si è ('conferma', 'corrieri', 'prepara'). Ogni passo ha anche `fase`, rispetto a quello
// corrente: 'fatto' (viene prima), 'corrente' o 'futuro' (viene dopo). Se `corrente` non è fra i passi, sono tutti 'futuro'.
// `avanzamento` = { conCorriere, oraConferma, corriere, daPreparare }: cambia i testi (e solo quelli) come li vuole la scheda "Avanzamento".
// `corriere` ({ nome, oraConsegna }, se un corriere ha preso la consegna) e `daPreparare` (l'ordine è nato e aspetta il banco) servono quando
// il passo dei corrieri è già fatto.
function passiDopoConferma({ conCorriere, corrente, avanzamento = null }) {
  const passi = conCorriere
    ? [
        { chiave: 'conferma', tono: 'arancio', titolo: 'Confermi la disponibilità', testo: 'Il cliente vede che hai il materiale.' },
        { chiave: 'corrieri', tono: 'viola', titolo: 'Avvisiamo i corrieri', testo: 'Non preparare ancora: aspetta che un corriere accetti la consegna.' },
        { chiave: 'prepara', tono: 'verde', titolo: 'Prepari il materiale', testo: 'L\u2019ordine compare in Da preparare con l\u2019ora di ritiro.' },
      ]
    : [
        { chiave: 'conferma', tono: 'arancio', titolo: 'Confermi la disponibilità', testo: 'Il cliente vede che hai il materiale.' },
        { chiave: 'prepara', tono: 'verde', titolo: 'Prepari il materiale', testo: 'L\u2019ordine compare subito in Da preparare.' },
      ];
  const indice = passi.findIndex((p) => p.chiave === corrente);
  return passi.map((p, i) => ({
    ...p,
    ...(avanzamento ? testiAvanzamento(p.chiave, avanzamento) : {}),
    corrente: p.chiave === corrente,
    fase: indice < 0 ? 'futuro' : i < indice ? 'fatto' : i === indice ? 'corrente' : 'futuro',
  }));
}

// I testi dei passi nella scheda "Avanzamento". Il passo dei corrieri porta `conTempo`: la vista scrive "· da N min" dopo il titolo
// (e lo script lo tiene aggiornato).
function testiAvanzamento(chiave, { conCorriere, oraConferma, corriere = null, daPreparare = false }) {
  if (chiave === 'conferma') {
    return { titolo: 'Disponibilità confermata', testo: oraConferma && oraConferma !== '—' ? `Fatto alle ${oraConferma}` : 'Fatto' };
  }
  if (chiave === 'corrieri') {
    // Un corriere ha accettato: il passo è fatto. L'ora è quella entro cui consegna dal cliente (orders.corriere_arrivo_il).
    if (corriere) {
      return {
        titolo: corriere.nome ? `Consegna presa da ${corriere.nome}` : 'Consegna presa',
        testo: corriere.oraConsegna ? `Dal cliente entro le ${corriere.oraConsegna}.` : 'Il corriere è in arrivo.',
      };
    }
    return { titolo: 'Corriere avvisato', conTempo: true, testo: 'Aspettiamo che un corriere accetti la consegna.' };
  }
  if (daPreparare) return { titolo: 'Da preparare', testo: 'Quando hai finito, premi "Preparato".' };
  return {
    titolo: 'Da preparare',
    testo: conCorriere
      ? 'Quando un corriere accetta, l\u2019ordine passa in Da preparare con l\u2019ora di ritiro.'
      : 'L\u2019ordine passa subito in Da preparare.',
  };
}

// "oggi alle 21:04", "ieri alle 21:04", "il 12 ottobre alle 21:04" da giorno (fmt.giornoRoma) e ora (fmt.oraSolaRoma).
function quandoRicevuta(giorno, ora) {
  const quando = giorno.etichetta === 'Oggi' ? 'oggi' : giorno.etichetta === 'Ieri' ? 'ieri' : 'il ' + giorno.etichetta;
  return `${quando} alle ${ora}`;
}

module.exports = { SOGLIA_URGENTE_SEC, statoRichiestaBanco, tabellaMateriale, passiDopoConferma, quandoRicevuta };
