import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icona } from '@/componenti/Icona';
import { useRiepilogo } from '@/corriere/dati';
import { COL, FC } from '@/corriere/tema';
import { Caricamento, Pagina, Piede, Pulsante, Scheda, kmTesto, minutiTesto } from '@/corriere/ui';

// Una riga del riepilogo: etichetta a sinistra, valore a destra.
function Riga({ etichetta, valore, ultima }: { etichetta: string; valore: string; ultima?: boolean }) {
  return (
    <View style={[stili.riga, !ultima && stili.rigaLinea]}>
      <Text style={stili.etichetta}>{etichetta}</Text>
      <Text style={stili.valore}>{valore}</Text>
    </View>
  );
}

// «Consegna completata»: si arriva qui subito dopo «Consegna confermata». Gli orari, quanto ci ha messo davvero rispetto alla stima e i km fatti; da qui si torna
// alle richieste (a consegna finita non si torna indietro alla consegna).
export default function Completata() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useRiepilogo(Number(id));
  const r = query.data;
  const alleRichieste = () => router.replace('/corriere');

  if (!r && query.isPending) {
    return (
      <Pagina bordi={['top', 'bottom']}>
        <Caricamento />
      </Pagina>
    );
  }

  const piuVeloce = r && r.tempo_effettivo_min !== null && r.tempo_stimato_min !== null && r.tempo_effettivo_min <= r.tempo_stimato_min;

  return (
    <Pagina>
      <ScrollView contentContainerStyle={stili.contenuto}>
        <View style={stili.cerchio} accessible={false}>
          <Icona nome="spunta" colore="#FFFFFF" dimensione={46} />
        </View>
        <Text style={stili.titolo} accessibilityRole="header">
          Consegna completata
        </Text>
        <Text style={stili.sotto}>
          {r ? `Ordine ${r.codice} consegnato${r.consegnata_alle ? ` alle ${r.consegnata_alle}` : ''}. Grazie!` : 'La consegna è stata registrata. Grazie!'}
        </Text>

        {r ? (
          <Scheda stile={stili.riepilogo}>
            {r.ritirata_alle ? <Riga etichetta="Ritirato alle" valore={r.ritirata_alle} /> : null}
            {r.consegnata_alle ? <Riga etichetta="Consegnato alle" valore={r.consegnata_alle} /> : null}
            {r.tempo_effettivo_min !== null ? (
              <Riga
                etichetta="Tempo impiegato"
                valore={r.tempo_stimato_min !== null ? `${minutiTesto(r.tempo_effettivo_min)} · stima ${minutiTesto(r.tempo_stimato_min)}` : minutiTesto(r.tempo_effettivo_min)}
              />
            ) : null}
            {r.distanza_km !== null ? <Riga etichetta="Percorso" valore={kmTesto(r.distanza_km)} ultima /> : null}
          </Scheda>
        ) : null}
        {piuVeloce ? <Text style={stili.bravo}>Hai consegnato nei tempi previsti.</Text> : null}
      </ScrollView>

      <Piede sullaPagina>
        <Pulsante titolo="Torna alle richieste" onPress={alleRichieste} />
      </Piede>
    </Pagina>
  );
}

const stili = StyleSheet.create({
  contenuto: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28, gap: 14 },
  cerchio: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: COL.verde, marginBottom: 6 },
  titolo: { fontFamily: FC.extra, fontSize: 28, lineHeight: 34, color: COL.testo, textAlign: 'center' },
  sotto: { fontFamily: FC.medio, fontSize: 16, lineHeight: 23, color: COL.grigio, textAlign: 'center' },
  riepilogo: { alignSelf: 'stretch', paddingVertical: 4, marginTop: 8 },
  riga: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 14 },
  rigaLinea: { borderBottomWidth: 1, borderBottomColor: COL.bordo },
  etichetta: { fontFamily: FC.medio, fontSize: 15, color: COL.grigio },
  valore: { flexShrink: 1, fontFamily: FC.forte, fontSize: 16, color: COL.testo, textAlign: 'right' },
  bravo: { fontFamily: FC.semi, fontSize: 14, color: COL.verde, textAlign: 'center' },
});
