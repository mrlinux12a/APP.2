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
    const nuovo = Math.max(0, (parseInt(input.value, 10) || 0) + passo);
    input.value = nuovo;
    // aggiorna via API
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: nuovo }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        aggiornaBadgeCarrello(d.pezzi);
        if (nuovo === 0) {
          const riga = document.querySelector('[data-riga="' + id + '"]');
          if (riga) riga.style.opacity = '0.4';
          // ricarica per ricalcolare totali se a zero
          setTimeout(function () { window.location.reload(); }, 400);
        } else {
          window.location.reload();
        }
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

  function cardProdottoHtml(p) {
    const barrato = p.sconto_base_pct > 0
      ? '<span class="barrato">€ ' + p.listino + '</span>'
      : '';
    const disabilitato = p.disponibilita === 'non_disponibile';
    return (
      '<div class="prodotto" data-prodotto="' + p.id + '">' +
      '<div class="info">' +
      '<div class="nome">' +
      (p.brand_nome
        ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' +
          esc(p.brand_nome) + '</span> '
        : '') +
      esc(p.nome) + '</div>' +
      '<div class="meta">Cod. ' + esc(p.codice) + ' · ' + esc(p.macro_nome || '') +
      (p.raee ? ' · RAEE € ' + p.raee : '') +
      ' <span class="badge badge-' + p.disponibilita + '">' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="prezzo">' + barrato + '€ ' + p.prezzo + ' <span class="iva">+ IVA</span></div>' +
      '</div>' +
      (disabilitato
        ? '<div class="meta">non disponibile</div>'
        : '<div class="prodotto-azioni">' +
          '<div class="stepper">' +
          '<button type="button" data-passo="-1" aria-label="Togli">−</button>' +
          '<input type="number" min="0" step="1" inputmode="numeric" data-qta data-prodotto-qta="' + p.id + '" value="0">' +
          '<button type="button" data-passo="1" aria-label="Aggiungi">+</button>' +
          '</div>' +
          '<div class="mini-carrello" data-nel-carrello="' + p.id + '" hidden><span>Nel carrello: <strong data-qta-carrello="' + p.id + '">0</strong> pz</span></div>' +
          '</div>') +
      '</div>'
    );
  }

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

  function invia(pos) {
    const ora = Date.now();
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
    if (box.dataset.consenso === '1') {
      avviaWatch();
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

/* Stato ordini — stepper 3 stati cliccabile + countdown per ogni card */
(function () {
  'use strict';
  document.querySelectorAll('[data-card]').forEach(function (card) {
    const stepper = card.querySelector('[data-stepper]');
    if (!stepper) return;
    const pannelli = card.querySelectorAll('[data-pannello]');
    stepper.querySelectorAll('[data-step-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        const n = btn.getAttribute('data-step-btn');
        pannelli.forEach(function (p) {
          if (p.getAttribute('data-pannello') === n) p.removeAttribute('hidden');
          else p.setAttribute('hidden','');
        });
        stepper.querySelectorAll('[data-step-btn]').forEach(function (b) {
          b.classList.toggle('corrente', b.getAttribute('data-step-btn') === n);
        });
      });
    });
    // countdown per pannello 1 (se presente)
    const cd = card.querySelector('[data-countdown]');
    if (cd) {
      let sec = parseInt(cd.getAttribute('data-secondi'),10) || 0;
      setInterval(function () {
        sec = Math.max(0, sec - 1);
        const m = Math.floor(sec/60), s = sec%60;
        cd.textContent = String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
        if (sec===0) setTimeout(function(){ window.location.reload(); }, 2500);
      }, 1000);
    }
  });
})();
