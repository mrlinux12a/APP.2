import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { Bottone, Nota } from '@/componenti/ui';
import { VistaOrdine } from '@/componenti/VistaOrdine';
import { VistaRichiesta } from '@/componenti/VistaRichiesta';
import { useStatoOrdini } from '@/dati';
import { useTema } from '@/tema';

// Come /ordini sul sito: mostra sempre e solo UNA cosa, la più rilevante (in attesa > da
// scegliere > in consegna > scaduta da poco). Niente in corso: invito al catalogo.
export default function StatoOrdini() {
  const { c } = useTema();
  const q = useStatoOrdini();

  // Ogni volta che si torna su questa scheda l'attività corrente si ricalcola.
  useFocusEffect(
    useCallback(() => {
      q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;

  const attivo = q.data.attivo;
  if (attivo?.tipo === 'richiesta') return <VistaRichiesta key={'r' + attivo.id} id={attivo.id} />;
  if (attivo?.tipo === 'ordine') return <VistaOrdine key={'o' + attivo.id} id={attivo.id} />;

  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      <Vuoto icona="vuotoScatola" messaggio={'Nessun ordine in corso.\nCrea il tuo ordine dal catalogo.'} />
      <View style={{ padding: 14, gap: 14 }}>
        <Bottone titolo="Vai al catalogo" onPress={() => router.navigate('/')} />
        <Nota>
          Lo storico completo (richieste scadute, annullate, ordini passati e consegnati) è in alto a destra, in
          "Storico".
        </Nota>
      </View>
    </View>
  );
}
