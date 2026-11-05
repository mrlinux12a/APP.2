import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import type { Sottocategoria } from '@/api';
import { BarraRicerca } from '@/componenti/BarraRicerca';
import { ElencoProdotti } from '@/componenti/ElencoProdotti';
import { IconaCategoria } from '@/componenti/Icona';
import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { percorsoProdottiCategoria, useCategoria, useElencoPaginato, usePrecaricaSottocategorie, useRicerca } from '@/dati';
import { FONT, useTema } from '@/tema';

// Una scheda di sottocategoria (.sotto-scheda): riquadro 4:3 con la foto; senza foto (o se non si carica) l'immagine della categoria su bianco, altrimenti l'icona della
// categoria su grigio. Sotto il nome, fino a due righe.
function SchedaSotto({ s, macro, onPress }: { s: Sottocategoria; macro: { slug: string; immagine?: string | null }; onPress: () => void }) {
  const { c } = useTema();
  const [fotoRotta, setFotoRotta] = useState(false);
  const conImmagine = !!macro.immagine;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={[stili.sotto, { backgroundColor: c.superficie, borderColor: c.bordo }]}
    >
      <View style={[stili.sottoFoto, { backgroundColor: conImmagine ? '#ffffff' : '#e7e3da' }]}>
        {conImmagine ? (
          <View style={stili.sottoImmagine}>
            <SvgUri uri={macro.immagine as string} width="100%" height="100%" />
          </View>
        ) : (
          <IconaCategoria slug={macro.slug} colore="#8a887e" dimensione={32} />
        )}
        {s.foto && !fotoRotta ? (
          <Image source={{ uri: s.foto }} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} onError={() => setFotoRotta(true)} accessibilityLabel={s.nome} />
        ) : null}
      </View>
      <View style={stili.sottoNome}>
        <Text style={[stili.sottoTesto, { color: c.testo }]} numberOfLines={2}>
          {s.nome}
        </Text>
      </View>
    </Pressable>
  );
}

// Le schede a due per riga (un'ultima scheda sola lascia il posto vuoto accanto).
function GrigliaSotto({ elementi }: { elementi: { chiave: string; nodo: ReactNode }[] }) {
  const righe: { chiave: string; nodo: ReactNode }[][] = [];
  for (let i = 0; i < elementi.length; i += 2) righe.push(elementi.slice(i, i + 2));
  return (
    <View style={{ gap: 10, marginHorizontal: 12 }}>
      {righe.map((riga) => (
        <View key={riga[0].chiave} style={{ flexDirection: 'row', gap: 10 }}>
          {riga.map((e) => (
            <View key={e.chiave} style={{ flex: 1, minWidth: 0 }}>
              {e.nodo}
            </View>
          ))}
          {riga.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

// Una categoria: prima l'elenco delle sottocategorie a schede con foto, poi (scelta una sottocategoria) i prodotti. Con una sola sottocategoria, o nessuna, si va
// dritti ai prodotti — come /categoria/:slug sul sito. La barra di ricerca resta fissa in alto, fuori dall'elenco: scrivendo la tastiera non si chiude.
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
  const prodotti = ricerca.attiva ? ricerca.data?.risultati || [] : sfoglia ? prodottiSfoglia : [];

  // "N risultati per «q»" solo cercando, come sul sito; sfogliando l'elenco parte subito.
  const intestazione = ricerca.attiva ? (
    <Text style={[stili.sottotitolo, { color: c.grigio }]}>
      {ricerca.isFetching && !ricerca.data ? 'Cerco…' : `${prodotti.length} risultati per «${ricerca.q}»`}
    </Text>
  ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      {/* Di norma il titolo arriva già nel parametro (vedi _layout); qui solo se manca (collegamento
          diretto) o è diverso: una categoria con una sola sottocategoria mostra quella. */}
      {titolo === titoloParam ? null : <Stack.Screen options={{ title: titolo }} />}

      <View style={[stili.ricercaFissa, { backgroundColor: c.sfondo }]}>
        <BarraRicerca valore={testo} cambia={setTesto} segnaposto={'Cerca in ' + titolo} />
      </View>

      {ricerca.attiva || sfoglia ? (
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
              : elenco.isError
                ? elenco.error.message
                : 'Nessun articolo in questa categoria.'
          }
        />
      ) : (
        // L'elenco delle sottocategorie: niente barra "Vai al carrello" (il sito non la mette qui), in fondo lo spazio della navbar.
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110 }}>
          {macro.descrizione ? <Text style={[stili.sottotitolo, { color: c.grigio, marginHorizontal: 14 }]}>{macro.descrizione}</Text> : null}
          {sottocategorie.length ? (
            <GrigliaSotto
              elementi={sottocategorie.map((s) => ({
                chiave: s.slug,
                nodo: (
                  <SchedaSotto
                    s={s}
                    macro={macro}
                    // push: stessa rotta con un altro parametro, va aggiunta come nuova schermata (così "indietro" torna all'elenco delle sottocategorie).
                    onPress={() => router.push({ pathname: '/categoria/[slug]', params: { slug, sotto: s.slug, titolo: s.nome } })}
                  />
                ),
              }))}
            />
          ) : (
            <View style={{ minHeight: 240 }}>
              <Vuoto icona="vuotoScatola" messaggio="Nessun prodotto in questa categoria." />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const stili = StyleSheet.create({
  // La ricerca fissa sotto l'intestazione (.ricerca-fissa-sotto): 12 di respiro e lo sfondo della pagina.
  ricercaFissa: { padding: 12 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 14.4, lineHeight: 20, marginHorizontal: 16, marginBottom: 12, marginTop: 2 },
  sotto: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  sottoFoto: { aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center' },
  sottoImmagine: { width: '70%', height: '55%' },
  sottoNome: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 12 },
  // Sempre due righe di altezza, così le schede di una riga restano allineate alle altre (min-height 2.5em).
  sottoTesto: { fontFamily: FONT.nome, fontSize: 13.5, lineHeight: 17, minHeight: 34 },
});
