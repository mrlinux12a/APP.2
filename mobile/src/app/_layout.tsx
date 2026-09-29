import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { Sora_800ExtraBold } from '@expo-google-fonts/sora/800ExtraBold';
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { SourceSans3_700Bold } from '@expo-google-fonts/source-sans-3/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CarrelloProvider } from '@/carrello';
import { SessioneProvider, useSessione } from '@/sessione';
import { FONT, TemaProvider, useTema } from '@/tema';
import { ErroreApi } from '@/api';

const clientDati = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Un 401/403/404 non migliora riprovando; un problema di rete sì.
      retry: (tentativi, errore) => tentativi < 2 && !(errore instanceof ErroreApi && errore.stato >= 400 && errore.stato < 500),
    },
  },
});

function Navigazione() {
  const { pronta, utente } = useSessione();
  const { c, nome } = useTema();

  // All'uscita si butta la cache: chi entra dopo sullo stesso telefono non deve vedere,
  // nemmeno per un attimo, dati letti con l'account precedente.
  useEffect(() => {
    if (!utente) clientDati.clear();
  }, [utente]);

  // Finché non si sa se c'è un accesso salvato si mostra solo lo sfondo: evita un lampo
  // della schermata di login per chi è già dentro.
  if (!pronta) return <View style={{ flex: 1, backgroundColor: c.sfondo }} />;

  return (
    <>
      <StatusBar style={nome === 'chiaro' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.sfondo },
          headerStyle: { backgroundColor: c.superficie },
          headerTintColor: c.accento,
          headerTitleStyle: { fontFamily: FONT.titolo, color: c.testo },
        }}
      >
        <Stack.Protected guard={!!utente}>
          <Stack.Screen name="(schede)" />
          <Stack.Screen name="profilo" options={{ presentation: 'modal', headerShown: true, title: 'Il mio account' }} />
        </Stack.Protected>
        <Stack.Protected guard={!utente}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Radice() {
  const [fontPronti] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={clientDati}>
        <TemaProvider>
          <SessioneProvider>
            <CarrelloProvider>{fontPronti ? <Navigazione /> : <View style={{ flex: 1, backgroundColor: '#12181f' }} />}</CarrelloProvider>
          </SessioneProvider>
        </TemaProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
