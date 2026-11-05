/* Comportamenti lato client dell'app cliente: selettori quantità, ricerca parziale
   mentre si digita, countdown della finestra di 10 minuti e notifiche del browser. */

/* Pezzi condivisi fra i blocchi di questo file (ognuno vive nel suo scope). */
const Minuteria = (function () {
  'use strict';

  // Stesso tetto del server (src/comune/input.js): una quantità oltre non ha senso per un articolo di minuteria.
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

  // Le notifiche sono SOLO notifiche di sistema, col suono del telefono: nessun suono del sito dentro la pagina (richiesta esplicita del 21/10/2026), e con l'app
  // aperta in primo piano nessuna notifica (si vede già tutto sullo schermo). `silent: false` e `vibrate` chiedono al sistema di far suonare e vibrare (il suono
  // vero lo decide il telefono: su Android vale il canale "Notifiche" del browser o dell'app, su iPhone la suoneria delle notifiche; non si può forzare da una
  // pagina). `renotify` fa suonare anche se il tag si ripete. `new Notification(...)` esiste su desktop e solo in certi casi su iOS, e Chrome per Android lo
  // rifiuta (TypeError): si passa dal service worker (/sw.js), che gestisce anche il tocco sulla notifica.
  const OPZIONI_SUONO = { silent: false, vibrate: [250, 120, 250], renotify: true };

  // Il service worker pronto, o null se non c'è (pagina non sicura, registrazione fallita, browser senza) o non lo diventa entro `attesaMs`:
  // `navigator.serviceWorker.ready` da solo non si risolve mai se nessun service worker si registra, e chi lo aspettava restava appeso.
  function registrazioneSw(attesaMs) {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (ok) { setTimeout(function () { ok(null); }, attesaMs); }),
    ]).catch(function () { return null; });
  }

  // Mostra una notifica di sistema. Ritorna una promessa: true se l'ha mostrata, false se no (già visibile, o nessun modo di mostrarla).
  // La via normale è il service worker (`showNotification`): funziona su Android, su computer e su iPhone/iPad (web app installata), dove `new Notification` c'è
  // solo in certi casi e altrove lancia. Il costruttore resta come ripiego quando il service worker manca.
  // Se la notifica con lo stesso tag ("minuteria-<id>") è già sullo schermo (per esempio perché è arrivata come push ad app chiusa un attimo prima) non se ne
  // fa una seconda, che con `renotify` farebbe suonare di nuovo.
  function mostraNotifica(titolo, testo, link, tag) {
    const opzioni = Object.assign({ body: testo, data: { link: link || '/' }, icon: '/icons/icona-192.png', badge: '/icons/icona-distintivo-96.png' }, OPZIONI_SUONO);
    if (tag) opzioni.tag = tag;
    else delete opzioni.renotify; // `renotify` senza `tag` è un errore del browser
    const comeFinestra = function () {
      try {
        const notifica = new Notification(titolo, opzioni);
        if (link) {
          notifica.onclick = function () {
            window.focus();
            window.location.href = link;
          };
        }
        return true;
      } catch (err) {
        return false; // nessuna notifica: l'avviso resta comunque in "Stato ordini"
      }
    };
    return registrazioneSw(3000).then(function (registrazione) {
      if (!registrazione || typeof registrazione.showNotification !== 'function') return comeFinestra();
      const mostra = function () {
        return registrazione.showNotification(titolo, opzioni).then(function () { return true; });
      };
      if (!/^minuteria-\d+$/.test(tag || '') || typeof registrazione.getNotifications !== 'function') return mostra();
      return registrazione.getNotifications({ tag: tag }).then(function (aperte) { return aperte.length ? false : mostra(); });
    }).catch(comeFinestra);
  }

  // ---------- Notifiche anche ad app chiusa (Web Push, src/logica/notifiche/web_push.js) ----------
  // Il browser si iscrive al servizio push (Google, Apple, Mozilla...) con la chiave pubblica del sito (<meta name="push-chiave">, assente se sul server le push
  // sono spente) e manda l'iscrizione al server, che da quel momento può far arrivare le notifiche anche con l'app chiusa: le mostra il service worker.
  // <meta name="push-endpoint"> è l'iscrizione che il server ha già per questa sessione: se coincide con quella del browser non si manda niente.
  // Su iPhone/iPad funziona solo per la web app installata sulla schermata Home (iOS 16.4 o successivo); in una scheda di Safari manca proprio `Notification`.
  function meta(nome) {
    const m = document.querySelector('meta[name="' + nome + '"]');
    return m ? m.getAttribute('content') || '' : '';
  }
  function eIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function eInstallata() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function pushDisponibile() {
    return !!meta('push-chiave') && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function chiaveInBytes(base64url) {
    const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
    const testo = atob(b64);
    const byte = new Uint8Array(testo.length);
    for (let i = 0; i < testo.length; i++) byte[i] = testo.charCodeAt(i);
    return byte;
  }
  // Due chiavi uguali? Se il browser non dice con quale chiave si era iscritto (alcuni non lo espongono) si dà per buona: meglio non disiscrivere per niente.
  function stessaChiave(vecchia, nuova) {
    if (!vecchia) return true;
    const a = new Uint8Array(vecchia);
    if (a.length !== nuova.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== nuova[i]) return false;
    return true;
  }
  function postJson(url, corpo) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(corpo) });
  }
  function ricordaEndpoint(endpoint) {
    let m = document.querySelector('meta[name="push-endpoint"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'push-endpoint'); document.head.appendChild(m); }
    m.setAttribute('content', endpoint);
  }

  // Iscrive questo browser (serve il permesso già concesso). `forza`: manda l'iscrizione al server anche se sembra che ce l'abbia già (clic su "Attiva").
  // Ritorna una promessa: true se il server ha l'iscrizione, false in ogni altro caso (push spente, non supportate, errore). Non lancia mai.
  function iscriviPush(opzioni) {
    const forza = !!(opzioni && opzioni.forza);
    if (!pushDisponibile() || Notification.permission !== 'granted') return Promise.resolve(false);
    const chiave = chiaveInBytes(meta('push-chiave'));
    return registrazioneSw(8000).then(function (registrazione) {
      if (!registrazione || !registrazione.pushManager) return false;
      return registrazione.pushManager.getSubscription().then(function (esistente) {
        // Iscrizione fatta con un'altra chiave (le chiavi del sito sono state cambiate): non funzionerebbe più, si rifà.
        if (esistente && !stessaChiave(esistente.options && esistente.options.applicationServerKey, chiave)) return esistente.unsubscribe().then(function () { return null; });
        return esistente;
      }).then(function (esistente) {
        return esistente || registrazione.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chiave });
      }).then(function (iscrizione) {
        if (!forza && iscrizione.endpoint === meta('push-endpoint')) return true;
        return postJson('/api/push/iscrivi', { subscription: iscrizione.toJSON() }).then(function (r) {
          if (r.ok) ricordaEndpoint(iscrizione.endpoint);
          return r.ok;
        });
      });
    }).catch(function () { return false; });
  }

  // Toglie l'iscrizione di questo browser (interruttore spento): non arriverà più niente ad app chiusa. Non lancia mai.
  function disiscriviPush() {
    if (!pushDisponibile()) return Promise.resolve(false);
    return registrazioneSw(3000).then(function (registrazione) {
      if (!registrazione || !registrazione.pushManager) return false;
      return registrazione.pushManager.getSubscription().then(function (iscrizione) {
        if (!iscrizione) return postJson('/api/push/disiscrivi', {}).then(function () { return true; });
        const endpoint = iscrizione.endpoint;
        return iscrizione.unsubscribe().then(function () { return postJson('/api/push/disiscrivi', { endpoint: endpoint }); }).then(function () {
          ricordaEndpoint('');
          return true;
        });
      });
    }).catch(function () { return false; });
  }

  // La notifica di prova passa dal server come una vera (arriva dal servizio push): se arriva, tutto il percorso funziona, anche ad app chiusa.
  // `dopoSec` (0-30): quanti secondi aspettare, per avere il tempo di chiudere l'app. Ritorna { ok, errore }.
  function provaPush(dopoSec) {
    return postJson('/api/push/prova', { dopoSec: dopoSec || 0 })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return { ok: false, errore: 'Il server non risponde.' }; });
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
    pushDisponibile: pushDisponibile,
    iscriviPush: iscriviPush,
    disiscriviPush: disiscriviPush,
    provaPush: provaPush,
    eIos: eIos,
    eInstallata: eInstallata,
    durataMinuti: durataMinuti,
    daMinuti: daMinuti,
    tempoTrascorso: tempoTrascorso,
  };
})();

