// Limite tentativi di login: senza, le credenziali si potevano provare senza alcun
// limite (brute force / credential stuffing). In memoria di processo — su un'unica
// istanza è sufficiente; non sopravvive a un riavvio né si condivide fra più istanze,
// ma è già una barriera concreta dove prima non c'era nulla. Condiviso fra il login web
// e quello dell'app (/api/v1/login), così i tentativi si sommano.
const tentativiLogin = new Map(); // chiave "ip|utente" -> { conteggio, dal }
const FINESTRA_LOGIN_MS = 10 * 60 * 1000;
const MAX_TENTATIVI_LOGIN = 8;

function chiaveLogin(req, username) {
  return req.ip + '|' + username.toLowerCase();
}

function loginBloccato(chiave) {
  const voce = tentativiLogin.get(chiave);
  if (!voce) return false;
  if (Date.now() - voce.dal > FINESTRA_LOGIN_MS) {
    tentativiLogin.delete(chiave);
    return false;
  }
  return voce.conteggio >= MAX_TENTATIVI_LOGIN;
}

function registraTentativoFallito(chiave) {
  const voce = tentativiLogin.get(chiave) || { conteggio: 0, dal: Date.now() };
  voce.conteggio += 1;
  tentativiLogin.set(chiave, voce);
}

function azzeraTentativi(chiave) {
  tentativiLogin.delete(chiave);
}

setInterval(() => {
  const ora = Date.now();
  for (const [chiave, voce] of tentativiLogin) {
    if (ora - voce.dal > FINESTRA_LOGIN_MS) tentativiLogin.delete(chiave);
  }
}, FINESTRA_LOGIN_MS).unref();

module.exports = { chiaveLogin, loginBloccato, registraTentativoFallito, azzeraTentativi };
