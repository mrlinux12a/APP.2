/* Comportamenti lato client dell'app cliente: selettori quantità, ricerca parziale
   mentre si digita, countdown della finestra di 10 minuti e notifiche del browser. */
(function () {
  'use strict';

  // ---------- Selettore quantità (+ / -) ----------

  // Il contatore della barra in fondo: pezzi già nel carrello (data-conteggio)
  // più quelli appena scelti in questa pagina.
  function aggiornaBarra() {
    const barra = document.querySelector('[data-conteggio]');
    if (!barra) return;
    const base = parseInt(barra.dataset.conteggio, 10) || 0;
    let pezziPagina = 0;
    document.querySelectorAll('input[data-qta]').forEach(function (i) {
      pezziPagina += Math.max(0, parseInt(i.value, 10) || 0);
    });
    const totale = base + pezziPagina;
    barra.textContent = totale
      ? totale + (totale === 1 ? ' pezzo selezionato' : ' pezzi selezionati')
      : 'Nessun materiale selezionato';
    const bottone = document.querySelector('[data-procedi]');
    if (bottone) bottone.disabled = totale === 0;
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-passo]');
    if (!btn) return;
    e.preventDefault();
    const input = btn.parentElement.querySelector('input[type="number"]');
    if (!input) return;
    const passo = parseInt(btn.dataset.passo, 10);
    input.value = Math.max(0, (parseInt(input.value, 10) || 0) + passo);
    aggiornaBarra();
  });

  document.addEventListener('input', function (e) {
    if (e.target.matches('input[type="number"]')) aggiornaBarra();
  });

  aggiornaBarra();

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
        // Torna l'elenco di partenza: in un catalogo di migliaia di articoli è quello
        // che serve, non un messaggio di aiuto.
        contenitore.innerHTML = contenutoIniziale;
        mostraPaginazione(true);
        aggiornaBarra();
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

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }

    function disegnaRisultati(risultati) {
      if (!risultati.length) {
        contenitore.innerHTML =
          '<div class="vuoto"><span class="emoji">🤷</span>Nessun prodotto trovato.</div>';
        return;
      }
      const html = risultati
        .map(function (p) {
          const barrato = p.sconto_base_pct > 0
            ? '<span class="barrato">€ ' + p.listino + '</span>'
            : '';
          const disabilitato = p.disponibilita === 'non_disponibile';
          return (
            '<div class="prodotto">' +
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
              : '<div class="stepper">' +
                '<button type="button" data-passo="-1" aria-label="Togli">−</button>' +
                '<input type="number" min="0" step="1" inputmode="numeric" data-qta name="quantita_' + p.id + '" value="0">' +
                '<button type="button" data-passo="1" aria-label="Aggiungi">+</button>' +
                '</div>') +
            '</div>'
          );
        })
        .join('');
      contenitore.innerHTML = '<div class="card card-fitta">' + html + '</div>';
      aggiornaBarra();
    }
  }

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
    if (box.dataset.consenso === '1') avviaWatch();
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
