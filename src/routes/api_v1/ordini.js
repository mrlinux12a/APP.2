// Ordine dell'app: pagina dell'ordine, riordina ed eliminazione.
const { creaRouter } = require('../base');
const catalogo = require('../../logica/catalogo/catalogo');
const pricing = require('../../logica/pagamenti/pricing');
const flusso = require('../../logica/ordini/flusso_cliente');
const format = require('../../comune/format');
const notifiche = require('../../logica/notifiche/notifiche');
const { e2, importiJson, ordineDelCliente, richiedeCliente, statoPagamentoJson } = require('./ausiliari');

const router = creaRouter();

// Un istante letto da una colonna TIMESTAMP senza fuso (ora UTC che pg legge come ora locale) come stringa ISO vera, o null se manca.
const isoFase = (naive) => {
  const d = format.istanteUtc(naive);
  return d ? d.toISOString() : null;
};

// Stessi due stati dello Storico del sito: finché l'installatore non conferma di aver ricevuto il materiale l'ordine è "In preparazione".
function statoOrdineTesto(ordine) {
  return ordine.consegnato_il ? 'Consegnato' : 'In preparazione';
}

// Quando arriva la merce: l'orario del corriere, e senza quello la stima del banco dalla nascita dell'ordine (la stessa regola della pagina
// dell'ordine e dell'icona del sito). etaSec = secondi all'arrivo (negativi se l'orario è passato), durataSec = dalla nascita all'arrivo.
function arrivoOrdine(ordine) {
  const creato = format.istanteUtc(ordine.creato_il);
  const ore = Number(ordine.consegna_ore);
  const arrivo = ordine.corriere_arrivo_il
    ? format.toDate(ordine.corriere_arrivo_il)
    : creato && ore > 0
      ? new Date(creato.getTime() + ore * 3600 * 1000)
      : null;
  if (!arrivo) return null;
  const etaSec = Math.round((arrivo.getTime() - Date.now()) / 1000);
  return {
    etaSec,
    durataSec: creato ? Math.max(1, Math.round((arrivo.getTime() - creato.getTime()) / 1000)) : null,
    inArrivo: format.inArrivo(etaSec),
    ora: format.oraRoma(arrivo),
    conCorriere: !!ordine.corriere_arrivo_il,
  };
}

// La scheda "Il tuo ultimo ordine" del carrello vuoto (la stessa del sito): l'ordine consegnato più recente, con data e le prime righe (`altri` = quante in più).
// `ordine` è null se non ce n'è nessuno.
router.get('/ultimo-ordine', richiedeCliente, async (req, res) => {
  res.json({ ordine: await flusso.ultimoOrdineConsegnato(req.utente.id) });
});

// Il dettaglio di un ordine per l'app: stato, tempi di arrivo, righe a prezzo del banco, importi e pagamento. Segna come lette le sue notifiche.
router.get('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  // Il cliente sta guardando proprio questo ordine: niente pallino per i suoi cambi di stato.
  await Promise.all([notifiche.segnaLetteCategoria(req.utente.id, 'ordini'), notifiche.segnaLetteCategoria(req.utente.id, 'richieste')]);
  const d = await flusso.dettaglioOrdine(ordine);
  const arrivo = ordine.consegnato_il ? null : arrivoOrdine(ordine);
  const ditta = d.distributore ? format.nomeCommerciale(d.distributore.nome) : '';
  const importi = importiJson(d.importi);
  res.json({
    id: ordine.id,
    stato: ordine.stato,
    stato_testo: statoOrdineTesto(ordine),
    consegnato: !!ordine.consegnato_il,
    // "Arriva entro 6 ore" / "Arriva entro le 18:30" / "In arrivo" (a 3 minuti o meno): lo stesso testo del titolo della pagina dell'ordine.
    tempo_testo: ordine.consegnato_il
      ? 'Consegnato il ' + format.dataOraRoma(ordine.consegnato_il, ', ')
      : !arrivo
        ? 'Tempi di consegna da confermare'
        : arrivo.inArrivo
          ? 'In arrivo'
          : arrivo.conCorriere
            ? 'Arriva entro le ' + arrivo.ora
            : 'Arriva entro ' + format.tempoConsegna(ordine.consegna_ore),
    // Per il conto alla rovescia dell'app: secondi all'arrivo al momento della risposta e durata totale (null senza orario).
    eta_sec: arrivo ? arrivo.etaSec : null,
    durata_sec: arrivo ? arrivo.durataSec : null,
    in_arrivo: arrivo ? arrivo.inArrivo : false,
    corriere: String(ordine.corriere_nome || '').trim() || null,
    creato_il: format.dataOraRoma(ordine.creato_il, ', '),
    consegnato_il: ordine.consegnato_il ? format.dataOraRoma(ordine.consegnato_il, ', ') : null,
    // "Martedì 14 ottobre alle 20:10": la data sotto "Consegnato", come sulla pagina dell'ordine del sito.
    consegnato_il_esteso: ordine.consegnato_il ? format.dataEstesaRoma(ordine.consegnato_il) : null,
    // Le tre fasi (Inviata · Confermata · Consegnata) come istanti ISO (null se non si sa), e quanto ci ha messo dall'invio alla consegna (minuti, null senza invio).
    // `fasi_testo` sono gli stessi orari già scritti in ora italiana per il passo ("19:23", o "14 ott · 19:23" se è in un altro giorno rispetto alla consegna):
    // l'app li mostra così com'è, senza fare conti coi fusi orari; `durata_testo` è il testo della pillola.
    fasi: {
      inviata: isoFase(d.fasi.inviata),
      confermata: isoFase(d.fasi.confermata),
      consegnata: isoFase(d.fasi.consegnata),
    },
    fasi_testo: {
      inviata: format.oraFaseRoma(d.fasi.inviata, ordine.consegnato_il) || null,
      confermata: format.oraFaseRoma(d.fasi.confermata, ordine.consegnato_il) || null,
      consegnata: format.oraFaseRoma(d.fasi.consegnata, ordine.consegnato_il) || null,
    },
    durataMin: d.fasi.durataMin,
    durata_testo: d.fasi.durataMin === null ? null : `Arrivato in ${format.durataArrivo(d.fasi.durataMin)} dall'invio`,
    // Solo la ditta: la filiale da cui parte l'ordine non si mostra all'installatore.
    distributore: d.distributore ? { nome: d.distributore.nome, filiale: '' } : null,
    ditta,
    modalita: ordine.modalita,
    destinazione: ordine.destinazione || null,
    note: ordine.note || null,
    // Le righe a PREZZO DEL BANCO (mai quello col 10% di servizio, che si paga in app e sta solo nella voce Servizio).
    righe: d.righe.map((r) => ({
      quantita: r.quantita,
      nome: r.nome_snapshot,
      codice: r.codice_snapshot,
      cad: e2(Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)),
      subtotale: e2(Number(r.subtotale) + Number(r.raee_riga || 0)),
    })),
    importi,
    // Forma storica dei totali, ora coerente con gli importi divisi: merce a prezzo del banco, consegna, IVA delle due parti, spesa complessiva.
    totali: {
      merce: importi.materiale.merce,
      raee: importi.materiale.raee,
      consegna: importi.consegna.corriere,
      iva: e2(pricing.round2(d.importi.app.iva + d.importi.banco.iva)),
      totale: importi.spesa,
    },
    iva_pct: d.ivaPct,
    pagamento: d.pagamento
      ? {
          stato: d.pagamento.stato,
          stato_testo: d.pagamento.stato === 'rimborsato' ? 'Rimborsato' : 'Pagato',
          importo: pricing.euro(d.pagamento.importo),
          simulato: d.pagamento.metodo === 'simulato',
          pagato_il: d.pagamento.pagato_il ? format.dataOra(d.pagamento.pagato_il) : null,
        }
      : null,
    stato_pagamento: statoPagamentoJson(d.statoPag),
    // Sempre false: il cliente non annulla un ordine (il banco ha già confermato). Non c'è più il pulsante.
    annullabile: d.annullabile,
  });
});

// "Riordina gli stessi pezzi" (sugli ordini consegnati, come sul sito): gli articoli di un ordine che si possono rimettere nel carrello, nella forma delle
// righe del carrello dell'app, e quanti non sono più disponibili (tolti dal catalogo). Il carrello sta sul telefono: aggiunge lui.
router.get('/ordini/:id/riordina', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  const r = await flusso.articoliDaRiordinare(req.utente.id, ordine.id);
  if (!r || r === 'altrui') return res.status(404).json({ errore: 'Ordine non trovato.' });
  const ids = r.articoli.map((a) => a.id);
  const prodotti = ids.length ? await catalogo.prodottiAttivi(ids) : [];
  const perId = new Map(prodotti.map((p) => [Number(p.id), p]));
  const articoli = [];
  let saltati = r.saltati;
  for (const a of r.articoli) {
    const p = perId.get(a.id);
    if (!p) {
      saltati++;
      continue;
    }
    articoli.push({
      id: p.id,
      nome: p.nome,
      etichetta: null,
      codice: p.codice,
      prezzo: pricing.euro(pricing.prezzoNetto(p)),
      prezzo_valore: pricing.prezzoNetto(p),
      foto_url: p.foto_url || null,
      quantita: a.quantita,
    });
  }
  res.json({ articoli, saltati });
});

// Prova ad annullare un ordine: oggi il cliente non può più farlo, quindi risponde con il motivo.
router.delete('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  try {
    await flusso.eliminaOrdine(ordine.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: e.messaggioCliente,
    });
  }
  res.json({ ok: true });
});

module.exports = router;
