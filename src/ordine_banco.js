// Pagina dell'ordine vista dal banco (GET /distributore/ordini/:id, views/distributore_ordine.ejs): le righe del materiale col PREZZO DEL BANCO e la
// spunta "preso", i passi di "Avanzamento", l'indirizzo di consegna e i valori predefiniti della bolla. Solo presentazione, niente DB: la route legge,
// la vista disegna.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Le scelte della bolla (DDT). Gli stessi testi che il documento stampa (views/ddt.ejs).
const ASPETTI = ['Colli', 'Bancali', 'Scatole', 'Sfuso'];
const CAUSALI = ['Vendita', 'Conto visione', 'Reso', 'Conto lavorazione'];

// "Trasporto a cura di": con un corriere è il vettore; senza, come prima: il banco con il suo mezzo (mittente) o il cliente che ritira (destinatario).
function trasportoPredefinito({ conCorriere, modalita }) {
  if (conCorriere) return 'vettore';
  return modalita === 'ritiro' ? 'destinatario' : 'mittente';
}

// Le righe del materiale, a prezzo del banco: prezzo cad. = prezzo netto + RAEE unitario, totale di riga = subtotale + RAEE di riga (MAI il prezzo
// col servizio: quello lo paga il cliente in app). `preso`: la spunta salvata (order_items.preso_il). `mancanti` (richieste.calcolaOfferta) porta le
// righe confermate a metà: "richiesti N, ne hai confermati M"; si abbinano per codice. Gli articoli confermati a zero non sono righe dell'ordine:
// vanno in `fuori`, per non perderli di vista.
// Ritorna { righe, presi, tutti, fuori }: `tutti` = non c'è niente da spuntare o è già tutto spuntato.
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
      preso: !!r.preso_il,
      richiesti: m ? Number(m.quantita_richiesta) : null,
      confermati: m ? Number(m.quantita_disponibile) : null,
    };
  });
  const presenti = new Set(lista.map((r) => String(r.codice)));
  const presi = lista.filter((r) => r.preso).length;
  return {
    righe: lista,
    presi,
    tutti: presi === lista.length,
    fuori: (mancanti || []).filter((m) => !presenti.has(String(m.codice))),
  };
}

// "Via Castel Morrone 1/7r, 16161 Genova (GE)" -> via in grassetto e, sotto, CAP e città. La via è ciò che sta prima della prima virgola.
function indirizzoDiviso(testo) {
  const t = String(testo || '').trim();
  const i = t.indexOf(',');
  return i === -1 ? { via: t, resto: '' } : { via: t.slice(0, i).trim(), resto: t.slice(i + 1).trim() };
}

function linkMaps(indirizzo) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(indirizzo || '').trim());
}

// La riga col furgone della scheda "Consegna".
function descrizioneConsegna({ modalita, conCorriere, corriereNome }) {
  if (modalita === 'ritiro') return 'Ritiro al banco da parte del cliente';
  if (conCorriere) return `Corriere${corriereNome ? ' ' + corriereNome : ''} · ritiro al banco`;
  return 'Consegna con mezzo del banco';
}

// "referente Mario · P. IVA 0123…": le parti che mancano non si scrivono.
function sottotitoloCliente(cliente) {
  const parti = [];
  if (cliente.referente) parti.push('referente ' + cliente.referente);
  if (cliente.partita_iva) parti.push('P. IVA ' + cliente.partita_iva);
  return parti.join(' · ');
}

// "Avanzamento": passi verticali. La pagina c'è solo per un ordine "Da preparare" (vedi la route), quindi il passo attuale è sempre quello: Confermato da te e
// Corriere trovato sono fatti, "Da preparare" (blu) è in corso, "In consegna" (dopo "Preparato" o la bolla) e "Consegnato" (lo conferma il cliente) devono ancora
// venire. Col modulo WhatsApp spento non c'è il passo del corriere (sarebbe falso).
//   `oraConferma`: quando il banco ha confermato; `corriere`: { nome, ora } di chi ha accettato (ora = quando ha accettato), o null se non c'è;
//   `oraRitiro`: l'orario del corriere (orders.corriere_arrivo_il, "Ritiro alle HH:MM").
function passiOrdine({ oraConferma = '', corriere = null, oraRitiro = '' } = {}) {
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
  passi.push(
    { chiave: 'preparare', fase: 'corrente', tono: 'blu', titolo: 'Da preparare', testo: oraRitiro && oraRitiro !== '—' ? `Ritiro alle ${oraRitiro}` : 'Prepara la merce e la bolla' },
    { chiave: 'consegna', fase: 'futuro', tono: 'verde', titolo: 'In consegna', testo: 'La merce passa al corriere' },
    { chiave: 'consegnato', fase: 'futuro', tono: 'verde', titolo: 'Consegnato', testo: 'Lo conferma il cliente' }
  );
  return passi;
}

module.exports = { ASPETTI, CAUSALI, trasportoPredefinito, righeMateriale, indirizzoDiviso, linkMaps, descrizioneConsegna, sottotitoloCliente, passiOrdine };
