import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi } from '../api';
import { useOrdine } from '../dati';
import { FONT, RAGGIO, useTema } from '../tema';
import { chiedi, informa } from './dialoghi';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, Forte, Nota, RigaArticolo, RigaInfo, RigaRiepilogo, SezioneTitolo } from './ui';

// Un ordine del cliente, come la pagina /ordini/:id del sito (versione installatore).
export function VistaOrdine({
  id,
  nuovo = false,
  dopoEliminazione,
  quandoChiusa,
}: {
  id: number;
  nuovo?: boolean;
  dopoEliminazione?: () => void;
  // Chiamata appena il server conferma l'annullamento, prima di ricaricare i dati.
  quandoChiusa?: () => void;
}) {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const q = useOrdine(id);
  const [azione, setAzione] = useState<string | null>(null);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const o = q.data;

  // eliminato: l'ordine non esiste più, quindi non si rilegge (darebbe "Ordine non trovato") e si
  // esce dalla schermata solo dopo aver aggiornato "Stato ordini": prima si tornava a una
  // schermata che per un attimo mostrava ancora, in verde, l'ordine appena annullato.
  const esegui = async (quale: string, fn: () => Promise<unknown>, eliminato = false) => {
    setAzione(quale);
    try {
      await fn();
      await Promise.all([
        eliminato
          ? clientDati.cancelQueries({ queryKey: ['ordine', id] })
          : clientDati.invalidateQueries({ queryKey: ['ordine', id] }),
        // La richiesta dell'ordine tolto risulta annullata: una copia vecchia in cache la mostrerebbe ordinata.
        eliminato ? clientDati.invalidateQueries({ queryKey: ['richiesta'] }) : null,
        // 'all': la scheda "Stato ordini" può essere sotto questa schermata, non in primo piano.
        clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' }),
        clientDati.invalidateQueries({ queryKey: ['storico'] }),
      ]);
      if (eliminato) dopoEliminazione?.();
    } catch (e) {
      informa('Operazione non riuscita', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const dettagli = [
    o.distributore ? { etichetta: o.distributore.nome, dettaglio: o.distributore.filiale } : null,
    { etichetta: o.modalita_testo, dettaglio: o.tempi_testo },
    o.destinazione ? { etichetta: 'Destinazione merce', dettaglio: o.destinazione } : null,
    o.ddt ? { etichetta: 'Bolla / DDT n. ' + o.ddt.numero, dettaglio: 'Del ' + o.ddt.data } : null,
    o.note ? { etichetta: 'Note', dettaglio: o.note } : null,
  ].filter(Boolean) as { etichetta: string; dettaglio: string }[];

  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      {nuovo ? (
        <Avviso tipo="ok">
          <Forte>Ordine inviato.</Forte> Il distributore ha ricevuto la conferma e prepara il materiale.
        </Avviso>
      ) : null}
      {o.assegnata_auto ? (
        <Avviso tipo="attenzione">
          <Forte>Ordine partito in automatico.</Forte> Il tempo per scegliere il distributore era scaduto, quindi l'ordine
          è andato a chi copriva tutto il materiale con la consegna più veloce, con consegna e note predefinite.
        </Avviso>
      ) : null}

      <View style={[stili.hero, { backgroundColor: '#cdedd4' }]}>
        <Text style={[stili.heroBadge, { backgroundColor: c.superficie, color: c.verde }]}>{o.stato_testo}</Text>
        <Text style={[stili.heroTempo, { color: c.verde }]}>{o.tempo_testo}</Text>
        {o.distributore ? (
          <Text style={[stili.heroSotto, { color: c.verde }]}>
            {o.distributore.nome}
            {o.distributore.filiale ? ' · ' + o.distributore.filiale : ''}
          </Text>
        ) : null}
      </View>

      <SezioneTitolo>Prodotti</SezioneTitolo>
      <Card>
        {o.righe.map((r, i) => (
          <RigaArticolo
            key={i}
            quantita={r.quantita}
            nome={r.nome}
            meta={'Cod. ' + r.codice}
            importo={r.subtotale}
            ultima={i === o.righe.length - 1}
          />
        ))}
      </Card>
      <Card>
        <RigaRiepilogo voce="Merce (IVA esclusa)" valore={'€ ' + o.totali.merce} />
        {o.totali.raee ? <RigaRiepilogo voce="Contributo RAEE" valore={'€ ' + o.totali.raee} /> : null}
        <RigaRiepilogo voce="Costo di consegna" valore={o.totali.consegna ? '€ ' + o.totali.consegna : 'inclusa'} />
        <RigaRiepilogo voce={`IVA ${o.iva_pct}%`} valore={'€ ' + o.totali.iva} />
        <RigaRiepilogo voce="Totale" valore={'€ ' + o.totali.totale} forte />
      </Card>

      <SezioneTitolo>Dettagli consegna e documenti</SezioneTitolo>
      <Card fitta>
        {dettagli.map((d, i) => (
          <RigaInfo key={i} etichetta={d.etichetta} dettaglio={d.dettaglio} ultima={i === dettagli.length - 1} />
        ))}
      </Card>
      <Nota>Prezzo definitivo, con eventuale sconto aggiuntivo, confermato in fattura come di consueto.</Nota>

      {o.da_confermare_consegna ? (
        <Bottone
          titolo="Ordine consegnato"
          onPress={() => esegui('consegnato', () => chiamaApi(`/ordini/${id}/consegnato`, { metodo: 'POST' }))}
          inCorso={azione === 'consegnato'}
        />
      ) : null}
      {o.annullabile ? (
        <Bottone
          titolo="Annulla ordine"
          tipo="discreto"
          onPress={() =>
            chiedi('Annullare questo ordine?', 'Il distributore verrà avvisato.', 'Annulla ordine', () =>
              esegui(
                'annulla',
                async () => {
                  await chiamaApi(`/ordini/${id}`, { metodo: 'DELETE' });
                  quandoChiusa?.();
                },
                true
              )
            , true)
          }
          inCorso={azione === 'annulla'}
        />
      ) : null}
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 32 },
  hero: { borderRadius: RAGGIO, paddingVertical: 14, paddingHorizontal: 16 },
  heroBadge: {
    alignSelf: 'flex-start',
    fontFamily: FONT.testoForte,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
  },
  heroTempo: { fontFamily: FONT.titolo, fontSize: 18 },
  heroSotto: { fontFamily: FONT.testo, fontSize: 14, marginTop: 3 },
});
