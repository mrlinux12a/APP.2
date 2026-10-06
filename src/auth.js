const { rispondiErrore, vuoleJson } = require('./http');

// Sessione scaduta: una pagina porta al login, mentre una chiamata a /api/... riceve un 401 in JSON
// (un redirect finirebbe nella pagina HTML di login e il `.json()` di chi chiama andrebbe in errore).
function nonCollegato(req, res) {
  if (vuoleJson(req)) return rispondiErrore(req, res, 401);
  return res.redirect('/login');
}

function requireLogin(req, res, next) {
  if (!req.session.user) return nonCollegato(req, res);
  next();
}

function requireRole(ruolo) {
  return (req, res, next) => {
    if (!req.session.user) return nonCollegato(req, res);
    if (req.session.user.ruolo !== ruolo) return rispondiErrore(req, res, 403, { link: '/', linkTesto: 'Torna all’inizio' });
    next();
  };
}

module.exports = { requireLogin, requireRole };
