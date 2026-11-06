import { Stack } from 'expo-router';

import { PosizioneProvider } from '@/corriere/posizione';
import { COL } from '@/corriere/tema';

// Anche aprendo direttamente una richiesta da una notifica (/corriere/richiesta/12, telefono chiuso) sotto di lei ci sono le schede: «indietro» porta alla home.
export const unstable_settings = { anchor: '(tab)' };

// L'area del CORRIERE (solo nell'ambiente «app», docs/app-corrieri.md): le quattro schede (Richieste, In corso, Storico, Profilo) e, sopra, il dettaglio di una
// richiesta e la «Consegna completata». La posizione del telefono vive qui sopra, così tutte le schermate leggono la stessa.
export default function LayoutCorriere() {
  return (
    <PosizioneProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          // Nessuna animazione tra le schermate (richiesta esplicita, come per l'installatore).
          animation: 'none',
          freezeOnBlur: true,
          contentStyle: { backgroundColor: COL.sfondo },
        }}
      >
        <Stack.Screen name="(tab)" />
        <Stack.Screen name="richiesta/[id]" />
        {/* A consegna finita non si torna indietro alla consegna: si riparte dalla home. */}
        <Stack.Screen name="completata/[id]" options={{ gestureEnabled: false }} />
      </Stack>
    </PosizioneProvider>
  );
}
