// Risposte pronte che le pagine dell'installatore danno quando qualcosa nel flusso richiesta-pagamento-ordine non va, e invio dei PDF.
// Il testo mostrato al cliente è sempre quello scritto da noi nell'errore del flusso (flusso.ErroreFlusso): mai il messaggio di un guasto tecnico.

// Mostra la pagina d'errore per un errore del flusso (richiesta già aperta, minimo non raggiunto, carrello vuoto, pagamento non disponibile) con il link
// giusto per ripartire. `altroLink` permette di scegliere un altro percorso di ritorno.
function paginaErroreFlusso(res, e, altroLink = null) {
  const link =
    altroLink ||
    (e.codice === 'in_corso' && e.requestId
      ? { link: '/richieste/' + e.requestId, linkTesto: 'Apri la richiesta in corso' }
      : e.codice === 'vuota'
        ? { link: '/home', linkTesto: 'Torna alla home' }
        : { link: '/carrello', linkTesto: 'Torna al riepilogo' });
  return res.status(400).render('errore', { titolo: e.titolo, messaggio: e.message, ...link });
}

// Spiega che l'annullamento non è possibile. `e` è un flusso.OrdineInLavorazione: il cliente non annulla mai un ordine, e nemmeno una richiesta su cui
// un banco ha già confermato (si annulla solo in fase 1). Niente è stato modificato.
function rifiutaEliminazioneOrdine(res, e) {
  const dellOrdine = !!(e.ordine && e.ordine.id);
  return res.status(400).render('errore', {
    titolo: 'Annullamento non possibile',
    messaggio: e.messaggioCliente,
    link: dellOrdine ? '/ordini/' + e.ordine.id : '/richieste/' + e.richiestaId,
    linkTesto: dellOrdine ? "Torna all'ordine" : 'Torna alla richiesta',
  });
}

// Manda un PDF al browser, da aprire nella pagina (non da scaricare), senza lasciarne copie in cache.
function inviaPdf(res, buffer, nomeFile) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + nomeFile + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

module.exports = { paginaErroreFlusso, rifiutaEliminazioneOrdine, inviaPdf };
