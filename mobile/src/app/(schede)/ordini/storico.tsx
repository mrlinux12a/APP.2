import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icona } from '@/componenti/Icona';
import { stileRigaCard } from '@/componenti/rigaCard';
import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { StatoBadge } from '@/componenti/ui';
import { useStorico } from '@/dati';
import { FONT, useTema } from '@/tema';

// Tutto: in corso, scaduto, annullato, consegnato (le ultime 50 richieste, come sul sito).
export default function Storico() {
  const { c } = useTema();
  const q = useStorico();

  useFocusEffect(
    useCallback(() => {
      q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const voci = q.data.voci;
  if (!voci.length) return <Vuoto icona="vuotoScatola" messaggio="Nessuna richiesta né ordine ancora." />;

  return (
    <FlatList
      data={voci}
      keyExtractor={(v) => String(v.richiesta_id)}
      style={{ backgroundColor: c.sfondo }}
      contentContainerStyle={{ paddingVertical: 14 }}
      renderItem={({ item: v, index }) => (
        <View style={stileRigaCard(c, index, voci.length)}>
          <Pressable
            onPress={() =>
              v.order_id
                ? router.push({ pathname: '/ordini/ordine/[id]', params: { id: String(v.order_id) } })
                : router.push({ pathname: '/ordini/richiesta/[id]', params: { id: String(v.richiesta_id) } })
            }
            style={({ pressed }) => [
              stili.riga,
              {
                borderBottomColor: c.bordo,
                borderBottomWidth: index < voci.length - 1 ? StyleSheet.hairlineWidth : 0,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Icona nome="ordini" colore={c.testo} />
            <View style={{ flex: 1 }}>
              <Text style={[stili.data, { color: c.testo }]}>{v.data}</Text>
              <Text style={[stili.materiale, { color: c.grigio }]} numberOfLines={2}>
                {v.materiale}
              </Text>
            </View>
            <StatoBadge testo={v.etichetta} tono={v.tono} />
          </Pressable>
        </View>
      )}
    />
  );
}

const stili = StyleSheet.create({
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  data: { fontFamily: FONT.testoMedio, fontSize: 15 },
  materiale: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
});
