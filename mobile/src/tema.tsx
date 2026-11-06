import { createContext, useContext, type ReactNode } from 'react';

// Stessi colori della modalità chiara del sito (variabili in cima a assets/css), con
// accento blu petrolio. L'app ha solo il tema chiaro, per scelta esplicita: niente modalità
// scura e niente interruttore.
const chiaro = {
  accento: '#245a8f',
  accentoScuro: '#1a4468',
  accentoChiaro: '#e3edf7',
  suAccento: '#ffffff',
  // Verde, arancio e rosso sono scuriti quel tanto che serve a portare il testo sul proprio
  // badge a 4.5:1 (prima 3.55, 3.04 e 4.34): sono i colori di "Disponibile", "In esaurimento" e
  // "Non disponibile". Stessi valori del tema chiaro di assets/css.
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

// ---------- Tema dell'accesso: un accento per tipo di account ----------

// Chi si presenta all'app: l'installatore (blu) o il corriere (giallo). Le schermate di accesso e di registrazione sono IDENTICHE per i due: cambiano solo
// questi colori e i testi (docs/app-corrieri.md). Tutto il resto (sfondo, campi, bordi, grigi, font, misure) è quello di `chiaro`.
export type ProfiloAccesso = 'installatore' | 'corriere';

export type TemaAccesso = {
  accento: string; // sfondo dell'icona in testata, pulsante principale, bordo del campo attivo
  accentoScuro: string; // pulsante premuto
  accentoChiaro: string; // alone (3 px) del campo attivo, riquadri d'avviso
  suAccento: string; // testo e icone SOPRA l'accento (il bianco su un giallo non si legge)
  testoAccento: string; // link e occhiello nel colore dell'accento, leggibili sullo sfondo beige (il giallo puro non lo è)
  ombra: { colore: string; opacita: number }; // ombra dell'icona in testata
  iconaSelettore: string; // colore dell'icona della voce attiva del selettore
};

export const TEMI_ACCESSO: Record<ProfiloAccesso, TemaAccesso> = {
  installatore: {
    accento: chiaro.accento,
    accentoScuro: chiaro.accentoScuro,
    accentoChiaro: chiaro.accentoChiaro,
    suAccento: chiaro.suAccento,
    testoAccento: chiaro.accento,
    ombra: { colore: '#245a8f', opacita: 0.28 },
    iconaSelettore: chiaro.accento,
  },
  corriere: {
    accento: '#ffcc00',
    accentoScuro: '#e6b800',
    accentoChiaro: '#fff4cc',
    suAccento: '#1c1917',
    testoAccento: '#7a5c00',
    ombra: { colore: '#cca300', opacita: 0.35 },
    iconaSelettore: '#c99a00',
  },
};

// Le schermate di accesso mettono il loro tema qui sotto, e i pezzi comuni (`Campo`, `PulsanteAcc`...) lo leggono: senza un tema scelto vale quello
// dell'installatore, quindi il resto dell'app (profilo, cambio password) resta com'è.
const ContestoTemaAccesso = createContext<TemaAccesso>(TEMI_ACCESSO.installatore);

export function TemaAccessoProvider({ profilo, children }: { profilo: ProfiloAccesso; children: ReactNode }) {
  return <ContestoTemaAccesso.Provider value={TEMI_ACCESSO[profilo]}>{children}</ContestoTemaAccesso.Provider>;
}

export function useTemaAccesso(): TemaAccesso {
  return useContext(ContestoTemaAccesso);
}
