// Limiti ai tentativi: senza, le credenziali si potevano provare senza alcun limite (brute force / credential
// stuffing) e la registrazione, aperta a tutti, poteva riempire il database di anagrafiche finte. In memoria di
// processo — su un'unica istanza è sufficiente; non sopravvive a un riavvio né si condivide fra più istanze, ma è già
// una barriera concreta dove prima non c'era nulla. Condiviso fra il login web e quello dell'app (/api/v1/login), così
// i tentativi si sommano.
//
// Tre contatori, ognuno con la sua finestra:
//  · login, per COPPIA indirizzo + nome utente (8 errori in 10 minuti): ferma chi insiste su un utente;
//  · login, per solo INDIRIZZO (60 errori in 10 minuti, su qualunque nome): ferma chi prova una password su molti utenti
//    (password spraying), che il contatore per coppia non vede mai. La soglia è alta perché dietro un proxy mal configurato
//    tanti clienti possono condividere lo stesso indirizzo;
//  · registrazioni, per indirizzo (12 all'ora).

// Un contatore a finestra fissa: dopo `massimo` eventi nella finestra, `colpito` risponde true fino alla fine della finestra.
function creaLimite({ finestraMs, massimo }) {
  const voci = new Map(); // chiave -> { conteggio, dal }
  const scaduta = (voce, ora) => ora - voce.dal > finestraMs;

  const timer = setInterval(() => {
    const ora = Date.now();
    for (const [chiave, voce] of voci) if (scaduta(voce, ora)) voci.delete(chiave);
  }, Math.min(finestraMs, 10 * 60 * 1000));
  if (timer.unref) timer.unref();

  return {
    colpito(chiave) {
      const voce = voci.get(chiave);
      if (!voce) return false;
      if (scaduta(voce, Date.now())) {
        voci.delete(chiave);
        return false;
      }
      return voce.conteggio >= massimo;
    },
    registra(chiave) {
      const ora = Date.now();
      let voce = voci.get(chiave);
      if (!voce || scaduta(voce, ora)) voce = { conteggio: 0, dal: ora };
      voce.conteggio += 1;
      voci.set(chiave, voce);
    },
    azzera(chiave) {
      voci.delete(chiave);
    },
    // Solo per le prove.
    svuota() {
      voci.clear();
    },
  };
}

const FINESTRA_LOGIN_MS = 10 * 60 * 1000;
const MAX_TENTATIVI_LOGIN = 8;
const MAX_TENTATIVI_PER_INDIRIZZO = 60;
const FINESTRA_ISCRIZIONI_MS = 60 * 60 * 1000;
const MAX_ISCRIZIONI_PER_INDIRIZZO = 12;

const perCoppia = creaLimite({ finestraMs: FINESTRA_LOGIN_MS, massimo: MAX_TENTATIVI_LOGIN });
const perIndirizzo = creaLimite({ finestraMs: FINESTRA_LOGIN_MS, massimo: MAX_TENTATIVI_PER_INDIRIZZO });
const iscrizioni = creaLimite({ finestraMs: FINESTRA_ISCRIZIONI_MS, massimo: MAX_ISCRIZIONI_PER_INDIRIZZO });

const indirizzo = (req) => String((req && req.ip) || 'sconosciuto');

function chiaveLogin(req, username) {
  return indirizzo(req) + '|' + String(username || '').toLowerCase();
}

// ---- Interfaccia per chi ha già la chiave (compatibilità) ----
function loginBloccato(chiave) {
  return perCoppia.colpito(chiave);
}
function registraTentativoFallito(chiave) {
  perCoppia.registra(chiave);
}
function azzeraTentativi(chiave) {
  perCoppia.azzera(chiave);
}

// ---- Interfaccia per le route di login: guarda anche l'indirizzo da solo ----
function accessoBloccato(req, username) {
  return perCoppia.colpito(chiaveLogin(req, username)) || perIndirizzo.colpito(indirizzo(req));
}
function registraAccessoFallito(req, username) {
  perCoppia.registra(chiaveLogin(req, username));
  perIndirizzo.registra(indirizzo(req));
}
// Un accesso riuscito azzera solo la coppia: l'indirizzo continua a contare i suoi errori (un attaccante che ha una
// password giusta non deve poter "ripulire" il contatore dei suoi tentativi sugli altri utenti).
function accessoRiuscito(req, username) {
  perCoppia.azzera(chiaveLogin(req, username));
}

// ---- Registrazioni ----
function iscrizioneBloccata(req) {
  return iscrizioni.colpito(indirizzo(req));
}
function registraIscrizione(req) {
  iscrizioni.registra(indirizzo(req));
}

function svuotaTutto() {
  perCoppia.svuota();
  perIndirizzo.svuota();
  iscrizioni.svuota();
}

module.exports = {
  chiaveLogin,
  loginBloccato,
  registraTentativoFallito,
  azzeraTentativi,
  accessoBloccato,
  registraAccessoFallito,
  accessoRiuscito,
  iscrizioneBloccata,
  registraIscrizione,
  svuotaTutto,
  creaLimite,
  MAX_TENTATIVI_PER_INDIRIZZO,
  MAX_ISCRIZIONI_PER_INDIRIZZO,
};
