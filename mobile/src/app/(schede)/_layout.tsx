import { router, Tabs } from 'expo-router';

import type { VoceAttivita } from '@/api';
import { usePezziNelCarrello } from '@/carrello';
import { intestazione } from '@/componenti/BarraTitolo';
import { Icona } from '@/componenti/Icona';
import { EtichettaStatoOrdini, fraseStatoOrdini, IconaStatoOrdini, useVoceMostrata } from '@/componenti/NavStatoOrdini';
import { PulsanteAccount } from '@/componenti/PulsanteAccount';
import { useAttivitaInCorso } from '@/dati';
import { FONT, useTema } from '@/tema';

// Nessuna attività in corso: sempre lo stesso elenco vuoto, così non si crea un array nuovo a ogni disegno.
const NESSUNA_VOCE: VoceAttivita[] = [];

// Barra in basso come sul sito: Catalogo, Carrello, Stato ordini.
export default function Schede() {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();
  // Le attività in corso (richieste in attesa e ordini in consegna): la scheda "Stato ordini" le alterna e il suo tocco porta a quella che si vede.
  const voci = useAttivitaInCorso().data?.voci ?? NESSUNA_VOCE;
  const voceMostrata = useVoceMostrata();

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
          // Icona ed etichetta come sul sito: un'icona per fase (anello, furgone, scatola con "!") e, con due o più attività, una alla volta ogni 2,5 secondi con i puntini
          // sotto (NavStatoOrdini). Il numero delle attività lo scrive l'icona stessa, solo con «riduci movimento».
          tabBarIcon: ({ color }) => <IconaStatoOrdini color={color} />,
          tabBarLabel: ({ color }) => <EtichettaStatoOrdini color={color} />,
          // I fotogrammi cambiano da soli: il lettore di schermo legge una frase sola con tutte le attività.
          tabBarAccessibilityLabel: voci.length >= 2 ? fraseStatoOrdini(voci) : undefined,
        }}
        listeners={{
          // Con due o più attività il tocco porta dritto alla pagina di quella che si vede in quel momento (come sul sito); con meno vale il tocco di sempre.
          tabPress: (e) => {
            const v = voceMostrata();
            if (!v) return;
            e.preventDefault();
            router.navigate({ pathname: '/ordini', params: { voce: `${v.tipo}-${v.id}`, n: String(Date.now()) } });
          },
        }}
      />
    </Tabs>
  );
}
