// Orari del banco: le fasce in cui riceve richieste (richiesta esplicita del 20/10/2026, pagina "Anagrafica del banco"). Funzioni pure,
// senza DB: le legge `richieste.distributoriCandidati`, il carrello (`flusso_cliente.validaRichiesta`) e la pagina dell'anagrafica.
//
// Formato salvato in `distributors.orari` (JSONB): { "lun": [["07:30","12:30"],["14:00","18:00"]], ..., "dom": [] }, sempre i sette giorni, al
// massimo due fasce per giorno, ora di Roma (Europe/Rome, anche se il server gira in UTC). Un giorno senza fasce è chiuso. NULL = nessun orario
// impostato = sempre aperto, com'era prima. Una fascia è [inizio, fine) con inizio < fine nello stesso giorno (niente notti a cavallo di due giorni).

const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const NOMI = { lun: 'Lunedì', mar: 'Martedì', mer: 'Mercoledì', gio: 'Giovedì', ven: 'Venerdì', sab: 'Sabato', dom: 'Domenica' };
const FUSO = 'Europe/Rome';
const MAX_FASCE = 2;
// Il prezzo del carrello e l'orario di riapertura si calcolano sull'ora di Roma di questo momento: nei test si passa un'altra data.
const GIORNO_DA_INGLESE = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const RE_ORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function oraValida(testo) {
  return typeof testo === 'string' && RE_ORA.test(testo);
}

// "07:30" -> 450 (minuti dalla mezzanotte).
function minutiDi(testo) {
  const [h, m] = String(testo).split(':').map(Number);
  return h * 60 + m;
}

// Una fascia ben fatta: due orari validi, il primo prima del secondo.
function fasciaValida(f) {
  return Array.isArray(f) && f.length === 2 && oraValida(f[0]) && oraValida(f[1]) && minutiDi(f[0]) < minutiDi(f[1]);
}

// Le fasce di un giorno, in ordine e senza sovrapposizioni; vuote se qualcosa non torna.
function fasceDelGiorno(valore) {
  if (!Array.isArray(valore) || valore.length > MAX_FASCE || !valore.every(fasciaValida)) return null;
  const ordinate = valore.map((f) => [f[0], f[1]]).sort((a, b) => minutiDi(a[0]) - minutiDi(b[0]));
  for (let i = 1; i < ordinate.length; i++) if (minutiDi(ordinate[i][0]) < minutiDi(ordinate[i - 1][1])) return null;
  return ordinate;
}

// Legge quello che arriva dal DB (oggetto, oppure testo JSON se il driver non lo ha già letto) e ritorna gli orari nella forma completa
// (sette giorni) o null: nessun orario, oppure un valore che non si capisce. Un valore rovinato NON chiude il banco: vale "sempre aperto"
// (meglio ricevere una richiesta fuori orario che perderne una per un dato sbagliato).
function leggiOrari(valore) {
  let o = valore;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch (e) { return null; }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const completi = {};
  for (const g of GIORNI) {
    const fasce = fasceDelGiorno(o[g] === undefined ? [] : o[g]);
    if (!fasce) return null;
    completi[g] = fasce;
  }
  return completi;
}

// Dal modulo della pagina agli orari. Per ogni giorno: `aperto_<g>` (casella), `da1_<g>`, `a1_<g>`, `da2_<g>`, `a2_<g>`. `sempre_aperto` = nessun
// orario (NULL). Ritorna { orari, errori: { <giorno>: 'testo' }, errore: 'testo generale' | null, valori }: `valori` rimette nel modulo quello che era
// stato scritto, anche se sbagliato.
function orariDaModulo(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const testo = (v) => (typeof v === 'string' ? v.trim() : '');
  const sempre = c.sempre_aperto === '1' || c.sempre_aperto === 'on';
  const valori = {};
  const errori = {};
  const orari = {};
  for (const g of GIORNI) {
    const aperto = c['aperto_' + g] === '1' || c['aperto_' + g] === 'on';
    const v = { aperto, da1: testo(c['da1_' + g]), a1: testo(c['a1_' + g]), da2: testo(c['da2_' + g]), a2: testo(c['a2_' + g]) };
    valori[g] = v;
    if (!aperto) { orari[g] = []; continue; }

    const fasce = [];
    const coppie = [[v.da1, v.a1, 1], [v.da2, v.a2, 2]];
    let errore = null;
    for (const [da, a, n] of coppie) {
      if (!da && !a) {
        if (n === 1) errore = errore || 'Scrivi gli orari della prima fascia, oppure segna il giorno come chiuso.';
        continue;
      }
      if (!oraValida(da) || !oraValida(a)) { errore = errore || 'Orari non validi: scrivi ore e minuti, per esempio 07:30.'; continue; }
      if (minutiDi(da) >= minutiDi(a)) { errore = errore || 'Ogni fascia deve finire dopo l’inizio (' + da + ' – ' + a + ').'; continue; }
      fasce.push([da, a]);
    }
    if (!errore && fasce.length === 2 && minutiDi(fasce[1][0]) < minutiDi(fasce[0][1])) errore = 'La seconda fascia deve cominciare dopo la fine della prima.';
    if (errore) errori[g] = errore; else orari[g] = fasce;
  }
  if (sempre) return { orari: null, errori: {}, errore: null, valori };
  if (Object.keys(errori).length) return { orari: null, errori, errore: null, valori };
  if (!GIORNI.some((g) => orari[g].length)) {
    return { orari: null, errori: {}, errore: 'Segna almeno un giorno come aperto, oppure scegli «Sempre aperto».', valori };
  }
  return { orari, errori: {}, errore: null, valori };
}

// Quello che il modulo di modifica mostra: i valori salvati; senza orari (sempre aperto) una proposta da cui partire (come nel mockup).
function valoriPerModulo(orari) {
  const base = orari || {
    lun: [['07:30', '12:30'], ['14:00', '18:00']], mar: [['07:30', '12:30'], ['14:00', '18:00']], mer: [['07:30', '12:30'], ['14:00', '18:00']],
    gio: [['07:30', '12:30'], ['14:00', '18:00']], ven: [['07:30', '12:30'], ['14:00', '18:00']], sab: [['07:30', '12:00']], dom: [],
  };
  const valori = {};
  for (const g of GIORNI) {
    const f = base[g] || [];
    valori[g] = { aperto: f.length > 0, da1: f[0] ? f[0][0] : '', a1: f[0] ? f[0][1] : '', da2: f[1] ? f[1][0] : '', a2: f[1] ? f[1][1] : '' };
  }
  return valori;
}

// Giorno della settimana (0 = lunedì) e minuti dalla mezzanotte, a Roma, di un istante.
function ricavaRoma(quando) {
  const parti = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(quando);
  const dato = (tipo) => (parti.find((p) => p.type === tipo) || {}).value;
  return { giorno: GIORNO_DA_INGLESE[dato('weekday')], minuti: Number(dato('hour')) * 60 + Number(dato('minute')) };
}

// Il banco riceve richieste adesso? (senza orari: sì)
function apertoAdesso(orari, quando = new Date()) {
  return statoOrari(orari, quando).aperto;
}

// { aperto, riapre }: `riapre` è null se è aperto (o se non riapre mai: tutti i giorni chiusi), altrimenti
// { giorno: 'lun', giorniDa: 0..7, ora: '07:30', attesaMin, testo: 'domani alle 07:30' }. `attesaMin` = minuti da adesso alla riapertura, per
// scegliere fra più banchi quello che riapre prima.
function statoOrari(valore, quando = new Date()) {
  const orari = leggiOrari(valore);
  if (!orari) return { aperto: true, riapre: null };
  const { giorno, minuti } = ricavaRoma(quando);
  const oggi = orari[GIORNI[giorno]];
  if (oggi.some((f) => minutiDi(f[0]) <= minuti && minuti < minutiDi(f[1]))) return { aperto: true, riapre: null };

  // Il prossimo inizio di fascia: oggi dopo adesso, poi i giorni dopo; allo stesso giorno della settimana prossima valgono tutte le fasce.
  for (let d = 0; d <= 7; d++) {
    const g = GIORNI[(giorno + d) % 7];
    const prima = orari[g].find((f) => d > 0 || minutiDi(f[0]) > minuti);
    if (!prima) continue;
    const attesaMin = d * 1440 + minutiDi(prima[0]) - minuti;
    const quandoTesto = d === 0 ? 'oggi' : d === 1 ? 'domani' : NOMI[g].toLowerCase();
    return { aperto: false, riapre: { giorno: g, giorniDa: d, ora: prima[0], attesaMin, testo: quandoTesto + ' alle ' + prima[0] } };
  }
  return { aperto: false, riapre: null }; // nessun giorno aperto
}

// Più banchi (le filiali attive): c'è qualcuno aperto? Se no, quando riapre il primo. `distributori`: righe di `distributors` (con `orari`).
function statoBanchi(distributori, quando = new Date()) {
  const stati = (distributori || []).map((d) => statoOrari(d.orari, quando));
  if (!stati.length || stati.some((s) => s.aperto)) return { aperto: true, riapre: null };
  const riaperture = stati.map((s) => s.riapre).filter(Boolean).sort((a, b) => a.attesaMin - b.attesaMin);
  return { aperto: false, riapre: riaperture[0] || null };
}

// "Il banco è chiuso · riapre domani alle 07:30" (senza riapertura: solo "Il banco è chiuso").
function frasePerCarrello(stato) {
  if (!stato || stato.aperto) return '';
  return 'Il banco è chiuso' + (stato.riapre ? ' · riapre ' + stato.riapre.testo : '');
}

// Le righe della scheda in lettura: giorni consecutivi con le stesse fasce su una riga sola.
// [{ etichetta: 'Lunedì – Venerdì', giorni: ['lun',...], fasce: ['07:30 – 12:30', '14:00 – 18:00'], chiuso: false }]
function riassunto(valore) {
  const orari = leggiOrari(valore);
  if (!orari) return [];
  const righe = [];
  for (const g of GIORNI) {
    const chiave = JSON.stringify(orari[g]);
    const ultima = righe[righe.length - 1];
    if (ultima && ultima.chiave === chiave) ultima.giorni.push(g);
    else righe.push({ chiave, giorni: [g], fasce: orari[g].map((f) => f[0] + ' – ' + f[1]), chiuso: orari[g].length === 0 });
  }
  return righe.map(({ chiave, ...r }) => ({
    ...r,
    etichetta: r.giorni.length === 1 ? NOMI[r.giorni[0]] : NOMI[r.giorni[0]] + ' – ' + NOMI[r.giorni[r.giorni.length - 1]],
  }));
}

module.exports = {
  GIORNI, NOMI, MAX_FASCE, FUSO,
  oraValida, leggiOrari, orariDaModulo, valoriPerModulo,
  apertoAdesso, statoOrari, statoBanchi, frasePerCarrello, riassunto,
};
