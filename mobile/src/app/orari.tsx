import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icona } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { Card, Nota } from '@/componenti/ui';
import { useOrari } from '@/dati';
import { FONT, RAGGIO, useTema } from '@/tema';

// "Orari di BOREA" (richiesta del 22/10/2026, mockup docs/mockup/orari-borea.png): aperto o chiuso adesso e i sette giorni con le fasce. Ci si arriva da
// "Vedi orari" del carrello. Gli orari sono quelli che il banco imposta nella sua anagrafica (le filiali si mettono insieme: l'installatore vede la ditta),
// mai scritti nell'app.
export default function OrariBanco() {
  const { c } = useTema();
  const q = useOrari();

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;

  const o = q.data;
  const nome = o.nome || 'il banco';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      <View style={[stili.stato, { backgroundColor: c.superficie, borderColor: c.bordo }]} accessibilityLiveRegion="polite">
        <View style={[stili.cerchio, { backgroundColor: o.aperto ? c.verdeChiaro : c.accentoScuro }]}>
          <Icona nome={o.aperto ? 'orario' : 'luna'} colore={o.aperto ? c.verde : c.suAccento} dimensione={22} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={stili.titoloRiga}>
            <View style={[stili.punto, { backgroundColor: o.aperto ? c.verde : c.rosso }]} />
            <Text style={[stili.titolo, { color: c.testo }]}>{o.titolo}</Text>
          </View>
          <Text style={[stili.sotto, { color: c.grigio }]}>
            {o.sotto_prefisso}
            {o.quando ? <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{o.quando}</Text> : null}
          </Text>
        </View>
      </View>

      {o.sempre_aperto ? (
        <Nota>Il banco non ha orari: puoi inviare le richieste a qualsiasi ora.</Nota>
      ) : (
        <>
          <Card fitta>
            <Text style={[stili.occhiello, { color: c.grigio }]}>QUANDO PUOI INVIARE LE RICHIESTE</Text>
            {o.giorni.map((g, i) => (
              <View
                key={g.giorno}
                style={[
                  stili.giorno,
                  { borderTopColor: c.bordo, borderTopWidth: StyleSheet.hairlineWidth },
                  g.oggi && { backgroundColor: c.accentoChiaro },
                  i === o.giorni.length - 1 && { borderBottomLeftRadius: RAGGIO - 1, borderBottomRightRadius: RAGGIO - 1 },
                ]}
              >
                <View style={stili.giornoNome}>
                  <Text style={[stili.nomeGiorno, { color: c.testo }]}>{g.nome}</Text>
                  {g.oggi ? <Text style={[stili.badge, { backgroundColor: c.accento, color: c.suAccento }]}>OGGI</Text> : null}
                  {g.riapre ? <Text style={[stili.badge, { backgroundColor: c.verdeChiaro, color: c.verde }]}>RIAPRE</Text> : null}
                </View>
                {g.chiuso ? (
                  <Text style={[stili.fasce, { color: c.grigio }]}>Chiuso</Text>
                ) : (
                  <View style={{ alignItems: 'flex-end' }}>
                    {g.fasce.map((f) => (
                      <Text key={f} style={[stili.fasce, { color: c.testo, fontFamily: g.oggi ? FONT.testoForte : FONT.testoMedio }]}>
                        {f}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </Card>
          <Nota>Fuori da questi orari puoi preparare il carrello, ma la richiesta si invia solo quando {nome} è aperto.</Nota>
        </>
      )}
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 40 },
  stato: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: RAGGIO, padding: 14 },
  cerchio: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  titoloRiga: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punto: { width: 9, height: 9, borderRadius: 5 },
  titolo: { fontFamily: FONT.titolo, fontSize: 18 },
  sotto: { fontFamily: FONT.testo, fontSize: 15, marginTop: 2 },
  occhiello: { fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  giorno: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  giornoNome: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  nomeGiorno: { fontFamily: FONT.testoForte, fontSize: 16 },
  badge: { fontFamily: FONT.testoForte, fontSize: 11, letterSpacing: 0.3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  fasce: { fontFamily: FONT.testoMedio, fontSize: 15, lineHeight: 22 },
});
