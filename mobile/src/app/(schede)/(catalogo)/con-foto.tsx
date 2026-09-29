import { StyleSheet, Text, View } from 'react-native';

import { ElencoProdotti } from '@/componenti/ElencoProdotti';
import { useElencoPaginato } from '@/dati';
import { FONT, useTema } from '@/tema';

// Vetrina trasversale alle categorie: tutti i prodotti che hanno già una foto.
export default function ConFoto() {
  const { c } = useTema();
  const elenco = useElencoPaginato('/con-foto');
  const prodotti = elenco.data?.pages.flatMap((p) => p.risultati) || [];
  const totale = elenco.data?.pages[0]?.totale;

  return (
    <ElencoProdotti
      prodotti={prodotti}
      intestazione={
        <View style={{ padding: 14 }}>
          <Text style={[stili.sottotitolo, { color: c.grigio }]}>
            {totale !== undefined ? `${totale.toLocaleString('it-IT')} articoli con foto, di ogni categoria.` : ' '}
          </Text>
        </View>
      }
      caricamento={elenco.isPending}
      altriInArrivo={elenco.isFetchingNextPage}
      caricaAltri={() => {
        if (elenco.hasNextPage && !elenco.isFetchingNextPage) elenco.fetchNextPage();
      }}
      vuoto={elenco.isError ? elenco.error.message : 'Nessun articolo con foto.'}
    />
  );
}

const stili = StyleSheet.create({
  sottotitolo: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20 },
});
