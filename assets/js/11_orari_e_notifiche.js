/* Orari del banco in tempo reale (richieste esplicite del 22/10/2026). Il carrello (banner "Ordini chiusi", pulsante, nota, striscia "Ancora 9 min per inviare: alle 17:00
   chiudiamo") e la pagina "Orari di BOREA" dipendono dagli orari che il banco imposta nella sua "Anagrafica". Le parti che ne dipendono sono marcate `data-orari-sync="nome"`
   nelle viste; quando qualcosa cambia la pagina si rilegge da sola (stesso indirizzo) e SOSTITUISCE solo quelle parti: indirizzo, nota, quantità e il resto non si toccano.
   Quando si rilegge:
     · il banco salva gli orari → il server scrive l'evento 'orari' a tutti gli installatori collegati (src/logica/notifiche/eventi.js `emettiARuolo`, GET /api/eventi) e subito qui;
     · lo stato cambia da solo (chiude o riapre): `data-cambia-sec` = i secondi che mancano, più 1,5 s perché il server abbia già cambiato idea (se un arrotondamento
       dicesse ancora "aperto", la nuova lettura riarma il timer con i secondi veri: niente ricariche a raffica);
     · la scheda torna in primo piano (o la pagina riappare dal tasto "indietro", o la connessione si riapre dopo una caduta): si recupera quel che si è perso.
   `data-chiusura-sec` della striscia = secondi alla chiusura al momento del disegno: qui si aggiorna il numero (i minuti, per eccesso). Se la pagina letta non ha più le parti
   marcate (per esempio il carrello nel frattempo si è svuotato) si ricarica del tutto; un errore di rete non fa niente. */
(function () {
  'use strict';
  const zona = '[data-orari-sync]';
  if (!document.querySelector(zona)) return;
  let timerCambio = null;
  let ultimaLettura = Date.now();
  let inCorso = false;
  let fineStriscia = 0;

  function aggiornaStriscia() {
    const striscia = document.querySelector('[data-chiusura-sec]');
    if (!striscia || !fineStriscia) return;
    const numero = striscia.querySelector('[data-chiusura-min]');
    const mancano = fineStriscia - Date.now();
    if (numero && mancano > 0) numero.textContent = Math.ceil(mancano / 60000) + ' min';
  }
  function armaStriscia() {
    const striscia = document.querySelector('[data-chiusura-sec]');
    fineStriscia = striscia ? Date.now() + Number(striscia.getAttribute('data-chiusura-sec')) * 1000 : 0;
    aggiornaStriscia();
  }
  function armaCambio() {
    clearTimeout(timerCambio);
    timerCambio = null;
    const el = document.querySelector('[data-cambia-sec]');
    const secondi = el ? Number(el.getAttribute('data-cambia-sec')) : 0;
    if (secondi > 0) timerCambio = setTimeout(rinfresca, Math.min(secondi * 1000 + 1500, 2000000000));
  }
  function rinfresca() {
    if (inCorso) return;
    inCorso = true;
    fetch(window.location.pathname + window.location.search, { credentials: 'same-origin', headers: { Accept: 'text/html' }, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok || r.redirected) throw new Error('pagina non disponibile'); // per esempio la sessione è scaduta: non si tocca niente
        return r.text();
      })
      .then(function (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nuove = doc.querySelectorAll(zona);
        if (!nuove.length) { window.location.reload(); return; }
        nuove.forEach(function (nuova) {
          const attuale = document.querySelector('[data-orari-sync="' + nuova.getAttribute('data-orari-sync') + '"]');
          if (attuale) attuale.replaceWith(document.importNode(nuova, true));
        });
        // lo spazio in fondo alla pagina segue la striscia sopra la barra di pagamento
        const app = document.querySelector('.app');
        const appNuova = doc.querySelector('.app');
        if (app && appNuova) app.classList.toggle('app-carrello-chiusura', appNuova.classList.contains('app-carrello-chiusura'));
        ultimaLettura = Date.now();
        armaStriscia();
        armaCambio();
      })
      .catch(function () { /* niente rete o sessione scaduta: al prossimo evento o al ritorno in primo piano */ })
      .then(function () { inCorso = false; });
  }

  armaStriscia();
  armaCambio();
  setInterval(aggiornaStriscia, 10000);
  window.addEventListener('minuteria:orari', rinfresca);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    aggiornaStriscia();
    if (Date.now() - ultimaLettura > 15000) rinfresca(); // i timer a scheda nascosta si fermano: si rimette tutto a posto
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) rinfresca(); });
})();

/* Entrando nell'app le notifiche di sistema già mostrate spariscono dalla tendina del telefono (richiesta esplicita del 21/10/2026): quando la pagina si apre o torna
   in primo piano (apertura dall'icona, tocco su una notifica, ritorno da un'altra app, tasto "indietro") si chiudono TUTTE quelle del sito, non solo la toccata. Chi
   è dentro l'app vede già tutto sullo schermo. Vale per ogni ruolo e solo da collegati. Il service worker fa lo stesso al tocco su una notifica (public/sw.js).
   `getNotifications` c'è su Android, su computer e su iPhone/iPad (web app installata); altrove non si fa niente. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !document.body || document.body.dataset.loggato !== '1') return;
  let inCorso = false;
  function pulisciTendina() {
    if (inCorso || document.visibilityState !== 'visible') return;
    inCorso = true;
    // `ready` da solo non si risolve mai se nessun service worker si registra: dopo 3 secondi si lascia perdere.
    Promise.race([navigator.serviceWorker.ready, new Promise(function (ok) { setTimeout(function () { ok(null); }, 3000); })])
      .then(function (registrazione) {
        if (!registrazione || typeof registrazione.getNotifications !== 'function') return;
        return registrazione.getNotifications().then(function (aperte) { aperte.forEach(function (notifica) { notifica.close(); }); });
      })
      .catch(function () { /* la tendina resta com'è */ })
      .then(function () { inCorso = false; });
  }
  pulisciTendina();
  document.addEventListener('visibilitychange', pulisciTendina);
  window.addEventListener('focus', pulisciTendina);
  window.addEventListener('pageshow', pulisciTendina);
})();

