import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, type Richiesta } from '../api';
import { useContoAllaRovescia, useRichiesta } from '../dati';
import { FONT, useTema } from '../tema';
import { chiedi, informa } from './dialoghi';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, mmss, Nota, RigaArticolo, SezioneTitolo, StatoBadge } from './ui';
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
            {r.filiale ? <Text style={[stili.meta, { color: c.grigio }]}>{r.filiale}</Text> : null}
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

// Una richiesta pagata, in qualunque stato: attesa di banchi e corrieri (con conto alla rovescia),
// chiusa senza ordine (pagamento rimborsato) o annullata. Appena l'ordine nasce (corriere trovato) mostra
// direttamente l'ordine, con il banner di conferma. Si aggiorna da sola ogni pochi secondi finché è aperta.
// dopoEliminazione: dove andare quando la richiesta non esiste più (una pagina aperta dallo
// storico torna indietro; "Stato ordini" invece si ridisegna da sola).
// quandoChiusa: chiamata appena il server conferma un annullamento o un'eliminazione, prima
// di ricaricare i dati ("Stato ordini" ci mostra "Nessun ordine in corso").
export function VistaRichiesta({
  id,
  dopoEliminazione,
  quandoChiusa,
}: {
  id: number;
  dopoEliminazione?: () => void;
  quandoChiusa?: () => void;
}) {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const q = useRichiesta(id);
  const [azione, setAzione] = useState<string | null>(null);
  const secondi = useContoAllaRovescia(q.data?.stato === 'in_attesa' ? q.data.secondi : null, q.dataUpdatedAt);
  // Se questa schermata ha visto la richiesta "in attesa" e poi è nato l'ordine, l'installatore era qui
  // ad aspettare: gli si mostra il banner "Ordine confermato".
  const vistaInAttesa = useRef(false);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const r = q.data;
  if (r.stato === 'in_attesa') vistaInAttesa.current = true;
  if (r.stato === 'ordinata' && r.order_id) {
    return <VistaOrdine id={r.order_id} nuovo={vistaInAttesa.current} dopoEliminazione={dopoEliminazione} quandoChiusa={quandoChiusa} />;
  }

  // eliminata: la richiesta non esiste più, quindi non si rilegge (darebbe "non trovata") e si
  // esce dalla schermata solo dopo aver aggiornato "Stato ordini", non prima.
  const esegui = async (nome: string, fn: () => Promise<unknown>, eliminata = false) => {
    setAzione(nome);
    try {
      await fn();
      await Promise.all([
        eliminata
          ? clientDati.cancelQueries({ queryKey: ['richiesta', id] })
          : clientDati.invalidateQueries({ queryKey: ['richiesta', id] }),
        // 'all': la scheda "Stato ordini" può essere sotto questa schermata, non in primo piano.
        clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' }),
        clientDati.invalidateQueries({ queryKey: ['storico'] }),
      ]);
      if (eliminata) dopoEliminazione?.();
    } catch (e) {
      informa('Operazione non riuscita', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const annulla = () =>
    chiedi('Annullare la richiesta?', 'Il pagamento ti verrà rimborsato.', 'Annulla richiesta', () =>
      esegui('annulla', async () => {
        // ok: false = non più annullabile (l'ordine è nato un istante prima): si ricarica e si
        // vede l'ordine, senza dire "nessun ordine in corso".
        const { ok } = await chiamaApi<{ ok: boolean }>(`/richieste/${id}/annulla`, { metodo: 'POST' });
        if (ok) quandoChiusa?.();
      })
    , true);
  const elimina = () =>
    chiedi('Eliminare definitivamente?', 'Sparirà anche per i venditori.', 'Elimina', () =>
      esegui(
        'elimina',
        async () => {
          await chiamaApi(`/richieste/${id}`, { metodo: 'DELETE' });
          quandoChiusa?.();
        },
        true
      )
    , true);
  const reinvia = () => esegui('reinvia', () => chiamaApi(`/richieste/${id}/reinvia`, { metodo: 'POST' }));

  const rimborsato = r.pagamento?.stato === 'rimborsato';

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
              I distributori hanno {r.minuti_risposta} minuti per confermare la disponibilità del materiale e trovare chi
              consegna. Appena è tutto pronto ti arriva la conferma dell'ordine con il tempo stimato: questa schermata si
              aggiorna da sola.
            </Text>
            {r.pagamento?.stato === 'pagato' ? (
              <Text style={[stili.attesaTesto, { color: c.grigio }]}>
                Hai pagato € {r.pagamento.importo}. Se nessuno conferma in tempo, ti viene rimborsato.
              </Text>
            ) : null}
          </Card>
          <SezioneTitolo>Distributori interpellati</SezioneTitolo>
          <Distributori risposte={r.risposte} />
          <Nota>
            Se un distributore non risponde entro i {r.minuti_risposta} minuti la richiesta risulta non confermata: il
            materiale potrebbe esserci ma non essere reperibile al banco. Se la richiesta si chiude senza ordine, il
            pagamento ti torna.
          </Nota>
        </>
      ) : (
        <>
          {r.stato === 'annullata' ? (
            <Avviso tipo="attenzione">
              Hai annullato questa richiesta.{rimborsato && r.pagamento ? ` Il pagamento di € ${r.pagamento.importo} è stato rimborsato.` : ''}
            </Avviso>
          ) : (
            <Avviso tipo="attenzione">
              Nessun distributore ha confermato la consegna entro i {r.minuti_risposta} minuti. La mancata risposta non
              vale come disponibilità: il materiale potrebbe esserci ma non essere reperibile al banco.
              {rimborsato && r.pagamento ? ` Il pagamento di € ${r.pagamento.importo} è stato rimborsato.` : ''}
            </Avviso>
          )}
          {r.risposte.length ? (
            <>
              <SezioneTitolo>Distributori interpellati</SezioneTitolo>
              <Distributori risposte={r.risposte} />
            </>
          ) : null}
        </>
      )}

      <SezioneTitolo>Materiale richiesto</SezioneTitolo>
      <Materiale righe={r.righe} />
      <Nota>Prezzi IVA esclusa, già comprensivi del servizio. Richiesta del {r.creato_il}.</Nota>

      {r.stato === 'nessuna_offerta' ? (
        <Bottone
          titolo={r.pagamento ? `Reinvia richiesta · paghi di nuovo € ${r.pagamento.importo}` : 'Reinvia richiesta'}
          onPress={reinvia}
          inCorso={azione === 'reinvia'}
        />
      ) : null}
      {r.stato === 'in_attesa' ? (
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
});
