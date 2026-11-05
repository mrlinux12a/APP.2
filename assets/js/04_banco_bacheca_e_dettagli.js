/* Home del banco (bacheca a 3 colonne, views/banco/richieste.ejs): fa muovere timer ed etichette a tempo.
   Ogni valore parte da quanti secondi mancano (o sono passati) quando il server ha disegnato la pagina, trasformati
   in un istante con l'orologio del browser: un conteggio non perde colpi se la scheda resta in secondo piano (i
   timer delle schede nascoste vengono rallentati) e l'orologio del PC, magari sfasato, non conta.
   - richiesta da confermare: anello che si svuota e mm:ss; rosso negli ultimi minuti (data-soglia-urgente); etichetta
     "Nuova" per i primi minuti; allo scadere la scheda si spegne e la pagina si ricarica (la richiesta non c'è più);
   - corriere avvisato: "da N min", da quando il banco ha confermato;
   - ordine da preparare: solo i minuti che mancano al ritiro del corriere, sempre in verde (niente orario, niente rosso: richiesta esplicita del 21/10/2026).
   La soglia della richiesta da confermare la scrive il server (BACHECA in server.js): la stessa che ha usato per le classi iniziali. */
(function () {
  'use strict';
  const bacheca = document.querySelector('[data-bacheca]');
  if (!bacheca) return;

  const sogliaUrgente = parseInt(bacheca.getAttribute('data-soglia-urgente'), 10) || 180;

  function numero(el, nome) {
    const n = parseInt(el.getAttribute(nome), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function mmss(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  // "8 min", "1 h 05": uguale a durata() nella vista (e a quello del dettaglio della richiesta).
  const durata = Minuteria.durataMinuti;

  // Scrive solo se il testo cambia: ogni secondo si controllano tutte le schede, ma il DOM si tocca di rado.
  function scrivi(el, testo) {
    if (el && el.textContent !== testo) el.textContent = testo;
  }

  // Gli istanti di ogni scheda si calcolano la PRIMA volta che la si vede, dai secondi scritti dal server, e da lì restano: la bacheca si aggiorna sul posto
  // (`rinfresca`, più sotto) e le schede che c'erano già continuano il loro conto invece di ripartire.
  const stati = new WeakMap();
  function statoRichiesta(el, adesso) {
    let r = stati.get(el);
    if (!r) {
      const anello = el.querySelector('[data-anello]');
      r = {
        anello: anello,
        circ: anello ? parseFloat(anello.getAttribute('stroke-dasharray')) : 0,
        tempo: el.querySelector('[data-tempo]'),
        nuova: el.querySelector('[data-nuova]'),
        fine: adesso + numero(el, 'data-secondi') * 1000,
        finestra: Math.max(1, numero(el, 'data-finestra')),
        nuovaFine: adesso + numero(el, 'data-nuova-sec') * 1000,
        chiusa: false,
      };
      stati.set(el, r);
    }
    return r;
  }
  function statoCorriere(el, adesso) {
    let c = stati.get(el);
    if (!c) {
      c = { da: el.querySelector('[data-da]'), inizio: adesso - numero(el, 'data-trascorsi') * 1000 };
      stati.set(el, c);
    }
    return c;
  }
  function statoArrivo(el, adesso) {
    let a = stati.get(el);
    if (!a) {
      a = { min: el.querySelector('[data-arrivo-min]'), fine: adesso + numero(el, 'data-secondi') * 1000 };
      stati.set(el, a);
    }
    return a;
  }

  function tick() {
    const adesso = Date.now();

    bacheca.querySelectorAll('[data-richiesta]').forEach(function (el) {
      const r = statoRichiesta(el, adesso);
      const sec = Math.max(0, Math.ceil((r.fine - adesso) / 1000));
      scrivi(r.tempo, mmss(sec));
      if (r.anello) r.anello.style.strokeDashoffset = String((r.circ * (1 - Math.min(1, sec / r.finestra))).toFixed(2));
      el.classList.toggle('urgente', sec <= sogliaUrgente);
      if (r.nuova && adesso >= r.nuovaFine) {
        r.nuova.remove();
        r.nuova = null;
      }
      if (sec === 0 && !r.chiusa) {
        // La richiesta è scaduta: sparirà dalla colonna aggiornando la bacheca (lo farebbe da solo anche il controllo ogni 5 secondi, ma così la scheda non resta
        // lì a contare zero). Se l'aggiornamento sul posto non riesce si ricarica la pagina.
        r.chiusa = true;
        el.classList.remove('urgente');
        el.classList.add('scaduta');
        setTimeout(function () { rinfresca().then(function (ok) { if (!ok) window.location.reload(); }); }, 2500);
      }
    });

    bacheca.querySelectorAll('[data-corriere]').forEach(function (el) {
      const c = statoCorriere(el, adesso);
      scrivi(c.da, Minuteria.daMinuti((adesso - c.inizio) / 1000));
    });

    bacheca.querySelectorAll('[data-arrivo]').forEach(function (el) {
      const a = statoArrivo(el, adesso);
      const min = Math.ceil((a.fine - adesso) / 60000);
      scrivi(a.min, min <= 0 ? 'In ritardo' : durata(min));
    });
  }

  // ----- Aggiornamento sul posto -----
  // Quando arriva una richiesta (o cambia qualcosa) la bacheca NON si ricarica più: si chiede al server la stessa pagina, se ne prendono le tre colonne e si
  // aggiungono, tolgono e riordinano le sole schede cambiate (ognuna ha la sua `data-chiave`). Così la scheda compare subito, insieme al suono e al numero sul
  // tab "Banco" (prima il suono e il numero arrivavano e la scheda aspettava il giro di controllo e la ricarica: "arriva prima il suono e il numeretto rispetto alla
  // card", richiesta esplicita del 21/10/2026), e la pagina non riparte da zero: l'audio resta sbloccato, lo scorrimento delle colonne e il conto delle altre
  // schede non si perdono. Ritorna una promessa: true se la bacheca è aggiornata, false se non si è riusciti (chi chiama ricarica la pagina).
  let puntatoreGiu = false;
  document.addEventListener('pointerdown', function () { puntatoreGiu = true; }, true);
  ['pointerup', 'pointercancel', 'dragend'].forEach(function (nome) {
    document.addEventListener(nome, function () { puntatoreGiu = false; }, true);
  });
  // Se in quel momento si sta premendo su una scheda (il clic su "Conferma" è a metà) si aspetta il rilascio: cambiare le schede sotto il dito farebbe perdere il clic.
  function attendiPuntatore() {
    const limite = Date.now() + 2500;
    return new Promise(function (ok) {
      const prova = function () { if (!puntatoreGiu || Date.now() > limite) ok(); else setTimeout(prova, 100); };
      if (puntatoreGiu) setTimeout(prova, 150); else ok();
    });
  }

  function daiServer() {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const scade = setTimeout(function () { if (ac) ac.abort(); }, 8000);
    return fetch(window.location.pathname + window.location.search, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'text/html' }, signal: ac ? ac.signal : undefined })
      .then(function (r) { clearTimeout(scade); return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) return null;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Una pagina senza bacheca (sessione scaduta: è la pagina di accesso) non si usa: chi chiama ricarica e il browser arriva dove deve.
        return doc.querySelector('[data-bacheca]') ? doc : null;
      })
      .catch(function () { clearTimeout(scade); return null; });
  }

  // Una colonna: il numero, le schede (le stesse restano, le nuove entrano, quelle che non ci sono più escono, l'ordine è quello del server) e la frase "Nessuna…".
  function riallineaColonna(vecchia, nuova) {
    const listaV = vecchia.querySelector('.colonna-lista');
    const listaN = nuova.querySelector('.colonna-lista');
    if (!listaV || !listaN) return;
    const contaV = vecchia.querySelector('.colonna-conta');
    const contaN = nuova.querySelector('.colonna-conta');
    if (contaV && contaN) {
      contaV.textContent = contaN.textContent;
      contaV.setAttribute('aria-label', contaN.getAttribute('aria-label') || '');
    }
    const esistenti = new Map();
    listaV.querySelectorAll('[data-chiave]').forEach(function (el) { esistenti.set(el.getAttribute('data-chiave'), el); });
    const volute = Array.prototype.slice.call(listaN.querySelectorAll('[data-chiave]'));
    const chiaviVolute = new Set(volute.map(function (el) { return el.getAttribute('data-chiave'); }));
    esistenti.forEach(function (el, chiave) { if (!chiaviVolute.has(chiave)) el.remove(); });

    const vuotoV = listaV.querySelector('.colonna-vuota');
    const vuotoN = listaN.querySelector('.colonna-vuota');
    if (volute.length) {
      if (vuotoV) vuotoV.remove();
    } else if (!vuotoV && vuotoN) {
      listaV.appendChild(document.importNode(vuotoN, true));
    }

    // Si scorre l'ordine voluto con un cursore sulla lista vecchia: la scheda giusta è già lì (si va avanti), altrimenti la si mette (nuova) o la si sposta (già nella lista).
    let cursore = listaV.querySelector('[data-chiave]');
    volute.forEach(function (voluta) {
      const chiave = voluta.getAttribute('data-chiave');
      let nodo = esistenti.get(chiave);
      if (!nodo) {
        nodo = document.importNode(voluta, true);
        nodo.classList.add('entra'); // anche le schede che arrivano da una colonna all'altra entrano con la loro animazione (quella di sempre: .scheda.entra)
      }
      if (nodo === cursore) {
        cursore = cursore.nextElementSibling;
        while (cursore && !cursore.hasAttribute('data-chiave')) cursore = cursore.nextElementSibling;
      } else {
        listaV.insertBefore(nodo, cursore);
      }
    });
  }

  let rinfrescoInCorso = null;
  let rinfrescoDaRifare = false;
  function rinfresca() {
    if (rinfrescoInCorso) { rinfrescoDaRifare = true; return rinfrescoInCorso; }
    rinfrescoInCorso = daiServer().then(function (doc) {
      if (!doc) return false;
      return attendiPuntatore().then(function () {
        const nuovo = doc.querySelector('[data-bacheca]');
        ['conferma', 'corriere', 'preparare'].forEach(function (nome) {
          const vecchia = bacheca.querySelector('.colonna-' + nome);
          const nuova = nuovo.querySelector('.colonna-' + nome);
          if (vecchia && nuova) riallineaColonna(vecchia, nuova);
        });
        // I numeri con cui la pagina è stata disegnata: la prossima verifica (blocco "Pagine del banco") non deve vedere una differenza e rifare tutto.
        const versione = doc.body ? doc.body.getAttribute('data-versione') : null;
        if (versione) document.body.setAttribute('data-versione', versione);
        // Il menu in basso (telefono) ha i suoi numeri.
        const navNuovo = doc.querySelector('nav.navbar');
        const navVecchio = document.querySelector('nav.navbar');
        if (navNuovo && navVecchio) navVecchio.innerHTML = navNuovo.innerHTML;
        tick(); // le schede nuove prendono subito il loro conto
        // Il numero sul tab "Banco" si allinea alle schede nello stesso istante (lo ascolta il blocco "Avvisi del banco").
        const daConfermare = bacheca.querySelectorAll('.colonna-conferma [data-richiesta]').length;
        window.dispatchEvent(new CustomEvent('minuteria:bacheca', { detail: { daConfermare: daConfermare } }));
        return true;
      });
    }).catch(function () { return false; }).then(function (ok) {
      rinfrescoInCorso = null;
      if (rinfrescoDaRifare) { rinfrescoDaRifare = false; rinfresca(); }
      return ok;
    });
    return rinfrescoInCorso;
  }
  Minuteria.homeBanco = { rinfresca: rinfresca };

  tick();
  setInterval(tick, 1000);
})();

/* Dettaglio di una richiesta al banco (views/banco/dettaglio.ejs). Due tempi, in due stati diversi:
   - "Da confermare": il timer con l'anello che si svuota (qui sotto). Come sulla home
   parte da quanti secondi mancano quando il server ha disegnato la pagina, trasformati in un istante con l'orologio del
   browser (un conteggio non perde colpi se la scheda resta in secondo piano). Negli ultimi data-soglia-urgente secondi (2
   minuti) anello e tempo passano dall'arancio al rosso; a zero la pagina si ricarica per mostrare che la richiesta è scaduta.
   - "Attesa corriere": il tempo da quando il banco ha confermato SALE (cerchio mm:ss, "1 h 05" oltre l'ora, e "da N min" nel passo
     in corso). Parte dai secondi trascorsi (data-trascorsi, calcolati dal server in SQL come per la home) e li trasforma in un istante
     col Date.now() del browser; i testi sono quelli di Minuteria (gli stessi di "Corriere avvisato · da N min" sulla home). */
(function () {
  'use strict';
  const attesa = document.querySelector('[data-ric-attesa]');
  if (attesa) {
    const inizio = Date.now() - (parseInt(attesa.getAttribute('data-trascorsi'), 10) || 0) * 1000;
    const cerchio = attesa.querySelector('[data-trascorso]');
    const da = document.querySelectorAll('[data-da]');
    const aggiorna = function () {
      const secondi = Math.max(0, (Date.now() - inizio) / 1000);
      const tempo = Minuteria.tempoTrascorso(secondi);
      if (cerchio && cerchio.textContent !== tempo) cerchio.textContent = tempo;
      const testo = Minuteria.daMinuti(secondi);
      da.forEach(function (el) { if (el.textContent !== testo) el.textContent = testo; });
    };
    aggiorna();
    setInterval(aggiorna, 1000);
  }

  // "Da preparare": minuti all'arrivo del corriere (come la pillola della home), rossi sotto la soglia; "In ritardo" a zero.
  const arrivo = document.querySelector('[data-ric-arrivo]');
  if (arrivo) {
    const min = arrivo.querySelector('[data-arrivo-min]');
    const fineArrivo = Date.now() + (parseInt(arrivo.getAttribute('data-secondi'), 10) || 0) * 1000;
    const sogliaArrivo = parseInt(arrivo.getAttribute('data-soglia-arrivo'), 10) || 15;
    const aggiornaArrivo = function () {
      const minuti = Math.ceil((fineArrivo - Date.now()) / 60000);
      const testo = minuti <= 0 ? 'In ritardo' : Minuteria.durataMinuti(minuti);
      if (min && min.textContent !== testo) min.textContent = testo;
      arrivo.classList.toggle('vicino', minuti <= sogliaArrivo);
    };
    aggiornaArrivo();
    setInterval(aggiornaArrivo, 1000);
  }

  const timer = document.querySelector('[data-ric-timer]');
  if (!timer) return;
  const tempo = timer.querySelector('[data-tempo]');
  const anello = timer.querySelector('[data-anello]');
  const circ = anello ? parseFloat(anello.getAttribute('stroke-dasharray')) : 0;

  function numero(nome) {
    const n = parseInt(timer.getAttribute(nome), 10);
    return Number.isFinite(n) ? n : 0;
  }

  const fine = Date.now() + numero('data-secondi') * 1000;
  const finestra = Math.max(1, numero('data-finestra'));
  const soglia = numero('data-soglia-urgente') || 120;
  let chiusa = false;

  function tick() {
    const sec = Math.max(0, Math.ceil((fine - Date.now()) / 1000));
    const testo = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    if (tempo && tempo.textContent !== testo) tempo.textContent = testo;
    if (anello) anello.style.strokeDashoffset = String((circ * (1 - Math.min(1, sec / finestra))).toFixed(2));
    timer.classList.toggle('urgente', sec <= soglia);
    if (sec === 0 && !chiusa) {
      chiusa = true;
      setTimeout(function () { window.location.reload(); }, 2500);
    }
  }

  tick();
  setInterval(tick, 1000);
})();

/* Pagina dell'ordine del banco (views/banco/ordine.ejs): "Stampa" (in stampa la pagina mostra solo testata e materiale, vedi @media print di style.css;
   c'è solo dopo la partenza dell'ordine). */
(function () {
  'use strict';
  const pagina = document.querySelector('[data-ordine-banco]');
  if (!pagina) return;

  const stampa = pagina.querySelector('[data-stampa]');
  if (stampa) stampa.addEventListener('click', function () { window.print(); });
})();

