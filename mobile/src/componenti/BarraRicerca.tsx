import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

// Come sul sito: niente autocorrezione/maiuscole (rovinerebbero codici e misure tipo
// "3/4"), e la ricerca parte mentre si scrive senza cambiare schermata, così la tastiera
// resta aperta.
export function BarraRicerca({
  valore,
  cambia,
  segnaposto,
}: {
  valore: string;
  cambia: (t: string) => void;
  segnaposto: string;
}) {
  const { c } = useTema();
  return (
    <View style={[stili.barra, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <Icona nome="lente" colore={c.iconaNav} dimensione={20} />
      <TextInput
        value={valore}
        onChangeText={cambia}
        placeholder={segnaposto}
        placeholderTextColor={c.grigio}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        returnKeyType="search"
        style={[stili.campo, { color: c.testo }]}
        accessibilityLabel="Cerca un pezzo"
      />
      {valore ? (
        <Pressable onPress={() => cambia('')} accessibilityLabel="Cancella ricerca" hitSlop={10}>
          <Text style={{ color: c.grigio, fontSize: 18 }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const stili = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  campo: { flex: 1, fontSize: 16, fontFamily: FONT.testo, paddingVertical: 10 },
});
