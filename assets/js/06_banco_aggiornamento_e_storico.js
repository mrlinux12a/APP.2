/* Pagine del banco (home, storico ordini, clienti, dettaglio richiesta): richieste e ordini
   appena arrivati compaiono senza premere F5. Ogni pochi secondi chiede al server due numeri
   leggeri (/api/distributore/novita) e li confronta con quelli con cui la pagina è stata disegnata
   (data-versione): se sono cambiati si ricarica (la HOME invece si aggiorna sul posto, vedi sotto). Non dipende da una ricarica a tempo, che si salta
   quando la scheda è in secondo piano. Se la scheda è nascosta o l'utente sta scrivendo in un
   campo aspetta, e ricarica appena torna in primo piano o esce dal campo. */
(function () {
  'use strict';
  const ms = parseInt(document.body.dataset.autoRefresh, 10);
  if (!ms) return;

  // I numeri con cui la pagina è stata disegnata. Si rileggono a ogni controllo: la home si aggiorna sul posto (Minuteria.homeBanco.rinfresca) e riscrive questo
  // attributo con quelli della bacheca nuova.
  const versioneAttuale = function () { return document.body.dataset.versione || null; };
  let inCorso = false;
  let daRicaricare = false;
  let erroriDiFila = 0;

  // Un campo marcato data-non-ricaricare (la ricerca dello Storico ordini) con del testo non ancora inviato: la ricarica
  // lo cancellerebbe, quindi si aspetta anche se il campo non ha più il fuoco. defaultValue è ciò che il server ha
  // disegnato (la ricerca già inviata): cambiato rispetto a quello = testo non inviato.
  function conTestoNonInviato() {
    return Array.prototype.some.call(document.querySelectorAll('input[data-non-ricaricare]'), function (c) {
      return c.value !== c.defaultValue;
    });
  }

  function suCampo() {
    const attivo = document.activeElement;
    return (!!attivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(attivo.tagName)) || conTestoNonInviato();
  }

  // La ricarica vera. Sulle pagine del banco prima si fa sentire ciò che è appena arrivato e si aspetta la fine del suono ("Avvisi del banco", più sotto:
  // Minuteria.banco.primaDiRicaricare): ricaricare subito tagliava lo squillo a metà, e la notifica già consumata dalla pagina che spariva non suonava più.
  // La HOME invece non si ricarica: le sue colonne si aggiornano sul posto (blocco "Home del banco": Minuteria.homeBanco.rinfresca), anche a scheda nascosta. La scheda
  // della richiesta compare subito, insieme al suono e al numero sul tab "Banco", e l'audio resta sbloccato (dopo una ricarica il browser lo blocca di nuovo).
  // Solo se l'aggiornamento non riesce (server che non risponde, sessione scaduta) si ricarica la pagina, come sulle altre.
  let ricaricando = false;
  function homeBanco() {
    return typeof Minuteria !== 'undefined' && Minuteria.homeBanco ? Minuteria.homeBanco : null;
  }
  function ricaricaDavvero() {
    if (ricaricando) return;
    ricaricando = true;
    const ricaricaPagina = function () {
      // (`Minuteria` è una const del file, non una proprietà di window: cercarla lì darebbe sempre undefined e la ricarica non aspetterebbe mai il suono.)
      const prima = typeof Minuteria !== 'undefined' && Minuteria.banco ? Minuteria.banco.primaDiRicaricare : null;
      Promise.resolve(prima ? prima() : null).catch(function () { /* si ricarica lo stesso */ }).then(function () { window.location.reload(); });
    };
    const home = homeBanco();
    if (!home) { ricaricaPagina(); return; }
    home.rinfresca().then(function (ok) {
      if (ok) { ricaricando = false; return; }
      ricaricaPagina();
    });
  }

  function ricarica() {
    if (homeBanco()) { ricaricaDavvero(); return; }
    if (document.hidden || suCampo()) {
      daRicaricare = true;
      return;
    }
    ricaricaDavvero();
  }

  function riprendi() {
    if (daRicaricare && !document.hidden && !suCampo()) ricaricaDavvero();
  }

  function controlla() {
    if (inCorso) return;
    inCorso = true;
    fetch('/api/distributore/novita', { cache: 'no-store', credentials: 'same-origin' })
      .then(Minuteria.leggiJson)
      .then(function (d) {
        erroriDiFila = 0;
        const versione = versioneAttuale();
        if (versione !== null && JSON.stringify(d) !== versione) ricarica();
      })
      .catch(function () {
        // Il controllo leggero non risponde (sessione scaduta, proxy, rete): si torna alla
        // ricarica a tempo, che almeno porta alla pagina di accesso o all'elenco aggiornato.
        erroriDiFila += 1;
        if (erroriDiFila >= 3) ricarica();
      })
      .then(function () { inCorso = false; });
  }

  setInterval(controlla, Math.min(ms, 5000));
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    riprendi();
    controlla();
  });
  document.addEventListener('focusout', function () { setTimeout(riprendi, 300); });
  window.addEventListener('online', controlla);
  // Tornando con "indietro" il browser può rimostrare la pagina com'era: va ridisegnata.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });
})();

/* Storico ordini del banco: la "×" per svuotare la ricerca compare appena nel campo c'è del testo (anche non ancora
   inviato) e sparisce quando è vuoto. È un link che riporta alla pagina senza ricerca, quindi funziona anche senza questo
   script (che lo mostra solo quando serve). */
(function () {
  'use strict';
  const campo = document.querySelector('[data-storico-cerca]');
  const svuota = document.querySelector('[data-storico-svuota]');
  if (!campo || !svuota) return;
  campo.addEventListener('input', function () { svuota.hidden = !campo.value; });
})();

/* Storico ordini del banco: OGNI riga si apre nella stessa pagina e mostra il dettaglio sotto di sé (views/banco/storico.ejs). La riga è un <button>
   (aria-expanded, Invio e Spazio); il pannello sotto è vuoto e nascosto, e al primo clic si riempie con il frammento di GET /distributore/storico/:id/dettaglio
   (la lista resta leggera). Una voce aperta alla volta: aprirne un'altra chiude la prima, un secondo clic la richiude. L'id aperto sta nell'ancora dell'indirizzo
   (#o149, scritta con replaceState: non sporca la cronologia), così dopo una ricarica o tornando indietro dalla pagina dell'ordine la stessa voce si riapre. */
(function () {
  'use strict';
  const voci = document.querySelectorAll('.sto-voce[data-voce]');
  if (!voci.length) return;

  let aperta = null;

  function scriviAncora(id) {
    try { history.replaceState(null, '', window.location.pathname + window.location.search + (id ? '#o' + id : '')); } catch (e) { /* l'indirizzo resta com'è */ }
  }

  function carica(voce) {
    const pannello = voce.querySelector('.sto-dettaglio');
    if (pannello.getAttribute('data-stato') === 'in-corso' || pannello.getAttribute('data-stato') === 'caricato') return;
    pannello.setAttribute('data-stato', 'in-corso');
    pannello.innerHTML = '<p class="sto-d-attesa" role="status">Caricamento…</p>';
    // `torna`: la pagina com'è adesso (con i suoi filtri): il pulsante "Apri ordine completo" la porta con sé, e la freccia della pagina dell'ordine ci riporta.
    const url = pannello.getAttribute('data-url') + '?torna=' + encodeURIComponent(window.location.pathname + window.location.search);
    fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) {
        // Sessione scaduta: il server rimanda al login (una pagina intera, non il frammento): si ricarica per andarci.
        if (r.redirected) { window.location.reload(); throw Object.assign(new Error('sessione'), { sessioneScaduta: true }); }
        if (!r.ok) throw new Error('http');
        return r.text();
      })
      .then(function (html) {
        pannello.innerHTML = html;
        pannello.setAttribute('data-stato', 'caricato');
      })
      .catch(function (err) {
        if (err && err.sessioneScaduta) return;
        pannello.setAttribute('data-stato', 'errore');
        pannello.innerHTML = '<p class="sto-d-errore" role="alert">Non riesco a caricare i dettagli. <button type="button" data-sto-riprova>Riprova</button></p>';
      });
  }

  function chiudi(voce) {
    voce.classList.remove('aperta');
    voce.querySelector('[data-sto-apri]').setAttribute('aria-expanded', 'false');
    voce.querySelector('.sto-dettaglio').hidden = true;
    if (aperta === voce) aperta = null;
  }

  function apri(voce) {
    if (aperta === voce) return;
    // Se la voce che si chiude sta sopra, la pagina si accorcia e la riga cliccata salterebbe in su: si riporta dov'era sotto il dito.
    const prima = voce.getBoundingClientRect().top;
    if (aperta) chiudi(aperta);
    voce.classList.add('aperta');
    voce.querySelector('[data-sto-apri]').setAttribute('aria-expanded', 'true');
    voce.querySelector('.sto-dettaglio').hidden = false;
    aperta = voce;
    carica(voce);
    const spostamento = voce.getBoundingClientRect().top - prima;
    if (spostamento) window.scrollBy(0, spostamento);
  }

  // Dall'ancora dell'indirizzo (#o149): apre quella voce se è in pagina; se la riga è fuori dallo schermo (la barra in cima è fissa) la porta in vista.
  function daAncora() {
    const m = /^#o(\d+)$/.exec(window.location.hash);
    const voce = m ? document.getElementById('o' + m[1]) : null;
    if (!voce || !voce.classList.contains('sto-voce')) {
      if (!m && aperta) chiudi(aperta);
      return;
    }
    apri(voce);
    const r = voce.getBoundingClientRect();
    if (r.top < 80 || r.top > window.innerHeight - 80) voce.scrollIntoView({ block: 'center' });
  }

  document.addEventListener('click', function (e) {
    const riprova = e.target.closest('[data-sto-riprova]');
    if (riprova) {
      const voce = riprova.closest('.sto-voce');
      voce.querySelector('.sto-dettaglio').removeAttribute('data-stato');
      carica(voce);
      return;
    }
    const riga = e.target.closest('[data-sto-apri]');
    if (!riga) return;
    const voce = riga.closest('.sto-voce');
    if (voce.classList.contains('aperta')) {
      chiudi(voce);
      scriviAncora(null);
    } else {
      apri(voce);
      scriviAncora(voce.getAttribute('data-voce'));
    }
  });

  window.addEventListener('hashchange', daAncora);
  daAncora();
})();

