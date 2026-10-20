/* Mappe dell'app, basate su Leaflet servito in locale (public/vendor/leaflet).
   Leaflet viene caricato solo nelle pagine che hanno davvero una mappa. */
(function () {
  'use strict';

  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUZIONE = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  let promessaLeaflet = null;

  function caricaLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (promessaLeaflet) return promessaLeaflet;

    promessaLeaflet = new Promise(function (risolvi, rifiuta) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);

      const js = document.createElement('script');
      js.src = '/vendor/leaflet/leaflet.js';
      js.onload = function () { risolvi(window.L); };
      js.onerror = function () { rifiuta(new Error('Leaflet non caricato')); };
      document.head.appendChild(js);
    });
    return promessaLeaflet;
  }

  function base(L, nodo, zoom) {
    const mappa = L.map(nodo, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUZIONE }).addTo(mappa);
    mappa.setView([41.9028, 12.4964], zoom || 5); // vista iniziale sull'Italia
    return mappa;
  }

  function pallino(L, colore) {
    return L.divIcon({
      className: 'segno-mappa',
      html: '<span style="background:' + colore + '"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function messaggio(nodo, testo) {
    nodo.innerHTML = '<div class="mappa-vuota">' + testo + '</div>';
  }

  // ---------- Mappa della propria posizione (cliente e banco) ----------

  const nodoGeo = document.querySelector('[data-geo-mappa]');
  if (nodoGeo) {
    let mappa = null;
    let segno = null;
    let cerchio = null;
    let viciniDisegnati = false;

    // Punti vendita da mostrare insieme alla posizione dell'utente.
    let vicini = [];
    try {
      vicini = JSON.parse(decodeURIComponent(nodoGeo.dataset.vicini || '[]')) || [];
    } catch (e) {
      vicini = [];
    }

    function distanzaKm(a, b) {
      const R = 6371;
      const rad = function (g) { return (g * Math.PI) / 180; };
      const dLat = rad(b.lat - a.lat);
      const dLng = rad(b.lng - a.lng);
      const h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return 2 * R * Math.asin(Math.sqrt(h));
    }

    function formatta(km) {
      return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km';
    }

    // I punti vendita più vicini alla posizione appena rilevata.
    function disegnaVicini(L, lat, lng) {
      if (viciniDisegnati || !vicini.length) return;
      viciniDisegnati = true;

      const ordinati = vicini
        .map(function (p) { return { ...p, km: distanzaKm({ lat: lat, lng: lng }, p) }; })
        .sort(function (a, b) { return a.km - b.km; });

      const daMostrare = ordinati.slice(0, 8);
      const confini = [[lat, lng]];

      daMostrare.forEach(function (p) {
        L.marker([p.lat, p.lng], { icon: pallino(L, '#e0912f') })
          .addTo(mappa)
          .bindPopup(
            '<strong>' + p.insegna + '</strong><br>' + p.nome + '<br>' + p.indirizzo +
              '<br>a ' + formatta(p.km) + ' da te'
          );
        confini.push([p.lat, p.lng]);
      });

      // Inquadratura sui tre più vicini, così la mappa non parte troppo larga.
      mappa.fitBounds(L.latLngBounds(confini.slice(0, 4)).pad(0.3));

      const legenda = document.querySelector('[data-geo-vicini]');
      if (legenda) legenda.removeAttribute('hidden');
    }

    function mostra(lat, lng, precisione) {
      caricaLeaflet()
        .then(function (L) {
          if (!mappa) {
            mappa = base(L, nodoGeo, 15);
            segno = L.marker([lat, lng], { icon: pallino(L, '#1d4e89') })
              .addTo(mappa)
              .bindPopup('Sei qui');
            cerchio = L.circle([lat, lng], {
              radius: precisione || 40,
              color: '#1d4e89',
              weight: 1,
              fillOpacity: 0.12,
            }).addTo(mappa);
            mappa.setView([lat, lng], 15);
          } else {
            segno.setLatLng([lat, lng]);
            cerchio.setLatLng([lat, lng]).setRadius(precisione || 40);
          }
          nodoGeo.classList.add('mappa-attiva');
          disegnaVicini(L, lat, lng);
          setTimeout(function () { mappa.invalidateSize(); }, 60);
        })
        .catch(function () {
          messaggio(nodoGeo, 'Mappa non disponibile (serve la connessione a internet).');
        });
    }

    // Posizione già nota dal server al caricamento della pagina.
    const lat0 = parseFloat(nodoGeo.dataset.lat);
    const lng0 = parseFloat(nodoGeo.dataset.lng);
    if (Number.isFinite(lat0) && Number.isFinite(lng0)) {
      mostra(lat0, lng0, parseFloat(nodoGeo.dataset.precisione) || 40);
    }

    // Aggiornamenti dal watchPosition gestito in app.js.
    window.addEventListener('posizione-aggiornata', function (e) {
      mostra(e.detail.lat, e.detail.lng, e.detail.precisione);
    });

    // Revoca del consenso: la mappa sparisce insieme alle coordinate.
    window.addEventListener('posizione-revocata', function () {
      if (mappa) {
        mappa.remove();
        mappa = null;
        segno = null;
        cerchio = null;
      }
      nodoGeo.classList.remove('mappa-attiva');
      nodoGeo.innerHTML = '';
    });
  }

  // ---------- Mappa di un punto fisso (destinazione della merce) ----------

  const nodoPunto = document.querySelector('[data-mappa-punto]');
  if (nodoPunto) {
    const lat = parseFloat(nodoPunto.dataset.lat);
    const lng = parseFloat(nodoPunto.dataset.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      caricaLeaflet()
        .then(function (L) {
          const mappa = base(L, nodoPunto, 15);
          L.marker([lat, lng], { icon: pallino(L, '#2e7d32') })
            .addTo(mappa)
            .bindPopup(nodoPunto.dataset.etichetta || 'Destinazione');
          mappa.setView([lat, lng], 15);
          setTimeout(function () { mappa.invalidateSize(); }, 60);
        })
        .catch(function () {
          messaggio(nodoPunto, 'Mappa non disponibile.');
        });
    } else {
      messaggio(nodoPunto, 'Posizione non condivisa dal cliente.');
    }
  }

  // ---------- Posizione del banco: segnaposto da trascinare (pagina "Anagrafica del banco") ----------
  // Si apre da "Sposta" / "Imposta" ([data-sposta]) in una finestra (<dialog data-mappa-dialog>): il segnaposto si trascina, oppure si tocca la mappa.
  // "Salva posizione" manda le coordinate a POST /distributore/anagrafica/posizione e ricarica la pagina. Senza una posizione già impostata la mappa parte
  // sull'Italia e il segnaposto compare al primo tocco.

  const dialogoPosizione = document.querySelector('[data-mappa-dialog]');
  if (dialogoPosizione) {
    const contenitore = dialogoPosizione.querySelector('[data-mappa-sposta]');
    const nodoErrore = dialogoPosizione.querySelector('[data-mappa-errore]');
    const bottoneSalva = dialogoPosizione.querySelector('[data-mappa-salva]');
    const bottoneAnnulla = dialogoPosizione.querySelector('[data-mappa-annulla]');
    const lat0 = parseFloat(contenitore.dataset.lat);
    const lng0 = parseFloat(contenitore.dataset.lng);
    const haPosizione = Number.isFinite(lat0) && Number.isFinite(lng0);
    let mappaBanco = null;
    let segnoBanco = null;
    let scelta = haPosizione ? { lat: lat0, lng: lng0 } : null;

    function mostraErrore(testo) {
      nodoErrore.textContent = testo || '';
      nodoErrore.hidden = !testo;
    }
    function aggiornaBottone() { bottoneSalva.disabled = !scelta; }

    function posiziona(L, lat, lng) {
      scelta = { lat: lat, lng: lng };
      if (!segnoBanco) {
        segnoBanco = L.marker([lat, lng], { draggable: true, icon: pallino(L, '#1d4e89') }).addTo(mappaBanco);
        segnoBanco.on('dragend', function () {
          const p = segnoBanco.getLatLng();
          scelta = { lat: p.lat, lng: p.lng };
          mostraErrore('');
        });
      } else {
        segnoBanco.setLatLng([lat, lng]);
      }
      mostraErrore('');
      aggiornaBottone();
    }

    function apri() {
      mostraErrore('');
      if (typeof dialogoPosizione.showModal === 'function') dialogoPosizione.showModal();
      else dialogoPosizione.setAttribute('open', '');
      caricaLeaflet()
        .then(function (L) {
          if (!mappaBanco) {
            mappaBanco = base(L, contenitore, haPosizione ? 17 : 6);
            if (haPosizione) mappaBanco.setView([lat0, lng0], 17);
            else mappaBanco.setView([42.5, 12.5], 6);
            if (haPosizione) posiziona(L, lat0, lng0);
            mappaBanco.on('click', function (e) { posiziona(L, e.latlng.lat, e.latlng.lng); });
          }
          aggiornaBottone();
          // La finestra è appena comparsa: la mappa deve rileggere la sua misura.
          setTimeout(function () { mappaBanco.invalidateSize(); }, 60);
        })
        .catch(function () {
          messaggio(contenitore, 'Mappa non disponibile (serve la connessione a internet).');
        });
    }
    function chiudi() {
      if (typeof dialogoPosizione.close === 'function') dialogoPosizione.close();
      else dialogoPosizione.removeAttribute('open');
    }

    document.querySelectorAll('[data-sposta]').forEach(function (b) { b.addEventListener('click', apri); });
    bottoneAnnulla.addEventListener('click', chiudi);
    bottoneSalva.addEventListener('click', function () {
      if (!scelta) return;
      bottoneSalva.disabled = true;
      fetch('/distributore/anagrafica/posizione', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ lat: scelta.lat, lng: scelta.lng }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok && d && d.ok, errore: d && d.errore }; }); })
        .then(function (esito) {
          if (esito.ok) { window.location.href = '/distributore/anagrafica?ok=posizione#filiale'; return; }
          mostraErrore(esito.errore || 'Non è stato possibile salvare la posizione.');
          aggiornaBottone();
        })
        .catch(function () {
          // Risposta che non è JSON: di solito la sessione è scaduta (il server rimanda al login).
          mostraErrore('Non è stato possibile salvare la posizione. Ricarica la pagina e riprova.');
          aggiornaBottone();
        });
    });
  }

  // ---------- Mappa di tutti i punti vendita ----------

  const nodoPunti = document.querySelector('[data-mappa-punti]');
  if (nodoPunti) {
    let elenco = [];
    try {
      elenco = JSON.parse(decodeURIComponent(nodoPunti.dataset.punti || '[]'));
    } catch (e) {
      elenco = [];
    }

    if (!elenco.length) {
      messaggio(nodoPunti, 'Nessun punto vendita con posizione nota.');
    } else {
      // Un colore per insegna, così sulla mappa si distinguono a colpo d'occhio.
      const COLORI = ['#1d4e89', '#e0912f', '#2e7d32', '#8e24aa', '#c62828', '#00838f'];
      const insegne = [];
      elenco.forEach(function (p) {
        if (insegne.indexOf(p.insegna) === -1) insegne.push(p.insegna);
      });

      caricaLeaflet()
        .then(function (L) {
          const mappa = base(L, nodoPunti, 12);
          const coordinate = [];

          elenco.forEach(function (p) {
            const colore = COLORI[insegne.indexOf(p.insegna) % COLORI.length];
            L.marker([p.lat, p.lng], { icon: pallino(L, colore) })
              .addTo(mappa)
              .bindPopup(
                '<strong>' + p.insegna + '</strong><br>' + p.nome + '<br>' + p.indirizzo +
                  (p.telefono ? '<br>☎ ' + p.telefono : '')
              );
            coordinate.push([p.lat, p.lng]);
          });

          mappa.fitBounds(L.latLngBounds(coordinate).pad(0.15));
          setTimeout(function () { mappa.invalidateSize(); }, 60);

          // Stessi colori nella legenda sotto la mappa.
          const legenda = document.querySelector('.legenda-insegne');
          if (legenda) {
            insegne.forEach(function (nome, i) {
              const voce = legenda.querySelector('.insegna-' + i);
              if (voce) voce.style.setProperty('--colore-insegna', COLORI[i % COLORI.length]);
            });
          }
        })
        .catch(function () {
          messaggio(nodoPunti, 'Mappa non disponibile (serve la connessione a internet).');
        });
    }
  }

})();
