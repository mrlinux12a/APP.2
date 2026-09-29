import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import type { Prodotto } from '../api';
import { FONT, useTema } from '../tema';
import { BarraCarrello } from './BarraCarrello';
import { stileRigaCard } from './rigaCard';
import { SchedaProdotto } from './SchedaProdotto';
import { Vuoto } from './Stato';

// Elenco di prodotti con scroll infinito. L'intestazione (barra di ricerca, titoli) sta
// dentro la FlatList, così scorre insieme ai prodotti; va passata come elemento, non come
// componente, e deve restare lo stesso albero mentre si scrive: se la barra di ricerca
// venisse ricreata la tastiera si chiuderebbe a ogni lettera.
// Senza "vuoto" un elenco vuoto non mostra nulla (es. la home prima di cercare).
// Sotto l'elenco la barra Aggiungi / Vai al carrello, come sul sito.
export function ElencoProdotti({
  prodotti,
  intestazione,
  caricamento,
  altriInArrivo,
  caricaAltri,
  vuoto,
}: {
  prodotti: Prodotto[];
  intestazione?: ReactElement;
  caricamento?: boolean;
  altriInArrivo?: boolean;
  caricaAltri?: () => void;
  vuoto?: string;
}) {
  const { c } = useTema();
  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      <FlatList
        data={prodotti}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item, index }) => (
          <View style={stileRigaCard(c, index, prodotti.length)}>
            <SchedaProdotto p={item} ultima={index === prodotti.length - 1} />
          </View>
        )}
        ListHeaderComponent={intestazione}
        ListEmptyComponent={
          caricamento ? (
            <ActivityIndicator color={c.accento} style={{ marginTop: 32 }} />
          ) : vuoto ? (
            <View style={{ minHeight: 240 }}>
              <Vuoto icona="vuotoRicerca" messaggio={vuoto} />
            </View>
          ) : null
        }
        ListFooterComponent={
          altriInArrivo ? (
            <ActivityIndicator color={c.accento} style={{ marginVertical: 20 }} />
          ) : prodotti.length ? (
            <Text style={[stili.nota, { color: c.grigio }]}>
              Prezzi IVA esclusa. La disponibilità la conferma il banco prima di chiudere l'ordine.
            </Text>
          ) : null
        }
        onEndReached={caricaAltri}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ backgroundColor: c.sfondo }}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
      <BarraCarrello />
    </View>
  );
}

const stili = StyleSheet.create({
  nota: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 18, padding: 16 },
});
