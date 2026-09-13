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
  '<svg viewBox="0 0 24 24" width="1.22em" height="1.22em" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
  'style="vertical-align:-0.2em" aria-hidden="true">' +
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

// Icone di navigazione del venditore: stesso trattamento (stroke, 1em, currentColor) delle
// tre sopra, così ereditano dal CSS gli stessi colori del menu installatore (--icona-nav a
// riposo, colore attivo del tema) invece di restare fisse come le emoji 🏠/👥 di prima.
const iconaHome = svg(
  '<path d="M4 11.5 12 4l8 7.5"/>' +
  '<path d="M6 10.5V20a1 1 0 0 0 1 1h3v-5.5h4V21h3a1 1 0 0 0 1-1v-9.5"/>'
);

const iconaClienti = svg(
  '<circle cx="8.5" cy="8.2" r="3"/><path d="M2.8 19.8c.7-3.5 3-5.3 5.7-5.3s5 1.8 5.7 5.3"/>' +
  '<circle cx="17" cy="8.8" r="2.3"/><path d="M15.2 14.7c2.3.3 3.9 2 4.5 5"/>'
);

// Campanella notifiche: sostituisce 🔔 nell'appbar, comune a installatore e venditore.
const iconaNotifiche = svg(
  '<path d="M6 10.5a6 6 0 0 1 12 0c0 3.8 1.4 5.3 1.4 5.3H4.6S6 14.3 6 10.5Z"/>' +
  '<path d="M10 19.3a2 2 0 0 0 4 0"/>'
);

// Icone delle righe di anagrafica/contatto, riusate sia nel profilo installatore sia nella
// scheda cliente del venditore (stesso partial partials/anagrafica_cliente.ejs).
const iconaPosizione = svg(
  '<path d="M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.2"/>'
);

const iconaAzienda = svg(
  '<rect x="4.5" y="3" width="11" height="18" rx="1"/>' +
  '<path d="M8 7.2h1M8 11h1M8 14.8h1M12.5 7.2h1M12.5 11h1M12.5 14.8h1"/>' +
  '<path d="M15.5 21v-4.5h4V21"/>'
);

const iconaFiscale = svg(
  '<path d="M6.5 3h11v18l-2.3-1.4L13 21l-2.3-1.4L8.5 21l-2-1.4Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>'
);

const iconaDestinazione = svg('<path d="M6 3v18"/><path d="M6 4.2h11l-2.4 3.3L17 10.8H6"/>');

const iconaTelefono = svg(
  '<path d="M6.2 3.2h3l1.4 3.8-2 1.5a12 12 0 0 0 5.9 5.9l1.5-2 3.8 1.4v3a2 2 0 0 1-2 2C10.9 18.8 5.2 13.1 4.2 5.2a2 2 0 0 1 2-2Z"/>'
);

const iconaOrario = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>');

const iconaPersona = svg(
  '<circle cx="12" cy="8" r="3.4"/><path d="M5 19c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/>'
);

const iconaNegozio = svg(
  '<path d="M4 4h16l1.4 4.8a2.4 2.4 0 0 1-4.4 1.4 2.4 2.4 0 0 1-4.5 0 2.4 2.4 0 0 1-4.5 0A2.4 2.4 0 0 1 3.5 9L4 4Z"/>' +
  '<path d="M5 10.6V20h14v-9.4"/><path d="M9.8 20v-5h4.4v5"/>'
);

// Ordine e consegna.
const iconaConsegna = svg(
  '<rect x="2.5" y="8" width="10.5" height="8" rx="1"/><path d="M13 11h3.2l3.3 3v2H19"/>' +
  '<circle cx="7" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>'
);

const iconaNota = svg(
  '<path d="M4.2 19.8 5 16l10.5-10.5a1.6 1.6 0 0 1 2.2 0l.8.8a1.6 1.6 0 0 1 0 2.2L8 19l-3.8.8Z"/>' +
  '<path d="M13.6 7l3.4 3.4"/>'
);

const iconaMappa = svg('<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>');

const iconaPagamento = svg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/>');

// Catalogo e marchi.
const iconaMarchio = svg(
  '<path d="M12.3 3.5H20v7.7L11 20.5a1.5 1.5 0 0 1-2.1 0l-6.4-6.4a1.5 1.5 0 0 1 0-2.1L12.3 3.5Z"/>' +
  '<circle cx="16.2" cy="7.4" r="1.4"/>'
);

const iconaFamiglia = svg(
  '<path d="M3.5 7a1 1 0 0 1 1-1h4.6l2 2.1h8.4a1 1 0 0 1 1 1v9.4a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/>'
);

const iconaListino = svg(
  '<path d="M12 6.3c-1.8-1.3-4-1.9-6.5-1.9v13c2.5 0 4.7.6 6.5 1.9 1.8-1.3 4-1.9 6.5-1.9v-13c-2.5 0-4.7.6-6.5 1.9Z"/>' +
  '<path d="M12 6.3v13"/>'
);

// Badge di stato (solo banco venditore).
const iconaNuovo = svg('<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/>');

// Stesso disegno della categoria "Fissaggi e utensili": è già la chiave inglese del set.
const iconaLavorazione = ICONE['fissaggi-e-utensili'];

const iconaRifiutato = svg('<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>');

const iconaDocumento = svg(
  '<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v4h4"/><path d="M9.5 12h5M9.5 15.3h5"/>'
);

// Stati vuoti: stesso stile, dimensionati più grandi da CSS (.vuoto .emoji) al posto
// dell'emoji isolata.
const iconaVuotoOk = svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.4 2.4 4.8-5"/>');

const iconaVuotoRicerca = svg(
  '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2l5 5"/><path d="M8 10.5h5"/>'
);

const iconaVuotoScatola = svg(
  '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M3 8.5V14.5M21 8.5V14.5"/>' +
  '<path d="M7 12.3v3.4M17 12.3v3.4"/>'
);

const iconaVuotoNotifiche = svg(
  '<path d="M6.2 10.3a6 6 0 0 1 9.3-5"/><path d="M18 10.5c0 3.8 1.4 5.3 1.4 5.3H8"/>' +
  '<path d="M10 19.3a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>'
);

// Avviso: sostituisce ⚠️ nel confronto offerte del cliente.
const iconaAvviso = svg(
  '<path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 9.5v4.2"/><path d="M12 17h.01"/>'
);

// Chiudi/rimuovi: X semplice per i pulsanti di dismissione (es. togliere una card dalla home).
const iconaChiudi = svg('<path d="M6 6l12 12M18 6 6 18"/>');

module.exports = {
  iconaCategoria,
  iconaLente,
  iconaCatalogo,
  iconaCarrello,
  iconaOrdini,
  iconaHome,
  iconaClienti,
  iconaNotifiche,
  iconaPosizione,
  iconaAzienda,
  iconaFiscale,
  iconaDestinazione,
  iconaTelefono,
  iconaOrario,
  iconaPersona,
  iconaNegozio,
  iconaConsegna,
  iconaNota,
  iconaMappa,
  iconaPagamento,
  iconaMarchio,
  iconaFamiglia,
  iconaListino,
  iconaNuovo,
  iconaLavorazione,
  iconaRifiutato,
  iconaDocumento,
  iconaVuotoOk,
  iconaVuotoRicerca,
  iconaVuotoScatola,
  iconaVuotoNotifiche,
  iconaAvviso,
  iconaChiudi,
};
