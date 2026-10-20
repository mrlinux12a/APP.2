// Pagina dell'ordine vista dal banco (GET /distributore/ordini/:id, views/distributore_ordine.ejs): le righe del materiale col PREZZO DEL BANCO,
// i passi di "Avanzamento" e l'indirizzo di consegna. Solo presentazione, niente DB: la route legge, la vista disegna.
// Anche il dettaglio che si apre nello Storico (src/storico_dettaglio.js) usa le righe e i momenti di qui: le due viste dicono le stesse cose.
// Il solo orario del corriere che il banco vede è quello scritto su WhatsApp (src/corriere.js).
const orariCorriere = require('./corriere');
const format = require('./format');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Le righe del materiale, a prezzo del banco: prezzo cad. = prezzo netto + RAEE unitario, totale di riga = subtotale + RAEE di riga (MAI il prezzo
// col servizio: quello lo paga il cliente in app). `mancanti` (richieste.calcolaOfferta) porta le righe confermate a metà: "richiesti N, ne hai
// confermati M"; si abbinano per codice. Gli articoli confermati a zero non sono righe dell'ordine: vanno in `fuori`, per non perderli di vista.
// Ritorna { righe, fuori }.
function righeMateriale(righe, mancanti = []) {
  const perCodice = new Map((mancanti || []).map((m) => [String(m.codice), m]));
  const lista = (righe || []).map((r) => {
    const m = perCodice.get(String(r.codice_snapshot));
    return {
      id: r.id,
      quantita: Number(r.quantita) || 0,
      nome: r.nome_snapshot,
      codice: r.codice_snapshot,
      cad: round2(Number(r.prezzo_netto_unitario) + Number(r.raee_unitario || 0)),
      totale: round2(Number(r.subtotale) + Number(r.raee_riga || 0)),
      richiesti: m ? Number(m.quantita_richiesta) : null,
      confermati: m ? Number(m.quantita_disponibile) : null,
    };
  });
  const presenti = new Set(lista.map((r) => String(r.codice)));
  return {
    righe: lista,
    fuori: (mancanti || []).filter((m) => !presenti.has(String(m.codice))),
  };
}

// "Via Castel Morrone 1/7r, 16161 Genova (GE)" -> via in grassetto e, sotto, CAP e città. La via è ciò che sta prima della prima virgola.
function indirizzoDiviso(testo) {
  const t = String(testo || '').trim();
  const i = t.indexOf(',');
  return i === -1 ? { via: t, resto: '' } : { via: t.slice(0, i).trim(), resto: t.slice(i + 1).trim() };
}

// La riga col furgone della scheda "Consegna". Vuota (la riga non si disegna) quando consegna il banco con il suo mezzo: è il caso di base, non serve dirlo.
function descrizioneConsegna({ modalita, conCorriere, corriereNome }) {
  if (modalita === 'ritiro') return 'Ritiro al banco da parte del cliente';
  if (conCorriere) return `Corriere${corriereNome ? ' ' + corriereNome : ''} · ritiro al banco`;
  return '';
}

// "referente Mario · P. IVA 0123…": le parti che mancano non si scrivono.
function sottotitoloCliente(cliente) {
  const parti = [];
  if (cliente.referente) parti.push('referente ' + cliente.referente);
  if (cliente.partita_iva) parti.push('P. IVA ' + cliente.partita_iva);
  return parti.join(' · ');
}

// ---------- Quando è successo: momenti, partenza, tempo di consegna ----------

// La colonna di una data: orders.creato_il, evaso_il, in_evasione_il, consegnato_il sono TIMESTAMP senza fuso (UTC, vedi format.istanteUtc);
// corriere_risposto_il (e quindi il ritiro del corriere, corriere.ritiro) è TIMESTAMPTZ (un istante vero: `reale`).
const GIORNO_ROMA = (istante) => istante.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });

// Un momento di un ordine, in ora italiana: { ora: '09:47', giorno: '' | '20/10', completo: '20/10/2026 alle 09:47' }, o null se la data manca.
// `giorno` è vuoto se cade nello stesso giorno italiano di `creatoIl` (di norma una consegna è lo stesso giorno: l'ora basta), altrimenti "gg/mm".
function momento(valore, creatoIl, { reale = false } = {}) {
  const istante = reale ? format.toDate(valore) : format.istanteUtc(valore);
  if (!istante) return null;
  const nascita = format.istanteUtc(creatoIl);
  const giorno = GIORNO_ROMA(istante);
  const ora = format.oraRoma(istante);
  return { ora, giorno: nascita && GIORNO_ROMA(nascita) !== giorno ? giorno.slice(0, 5) : '', completo: `${giorno} alle ${ora}` };
}

// "alle 09:47" o, se non è lo stesso giorno dell'ordine, "il 20/10 alle 09:47".
function quando(m) {
  if (!m) return '';
  return m.giorno ? `il ${m.giorno} alle ${m.ora}` : `alle ${m.ora}`;
}

const maiuscola = (testo) => testo.charAt(0).toUpperCase() + testo.slice(1);

// Quando la merce è partita: il momento del "Preparato" (in_evasione_il) o, negli ordini vecchi (stato `evaso`), evaso_il.
function partenza(o) {
  return o.evaso_il || o.in_evasione_il || null;
}

// "Partito alle 09:47 · ritiro alle 09:40": la riga di un ordine in consegna. Il ritiro è il tempo scritto dal corriere su WhatsApp (arriva dal banco), non
// l'arrivo dal cliente: quello al banco non si dice. Le parti che mancano non si scrivono.
function testoInConsegna(o) {
  const parti = [];
  const partito = momento(partenza(o), o.creato_il);
  if (partito) parti.push('Partito ' + quando(partito));
  const istanteRitiro = orariCorriere.ritiro(o);
  const ritiro = istanteRitiro ? momento(istanteRitiro, o.creato_il, { reale: true }) : null;
  if (ritiro) parti.push('ritiro ' + quando(ritiro));
  return parti.join(' · ') || 'La merce è in viaggio';
}

// Da quando è partita a quando il cliente ha confermato: "34 min", "1 h 05"; null se manca uno dei due momenti o l'ordine risulta consegnato prima di partire
// (la consegna provvisoria può segnare consegnato anche un ordine mai partito).
function tempoDiConsegna(o) {
  const da = format.istanteUtc(partenza(o));
  const a = format.istanteUtc(o.consegnato_il);
  if (!da || !a) return null;
  const minuti = Math.round((a.getTime() - da.getTime()) / 60000);
  if (minuti < 0) return null;
  return minuti < 1 ? 'meno di 1 min' : format.durataMinuti(minuti);
}

// "Il 19/10 alle 10:21 · confermato dal cliente": sotto "Consegnato" nella scheda dello stato.
function consegnatoTesto(o) {
  if (!o.consegnato_il) return 'Confermato dal cliente';
  return `Il ${format.giornoMeseRoma(o.consegnato_il)} alle ${format.oraSolaRoma(o.consegnato_il)} · confermato dal cliente`;
}

// "il 19/10 alle 09:28": quando l'ordine è arrivato, con la data (la testata di un ordine consegnato: non è più "oggi").
function ricevutoIl(o) {
  return `il ${format.giornoMeseRoma(o.creato_il)} alle ${format.oraSolaRoma(o.creato_il)}`;
}

// "Avanzamento": passi verticali, secondo lo stato dell'ordine (`stato`: 'da_preparare' | 'in_consegna' | 'consegnato', vedi storico_banco.statoStorico).
//  · da preparare: Confermato da te e Corriere trovato sono fatti, "Da preparare" (blu) è in corso, "In consegna" (dopo "Preparato") e
//    "Consegnato" (lo conferma il cliente) devono ancora venire;
//  · in consegna: anche "Partito" è fatto, "Consegnato" deve ancora venire;
//  · consegnato: tutto fatto, con le ore. Un "Partito" di cui non si sa il momento (consegna provvisoria su un ordine mai partito) non si scrive.
// Col modulo WhatsApp spento non c'è il passo del corriere (sarebbe falso).
//   `oraConferma`: quando il banco ha confermato; `corriere`: { nome, ora } di chi ha accettato (ora = quando ha accettato), o null se non c'è;
//   `oraRitiro`: quando il corriere arriva dal banco (il tempo scritto su WhatsApp, corriere.ritiro, "Ritiro alle HH:MM"); `partito`: { quando: momento | null };
//   `consegnato`: { quando: momento | null }.
function passiOrdine({ stato = 'da_preparare', oraConferma = '', corriere = null, oraRitiro = '', partito = null, consegnato = null } = {}) {
  const passi = [
    { chiave: 'conferma', fase: 'fatto', tono: 'verde', titolo: 'Confermato da te', testo: oraConferma && oraConferma !== '—' ? `Alle ${oraConferma}` : 'Fatto' },
  ];
  if (corriere) {
    const nome = corriere.nome || '';
    const ora = corriere.ora && corriere.ora !== '—' ? corriere.ora : '';
    let testo;
    if (nome && ora) testo = `${nome} ha accettato alle ${ora}`;
    else if (nome) testo = `${nome} ha accettato`;
    else if (ora) testo = `Un corriere ha accettato alle ${ora}`;
    else testo = 'Un corriere ha accettato';
    passi.push({ chiave: 'corriere', fase: 'fatto', tono: 'verde', titolo: 'Corriere trovato', testo });
  }
  if (stato === 'da_preparare') {
    passi.push(
      { chiave: 'preparare', fase: 'corrente', tono: 'blu', titolo: 'Da preparare', testo: oraRitiro && oraRitiro !== '—' ? `Ritiro alle ${oraRitiro}` : 'Prepara la merce' },
      { chiave: 'consegna', fase: 'futuro', tono: 'verde', titolo: 'In consegna', testo: 'La merce passa al corriere' },
      { chiave: 'consegnato', fase: 'futuro', tono: 'verde', titolo: 'Consegnato', testo: 'Lo conferma il cliente' }
    );
    return passi;
  }

  const quandoPartito = partito && partito.quando ? quando(partito.quando) : '';
  if (stato === 'in_consegna') {
    passi.push(
      { chiave: 'partito', fase: 'fatto', tono: 'verde', titolo: 'Partito', testo: quandoPartito ? maiuscola(quandoPartito) : 'Fatto' },
      { chiave: 'consegnato', fase: 'futuro', tono: 'verde', titolo: 'Consegnato', testo: 'Lo conferma il cliente' }
    );
    return passi;
  }

  // consegnato
  if (quandoPartito) passi.push({ chiave: 'partito', fase: 'fatto', tono: 'verde', titolo: 'Partito', testo: maiuscola(quandoPartito) });
  const quandoConsegnato = consegnato && consegnato.quando ? quando(consegnato.quando) : '';
  passi.push({ chiave: 'consegnato', fase: 'fatto', tono: 'verde', titolo: 'Consegnato', testo: quandoConsegnato ? `Confermato dal cliente ${quandoConsegnato}` : 'Confermato dal cliente' });
  return passi;
}

module.exports = {
  righeMateriale,
  indirizzoDiviso,
  descrizioneConsegna,
  sottotitoloCliente,
  passiOrdine,
  momento,
  quando,
  partenza,
  testoInConsegna,
  tempoDiConsegna,
  consegnatoTesto,
  ricevutoIl,
};
