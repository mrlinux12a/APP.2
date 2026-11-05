import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import type { Prodotto } from '../api';
import { usePezziNelCarrello } from '../carrello';
import { FONT, useTema } from '../tema';
import { BarraVai, SPAZIO_BARRA_VAI } from './BarraVai';
import { RigaProdotto } from './RigaProdotto';
import { stileElencoRighe } from './rigaCard';
import { Vuoto } from './Stato';

// Elenco di prodotti con scroll infinito, a righe compatte (RigaProdotto) come sul sito. L'intestazione (titoli, griglie) sta dentro la FlatList, così scorre insieme
// ai prodotti; va passata come elemento, non come componente, e non deve contenere campi di testo (la barra di ricerca sta fuori dall'elenco: se venisse ricreata
// la tastiera si chiuderebbe a ogni lettera). Senza "vuoto" un elenco vuoto non mostra nulla (es. la home prima di cercare).
// In fondo la barra blu "N pezzi · Vai al carrello →", solo con almeno un pezzo nel carrello (`senzaBarra` la toglie: elenco delle sottocategorie).
export function ElencoProdotti({
  prodotti,
  intestazione,
  caricamento,
  altriInArrivo,
  caricaAltri,
  vuoto,
  senzaNota,
  senzaBarra,
}: {
  prodotti: Prodotto[];
  intestazione?: ReactElement;
  caricamento?: boolean;
  altriInArrivo?: boolean;
  caricaAltri?: () => void;
  vuoto?: string;
  senzaNota?: boolean;
  senzaBarra?: boolean;
}) {
  const { c } = useTema();
  const pezzi = usePezziNelCarrello();
  const spazioInFondo = !senzaBarra && pezzi > 0 ? SPAZIO_BARRA_VAI : 24;
  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      <FlatList
        data={prodotti}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item, index }) => (
          <View style={stileElencoRighe(c, index, prodotti.length)}>
            <RigaProdotto p={item} ultima={index === prodotti.length - 1} />
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
          ) : undefined
        }
        ListFooterComponent={
          altriInArrivo ? (
            <ActivityIndicator color={c.accento} style={{ marginVertical: 20 }} />
          ) : prodotti.length && !senzaNota ? (
            <Text style={[stili.nota, { color: c.grigio }]}>{NOTA_PREZZI}</Text>
          ) : undefined
        }
        onEndReached={caricaAltri}
        onEndReachedThreshold={0.6}
        // Poche righe al primo disegno (le altre arrivano a piccoli gruppi): la schermata compare subito.
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ backgroundColor: c.sfondo }}
        contentContainerStyle={{ paddingBottom: spazioInFondo }}
      />
      {senzaBarra ? null : <BarraVai />}
    </View>
  );
}

// La nota sotto i prezzi, la stessa di tutto il sito (home): prezzi IVA esclusa, e cosa succede al pagamento.
export const NOTA_PREZZI =
  'I prezzi in app sono IVA esclusa. Paghi quando mandi la richiesta; il banco conferma la disponibilità e, se nessuno conferma, il pagamento ti viene rimborsato.';

const stili = StyleSheet.create({
  nota: { fontFamily: FONT.testo, fontSize: 13.3, lineHeight: 19, marginHorizontal: 16, marginTop: 8, marginBottom: 16 },
});
