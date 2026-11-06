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
import { intestazione } from '@/componenti/BarraTitolo';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
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

  // Chi è dentro è un installatore ("cliente") o un corriere: ognuno ha le sue schermate (docs/app-corrieri.md). Qualunque altro ruolo, che l'API dell'app non
  // dovrebbe mai dare, non vede né le une né le altre e resta alla schermata di accesso.
  const eCliente = !!utente && utente.ruolo === 'cliente';
  const eCorriere = !!utente && utente.ruolo === 'corriere';

  // Le notifiche push servono all'installatore: registra il telefono e porta alla richiesta o all'ordine quando si tocca una notifica. Il corriere non ne ha
  // ancora (le sue arriveranno con le consegne): così non gli si chiede nemmeno il permesso.
  useNotifichePush(eCliente && utente ? utente.id : null);

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
          // Nessuna animazione tra le schermate (richiesta esplicita): si passa dall'una all'altra di colpo, come sul sito.
          animation: 'none',
          // Le schermate sotto la prima non si ridisegnano mentre sono coperte: meno lavoro
          // per il thread JS quando si cambia schermata.
          freezeOnBlur: true,
          contentStyle: { backgroundColor: c.sfondo },
          headerStyle: { backgroundColor: c.superficie },
          headerTintColor: c.accento,
          headerTitleStyle: STILE_TITOLO,
        }}
      >
        <Stack.Protected guard={eCliente}>
          <Stack.Screen name="(schede)" />
          {/* «La mia anagrafica» (si apre dal menu del profilo): stessa barra delle altre pagine, con la freccia indietro e il pulsante del profilo come sul sito. */}
          <Stack.Screen
            name="profilo"
            options={{ headerShown: true, header: intestazione, title: 'La mia anagrafica', headerRight: () => <PulsanteAccount /> }}
          />
          {/* "Orari di BOREA": ci si arriva da "Vedi orari" del carrello. Il titolo arriva dal parametro "titolo" (vedi apriOrari), come per le categorie. */}
          <Stack.Screen
            name="orari"
            options={({ route }) => ({
              headerShown: true,
              header: intestazione,
              title: (route.params as { titolo?: string } | undefined)?.titolo ?? 'Orari del banco',
            })}
          />
        </Stack.Protected>
        {/* La schermata del corriere (solo nell'app). */}
        <Stack.Protected guard={eCorriere}>
          <Stack.Screen name="corriere" />
        </Stack.Protected>
        {/* Accesso e registrazione, dell'installatore e del corriere: si passa dall'uno all'altro con il selettore in cima. */}
        <Stack.Protected guard={!utente}>
          <Stack.Screen name="login" />
          <Stack.Screen name="registrati" />
          <Stack.Screen name="accesso-corriere" />
          <Stack.Screen name="registrati-corriere" />
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
