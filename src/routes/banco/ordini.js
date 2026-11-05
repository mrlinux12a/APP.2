// La pagina dell'ordine del banco (`GET /distributore/ordini/:id`), "Preparato" e "Elimina dal banco"; i vecchi link alla lista degli ordini rimandano allo Storico.
const { creaRouter } = require('../base');
const { requireRole } = require('../../middleware/auth');
const { ritornoBanco, conRitorno } = require('../../comune/http');
const pricing = require('../../logica/pagamenti/pricing');
const format = require('../../comune/format');
const orariCorriere = require('../../logica/ordini/corriere');
const richieste = require('../../logica/ordini/richieste');
const datiOrdini = require('../../logica/ordini/ordini');
const utenti = require('../../logica/account/utenti');
const anagrafiche = require('../../logica/account/anagrafiche');
const notifiche = require('../../logica/notifiche/notifiche');
const storicoBanco = require('../../logica/banco/storico');
const storicoDettaglio = require('../../logica/banco/storico_dettaglio');
const richiestaBanco = require('../../logica/banco/richiesta');
const ordineBanco = require('../../logica/banco/ordine');
const { BACHECA } = require('../../config/bacheca');
const { distanzaClienteBanco, ordineDelBanco, prendiInCarico, eliminaOrdineDalBanco } = require('../../logica/banco/banco');

const router = creaRouter();

// I vecchi link (e i segnalibri) alla lista degli ordini arrivano allo Storico, con la loro query string (301). La lista degli ordini è lo Storico ordini:
// il dettaglio /distributore/ordini/:id resta com'è.
router.get('/distributore/ordini', requireRole('distributore'), (req, res) => {
  const i = req.originalUrl.indexOf('?');
  res.redirect(301, '/distributore/storico' + (i === -1 ? '' : req.originalUrl.slice(i)));
});

// Mostra la pagina dell'ordine vista dal banco (views/banco/ordine.ejs, src/logica/banco/ordine.js): materiale, consegna, cliente, avanzamento e, a
// destra, quello che serve in quello stato. Si adatta allo stato (storicoBanco.statoStorico, lo stesso della lista dello Storico), e "Apri ordine
// completo" dello Storico funziona per tutti:
//  · Da preparare: il ritiro del corriere con il conto alla rovescia (il tempo scritto dal corriere su WhatsApp) e il pulsante "Preparato", "Elimina ordine";
//  · In consegna (dopo "Preparato"): la scheda "In consegna" (partito, ritiro del corriere, corriere);
//  · Consegnato: la scheda "Consegnato" (quando, tempo di consegna).
// SOLA LETTURA in ogni stato: aprirla non cambia l'ordine. In particolare un ordine già partito o consegnato non si tocca: prendiInCarico (che lo
// porterebbe a 'in_evasione') non si chiama da qui, e comunque agisce solo su 'inviato'. Prova: test "banco: pagina dell'ordine in consegna e consegnato...".
router.get('/distributore/ordini/:id', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) {
    return res.status(404).render('comune/errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const stato = storicoBanco.statoStorico(ordine);
  const daPreparare = stato.chiave === 'da_preparare';

  const distributorId = req.session.user.distributor_id;
  // Quando il corriere arriva dal banco: il tempo che ha scritto su WhatsApp (src/logica/ordini/corriere.js). È l'unico orario del corriere che il banco vede.
  const ritiroCorriere = orariCorriere.ritiro(ordine);
  // Letture indipendenti: partono insieme (ogni query in sequenza costa un giro di rete). `secondi`: quanti ne mancano al corriere, calcolati dal DB.
  const [cliente, distributore, righe, risposta, ivaConfig, arrivo, legameCliente] = await Promise.all([
    utenti.utentePerId(ordine.cliente_id),
    anagrafiche.distributorePerId(ordine.distributor_id),
    datiOrdini.righeOrdine(ordine.id),
    ordine.request_id ? richieste.getRisposta(ordine.request_id, ordine.distributor_id) : null,
    pricing.getIvaPct(),
    // Il conto alla rovescia del ritiro c'è solo finché l'ordine è da preparare.
    daPreparare && ritiroCorriere ? datiOrdini.secondiAlRitiro(ordine.id) : null,
    // "Apri scheda cliente" solo se il cliente ha indicato questo banco (altrimenti la pagina risponde 404).
    anagrafiche.legame(distributorId, ordine.cliente_id),
  ]);
  // Le righe confermate a metà si leggono solo se il banco ha risposto con una copertura parziale (la UI di oggi non la produce più).
  const mancanti = risposta && risposta.copertura === 'parziale'
    ? (await richieste.calcolaOfferta(ordine.request_id, ordine.distributor_id)).mancanti
    : [];

  // Gli importi del banco, gli stessi del Materiale ordinato del cliente e dello Storico: merce, IVA (quella salvata nell'ordine) e totale.
  const importi = pricing.importi({ ordine, pagamento: null, ivaPct: pricing.ivaPctOrdine(ordine, ivaConfig) });
  const materiale = ordineBanco.righeMateriale(righe, mancanti);
  const conCorriere = !!(ordine.corriere_risposto_il || ordine.corriere_nome);
  const destinazione = ordine.destinazione || cliente.indirizzo_consegna || format.indirizzoCompleto(cliente) || '';
  const corriereNome = ordine.corriere_nome || (risposta && risposta.corriere_nome) || '';
  const oraRitiro = ritiroCorriere ? format.oraRoma(ritiroCorriere) : '';
  // Quando è partita la merce (il "Preparato"): lo vedono "In consegna" e "Consegnato".
  const partenza = ordineBanco.partenza(ordine);
  const consegnato = stato.chiave === 'consegnato';

  res.render('banco/ordine', {
    titolo: 'Ordine #' + ordine.id,
    // La freccia riporta alla pagina da cui si è arrivati (`torna`: Storico, scheda cliente, richiesta), altrimenti alla home.
    paginaPrecedente: ritornoBanco(req.query.torna),
    ordine,
    cliente,
    stato,
    // Un ordine consegnato non è più "di oggi": la testata dice il giorno ("il 19/10 alle 09:28").
    ricevuto: consegnato
      ? ordineBanco.ricevutoIl(ordine)
      : richiestaBanco.quandoRicevuta(format.giornoRoma(ordine.creato_il), format.oraSolaRoma(ordine.creato_il)),
    materiale,
    conta: storicoDettaglio.contaMateriale(materiale.righe),
    banco: importi.banco,
    ivaPct: importi.ivaPct,
    conCorriere,
    corriereNome,
    // La scheda "In consegna": quando è partito e quando è previsto l'arrivo. La scheda "Consegnato": quando, da quando è partito e in quanto tempo.
    inConsegna: stato.chiave === 'in_consegna' ? { testo: ordineBanco.testoInConsegna(ordine) } : null,
    consegnato: consegnato
      ? {
          testo: ordineBanco.consegnatoTesto(ordine),
          partito: partenza ? `${format.giornoMeseRoma(partenza)} · ${format.oraSolaRoma(partenza)}` : '',
          durata: ordineBanco.tempoDiConsegna(ordine) || '',
        }
      : null,
    // Il riquadro "Ritiro": c'è l'orario del corriere, e solo finché l'ordine è da preparare. I secondi si muovono nel browser (app.js, data-ric-arrivo).
    ritiro: daPreparare && oraRitiro
      ? {
          secondi: Number(arrivo && arrivo.secondi) || 0,
          ora: oraRitiro,
          oraAccettato: ordine.corriere_risposto_il ? format.oraRoma(ordine.corriere_risposto_il) : '',
          sogliaMin: BACHECA.arrivoVicinoMin,
        }
      : null,
    passi: ordineBanco.passiOrdine({
      stato: stato.chiave,
      oraConferma: format.oraSolaRoma((risposta && risposta.risposto_il) || ordine.creato_il),
      corriere: conCorriere
        ? { nome: corriereNome, ora: ordine.corriere_risposto_il ? format.oraRoma(ordine.corriere_risposto_il) : '' }
        : null,
      oraRitiro,
      partito: { quando: ordineBanco.momento(partenza, ordine.creato_il) },
      consegnato: { quando: ordineBanco.momento(ordine.consegnato_il, ordine.creato_il) },
    }),
    destinazione,
    indirizzo: ordineBanco.indirizzoDiviso(destinazione),
    distanza: distanzaClienteBanco(cliente, distributore),
    descrizioneConsegna: ordineBanco.descrizioneConsegna({ modalita: ordine.modalita, conCorriere, corriereNome }),
    sottotitoloCliente: ordineBanco.sottotitoloCliente(cliente),
    schedaClienteAperta: !!legameCliente,
    errore: req.query.errore || null,
  });
});

// "Preparato": dalla card "Da preparare" in home (`torna` = 'home': la card sparisce da lì) o dalla pagina dell'ordine (`torna` = la pagina da cui si era
// arrivati: si resta sull'ordine, che ora è "In consegna", e la sua freccia riporta ancora lì). Il materiale parte e il cliente è avvisato.
router.post('/distributore/ordini/:id/preparazione', requireRole('distributore'), async (req, res) => {
  const ordine = await ordineDelBanco(req);
  if (!ordine) return res.redirect('/distributore/storico');
  await prendiInCarico(ordine);
  if (req.body.torna === 'home') return res.redirect('/distributore');
  res.redirect(conRitorno('/distributore/ordini/' + ordine.id, ritornoBanco(req.body.torna, '')));
});

// Elimina un ordine dal banco: l'ordine sparisce, e il pagamento torna all'installatore (che viene avvisato). È l'unico caso in cui un ordine confermato si
// annulla.
router.post('/distributore/ordini/:id/elimina', requireRole('distributore'), async (req, res) => {
  const ordine = await datiOrdini.ordinePerId(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) {
    return res.status(404).render('comune/errore', { titolo: 'Non trovato', messaggio: 'Ordine non trovato.' });
  }
  const rimborsato = await eliminaOrdineDalBanco(ordine);
  // L'installatore deve saperlo: altrimenti l'ordine sparisce dal suo "Stato ordini" senza una parola.
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Ordine annullato dal banco',
    testo: `Ordine #${ordine.id} — Il banco ha annullato l'ordine.` + (rimborsato ? ' Il pagamento è stato rimborsato.' : ''),
    link: '/ordini',
    categoria: 'ordini',
  }).catch((err) => console.error('[ordini] notifica di annullamento non inviata:', err.message));
  res.redirect('/distributore');
});

module.exports = router;
