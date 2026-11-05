/* Clienti del banco (/distributore/clienti): il campo "Cerca" filtra subito, nel browser, i clienti da approvare, gli
   approvati e i non riconosciuti. Ogni cliente ([data-cliente]) porta in data-cerca ragione sociale, partita IVA e
   codice cliente; senza badare alle maiuscole, ogni parola scritta deve comparire in uno dei tre. Una sezione senza
   corrispondenze sparisce, il numero accanto al titolo conta quelle rimaste e, se non resta niente, compare "Nessun
   cliente trovato.". Il campo non è dentro un form e non naviga: l'aggiornamento automatico del banco aspetta che
   si smetta di scrivere (vedi sopra). */
(function () {
  'use strict';
  const campo = document.querySelector('[data-cerca-clienti]');
  if (!campo) return;
  const sezioni = Array.prototype.slice.call(document.querySelectorAll('[data-sezione-clienti]'));
  const nessuno = document.querySelector('[data-cerca-nessuno]');

  function applica() {
    const parole = campo.value.toLowerCase().split(/\s+/).filter(Boolean);
    let visibili = 0;
    sezioni.forEach(function (sezione) {
      let nella = 0;
      sezione.querySelectorAll('[data-cliente]').forEach(function (voce) {
        const testo = (voce.getAttribute('data-cerca') || '').toLowerCase();
        const trovato = parole.every(function (p) { return testo.indexOf(p) !== -1; });
        voce.hidden = !trovato;
        if (trovato) nella += 1;
      });
      visibili += nella;
      sezione.hidden = parole.length > 0 && nella === 0;
      sezione.querySelectorAll('[data-conta-sezione]').forEach(function (conta) {
        conta.textContent = parole.length ? String(nella) : conta.getAttribute('data-totale');
      });
    });
    if (nessuno) nessuno.hidden = !(parole.length > 0 && visibili === 0);
  }

  campo.addEventListener('input', applica);
  // Tornando con "indietro" il browser può rimettere il testo nel campo: l'elenco va riallineato.
  window.addEventListener('pageshow', applica);
  applica();
})();

/* Pagina di un cliente approvato (partials/banco/materiale_cliente.ejs): da 900px la testata del materiale (filtri e totale, `[data-mc-fisso]`) resta in cima mentre si
   scorrono gli ordini: lo fa il CSS (position: sticky). Quando è staccata dalla scheda, cioè sta davvero scorrendo sopra gli ordini, prende un'ombra leggera
   (`.staccato`): il CSS da solo non sa dire se lo sticky è "attivo", quindi si confronta la sua posizione con quella della scheda a ogni scorrimento
   (una misura per fotogramma). Sotto i 900px non è sticky e non resta mai staccata. */
(function () {
  'use strict';
  const fisso = document.querySelector('[data-mc-fisso]');
  const scheda = fisso && fisso.closest('.mc-card');
  if (!scheda) return;
  let inAttesa = false;

  function misura() {
    inAttesa = false;
    const sticky = window.getComputedStyle(fisso).position === 'sticky';
    // a riposo la testata è nell'angolo della scheda (sotto il suo bordo); se è più in basso, lo sticky la sta trattenendo
    const spostamento = fisso.getBoundingClientRect().top - (scheda.getBoundingClientRect().top + scheda.clientTop);
    fisso.classList.toggle('staccato', sticky && spostamento > 0.5);
  }
  function programma() {
    if (inAttesa) return;
    inAttesa = true;
    window.requestAnimationFrame(misura);
  }

  window.addEventListener('scroll', programma, { passive: true });
  window.addEventListener('resize', programma);
  window.addEventListener('pageshow', programma);
  misura();
})();

