import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { usePezziNelCarrello } from '../carrello';
import { FONT, useTema } from '../tema';

// Come `.barra-vai` del sito: un pulsante blu in fondo agli elenchi, "N pezzi" a sinistra e la pillola bianca "Vai al carrello →" a destra. Compare solo con almeno
// un pezzo nel carrello. Lo spazio da lasciare in fondo all'elenco (altezza + distanza dal bordo + aria) è SPAZIO_BARRA_VAI, come `--altezza-barra-vai` del sito.
const ALTEZZA = 52;
export const SPAZIO_BARRA_VAI = ALTEZZA + 10 + 16;

const FRECCIA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export function BarraVai() {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();
  if (pezzi <= 0) return null;

  return (
    // Il contenitore non intercetta i tocchi: solo il pulsante.
    <View pointerEvents="box-none" style={stili.contenitore}>
      <Pressable
        onPress={() => router.navigate('/carrello')}
        accessibilityRole="link"
        accessibilityLabel={`${pezzi} ${pezzi === 1 ? 'pezzo' : 'pezzi'} nel carrello. Vai al carrello`}
        style={({ pressed }) => [stili.link, { backgroundColor: pressed ? c.accentoScuro : c.accento }]}
      >
        <Text style={[stili.pezzi, { color: c.suAccento }]}>
          {pezzi} {pezzi === 1 ? 'pezzo' : 'pezzi'}
        </Text>
        <View style={[stili.pillola, { backgroundColor: c.superficie }]}>
          <Text style={[stili.pillolaTesto, { color: c.accento }]}>Vai al carrello</Text>
          <SvgXml xml={FRECCIA} width={18} height={18} color={c.accento} />
        </View>
      </Pressable>
    </View>
  );
}

const stili = StyleSheet.create({
  contenitore: { position: 'absolute', left: 0, right: 0, bottom: 10, paddingHorizontal: 12 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 496,
    height: ALTEZZA,
    paddingLeft: 22,
    paddingRight: 6,
    borderRadius: 26,
    elevation: 6,
    shadowColor: '#1a4468',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  pezzi: { fontFamily: FONT.titolo, fontSize: 16 },
  pillola: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20 },
  pillolaTesto: { fontFamily: FONT.testoForte, fontSize: 15.5 },
});
