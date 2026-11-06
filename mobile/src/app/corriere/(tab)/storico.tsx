import { StyleSheet, View } from 'react-native';

import { Pagina, StatoVuoto, Titolo } from '@/corriere/ui';

// Lo Storico dei corrieri non c'è ancora (fuori dal primo lancio, docs/app-corrieri.md): per ora dice com'è. Il riepilogo di ogni consegna si vede subito dopo averla
// conclusa («Consegna completata»).
export default function Storico() {
  return (
    <Pagina>
      <View style={stili.testa}>
        <Titolo>Storico</Titolo>
      </View>
      <StatoVuoto
        icona="scontrino"
        titolo="Lo storico arriva presto"
        testo="Qui vedrai le consegne che hai completato, con orari e tempi. Per ora trovi il riepilogo di ogni consegna subito dopo averla conclusa."
      />
    </Pagina>
  );
}

const stili = StyleSheet.create({
  testa: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
});
