// Stessi colori del sito (variabili in cima a public/style.css): "Cantiere Notte" scuro
// con accento ambra di default, modalità chiara con accento blu petrolio.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const scuro = {
  accento: '#f2a71b',
  accentoScuro: '#c9860a',
  accentoChiaro: '#2b2313',
  suAccento: '#12181f',
  verde: '#5fbf63',
  verdeChiaro: '#17261a',
  arancio: '#ff7a52',
  arancioChiaro: '#2c1a14',
  rosso: '#ff6b6b',
  rossoChiaro: '#2c1616',
  grigio: '#93a2ad',
  sfondo: '#12181f',
  superficie: '#1a222b',
  bordo: '#2a3540',
  testo: '#eef2f5',
  account: '#4fc3bf',
  iconaNav: '#ffffff',
  navAttivo: '#ffffff',
  barrato: '#6f7c86',
};

export type Colori = typeof scuro;

const chiaro: Colori = {
  accento: '#245a8f',
  accentoScuro: '#1a4468',
  accentoChiaro: '#e3edf7',
  suAccento: '#ffffff',
  verde: '#2f8f45',
  verdeChiaro: '#e3f3e6',
  arancio: '#d9622e',
  arancioChiaro: '#fbe6da',
  rosso: '#c23b3b',
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

type NomeTema = 'scuro' | 'chiaro';

type ValoreTema = { nome: NomeTema; c: Colori; cambia: () => void };

const ContestoTema = createContext<ValoreTema>({ nome: 'scuro', c: scuro, cambia: () => {} });

// Come sul sito: scuro di default, "chiaro" solo se scelto esplicitamente (e ricordato).
export function TemaProvider({ children }: { children: ReactNode }) {
  const [nome, setNome] = useState<NomeTema>('scuro');

  useEffect(() => {
    AsyncStorage.getItem('tema')
      .then((salvato) => {
        if (salvato === 'chiaro') setNome('chiaro');
      })
      .catch(() => {});
  }, []);

  const valore = useMemo<ValoreTema>(
    () => ({
      nome,
      c: nome === 'chiaro' ? chiaro : scuro,
      cambia: () => {
        const nuovo = nome === 'chiaro' ? 'scuro' : 'chiaro';
        setNome(nuovo);
        AsyncStorage.setItem('tema', nuovo).catch(() => {});
      },
    }),
    [nome]
  );

  return <ContestoTema.Provider value={valore}>{children}</ContestoTema.Provider>;
}

export function useTema() {
  return useContext(ContestoTema);
}
