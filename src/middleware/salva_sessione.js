// Salvataggio della sessione prima di un redirect. Sta in un file a sé, senza dipendenze, per provarlo con un'app Express vuota (nessun .env, nessun DB).

// express-session scrive la sessione nel DB DOPO aver mandato la risposta: le intestazioni e quasi tutto il corpo
// partono subito, solo l'ultimo byte aspetta il salvataggio. Una risposta JSON la legge intera chi la chiede, quindi
// va bene; un redirect invece il browser lo segue appena riceve le intestazioni, e la pagina di arrivo chiede la
// sessione prima che la scrittura sia finita: "Svuota carrello" e poi la home con il carrello ancora pieno (6 volte
// su 12 in prova sul DB vero, ~50 ms di rete per ogni scrittura).
// Questo middleware fa salvare la sessione PRIMA del redirect, ma solo se la route l'ha cambiata (confronto con com'era
// a inizio richiesta, cookie escluso: lo rinnova express-session da sé). Va montato subito dopo il middleware di sessione.
function salvaSessionePrimaDelRedirect(req, res, next) {
  const istantanea = () => {
    if (!req.session) return '';
    const { cookie, ...dati } = req.session;
    return JSON.stringify(dati);
  };
  const prima = istantanea();
  const redirect = res.redirect;
  res.redirect = function (...args) {
    if (!req.session || istantanea() === prima) return redirect.apply(res, args);
    req.session.save((err) => {
      if (err) console.error('Sessione non salvata prima del redirect:', err.message);
      redirect.apply(res, args);
    });
  };
  next();
}

module.exports = { salvaSessionePrimaDelRedirect };
