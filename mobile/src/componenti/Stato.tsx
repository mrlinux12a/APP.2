import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NomeIcona } from '../icone';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

export function Caricamento() {
  const { c } = useTema();
  return (
    <View style={stili.centro}>
      <ActivityIndicator color={c.accento} size="large" />
    </View>
  );
}

export function Errore({ messaggio, riprova }: { messaggio: string; riprova?: () => void }) {
  const { c } = useTema();
  return (
    <View style={stili.centro}>
      <Icona nome="avviso" colore={c.rosso} dimensione={36} />
      <Text style={[stili.testo, { color: c.testo }]}>{messaggio}</Text>
      {riprova ? (
        <Pressable onPress={riprova} style={[stili.bottone, { borderColor: c.bordo, backgroundColor: c.superficie }]}>
          <Text style={[stili.bottoneTesto, { color: c.accento }]}>Riprova</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Vuoto({ icona, messaggio }: { icona: NomeIcona; messaggio: string }) {
  const { c } = useTema();
  return (
    <View style={stili.centro}>
      <Icona nome={icona} colore={c.grigio} dimensione={36} />
      <Text style={[stili.testo, { color: c.grigio }]}>{messaggio}</Text>
    </View>
  );
}

const stili = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  testo: { fontFamily: FONT.testo, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  bottone: { borderWidth: 1, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 24, marginTop: 6 },
  bottoneTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
});
