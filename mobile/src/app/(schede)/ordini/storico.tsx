import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, type Materiale, type VoceMateriale } from '@/api';
import { riordina } from '@/carrello';
import { informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import { apriRicevuta } from '@/componenti/Pagamenti';
import { Caricamento, Errore } from '@/componenti/Stato';
import { Bottone } from '@/componenti/ui';
import { useMateriale } from '@/dati';
import { FONT, useTema } from '@/tema';

type Vista = 'ordine' | 'articolo';

// Il fondo delle pagine con la barra delle schede sospesa: come .app-storico del sito (circa 96px).
const FONDO_PAGINA = 96;

// I colori del bollino di stato (.st-stato del sito): consegnato verde, in preparazione arancio, nessuna risposta rosso, annullata grigio.
function coloriStato(tono: string, consegnato: boolean) {
  if (consegnato || tono === 'consegnato' || tono === 'consegna') return { sfondo: '#e3f3e6', testo: '#1f5f2e' };
  if (tono === 'nessuna') return { sfondo: '#fbe4e2', testo: '#991b1b' };
  if (tono === 'annullata') return { sfondo: '#ece9e2', testo: '#3f3e38' };
  return { sfondo: '#fbe6da', testo: '#8a3c16' };
}

// Un chip del mese nel riquadro blu: bordo bianco trasparente; quello scelto è pieno bianco con il testo blu scuro.
function ChipMese({ testo, attivo, onPress }: { testo: string; attivo: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: attivo }}
      style={[stili.chip, attivo ? { backgroundColor: '#ffffff', borderColor: '#ffffff' } : { borderColor: 'rgba(255,255,255,0.45)' }]}
    >
      <Text style={[stili.chipTesto, { color: attivo ? '#1a4468' : '#ffffff' }]}>{testo}</Text>
    </Pressable>
  );
}

// Il riquadro blu "Da pagare a BOREA" (.sm-riquadro): i chip del mese, il totale del materiale IVA inclusa, gli ordini e le consegne già pagate in app.
// I due pulsanti del sito ("Ricevute del mese" ed "Esporta elenco", un PDF e un CSV) nell'app non ci sono.
function Riquadro({ m, scegliMese }: { m: Materiale; scegliMese: (chiave: string) => void }) {
  const nome = m.ditte[0] || 'BOREA';
  return (
    <View style={stili.riquadro}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={stili.mesi} contentContainerStyle={stili.mesiContenuto}>
        {m.mesi.map((x) => (
          <ChipMese key={x.chiave} testo={x.titolo} attivo={m.mese === x.chiave} onPress={() => scegliMese(x.chiave)} />
        ))}
        <ChipMese testo="Tutto" attivo={m.mese === 'tutto'} onPress={() => scegliMese('tutto')} />
      </ScrollView>
      <Text style={stili.occhiello}>Da pagare a {nome}</Text>
      <View style={stili.totale}>
        <Text style={stili.importo}>€ {m.riepilogo.totale}</Text>
        <Text style={stili.iva}>IVA inclusa</Text>
      </View>
      <Text style={stili.sotto}>Materiale di {m.riepilogo.n_ordini} {m.riepilogo.n_ordini === 1 ? 'ordine' : 'ordini'}</Text>
      <View style={stili.fondo}>
        <Text style={stili.fondoTesto}>
          Consegne pagate in app: <Text style={stili.fondoForte}>€ {m.riepilogo.servizio}</Text>
        </Text>
      </View>
    </View>
  );
}

// Il selettore "Per ordine | Per articolo" (.sm-vista): due metà in una pillola grigia, quella scelta in bianco.
function SelettoreVista({ vista, scegli }: { vista: Vista; scegli: (v: Vista) => void }) {
  const { c } = useTema();
  const voce = (v: Vista, testo: string) => (
    <Pressable
      key={v}
      onPress={() => scegli(v)}
      accessibilityRole="button"
      accessibilityState={{ selected: vista === v }}
      style={[stili.vistaVoce, vista === v && stili.vistaAttiva]}
    >
      <Text style={[stili.vistaTesto, { color: vista === v ? c.testo : '#5c5b52' }]}>{testo}</Text>
    </Pressable>
  );
  return <View style={stili.vista}>{[voce('ordine', 'Per ordine'), voce('articolo', 'Per articolo')]}</View>;
}

// La parte alta dell'elenco: il riquadro blu e il selettore della vista.
function Testata({ m, vista, scegliMese, scegliVista }: { m: Materiale; vista: Vista; scegliMese: (chiave: string) => void; scegliVista: (v: Vista) => void }) {
  return (
    <View>
      <Riquadro m={m} scegliMese={scegliMese} />
      <SelettoreVista vista={vista} scegli={scegliVista} />
    </View>
  );
}

// "Nessun ordine in questo mese." con la figura della scatola vuota (.vuoto del sito).
function VuotoPeriodo({ testo }: { testo: string }) {
  const { c } = useTema();
  return (
    <View style={stili.vuoto}>
      <Icona nome="vuotoScatola" colore={c.grigio} dimensione={36} />
      <Text style={[stili.vuotoTesto, { color: c.grigio }]}>{testo}</Text>
    </View>
  );
}

// Il riquadro piccolo con la quantità ("2×"): blu chiaro, come .sm-qta.
function Quantita({ n }: { n: number }) {
  const { c } = useTema();
  return <Text style={[stili.qta, { backgroundColor: c.accentoChiaro, color: c.accentoScuro }]}>{n}×</Text>;
}

// La prima riga di una scheda: "Ordine #12 · 18 ott" e l'importo; sotto lo stato, il primo articolo, "+N" e la freccia che gira quando si apre.
function TestaScheda({
  titolo,
  data,
  destra,
  bollino,
  primo,
  altri,
  aperta,
  apribile,
}: {
  titolo: string;
  data: string;
  destra: string;
  bollino: { testo: string; tono: string; consegnato: boolean };
  primo: string;
  altri: number;
  aperta: boolean;
  apribile: boolean;
}) {
  const { c } = useTema();
  const col = coloriStato(bollino.tono, bollino.consegnato);
  return (
    <View style={stili.testa}>
      <View style={stili.riga1}>
        <Text style={[stili.nome, { color: c.testo }]} numberOfLines={1}>
          <Text style={{ fontFamily: FONT.testoForte }}>{titolo}</Text>
          <Text style={[stili.data, { color: c.grigio }]}>  {data}</Text>
        </Text>
        <Text style={[destra === 'Nessun costo' ? stili.totZero : stili.tot, { color: destra === 'Nessun costo' ? c.grigio : c.testo }]}>{destra}</Text>
      </View>
      <View style={stili.riga2}>
        <Text style={[stili.stato, { backgroundColor: col.sfondo, color: col.testo }]}>{bollino.testo}</Text>
        <Text style={stili.primo} numberOfLines={1}>
          {primo}
        </Text>
        {altri ? <Text style={[stili.altri, { color: c.grigio }]}>+{altri}</Text> : null}
        {apribile ? (
          <View style={[stili.freccia, aperta && { transform: [{ rotate: '90deg' }] }]}>
            <Icona nome="avanti" colore={c.grigio} dimensione={14} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Una scheda ordine (.sm-ordine): chiusa mostra numero, data, importo e stato; aperta il materiale riga per riga, la consegna pagata in app, "Riordina" (solo se
// consegnato), "Ricevuta" (se il pagamento è vero) e "Dettagli ›". Il servizio pagato in app resta fuori dal totale.
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
      <Pressable onPress={apri} accessibilityRole="button" accessibilityState={{ expanded: aperta }}>
        <TestaScheda
          titolo={`Ordine #${v.id}`}
          data={v.data}
          destra={`€ ${v.totale}`}
          bollino={{ testo: v.stato, tono: v.consegnato ? 'consegnato' : 'attesa', consegnato: v.consegnato }}
          primo={v.primo}
          altri={v.altri}
          aperta={aperta}
          apribile
        />
      </Pressable>
      {aperta ? (
        <View style={stili.dettaglio}>
          {v.righe.map((r, i) => (
            <View key={i} style={stili.riga}>
              <Quantita n={r.quantita} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[stili.rigaNome, { color: c.testo }]}>{r.nome}</Text>
                <Text style={[stili.rigaSotto, { color: c.grigio }]}>€ {r.cad} cad.</Text>
              </View>
              <Text style={[stili.rigaTotale, { color: c.testo }]}>€ {r.totale}</Text>
            </View>
          ))}
          <View style={stili.servizio}>
            <Text style={[stili.servizioTesto, { color: c.grigio }]}>Consegna pagata in app · corriere + {v.servizio_pct}% + IVA</Text>
            <Text style={[stili.servizioTesto, { color: c.grigio }]}>€ {v.servizio}</Text>
          </View>
          <View style={stili.azioni}>
            {v.consegnato ? (
              <Pressable
                onPress={ripeti}
                disabled={occupato}
                accessibilityRole="button"
                style={({ pressed }) => [stili.riordina, { borderColor: c.accento, backgroundColor: pressed ? c.accentoChiaro : c.superficie, opacity: occupato ? 0.6 : 1 }]}
              >
                <Icona nome="riprova" colore={c.accento} dimensione={18} />
                <Text style={[stili.riordinaTesto, { color: c.accento }]}>Riordina</Text>
              </Pressable>
            ) : null}
            <View style={stili.destra}>
              {v.ricevuta ? (
                <Pressable onPress={() => apriRicevuta(v.id)} accessibilityRole="link" style={stili.link}>
                  <Icona nome="scontrino" colore={c.accento} dimensione={17} />
                  <Text style={[stili.linkTesto, { color: c.accento }]}>Ricevuta</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => router.push({ pathname: '/ordini/ordine/[id]', params: { id: String(v.id) } })}
                accessibilityRole="link"
                style={stili.link}
              >
                <Text style={[stili.linkTesto, { color: c.accento }]}>Dettagli ›</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Una richiesta chiusa senza ordine, nella stessa scheda dell'ordine (.sm-ordine): "Nessun costo" al posto dell'importo. Le richieste non salvano i prezzi: nel
// dettaglio ci sono solo quantità e nome. Una chiusa per "nessuna risposta" si apre e porta alla sua pagina (da lì si rinvia); una annullata non si apre e non è un link.
function SchedaRichiesta({ v, aperta, apri }: { v: Extract<VoceMateriale, { tipo: 'richiesta' }>; aperta: boolean; apri: () => void }) {
  const { c } = useTema();
  const testa = (
    <TestaScheda
      titolo={`Richiesta #${v.id}`}
      data={v.data}
      destra="Nessun costo"
      bollino={{ testo: v.etichetta, tono: v.tono, consegnato: false }}
      primo={v.primo}
      altri={v.altri}
      aperta={aperta}
      apribile={v.apribile}
    />
  );
  if (!v.apribile) return <View style={[stili.scheda, { backgroundColor: c.superficie, borderColor: c.bordo }]}>{testa}</View>;
  return (
    <View style={[stili.scheda, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <Pressable onPress={apri} accessibilityRole="button" accessibilityState={{ expanded: aperta }}>
        {testa}
      </Pressable>
      {aperta ? (
        <View style={stili.dettaglio}>
          {v.righe.map((r, i) => (
            <View key={i} style={stili.riga}>
              <Quantita n={r.quantita} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[stili.rigaNome, { color: c.testo }]}>{r.nome}</Text>
              </View>
            </View>
          ))}
          <View style={stili.servizio}>
            <Text style={[stili.servizioTesto, { color: c.grigio }]}>Nessun addebito sulla carta</Text>
            <Text style={[stili.servizioTesto, { color: c.grigio }]}>€ 0,00</Text>
          </View>
          <View style={stili.azioni}>
            <View style={stili.destra}>
              <Pressable
                onPress={() => router.push({ pathname: '/ordini/richiesta/[id]', params: { id: String(v.id) } })}
                accessibilityRole="link"
                style={stili.link}
              >
                <Text style={[stili.linkTesto, { color: c.accento }]}>Dettagli ›</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// La vista "Per articolo" (.sm-articoli): una scheda sola con le righe sommate dal totale più alto (quantità, nome, "€ cad. · ordini #12, #14", importo) e il totale in fondo.
function PerArticolo({ m }: { m: Materiale }) {
  const { c } = useTema();
  if (!m.articoli.length) return <VuotoPeriodo testo="Nessun ordine in questo mese." />;
  return (
    <View style={[stili.articoli, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      {m.articoli.map((a, i) => (
        <View key={a.codice + '|' + a.nome + '|' + a.cad + '|' + i} style={stili.articolo}>
          <Quantita n={a.quantita} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[stili.rigaNome, { color: c.testo }]}>{a.nome}</Text>
            <Text style={[stili.rigaSotto, { color: c.grigio }]}>
              {a.cad ? `€ ${a.cad} cad.` : 'prezzi diversi'} · ordini {a.ordini.map((id) => '#' + id).join(', ')}
            </Text>
          </View>
          <Text style={[stili.rigaTotale, { color: c.testo }]}>€ {a.totale}</Text>
        </View>
      ))}
      <View style={[stili.articolo, stili.somma]}>
        <Text style={[stili.sommaEtichetta, { color: c.testo }]}>Totale</Text>
        <Text style={[stili.sommaValore, { color: c.testo }]}>€ {m.riepilogo.totale}</Text>
      </View>
    </View>
  );
}

// Lo Storico come sul sito (views/cliente/storico.ejs): il riquadro blu con quanto si deve al banco mese per mese, il selettore Per ordine / Per articolo e le schede
// (ordini e richieste chiuse senza ordine nello stesso elenco, dal più recente). Le schede si aprono al tocco, tutte chiuse all'arrivo.
export default function Storico() {
  const { c } = useTema();
  const [mese, setMese] = useState<string | null>(null); // null = quello che sceglie il server (il mese corrente, o il più recente)
  const [vista, setVista] = useState<Vista>('ordine');
  const [aperte, setAperte] = useState<Record<string, boolean>>({});
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

  // Nessun ordine né richiesta, mai: la figura e il pulsante per andare al catalogo.
  if (!m.mesi.length) {
    return (
      <View style={[stili.nessuno, { backgroundColor: c.sfondo }]}>
        <VuotoPeriodo testo="Nessun ordine ancora." />
        <Bottone titolo="Vai al catalogo" onPress={() => router.navigate('/')} />
      </View>
    );
  }

  const testata = (
    <Testata
      m={m}
      vista={vista}
      scegliMese={(x) => {
        setMese(x);
        setAperte({});
      }}
      scegliVista={setVista}
    />
  );

  if (vista === 'articolo') {
    return (
      <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
        {testata}
        <PerArticolo m={m} />
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={m.elenco}
      extraData={aperte}
      keyExtractor={(v) => v.tipo + v.id}
      style={{ backgroundColor: c.sfondo }}
      contentContainerStyle={stili.pagina}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListHeaderComponent={testata}
      ListEmptyComponent={<VuotoPeriodo testo="Nessun ordine in questo mese." />}
      renderItem={({ item: v }) => {
        const chiave = v.tipo + '-' + v.id;
        const alTocco = () => setAperte((a) => ({ ...a, [chiave]: !a[chiave] }));
        return v.tipo === 'ordine' ? (
          <SchedaOrdine v={v} aperta={!!aperte[chiave]} apri={alTocco} />
        ) : (
          <SchedaRichiesta v={v} aperta={!!aperte[chiave]} apri={alTocco} />
        );
      }}
    />
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, paddingBottom: FONDO_PAGINA },
  nessuno: { flex: 1, justifyContent: 'center', gap: 6, padding: 14 },
  riquadro: { backgroundColor: '#245a8f', borderRadius: 18, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 16, marginBottom: 12 },
  mesi: { marginHorizontal: -16, marginBottom: 12, flexGrow: 0 },
  mesiContenuto: { paddingHorizontal: 16, gap: 8 },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  chipTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
  occhiello: { color: '#ffffff', opacity: 0.85, fontFamily: FONT.testoForte, fontSize: 13, letterSpacing: 0.65, textTransform: 'uppercase' },
  totale: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 4 },
  importo: { color: '#ffffff', fontFamily: FONT.titoloForte, fontSize: 34, lineHeight: 39, fontVariant: ['tabular-nums'], flexShrink: 1 },
  iva: { color: '#ffffff', opacity: 0.85, fontFamily: FONT.testo, fontSize: 14 },
  sotto: { color: '#ffffff', opacity: 0.9, marginTop: 2, fontFamily: FONT.testo, fontSize: 14 },
  fondo: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)' },
  fondoTesto: { color: '#ffffff', fontFamily: FONT.testo, fontSize: 13.5 },
  fondoForte: { fontFamily: FONT.testoForte, fontVariant: ['tabular-nums'] },
  vista: { flexDirection: 'row', gap: 4, padding: 4, marginBottom: 14, backgroundColor: '#e7e4dc', borderRadius: 14 },
  vistaVoce: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  vistaAttiva: { backgroundColor: '#ffffff', shadowColor: '#232019', shadowOpacity: 0.14, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  vistaTesto: { fontFamily: FONT.testoForte, fontSize: 14.5 },
  vuoto: { alignItems: 'center', gap: 10, padding: 28 },
  vuotoTesto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  scheda: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  testa: { paddingVertical: 12, paddingHorizontal: 14 },
  riga1: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  nome: { flexShrink: 1, minWidth: 0, fontFamily: FONT.testo, fontSize: 15.5 },
  data: { fontFamily: FONT.testo, fontSize: 13 },
  tot: { fontFamily: FONT.titoloForte, fontSize: 16, fontVariant: ['tabular-nums'] },
  totZero: { fontFamily: FONT.testoMedio, fontSize: 14 },
  riga2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, minWidth: 0 },
  stato: { overflow: 'hidden', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 10, fontFamily: FONT.testoForte, fontSize: 12.5, lineHeight: 16 },
  primo: { flexShrink: 1, minWidth: 0, fontFamily: FONT.testo, fontSize: 13.5, color: '#3f3e38' },
  altri: { fontFamily: FONT.testoMedio, fontSize: 13 },
  freccia: { marginLeft: 'auto' },
  dettaglio: { backgroundColor: '#faf9f6', borderTopWidth: 1, borderTopColor: '#ece9e2', paddingTop: 4, paddingHorizontal: 14, paddingBottom: 12 },
  riga: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#ece9e2' },
  qta: { minWidth: 30, overflow: 'hidden', paddingVertical: 2, paddingHorizontal: 7, borderRadius: 8, textAlign: 'center', fontFamily: FONT.testoForte, fontSize: 13, fontVariant: ['tabular-nums'] },
  rigaNome: { fontFamily: FONT.testoForte, fontSize: 14.5, lineHeight: 19 },
  rigaSotto: { marginTop: 2, fontFamily: FONT.testo, fontSize: 12.5 },
  rigaTotale: { fontFamily: FONT.testoForte, fontSize: 14.5, fontVariant: ['tabular-nums'] },
  servizio: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 10, paddingBottom: 2 },
  servizioTesto: { flexShrink: 1, fontFamily: FONT.testo, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  azioni: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  riordina: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 18, borderWidth: 1.5, borderRadius: 20 },
  riordinaTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
  destra: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 18 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 },
  linkTesto: { fontFamily: FONT.testoForte, fontSize: 14.5 },
  articoli: { borderWidth: 1, borderRadius: 16, paddingVertical: 2, paddingHorizontal: 14 },
  articolo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#ece9e2' },
  somma: { alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0 },
  sommaEtichetta: { fontFamily: FONT.testoForte, fontSize: 15.5 },
  sommaValore: { fontFamily: FONT.titoloForte, fontSize: 16, fontVariant: ['tabular-nums'] },
});
