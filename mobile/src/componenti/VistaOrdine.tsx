import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, type Ordine } from '../api';
import { riordina } from '../carrello';
import { useContoAllaRovescia, useOrdine } from '../dati';
import { FONT, RAGGIO, useTema } from '../tema';
import { informa } from './dialoghi';
import { Pagamenti } from './Pagamenti';
import { Caricamento, Errore } from './Stato';
import { Avviso, Bottone, Card, Forte, Nota, RigaArticolo, RigaInfo, SezioneTitolo } from './ui';

// Entro questa soglia l'ordine "è in arrivo" e non si scrivono più i minuti (la stessa del sito: format.SOGLIA_IN_ARRIVO_SEC).
const IN_ARRIVO_SEC = 180;

// I tre passi della pagina "Consegnato", ognuno con il suo orario (fasi_testo, già in ora italiana dal server).
const PASSI_CONSEGNATO: { chiave: 'inviata' | 'confermata' | 'consegnata'; etichetta: string }[] = [
  { chiave: 'inviata', etichetta: 'Inviata' },
  { chiave: 'confermata', etichetta: 'Confermata' },
  { chiave: 'consegnata', etichetta: 'Consegnata' },
];

// La parte alta di un ordine in consegna: titolo con l'arrivo (che si aggiorna da solo), barra che si riempie fino all'arrivo, chi lo porta.
function Consegna({ o, lettoIl }: { o: Ordine; lettoIl: number }) {
  const { c } = useTema();
  const restano = useContoAllaRovescia(o.eta_sec, lettoIl);
  const inArrivo = restano !== null && restano <= IN_ARRIVO_SEC;
  const durata = o.durata_sec || 0;
  const frazione = restano !== null && durata > 0 ? Math.min(1, Math.max(0, 1 - restano / durata)) : 0.5;
  const titolo = inArrivo ? 'In arrivo' : o.tempo_testo;
  const chiPorta = o.corriere || o.ditta || (o.distributore ? o.distributore.nome : '');

  return (
    <View style={[stili.hero, { backgroundColor: c.verdeChiaro }]}>
      <Text style={[stili.heroBadge, { backgroundColor: c.superficie, color: c.verde }]}>{o.stato_testo}</Text>
      <Text style={[stili.heroTempo, { color: c.verde }]}>{titolo}</Text>
      {chiPorta ? <Text style={[stili.heroSotto, { color: c.verde }]}>Te lo porta {chiPorta}</Text> : null}
      <View style={[stili.barra, { backgroundColor: c.superficie }]}>
        <View style={[stili.barraPiena, { backgroundColor: c.verde, width: `${Math.round(frazione * 100)}%` }]} />
      </View>
      <View style={stili.barraTesti}>
        <Text style={[stili.barraTesto, { color: c.verde }]}>Confermato</Text>
        <Text style={[stili.barraTesto, { color: c.verde }]}>In consegna</Text>
        <Text style={[stili.barraTesto, { color: c.verde }]}>Consegnato</Text>
      </View>
    </View>
  );
}

// Un ordine del cliente, come la pagina /ordini/:id del sito (versione installatore): in consegna o consegnato.
export function VistaOrdine({ id, nuovo = false }: { id: number; nuovo?: boolean }) {
  const { c } = useTema();
  const clientDati = useQueryClient();
  const q = useOrdine(id);
  const [azione, setAzione] = useState<string | null>(null);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const o = q.data;

  const esegui = async (quale: string, fn: () => Promise<unknown>) => {
    setAzione(quale);
    try {
      await fn();
      await Promise.all([
        clientDati.invalidateQueries({ queryKey: ['ordine', id] }),
        // 'all': la scheda "Stato ordini" può essere sotto questa schermata, non in primo piano.
        clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' }),
        clientDati.invalidateQueries({ queryKey: ['materiale'] }),
      ]);
    } catch (e) {
      informa('Operazione non riuscita', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const ripeti = async () => {
    setAzione('riordina');
    try {
      const { aggiunti, saltati } = await riordina(id);
      if (!aggiunti) {
        informa('Riordina', 'Questi articoli non sono più disponibili.');
        return;
      }
      if (saltati) informa('Riordina', saltati === 1 ? '1 articolo non è più disponibile.' : `${saltati} articoli non sono più disponibili.`);
      router.navigate('/carrello');
    } catch (e) {
      informa('Riordina', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  const dettagli = [
    o.destinazione ? { etichetta: 'Consegna in cantiere', dettaglio: o.destinazione } : null,
    o.note ? { etichetta: 'Note', dettaglio: o.note } : null,
  ].filter(Boolean) as { etichetta: string; dettaglio: string }[];

  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      {nuovo ? (
        <Avviso tipo="ok">
          <Forte>Ordine confermato.</Forte> {o.ditta ? o.ditta + ' prepara' : 'Il banco prepara'} il materiale. {o.tempo_testo}.
        </Avviso>
      ) : null}

      {o.consegnato ? (
        <View style={[stili.hero, { backgroundColor: c.verdeChiaro }]}>
          <Text style={[stili.heroBadge, { backgroundColor: c.superficie, color: c.verde }]}>Consegnato</Text>
          <Text style={[stili.heroTempo, { color: c.verde }]}>{o.tempo_testo}</Text>
          {o.ditta ? <Text style={[stili.heroSotto, { color: c.verde }]}>{o.ditta}</Text> : null}
          {o.durata_testo ? (
            <Text style={[stili.heroPillola, { backgroundColor: c.superficie, color: c.verde }]}>{o.durata_testo}</Text>
          ) : null}
          <View style={stili.passi}>
            {PASSI_CONSEGNATO.map((p) => (
              <View key={p.chiave} style={stili.passo}>
                <View style={[stili.passoBarretta, { backgroundColor: c.verde }]} />
                <Text style={[stili.passoEtichetta, { color: c.verde }]}>✓ {p.etichetta}</Text>
                {/* Un orario che manca (ordine vecchio) non si scrive: resta solo l'etichetta. */}
                {o.fasi_testo[p.chiave] ? (
                  <Text style={[stili.passoOra, { color: c.testo }]}>{o.fasi_testo[p.chiave]}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Consegna o={o} lettoIl={q.dataUpdatedAt} />
      )}

      {o.consegnato ? <Bottone titolo="Riordina gli stessi pezzi" onPress={ripeti} inCorso={azione === 'riordina'} /> : null}

      <SezioneTitolo>{o.consegnato ? 'Materiale consegnato' : 'Materiale in arrivo'}</SezioneTitolo>
      <Card>
        <Text style={[stili.ordineNumero, { color: c.grigio }]}>
          Ordine #{o.id}
          {o.ditta ? ' · ' + o.ditta : ''}
        </Text>
        {o.righe.map((r, i) => (
          <RigaArticolo
            key={i}
            quantita={r.quantita}
            nome={r.nome}
            meta={`Cod. ${r.codice} · € ${r.cad} cad.`}
            importo={r.subtotale}
            ultima={i === o.righe.length - 1}
          />
        ))}
      </Card>
      <Nota>Merce · IVA esclusa: € {o.importi.materiale.imponibile}. I prezzi sono quelli del banco.</Nota>

      <Pagamenti importi={o.importi} stato={o.stato_pagamento} fallback="ordine" ditta={o.ditta || null} ordineId={o.id} />

      {dettagli.length ? (
        <Card fitta>
          {dettagli.map((d, i) => (
            <RigaInfo key={i} etichetta={d.etichetta} dettaglio={d.dettaglio} ultima={i === dettagli.length - 1} />
          ))}
        </Card>
      ) : null}

      <Nota>Per problemi con l’ordine contatta l’assistenza: dopo la conferma del banco non si può più annullare.</Nota>
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
  heroTempo: { fontFamily: FONT.titolo, fontSize: 20 },
  heroSotto: { fontFamily: FONT.testo, fontSize: 14, marginTop: 3 },
  heroPillola: {
    alignSelf: 'flex-start',
    fontFamily: FONT.testoForte,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
    marginTop: 10,
  },
  passi: { flexDirection: 'row', gap: 8, marginTop: 14 },
  passo: { flex: 1, gap: 6 },
  passoBarretta: { height: 5, borderRadius: 3 },
  passoEtichetta: { fontFamily: FONT.testoForte, fontSize: 12.5, textAlign: 'center' },
  passoOra: { fontFamily: FONT.testoForte, fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  barra: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 14 },
  barraPiena: { height: 8, borderRadius: 4 },
  barraTesti: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  barraTesto: { fontFamily: FONT.testoMedio, fontSize: 12 },
  ordineNumero: { fontFamily: FONT.testoMedio, fontSize: 13, marginBottom: 4 },
});
