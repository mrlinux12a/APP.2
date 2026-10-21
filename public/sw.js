/* Service worker di Ordini Minuteria.

   Volutamente minimo: NON mette in cache pagine, CSS, JS o API. Le pagine sono dati di chi è collegato
   (richieste, ordini) e CSS/JS si aggiornano con una verifica ETag: una copia in cache li farebbe vedere
   vecchi. Serve a quattro cose:
   0. ricevere le notifiche push ANCHE CON L'APP CHIUSA (evento `push`, src/web_push.js) e gestirne il tocco;
   1. mostrare le notifiche di sistema dove `new Notification(...)` non esiste (Chrome per Android, e su iPhone è
      la via sicura): public/app.js chiama registration.showNotification(...) e qui si gestisce il tocco;
   2. rendere l'app installabile sulla schermata Home (insieme a /manifest.webmanifest);
   3. al posto dell'errore del browser, quando una pagina non si carica perché manca la rete, mostrare /offline.html
      (l'unico file tenuto in cache). Solo per le navigazioni: immagini, script e chiamate /api non passano da qui
      e falliscono come prima, così l'app non finge mai di avere dati che non ha.
   Il browser lo accetta solo in HTTPS (o su localhost). */

const CACHE_OFFLINE = 'minuteria-offline-v1';
const PAGINA_OFFLINE = '/offline.html';

self.addEventListener('install', function (evento) {
  // `cache: 'reload'`: la copia della pagina offline è sempre quella aggiornata, non una già nella cache HTTP del browser. Se non si riesce a
  // scaricarla (rete assente durante l'installazione) il service worker si installa lo stesso: la pagina offline arriverà alla prossima versione.
  evento.waitUntil(
    caches.open(CACHE_OFFLINE)
      .then(function (cache) { return cache.add(new Request(PAGINA_OFFLINE, { cache: 'reload' })); })
      .catch(function () { /* niente pagina offline per ora */ })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (evento) {
  // Le cache di versioni precedenti si tolgono (stesso prefisso, nome diverso).
  evento.waitUntil(
    caches.keys()
      .then(function (nomi) {
        return Promise.all(nomi.filter(function (nome) { return nome.indexOf('minuteria-') === 0 && nome !== CACHE_OFFLINE; })
          .map(function (nome) { return caches.delete(nome); }));
      })
      .catch(function () { /* resta qualche cache vecchia: non fa danni */ })
      .then(function () { return self.clients.claim(); })
  );
});

// Una pagina che non si carica: rete prima, e se manca la connessione la pagina "Sei offline". Una risposta del server, anche un errore, passa com'è.
self.addEventListener('fetch', function (evento) {
  if (evento.request.mode !== 'navigate') return;
  evento.respondWith(
    fetch(evento.request).catch(function () {
      return caches.match(PAGINA_OFFLINE).then(function (offline) { return offline || Response.error(); });
    })
  );
});

// Una notifica push (src/web_push.js): arriva dal servizio push di Google/Apple/Mozilla anche con l'app CHIUSA, il browser sveglia questo file e qui si
// mostra la notifica di sistema, col suono e la vibrazione del telefono. Regole (richiesta esplicita del 21/10/2026):
//  · app CHIUSA o in SECONDO PIANO (nessuna finestra del sito in primo piano): notifica di sistema con suono;
//  · app APERTA e in PRIMO PIANO: nessuna notifica (si vede già tutto sullo schermo), né suono: il "ding" del sito non c'è più;
//  · SI MOSTRA però SEMPRE una notifica, anche in primo piano e qualunque cosa arrivi (messaggio vuoto o rovinato): Safari su iPhone e iPad non ammette push
//    "silenziose" e dopo tre che non mostrano niente CANCELLA l'iscrizione (l'utente dovrebbe riattivare le notifiche a mano), e non ha eccezioni per la finestra
//    in primo piano (WebKit). Quindi in primo piano la notifica si mostra SILENZIOSA (`silent: true`: niente suono, niente vibrazione, niente banner in
//    cima) e si chiude subito: per il sistema è mostrata, per l'utente non è successo niente. La notifica di PROVA (`tipo: 'prova'`) si mostra sempre, è
//    richiesta dall'utente per vedere che il telefono la riceve;
//  · il `tag` è l'id della notifica sul server ("minuteria-123"): se la pagina aperta ha già mostrato la stessa notifica, questa la sostituisce, non si raddoppia.
function inPrimoPiano() {
  // Una finestra del sito visibile E col fuoco: su telefono è l'app che si sta usando; su computer la scheda davanti, nella finestra attiva.
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (finestre) {
    return finestre.some(function (finestra) { return finestra.visibilityState === 'visible' && finestra.focused === true; });
  }).catch(function () { return false; });
}

self.addEventListener('push', function (evento) {
  let dati = {};
  try {
    dati = evento.data ? evento.data.json() : {};
  } catch (err) {
    try { dati = { testo: evento.data.text() }; } catch (err2) { dati = {}; }
  }
  if (!dati || typeof dati !== 'object') dati = {};
  const titolo = typeof dati.titolo === 'string' && dati.titolo ? dati.titolo : 'Minuteria';
  const tag = typeof dati.tag === 'string' && dati.tag ? dati.tag : '';
  const base = {
    body: typeof dati.testo === 'string' ? dati.testo : '',
    icon: '/icons/icona-192.png', // la "M" blu della notifica
    badge: '/icons/icona-distintivo-96.png', // la "M" bianca su trasparente, per la barra di stato di Android
    data: { link: typeof dati.link === 'string' ? dati.link : '/', tipo: dati.tipo || null },
  };
  const opzioni = Object.assign({
    silent: false,
    vibrate: [250, 120, 250],
    // Una richiesta da confermare nel banco aspetta una risposta, e un corriere trovato vuol dire "prepara il materiale": sul computer la notifica resta finché la si
    // tocca (su telefono è ignorato). Dal 21/10/2026 vale anche per "corriere trovato": prima spariva dopo pochi secondi e a banco lasciato un attimo non la vedeva nessuno.
    requireInteraction: dati.tipo === 'nuova_richiesta' || dati.tipo === 'corriere_trovato',
  }, base);
  // `renotify` senza `tag` è un errore del browser, e senza notifica vale la regola sopra.
  if (tag) { opzioni.tag = tag; opzioni.renotify = true; }

  const mostra = function () {
    return Promise.resolve().then(function () {
      return self.registration.showNotification(titolo, opzioni);
    }).catch(function () {
      // Opzioni rifiutate dal browser: una notifica semplice, ma una notifica.
      return self.registration.showNotification('Minuteria', { body: base.body || 'Hai una nuova notifica.', data: base.data });
    });
  };
  // In primo piano: mostrata in silenzio e chiusa subito (vedi sopra). Anche se la chiusura non riesce resta una notifica silenziosa, senza suono.
  const mostraESilenzia = function () {
    const tagSilenzioso = tag || 'minuteria-in-primo-piano';
    return Promise.resolve().then(function () {
      return self.registration.showNotification(titolo, Object.assign({ tag: tagSilenzioso, silent: true }, base));
    }).catch(function () {
      return self.registration.showNotification('Minuteria', { body: base.body || 'Hai una nuova notifica.', silent: true, data: base.data });
    }).then(function () {
      return self.registration.getNotifications({ tag: tagSilenzioso });
    }).then(function (aperte) {
      aperte.forEach(function (notifica) { notifica.close(); });
    }).catch(function () { /* resta silenziosa */ });
  };

  evento.waitUntil(inPrimoPiano().then(function (primoPiano) {
    return primoPiano && dati.tipo !== 'prova' ? mostraESilenzia() : mostra();
  }));
});

// Il browser ha cambiato o perso l'iscrizione (scadenza, chiavi ruotate): se sa dire con quali opzioni si era iscritto si rinnova da soli, altrimenti lo
// fa la pagina alla prossima apertura (public/app.js la confronta col <meta name="push-endpoint">). Safari non manda questo evento.
self.addEventListener('pushsubscriptionchange', function (evento) {
  const manda = function (iscrizione) {
    if (!iscrizione) return null;
    return fetch('/api/push/iscrivi', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ subscription: iscrizione.toJSON ? iscrizione.toJSON() : iscrizione }),
    });
  };
  let lavoro = null;
  if (evento.newSubscription) lavoro = Promise.resolve(manda(evento.newSubscription));
  else if (evento.oldSubscription && evento.oldSubscription.options && evento.oldSubscription.options.applicationServerKey) {
    lavoro = self.registration.pushManager.subscribe(evento.oldSubscription.options).then(manda);
  }
  if (lavoro) evento.waitUntil(lavoro.catch(function () { /* ci pensa la pagina */ }));
});

// Tocco su una notifica: porta sulla pagina indicata (solo di questo sito), riusando una finestra già aperta.
// Se la finestra non si lascia portare sulla pagina (`navigate` manca o fallisce: capita su iPhone) le si manda un messaggio e ci va da sola (public/app.js, "vai");
// se non si riesce neppure a metterla in primo piano se ne apre una nuova.
self.addEventListener('notificationclick', function (evento) {
  evento.notification.close();
  // Si entra nell'app: spariscono dalla tendina anche tutte le altre notifiche del sito (richiesta esplicita del 21/10/2026; la pagina fa lo stesso quando si apre
  // o torna in primo piano, public/app.js). Un errore qui non deve impedire di aprire la pagina.
  const chiudiLeAltre = Promise.resolve().then(function () {
    return self.registration.getNotifications();
  }).then(function (aperte) {
    aperte.forEach(function (notifica) { notifica.close(); });
  }).catch(function () { /* restano com'erano */ });
  const dati = evento.notification.data || {};
  let destinazione = new URL('/', self.location.origin).href;
  try {
    const url = new URL(dati.link || '/', self.location.origin);
    if (url.origin === self.location.origin) destinazione = url.href;
  } catch (err) { /* resta la home */ }

  const vaDaSola = function (finestra) {
    try { finestra.postMessage({ tipo: 'vai', url: destinazione }); } catch (err) { /* niente da fare */ }
  };
  evento.waitUntil(Promise.all([chiudiLeAltre,
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (finestre) {
      for (const finestra of finestre) {
        if (finestra.url.indexOf(self.location.origin) === 0 && 'focus' in finestra) {
          return finestra.focus().then(function (f) {
            const w = f || finestra;
            if (!('navigate' in w)) return vaDaSola(w);
            return Promise.resolve(w.navigate(destinazione)).catch(function () { vaDaSola(w); });
          }).catch(function () { return self.clients.openWindow(destinazione); });
        }
      }
      return self.clients.openWindow(destinazione);
    })
  ]));
});
