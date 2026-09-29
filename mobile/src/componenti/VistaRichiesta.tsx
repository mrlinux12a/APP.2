import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, type Offerta, type Richiesta } from '../api';
import { useContoAllaRovescia, useRichiesta } from '../dati';
import { FONT, RAGGIO, useTema } from '../tema';
import { chiedi, informa } from './dialoghi';
import { Icona } from './Icona';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, Forte, mmss, Nota, RigaArticolo, SezioneTitolo, StatoBadge } from './ui';
import { VistaOrdine } from './VistaOrdine';

function tonoEsito(esito: string) {
  return esito === 'confermato' ? 'ok' : esito === 'in_attesa' ? 'info' : 'ko';
}

function Distributori({ risposte }: { risposte: Richiesta['risposte'] }) {
  const { c } = useTema();
  return (
    <Card fitta>
      {risposte.map((r, i) => (
        <View
          key={r.distributore}
          style={[stili.pill, { borderBottomColor: c.bordo, borderBottomWidth: i < risposte.length - 1 ? StyleSheet.hairlineWidth : 0 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[stili.pillNome, { color: c.testo }]}>{r.distributore}</Text>
            <Text style={[stili.meta, { color: c.grigio }]}>{r.filiale}</Text>
          </View>
          <StatoBadge testo={r.esito_testo} tono={tonoEsito(r.esito)} />
        </View>
      ))}
    </Card>
  );
}

function Materiale({ righe }: { righe: Richiesta['righe'] }) {
  return (
    <Card>
      {righe.map((r, i) => (
        <RigaArticolo key={i} quantita={r.quantita} nome={r.nome} meta={'Cod. ' + r.codice} ultima={i === righe.length - 1} />
      ))}
    </Card>
  );
}

function SchedaOfferta({ o, richiestaId }: { o: Offerta; richiestaId: number }) {
  const { c } = useTema();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/ordini/offerta', params: { richiesta: String(richiestaId), distributore: String(o.distributore_id) } })
      }
      style={({ pressed }) => [
        stili.offerta,
        { backgroundColor: c.superficie, borderColor: o.piu_conveniente ? c.verde : c.bordo, opacity: pressed ? 0.85 : 1 },
        o.piu_conveniente && { borderWidth: 2 },
      ]}
    >
      <View style={stili.offertaTesta}>
        <View style={{ flex: 1 }}>
          <Text style={[stili.offertaNome, { color: c.testo }]}>{o.distributore}</Text>
          <Text style={[stili.meta, { color: c.grigio }]}>{o.filiale}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[stili.offertaValore, { color: c.accento }]}>€ {o.imponibile}</Text>
          <Text style={[stili.meta, { color: c.grigio }]}>+ IVA</Text>
        </View>
      </View>
      <View style={stili.offertaRiga}>
        <StatoBadge testo={o.copertura === 'totale' ? 'Disponibilità totale' : 'Disponibilità parziale'} tono={o.copertura === 'totale' ? 'ok' : 'attesa'} />
      </View>
      {o.copertura === 'parziale' ? (
        <Text style={[stili.offertaTesto, stili.offertaTestoSolo, { color: c.rosso }]}>
          Mancano {o.mancanti.map((m) => `${m.mancano} pz di ${m.nome}`).join(', ')}
        </Text>
      ) : null}
      <View style={stili.offertaRiga}>
        <Icona nome="orario" colore={c.testo} dimensione={18} />
        <Text style={[stili.offertaTesto, { color: c.testo }]}>Parte dalla filiale entro {o.partenza_testo}</Text>
      </View>
      <View style={stili.offertaRiga}>
        <Icona nome="consegna" colore={c.testo} dimensione={18} />
        <Text style={[stili.offertaTesto, { color: c.testo }]}>
          Da te in <Forte>{o.arrivo_testo}</Forte>
        </Text>
        {o.piu_veloce ? <StatoBadge testo="più veloce" tono="ok" /> : null}
      </View>
      <View style={stili.offertaRiga}>
        <Icona nome="ordini" colore={c.testo} dimensione={18} />
        <Text style={[stili.offertaTesto, { color: c.testo }]}>
          Merce € {o.merce} + IVA · {o.consegna ? 'consegna € ' + o.consegna : 'consegna inclusa'}
        </Text>
      </View>
      {o.note ? (
        <View style={stili.offertaRiga}>
          <Icona nome="nota" colore={c.testo} dimensione={18} />
          <Text style={[stili.offertaTesto, { color: c.testo }]}>{o.note}</Text>
        </View>
      ) : null}
      {o.piu_conveniente ? <Text style={[stili.offertaTesto, stili.offertaTestoSolo, { color: c.verde, fontFamily: FONT.testoForte }]}>✓ Offerta più conveniente</Text> : null}
      <View style={[stili.offertaPiede, { borderTopColor: c.bordo }]}>
        <Text style={[stili.offertaPiedeTesto, { color: c.accento }]}>Procedi con l'ordine</Text>
        <Text style={[stili.offertaPiedeTesto, { color: c.accento }]}>›</Text>
      </View>
    </Pressable>
  );
}

// Una richiesta di disponibilità, in qualunque stato: attesa delle risposte (con conto alla
// rovescia), offerte da scegliere, scaduta, annullata. Se è già diventata un ordine mostra
// direttamente l'ordine. Si aggiorna da sola ogni pochi secondi finché è aperta.
// dopoEliminazione: dove andare quando la richiesta non esiste più (una pagina aperta dallo
// storico torna indietro; "Stato ordini" invece si ridisegna da sola).
export function VistaRichiesta({ id, dopoEliminazione }: { id: number; dopoEliminazione?: () => void }) {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const q = useRichiesta(id);
  const [azione, setAzione] = useState<string | null>(null);
  const secondi = useContoAllaRovescia(q.data?.stato === 'in_attesa' ? q.data.secondi : null, q.dataUpdatedAt);
  const secondiScelta = useContoAllaRovescia(q.data?.stato === 'con_offerte' ? q.data.secondi_scelta : null, q.dataUpdatedAt);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const r = q.data;
  if (r.stato === 'ordinata' && r.order_id) return <VistaOrdine id={r.order_id} dopoEliminazione={dopoEliminazione} />;

  const esegui = async (nome: string, fn: () => Promise<unknown>) => {
    setAzione(nome);
    try {
      await fn();
      await Promise.all([
        clientDati.invalidateQueries({ queryKey: ['richiesta', id] }),
        clientDati.invalidateQueries({ queryKey: ['stato-ordini'] }),
        clientDati.invalidateQueries({ queryKey: ['storico'] }),
      ]);
    } catch (e) {
      informa('Operazione non riuscita', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const annulla = () =>
    chiedi('Annullare la richiesta?', 'I distributori non potranno più confermare.', 'Annulla richiesta', () =>
      esegui('annulla', () => chiamaApi(`/richieste/${id}/annulla`, { metodo: 'POST' }))
    , true);
  const elimina = () =>
    chiedi('Eliminare definitivamente?', 'Sparirà anche per i venditori.', 'Elimina', () =>
      esegui('elimina', async () => {
        await chiamaApi(`/richieste/${id}`, { metodo: 'DELETE' });
        dopoEliminazione?.();
      })
    , true);
  const reinvia = () => esegui('reinvia', () => chiamaApi(`/richieste/${id}/reinvia`, { metodo: 'POST' }));

  const altri = r.risposte.filter((x) => x.esito !== 'confermato');

  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      {r.stato === 'in_attesa' ? (
        <>
          <Card stile={stili.attesa}>
            <View style={[stili.cerchio, { borderColor: c.accentoChiaro, backgroundColor: c.superficie }]}>
              <Text style={[stili.cerchioTesto, { color: c.accento }]}>{mmss(secondi ?? r.secondi)}</Text>
            </View>
            <Text style={[stili.attesaTitolo, { color: c.testo }]}>Stiamo chiedendo al banco</Text>
            <Text style={[stili.attesaTesto, { color: c.grigio }]}>
              I distributori hanno {r.minuti_risposta} minuti per confermare la disponibilità del materiale. Questa
              schermata si aggiorna da sola appena rispondono.
            </Text>
          </Card>
          <SezioneTitolo>Distributori interpellati</SezioneTitolo>
          <Distributori risposte={r.risposte} />
          <Nota>
            Se un distributore non risponde entro i {r.minuti_risposta} minuti la richiesta risulta non confermata: il
            materiale potrebbe esserci ma non essere reperibile al banco.
          </Nota>
        </>
      ) : (
        <>
          {r.stato === 'annullata' ? (
            <Avviso tipo="attenzione">Hai annullato questa richiesta.</Avviso>
          ) : r.stato === 'nessuna_offerta' && r.offerte_scadute ? (
            <Avviso tipo="attenzione">
              Le offerte sono scadute senza che venisse scelto un distributore, quindi nessun ordine è partito. Puoi
              reinviare la richiesta per avere conferme aggiornate.
            </Avviso>
          ) : !r.offerte.length ? (
            <Avviso tipo="attenzione">
              Nessun distributore ha confermato la disponibilità entro i {r.minuti_risposta} minuti. La mancata risposta
              non vale come disponibilità: il materiale potrebbe esserci ma non essere reperibile al banco.
            </Avviso>
          ) : (
            <Avviso tipo="ok">
              <Forte>{r.offerte.length}</Forte>{' '}
              {r.offerte.length === 1 ? 'distributore ha confermato' : 'distributori hanno confermato'} la disponibilità.
              Scegli con chi ordinare.
            </Avviso>
          )}
          {r.stato === 'con_offerte' && secondiScelta !== null ? (
            secondiScelta > 0 ? (
              <Avviso tipo="attenzione">
                Hai <Forte>{mmss(secondiScelta)}</Forte> per scegliere. Se non scegli, l'ordine parte da solo verso{' '}
                <Forte>{r.nome_assegnazione}</Forte> (consegna più veloce tra chi copre tutto il materiale).
              </Avviso>
            ) : (
              <Avviso tipo="attenzione">
                Il tempo per scegliere è scaduto: l'ordine sta per partire verso <Forte>{r.nome_assegnazione}</Forte>.
              </Avviso>
            )
          ) : null}
          {r.offerte.map((o) => (
            <SchedaOfferta key={o.distributore_id} o={o} richiestaId={r.id} />
          ))}
          {altri.length ? (
            <>
              <SezioneTitolo>Altri distributori interpellati</SezioneTitolo>
              <Distributori risposte={altri} />
            </>
          ) : null}
        </>
      )}

      <SezioneTitolo>Materiale richiesto</SezioneTitolo>
      <Materiale righe={r.righe} />
      <Nota>Prezzi IVA esclusa, già comprensivi del servizio. Richiesta del {r.creato_il}.</Nota>

      {r.stato === 'nessuna_offerta' ? (
        <Bottone titolo="Reinvia richiesta" onPress={reinvia} inCorso={azione === 'reinvia'} />
      ) : null}
      {r.stato === 'in_attesa' || r.stato === 'con_offerte' ? (
        <Bottone titolo="Annulla la richiesta" tipo="chiaro" onPress={annulla} inCorso={azione === 'annulla'} />
      ) : null}
      <Bottone titolo="Elimina definitivamente" tipo="rosso" onPress={elimina} inCorso={azione === 'elimina'} />
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 32 },
  meta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
  attesa: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 16 },
  cerchio: {
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cerchioTesto: { fontFamily: FONT.titolo, fontSize: 26 },
  attesaTitolo: { fontFamily: FONT.titolo, fontSize: 17 },
  attesaTesto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  pillNome: { fontFamily: FONT.testoMedio, fontSize: 15 },
  offerta: { borderWidth: 1, borderRadius: RAGGIO, padding: 14 },
  offertaTesta: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  offertaNome: { fontFamily: FONT.titolo, fontSize: 17 },
  offertaValore: { fontFamily: FONT.titoloForte, fontSize: 18 },
  offertaRiga: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  offertaTesto: { fontFamily: FONT.testo, fontSize: 15, flexShrink: 1 },
  offertaTestoSolo: { marginTop: 10 },
  offertaPiede: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  offertaPiedeTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
});
