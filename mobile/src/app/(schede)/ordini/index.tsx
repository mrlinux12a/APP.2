import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { VoceAttivita } from '@/api';
import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { Bottone, Card, Nota, SezioneTitolo } from '@/componenti/ui';
import { VistaOrdine } from '@/componenti/VistaOrdine';
import { VistaRichiesta } from '@/componenti/VistaRichiesta';
import { useStatoOrdini } from '@/dati';
import { FONT, useTema } from '@/tema';

function NessunOrdine() {
  const { c } = useTema();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.sfondo }} contentContainerStyle={{ flexGrow: 1 }}>
      <Vuoto icona="vuotoScatola" messaggio={'Nessun ordine in corso.\nCrea il tuo ordine dal catalogo.'} />
      <View style={{ padding: 14, gap: 14 }}>
        <SezioneTitolo>Come funziona</SezioneTitolo>
        <Card>
          <Passo n={1} testo="Scegli il materiale e paga la consegna: la carta viene solo bloccata." />
          <Passo n={2} testo="Il banco controlla la disponibilità e un corriere prende la consegna." />
          <Passo n={3} testo="Il materiale arriva in cantiere. Lo paghi dopo al banco, con la sua fattura." ultimo />
        </Card>
        <Bottone titolo="Vai al catalogo" onPress={() => router.navigate('/')} />
        <Bottone titolo="Storico ordini" tipo="chiaro" onPress={() => router.push('/ordini/storico')} />
        <Nota>Le richieste scadute o annullate e gli ordini consegnati sono nello Storico.</Nota>
      </View>
    </ScrollView>
  );
}

function Passo({ n, testo, ultimo }: { n: number; testo: string; ultimo?: boolean }) {
  const { c } = useTema();
  return (
    <View style={[stili.passo, { marginBottom: ultimo ? 0 : 12 }]}>
      <View style={[stili.passoNumero, { backgroundColor: c.accentoChiaro }]}>
        <Text style={[stili.passoNumeroTesto, { color: c.accento }]}>{n}</Text>
      </View>
      <Text style={[stili.passoTesto, { color: c.testo }]}>{testo}</Text>
    </View>
  );
}

const chiaveVoce = (v: VoceAttivita) => `${v.tipo}-${v.id}`;

function etichettaVoce(v: VoceAttivita) {
  return v.fase === 'richiesta' ? 'In attesa' : v.fase === 'consegna' ? (v.in_arrivo ? 'In arrivo' : 'In consegna') : 'Nessuna risposta';
}

// La striscia di schede in cima, solo con due o più attività in corso (come sul sito): si passa dall'una all'altra con un tocco.
function Striscia({ voci, attiva, scegli }: { voci: VoceAttivita[]; attiva: string; scegli: (chiave: string) => void }) {
  const { c } = useTema();
  return (
    <View style={{ backgroundColor: c.sfondo, borderBottomColor: c.bordo, borderBottomWidth: StyleSheet.hairlineWidth }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={stili.striscia}>
        {voci.map((v) => {
          const sel = chiaveVoce(v) === attiva;
          return (
            <Pressable
              key={chiaveVoce(v)}
              onPress={() => scegli(chiaveVoce(v))}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              style={[
                stili.scheda,
                { backgroundColor: sel ? c.accentoChiaro : c.superficie, borderColor: sel ? c.accento : c.bordo },
              ]}
            >
              <Text style={[stili.schedaEtichetta, { color: sel ? c.accento : c.grigio }]}>{etichettaVoce(v)}</Text>
              <Text style={[stili.schedaTesto, { color: c.testo }]} numberOfLines={1}>
                {v.breve || (v.tipo === 'ordine' ? 'Ordine #' + v.id : 'Richiesta #' + v.id)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Come /ordini sul sito: senza attività la pagina vuota, con una la sua pagina, con due o più la striscia di schede (la prima è la più urgente) e sotto la
// pagina di quella scelta. Si aggiorna da sola: una richiesta ogni 15 secondi, un ordine in consegna ogni minuto.
export default function StatoOrdini() {
  const { c } = useTema();
  const q = useStatoOrdini();
  const [scelta, setScelta] = useState<string | null>(null);

  // Ogni volta che si torna su questa scheda l'elenco si ricalcola.
  useFocusEffect(
    useCallback(() => {
      q.refetch();
      return () => setScelta(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;

  const voci = q.data.voci;
  if (!voci.length) return <NessunOrdine />;
  const corrente = voci.find((v) => chiaveVoce(v) === scelta) || voci[0];
  const k = chiaveVoce(corrente);
  // Con la richiesta scaduta da poco c'è solo "Nessuna risposta": si apre la sua pagina (da lì si rinvia).
  const pagina =
    corrente.tipo === 'ordine' ? <VistaOrdine key={k} id={corrente.id} /> : <VistaRichiesta key={k} id={corrente.id} quandoChiusa={() => q.refetch()} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      {voci.length >= 2 ? <Striscia voci={voci} attiva={k} scegli={setScelta} /> : null}
      <View style={{ flex: 1 }}>{pagina}</View>
    </View>
  );
}

const stili = StyleSheet.create({
  passo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passoNumero: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  passoNumeroTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
  passoTesto: { flex: 1, fontFamily: FONT.testo, fontSize: 15, lineHeight: 21 },
  striscia: { padding: 10, gap: 8 },
  scheda: { borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, minWidth: 130, maxWidth: 200, minHeight: 48 },
  schedaEtichetta: { fontFamily: FONT.testoForte, fontSize: 12 },
  schedaTesto: { fontFamily: FONT.testoMedio, fontSize: 14, marginTop: 1 },
});
