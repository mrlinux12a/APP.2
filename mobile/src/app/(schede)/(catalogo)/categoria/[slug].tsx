import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BarraRicerca } from '@/componenti/BarraRicerca';
import { ElencoProdotti } from '@/componenti/ElencoProdotti';
import { Icona } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { percorsoProdottiCategoria, useCategoria, useElencoPaginato, usePrecaricaSottocategorie, useRicerca } from '@/dati';
import { FONT, RAGGIO, useTema } from '@/tema';

// Una categoria: prima l'elenco delle sottocategorie, poi (scelta una sottocategoria) i
// prodotti. Con una sola sottocategoria, o nessuna, si va dritti ai prodotti — come
// /categoria/:slug sul sito.
export default function CategoriaSchermata() {
  const { c } = useTema();
  const { slug, sotto: sottoParam, titolo: titoloParam } = useLocalSearchParams<{ slug: string; sotto?: string; titolo?: string }>();
  const categoria = useCategoria(slug);
  const [testo, setTesto] = useState('');

  const sottocategorie = categoria.data?.sottocategorie || [];
  const sotto = sottoParam || (sottocategorie.length === 1 ? sottocategorie[0].slug : null);
  const sfoglia = !!categoria.data && (!!sotto || sottocategorie.length === 0);
  const sottoScelta = sottocategorie.find((s) => s.slug === sotto);

  const ricerca = useRicerca(testo, { macro: slug, sotto });
  const elenco = useElencoPaginato(percorsoProdottiCategoria(slug, sotto), sfoglia && !ricerca.attiva);
  // Mentre si legge l'elenco delle sottocategorie si scarica già il primo elenco di ognuna.
  usePrecaricaSottocategorie(slug, sfoglia ? [] : sottocategorie);

  if (categoria.isPending) return <Caricamento />;
  if (categoria.isError) return <Errore messaggio={categoria.error.message} riprova={() => categoria.refetch()} />;

  const { macro } = categoria.data;
  const titolo = sottoScelta ? sottoScelta.nome : macro.nome;
  const prodottiSfoglia = elenco.data?.pages.flatMap((p) => p.risultati) || [];
  const totale = elenco.data?.pages[0]?.totale;
  const prodotti = ricerca.attiva ? ricerca.data?.risultati || [] : sfoglia ? prodottiSfoglia : [];

  const intestazione = (
    <View style={stili.intestazione}>
      <BarraRicerca valore={testo} cambia={setTesto} segnaposto={'Cerca in ' + titolo} />
      {ricerca.attiva ? (
        <Text style={[stili.sottotitolo, { color: c.grigio }]}>
          {ricerca.isFetching && !ricerca.data ? 'Cerco…' : `${prodotti.length} risultati per «${ricerca.q}»`}
        </Text>
      ) : sfoglia ? (
        <Text style={[stili.sottotitolo, { color: c.grigio }]}>
          <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{titolo}</Text>
          {totale !== undefined ? ` — ${totale.toLocaleString('it-IT')} articoli` : ''}
        </Text>
      ) : (
        <>
          {macro.descrizione ? <Text style={[stili.sottotitolo, { color: c.grigio }]}>{macro.descrizione}</Text> : null}
          <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
            {sottocategorie.map((s, i) => (
              <Pressable
                key={s.slug}
                // push: stessa rotta con un altro parametro, va aggiunta come nuova schermata
                // (così "indietro" torna all'elenco delle sottocategorie).
                onPress={() => router.push({ pathname: '/categoria/[slug]', params: { slug, sotto: s.slug, titolo: s.nome } })}
                accessibilityRole="link"
                style={[
                  stili.riga,
                  { borderBottomColor: c.bordo, borderBottomWidth: i < sottocategorie.length - 1 ? StyleSheet.hairlineWidth : 0 },
                ]}
              >
                <Icona nome="famiglia" colore={c.testo} />
                <View style={{ flex: 1 }}>
                  <Text style={[stili.rigaNome, { color: c.testo }]}>{s.nome}</Text>
                  <Text style={[stili.rigaConta, { color: c.grigio }]}>{s.n.toLocaleString('it-IT')} articoli</Text>
                </View>
                <Text style={{ color: c.grigio, fontSize: 20 }}>›</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );

  return (
    <>
      {/* Di norma il titolo arriva già nel parametro (vedi _layout); qui solo se manca (collegamento
          diretto) o è diverso: una categoria con una sola sottocategoria mostra quella. */}
      {titolo === titoloParam ? null : <Stack.Screen options={{ title: titolo }} />}
      <ElencoProdotti
        prodotti={prodotti}
        intestazione={intestazione}
        caricamento={ricerca.attiva ? ricerca.isPending : sfoglia && elenco.isPending}
        altriInArrivo={!ricerca.attiva && elenco.isFetchingNextPage}
        caricaAltri={() => {
          if (!ricerca.attiva && elenco.hasNextPage && !elenco.isFetchingNextPage) elenco.fetchNextPage();
        }}
        vuoto={
          ricerca.attiva
            ? 'Nessun articolo trovato in questa categoria.'
            : sfoglia
              ? elenco.isError
                ? elenco.error.message
                : 'Nessun articolo in questa categoria.'
              : undefined
        }
      />
    </>
  );
}

const stili = StyleSheet.create({
  intestazione: { padding: 14, gap: 12 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20, marginHorizontal: 2 },
  card: { borderWidth: 1, borderRadius: RAGGIO, overflow: 'hidden' },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rigaNome: { fontFamily: FONT.testoMedio, fontSize: 16 },
  rigaConta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
});
