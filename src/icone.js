// Icone delle categorie merceologiche: line-icon 24x24, un solo colore (currentColor),
// dimensionate a 1em così ereditano il font-size già impostato nel CSS per ogni contesto
// (riga di lista, tessera in evidenza, riga sconti) senza bisogno di regole nuove.
// Sostituiscono le emoji: leggibili anche molto piccole, coerenti con un tono professionale.

function svg(path) {
  return (
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="vertical-align:-0.15em" aria-hidden="true">' + path + '</svg>'
  );
}

const ICONE = {
  // Riscaldamento e Caldaie — radiatore
  'riscaldamento-e-caldaie': svg(
    '<rect x="4" y="6" width="16" height="13" rx="1"/>' +
    '<path d="M8 6V4M12 6V4M16 6V4"/><path d="M8 19v1M12 19v1M16 19v1"/>'
  ),
  // Condizionamento e Climatizzazione — unità split a parete
  'condizionamento-e-climatizzazione': svg(
    '<rect x="3" y="6" width="18" height="7" rx="2"/>' +
    '<path d="M6 13v2M10 13v3M14 13v2M18 13v3"/>' +
    '<path d="M7 9h6"/>'
  ),
  // Ricambi e Accessori — ingranaggio
  'ricambi-e-accessori': svg(
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3' +
    'M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4 5.6 5.6"/>'
  ),
  // Acqua Calda Sanitaria — scaldabagno (cilindro) con goccia
  'acqua-calda-sanitaria': svg(
    '<rect x="6" y="3" width="9" height="16" rx="4"/>' +
    '<path d="M18.5 13c1.4 1.7 1.4 3.3 0 5-1.4-1.7-1.4-3.3 0-5Z"/>'
  ),
  // Generico — scatola
  generico: svg(
    '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/>' +
    '<path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/>'
  ),
  // Raccorderia e Valvole — valvola a saracinesca
  'raccorderia-e-valvole': svg(
    '<circle cx="12" cy="15" r="3.2"/>' +
    '<path d="M12 3v3.2M9.5 12.8 7 10.3M14.5 12.8 17 10.3"/>' +
    '<path d="M6 8h3M15 8h3"/>'
  ),
  // Ventilazione e Trattamento Aria — ventola
  'ventilazione-e-trattamento-aria': svg(
    '<circle cx="12" cy="12" r="1.6"/>' +
    '<path d="M12 10.4c0-3 1.6-5.4 4-5.4 1.7 0 2.6 1.4 1.6 3.1-1 1.7-3.3 2.3-5.6 2.3Z"/>' +
    '<path d="M13.4 12.9c2.7 1.3 4.2 3.5 3.3 5.6-.7 1.6-2.6 1.6-3.5-.1-.9-1.6-.9-3.9.2-5.5Z"/>' +
    '<path d="M10.6 13.1c-2.7 1.2-4.3 3.4-3.4 5.5.7 1.6 2.6 1.6 3.5-.1.9-1.6.9-3.8-.1-5.4Z"/>'
  ),
  // Bagno e Sanitari — vasca
  'bagno-e-sanitari': svg(
    '<path d="M4 12h16v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-2Z"/>' +
    '<path d="M4 12V9a2 2 0 0 1 2-2c1 0 1.6.6 1.8 1.4"/>' +
    '<path d="M3 18v1M19 18v1"/>'
  ),
  // Fissaggi e Utensili — chiave inglese
  'fissaggi-e-utensili': svg(
    '<path d="M14.7 6.3a3.5 3.5 0 0 0-4.6 4.6L4 17l3 3 6.1-6.1a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2Z"/>'
  ),
  // Tubazioni e Sistemi di Distribuzione — gomito di tubo
  'tubazioni-e-sistemi-di-distribuzione': svg(
    '<path d="M5 4h5a6 6 0 0 1 6 6v9"/>' +
    '<path d="M5 4v5M10 4v5" /><path d="M13 19h5M13 15h5"/>'
  ),
  // Elettrico e Fotovoltaico — pannello solare
  'elettrico-e-fotovoltaico': svg(
    '<path d="M3 9 12 4l9 5-2 11H5L3 9Z"/>' +
    '<path d="M6.5 9h11M7.5 14h9M9 9l-1 11M15 9l1 11M12 9v11"/>'
  ),
  // Trattamento Acqua — goccia con filtro
  'trattamento-acqua': svg(
    '<path d="M12 3.5c3 4 5.5 7.6 5.5 10.7a5.5 5.5 0 1 1-11 0C6.5 11.1 9 7.5 12 3.5Z"/>' +
    '<path d="M9.2 14.2h5.6"/>'
  ),
  // Scarico e Fognatura — chiusino di scarico
  'scarico-e-fognatura': svg(
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M12 6v3M12 15v3M6 12h3M15 12h3M8 8l2 2M14 14l2 2M16 8l-2 2M10 14l-2 2"/>'
  ),
};

const FALLBACK = ICONE.generico;

function iconaCategoria(slug) {
  return ICONE[slug] || FALLBACK;
}

// Icone di ricerca e barra di navigazione: stesso stile, colore fisso per tema
// (ambra in scuro, nera in chiaro) gestito in CSS via --icona-nav.
const iconaLente = (
  '<svg viewBox="0 0 24 24" width="1.12em" height="1.12em" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'style="vertical-align:-0.17em" aria-hidden="true">' +
  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2l5 5"/>' +
  '</svg>'
);

const iconaCatalogo = svg(
  '<path d="M4 5.5c2-1 4.5-1 8 0v13c-3.5-1-6-1-8 0V5.5Z"/>' +
  '<path d="M20 5.5c-2-1-4.5-1-8 0v13c3.5-1 6-1 8 0V5.5Z"/>'
);

const iconaCarrello = svg(
  '<circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>' +
  '<path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20.5 8H6"/>'
);

const iconaOrdini = svg(
  '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/>' +
  '<path d="M3 8.5V16l9 4.5 9-4.5V8.5"/><path d="M12 13v7.5"/>'
);

module.exports = { iconaCategoria, iconaLente, iconaCatalogo, iconaCarrello, iconaOrdini };
