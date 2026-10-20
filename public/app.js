/* Comportamenti lato client dell'app cliente: selettori quantità, ricerca parziale
   mentre si digita, countdown della finestra di 10 minuti e notifiche del browser. */

/* Pezzi condivisi fra i blocchi di questo file (ognuno vive nel suo scope). */
const Minuteria = (function () {
  'use strict';

  // Stesso tetto del server (src/input.js): una quantità oltre non ha senso per un articolo di minuteria.
  const QUANTITA_MASSIMA = 9999;

  function limitaQuantita(n) {
    return Math.min(QUANTITA_MASSIMA, Math.max(0, n));
  }

  // Legge la risposta JSON di una chiamata a /api/...: con la sessione scaduta il server risponde 401 e si
  // torna al login (prima il redirect finiva in una pagina HTML e `.json()` andava in errore, senza alcun
  // messaggio). L'errore lanciato porta sessioneScaduta = true, così chi chiama non mostra anche un avviso.
  function leggiJson(risposta) {
    if (risposta.status === 401) {
      window.location.href = '/login';
      const errore = new Error('sessione scaduta');
      errore.sessioneScaduta = true;
      throw errore;
    }
    return risposta.json();
  }

  // Mostra una notifica di sistema. `new Notification(...)` esiste su desktop e iOS, ma Chrome per Android lo
  // rifiuta (TypeError): lì si passa dal service worker (/sw.js), che gestisce anche il tocco sulla notifica.
  function mostraNotifica(titolo, testo, link, tag) {
    try {
      const notifica = new Notification(titolo, { body: testo, tag: tag });
      if (link) {
        notifica.onclick = function () {
          window.focus();
          window.location.href = link;
        };
      }
      return;
    } catch (err) { /* si prova con il service worker */ }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then(function (registrazione) {
        return registrazione.showNotification(titolo, { body: testo, tag: tag, data: { link: link || '/' } });
      })
      .catch(function () { /* niente notifica: l'avviso resta comunque in "Stato ordini" */ });
  }

  // "8 min", "1 h 05": una durata in minuti come la scrive la home del banco (uguale a format.durataMinuti sul server).
  function durataMinuti(min) {
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  }

  // "meno di 1 min", "3 min", "1 h 05": quanto tempo è passato da quando il banco ha confermato ("Corriere avvisato · da 3 min",
  // sulla home e nel dettaglio della richiesta). Uguale a format.daMinuti.
  function daMinuti(secondi) {
    const min = Math.max(0, Math.floor(secondi / 60));
    return min < 1 ? 'meno di 1 min' : durataMinuti(min);
  }

  // "04:13" che sale, "1 h 05" oltre l'ora (cerchio dell'attesa del corriere). Uguale a format.tempoTrascorso.
  function tempoTrascorso(secondi) {
    const s = Math.max(0, Math.floor(secondi));
    if (s >= 3600) return durataMinuti(Math.floor(s / 60));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  return {
    QUANTITA_MASSIMA: QUANTITA_MASSIMA,
    limitaQuantita: limitaQuantita,
    leggiJson: leggiJson,
    mostraNotifica: mostraNotifica,
    durataMinuti: durataMinuti,
    daMinuti: daMinuti,
    tempoTrascorso: tempoTrascorso,
  };
})();

(function () {
  'use strict';

  const { QUANTITA_MASSIMA, limitaQuantita, leggiJson, mostraNotifica } = Minuteria;

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
      const apri = function () {
        zonaCampo.hidden = false;
        bottone.textContent = 'Fatto';
        campo.focus();
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

      // Posizione di consegna: se il dispositivo la dà, l'indirizzo si precompila da lì (geocodifica inversa, GET /api/indirizzo) e le sue coordinate partono con la
      // richiesta (dest_lat/dest_lng: da quelle il server calcola il tragitto del corriere). Se non c'è, il campo resta vuoto e l'indirizzo lo scrive l'installatore
      // (il server ne ricava la posizione). Appena si modifica il testo le coordinate si tolgono: non descrivono più quell'indirizzo. Non si paga senza un indirizzo.
      const form = campo.form;
      const destLat = consegna.querySelector('[data-dest-lat]');
      const destLng = consegna.querySelector('[data-dest-lng]');
      const posizione = consegna.querySelector('[data-consegna-pos]');
      const posizioneTesto = consegna.querySelector('[data-consegna-pos-testo]');
      const posizioneUsa = consegna.querySelector('[data-consegna-pos-usa]');
      if (form && destLat && destLng && posizione && posizioneTesto && posizioneUsa) {
        let daPosizione = ''; // l'indirizzo ricavato dalla posizione, per accorgersi che è stato cambiato
        const dice = function (testo, conPulsante, etichetta) {
          posizione.hidden = !testo;
          posizioneTesto.textContent = testo || '';
          posizioneUsa.hidden = !conPulsante;
          if (etichetta) posizioneUsa.textContent = etichetta;
        };
        campo.addEventListener('input', function () {
          if (campo.value.trim() !== daPosizione) { destLat.value = ''; destLng.value = ''; }
        });

        let incorso = false;
        const cercaPosizione = function (daClic) {
          if (incorso) return;
          if (!('geolocation' in navigator) || !window.isSecureContext) {
            if (daClic) dice('Il browser non legge la posizione su questa connessione: scrivi l’indirizzo.', false);
            return;
          }
          incorso = true;
          dice('Cerco la tua posizione…', false);
          navigator.geolocation.getCurrentPosition(function (p) {
            const lat = p.coords.latitude;
            const lng = p.coords.longitude;
            fetch('/api/indirizzo?lat=' + encodeURIComponent(lat) + '&lng=' + encodeURIComponent(lng))
              .then(leggiJson)
              .then(function (dati) {
                incorso = false;
                if (!dati || !dati.ok || !dati.indirizzo) {
                  dice('Ho trovato la posizione ma non l’indirizzo: scrivilo qui sopra.', true, 'Riprova');
                  return;
                }
                // Col clic si sostituisce quello che c'era; da sola la pagina non sovrascrive mai un indirizzo già scritto.
                if (campo.value.trim() && !daClic) { dice('', false); return; }
                campo.value = dati.indirizzo;
                daPosizione = dati.indirizzo;
                destLat.value = String(lat);
                destLng.value = String(lng);
                dice('', false);
                conferma();
              })
              .catch(function (errore) {
                incorso = false;
                if (!errore || !errore.sessioneScaduta) dice('Non riesco a ricavare l’indirizzo dalla posizione: scrivilo qui sopra.', true, 'Riprova');
              });
          }, function (errore) {
            incorso = false;
            if (errore && errore.code === 1) dice('Posizione non attiva: scrivi l’indirizzo, oppure attivala e tocca il pulsante.', true, 'Usa la mia posizione');
            else dice('Non riesco a leggere la posizione: scrivi l’indirizzo.', true, 'Riprova');
          }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        };
        posizioneUsa.addEventListener('click', function () { cercaPosizione(true); });

        // Senza indirizzo non si invia: il campo si apre e dice cosa manca. Il gestore del form sta sul form (prima di quello sul documento) e ferma la propagazione.
        form.addEventListener('submit', function (e) {
          if (campo.value.trim()) return;
          e.preventDefault();
          e.stopPropagation();
          apri();
          dice('Scrivi l’indirizzo di consegna (o attiva la posizione) per poter pagare.', true, 'Usa la mia posizione');
        });

        if (!campo.value.trim()) cercaPosizione(false);
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
  // (deve restare uguale a views/partials/misura.ejs).
  const SOGLIA_CHIP = 2;
  const FRECCIA_MISURA = '<svg class="misura-freccia" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // Blocco "Misura" di un prodotto con varianti (occhiello + chip o pulsante) e l'attributo con i dati delle
  // varianti: condivisi fra la card classica e la riga compatta della categoria. Le etichette arrivano già
  // scritte come misure ("108 × 60 × 44 cm") dal server (catalogo.etichettaVariante), qui non si rifanno.
  // Deve restare uguale a views/partials/misura.ejs.
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
  // views/partials/prodotto_riga.ejs e deve restare uguale a rigaCompattaHtml qui sotto). Il numero
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
  // La prima pagina arriva già renderizzata dal server (partials/paginazione fa da
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

  // Il pulsante "Attiva" della scheda "Sul telefono" del profilo (views/profilo.ejs): chiede il permesso con un clic e dice com'è messa la cosa. Gli avvisi
  // arrivano però solo finché l'app (o la scheda) è aperta: il controllo qui sotto gira ogni 10 secondi nella pagina, non c'è ancora una notifica che
  // arrivi a telefono chiuso (servirebbe Web Push: chiavi VAPID e un archivio delle iscrizioni).
  const pulsanteNotifiche = document.querySelector('[data-abilita-notifiche]');
  const statoNotifiche = document.querySelector('[data-notifiche-stato]');
  const schedaNotifiche = document.querySelector('[data-notifiche-scheda]');
  function mostraStatoNotifiche() {
    if (!pulsanteNotifiche) return;
    if (!('Notification' in window)) { if (schedaNotifiche) schedaNotifiche.hidden = true; return; } // browser senza notifiche: niente scheda
    const permesso = Notification.permission;
    pulsanteNotifiche.hidden = permesso !== 'default';
    if (!statoNotifiche) return;
    if (permesso === 'granted') statoNotifiche.textContent = "Attivi: ti avvisiamo quando un banco risponde, finché l'app è aperta.";
    else if (permesso === 'denied') statoNotifiche.textContent = 'Bloccati dal browser: riattivali dalle impostazioni del sito.';
  }
  if (pulsanteNotifiche) {
    mostraStatoNotifiche();
    pulsanteNotifiche.addEventListener('click', function () {
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') mostraNotifica('Avvisi attivi', 'Ti avviseremo quando i distributori rispondono.', null, 'minuteria-attive');
        mostraStatoNotifiche();
      });
    });
  }

  // Sulle pagine del banco (intestazione [data-banco-testa]) le notifiche le gestisce il blocco "Avvisi del banco", in fondo a questo file.
  if ('Notification' in window && document.body.dataset.loggato === '1' && !document.querySelector('[data-banco-testa]')) {
    setInterval(function () {
      if (Notification.permission !== 'granted') return;
      fetch('/api/notifiche/push')
        .then(leggiJson)
        .then(function (dati) {
          (dati.notifiche || []).forEach(function (n) {
            mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id);
          });
        })
        .catch(function () { /* nessuna notifica questo giro */ });
    }, 10000);
  }
})();

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

/* Sconti a scalare: mostra lo sconto effettivo mentre il banco scrive gli scaglioni. */
(function () {
  'use strict';

  const righe = document.querySelectorAll('[data-riga-sconti]');
  if (!righe.length) return;

  function calcola(riga) {
    const campi = riga.querySelectorAll('[data-scaglione]');
    let residuo = 1;
    let almenoUno = false;

    campi.forEach(function (c) {
      const n = parseFloat(String(c.value).replace(',', '.'));
      if (Number.isFinite(n) && n > 0) {
        residuo *= 1 - Math.min(90, n) / 100;
        almenoUno = true;
      }
    });

    const box = riga.querySelector('[data-effettivo]');
    const valore = riga.querySelector('[data-valore-effettivo]');
    if (!box || !valore) return;

    if (!almenoUno) {
      box.setAttribute('hidden', '');
      return;
    }
    valore.textContent = String(Math.round((1 - residuo) * 1000) / 10).replace('.', ',');
    box.removeAttribute('hidden');
  }

  righe.forEach(function (riga) {
    riga.addEventListener('input', function (e) {
      if (e.target.matches('[data-scaglione]')) calcola(riga);
    });
    calcola(riga);
  });
})();

/* Menu del profilo in alto a destra: dentro ci sta anche l'uscita. Il cliente ha un pannello con un velo scuro
   dietro (partials/appbar.ejs), banco e agente una tendina. Il pannello del cliente sta fuori dall'appbar, quindi
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

/* Home del banco (bacheca a 3 colonne, views/distributore_richieste.ejs): fa muovere timer ed etichette a tempo.
   Ogni valore parte da quanti secondi mancano (o sono passati) quando il server ha disegnato la pagina, trasformati
   in un istante con l'orologio del browser: un conteggio non perde colpi se la scheda resta in secondo piano (i
   timer delle schede nascoste vengono rallentati) e l'orologio del PC, magari sfasato, non conta.
   - richiesta da confermare: anello che si svuota e mm:ss; rosso negli ultimi minuti (data-soglia-urgente); etichetta
     "Nuova" per i primi minuti; allo scadere la scheda si spegne e la pagina si ricarica (la richiesta non c'è più);
   - corriere avvisato: "da N min", da quando il banco ha confermato;
   - ordine da preparare: minuti all'arrivo del corriere, rossi sotto i data-soglia-arrivo minuti.
   Le soglie le scrive il server (BACHECA in server.js): le stesse che ha usato per le classi iniziali. */
(function () {
  'use strict';
  const bacheca = document.querySelector('[data-bacheca]');
  if (!bacheca) return;

  const sogliaUrgente = parseInt(bacheca.getAttribute('data-soglia-urgente'), 10) || 180;
  const sogliaArrivo = parseInt(bacheca.getAttribute('data-soglia-arrivo'), 10) || 15;
  const avvio = Date.now();

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

  const richieste = Array.prototype.map.call(bacheca.querySelectorAll('[data-richiesta]'), function (el) {
    const anello = el.querySelector('[data-anello]');
    const circ = anello ? parseFloat(anello.getAttribute('stroke-dasharray')) : 0;
    return {
      el: el,
      anello: anello,
      circ: circ,
      tempo: el.querySelector('[data-tempo]'),
      nuova: el.querySelector('[data-nuova]'),
      fine: avvio + numero(el, 'data-secondi') * 1000,
      finestra: Math.max(1, numero(el, 'data-finestra')),
      nuovaFine: avvio + numero(el, 'data-nuova-sec') * 1000,
      chiusa: false,
    };
  });

  const corrieri = Array.prototype.map.call(bacheca.querySelectorAll('[data-corriere]'), function (el) {
    return { el: el, da: el.querySelector('[data-da]'), inizio: avvio - numero(el, 'data-trascorsi') * 1000 };
  });

  const arrivi = Array.prototype.map.call(bacheca.querySelectorAll('[data-arrivo]'), function (el) {
    return { el: el, min: el.querySelector('[data-arrivo-min]'), fine: avvio + numero(el, 'data-secondi') * 1000 };
  });

  if (!richieste.length && !corrieri.length && !arrivi.length) return;

  function tick() {
    const adesso = Date.now();

    richieste.forEach(function (r) {
      const sec = Math.max(0, Math.ceil((r.fine - adesso) / 1000));
      scrivi(r.tempo, mmss(sec));
      if (r.anello) r.anello.style.strokeDashoffset = String((r.circ * (1 - Math.min(1, sec / r.finestra))).toFixed(2));
      r.el.classList.toggle('urgente', sec <= sogliaUrgente);
      if (r.nuova && adesso >= r.nuovaFine) {
        r.nuova.remove();
        r.nuova = null;
      }
      if (sec === 0 && !r.chiusa) {
        // La richiesta è scaduta: sparirà dalla colonna con la ricarica (la pagina si accorgerebbe da sola entro
        // pochi secondi, ma così la scheda non resta lì a contare zero).
        r.chiusa = true;
        r.el.classList.remove('urgente');
        r.el.classList.add('scaduta');
        setTimeout(function () { window.location.reload(); }, 2500);
      }
    });

    corrieri.forEach(function (c) {
      scrivi(c.da, Minuteria.daMinuti((adesso - c.inizio) / 1000));
    });

    arrivi.forEach(function (a) {
      const min = Math.ceil((a.fine - adesso) / 60000);
      scrivi(a.min, min <= 0 ? 'In ritardo' : durata(min));
      a.el.classList.toggle('vicino', min <= sogliaArrivo);
    });
  }

  tick();
  setInterval(tick, 1000);
})();

/* Dettaglio di una richiesta al banco (views/distributore_dettaglio.ejs). Due tempi, in due stati diversi:
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

/* Pagina dell'ordine del banco (views/distributore_ordine.ejs): "Stampa" (in stampa la pagina mostra solo testata e materiale, vedi @media print di style.css;
   c'è solo dopo la partenza dell'ordine). */
(function () {
  'use strict';
  const pagina = document.querySelector('[data-ordine-banco]');
  if (!pagina) return;

  const stampa = pagina.querySelector('[data-stampa]');
  if (stampa) stampa.addEventListener('click', function () { window.print(); });
})();

/* Impedisce il doppio invio dei form che cambiano stato (conferma ordine, risposta del
   banco, elimina...): un doppio tap — frequente su rete lenta da cantiere, quando non si
   vede subito una reazione — poteva mandare due POST identiche in rapida successione.
   Il server si difende comunque (la richiesta passa a 'ordinata' una volta sola, vedi
   creaOrdineDaRisposta in src/flusso_cliente.js), ma è meglio non generarla nemmeno la seconda richiesta. Generico: si applica a ogni <form> dell'app,
   non solo a quello dell'ordine. */
document.addEventListener('submit', function (e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const bottoni = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  if (!bottoni.length) return;
  // Il ritardo di un tick lascia al browser il tempo di leggere quale bottone è stato
  // premuto (nome/valore) prima di disabilitarlo: alcuni form hanno più bottoni di invio
  // diversi (es. "Conferma" / "Rifiuta") e disabilitarli subito, in modo sincrono, rischia
  // di far perdere quale dei due ha davvero avviato l'invio.
  setTimeout(function () {
    bottoni.forEach(function (b) {
      // Solo quelli attivi: un pulsante già disabilitato dal server (es. "Paga" sotto il minimo) deve restarlo.
      if (b.disabled) return;
      b.disabled = true;
      b.setAttribute('data-bloccato-da-invio', '');
    });
  }, 0);
}, true);

/* Tornando con "indietro" dopo un invio (anche finito con un errore) il browser può rimostrare la pagina
   com'era, con i pulsanti ancora bloccati: si riattivano. */
window.addEventListener('pageshow', function (e) {
  if (!e.persisted) return;
  document.querySelectorAll('[data-bloccato-da-invio]').forEach(function (b) {
    b.disabled = false;
    b.removeAttribute('data-bloccato-da-invio');
  });
});

/* Pagine del banco (home, storico ordini, clienti, dettaglio richiesta): richieste e ordini
   appena arrivati compaiono senza premere F5. Ogni pochi secondi chiede al server due numeri
   leggeri (/api/distributore/novita) e li confronta con quelli con cui la pagina è stata disegnata
   (data-versione): se sono cambiati si ricarica. Non dipende da una ricarica a tempo, che si salta
   quando la scheda è in secondo piano. Se la scheda è nascosta o l'utente sta scrivendo in un
   campo aspetta, e ricarica appena torna in primo piano o esce dal campo. */
(function () {
  'use strict';
  const ms = parseInt(document.body.dataset.autoRefresh, 10);
  if (!ms) return;

  const versionePagina = document.body.dataset.versione || null;
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

  function ricarica() {
    if (document.hidden || suCampo()) {
      daRicaricare = true;
      return;
    }
    window.location.reload();
  }

  function riprendi() {
    if (daRicaricare && !document.hidden && !suCampo()) window.location.reload();
  }

  function controlla() {
    if (inCorso) return;
    inCorso = true;
    fetch('/api/distributore/novita', { cache: 'no-store', credentials: 'same-origin' })
      .then(Minuteria.leggiJson)
      .then(function (d) {
        erroriDiFila = 0;
        if (versionePagina !== null && JSON.stringify(d) !== versionePagina) ricarica();
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

/* Storico ordini del banco: OGNI riga si apre nella stessa pagina e mostra il dettaglio sotto di sé (views/distributore_storico.ejs). La riga è un <button>
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

/* Password con l'occhio (partials/acc_campo.ejs): il pulsante parte nascosto, perché senza script non farebbe niente.
   Mostra o nasconde il testo del campo accanto e aggiorna etichetta e stato per chi usa uno screen reader. */
(function () {
  'use strict';
  const pulsanti = document.querySelectorAll('[data-mostra-password]');
  if (!pulsanti.length) return;
  pulsanti.forEach(function (pulsante) {
    pulsante.hidden = false;
    pulsante.addEventListener('click', function () {
      const campo = pulsante.parentNode.querySelector('input');
      if (!campo) return;
      const mostra = campo.type === 'password';
      campo.type = mostra ? 'text' : 'password';
      pulsante.setAttribute('aria-pressed', mostra ? 'true' : 'false');
      pulsante.setAttribute('aria-label', mostra ? 'Nascondi password' : 'Mostra password');
    });
  });
})();

/* Registrazione a passi (views/registrati.ejs): un solo modulo diviso in tre fieldset, qui se ne mostra uno alla volta.
   "Avanti" controlla solo i campi del passo corrente (la validazione vera resta sul server); dopo un errore del server
   la pagina arriva già sul primo passo sbagliato (data-passo-iniziale). Senza script i tre blocchi restano tutti
   visibili e il modulo funziona come un modulo qualunque. */
(function () {
  'use strict';
  const radice = document.querySelector('[data-registrazione]');
  if (!radice) return;
  const form = radice.querySelector('[data-reg-form]');
  const passi = Array.prototype.slice.call(radice.querySelectorAll('[data-reg-passo]'));
  const segmenti = radice.querySelectorAll('.reg-avanzamento span');
  const avanti = radice.querySelector('[data-reg-avanti]');
  const indietro = radice.querySelector('[data-reg-indietro]');
  if (!form || passi.length < 2 || !avanti) return;

  const ultimo = passi.length - 1;
  let corrente = Math.min(passi.length, Math.max(1, Number(radice.getAttribute('data-passo-iniziale')) || 1)) - 1;

  // Un fieldset nascosto con un campo non valido farebbe fallire l'invio del browser senza un messaggio ("campo non
  // focalizzabile"): i controlli li facciamo noi, passo per passo, prima dell'invio.
  form.noValidate = true;
  radice.setAttribute('data-passi', 'attivi');

  function campiDel(indice) {
    return Array.prototype.slice.call(passi[indice].querySelectorAll('input, select, textarea'));
  }

  // Primo campo non valido del passo, o null.
  function primoSbagliato(indice) {
    return campiDel(indice).find(function (campo) { return !campo.checkValidity(); }) || null;
  }

  function mostra(indice, conFocus) {
    corrente = indice;
    passi.forEach(function (passo, i) { passo.hidden = i !== indice; });
    segmenti.forEach(function (segmento, i) { segmento.classList.toggle('fatto', i <= indice); });
    avanti.textContent = indice === ultimo ? "Crea l'anagrafica" : 'Avanti';
    if (conFocus) {
      window.scrollTo(0, 0);
      const primo = campiDel(indice).find(function (campo) { return campo.type !== 'radio'; });
      if (primo) primo.focus({ preventScroll: true });
    }
  }

  // Mostra il passo e fa uscire il messaggio del browser sul campo sbagliato.
  function segnala(indice, campo) {
    if (indice !== corrente) mostra(indice, false);
    campo.focus({ preventScroll: true });
    campo.reportValidity();
  }

  avanti.addEventListener('click', function (e) {
    if (corrente < ultimo) {
      e.preventDefault();
      const sbagliato = primoSbagliato(corrente);
      if (sbagliato) return segnala(corrente, sbagliato);
      return mostra(corrente + 1, true);
    }
    // Ultimo passo: prima di inviare si controllano tutti, e si torna sul primo che ha un problema.
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  // Rete di sicurezza (invio con Invio da un campo, o da script): non deve partire un modulo con un passo sbagliato.
  form.addEventListener('submit', function (e) {
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  if (indietro) {
    indietro.addEventListener('click', function (e) {
      if (corrente > 0) {
        e.preventDefault();
        mostra(corrente - 1, false);
        window.scrollTo(0, 0);
      }
    });
  }

  mostra(corrente, false);
})();

/* Clienti del banco (/distributore/clienti): il campo "Cerca" filtra subito, nel browser, i clienti da approvare, gli
   approvati e i non riconosciuti. Ogni cliente ([data-cliente]) porta in data-cerca ragione sociale, partita IVA e
   codice cliente; senza badare alle maiuscole, ogni parola scritta deve comparire in uno dei tre. Una sezione senza
   corrispondenze sparisce, il numero accanto al titolo conta quelle rimaste e, se non resta niente, compare "Nessun
   cliente trovato.". Il campo non è dentro un form e non naviga: l'aggiornamento automatico del banco aspetta che
   si smetta di scrivere (vedi sopra). */
(function () {
  'use strict';
  const campo = document.querySelector('[data-cerca-clienti]');
  if (!campo) return;
  const sezioni = Array.prototype.slice.call(document.querySelectorAll('[data-sezione-clienti]'));
  const nessuno = document.querySelector('[data-cerca-nessuno]');

  function applica() {
    const parole = campo.value.toLowerCase().split(/\s+/).filter(Boolean);
    let visibili = 0;
    sezioni.forEach(function (sezione) {
      let nella = 0;
      sezione.querySelectorAll('[data-cliente]').forEach(function (voce) {
        const testo = (voce.getAttribute('data-cerca') || '').toLowerCase();
        const trovato = parole.every(function (p) { return testo.indexOf(p) !== -1; });
        voce.hidden = !trovato;
        if (trovato) nella += 1;
      });
      visibili += nella;
      sezione.hidden = parole.length > 0 && nella === 0;
      sezione.querySelectorAll('[data-conta-sezione]').forEach(function (conta) {
        conta.textContent = parole.length ? String(nella) : conta.getAttribute('data-totale');
      });
    });
    if (nessuno) nessuno.hidden = !(parole.length > 0 && visibili === 0);
  }

  campo.addEventListener('input', applica);
  // Tornando con "indietro" il browser può rimettere il testo nel campo: l'elenco va riallineato.
  window.addEventListener('pageshow', applica);
  applica();
})();

/* Striscia degli ordini in corso (partials/striscia_ordini.ejs). Con 4 o più schede la striscia scorre di lato: al caricamento si porta in
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

/* Installa l'app (views/partials/installa.ejs, nella home e nel profilo). Le schede [data-installa] sono nascoste e qui si mostrano solo se si può installare:
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

/* Avvisi del banco (richiesta esplicita del 20/10/2026), su TUTTE le pagine con l'intestazione del banco (partials/banco_testa.ejs, [data-banco-testa]).
   Servono quando nessuno sta guardando la home: lì le tre colonne mostrano già tutto. Tre livelli, più la scheda del browser e il suono:
   1. pallino arancio col numero di richieste da confermare sulla scheda "Banco" (anche sulla home);
   2. striscia arancio sotto l'intestazione (partials/banco_avviso.ejs): "2 richieste da confermare · la prima scade tra 01:38" (non sulla home);
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
   5. suono breve (public/suoni/avviso.mp3) per nuova richiesta e corriere trovato, sbloccato dal primo clic sulla pagina. Gli interruttori "Suoni" e
      "Notifiche del computer" stanno nella scheda Notifiche della pagina "Anagrafica del banco" (non più nella tendina dell'account); localStorage.
   Dati: GET /distributore/stato-banco ogni 15 s (e subito quando arriva una notifica) per numeri, richieste ancora aperte e ordini da preparare; GET /api/notifiche/push ogni 5 s
   per le notifiche nuove (src/banco_avvisi.js). Una richiesta che non c'è più nell'elenco (risposta di un collega, scaduta, annullata) fa sparire il suo avviso.
   Questo blocco sostituisce, sulle pagine del banco, quello delle notifiche del browser qui sopra. */
(function () {
  'use strict';
  const testa = document.querySelector('[data-banco-testa]');
  if (!testa) return;

  const { leggiJson, mostraNotifica } = Minuteria;
  // La home del banco è /distributore (le colonne mostrano già tutto: lì niente striscia né avvisi a comparsa); è la stessa regola di partials/banco_testa.ejs.
  const eHome = window.location.pathname.replace(/\/+$/, '') === '/distributore';
  const ditta = testa.getAttribute('data-ditta') || '';
  const titoloNormale = document.title;
  const SOGLIA_URGENTE_SEC = 120; // come src/richiesta_banco.js: negli ultimi 2 minuti tempi e anelli diventano rossi
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

  // ---------- Suono ----------

  let suoniAttivi = leggi('localStorage', CHIAVE_SUONI) !== 'no';
  let audio = null;
  function preparaAudio() {
    if (audio) return audio;
    try { audio = new Audio('/suoni/avviso.mp3'); audio.preload = 'auto'; } catch (e) { audio = null; }
    return audio;
  }
  // Il browser blocca l'audio finché l'utente non ha interagito con la pagina: al primo clic (o tasto) si riproduce il suono in silenzio, così da lì in poi
  // può partire da solo (Safari lo vuole nello stesso gesto).
  function sbloccaAudio() {
    document.removeEventListener('pointerdown', sbloccaAudio, true);
    document.removeEventListener('keydown', sbloccaAudio, true);
    const a = preparaAudio();
    if (!a) return;
    try {
      a.muted = true;
      const p = a.play();
      const fine = function () { try { a.pause(); a.currentTime = 0; } catch (e) { /* niente */ } a.muted = false; };
      if (p && typeof p.then === 'function') p.then(fine, function () { a.muted = false; }); else fine();
    } catch (e) { /* niente suono */ }
  }
  document.addEventListener('pointerdown', sbloccaAudio, true);
  document.addEventListener('keydown', sbloccaAudio, true);

  function suono() {
    if (!suoniAttivi) return;
    const a = preparaAudio();
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* audio ancora bloccato: nessun clic su questa pagina */ });
    } catch (e) { /* niente suono */ }
  }

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

  const interruttoreSistema = document.querySelector('[data-notifiche-sistema]');
  const notaSistema = document.querySelector('[data-notifiche-nota]');
  function mostraInterruttoreSistema() {
    if (!interruttoreSistema) return;
    const supportate = 'Notification' in window;
    interruttoreSistema.setAttribute('aria-checked', notificheSistemaConsentite() ? 'true' : 'false');
    if (!notaSistema) return;
    // Permesso negato: l'interruttore resta spento e dice come sbloccarlo (solo il browser può farlo).
    const bloccate = supportate && Notification.permission === 'denied';
    notaSistema.hidden = supportate && !bloccate;
    notaSistema.textContent = !supportate ? 'Questo browser non supporta le notifiche.' : bloccate ? 'Bloccate dal browser: riattivale dalle impostazioni del sito' : '';
  }
  mostraInterruttoreSistema();
  if (interruttoreSistema) {
    interruttoreSistema.addEventListener('click', function () {
      if (!('Notification' in window)) return;
      if (notificheSistemaConsentite()) { scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'no'); mostraInterruttoreSistema(); return; }
      if (Notification.permission === 'granted') { scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'sì'); mostraInterruttoreSistema(); return; }
      if (Notification.permission === 'denied') { mostraInterruttoreSistema(); return; }
      Notification.requestPermission().then(function (permesso) {
        if (permesso === 'granted') {
          scrivi('localStorage', CHIAVE_NOTIFICHE_SISTEMA, 'sì');
          mostraNotifica('Notifiche attive', 'Ti avviseremo quando arrivano richieste e ordini.', null, 'minuteria-attive');
        }
        mostraInterruttoreSistema();
      });
    });
  }

  // Email per ogni nuova richiesta: salva subito (la riga c'è solo quando esiste l'invio, vedi views/distributore_anagrafica.ejs). Se il salvataggio
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
    if (!document.hidden) { aggiornaStato(); daiPush(); }
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
    if (sorgente) span.innerHTML = sorgente.innerHTML; // markup scritto dal server (src/icone.js), mai testo di un utente
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

  let pushInCorso = false;
  function daiPush() {
    if (pushInCorso) return;
    pushInCorso = true;
    fetch('/api/notifiche/push', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(leggiJson)
      .then(function (d) {
        const nuove = ((d && d.notifiche) || []).filter(function (n) { return !(n.eta_sec > NOTIFICA_VECCHIA_SEC); });
        if (!nuove.length) return;
        let suonare = false;
        let aggiornare = false;
        nuove.forEach(function (n) {
          // Notifica di sistema: solo se la pagina è nascosta (se si vede basta l'avviso a comparsa, per non avvisare due volte).
          if (document.hidden && notificheSistemaConsentite()) mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id);
          const sullaPagina = n.link && window.location.pathname === n.link.split('?')[0];
          switch (n.tipo) {
            case 'nuova_richiesta':
              if (!n.richiesta) break; // già risposta o scaduta: niente da fare
              aggiornare = true;
              suonare = true;
              if (!eHome && !sullaPagina) schedaRichiesta(n.richiesta, [n.id], false);
              else if (sullaPagina) segnaLette([n.id], n.request_id, null); // sulla pagina di quella richiesta c'è già tutto: letta
              break;
            case 'corriere_trovato':
              if (!n.ordine || !n.ordine.daPreparare) break;
              aggiornare = true;
              suonare = true;
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
        if (suonare) suono();
        if (aggiornare) aggiornaStato();
      })
      .catch(function () { /* nessuna notifica questo giro */ })
      .then(function () { pushInCorso = false; });
  }

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

  mostraNumeri(daConfermare, null);
  aggiornaStato();
  setTimeout(daiPush, 800);
  setInterval(aggiornaStato, STATO_MS);
  setInterval(daiPush, PUSH_MS);
  window.addEventListener('online', function () { aggiornaStato(); daiPush(); });
  // Tornando con "indietro" il browser può rimostrare la pagina com'era: gli avvisi vanno rifatti da capo.
  window.addEventListener('pageshow', function (e) { if (e.persisted) window.location.reload(); });
})();


/* Anagrafica del banco (views/distributore_anagrafica.ejs, richiesta esplicita del 20/10/2026). Ogni scheda ([data-scheda]) ha la sua lettura
   ([data-lettura]) e il suo modulo ([data-modulo], nascosto): "Modifica" li scambia, "Annulla" torna alla lettura. Se la pagina è arrivata con una scheda già
   aperta (errori di un salvataggio, o ?modifica=...: [data-aperta]) "Annulla" è il link vero che ricarica la pagina, così spariscono anche errori e valori
   scritti. Senza JavaScript "Modifica" e "Annulla" restano collegamenti normali. Orari: l'interruttore aperto/chiuso di ogni giorno accende o spegne i suoi
   campi, "sempre aperto" li spegne tutti, "Copia su tutti i giorni feriali" copia il lunedì su martedì-venerdì. */
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
    const sempre = moduloOrari.querySelector('[data-sempre-aperto]');
    const giorni = Array.prototype.slice.call(moduloOrari.querySelectorAll('[data-giorno]'));

    function campiDelGiorno(giorno) { return Array.prototype.slice.call(giorno.querySelectorAll('[data-fasce] input')); }
    function aggiornaGiorno(giorno) {
      const aperto = giorno.querySelector('[data-aperto]');
      const testo = giorno.querySelector('[data-aperto-testo]');
      const spento = !!(sempre && sempre.checked);
      if (aperto) aperto.disabled = spento;
      if (testo) testo.textContent = aperto && aperto.checked ? 'Aperto' : 'Chiuso';
      const apertoOra = !spento && aperto && aperto.checked;
      campiDelGiorno(giorno).forEach(function (c) { c.disabled = !apertoOra; });
      giorno.classList.toggle('ab-giorno-chiuso', !apertoOra);
    }
    function aggiornaOrari() { giorni.forEach(aggiornaGiorno); }
    moduloOrari.aggiornaOrari = aggiornaOrari; // lo richiama "Annulla" dopo il reset del modulo
    giorni.forEach(function (giorno) {
      const aperto = giorno.querySelector('[data-aperto]');
      if (aperto) aperto.addEventListener('change', function () { aggiornaGiorno(giorno); });
    });
    if (sempre) sempre.addEventListener('change', aggiornaOrari);
    aggiornaOrari();

    // Il lunedì su martedì-venerdì: stato aperto/chiuso e le quattro ore (i giorni in cui non conta restano com'erano).
    const copia = moduloOrari.querySelector('[data-copia-feriali]');
    if (copia) {
      copia.addEventListener('click', function () {
        const lunedi = moduloOrari.querySelector('[data-giorno="lun"]');
        if (!lunedi) return;
        const daCopiare = Array.prototype.slice.call(lunedi.querySelectorAll('input')).map(function (c) { return c.type === 'checkbox' ? c.checked : c.value; });
        ['mar', 'mer', 'gio', 'ven'].forEach(function (g) {
          const giorno = moduloOrari.querySelector('[data-giorno="' + g + '"]');
          if (!giorno) return;
          Array.prototype.slice.call(giorno.querySelectorAll('input')).forEach(function (c, i) {
            if (c.type === 'checkbox') c.checked = daCopiare[i]; else c.value = daCopiare[i];
          });
        });
        aggiornaOrari();
      });
    }
  }
})();
