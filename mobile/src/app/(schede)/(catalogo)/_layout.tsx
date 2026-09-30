import { Stack } from 'expo-router';

import { intestazione } from '@/componenti/BarraTitolo';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { useTema } from '@/tema';

export default function PilaCatalogo() {
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
      <Stack.Screen name="index" options={{ title: 'Catalogo' }} />
      {/* Il titolo arriva dal parametro "titolo" di chi apre la schermata: è giusto dal primo
          fotogramma. Se lo cambiasse la schermata dopo il caricamento, l'intestazione si
          ridisegnerebbe a metà transizione. */}
      <Stack.Screen
        name="categoria/[slug]"
        options={({ route }) => ({ title: (route.params as { titolo?: string } | undefined)?.titolo ?? '' })}
      />
      <Stack.Screen name="con-foto" options={{ title: 'Elementi con foto' }} />
    </Stack>
  );
}
