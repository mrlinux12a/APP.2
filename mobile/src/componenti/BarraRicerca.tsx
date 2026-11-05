import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

// Come sul sito: niente autocorrezione/maiuscole (rovinerebbero codici e misure tipo "3/4"), e la ricerca parte mentre si scrive senza cambiare schermata, così la
// tastiera resta aperta. Con `home` è la barra della home (`.barra-home`): bordo blu, il pulsante "Cerca" e il tasto per cercare con foto o codice a barre, che
// c'è ma non è ancora attivo (come sul sito: "Presto disponibile").
// `senzaFoto`: toglie il tasto della foto (la barra del carrello vuoto, .barra-vuoto). `alCerca`: cosa fare toccando "Cerca" o invio sulla tastiera (di norma si chiude solo
// la tastiera, perché la ricerca parte già mentre si scrive; nel carrello vuoto porta al catalogo con il testo scritto).
export function BarraRicerca({
  valore,
  cambia,
  segnaposto,
  home = false,
  senzaFoto = false,
  alCerca,
}: {
  valore: string;
  cambia: (t: string) => void;
  segnaposto: string;
  home?: boolean;
  senzaFoto?: boolean;
  alCerca?: () => void;
}) {
  const { c } = useTema();
  const cerca = () => {
    Keyboard.dismiss();
    alCerca?.();
  };
  return (
    <View
      style={[
        stili.barra,
        home ? stili.barraHome : null,
        { backgroundColor: c.superficie, borderColor: home ? c.accento : c.bordo },
      ]}
    >
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
        onSubmitEditing={cerca}
        style={[stili.campo, { color: c.testo }]}
        accessibilityLabel="Cerca un pezzo"
      />
      {valore ? (
        <Pressable onPress={() => cambia('')} accessibilityLabel="Cancella ricerca" hitSlop={10}>
          <Text style={{ color: c.grigio, fontSize: 18 }}>✕</Text>
        </Pressable>
      ) : null}
      {home ? (
        <>
          {senzaFoto ? null : (
            <View
              accessible
              accessibilityRole="button"
              accessibilityState={{ disabled: true }}
              accessibilityLabel="Cerca con una foto o il codice a barre: presto disponibile"
              style={[stili.inquadra, { backgroundColor: c.accentoChiaro }]}
            >
              <Icona nome="inquadra" colore={c.accentoScuro} dimensione={22} />
            </View>
          )}
          <Pressable
            onPress={cerca}
            accessibilityRole="button"
            style={({ pressed }) => [stili.cerca, { backgroundColor: pressed ? c.accentoScuro : c.accento }]}
          >
            <Text style={[stili.cercaTesto, { color: c.suAccento }]}>Cerca</Text>
          </Pressable>
        </>
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
  barraHome: { borderWidth: 1.5, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  campo: { flex: 1, minWidth: 0, fontSize: 16, fontFamily: FONT.testo, paddingVertical: 6 },
  inquadra: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  cerca: { height: 44, paddingHorizontal: 20, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cercaTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
});
