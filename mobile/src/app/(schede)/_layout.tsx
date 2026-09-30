import { Tabs } from 'expo-router';

import { usePezziNelCarrello } from '@/carrello';
import { intestazione } from '@/componenti/BarraTitolo';
import { Icona } from '@/componenti/Icona';
import { FONT, useTema } from '@/tema';

// Barra in basso come sul sito: Catalogo, Carrello, Stato ordini.
export default function Schede() {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();

  return (
    <Tabs
      screenOptions={{
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
          tabBarIcon: ({ color }) => <Icona nome="ordini" colore={color} />,
        }}
      />
    </Tabs>
  );
}
