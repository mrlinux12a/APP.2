// Difesa in profondità contro il CSRF (un sito terzo che fa inviare un modulo al posto dell'utente), in aggiunta al cookie di sessione già impostato con
// sameSite:'lax' (che da solo blocca già la maggior parte degli invii cross-site).

// Dice se la richiesta arriva da una pagina di questo stesso sito: confronta l'host di Origin (o, in mancanza, di Referer) con quello della richiesta.
// Se mancano entrambe le intestazioni si lascia passare piuttosto che bloccare traffico legittimo: capita con alcuni browser/estensioni per la privacy,
// e sameSite:'lax' resta comunque la prima barriera.
function stessaOrigine(req) {
  const host = req.get('host');
  if (!host) return false;
  const origin = req.get('origin');
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  const referer = req.get('referer');
  if (referer) {
    try { return new URL(referer).host === host; } catch { return false; }
  }
  return true;
}

// I metodi che cambiano qualcosa sul server: solo questi si controllano.
const METODI_DA_VERIFICARE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Rifiuta (403) le richieste che cambiano stato se arrivano da un altro sito.
function controlloOrigine(req, res, next) {
  if (METODI_DA_VERIFICARE.has(req.method) && !stessaOrigine(req)) {
    return res.status(403).send('Richiesta rifiutata: origine non corrispondente.');
  }
  next();
}

module.exports = { stessaOrigine, controlloOrigine };
