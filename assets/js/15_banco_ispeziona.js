/* Popup "Ispeziona" della home del banco (richiesta del 10/11/2026; vista views/banco/richieste.ejs, contenuto views/partials/banco/ispeziona.ejs).
   Si apre SOPRA la bacheca, senza cambiare pagina, dal pulsante "Ispeziona" di una scheda (un collegamento alla pagina vera: senza JS, o con un clic con Ctrl/Cmd, si va lì).
   - Il contenuto lo disegna il server: GET /distributore/ispeziona/<lavoro> (src/routes/banco/home.js). Il lavoro ("r177", "o1281") resta uguale quando la richiesta
     diventa ordine, quindi il popup aperto segue il lavoro da una fase all'altra: lo si rilegge a ogni aggiornamento della bacheca (evento `minuteria:bacheca`,
     lanciato da Minuteria.homeBanco.rinfresca) e ogni 10 secondi come rete di sicurezza. Se la fase cambia, il popup cambia; se il lavoro esce dalla bacheca
     (ritirato, scaduto, rifiutato da altri, annullato) mostra un avviso e si può chiudere.
   - Se il contenuto non cambia (stessa `data-isp-firma`) non si ridisegna: i conti alla rovescia del popup continuano senza ripartire. Come sulla home, ogni tempo
     parte dai secondi scritti dal server e si trasforma in un istante con l'orologio del browser.
   - Si chiude con X, "Chiudi", Esc e clic sull'overlay. Il fuoco resta intrappolato nel popup (il resto della pagina è `inert`) e, chiudendo, torna al pulsante che l'ha aperto.
   - Le azioni (Accetta ordine, Non disponibile, Ritirato dal corriere) usano le rotte di sempre, chieste in JSON, senza lasciare la pagina: "Accetta ordine" lascia il popup
     aperto, che passa da solo alla fase dopo; le altre due fanno uscire il lavoro dalla bacheca e chiudono il popup. */
(function () {
  'use strict';
  const overlay = document.querySelector('[data-isp-overlay]');
  const pannello = overlay ? overlay.querySelector('[data-isp-pannello]') : null;
  const bacheca = document.querySelector('[data-bacheca]');
  if (!overlay || !pannello || !bacheca) return;

  const sogliaUrgente = parseInt(bacheca.getAttribute('data-soglia-urgente'), 10) || 120;
  // Quello che la pagina nasconde al resto del mondo finché il popup è aperto (non si può cliccare né raggiungere con Tab).
  const SFONDO = '.banco-testa, [data-bacheca], nav.navbar, .banco-config';
  const FOCUSABILI = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let chiave = null; // il lavoro aperto ("r177"), null se il popup è chiuso
  let apertoDa = null; // l'elemento a cui restituire il fuoco alla chiusura
  let contenuto = null; // la radice [data-isp] attualmente nel pannello
  let intervalloConti = 0;
  let intervalloSicurezza = 0;
  let richiestaN = 0; // numera le letture: una risposta arrivata in ritardo, dopo una più recente, si ignora
  let inAzione = false;
  let scadenzaVista = false;

  function numero(el, nome) {
    const n = parseInt(el.getAttribute(nome), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function mmss(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function scrivi(el, testo) {
    if (el && el.textContent !== testo) el.textContent = testo;
  }
  function larghezza(barra, frazione) {
    if (!barra) return;
    const w = (Math.max(0, Math.min(1, frazione)) * 100).toFixed(1) + '%';
    if (barra.style.width !== w) barra.style.width = w;
  }

  // ----- I conti alla rovescia del popup -----
  // Gli istanti si calcolano quando il contenuto entra nel pannello (`preparaConti`) e da lì restano.
  let conti = null;
  function preparaConti() {
    conti = null;
    scadenzaVista = false;
    const t = contenuto ? contenuto.querySelector('[data-isp-tempo]') : null;
    if (!t) return;
    const adesso = Date.now();
    const valore = t.querySelector('[data-isp-valore]');
    const barra = t.querySelector('[data-barra]');
    if (t.hasAttribute('data-finestra')) {
      conti = { tipo: 'conferma', t: t, valore: valore, barra: barra, fine: adesso + numero(t, 'data-secondi') * 1000, finestra: Math.max(1, numero(t, 'data-finestra')) };
    } else if (t.hasAttribute('data-trascorsi')) {
      conti = { tipo: 'corriere', t: t, valore: valore, inizio: adesso - numero(t, 'data-trascorsi') * 1000 };
    } else if (t.hasAttribute('data-totale')) {
      conti = {
        tipo: 'arrivo', t: t, valore: valore, barra: barra, etichetta: t.querySelector('[data-isp-eti-testo]'),
        fine: adesso + numero(t, 'data-secondi') * 1000, totale: Math.max(1, numero(t, 'data-totale')), arrivato: t.classList.contains('arrivato'),
      };
    }
    tickConti();
  }
  function tickConti() {
    if (!conti) return;
    const adesso = Date.now();
    if (conti.tipo === 'conferma') {
      const sec = Math.max(0, Math.ceil((conti.fine - adesso) / 1000));
      scrivi(conti.valore, sec > 0 ? mmss(sec) : 'Scaduto');
      larghezza(conti.barra, sec / conti.finestra);
      conti.t.classList.toggle('urgente', sec <= sogliaUrgente);
      if (sec === 0 && !scadenzaVista) {
        // Scaduta: i pulsanti si spengono subito, poi si rilegge (il server dirà che la richiesta è chiusa).
        scadenzaVista = true;
        contenuto.querySelectorAll('[data-isp-azione]').forEach(function (b) { b.disabled = true; });
        setTimeout(carica, 1500);
      }
    } else if (conti.tipo === 'corriere') {
      scrivi(conti.valore, Minuteria.tempoTrascorso((adesso - conti.inizio) / 1000));
    } else if (conti.tipo === 'arrivo') {
      const sec = Math.max(0, Math.ceil((conti.fine - adesso) / 1000));
      scrivi(conti.valore, mmss(sec));
      larghezza(conti.barra, 1 - sec / conti.totale);
      const arrivato = sec <= 0;
      if (arrivato !== conti.arrivato) {
        conti.arrivato = arrivato;
        conti.t.classList.toggle('arrivato', arrivato);
        scrivi(conti.etichetta, arrivato ? 'Corriere arrivato al banco' : 'Corriere in arrivo tra');
      }
    }
  }

  // ----- Contenuto -----
  // Un pezzo di pagina per i casi in cui il server non dà il contenuto (lavoro sparito, rete giù): stessa forma del vero, con "Chiudi".
  function messaggio(titolo, testo) {
    const radice = document.createElement('div');
    radice.className = 'isp isp-chiuso';
    radice.setAttribute('data-isp', '');
    radice.setAttribute('data-isp-fase', 'chiuso');
    radice.setAttribute('data-isp-firma', 'messaggio:' + titolo + ':' + testo);
    const testa = document.createElement('div');
    testa.className = 'isp-testa';
    const h = document.createElement('h2');
    h.className = 'isp-titolo';
    h.id = 'isp-titolo';
    h.textContent = titolo;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'isp-x';
    x.setAttribute('data-isp-chiudi', '');
    x.setAttribute('aria-label', 'Chiudi');
    x.textContent = '×';
    testa.appendChild(h);
    testa.appendChild(x);
    const p = document.createElement('p');
    p.className = 'isp-avviso';
    p.setAttribute('role', 'status');
    p.textContent = testo;
    const azioni = document.createElement('div');
    azioni.className = 'isp-azioni';
    const chiudiBtn = document.createElement('button');
    chiudiBtn.type = 'button';
    chiudiBtn.className = 'btn-banco btn-banco-secondario';
    chiudiBtn.setAttribute('data-isp-chiudi', '');
    chiudiBtn.textContent = 'Chiudi';
    azioni.appendChild(chiudiBtn);
    radice.appendChild(testa);
    radice.appendChild(p);
    radice.appendChild(azioni);
    return radice;
  }

  // Mette un contenuto nel pannello (se è diverso da quello che c'è) e, se il fuoco era in un pezzo sparito, lo porta sul pannello.
  function monta(radice) {
    const firmaNuova = radice.getAttribute('data-isp-firma');
    if (contenuto && contenuto.getAttribute('data-isp-firma') === firmaNuova) return; // uguale: i conti continuano
    const fuocoDentro = pannello.contains(document.activeElement);
    const idFuoco = fuocoDentro && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-isp-azione') : null;
    while (pannello.firstChild) pannello.removeChild(pannello.firstChild);
    pannello.appendChild(radice);
    contenuto = radice;
    preparaConti();
    // Il fuoco: se era su un pulsante che esiste ancora (stessa azione) ci torna, altrimenti va al pannello (che ha il titolo come nome).
    let rimesso = null;
    if (idFuoco) rimesso = pannello.querySelector('[data-isp-azione="' + idFuoco + '"]');
    if (rimesso) rimesso.focus();
    else if (!fuocoDentro || !pannello.contains(document.activeElement)) pannello.focus();
  }

  // Rilegge il contenuto del lavoro aperto dal server. `primo` = la prima lettura dopo l'apertura (un errore si dice; poi si ignora e si riprova).
  function carica(primo) {
    if (!chiave) return Promise.resolve();
    const mia = ++richiestaN;
    const k = chiave;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const scade = setTimeout(function () { if (ac) ac.abort(); }, 8000);
    return fetch('/distributore/ispeziona/' + encodeURIComponent(k), { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'text/html' }, signal: ac ? ac.signal : undefined })
      .then(function (r) {
        clearTimeout(scade);
        if (mia !== richiestaN || k !== chiave) return;
        if (r.status === 401 || r.redirected) { window.location.reload(); return; }
        if (r.status === 404) { monta(messaggio('Ordine non trovato', 'Questo ordine non è più disponibile.')); return; }
        if (!r.ok) throw new Error('lettura ' + r.status);
        return r.text().then(function (html) {
          if (mia !== richiestaN || k !== chiave) return;
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const radice = doc.querySelector('[data-isp]');
          if (!radice) throw new Error('contenuto vuoto');
          monta(document.importNode(radice, true));
        });
      })
      .catch(function () {
        clearTimeout(scade);
        if (mia === richiestaN && k === chiave && primo) monta(messaggio('Ordine non caricato', 'Non riesco a leggere l\'ordine: controlla la connessione e riprova.'));
      });
  }

  // ----- Apertura e chiusura -----
  function sfondo(inerte) {
    document.querySelectorAll(SFONDO).forEach(function (el) {
      if (inerte) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });
  }

  function apri(k, da) {
    chiave = k;
    apertoDa = da || null;
    contenuto = null;
    conti = null;
    inAzione = false;
    while (pannello.firstChild) pannello.removeChild(pannello.firstChild);
    overlay.hidden = false;
    document.body.classList.add('isp-aperto');
    sfondo(true);
    pannello.focus();
    clearInterval(intervalloConti);
    clearInterval(intervalloSicurezza);
    intervalloConti = setInterval(tickConti, 1000);
    intervalloSicurezza = setInterval(function () { if (!document.hidden) carica(); }, 10000);
    carica(true);
  }

  function chiudi() {
    if (!chiave) return;
    const k = chiave;
    chiave = null;
    richiestaN++;
    clearInterval(intervalloConti);
    clearInterval(intervalloSicurezza);
    overlay.hidden = true;
    document.body.classList.remove('isp-aperto');
    sfondo(false);
    while (pannello.firstChild) pannello.removeChild(pannello.firstChild);
    contenuto = null;
    conti = null;
    // Il fuoco torna al pulsante che ha aperto il popup; se la scheda è stata sostituita (il lavoro è passato in un'altra colonna) si cerca quella nuova.
    let torna = apertoDa && document.contains(apertoDa) ? apertoDa : null;
    if (!torna) {
      const scheda = bacheca.querySelector('[data-lavoro="' + k + '"] [data-ispeziona]');
      torna = scheda || null;
    }
    if (torna) torna.focus();
    apertoDa = null;
  }

  // ----- Azioni dal popup -----
  function azione(bottone) {
    if (inAzione) return;
    const tipo = bottone.getAttribute('data-isp-azione');
    const url = bottone.getAttribute('data-isp-url');
    const corpo = bottone.getAttribute('data-isp-corpo') || '';
    const errore = contenuto ? contenuto.querySelector('[data-isp-errore]') : null;
    const bottoni = Array.prototype.slice.call(pannello.querySelectorAll('[data-isp-azione]'));
    inAzione = true;
    bottoni.forEach(function (b) { b.disabled = true; });
    if (errore) errore.hidden = true;
    fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: corpo,
    })
      .then(function (r) {
        if (r.status === 401) { window.location.href = '/login'; throw Object.assign(new Error('sessione scaduta'), { sessioneScaduta: true }); }
        return r.json().catch(function () { return null; });
      })
      .then(function (d) {
        inAzione = false;
        if (d && d.ok) {
          // La bacheca si aggiorna subito (la scheda cambia colonna o sparisce). "Accetta ordine" lascia il popup aperto, che passa alla fase dopo; le altre lo chiudono.
          const aggiorna = Minuteria.homeBanco ? Minuteria.homeBanco.rinfresca() : Promise.resolve(false);
          if (tipo === 'accetta') {
            aggiorna.then(function (ok) { if (!ok) window.location.reload(); else carica(); });
          } else {
            chiudi();
            aggiorna.then(function (ok) { if (!ok) window.location.reload(); });
          }
          return;
        }
        // Non è andata (un collega ha già risposto, tempo scaduto...): si dice perché, si riabilitano i pulsanti e si rilegge lo stato vero.
        bottoni.forEach(function (b) { b.disabled = false; });
        if (errore) { errore.textContent = (d && d.errore) || 'Non sono riuscito a completare l\'azione. Riprova.'; errore.hidden = false; }
        carica();
      })
      .catch(function (err) {
        inAzione = false;
        if (err && err.sessioneScaduta) return;
        bottoni.forEach(function (b) { b.disabled = false; });
        if (errore) { errore.textContent = 'Non riesco a collegarmi: controlla la connessione e riprova.'; errore.hidden = false; }
      });
  }

  // ----- Eventi -----
  // Il pulsante "Ispeziona" di ogni scheda (un collegamento alla pagina vera: con Ctrl/Cmd/Maiusc o il tasto centrale funziona come un collegamento).
  bacheca.addEventListener('click', function (e) {
    const a = e.target.closest ? e.target.closest('[data-ispeziona]') : null;
    if (!a || !bacheca.contains(a)) return;
    if (e.defaultPrevented || e.button > 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    apri(a.getAttribute('data-ispeziona'), a);
  });

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) { chiudi(); return; }
    const chiudiBtn = e.target.closest ? e.target.closest('[data-isp-chiudi]') : null;
    if (chiudiBtn && pannello.contains(chiudiBtn)) { chiudi(); return; }
    const azioneBtn = e.target.closest ? e.target.closest('[data-isp-azione]') : null;
    if (azioneBtn && pannello.contains(azioneBtn)) azione(azioneBtn);
  });

  document.addEventListener('keydown', function (e) {
    if (!chiave) return;
    if (e.key === 'Escape') { e.preventDefault(); chiudi(); return; }
    if (e.key !== 'Tab') return;
    // Il fuoco gira dentro il popup: dall'ultimo elemento al primo e viceversa.
    const lista = Array.prototype.filter.call(pannello.querySelectorAll(FOCUSABILI), function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!lista.length) { e.preventDefault(); pannello.focus(); return; }
    const primo = lista[0];
    const ultimo = lista[lista.length - 1];
    if (e.shiftKey && (document.activeElement === primo || document.activeElement === pannello)) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
    else if (!pannello.contains(document.activeElement)) { e.preventDefault(); primo.focus(); }
  });

  // La bacheca è cambiata (una richiesta passata di colonna, un ordine uscito...): il popup rilegge il suo lavoro e, se la fase è cambiata, cambia con lei.
  window.addEventListener('minuteria:bacheca', function () { if (chiave) carica(); });
})();
