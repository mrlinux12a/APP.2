function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(ruolo) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.ruolo !== ruolo) return res.status(403).send('Accesso non consentito.');
    next();
  };
}

module.exports = { requireLogin, requireRole };
