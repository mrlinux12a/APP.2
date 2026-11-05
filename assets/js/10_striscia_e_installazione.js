/* Striscia degli ordini in corso (partials/cliente/striscia_ordini.ejs). Con 4 o più schede la striscia scorre di lato: al caricamento si porta in
   vista quella della pagina aperta. Swipe tra gli ordini, SOLO con la striscia e SOLO su touch: uno spostamento orizzontale sul contenuto
   (non sulla striscia) passa all'ordine successivo (verso sinistra) o al precedente (verso destra). Conta come swipe se supera 60px ed è
   almeno 1,5 volte quello verticale; si ignora se parte su un campo di testo o dentro qualcosa che scorre in orizzontale. La pagina nuova si
   chiede SUBITO (senza aspettare l'animazione): intanto il contenuto scorre di lato e si attenua (translateX + .str-cambio; niente
   spostamento con "riduci movimento"), e la scheda di destinazione diventa subito quella attiva, anche con un tocco sulla striscia. Sulla
   prima e sull'ultima voce non si va da nessuna parte: un rimbalzo di 8px. */
(function () {
  'use strict';
  const striscia = document.querySelector('[data-striscia]');
  if (!striscia) return;
  const schede = Array.prototype.slice.call(striscia.querySelectorAll('a[data-voce]'));
  const corrente = schede.findIndex(function (a) { return a.getAttribute('aria-current') === 'page'; });
  if (corrente !== -1 && striscia.classList.contains('striscia-scorre')) {
    schede[corrente].scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  const contenuto = document.querySelector('.app > .contenuto');

  // Passando da un ordine all'altro la pagina nuova arriva dal server (qualche centinaio di millisecondi): intanto la scheda toccata
  // diventa subito quella attiva e il contenuto si attenua, così il tocco ha una risposta visibile senza aspettare.
  function segnaInArrivo(scheda) {
    schede.forEach(function (s) { s.classList.toggle('str-attiva', s === scheda); });
    if (contenuto) contenuto.classList.add('str-cambio');
  }
  striscia.addEventListener('click', function (e) {
    const scheda = e.target instanceof Element ? e.target.closest('a[data-voce]') : null;
    if (!scheda || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (scheda.getAttribute('aria-current') === 'page') return;
    segnaInArrivo(scheda);
  });
  // Tornando con "indietro" la pagina può essere rimostrata com'era (bfcache): la scheda attiva è quella vera, il contenuto a posto.
  window.addEventListener('pageshow', function () {
    schede.forEach(function (s, i) { s.classList.toggle('str-attiva', i === corrente); });
    if (contenuto) { contenuto.classList.remove('str-cambio'); contenuto.style.transform = ''; contenuto.style.opacity = ''; }
  });

  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  if (!contenuto || corrente === -1 || !touch) return;
  const ridotto = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let inizio = null;

  function scorreInOrizzontale(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1) {
        const o = window.getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
    }
    return false;
  }

  function rimbalzo(verso) {
    if (ridotto.matches) return;
    contenuto.classList.add('swipe-rimbalzo');
    contenuto.style.transform = 'translateX(' + verso * 8 + 'px)';
    setTimeout(function () {
      contenuto.style.transform = '';
      setTimeout(function () { contenuto.classList.remove('swipe-rimbalzo'); }, 140);
    }, 110);
  }

  // verso: -1 = il contenuto esce verso sinistra (si va all'ordine dopo), 1 = verso destra (a quello prima)
  function vai(indice, verso) {
    if (indice < 0 || indice >= schede.length) { rimbalzo(verso); return; }
    // La navigazione parte SUBITO: il contenuto scorre di lato mentre il browser aspetta la pagina nuova (prima si aspettavano 150ms
    // di animazione e poi si partiva, e quei 150ms si sommavano all'attesa del server).
    segnaInArrivo(schede[indice]);
    if (!ridotto.matches) contenuto.style.transform = 'translateX(' + verso * 24 + 'px)';
    window.location.href = schede[indice].href;
  }

  contenuto.addEventListener('touchstart', function (e) {
    inizio = null;
    if (e.touches.length !== 1) return;
    const bersaglio = e.target instanceof Element ? e.target : null;
    if (!bersaglio || bersaglio.closest('input, textarea, select, [contenteditable="true"]') || scorreInOrizzontale(bersaglio)) return;
    inizio = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  contenuto.addEventListener('touchend', function (e) {
    if (!inizio) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - inizio.x;
    const dy = t.clientY - inizio.y;
    inizio = null;
    if (Math.abs(dx) <= 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    vai(dx < 0 ? corrente + 1 : corrente - 1, dx < 0 ? -1 : 1);
  }, { passive: true });
  contenuto.addEventListener('touchcancel', function () { inizio = null; }, { passive: true });
})();

/* Installa l'app (views/partials/comune/installa.ejs, nella home e nel profilo). Le schede [data-installa] sono nascoste e qui si mostrano solo se si può installare:
   · Chrome/Edge/Samsung (HTTPS): il browser manda `beforeinstallprompt`; lo si tiene da parte e "Installa" lo mostra (si può usare una volta sola);
   · iPhone/iPad con Safari: non c'è un pulsante, si spiega a parole ("Condividi → Aggiungi alla schermata Home") e il bottone non c'è;
   · già installata (display-mode standalone / navigator.standalone): niente.
   Sulla home la × "Non ora" la nasconde per 30 giorni (localStorage); nel profilo ([data-installa-sempre]) non scompare mai. Dopo l'installazione
   (`appinstalled`) le schede spariscono. */
(function () {
  'use strict';
  const schede = Array.prototype.slice.call(document.querySelectorAll('[data-installa]'));
  if (!schede.length) return;

  const CHIAVE = 'minuteria.installa.nascosto';
  const TRENTA_GIORNI_MS = 30 * 24 * 60 * 60 * 1000;
  function leggi(chiave) { try { return window.localStorage.getItem(chiave); } catch (e) { return null; } }
  function scrivi(chiave, valore) { try { window.localStorage.setItem(chiave, valore); } catch (e) { /* si va avanti senza */ } }

  const giaInstallata = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  if (giaInstallata) return;

  const agente = window.navigator.userAgent || '';
  const iosSafari = (/iphone|ipad|ipod/i.test(agente) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)) && !/crios|fxios|edgios|opios/i.test(agente);
  let proposta = null; // l'evento beforeinstallprompt

  function mostra() {
    const nascostaFino = Number(leggi(CHIAVE)) || 0;
    schede.forEach(function (scheda) {
      if (scheda.hasAttribute('data-installa-sempre') || Date.now() > nascostaFino) scheda.hidden = false;
    });
  }
  function nascondi() { schede.forEach(function (scheda) { scheda.hidden = true; }); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // niente mini-barra del browser: l'invito è il nostro
    proposta = e;
    mostra();
  });
  window.addEventListener('appinstalled', function () {
    proposta = null;
    nascondi();
  });

  if (iosSafari) {
    schede.forEach(function (scheda) {
      const testo = scheda.querySelector('[data-installa-testo]');
      const bottone = scheda.querySelector('[data-installa-btn]');
      if (testo) testo.textContent = 'Tocca Condividi, poi «Aggiungi alla schermata Home».';
      if (bottone) bottone.hidden = true;
    });
    mostra();
  }

  schede.forEach(function (scheda) {
    const bottone = scheda.querySelector('[data-installa-btn]');
    const chiudi = scheda.querySelector('[data-installa-chiudi]');
    if (bottone) {
      bottone.addEventListener('click', function () {
        if (!proposta) return;
        const evento = proposta;
        proposta = null; // una proposta si può mostrare una volta sola
        evento.prompt();
        evento.userChoice.then(function (scelta) {
          if (scelta && scelta.outcome === 'accepted') nascondi();
        }).catch(function () { /* il browser ha annullato: l'invito resta fino al prossimo evento */ });
      });
    }
    if (chiudi) {
      chiudi.addEventListener('click', function () {
        scrivi(CHIAVE, String(Date.now() + TRENTA_GIORNI_MS));
        scheda.hidden = true;
      });
    }
  });
})();

/* Service worker: serve a mostrare le notifiche dove `new Notification` non esiste (Chrome per Android) e a
   rendere l'app installabile sulla schermata Home. Non mette in cache pagine né file: restano sempre quelli
   del server. Funziona solo in HTTPS (o su localhost): altrove il browser non lo offre e non succede niente. */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* l'app funziona anche senza */ });
  });
}

