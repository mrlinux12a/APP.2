// Barra del titolo in alto, uguale in tutte le schermate.
//
// Prima il Carrello (una scheda) usava la barra di react-navigation disegnata in JavaScript,
// mentre Catalogo, categorie e Stato ordini (pile di schermate) usavano la barra nativa del
// telefono: sul telefono le due non avevano la stessa altezza, e cambiare il carattere del
// titolo non cambiava niente. Ora la usano tutte, con le misure della vecchia barra del Carrello:
// 44 su iOS e 64 su Android, più la fascia della barra di stato.
import type { ReactNode } from 'react';
import { PixelRatio, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { STILE_TITOLO, useTema } from '../tema';

const FRECCIA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

// Come getDefaultHeaderHeight di react-navigation: sugli iPhone con Dynamic Island la fascia
// della barra di stato è più bassa dell'area sicura, e il contenuto ne guadagna.
function altezzaTotale(sopra: number) {
  const base = Platform.OS === 'ios' ? 44 : 64;
  const fascia = Platform.OS === 'ios' && sopra > 50 ? sopra - (5 + 1 / PixelRatio.get()) : sopra;
  return base + fascia;
}

export function BarraTitolo({ titolo, destra, indietro }: { titolo: string; destra?: ReactNode; indietro?: () => void }) {
  const { c } = useTema();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Il titolo non deve finire fuori schermo né sopra i pulsanti.
  const larghezzaMassima = width - ((indietro ? 32 : 16) + (destra ? 16 : 0) + Math.max(insets.left, insets.right)) * 2;

  return (
    <View style={{ height: altezzaTotale(insets.top), backgroundColor: c.superficie }}>
      <View style={{ height: insets.top }} />
      <View style={stili.contenuto}>
        <View style={[stili.lato, stili.inizio, { marginStart: insets.left }]}>
          {indietro ? (
            <Pressable
              onPress={indietro}
              accessibilityRole="button"
              accessibilityLabel="Indietro"
              hitSlop={8}
              style={stili.indietro}
            >
              <SvgXml xml={FRECCIA} width={24} height={24} color={c.accento} />
            </Pressable>
          ) : null}
        </View>
        <View style={[stili.titolo, { maxWidth: larghezzaMassima }]}>
          <Text numberOfLines={1} accessibilityRole="header" style={STILE_TITOLO}>
            {titolo}
          </Text>
        </View>
        <View style={[stili.lato, stili.fine, { marginEnd: insets.right }]}>{destra}</View>
      </View>
    </View>
  );
}

// Quello che serve alle opzioni `header` di una pila e delle schede: il titolo, se si può
// tornare indietro e il pulsante a destra già scritto nelle opzioni della schermata.
type PropsIntestazione = {
  navigation: { goBack: () => void };
  route: { name: string };
  options: { title?: string; headerRight?: (props: { canGoBack: boolean }) => ReactNode };
  back?: unknown;
};

export function intestazione({ navigation, route, options, back }: PropsIntestazione) {
  return (
    <BarraTitolo
      titolo={options.title ?? route.name}
      indietro={back ? () => navigation.goBack() : undefined}
      destra={options.headerRight ? options.headerRight({ canGoBack: !!back }) : undefined}
    />
  );
}

const stili = StyleSheet.create({
  contenuto: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  // I due lati occupano lo stesso spazio: così il titolo resta al centro anche se a destra
  // c'è più roba che a sinistra.
  lato: { flexDirection: 'row', alignItems: 'center', flexGrow: 1, flexBasis: 0 },
  inizio: { justifyContent: 'flex-start' },
  fine: { justifyContent: 'flex-end' },
  titolo: { justifyContent: 'center', marginHorizontal: 16 },
  indietro: { paddingHorizontal: 8, paddingVertical: 8, marginStart: 4 },
});
