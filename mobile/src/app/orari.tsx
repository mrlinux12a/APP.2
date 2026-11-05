import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icona } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { useOrari } from '@/dati';
import { FONT, useTema } from '@/tema';

// "Orari di BOREA" (richiesta del 22/10/2026, mockup docs/mockup/orari-borea.png, views/cliente/orari_banco.ejs): aperto o chiuso adesso e i sette giorni con le fasce.
// Ci si arriva da "Vedi orari" del carrello. Gli orari sono quelli che il banco imposta nella sua anagrafica (le filiali si mettono insieme: l'installatore vede la
// ditta), mai scritti nell'app.
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
        <View style={[stili.cerchio, { backgroundColor: o.aperto ? c.verde : c.accentoScuro }]}>
          <Icona nome={o.aperto ? 'orario' : 'luna'} colore="#ffffff" dimensione={23} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
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
        <Text style={[stili.nota, { color: c.grigio }]}>Il banco non ha orari: puoi inviare le richieste a qualsiasi ora.</Text>
      ) : (
        <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
          <Text style={[stili.occhiello, { color: c.grigio }]}>Quando puoi inviare le richieste</Text>
          {o.giorni.map((g, i) => {
            // Il giorno dopo "oggi" non ha la linea sopra (l'azzurro di oggi basta); il primo non l'ha mai.
            const precedenteOggi = i > 0 && o.giorni[i - 1].oggi;
            return (
              <View
                key={g.giorno}
                style={[
                  stili.giorno,
                  { borderTopColor: i === 0 || g.oggi || precedenteOggi ? 'transparent' : c.bordo },
                  g.oggi && { backgroundColor: c.accentoChiaro, borderRadius: 12 },
                ]}
              >
                <View style={stili.giornoNome}>
                  <Text style={[stili.nomeGiorno, { color: c.testo }]}>{g.nome}</Text>
                  {g.oggi ? <Text style={[stili.badge, { backgroundColor: c.accento, color: c.suAccento }]}>Oggi</Text> : null}
                  {g.riapre ? <Text style={[stili.badge, { backgroundColor: c.verdeChiaro, color: c.verde }]}>Riapre</Text> : null}
                </View>
                {g.chiuso ? (
                  <Text style={[stili.fasce, { color: c.grigio }]}>Chiuso</Text>
                ) : (
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {g.fasce.map((f) => (
                      <Text key={f} style={[stili.fasce, { color: c.testo, fontFamily: g.oggi ? FONT.testoForte : FONT.testo }]}>
                        {f}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <Text style={[stili.nota, { color: c.grigio }]}>Fuori da questi orari puoi preparare il carrello, ma la richiesta si invia solo quando {nome} è aperto.</Text>
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  // In fondo c'è la barra delle schede sospesa: circa 96px, come .app-orari del sito.
  pagina: { padding: 14, paddingBottom: 96 },
  stato: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderRadius: 16 },
  cerchio: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  titoloRiga: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  punto: { width: 9, height: 9, borderRadius: 5 },
  titolo: { flexShrink: 1, fontFamily: FONT.titolo, fontSize: 20, lineHeight: 24 },
  sotto: { marginTop: 3, fontFamily: FONT.testo, fontSize: 14.5, lineHeight: 20 },
  card: { paddingTop: 16, paddingHorizontal: 14, paddingBottom: 8, borderWidth: 1, borderRadius: 16 },
  occhiello: { marginBottom: 4, marginLeft: 4, fontFamily: FONT.testoForte, fontSize: 11.5, letterSpacing: 0.69, textTransform: 'uppercase' },
  giorno: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 14, paddingHorizontal: 10, borderTopWidth: 1 },
  giornoNome: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
  nomeGiorno: { fontFamily: FONT.testoForte, fontSize: 16 },
  badge: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontFamily: FONT.testoForte, fontSize: 11, letterSpacing: 0.44, textTransform: 'uppercase' },
  fasce: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, fontVariant: ['tabular-nums'] },
  nota: { marginTop: 14, marginHorizontal: 4, fontFamily: FONT.testo, fontSize: 14, lineHeight: 20 },
});
