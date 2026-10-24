// Apertura della sessione di un utente appena riconosciuto.

// Apre la sessione di un utente appena riconosciuto (login o registrazione). Prima si cambia l'id di sessione (regenerate): un cookie di sessione
// preesistente non diventa mai quello di un utente collegato (session fixation). Poi si salva PRIMA di rispondere: express-session manda la risposta e
// salva dopo, e se il browser rilegge subito la pagina (succede) la sessione non c'è ancora e si torna al login.
function avviaSessione(req, utente) {
  return new Promise((risolvi, rifiuta) => {
    req.session.regenerate((err) => {
      if (err) return rifiuta(err);
      req.session.user = utente;
      req.session.save((errSalvataggio) => (errSalvataggio ? rifiuta(errSalvataggio) : risolvi()));
    });
  });
}

module.exports = { avviaSessione };
