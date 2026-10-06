// API JSON dell'app nativa (cartella mobile/). Stessa logica delle pagine web — le
// funzioni di catalogo, prezzi, richieste e ordini sono quelle di src/ — ma
// autenticazione con token invece del cookie di sessione.
//
// Per ora l'app è solo per gli installatori (ruolo 'cliente'): il banco e l'agente
// continuano a usare il sito.
const express = require('express');

const db = require('../db');
const catalogo = require('./catalogo');
const pricing = require('./pricing');
const richieste = require('./richieste');
const flusso = require('./flusso_cliente');
const format = require('./format');
const notifiche = require('./notifiche');
const tokenApp = require('./token_app');
const { prodottoJson } = require('./prodotto_json');
const { chiaveLogin, loginBloccato, registraTentativoFallito, azzeraTentativi } = require('./limite_login');
const { passwordValida } = require('./password');
const { idNumerico } = require('./http');

const router = express.Router();

// Un id che non è un numero intero positivo non esiste: 404 in JSON invece di una query che fallisce (500).
router.param('id', idNumerico);

// Nessun cookie in gioco: l'unica credenziale è l'intestazione Authorization, che un sito
// terzo non può far inviare al posto dell'utente. Aprire l'origine non espone quindi nulla
// e permette di provare l'app anche nel browser durante lo sviluppo (expo start --web).
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function tokenDellaRichiesta(req) {
  const intestazione = req.get('authorization') || '';
  const m = intestazione.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function utenteJson(u) {
  return { id: u.id, username: u.username, ragione_sociale: u.ragione_sociale, ruolo: u.ruolo };
}

async function richiedeCliente(req, res, next) {
  const utente = await tokenApp.utenteDaToken(tokenDellaRichiesta(req));
  if (!utente) return res.status(401).json({ errore: 'Accesso scaduto: entra di nuovo.' });
  if (utente.ruolo !== 'cliente') return res.status(403).json({ errore: 'Accesso non consentito.' });
  req.utente = utente;
  next();
}

// Formato prodotto dell'app: quello già usato dalla ricerca live del sito, più i valori
// numerici del prezzo (servono all'app per il totale indicativo del carrello) e lo sconto
// di ogni variante (per il prezzo di listino barrato).
function prodottoApp(p, servizioPct) {
  const base = prodottoJson(p, servizioPct);
  return {
    ...base,
    categoria: p.categoria || null,
    prezzo_valore: pricing.prezzoClienteConPct(p, servizioPct),
    varianti: base.varianti
      ? base.varianti.map((v, i) => ({
          ...v,
          sconto_base_pct: p.varianti[i].sconto_base_pct,
          prezzo_valore: pricing.prezzoClienteConPct(p.varianti[i], servizioPct),
        }))
      : null,
  };
}

async function elencoJson(elenco) {
  const servizioPct = await pricing.getServizioPct();
  return {
    risultati: elenco.righe.map((p) => prodottoApp(p, servizioPct)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  };
}

function macroJson(m) {
  return { slug: m.slug, nome: m.nome, descrizione: m.descrizione, n_prodotti: Number(m.n_prodotti) || 0 };
}

// ---------- Accesso ----------

router.post('/login', async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim().slice(0, 100);
  const chiave = chiaveLogin(req, username);

  if (loginBloccato(chiave)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
  if (!(await passwordValida(req.body && req.body.password, user))) {
    registraTentativoFallito(chiave);
    return res.status(401).json({ errore: 'Credenziali non valide.' });
  }
  azzeraTentativi(chiave);
  if (user.ruolo !== 'cliente') {
    return res.status(403).json({ errore: "Per ora l'app è riservata agli installatori: accedi dal sito." });
  }
  const token = await tokenApp.creaToken(user.id, req.body && req.body.dispositivo);
  res.json({ token, utente: utenteJson(user) });
});

router.post('/logout', async (req, res) => {
  await tokenApp.revocaToken(tokenDellaRichiesta(req));
  res.json({ ok: true });
});

router.get('/me', richiedeCliente, async (req, res) => {
  res.json({ utente: utenteJson(req.utente) });
});

// ---------- Catalogo ----------

router.get('/catalogo', richiedeCliente, async (req, res) => {
  const [{ inEvidenza, altre }, conFoto] = await Promise.all([
    catalogo.categorieHome(),
    catalogo.contaProdottiConFoto(),
  ]);
  res.json({ in_evidenza: inEvidenza.map(macroJson), altre: altre.map(macroJson), con_foto: conFoto });
});

// Ricerca mentre si digita, con lo stesso ambito delle pagine del sito (categoria,
// sottocategoria). I marchi non ci sono: nel sito /marchi non è collegato da nessuna
// pagina e oggi nessun marchio ha prodotti attivi.
router.get('/cerca', richiedeCliente, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ risultati: [] });
  const risultati = await catalogo.cercaProdotti(q, {
    macroSlug: req.query.macro || null,
    sotto: req.query.sotto || null,
    limite: 60,
  });
  const servizioPct = await pricing.getServizioPct();
  res.json({ risultati: risultati.map((p) => prodottoApp(p, servizioPct)) });
});

router.get('/categorie/:slug', richiedeCliente, async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ errore: 'Categoria non trovata.' });
  const sottocategorie = await catalogo.sottocategorieDi(macro.slug);
  res.json({
    macro: { slug: macro.slug, nome: macro.nome, descrizione: macro.descrizione },
    sottocategorie: sottocategorie.map((s) => ({ slug: s.slug, nome: s.nome, n: Number(s.n) || 0 })),
  });
});

router.get('/categorie/:slug/prodotti', richiedeCliente, async (req, res) => {
  const macro = await catalogo.macroCategoria(req.params.slug);
  if (!macro) return res.status(404).json({ errore: 'Categoria non trovata.' });
  const elenco = await catalogo.prodottiDellaCategoria(macro.slug, {
    sotto: req.query.sotto || null,
    pagina: req.query.pagina,
  });
  res.json(await elencoJson(elenco));
});

router.get('/con-foto', richiedeCliente, async (req, res) => {
  res.json(await elencoJson(await catalogo.prodottiConFoto({ pagina: req.query.pagina })));
});

// ---------- Carrello e richiesta di disponibilità ----------

// Il carrello dell'app sta sul telefono: qui arrivano le quantità e il server rifà i conti
// con i prezzi veri, come la pagina Carrello del sito (merce, RAEE, spedizione, minimo).
router.post('/carrello/riepilogo', richiedeCliente, async (req, res) => {
  const righe = await flusso.righeDaQuantita(req.body && req.body.righe);
  const r = await flusso.riepilogoCarrello(righe);
  const presenti = new Set(righe.map((x) => x.prodotto.id));
  res.json({
    merce: pricing.euro(r.totali.totale_finale),
    raee: r.totali.contributo_raee > 0 ? pricing.euro(r.totali.contributo_raee) : null,
    spedizione: pricing.euro(r.spedizione),
    // Totale da pagare: l'installatore paga all'invio della richiesta (pagamento simulato).
    imponibile: pricing.euro(r.totali.imponibile),
    iva: pricing.euro(r.totali.iva),
    iva_pct: r.ivaPct,
    totale_ivato: pricing.euro(r.totali.totale_ivato),
    // Destinazione di partenza: l'indirizzo di consegna abituale (il cliente può cambiarlo).
    indirizzo_consegna: req.utente.indirizzo_consegna || '',
    minimo: pricing.euro(r.minimo),
    manca_al_minimo: pricing.euro(r.mancaAlMinimo),
    raggiunto: r.raggiunto,
    minuti_risposta: Math.round(r.minutiRisposta),
    // Articoli tolti dal catalogo dopo essere finiti nel carrello: l'app li segnala.
    non_piu_disponibili: ((req.body && req.body.righe) || [])
      .map((v) => parseInt(v && v.id, 10))
      .filter((id) => id && !presenti.has(id)),
  });
});

// Paga (simulato) e invia la richiesta, con destinazione e note scritte nel carrello.
router.post('/richieste', richiedeCliente, async (req, res) => {
  try {
    const body = req.body || {};
    const id = await flusso.nuovaRichiesta(req.utente.id, await flusso.righeDaQuantita(body.righe), {
      destinazione: body.destinazione,
      note: body.note,
    });
    res.json({ id });
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    res.status(400).json({ errore: e.message, titolo: e.titolo, codice: e.codice, request_id: e.requestId || null });
  }
});

const ESITO_RISPOSTA = {
  in_attesa: 'In attesa',
  confermato: 'Disponibile',
  non_disponibile: 'Non disponibile',
};

function righeJson(righe) {
  return righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice }));
}

// Il pagamento di una richiesta (simulato, vedi src/pagamenti.js): null se la richiesta è nata col
// vecchio flusso e non ha pagamento.
function pagamentoJson(r) {
  if (!r || !r.pagamento_stato) return null;
  return {
    stato: r.pagamento_stato,
    stato_testo: r.pagamento_stato === 'rimborsato' ? 'Rimborsato' : 'Pagato',
    importo: pricing.euro(r.pagamento_importo),
    simulato: r.pagamento_metodo === 'simulato',
    pagato_il: r.pagato_il ? format.dataOra(r.pagato_il) : null,
  };
}

async function richiestaDelCliente(req, res) {
  const richiesta = await richieste.aggiornaScadenza(req.params.id);
  if (!richiesta || richiesta.cliente_id !== req.utente.id) {
    res.status(404).json({ errore: 'Richiesta non trovata.' });
    return null;
  }
  return richiesta;
}

// Una richiesta com'è ora: attesa con conto alla rovescia, chiusa senza ordine (nessuno ha confermato:
// pagamento rimborsato), annullata o (con order_id) già diventata ordine. L'app la rilegge ogni pochi secondi.
router.get('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const d = await flusso.dettaglioRichiesta(richiesta);
  res.json({
    id: richiesta.id,
    stato: richiesta.stato,
    order_id: richiesta.stato === 'ordinata' ? richiesta.order_id : null,
    creato_il: format.dataOra(richiesta.creato_il),
    secondi: d.secondi,
    minuti_risposta: Math.round(d.minutiRisposta),
    righe: righeJson(d.righe),
    risposte: d.risposte.map((r) => ({
      distributore: r.distributore_nome,
      filiale: r.filiale,
      esito: r.esito,
      esito_testo: ESITO_RISPOSTA[r.esito] || 'Nessuna risposta',
    })),
    // Pagamento fatto all'invio (null per le richieste del vecchio flusso).
    pagamento: pagamentoJson(richiesta),
  });
});

router.post('/richieste/:id/annulla', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const ok = await flusso.annullaRichiesta(richiesta.id);
  res.json({ ok });
});

router.post('/richieste/:id/reinvia', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  res.json({ id: await flusso.reinviaRichiesta(richiesta) });
});

router.delete('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  try {
    await flusso.eliminaRichiesta(richiesta.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: 'Il distributore ha già preso in carico questo ordine: per annullarlo contattalo direttamente.',
    });
  }
  res.json({ ok: true });
});

// ---------- Ordine ----------

// Non ci sono più la scelta dell'offerta né "Invia l'ordine": l'installatore paga con la richiesta
// (POST /richieste) e l'ordine nasce da solo quando il corriere prende la consegna.

function statoOrdineTesto(ordine) {
  if (ordine.consegnato_il) return 'Consegnato';
  if (ordine.stato === 'inviato') return 'Inviato';
  if (ordine.stato === 'in_evasione') return 'In preparazione';
  return 'In consegna';
}

async function ordineDelCliente(req, res) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.utente.id) {
    res.status(404).json({ errore: 'Ordine non trovato.' });
    return null;
  }
  return ordine;
}

router.get('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  // Il cliente sta guardando proprio questo ordine: niente pallino per i suoi cambi di stato.
  await notifiche.segnaLetteCategoria(req.utente.id, 'ordini');
  await notifiche.segnaLetteCategoria(req.utente.id, 'richieste');
  const d = await flusso.dettaglioOrdine(ordine);
  res.json({
    id: ordine.id,
    stato: ordine.stato,
    stato_testo: statoOrdineTesto(ordine),
    consegnato: !!ordine.consegnato_il,
    tempo_testo: ordine.consegnato_il
      ? 'Consegnato il ' + format.dataOra(ordine.consegnato_il)
      : ordine.modalita === 'ritiro'
        ? 'Pronto per il ritiro al banco'
        : ordine.corriere_arrivo_il
          ? 'Consegna prevista entro le ' + format.oraRoma(ordine.corriere_arrivo_il)
          : ordine.consegna_ore
            ? 'Arriva entro ' + format.tempoConsegna(ordine.consegna_ore)
            : 'Tempi di consegna da confermare',
    creato_il: format.dataOra(ordine.creato_il),
    // Solo la ditta: la filiale da cui parte l'ordine non si mostra all'installatore.
    distributore: d.distributore ? { nome: d.distributore.nome, filiale: '' } : null,
    modalita: ordine.modalita,
    modalita_testo: ordine.modalita === 'ritiro' ? 'Ritiro al banco' : 'Consegna con mezzo del distributore',
    tempi_testo: ordine.corriere_arrivo_il
      ? 'Consegna con corriere, prevista entro le ' + format.oraRoma(ordine.corriere_arrivo_il)
      : (ordine.partenza_ore ? 'Partenza stimata: ' + format.tempoConsegna(ordine.partenza_ore) + ' · ' : '') +
        (ordine.consegna_ore ? 'consegna stimata: ' + format.tempoConsegna(ordine.consegna_ore) : 'tempo da concordare'),
    destinazione: ordine.destinazione || null,
    note: ordine.note || null,
    ddt: ordine.ddt_numero ? { numero: ordine.ddt_numero, data: format.dataSola(ordine.ddt_data) } : null,
    righe: d.righe.map((r) => ({
      quantita: r.quantita,
      nome: r.nome_snapshot,
      codice: r.codice_snapshot,
      subtotale: pricing.euro(r.subtotale_cliente),
    })),
    totali: {
      merce: pricing.euro(ordine.totale_finale),
      raee: ordine.contributo_raee > 0 ? pricing.euro(ordine.contributo_raee) : null,
      consegna: ordine.costo_consegna > 0 ? pricing.euro(ordine.costo_consegna) : null,
      iva: pricing.euro(ordine.iva),
      // Gli ordini creati prima delle offerte per distributore non hanno l'IVA calcolata.
      totale: pricing.euro(ordine.totale_ivato > 0 ? ordine.totale_ivato : ordine.totale_finale),
    },
    iva_pct: d.ivaPct,
    // Pagamento fatto all'invio della richiesta (null per gli ordini del vecchio flusso).
    pagamento: d.pagamento
      ? {
          stato: d.pagamento.stato,
          stato_testo: d.pagamento.stato === 'rimborsato' ? 'Rimborsato' : 'Pagato',
          importo: pricing.euro(d.pagamento.importo),
          simulato: d.pagamento.metodo === 'simulato',
          pagato_il: d.pagamento.pagato_il ? format.dataOra(d.pagamento.pagato_il) : null,
        }
      : null,
    annullabile: d.annullabile,
    da_confermare_consegna: ordine.stato === 'evaso' && !ordine.consegnato_il,
  });
});

router.post('/ordini/:id/consegnato', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  await flusso.segnaConsegnato(ordine);
  res.json({ ok: true });
});

router.delete('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  try {
    await flusso.eliminaOrdine(ordine.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: 'Il distributore ha già preso in carico questo ordine: per annullarlo contattalo direttamente.',
    });
  }
  res.json({ ok: true });
});

// ---------- Stato ordini e storico ----------

// L'unica attività da mostrare in "Stato ordini" (stesse regole del sito), o null.
router.get('/stato-ordini', richiedeCliente, async (req, res) => {
  res.json({ attivo: await flusso.attivitaCorrente(req.utente.id) });
});

router.get('/storico', richiedeCliente, async (req, res) => {
  const cards = await flusso.richiesteClienteConStato(req.utente.id);
  res.json({
    voci: cards.map((c) => {
      const r = c.richiesta;
      const consegnato = !!(c.ordine && c.ordine.consegnato_il);
      const etichetta = consegnato
        ? 'Consegnato'
        : r.stato === 'in_attesa'
          ? 'In attesa'
          : r.stato === 'ordinata'
            ? c.ordine
              ? c.ordine.stato === 'inviato'
                ? 'Inviato'
                : c.ordine.stato === 'in_evasione'
                  ? 'In preparazione'
                  : 'Partito'
              : 'Ordinata'
            : r.stato === 'nessuna_offerta'
              ? 'Scaduta senza ordine'
              : r.stato === 'annullata'
                ? 'Annullata'
                : r.stato;
      return {
        richiesta_id: r.id,
        order_id: c.step === 3 && c.ordine ? c.ordine.id : null,
        data: format.dataOra(r.creato_il),
        materiale: c.righe.map((x) => x.quantita + '× ' + x.nome).join(', '),
        etichetta,
        // Colore del badge: verde a buon fine, arancio da fare, rosso chiusa senza ordine.
        tono: consegnato || r.stato === 'ordinata' ? 'ok' : r.stato === 'in_attesa' ? 'attesa' : 'ko',
      };
    }),
  });
});

router.use((req, res) => {
  res.status(404).json({ errore: 'Risorsa non trovata.' });
});

// Gli errori dell'API restano JSON: il gestore generale di server.js risponde con una
// pagina HTML, che l'app non saprebbe mostrare.
router.use((err, req, res, next) => {
  console.error('Errore API', req.method, req.originalUrl, ':', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ errore: 'Si è verificato un problema imprevisto. Riprova tra poco.' });
});

module.exports = router;
