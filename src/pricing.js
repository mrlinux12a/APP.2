const db = require('../db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function getConfigNum(chiave, fallback) {
  const row = await db.prepare('SELECT valore FROM config WHERE chiave = ?').get(chiave);
  return row ? parseFloat(row.valore) : fallback;
}

async function getServizioPct() {
  return getConfigNum('servizio_pct', 10);
}

async function getIvaPct() {
  return getConfigNum('iva_pct', 22);
}

async function getFinestraMinuti() {
  return getConfigNum('finestra_conferma_min', 10);
}

// Minuti che il cliente ha per scegliere fra più distributori che hanno confermato.
async function getFinestraSceltaMinuti() {
  return getConfigNum('finestra_scelta_min', 5);
}

// Ordine minimo, calcolato sui prezzi già maggiorati del servizio e IVA esclusa.
async function getOrdineMinimo() {
  return getConfigNum('ordine_minimo', 33);
}

// Spedizione fissa: si somma dopo, non concorre a raggiungere il minimo.
async function getSpedizioneFissa() {
  return getConfigNum('spedizione_fissa', 10);
}

// Prezzo netto grossista: listino meno lo sconto Base del prodotto (o del distributore).
function prezzoNetto({ prezzo_listino, sconto_base_pct }) {
  return round2(prezzo_listino * (1 - sconto_base_pct / 100));
}

// Prezzo esposto al cliente: netto + 10% di servizio. È IVA esclusa: in interfaccia
// va sempre accompagnato da "+ IVA".
async function prezzoCliente(riga) {
  const pct = await getServizioPct();
  return prezzoClienteConPct(riga, pct);
}

// Versione sincrona per i template EJS (che non possono fare "await" dentro <%= %>):
// la percentuale di servizio si legge una volta sola per richiesta, poi il calcolo
// per riga è puro e non tocca il DB.
function prezzoClienteConPct(riga, servizioPct) {
  return round2(prezzoNetto(riga) * (1 + servizioPct / 100));
}

// Formattazione in euro, formato italiano (1.234,56).
function euro(n) {
  return (n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A partire dalle righe carrello [{prodotto, quantita}], calcola righe ordine e totali.
// `prodotto` può essere il prodotto di catalogo o la riga di listino di un distributore:
// serve solo che abbia codice, nome, prezzo_listino e sconto_base_pct.
// `prodotto.raee` (opzionale) è il contributo RAEE unitario: i listini dei produttori lo
// dichiarano escluso dal prezzo, quindi viaggia come voce separata.
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
  const imponibile = round2(merce_cliente + contributo_raee + costo_consegna);
  const iva = round2(imponibile * (ivaPct / 100));
  const totale_ivato = round2(imponibile + iva);

  return {
    righe,
    totale_netto,
    totale_finale: merce_cliente, // imponibile della sola merce (servizio già incluso)
    contributo_raee,
    costo_consegna,
    imponibile,
    iva,
    totale_ivato,
  };
}

module.exports = {
  round2,
  euro,
  getServizioPct,
  getIvaPct,
  getFinestraMinuti,
  getFinestraSceltaMinuti,
  getOrdineMinimo,
  getSpedizioneFissa,
  prezzoNetto,
  prezzoCliente,
  prezzoClienteConPct,
  calcolaOrdine,
};
