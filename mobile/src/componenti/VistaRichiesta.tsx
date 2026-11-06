import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, type Richiesta } from '../api';
import { useContoAllaRovescia, useRichiesta } from '../dati';
import { completaInvio, type RispostaInvio } from '../pagamento';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { AnelloAtt, BadgeBanco, CardAtt, ChipNo, ChipOk, LinkRosso, PallinoAllarme, PassiAtt, PillolaOk, PulsanteBlu, SchedaBanco, SchedaConsegna, SchedaMateriale, SottoAtt, stileTimer, TempoAnello, TitoloAtt } from './att';
import { chiedi, informa } from './dialoghi';
import { Pagamenti } from './Pagamenti';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, mmss, SezioneTitolo, StatoBadge } from './ui';
import { VistaOrdine } from './VistaOrdine';

// Il testo del badge di un banco mentre la richiesta è in attesa (come #stato-distributori del sito).
function testoBancoAttesa(esito: string) {
  return esito === 'in_attesa' ? 'Sta verificando' : esito === 'confermato' ? 'Disponibile' : esito === 'non_disponibile' ? 'Non disponibile' : 'Nessuna risposta';
}

// Il materiale richiesto a prezzo del banco (righe + "Merce · IVA esclusa · prezzi del banco"): la scheda "Materiale richiesto" delle pagine della richiesta.
function Materiale({ r }: { r: Richiesta }) {
  return (
    <SchedaMateriale
      occhiello="Materiale richiesto"
      righe={r.righe_prezzi}
      etichettaMerce="Merce · IVA esclusa · prezzi del banco"
      merce={r.importi.materiale.imponibile}
    />
  );
}

// "Distributori interpellati" della richiesta annullata (l'unica pagina che ha ancora l'elenco in forma di riga, come sul sito).
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
          </View>
          <StatoBadge
            testo={r.esito === 'non_disponibile' ? 'Non disponibile' : r.esito === 'in_attesa' ? 'In attesa' : r.esito === 'confermato' ? 'Disponibile' : 'Nessuna risposta'}
            tono={r.esito === 'confermato' ? 'ok' : r.esito === 'in_attesa' ? 'info' : 'ko'}
          />
        </View>
      ))}
    </Card>
  );
}

// Una richiesta, in qualunque stato: verifica della disponibilità (con conto alla rovescia), chiusa senza ordine (nessun addebito) o annullata. Appena
// nasce l'ordine (corriere trovato) mostra direttamente l'ordine in consegna. Si aggiorna da sola ogni pochi secondi finché è aperta.
// dopoEliminazione: dove andare quando la richiesta non esiste più (una pagina aperta dallo storico torna indietro; "Stato ordini" invece si ridisegna da sola).
// quandoChiusa: chiamata appena il server conferma un annullamento o un'eliminazione, prima di ricaricare i dati ("Stato ordini" ci mostra
// "Nessun ordine in corso").
// compatta: la pagina sta sotto la striscia di "Stato ordini" (due o più attività), quindi anello e scheda in alto sono più piccoli.
export function VistaRichiesta({
  id,
  dopoEliminazione,
  quandoChiusa,
  compatta,
}: {
  id: number;
  dopoEliminazione?: () => void;
  quandoChiusa?: () => void;
  compatta?: boolean;
}) {
  const { c } = useTema();
  const { utente } = useSessione();
  const clientDati = useQueryClient();
  const q = useRichiesta(id);
  const [azione, setAzione] = useState<string | null>(null);
  const secondi = useContoAllaRovescia(q.data?.stato === 'in_attesa' ? q.data.secondi : null, q.dataUpdatedAt);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const r = q.data;
  // Nata l'ordine (corriere trovato) la pagina diventa direttamente quella dell'ordine in consegna, come sul sito.
  if (r.stato === 'ordinata' && r.order_id) {
    return <VistaOrdine id={r.order_id} compatta={compatta} />;
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

  // Il banco ha accettato ma nessun corriere ha preso la consegna in tempo: la causa è il corriere, non il banco (come richiesta_chiusa.ejs).
  const senzaCorriere = r.risposte.some((x) => x.banco_confermato && x.esito === 'scaduto');
  const pagamentoAnnullato = r.stato_pagamento?.chiave === 'annullato';

  // ---- 1. In attesa: anello che si svuota, banchi interpellati, materiale, pagamenti, annulla ----
  if (r.stato === 'in_attesa') {
    const restano = secondi ?? r.secondi;
    const durata = r.durata > 0 ? r.durata : r.minuti_risposta * 60;
    return (
      <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
        <CardAtt stile={stileTimer(compatta)}>
          <AnelloAtt frazione={durata > 0 ? restano / durata : 0} tono="arancio" compatto={compatta}>
            <TempoAnello testo={mmss(restano)} compatto={compatta} />
          </AnelloAtt>
          <TitoloAtt testo="Stiamo chiedendo al banco" tono="arancio" />
          <PassiAtt
            tono="arancio"
            passi={[
              { etichetta: 'Inviata', stato: 'fatto' },
              { etichetta: 'Conferma banco', stato: 'corrente' },
              { etichetta: 'In consegna', stato: 'dafare' },
            ]}
          />
        </CardAtt>

        {r.risposte.map((x) => (
          <SchedaBanco key={x.distributore} occhiello="Banco interpellato" nome={x.distributore} destra={<BadgeBanco testo={testoBancoAttesa(x.esito)} esito={x.esito} />} />
        ))}

        {/* L'indirizzo mandato con la richiesta, subito sotto il banco (come sul sito, in ogni fase). */}
        <SchedaConsegna indirizzo={r.destinazione} />

        <Materiale r={r} />

        <Pagamenti importi={r.importi} stato={r.stato_pagamento} fallback="attesa" ditta={r.ditta} />

        {/* Si annulla solo finché nessun banco ha accettato: poi il link sparisce (anche dalla lettura periodica). */}
        {r.annullabile ? <LinkRosso titolo="Annulla la richiesta" onPress={annulla} disabilitato={azione === 'annulla'} /> : null}
      </ScrollView>
    );
  }

  // ---- 2. Chiusa senza risposta: anello vuoto rosso, banchi, materiale, pagamenti, Rinvia, Elimina ----
  if (r.stato === 'nessuna_offerta') {
    return (
      <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
        <CardAtt stile={stileTimer(compatta)}>
          <AnelloAtt frazione={0} tono="rosso" senzaArco compatto={compatta}>
            <TempoAnello testo="00:00" spento compatto={compatta} />
            <PallinoAllarme compatto={compatta} />
          </AnelloAtt>
          <TitoloAtt testo={senzaCorriere ? 'Nessun corriere ha confermato' : 'Nessun banco ha confermato'} tono="rosso" />
          <SottoAtt spazio={14}>Il tempo per rispondere è scaduto.</SottoAtt>
          {/* La carta era solo bloccata: il blocco si annulla, non c'è nessun rimborso da aspettare. */}
          {pagamentoAnnullato ? <PillolaOk testo="Nessun addebito sulla carta" /> : null}
          <PassiAtt
            tono="rosso"
            passi={[
              { etichetta: 'Inviata', stato: 'fatto' },
              { etichetta: 'Nessuna risposta', stato: 'corrente', croce: true },
              { etichetta: 'In consegna', stato: 'dafare' },
            ]}
          />
        </CardAtt>

        {r.risposte.map((x) => (
          <SchedaBanco
            key={x.distributore}
            occhiello="Banco interpellato"
            nome={x.distributore}
            destra={
              x.esito === 'confermato' || (x.banco_confermato && x.esito === 'scaduto') ? (
                <ChipOk testo="Disponibile" />
              ) : (
                <ChipNo testo={x.esito === 'non_disponibile' ? 'Non disponibile' : 'Nessuna risposta'} />
              )
            }
          />
        ))}

        <SchedaConsegna indirizzo={r.destinazione} />

        <Materiale r={r} />

        <Pagamenti
          importi={r.importi}
          stato={r.stato_pagamento}
          fallback="chiusa"
          ditta={r.ditta}
          motivoChiusura={senzaCorriere ? 'corriere' : 'banco'}
          rinvio={r.rinvio}
        />

        <PulsanteBlu titolo="Rinvia richiesta" icona="riprova" onPress={reinvia} disabilitato={azione !== null} />
        <LinkRosso titolo="Elimina richiesta" forte onPress={elimina} disabilitato={azione !== null} />
      </ScrollView>
    );
  }

  // ---- 3. Annullata dall'installatore ----
  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      <Avviso tipo="attenzione">Hai annullato questa richiesta.{pagamentoAnnullato ? ' Nessun addebito sulla carta.' : ''}</Avviso>

      {r.risposte.length ? (
        <>
          <SezioneTitolo>Distributori interpellati</SezioneTitolo>
          <Distributori risposte={r.risposte} />
        </>
      ) : null}

      <SchedaConsegna indirizzo={r.destinazione} />

      <Materiale r={r} />

      <Pagamenti importi={r.importi} stato={r.stato_pagamento} fallback="chiusa" ditta={r.ditta} motivoChiusura="annullata" />

      <Bottone titolo="Torna alla home" onPress={() => router.navigate('/')} />
      <Bottone titolo="Elimina richiesta" tipo="rosso" onPress={elimina} inCorso={azione === 'elimina'} />
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 32 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  pillNome: { fontFamily: FONT.testoMedio, fontSize: 15 },
});
