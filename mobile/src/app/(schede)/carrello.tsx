import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, urlFoto } from '@/api';
import { carrello, useRigheCarrello, type RigaCarrello } from '@/carrello';
import { chiedi, informa } from '@/componenti/dialoghi';
import { stileRigaCard } from '@/componenti/rigaCard';
import { Stepper } from '@/componenti/Stepper';
import { Vuoto } from '@/componenti/Stato';
import { Avviso, Bottone, Card, Forte, Nota, RigaRiepilogo } from '@/componenti/ui';
import { useRiepilogoCarrello } from '@/dati';
import { FONT, useTema } from '@/tema';

function Riga({ r, ultima, tolto }: { r: RigaCarrello; ultima: boolean; tolto: boolean }) {
  const { c } = useTema();
  const { quantita, ...dati } = r;
  return (
    <View style={[stili.riga, { borderBottomColor: c.bordo, borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth }]}>
      {r.foto_url ? (
        <Image source={urlFoto(r.foto_url)} style={[stili.foto, { backgroundColor: c.superficie }]} contentFit="contain" />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[stili.nome, { color: c.testo }]}>
          {r.nome}
          {r.etichetta ? <Text style={{ color: c.accento }}> {r.etichetta}</Text> : null}
        </Text>
        <Text style={[stili.meta, { color: c.grigio }]}>Cod. {r.codice}</Text>
        {tolto ? (
          <Text style={[stili.meta, { color: c.rosso }]}>Non più a catalogo: non verrà richiesto</Text>
        ) : (
          <Text style={[stili.prezzo, { color: c.accento }]}>
            € {r.prezzo} <Text style={[stili.meta, { color: c.grigio }]}>+ IVA cad.</Text>
          </Text>
        )}
      </View>
      {/* Come sul sito: nel carrello lo stepper si ferma a 1, per togliere c'è "Rimuovi". */}
      <View style={stili.azioni}>
        <Stepper valore={quantita} minimo={1} cambia={(n) => carrello.imposta(dati, n)} etichetta={r.nome} />
        <Pressable onPress={() => carrello.imposta(dati, 0)} hitSlop={6}>
          <Text style={[stili.rimuovi, { color: c.rosso }]}>Rimuovi</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function Carrello() {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const righe = useRigheCarrello();
  const voci = useMemo(() => righe.map((r) => ({ id: r.id, quantita: r.quantita })), [righe]);
  const riepilogo = useRiepilogoCarrello(voci);
  const [invio, setInvio] = useState(false);
  const pezzi = righe.reduce((n, r) => n + r.quantita, 0);
  const tolti = new Set(riepilogo.data?.non_piu_disponibili || []);

  const chiediSvuota = () =>
    chiedi('Svuotare il carrello?', 'Togli tutti i pezzi dal carrello.', 'Svuota', () => carrello.svuota(), true);

  // Richiesta partita: il carrello si svuota solo quando si lascia la scheda. Svuotarlo subito
  // mostrava "Il carrello è vuoto / Vai al catalogo" per tutto il tempo in cui si aspetta
  // "Stato ordini", cioè un attimo di catalogo prima dell'attesa delle risposte.
  const partita = useRef(false);
  useFocusEffect(
    useCallback(
      () => () => {
        if (!partita.current) return;
        partita.current = false;
        carrello.svuota();
      },
      []
    )
  );

  // "Conferma e chiedi disponibilità": la richiesta parte verso tutti i distributori attivi,
  // poi si passa a "Stato ordini", che mostra l'attesa delle risposte.
  const inviaRichiesta = async () => {
    setInvio(true);
    try {
      await chiamaApi<{ id: number }>('/richieste', { metodo: 'POST', corpo: { righe: carrello.voci() } });
      partita.current = true;
      // 'all': anche se la scheda è già stata vista e non è in primo piano, così non mostra i dati vecchi.
      await clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' });
      router.navigate('/ordini');
    } catch (e) {
      if (e instanceof ErroreApi && e.dati?.codice === 'in_corso') {
        chiedi('Richiesta già in corso', e.message, 'Apri la richiesta', () => router.navigate('/ordini'));
      } else {
        informa('Richiesta non inviata', e instanceof ErroreApi ? e.message : 'Invio non riuscito, riprova.');
      }
    } finally {
      setInvio(false);
    }
  };

  if (!righe.length) {
    return (
      <View style={{ flex: 1, backgroundColor: c.sfondo }}>
        <Vuoto icona="vuotoScatola" messaggio={'Il carrello è vuoto.\nAggiungi articoli dalle categorie o dalla ricerca.'} />
        <View style={{ padding: 14 }}>
          <Bottone titolo="Vai al catalogo" onPress={() => router.navigate('/')} />
        </View>
      </View>
    );
  }

  const r = riepilogo.data;

  return (
    <FlatList
      data={righe}
      keyExtractor={(x) => String(x.id)}
      renderItem={({ item, index }) => (
        <View style={stileRigaCard(c, index, righe.length)}>
          <Riga r={item} ultima={index === righe.length - 1} tolto={tolti.has(item.id)} />
        </View>
      )}
      style={{ backgroundColor: c.sfondo }}
      contentContainerStyle={{ paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={stili.testata}>
          <Text style={[stili.sottotitolo, { color: c.grigio }]}>
            <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{pezzi} pezzi</Text> nel carrello — controlla le
            quantità prima di chiedere la disponibilità.
          </Text>
        </View>
      }
      ListFooterComponent={
        <View style={stili.piede}>
          <Bottone titolo="Svuota carrello" tipo="rosso" onPress={chiediSvuota} />
          <Card>
            {r ? (
              <>
                <RigaRiepilogo voce="Merce (IVA esclusa)" valore={'€ ' + r.merce} />
                {r.raee ? <RigaRiepilogo voce="Contributo RAEE" valore={'€ ' + r.raee} /> : null}
                <RigaRiepilogo voce="Spedizione" valore={'€ ' + r.spedizione} />
                <RigaRiepilogo voce="Totale stimato + IVA" valore={'€ ' + r.totale} forte />
              </>
            ) : riepilogo.isError ? (
              <Text style={[stili.meta, { color: c.rosso }]}>{riepilogo.error.message}</Text>
            ) : (
              <Text style={[stili.meta, { color: c.grigio }]}>Calcolo i totali…</Text>
            )}
          </Card>
          {r && !r.raggiunto ? (
            <Avviso tipo="attenzione">
              <Forte>Ordine minimo € {r.minimo}</Forte> di merce, IVA e spedizione escluse. Ti mancano{' '}
              <Forte>€ {r.manca_al_minimo}</Forte>.
            </Avviso>
          ) : r ? (
            <Nota>
              Ordine minimo di € {r.minimo} raggiunto. La spedizione di € {r.spedizione} si aggiunge al totale e non conta
              per la soglia. Il prezzo definitivo lo conferma il distributore.
            </Nota>
          ) : null}
          <Bottone
            titolo="Conferma e chiedi disponibilità"
            onPress={inviaRichiesta}
            disabilitato={!r || !r.raggiunto || riepilogo.isFetching || riepilogo.inAttesa}
            inCorso={invio}
          />
          {r ? (
            <Text style={[stili.notaCentro, { color: c.grigio }]}>
              Invierai la richiesta ai distributori. Rispondono entro {r.minuti_risposta} minuti.
            </Text>
          ) : null}
          <Bottone titolo="Continua a scegliere" tipo="chiaro" onPress={() => router.navigate('/')} />
        </View>
      }
    />
  );
}

const stili = StyleSheet.create({
  testata: { padding: 14, paddingBottom: 10 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20 },
  riga: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  foto: { width: 48, height: 48, borderRadius: 6 },
  nome: { fontFamily: FONT.nome, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: FONT.testo, fontSize: 13 },
  prezzo: { fontFamily: FONT.testoForte, fontSize: 15 },
  azioni: { alignItems: 'center', gap: 4 },
  rimuovi: { fontFamily: FONT.testoMedio, fontSize: 13 },
  piede: { padding: 14, gap: 12 },
  notaCentro: { fontFamily: FONT.testo, fontSize: 13, textAlign: 'center', marginTop: -4 },
});
