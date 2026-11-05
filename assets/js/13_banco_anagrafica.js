/* Anagrafica del banco (views/banco/anagrafica.ejs, richiesta esplicita del 20/10/2026). Ogni scheda ([data-scheda]) ha la sua lettura
   ([data-lettura]) e il suo modulo ([data-modulo], nascosto): "Modifica" li scambia, "Annulla" torna alla lettura. Se la pagina è arrivata con una scheda già
   aperta (errori di un salvataggio, o ?modifica=...: [data-aperta]) "Annulla" è il link vero che ricarica la pagina, così spariscono anche errori e valori
   scritti. Senza JavaScript "Modifica" e "Annulla" restano collegamenti normali. Orari: l'interruttore aperto/chiuso di ogni giorno accende o spegne i suoi
   campi. */
(function () {
  'use strict';
  const pagina = document.querySelector('.pagina-anagrafica-banco');
  if (!pagina) return;

  pagina.querySelectorAll('[data-scheda]').forEach(function (scheda) {
    const lettura = scheda.querySelector('[data-lettura]');
    const modulo = scheda.querySelector('[data-modulo]');
    const modifica = scheda.querySelector('[data-modifica]');
    const annulla = scheda.querySelector('[data-annulla]');
    if (!modulo) return;

    function apri(e) {
      if (e) e.preventDefault();
      if (lettura) lettura.hidden = true;
      if (modifica) modifica.hidden = true;
      modulo.hidden = false;
      const primo = modulo.querySelector('input:not([type="checkbox"]):not([disabled])');
      if (primo) primo.focus();
    }
    function chiudi(e) {
      // Scheda arrivata già aperta (errori, ?modifica=): il link ricarica la pagina com'è salvata.
      if (scheda.hasAttribute('data-aperta')) return;
      if (e) e.preventDefault();
      modulo.reset();
      if (typeof modulo.aggiornaOrari === 'function') modulo.aggiornaOrari();
      modulo.hidden = true;
      if (lettura) lettura.hidden = false;
      if (modifica) { modifica.hidden = false; modifica.focus(); }
    }
    if (modifica) modifica.addEventListener('click', apri);
    if (annulla) annulla.addEventListener('click', chiudi);
    modulo.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && annulla) { e.preventDefault(); if (scheda.hasAttribute('data-aperta')) window.location.href = annulla.href; else chiudi(); }
    });
  });

  // ---------- Orari ----------
  const moduloOrari = pagina.querySelector('[data-modulo-orari]');
  if (moduloOrari) {
    const giorni = Array.prototype.slice.call(moduloOrari.querySelectorAll('[data-giorno]'));

    function campiDelGiorno(giorno) { return Array.prototype.slice.call(giorno.querySelectorAll('[data-fasce] input')); }
    function aggiornaGiorno(giorno) {
      const aperto = giorno.querySelector('[data-aperto]');
      const testo = giorno.querySelector('[data-aperto-testo]');
      if (testo) testo.textContent = aperto && aperto.checked ? 'Aperto' : 'Chiuso';
      const apertoOra = !!(aperto && aperto.checked);
      campiDelGiorno(giorno).forEach(function (c) { c.disabled = !apertoOra; });
      giorno.classList.toggle('ab-giorno-chiuso', !apertoOra);
    }
    function aggiornaOrari() { giorni.forEach(aggiornaGiorno); }
    moduloOrari.aggiornaOrari = aggiornaOrari; // lo richiama "Annulla" dopo il reset del modulo
    giorni.forEach(function (giorno) {
      const aperto = giorno.querySelector('[data-aperto]');
      if (aperto) aperto.addEventListener('change', function () { aggiornaGiorno(giorno); });
    });
    aggiornaOrari();
  }
})();

