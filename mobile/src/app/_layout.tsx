import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { Sora_800ExtraBold } from '@expo-google-fonts/sora/800ExtraBold';
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { SourceSans3_700Bold } from '@expo-google-fonts/source-sans-3/700Bold';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CarrelloProvider } from '@/carrello';
import { useNotifichePush } from '@/notifiche';
import { SessioneProvider, useSessione } from '@/sessione';
import { FONT, STILE_TITOLO, useTema } from '@/tema';
import { ErroreApi, erroreConfigurazione } from '@/api';

// La schermata di avvio resta finché font e sessione non sono pronti: niente lampo di schermata vuota o di login.
SplashScreen.preventAutoHideAsync().catch(() => {});

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
  const { c } = useTema();

  // Le notifiche push servono a chi è dentro: registra il telefono e porta alla richiesta o all'ordine quando si tocca una notifica.
  useNotifichePush(!!utente);

  // All'uscita si butta la cache: chi entra dopo sullo stesso telefono non deve vedere,
  // nemmeno per un attimo, dati letti con l'account precedente.
  useEffect(() => {
    if (!utente) clientDati.clear();
  }, [utente]);

  // Pronti (font e sessione): si toglie la schermata di avvio.
  useEffect(() => {
    if (pronta) SplashScreen.hideAsync().catch(() => {});
  }, [pronta]);

  // Finché non si sa se c'è un accesso salvato si mostra solo lo sfondo: evita un lampo
  // della schermata di login per chi è già dentro.
  if (!pronta) return <View style={{ flex: 1, backgroundColor: c.sfondo }} />;

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          // Le schermate sotto la prima non si ridisegnano mentre sono coperte: meno lavoro
          // per il thread JS durante le transizioni.
          freezeOnBlur: true,
          contentStyle: { backgroundColor: c.sfondo },
          headerStyle: { backgroundColor: c.superficie },
          headerTintColor: c.accento,
          headerTitleStyle: STILE_TITOLO,
        }}
      >
        <Stack.Protected guard={!!utente}>
          <Stack.Screen name="(schede)" />
          <Stack.Screen name="profilo" options={{ presentation: 'modal', headerShown: true, title: 'Il mio account' }} />
        </Stack.Protected>
        <Stack.Protected guard={!utente}>
          <Stack.Screen name="login" />
          <Stack.Screen name="registrati" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

// Un'app installata senza l'indirizzo del server (o con un indirizzo non HTTPS) non può funzionare: lo dice invece di mostrare errori di rete misteriosi.
function NonConfigurata({ motivo }: { motivo: string }) {
  const { c } = useTema();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: c.sfondo }}>
      <Text style={{ fontFamily: FONT.titolo, fontSize: 20, color: c.testo, marginBottom: 10 }}>App non configurata</Text>
      <Text style={{ fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, color: c.grigio, textAlign: 'center' }}>{motivo}</Text>
    </View>
  );
}

export default function Radice() {
  const { c } = useTema();
  const [fontPronti, erroreFont] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Sora_800ExtraBold,
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });
  const configurazione = erroreConfigurazione();

  useEffect(() => {
    if (configurazione) SplashScreen.hideAsync().catch(() => {});
  }, [configurazione]);

  if (configurazione) return <NonConfigurata motivo={configurazione} />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={clientDati}>
        <SessioneProvider>
          <CarrelloProvider>{fontPronti || erroreFont ? <Navigazione /> : <View style={{ flex: 1, backgroundColor: c.sfondo }} />}</CarrelloProvider>
        </SessioneProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
