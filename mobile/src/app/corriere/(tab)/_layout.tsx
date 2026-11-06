import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icona } from '@/componenti/Icona';
import { useSincronizzaCorriere } from '@/corriere/dati';
import { COL, FC } from '@/corriere/tema';
import type { NomeIcona } from '@/icone';

// L'icona di una scheda: quando è quella attiva sta dentro una pillola gialla. `conteggio` = pallino rosso col numero (richieste da prendere), `punto` = pallino
// giallo scuro senza numero (c'è una consegna in corso).
function IconaScheda({ nome, attiva, conteggio, punto }: { nome: NomeIcona; attiva: boolean; conteggio?: number; punto?: boolean }) {
  return (
    <View style={[stili.pillola, attiva && stili.pillolaAttiva]}>
      <Icona nome={nome} colore={attiva ? COL.testo : COL.grigio} dimensione={22} />
      {conteggio ? (
        <View style={stili.conteggio}>
          <Text style={stili.conteggioTesto}>{conteggio > 9 ? '9+' : conteggio}</Text>
        </View>
      ) : null}
      {punto ? <View style={stili.punto} /> : null}
    </View>
  );
}

function EtichettaScheda({ testo, attiva }: { testo: string; attiva: boolean }) {
  return <Text style={[stili.etichetta, { color: attiva ? COL.testo : COL.grigio, fontFamily: attiva ? FC.forte : FC.semi }]}>{testo}</Text>;
}

// Le quattro schede del corriere: Richieste · In corso · Storico · Profilo. Questo layout è sempre montato nell'area del corriere, quindi è lui a tenere
// aggiornate le richieste e la consegna in corso (useSincronizzaCorriere) per i numeri sulle schede.
export default function Schede() {
  const { elenco, inCorso } = useSincronizzaCorriere();
  const { bottom } = useSafeAreaInsets();
  const richiesteDaPrendere = elenco && elenco.disponibile && !elenco.in_corso ? elenco.richieste.length : 0;
  const consegnaInCorso = !!(elenco && elenco.in_corso) || !!(inCorso && (inCorso.consegna || inCorso.in_preparazione));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Nessuna animazione nel cambio di scheda (richiesta esplicita); una scheda non in primo piano non si ridisegna.
        animation: 'none',
        freezeOnBlur: true,
        // Con la tastiera aperta la barra non deve salire sopra di lei.
        tabBarHideOnKeyboard: true,
        // Altezza scritta a mano: la pillola (32) con l'etichetta sotto (14 + 2) non ci sta nei 49 di serie. Si somma la zona sicura in basso (barra dei gesti).
        tabBarStyle: { backgroundColor: COL.scheda, borderTopColor: COL.bordo, height: 64 + bottom, paddingTop: 7, paddingBottom: bottom > 0 ? bottom : 7 },
        sceneStyle: { backgroundColor: COL.sfondo },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Richieste',
          tabBarAccessibilityLabel: richiesteDaPrendere ? `Richieste, ${richiesteDaPrendere} da prendere` : 'Richieste',
          tabBarIcon: ({ focused }) => <IconaScheda nome="ordini" attiva={focused} conteggio={richiesteDaPrendere} />,
          tabBarLabel: ({ focused }) => <EtichettaScheda testo="Richieste" attiva={focused} />,
        }}
      />
      <Tabs.Screen
        name="in-corso"
        options={{
          title: 'In corso',
          tabBarAccessibilityLabel: consegnaInCorso ? 'In corso, hai una consegna' : 'In corso',
          tabBarIcon: ({ focused }) => <IconaScheda nome="furgone" attiva={focused} punto={consegnaInCorso} />,
          tabBarLabel: ({ focused }) => <EtichettaScheda testo="In corso" attiva={focused} />,
        }}
      />
      <Tabs.Screen
        name="storico"
        options={{
          title: 'Storico',
          tabBarIcon: ({ focused }) => <IconaScheda nome="orario" attiva={focused} />,
          tabBarLabel: ({ focused }) => <EtichettaScheda testo="Storico" attiva={focused} />,
        }}
      />
      <Tabs.Screen
        name="profilo"
        options={{
          title: 'Profilo',
          tabBarIcon: ({ focused }) => <IconaScheda nome="persona" attiva={focused} />,
          tabBarLabel: ({ focused }) => <EtichettaScheda testo="Profilo" attiva={focused} />,
        }}
      />
    </Tabs>
  );
}

const stili = StyleSheet.create({
  pillola: { width: 58, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillolaAttiva: { backgroundColor: COL.giallo },
  etichetta: { fontSize: 11, lineHeight: 14, marginTop: 2 },
  conteggio: {
    position: 'absolute',
    top: -4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COL.rosso,
    borderWidth: 2,
    borderColor: COL.scheda,
  },
  conteggioTesto: { fontFamily: FC.extra, fontSize: 10, lineHeight: 12, color: '#FFFFFF' },
  punto: { position: 'absolute', top: 1, right: 10, width: 11, height: 11, borderRadius: 6, backgroundColor: COL.gialloTesto, borderWidth: 2, borderColor: COL.scheda },
});
