import { router, Stack } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { intestazione } from '@/componenti/BarraTitolo';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { FONT, useTema } from '@/tema';

// "Stato ordini": la prima schermata mostra l'unica attività in corso (come sul sito);
// dallo Storico si aprono le richieste e gli ordini passati. Non c'è più il riepilogo per ordinare:
// l'ordine nasce da solo dopo il pagamento (vedi carrello).
export default function PilaOrdini() {
  const { c } = useTema();
  return (
    <Stack
      screenOptions={{
        freezeOnBlur: true,
        // Barra uguale a quella del Carrello (vedi BarraTitolo): quella nativa era più alta.
        header: intestazione,
        headerRight: () => <PulsanteAccount />,
        contentStyle: { backgroundColor: c.sfondo },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Stato ordini',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable onPress={() => router.push('/ordini/storico')} hitSlop={8} accessibilityRole="link">
                <Text style={{ color: c.accento, fontFamily: FONT.testoForte, fontSize: 15 }}>Storico</Text>
              </Pressable>
              <PulsanteAccount />
            </View>
          ),
        }}
      />
      <Stack.Screen name="richiesta/[id]" options={{ title: 'Richiesta' }} />
      <Stack.Screen name="ordine/[id]" options={{ title: 'Ordine' }} />
      <Stack.Screen name="storico" options={{ title: 'Storico' }} />
    </Stack>
  );
}
