// Stato ordini, storico e materiale ordinato dell'app.
const { creaRouter } = require('../base');
const flusso = require('../../logica/ordini/flusso_cliente');
const format = require('../../comune/format');
const materialeModulo = require('../../logica/ordini/materiale');
const pricing = require('../../logica/pagamenti/pricing');
const { e2, richiedeCliente } = require('./ausiliari');

const router = creaRouter();

// Una voce di "Stato ordini" per l'app (flusso.vociStriscia, le stesse dell'icona e della striscia del sito): richiesta in attesa col suo conto alla
// rovescia, ordine in consegna con l'arrivo previsto, o richiesta scaduta da poco da rinviare.
function voceJson(v) {
  return {
    tipo: v.tipo,
    id: v.id,
    fase: v.fase,
    richiesta_id: v.richiestaId,
    breve: v.breve || '',
    secondi: v.secondi === undefined ? null : v.secondi,
    durata: v.durata === undefined ? null : v.durata,
    eta_sec: v.etaSec === undefined ? null : v.etaSec,
    durata_sec: v.durataSec === undefined ? null : v.durataSec,
    in_arrivo: !!v.inArrivo,
    minuti: v.minuti === undefined ? null : v.minuti,
    // Il numero da SCRIVERE nei testi della richiesta in attesa ("se nessuno accetta entro 10 min"): non la durata dell'anello, che col timer accorciato delle prove sarebbe 1.
    minuti_testo: v.minutiTesto === undefined ? null : v.minutiTesto,
    corriere: v.corriere || '',
  };
}

// Tutte le attività in corso (`voci`, nell'ordine del sito) e, per comodità, `attivo`: la prima inviata (la richiesta con l'id più basso), o la
// scaduta da poco se non c'è altro. Apre "Stato ordini": segna lette le notifiche di richieste e ordini.
router.get('/stato-ordini', richiedeCliente, async (req, res) => {
  // `?lette=0`: lettura "silenziosa" (le schede in cima alla home e l'etichetta della scheda "Stato ordini"), che NON segna lette le notifiche: lo fa solo l'apertura della pagina.
  const voci = await flusso.vociStriscia(req.utente.id, { segnaLette: req.query.lette !== '0', breve: true });
  const inCorso = voci.filter((v) => v.fase !== 'scaduta');
  const prima = inCorso.length ? inCorso.reduce((a, b) => (b.richiestaId < a.richiestaId ? b : a)) : voci.find((v) => v.fase === 'scaduta');
  // `minuti_testo`: i minuti che hanno i banchi per rispondere, da scrivere nella pagina vuota ("Entro 10 minuti, o ti rimborsiamo"): non il timer, che nelle prove può essere più corto.
  res.json({
    attivo: prima ? { tipo: prima.tipo, id: prima.id } : null,
    voci: voci.map(voceJson),
    minuti_testo: Math.round(await pricing.getFinestraMinutiTesto()),
  });
});

// Lo storico dell'app: tutte le richieste e gli ordini del cliente, dal più recente, con il loro stato.
router.get('/storico', richiedeCliente, async (req, res) => {
  const cards = await flusso.richiesteClienteConStato(req.utente.id);
  res.json({
    voci: cards.map((c) => {
      const r = c.richiesta;
      const consegnato = !!(c.ordine && c.ordine.consegnato_il);
      const etichetta = consegnato
        ? 'Consegnato'
        : r.stato === 'in_attesa'
          ? 'In attesa'
          : r.stato === 'ordinata'
            ? 'In preparazione'
            : r.stato === 'nessuna_offerta'
              ? 'Nessuna risposta'
              : r.stato === 'annullata'
                ? 'Annullata'
                : r.stato;
      return {
        richiesta_id: r.id,
        order_id: c.step === 3 && c.ordine ? c.ordine.id : null,
        data: format.dataOraRoma(r.creato_il, ', '),
        materiale: c.righe.map((x) => x.quantita + '× ' + x.nome).join(', '),
        etichetta,
        // Colore del badge: verde a buon fine, arancio da fare, rosso chiusa senza ordine.
        tono: consegnato || r.stato === 'ordinata' ? 'ok' : r.stato === 'in_attesa' ? 'attesa' : 'ko',
      };
    }),
  });
});

// Lo Storico come sul sito (src/logica/ordini/materiale.js, lo stesso calcolo): il materiale ordinato mese per mese, con i prezzi IVA inclusa e quanto si deve
// al banco, più la consegna pagata in app. ?mese=AAAA-MM|tutto  ?vista=ordine|articolo.
router.get('/materiale', richiedeCliente, async (req, res) => {
  const m = await materialeModulo.materialeOrdini({ clienteId: req.utente.id, mese: req.query.mese, vista: req.query.vista });
  const righeJsonOrdine = (o) => o.righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice, cad: e2(r.cad), totale: e2(r.totale) }));
  res.json({
    mese: m.mese,
    vista: m.vista,
    mesi: m.mesi,
    ditte: m.ditte,
    riepilogo: { totale: e2(m.riepilogo.totale), servizio: e2(m.riepilogo.servizio), n_ordini: m.riepilogo.nOrdini },
    elenco: m.elenco.map((x) =>
      x.tipo === 'ordine'
        ? {
            tipo: 'ordine',
            id: x.ordine.id,
            data: x.ordine.data,
            stato: x.ordine.stato.etichetta,
            consegnato: x.ordine.consegnato,
            totale: e2(x.ordine.totale),
            servizio: e2(x.ordine.servizio),
            // La percentuale del servizio, per la riga "Consegna pagata in app · corriere + 10% + IVA" (come nella scheda del sito).
            servizio_pct: x.ordine.importi.servizioPct,
            primo: x.ordine.primo,
            altri: x.ordine.altri,
            ditta: x.ordine.ditta,
            ricevuta: !!x.ordine.ricevuta,
            righe: righeJsonOrdine(x.ordine),
          }
        : {
            tipo: 'richiesta',
            id: x.richiesta.id,
            data: x.richiesta.data,
            etichetta: x.richiesta.etichetta,
            tono: x.richiesta.tono,
            primo: x.richiesta.primo,
            altri: x.richiesta.altri,
            apribile: !!x.richiesta.href,
            righe: x.richiesta.righe.map((r) => ({ quantita: r.quantita, nome: r.nome })),
          }
    ),
    articoli: m.gruppi
      .flatMap((g) => g.articoli)
      // `ordini`: i numeri degli ordini in cui compare l'articolo ("ordini #12, #14" sotto il nome, come sul sito).
      .map((a) => ({ codice: a.codice, nome: a.nome, cad: a.cad === null ? null : e2(a.cad), quantita: a.quantita, totale: e2(a.totale), n_ordini: a.ordini.length, ordini: a.ordini })),
    vuoto: m.vuoto,
  });
});

module.exports = router;
