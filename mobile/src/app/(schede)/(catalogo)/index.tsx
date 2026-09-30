import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Categoria } from '@/api';
import { BarraRicerca } from '@/componenti/BarraRicerca';
import { ElencoProdotti } from '@/componenti/ElencoProdotti';
import { Icona, IconaCategoria } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { useCatalogo, usePrecaricaCatalogo, useRicerca } from '@/dati';
import { FONT, RAGGIO, useTema, type Colori } from '@/tema';

function Tessera({ c, titolo, conta, icona, href }: { c: Colori; titolo: string; conta: number; icona: React.ReactNode; href: Href }) {
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      style={[stili.tessera, { backgroundColor: c.superficie, borderColor: c.bordo }]}
    >
      <View style={[stili.tesseraIco, { backgroundColor: c.accentoChiaro }]}>{icona}</View>
      <Text style={[stili.tesseraNome, { color: c.testo }]}>{titolo}</Text>
      <Text style={[stili.tesseraConta, { color: c.grigio }]}>{conta.toLocaleString('it-IT')} articoli</Text>
    </Pressable>
  );
}

export default function Home() {
  const { c } = useTema();
  const catalogo = useCatalogo();
  const [testo, setTesto] = useState('');
  const ricerca = useRicerca(testo);
  const categorie: Categoria[] = catalogo.data ? [...catalogo.data.in_evidenza, ...catalogo.data.altre] : [];
  // Le categorie si leggono in background appena c'è l'elenco: all'apertura sono già pronte.
  usePrecaricaCatalogo(categorie);

  if (catalogo.isPending) return <Caricamento />;
  if (catalogo.isError) return <Errore messaggio={catalogo.error.message} riprova={() => catalogo.refetch()} />;

  const risultati = ricerca.attiva ? ricerca.data?.risultati || [] : [];

  const intestazione = (
    <View style={stili.intestazione}>
      <Text style={[stili.domanda, { color: c.testo }]}>Cosa ti serve?</Text>
      <BarraRicerca valore={testo} cambia={setTesto} segnaposto="Es. valvola sfera 3/4, raccordo 16" />
      {ricerca.attiva ? (
        <Text style={[stili.nota, { color: c.grigio }]}>
          {ricerca.isFetching && !ricerca.data ? 'Cerco…' : `${risultati.length} risultati per «${ricerca.q}»`}
        </Text>
      ) : (
        <>
          <Text style={[stili.nota, { color: c.grigio }]}>
            Scrivi anche solo un pezzo di parola o la misura: <Text style={{ fontFamily: FONT.testoForte }}>valv 3/4</Text>{' '}
            basta.
          </Text>
          <Text style={[stili.sezione, { color: c.testo }]}>Categorie</Text>
          <View style={stili.griglia}>
            {categorie.map((m) => (
              <Tessera
                key={m.slug}
                c={c}
                titolo={m.nome}
                conta={m.n_prodotti}
                icona={<IconaCategoria slug={m.slug} colore={c.accento} dimensione={20} />}
                href={{ pathname: '/categoria/[slug]', params: { slug: m.slug, titolo: m.nome } }}
              />
            ))}
            <Tessera
              c={c}
              titolo="Elementi con foto"
              conta={catalogo.data.con_foto}
              icona={<Icona nome="catalogo" colore={c.accento} dimensione={20} />}
              href="/con-foto"
            />
          </View>
          <Text style={[stili.nota, { color: c.grigio, marginTop: 14 }]}>
            I prezzi in app sono IVA esclusa. La disponibilità viene confermata dal banco prima di chiudere l'ordine.
          </Text>
        </>
      )}
    </View>
  );

  return (
    <ElencoProdotti
      prodotti={risultati}
      intestazione={intestazione}
      caricamento={ricerca.attiva && ricerca.isPending}
      vuoto={ricerca.attiva ? 'Nessun articolo trovato. Prova con meno parole o solo la misura.' : undefined}
    />
  );
}

const stili = StyleSheet.create({
  intestazione: { padding: 14, gap: 10 },
  domanda: { fontFamily: FONT.titoloForte, fontSize: 24, marginTop: 4 },
  nota: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 19, marginHorizontal: 2 },
  sezione: { fontFamily: FONT.titolo, fontSize: 17, marginTop: 10 },
  griglia: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tessera: {
    // Due per riga: 45% + crescita, così lo spazio fra le due tessere non le manda a capo.
    width: '45%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: RAGGIO,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 6,
    minHeight: 118,
  },
  tesseraIco: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tesseraNome: { fontFamily: FONT.titolo, fontSize: 15, lineHeight: 19 },
  tesseraConta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 'auto' },
});
