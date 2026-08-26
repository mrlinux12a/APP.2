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

    function mostra(lat, lng, precisione) {
      caricaLeaflet()
        .then(function (L) {
          if (!mappa) {
            mappa = base(L, nodoGeo, 15);
            segno = L.marker([lat, lng], { icon: pallino(L, '#1d4e89') }).addTo(mappa);
            cerchio = L.circle([lat, lng], {
              radius: precisione || 40,
              color: '#1d4e89',
              weight: 1,
              fillOpacity: 0.12,
            }).addTo(mappa);
          } else {
            segno.setLatLng([lat, lng]);
            cerchio.setLatLng([lat, lng]).setRadius(precisione || 40);
          }
          mappa.setView([lat, lng], Math.max(mappa.getZoom() || 0, 15));
          nodoGeo.classList.add('mappa-attiva');
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

  // ---------- Mappa della consegna in tempo reale ----------

  const segui = document.querySelector('[data-segui-ordine]');
  if (segui) {
    const ordineId = segui.dataset.seguiOrdine;
    const titolo = segui.querySelector('[data-segui-titolo]');
    const stato = segui.querySelector('[data-segui-stato]');
    const nodo = segui.querySelector('[data-segui-mappa]');
    const legenda = segui.querySelector('[data-segui-legenda]');

    let mappa = null;
    let segnoMezzo = null;
    let segnoDest = null;
    let tratta = null;

    function disegna(d) {
      if (!nodo || !d.mezzo) return;
      caricaLeaflet()
        .then(function (L) {
          if (!mappa) {
            nodo.removeAttribute('hidden');
            mappa = base(L, nodo, 13);
            segnoMezzo = L.marker([d.mezzo.lat, d.mezzo.lng], { icon: pallino(L, '#1d4e89') })
              .addTo(mappa)
              .bindPopup('Mezzo del distributore');
          } else {
            segnoMezzo.setLatLng([d.mezzo.lat, d.mezzo.lng]);
          }

          if (d.destinazione) {
            if (!segnoDest) {
              segnoDest = L.marker([d.destinazione.lat, d.destinazione.lng], {
                icon: pallino(L, '#2e7d32'),
              })
                .addTo(mappa)
                .bindPopup('Destinazione');
            } else {
              segnoDest.setLatLng([d.destinazione.lat, d.destinazione.lng]);
            }

            const punti = [
              [d.mezzo.lat, d.mezzo.lng],
              [d.destinazione.lat, d.destinazione.lng],
            ];
            if (!tratta) {
              tratta = L.polyline(punti, { color: '#8a94a0', weight: 2, dashArray: '6 5' }).addTo(mappa);
            } else {
              tratta.setLatLngs(punti);
            }
            mappa.fitBounds(L.latLngBounds(punti).pad(0.35));
          } else {
            mappa.setView([d.mezzo.lat, d.mezzo.lng], 14);
          }

          if (legenda) legenda.removeAttribute('hidden');
          setTimeout(function () { mappa.invalidateSize(); }, 60);
        })
        .catch(function () {
          nodo.removeAttribute('hidden');
          messaggio(nodo, 'Mappa non disponibile (serve la connessione a internet).');
        });
    }

    function spegni() {
      if (nodo) nodo.setAttribute('hidden', '');
      if (legenda) legenda.setAttribute('hidden', '');
    }

    function aggiorna() {
      fetch('/api/ordini/' + ordineId + '/posizione')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.attivo || !d.mezzo) {
            if (titolo) titolo.textContent = 'Tracciamento non attivo';
            if (stato) {
              stato.textContent =
                'Il distributore condivide la posizione del mezzo quando la merce parte.';
            }
            spegni();
            return;
          }
          if (titolo) {
            titolo.textContent = 'Mezzo in viaggio' + (d.nome_mezzo ? ' — ' + d.nome_mezzo : '');
          }
          if (stato) {
            stato.textContent = d.distanza
              ? 'A ' + d.distanza + ' dalla destinazione, in aggiornamento continuo.'
              : 'Posizione condivisa dal banco. Attiva la tua posizione per vedere la distanza.';
          }
          disegna(d);
        })
        .catch(function () { /* riprova al giro dopo */ });
    }

    aggiorna();
    setInterval(aggiorna, 8000);
  }
})();
