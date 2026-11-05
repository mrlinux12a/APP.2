/* Avvisi del banco (richiesta esplicita del 20/10/2026), su TUTTE le pagine con l'intestazione del banco (partials/banco/banco_testa.ejs, [data-banco-testa]).
   Servono quando nessuno sta guardando la home: lì le tre colonne mostrano già tutto. Tre livelli, più la scheda del browser e il suono:
   1. pallino arancio col numero di richieste da confermare sulla scheda "Banco" (anche sulla home);
   2. striscia arancio sotto l'intestazione (partials/banco/banco_avviso.ejs): "2 richieste da confermare · la prima scade tra 01:38" (non sulla home);
   3. notifiche a comparsa in basso a destra (non sulla home), al massimo 3 per volta, la più nuova in basso:
        nuova_richiesta   anello col tempo che si svuota, "Conferma" (risponde senza lasciare la pagina) e "Ispeziona"; niente "×": resta finché
                          qualcuno risponde o scade (allora diventa "Richiesta scaduta"); suono
        corriere_trovato  "Ispeziona ordine"; resta finché si chiude o si apre l'ordine (anche cambiando pagina: sessionStorage); suono
        nessun_corriere   si chiude da sola dopo 10 s
        richiesta_scaduta si chiude da sola dopo 10 s
        ordine_consegnato si chiude da sola dopo 6 s
      Passando il mouse sopra, il conto alla rovescia di chiusura si ferma. Aperta o chiusa, la notifica risulta letta (POST /api/notifiche/lette).
   4. scheda del browser: se ci sono richieste da confermare e la scheda non è in primo piano, il titolo alterna ogni 2 s con "(N) Nuova richiesta · ditta"
      e la favicon prende un pallino arancio; la notifica di sistema (Notification) parte solo se la pagina è nascosta e l'interruttore è acceso;
   5. suono morbido (public/suoni/avviso.mp3, scripts/genera/genera_suono_avviso.js) per nuova richiesta e corriere trovato, su OGNI pagina del banco (home compresa), con la
      Web Audio API (una sorgente nuova a ogni suono: non si taglia). Il browser lo lascia partire solo dopo un gesto dell'utente sulla pagina: finché manca compare
      un avviso "Attiva il suono" sotto l'intestazione. Gli interruttori "Suoni" (con "Ascolta") e "Notifiche del computer" stanno nella scheda Notifiche della pagina
      "Anagrafica del banco"; localStorage;
   6. notifiche del computer (Web Push, src/logica/notifiche/web_push.js): con la pagina in secondo piano o chiusa è il sistema a suonare e a mostrare "Nuova richiesta" e "Corriere
      trovato". Se non sono attive compare un avviso "Attiva le notifiche" (si può rimandare di 7 giorni), perché senza il suono arriva solo con questa pagina aperta.
   Dati: GET /distributore/stato-banco ogni 15 s (e subito quando arriva una notifica) per numeri, richieste ancora aperte e ordini da preparare; GET /api/notifiche/push ogni 5 s
   per le notifiche nuove (src/logica/banco/avvisi.js). In più GET /api/eventi (Server-Sent Events, src/logica/notifiche/eventi.js): il server scrive alla pagina appena nasce una notifica e il
   suono parte subito, anche con la scheda nascosta (dove il browser porta i timer a un giro al minuto). Una richiesta che non c'è più nell'elenco (risposta di un collega,
   scaduta, annullata) fa sparire il suo avviso.
   La ricarica automatica delle pagine del banco (blocco "Pagine del banco", più su) aspetta la fine del suono: Minuteria.banco.primaDiRicaricare.
   Questo blocco sostituisce, sulle pagine del banco, quello delle notifiche del browser qui sopra. */
(function () {
  'use strict';
  const testa = document.querySelector('[data-banco-testa]');
  if (!testa) return;

  const { leggiJson, mostraNotifica, iscriviPush, disiscriviPush, pushDisponibile } = Minuteria;
  // La home del banco è /distributore (le colonne mostrano già tutto: lì niente striscia né avvisi a comparsa); è la stessa regola di partials/banco/banco_testa.ejs.
  const eHome = window.location.pathname.replace(/\/+$/, '') === '/distributore';
  const ditta = testa.getAttribute('data-ditta') || '';
  const titoloNormale = document.title;
  const SOGLIA_URGENTE_SEC = 120; // come src/logica/banco/richiesta.js: negli ultimi 2 minuti tempi e anelli diventano rossi
  const PUSH_MS = 5000;
  const STATO_MS = 15000;
  const MASSIMO_VISIBILI = 3;
  const NOTIFICA_VECCHIA_SEC = 600; // una notifica nata più di 10 minuti fa (si arriva dopo una lunga assenza) non si mostra più
  const CHIAVE_SUONI = 'minuteria.banco.suoni';
  const metaUtente = document.querySelector('meta[name="utente"]');
  const CHIAVE_SALVATI = 'minuteria.banco.avvisi.' + (metaUtente ? metaUtente.content : '0');
  const SALVATI_MAX_MS = 2 * 60 * 60 * 1000; // un avviso "Corriere trovato" salvato da più di 2 ore non si ripropone

  // localStorage e sessionStorage possono lanciare (navigazione privata, dati bloccati): mai un errore per questo.
  function leggi(storage, chiave) { try { return window[storage].getItem(chiave); } catch (e) { return null; } }
  function scrivi(storage, chiave, valore) { try { window[storage].setItem(chiave, valore); } catch (e) { /* si va avanti senza */ } }

  function plurale(n, uno, molti) { return n === 1 ? '1 ' + uno : n + ' ' + molti; }
  function mmss(sec) { return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  function richiestaUrl(id) { return '/distributore/richieste/' + id + '?torna=' + encodeURIComponent(window.location.pathname + window.location.search); }
  function ordineUrl(id) { return '/distributore/ordini/' + id + '?torna=' + encodeURIComponent(window.location.pathname + window.location.search); }

  // Avvisi di configurazione (suono bloccato, notifiche del computer: sezione più sotto). Le variabili vanno dichiarate PRIMA di tutto il resto: `aggiornaConfig`
  // viene chiamata già durante il caricamento (da `mostraInterruttoreSistema`) e con `let` più in basso scatterebbe l'errore "prima dell'inizializzazione".
  const CHIAVE_NOTIFICHE_RIMANDATE = 'minuteria.banco.notificheRimandate';
  const RIMANDA_NOTIFICHE_MS = 7 * 24 * 60 * 60 * 1000;
  let config = null;
  let rigaSuono = null;
  let rigaNotifiche = null;
  let rigaMessaggio = null;
  let testoMessaggio = null;
  let messaggioTimer = null;
  let configPronta = false; // vero poco dopo il caricamento: nei browser che lasciano partire l'audio da soli l'avviso non deve nemmeno lampeggiare

  // ---------- Suono ----------

  // Il suono (public/suoni/avviso.mp3, fatto da scripts/genera/genera_suono_avviso.js) si riproduce con la Web Audio API: UN contesto, UN buffer decodificato e, a ogni suono,
  // una "sorgente" nuova. Prima era un solo <audio> riusato: due suoni vicini si tagliavano a vicenda e lo "sblocco" del browser (l'audio parte solo dopo un gesto
  // dell'utente su quella pagina) poteva interrompere un suono vero: "a volte arriva solo un pezzo dello squillo" (richiesta esplicita del 21/10/2026).
  // `suonoFinoA` dice quando finisce il suono in corso: la ricarica automatica della pagina lo aspetta (primaDiRicaricare, più sotto).
  let suoniAttivi = leggi('localStorage', CHIAVE_SUONI) !== 'no';
  const ContestoAudio = window.AudioContext || window.webkitAudioContext;
  let contesto = null;
  let bufferSuono = null;
  let caricamentoBuffer = null;
  let suonoFinoA = 0;
  let ultimoBloccato = 0; // Date.now() dell'ultimo suono che il browser non ha lasciato partire (nessun gesto su questa pagina)

  function pausa(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function contestoAudio() {
    if (contesto || !ContestoAudio) return contesto;
    try { contesto = new ContestoAudio(); } catch (e) { contesto = null; }
    if (contesto) {
      try { contesto.addEventListener('statechange', function () { aggiornaConfig(); }); } catch (e) { /* senza, l'avviso si aggiorna al giro dopo */ }
    }
    return contesto;
  }

  // Scarica e decodifica il suono una volta sola (anche col contesto ancora fermo: decodificare si può sempre). Ritorna il buffer, o null se non si riesce.
  function caricaBuffer() {
    if (bufferSuono) return Promise.resolve(bufferSuono);
    if (caricamentoBuffer) return caricamentoBuffer;
    const c = contestoAudio();
    if (!c) return Promise.resolve(null);
    caricamentoBuffer = fetch('/suoni/avviso.mp3', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('suono non trovato'); return r.arrayBuffer(); })
      .then(function (dati) {
        // I Safari più vecchi vogliono le funzioni di ritorno, gli altri la promessa: vanno bene tutte e due.
        return new Promise(function (ok, no) {
          const p = c.decodeAudioData(dati, ok, no);
          if (p && typeof p.then === 'function') p.then(ok, no);
        });
      })
      .then(function (b) { bufferSuono = b; return b; })
      .catch(function () { caricamentoBuffer = null; return null; });
    return caricamentoBuffer;
  }

  // Il browser tiene fermo l'audio finché l'utente non ha usato la pagina: al primo gesto (tocco, clic, tasto) si fa partire il contesto, con un suono vuoto dentro
  // il gesto (è ciò che "sveglia" davvero l'audio di iPhone e iPad). Quando il contesto gira si smette di ascoltare i gesti.
  const GESTI = ['pointerup', 'touchend', 'click', 'keydown'];
  function sbloccaAudio() {
    const c = contestoAudio();
    if (!c) return;
    const verifica = function () {
      if (c.state !== 'running') return;
      GESTI.forEach(function (g) { document.removeEventListener(g, sbloccaAudio, true); });
      caricaBuffer();
      aggiornaConfig();
    };
    try {
      const p = c.resume();
      const vuoto = c.createBufferSource();
      vuoto.buffer = c.createBuffer(1, 1, 22050);
      vuoto.connect(c.destination);
      vuoto.start(0);
      if (p && typeof p.then === 'function') p.then(verifica, verifica); else verifica();
    } catch (e) { /* il gesto dopo riprova */ }
  }
  GESTI.forEach(function (g) { document.addEventListener(g, sbloccaAudio, true); });

  // Fa partire il suono. Ritorna una promessa con l'esito: 'partito'; 'spento' (interruttore "Suoni"); 'bloccato' (il browser non lo lascia partire: nessun gesto
  // su questa pagina, e compare l'avviso "Attiva il suono"); 'errore' (audio non disponibile o suono non caricato). `forza`: anche con l'interruttore spento (il
  // pulsante "Ascolta" dell'Anagrafica).
  function suono(opzioni) {
    if (!suoniAttivi && !(opzioni && opzioni.forza)) return Promise.resolve('spento');
    const c = contestoAudio();
    if (!c) return Promise.resolve('errore');
    let gira;
    if (c.state === 'running') {
      gira = Promise.resolve(true);
    } else {
      // Senza gesto il browser lascia in attesa resume(): si aspetta un attimo e, se non è partito, il suono è bloccato (non lo si recupera dopo, a gesto fatto:
      // sarebbe uno squillo fuori tempo).
      let r = null;
      try { r = c.resume(); } catch (e) { r = null; }
      gira = Promise.race([
        r && typeof r.then === 'function' ? r.then(function () { return c.state === 'running'; }, function () { return false; }) : Promise.resolve(false),
        pausa(400).then(function () { return c.state === 'running'; }),
      ]);
    }
    return Promise.all([gira, caricaBuffer()]).then(function (esito) {
      if (!esito[0]) { ultimoBloccato = Date.now(); aggiornaConfig(); return 'bloccato'; }
      if (!esito[1]) return 'errore';
      const sorgente = c.createBufferSource();
      sorgente.buffer = esito[1];
      sorgente.connect(c.destination);
      sorgente.start(0);
      suonoFinoA = Math.max(suonoFinoA, Date.now() + esito[1].duration * 1000 + 100);
      return 'partito';
    }).catch(function () { return 'errore'; });
  }
  // Si aspetta che il suono in corso finisca (anche se, nel frattempo, ne è partito un altro).
  function attendiFineSuono() {
    const resta = suonoFinoA - Date.now();
    return resta > 0 ? pausa(resta).then(attendiFineSuono) : Promise.resolve();
  }
  contestoAudio();
  caricaBuffer();

  // Interruttori della pagina "Anagrafica del banco" (scheda Notifiche; prima erano due voci della tendina dell'account: "Suoni notifiche" e
  // "Attiva le notifiche del computer"). Valgono per questo computer, non per il profilo. Sono bottoni role="switch": aria-checked dice se sono accesi.
  // Suoni: localStorage (CHIAVE_SUONI, default acceso). Notifiche del computer: serve il permesso del browser (si chiede solo con un clic) E la preferenza
  // qui sotto: il permesso non si revoca da una pagina, quindi "spento" vuol dire solo "non le mostro più" (CHIAVE_NOTIFICHE_SISTEMA = 'no').
  const CHIAVE_NOTIFICHE_SISTEMA = 'minuteria.banco.notificheSistema';
  function notificheSistemaConsentite() {
    return 'Notification' in window && Notification.permission === 'granted' && leggi('localStorage', CHIAVE_NOTIFICHE_SISTEMA) !== 'no';
  }

  const interruttoreSuoni = document.querySelector('[data-suoni-voce]');
  function mostraInterruttoreSuoni() {
    if (interruttoreSuoni) interruttoreSuoni.setAttribute('aria-checked', suoniAttivi ? 'true' : 'false');
    aggiornaConfig(); // con i suoni spenti l'avviso "Attiva il suono" non serve
  }
  mostraInterruttoreSuoni();
  if (interruttoreSuoni) {
    interruttoreSuoni.addEventListener('click', function () {
      suoniAttivi = !suoniAttivi;
      scrivi('localStorage', CHIAVE_SUONI, suoniAttivi ? 'sì' : 'no');
      mostraInterruttoreSuoni();
      if (suoniAttivi) suono(); // il clic sblocca l'audio: si sente subito com'è
    });
  }
  // "Ascolta" (Anagrafica del banco): il suono di adesso, anche con l'interruttore spento. Il clic è il gesto che sblocca l'audio.
  const pulsanteAscolta = document.querySelector('[data-suoni-prova]');
  if (pulsanteAscolta) pulsanteAscolta.addEventListener('click', function () { suono({ forza: true }); });

  const interruttoreSistema = document.querySelector('[data-notifiche-sistema]');
  const notaSistema = document.querySelector('[data-notifiche-nota]');
  // `notaProva`: dopo aver acceso l'interruttore, la riga dice che fra 10 secondi arriva una notifica di prova (con la scheda davanti non ne arrivano: bisogna uscire).
  let notaProva = '';
  function mostraInterruttoreSistema() {
    aggiornaConfig(); // acceso o spento qui, l'avviso "Attiva le notifiche" si adegua
    if (!interruttoreSistema) return;
    const supportate = 'Notification' in window;
    interruttoreSistema.setAttribute('aria-checked', notificheSistemaConsentite() ? 'true' : 'false');
    if (!notaSistema) return;
    // Permesso negato: l'interruttore resta spento e dice come sbloccarlo (solo il browser può farlo).
    const bloccate = supportate && Notification.permission === 'denied';
    const prova = supportate && !bloccate && notificheSistemaConsentite() ? notaProva : '';
    notaSistema.hidden = supportate && !bloccate && !prova;
    notaSistema.textContent = !supportate ? 'Questo browser non supporta le notifiche.' : bloccate ? 'Bloccate dal browser: riattivale dalle impostazioni del sito' : prova;
  }
  mostraInterruttoreSistema();
  // Notifiche ad app chiusa (Web Push, src/logica/notifiche/web_push.js): l'interruttore acceso iscrive questo browser alle push, e il service worker le mostra anche con la scheda
  // o il browser chiusi (la scheda non deve restare aperta); spento, toglie l'iscrizione. A ogni pagina, se l'interruttore è acceso, si controlla che l'iscrizione
  // ci sia ancora (nessuna chiamata al server se è tutto a posto). Le notifiche di sistema "da pagina nascosta" qui sotto (`daiPush`) restano per i browser senza push.
  if (notificheSistemaConsentite()) window.addEventListener('load', function () { iscriviPush(); });
  if (interruttoreSistema) {
    interruttoreSistema.addEventListener('click', function () {
      if (!('Notification' in window)) return;
      if (notificheSistemaConsentite()) { scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'no'); disiscriviPush(); mostraInterruttoreSistema(); return; }
      if (Notification.permission === 'granted') { scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'sì'); iscriviPush({ forza: true }); mostraInterruttoreSistema(); return; }
      if (Notification.permission === 'denied') { mostraInterruttoreSistema(); return; }
      Notification.requestPermission().then(function (permesso) {
        if (permesso === 'granted') {
          scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'sì');
          iscriviPush({ forza: true });
        }
        mostraInterruttoreSistema();
      });
    });
  }

  // Email per ogni nuova richiesta: salva subito (la riga c'è solo quando esiste l'invio, vedi views/banco/anagrafica.ejs). Se il salvataggio
  // non riesce l'interruttore torna com'era.
  const interruttoreEmail = document.querySelector('[data-email-richieste]');
  if (interruttoreEmail) {
    interruttoreEmail.addEventListener('click', function () {
      const acceso = interruttoreEmail.getAttribute('aria-checked') !== 'true';
      interruttoreEmail.setAttribute('aria-checked', acceso ? 'true' : 'false');
      fetch('/distributore/anagrafica/email-richieste', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceso: acceso }),
      }).then(function (r) { if (!r.ok) throw new Error('non salvato'); })
        .catch(function () { interruttoreEmail.setAttribute('aria-checked', acceso ? 'false' : 'true'); });
    });
  }

  // ---------- Avvisi di configurazione: suono bloccato, notifiche del computer ----------

  // Una striscia azzurra sotto l'intestazione (su tutte le pagine del banco, home compresa), con fino a tre righe:
  //  · "Attiva il suono": il browser tiene fermo l'audio finché non si tocca la pagina; la riga sparisce da sola appena il suono può partire;
  //  · "Attiva le notifiche": senza, suono e notifica arrivano solo con una pagina del banco aperta e davanti ("il suono arriva solo se sono sopra Banco"). Fino al
  //    21/10/2026 nel database non c'era NESSUNA iscrizione del banco: l'interruttore stava solo nell'Anagrafica e nessuno lo aveva acceso. Si può rimandare di 7 giorni;
  //  · un messaggio breve dopo aver provato ad attivare le notifiche.
  // (Le variabili stanno in cima, prima del suono: `aggiornaConfig` può essere chiamata già durante il caricamento.)

  function rigaDiConfig(testo, pulsanti) {
    const riga = nodo('div', 'banco-config-riga');
    riga.appendChild(nodo('span', 'banco-config-punto'));
    riga.appendChild(nodo('p', 'banco-config-testo', testo));
    if (pulsanti.length) {
      const azioni = nodo('div', 'banco-config-azioni');
      pulsanti.forEach(function (p) {
        const b = nodo('button', 'banco-config-btn' + (p.pieno ? ' pieno' : ''), p.testo);
        b.type = 'button';
        b.addEventListener('click', p.azione);
        azioni.appendChild(b);
      });
      riga.appendChild(azioni);
    }
    return riga;
  }

  function suonoDaSbloccare() {
    return suoniAttivi && !!contesto && contesto.state !== 'running' && (configPronta || Date.now() - ultimoBloccato < 120000);
  }
  function notificheDaProporre() {
    if (!('Notification' in window) || Notification.permission !== 'default' || !pushDisponibile()) return false;
    const rimandate = parseInt(leggi('localStorage', CHIAVE_NOTIFICHE_RIMANDATE) || '0', 10) || 0;
    return !(rimandate && Date.now() - rimandate < RIMANDA_NOTIFICHE_MS);
  }
  function aggiornaConfig() {
    if (!config) return;
    rigaSuono.hidden = !suonoDaSbloccare();
    rigaNotifiche.hidden = !notificheDaProporre();
    config.hidden = rigaSuono.hidden && rigaNotifiche.hidden && rigaMessaggio.hidden;
  }
  function mostraMessaggio(testo) {
    if (!config) return;
    testoMessaggio.textContent = testo;
    rigaMessaggio.hidden = false;
    clearTimeout(messaggioTimer);
    messaggioTimer = setTimeout(function () { rigaMessaggio.hidden = true; aggiornaConfig(); }, 7000);
    aggiornaConfig();
  }

  // "Attiva" le notifiche: il permesso si chiede solo con un clic. Poi il browser si iscrive alle push (il server può scrivere anche a pagina chiusa).
  function attivaNotifiche() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function (permesso) {
      if (permesso === 'denied') { mostraMessaggio('Le notifiche sono bloccate dal browser: si riattivano dalle impostazioni del sito.'); return null; }
      if (permesso !== 'granted') return null;
      scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'sì');
      return iscriviPush({ forza: true }).then(function (ok) {
        mostraMessaggio(ok
          ? 'Notifiche attivate: richieste e corrieri arrivano anche con la pagina in secondo piano o chiusa.'
          : 'Il permesso c’è, ma non sono riuscito ad attivare le notifiche a pagina chiusa. Riprova dall’Anagrafica del banco.');
      });
    }).catch(function () { /* resta com'era */ }).then(function () { mostraInterruttoreSistema(); aggiornaConfig(); });
  }

  function creaConfig() {
    config = nodo('div', 'banco-config');
    config.setAttribute('role', 'status');
    rigaSuono = rigaDiConfig('Il suono parte dopo un tocco su questa pagina: finché non la usi il browser lo tiene fermo.', [
      { testo: 'Attiva il suono', pieno: true, azione: function () { sbloccaAudio(); suono(); } },
    ]);
    rigaNotifiche = rigaDiConfig('Attiva le notifiche: con la pagina in secondo piano o chiusa ricevi lo stesso richieste e corrieri, con il suono del computer.', [
      { testo: 'Attiva', pieno: true, azione: attivaNotifiche },
      { testo: 'Non ora', azione: function () { scrivi('localStorage', CHIAVE_NOTIFICHE_RIMANDATE, String(Date.now())); aggiornaConfig(); } },
    ]);
    rigaMessaggio = rigaDiConfig('', []);
    testoMessaggio = rigaMessaggio.querySelector('.banco-config-testo');
    [rigaSuono, rigaNotifiche, rigaMessaggio].forEach(function (r) { r.hidden = true; config.appendChild(r); });
    config.hidden = true;
    testa.insertAdjacentElement('afterend', config);
    setTimeout(function () { configPronta = true; aggiornaConfig(); }, 1500);
  }

  // ---------- Scheda del browser: titolo e favicon ----------

  const pallino = document.querySelector('[data-banco-pallino]');
  let daConfermare = pallino && !pallino.hidden ? parseInt(pallino.textContent, 10) || 0 : 0;
  let titoloGiro = null;
  let titoloAlternato = false;

  function aggiornaTitolo() {
    const lampeggia = daConfermare > 0 && document.hidden;
    if (lampeggia && !titoloGiro) {
      titoloAlternato = false;
      const cambia = function () {
        titoloAlternato = !titoloAlternato;
        document.title = titoloAlternato ? '(' + daConfermare + ') Nuova richiesta' + (ditta ? ' · ' + ditta : '') : titoloNormale;
      };
      cambia();
      titoloGiro = setInterval(cambia, 2000);
    } else if (!lampeggia && titoloGiro) {
      clearInterval(titoloGiro);
      titoloGiro = null;
      document.title = titoloNormale;
    }
  }

  // Favicon: l'icona di sempre con un pallino arancio in alto a destra, disegnata su un canvas, finché ci sono richieste da confermare.
  const linkIcona = document.querySelector('link[rel~="icon"]');
  const iconaOriginale = linkIcona ? linkIcona.getAttribute('href') : null;
  let iconaImmagine = null;
  let iconaPronta = false;
  let iconaCon = null; // l'ultimo stato scritto (true = col pallino), per non rifare il disegno a vuoto
  function scriviFavicon(href) {
    const vecchio = document.querySelector('link[rel~="icon"]');
    const nuovo = document.createElement('link');
    nuovo.rel = 'icon';
    nuovo.type = 'image/png';
    nuovo.href = href;
    if (vecchio && vecchio.parentNode) vecchio.parentNode.replaceChild(nuovo, vecchio); else document.head.appendChild(nuovo);
  }
  function aggiornaFavicon() {
    if (!iconaOriginale) return;
    const con = daConfermare > 0;
    if (iconaCon === con) return;
    if (!con) {
      iconaCon = con;
      scriviFavicon(iconaOriginale);
      return;
    }
    const disegna = function () {
      try {
        const lato = 64;
        const canvas = document.createElement('canvas');
        canvas.width = lato;
        canvas.height = lato;
        const c = canvas.getContext('2d');
        c.drawImage(iconaImmagine, 0, 0, lato, lato);
        c.beginPath();
        c.arc(lato - 16, 16, 14, 0, Math.PI * 2);
        c.fillStyle = '#ab4d24';
        c.fill();
        c.lineWidth = 4;
        c.strokeStyle = '#ffffff';
        c.stroke();
        iconaCon = true;
        scriviFavicon(canvas.toDataURL('image/png'));
      } catch (e) { /* l'icona resta quella di prima */ }
    };
    if (iconaPronta) { disegna(); return; }
    if (iconaImmagine) return; // già in caricamento: ci si ritorna a caricamento finito
    iconaImmagine = new Image();
    iconaImmagine.onload = function () {
      iconaPronta = true;
      if (daConfermare > 0) disegna();
    };
    iconaImmagine.src = iconaOriginale;
  }
  document.addEventListener('visibilitychange', function () {
    aggiornaTitolo();
    if (!document.hidden) { aggiornaStato(); daiPush(); aggiornaConfig(); }
  });

  // ---------- Pallino su "Banco" e striscia ----------

  const striscia = document.querySelector('[data-banco-avviso]');
  const stripConta = striscia ? striscia.querySelector('[data-avviso-conta]') : null;
  const stripTempo = striscia ? striscia.querySelector('[data-avviso-tempo]') : null;
  const sogliaStriscia = striscia ? parseInt(striscia.getAttribute('data-urgente-sec'), 10) || SOGLIA_URGENTE_SEC : SOGLIA_URGENTE_SEC;
  let stripFine = striscia && stripTempo ? Date.now() + (parseInt(stripTempo.getAttribute('data-secondi'), 10) || 0) * 1000 : 0;
  let stripZeroChiesto = false;

  function mostraNumeri(n, primaScadeSec) {
    daConfermare = n;
    if (pallino) {
      pallino.textContent = String(n);
      pallino.setAttribute('aria-label', n + ' da confermare');
      pallino.hidden = n <= 0;
    }
    if (striscia) {
      const testo = n === 1 ? '1 richiesta da confermare' : n + ' richieste da confermare';
      if (stripConta && stripConta.textContent !== testo) stripConta.textContent = testo;
      if (typeof primaScadeSec === 'number') { stripFine = Date.now() + primaScadeSec * 1000; stripZeroChiesto = false; }
      striscia.hidden = n <= 0;
      tickStriscia();
    }
    aggiornaTitolo();
    aggiornaFavicon();
  }

  function tickStriscia() {
    if (!striscia || striscia.hidden || !stripTempo) return;
    const sec = Math.max(0, Math.ceil((stripFine - Date.now()) / 1000));
    const testo = mmss(sec);
    if (stripTempo.textContent !== testo) stripTempo.textContent = testo;
    striscia.classList.toggle('urgente', sec <= sogliaStriscia);
    // La prima è scaduta: fra poco il server avrà chiuso la richiesta, e la striscia passa alla prossima (o sparisce).
    if (sec === 0 && !stripZeroChiesto) {
      stripZeroChiesto = true;
      setTimeout(aggiornaStato, 1500);
    }
  }

  // ---------- Avvisi a comparsa ----------

  const avvisi = []; // dal più vecchio (in alto) al più nuovo (in basso)
  const confermate = new Set(); // richieste a cui ha risposto "Conferma" di questa pagina: non si ridisegnano se il server non se n'è ancora accorto
  const scadute = new Set(); // richieste già trasformate in "Richiesta scaduta" su questa pagina
  let contenitore = null;
  let altri = null;
  const modelloIcone = document.querySelector('template[data-banco-avvisi-icone]');

  function icona(nome) {
    const sorgente = modelloIcone ? modelloIcone.content.querySelector('[data-icona="' + nome + '"]') : null;
    const span = document.createElement('span');
    span.className = 'avv-ico';
    span.setAttribute('aria-hidden', 'true');
    if (sorgente) span.innerHTML = sorgente.innerHTML; // markup scritto dal server (src/comune/icone.js), mai testo di un utente
    return span;
  }

  function nodo(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = testo;
    return e;
  }

  // Aperta o chiusa, la notifica risulta letta. Un avviso sopravvive alle ricariche della pagina, che ne perdono gli id: per questo si manda anche la richiesta
  // ("Nuova richiesta") o l'ordine ("Corriere trovato") a cui si riferisce, e il server segna lette le notifiche di quel tipo per quella richiesta o ordine.
  function segnaLette(ids, richiesta, ordine) {
    const validi = (ids || []).filter(function (n) { return Number.isInteger(n) && n > 0; });
    if (!validi.length && !richiesta && !ordine) return;
    // keepalive: la richiesta parte anche se, subito dopo, la pagina cambia (clic su "Ispeziona").
    try {
      fetch('/api/notifiche/lette', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: validi, richieste: richiesta ? [richiesta] : [], ordini: ordine ? [ordine] : [] }),
      }).catch(function () { /* resta da leggere: non è grave */ });
    } catch (e) { /* idem */ }
  }
  function segnaLetto(a) {
    const richiesta = a.tipo === 'nuova_richiesta' ? a.richiestaId : a.rif;
    segnaLette(a.notifiche, richiesta, a.tipo === 'corriere_trovato' ? a.ordineId : null);
  }

  function salvaCorrieri() {
    const elenco = avvisi
      .filter(function (a) { return a.salva; })
      .map(function (a) { return { chiave: a.chiave, ordineId: a.ordineId, notifiche: a.notifiche, titolo: a.titolo, testo: a.testo, salvatoIl: a.salvatoIl }; });
    if (elenco.length) scrivi('sessionStorage', CHIAVE_SALVATI, JSON.stringify(elenco));
    else try { window.sessionStorage.removeItem(CHIAVE_SALVATI); } catch (e) { /* niente */ }
  }

  function disegna() {
    if (!contenitore) return;
    const daMostrare = avvisi.slice(-MASSIMO_VISIBILI);
    avvisi.forEach(function (a) {
      const visibile = daMostrare.indexOf(a) !== -1;
      if (visibile && !a.visibileDa) a.visibileDa = Date.now();
      a.el.hidden = !visibile;
    });
    const nascosti = avvisi.length - daMostrare.length;
    if (nascosti > 0) {
      altri.textContent = '+' + nascosti + (nascosti === 1 ? ' altro avviso' : ' altri avvisi');
      altri.hidden = false;
    } else {
      altri.hidden = true;
    }
  }

  function rimuovi(a, segnaLetta) {
    const i = avvisi.indexOf(a);
    if (i === -1) return;
    avvisi.splice(i, 1);
    if (a.el.parentNode) a.el.parentNode.removeChild(a.el);
    if (segnaLetta !== false) segnaLetto(a);
    if (a.salva) salvaCorrieri();
    disegna();
  }

  function trova(chiave) {
    return avvisi.find(function (a) { return a.chiave === chiave; }) || null;
  }

  // Crea (o aggiorna, se la chiave c'è già) un avviso. def: { chiave, tipo, titolo, testo, link, notifiche, pulsanti, chiudibile, durataMs, anello, salva, ordineId,
  // senzaAnimazione }. I testi sono sempre testo (textContent): il nome di un cliente lo scrive lui in registrazione.
  function crea(def) {
    if (!contenitore) return null;
    const esistente = trova(def.chiave);
    if (esistente) {
      (def.notifiche || []).forEach(function (id) { if (esistente.notifiche.indexOf(id) === -1) esistente.notifiche.push(id); });
      return esistente;
    }
    const a = {
      chiave: def.chiave,
      tipo: def.tipo,
      titolo: def.titolo,
      testo: def.testo,
      link: def.link || null,
      notifiche: (def.notifiche || []).slice(),
      durataMs: def.durataMs || 0,
      restanteMs: def.durataMs || 0,
      sopra: false,
      salva: !!def.salva,
      salvatoIl: def.salvatoIl || Date.now(),
      ordineId: def.ordineId || null,
      richiestaId: def.richiestaId || null, // solo gli avvisi "Nuova richiesta": sono quelli che seguono l'elenco del server e hanno l'anello
      rif: def.rif || null, // la richiesta a cui si riferisce un avviso "scaduta" o "nessun corriere" (per segnarne lette le notifiche)
      visibileDa: 0,
      creatoIl: def.creatoIl !== undefined ? def.creatoIl : Date.now(), // un avviso ripreso da un'altra pagina non è "appena nato": il server può già dire che è superato
      anello: null,
    };

    const el = nodo('div', 'avv avv-' + def.tipo + (def.senzaAnimazione ? ' senza-entrata' : ''));
    el.setAttribute('role', 'group');
    el.setAttribute('data-avviso', def.chiave);
    el.setAttribute('aria-label', def.titolo);

    const figura = nodo('div', 'avv-figura');
    if (def.anello) {
      const NS = 'http://www.w3.org/2000/svg';
      const R = 19;
      const circ = 2 * Math.PI * R;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 44 44');
      svg.setAttribute('aria-hidden', 'true');
      const traccia = document.createElementNS(NS, 'circle');
      traccia.setAttribute('class', 'avv-anello-traccia');
      const barra = document.createElementNS(NS, 'circle');
      barra.setAttribute('class', 'avv-anello-barra');
      [traccia, barra].forEach(function (c) { c.setAttribute('cx', '22'); c.setAttribute('cy', '22'); c.setAttribute('r', String(R)); });
      barra.setAttribute('transform', 'rotate(-90 22 22)');
      barra.setAttribute('stroke-dasharray', circ.toFixed(2));
      svg.appendChild(traccia);
      svg.appendChild(barra);
      const tempo = nodo('span', 'avv-anello-tempo', '');
      figura.classList.add('avv-figura-anello');
      figura.appendChild(svg);
      figura.appendChild(tempo);
      a.anello = { barra: barra, tempo: tempo, circ: circ, fine: Date.now() + def.anello.secondi * 1000, finestra: Math.max(1, def.anello.finestra) };
    } else {
      figura.appendChild(icona(def.icona));
    }
    el.appendChild(figura);

    const corpo = nodo('div', 'avv-corpo');
    corpo.appendChild(nodo('p', 'avv-titolo', def.titolo));
    corpo.appendChild(nodo('p', 'avv-testo', def.testo));
    const errore = nodo('p', 'avv-errore', '');
    errore.setAttribute('role', 'alert');
    errore.hidden = true;
    corpo.appendChild(errore);
    a.errore = errore;
    if (def.pulsanti && def.pulsanti.length) {
      const azioni = nodo('div', 'avv-azioni');
      def.pulsanti.forEach(function (p) {
        const b = nodo(p.href ? 'a' : 'button', 'avv-btn ' + (p.pieno ? 'avv-btn-' + p.pieno : 'avv-btn-bordo'));
        if (p.href) b.href = p.href; else b.type = 'button';
        if (p.icona) b.appendChild(icona(p.icona));
        const etichetta = nodo('span', '', p.testo);
        b.appendChild(etichetta);
        b.addEventListener('click', function () { if (p.azione) p.azione(a, b, etichetta); else uscendo(a); });
        azioni.appendChild(b);
      });
      corpo.appendChild(azioni);
    }
    el.appendChild(corpo);

    if (def.chiudibile) {
      const x = nodo('button', 'avv-chiudi');
      x.type = 'button';
      x.setAttribute('aria-label', 'Chiudi');
      x.appendChild(icona('chiudi'));
      x.addEventListener('click', function (e) { e.stopPropagation(); rimuovi(a); });
      el.appendChild(x);
    }

    // Un clic sull'avviso (non sui suoi pulsanti) porta al suo link.
    if (a.link) {
      el.classList.add('avv-link');
      el.addEventListener('click', function (e) {
        if (e.target.closest('a, button')) return;
        apriLink(a);
      });
    }
    // Passando il mouse (o con la tastiera dentro) il conto alla rovescia di chiusura si ferma.
    el.addEventListener('mouseenter', function () { a.sopra = true; });
    el.addEventListener('mouseleave', function () { a.sopra = false; });
    el.addEventListener('focusin', function () { a.sopra = true; });
    el.addEventListener('focusout', function () { a.sopra = false; });

    a.el = el;
    contenitore.appendChild(el);
    avvisi.push(a);
    if (a.salva) salvaCorrieri();
    disegna();
    tickAvvisi(0);
    return a;
  }

  // Si lascia la pagina aprendo l'avviso (clic su un suo pulsante-link o sull'avviso): prima lo si segna letto (la richiesta parte anche se la pagina
  // cambia subito) e lo si toglie dall'elenco di quelli salvati, così nella pagina dopo non ricompare.
  function uscendo(a) {
    segnaLetto(a);
    a.notifiche = [];
    const i = avvisi.indexOf(a);
    if (i !== -1) { avvisi.splice(i, 1); if (a.salva) salvaCorrieri(); }
  }
  function apriLink(a) {
    if (!a.link) return;
    uscendo(a);
    window.location.href = a.link;
  }

  // ---------- Le cinque schede ----------

  function schedaRichiesta(r, notifiche, senzaAnimazione) {
    return crea({
      chiave: 'richiesta-' + r.id,
      tipo: 'nuova_richiesta',
      titolo: 'Nuova richiesta · ' + r.cliente,
      testo: plurale(r.articoli, 'articolo', 'articoli') + ' · ' + plurale(r.pezzi, 'pezzo', 'pezzi') + ' · rispondi entro le ' + r.scadeAlle,
      link: richiestaUrl(r.id),
      richiestaId: r.id,
      notifiche: notifiche,
      chiudibile: false,
      anello: { secondi: r.secondi, finestra: r.finestraSec },
      senzaAnimazione: senzaAnimazione,
      pulsanti: [
        { testo: 'Conferma', pieno: 'arancio', azione: function (a, b, etichetta) { confermaDaAvviso(a, r.id, b, etichetta); } },
        { testo: 'Ispeziona', icona: 'occhio', href: richiestaUrl(r.id) },
      ],
    });
  }

  function schedaOrdine(o, notifiche, senzaAnimazione, salvatoIl) {
    const conCorriere = !!o.corriere;
    return crea({
      chiave: 'ordine-' + o.id,
      tipo: 'corriere_trovato',
      icona: 'furgone',
      titolo: (conCorriere ? 'Corriere trovato' : 'Nuovo ordine') + ' · Ordine #' + o.id,
      testo: conCorriere
        ? o.corriere + (o.ritiroAlle ? ' ritira alle ' + o.ritiroAlle : ' ha preso la consegna') + ': prepara il materiale.'
        : 'Ordine già pagato: prepara il materiale.',
      link: ordineUrl(o.id),
      ordineId: o.id,
      notifiche: notifiche,
      chiudibile: true,
      salva: true,
      salvatoIl: salvatoIl,
      senzaAnimazione: senzaAnimazione,
      pulsanti: [{ testo: 'Ispeziona ordine', icona: 'occhio', pieno: 'blu', href: ordineUrl(o.id) }],
    });
  }

  function schedaScaduta(id, notifiche) {
    scadute.add(id);
    return crea({
      chiave: 'scaduta-' + id,
      tipo: 'richiesta_scaduta',
      icona: 'esclamativo',
      titolo: 'Richiesta #' + id + ' scaduta',
      testo: 'Non hai risposto in tempo. Il cliente non paga nulla.',
      link: richiestaUrl(id),
      rif: id,
      notifiche: notifiche,
      chiudibile: true,
      durataMs: 10000,
    });
  }

  function schedaSenzaCorriere(id, notifiche) {
    return crea({
      chiave: 'senza-corriere-' + id,
      tipo: 'nessun_corriere',
      icona: 'esclamativo',
      titolo: 'Nessun corriere · richiesta #' + id,
      testo: 'Nessuno ha preso la consegna: non preparare. Il cliente è stato avvisato e non paga nulla.',
      link: richiestaUrl(id),
      rif: id,
      notifiche: notifiche,
      chiudibile: true,
      durataMs: 10000,
    });
  }

  function schedaConsegnato(o, notifiche) {
    return crea({
      chiave: 'consegnato-' + o.id,
      tipo: 'ordine_consegnato',
      icona: 'spunta',
      titolo: 'Ordine #' + o.id + ' consegnato',
      testo: (o.cliente || 'Il cliente') + ' ha confermato la consegna' + (o.alle ? ' alle ' + o.alle : '') + '.',
      link: ordineUrl(o.id),
      notifiche: notifiche,
      chiudibile: true,
      durataMs: 6000,
    });
  }

  // "Conferma" dall'avviso: risponde al banco senza lasciare la pagina (la rotta, chiesta in JSON, non fa redirect).
  function confermaDaAvviso(a, id, bottone, etichetta) {
    bottone.disabled = true;
    const prima = etichetta.textContent;
    etichetta.textContent = 'Confermo…';
    a.errore.hidden = true;
    fetch('/distributore/richieste/' + id + '/rispondi', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'azione=prezzo_richiesto',
    })
      .then(function (r) {
        if (r.status === 401) { window.location.href = '/login'; throw Object.assign(new Error('sessione scaduta'), { sessioneScaduta: true }); }
        return r.json().catch(function () { return null; });
      })
      .then(function (d) {
        if (d && d.ok) {
          confermate.add(id);
          etichetta.textContent = 'Confermata';
          segnaLetto(a);
          a.notifiche = [];
          setTimeout(function () { rimuovi(a, false); }, 1200);
          // La conferma cambia i numeri (striscia, pallino) e, a modulo spento, fa nascere subito l'ordine: si chiede senza aspettare il giro.
          aggiornaStato();
          setTimeout(daiPush, 1200);
          return;
        }
        bottone.disabled = false;
        etichetta.textContent = prima;
        a.errore.textContent = (d && d.errore) || 'Non sono riuscito a confermare. Riprova.';
        a.errore.hidden = false;
        // Se la richiesta non è più da confermare (la finestra è chiusa, ha risposto un collega) il prossimo aggiornamento tira via l'avviso.
        aggiornaStato();
      })
      .catch(function (err) {
        if (err && err.sessioneScaduta) return;
        bottone.disabled = false;
        etichetta.textContent = prima;
        a.errore.textContent = 'Non sono riuscito a confermare: controlla la connessione e riprova.';
        a.errore.hidden = false;
      });
  }

  // ---------- Conti alla rovescia: anelli e chiusure automatiche ----------

  let ultimoGiro = Date.now();
  function tickAvvisi(passoMs) {
    const adesso = Date.now();
    avvisi.slice().forEach(function (a) {
      if (a.anello) {
        const sec = Math.max(0, Math.ceil((a.anello.fine - adesso) / 1000));
        const testo = mmss(sec);
        if (a.anello.tempo.textContent !== testo) a.anello.tempo.textContent = testo;
        a.anello.barra.style.strokeDashoffset = (a.anello.circ * (1 - Math.min(1, sec / a.anello.finestra))).toFixed(2);
        a.el.classList.toggle('urgente', sec <= SOGLIA_URGENTE_SEC);
        // Scaduta: l'avviso si trasforma in "Richiesta scaduta" (il server la chiude entro pochi secondi e manda lo stesso avviso, che non si ripete).
        if (sec === 0 && a.richiestaId) {
          const id = a.richiestaId;
          const notifiche = a.notifiche.slice();
          a.notifiche = [];
          rimuovi(a, false);
          if (!confermate.has(id)) schedaScaduta(id, notifiche);
          setTimeout(aggiornaStato, 1500);
          return;
        }
      }
      // Chiusura automatica: conta solo mentre l'avviso si vede e il mouse non ci sta sopra.
      if (a.durataMs && a.visibileDa && !a.sopra && !a.el.hidden) {
        a.restanteMs -= passoMs;
        if (a.restanteMs <= 0) rimuovi(a);
      }
    });
  }
  setInterval(function () {
    const adesso = Date.now();
    const passo = Math.min(adesso - ultimoGiro, 2000); // dopo una pausa lunga (scheda in secondo piano) non si butta via tutto in un colpo
    ultimoGiro = adesso;
    tickStriscia();
    tickAvvisi(passo);
  }, 250);

  // ---------- Dati dal server ----------

  let statoInCorso = false;
  let statoDaRifare = false;
  let primoStato = true;

  function aggiornaStato() {
    // Chiesto mentre un altro giro è ancora per strada (la sua risposta può essere più vecchia di ciò che è successo): si rifà appena finisce.
    if (statoInCorso) { statoDaRifare = true; return; }
    statoInCorso = true;
    fetch('/distributore/stato-banco', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(leggiJson)
      .then(function (d) {
        if (!d || typeof d.daConfermare !== 'number') return;
        mostraNumeri(d.daConfermare, d.primaScadeSec);
        if (!eHome) riallinea(d.richieste || [], primoStato, d.ordini || []);
        primoStato = false;
      })
      .catch(function () { /* riprova al giro dopo */ })
      .then(function () {
        statoInCorso = false;
        if (statoDaRifare) { statoDaRifare = false; aggiornaStato(); }
      });
  }

  // Gli avvisi "Nuova richiesta" seguono l'elenco del server: ne compare uno per ogni richiesta ancora da confermare (anche dopo un cambio di pagina) e
  // sparisce quello di una richiesta che non c'è più. Se mancano pochi secondi alla scadenza si trasforma in "Richiesta scaduta".
  function riallinea(richieste, senzaAnimazione, ordiniDaPreparare) {
    // "Corriere trovato" resta finché si chiude o si apre l'ordine, ma se l'ordine è già partito (un collega l'ha preparato) o non c'è più, non c'è niente da preparare.
    const daPreparare = new Set(ordiniDaPreparare);
    avvisi.slice().forEach(function (a) {
      if (a.tipo !== 'corriere_trovato' || !a.ordineId || daPreparare.has(a.ordineId) || Date.now() - a.creatoIl < 4000) return;
      rimuovi(a);
    });
    const presenti = new Set(richieste.map(function (r) { return r.id; }));
    avvisi.slice().forEach(function (a) {
      if (!a.richiestaId || presenti.has(a.richiestaId)) return;
      // La risposta può essere partita prima che la richiesta esistesse: un avviso nato da pochi secondi si lascia al giro dopo.
      if (Date.now() - a.creatoIl < 4000) return;
      const restano = a.anello ? (a.anello.fine - Date.now()) / 1000 : 0;
      const id = a.richiestaId;
      const notifiche = a.notifiche.slice();
      a.notifiche = [];
      rimuovi(a, false);
      if (restano <= 5 && !confermate.has(id)) schedaScaduta(id, notifiche);
      else segnaLette(notifiche, id, null);
    });
    richieste.forEach(function (r) {
      if (r.secondi < 1 || confermate.has(r.id) || scadute.has(r.id)) return;
      // Sulla pagina di quella stessa richiesta c'è già tutto (timer e "Conferma"): niente avviso.
      if (window.location.pathname === '/distributore/richieste/' + r.id) return;
      if (!trova('richiesta-' + r.id)) schedaRichiesta(r, [], senzaAnimazione);
    });
  }

  // Ritorna una promessa che si chiude a notifiche trattate e suono PARTITO (non finito: per quello c'è attendiFineSuono). Se un giro è già in corso ritorna quello.
  let pushInCorso = null;
  function daiPush() {
    if (pushInCorso) return pushInCorso;
    pushInCorso = fetch('/api/notifiche/push', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(leggiJson)
      .then(function (d) {
        const nuove = ((d && d.notifiche) || []).filter(function (n) { return !(n.eta_sec > NOTIFICA_VECCHIA_SEC); });
        if (!nuove.length) return null;
        let suonare = false;
        let aggiornare = false;
        const perSuono = []; // le notifiche che meritano un suono: se il browser blocca l'audio, suona la notifica di sistema al loro posto
        nuove.forEach(function (n) {
          // Notifica di sistema: solo se la pagina è nascosta (se si vede basta l'avviso a comparsa, per non avvisare due volte).
          if (document.hidden && notificheSistemaConsentite()) mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id);
          const sullaPagina = n.link && window.location.pathname === n.link.split('?')[0];
          switch (n.tipo) {
            case 'nuova_richiesta':
              if (!n.richiesta) break; // già risposta o scaduta: niente da fare
              aggiornare = true;
              suonare = true;
              perSuono.push(n);
              if (!eHome && !sullaPagina) schedaRichiesta(n.richiesta, [n.id], false);
              else if (sullaPagina) segnaLette([n.id], n.request_id, null); // sulla pagina di quella richiesta c'è già tutto: letta
              break;
            case 'corriere_trovato':
              if (!n.ordine || !n.ordine.daPreparare) break;
              aggiornare = true;
              suonare = true;
              perSuono.push(n);
              if (!eHome && !sullaPagina) schedaOrdine(n.ordine, [n.id], false);
              else if (sullaPagina) segnaLette([n.id], null, n.ordine.id);
              break;
            case 'nessun_corriere':
              aggiornare = true;
              if (!eHome && n.request_id) { schedaSenzaCorriere(n.request_id, [n.id]); const r = trova('richiesta-' + n.request_id); if (r) rimuovi(r, false); }
              break;
            case 'richiesta_scaduta':
              aggiornare = true;
              if (eHome || !n.request_id) break;
              if (scadute.has(n.request_id)) segnaLette([n.id]); // già mostrata allo scadere del conto alla rovescia: non si ripete
              else {
                const r = trova('richiesta-' + n.request_id);
                if (r) rimuovi(r, false);
                schedaScaduta(n.request_id, [n.id]);
              }
              break;
            case 'ordine_consegnato':
              aggiornare = true;
              if (!eHome && n.ordine && !sullaPagina) schedaConsegnato(n.ordine, [n.id]);
              break;
            default:
              break;
          }
        });
        // Sulla HOME la scheda compare PRIMA del suono e del numero sul tab "Banco" (richiesta esplicita del 21/10/2026: "arriva prima il suono e il numeretto rispetto
        // alla card"): si aggiornano le colonne sul posto (senza ricaricare la pagina) e solo dopo si suona. Se il server tarda più di 2,5 s si suona lo stesso.
        const home = eHome && Minuteria.homeBanco ? Minuteria.homeBanco : null;
        const colonne = home && aggiornare ? Promise.race([home.rinfresca(), pausa(2500)]) : Promise.resolve(true);
        return colonne.then(function () {
          if (aggiornare) aggiornaStato();
          if (!suonare) return null;
          return suono().then(function (esito) {
            // Audio bloccato dal browser (nessun gesto su questa pagina) ma notifiche del computer attive: ci pensa il sistema, col suo suono. Con la scheda nascosta la
            // notifica è già stata mostrata qui sopra (stesso tag: non se ne fa una seconda).
            if (esito === 'bloccato' && notificheSistemaConsentite()) {
              perSuono.forEach(function (n) { mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id); });
            }
          });
        });
      })
      .catch(function () { /* nessuna notifica questo giro */ })
      .then(function () { pushInCorso = null; });
    return pushInCorso;
  }

  // La ricarica automatica delle pagine del banco (blocco "Pagine del banco") passa da qui: prima si prendono le notifiche appena nate, il suono parte e se ne aspetta la
  // fine (al massimo 4,5 s), poi si ricarica. Senza, una ricarica nel momento sbagliato tagliava lo squillo a metà, o toglieva alla pagina nuova la notifica che la
  // vecchia aveva già consumato senza farla suonare.
  function primaDiRicaricare() {
    return Promise.race([daiPush().then(attendiFineSuono), pausa(4500)]);
  }
  Minuteria.banco = { primaDiRicaricare: primaDiRicaricare, suono: suono };

  // ---------- Avvio ----------

  if (!eHome) {
    contenitore = nodo('div', 'banco-avvisi');
    contenitore.setAttribute('aria-live', 'polite');
    contenitore.setAttribute('aria-atomic', 'false');
    altri = nodo('div', 'banco-avvisi-altri');
    altri.hidden = true;
    contenitore.appendChild(altri);
    document.body.appendChild(contenitore);

    // "Corriere trovato" salvati (restano finché non si chiudono o si apre l'ordine, anche cambiando pagina).
    try {
      const salvati = JSON.parse(leggi('sessionStorage', CHIAVE_SALVATI) || '[]');
      salvati.forEach(function (s) {
        if (!s || !s.ordineId || Date.now() - s.salvatoIl > SALVATI_MAX_MS) return;
        if (window.location.pathname === '/distributore/ordini/' + s.ordineId) { segnaLette(s.notifiche, null, s.ordineId); return; }
        const a = crea({
          chiave: s.chiave, tipo: 'corriere_trovato', icona: 'furgone', titolo: s.titolo, testo: s.testo, link: ordineUrl(s.ordineId), ordineId: s.ordineId,
          notifiche: s.notifiche || [], chiudibile: true, salva: true, salvatoIl: s.salvatoIl, senzaAnimazione: true, creatoIl: 0,
          pulsanti: [{ testo: 'Ispeziona ordine', icona: 'occhio', pieno: 'blu', href: ordineUrl(s.ordineId) }],
        });
      });
      salvaCorrieri();
    } catch (e) { /* elenco rovinato: si riparte da zero */ }
  }

  creaConfig();
  mostraNumeri(daConfermare, null);
  // La home aggiornata sul posto (blocco "Home del banco") dice quante richieste ci sono da confermare: il numero sul tab "Banco" cambia nello stesso istante delle schede.
  window.addEventListener('minuteria:bacheca', function (e) {
    if (e.detail && typeof e.detail.daConfermare === 'number') mostraNumeri(e.detail.daConfermare, null);
  });
  aggiornaStato();
  setTimeout(daiPush, 800);
  setInterval(aggiornaStato, STATO_MS);
  setInterval(daiPush, PUSH_MS);
  window.addEventListener('online', function () { aggiornaStato(); daiPush(); });

  // In tempo reale (Server-Sent Events, GET /api/eventi, src/logica/notifiche/eventi.js): il server scrive a questa pagina appena nasce una notifica del banco, e il suono parte subito.
  // I giri da 5 e 15 secondi qui sopra restano come rete di sicurezza, ma in una scheda NASCOSTA il browser rallenta i timer (fino a un giro al minuto dopo qualche
  // minuto): era il motivo per cui "il suono arriva solo se sono sopra Banco". Gli eventi di rete invece non vengono rallentati. Se la notifica non è ancora visibile
  // al database (l'evento parte appena scritta, a volte dentro una transazione) si riprova dopo un secondo e mezzo.
  if ('EventSource' in window) {
    let sorgente = null;
    let apertaGiaUnaVolta = false;
    const apriEventi = function () {
      if (sorgente) return;
      try { sorgente = new EventSource('/api/eventi'); } catch (e) { sorgente = null; return; }
      sorgente.addEventListener('open', function () {
        if (apertaGiaUnaVolta) { daiPush(); aggiornaStato(); } // riaperta dopo una caduta: si guarda cosa è successo nel frattempo
        apertaGiaUnaVolta = true;
      });
      sorgente.addEventListener('notifica', function () {
        daiPush(); // sulla home aggiorna prima le colonne e poi suona (vedi daiPush)
        setTimeout(function () {
          if (eHome && Minuteria.homeBanco) Minuteria.homeBanco.rinfresca(); // la scheda può non essere ancora visibile al database: si ricontrolla
          daiPush();
        }, 1500);
      });
    };
    apriEventi();
    window.addEventListener('pagehide', function () { if (sorgente) { sorgente.close(); sorgente = null; } });
    window.addEventListener('pageshow', function (e) { if (e.persisted) apriEventi(); });
  }
  // Tornando con "indietro" il browser può rimostrare la pagina com'era: gli avvisi vanno rifatti da capo.
  window.addEventListener('pageshow', function (e) { if (e.persisted) window.location.reload(); });
})();


