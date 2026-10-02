import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { chiamaApi, ErroreApi } from '@/api';
import { informa } from '@/componenti/dialoghi';
import { Caricamento, Errore } from '@/componenti/Stato';
import { Avviso, Bottone, Card, Forte, mmss, Nota, RigaArticolo, RigaInfo, RigaRiepilogo, SezioneTitolo } from '@/componenti/ui';
import { useContoAllaRovescia, useRiepilogoOfferta } from '@/dati';
import { FONT, useTema } from '@/tema';

// Riepilogo dell'ordine con il distributore scelto, come /richieste/:id/offerta/:d sul sito:
// consegna o ritiro, destinazione, note, totali, e "Invia l'ordine".
export default function RiepilogoOrdine() {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const { richiesta, distributore } = useLocalSearchParams<{ richiesta: string; distributore: string }>();
  const richiestaId = Number(richiesta);
  const distributoreId = Number(distributore);
  const [modalita, setModalita] = useState<'consegna_mezzo_grossista' | 'ritiro'>('consegna_mezzo_grossista');
  const q = useRiepilogoOfferta(richiestaId, distributoreId, modalita);
  const [destinazione, setDestinazione] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [invio, setInvio] = useState(false);
  const secondi = useContoAllaRovescia(q.data?.secondi_scelta, q.dataUpdatedAt);

  // La destinazione parte dall'indirizzo di consegna abituale del cliente (una volta sola:
  // poi resta quello che ha scritto, anche cambiando consegna/ritiro).
  useEffect(() => {
    if (q.data && destinazione === null) setDestinazione(q.data.indirizzo_consegna);
  }, [q.data, destinazione]);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const o = q.data;

  const aggiornaTutto = () =>
    Promise.all([
      clientDati.invalidateQueries({ queryKey: ['richiesta', richiestaId] }),
      // 'all': "Stato ordini" sta sotto questa schermata, non in primo piano: senza, tornandoci
      // si vedrebbe per un attimo la richiesta di prima.
      clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' }),
      clientDati.invalidateQueries({ queryKey: ['storico'] }),
    ]);

  const inviaOrdine = async () => {
    setInvio(true);
    try {
      const { order_id } = await chiamaApi<{ order_id: number }>('/ordini', {
        metodo: 'POST',
        corpo: { request_id: richiestaId, distributor_id: distributoreId, modalita, note, destinazione: destinazione || '' },
      });
      await aggiornaTutto();
      router.replace({ pathname: '/ordini/ordine/[id]', params: { id: String(order_id), nuovo: '1' } });
    } catch (e) {
      await aggiornaTutto();
      if (e instanceof ErroreApi && e.dati?.order_id) {
        // Chiusa nel frattempo (doppio tap o ordine automatico): si mostra l'ordine vero.
        informa('Ordine già assegnato', e.message);
        router.replace({ pathname: '/ordini/ordine/[id]', params: { id: String(e.dati.order_id) } });
      } else {
        informa('Ordine non inviato', e instanceof ErroreApi ? e.message : 'Invio non riuscito, riprova.');
      }
    } finally {
      setInvio(false);
    }
  };

  const campo = [stili.campo, { color: c.testo, borderColor: c.bordo, backgroundColor: c.sfondo }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
        {secondi !== null && secondi > 0 ? (
          <Avviso tipo="attenzione">
            Hai <Forte>{mmss(secondi)}</Forte> per inviare l'ordine. Poi parte da solo verso <Forte>{o.nome_assegnazione}</Forte>,
            con consegna e note predefinite.
          </Avviso>
        ) : secondi === 0 ? (
          <Avviso tipo="attenzione">
            Il tempo per scegliere è scaduto: l'ordine sta per partire verso <Forte>{o.nome_assegnazione}</Forte>.
          </Avviso>
        ) : null}

        <SezioneTitolo>Dettagli dell'ordine</SezioneTitolo>
        <Card fitta>
          <RigaInfo etichetta={o.cliente.ragione_sociale} dettaglio={o.cliente.telefono || 'Telefono non impostato'} />
          <RigaInfo etichetta={o.distributore.nome} dettaglio={[o.distributore.filiale, `zona ${o.distributore.zona}`].filter(Boolean).join(' · ')} />
          <RigaInfo
            etichetta={'Partenza ordine stimata: ' + o.partenza_testo}
            dettaglio={`Consegna stimata in ${o.consegna_testo} — tempi dichiarati dal banco`}
            ultima
          />
        </Card>

        {o.mancanti.length ? (
          <Avviso tipo="attenzione">
            <Forte>Disponibilità parziale.</Forte> Questo distributore non copre tutto:{' '}
            {o.mancanti.map((m) => `${m.mancano} pz di ${m.nome}`).join(', ')}. Ordinando qui ricevi solo il materiale
            confermato; per il resto puoi fare una nuova richiesta.
          </Avviso>
        ) : null}

        <SezioneTitolo>Come vuoi ricevere il materiale?</SezioneTitolo>
        <View style={stili.scelta}>
          {(
            [
              ['consegna_mezzo_grossista', 'Consegna in cantiere'],
              ['ritiro', 'Ritiro al banco'],
            ] as const
          ).map(([valore, testo]) => {
            const attiva = modalita === valore;
            return (
              <Pressable
                key={valore}
                onPress={() => setModalita(valore)}
                accessibilityRole="radio"
                accessibilityState={{ checked: attiva }}
                style={[
                  stili.sceltaVoce,
                  { borderColor: attiva ? c.accento : c.bordo, backgroundColor: attiva ? c.accentoChiaro : c.superficie },
                ]}
              >
                <Text style={[stili.sceltaTesto, { color: attiva ? c.accento : c.grigio }]}>{testo}</Text>
              </Pressable>
            );
          })}
        </View>
        <Nota>
          {modalita === 'ritiro'
            ? 'Ritiri tu al banco del distributore: nessun costo di consegna.'
            : o.totali.consegna
              ? `Consegna con mezzo del distributore: € ${o.totali.consegna} + IVA.`
              : 'Consegna con mezzo del distributore inclusa nel prezzo.'}
        </Nota>

        {modalita !== 'ritiro' ? (
          <>
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
          </>
        ) : null}

        <SezioneTitolo>Note per il distributore</SezioneTitolo>
        <Card>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Es. orario preferito, riferimento cantiere..."
            placeholderTextColor={c.grigio}
            multiline
            style={[campo, { minHeight: 64, textAlignVertical: 'top' }]}
          />
        </Card>

        <SezioneTitolo>Come vuoi pagare?</SezioneTitolo>
        <Card fitta>
          <RigaInfo
            etichetta="Alle condizioni concordate con il distributore"
            dettaglio="I metodi di pagamento in app verranno definiti più avanti"
            ultima
          />
        </Card>

        <SezioneTitolo>Riepilogo ordine</SezioneTitolo>
        <Card>
          {o.righe.map((r, i) => (
            <RigaArticolo
              key={i}
              quantita={r.quantita}
              nome={r.nome}
              meta={`Cod. ${r.codice} · € ${r.prezzo} cad. + IVA`}
              importo={r.subtotale}
              ultima={i === o.righe.length - 1}
            />
          ))}
        </Card>
        <Card>
          <RigaRiepilogo voce="Merce (IVA esclusa)" valore={'€ ' + o.totali.merce} />
          {o.totali.raee ? <RigaRiepilogo voce="Contributo RAEE" valore={'€ ' + o.totali.raee} /> : null}
          <RigaRiepilogo voce="Costo di consegna" valore={o.totali.consegna ? '€ ' + o.totali.consegna : 'inclusa'} />
          <RigaRiepilogo voce="Imponibile" valore={'€ ' + o.totali.imponibile} />
          <RigaRiepilogo voce={`IVA ${o.iva_pct}%`} valore={'€ ' + o.totali.iva} />
          <RigaRiepilogo voce="Totale" valore={'€ ' + o.totali.totale_ivato} forte />
        </Card>
        <Nota>
          Premendo <Forte>Invia l'ordine</Forte> confermi il contenuto dell'ordine e i dati inseriti. Il distributore
          riceve la conferma e prepara il materiale.
        </Nota>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={[stili.barra, { backgroundColor: c.superficie, borderTopColor: c.bordo }]}>
        <Bottone titolo={`Invia l'ordine · € ${o.totali.totale_ivato}`} onPress={inviaOrdine} inCorso={invio} disabilitato={q.isFetching} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 24 },
  scelta: { flexDirection: 'row', gap: 8 },
  sceltaVoce: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  sceltaTesto: { fontFamily: FONT.testoMedio, fontSize: 15 },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15, marginBottom: 6 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo },
  aiuto: { fontFamily: FONT.testo, fontSize: 13, marginTop: 8 },
  barra: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
