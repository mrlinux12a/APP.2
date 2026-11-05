/* Password con l'occhio (partials/comune/acc_campo.ejs): il pulsante parte nascosto, perché senza script non farebbe niente.
   Mostra o nasconde il testo del campo accanto e aggiorna etichetta e stato per chi usa uno screen reader. */
(function () {
  'use strict';
  const pulsanti = document.querySelectorAll('[data-mostra-password]');
  if (!pulsanti.length) return;
  pulsanti.forEach(function (pulsante) {
    pulsante.hidden = false;
    pulsante.addEventListener('click', function () {
      const campo = pulsante.parentNode.querySelector('input');
      if (!campo) return;
      const mostra = campo.type === 'password';
      campo.type = mostra ? 'text' : 'password';
      pulsante.setAttribute('aria-pressed', mostra ? 'true' : 'false');
      pulsante.setAttribute('aria-label', mostra ? 'Nascondi password' : 'Mostra password');
    });
  });
})();

/* Registrazione a passi (views/auth/registrati.ejs): un solo modulo diviso in tre fieldset, qui se ne mostra uno alla volta.
   "Avanti" controlla solo i campi del passo corrente (la validazione vera resta sul server); dopo un errore del server
   la pagina arriva già sul primo passo sbagliato (data-passo-iniziale). Senza script i tre blocchi restano tutti
   visibili e il modulo funziona come un modulo qualunque. */
(function () {
  'use strict';
  const radice = document.querySelector('[data-registrazione]');
  if (!radice) return;
  const form = radice.querySelector('[data-reg-form]');
  const passi = Array.prototype.slice.call(radice.querySelectorAll('[data-reg-passo]'));
  const segmenti = radice.querySelectorAll('.reg-avanzamento span');
  const avanti = radice.querySelector('[data-reg-avanti]');
  const indietro = radice.querySelector('[data-reg-indietro]');
  if (!form || passi.length < 2 || !avanti) return;

  const ultimo = passi.length - 1;
  let corrente = Math.min(passi.length, Math.max(1, Number(radice.getAttribute('data-passo-iniziale')) || 1)) - 1;

  // Un fieldset nascosto con un campo non valido farebbe fallire l'invio del browser senza un messaggio ("campo non
  // focalizzabile"): i controlli li facciamo noi, passo per passo, prima dell'invio.
  form.noValidate = true;
  radice.setAttribute('data-passi', 'attivi');

  function campiDel(indice) {
    return Array.prototype.slice.call(passi[indice].querySelectorAll('input, select, textarea'));
  }

  // Primo campo non valido del passo, o null.
  function primoSbagliato(indice) {
    return campiDel(indice).find(function (campo) { return !campo.checkValidity(); }) || null;
  }

  function mostra(indice, conFocus) {
    corrente = indice;
    passi.forEach(function (passo, i) { passo.hidden = i !== indice; });
    segmenti.forEach(function (segmento, i) { segmento.classList.toggle('fatto', i <= indice); });
    avanti.textContent = indice === ultimo ? "Crea l'anagrafica" : 'Avanti';
    if (conFocus) {
      window.scrollTo(0, 0);
      const primo = campiDel(indice).find(function (campo) { return campo.type !== 'radio'; });
      if (primo) primo.focus({ preventScroll: true });
    }
  }

  // Mostra il passo e fa uscire il messaggio del browser sul campo sbagliato.
  function segnala(indice, campo) {
    if (indice !== corrente) mostra(indice, false);
    campo.focus({ preventScroll: true });
    campo.reportValidity();
  }

  avanti.addEventListener('click', function (e) {
    if (corrente < ultimo) {
      e.preventDefault();
      const sbagliato = primoSbagliato(corrente);
      if (sbagliato) return segnala(corrente, sbagliato);
      return mostra(corrente + 1, true);
    }
    // Ultimo passo: prima di inviare si controllano tutti, e si torna sul primo che ha un problema.
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  // Rete di sicurezza (invio con Invio da un campo, o da script): non deve partire un modulo con un passo sbagliato.
  form.addEventListener('submit', function (e) {
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  if (indietro) {
    indietro.addEventListener('click', function (e) {
      if (corrente > 0) {
        e.preventDefault();
        mostra(corrente - 1, false);
        window.scrollTo(0, 0);
      }
    });
  }

  mostra(corrente, false);
})();

