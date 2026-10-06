import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { chiamaApi, ErroreApi, urlFoto } from '@/api';
import { carrello, useRigheCarrello, type RigaCarrello } from '@/carrello';
import { chiedi, informa } from '@/componenti/dialoghi';
import { stileRigaCard } from '@/componenti/rigaCard';
import { Stepper } from '@/componenti/Stepper';
import { Vuoto } from '@/componenti/Stato';
import { Avviso, Bottone, Card, Forte, Nota, RigaInfo, RigaRiepilogo, SezioneTitolo } from '@/componenti/ui';
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
  const [destinazione, setDestinazione] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const pezzi = righe.reduce((n, r) => n + r.quantita, 0);
  const tolti = new Set(riepilogo.data?.non_piu_disponibili || []);

  // La destinazione parte dall'indirizzo di consegna abituale (una volta sola: poi resta quello
  // che l'installatore ha scritto).
  useEffect(() => {
    if (riepilogo.data && destinazione === null) setDestinazione(riepilogo.data.indirizzo_consegna);
  }, [riepilogo.data, destinazione]);

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

  // "Paga e invia la richiesta": si paga (per ora simulato), la richiesta parte verso tutti i distributori
  // attivi e si passa a "Stato ordini", che mostra l'attesa. L'ordine nasce da solo quando il corriere
  // prende la consegna: l'installatore non sceglie né conferma altro.
  const inviaRichiesta = async () => {
    setInvio(true);
    try {
      await chiamaApi<{ id: number }>('/richieste', {
        metodo: 'POST',
        corpo: { righe: carrello.voci(), destinazione: destinazione || '', note },
      });
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
  const campo = [stili.campo, { color: c.testo, borderColor: c.bordo, backgroundColor: c.sfondo }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={righe}
        keyExtractor={(x) => String(x.id)}
        renderItem={({ item, index }) => (
          <View style={stileRigaCard(c, index, righe.length)}>
            <Riga r={item} ultima={index === righe.length - 1} tolto={tolti.has(item.id)} />
          </View>
        )}
        style={{ flex: 1, backgroundColor: c.sfondo }}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={stili.testata}>
            <Text style={[stili.sottotitolo, { color: c.grigio }]}>
              <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{pezzi} pezzi</Text> nel carrello — controlla le
              quantità prima di pagare.
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
                  <RigaRiepilogo voce="Imponibile" valore={'€ ' + r.imponibile} />
                  <RigaRiepilogo voce={`IVA ${r.iva_pct}%`} valore={'€ ' + r.iva} />
                  <RigaRiepilogo voce="Totale da pagare" valore={'€ ' + r.totale_ivato} forte />
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
                per la soglia. Il prezzo definitivo, con eventuale sconto aggiuntivo, è confermato in fattura.
              </Nota>
            ) : null}

            <SezioneTitolo>Dove consegniamo</SezioneTitolo>
            <Card>
              <Text style={[stili.etichetta, { color: c.testo }]}>Destinazione della merce</Text>
              <TextInput
                value={destinazione || ''}
                onChangeText={setDestinazione}
                placeholder="Via, numero, CAP, città"
                placeholderTextColor={c.grigio}
                style={campo}
              />
              <Text style={[stili.aiuto, { color: c.grigio }]}>
                È l'indirizzo che finisce sulla bolla / DDT insieme alla tua ragione sociale.
              </Text>
            </Card>

            <SezioneTitolo>Note per il distributore</SezioneTitolo>
            <Card>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Es. orario preferito, riferimento cantiere..."
                placeholderTextColor={c.grigio}
                multiline
                maxLength={500}
                style={[campo, { minHeight: 64, textAlignVertical: 'top' }]}
              />
            </Card>

            <SezioneTitolo>Pagamento</SezioneTitolo>
            <Card fitta>
              <RigaInfo
                etichetta={r ? `Paghi ora € ${r.totale_ivato}` : 'Paghi ora'}
                dettaglio="Pagamento di prova: per ora non viene addebitato nulla. Se nessun banco o corriere conferma, il pagamento ti viene rimborsato."
                ultima
              />
            </Card>

            <Bottone
              titolo={r ? `Paga € ${r.totale_ivato} e invia la richiesta` : 'Paga e invia la richiesta'}
              onPress={inviaRichiesta}
              disabilitato={!r || !r.raggiunto || riepilogo.isFetching || riepilogo.inAttesa}
              inCorso={invio}
            />
            {r ? (
              <Text style={[stili.notaCentro, { color: c.grigio }]}>
                I distributori rispondono entro {r.minuti_risposta} minuti. Appena un corriere prende la consegna ti arriva la
                conferma dell'ordine con il tempo stimato: non devi scegliere né confermare altro.
              </Text>
            ) : null}
            <Bottone titolo="Continua a scegliere" tipo="chiaro" onPress={() => router.navigate('/')} />
          </View>
        }
      />
    </KeyboardAvoidingView>
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
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15, marginBottom: 6 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo },
  aiuto: { fontFamily: FONT.testo, fontSize: 13, marginTop: 8 },
  notaCentro: { fontFamily: FONT.testo, fontSize: 13, textAlign: 'center', marginTop: -4 },
});
