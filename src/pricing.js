const db = require('../db');
const { conCache } = require('./memo');
const stripeConfig = require('./stripe_config');

// Arrotonda a due decimali (centesimi).
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// La configurazione (percentuale di servizio, IVA, finestre) non cambia mentre l'app gira:
// si legge una volta al minuto invece che a ogni richiesta.
const getConfigNum = conCache(60 * 1000, async (chiave, fallback) => {
  const row = await db.prepare('SELECT valore FROM config WHERE chiave = ?').get(chiave);
  // Un valore scritto male nella tabella config (testo, vuoto) darebbe NaN, che si propaga in prezzi e totali:
  // meglio il valore di ripiego.
  const numero = row ? parseFloat(String(row.valore).replace(',', '.')) : NaN;
  return Number.isFinite(numero) ? numero : fallback;
});

// La percentuale del servizio, dalla configurazione (10 se manca).
async function getServizioPct() {
  return getConfigNum('servizio_pct', 10);
}

// La percentuale di IVA, dalla configurazione (22 se manca).
async function getIvaPct() {
  return getConfigNum('iva_pct', 22);
}

// Finestra di conferma delle richieste, in minuti (anche con la virgola: 0,5 = 30 secondi). Di norma sta nella tabella config
// (`finestra_conferma_min`, 10). `FINESTRA_CONFERMA_SEC` nel .env di UN computer la accorcia (o allunga) solo per quell'istanza,
// senza toccare il DB condiviso con la VPS e i banchi veri: richiesta esplicita del 16/10/2026, "per adesso" 30 secondi per
// provare i timer. Per toglierla: via la riga dal .env e riavvio.
const FINESTRA_SEC_ENV = parseFloat(process.env.FINESTRA_CONFERMA_SEC);
const FINESTRA_FORZATA_MIN = Number.isFinite(FINESTRA_SEC_ENV) && FINESTRA_SEC_ENV > 0 ? FINESTRA_SEC_ENV / 60 : null;
if (FINESTRA_FORZATA_MIN !== null) {
  console.log(`[config] FINESTRA_CONFERMA_SEC=${FINESTRA_SEC_ENV}: la finestra di conferma è di ${FINESTRA_SEC_ENV} s (il valore del DB è ignorato).`);
}

// I minuti che i banchi hanno per rispondere, usati dai timer: la configurazione, o il valore forzato nel .env di questo computer.
async function getFinestraMinuti() {
  if (FINESTRA_FORZATA_MIN !== null) return FINESTRA_FORZATA_MIN;
  return getConfigNum('finestra_conferma_min', 10);
}

// I minuti che si SCRIVONO nei testi ("I banchi rispondono entro 10 min", "Hai 10 minuti per confermare"): sempre il valore vero della configurazione,
// anche quando FINESTRA_CONFERMA_SEC accorcia il timer di un'istanza per provare (richiesta esplicita del 21/10/2026: "deve esserci 10, ovunque, anche se
// per ora il timer è di 1m"). Timer, anelli e scadenze continuano a usare getFinestraMinuti.
async function getFinestraMinutiTesto() {
  return getConfigNum('finestra_conferma_min', 10);
}

// IMPORTO DI PROVA — TEMPORANEO (richieste esplicite del 21/10/2026). `PAGAMENTO_APP_PROVA=0.50` nel .env di UN server fa valere quella cifra come importo
// che l'installatore paga ORA in app (`app.totale`, cioè `da_pagare_app`: carrello, addebito Stripe, ordine, Storico). La formula di dividiTotale non cambia e
// le sue voci (corriere, servizio, IVA) restano com'erano; cambia solo il totale addebitato, e mai in più della formula (`Math.min`). Il materiale da pagare
// dopo a BOREA non si tocca. Da rimuovere quando le prove sono finite: vedi docs/PROMPT_RIPRISTINO_PAGAMENTO_PROVA.md.
//
// Con Stripe in modo di PROVA o col pagamento simulato basta quella riga. Con Stripe REALE (`STRIPE_MODO=live`, chiave sk_live_) o `NODE_ENV=production`
// — cioè con soldi veri e clienti veri sullo stesso server — la riga da sola è IGNORATA: serve una seconda, `PAGAMENTO_APP_PROVA_LIVE=AAAA-MM-GG`, la data
// (ora di Roma, compresa) fino a cui vale. Passata quella data, o se la data manca, è scritta male o è più lontana di 7 giorni, l'importo torna quello della
// formula da solo anche se le righe restano nel .env: una dimenticanza non lascia il prezzo basso aperto. In quel caso la cifra non scende mai sotto i
// 0,50 € (il minimo di Stripe, che sotto rifiuta l'addebito) e all'avvio il log scrive ATTENZIONE, con la data di scadenza.
const MINIMO_STRIPE = 0.5;
const GIORNI_MASSIMI_LIVE = 7;
const avvisiProva = new Set(); // ogni avviso si scrive una volta sola
// Scrive un avviso nel log una volta sola per ogni chiave (per non riempirlo a ogni calcolo).
function avvisaProva(chiave, testo, livello = 'warn') {
  if (avvisiProva.has(chiave)) return;
  avvisiProva.add(chiave);
  console[livello](testo);
}
const giornoRoma = (data = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(data);
// L'importo di prova che l'installatore paga ora (PAGAMENTO_APP_PROVA), se è attivo e permesso; con Stripe reale o in produzione conta solo con la
// data di scadenza e mai sotto 0,50.
function importoProvaApp() {
  const grezzo = String(process.env.PAGAMENTO_APP_PROVA || '').trim().replace(',', '.');
  if (!grezzo) return null;
  let importo = Number(grezzo);
  if (!Number.isFinite(importo) || importo <= 0) return null;
  if (stripeConfig.modo() === 'live' || process.env.NODE_ENV === 'production') {
    const fino = String(process.env.PAGAMENTO_APP_PROVA_LIVE || '').trim();
    const oggi = giornoRoma();
    const valida = /^\d{4}-\d{2}-\d{2}$/.test(fino) && !Number.isNaN(Date.parse(fino + 'T00:00:00Z'));
    const lontana = valida && Date.parse(fino + 'T00:00:00Z') - Date.parse(oggi + 'T00:00:00Z') > GIORNI_MASSIMI_LIVE * 86400000;
    if (!valida || lontana || fino < oggi) {
      avvisaProva(
        'ignorata:' + fino,
        !fino
          ? '[config] PAGAMENTO_APP_PROVA ignorata: con Stripe in modo reale o NODE_ENV=production serve anche PAGAMENTO_APP_PROVA_LIVE=AAAA-MM-GG (la data fino a cui vale, al massimo ' + GIORNI_MASSIMI_LIVE + ' giorni). L’importo si calcola con la formula.'
          : !valida
            ? '[config] PAGAMENTO_APP_PROVA ignorata: PAGAMENTO_APP_PROVA_LIVE="' + fino + '" non è una data AAAA-MM-GG. L’importo si calcola con la formula.'
            : lontana
              ? '[config] PAGAMENTO_APP_PROVA ignorata: PAGAMENTO_APP_PROVA_LIVE=' + fino + ' è più lontana di ' + GIORNI_MASSIMI_LIVE + ' giorni. L’importo si calcola con la formula.'
              : '[config] PAGAMENTO_APP_PROVA scaduta il ' + fino + ': l’importo si calcola con la formula. Togli le righe PAGAMENTO_APP_PROVA e PAGAMENTO_APP_PROVA_LIVE dal .env.'
      );
      return null;
    }
    importo = Math.max(importo, MINIMO_STRIPE);
    avvisaProva(
      'live:' + fino + ':' + importo,
      `[config] ATTENZIONE: PAGAMENTO_APP_PROVA=${importo.toFixed(2)} con Stripe REALE / produzione, fino al ${fino} compreso: l'installatore paga ${importo.toFixed(2)} € invece della formula, con soldi veri. Togli PAGAMENTO_APP_PROVA e PAGAMENTO_APP_PROVA_LIVE dal .env appena finite le prove.`
    );
  }
  return Math.round(importo * 100) / 100;
}
{
  const prova = importoProvaApp();
  if (prova !== null && stripeConfig.modo() !== 'live' && process.env.NODE_ENV !== 'production') {
    console.log(`[config] PAGAMENTO_APP_PROVA=${prova}: l'installatore paga ORA ${prova} € in app (la formula resta, il materiale al banco non cambia).`);
  }
}

// Ordine minimo, calcolato sui prezzi già maggiorati del servizio e IVA esclusa.
async function getOrdineMinimo() {
  return getConfigNum('ordine_minimo', 33);
}

// Spedizione fissa (il corriere che l'installatore paga in app, 5 € dal 23/10/2026): si somma dopo, non concorre a raggiungere il minimo.
async function getSpedizioneFissa() {
  return getConfigNum('spedizione_fissa', 5);
}

// Prezzo netto grossista: listino meno lo sconto Base del prodotto (o del distributore).
function prezzoNetto({ prezzo_listino, sconto_base_pct }) {
  return round2(prezzo_listino * (1 - sconto_base_pct / 100));
}

// Formattazione in euro, formato italiano (1.234,56).
function euro(n) {
  return (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// COME SI DIVIDE QUELLO CHE PAGA L'INSTALLATORE (la tiene UNA sola funzione, dividiTotale, e la usano il carrello, l'addebito, l'ordine e lo Storico):
//  · PAGA ORA IN APP  = corriere fisso (config spedizione_fissa, 5 €: è già il prezzo finale, niente IVA sopra)
//                       + servizio IVA INCLUSA = servizio_pct (10%) della merce a PREZZO DEL BANCO, IVA esclusa, più la sua IVA iva_pct (22%).
//  · PAGA DOPO A BOREA = merce a prezzo del banco (+ RAEE, se c'è) + IVA iva_pct su quella somma.
// Richiesta esplicita del 23/10/2026 ("5 euro costo fisso corriere, e costo di servizio con IVA incluso"): prima l'IVA era una riga sopra a corriere e
// servizio (10 € + servizio, poi + 22% su tutto). Ora nel riepilogo non c'è più la riga IVA: il servizio si mostra e si paga con l'IVA dentro.
// L'IVA che sta DENTRO il totale (`app.iva`, `app.imponibile`) si ricava per scorporo dal totale pagato, ed è quella che va salvata sull'ordine e sulla
// ricevuta ("di cui"). `app.servizio` resta il 10% IVA ESCLUSA (è quello che si salva in `servizio` e da cui si ricava la percentuale), `app.servizioIva`
// è quello che si mostra e si paga; `app.ivaInclusa` vale sempre true qui: serve a chi legge importi salvati col modello di prima (vedi appIvaInclusa).
// Il 10% sta SOLO nella voce "Servizio": i prezzi delle righe (catalogo, carrello) sono quelli del banco. Ogni voce è già arrotondata (round2) e i totali sono
// somma di voci arrotondate: la vista non fa conti, e da_pagare_app (l'addebito Stripe) coincide con app.totale centesimo per centesimo.
// Esempio: merce 64,50 → servizio 6,45 → con IVA 7,87; app = 5,00 + 7,87 = 12,87 (di cui IVA 2,32); banco = 64,50 + IVA 14,19 = 78,69; spesa complessiva 91,56.
function scorporaIva(totale, ivaPct) {
  const iva = round2(totale - totale / (1 + ivaPct / 100));
  return { iva, imponibile: round2(totale - iva) };
}

// Il calcolo unico dei prezzi: separa quanto si paga ora in app (corriere + servizio con IVA inclusa) da quanto si paga dopo al banco (materiale +
// RAEE + IVA), con tutte le voci già arrotondate.
function dividiTotale({ netto, raee = 0, consegna = 0, servizioPct, ivaPct }) {
  const servizio = round2((netto * servizioPct) / 100); // esattamente "il 10% della merce", non la somma di righe arrotondate una per una
  const servizioIva = round2(servizio * (1 + ivaPct / 100));
  const appTotale = round2(consegna + servizioIva);
  const { iva: appIva, imponibile: appImponibile } = scorporaIva(appTotale, ivaPct);
  const bancoImponibile = round2(netto + raee);
  const bancoIva = round2((bancoImponibile * ivaPct) / 100);
  return {
    servizio,
    app: { corriere: round2(consegna), servizio, servizioIva, imponibile: appImponibile, iva: appIva, totale: appTotale, ivaInclusa: true },
    banco: { merce: round2(netto), raee: round2(raee), imponibile: bancoImponibile, iva: bancoIva, totale: round2(bancoImponibile + bancoIva) },
    servizioPct,
    ivaPct,
  };
}

// Gli importi "paga ora" già salvati (ordini e richieste nati prima del 23/10/2026) hanno l'IVA SOPRA corriere e servizio: (10 + 6,45) × 1,22 = 20,07, con
// la riga IVA da 3,62. Quelli nuovi hanno l'IVA dentro: 5 + 7,87 = 12,87, di cui IVA 2,32. Per scegliere come mostrarli si guarda l'IVA salvata: è
// "inclusa" se è più vicina allo scorporo dal totale nuovo che all'IVA sommata sopra del modello vecchio. Con il corriere a zero i due modelli danno gli
// stessi numeri e vale quello vecchio (le righe tornano comunque). Non si guarda il totale addebitato: con l'importo di prova (PAGAMENTO_APP_PROVA) non
// somma, ma l'IVA salvata sì.
function appIvaInclusa({ corriere, servizio, iva, ivaPct }) {
  const vecchia = round2(((corriere + servizio) * ivaPct) / 100);
  const nuova = scorporaIva(round2(corriere + round2(servizio * (1 + ivaPct / 100))), ivaPct).iva;
  return Math.abs(iva - nuova) < Math.abs(iva - vecchia);
}

// In `app` ogni importo ha sempre `servizioIva` (il servizio come si MOSTRA: con l'IVA dentro nel modello nuovo, uguale a `servizio` nel vecchio, dove l'IVA
// ha la sua riga) e `ivaInclusa`: le viste scrivono `servizioIva` e disegnano la riga IVA solo se `!ivaInclusa`, senza fare conti.
function conServizioMostrato(app, ivaPct) {
  const ivaInclusa = appIvaInclusa({ corriere: app.corriere, servizio: app.servizio, iva: app.iva, ivaPct });
  if (!ivaInclusa) return { ...app, ivaInclusa, servizioIva: app.servizio };
  const servizioIva = round2(app.servizio * (1 + ivaPct / 100));
  // L'imponibile "di cui" è quello che resta togliendo l'IVA dal totale nuovo (le richieste non lo salvano: lo si ricava così).
  return { ...app, ivaInclusa, servizioIva, imponibile: round2(app.corriere + servizioIva - app.iva) };
}

// A partire dalle righe carrello [{prodotto, quantita}], calcola righe ordine e totali.
// `prodotto` può essere il prodotto di catalogo o la riga di listino di un distributore:
// serve solo che abbia codice, nome, prezzo_listino e sconto_base_pct.
// `prodotto.raee` (opzionale) è il contributo RAEE unitario: i listini dei produttori lo
// dichiarano escluso dal prezzo, quindi viaggia come voce separata.
//
// Prezzi e totali (vedi dividiTotale per la regola e un esempio):
//  · le righe del carrello valgono il PREZZO DEL BANCO (`prezzo_netto_unitario`, `subtotale`); `totale_netto` è la merce;
//  · `app` e `banco` sono le due parti già arrotondate (corriere, servizio, imponibile, IVA, totale / merce, RAEE, imponibile, IVA,
//    totale), `servizioPct` e `ivaPct` servono alle etichette; `da_pagare_app` = app.totale (l'addebito) e `materiale_banco` =
//    banco.totale; `totale_ivato` = app.totale + banco.totale (la "spesa complessiva"), con `imponibile` e `iva` somme delle due parti;
//  · restano scritti come sempre in order_items `prezzo_unitario_cliente` e `subtotale_cliente` (il prezzo col 10%): non si mostrano
//    più come prezzo, `totale_finale` (merce col servizio) è quello salvato sull'ordine.
async function calcolaOrdine(righeCarrello, { costoConsegna = 0 } = {}) {
  const servizioPct = await getServizioPct();
  const ivaPct = await getIvaPct();
  const righe = righeCarrello.map(({ prodotto, quantita }) => {
    const prezzo_netto_unitario = prezzoNetto(prodotto);
    const prezzo_unitario_cliente = round2(prezzo_netto_unitario * (1 + servizioPct / 100));
    const raee_unitario = round2(prodotto.raee || 0);
    return {
      product_id: prodotto.id,
      codice_snapshot: prodotto.codice,
      nome_snapshot: prodotto.nome,
      quantita,
      prezzo_listino_snapshot: prodotto.prezzo_listino,
      sconto_pct_snapshot: prodotto.sconto_base_pct,
      prezzo_netto_unitario,
      subtotale: round2(prezzo_netto_unitario * quantita),
      prezzo_unitario_cliente,
      subtotale_cliente: round2(prezzo_unitario_cliente * quantita),
      raee_unitario,
      raee_riga: round2(raee_unitario * quantita),
    };
  });

  const totale_netto = round2(righe.reduce((acc, r) => acc + r.subtotale, 0));
  const merce_cliente = round2(righe.reduce((acc, r) => acc + r.subtotale_cliente, 0));
  const contributo_raee = round2(righe.reduce((acc, r) => acc + r.raee_riga, 0));
  const costo_consegna = round2(costoConsegna || 0);

  const { servizio, app, banco } = dividiTotale({ netto: totale_netto, raee: contributo_raee, consegna: costo_consegna, servizioPct, ivaPct });
  const prova = importoProvaApp();
  if (prova !== null) app.totale = Math.min(prova, app.totale); // solo prove, temporaneo, mai più della formula: vedi importoProvaApp

  return {
    righe,
    totale_netto, // la merce a prezzo del banco: quella che si vede nelle righe e nel riquadro Materiale
    totale_finale: merce_cliente, // merce col servizio incluso (come si salva sull'ordine); non più quella che si mostra
    contributo_raee,
    costo_consegna,
    imponibile: round2(app.imponibile + banco.imponibile),
    iva: round2(app.iva + banco.iva),
    totale_ivato: round2(app.totale + banco.totale), // la spesa complessiva
    servizio, // il 10% della merce a prezzo del banco, IVA esclusa
    da_pagare_app: app.totale, // corriere + servizio con IVA inclusa: l'importo addebitato quando si preme "Paga e invia"
    materiale_banco: banco.totale, // merce (+ RAEE) + IVA: quello che si paga dopo a BOREA
    app,
    banco,
    servizioPct,
    ivaPct,
  };
}

// % IVA di un ordine, dai suoi valori SALVATI (mai quella di oggi, se l'ordine ne ha una sua): per gli ordini con gli importi divisi è
// iva / imponibile delle due parti; per gli altri iva / (merce col servizio + RAEE + consegna); senza IVA salvata, quella della configurazione.
// Un solo decimale (22, 10, 4...): l'IVA di un ordine non ha centesimi di percentuale, ma l'arrotondamento dei centesimi sì.
function ivaPctOrdine(o, ivaConfig) {
  const n = (v) => Number(v) || 0;
  const uno = (x) => Math.round(x * 10) / 10;
  const impDiviso = n(o.imponibile_app) + n(o.imponibile_banco);
  const ivaDiviso = n(o.iva_app) + n(o.iva_banco);
  if (impDiviso > 0 && ivaDiviso > 0) {
    const pct = uno((ivaDiviso / impDiviso) * 100);
    if (pct > 0 && pct < 100) return pct;
  }
  const imponibile = n(o.totale_finale) + n(o.contributo_raee) + n(o.costo_consegna);
  if (n(o.iva) > 0 && imponibile > 0) {
    const pct = uno((n(o.iva) / imponibile) * 100);
    if (pct > 0 && pct < 100) return pct;
  }
  return ivaConfig;
}

// Un centesimo di arrotondamento fra l'importo addebitato e quello calcolato.
const TOLLERANZA_ADDEBITO = 0.011;

// GLI IMPORTI DI UN ORDINE, divisi come nel carrello: UNA sola funzione per la pagina dell'ordine, la richiesta in attesa, lo Storico e la
// pagina del cliente lato banco, così i numeri sono uguali dappertutto.
//   `ordine`: la riga di orders. `pagamento`: { stato, metodo, importo, pagato_il } della richiesta, o null. `ivaPct`: l'IVA (vedi ivaPctOrdine).
//   `servizioPct` (facoltativo): la % di servizio per le etichette degli ordini VECCHI; per gli altri si ricava dall'ordine (servizio / merce).
// Ritorna { app: { corriere, servizio, imponibile, iva, totale, pagatoIl, rimborsato, metodo },
//           banco: { merce, raee, imponibile, iva, totale }, servizioPct, ivaPct }.
//  · Ordini con le colonne nuove (servizio, imponibile_app, iva_app, da_pagare_app, imponibile_banco, iva_banco, materiale_banco): si usano
//    quelle, già calcolate da calcolaOrdine alla nascita dell'ordine.
//  · Ordini vecchi (colonne a 0): si ricalcola dai valori dell'ordine: merce = totale_netto; servizio = totale_finale − totale_netto;
//    corriere = costo_consegna; raee = contributo_raee; IVA delle due parti come in calcolaOrdine (round2(imponibile × iva/100)).
//  · app.totale: l'importo davvero addebitato (pagamento.importo, che con Stripe è già l'incassato) quando c'è ed è coerente con il calcolo
//    (non oltre un centesimo): gli ordini di prima, pagati interi in app, hanno un importo che comprende il materiale e non è una consegna, e
//    lì vale il calcolo. `pagatoIl` è la data del pagamento.
function importiOrdine(ordine, pagamento, ivaPct, servizioPct) {
  const n = (v) => Number(v) || 0;
  const merce = round2(n(ordine.totale_netto));
  const raee = round2(n(ordine.contributo_raee));
  const corriere = round2(n(ordine.costo_consegna));
  const salvati = n(ordine.da_pagare_app) > 0 || n(ordine.materiale_banco) > 0;

  let servizio;
  let app;
  let banco;
  if (salvati) {
    servizio = round2(n(ordine.servizio));
    app = {
      corriere,
      servizio,
      imponibile: n(ordine.imponibile_app) > 0 ? round2(n(ordine.imponibile_app)) : round2(corriere + servizio),
      iva: round2(n(ordine.iva_app)),
      totale: round2(n(ordine.da_pagare_app)),
    };
    banco = {
      merce,
      raee,
      imponibile: n(ordine.imponibile_banco) > 0 ? round2(n(ordine.imponibile_banco)) : round2(merce + raee),
      iva: round2(n(ordine.iva_banco)),
      totale: round2(n(ordine.materiale_banco)),
    };
  } else {
    servizio = Math.max(0, round2(n(ordine.totale_finale) - merce));
    const appImponibile = round2(corriere + servizio);
    const appIva = round2((appImponibile * ivaPct) / 100);
    const bancoImponibile = round2(merce + raee);
    const bancoIva = round2((bancoImponibile * ivaPct) / 100);
    app = { corriere, servizio, imponibile: appImponibile, iva: appIva, totale: round2(appImponibile + appIva) };
    banco = { merce, raee, imponibile: bancoImponibile, iva: bancoIva, totale: round2(bancoImponibile + bancoIva) };
  }
  app = conServizioMostrato(app, ivaPct);

  let pagatoIl = null;
  let rimborsato = false;
  let rimborsatoIl = null;
  let metodo = null;
  if (pagamento) {
    pagatoIl = pagamento.pagato_il || null;
    rimborsato = pagamento.stato === 'rimborsato';
    rimborsatoIl = pagamento.rimborsato_il || null;
    metodo = pagamento.metodo || null;
    const addebitato = n(pagamento.importo);
    if (addebitato > 0 && addebitato <= app.totale + TOLLERANZA_ADDEBITO) app.totale = round2(addebitato);
  }

  const ricavata = merce > 0 ? Math.round((servizio / merce) * 1000) / 10 : 0;
  return {
    app: { ...app, conPagamento: !!pagamento, pagatoIl, rimborsato, rimborsatoIl, metodo },
    banco,
    servizioPct: !salvati && servizioPct !== undefined && servizioPct !== null ? Number(servizioPct) : ricavata,
    ivaPct,
  };
}

// Le righe di una richiesta come le legge richieste.righeRichiesta (request_items + prodotto) -> righe carrello [{ prodotto, quantita }] ->
// calcolaOrdine: LA STESSA funzione di prezzo del carrello, quindi gli stessi prezzi del banco. Serve alle pagine della richiesta (le righe a
// prezzo del banco e gli importi delle richieste nate prima delle colonne salvate), a "Rinvia" (quanto si paga di nuovo, con i prezzi di oggi).
async function calcolaDaRigheDb(righeDb, opzioni) {
  return calcolaOrdine(
    righeDb.map((r) => ({
      prodotto: { id: r.product_id, codice: r.codice, nome: r.nome, prezzo_listino: r.prezzo_listino, sconto_base_pct: r.sconto_base_pct, raee: r.raee },
      quantita: r.quantita,
    })),
    opzioni
  );
}

// GLI IMPORTI DI UNA RICHIESTA (senza ordine: in attesa, chiusa, annullata), nella stessa forma di importiOrdine:
//   { app: { corriere, servizio, imponibile, iva, totale, conPagamento, pagatoIl, rimborsato, rimborsatoIl, metodo },
//     banco: { merce, raee, imponibile, iva, totale }, servizioPct, ivaPct }.
//  · Richiesta con le colonne salvate alla nascita (corriere, servizio, iva_app, da_pagare_app, merce_banco, raee_banco, iva_banco, materiale_banco):
//    si usano quelle. Richiesta vecchia (colonne a 0): `calcolato` = calcolaOrdine sulle righe della richiesta con la consegna fissa di oggi.
//  · app.totale = `pagamento_importo` quando c'è: quello davvero addebitato (e poi rimborsato), non il calcolo. `pagatoIl` = pagato_il;
//    `rimborsatoIl` = rimborsato_il, o per una richiesta chiusa senza ordine (nessuna_offerta) il momento in cui è scaduta (`scade_il`, per i
//    rimborsi fatti prima che la colonna esistesse).
function importiRichiesta(richiesta, calcolato) {
  const n = (v) => Number(v) || 0;
  const uno = (x) => Math.round(x * 10) / 10;
  const salvati = n(richiesta.da_pagare_app) > 0 || n(richiesta.materiale_banco) > 0;

  let app;
  let banco;
  let ivaPct;
  let servizioPct;
  if (salvati || !calcolato) {
    const corriere = round2(n(richiesta.corriere));
    const servizio = round2(n(richiesta.servizio));
    const merce = round2(n(richiesta.merce_banco));
    const raee = round2(n(richiesta.raee_banco));
    app = { corriere, servizio, imponibile: round2(corriere + servizio), iva: round2(n(richiesta.iva_app)), totale: round2(n(richiesta.da_pagare_app)) };
    banco = { merce, raee, imponibile: round2(merce + raee), iva: round2(n(richiesta.iva_banco)), totale: round2(n(richiesta.materiale_banco)) };
    // L'IVA % si ricava dal materiale, dove non ci sono dubbi (iva / imponibile); solo senza materiale si prova con le due parti insieme (modello di prima).
    const pctBanco = banco.imponibile > 0 ? uno((banco.iva / banco.imponibile) * 100) : 0;
    const imponibile = app.imponibile + banco.imponibile;
    const pctInsieme = imponibile > 0 ? uno(((app.iva + banco.iva) / imponibile) * 100) : 0;
    const pct = pctBanco > 0 && pctBanco < 100 ? pctBanco : pctInsieme;
    ivaPct = pct > 0 && pct < 100 ? pct : (calcolato ? calcolato.ivaPct : 0);
    servizioPct = merce > 0 ? uno((servizio / merce) * 100) : (calcolato ? calcolato.servizioPct : 0);
  } else {
    app = { ...calcolato.app };
    banco = { ...calcolato.banco };
    ivaPct = calcolato.ivaPct;
    servizioPct = calcolato.servizioPct;
  }
  app = conServizioMostrato(app, ivaPct);

  const addebitato = n(richiesta.pagamento_importo);
  if (addebitato > 0) app.totale = round2(addebitato);
  const rimborsato = richiesta.pagamento_stato === 'rimborsato';
  const rimborsatoIl = rimborsato ? richiesta.rimborsato_il || (richiesta.stato === 'nessuna_offerta' ? richiesta.scade_il || null : null) : null;
  return {
    app: {
      ...app,
      conPagamento: !!richiesta.pagamento_stato,
      pagatoIl: richiesta.pagato_il || null,
      rimborsato,
      rimborsatoIl,
      metodo: richiesta.pagamento_metodo || null,
    },
    banco,
    servizioPct,
    ivaPct,
  };
}

// UN SOLO PUNTO per gli importi di un ordine o di una richiesta: importi({ ordine, pagamento, ivaPct, servizioPct }) oppure
// importi({ richiesta, calcolato }). Vedi importiOrdine e importiRichiesta.
function importi({ ordine, richiesta, pagamento = null, ivaPct, servizioPct, calcolato } = {}) {
  if (ordine) return importiOrdine(ordine, pagamento, ivaPct, servizioPct);
  if (richiesta) return importiRichiesta(richiesta, calcolato);
  throw new Error('importi: serve un ordine o una richiesta');
}

module.exports = {
  round2,
  euro,
  getServizioPct,
  getIvaPct,
  getFinestraMinuti,
  getFinestraMinutiTesto,
  getOrdineMinimo,
  getSpedizioneFissa,
  prezzoNetto,
  dividiTotale,
  appIvaInclusa,
  ivaPctOrdine,
  importiOrdine,
  importiRichiesta,
  importi,
  calcolaDaRigheDb,
  calcolaOrdine,
};
