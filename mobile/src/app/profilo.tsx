import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSessione } from '@/sessione';
import { FONT, RAGGIO, useTema } from '@/tema';

export default function Profilo() {
  const { c } = useTema();
  const { utente, esci } = useSessione();

  return (
    <View style={[stili.pagina, { backgroundColor: c.sfondo }]}>
      <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
        <Text style={[stili.ragione, { color: c.testo }]}>{utente?.ragione_sociale}</Text>
        <Text style={[stili.meta, { color: c.grigio }]}>Cliente · {utente?.username}</Text>
      </View>

      <Pressable
        onPress={async () => {
          if (router.canGoBack()) router.back();
          await esci();
        }}
        style={[stili.esci, { borderColor: c.bordo, backgroundColor: c.superficie }]}
      >
        <Text style={[stili.esciTesto, { color: c.rosso }]}>Esci</Text>
      </Pressable>
    </View>
  );
}

const stili = StyleSheet.create({
  pagina: { flex: 1, padding: 14, gap: 12 },
  card: { borderWidth: 1, borderRadius: RAGGIO, padding: 16 },
  ragione: { fontFamily: FONT.titolo, fontSize: 18 },
  meta: { fontFamily: FONT.testo, fontSize: 14, marginTop: 4 },
  esci: { borderWidth: 1, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  esciTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
});
