// Pezzi usati da più parti dell'API dell'app: lettura del token, controllo del cliente collegato e le forme JSON comuni (prodotti, categorie, importi).
const datiOrdini = require('../../logica/ordini/ordini');
const pricing = require('../../logica/pagamenti/pricing');
const format = require('../../comune/format');
const tokenApp = require('../../logica/account/token_app');

// Prende il token di accesso dalla richiesta (intestazione "Authorization: Bearer ..."), o niente se manca.
function tokenDellaRichiesta(req) {
  const intestazione = req.get('authorization') || '';
  const m = intestazione.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

// I dati dell'utente che l'app può vedere: id, nome utente, ragione sociale e ruolo.
function utenteJson(u) {
  return { id: u.id, username: u.username, ragione_sociale: u.ragione_sociale, ruolo: u.ruolo };
}

// Controllo d'accesso dell'API: lascia passare solo un installatore con un token valido (401 se il token manca o è scaduto, 403 se il ruolo non è
// quello giusto).
async function richiedeCliente(req, res, next) {
  const utente = await tokenApp.utenteDaToken(tokenDellaRichiesta(req));
  if (!utente) return res.status(401).json({ errore: 'Accesso scaduto: entra di nuovo.' });
  if (utente.ruolo !== 'cliente') return res.status(403).json({ errore: 'Accesso non consentito.' });
  req.utente = utente;
  next();
}

// Scrive un importo in euro come testo, con due decimali.
const e2 = (n) => pricing.euro(n);

// Le due parti di quello che l'installatore paga, in testo (pricing.importi): la consegna pagata in app e il materiale pagato dopo al banco.
function importiJson(i) {
  return {
    consegna: {
      totale: e2(i.app.totale),
      corriere: e2(i.app.corriere),
      servizio: e2(i.app.servizioIva), // il servizio come si mostra: con l'IVA dentro dal 23/10/2026 (`iva_inclusa`)
      servizio_pct: i.servizioPct,
      imponibile: e2(i.app.imponibile),
      iva: e2(i.app.iva), // se `iva_inclusa` è "di cui" (già nel totale), altrimenti una riga in più (importi di prima)
      iva_pct: i.ivaPct,
      iva_inclusa: !!i.app.ivaInclusa,
    },
    materiale: {
      totale: e2(i.banco.totale),
      merce: e2(i.banco.merce),
      raee: i.banco.raee > 0 ? e2(i.banco.raee) : null,
      imponibile: e2(i.banco.imponibile),
      iva: e2(i.banco.iva),
    },
    spesa: e2(pricing.round2(i.app.totale + i.banco.totale)),
  };
}

const TESTO_STATO_PAGAMENTO = {
  bloccato: 'Bloccato sulla carta',
  pagato: 'Pagata',
  annullato: 'Nessun addebito',
  rimborsato: 'Rimborsata',
};

// Cosa dice la carta (pagamenti.calcolaStatoPagamento): 'bloccato' | 'pagato' | 'annullato' | 'rimborsato'. null per le richieste del vecchio flusso.
function statoPagamentoJson(sp) {
  if (!sp) return null;
  return {
    chiave: sp.chiave,
    testo: TESTO_STATO_PAGAMENTO[sp.chiave] || '',
    importo: sp.importo === null || sp.importo === undefined ? null : e2(sp.importo),
    data: sp.data ? format.dataOraRoma(sp.data, ', ') : null,
    carta: sp.carta ? sp.carta.testo : null,
    ricevuta: !!sp.ricevuta,
    ricevuta_rimborso: !!sp.ricevutaRimborso,
    prova: !!sp.prova,
  };
}

// Trova l'ordine indicato nell'indirizzo e controlla che sia di questo cliente; altrimenti risponde 404 e restituisce niente.
async function ordineDelCliente(req, res) {
  const ordine = await datiOrdini.ordinePerId(req.params.id);
  if (!ordine || ordine.cliente_id !== req.utente.id) {
    res.status(404).json({ errore: 'Ordine non trovato.' });
    return null;
  }
  return ordine;
}

module.exports = { e2, importiJson, ordineDelCliente, richiedeCliente, statoPagamentoJson, tokenDellaRichiesta, utenteJson };
