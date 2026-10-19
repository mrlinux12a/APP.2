import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, type Richiesta } from '../api';
import { useContoAllaRovescia, useRichiesta } from '../dati';
import { completaInvio, type RispostaInvio } from '../pagamento';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { chiedi, informa } from './dialoghi';
import { Pagamenti } from './Pagamenti';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, mmss, Nota, RigaArticolo, SezioneTitolo, StatoBadge } from './ui';
import { VistaOrdine } from './VistaOrdine';

function tonoEsito(esito: string) {
  return esito === 'confermato' ? 'ok' : esito === 'in_attesa' ? 'info' : 'ko';
}

// Per l'installatore un banco che sta controllando "sta verificando" (non "in attesa").
function testoEsito(r: Richiesta['risposte'][number]) {
  return r.esito === 'in_attesa' ? 'Sta verificando' : r.esito_testo;
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
          <StatoBadge testo={testoEsito(r)} tono={tonoEsito(r.esito)} />
        </View>
      ))}
    </Card>
  );
}

// Il materiale richiesto, a prezzo del banco (come sul sito): "Cod. … · € cad.", e sotto "Merce · IVA esclusa".
function Materiale({ r }: { r: Richiesta }) {
  return (
    <Card>
      {r.righe_prezzi.map((x, i) => (
        <RigaArticolo
          key={i}
          quantita={x.quantita}
          nome={x.nome}
          meta={`Cod. ${x.codice} · € ${x.cad} cad.`}
          importo={x.totale}
          ultima={i === r.righe_prezzi.length - 1}
        />
      ))}
    </Card>
  );
}

// Una richiesta, in qualunque stato: verifica della disponibilità (con conto alla rovescia), chiusa senza ordine (nessun addebito) o annullata. Appena
// nasce l'ordine (corriere trovato) mostra direttamente l'ordine, con il banner di conferma. Si aggiorna da sola ogni pochi secondi finché è aperta.
// dopoEliminazione: dove andare quando la richiesta non esiste più (una pagina aperta dallo storico torna indietro; "Stato ordini" invece si ridisegna da sola).
// quandoChiusa: chiamata appena il server conferma un annullamento o un'eliminazione, prima di ricaricare i dati ("Stato ordini" ci mostra
// "Nessun ordine in corso").
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
  const { utente } = useSessione();
  const clientDati = useQueryClient();
  const q = useRichiesta(id);
  const [azione, setAzione] = useState<string | null>(null);
  const secondi = useContoAllaRovescia(q.data?.stato === 'in_attesa' ? q.data.secondi : null, q.dataUpdatedAt);
  // Se questa schermata ha visto la richiesta "in attesa" e poi è nato l'ordine, l'installatore era qui ad aspettare: gli si mostra il banner "Ordine confermato".
  const vistaInAttesa = useRef(false);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const r = q.data;
  if (r.stato === 'in_attesa') vistaInAttesa.current = true;
  if (r.stato === 'ordinata' && r.order_id) {
    return <VistaOrdine id={r.order_id} nuovo={vistaInAttesa.current} />;
  }

  // eliminata: la richiesta non esiste più, quindi non si rilegge (darebbe "non trovata") e si esce dalla schermata solo dopo aver aggiornato "Stato ordini".
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
        clientDati.invalidateQueries({ queryKey: ['materiale'] }),
      ]);
      if (eliminata) dopoEliminazione?.();
    } catch (e) {
      informa('Operazione non riuscita', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const annulla = () =>
    chiedi(
      'Annullare la richiesta?',
      'Nessun banco ha ancora confermato: il blocco sulla carta viene tolto e non paghi niente.',
      'Annulla richiesta',
      () =>
        esegui('annulla', async () => {
          // ok: false = non più annullabile (un banco ha confermato un istante prima): si ricarica e si vede com'è andata.
          const { ok } = await chiamaApi<{ ok: boolean }>(`/richieste/${id}/annulla`, { metodo: 'POST' });
          if (ok) quandoChiusa?.();
          else informa('Non più annullabile', 'Un banco ha appena confermato: la richiesta prosegue e non si può più annullare.');
        }),
      true
    );
  const elimina = () =>
    chiedi(
      'Eliminare definitivamente?',
      'La richiesta sparirà dallo storico.',
      'Elimina',
      () =>
        esegui(
          'elimina',
          async () => {
            await chiamaApi(`/richieste/${id}`, { metodo: 'DELETE' });
            quandoChiusa?.();
          },
          true
        ),
      true
    );
  // "Rinvia richiesta": con la carta vera si blocca di nuovo la consegna (foglio di pagamento), con il pagamento di prova riparte subito.
  const reinvia = () =>
    esegui('reinvia', async () => {
      const risposta = await chiamaApi<RispostaInvio>(`/richieste/${id}/reinvia`, { metodo: 'POST' });
      await completaInvio(risposta, utente?.ragione_sociale);
    });

  const bancoConfermato = r.risposte.some((x) => x.banco_confermato);

  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      {r.stato === 'in_attesa' ? (
        <>
          <Card stile={stili.attesa}>
            <View style={[stili.cerchio, { borderColor: c.accentoChiaro, backgroundColor: c.superficie }]}>
              <Text style={[stili.cerchioTesto, { color: c.accento }]}>{mmss(secondi ?? r.secondi)}</Text>
            </View>
            <Text style={[stili.attesaTitolo, { color: c.testo }]}>Verifica disponibilità</Text>
            <Text style={[stili.attesaTesto, { color: c.grigio }]}>
              {r.ditta || 'Il banco'} ha {r.minuti_risposta} minuti per confermare il materiale e trovare chi consegna. Appena è tutto pronto ti arriva la
              conferma dell’ordine con il tempo stimato: questa schermata si aggiorna da sola.
            </Text>
          </Card>
          <SezioneTitolo>Banco interpellato</SezioneTitolo>
          <Distributori risposte={r.risposte} />
        </>
      ) : r.stato === 'annullata' ? (
        <Avviso tipo="attenzione">Hai annullato questa richiesta.</Avviso>
      ) : (
        <Card stile={stili.attesa}>
          <View style={[stili.cerchio, { borderColor: c.rossoChiaro, backgroundColor: c.superficie }]}>
            <Text style={[stili.cerchioTesto, { color: c.grigio }]}>00:00</Text>
          </View>
          <Text style={[stili.attesaTitolo, { color: c.testo }]}>{bancoConfermato ? 'Nessun corriere ha confermato' : 'Nessun banco ha confermato'}</Text>
          <Text style={[stili.attesaTesto, { color: c.grigio }]}>Il tempo per rispondere è scaduto.</Text>
          <View style={{ marginTop: 10 }}>
            <StatoBadge testo="Nessun addebito sulla carta" tono="ok" />
          </View>
        </Card>
      )}

      {r.stato === 'nessuna_offerta' && r.risposte.length ? (
        <>
          <SezioneTitolo>Banco interpellato</SezioneTitolo>
          <Distributori risposte={r.risposte} />
        </>
      ) : null}

      <SezioneTitolo>Materiale richiesto</SezioneTitolo>
      <Materiale r={r} />
      <Nota>Merce · IVA esclusa: € {r.importi.materiale.imponibile}. Prezzi del banco. Richiesta del {r.creato_il}.</Nota>

      <Pagamenti
        importi={r.importi}
        stato={r.stato_pagamento}
        fallback={r.stato === 'in_attesa' ? 'attesa' : 'chiusa'}
        ditta={r.ditta}
        motivoChiusura={r.stato === 'annullata' ? 'annullata' : 'banco'}
        rinvio={r.stato === 'nessuna_offerta' ? r.rinvio : undefined}
      />

      {r.stato === 'nessuna_offerta' ? <Bottone titolo="Rinvia richiesta" onPress={reinvia} inCorso={azione === 'reinvia'} /> : null}
      {/* Si annulla solo finché nessun banco ha accettato: poi il pulsante sparisce (anche dalla lettura periodica). */}
      {r.annullabile ? <Bottone titolo="Annulla la richiesta" tipo="chiaro" onPress={annulla} inCorso={azione === 'annulla'} /> : null}
      {r.stato !== 'in_attesa' ? <Bottone titolo="Elimina richiesta" tipo="rosso" onPress={elimina} inCorso={azione === 'elimina'} /> : null}
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
