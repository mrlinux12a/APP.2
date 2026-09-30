import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { Bottone, Nota } from '@/componenti/ui';
import { VistaOrdine } from '@/componenti/VistaOrdine';
import { VistaRichiesta } from '@/componenti/VistaRichiesta';
import { useStatoOrdini } from '@/dati';
import { useTema } from '@/tema';

function NessunOrdine() {
  const { c } = useTema();
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

// Come /ordini sul sito: mostra sempre e solo UNA cosa, la più rilevante (in attesa > da
// scegliere > in consegna > scaduta da poco). Niente in corso: invito al catalogo.
export default function StatoOrdini() {
  const q = useStatoOrdini();
  // Annullata o eliminata una richiesta o un ordine si resta qui, su "Nessun ordine in corso",
  // invece di passare subito all'attività successiva (un ordine di ieri ancora aperto, in
  // verde, sembrava la richiesta appena annullata "confermata"). L'attività corrente
  // si ricalcola quando si lascia la scheda e si torna.
  const [chiusa, setChiusa] = useState(false);

  // Ogni volta che si torna su questa scheda l'attività corrente si ricalcola.
  useFocusEffect(
    useCallback(() => {
      q.refetch();
      return () => setChiusa(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (chiusa) return <NessunOrdine />;
  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;

  const attivo = q.data.attivo;
  const dopoChiusura = () => setChiusa(true);
  if (attivo?.tipo === 'richiesta') return <VistaRichiesta key={'r' + attivo.id} id={attivo.id} quandoChiusa={dopoChiusura} />;
  if (attivo?.tipo === 'ordine') return <VistaOrdine key={'o' + attivo.id} id={attivo.id} quandoChiusa={dopoChiusura} />;

  return <NessunOrdine />;
}
