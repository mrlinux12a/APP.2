/* Service worker di Ordini Minuteria.

   Volutamente minimo: NON mette in cache pagine, CSS, JS o API. Le pagine sono dati di chi è collegato
   (richieste, ordini) e CSS/JS si aggiornano con una verifica ETag: una copia in cache li farebbe vedere
   vecchi. Serve solo a due cose:
   1. mostrare le notifiche di sistema dove `new Notification(...)` non esiste (Chrome per Android):
      public/app.js chiama registration.showNotification(...) e qui si gestisce il tocco;
   2. rendere l'app installabile sulla schermata Home (insieme a /manifest.webmanifest).
   Il browser lo accetta solo in HTTPS (o su localhost). */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(self.clients.claim());
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
