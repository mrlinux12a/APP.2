// Intestazioni di sicurezza delle risposte (helmet più due intestazioni che helmet non conosce).
const helmet = require('helmet');

// Quali regole di sicurezza mandare al browser, per ogni risposta.
// Una Content-Security-Policy completa (script-src) non è possibile: le pagine usano script e stili inline. Quella qui sotto non tocca gli script ma
// chiude le strade che non servono: il sito non si incornicia in pagine altrui (clickjacking, anche per i browser che ignorano X-Frame-Options),
// nessun <base> iniettato può cambiare dove puntano i collegamenti relativi, nessun <object>/<embed>, e i moduli si inviano solo a questo sito (un
// modulo iniettato non può portare i dati su un indirizzo esterno).
// Cosa helmet NON fa, di proposito:
//  · Strict-Transport-Security: lo mandiamo noi solo quando la richiesta è davvero HTTPS (con `trust proxy` vale anche dietro il proxy): su HTTP
//    semplice il browser lo ignorerebbe e in locale non deve restare appiccicato a localhost;
//  · Cross-Origin-Opener-Policy: romperebbe le finestre di Google Pay e di Link (pagamenti);
//  · Cross-Origin-Resource-Policy / Embedder-Policy: le foto del catalogo le carica anche l'app (e la sua anteprima nel browser, da un altro indirizzo).
function creaHelmet() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        // Niente `default-src`, di proposito: ne imporrebbe uno per script, stili e font, che qui non si può dare (le pagine hanno script e stili inline,
        // e caricano font, mappe e Stripe da altri indirizzi). helmet vuole che lo si dica esplicitamente.
        'default-src': helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc,
        'frame-ancestors': ["'self'"],
        'base-uri': ["'self'"],
        'object-src': ["'none'"],
        'form-action': ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: false,
    xFrameOptions: { action: 'sameorigin' },
  });
}

// Aggiunge le due intestazioni che helmet non gestisce: Permissions-Policy (quali funzioni del dispositivo può chiedere la pagina) e HSTS (solo su HTTPS).
// Il sito non usa fotocamera né microfono: niente script (nemmeno iniettato) può chiederli. La posizione sì, ma solo a questo sito (`self`) e solo dal
// pulsante accanto all'indirizzo di consegna del carrello: con `geolocation=()` il browser la bloccava sempre, su iPhone, Android e PC. `payment` resta
// com'è (Stripe lo usa per Apple Pay e Google Pay).
function permessiEHsts(req, res, next) {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
}

// Le intestazioni di sicurezza da montare per prime, nell'ordine giusto.
function intestazioniSicurezza() {
  return [creaHelmet(), permessiEHsts];
}

module.exports = { intestazioniSicurezza, creaHelmet, permessiEHsts };
