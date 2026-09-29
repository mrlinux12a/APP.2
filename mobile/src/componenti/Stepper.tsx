import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FONT, useTema } from '../tema';

const TASTO = 44;
const PADDING = 3;
// Altezza complessiva (tasto + padding + bordo): la card prodotto ci allinea il prezzo.
export const ALTEZZA_STEPPER = TASTO + PADDING * 2 + 2;

// Selettore quantità: tasti da 44pt (uso da cantiere, guanti e dita sporche) e numero
// scrivibile a mano per le quantità grandi. minimo 1 nel carrello (per togliere una riga
// c'è "Rimuovi"), 0 nel catalogo.
export function Stepper({
  valore,
  cambia,
  etichetta,
  minimo = 0,
}: {
  valore: number;
  cambia: (n: number) => void;
  etichetta: string;
  minimo?: number;
}) {
  const { c } = useTema();
  const [testo, setTesto] = useState(String(valore));

  useEffect(() => {
    setTesto(String(valore));
  }, [valore]);

  const conferma = () => {
    const n = Math.max(minimo, parseInt(testo, 10) || 0);
    setTesto(String(n));
    if (n !== valore) cambia(n);
  };

  const menoAttivo = valore > minimo;

  return (
    <View style={[stili.stepper, { backgroundColor: c.sfondo, borderColor: c.bordo }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Togli ' + etichetta}
        disabled={!menoAttivo}
        onPress={() => cambia(Math.max(minimo, valore - 1))}
        style={({ pressed }) => [stili.tasto, { backgroundColor: c.superficie, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[stili.segno, { color: menoAttivo ? c.accento : c.bordo }]}>−</Text>
      </Pressable>
      <TextInput
        value={testo}
        onChangeText={(t) => setTesto(t.replace(/[^0-9]/g, ''))}
        onEndEditing={conferma}
        onSubmitEditing={conferma}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={4}
        accessibilityLabel={'Quantità ' + etichetta}
        style={[stili.numero, { color: c.testo }]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Aggiungi ' + etichetta}
        onPress={() => cambia(valore + 1)}
        style={({ pressed }) => [stili.tasto, { backgroundColor: c.superficie, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[stili.segno, { color: c.accento }]}>+</Text>
      </Pressable>
    </View>
  );
}

const stili = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    padding: PADDING,
  },
  tasto: { width: TASTO, height: TASTO, borderRadius: TASTO / 2, alignItems: 'center', justifyContent: 'center' },
  segno: { fontSize: 20, fontFamily: FONT.testoForte, lineHeight: 24 },
  numero: { width: 38, textAlign: 'center', fontSize: 16, fontFamily: FONT.testoMedio, padding: 0 },
});
