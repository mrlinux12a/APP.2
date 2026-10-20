// API JSON dell'app nativa (cartella mobile/). Stessa logica delle pagine web — le
// funzioni di catalogo, prezzi, richieste e ordini sono quelle di src/ — ma
// autenticazione con token invece del cookie di sessione.
//
// Per ora l'app è solo per gli installatori (ruolo 'cliente'): il banco e l'agente
// continuano a usare il sito.
const crypto = require('crypto');
const express = require('express');

const db = require('../db');
const catalogo = require('./catalogo');
const pricing = require('./pricing');
const richieste = require('./richieste');
const flusso = require('./flusso_cliente');
const format = require('./format');
const notifiche = require('./notifiche');
const tokenApp = require('./token_app');
const anagrafiche = require('./anagrafiche');
const account = require('./account');
const push = require('./push');
const pagamentiModulo = require('./pagamenti');
const stripePagamenti = require('./stripe_pagamenti');
const materialeModulo = require('./materiale');
const ricevuteModulo = require('./ricevute');
const { azienda } = require('./azienda');
const { prodottoJson } = require('./prodotto_json');
const { accessoBloccato, registraAccessoFallito, accessoRiuscito, iscrizioneBloccata, registraIscrizione } = require('./limite_login');
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
  // Risposte di un utente collegato: né il telefono né un proxy ne tengono copia.
  res.set('Cache-Control', 'private, no-store');
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
function prodottoApp(p) {
  const base = prodottoJson(p);
  return {
    ...base,
    categoria: p.categoria || null,
    prezzo_valore: pricing.prezzoNetto(p),
    varianti: base.varianti
      ? base.varianti.map((v, i) => ({
          ...v,
          sconto_base_pct: p.varianti[i].sconto_base_pct,
          prezzo_valore: pricing.prezzoNetto(p.varianti[i]),
        }))
      : null,
  };
}

async function elencoJson(elenco) {
  return {
    risultati: elenco.righe.map((p) => prodottoApp(p)),
    pagina: elenco.pagina,
    pagine: elenco.pagine,
    totale: elenco.totale,
  };
}

function macroJson(m) {
  return { slug: m.slug, nome: m.nome, descrizione: m.descrizione, n_prodotti: Number(m.n_prodotti) || 0 };
}

const e2 = (n) => pricing.euro(n);

// ---------- Accesso ----------

router.post('/login', async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim().slice(0, 100);

  if (accessoBloccato(req, username)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE username = ? AND attivo = 1').get(username);
  if (!(await passwordValida(req.body && req.body.password, user))) {
    registraAccessoFallito(req, username);
    return res.status(401).json({ errore: 'Credenziali non valide.' });
  }
  accessoRiuscito(req, username);
  if (user.ruolo !== 'cliente') {
    return res.status(403).json({ errore: "Per ora l'app è riservata agli installatori: accedi dal sito." });
  }
  const token = await tokenApp.creaToken(user.id, req.body && req.body.dispositivo);
  res.json({ token, utente: utenteJson(user) });
});

// Registrazione dall'app: gli stessi controlli e la stessa iscrizione del sito (anagrafiche.validaIscrizione / iscriviCliente), poi si entra
// subito, senza un secondo passaggio dal login. Con gli errori per campo (`errori`) l'app evidenzia i campi sbagliati.
router.post('/registrazione', async (req, res) => {
  if (iscrizioneBloccata(req)) {
    return res.status(429).json({ errore: 'Da questo dispositivo sono state fatte troppe registrazioni. Riprova più tardi.' });
  }
  const dati = req.body || {};
  const errori = await anagrafiche.validaIscrizione(dati);
  if (errori.length) return res.status(400).json({ errore: errori[0].testo, errori });

  let cliente;
  try {
    cliente = await anagrafiche.iscriviCliente(dati, await anagrafiche.distributoriPredefiniti());
  } catch (e) {
    // 23505 = nome utente (unico) preso da qualcun altro fra il controllo e l'inserimento.
    if (e && e.code === '23505') {
      const errore = { testo: 'Questo nome utente è già in uso.', campi: ['username'] };
      return res.status(400).json({ errore: errore.testo, errori: [errore] });
    }
    throw e;
  }
  registraIscrizione(req);
  const token = await tokenApp.creaToken(cliente.id, dati.dispositivo);
  res.json({ token, utente: utenteJson(cliente) });
});

router.post('/logout', async (req, res) => {
  const token = tokenDellaRichiesta(req);
  // Il telefono che esce non deve più ricevere le notifiche di questo utente (se manda il suo token push).
  const utente = token ? await tokenApp.utenteDaToken(token) : null;
  const tokenPush = req.body && req.body.token_push;
  if (utente && tokenPush) await push.rimuovi(tokenPush, utente.id).catch(() => {});
  await tokenApp.revocaToken(token);
  res.json({ ok: true });
});

router.get('/me', richiedeCliente, async (req, res) => {
  res.json({ utente: utenteJson(req.utente) });
});

// ---------- Profilo, notifiche push, eliminazione dell'account ----------

// "La mia anagrafica": gli stessi dati della pagina /profilo del sito, in sola lettura.
router.get('/profilo', richiedeCliente, async (req, res) => {
  const u = req.utente;
  const legami = await anagrafiche.legamiDelCliente(u.id);
  const riferimento = anagrafiche.distributoreDiRiferimento(legami);
  res.json({
    utente: {
      ...utenteJson(u),
      tipo_soggetto: u.tipo_soggetto,
      tipo_testo: anagrafiche.TIPI_SOGGETTO[u.tipo_soggetto] || '',
      referente: u.referente || '',
      partita_iva: u.partita_iva || '',
      codice_fiscale: u.codice_fiscale || '',
      indirizzo: u.indirizzo || '',
      cap: u.cap || '',
      citta: u.citta || '',
      provincia: u.provincia || '',
      sdi_pec: u.sdi_pec || '',
      email: u.email || '',
      telefono: u.telefono || '',
      indirizzo_consegna: u.indirizzo_consegna || '',
    },
    distributore: riferimento ? format.nomeCommerciale(riferimento.distributore) : null,
    assistenza: azienda().email || null,
  });
});

// Il telefono comunica il suo token push (Expo) appena l'utente entra nell'app.
router.post('/dispositivi', richiedeCliente, async (req, res) => {
  const body = req.body || {};
  const ok = await push.registra(req.utente.id, body.token, body.piattaforma);
  if (!ok) return res.status(400).json({ errore: 'Token delle notifiche non valido.' });
  res.json({ ok: true });
});

router.delete('/dispositivi', richiedeCliente, async (req, res) => {
  await push.rimuovi((req.body && req.body.token) || '', req.utente.id);
  res.json({ ok: true });
});

// Elimina (anonimizza) l'account: serve la password, come conferma. Vedi src/account.js per cosa resta e cosa sparisce.
router.delete('/account', richiedeCliente, async (req, res) => {
  const username = String(req.utente.username || '');
  if (accessoBloccato(req, username)) {
    return res.status(429).json({ errore: 'Troppi tentativi non riusciti. Riprova tra qualche minuto.' });
  }
  if (!(await passwordValida(req.body && req.body.password, req.utente))) {
    registraAccessoFallito(req, username);
    return res.status(401).json({ errore: 'Password non corretta.' });
  }
  accessoRiuscito(req, username);
  try {
    await account.eliminaAccount(req.utente);
  } catch (e) {
    if (!(e instanceof account.AccountNonEliminabile)) throw e;
    return res.status(409).json({ errore: e.messaggioCliente });
  }
  tokenApp.dimenticaUtente(req.utente.id);
  res.json({ ok: true });
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
  });
  res.json({ risultati: risultati.map((p) => prodottoApp(p)), troncato: !!risultati.troncato });
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
  const [r, intestazione] = await Promise.all([flusso.riepilogoCarrello(righe), anagrafiche.intestazioneCliente(req.utente.id).catch(() => null)]);
  const presenti = new Set(righe.map((x) => x.prodotto.id));
  res.json({
    merce: pricing.euro(r.totali.totale_netto), // a prezzo del banco: il 10% di servizio sta solo nella voce Servizio (`riepilogo`)
    raee: r.totali.contributo_raee > 0 ? pricing.euro(r.totali.contributo_raee) : null,
    spedizione: pricing.euro(r.spedizione),
    imponibile: pricing.euro(r.totali.imponibile),
    iva: pricing.euro(r.totali.iva),
    iva_pct: r.ivaPct,
    // La spesa complessiva (consegna + materiale). Quello che si paga ORA in app è `da_pagare_ora`; il resto si paga dopo al banco.
    totale_ivato: pricing.euro(r.totali.totale_ivato),
    da_pagare_ora: pricing.euro(r.totali.da_pagare_app),
    da_pagare_al_banco: pricing.euro(r.totali.materiale_banco),
    // Le due parti con ogni voce già in testo (corriere, servizio, IVA / merce, RAEE, IVA), come le disegna il carrello del sito.
    riepilogo: r.vista,
    // Nome della ditta a cui si paga il materiale ("BOREA"), per "Lo paghi dopo a ...".
    ditta: intestazione && intestazione.distributore ? format.nomeCommerciale(intestazione.distributore) : null,
    // Con la carta vera (Stripe) o di prova (nessun addebito): l'app lo dice sul pulsante di pagamento.
    pagamento_reale: stripePagamenti.pagaConStripe(),
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

// Come finisce una richiesta di pagamento Stripe, nella forma dell'app: { esito: 'da_pagare', id, client_secret, chiave_pubblica, importo, modo } finché la
// carta non è autorizzata (l'app apre il foglio di pagamento), { esito: 'ok', request_id } quando la richiesta è nata, e gli altri esiti di
// stripe_pagamenti.preparaPagina ('in_corso', 'rifiutato' con titolo e messaggio, 'annullato', 'non_configurato').
async function esitoPagamentoJson(id, clienteId) {
  const riga = await db.prepare('SELECT importo_cent FROM stripe_pagamenti WHERE id = ? AND cliente_id = ?').get(id, clienteId);
  const pagina = await stripePagamenti.preparaPagina(id, clienteId);
  switch (pagina.esito) {
    case 'pagina':
      return {
        esito: 'da_pagare',
        id,
        client_secret: pagina.clientSecret,
        chiave_pubblica: pagina.chiavePubblica,
        importo: e2((riga ? riga.importo_cent : pagina.importoCent) / 100),
        modo: pagamentiModulo.modoStripe(),
      };
    case 'ok':
      return { esito: 'ok', id, request_id: pagina.requestId, tipo: pagina.tipo };
    case 'da_pagare':
      // Pagamento aperto da oltre un'ora e mai autorizzato: la pagina non si apre più (come sul sito) e il blocco scade da solo.
      return { esito: 'annullato' };
    case 'rifiutato':
      return { esito: 'rifiutato', titolo: pagina.titolo, messaggio: pagina.messaggio };
    default:
      return { esito: pagina.esito };
  }
}

function rispostaErroreFlusso(res, e) {
  return res.status(400).json({ errore: e.message, titolo: e.titolo, codice: e.codice, request_id: e.requestId || null });
}

// Paga e invia la richiesta, con destinazione e note scritte nel carrello. `chiave` (facoltativa) identifica l'invio dal carrello: lo
// stesso invio ripetuto (doppio tocco, ritentativo) risponde con la richiesta già partita, senza crearne un'altra.
//  · Senza Stripe (sviluppo, prove, pagamento simulato): la richiesta parte subito → { id }.
//  · Con Stripe: la richiesta NON nasce qui. Si crea il pagamento (carta solo autorizzata) e l'app apre il foglio di pagamento → { pagamento: { esito:
//    'da_pagare', id, client_secret, chiave_pubblica, importo } }; la richiesta nasce quando la carta è autorizzata (GET /pagamenti/:id, il webhook o il
//    timer del server). Così dall'app NON si ordina senza pagare, come dal sito.
router.post('/richieste', richiedeCliente, async (req, res) => {
  try {
    const body = req.body || {};
    const righe = await flusso.righeDaQuantita(body.righe);
    const dati = { destinazione: body.destinazione, note: body.note, chiaveInvio: body.chiave };
    if (stripePagamenti.pagaConStripe()) {
      const pagamentoId = await stripePagamenti.avviaPagamento(req.utente.id, righe, dati);
      const pagamento = await esitoPagamentoJson(pagamentoId, req.utente.id);
      if (pagamento.esito === 'non_configurato') {
        return res.status(503).json({ errore: 'Il pagamento non è disponibile in questo momento. Non è stato addebitato nulla.' });
      }
      return res.json(pagamento.esito === 'ok' ? { id: pagamento.request_id } : { pagamento });
    }
    const id = await flusso.nuovaRichiesta(req.utente.id, righe, dati);
    res.json({ id });
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    // Questo invio ha già dato una richiesta (secondo tocco, risposta persa): si porta a quella.
    if (e.codice === 'gia_inviata' && e.requestId) return res.json({ id: e.requestId });
    rispostaErroreFlusso(res, e);
  }
});

// Come sta andando un pagamento Stripe iniziato da POST /richieste o /richieste/:id/reinvia: l'app lo chiede dopo il foglio di pagamento
// finché non è 'ok' (o un altro esito definitivo). Solo il cliente del pagamento.
router.get('/pagamenti/:id', richiedeCliente, async (req, res) => {
  if (!stripePagamenti.attivo()) return res.status(404).json({ errore: 'Pagamento non trovato.' });
  res.json(await esitoPagamentoJson(Number(req.params.id), req.utente.id));
});

const ESITO_RISPOSTA = {
  in_attesa: 'In attesa',
  confermato: 'Disponibile',
  non_disponibile: 'Non disponibile',
};

function righeJson(righe) {
  return righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice }));
}

// Le due parti di quello che l'installatore paga, in testo (pricing.importi): la consegna pagata in app e il materiale pagato dopo al banco.
function importiJson(i) {
  return {
    consegna: {
      totale: e2(i.app.totale),
      corriere: e2(i.app.corriere),
      servizio: e2(i.app.servizio),
      servizio_pct: i.servizioPct,
      imponibile: e2(i.app.imponibile),
      iva: e2(i.app.iva),
      iva_pct: i.ivaPct,
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

// Il pagamento di una richiesta (forma storica, usata anche dallo storico): null se la richiesta è nata col vecchio flusso e non ha pagamento.
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

// Una richiesta com'è ora: attesa con conto alla rovescia, chiusa senza ordine (nessuno ha confermato: blocco sulla carta tolto), annullata o
// (con order_id) già diventata ordine. L'app la rilegge ogni pochi secondi.
router.get('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const d = await flusso.dettaglioRichiesta(richiesta);
  res.json({
    id: richiesta.id,
    stato: richiesta.stato,
    order_id: richiesta.stato === 'ordinata' ? richiesta.order_id : null,
    creato_il: format.dataOraRoma(richiesta.creato_il, ', '),
    secondi: d.secondi,
    minuti_risposta: Math.round(d.minutiRisposta),
    righe: righeJson(d.righe),
    // Le righe a prezzo del banco (come le mostra il sito) e gli importi divisi: consegna pagata in app / materiale pagato dopo al banco.
    righe_prezzi: d.righePrezzi.map((r) => ({ quantita: r.quantita, nome: r.nome_snapshot, codice: r.codice_snapshot, cad: e2(Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)), totale: e2(Number(r.subtotale) + Number(r.raee_riga || 0)) })),
    importi: importiJson(d.importi),
    ditta: d.ditta || null,
    // Cosa si pagherebbe rinviando una richiesta chiusa (prezzi di oggi): la consegna si addebita di nuovo, il materiale solo se un banco conferma.
    rinvio: { consegna: e2(d.rinvio.consegna), materiale: e2(d.rinvio.materiale) },
    risposte: d.risposte.map((r) => ({
      distributore: r.distributore_nome,
      filiale: '', // l'installatore vede solo la ditta
      esito: r.esito,
      esito_testo: ESITO_RISPOSTA[r.esito] || 'Nessuna risposta',
      banco_confermato: !!r.bancoConfermato,
    })),
    pagamento: pagamentoJson(richiesta),
    stato_pagamento: statoPagamentoJson(d.statoPag),
    // Si può annullare solo in fase 1: in attesa e nessun banco ha ancora accettato.
    annullabile: d.annullabile,
  });
});

// Solo in fase 1 (in attesa e nessun banco ha accettato): `ok: false` se non è più possibile, la richiesta resta com'è.
router.post('/richieste/:id/annulla', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  const ok = await flusso.annullaRichiesta(richiesta.id);
  res.json({ ok });
});

// "Rinvia richiesta" (solo se chiusa senza ordine). Con Stripe si autorizza di nuovo la consegna: stessa risposta di POST /richieste
// ({ pagamento: {...} } da pagare con il foglio di pagamento); senza Stripe la richiesta riparte subito → { id }.
router.post('/richieste/:id/reinvia', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  if (stripePagamenti.pagaConStripe() && richiesta.stato === 'nessuna_offerta') {
    try {
      const pagamentoId = await stripePagamenti.avviaPagamentoReinvio(req.utente.id, richiesta);
      const pagamento = await esitoPagamentoJson(pagamentoId, req.utente.id);
      if (pagamento.esito === 'non_configurato') {
        return res.status(503).json({ errore: 'Il pagamento non è disponibile in questo momento. Non è stato addebitato nulla.' });
      }
      return res.json(pagamento.esito === 'ok' ? { id: pagamento.request_id } : { pagamento });
    } catch (e) {
      if (!(e instanceof flusso.ErroreFlusso)) throw e;
      return rispostaErroreFlusso(res, e);
    }
  }
  try {
    res.json({ id: await flusso.reinviaRichiesta(richiesta) });
  } catch (e) {
    if (!(e instanceof flusso.ErroreFlusso)) throw e;
    rispostaErroreFlusso(res, e); // per esempio 'banco_chiuso' fuori orario
  }
});

router.delete('/richieste/:id', richiedeCliente, async (req, res) => {
  const richiesta = await richiestaDelCliente(req, res);
  if (!richiesta) return;
  try {
    await flusso.eliminaRichiesta(richiesta.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: e.messaggioCliente,
    });
  }
  res.json({ ok: true });
});

// ---------- Ordine ----------

// Non ci sono più la scelta dell'offerta né "Invia l'ordine": l'installatore paga con la richiesta
// (POST /richieste) e l'ordine nasce da solo quando il corriere prende la consegna.

// Stessi due stati dello Storico del sito: finché l'installatore non conferma di aver ricevuto il materiale l'ordine è "In preparazione".
function statoOrdineTesto(ordine) {
  return ordine.consegnato_il ? 'Consegnato' : 'In preparazione';
}

async function ordineDelCliente(req, res) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.cliente_id !== req.utente.id) {
    res.status(404).json({ errore: 'Ordine non trovato.' });
    return null;
  }
  return ordine;
}

// Quando arriva la merce: l'orario del corriere, e senza quello la stima del banco dalla nascita dell'ordine (la stessa regola della pagina
// dell'ordine e dell'icona del sito). etaSec = secondi all'arrivo (negativi se l'orario è passato), durataSec = dalla nascita all'arrivo.
function arrivoOrdine(ordine) {
  const creato = format.istanteUtc(ordine.creato_il);
  const ore = Number(ordine.consegna_ore);
  const arrivo = ordine.corriere_arrivo_il
    ? format.toDate(ordine.corriere_arrivo_il)
    : creato && ore > 0
      ? new Date(creato.getTime() + ore * 3600 * 1000)
      : null;
  if (!arrivo) return null;
  const etaSec = Math.round((arrivo.getTime() - Date.now()) / 1000);
  return {
    etaSec,
    durataSec: creato ? Math.max(1, Math.round((arrivo.getTime() - creato.getTime()) / 1000)) : null,
    inArrivo: format.inArrivo(etaSec),
    ora: format.oraRoma(arrivo),
    conCorriere: !!ordine.corriere_arrivo_il,
  };
}

router.get('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  // Il cliente sta guardando proprio questo ordine: niente pallino per i suoi cambi di stato.
  await Promise.all([notifiche.segnaLetteCategoria(req.utente.id, 'ordini'), notifiche.segnaLetteCategoria(req.utente.id, 'richieste')]);
  const d = await flusso.dettaglioOrdine(ordine);
  const arrivo = ordine.consegnato_il ? null : arrivoOrdine(ordine);
  const ditta = d.distributore ? format.nomeCommerciale(d.distributore.nome) : '';
  const importi = importiJson(d.importi);
  res.json({
    id: ordine.id,
    stato: ordine.stato,
    stato_testo: statoOrdineTesto(ordine),
    consegnato: !!ordine.consegnato_il,
    // "Arriva entro 6 ore" / "Arriva entro le 18:30" / "In arrivo" (a 3 minuti o meno): lo stesso testo del titolo della pagina dell'ordine.
    tempo_testo: ordine.consegnato_il
      ? 'Consegnato il ' + format.dataOraRoma(ordine.consegnato_il, ', ')
      : !arrivo
        ? 'Tempi di consegna da confermare'
        : arrivo.inArrivo
          ? 'In arrivo'
          : arrivo.conCorriere
            ? 'Arriva entro le ' + arrivo.ora
            : 'Arriva entro ' + format.tempoConsegna(ordine.consegna_ore),
    // Per il conto alla rovescia dell'app: secondi all'arrivo al momento della risposta e durata totale (null senza orario).
    eta_sec: arrivo ? arrivo.etaSec : null,
    durata_sec: arrivo ? arrivo.durataSec : null,
    in_arrivo: arrivo ? arrivo.inArrivo : false,
    corriere: String(ordine.corriere_nome || '').trim() || null,
    creato_il: format.dataOraRoma(ordine.creato_il, ', '),
    consegnato_il: ordine.consegnato_il ? format.dataOraRoma(ordine.consegnato_il, ', ') : null,
    // Solo la ditta: la filiale da cui parte l'ordine non si mostra all'installatore.
    distributore: d.distributore ? { nome: d.distributore.nome, filiale: '' } : null,
    ditta,
    modalita: ordine.modalita,
    destinazione: ordine.destinazione || null,
    note: ordine.note || null,
    // Le righe a PREZZO DEL BANCO (mai quello col 10% di servizio, che si paga in app e sta solo nella voce Servizio).
    righe: d.righe.map((r) => ({
      quantita: r.quantita,
      nome: r.nome_snapshot,
      codice: r.codice_snapshot,
      cad: e2(Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)),
      subtotale: e2(Number(r.subtotale) + Number(r.raee_riga || 0)),
    })),
    importi,
    // Forma storica dei totali, ora coerente con gli importi divisi: merce a prezzo del banco, consegna, IVA delle due parti, spesa complessiva.
    totali: {
      merce: importi.materiale.merce,
      raee: importi.materiale.raee,
      consegna: importi.consegna.corriere,
      iva: e2(pricing.round2(d.importi.app.iva + d.importi.banco.iva)),
      totale: importi.spesa,
    },
    iva_pct: d.ivaPct,
    pagamento: d.pagamento
      ? {
          stato: d.pagamento.stato,
          stato_testo: d.pagamento.stato === 'rimborsato' ? 'Rimborsato' : 'Pagato',
          importo: pricing.euro(d.pagamento.importo),
          simulato: d.pagamento.metodo === 'simulato',
          pagato_il: d.pagamento.pagato_il ? format.dataOra(d.pagamento.pagato_il) : null,
        }
      : null,
    stato_pagamento: statoPagamentoJson(d.statoPag),
    // Sempre false: il cliente non annulla un ordine (il banco ha già confermato). Non c'è più il pulsante.
    annullabile: d.annullabile,
    // "Ho ricevuto il materiale": come sul sito, il pulsante c'è finché l'ordine non è segnato consegnato.
    da_confermare_consegna: !ordine.consegnato_il,
  });
});

// "Ho ricevuto il materiale". Come sul sito: un ordine 'evaso' (stato degli ordini vecchi) ha la conferma vera; per tutti gli altri vale quella provvisoria
// (flusso.segnaConsegnatoProva), perché la consegna non è ancora segnata da un evento vero.
router.post('/ordini/:id/consegnato', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  if (ordine.stato === 'evaso') await flusso.segnaConsegnato(ordine);
  else await flusso.segnaConsegnatoProva(ordine);
  res.json({ ok: true });
});

// "Riordina gli stessi pezzi" (sugli ordini consegnati, come sul sito): gli articoli di un ordine che si possono rimettere nel carrello, nella forma delle
// righe del carrello dell'app, e quanti non sono più disponibili (tolti dal catalogo). Il carrello sta sul telefono: aggiunge lui.
router.get('/ordini/:id/riordina', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  const r = await flusso.articoliDaRiordinare(req.utente.id, ordine.id);
  if (!r || r === 'altrui') return res.status(404).json({ errore: 'Ordine non trovato.' });
  const ids = r.articoli.map((a) => a.id);
  const prodotti = ids.length ? await db.prepare('SELECT * FROM products WHERE attivo = 1 AND id = ANY(?::int[])').all(ids) : [];
  const perId = new Map(prodotti.map((p) => [Number(p.id), p]));
  const articoli = [];
  let saltati = r.saltati;
  for (const a of r.articoli) {
    const p = perId.get(a.id);
    if (!p) {
      saltati++;
      continue;
    }
    articoli.push({
      id: p.id,
      nome: p.nome,
      etichetta: null,
      codice: p.codice,
      prezzo: pricing.euro(pricing.prezzoNetto(p)),
      prezzo_valore: pricing.prezzoNetto(p),
      foto_url: p.foto_url || null,
      quantita: a.quantita,
    });
  }
  res.json({ articoli, saltati });
});

router.delete('/ordini/:id', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  try {
    await flusso.eliminaOrdine(ordine.id);
  } catch (e) {
    if (!(e instanceof flusso.OrdineInLavorazione)) throw e;
    return res.status(409).json({
      errore: e.messaggioCliente,
    });
  }
  res.json({ ok: true });
});

// ---------- Ricevute di pagamento (PDF) ----------

// Il telefono non può mandare l'intestazione Authorization quando apre un PDF nel browser o nel lettore di sistema: per questo la ricevuta si
// scarica da un indirizzo firmato (HMAC) valido pochi minuti, fatto per UN ordine e UN cliente. Chi non ha il link non scarica niente; chi lo
// perde dopo cinque minuti non scarica più.
const VALIDITA_LINK_RICEVUTA_SEC = 5 * 60;
const segretoLink = () =>
  crypto.createHash('sha256').update('ricevuta-app|' + (process.env.SESSION_SECRET || process.env.DATABASE_URL || 'sviluppo-locale')).digest();
const firmaLink = (ordineId, clienteId, scadenza) =>
  crypto.createHmac('sha256', segretoLink()).update(`${ordineId}|${clienteId}|${scadenza}`).digest('hex');

function baseUrl(req) {
  const fisso = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return fisso || req.protocol + '://' + req.get('host');
}

router.post('/ordini/:id/ricevuta', richiedeCliente, async (req, res) => {
  const ordine = await ordineDelCliente(req, res);
  if (!ordine) return;
  const dati = await ricevuteModulo.datiRicevuta(ordine.id, { tipo: 'pagamento', clienteId: req.utente.id });
  if (!dati) return res.status(404).json({ errore: 'Per questo ordine non c’è una ricevuta di pagamento.' });
  const scadenza = Math.floor(Date.now() / 1000) + VALIDITA_LINK_RICEVUTA_SEC;
  const firma = firmaLink(ordine.id, req.utente.id, scadenza);
  res.json({ url: `${baseUrl(req)}/api/v1/ricevute/${ordine.id}.pdf?c=${req.utente.id}&e=${scadenza}&s=${firma}` });
});

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

// ---------- Stato ordini e storico ----------

// Una voce di "Stato ordini" per l'app (flusso.vociStriscia, le stesse dell'icona e della striscia del sito): richiesta in attesa col suo conto alla
// rovescia, ordine in consegna con l'arrivo previsto, o richiesta scaduta da poco da rinviare.
function voceJson(v) {
  return {
    tipo: v.tipo,
    id: v.id,
    fase: v.fase,
    richiesta_id: v.richiestaId,
    breve: v.breve || '',
    secondi: v.secondi === undefined ? null : v.secondi,
    durata: v.durata === undefined ? null : v.durata,
    eta_sec: v.etaSec === undefined ? null : v.etaSec,
    durata_sec: v.durataSec === undefined ? null : v.durataSec,
    in_arrivo: !!v.inArrivo,
    minuti: v.minuti === undefined ? null : v.minuti,
    corriere: v.corriere || '',
  };
}

// Tutte le attività in corso (`voci`, nell'ordine del sito) e, per comodità, `attivo`: la prima inviata (la richiesta con l'id più basso), o la
// scaduta da poco se non c'è altro. Apre "Stato ordini": segna lette le notifiche di richieste e ordini.
router.get('/stato-ordini', richiedeCliente, async (req, res) => {
  const voci = await flusso.vociStriscia(req.utente.id, { segnaLette: true, breve: true });
  const inCorso = voci.filter((v) => v.fase !== 'scaduta');
  const prima = inCorso.length ? inCorso.reduce((a, b) => (b.richiestaId < a.richiestaId ? b : a)) : voci.find((v) => v.fase === 'scaduta');
  res.json({ attivo: prima ? { tipo: prima.tipo, id: prima.id } : null, voci: voci.map(voceJson) });
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
            ? 'In preparazione'
            : r.stato === 'nessuna_offerta'
              ? 'Nessuna risposta'
              : r.stato === 'annullata'
                ? 'Annullata'
                : r.stato;
      return {
        richiesta_id: r.id,
        order_id: c.step === 3 && c.ordine ? c.ordine.id : null,
        data: format.dataOraRoma(r.creato_il, ', '),
        materiale: c.righe.map((x) => x.quantita + '× ' + x.nome).join(', '),
        etichetta,
        // Colore del badge: verde a buon fine, arancio da fare, rosso chiusa senza ordine.
        tono: consegnato || r.stato === 'ordinata' ? 'ok' : r.stato === 'in_attesa' ? 'attesa' : 'ko',
      };
    }),
  });
});

// Lo Storico come sul sito (src/materiale.js, lo stesso calcolo): il materiale ordinato mese per mese, con i prezzi IVA inclusa e quanto si deve
// al banco, più la consegna pagata in app. ?mese=AAAA-MM|tutto  ?vista=ordine|articolo.
router.get('/materiale', richiedeCliente, async (req, res) => {
  const m = await materialeModulo.materialeOrdini({ clienteId: req.utente.id, mese: req.query.mese, vista: req.query.vista });
  const righeJsonOrdine = (o) => o.righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice, cad: e2(r.cad), totale: e2(r.totale) }));
  res.json({
    mese: m.mese,
    vista: m.vista,
    mesi: m.mesi,
    ditte: m.ditte,
    riepilogo: { totale: e2(m.riepilogo.totale), servizio: e2(m.riepilogo.servizio), n_ordini: m.riepilogo.nOrdini },
    elenco: m.elenco.map((x) =>
      x.tipo === 'ordine'
        ? {
            tipo: 'ordine',
            id: x.ordine.id,
            data: x.ordine.data,
            stato: x.ordine.stato.etichetta,
            consegnato: x.ordine.consegnato,
            totale: e2(x.ordine.totale),
            servizio: e2(x.ordine.servizio),
            primo: x.ordine.primo,
            altri: x.ordine.altri,
            ditta: x.ordine.ditta,
            ricevuta: !!x.ordine.ricevuta,
            righe: righeJsonOrdine(x.ordine),
          }
        : {
            tipo: 'richiesta',
            id: x.richiesta.id,
            data: x.richiesta.data,
            etichetta: x.richiesta.etichetta,
            tono: x.richiesta.tono,
            primo: x.richiesta.primo,
            altri: x.richiesta.altri,
            apribile: !!x.richiesta.href,
            righe: x.richiesta.righe.map((r) => ({ quantita: r.quantita, nome: r.nome })),
          }
    ),
    articoli: m.gruppi
      .flatMap((g) => g.articoli)
      .map((a) => ({ codice: a.codice, nome: a.nome, cad: a.cad === null ? null : e2(a.cad), quantita: a.quantita, totale: e2(a.totale), n_ordini: a.ordini.length })),
    vuoto: m.vuoto,
  });
});

router.use((req, res) => {
  res.status(404).json({ errore: 'Risorsa non trovata.' });
});

// Gli errori dell'API restano JSON: il gestore generale di server.js risponde con una
// pagina HTML, che l'app non saprebbe mostrare.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Un valore che Postgres non accetta (testo con NUL, numero fuori misura...) viene dall'input, non da un guasto: 400 e non 500.
  if (err && ['22021', '22P05', '22003', '22P02', '22007', '22008'].includes(err.code)) {
    console.warn('Valore non valido (' + err.code + ') in', req.method, req.originalUrl, ':', err.message);
    return res.status(400).json({ errore: 'Alcuni dati inviati non sono validi.' });
  }
  console.error('Errore API', req.method, req.originalUrl, ':', err);
  res.status(500).json({ errore: 'Si è verificato un problema imprevisto. Riprova tra poco.' });
});

module.exports = router;
