import { Tabs } from 'expo-router';

import { usePezziNelCarrello } from '@/carrello';
import { intestazione } from '@/componenti/BarraTitolo';
import { Icona } from '@/componenti/Icona';
import { EtichettaStatoOrdini, IconaStatoOrdini } from '@/componenti/NavStatoOrdini';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { useAttivitaInCorso } from '@/dati';
import { FONT, useTema } from '@/tema';

// Barra in basso come sul sito: Catalogo, Carrello, Stato ordini.
export default function Schede() {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();
  // Quante attività ci sono in corso (richieste in attesa e ordini in consegna): con due o più la scheda "Stato ordini" lo dice con un numero.
  const attivita = useAttivitaInCorso().data?.voci.length ?? 0;

  return (
    <Tabs
      screenOptions={{
        // Nessuna animazione nel cambio di scheda (richiesta esplicita).
        animation: 'none',
        // Una scheda non in primo piano non si ridisegna finché non si torna a lei.
        freezeOnBlur: true,
        // Su Android, con la tastiera aperta, la barra in basso salirebbe sopra la tastiera e
        // toglierebbe spazio ai risultati mentre si scrive (Expo, "Keyboard handling").
        tabBarHideOnKeyboard: true,
        tabBarStyle: { backgroundColor: c.superficie, borderTopColor: c.bordo },
        tabBarActiveTintColor: c.navAttivo,
        tabBarInactiveTintColor: c.grigio,
        tabBarLabelStyle: { fontFamily: FONT.testoMedio, fontSize: 12 },
        // Stessa barra delle pile di schermate (Catalogo, Stato ordini): vedi BarraTitolo.
        header: intestazione,
        sceneStyle: { backgroundColor: c.sfondo },
      }}
    >
      <Tabs.Screen
        name="(catalogo)"
        options={{
          title: 'Catalogo',
          headerShown: false,
          tabBarIcon: ({ color }) => <Icona nome="catalogo" colore={color} />,
        }}
      />
      <Tabs.Screen
        name="carrello"
        options={{
          title: 'Carrello',
          // Il pulsante del profilo e il suo menu ci sono in ogni pagina del cliente, anche nel carrello (views/partials/comune/appbar.ejs).
          headerRight: () => <PulsanteAccount />,
          tabBarIcon: ({ color }) => <Icona nome="carrello" colore={color} />,
          tabBarBadge: pezzi > 0 ? pezzi : undefined,
          tabBarBadgeStyle: { backgroundColor: c.rosso, color: '#fff', fontFamily: FONT.testoForte, fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="ordini"
        options={{
          title: 'Stato ordini',
          headerShown: false,
          // Icona ed etichetta seguono la prima attività (anello e conto alla rovescia, furgone e minuti all'arrivo); con più attività un numero dice quante sono.
          tabBarIcon: ({ color }) => <IconaStatoOrdini color={color} />,
          tabBarLabel: ({ color }) => <EtichettaStatoOrdini color={color} />,
          tabBarBadge: attivita >= 2 ? attivita : undefined,
          tabBarBadgeStyle: { backgroundColor: c.accento, color: '#fff', fontFamily: FONT.testoForte, fontSize: 11 },
        }}
      />
    </Tabs>
  );
}
