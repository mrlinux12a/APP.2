import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { selezione, usePezziNelCarrello, usePezziSelezionati } from '../carrello';
import { FONT, useTema } from '../tema';

// Barra in fondo agli elenchi di prodotti, come .barra-carrello sul sito: conta i pezzi
// scelti con gli stepper e li mette nel carrello tutti insieme con "Aggiungi".
export function BarraCarrello() {
  const { c } = useTema();
  const selezionati = usePezziSelezionati();
  const nelCarrello = usePezziNelCarrello();
  const [aggiunti, setAggiunti] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!selezionati && !nelCarrello && !aggiunti) return null;

  const aggiungi = () => {
    if (!selezione.aggiungiAlCarrello()) return;
    setAggiunti(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAggiunti(false), 1200);
  };

  return (
    <View style={[stili.barra, { backgroundColor: c.superficie, borderTopColor: c.bordo }]}>
      <Text style={[stili.testo, { color: c.testo }]} numberOfLines={2}>
        {selezionati > 0 ? (
          <>
            <Text style={{ color: c.accento, fontFamily: FONT.testoForte }}>{selezionati}</Text> selezionati
            {nelCarrello > 0 ? ' · ' : ''}
          </>
        ) : null}
        {nelCarrello > 0 ? (
          <>
            <Text style={{ color: c.accento, fontFamily: FONT.testoForte }}>{nelCarrello}</Text> nel carrello
          </>
        ) : selezionati === 0 ? (
          'Nessun pezzo nel carrello'
        ) : null}
      </Text>
      <View style={stili.bottoni}>
        <Pressable
          onPress={aggiungi}
          disabled={selezionati === 0}
          accessibilityRole="button"
          style={({ pressed }) => [
            stili.bottone,
            {
              backgroundColor: aggiunti ? c.verde : selezionati > 0 ? c.accento : c.bordo,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[stili.bottoneTesto, { color: aggiunti ? '#fff' : selezionati > 0 ? c.suAccento : c.grigio }]}>
            {aggiunti && selezionati === 0 ? 'Aggiunto ✓' : selezionati > 0 ? `Aggiungi (${selezionati})` : 'Aggiungi'}
          </Text>
        </Pressable>
        {nelCarrello > 0 ? (
          <Pressable
            onPress={() => router.navigate('/carrello')}
            accessibilityRole="button"
            style={({ pressed }) => [
              stili.bottone,
              { backgroundColor: c.superficie, borderWidth: 1, borderColor: c.bordo, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[stili.bottoneTesto, { color: c.accento }]}>Vai al carrello</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const stili = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  testo: { flex: 1, fontFamily: FONT.testo, fontSize: 14 },
  bottoni: { flexDirection: 'row', gap: 8 },
  bottone: { borderRadius: 999, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center' },
  bottoneTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
});
