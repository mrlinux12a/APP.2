import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import type { Categoria } from '@/api';
import { BarraRicerca } from '@/componenti/BarraRicerca';
import { ElencoProdotti, NOTA_PREZZI } from '@/componenti/ElencoProdotti';
import { Icona, IconaCategoria } from '@/componenti/Icona';
import { StatoHome } from '@/componenti/StatoHome';
import { Caricamento, Errore } from '@/componenti/Stato';
import { useCatalogo, usePrecaricaCatalogo, useRicerca } from '@/dati';
import { FONT, useTema } from '@/tema';

// L'immagine della categoria (SVG da /img/categorie/<slug>.svg, la manda l'API) su riquadro bianco da 72×60, come .cat-img del sito. Se manca o non si carica resta l'icona.
function ImmagineCategoria({ uri, icona }: { uri: string; icona: ReactNode }) {
  const [errore, setErrore] = useState(false);
  if (errore) return <View style={stili.tesseraIco}>{icona}</View>;
  return (
    <View style={stili.tesseraImg}>
      <SvgUri uri={uri} width="100%" height="100%" onError={() => setErrore(true)} />
    </View>
  );
}

// Una tessera della griglia (.cat): immagine o icona sopra, nome sotto (fino a 3 righe). Una parola da 15+ lettere ("Condizionamento") ha il corpo ridotto invece di
// essere spezzata (.cat-lunga); sugli schermi stretti i corpi scendono ancora, come nelle regole @media del sito.
function Tessera({ nome, icona, immagine, href }: { nome: string; icona: ReactNode; immagine?: string | null; href: Href }) {
  const { c } = useTema();
  const { width } = useWindowDimensions();
  const lunga = nome.split(/\s+/).some((p) => p.length > 14);
  const corpo = width <= 330 ? (lunga ? 12 : 14) : width <= 360 ? (lunga ? 13 : 14) : lunga ? 14 : 15;
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      style={[stili.tessera, { backgroundColor: c.superficie, borderColor: c.bordo }]}
    >
      {immagine ? <ImmagineCategoria uri={immagine} icona={icona} /> : <View style={stili.tesseraIco}>{icona}</View>}
      <Text style={[stili.tesseraNome, { color: c.testo, fontSize: corpo, lineHeight: corpo * 1.25 }]} numberOfLines={3}>
        {nome}
      </Text>
    </Pressable>
  );
}

// Le tessere a due per riga (un'ultima tessera sola lascia il posto vuoto accanto).
function Griglia({ tessere }: { tessere: { chiave: string; nodo: ReactNode }[] }) {
  const righe: { chiave: string; nodo: ReactNode }[][] = [];
  for (let i = 0; i < tessere.length; i += 2) righe.push(tessere.slice(i, i + 2));
  return (
    <View style={{ gap: 10 }}>
      {righe.map((riga) => (
        <View key={riga[0].chiave} style={stili.rigaGriglia}>
          {riga.map((t) => (
            <View key={t.chiave} style={{ flex: 1, minWidth: 0 }}>
              {t.nodo}
            </View>
          ))}
          {riga.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

// La home dell'installatore (views/cliente/home.ejs): in alto fisse "Cosa ti serve?" e la barra di ricerca, sotto le schede di stato, le categorie a due per riga e la
// nota sui prezzi. Scrivendo, al posto delle categorie compaiono le righe compatte dei risultati (−/+ salva subito nel carrello).
export default function Home() {
  const { c } = useTema();
  const catalogo = useCatalogo();
  const [testo, setTesto] = useState('');
  const ricerca = useRicerca(testo);
  // La barra del carrello vuoto manda qui il testo scritto (`q`): si cerca subito, come /cerca sul sito. `n` cambia a ogni invio, così lo stesso testo si applica una
  // volta sola e tornando sulla scheda non rimette la vecchia ricerca.
  const { q, n } = useLocalSearchParams<{ q?: string; n?: string }>();
  const [nVisto, setNVisto] = useState<string | undefined>(undefined);
  if (q && n && n !== nVisto) {
    setNVisto(n);
    setTesto(q);
  }
  const categorie: Categoria[] = catalogo.data ? [...catalogo.data.in_evidenza, ...catalogo.data.altre] : [];
  // Le categorie si leggono in background appena c'è l'elenco: all'apertura sono già pronte.
  usePrecaricaCatalogo(categorie);

  if (catalogo.isPending) return <Caricamento />;
  if (catalogo.isError) return <Errore messaggio={catalogo.error.message} riprova={() => catalogo.refetch()} />;

  const risultati = ricerca.attiva ? ricerca.data?.risultati || [] : [];

  const tessere = [
    ...categorie.map((m) => ({
      chiave: m.slug,
      nodo: (
        <Tessera
          nome={m.nome}
          icona={<IconaCategoria slug={m.slug} colore="#1a4468" dimensione={30} />}
          immagine={m.immagine}
          href={{ pathname: '/categoria/[slug]', params: { slug: m.slug, titolo: m.nome } }}
        />
      ),
    })),
    {
      chiave: 'con-foto',
      nodo: <Tessera nome="Elementi con foto" icona={<Icona nome="catalogo" colore="#1a4468" dimensione={30} />} href="/con-foto" />,
    },
  ];

  const intestazione = ricerca.attiva ? (
    <View style={stili.intestazione}>
      <Text style={[stili.nota, { color: c.grigio }]}>
        {ricerca.isFetching && !ricerca.data ? 'Cerco…' : `${risultati.length} risultati per «${ricerca.q}»`}
      </Text>
    </View>
  ) : (
    <View style={stili.intestazione}>
      <StatoHome />
      <Griglia tessere={tessere} />
      <Text style={[stili.nota, { color: c.grigio, marginTop: 14 }]}>{NOTA_PREZZI}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      {/* Fisso sotto l'intestazione, fuori dall'elenco: la tastiera non si chiude scrivendo (.ricerca-fissa del sito). */}
      <View style={[stili.ricercaFissa, { backgroundColor: c.sfondo, borderBottomColor: c.bordo }]}>
        <Text style={[stili.domanda, { color: c.testo }]}>Cosa ti serve?</Text>
        <BarraRicerca home valore={testo} cambia={setTesto} segnaposto="Nome o misura: valv 3/4" />
      </View>
      <ElencoProdotti
        prodotti={risultati}
        intestazione={intestazione}
        caricamento={ricerca.attiva && ricerca.isPending}
        vuoto={ricerca.attiva ? 'Nessun articolo trovato. Prova con meno parole o solo la misura.' : undefined}
        // Senza ricerca la nota sta già sotto le categorie.
        senzaNota={!ricerca.attiva}
      />
    </View>
  );
}

const stili = StyleSheet.create({
  ricercaFissa: {
    paddingTop: 6,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    zIndex: 2,
    shadowColor: '#232019',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  domanda: { fontFamily: FONT.titoloForte, fontSize: 24, lineHeight: 30, marginTop: 4, marginHorizontal: 2, marginBottom: 10 },
  intestazione: { paddingHorizontal: 14, paddingTop: 12 },
  nota: { fontFamily: FONT.testo, fontSize: 13.3, lineHeight: 19, marginHorizontal: 2 },
  rigaGriglia: { flexDirection: 'row', gap: 10 },
  tessera: {
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 138,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  // Riquadro bianco (niente sfondo azzurro): l'icona di ripiego e l'immagine stanno sullo stesso fondo.
  tesseraIco: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },
  tesseraImg: { width: 72, height: 60, borderRadius: 12, overflow: 'hidden', backgroundColor: '#ffffff' },
  tesseraNome: { alignSelf: 'stretch', fontFamily: FONT.nome },
});
