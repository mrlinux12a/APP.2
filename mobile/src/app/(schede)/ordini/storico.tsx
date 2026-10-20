import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, type Materiale, type VoceMateriale } from '@/api';
import { riordina } from '@/carrello';
import { informa } from '@/componenti/dialoghi';
import { apriRicevuta } from '@/componenti/Pagamenti';
import { Caricamento, Errore, Vuoto } from '@/componenti/Stato';
import { StatoBadge } from '@/componenti/ui';
import { useMateriale } from '@/dati';
import { FONT, RAGGIO, useTema } from '@/tema';

type Vista = 'ordine' | 'articolo';

function Chip({ testo, attivo, onPress }: { testo: string; attivo: boolean; onPress: () => void }) {
  const { c } = useTema();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: attivo }}
      style={[stili.chip, { backgroundColor: attivo ? c.accentoChiaro : c.superficie, borderColor: attivo ? c.accento : c.bordo }]}
    >
      <Text style={[stili.chipTesto, { color: attivo ? c.accento : c.testo }]}>{testo}</Text>
    </Pressable>
  );
}

function Testata({
  m,
  mese,
  vista,
  scegliMese,
  scegliVista,
}: {
  m: Materiale;
  mese: string;
  vista: Vista;
  scegliMese: (chiave: string) => void;
  scegliVista: (v: Vista) => void;
}) {
  const { c } = useTema();
  const ditta = m.ditte.length === 1 ? m.ditte[0].replace(/\s+s\.?r\.?l\.?$/i, '') : '';
  return (
    <View style={{ gap: 12, paddingBottom: 6 }}>
      <View style={[stili.riquadro, { backgroundColor: c.accentoChiaro }]}>
        <Text style={[stili.riquadroEtichetta, { color: c.accento }]}>{ditta ? `MATERIALE DA PAGARE A ${ditta.toUpperCase()}` : 'MATERIALE DA PAGARE AL BANCO'}</Text>
        <Text style={[stili.riquadroImporto, { color: c.testo }]}>€ {m.riepilogo.totale}</Text>
        <Text style={[stili.riquadroSotto, { color: c.grigio }]}>
          {m.riepilogo.n_ordini === 1 ? '1 ordine' : `${m.riepilogo.n_ordini} ordini`} · IVA inclusa · prezzi del banco
        </Text>
        <Text style={[stili.riquadroSotto, { color: c.grigio }]}>Consegne pagate in app: € {m.riepilogo.servizio}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {m.mesi.map((x) => (
          <Chip key={x.chiave} testo={x.titolo} attivo={mese === x.chiave} onPress={() => scegliMese(x.chiave)} />
        ))}
        <Chip testo="Tutto" attivo={mese === 'tutto'} onPress={() => scegliMese('tutto')} />
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip testo="Per ordine" attivo={vista === 'ordine'} onPress={() => scegliVista('ordine')} />
        <Chip testo="Per articolo" attivo={vista === 'articolo'} onPress={() => scegliVista('articolo')} />
      </View>
    </View>
  );
}

function SchedaOrdine({ v, aperta, apri }: { v: Extract<VoceMateriale, { tipo: 'ordine' }>; aperta: boolean; apri: () => void }) {
  const { c } = useTema();
  const [occupato, setOccupato] = useState(false);

  const ripeti = async () => {
    setOccupato(true);
    try {
      const { aggiunti, saltati } = await riordina(v.id);
      if (!aggiunti) return informa('Riordina', 'Questi articoli non sono più disponibili.');
      if (saltati) informa('Riordina', saltati === 1 ? '1 articolo non è più disponibile.' : `${saltati} articoli non sono più disponibili.`);
      router.navigate('/carrello');
    } catch (e) {
      informa('Riordina', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setOccupato(false);
    }
  };

  return (
    <View style={[stili.scheda, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <Pressable onPress={apri} accessibilityRole="button" accessibilityState={{ expanded: aperta }} style={stili.schedaTesta}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[stili.schedaData, { color: c.grigio }]}>
            Ordine #{v.id} · {v.data}
          </Text>
          <Text style={[stili.schedaPrimo, { color: c.testo }]} numberOfLines={2}>
            {v.primo}
            {v.altri ? ` +${v.altri}` : ''}
          </Text>
          <StatoBadge testo={v.stato} tono={v.consegnato ? 'ok' : 'attesa'} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={[stili.schedaImporto, { color: c.testo }]}>€ {v.totale}</Text>
          <Text style={{ color: c.grigio, fontSize: 16 }}>{aperta ? '▴' : '▾'}</Text>
        </View>
      </Pressable>
      {aperta ? (
        <View style={[stili.dettaglio, { borderTopColor: c.bordo }]}>
          {v.righe.map((r, i) => (
            <View key={i} style={stili.riga}>
              <Text style={[stili.rigaQta, { color: c.accento }]}>{r.quantita}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={[stili.rigaNome, { color: c.testo }]}>{r.nome}</Text>
                <Text style={[stili.rigaMeta, { color: c.grigio }]}>
                  Cod. {r.codice} · € {r.cad} cad.
                </Text>
              </View>
              <Text style={[stili.rigaImporto, { color: c.testo }]}>€ {r.totale}</Text>
            </View>
          ))}
          <Text style={[stili.rigaMeta, { color: c.grigio, marginTop: 4 }]}>
            Servizio pagato in app (consegna + servizio + IVA): € {v.servizio}. Il servizio non è nel totale del materiale.
          </Text>
          <View style={stili.azioni}>
            <Pressable onPress={() => router.push({ pathname: '/ordini/ordine/[id]', params: { id: String(v.id) } })} style={stili.azione} hitSlop={6}>
              <Text style={[stili.azioneTesto, { color: c.accento }]}>Dettagli ›</Text>
            </Pressable>
            {v.ricevuta ? (
              <Pressable onPress={() => apriRicevuta(v.id)} style={stili.azione} hitSlop={6}>
                <Text style={[stili.azioneTesto, { color: c.accento }]}>Ricevuta</Text>
              </Pressable>
            ) : null}
            {v.consegnato ? (
              <Pressable onPress={ripeti} disabled={occupato} style={stili.azione} hitSlop={6}>
                <Text style={[stili.azioneTesto, { color: occupato ? c.grigio : c.accento }]}>Riordina</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SchedaRichiesta({ v }: { v: Extract<VoceMateriale, { tipo: 'richiesta' }> }) {
  const { c } = useTema();
  const contenuto = (
    <View style={[stili.scheda, stili.schedaTesta, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[stili.schedaData, { color: c.grigio }]}>
          Richiesta #{v.id} · {v.data}
        </Text>
        <Text style={[stili.schedaPrimo, { color: c.testo }]} numberOfLines={2}>
          {v.primo}
          {v.altri ? ` +${v.altri}` : ''}
        </Text>
        <StatoBadge testo={v.etichetta} tono={v.tono === 'annullata' ? 'info' : 'ko'} />
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[stili.schedaImporto, { color: c.grigio }]}>Nessun costo</Text>
        {v.apribile ? <Text style={{ color: c.grigio, fontSize: 16 }}>›</Text> : null}
      </View>
    </View>
  );
  // Una richiesta annullata non si apre; una chiusa per "nessuna risposta" sì: da lì si rinvia.
  if (!v.apribile) return contenuto;
  return (
    <Pressable onPress={() => router.push({ pathname: '/ordini/richiesta/[id]', params: { id: String(v.id) } })} accessibilityRole="button">
      {contenuto}
    </Pressable>
  );
}

// Lo Storico come sul sito: il materiale ordinato mese per mese e quanto si deve al banco. Per ordine (con le richieste chiuse senza ordine, nello stesso
// elenco) o per articolo.
export default function Storico() {
  const { c } = useTema();
  const [mese, setMese] = useState<string | null>(null); // null = quello che sceglie il server (il mese corrente, o il più recente)
  const [vista, setVista] = useState<Vista>('ordine');
  const [aperta, setAperta] = useState<number | null>(null);
  const q = useMateriale(mese, vista);

  useFocusEffect(
    useCallback(() => {
      q.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const m = q.data;
  const attivo = mese ?? m.mese;

  const testata = (
    <Testata
      m={m}
      mese={attivo}
      vista={vista}
      scegliMese={(x) => {
        setMese(x);
        setAperta(null);
      }}
      scegliVista={setVista}
    />
  );

  if (m.vuoto && !m.mesi.length) return <Vuoto icona="vuotoScatola" messaggio="Nessuna richiesta né ordine ancora." />;

  if (vista === 'articolo') {
    return (
      <FlatList
        data={m.articoli}
        keyExtractor={(a, i) => a.codice + '|' + a.nome + '|' + a.cad + '|' + i}
        style={{ backgroundColor: c.sfondo }}
        contentContainerStyle={{ padding: 14, gap: 8 }}
        ListHeaderComponent={testata}
        ListEmptyComponent={<Text style={[stili.vuoto, { color: c.grigio }]}>Nessun articolo in questo periodo.</Text>}
        renderItem={({ item: a }) => (
          <View style={[stili.scheda, stili.schedaTesta, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
            <Text style={[stili.rigaQta, { color: c.accento }]}>{a.quantita}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={[stili.rigaNome, { color: c.testo }]}>{a.nome}</Text>
              <Text style={[stili.rigaMeta, { color: c.grigio }]}>
                Cod. {a.codice} · {a.cad ? `€ ${a.cad} cad.` : 'prezzi diversi'} · {a.n_ordini === 1 ? '1 ordine' : `${a.n_ordini} ordini`}
              </Text>
            </View>
            <Text style={[stili.rigaImporto, { color: c.testo }]}>€ {a.totale}</Text>
          </View>
        )}
      />
    );
  }

  return (
    <FlatList
      data={m.elenco}
      keyExtractor={(v) => v.tipo + v.id}
      style={{ backgroundColor: c.sfondo }}
      contentContainerStyle={{ padding: 14, gap: 8 }}
      ListHeaderComponent={testata}
      ListEmptyComponent={<Text style={[stili.vuoto, { color: c.grigio }]}>Nessun ordine in questo periodo.</Text>}
      renderItem={({ item: v }) =>
        v.tipo === 'ordine' ? (
          <SchedaOrdine v={v} aperta={aperta === v.id} apri={() => setAperta(aperta === v.id ? null : v.id)} />
        ) : (
          <SchedaRichiesta v={v} />
        )
      }
    />
  );
}

const stili = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, minHeight: 38, justifyContent: 'center' },
  chipTesto: { fontFamily: FONT.testoMedio, fontSize: 14 },
  riquadro: { borderRadius: RAGGIO, padding: 14, gap: 2 },
  riquadroEtichetta: { fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.4 },
  riquadroImporto: { fontFamily: FONT.titoloForte, fontSize: 26, marginTop: 2 },
  riquadroSotto: { fontFamily: FONT.testo, fontSize: 13 },
  scheda: { borderWidth: 1, borderRadius: RAGGIO, overflow: 'hidden' },
  schedaTesta: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  schedaData: { fontFamily: FONT.testo, fontSize: 13 },
  schedaPrimo: { fontFamily: FONT.testoMedio, fontSize: 15, lineHeight: 20 },
  schedaImporto: { fontFamily: FONT.titolo, fontSize: 16 },
  dettaglio: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  riga: { flexDirection: 'row', gap: 10 },
  rigaQta: { minWidth: 30, fontFamily: FONT.testoForte, fontSize: 15 },
  rigaNome: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20 },
  rigaMeta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
  rigaImporto: { fontFamily: FONT.testoMedio, fontSize: 15 },
  azioni: { flexDirection: 'row', gap: 20, marginTop: 6 },
  azione: { minHeight: 36, justifyContent: 'center' },
  azioneTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  vuoto: { fontFamily: FONT.testo, fontSize: 15, textAlign: 'center', padding: 24 },
});
