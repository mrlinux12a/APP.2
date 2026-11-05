/* Foto prodotto a schermo intero: un tap sulla miniatura la apre ingrandita. Delegato su
   document (le card della ricerca live/scroll infinito vengono ridisegnate a runtime, un
   listener messo sulla singola <img> al caricamento pagina non le coprirebbe). Il segnaposto
   invisibile (.prodotto-foto-vuota, dove non c'è ancora una foto vera) è escluso. */
(function () {
  'use strict';
  let overlay = null;

  function apri(src) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'foto-overlay';
      overlay.innerHTML =
        '<button type="button" class="foto-overlay-chiudi" aria-label="Chiudi">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
        '</button>' +
        '<img class="foto-overlay-img" alt="">';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('.foto-overlay-chiudi')) chiudi();
      });
    }
    overlay.querySelector('.foto-overlay-img').src = src;
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }

  function chiudi() {
    if (!overlay) return;
    overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    const foto = e.target.closest('.prodotto-foto:not(.prodotto-foto-vuota)');
    if (!foto) return;
    apri(foto.src);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') chiudi();
  });
})();

/* Consegna in arrivo: minuti, "In arrivo", barra e anello di un ordine in consegna scendono (o salgono, per la barra) col tempo,
   in modo lineare, con l'orologio del browser. Prima il testo "Arriva tra N min" lo scriveva solo il server (fermo finché non
   arrivava un aggiornamento: nella striscia con più ordini restava fisso per sempre), l'anello e la barra dell'ordine si muovevano
   a scatti ogni 30 secondi e quella della home era ferma a metà.
   Un contenitore [data-eta-sec] porta i secondi che mancano all'arrivo al momento del disegno (calcolati sul server, quindi l'ora
   del PC non c'entra; possono essere negativi) e, se c'è, [data-eta-durata] = secondi dalla nascita dell'ordine all'arrivo. Dentro:
     [data-eta-testo]  testo con {m} = minuti che mancano (mai meno di 1) o {t} = la stessa durata scritta come sulla home del banco, o {c} = quella stessa in forma breve per il badge ("45′", "5h57")
                       ("8 min", "5 h 57"); a 3 minuti o meno diventa solo "In arrivo", mai prima. Senza segnaposto
                       (il titolo dell'ordine) fuori dai 3 minuti torna lo stesso testo normale. Con anche [data-eta-nascondi]
                       (il badge dei minuti dell'icona, "N′") a 3 minuti o meno non si scrive "In arrivo" ma sparisce, perché
                       accanto a "In arrivo" un numero di minuti direbbe un'altra cosa.
     [data-eta-barra]  larghezza = tempo trascorso sul totale (si riempie); serve la durata. Con valore "da-meta" (la card della home,
                       tappe Accettato · In viaggio · Consegnato) parte dal 50% e a tempo finito si ferma al 94% (un filo prima di Consegnato; stessa soglia di PROGRESSO_ARRIVO sul server).
     [data-eta-arco]   anello che si svuota (stroke-dashoffset su data-circ); serve la durata. Negli ultimi 3 minuti si riempie (cronometro "In arrivo").
   Un colpo al secondo, con le transizioni CSS da 1 s lineari: il movimento è continuo. La fine di ogni contenitore si fissa la
   prima volta che lo si vede, quindi un contenitore rimpiazzato dall'aggiornamento dell'icona riparte dal suo numero nuovo e uno
   che resta non si sposta. IN_ARRIVO_SEC è la stessa soglia di format.SOGLIA_IN_ARRIVO_SEC sul server. Non usare [data-consegna]:
   è già la scheda "Consegna in cantiere" del carrello, e il suo blocco in alto in questo file va in errore (e ferma tutto lo
   script) se non trova i suoi pulsanti. */
(function () {
  'use strict';
  const IN_ARRIVO_SEC = 180;
  const fini = new WeakMap(); // contenitore [data-eta-sec] -> istante (ms) in cui si arriva

  // Secondi che mancano all'arrivo, con i decimali (anche negativi).
  function restano(contenitore) {
    let fine = fini.get(contenitore);
    if (fine === undefined) {
      fine = Date.now() + (Number(contenitore.getAttribute('data-eta-sec')) || 0) * 1000;
      fini.set(contenitore, fine);
    }
    return (fine - Date.now()) / 1000;
  }
  // Quanto resta del viaggio, da 1 (appena nato l'ordine) a 0 (arrivo previsto o dopo); null se non c'è la durata.
  function rimasto(contenitore) {
    const durata = Number(contenitore.getAttribute('data-eta-durata')) || 0;
    return durata ? Math.min(1, Math.max(0, restano(contenitore) / durata)) : null;
  }

  function aggiorna() {
    if (document.hidden) return;
    document.querySelectorAll('[data-eta-testo]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      if (!c) return;
      const s = restano(c);
      const inArrivo = s <= IN_ARRIVO_SEC;
      const minuti = Math.max(1, Math.ceil(s / 60));
      if (el.hasAttribute('data-eta-nascondi')) { // il badge dei minuti: a 3 minuti o meno sparisce, resta solo "In arrivo"; 
        el.style.display = inArrivo ? 'none' : '';
        if (inArrivo) return;
      }
      const testo = inArrivo
        ? 'In arrivo'
        : el.getAttribute('data-eta-testo').replace('{m}', minuti).replace('{t}', Minuteria.durataMinuti(minuti))
          .replace('{c}', minuti < 60 ? minuti + '′' : Math.floor(minuti / 60) + 'h' + String(minuti % 60).padStart(2, '0'));
      if (el.textContent !== testo) el.textContent = testo;
    });
    document.querySelectorAll('[data-eta-barra]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      const r = c ? rimasto(c) : null;
      // data-eta-barra="da-meta": la barra della home parte da "In viaggio" (50%) e a tempo finito si ferma al 94%, mai a "Consegnato".
      if (r !== null) el.style.width = (el.getAttribute('data-eta-barra') === 'da-meta' ? 50 + (1 - r) * 44 : (1 - r) * 100).toFixed(1) + '%';
    });
    document.querySelectorAll('[data-eta-arco]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      const r = c ? rimasto(c) : null;
      if (r === null) return;
      const circ = Number(el.getAttribute('data-circ')) || 402.12;
      const s = restano(c);
      // Negli ultimi 3 minuti ("In arrivo") l'anello è un cronometro: riparte da vuoto e si riempie fino all'arrivo (da vuoto a vuoto
      // non c'è salto: a 180 s dall'arrivo l'anello del viaggio è già quasi vuoto).
      el.style.strokeDashoffset = (s <= IN_ARRIVO_SEC ? circ * Math.max(0, s) / IN_ARRIVO_SEC : circ * (1 - r)).toFixed(2);
    });
  }

  aggiorna();
  setInterval(aggiorna, 1000);
  // Un timer in una scheda nascosta viene rallentato (e qui non si disegna): al ritorno si riallinea subito.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) aggiorna(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) aggiorna(); });
})();

