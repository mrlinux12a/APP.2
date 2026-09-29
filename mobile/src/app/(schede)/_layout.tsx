import { Tabs } from 'expo-router';

import { usePezziNelCarrello } from '@/carrello';
import { Icona } from '@/componenti/Icona';
import { FONT, useTema } from '@/tema';

// Barra in basso come sul sito: Catalogo, Carrello, Stato ordini.
export default function Schede() {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: c.superficie, borderTopColor: c.bordo },
        tabBarActiveTintColor: c.navAttivo,
        tabBarInactiveTintColor: c.grigio,
        tabBarLabelStyle: { fontFamily: FONT.testoMedio, fontSize: 12 },
        headerStyle: { backgroundColor: c.superficie },
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: FONT.titolo, color: c.testo },
        headerTitleAlign: 'center',
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
