// Ricevute di pagamento in PDF: il link firmato e il file.
const { creaRouter } = require('../base');
const crypto = require('crypto');
const ricevuteModulo = require('../../logica/pagamenti/ricevute');
const { ordineDelCliente, richiedeCliente } = require('./ausiliari');

const router = creaRouter();

// Il telefono non può mandare l'intestazione Authorization quando apre un PDF nel browser o nel lettore di sistema: per questo la ricevuta si
// scarica da un indirizzo firmato (HMAC) valido pochi minuti, fatto per UN ordine e UN cliente. Chi non ha il link non scarica niente; chi lo
// perde dopo cinque minuti non scarica più.
const VALIDITA_LINK_RICEVUTA_SEC = 5 * 60;

// La chiave segreta con cui si firmano gli indirizzi temporanei delle ricevute (ricavata dal segreto del server).
const segretoLink = () =>
  crypto.createHash('sha256').update('ricevuta-app|' + (process.env.SESSION_SECRET || process.env.DATABASE_URL || 'sviluppo-locale')).digest();

// La firma di un indirizzo temporaneo di ricevuta: lega insieme ordine, cliente e scadenza, così nessuno può cambiarli.
const firmaLink = (ordineId, clienteId, scadenza) =>
  crypto.createHmac('sha256', segretoLink()).update(`${ordineId}|${clienteId}|${scadenza}`).digest('hex');

// L'indirizzo base del sito: quello fisso del .env se c'è, altrimenti quello da cui è arrivata la richiesta.
function baseUrl(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || req.protocol + '://' + req.get('host');
}

// Dà all'app un indirizzo firmato e a scadenza per aprire la ricevuta PDF dell'ordine (il telefono non può mandare il token quando apre un PDF).
router.post('/ordini/:id/ricevuta', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  const dati = await ricevuteModulo.datiRicevuta(ordine.id, { tipo: 'pagamento', clienteId: req.utente.id });
  if (!dati) return res.status(404).json({ errore: 'Per questo ordine non c’è una ricevuta di pagamento.' });
  const scadenza = Math.floor(Date.now() / 1000) + VALIDITA_LINK_RICEVUTA_SEC;
  const firma = firmaLink(ordine.id, req.utente.id, scadenza);
  res.json({ url: `${baseUrl(req)}/api/v1/ricevute/${ordine.id}.pdf?c=${req.utente.id}&e=${scadenza}&s=${firma}` });
});

// Scarica la ricevuta PDF di un ordine, ma solo con un indirizzo firmato ancora valido.
router.get('/ricevute/:ordineId.pdf', async (req, res) => {
  const ordineId = Number(req.params.ordineId);
  const clienteId = Number(req.query.c);
  const scadenza = Number(req.query.e);
  const firma = String(req.query.s || '');
  const attesa = Number.isInteger(ordineId) && ordineId > 0 && Number.isInteger(clienteId) && Number.isInteger(scadenza) ? firmaLink(ordineId, clienteId, scadenza) : '';
  const valida = attesa.length === firma.length && attesa.length > 0 && crypto.timingSafeEqual(Buffer.from(attesa), Buffer.from(firma));
  if (!valida || scadenza < Math.floor(Date.now() / 1000)) return res.status(403).json({ errore: 'Il link della ricevuta non è valido o è scaduto: riaprila dall’app.' });
  const dati = await ricevuteModulo.datiRicevuta(ordineId, { tipo: 'pagamento', clienteId });
  if (!dati) return res.status(404).json({ errore: 'Ricevuta non disponibile.' });
  const pdf = await ricevuteModulo.pdfRicevute([dati], 'Ricevuta di pagamento');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="' + ricevuteModulo.nomeFilePdf(dati) + '"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf);
});

module.exports = router;
