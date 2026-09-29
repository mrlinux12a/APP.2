import { Stack } from 'expo-router';

import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { FONT, useTema } from '@/tema';

export default function PilaCatalogo() {
  const { c } = useTema();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.superficie },
        headerShadowVisible: false,
        headerTintColor: c.accento,
        headerTitleStyle: { fontFamily: FONT.titolo, color: c.testo },
        headerTitleAlign: 'center',
        headerBackButtonDisplayMode: 'minimal',
        headerRight: () => <PulsanteAccount />,
        contentStyle: { backgroundColor: c.sfondo },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Catalogo' }} />
      <Stack.Screen name="categoria/[slug]" options={{ title: '' }} />
      <Stack.Screen name="con-foto" options={{ title: 'Elementi con foto' }} />
    </Stack>
  );
}
