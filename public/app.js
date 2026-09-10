/* Comportamenti lato client dell'app cliente: selettori quantità, ricerca parziale
   mentre si digita, countdown della finestra di 10 minuti e notifiche del browser. */
(function () {
  'use strict';

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

  function ricalcolaBarra() {
    let pendenti = 0;
    document.querySelectorAll('input[data-qta]').forEach(function (i) {
      pendenti += Math.max(0, parseInt(i.value, 10) || 0);
    });
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
    input.value = Math.max(0, (parseInt(input.value, 10) || 0) + passo);
    ricalcolaBarra();
  });

  document.addEventListener('input', function (e) {
    if (e.target.matches('input[data-qta]')) ricalcolaBarra();
  });

  ricalcolaBarra();

  // Click Aggiungi globale -> raccoglie tutti gli stepper con qty>0 e invia batch
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-aggiungi-tutti]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    const items = [];
    document.querySelectorAll('input[data-qta]').forEach(function (inp) {
      const q = Math.max(0, parseInt(inp.value, 10) || 0);
      if (q > 0) {
        const id = inp.getAttribute('data-prodotto-qta');
        if (id) items.push({ id: id, qty: q });
      }
    });
    if (!items.length) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    fetch('/api/carrello/aggiungi-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.errore || 'errore');
        // reset tutti gli stepper a 0
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
      .catch(function () {
        btn.textContent = old;
        btn.disabled = false;
        window.alert('Non è stato possibile aggiungere al carrello.');
      });
  });

  // ---------- Carrello: modifica quantità e rimozione ----------
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
    const nuovo = Math.max(1, (parseInt(input.value, 10) || 0) + passo);
    input.value = nuovo;
    const meno = stepper.querySelector('[data-passo-carrello="-1"]');
    if (meno) meno.disabled = nuovo <= 1;
    // aggiorna via API
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: nuovo }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        aggiornaBadgeCarrello(d.pezzi);
        window.location.reload();
      })
      .catch(function () { window.location.reload(); });
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

  document.addEventListener('input', function (e) {
    if (!e.target.matches('[data-qta-carrello-input]')) return;
    // l'utente digita: non inviamo subito, lascia il pulsante Aggiorna del form come fallback
  });

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
      '<input type="number" min="0" step="1" inputmode="numeric" data-qta data-prodotto-qta="' + id + '" value="0">' +
      '<button type="button" data-passo="1" aria-label="Aggiungi">+</button>' +
      '</div>' +
      '<div class="mini-carrello" data-nel-carrello="' + id + '" hidden><span>Nel carrello: <strong data-qta-carrello="' + id + '">0</strong> pz</span></div>' +
      '</div>'
    );
  }

  // Oltre questa soglia una riga di chip diventa una striscia troppo lunga da scorrere:
  // si passa a un menu a tendina, più compatto e più veloce da usare con tante misure.
  const SOGLIA_CHIP = 8;

  function cardProdottoHtml(p) {
    const barrato = p.sconto_base_pct > 0
      ? '<span class="barrato">€ ' + p.listino + '</span>'
      : '';
    const varianti = !p.varianti
      ? ''
      : p.varianti.length > SOGLIA_CHIP
      ? '<select class="selettore-variante" data-selettore-variante aria-label="Misura di ' + esc(p.nome) + '">' +
        p.varianti.map(function (v) {
          return '<option value="' + v.id + '"' + (v.id === p.id ? ' selected' : '') + '>' + esc(v.etichetta) + '</option>';
        }).join('') + '</select>'
      : '<div class="chip-riga varianti-riga">' +
        p.varianti.map(function (v) {
          return '<button type="button" class="chip chip-variante' + (v.id === p.id ? ' attivo' : '') +
            '" data-variante-id="' + v.id + '">' + esc(v.etichetta) + '</button>';
        }).join('') + '</div>';
    return (
      '<div class="prodotto" data-prodotto="' + p.id + '"' +
      (p.varianti ? ' data-varianti=\'' + esc(JSON.stringify(p.varianti)).replace(/'/g, '&#39;') + '\'' : '') +
      '>' +
      '<div class="info">' +
      '<div class="nome">' +
      (p.brand_nome
        ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' +
          esc(p.brand_nome) + '</span> '
        : '') +
      esc(p.nome) + '</div>' +
      varianti +
      '<div class="meta" data-riga-meta>Cod. <span data-riga-codice>' + esc(p.codice) + '</span> · ' + esc(p.macro_nome || '') +
      (p.raee ? ' · RAEE € ' + p.raee : '') +
      ' <span class="badge badge-' + p.disponibilita + '" data-riga-badge>' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="prezzo" data-riga-prezzo>' + barrato + '€ ' + p.prezzo + ' <span class="iva">+ IVA</span></div>' +
      '</div>' +
      '<div data-riga-azioni>' + azioniHtml(p.id, p.disponibilita) + '</div>' +
      '</div>'
    );
  }

  // ---------- Selettore varianti (misure) dentro una card prodotto ----------
  // Aggiorna la card (prezzo, codice, disponibilità, stepper) sulla variante scelta,
  // sia che arrivi da un chip cliccato sia da una select cambiata.
  function applicaVariante(card, v) {
    card.setAttribute('data-prodotto', v.id);
    card.querySelectorAll('[data-variante-id]').forEach(function (c) {
      c.classList.toggle('attivo', c.getAttribute('data-variante-id') === String(v.id));
    });
    const codiceEl = card.querySelector('[data-riga-codice]');
    if (codiceEl) codiceEl.textContent = v.codice;
    const badgeEl = card.querySelector('[data-riga-badge]');
    if (badgeEl) {
      badgeEl.className = 'badge badge-' + v.disponibilita;
      badgeEl.textContent = v.disponibilita_testo || v.disponibilita;
    }
    const prezzoEl = card.querySelector('[data-riga-prezzo]');
    if (prezzoEl) {
      const barrato = (v.sconto || v.sconto_base_pct) > 0 ? '<span class="barrato">€ ' + v.listino + '</span>' : '';
      prezzoEl.innerHTML = barrato + '€ ' + v.prezzo + ' <span class="iva">+ IVA</span>';
    }
    const azioniEl = card.querySelector('[data-riga-azioni]');
    if (azioniEl) azioniEl.innerHTML = azioniHtml(v.id, v.disponibilita);

    risincronizzaCarrelloVisibile();
    ricalcolaBarra();
  }

  function trovaVariante(card, id) {
    let varianti;
    try { varianti = JSON.parse(card.getAttribute('data-varianti')); } catch (err) { return null; }
    return varianti.find(function (x) { return String(x.id) === String(id); }) || null;
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

  document.addEventListener('change', function (e) {
    const select = e.target.closest('[data-selettore-variante]');
    if (!select) return;
    const card = select.closest('[data-varianti]');
    if (!card) return;
    const v = trovaVariante(card, select.value);
    if (v) applicaVariante(card, v);
  });

  // Dopo aver inserito nuove card nel DOM: aggancia i loro quantità/mini-carrello e
  // aggiorna la barra in fondo. Serve sia dopo una sostituzione che dopo un'aggiunta.
  function risincronizzaCarrelloVisibile() {
    fetch('/api/carrello').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.carrello) return;
      Object.keys(d.carrello).forEach(function (id) { aggiornaMiniCard(id, d.carrello[id]); });
    }).catch(function () {});
    ricalcolaBarra();
  }

  // ---------- Ricerca parziale mentre si digita ----------

  const campoRicerca = document.querySelector('[data-ricerca]');
  const contenitore = document.getElementById('risultati');
  if (campoRicerca && contenitore) {
    let timer = null;
    let ultima = campoRicerca.value.trim();
    // Elenco mostrato all'apertura della pagina: si ripristina svuotando la ricerca.
    const contenutoIniziale = contenitore.innerHTML;
    const paginazione = document.querySelector('[data-paginazione]');
    // Ambito della pagina (categoria, marchio, famiglia, gruppo): la ricerca resta lì dentro.
    const ambito = campoRicerca.dataset.ambito || '';

    // Chip di raffinamento (diametro/materiale), solo dove il contenitore esiste (oggi
    // solo /cerca): stesso pattern "ripristina al contenuto iniziale svuotando" di sopra.
    const contenitoreTag = document.getElementById('tag-raffinamento');
    const tagIniziale = contenitoreTag ? contenitoreTag.innerHTML : '';

    function leggiFiltro(chiave) {
      try { return new URLSearchParams(window.location.search).get(chiave) || ''; } catch (e) { return ''; }
    }
    let diametroAttivo = leggiFiltro('diametro');
    let materialeAttivo = leggiFiltro('materiale');

    function urlCerca(q, cambio) {
      const stato = { q: q, diametro: diametroAttivo, materiale: materialeAttivo };
      Object.keys(cambio).forEach(function (k) { stato[k] = cambio[k]; });
      const parti = Object.keys(stato)
        .filter(function (k) { return stato[k]; })
        .map(function (k) { return k + '=' + encodeURIComponent(stato[k]); });
      return '/cerca' + (parti.length ? '?' + parti.join('&') : '');
    }

    function rigaChip(titolo, voci, attivo, chiave) {
      if (!voci.length) return '';
      var html = '<div class="filtro-titolo">' + titolo + '</div><div class="chip-riga">';
      var cambioTutti = {}; cambioTutti[chiave] = null;
      html += '<a class="chip ' + (attivo ? '' : 'attivo') + '" href="' + urlCerca(ultima, cambioTutti) + '">Tutti</a>';
      voci.forEach(function (v) {
        var cambio = {}; cambio[chiave] = v.valore;
        html += '<a class="chip ' + (attivo === v.valore ? 'attivo' : '') + '" href="' +
          urlCerca(ultima, cambio) + '">' + esc(v.valore) + '</a>';
      });
      return html + '</div>';
    }

    function disegnaTag(tag) {
      if (!contenitoreTag) return;
      const t = tag || { diametri: [], materiali: [] };
      contenitoreTag.innerHTML =
        rigaChip('Diametro', t.diametri, diametroAttivo, 'diametro') +
        rigaChip('Materiale', t.materiali, materialeAttivo, 'materiale');
    }

    campoRicerca.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(cerca, 220);
    });

    function mostraPaginazione(visibile) {
      if (!paginazione) return;
      if (visibile) paginazione.removeAttribute('hidden');
      else paginazione.setAttribute('hidden', '');
    }

    function cerca() {
      const q = campoRicerca.value.trim();
      if (q === ultima) return;
      ultima = q;
      if (q.length < 2) {
        contenitore.innerHTML = contenutoIniziale;
        if (contenitoreTag) contenitoreTag.innerHTML = tagIniziale;
        mostraPaginazione(true);
        ricalcolaBarra();
        return;
      }
      fetch('/api/cerca?q=' + encodeURIComponent(q) + (ambito ? '&' + ambito : ''))
        .then(function (r) { return r.json(); })
        .then(function (dati) {
          if (campoRicerca.value.trim() !== q) return;
          mostraPaginazione(false);
          disegnaRisultati(dati.risultati || []);
          disegnaTag(dati.tag);
        })
        .catch(function () { /* offline: resta l'ultimo elenco mostrato */ });
    }

    function disegnaRisultati(risultati) {
      if (!risultati.length) {
        contenitore.innerHTML =
          '<div class="vuoto"><span class="emoji">🤷</span>Nessun prodotto trovato.</div>';
        return;
      }
      contenitore.innerHTML = '<div class="card card-fitta">' + risultati.map(cardProdottoHtml).join('') + '</div>';
      risincronizzaCarrelloVisibile();
    }
  }

  // ---------- Ricerca dalla home: appena scritte 3 lettere si va ai risultati ----------
  // (senza dover premere "Cerca" o Invio; su /cerca poi la ricerca è già live mentre si scrive)
  const campoRicercaHome = document.querySelector('[data-auto-cerca]');
  if (campoRicercaHome) {
    let timerHome = null;
    campoRicercaHome.addEventListener('input', function () {
      clearTimeout(timerHome);
      const q = campoRicercaHome.value.trim();
      if (q.length < 3) return;
      timerHome = setTimeout(function () {
        window.location.href = '/cerca?q=' + encodeURIComponent(q);
      }, 350);
    });
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
    let caricamento = false;
    const urlBase = scrollInfinito.dataset.url;

    const paginazione = document.querySelector('[data-paginazione]');
    if (paginazione) paginazione.setAttribute('hidden', ''); // sostituita dallo scroll

    const sentinella = document.createElement('div');
    sentinella.setAttribute('data-sentinella-scroll', '');
    scrollInfinito.after(sentinella);

    function caricaProssimaPagina() {
      if (caricamento || pagina >= pagine) return;
      caricamento = true;
      fetch(urlBase + (urlBase.indexOf('?') === -1 ? '?' : '&') + 'pagina=' + (pagina + 1))
        .then(function (r) { return r.json(); })
        .then(function (dati) {
          const cardFitta = contenitore.querySelector('.card-fitta');
          if (cardFitta && dati.risultati && dati.risultati.length) {
            cardFitta.insertAdjacentHTML('beforeend', dati.risultati.map(cardProdottoHtml).join(''));
            risincronizzaCarrelloVisibile();
          }
          pagina = dati.pagina || pagina + 1;
          pagine = dati.pagine || pagine;
          caricamento = false;
          if (pagina >= pagine) osservatore.disconnect();
        })
        .catch(function () { caricamento = false; });
    }

    const osservatore = new IntersectionObserver(function (voci) {
      if (voci[0].isIntersecting) caricaProssimaPagina();
    }, { rootMargin: '400px' });
    osservatore.observe(sentinella);
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
      in_attesa: ['In attesa', 'stato-in_attesa'],
      confermato: ['Disponibile', 'stato-confermato'],
      non_disponibile: ['Non disponibile', 'stato-non_disponibile'],
      scaduto: ['Nessuna risposta', 'stato-scaduto'],
    };

    setInterval(function () {
      fetch('/api/richieste/' + richiestaId)
        .then(function (r) { return r.json(); })
        .then(function (dati) {
          if (typeof dati.secondi === 'number') secondi = dati.secondi;
          if (elenco && dati.risposte) {
            dati.risposte.forEach(function (r) {
              const nodo = elenco.querySelector('[data-distributore="' + r.nome + '"]');
              if (!nodo) return;
              const et = etichette[r.esito] || etichette.in_attesa;
              nodo.textContent = et[0];
              nodo.className = 'stato-badge ' + et[1];
            });
          }
          if (dati.stato !== 'in_attesa') window.location.reload();
        })
        .catch(function () { /* riprova al giro dopo */ });
    }, 3000);
  }

  // ---------- Notifiche del browser ----------

  const pulsanteNotifiche = document.querySelector('[data-abilita-notifiche]');
  if (pulsanteNotifiche && 'Notification' in window) {
    if (Notification.permission === 'granted') pulsanteNotifiche.hidden = true;
    pulsanteNotifiche.addEventListener('click', function () {
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') {
          pulsanteNotifiche.hidden = true;
          new Notification('Notifiche attive', {
            body: 'Ti avviseremo quando i distributori rispondono.',
          });
        }
      });
    });
  }

  if ('Notification' in window && document.body.dataset.loggato === '1') {
    setInterval(function () {
      if (Notification.permission !== 'granted') return;
      fetch('/api/notifiche/push')
        .then(function (r) { return r.json(); })
        .then(function (dati) {
          (dati.notifiche || []).forEach(function (n) {
            const notifica = new Notification(n.titolo, { body: n.testo, tag: 'minuteria-' + n.id });
            if (n.link) {
              notifica.onclick = function () {
                window.focus();
                window.location.href = n.link;
              };
            }
          });
        })
        .catch(function () { /* nessuna notifica questo giro */ });
    }, 10000);
  }
})();

/* Geolocalizzazione in tempo reale — sempre e solo dopo consenso esplicito.
   Nessuna coordinata parte prima che l'utente prema "Attiva la posizione". */
(function () {
  'use strict';

  const box = document.querySelector('[data-geo]');
  const supportata = 'geolocation' in navigator;
  let watchId = null;
  let ultimoInvio = 0;

  function scriviStato(testo) {
    if (!box) return;
    const el = box.querySelector('[data-geo-stato]');
    if (el) el.textContent = testo;
  }

  function segnaAttiva(attiva) {
    if (!box) return;
    const badge = box.querySelector('[data-geo-badge]');
    if (badge) {
      badge.textContent = attiva ? 'Consenso dato' : 'Spenta';
      badge.className = 'stato-badge ' + (attiva ? 'stato-confermato' : 'stato-scaduto');
    }
    const on = box.querySelector('[data-geo-attiva]');
    const off = box.querySelector('[data-geo-revoca]');
    if (on) on.hidden = attiva;
    if (off) off.hidden = !attiva;
  }

  // Essendo un'app multipagina (non una SPA), ogni navigazione riparte da zero e
  // richiamerebbe l'API di posizione del browser ad ogni pagina: su origini non sicure
  // (http) alcuni browser (Safari iOS) non ricordano il consenso da una pagina all'altra
  // e ri-chiedono il permesso di continuo. Questo throttle a livello di sessione evita di
  // richiamare l'API se abbiamo già un fix recente, per ridurre quanto è possibile quante
  // volte la richiediamo — non risolve un'origine non sicura, ma aiuta comunque su https.
  const CHIAVE_ULTIMO_FIX = 'geo_ultimo_fix_ts';
  function fixRecente() {
    try {
      const t = parseInt(sessionStorage.getItem(CHIAVE_ULTIMO_FIX), 10);
      return Number.isFinite(t) && Date.now() - t < 20000;
    } catch (e) { return false; }
  }
  function segnaFixOra() {
    try { sessionStorage.setItem(CHIAVE_ULTIMO_FIX, String(Date.now())); } catch (e) {}
  }

  function invia(pos) {
    const ora = Date.now();
    segnaFixOra();
    // Non tempestiamo il server: al massimo un aggiornamento ogni 10 secondi.
    if (ora - ultimoInvio < 10000) return;
    ultimoInvio = ora;
    fetch('/api/posizione', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        precisione: pos.coords.accuracy,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function () {
        scriviStato('Attiva — posizione aggiornata ora');
        window.dispatchEvent(new CustomEvent('posizione-aggiornata', {
          detail: { lat: pos.coords.latitude, lng: pos.coords.longitude, precisione: pos.coords.accuracy },
        }));
      })
      .catch(function () { /* riprova al prossimo rilevamento */ });
  }

  function fermaWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function avviaWatch() {
    if (!supportata || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(
      invia,
      function (err) {
        if (err.code === err.PERMISSION_DENIED) {
          scriviStato('Permesso negato dal browser: la posizione resta spenta.');
          segnaAttiva(false);
          fermaWatch();
          // Permesso tolto nel browser: allineiamo il server e cancelliamo le coordinate.
          fetch('/api/posizione/revoca', { method: 'POST' });
        } else {
          scriviStato('Posizione momentaneamente non disponibile.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  if (box) {
    const attivaBtn = box.querySelector('[data-geo-attiva]');
    const revocaBtn = box.querySelector('[data-geo-revoca]');

    if (!supportata) {
      scriviStato('Questo dispositivo non espone la posizione al browser.');
      if (attivaBtn) attivaBtn.disabled = true;
    }

    if (attivaBtn) {
      attivaBtn.addEventListener('click', function () {
        scriviStato('In attesa del permesso del browser...');
        // Il consenso vero è quello che il browser chiede qui.
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            ultimoInvio = 0;
            invia(pos);
            segnaAttiva(true);
            avviaWatch();
          },
          function () {
            scriviStato('Permesso negato: nessuna posizione è stata registrata.');
            segnaAttiva(false);
          },
          { enableHighAccuracy: true, timeout: 20000 }
        );
      });
    }

    if (revocaBtn) {
      revocaBtn.addEventListener('click', function () {
        fermaWatch();
        fetch('/api/posizione/revoca', { method: 'POST' }).then(function () {
          segnaAttiva(false);
          scriviStato('Non attiva: la posizione salvata è stata cancellata.');
          window.dispatchEvent(new CustomEvent('posizione-revocata'));
        });
      });
    }

    // Consenso già dato in una sessione precedente: riprendiamo senza nuovi popup.
    // Se abbiamo già un fix recentissimo (arrivato dalla pagina precedente) evitiamo di
    // richiamare subito l'API del browser: meno occasioni di ri-chiedere il permesso.
    if (box.dataset.consenso === '1') {
      if (fixRecente()) scriviStato('Attiva — posizione aggiornata di recente');
      else avviaWatch();
    } else if (supportata) {
      // Prima volta: la posizione si attiva appena si entra nell'app. Il permesso lo
      // chiede comunque il browser; se è già stato negato non insistiamo.
      const chiedi = function () {
        scriviStato('Sto cercando la tua posizione...');
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            ultimoInvio = 0;
            invia(pos);
            segnaAttiva(true);
            avviaWatch();
          },
          function (err) {
            scriviStato(
              err.code === err.PERMISSION_DENIED
                ? 'Permesso negato: nessuna posizione è stata registrata.'
                : 'Posizione non disponibile in questo momento.'
            );
            segnaAttiva(false);
          },
          { enableHighAccuracy: true, timeout: 20000 }
        );
      };

      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: 'geolocation' })
          .then(function (p) {
            if (p.state !== 'denied') chiedi();
            else scriviStato('Permesso bloccato nelle impostazioni del browser.');
          })
          .catch(chiedi);
      } else {
        chiedi();
      }
    }
  }

  // ---------- Banco: condivisione della posizione del mezzo per un ordine ----------

  const tracc = document.querySelector('[data-tracciamento]');
  if (tracc) {
    const ordineId = tracc.dataset.tracciamento;
    const on = tracc.querySelector('[data-tracciamento-on]');
    const off = tracc.querySelector('[data-tracciamento-off]');

    const imposta = function (attivo) {
      fetch('/api/ordini/' + ordineId + '/tracciamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attivo: attivo }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) {
            window.alert(d.errore || 'Non è stato possibile cambiare la condivisione.');
            return;
          }
          if (on) on.hidden = d.attivo;
          if (off) off.hidden = !d.attivo;
          if (d.attivo) avviaWatch();
        });
    };

    if (on) on.addEventListener('click', function () { imposta(true); });
    if (off) off.addEventListener('click', function () { imposta(false); });
  }

  // La consegna in tempo reale la disegna mappa.js: qui restano solo consenso e invio
  // della posizione.

  // ---------- Banco: azzera tutte le quantità disponibili ----------

  const azzera = document.querySelector('[data-azzera-righe]');
  if (azzera) {
    azzera.addEventListener('click', function () {
      document.querySelectorAll('input[name^="disp_"]').forEach(function (i) {
        i.value = 0;
      });
    });
  }
})();

/* Banco distributore: sconti riga per riga con ricalcolo immediato del prezzo cliente. */
(function () {
  'use strict';

  const modulo = document.querySelector('[data-modulo-risposta]');
  if (!modulo) return;

  const servizio = parseFloat(modulo.dataset.servizio || '10') || 0;

  function euro(n) {
    return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Stesso calcolo del server: (listino − sconto) + servizio, IVA esclusa.
  function ricalcola(riga) {
    const listino = parseFloat(riga.dataset.listino);
    const campo = riga.querySelector('[data-sconto-riga]');
    const uscita = riga.querySelector('[data-prezzo-riga]');
    if (!Number.isFinite(listino) || !campo || !uscita) return;

    let sconto = parseFloat(String(campo.value).replace(',', '.'));
    if (!Number.isFinite(sconto)) sconto = 0;
    sconto = Math.min(90, Math.max(0, sconto));

    const netto = Math.round(listino * (1 - sconto / 100) * 100) / 100;
    const cliente = Math.round(netto * (1 + servizio / 100) * 100) / 100;
    uscita.textContent = euro(cliente);

    const standard = parseFloat(riga.dataset.standard);
    riga.classList.toggle('sconto-modificato', Number.isFinite(standard) && sconto !== standard);
  }

  function tutteLeRighe() {
    return Array.prototype.slice.call(modulo.querySelectorAll('.riga-banco'));
  }

  modulo.addEventListener('input', function (e) {
    if (e.target.matches('[data-sconto-riga]')) {
      const riga = e.target.closest('.riga-banco');
      if (riga) ricalcola(riga);
    }
  });

  const applica = modulo.querySelector('[data-applica-sconto]');
  const campoCliente = modulo.querySelector('[data-sconto-cliente]');
  if (applica && campoCliente) {
    applica.addEventListener('click', function () {
      const valore = String(campoCliente.value).trim();
      if (valore === '') return;
      tutteLeRighe().forEach(function (riga) {
        const campo = riga.querySelector('[data-sconto-riga]');
        if (campo) campo.value = valore;
        ricalcola(riga);
      });
    });
  }

  tutteLeRighe().forEach(ricalcola);
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

/* Menu account in alto a destra: dentro ci sta anche l'uscita. */
(function () {
  'use strict';

  const menu = document.querySelector('[data-menu-account]');
  if (!menu) return;

  const bottone = menu.querySelector('[data-menu-apri]');
  const tendina = menu.querySelector('[data-menu-tendina]');
  if (!bottone || !tendina) return;

  function apri(aperto) {
    if (aperto) tendina.removeAttribute('hidden');
    else tendina.setAttribute('hidden', '');
    bottone.setAttribute('aria-expanded', aperto ? 'true' : 'false');
  }

  bottone.addEventListener('click', function (e) {
    e.stopPropagation();
    apri(tendina.hasAttribute('hidden'));
  });

  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) apri(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') apri(false);
  });
})();

/* Interruttore chiaro/scuro nell'appbar: cambia subito e ricorda la scelta. */
(function () {
  'use strict';

  const bottone = document.querySelector('[data-tema-toggle]');
  if (!bottone) return;

  const etichettaScuro = bottone.querySelector('[data-tema-scuro]');
  const etichettaChiaro = bottone.querySelector('[data-tema-chiaro]');

  function mostraEtichetta() {
    const chiaro = document.documentElement.getAttribute('data-tema') === 'chiaro';
    etichettaScuro.toggleAttribute('hidden', chiaro);
    etichettaChiaro.toggleAttribute('hidden', !chiaro);
  }
  mostraEtichetta();

  bottone.addEventListener('click', function () {
    const chiaroOra = document.documentElement.getAttribute('data-tema') === 'chiaro';
    const nuovo = chiaroOra ? 'scuro' : 'chiaro';
    if (nuovo === 'chiaro') document.documentElement.setAttribute('data-tema', 'chiaro');
    else document.documentElement.removeAttribute('data-tema');
    try { localStorage.setItem('tema', nuovo); } catch (e) {}
    mostraEtichetta();
  });
})();

/* Finestra di 5 minuti per scegliere il distributore: countdown e ricarica alla scadenza. */
(function () {
  'use strict';

  const box = document.querySelector('[data-scelta]');
  if (!box) return;

  let secondi = parseInt(box.dataset.secondi, 10) || 0;
  const orologio = document.getElementById('countdown-scelta');

  setInterval(function () {
    secondi = Math.max(0, secondi - 1);
    if (orologio) {
      const m = Math.floor(secondi / 60);
      const s = secondi % 60;
      orologio.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    // Scaduto: il server assegna al più veloce, ricarichiamo per mostrare l'esito.
    if (secondi === 0) window.setTimeout(function () { window.location.reload(); }, 3000);
  }, 1000);
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

/* Banco distributore: pausa/riattiva la ricezione di nuove richieste, cambio istantaneo
   senza ricaricare la pagina (la sede resta comunque attiva sulla piattaforma). */
(function () {
  'use strict';
  const btn = document.querySelector('[data-toggle-banco]');
  if (!btn) return;
  const testo = btn.querySelector('[data-toggle-banco-testo]');

  btn.addEventListener('click', function () {
    const attivoOra = btn.dataset.attivo === '1';
    const nuovo = !attivoOra;
    btn.disabled = true;
    fetch('/api/distributore/stato', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo: nuovo }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.dataset.attivo = d.attivo ? '1' : '0';
        btn.classList.toggle('attivo', d.attivo);
        btn.classList.toggle('pausa', !d.attivo);
        if (testo) testo.textContent = d.attivo ? 'Banco operativo · Ricezione attiva' : 'Non disponibile · In pausa';
      })
      .catch(function () { window.alert('Non è stato possibile cambiare lo stato del banco.'); })
      .finally(function () { btn.disabled = false; });
  });
})();

/* Impedisce il doppio invio dei form che cambiano stato (conferma ordine, risposta del
   banco, elimina...): un doppio tap — frequente su rete lenta da cantiere, quando non si
   vede subito una reazione — poteva mandare due POST identiche in rapida successione.
   Il server ora si difende comunque (vedi creaOrdineDaOfferta in server.js), ma è meglio
   non generarla nemmeno la seconda richiesta. Generico: si applica a ogni <form> dell'app,
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
    bottoni.forEach(function (b) { b.disabled = true; });
  }, 0);
}, true);
