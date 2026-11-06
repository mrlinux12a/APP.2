// Colori, font e misure delle schermate di lavoro del corriere (docs/app-corrieri.md). Sono volutamente separati dal tema dell'installatore (src/tema.tsx): fondo
// beige chiaro, schede bianche con un bordo sottile, giallo Flash Delivery per le azioni e font Manrope. L'accesso e la registrazione del corriere restano quelli
// comuni (TEMI_ACCESSO.corriere in src/tema.tsx), con lo stesso giallo.
export const COL = {
  sfondo: '#F3F2EE',
  scheda: '#FFFFFF',
  bordo: '#E3E1DA',
  testo: '#16181C',
  grigio: '#5F636B',
  giallo: '#FFCC00',
  gialloPremuto: '#E6B800',
  gialloChiaro: '#FFF4CC',
  // Il giallo scuro che si legge come testo o icona su uno sfondo chiaro (il giallo puro no).
  gialloTesto: '#7A5C00',
  // Verde, arancio e rosso: gli stessi del resto dell'app (testo a 4.5:1 sul proprio sfondo chiaro).
  verde: '#297C3C',
  verdeChiaro: '#E3F3E6',
  arancio: '#AB4D24',
  arancioChiaro: '#FBE6DA',
  rosso: '#BD3A3A',
  rossoChiaro: '#FBE4E2',
  interruttoreSpento: '#D5D3CB',
};

// Manrope (i pesi sono caricati nel layout principale, src/app/_layout.tsx).
export const FC = {
  medio: 'Manrope_500Medium',
  semi: 'Manrope_600SemiBold',
  forte: 'Manrope_700Bold',
  extra: 'Manrope_800ExtraBold',
};

// Raggio delle schede e altezza dei pulsanti grandi.
export const RAGGIO = 18;
export const ALTEZZA_PULSANTE = 56;
