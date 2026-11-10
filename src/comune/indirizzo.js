// L'indirizzo di consegna a campi separati (via, numero civico, interno, CAP, città), come lo chiedono il carrello del sito e quello dell'app.
// Senza database: serve alle rotte che ricevono l'invio (sito e API dell'app) e alle prove. Il testo che ne esce ("Via Puggia 22 int. 3, 16141 Genova (GE)")
// è quello che da sempre si salva in `requests.destinazione` e che leggono banco, corriere e messaggi: nessuna colonna nuova.

// Lunghezze massime di ogni campo (la destinazione intera si taglia a 300 caratteri in flusso_cliente).
const MAX_VIA = 120;
const MAX_CIVICO = 12;
const MAX_INTERNO = 12;
const MAX_CITTA = 80;

// Ripulisce un campo: testo, spazi doppi tolti, niente a capo (finirebbero nel messaggio ai corrieri), al massimo `max` caratteri.
function pulisci(valore, max) {
  return String(valore === undefined || valore === null ? '' : valore).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Legge i cinque campi da un oggetto (corpo del modulo del sito o dell'app): `indirizzo` = la via, `civico`, `interno`, `cap`, `citta`.
function leggiCampi(corpo) {
  const c = corpo || {};
  return {
    indirizzo: pulisci(c.indirizzo, MAX_VIA),
    civico: pulisci(c.civico, MAX_CIVICO),
    interno: pulisci(c.interno, MAX_INTERNO),
    cap: pulisci(c.cap, 5),
    citta: pulisci(c.citta, MAX_CITTA),
  };
}

// L'invio usa i campi separati? Vale se almeno uno è presente: un vecchio client (solo `destinazione`) continua a funzionare come prima.
function haCampi(corpo) {
  const c = corpo || {};
  return ['indirizzo', 'civico', 'interno', 'cap', 'citta'].some((k) => c[k] !== undefined && c[k] !== null);
}

// Cosa manca o non va: elenco dei campi sbagliati ([] = tutto a posto). Servono tutti e cinque (anche l'interno, richiesta del 10/11/2026).
// Il CAP italiano ha cinque cifre.
function campiMancanti(campi) {
  const mancanti = [];
  if (!campi.indirizzo) mancanti.push('indirizzo');
  if (!campi.civico) mancanti.push('civico');
  if (!campi.interno) mancanti.push('interno');
  if (!/^\d{5}$/.test(campi.cap)) mancanti.push('cap');
  if (!campi.citta) mancanti.push('citta');
  return mancanti;
}

// I campi in una riga sola: "Via Puggia 22 int. 3, 16141 Genova (GE)". Senza interno non si scrive "int.".
function componi(campi) {
  const via = [campi.indirizzo, campi.civico].filter(Boolean).join(' ') + (campi.interno ? ' int. ' + campi.interno : '');
  return [via, [campi.cap, campi.citta].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

module.exports = { leggiCampi, haCampi, campiMancanti, componi, MAX_VIA, MAX_CIVICO, MAX_INTERNO, MAX_CITTA };
