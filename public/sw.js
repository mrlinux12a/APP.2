/* Service worker di Ordini Minuteria.

   Volutamente minimo: NON mette in cache pagine, CSS, JS o API. Le pagine sono dati di chi è collegato
   (richieste, ordini) e CSS/JS si aggiornano con una verifica ETag: una copia in cache li farebbe vedere
   vecchi. Serve a tre cose:
   1. mostrare le notifiche di sistema dove `new Notification(...)` non esiste (Chrome per Android):
      public/app.js chiama registration.showNotification(...) e qui si gestisce il tocco;
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

// Tocco su una notifica: porta sulla pagina indicata (solo di questo sito), riusando una finestra già aperta.
self.addEventListener('notificationclick', function (evento) {
  evento.notification.close();
  const dati = evento.notification.data || {};
  let destinazione = new URL('/', self.location.origin).href;
  try {
    const url = new URL(dati.link || '/', self.location.origin);
    if (url.origin === self.location.origin) destinazione = url.href;
  } catch (err) { /* resta la home */ }

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (finestre) {
      for (const finestra of finestre) {
        if (finestra.url.indexOf(self.location.origin) === 0 && 'focus' in finestra) {
          return finestra.focus().then(function (f) { return f && 'navigate' in f ? f.navigate(destinazione) : null; });
        }
      }
      return self.clients.openWindow(destinazione);
    })
  );
});
