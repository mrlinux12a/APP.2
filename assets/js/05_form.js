/* Impedisce il doppio invio dei form che cambiano stato (conferma ordine, risposta del
   banco, elimina...): un doppio tap — frequente su rete lenta da cantiere, quando non si
   vede subito una reazione — poteva mandare due POST identiche in rapida successione.
   Il server si difende comunque (la richiesta passa a 'ordinata' una volta sola, vedi
   creaOrdineDaRisposta in src/logica/ordini/flusso_cliente.js), ma è meglio non generarla nemmeno la seconda richiesta. Generico: si applica a ogni <form> dell'app,
   non solo a quello dell'ordine. */
document.addEventListener('submit', function (e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const bottoni = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  if (!bottoni.length) return;
  // Il ritardo di un tick lascia al browser il tempo di leggere quale bottone è stato
  // premuto (nome/valore) prima di disabilitarlo: alcuni form hanno più bottoni di invio
  // diversi (es. "Conferma" / "Rifiuta") e disabilitarli subito, in modo sincrono, rischia
  // di far perdere quale dei due ha davvero avviato l'invio.
  setTimeout(function () {
    // Un invio fermato da qualcuno (un controllo dei campi, una conferma annullata) non è partito: i pulsanti restano usabili.
    if (e.defaultPrevented) return;
    bottoni.forEach(function (b) {
      // Solo quelli attivi: un pulsante già disabilitato dal server (es. "Paga" sotto il minimo) deve restarlo.
      if (b.disabled) return;
      b.disabled = true;
      b.setAttribute('data-bloccato-da-invio', '');
    });
  }, 0);
}, true);

/* Tornando con "indietro" dopo un invio (anche finito con un errore) il browser può rimostrare la pagina
   com'era, con i pulsanti ancora bloccati: si riattivano. */
window.addEventListener('pageshow', function (e) {
  if (!e.persisted) return;
  document.querySelectorAll('[data-bloccato-da-invio]').forEach(function (b) {
    b.disabled = false;
    b.removeAttribute('data-bloccato-da-invio');
  });
});

