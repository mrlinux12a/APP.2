// Pagamenti con Stripe (solo sito; l'app resta sul pagamento simulato di src/pagamenti.js).
//
// Come funziona, in breve:
//  1. "Paga e invia richiesta" non crea più la richiesta: crea una riga in `stripe_pagamenti` e un PaymentIntent
//     Stripe con `capture_method: manual`, e porta il cliente alla pagina /pagamento/<id> DEL SITO, dove il form di
//     Stripe (Payment Element, public/pagamento.js) raccoglie la carta senza che passi dal nostro server.
//  2. Il cliente autorizza la carta: Stripe NON incassa, blocca l'importo. Il cliente torna su /pagamento/esito e,
//     in parallelo, può arrivare il webhook `payment_intent.amount_capturable_updated`; in più il timer (`elabora`)
//     recupera i pagamenti autorizzati che nessuno ha raccolto. Chi arriva prima (`completaRiga`) fa nascere la
//     richiesta, gli altri trovano già tutto fatto: una UPDATE atomica sullo stato lo garantisce.
//  3. Quando nasce l'ordine la carta si INCASSA (per il totale dell'ordine, mai più di quanto autorizzato); se la
//     richiesta si chiude senza ordine il blocco si RILASCIA e non è passato un euro. Se l'ordine viene annullato dopo
//     l'incasso, si RIMBORSA. Il flusso (src/pagamenti.js) segna sul DB cosa fare; `elabora` lo esegue con Stripe,
//     subito dopo (richiediElaborazione) e dal timer di server.js, così nessuna chiamata di rete sta dentro una
//     transazione e un guasto di Stripe si riprova da solo.
//
// Stripe sa tutto dei soldi; qui il DB dice a che punto è ogni pagamento (vedi `stato` in schema.sql). Le chiavi
// stanno nel .env: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, APP_URL (vedi README).
const db = require('../db');
const pagamenti = require('./pagamenti');
const flusso = require('./flusso_cliente');
const richieste = require('./richieste');

const { ErroreFlusso } = flusso;

const attivo = pagamenti.stripeAttivo;

// La pagina di pagamento si apre per un'ora dalla creazione; una carta autorizzata oltre i 90 minuti non fa più nascere
// una richiesta (il blocco si rilascia). Il timer controlla i pagamenti ancora aperti da almeno un minuto.
const MINUTI_PAGINA = 60;
const MINUTI_MASSIMI_PER_COMPLETARE = 90;
const SECONDI_PRIMA_DEL_RECUPERO = 60;
const TENTATIVI_MASSIMI = 30;
const LIMITE_LAVORI = 25;

// ---------- Configurazione e client Stripe ----------

// La chiave pubblicabile (pk_...): STRIPE_PUBLISHABLE_KEY, il nome di Stripe, o STRIPE_PUBLIC_KEY.
const chiavePubblicaGrezza = () => String(process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLIC_KEY || '').trim();
// Il Dashboard dà la chiave intera ("pk_test_51..."), ma copiandola si perde facilmente il prefisso: resta "51...", lunga
// quanto basta e tutta alfanumerica. In quel caso il prefisso è quello della chiave segreta (stesso ambiente: prova o
// reale), e all'avvio si avvisa di sistemare il .env (vedi controllaConfigurazione).
const chiaveSenzaPrefisso = () => /^[A-Za-z0-9]{50,}$/.test(chiavePubblicaGrezza());
// Quella buona per la pagina: vuota se manca o non ha la forma di una chiave: Stripe.js la rifiuterebbe e il cliente
// vedrebbe un form rotto, meglio l'errore chiaro del server.
const chiavePubblica = () => {
  const k = chiavePubblicaGrezza();
  if (/^pk_(test|live)_\S+$/.test(k)) return k;
  if (chiaveSenzaPrefisso()) return `pk_${pagamenti.modoStripe()}_${k}`;
  return '';
};

// Cosa non va nel .env (testi per il log all'avvio). Vuota se Stripe è spento o tutto è a posto.
function controllaConfigurazione() {
  const avvisi = [];
  if (pagamenti.simulatoRichiesto()) {
    avvisi.push(
      pagamenti.pagamentoSimulatoForzato() && pagamenti.simulatoForzatoInProduzione()
        ? 'ATTENZIONE: PAGAMENTO_SIMULATO=1 + PAGAMENTO_SIMULATO_FORZA=1: "Paga e invia" salta Stripe ANCHE QUI (chiave reale / produzione) e i clienti ordinano senza pagare. Per spegnerlo togli una delle due righe e riavvia.'
        : pagamenti.pagamentoSimulatoForzato()
        ? 'PAGAMENTO_SIMULATO=1: "Paga e invia" salta Stripe e usa il pagamento simulato. Va bene solo sul PC: sulla VPS quella riga non deve esserci.'
        : 'PAGAMENTO_SIMULATO=1 è ignorata (chiave reale o NODE_ENV=production): si paga con Stripe.'
    );
  }
  if (!attivo()) return avvisi;
  const pk = chiavePubblica();
  if (!chiavePubblicaGrezza()) {
    avvisi.push('STRIPE_PUBLISHABLE_KEY (o STRIPE_PUBLIC_KEY) manca: la pagina di pagamento non si può aprire e i clienti non possono pagare.');
  } else if (!pk) {
    avvisi.push('La chiave pubblicabile nel .env non è valida: deve iniziare con pk_test_ (prova) o pk_live_ (reale). Va copiata intera dal Dashboard, prefisso compreso. Finché è così i clienti non possono pagare.');
  } else if (chiaveSenzaPrefisso()) {
    avvisi.push(`La chiave pubblicabile nel .env è senza prefisso: l'ho completata io con pk_${pagamenti.modoStripe()}_ (stesso ambiente della chiave segreta). Meglio correggere il .env scrivendola intera.`);
  } else if (pk.startsWith('pk_live_') !== (pagamenti.modoStripe() === 'live')) {
    avvisi.push('STRIPE_SECRET_KEY e STRIPE_PUBLISHABLE_KEY sono di modi diversi (prova e reale): il form di pagamento non funzionerà.');
  }
  if (!String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()) {
    avvisi.push('STRIPE_WEBHOOK_SECRET manca: senza webhook i pagamenti si raccolgono dal ritorno del cliente o dal timer (entro un minuto circa).');
  }
  return avvisi;
}

let clienteStripe = null;
function stripe() {
  if (clienteStripe) return clienteStripe;
  const Stripe = require('stripe');
  clienteStripe = new Stripe(String(process.env.STRIPE_SECRET_KEY).trim(), {
    maxNetworkRetries: 2,
    timeout: 20000,
    appInfo: { name: 'Minuteria' },
  });
  return clienteStripe;
}
// Per le prove: un Stripe finto al posto di quello vero.
function impostaStripe(cliente) {
  clienteStripe = cliente;
}

const centesimi = (euro) => Math.round(Number(euro) * 100);
const SQL_RIGA = `SELECT *, EXTRACT(EPOCH FROM (NOW() - creato_il))::int AS eta_sec FROM stripe_pagamenti`;

// ---------- Avvio del pagamento ----------

// Crea la riga e il PaymentIntent; ritorna l'id della riga (la pagina di pagamento è /pagamento/<id>). Se Stripe non
// risponde la riga resta 'fallito' e il cliente vede un errore, non una pagina rotta.
async function creaIntento({ cliente, tipo, importoCent, voci, destinazione, note, requestId, chiaveInvio = null }) {
  const modo = pagamenti.modoStripe();
  const ins = await db
    .prepare(
      `INSERT INTO stripe_pagamenti (cliente_id, tipo, modo, importo_cent, righe, destinazione, note, request_id, chiave_invio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cliente.id, tipo, modo, importoCent, JSON.stringify(voci), destinazione || null, note || '', requestId || null, chiaveInvio);
  const id = Number(ins.lastInsertRowid);

  try {
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(cliente.email || '')) ? cliente.email : undefined;
    const intento = await stripe().paymentIntents.create(
      {
        amount: importoCent,
        currency: 'eur',
        // Blocca l'importo senza incassarlo: si incassa quando nasce l'ordine (vedi `elabora`). Con la scelta dinamica
        // dei metodi (Dashboard) il form propone solo quelli che supportano questa modalità: carta, Apple Pay, Google
        // Pay, Link... e non quelli che incassano subito (bonifici, iDEAL...).
        capture_method: 'manual',
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        description: `Minuteria · ${cliente.ragione_sociale}`,
        metadata: { pagamento_id: String(id), cliente_id: String(cliente.id) },
      },
      { idempotencyKey: `pi-${modo}-${id}` }
    );
    await db.prepare(`UPDATE stripe_pagamenti SET payment_intent_id = ?, aggiornato_il = NOW() WHERE id = ?`).run(intento.id, id);
    return id;
  } catch (e) {
    console.error('[stripe] pagamento non creato:', e.message);
    await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'fallito', errore = ?, aggiornato_il = NOW() WHERE id = ?`)
      .run(String(e.message).slice(0, 300), id);
    throw new ErroreFlusso(
      'pagamento',
      'Pagamento non disponibile',
      'Non riesco a collegarmi al servizio di pagamento. Non è stato addebitato nulla: riprova fra qualche istante.'
    );
  }
}

// Dal carrello: controlla (minimo, carrello non vuoto) e prepara il pagamento. Ritorna l'id della pagina.
// `chiaveInvio` identifica l'invio dal carrello (vedi flusso.chiaveInvioValida): un secondo clic sullo stesso invio non apre
// un altro pagamento. Se l'invio ha già dato una richiesta lancia ErroreFlusso('gia_inviata', requestId); se il pagamento è
// ancora da fare si riporta alla stessa pagina (stesso PaymentIntent).
async function avviaPagamento(clienteId, righe, { destinazione = '', note = '', chiaveInvio = null } = {}) {
  const chiave = flusso.chiaveInvioValida(chiaveInvio);
  if (chiave) {
    const gia = await richieste.richiestaConChiave(clienteId, chiave);
    if (gia) throw new ErroreFlusso('gia_inviata', 'Ordine già inviato', 'Questo ordine è già stato inviato: non ne parte un altro.', { requestId: gia.id });
    const aperto = await db
      .prepare(`SELECT * FROM stripe_pagamenti WHERE cliente_id = ? AND chiave_invio = ? AND stato = 'da_pagare' ORDER BY id LIMIT 1`)
      .get(clienteId, chiave);
    if (aperto && aperto.payment_intent_id) return aperto.id;
  }
  const { cliente, totali } = await flusso.validaRichiesta(clienteId, righe);
  return creaIntento({
    chiaveInvio: chiave,
    cliente,
    tipo: 'richiesta',
    importoCent: centesimi(totali.da_pagare_app), // solo servizio + consegna: il materiale si paga dopo al banco
    voci: righe.map((r) => ({ id: r.prodotto.id, quantita: r.quantita })),
    destinazione: String(destinazione || '').trim().slice(0, 300),
    note: String(note || '').trim().slice(0, 500),
  });
}

// "Rinvia richiesta": la richiesta è chiusa senza ordine e il blocco sulla carta è stato rilasciato, quindi si paga
// di nuovo la consegna (servizio + corriere + IVA), ricalcolata con i prezzi di oggi: è la cifra che la pagina "Nessuna risposta" mostra
// in "Se rinvii la richiesta paghi di nuovo solo la consegna". A pagamento autorizzato la STESSA richiesta si riapre (stesso id).
async function avviaPagamentoReinvio(clienteId, richiesta) {
  if (richiesta.cliente_id !== clienteId || richiesta.stato !== 'nessuna_offerta') {
    throw new ErroreFlusso('reinvio', 'Richiesta non rinviabile', 'Questa richiesta non si può più rinviare.');
  }
  const importoCent = centesimi((await flusso.totaliRichiestaOggi(richiesta.id)).da_pagare_app);
  if (!(importoCent > 0)) {
    throw new ErroreFlusso('reinvio', 'Richiesta non rinviabile', 'Per questa richiesta non posso ripetere il pagamento: invia una nuova richiesta dal carrello.');
  }
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  return creaIntento({ cliente, tipo: 'reinvio', importoCent, voci: [], requestId: richiesta.id });
}

// ---------- La pagina di pagamento ----------

// Cosa dire a chi chiede "com'è andata?" guardando la riga: { esito: 'ok' | 'in_corso' | 'rifiutato' | 'annullato' }.
function esitoDaRiga(riga) {
  // `motivo` c'è solo se il pagamento è stato respinto (richiesta non creata): allora non c'è nessuna richiesta nuova.
  if (riga.motivo) return { esito: 'rifiutato', titolo: 'Pagamento non completato', messaggio: riga.motivo };
  if (riga.request_id && ['autorizzato', 'da_incassare', 'incassato', 'da_rilasciare', 'rilasciato', 'da_rimborsare', 'rimborsato'].includes(riga.stato)) {
    return { esito: 'ok', requestId: riga.request_id, tipo: riga.tipo };
  }
  if (riga.stato === 'in_creazione') return { esito: 'in_corso' };
  return { esito: 'annullato' };
}

// Per la pagina /pagamento/<id>: o i dati per disegnare il form ({ esito: 'pagina', ... }) o un altro esito (carta già
// autorizzata e richiesta già nata, pagamento scaduto...). La riga deve essere del cliente.
async function preparaPagina(id, clienteId) {
  const riga = await db.prepare(`${SQL_RIGA} WHERE id = ? AND cliente_id = ?`).get(id, clienteId);
  if (!riga) return { esito: 'annullato' };
  if (riga.stato !== 'da_pagare') return esitoDaRiga(riga);
  if (!chiavePubblica()) return { esito: 'non_configurato' };
  if (!riga.payment_intent_id) return { esito: 'annullato' };

  // Aperta da troppo tempo: si chiude (o, se nel frattempo la carta è stata autorizzata, si completa).
  if (Number(riga.eta_sec) > MINUTI_PAGINA * 60) return verificaPendente(riga);

  const intento = await stripe().paymentIntents.retrieve(riga.payment_intent_id);
  if (intento.status === 'requires_capture') return completaRiga(riga, intento);
  if (intento.status === 'processing') return { esito: 'in_corso' };
  if (intento.status === 'canceled' || intento.status === 'succeeded') return { esito: 'annullato' };

  const voci = JSON.parse(riga.righe || '[]');
  return {
    esito: 'pagina',
    chiavePubblica: chiavePubblica(),
    clientSecret: intento.client_secret,
    importoCent: riga.importo_cent,
    tipo: riga.tipo,
    requestId: riga.request_id,
    pezzi: voci.reduce((n, v) => n + (Number(v.quantita) || 0), 0),
  };
}

// ---------- Completamento (ritorno del cliente, webhook, timer) ----------

// Rilascia il blocco sulla carta di una riga (da fare con Stripe: lo esegue `elabora`) e ricorda perché: `motivo` è
// il testo che vede il cliente.
async function rilascia(id, motivo) {
  await db
    .prepare(`UPDATE stripe_pagamenti SET stato = 'da_rilasciare', motivo = ?, aggiornato_il = NOW() WHERE id = ?`)
    .run(String(motivo).slice(0, 300), id);
  pagamenti.richiediElaborazione();
}

// Fa nascere la richiesta (o riapre quella chiusa) per un pagamento autorizzato. Una sola volta: la UPDATE che porta
// la riga da 'da_pagare' a 'in_creazione' la vince un solo chiamante, gli altri leggono com'è finita. `intentoNoto`: il
// PaymentIntent già letto da Stripe, se chi chiama l'ha.
async function completaRiga(riga, intentoNoto = null) {
  if (riga.stato !== 'da_pagare') return esitoDaRiga(riga);
  if (!riga.payment_intent_id) return { esito: 'annullato' };

  const intento = intentoNoto || (await stripe().paymentIntents.retrieve(riga.payment_intent_id));
  if (intento.status === 'canceled') {
    await db.prepare(`UPDATE stripe_pagamenti SET stato = 'scaduto', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_pagare'`).run(riga.id);
    return { esito: 'annullato' };
  }
  if (intento.status === 'processing') return { esito: 'in_corso' };
  // Carta non (ancora) autorizzata: pagamento rifiutato, 3-D Secure da completare, pagina chiusa a metà. Si può riprovare.
  if (intento.status !== 'requires_capture') return { esito: 'da_pagare', id: riga.id };

  // L'importo e il riferimento devono essere quelli che abbiamo chiesto noi.
  const riferimento = intento.metadata && intento.metadata.pagamento_id;
  if (String(riferimento) !== String(riga.id) || intento.amount !== riga.importo_cent) {
    console.error(`[stripe] pagamento ${riga.id}: l'intento non corrisponde (importo ${intento.amount}, atteso ${riga.importo_cent})`);
    const motivo = 'Il pagamento non corrisponde alla richiesta. Non è stato addebitato nulla.';
    const mancato = await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'da_rilasciare', motivo = ?, aggiornato_il = NOW() WHERE id = ? AND stato = 'da_pagare'`)
      .run(motivo, riga.id);
    if (mancato.changes) pagamenti.richiediElaborazione();
    return { esito: 'rifiutato', titolo: 'Pagamento non completato', messaggio: motivo };
  }

  const claim = await db
    .prepare(`UPDATE stripe_pagamenti SET stato = 'in_creazione', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_pagare'`)
    .run(riga.id);
  if (!claim.changes) {
    // Un altro (il webhook, il timer o il ritorno del cliente) l'ha presa un attimo prima: si guarda com'è andata.
    return esitoDaRiga(await db.prepare('SELECT * FROM stripe_pagamenti WHERE id = ?').get(riga.id));
  }

  // Oltre il tempo massimo non si crea più una richiesta "ferma" da ore: si rilascia la carta.
  if (Number(riga.eta_sec) > MINUTI_MASSIMI_PER_COMPLETARE * 60) {
    const motivo = 'Il pagamento è arrivato oltre il tempo consentito. Non è stato addebitato nulla.';
    await rilascia(riga.id, motivo);
    return { esito: 'rifiutato', titolo: 'Pagamento non completato', messaggio: motivo };
  }

  let requestId;
  try {
    if (riga.tipo === 'reinvio') {
      requestId = await riapriRichiesta(riga);
    } else {
      requestId = await flusso.nuovaRichiesta(
        riga.cliente_id,
        await flusso.righeDaQuantita(JSON.parse(riga.righe || '[]')),
        {
          destinazione: riga.destinazione,
          note: riga.note,
          metodoPagamento: pagamenti.METODO_STRIPE,
          importoPagato: riga.importo_cent / 100,
          // Lo stesso invio non può dare due richieste: se un altro pagamento dello stesso carrello è arrivato prima, questo
          // (una seconda carta autorizzata) si respinge e la carta si rilascia.
          chiaveInvio: riga.chiave_invio,
          inCasoDiDuplicato: 'rifiuta',
        }
      );
    }
  } catch (e) {
    // Una regola del flusso (minimo non più raggiunto, carrello svuotato dal catalogo...) o un guasto: la carta non
    // va incassata, si rilascia e il cliente lo vede.
    const previsto = e instanceof ErroreFlusso;
    if (!previsto) console.error(`[stripe] pagamento ${riga.id}: richiesta non creata:`, e.message);
    const messaggio =
      (previsto ? e.message : 'Non siamo riusciti a inviare la richiesta.') + ' Non è stato addebitato nulla.';
    await rilascia(riga.id, messaggio);
    return { esito: 'rifiutato', titolo: previsto ? e.titolo : 'Richiesta non inviata', messaggio };
  }

  await db
    .prepare(`UPDATE stripe_pagamenti SET stato = 'autorizzato', request_id = ?, aggiornato_il = NOW() WHERE id = ?`)
    .run(requestId, riga.id);
  // La richiesta può essere nata già chiusa (nessun banco disponibile: pagamento già "rimborsato") o chiudersi
  // nell'attimo fra la creazione e questa UPDATE: in entrambi i casi il blocco sulla carta va tolto.
  const creata = await db.prepare('SELECT pagamento_stato FROM requests WHERE id = ?').get(requestId);
  if (creata && creata.pagamento_stato === 'rimborsato') {
    await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'da_rilasciare', aggiornato_il = NOW() WHERE id = ? AND stato = 'autorizzato'`)
      .run(riga.id);
    pagamenti.richiediElaborazione();
  }
  return { esito: 'ok', requestId, tipo: riga.tipo };
}

// Riapre la richiesta chiusa senza ordine (stesso id) ora che il pagamento è di nuovo autorizzato.
async function riapriRichiesta(riga) {
  const richiesta = await richieste.getRichiesta(riga.request_id);
  if (!richiesta || richiesta.cliente_id !== riga.cliente_id || richiesta.stato !== 'nessuna_offerta') {
    throw new ErroreFlusso('reinvio', 'Richiesta non rinviabile', 'Questa richiesta non si può più rinviare.');
  }
  // Il pagamento di questa riga è già autorizzato: quello è l'importo che la richiesta torna a segnare come pagato.
  const riaperta = await richieste.reinviaRichiesta(richiesta.id, { metodoPagamento: pagamenti.METODO_STRIPE, importo: riga.importo_cent / 100 });
  if (!riaperta) throw new ErroreFlusso('reinvio', 'Richiesta non rinviabile', 'Questa richiesta non si può più rinviare.');
  return richiesta.id;
}

// Un pagamento ancora "da_pagare": se la carta nel frattempo è stata autorizzata (webhook perso, scheda chiusa dopo
// aver pagato) lo si completa; se è abbandonato da troppo si annulla il PaymentIntent e la riga scade.
async function verificaPendente(riga) {
  const scaduto = () => db.prepare(`UPDATE stripe_pagamenti SET stato = 'scaduto', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_pagare'`).run(riga.id);
  if (!riga.payment_intent_id) {
    if (Number(riga.eta_sec) > 600) await scaduto();
    return { esito: 'annullato' };
  }
  const intento = await stripe().paymentIntents.retrieve(riga.payment_intent_id);
  if (intento.status === 'requires_capture' || intento.status === 'processing') return completaRiga(riga, intento);
  if (intento.status === 'canceled') {
    await scaduto();
    return { esito: 'annullato' };
  }
  if (Number(riga.eta_sec) > (MINUTI_PAGINA + 10) * 60) {
    await stripe().paymentIntents.cancel(riga.payment_intent_id, { cancellation_reason: 'abandoned' }, { idempotencyKey: `ab-${riga.id}` });
    await scaduto();
    return { esito: 'annullato' };
  }
  return { esito: 'da_pagare', id: riga.id };
}

// Il cliente torna dal pagamento (Stripe aggiunge `payment_intent` al ritorno; il nostro script lo aggiunge se non
// c'è stato nessun reindirizzamento). La riga deve essere sua.
async function esitoRitorno(intentoId, clienteId) {
  if (!/^pi_[A-Za-z0-9_]+$/.test(String(intentoId || ''))) return { esito: 'annullato' };
  const riga = await db.prepare(`${SQL_RIGA} WHERE payment_intent_id = ? AND cliente_id = ?`).get(intentoId, clienteId);
  if (!riga) return { esito: 'annullato' };
  return completaRiga(riga);
}

// Webhook: la carta di questo PaymentIntent è stata autorizzata.
async function completaDaIntento(intentoId) {
  const riga = await db.prepare(`${SQL_RIGA} WHERE payment_intent_id = ?`).get(intentoId);
  // Di un altro ambiente (stesso account Stripe, altro DB) o sconosciuto: non è roba nostra.
  if (!riga || riga.modo !== pagamenti.modoStripe()) return { esito: 'sconosciuto' };
  return completaRiga(riga);
}

// ---------- Webhook ----------

// Verifica la firma di Stripe sul corpo GREZZO (qualunque modifica la invalida). Lancia se non è valida.
function leggiEvento(corpoGrezzo, firma) {
  return stripe().webhooks.constructEvent(corpoGrezzo, firma, String(process.env.STRIPE_WEBHOOK_SECRET || '').trim());
}

async function gestisciEvento(evento) {
  // Un evento dell'altro modo (prova/produzione) non ci riguarda.
  if (Boolean(evento.livemode) !== (pagamenti.modoStripe() === 'live')) return;
  const oggetto = evento.data && evento.data.object;
  if (!oggetto) return;
  if (evento.type === 'payment_intent.amount_capturable_updated') {
    await completaDaIntento(oggetto.id);
  } else if (evento.type === 'payment_intent.canceled') {
    await db.prepare(`UPDATE stripe_pagamenti SET stato = 'scaduto', aggiornato_il = NOW() WHERE payment_intent_id = ? AND stato = 'da_pagare'`).run(oggetto.id);
  }
}

// ---------- Incassi, rilasci e rimborsi ----------

async function eseguiLavoro(lavoro) {
  const s = stripe();
  const intento = lavoro.payment_intent_id;
  if (!intento) {
    await db.prepare(`UPDATE stripe_pagamenti SET stato = 'da_verificare', errore = 'Manca il PaymentIntent', aggiornato_il = NOW() WHERE id = ?`).run(lavoro.id);
    return;
  }

  if (lavoro.stato === 'da_incassare') {
    const daIncassare = lavoro.incasso_cent || lavoro.importo_cent;
    try {
      await s.paymentIntents.capture(intento, { amount_to_capture: daIncassare }, { idempotencyKey: `cap-${lavoro.id}` });
    } catch (e) {
      const pi = await s.paymentIntents.retrieve(intento);
      if (pi.status !== 'succeeded') throw e; // già incassata da un altro giro: va bene; altrimenti si riprova
    }
    await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'incassato', incasso_cent = ?, errore = NULL, aggiornato_il = NOW() WHERE id = ? AND stato = 'da_incassare'`)
      .run(daIncassare, lavoro.id);
    // Incassato meno di quanto autorizzato: l'importo pagato che il cliente vede è quello vero.
    if (lavoro.request_id && daIncassare < lavoro.importo_cent) {
      await db.prepare(`UPDATE requests SET pagamento_importo = ? WHERE id = ?`).run(daIncassare / 100, lavoro.request_id);
    }
    return;
  }

  if (lavoro.stato === 'da_rilasciare') {
    try {
      await s.paymentIntents.cancel(intento, { cancellation_reason: 'requested_by_customer' }, { idempotencyKey: `rel-${lavoro.id}` });
    } catch (e) {
      const pi = await s.paymentIntents.retrieve(intento);
      if (pi.status === 'succeeded') {
        // Nel frattempo era stata incassata: il blocco non c'è più, i soldi sì. Si rimborsano.
        await db.prepare(`UPDATE stripe_pagamenti SET stato = 'da_rimborsare', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_rilasciare'`).run(lavoro.id);
        return;
      }
      if (pi.status !== 'canceled') throw e; // già rilasciata va bene; altrimenti si riprova
    }
    await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'rilasciato', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_rilasciare'`)
      .run(lavoro.id);
    return;
  }

  if (lavoro.stato === 'da_rimborsare') {
    const pi = await s.paymentIntents.retrieve(intento);
    if (pi.status === 'requires_capture') {
      // Mai incassata (l'incasso non era andato a buon fine): basta rilasciare il blocco.
      await s.paymentIntents.cancel(intento, { cancellation_reason: 'requested_by_customer' }, { idempotencyKey: `rel2-${lavoro.id}` });
    } else if (pi.status !== 'canceled') {
      await s.refunds.create({ payment_intent: intento }, { idempotencyKey: `ref-${lavoro.id}` });
    }
    await db
      .prepare(`UPDATE stripe_pagamenti SET stato = 'rimborsato', aggiornato_il = NOW() WHERE id = ? AND stato = 'da_rimborsare'`)
      .run(lavoro.id);
  }
}

// Esegue con Stripe quello che il flusso ha segnato sul DB (incassi, rilasci, rimborsi) e fa un po' di pulizia:
// pagamenti rimasti a metà, carte autorizzate che nessuno ha raccolto. Un giro alla volta; ogni lavoro che fallisce si
// riprova al giro dopo, fino a TENTATIVI_MASSIMI (poi 'da_verificare': serve una persona, il motivo è in `errore`).
let inElaborazione = false;
async function elabora() {
  if (!attivo() || inElaborazione) return;
  inElaborazione = true;
  try {
    const modo = pagamenti.modoStripe();

    // Autorizzata ma la richiesta non è mai nata (processo caduto a metà): si rilascia il blocco.
    await db
      .prepare(
        `UPDATE stripe_pagamenti
            SET stato = 'da_rilasciare', motivo = 'La richiesta non è stata completata. Non è stato addebitato nulla.', aggiornato_il = NOW()
          WHERE modo = ? AND stato = 'in_creazione' AND aggiornato_il < NOW() - INTERVAL '3 minutes'`
      )
      .run(modo);

    // Pagamenti ancora aperti: se la carta è stata autorizzata e nessuno ha raccolto il pagamento (webhook perso o
    // mai configurato, scheda chiusa subito dopo aver pagato) la richiesta nasce da qui; i pagamenti abbandonati si
    // chiudono.
    const aperti = await db
      .prepare(`${SQL_RIGA} WHERE modo = ? AND stato = 'da_pagare' AND tentativi < ${TENTATIVI_MASSIMI} LIMIT ${LIMITE_LAVORI}`)
      .all(modo);
    for (const riga of aperti) {
      if (Number(riga.eta_sec) < SECONDI_PRIMA_DEL_RECUPERO) continue;
      try {
        await verificaPendente(riga);
      } catch (e) {
        console.error(`[stripe] pagamento ${riga.id}: verifica non riuscita:`, e.message);
        await db
          .prepare(`UPDATE stripe_pagamenti SET tentativi = tentativi + 1, errore = ?, aggiornato_il = NOW() WHERE id = ?`)
          .run(String(e.message).slice(0, 250), riga.id);
      }
    }

    const lavori = await db
      .prepare(
        `SELECT * FROM stripe_pagamenti
          WHERE modo = ? AND stato IN ('da_incassare', 'da_rilasciare', 'da_rimborsare') AND tentativi < ${TENTATIVI_MASSIMI}
          ORDER BY id LIMIT ${LIMITE_LAVORI}`
      )
      .all(modo);
    for (const lavoro of lavori) {
      try {
        await eseguiLavoro(lavoro);
      } catch (e) {
        console.error(`[stripe] pagamento ${lavoro.id} (${lavoro.stato}):`, e.message);
        const esauriti = lavoro.tentativi + 1 >= TENTATIVI_MASSIMI;
        await db
          .prepare(
            `UPDATE stripe_pagamenti
                SET tentativi = tentativi + 1, errore = ?, stato = CASE WHEN ? THEN 'da_verificare' ELSE stato END, aggiornato_il = NOW()
              WHERE id = ?`
          )
          .run(`${lavoro.stato}: ${String(e.message).slice(0, 250)}`, esauriti, lavoro.id);
      }
    }
  } finally {
    inElaborazione = false;
  }
}

// Registrarsi qui permette al flusso (src/pagamenti.js) di chiedere un giro subito dopo aver segnato un incasso o
// un rilascio, senza dipendere da questo modulo.
pagamenti.impostaElaboratore(elabora);

module.exports = {
  attivo,
  pagaConStripe: pagamenti.pagaConStripe,
  chiavePubblica,
  controllaConfigurazione,
  impostaStripe,
  avviaPagamento,
  avviaPagamentoReinvio,
  preparaPagina,
  esitoRitorno,
  completaDaIntento,
  leggiEvento,
  gestisciEvento,
  elabora,
};
