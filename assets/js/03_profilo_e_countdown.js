/* Nome utente: si scrive tutto attaccato, quindi spazi e maiuscole spariscono da soli. */
(function () {
  'use strict';
  const campo = document.querySelector('[data-utente]');
  if (!campo) return;

  campo.addEventListener('input', function () {
    const posizione = campo.selectionStart;
    const prima = campo.value;
    const dopo = prima
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9._-]/g, '');
    if (dopo !== prima) {
      campo.value = dopo;
      const scarto = prima.length - dopo.length;
      campo.setSelectionRange(Math.max(0, posizione - scarto), Math.max(0, posizione - scarto));
    }
  });
})();

/* Menu del profilo in alto a destra: dentro ci sta anche l'uscita. Il cliente ha un pannello con un velo scuro
   dietro (partials/comune/appbar.ejs), banco e agente una tendina. Il pannello del cliente sta fuori dall'appbar, quindi
   pulsante, pannello e velo si cercano nella pagina e non dentro un contenitore comune. */
(function () {
  'use strict';

  const bottone = document.querySelector('[data-menu-apri]');
  const tendina = document.querySelector('[data-menu-tendina]');
  if (!bottone || !tendina) return;
  const velo = document.querySelector('[data-menu-velo]'); // solo nel menu del cliente

  function aperto() {
    return !tendina.hasAttribute('hidden');
  }

  function voci() {
    return Array.prototype.slice.call(tendina.querySelectorAll('[role="menuitem"]'));
  }

  function apri(si) {
    if (si) tendina.removeAttribute('hidden');
    else tendina.setAttribute('hidden', '');
    if (velo) {
      if (si) velo.removeAttribute('hidden');
      else velo.setAttribute('hidden', '');
    }
    bottone.setAttribute('aria-expanded', si ? 'true' : 'false');
  }

  // Esc e tocco sul velo: il focus torna sul pulsante, da cui si era aperto il menu.
  function chiudiERiportaIlFocus() {
    apri(false);
    bottone.focus();
  }

  bottone.addEventListener('click', function (e) {
    e.stopPropagation();
    const siApre = !aperto();
    apri(siApre);
    // Aperto da tastiera (un click senza puntatore ha detail 0): il focus entra nel menu, sulla prima voce.
    if (siApre && e.detail === 0 && voci().length) voci()[0].focus();
  });

  if (velo) velo.addEventListener('click', chiudiERiportaIlFocus);

  document.addEventListener('click', function (e) {
    if (aperto() && !tendina.contains(e.target) && !bottone.contains(e.target)) apri(false);
  });

  document.addEventListener('keydown', function (e) {
    if (!aperto()) return;
    if (e.key === 'Escape') {
      chiudiERiportaIlFocus();
      return;
    }
    const lista = voci();
    const attivo = document.activeElement;
    if (!lista.length || !(tendina.contains(attivo) || attivo === bottone)) return;
    const i = lista.indexOf(attivo);
    let prossima = null;
    if (e.key === 'ArrowDown') prossima = lista[(i + 1) % lista.length];
    else if (e.key === 'ArrowUp') prossima = lista[i <= 0 ? lista.length - 1 : i - 1];
    else if (e.key === 'Home') prossima = lista[0];
    else if (e.key === 'End') prossima = lista[lista.length - 1];
    if (prossima) {
      e.preventDefault();
      prossima.focus();
    }
  });

  // Con Tab fuori dal pannello il menu si chiude, invece di restare aperto sotto il velo.
  tendina.addEventListener('focusout', function (e) {
    if (aperto() && e.relatedTarget && !tendina.contains(e.relatedTarget) && e.relatedTarget !== bottone) apri(false);
  });

  // Tornando indietro da una voce del menu la pagina può riapparire dalla cache col menu ancora aperto.
  window.addEventListener('pageshow', function () {
    apri(false);
  });
})();

/* Countdown generico: qualsiasi elemento con data-countdown-live si aggiorna da solo
   ogni secondo (finestra di risposta del banco, elenco richieste, ecc.), invece di
   restare fermo al valore calcolato dal server al momento del caricamento pagina.
   Con data-ricarica-a-zero, allo scadere ricarica la pagina per mostrare il nuovo stato. */
(function () {
  'use strict';
  document.querySelectorAll('[data-countdown-live]').forEach(function (el) {
    let sec = parseInt(el.getAttribute('data-secondi'), 10) || 0;
    if (sec <= 0) return;
    const ricarica = el.hasAttribute('data-ricarica-a-zero');
    setInterval(function () {
      sec = Math.max(0, sec - 1);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      if (sec === 0 && ricarica) setTimeout(function () { window.location.reload(); }, 2500);
    }, 1000);
  });
})();

