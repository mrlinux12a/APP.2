// Stessi colori della modalità chiara del sito (variabili in cima a public/style.css), con
// accento blu petrolio. L'app ha solo il tema chiaro, per scelta esplicita: niente modalità
// scura e niente interruttore.
const chiaro = {
  accento: '#245a8f',
  accentoScuro: '#1a4468',
  accentoChiaro: '#e3edf7',
  suAccento: '#ffffff',
  // Verde, arancio e rosso sono scuriti quel tanto che serve a portare il testo sul proprio
  // badge a 4.5:1 (prima 3.55, 3.04 e 4.34): sono i colori di "Disponibile", "In esaurimento" e
  // "Non disponibile". Stessi valori del tema chiaro di public/style.css.
  verde: '#297c3c',
  verdeChiaro: '#e3f3e6',
  arancio: '#ab4d24',
  arancioChiaro: '#fbe6da',
  rosso: '#bd3a3a',
  rossoChiaro: '#fbe4e2',
  grigio: '#6b6a5f',
  sfondo: '#f3f1ec',
  superficie: '#ffffff',
  bordo: '#e2ded3',
  testo: '#232019',
  account: '#0f9d93',
  iconaNav: '#000000',
  navAttivo: '#245a8f',
  barrato: '#a7aeb8',
};

export type Colori = typeof chiaro;

export const FONT = {
  // Nome dei prodotti: come .prodotto .nome sul sito (Sora 600).
  nome: 'Sora_600SemiBold',
  titolo: 'Sora_700Bold',
  titoloForte: 'Sora_800ExtraBold',
  testo: 'SourceSans3_400Regular',
  testoMedio: 'SourceSans3_600SemiBold',
  testoForte: 'SourceSans3_700Bold',
};

export const RAGGIO = 14;

// Titolo delle barre in alto: come .appbar .titolo del sito (Sora 700, 1.05rem ≈ 17px).
// Senza una dimensione esplicita Android usa 20 e la barra risulta più grossa di quella web.
export const STILE_TITOLO = { fontFamily: FONT.titolo, fontSize: 17, color: chiaro.testo };

const VALORE = { c: chiaro };

// Resta un hook (come quando c'era anche il tema scuro) per non toccare ogni schermata.
export function useTema() {
  return VALORE;
}
