import { StyleSheet, Text, View } from 'react-native';

import { ElencoProdotti } from '@/componenti/ElencoProdotti';
import { useElencoPaginato } from '@/dati';
import { FONT, useTema } from '@/tema';

// Vetrina trasversale alle categorie: tutti i prodotti che hanno già una foto (views/cliente/con_foto.ejs).
export default function ConFoto() {
  const { c } = useTema();
  const elenco = useElencoPaginato('/con-foto');
  const prodotti = elenco.data?.pages.flatMap((p) => p.risultati) || [];
  const totale = elenco.data?.pages[0]?.totale;

  return (
    <ElencoProdotti
      prodotti={prodotti}
      intestazione={
        <View style={stili.intestazione}>
          <Text style={[stili.sottotitolo, { color: c.grigio }]}>
            {totale !== undefined ? `${totale.toLocaleString('it-IT')} articoli con foto caricata.` : ' '}
          </Text>
        </View>
      }
      caricamento={elenco.isPending}
      altriInArrivo={elenco.isFetchingNextPage}
      caricaAltri={() => {
        if (elenco.hasNextPage && !elenco.isFetchingNextPage) elenco.fetchNextPage();
      }}
      vuoto={elenco.isError ? elenco.error.message : 'Nessun articolo ha ancora una foto.'}
    />
  );
}

const stili = StyleSheet.create({
  intestazione: { paddingHorizontal: 14, paddingTop: 12 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 14.4, lineHeight: 20, marginHorizontal: 2, marginBottom: 12 },
});
