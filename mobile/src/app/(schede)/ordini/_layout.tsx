import { Stack } from 'expo-router';

import { intestazione } from '@/componenti/BarraTitolo';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { useTema } from '@/tema';

// Quando si arriva da un'altra scheda direttamente su una pagina di questa pila (lo Storico dal menu del profilo, con `withAnchor`), sotto c'è "Stato ordini":
// così la freccia indietro c'è e porta lì.
export const unstable_settings = { anchor: 'index' };

// "Stato ordini": la prima schermata mostra l'unica attività in corso (come sul sito);
// lo Storico si apre dal menu del profilo (in alto a destra) o dalla riga «Storico ordini» della pagina vuota, e da lì le richieste e gli ordini passati.
// Non c'è più il riepilogo per ordinare: l'ordine nasce da solo dopo il pagamento (vedi carrello).
export default function PilaOrdini() {
  const { c } = useTema();
  return (
    <Stack
      screenOptions={{
        // Nessuna animazione tra le schermate (richiesta esplicita).
        animation: 'none',
        freezeOnBlur: true,
        // Barra uguale a quella del Carrello (vedi BarraTitolo): quella nativa era più alta.
        header: intestazione,
        // Solo il pulsante del profilo, come sul sito: lo Storico è una voce del suo menu, non un link accanto all'icona.
        headerRight: () => <PulsanteAccount />,
        contentStyle: { backgroundColor: c.sfondo },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Stato ordini' }} />
      <Stack.Screen name="richiesta/[id]" options={{ title: 'Richiesta' }} />
      <Stack.Screen name="ordine/[id]" options={{ title: 'Ordine' }} />
      <Stack.Screen name="storico" options={{ title: 'Storico ordini' }} />
    </Stack>
  );
}
