(function () {
  'use strict';

  const { QUANTITA_MASSIMA, limitaQuantita, leggiJson, mostraNotifica, pushDisponibile, iscriviPush, disiscriviPush, eIos, eInstallata } = Minuteria;

  // ---------- Selettore quantità (+ / -) e Aggiungi globale ----------
  function aggiornaBadgeCarrello(pezzi) {
    const badge = document.querySelector('[data-nav-badge]');
    if (badge) {
      if (pezzi > 0) { badge.textContent = pezzi; badge.removeAttribute('hidden'); }
      else badge.setAttribute('hidden', '');
    }
    const wrap = document.querySelector('[data-carrello-wrap]');
    const vuoto = document.querySelector('[data-carrello-vuoto]');
    const conta = document.querySelector('[data-carrello-conta]');
    const vai = document.querySelector('[data-vai-carrello]');
    if (conta) conta.textContent = pezzi;
    if (wrap) { if (pezzi > 0) wrap.removeAttribute('hidden'); else wrap.setAttribute('hidden',''); }
    if (vuoto) { if (pezzi > 0) vuoto.setAttribute('hidden',''); else vuoto.removeAttribute('hidden'); }
    if (vai) { if (pezzi > 0) vai.removeAttribute('hidden'); else vai.setAttribute('hidden',''); }
    ricalcolaBarra();
  }

  function aggiornaMiniCard(prodottoId, qty) {
    const card = document.querySelector('[data-nel-carrello="' + prodottoId + '"]');
    if (!card) return;
    const num = card.querySelector('[data-qta-carrello]');
    if (num) num.textContent = qty;
    if (qty > 0) card.removeAttribute('hidden');
    else card.setAttribute('hidden','');
  }

  // ---------- Quantità scelte e non ancora aggiunte ----------
  // Il + del catalogo scrive solo nel campo della card: il carrello cambia quando si preme "Aggiungi". Cambiando pagina il campo
  // tornava a 0 e le scelte si perdevano. Ora stanno in `scelte` ({ id prodotto: quantità }) e si copiano in sessionStorage (una scheda
  // del browser, un utente: la chiave porta il suo id), da cui si rimettono nei campi a ogni pagina, ricerca o scroll infinito.
  // Il conto "N selezionati" e il pulsante "Aggiungi (N)" guardano `scelte`, non i campi: valgono anche per le card non in vista.
  // Senza sessionStorage (navigazione privata, blocco) le scelte restano per la sola pagina aperta, come prima.
  const SCELTE_SCADENZA_MS = 12 * 3600 * 1000;
  const metaUtente = document.querySelector('meta[name="utente"]');
  const chiaveScelte = 'minuteria.scelte.' + (metaUtente ? metaUtente.content : '');

  function leggiScelteSalvate() {
    const out = {};
    try {
      const grezzo = JSON.parse(window.sessionStorage.getItem(chiaveScelte) || 'null');
      if (!grezzo || typeof grezzo.q !== 'object' || !grezzo.q || Date.now() - (Number(grezzo.t) || 0) > SCELTE_SCADENZA_MS) return out;
      Object.keys(grezzo.q).forEach(function (id) {
        const n = limitaQuantita(parseInt(grezzo.q[id], 10) || 0);
        if (n > 0 && /^\d+$/.test(id)) out[id] = n;
      });
    } catch (err) { /* storage assente o contenuto non valido: si riparte vuoti */ }
    return out;
  }

  let scelte = leggiScelteSalvate();

  function salvaScelte() {
    try {
      if (Object.keys(scelte).length) window.sessionStorage.setItem(chiaveScelte, JSON.stringify({ t: Date.now(), q: scelte }));
      else window.sessionStorage.removeItem(chiaveScelte);
    } catch (err) { /* resta solo in questa pagina */ }
  }

  function impostaScelta(id, qta) {
    if (!id) return;
    const n = limitaQuantita(parseInt(qta, 10) || 0);
    if (n > 0) scelte[id] = n; else delete scelte[id];
    salvaScelte();
  }

  // Rimette nei campi di `radice` le quantità scelte. Con `azzera` anche chi non ha una scelta torna a 0 (tornando con "indietro" la
  // pagina può riapparire con i campi di prima: vale quello che c'è in memoria ora).
  function applicaScelte(radice, azzera) {
    (radice || document).querySelectorAll('input[data-qta]').forEach(function (inp) {
      const id = inp.getAttribute('data-prodotto-qta');
      if (id in scelte) inp.value = scelte[id];
      else if (azzera) inp.value = 0;
    });
  }

  function ricalcolaBarra() {
    let pendenti = 0;
    Object.keys(scelte).forEach(function (id) { pendenti += scelte[id]; });
    const wrap = document.querySelector('[data-pendenti-wrap]');
    const num = document.querySelector('[data-pendenti]');
    const sep = document.querySelector('[data-sep-pendenti]');
    const barra = document.querySelector('[data-barra-carrello]');
    const btn = document.querySelector('[data-aggiungi-tutti]');
    const badge = document.querySelector('[data-nav-badge]');
    const carrelloPezzi = badge && !badge.hasAttribute('hidden') ? parseInt(badge.textContent,10)||0 : 0;
    // pendenti count
    if (wrap) { if (pendenti > 0) { wrap.removeAttribute('hidden'); if(num) num.textContent = pendenti; } else wrap.setAttribute('hidden',''); }
    if (sep) {
      const carrelloVis = document.querySelector('[data-carrello-wrap]') && !document.querySelector('[data-carrello-wrap]').hasAttribute('hidden');
      if (pendenti > 0 && carrelloVis) sep.removeAttribute('hidden'); else sep.setAttribute('hidden','');
    }
    if (btn) {
      btn.disabled = pendenti === 0;
      btn.textContent = pendenti > 0 ? 'Aggiungi (' + pendenti + ')' : 'Aggiungi';
    }
    if (barra) {
      if (pendenti > 0 || carrelloPezzi > 0) barra.removeAttribute('hidden');
      else barra.setAttribute('hidden','');
    }
  }

  // Stepper catalogo (+/-)
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-passo]');
    if (!btn) return;
    e.preventDefault();
    const stepper = btn.closest('.stepper');
    const input = stepper ? stepper.querySelector('input[data-qta]') : btn.parentElement.querySelector('input[type="number"]');
    if (!input) return;
    const passo = parseInt(btn.dataset.passo, 10);
    input.value = limitaQuantita((parseInt(input.value, 10) || 0) + passo);
    impostaScelta(input.getAttribute('data-prodotto-qta'), input.value);
    ricalcolaBarra();
  });

  document.addEventListener('input', function (e) {
    if (!e.target.matches('input[data-qta]')) return;
    impostaScelta(e.target.getAttribute('data-prodotto-qta'), e.target.value);
    ricalcolaBarra();
  });

  // Le scelte di prima (altra pagina, altra ricerca) tornano nei campi di questa pagina.
  applicaScelte(document);
  ricalcolaBarra();
  // Pagina rimostrata dal tasto "indietro" (bfcache) o tornata in primo piano: le scelte vere sono quelle salvate, che un'altra pagina
  // può aver cambiato nel frattempo.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    scelte = leggiScelteSalvate();
    applicaScelte(document, true);
    ricalcolaBarra();
  });

  // Click Aggiungi globale -> raccoglie tutti gli stepper con qty>0 e invia batch
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-aggiungi-tutti]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    // Si aggiunge tutto quello che è stato scelto, anche nelle card che non sono in questa pagina (altra ricerca, pagina precedente).
    const inviati = Object.keys(scelte).map(function (id) { return { id: id, qty: scelte[id] }; });
    const items = inviati.filter(function (v) { return v.qty > 0; });
    if (!items.length) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    fetch('/api/carrello/aggiungi-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
    })
      .then(leggiJson)
      .then(function (d) {
        if (!d.ok) throw new Error(d.errore || 'errore');
        // Aggiunto: le scelte non ci sono più (né in memoria né salvate) e tutti gli stepper tornano a 0.
        items.forEach(function (v) { delete scelte[v.id]; });
        salvaScelte();
        document.querySelectorAll('input[data-qta]').forEach(function (inp) { inp.value = 0; });
        // aggiorna mini-card per ogni prodotto aggiunto
        Object.keys(d.aggiornati || {}).forEach(function (pid) { aggiornaMiniCard(pid, d.aggiornati[pid]); });
        // fallback: se il server non ha rimandato tutti, usa carrello
        if (d.carrello) Object.keys(d.carrello).forEach(function (pid) { if (!(pid in (d.aggiornati||{}))) aggiornaMiniCard(pid, d.carrello[pid]); });
        aggiornaBadgeCarrello(d.pezzi);
        ricalcolaBarra();
        btn.textContent = 'Aggiunto ✓';
        setTimeout(function () { ricalcolaBarra(); }, 900);
      })
      .catch(function (err) {
        btn.textContent = old;
        btn.disabled = false;
        if (err && err.sessioneScaduta) return;
        window.alert('Non è stato possibile aggiungere al carrello.');
      });
  });

  // ---------- Carrello: modifica quantità e rimozione ----------
  // Più tocchi ravvicinati su + e − fanno un solo salvataggio. Le quantità si mandano una alla volta: richieste in parallelo sulla
  // stessa sessione si sovrascriverebbero a vicenda. Dopo il salvataggio la pagina NON si ricarica: /api/carrello/imposta restituisce
  // già i totali (`riepilogo`: ogni voce in testo con le chiavi dei `[data-riep]`, e `totali_righe`), e `aggiornaCarrelloDa` riscrive
  // le voci dei due riquadri "Cosa paghi e a chi", i totali di riga, l'avviso dell'ordine minimo, il pulsante e la barra. Senza quella
  // risposta (errore, vecchia pagina) o togliendo una riga si ricarica come prima.
  function aggiornaCarrelloDa(d) {
    if (!d || !d.riepilogo || typeof d.riepilogo !== 'object') return false;
    const r = d.riepilogo;
    Object.keys(r).forEach(function (chiave) {
      if (typeof r[chiave] !== 'string') return;
      document.querySelectorAll('[data-riep="' + chiave + '"]').forEach(function (el) { el.textContent = r[chiave]; });
    });
    document.querySelectorAll('[data-riga-raee]').forEach(function (el) { el.hidden = !r.con_raee; });
    document.querySelectorAll('[data-minimo-avviso]').forEach(function (el) { el.hidden = !!r.raggiunto; });
    // Con il banco chiuso (orari) il pulsante resta spento qualunque sia il carrello.
    document.querySelectorAll('[data-btn-paga]').forEach(function (el) { el.disabled = !r.raggiunto || el.hasAttribute('data-banco-chiuso'); });
    const righe = d.totali_righe || {};
    Object.keys(righe).forEach(function (id) {
      document.querySelectorAll('[data-totale-riga="' + id + '"]').forEach(function (el) { el.textContent = '€ ' + righe[id]; });
    });
    return true;
  }

  const quantitaDaSalvare = {};
  let timerSalvataggioCarrello = null;
  function programmaSalvataggioCarrello(id, qty) {
    quantitaDaSalvare[id] = qty;
    clearTimeout(timerSalvataggioCarrello);
    timerSalvataggioCarrello = setTimeout(function () {
      const voci = Object.keys(quantitaDaSalvare).map(function (k) { return { id: k, qty: quantitaDaSalvare[k] }; });
      Object.keys(quantitaDaSalvare).forEach(function (k) { delete quantitaDaSalvare[k]; });
      let ultima = null; // l'ultima risposta: ha i totali con TUTTE le quantità salvate
      voci
        .reduce(function (catena, voce) {
          return catena.then(function () {
            return fetch('/api/carrello/imposta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(voce),
            })
              .then(leggiJson)
              .then(function (d) {
                if (d && typeof d.pezzi === 'number') aggiornaBadgeCarrello(d.pezzi);
                ultima = d;
              });
          });
        }, Promise.resolve())
        .then(function () { return aggiornaCarrelloDa(ultima); }, function () { return false; })
        .then(function (aggiornato) { if (!aggiornato && !invioCarrelloInCorso) window.location.reload(); });
    }, 400);
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-passo-carrello]');
    if (!btn) return;
    e.preventDefault();
    const stepper = btn.closest('[data-stepper-carrello]');
    const id = stepper ? stepper.getAttribute('data-stepper-carrello') : null;
    const input = document.querySelector('[data-qta-carrello-input="' + id + '"]');
    if (!input || !id) return;
    const passo = parseInt(btn.dataset.passoCarrello, 10);
    // Nel carrello il minimo è 1: per togliere del tutto una riga c'è il pulsante
    // "Rimuovi" dedicato, non si arriva a 0 scalando con lo stepper.
    const nuovo = Math.max(1, Math.min(QUANTITA_MASSIMA, (parseInt(input.value, 10) || 0) + passo));
    input.value = nuovo;
    const meno = stepper.querySelector('[data-passo-carrello="-1"]');
    if (meno) meno.disabled = nuovo <= 1;
    programmaSalvataggioCarrello(id, nuovo);
  });

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-rimuovi]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute('data-rimuovi');
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: 0 }),
    })
      .then(function () { window.location.reload(); })
      .catch(function () { window.location.reload(); });
  });

  // Quantità scritta a mano: si salva quando il campo perde il fuoco e le voci si riscrivono da sole
  // (totali e ordine minimo compresi). Prima non si salvava mai (il pulsante "Aggiorna"
  // a cui si affidava non esiste) e la richiesta partiva con la quantità vecchia.
  let invioCarrelloInCorso = false;
  document.addEventListener('change', function (e) {
    if (!e.target.matches('[data-qta-carrello-input]')) return;
    const id = e.target.getAttribute('data-qta-carrello-input');
    const qty = limitaQuantita(parseInt(e.target.value, 10) || 0);
    // Il campo mostra il valore davvero salvato (con il tetto applicato).
    e.target.value = qty;
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: qty }),
    })
      .then(leggiJson)
      .then(function (d) {
        if (d && typeof d.pezzi === 'number') aggiornaBadgeCarrello(d.pezzi);
        // Zero toglie la riga: lì si ricarica. Altrimenti si riscrivono le voci (e il pulsante "−" dello stepper).
        if (qty > 0 && aggiornaCarrelloDa(d)) {
          const meno = document.querySelector('[data-stepper-carrello="' + id + '"] [data-passo-carrello="-1"]');
          if (meno) meno.disabled = qty <= 1;
          return;
        }
        if (!invioCarrelloInCorso) window.location.reload();
      })
      .catch(function () { if (!invioCarrelloInCorso) window.location.reload(); });
  });

  // "Paga e invia la richiesta" è un form separato: porta con sé le quantità visibili,
  // così vale quello che il cliente vede anche se il salvataggio sopra non ha fatto in tempo.
  document.addEventListener('submit', function (e) {
    const form = e.target.closest('[data-invia-carrello]');
    if (!form) return;
    invioCarrelloInCorso = true;
    document.querySelectorAll('[data-qta-carrello-input]').forEach(function (inp) {
      const campo = document.createElement('input');
      campo.type = 'hidden';
      campo.name = 'quantita_' + inp.getAttribute('data-qta-carrello-input');
      campo.value = limitaQuantita(parseInt(inp.value, 10) || 0);
      form.appendChild(campo);
    });
  });

  // ---------- Carrello: indirizzo di consegna ("Cambia") e nota facoltativa ----------
  // Il campo "destinazione" è sempre nel form (anche nascosto, parte comunque con la richiesta): "Cambia"
  // lo mostra, "Fatto" lo richiude e riscrive la scheda. Invio dentro il campo vale "Fatto": prima
  // inviava il form, cioè pagava.
  (function () {
    const consegna = document.querySelector('[data-consegna]');
    const campo = consegna && consegna.querySelector('input[name="destinazione"]');
    const zonaCampo = consegna && consegna.querySelector('[data-consegna-campo]');
    const bottone = consegna && consegna.querySelector('[data-consegna-cambia]');
    const via = consegna && consegna.querySelector('[data-consegna-via]');
    const citta = consegna && consegna.querySelector('[data-consegna-citta]');
    // Se manca un solo pezzo della scheda non si fa niente: un errore qui fermerebbe tutto il resto dello script.
    if (campo && zonaCampo && bottone && via && citta) {
      // `senzaFuoco`: dal pulsante della posizione il campo si apre ma la tastiera no (sul telefono si coprirebbe il messaggio).
      const apri = function (senzaFuoco) {
        zonaCampo.hidden = false;
        bottone.textContent = 'Fatto';
        if (senzaFuoco !== true) campo.focus();
      };
      const conferma = function () {
        const testo = campo.value.trim();
        if (!testo) { campo.focus(); return; }
        const taglio = testo.indexOf(',');
        via.textContent = taglio === -1 ? testo : testo.slice(0, taglio).trim();
        citta.textContent = taglio === -1 ? '' : testo.slice(taglio + 1).trim();
        zonaCampo.hidden = true;
        bottone.textContent = 'Cambia';
      };
      bottone.addEventListener('click', function () { if (zonaCampo.hidden) apri(); else conferma(); });
      campo.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); conferma(); }
      });

      // Posizione di consegna: due modi. O l'installatore scrive l'indirizzo (il server ne ricava la posizione), oppure tocca il mirino accanto al campo:
      // solo allora il browser legge la posizione del dispositivo (mai all'apertura della pagina), la geocodifica inversa (GET /api/indirizzo) la
      // trasforma in indirizzo e le coordinate partono con la richiesta (dest_lat/dest_lng: da quelle il server calcola il tragitto del corriere).
      // Appena si modifica il testo le coordinate si tolgono: non descrivono più quell'indirizzo. Non si paga senza un indirizzo.
      // Funziona da sito e da web app installata, su iPhone, Android e computer, ma solo in HTTPS (o su localhost): è una regola dei browser.
      const form = campo.form;
      const destLat = consegna.querySelector('[data-dest-lat]');
      const destLng = consegna.querySelector('[data-dest-lng]');
      const posizione = consegna.querySelector('[data-consegna-pos]');
      const posizioneTesto = consegna.querySelector('[data-consegna-pos-testo]');
      const bottonePos = consegna.querySelector('[data-consegna-pos-usa]');
      if (form && destLat && destLng && posizione && posizioneTesto && bottonePos) {
        let daPosizione = ''; // l'indirizzo ricavato dalla posizione, per accorgersi che è stato cambiato
        const dice = function (testo) {
          posizione.hidden = !testo;
          posizioneTesto.textContent = testo || '';
        };
        campo.addEventListener('input', function () {
          if (campo.value.trim() !== daPosizione) { destLat.value = ''; destLng.value = ''; }
          dice('');
        });

        // Come riattivare il permesso, detto per il dispositivo che si ha davanti (iPad con Safari "desktop" compreso).
        const ua = navigator.userAgent || '';
        const suIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        const suAndroid = /Android/i.test(ua);
        const testoNegata = function () {
          if (suIos) return 'Posizione non consentita. Su iPhone e iPad: Impostazioni › Privacy e sicurezza › Localizzazione › Safari (o questa app), poi riprova. Oppure scrivi l’indirizzo.';
          if (suAndroid) return 'Posizione non consentita. Dalle impostazioni del sito (il lucchetto accanto all’indirizzo) o dell’app consenti la Posizione, poi riprova. Oppure scrivi l’indirizzo.';
          return 'Posizione non consentita dal browser: abilitala per questo sito e riprova. Oppure scrivi l’indirizzo.';
        };
        const leggi = function (opzioni) {
          return new Promise(function (ok, no) { navigator.geolocation.getCurrentPosition(ok, no, opzioni); });
        };
        // Il primo rilevamento che il dispositivo dà è spesso grossolano (Wi-Fi, celle, o una posizione vecchia in cache): il GPS ci mette qualche secondo a stringere,
        // e una posizione sbagliata di 100 m dà il civico di un'altra casa (da Via Puggia 22 usciva il 17). Si ascolta quindi per un po' tenendo il rilevamento con
        // l'incertezza minore, e ci si ferma quando è buono (PRECISIONE_OTTIMA_M), quando non migliora più (ATTESA_SENZA_MIGLIORAMENTI_MS: un computer ne dà uno solo)
        // o allo scadere del tempo massimo. `avanza(metri)` racconta i progressi. Permesso negato: subito errore. Nessun rilevamento: l'ultimo errore.
        const PRECISIONE_OTTIMA_M = 15;
        const ATTESA_MASSIMA_MS = 12000;
        const ATTESA_SENZA_MIGLIORAMENTI_MS = 4000;
        const leggiMigliore = function (avanza) {
          return new Promise(function (ok, no) {
            let migliore = null;
            let ultimoErrore = null;
            let sorveglianza = null;
            let finito = false;
            let tMassimo = null;
            let tFermo = null;
            const concludi = function () {
              if (finito) return;
              finito = true;
              clearTimeout(tMassimo);
              clearTimeout(tFermo);
              if (sorveglianza !== null) navigator.geolocation.clearWatch(sorveglianza);
              if (migliore) ok(migliore); else no(ultimoErrore || { code: 2 });
            };
            tMassimo = setTimeout(concludi, ATTESA_MASSIMA_MS);
            sorveglianza = navigator.geolocation.watchPosition(function (p) {
              const metri = p.coords.accuracy;
              if (!migliore || metri < migliore.coords.accuracy) {
                migliore = p;
                clearTimeout(tFermo);
                tFermo = setTimeout(concludi, ATTESA_SENZA_MIGLIORAMENTI_MS);
                if (avanza) avanza(metri);
              }
              if (metri <= PRECISIONE_OTTIMA_M) concludi();
            }, function (errore) {
              ultimoErrore = errore;
              if (errore && errore.code === 1) concludi();
            }, { enableHighAccuracy: true, maximumAge: 0, timeout: ATTESA_MASSIMA_MS });
          });
        };
        const metriInTesto = function (metri) {
          if (metri >= 10000) return Math.round(metri / 1000) + ' km';
          if (metri >= 1000) return (Math.round(metri / 100) / 10).toString().replace('.', ',') + ' km';
          return Math.max(1, Math.round(metri)) + ' m';
        };

        let incorso = false;
        const fine = function () {
          incorso = false;
          bottonePos.disabled = false;
          bottonePos.classList.remove('cerca');
        };
        const cercaPosizione = function () {
          if (incorso) return;
          if (!window.isSecureContext) {
            dice('Il browser legge la posizione solo su un sito sicuro (HTTPS). Scrivi l’indirizzo.');
            return;
          }
          if (!('geolocation' in navigator)) {
            dice('Questo dispositivo non può dare la posizione. Scrivi l’indirizzo.');
            return;
          }
          incorso = true;
          bottonePos.disabled = true;
          bottonePos.classList.add('cerca');
          dice('Cerco la tua posizione…');
          // Prima si ascolta il GPS tenendo il rilevamento migliore (leggiMigliore); se non ne arriva nessuno in tempo, o il dispositivo non lo dà, si riprova con quello
          // approssimato (Wi-Fi e celle, al massimo di un minuto fa), che basta per la via. Se il permesso è negato inutile riprovare.
          leggiMigliore(function (metri) { dice('Cerco la tua posizione… (precisione circa ' + metriInTesto(metri) + ')'); })
            .catch(function (errore) {
              if (errore && errore.code === 1) throw errore;
              return leggi({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
            })
            .then(function (p) {
              const lat = p.coords.latitude;
              const lng = p.coords.longitude;
              const metri = Math.round(p.coords.accuracy || 0);
              return fetch('/api/indirizzo?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng) + '&precisione=' + encodeURIComponent(metri))
                .then(leggiJson)
                .then(function (dati) {
                  fine();
                  if (!dati || !dati.ok || !dati.indirizzo) {
                    apri(true);
                    dice('Ho trovato la posizione ma non l’indirizzo: scrivilo qui sopra.');
                    return;
                  }
                  campo.value = dati.indirizzo;
                  daPosizione = dati.indirizzo;
                  destLat.value = String(lat);
                  destLng.value = String(lng);
                  // Un server che non manda `civico` (non ancora riavviato) vale come "c'è": la scheda si chiude come prima.
                  if (dati.civico !== false) {
                    dice('');
                    conferma();
                  } else if (dati.precisa === false) {
                    // La posizione sbaglia di troppo per scegliere il numero (il server non lo scrive: sarebbe quello di un'altra casa): il campo resta aperto.
                    apri(true);
                    dice('Posizione precisa solo a circa ' + metriInTesto(metri) + ': controlla la via e aggiungi il numero civico.');
                  } else {
                    apri(true);
                    dice('Non trovo il numero civico di questo punto: aggiungilo all’indirizzo.');
                  }
                }, function (errore) {
                  fine();
                  if (errore && errore.sessioneScaduta) return;
                  apri(true);
                  dice('Non riesco a ricavare l’indirizzo dalla posizione: scrivilo qui sopra.');
                });
            }, function (errore) {
              fine();
              apri(true);
              if (errore && errore.code === 1) dice(testoNegata());
              else if (errore && errore.code === 3) dice('La posizione non arriva: prova all’aperto o scrivi l’indirizzo.');
              else dice('Non riesco a leggere la posizione di questo dispositivo: scrivi l’indirizzo.');
            });
        };
        bottonePos.addEventListener('click', cercaPosizione);

        // Senza indirizzo non si invia: il campo si apre e dice cosa manca. Il gestore del form sta sul form (prima di quello sul documento) e ferma la propagazione.
        form.addEventListener('submit', function (e) {
          if (campo.value.trim()) return;
          e.preventDefault();
          e.stopPropagation();
          apri();
          dice('Scrivi l’indirizzo di consegna, oppure tocca il mirino per usare la tua posizione.');
        });
      }
    }

    const nota = document.querySelector('[data-nota]');
    const testoNota = nota && nota.querySelector('textarea');
    const titoloNota = nota && nota.querySelector('summary');
    if (nota && testoNota && titoloNota) {
      const testo = testoNota;
      // Già scritta (il browser rimette il testo dopo un ricaricamento): si mostra aperta.
      const apriSeScritta = function () { if (testo.value.trim()) nota.open = true; };
      apriSeScritta();
      window.addEventListener('pageshow', apriSeScritta);
      // Il fuoco va nel campo solo se è l'utente ad aprirla: all'apertura automatica aprirebbe la tastiera.
      titoloNota.addEventListener('click', function () {
        if (!nota.open) setTimeout(function () { testo.focus(); }, 0);
      });
    }
  })();

  // ---------- Helper condivisi per costruire una card prodotto da JSON ----------
  // (usati sia dalla ricerca live sotto, sia dallo scroll infinito delle categorie)

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Blocco stepper/mini-carrello (o messaggio "non disponibile"): usato sia al primo
  // disegno della card, sia quando si cambia variante dal selettore misure.
  function azioniHtml(id, disponibilita) {
    if (disponibilita === 'non_disponibile') return '<div class="meta">non disponibile</div>';
    return (
      '<div class="prodotto-azioni">' +
      '<div class="stepper">' +
      '<button type="button" data-passo="-1" aria-label="Togli">−</button>' +
      '<input type="number" min="0" max="9999" step="1" inputmode="numeric" data-qta data-prodotto-qta="' + id + '" value="0">' +
      '<button type="button" data-passo="1" aria-label="Aggiungi">+</button>' +
      '</div>' +
      '<div class="mini-carrello" data-nel-carrello="' + id + '" hidden><span>Nel carrello: <strong data-qta-carrello="' + id + '">0</strong> pz</span></div>' +
      '</div>'
    );
  }

  // Con 2 varianti bastano due chip affiancati; da 3 in su un pulsante apre il pannello dal basso
  // (deve restare uguale a views/partials/cliente/misura.ejs).
  const SOGLIA_CHIP = 2;
  const FRECCIA_MISURA = '<svg class="misura-freccia" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // Blocco "Misura" di un prodotto con varianti (occhiello + chip o pulsante) e l'attributo con i dati delle
  // varianti: condivisi fra la card classica e la riga compatta della categoria. Le etichette arrivano già
  // scritte come misure ("108 × 60 × 44 cm") dal server (catalogo.etichettaVariante), qui non si rifanno.
  // Deve restare uguale a views/partials/cliente/misura.ejs.
  function misuraHtml(p) {
    if (!p.varianti) return '';
    const info = p.varianti_info || { voce: 'Misura', ordine: '', occhiello: 'Misura', titolo: 'Scegli la misura' };
    const n = p.varianti.length;
    const scelta = p.varianti.find(function (v) { return v.id === p.id; }) || p.varianti[0];
    return (
      '<div class="misura" data-misura><div class="misura-occhiello">' + esc(info.occhiello) +
      (n > SOGLIA_CHIP ? ' · ' + n + ' disponibili' : '') + '</div>' +
      (n > SOGLIA_CHIP
        ? '<button type="button" class="misura-apri" data-misura-apri aria-haspopup="dialog" data-pannello-titolo="' + esc(info.titolo) +
          '" data-pannello-sotto="' + esc(p.nome + (info.ordine ? ' · ' + info.ordine : '')) + '">' +
          '<span class="misura-sr">' + esc(info.voce) + ' di ' + esc(p.nome) + ': </span>' +
          '<span class="misura-testo" data-misura-testo>' + esc(scelta.etichetta) + '</span>' + FRECCIA_MISURA + '</button>'
        : '<div class="misura-chip" role="radiogroup" aria-label="' + esc(info.voce) + ' di ' + esc(p.nome) + '">' +
          p.varianti.map(function (v) {
            const attiva = v.id === scelta.id;
            return '<button type="button" class="misura-opz' + (attiva ? ' attivo' : '') + '" role="radio" aria-checked="' + attiva +
              '" tabindex="' + (attiva ? 0 : -1) + '" data-variante-id="' + v.id + '">' + esc(v.etichetta) + '</button>';
          }).join('') + '</div>') +
      '</div>'
    );
  }

  function variantiAttr(p) {
    return p.varianti ? ' data-varianti=\'' + esc(JSON.stringify(p.varianti)).replace(/'/g, '&#39;') + '\'' : '';
  }

  function cardProdottoHtml(p) {
    const barrato = p.sconto_base_pct > 0
      ? '<span class="barrato">€ ' + p.listino + '</span>'
      : '';
    const varianti = misuraHtml(p);
    return (
      '<div class="prodotto" data-prodotto="' + p.id + '"' + variantiAttr(p) +
      '>' +
      '<div class="info">' +
      '<div class="nome">' +
      (p.brand_nome
        ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' +
          esc(p.brand_nome) + '</span> '
        : '') +
      esc(p.nome) + '</div>' +
      varianti +
      '<div class="meta" data-riga-meta><span data-riga-codice hidden>' + esc(p.codice) + '</span>' + esc(p.macro_nome || '') +
      (p.raee ? ' · RAEE € ' + p.raee : '') +
      ' <span class="badge badge-' + p.disponibilita + '" data-riga-badge>' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="prezzo" data-riga-prezzo>' + barrato + '€ ' + p.prezzo + ' <span class="iva">+ IVA</span></div>' +
      '</div>' +
      '<div class="prodotto-laterale">' +
      (p.foto_url
        ? '<img class="prodotto-foto" src="' + esc(p.foto_url) + '" alt="" loading="lazy">'
        : '<div class="prodotto-foto prodotto-foto-vuota" aria-hidden="true"></div>') +
      '<div data-riga-azioni>' + azioniHtml(p.id, p.disponibilita) + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  // ---------- Righe compatte della categoria: − N + che scrive subito nel carrello ----------
  // Solo la pagina categoria (#risultati[data-righe-compatte]; il markup server è in
  // views/partials/cliente/prodotto_riga.ejs e deve restare uguale a rigaCompattaHtml qui sotto). Il numero
  // sullo stepper è la quantità già nel carrello, non un contatore a parte: ogni tocco lo cambia
  // subito a schermo e la quantità va a /api/carrello/imposta, una richiesta alla volta (richieste
  // parallele sulla stessa sessione si sovrascriverebbero) e, per lo stesso prodotto, solo l'ultimo
  // valore. Se il salvataggio fallisce il numero torna a quello confermato dal server.
  //   salvate: carrello come l'ha confermato il server { id: qty }
  //   volute:  quantità mostrate e non ancora confermate { id: qty }
  //   pezzi:   pezzi totali nel carrello secondo il server (comprende i prodotti fuori pagina)
  const radiceRighe = document.querySelector('[data-righe-compatte]');
  const iconaFotoVuota = radiceRighe ? radiceRighe.dataset.iconaVuota || '' : '';
  const righe = { salvate: {}, volute: {}, pezzi: 0, inCorso: false, dopo: [] };

  function carrelloNormalizzato(c) {
    const out = {};
    Object.keys(c || {}).forEach(function (id) {
      const q = parseInt(c[id], 10) || 0;
      if (q > 0) out[id] = q;
    });
    return out;
  }

  if (radiceRighe) {
    try { righe.salvate = carrelloNormalizzato(JSON.parse(radiceRighe.dataset.carrello || '{}')); } catch (err) { /* parte vuoto */ }
    righe.pezzi = parseInt(radiceRighe.dataset.pezzi, 10) || 0;
  }

  function qtaRiga(id) {
    return id in righe.volute ? righe.volute[id] : (righe.salvate[id] || 0);
  }

  function pezziRighe() {
    let scarto = 0;
    Object.keys(righe.volute).forEach(function (id) { scarto += righe.volute[id] - (righe.salvate[id] || 0); });
    return Math.max(0, righe.pezzi + scarto);
  }

  function prodottoDaSalvare() {
    return Object.keys(righe.volute).find(function (id) { return righe.volute[id] !== (righe.salvate[id] || 0); });
  }

  function disegnaRiga(id) {
    const q = qtaRiga(id);
    document.querySelectorAll('[data-riga-stepper="' + id + '"]').forEach(function (st) {
      st.classList.toggle('attivo', q > 0);
      const num = st.querySelector('[data-riga-qta]');
      if (num) num.textContent = q;
      const meno = st.querySelector('[data-riga-passo="-1"]');
      if (meno) meno.disabled = q <= 0;
    });
  }

  // Pallino del Carrello nella navbar e barra "N pezzi · Vai al carrello" (solo con pezzi > 0).
  function disegnaTotaliRighe() {
    const pezzi = pezziRighe();
    aggiornaBadgeCarrello(pezzi);
    const barra = document.querySelector('[data-barra-vai]');
    if (!barra) return;
    barra.hidden = pezzi <= 0;
    const testo = barra.querySelector('[data-barra-pezzi]');
    if (testo) testo.textContent = pezzi + (pezzi === 1 ? ' pezzo' : ' pezzi');
  }

  function ridisegnaRighe() {
    document.querySelectorAll('[data-riga-stepper]').forEach(function (st) {
      disegnaRiga(st.getAttribute('data-riga-stepper'));
    });
    disegnaTotaliRighe();
  }

  function segnalaErroreRiga(id) {
    document.querySelectorAll('[data-riga-stepper="' + id + '"]').forEach(function (st) {
      st.classList.remove('errore');
      void st.offsetWidth; // riparte l'animazione anche se era già in corso
      st.classList.add('errore');
      setTimeout(function () { st.classList.remove('errore'); }, 700);
    });
  }

  function salvaRighe() {
    if (righe.inCorso) return;
    const id = prodottoDaSalvare();
    if (id === undefined) {
      righe.volute = {}; // tutto uguale al server
      const dopo = righe.dopo;
      righe.dopo = [];
      dopo.forEach(function (f) { f(); });
      return;
    }
    righe.inCorso = true;
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: righe.volute[id] }),
      keepalive: true, // un salvataggio partito non si perde se si cambia pagina subito dopo
    })
      .then(function (r) { if (!r.ok && r.status !== 401) throw new Error('http'); return leggiJson(r); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error('rifiutato');
        righe.salvate = carrelloNormalizzato(d.carrello);
        righe.pezzi = parseInt(d.pezzi, 10) || 0;
        Object.keys(righe.volute).forEach(function (k) {
          if (righe.volute[k] === (righe.salvate[k] || 0)) delete righe.volute[k];
        });
      })
      .catch(function () {
        delete righe.volute[id]; // il numero torna a quello di prima
        segnalaErroreRiga(id);
      })
      .then(function () {
        righe.inCorso = false;
        ridisegnaRighe();
        salvaRighe();
      });
  }

  // Tornando con "indietro" la pagina può riapparire com'era, con le quantità di prima: si rileggono.
  function sincronizzaRighe() {
    fetch('/api/carrello', { cache: 'no-store' })
      .then(leggiJson)
      .then(function (d) {
        if (!d || !d.carrello || righe.inCorso || prodottoDaSalvare() !== undefined) return;
        righe.salvate = carrelloNormalizzato(d.carrello);
        righe.pezzi = parseInt(d.pezzi, 10) || 0;
        righe.volute = {};
        ridisegnaRighe();
      })
      .catch(function () { /* resta quello che c'è */ });
  }

  if (radiceRighe) {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-riga-passo]');
      if (!btn) return;
      e.preventDefault();
      if (btn.disabled) return;
      const stepper = btn.closest('[data-riga-stepper]');
      if (!stepper) return;
      const id = stepper.getAttribute('data-riga-stepper');
      const prima = qtaRiga(id);
      const dopo = limitaQuantita(prima + parseInt(btn.getAttribute('data-riga-passo'), 10));
      if (dopo === prima) return;
      righe.volute[id] = dopo;
      disegnaRiga(id);
      disegnaTotaliRighe();
      salvaRighe();
    });

    // Un link toccato mentre un salvataggio è ancora in corso (ultimo + e subito "Vai al carrello")
    // aspetta che il carrello sia aggiornato: sulla pagina dopo si vedrebbe il numero vecchio.
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a[href]');
      if (!link || link.target === '_blank') return;
      if (!righe.inCorso && prodottoDaSalvare() === undefined) return;
      e.preventDefault();
      let partito = false;
      const vai = function () { if (!partito) { partito = true; window.location.href = link.href; } };
      righe.dopo.push(vai);
      setTimeout(vai, 3000); // rete che non risponde: si va comunque
    });

    window.addEventListener('pageshow', function (e) {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      if (e.persisted || (nav && nav.type === 'back_forward')) sincronizzaRighe();
    });
  }

  // Home, ricerca, marchio, "con foto": tornando con "indietro" la pagina può riapparire com'era, con il carrello di
  // prima nella barra "Vai al carrello" e nel pallino. Si rilegge (le pagine categoria lo fanno già con le loro righe).
  if (!radiceRighe && document.body.dataset.loggato === '1' && document.querySelector('[data-nav-badge]')) {
    window.addEventListener('pageshow', function (e) {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      if (!e.persisted && !(nav && nav.type === 'back_forward')) return;
      fetch('/api/carrello', { cache: 'no-store' })
        .then(leggiJson)
        .then(function (d) { if (d && typeof d.pezzi === 'number') aggiornaBadgeCarrello(d.pezzi); })
        .catch(function () { /* resta quello che c'è */ });
    });
  }

  function stepperRigaHtml(id, disponibilita, qty) {
    if (disponibilita === 'non_disponibile') return '';
    return (
      '<div class="riga-stepper' + (qty > 0 ? ' attivo' : '') + '" data-riga-stepper="' + id +
      '" role="group" aria-label="Quantità nel carrello">' +
      '<button type="button" class="riga-passo" data-riga-passo="-1" aria-label="Togli uno"' + (qty > 0 ? '' : ' disabled') +
      '><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>' +
      '<span class="riga-qta" data-riga-qta="' + id + '" aria-live="polite">' + qty + '</span>' +
      '<button type="button" class="riga-passo" data-riga-passo="1" aria-label="Aggiungi uno">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>' +
      '</div>'
    );
  }

  function prezzoRigaHtml(prezzo, listino, scontoPct, raee) {
    return (
      (scontoPct > 0 ? '<span class="barrato">€ ' + listino + '</span>' : '') +
      '<span class="importo">€ ' + prezzo + '</span> <span class="iva">+ IVA</span>' +
      (raee ? '<span class="raee">RAEE € ' + raee + '</span>' : '')
    );
  }

  function rigaCompattaHtml(p) {
    const foto = p.foto_url
      ? '<img class="prodotto-foto riga-foto" src="' + esc(p.foto_url) + '" alt="" loading="lazy">'
      : '<div class="riga-foto riga-foto-vuota" aria-hidden="true">' + iconaFotoVuota + '</div>';
    const marchio = p.brand_nome
      ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' + esc(p.brand_nome) + '</span> '
      : '';
    return (
      '<div class="riga-prod" data-prodotto="' + p.id + '" data-riga-compatta' + variantiAttr(p) + '>' +
      foto +
      '<div class="riga-info">' +
      '<div class="riga-nome">' + marchio + esc(p.nome) + '</div>' +
      misuraHtml(p) +
      '<div class="riga-stato" data-riga-stato' + (p.disponibilita === 'disponibile' ? ' hidden' : '') + '>' +
      '<span class="badge badge-' + p.disponibilita + '" data-riga-badge>' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="riga-prezzo" data-riga-prezzo>' + prezzoRigaHtml(p.prezzo, p.listino, p.sconto_base_pct, p.raee) + '</div>' +
      '</div>' +
      '<div class="riga-azioni" data-riga-azioni>' + stepperRigaHtml(p.id, p.disponibilita, qtaRiga(p.id)) + '</div>' +
      '</div>'
    );
  }

  // Cambio misura dentro una riga compatta: prezzo, stato e stepper (con la quantità già nel
  // carrello per quella misura) passano alla variante scelta.
  function applicaVarianteRiga(card, v) {
    segnaMisuraScelta(card, v);
    const badge = card.querySelector('[data-riga-badge]');
    if (badge) {
      badge.className = 'badge badge-' + v.disponibilita;
      badge.textContent = v.disponibilita_testo || v.disponibilita;
    }
    const stato = card.querySelector('[data-riga-stato]');
    if (stato) stato.hidden = v.disponibilita === 'disponibile';
    const prezzo = card.querySelector('[data-riga-prezzo]');
    if (prezzo) prezzo.innerHTML = prezzoRigaHtml(v.prezzo, v.listino, v.sconto_base_pct, v.raee);
    const azioni = card.querySelector('[data-riga-azioni]');
    if (azioni) azioni.innerHTML = stepperRigaHtml(v.id, v.disponibilita, qtaRiga(v.id));
  }

  // ---------- Selettore varianti (misure) dentro una card prodotto ----------
  // Chip e pulsante del pannello mostrano la misura scelta: la card passa alla variante `v`.
  function segnaMisuraScelta(card, v) {
    card.setAttribute('data-prodotto', v.id);
    card.querySelectorAll('[data-variante-id]').forEach(function (c) {
      const attivo = c.getAttribute('data-variante-id') === String(v.id);
      c.classList.toggle('attivo', attivo);
      c.setAttribute('aria-checked', attivo ? 'true' : 'false');
      c.tabIndex = attivo ? 0 : -1;
    });
    const testo = card.querySelector('[data-misura-testo]');
    if (testo) testo.textContent = v.etichetta;
  }

  // Aggiorna la card (prezzo, codice, disponibilità, stepper) sulla variante scelta,
  // sia che arrivi da un chip cliccato sia dal pannello delle misure.
  function applicaVariante(card, v) {
    if (card.hasAttribute('data-riga-compatta')) { applicaVarianteRiga(card, v); return; }
    segnaMisuraScelta(card, v);
    const codiceEl = card.querySelector('[data-riga-codice]');
    if (codiceEl) codiceEl.textContent = v.codice;
    const badgeEl = card.querySelector('[data-riga-badge]');
    if (badgeEl) {
      badgeEl.className = 'badge badge-' + v.disponibilita;
      badgeEl.textContent = v.disponibilita_testo || v.disponibilita;
    }
    const prezzoEl = card.querySelector('[data-riga-prezzo]');
    if (prezzoEl) {
      const barrato = v.sconto_base_pct > 0 ? '<span class="barrato">€ ' + v.listino + '</span>' : '';
      prezzoEl.innerHTML = barrato + '€ ' + v.prezzo + ' <span class="iva">+ IVA</span>';
    }
    const azioniEl = card.querySelector('[data-riga-azioni]');
    if (azioniEl) {
      // La quantità scelta per la misura di prima non passa a quella nuova: la card riparte da quanto era stato scelto per questa.
      const campoPrima = azioniEl.querySelector('input[data-qta]');
      if (campoPrima && campoPrima.getAttribute('data-prodotto-qta') !== String(v.id)) impostaScelta(campoPrima.getAttribute('data-prodotto-qta'), 0);
      azioniEl.innerHTML = azioniHtml(v.id, v.disponibilita);
      applicaScelte(azioniEl);
    }

    risincronizzaCarrelloVisibile();
    ricalcolaBarra();
  }

  function variantiDellaCard(card) {
    try { return JSON.parse(card.getAttribute('data-varianti')); } catch (err) { return null; }
  }

  function trovaVariante(card, id) {
    const varianti = variantiDellaCard(card);
    return (varianti && varianti.find(function (x) { return String(x.id) === String(id); })) || null;
  }

  document.addEventListener('click', function (e) {
    const chip = e.target.closest('[data-variante-id]');
    if (!chip) return;
    e.preventDefault();
    const card = chip.closest('[data-varianti]');
    if (!card) return;
    const v = trovaVariante(card, chip.getAttribute('data-variante-id'));
    if (v) applicaVariante(card, v);
  });

  // Chip e righe del pannello sono un gruppo di radio: le frecce scelgono la misura accanto (e la applicano).
  document.addEventListener('keydown', function (e) {
    const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const el = passo && e.target.closest ? e.target.closest('.misura-opz, .misura-riga') : null;
    if (!el) return;
    e.preventDefault();
    const sorelle = Array.prototype.slice.call(el.parentNode.children);
    const prossima = sorelle[(sorelle.indexOf(el) + passo + sorelle.length) % sorelle.length];
    prossima.focus();
    prossima.click();
  });

  // ---------- Pannello "Scegli la misura" (da 3 varianti in su) ----------
  // Uno solo per pagina: nasce al primo tocco e ogni volta si riempie dai data-varianti della riga toccata.
  // Toccare una misura la applica subito alla riga (prezzo, stepper e carrello come con i chip): "Conferma",
  // il velo ed Esc chiudono soltanto, e il fuoco torna sul pulsante della misura.
  const pannelloMisura = { velo: null, elenco: null, apritore: null, card: null };

  function rigaPannelloHtml(v, scelta) {
    return (
      '<button type="button" class="misura-riga' + (scelta ? ' attivo' : '') + '" role="radio" aria-checked="' + scelta +
      '" tabindex="' + (scelta ? 0 : -1) + '" data-pannello-variante="' + v.id + '">' +
      '<span class="misura-radio" aria-hidden="true"></span>' +
      '<span class="misura-riga-testo">' + esc(v.etichetta) + '</span>' +
      '<span class="misura-riga-prezzo">€ ' + esc(v.prezzo) + '</span></button>'
    );
  }

  function chiudiPannelloMisura() {
    const velo = pannelloMisura.velo;
    if (!velo || velo.hidden) return;
    velo.hidden = true;
    document.documentElement.classList.remove('misura-aperta');
    const apritore = pannelloMisura.apritore;
    pannelloMisura.apritore = pannelloMisura.card = null;
    if (apritore && apritore.isConnected) apritore.focus();
  }

  function creaPannelloMisura() {
    const velo = document.createElement('div');
    velo.className = 'misura-velo';
    velo.hidden = true;
    velo.innerHTML =
      '<div class="misura-pannello" role="dialog" aria-modal="true" aria-labelledby="misura-titolo">' +
      '<div class="misura-maniglia" aria-hidden="true"></div>' +
      '<h2 class="misura-titolo" id="misura-titolo"></h2><p class="misura-sotto"></p>' +
      '<div class="misura-elenco" role="radiogroup" aria-labelledby="misura-titolo"></div>' +
      '<button type="button" class="misura-conferma">Conferma</button></div>';
    document.body.appendChild(velo);
    pannelloMisura.velo = velo;
    pannelloMisura.elenco = velo.querySelector('.misura-elenco');

    velo.addEventListener('click', function (e) {
      if (e.target === velo || e.target.closest('.misura-conferma')) { chiudiPannelloMisura(); return; }
      const riga = e.target.closest('[data-pannello-variante]');
      const card = pannelloMisura.card;
      const v = riga && card && trovaVariante(card, riga.getAttribute('data-pannello-variante'));
      if (!v) return;
      applicaVariante(card, v);
      pannelloMisura.elenco.querySelectorAll('[data-pannello-variante]').forEach(function (r) {
        r.classList.toggle('attivo', r === riga);
        r.setAttribute('aria-checked', r === riga ? 'true' : 'false');
        r.tabIndex = r === riga ? 0 : -1;
      });
    });
  }

  function apriPannelloMisura(apritore) {
    const card = apritore.closest('[data-varianti]');
    const varianti = card && variantiDellaCard(card);
    if (!varianti || !varianti.length) return;
    if (!pannelloMisura.velo) creaPannelloMisura();
    const velo = pannelloMisura.velo;
    const elenco = pannelloMisura.elenco;
    const idScelto = String(card.getAttribute('data-prodotto'));
    pannelloMisura.apritore = apritore;
    pannelloMisura.card = card;
    velo.querySelector('.misura-titolo').textContent = apritore.getAttribute('data-pannello-titolo') || 'Scegli la misura';
    velo.querySelector('.misura-sotto').textContent = apritore.getAttribute('data-pannello-sotto') || '';
    elenco.innerHTML = varianti.map(function (v) { return rigaPannelloHtml(v, String(v.id) === idScelto); }).join('');
    velo.hidden = false;
    document.documentElement.classList.add('misura-aperta');
    const scelta = elenco.querySelector('.attivo') || elenco.firstElementChild;
    if (!scelta) return;
    scelta.focus({ preventScroll: true });
    // Con molte misure l'elenco scorre: la scelta si porta a metà, non resta fuori vista.
    elenco.scrollTop = scelta.offsetTop - (elenco.clientHeight - scelta.offsetHeight) / 2;
  }

  document.addEventListener('click', function (e) {
    const apri = e.target.closest('[data-misura-apri]');
    if (!apri) return;
    e.preventDefault();
    apriPannelloMisura(apri);
  });

  // Esc chiude; Tab resta dentro il pannello (la riga scelta e "Conferma").
  document.addEventListener('keydown', function (e) {
    const velo = pannelloMisura.velo;
    if (!velo || velo.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); chiudiPannelloMisura(); return; }
    if (e.key !== 'Tab') return;
    const fuochi = Array.prototype.filter.call(velo.querySelectorAll('button'), function (b) { return b.tabIndex >= 0; });
    const primo = fuochi[0];
    const ultimo = fuochi[fuochi.length - 1];
    if (!primo) return;
    if (!velo.contains(document.activeElement)) { e.preventDefault(); primo.focus(); }
    else if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
  });

  // Dopo aver inserito nuove card nel DOM: aggancia i loro quantità/mini-carrello e
  // aggiorna la barra in fondo. Serve sia dopo una sostituzione che dopo un'aggiunta.
  function risincronizzaCarrelloVisibile() {
    fetch('/api/carrello').then(leggiJson).then(function (d) {
      if (!d.carrello) return;
      Object.keys(d.carrello).forEach(function (id) { aggiornaMiniCard(id, d.carrello[id]); });
    }).catch(function () {});
    ricalcolaBarra();
  }

  // ---------- Ricerca parziale mentre si digita ----------

  const campoRicerca = document.querySelector('[data-ricerca]');
  const contenitore = document.getElementById('risultati');
  // Nella categoria l'elenco è fatto di righe compatte (vedi sopra), altrove di card classiche.
  const righeCompatte = !!(contenitore && contenitore.hasAttribute('data-righe-compatte'));
  const costruisciRiga = righeCompatte ? rigaCompattaHtml : cardProdottoHtml;
  const classeElenco = righeCompatte ? 'card card-fitta elenco-righe' : 'card card-fitta griglia-prodotti';

  // Ricerca e scroll infinito (più sotto) lavorano sullo stesso elenco. Finché si vedono i risultati di una ricerca lo
  // scroll infinito sta fermo: prima accodava ai risultati le pagine successive della categoria (da 2 risultati si
  // arrivava a 40 articoli che non c'entravano). Svuotando il campo si rimette l'elenco di partenza, e lo scroll
  // riparte dalla pagina con cui era stato disegnato: senza, le pagine già caricate e poi tolte non tornavano più.
  // `generazione` cambia a ogni passaggio, così una pagina richiesta prima della ricerca e arrivata dopo si scarta.
  const scorrimento = {
    generazione: 0,
    ferma: function () { this.generazione++; this.inRicerca = true; },
    riparti: function () { this.generazione++; this.inRicerca = false; },
    inRicerca: false,
    ripristina: function () {}, // lo imposta lo scroll infinito, se la pagina ce l'ha
    sostituisceLaPaginazione: false, // vero se lo scroll infinito ha nascosto i pulsanti di pagina
  };

  if (campoRicerca && contenitore) {
    let timer = null;
    let ultima = campoRicerca.value.trim();
    // Elenco mostrato all'apertura della pagina: si ripristina svuotando la ricerca.
    const contenutoIniziale = contenitore.innerHTML;
    const paginazione = document.querySelector('[data-paginazione]');
    // Ambito della pagina (categoria, marchio, famiglia, gruppo): la ricerca resta lì dentro.
    const ambito = campoRicerca.dataset.ambito || '';

    campoRicerca.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(cerca, 220);
    });

    function mostraPaginazione(visibile) {
      if (!paginazione) return;
      // Con lo scroll infinito i pulsanti di pagina restano nascosti anche dopo una ricerca: prima ricomparivano.
      if (visibile && !scorrimento.sostituisceLaPaginazione) paginazione.removeAttribute('hidden');
      else paginazione.setAttribute('hidden', '');
    }

    function cerca() {
      const q = campoRicerca.value.trim();
      if (q === ultima) return;
      ultima = q;
      if (q.length < 2) {
        scorrimento.riparti();
        contenitore.innerHTML = contenutoIniziale;
        scorrimento.ripristina();
        mostraPaginazione(true);
        applicaScelte(contenitore); // l'elenco di partenza ha i campi a 0: si rimettono le quantità scelte
        ricalcolaBarra();
        // L'elenco di partenza ha le quantità di quando la pagina è stata caricata: si rimettono quelle di ora.
        if (righeCompatte) ridisegnaRighe();
        return;
      }
      scorrimento.ferma();
      fetch('/api/cerca?q=' + encodeURIComponent(q) + (ambito ? '&' + ambito : ''))
        .then(leggiJson)
        .then(function (dati) {
          if (campoRicerca.value.trim() !== q) return;
          // Da cellulare, sostituire il contenuto della pagina mentre si sta scrivendo
          // può far sparire la tastiera (il browser toglie il focus dal campo quando il
          // layout intorno cambia): se l'utente sta ancora scrivendo qui, si rimette il
          // focus subito dopo aver ridisegnato i risultati.
          const eraFocus = document.activeElement === campoRicerca;
          mostraPaginazione(false);
          disegnaRisultati(dati.risultati || [], !!dati.troncato);
          if (eraFocus) campoRicerca.focus();
        })
        .catch(function () { /* offline: resta l'ultimo elenco mostrato */ });
    }

    function disegnaRisultati(risultati, troncato) {
      if (!risultati.length) {
        contenitore.innerHTML =
          '<div class="vuoto"><span class="emoji">🤷</span>Nessun prodotto trovato.</div>';
        return;
      }
      contenitore.innerHTML = '<div class="' + classeElenco + '">' + risultati.map(costruisciRiga).join('') + '</div>' +
        (troncato ? '<p class="nota nota-troncato" data-troncato>Mostrati i primi risultati: scrivi qualcosa in più per restringere la ricerca.</p>' : '');
      applicaScelte(contenitore); // un prodotto già scelto in una ricerca precedente riappare con la sua quantità
      if (!righeCompatte) risincronizzaCarrelloVisibile();
    }
  }

  // ---------- Scroll infinito nelle categorie ----------
  // La prima pagina arriva già renderizzata dal server (partials/comune/paginazione fa da
  // fallback se JS non parte); da qui in poi, avvicinandosi al fondo della lista si
  // carica ed accoda la pagina successiva, senza bisogno di cliccare "Successiva".
  (function () {
    const scrollInfinito = document.querySelector('[data-scroll-infinito]');
    if (!scrollInfinito || !contenitore) return;

    let pagina = parseInt(scrollInfinito.dataset.pagina, 10) || 1;
    let pagine = parseInt(scrollInfinito.dataset.pagine, 10) || 1;
    const paginaIniziale = pagina;
    const pagineIniziali = pagine;
    let caricamento = false;
    const urlBase = scrollInfinito.dataset.url;

    const paginazione = document.querySelector('[data-paginazione]');
    if (paginazione) paginazione.setAttribute('hidden', ''); // sostituita dallo scroll
    scorrimento.sostituisceLaPaginazione = true;

    const sentinella = document.createElement('div');
    sentinella.setAttribute('data-sentinella-scroll', '');
    scrollInfinito.after(sentinella);

    function caricaProssimaPagina() {
      if (caricamento || scorrimento.inRicerca || pagina >= pagine) return;
      caricamento = true;
      const generazione = scorrimento.generazione;
      fetch(urlBase + (urlBase.indexOf('?') === -1 ? '?' : '&') + 'pagina=' + (pagina + 1))
        .then(leggiJson)
        .then(function (dati) {
          // Nel frattempo è partita (o finita) una ricerca: questa pagina non appartiene più all'elenco mostrato.
          if (generazione !== scorrimento.generazione) return;
          const cardFitta = contenitore.querySelector('.card-fitta');
          if (cardFitta && dati.risultati && dati.risultati.length) {
            cardFitta.insertAdjacentHTML('beforeend', dati.risultati.map(costruisciRiga).join(''));
            applicaScelte(cardFitta);
            if (!righeCompatte) risincronizzaCarrelloVisibile();
          }
          pagina = dati.pagina || pagina + 1;
          pagine = dati.pagine || pagine;
          caricamento = false;
          if (pagina >= pagine) osservatore.disconnect();
        })
        .catch(function () { if (generazione === scorrimento.generazione) caricamento = false; });
    }

    const osservatore = new IntersectionObserver(function (voci) {
      if (voci[0].isIntersecting) caricaProssimaPagina();
    }, { rootMargin: '400px' });
    osservatore.observe(sentinella);

    // Svuotata la ricerca l'elenco è di nuovo la prima pagina: si riparte da lì (e si riaccende l'osservatore, che
    // poteva essersi spento arrivando all'ultima pagina; osservando di nuovo se ne ottiene subito lo stato).
    scorrimento.ripristina = function () {
      caricamento = false;
      pagina = paginaIniziale;
      pagine = pagineIniziali;
      osservatore.disconnect();
      if (pagina < pagine) osservatore.observe(sentinella);
    };
  })();

  // ---------- Schermata di attesa: countdown + polling ----------

  const attesa = document.querySelector('[data-attesa]');
  if (attesa) {
    let secondi = parseInt(attesa.dataset.secondi, 10) || 0;
    const orologio = document.getElementById('countdown');
    const elenco = document.getElementById('stato-distributori');
    const richiestaId = attesa.dataset.attesa;

    function mostraTempo() {
      if (!orologio) return;
      const s = Math.max(0, secondi);
      orologio.textContent =
        String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    setInterval(function () {
      secondi = Math.max(0, secondi - 1);
      mostraTempo();
    }, 1000);
    mostraTempo();

    const etichette = {
      in_attesa: ['Sta verificando', 'stato-in_attesa'],
      confermato: ['Disponibile', 'stato-confermato'],
      non_disponibile: ['Non disponibile', 'stato-non_disponibile'],
      scaduto: ['Nessuna risposta', 'stato-scaduto'],
    };

    setInterval(function () {
      fetch('/api/richieste/' + richiestaId)
        .then(leggiJson)
        .then(function (dati) {
          if (typeof dati.secondi === 'number') secondi = dati.secondi;
          if (elenco && dati.risposte) {
            dati.risposte.forEach(function (r) {
              // Confronto sull'attributo invece di un selettore CSS: un nome con le virgolette lo rompeva.
              const nodo = Array.prototype.find.call(elenco.querySelectorAll('[data-distributore]'), function (el) {
                return el.getAttribute('data-distributore') === r.nome;
              });
              if (!nodo) return;
              const et = etichette[r.esito] || etichette.in_attesa;
              nodo.textContent = et[0];
              nodo.className = 'stato-badge ' + et[1];
            });
          }
          // "Annulla la richiesta" si può solo finché nessun banco ha accettato: appena uno conferma il link sparisce.
          if (dati.annullabile === false) {
            const annulla = document.querySelector('[data-annulla-richiesta]');
            if (annulla) annulla.hidden = true;
          }
          // L'ordine è nato (corriere trovato): si va dritti all'ordine, con il banner di conferma.
          if (dati.order_id) window.location.href = '/ordini/' + dati.order_id + '?nuovo=1';
          else if (dati.stato !== 'in_attesa') window.location.reload();
        })
        .catch(function () { /* riprova al giro dopo */ });
    }, 3000);
  }

  // ---------- Notifiche del browser ----------

  // Come arrivano le notifiche (richiesta esplicita del 21/10/2026): SOLO come notifiche di sistema, col suono del telefono, quando l'app è in secondo piano o
  // chiusa. Con l'app aperta in primo piano non arriva nessuna notifica e il sito non fa nessun suono: si vede già tutto sullo schermo.
  // Il pulsante "Attiva" della scheda "Sul telefono" del profilo (views/cliente/profilo.ejs) chiede il permesso con un clic, iscrive il browser alle notifiche push e dice
  // com'è messa la cosa. Con le push (chiavi VAPID sul server, browser che le supportano) gli avvisi arrivano ANCHE AD APP CHIUSA; dopo "Attiva" e col pulsante
  // "Prova" ne arriva una di prova dopo 10 secondi, il tempo di uscire dall'app (la prova il service worker la mostra sempre, anche con l'app davanti).
  // Senza push arrivano solo con l'app (o la scheda) aperta in secondo piano: un controllo ogni 5 secondi, vedi sotto.
  // Su iPhone e iPad le notifiche esistono solo per la web app installata sulla schermata Home (iOS 16.4 o successivo): in Safari `Notification` manca, e la
  // scheda lo spiega invece di sparire.
  // "Avvisi sul telefono" è un interruttore (role="switch", aria-checked): acceso = permesso del telefono concesso E preferenza non spenta. Il permesso non si
  // revoca da una pagina, quindi "spento" vuol dire: tolgo l'iscrizione alle push e non mostro più niente (preferenza 'no' in localStorage, per questo dispositivo).
  // Acceso la prima volta, il telefono chiede il permesso (una volta sola); dopo, spegnere e riaccendere non chiede più niente. Nessuna notifica di prova.
  const CHIAVE_AVVISI_TELEFONO = 'minuteria.avvisi.telefono';
  function avvisiVoluti() {
    try { return window.localStorage.getItem(CHIAVE_AVVISI_TELEFONO) !== 'no'; } catch (e) { return true; }
  }
  function ricordaAvvisi(si) {
    try { window.localStorage.setItem(CHIAVE_AVVISI_TELEFONO, si ? 'sì' : 'no'); } catch (e) { /* senza memoria: vale solo finché la pagina resta aperta */ }
  }
  const pulsanteNotifiche = document.querySelector('[data-abilita-notifiche]');
  const statoNotifiche = document.querySelector('[data-notifiche-stato]');
  const schedaNotifiche = document.querySelector('[data-notifiche-scheda]');
  function scriviStatoNotifiche(testo) {
    if (statoNotifiche) statoNotifiche.textContent = testo;
  }
  const bloccoNotifiche = document.querySelector('[data-notifiche-blocco]');
  const bloccoPassi = document.querySelector('[data-notifiche-passi]');
  let bloccatoPrima = false; // l'ultima volta che si è guardato il permesso era "negato"?
  // I passi per riattivare le notifiche dal telefono (solo il telefono può cambiare un permesso negato).
  function passiPerSbloccare() {
    if (eIos()) return "Esci dall'app, apri Impostazioni › Notifiche › Minuteria e attiva «Consenti notifiche». Poi torna qui: lo attiviamo da soli.";
    if (eInstallata()) return "Esci dall'app, tieni premuta l'icona di Minuteria › Info app › Notifiche e attiva «Tutte le notifiche di Minuteria». Poi torna qui: lo attiviamo da soli.";
    return "Tocca il lucchetto (o i tre puntini) accanto all'indirizzo › Impostazioni sito › Notifiche › Consenti. Poi torna su questa pagina: lo attiviamo da soli.";
  }
  function mostraStatoNotifiche() {
    if (!pulsanteNotifiche) return;
    if (!('Notification' in window)) {
      pulsanteNotifiche.hidden = true;
      if (eIos()) {
        // iPhone/iPad: in Safari non c'è `Notification`; nella web app installata c'è solo da iOS 16.4.
        scriviStatoNotifiche(eInstallata()
          ? 'Per ricevere le notifiche serve iOS 16.4 o successivo: aggiorna il telefono.'
          : "Su iPhone le notifiche funzionano dall'app installata: tocca Condividi › Aggiungi alla schermata Home, aprila da lì e attivale qui (serve iOS 16.4 o successivo).");
      } else if (schedaNotifiche) {
        schedaNotifiche.hidden = true; // browser senza notifiche: niente scheda
      }
      return;
    }
    const permesso = Notification.permission;
    const acceso = permesso === 'granted' && avvisiVoluti();
    pulsanteNotifiche.setAttribute('aria-checked', acceso ? 'true' : 'false');
    // Permesso negato: l'interruttore resta spento e disabilitato (il telefono non chiede più niente) e sotto compare il riquadro giallo con i passi esatti per questo dispositivo.
    pulsanteNotifiche.disabled = permesso === 'denied';
    if (bloccoNotifiche) {
      bloccoNotifiche.hidden = permesso !== 'denied';
      if (permesso === 'denied' && bloccoPassi) bloccoPassi.textContent = passiPerSbloccare();
    }
    bloccatoPrima = permesso === 'denied';
    if (permesso === 'denied') {
      scriviStatoNotifiche('Bloccate dal telefono: segui i passi qui sotto.');
    } else if (!acceso) {
      scriviStatoNotifiche('Spente: non ricevi avvisi quando un banco risponde.');
    } else if (!pushDisponibile()) {
      scriviStatoNotifiche("Accese: ti avvisiamo quando un banco risponde, con l'app in secondo piano.");
    } else {
      scriviStatoNotifiche('Controllo le notifiche…');
      iscriviPush().then(function (ok) {
        scriviStatoNotifiche(ok
          ? "Accese: ti avvisiamo quando un banco risponde, anche con l'app chiusa."
          : "Accese solo con l'app in secondo piano: non sono riuscito ad attivarle anche ad app chiusa. Riprova più tardi.");
      });
    }
  }
  function accendiAvvisi() {
    ricordaAvvisi(true);
    // Prima si segnano come già viste le notifiche di prima (altrimenti arriverebbero tutte insieme), poi si iscrive il browser.
    return fetch('/api/notifiche/attiva', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .catch(function () { /* il filtro dei 10 minuti sul server evita comunque il peggio */ })
      .then(function () { return iscriviPush({ forza: true }); })
      .then(mostraStatoNotifiche);
  }
  // Tornando sulla pagina (visibilitychange; focus/pageshow per i browser che non lo mandano) si rilegge il permesso: se da "negato" è diventato "concesso" il riquadro
  // giallo sparisce, il browser si iscrive alle notifiche e l'interruttore passa su ON da solo.
  function controllaPermessoTornando() {
    if (!pulsanteNotifiche || !('Notification' in window) || document.visibilityState === 'hidden') return;
    if (bloccatoPrima && Notification.permission === 'granted') { accendiAvvisi(); return; }
    if (bloccatoPrima !== (Notification.permission === 'denied')) mostraStatoNotifiche();
  }
  document.addEventListener('visibilitychange', controllaPermessoTornando);
  window.addEventListener('focus', controllaPermessoTornando);
  window.addEventListener('pageshow', controllaPermessoTornando);
  if (pulsanteNotifiche) {
    mostraStatoNotifiche();
    pulsanteNotifiche.addEventListener('click', function () {
      if (!('Notification' in window)) return;
      const permesso = Notification.permission;
      if (permesso === 'denied') { mostraStatoNotifiche(); return; }
      if (permesso === 'granted' && avvisiVoluti()) { // acceso → spegni
        ricordaAvvisi(false);
        disiscriviPush().then(mostraStatoNotifiche);
        mostraStatoNotifiche();
        return;
      }
      if (permesso === 'granted') { accendiAvvisi(); return; }
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') accendiAvvisi(); else mostraStatoNotifiche();
      });
    });
  }


  // Ordine in consegna: attende la consegna. La segna il corriere dal gruppo WhatsApp (l'installatore non ha nessun pulsante): la pagina chiede ogni 8 secondi se l'ordine
  // risulta consegnato (GET /api/ordini/:id/consegnato) e, appena è così, si ricarica e il server disegna la pagina "Consegnato". Controlla anche appena la pagina torna in
  // primo piano (telefono sbloccato, scheda riaperta). Mai più di una richiesta alla volta; un errore di rete si ignora e si riprova al giro dopo.
  const attendeConsegna = document.querySelector('[data-attendi-consegna]');
  // Il server avvisa la pagina da sé (Server-Sent Events, GET /api/eventi, src/logica/notifiche/eventi.js): appena il corriere segna la consegna la pagina dell'ordine si ricarica ("Consegnato")
  // e l'icona e la scheda "Stato ordini" si rileggono (evento 'minuteria:stato-ordini', lo ascolta partials/cliente/nav_ordini.ejs). Niente richieste a vuoto. Il controllo qui sotto resta
  // solo come rete di sicurezza (una volta al minuto, e quando la pagina torna in primo piano o la connessione si riapre dopo una caduta), per il caso in cui l'evento nasca in un
  // altro processo o la connessione sia caduta senza che il browser se ne accorga.
  let aggiornaConsegna = function () {};
  if ('EventSource' in window && document.body && document.body.dataset.loggato === '1' && (attendeConsegna || document.querySelector('a.nav-ordini'))) {
    let sorgente = null;
    let apertaGiaUnaVolta = false;
    const apri = function () {
      if (sorgente) return;
      sorgente = new EventSource('/api/eventi');
      sorgente.addEventListener('open', function () {
        if (apertaGiaUnaVolta) { // riaperta dopo una caduta: si guarda cosa è successo nel frattempo
          aggiornaConsegna();
          window.dispatchEvent(new Event('minuteria:orari'));
        }
        apertaGiaUnaVolta = true;
      });
      // Il banco ha cambiato gli orari (anagrafica_banco.salvaOrari): il carrello e la pagina degli orari si rileggono (blocco "Orari del banco in tempo reale").
      sorgente.addEventListener('orari', function () { window.dispatchEvent(new Event('minuteria:orari')); });
      sorgente.addEventListener('consegnato', function (e) {
        let ordine = null;
        try { ordine = JSON.parse(e.data).ordine; } catch (err) { /* messaggio rovinato: basta rileggere lo stato */ }
        if (attendeConsegna && String(ordine) === attendeConsegna.getAttribute('data-attendi-consegna')) { window.location.reload(); return; }
        window.dispatchEvent(new Event('minuteria:stato-ordini'));
      });
    };
    apri();
    // La pagina che va in cache per il tasto "indietro" chiude la connessione e la riapre quando riappare.
    window.addEventListener('pagehide', function () { if (sorgente) { sorgente.close(); sorgente = null; } });
    window.addEventListener('pageshow', function (e) { if (e.persisted) apri(); });
  }
  if (attendeConsegna) {
    const idOrdine = attendeConsegna.getAttribute('data-attendi-consegna');
    let inCorso = false;
    let finito = false;
    const controlla = function () {
      if (inCorso || finito || document.visibilityState === 'hidden') return;
      inCorso = true;
      fetch('/api/ordini/' + encodeURIComponent(idOrdine) + '/consegnato', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.consegnato) { finito = true; window.location.reload(); }
        })
        .catch(function () { /* niente rete: al prossimo giro */ })
        .then(function () { inCorso = false; });
    };
    aggiornaConsegna = controlla;
    setInterval(controlla, 60000);
    document.addEventListener('visibilitychange', controlla);
    window.addEventListener('pageshow', controlla);
  }

  // Un messaggio dal service worker (public/sw.js): è stata toccata una notifica ma la finestra non si è lasciata portare sulla pagina ("vai": ci va da sola,
  // solo dentro il sito).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (evento) {
      const dati = evento.data || {};
      if (dati.tipo === 'vai' && typeof dati.url === 'string') {
        try {
          const url = new URL(dati.url, window.location.href);
          if (url.origin === window.location.origin) window.location.href = url.href;
        } catch (err) { /* indirizzo rovinato: si resta dove si è */ }
      }
    });
  }

  // Sulle pagine del banco (intestazione [data-banco-testa]) le notifiche le gestisce il blocco "Avvisi del banco", in fondo a questo file.
  if ('Notification' in window && document.body.dataset.loggato === '1' && !document.querySelector('[data-banco-testa]')) {
    // Chi ha già dato il permesso è iscritto alle push su ogni dispositivo che usa (primo accesso dopo l'aggiornamento, nuovo login, chiavi cambiate): si controlla a ogni
    // apertura, senza chiamate al server se è già tutto a posto (il confronto è col <meta name="push-endpoint">).
    if (Notification.permission === 'granted' && avvisiVoluti() && !pulsanteNotifiche) window.addEventListener('load', function () { iscriviPush(); }); // dove c'è la scheda "Sul telefono" lo fa già lei

    // Per i browser senza push (e come rete di sicurezza se una push non arriva): il server si interroga ogni 5 secondi SOLO mentre c'è una richiesta in attesa
    // (l'icona "Stato ordini" in fase "richiesta"), cioè da quando si invia l'ordine a quando un banco accetta o nessuno risponde; più un ultimo controllo appena
    // finita, per prendere la notifica di chiusura. Senza richieste in corso non parte NESSUNA chiamata (il timer da 5 s è solo locale, non tocca la rete).
    // Con l'app in primo piano le notifiche lette qui si scartano senza mostrarle (si vede già tutto: la pagina della richiesta si aggiorna da sola e porta
    // all'ordine); con la scheda in secondo piano (o nascosta) arrivano come notifiche di sistema. Con le push attive di norma qui non c'è niente: sono già
    // arrivate dal servizio push e il server le ha segnate come mostrate.
    let eraAttiva = false;
    setInterval(function () {
      if (Notification.permission !== 'granted' || !avvisiVoluti()) return;
      const attiva = !!document.querySelector('.navbar .fase-richiesta, .navbar [data-fasi*="richiesta"]');
      if (!attiva && !eraAttiva) return;
      eraAttiva = attiva;
      fetch('/api/notifiche/push')
        .then(leggiJson)
        .then(function (dati) {
          if (document.visibilityState === 'visible') return; // in primo piano: nessuna notifica
          (dati.notifiche || []).forEach(function (n) { mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id); });
        })
        .catch(function () { /* nessuna notifica questo giro */ });
    }, 5000);
  }
})();

