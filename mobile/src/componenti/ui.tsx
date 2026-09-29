// Mattoncini delle schermate richiesta / offerte / ordine, con lo stesso aspetto delle
// classi del sito (.avviso, .card, .riga-articolo, .riepilogo-riga, .btn, .stato-badge).
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { FONT, RAGGIO, useTema } from '../tema';

export function mmss(secondi: number) {
  const s = Math.max(0, Math.floor(secondi || 0));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function Avviso({ tipo, children }: { tipo: 'ok' | 'attenzione' | 'info' | 'errore'; children: ReactNode }) {
  const { c } = useTema();
  const colori =
    tipo === 'ok'
      ? { sfondo: c.verdeChiaro, testo: c.verde }
      : tipo === 'attenzione'
        ? { sfondo: c.arancioChiaro, testo: c.arancio }
        : tipo === 'errore'
          ? { sfondo: c.rossoChiaro, testo: c.rosso }
          : { sfondo: c.accentoChiaro, testo: c.accento };
  return (
    <View style={[stili.avviso, { backgroundColor: colori.sfondo }]}>
      <Text style={[stili.avvisoTesto, { color: colori.testo }]}>{children}</Text>
    </View>
  );
}

export function Forte({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: FONT.testoForte }}>{children}</Text>;
}

export function SezioneTitolo({ children }: { children: ReactNode }) {
  const { c } = useTema();
  return <Text style={[stili.sezione, { color: c.testo }]}>{children}</Text>;
}

export function Card({ children, fitta = false, stile }: { children: ReactNode; fitta?: boolean; stile?: ViewStyle }) {
  const { c } = useTema();
  return (
    <View style={[stili.card, fitta && stili.cardFitta, { backgroundColor: c.superficie, borderColor: c.bordo }, stile]}>
      {children}
    </View>
  );
}

export function Nota({ children }: { children: ReactNode }) {
  const { c } = useTema();
  return <Text style={[stili.nota, { color: c.grigio }]}>{children}</Text>;
}

// "3×  Nome prodotto / Cod. 123   € 12,00"
export function RigaArticolo({
  quantita,
  nome,
  meta,
  importo,
  ultima,
}: {
  quantita: number;
  nome: string;
  meta?: string;
  importo?: string;
  ultima?: boolean;
}) {
  const { c } = useTema();
  return (
    <View style={[stili.articolo, { borderBottomColor: c.bordo, borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth }]}>
      <Text style={[stili.qta, { color: c.accento }]}>{quantita}×</Text>
      <View style={{ flex: 1 }}>
        <Text style={[stili.desc, { color: c.testo }]}>{nome}</Text>
        {meta ? <Text style={[stili.meta, { color: c.grigio }]}>{meta}</Text> : null}
      </View>
      {importo ? <Text style={[stili.imp, { color: c.testo }]}>€ {importo}</Text> : null}
    </View>
  );
}

export function RigaRiepilogo({ voce, valore, forte }: { voce: string; valore: string; forte?: boolean }) {
  const { c } = useTema();
  return (
    <View style={[stili.riepilogo, forte && [stili.riepilogoForte, { borderTopColor: c.bordo }]]}>
      <Text style={[forte ? stili.riepilogoVoceForte : stili.riepilogoVoce, { color: forte ? c.testo : c.grigio }]}>{voce}</Text>
      <Text style={[forte ? stili.riepilogoVoceForte : stili.riepilogoValore, { color: c.testo }]}>{valore}</Text>
    </View>
  );
}

// Riga con due testi (etichetta + dettaglio), come .riga-lista del sito.
export function RigaInfo({ etichetta, dettaglio, ultima }: { etichetta: string; dettaglio?: string | null; ultima?: boolean }) {
  const { c } = useTema();
  return (
    <View style={[stili.info, { borderBottomColor: c.bordo, borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth }]}>
      <Text style={[stili.infoEtichetta, { color: c.testo }]}>{etichetta}</Text>
      {dettaglio ? <Text style={[stili.meta, { color: c.grigio }]}>{dettaglio}</Text> : null}
    </View>
  );
}

export function StatoBadge({ testo, tono }: { testo: string; tono: 'ok' | 'attesa' | 'ko' | 'info' }) {
  const { c } = useTema();
  const colori =
    tono === 'ok'
      ? { sfondo: c.verdeChiaro, testo: c.verde }
      : tono === 'attesa'
        ? { sfondo: c.arancioChiaro, testo: c.arancio }
        : tono === 'ko'
          ? { sfondo: c.rossoChiaro, testo: c.rosso }
          : { sfondo: c.accentoChiaro, testo: c.accento };
  return <Text style={[stili.statoBadge, { backgroundColor: colori.sfondo, color: colori.testo }]}>{testo}</Text>;
}

export function Bottone({
  titolo,
  onPress,
  tipo = 'primario',
  disabilitato,
  inCorso,
}: {
  titolo: string;
  onPress: () => void;
  tipo?: 'primario' | 'chiaro' | 'rosso' | 'discreto';
  disabilitato?: boolean;
  inCorso?: boolean;
}) {
  const { c } = useTema();
  if (tipo === 'discreto') {
    return (
      <Pressable onPress={onPress} disabled={disabilitato || inCorso} style={stili.discreto} hitSlop={6}>
        <Text style={[stili.discretoTesto, { color: c.rosso }]}>{titolo}</Text>
      </Pressable>
    );
  }
  const spento = disabilitato || inCorso;
  const sfondo = tipo === 'primario' ? (disabilitato ? c.bordo : c.accento) : c.superficie;
  const testo = tipo === 'primario' ? (disabilitato ? c.grigio : c.suAccento) : tipo === 'rosso' ? c.rosso : c.accento;
  return (
    <Pressable
      onPress={onPress}
      disabled={spento}
      accessibilityRole="button"
      style={({ pressed }) => [
        stili.bottone,
        { backgroundColor: sfondo, opacity: pressed ? 0.8 : 1 },
        tipo !== 'primario' && { borderWidth: 1, borderColor: c.bordo },
      ]}
    >
      {inCorso ? <ActivityIndicator color={testo} /> : <Text style={[stili.bottoneTesto, { color: testo }]}>{titolo}</Text>}
    </Pressable>
  );
}

const stili = StyleSheet.create({
  avviso: { borderRadius: RAGGIO, paddingVertical: 12, paddingHorizontal: 14 },
  avvisoTesto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21 },
  sezione: { fontFamily: FONT.titolo, fontSize: 17, marginTop: 8, marginHorizontal: 2 },
  card: { borderWidth: 1, borderRadius: RAGGIO, padding: 14 },
  cardFitta: { padding: 0, overflow: 'hidden' },
  nota: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 19, marginHorizontal: 2 },
  articolo: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  qta: { minWidth: 30, fontFamily: FONT.testoForte, fontSize: 15 },
  desc: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
  imp: { fontFamily: FONT.testoMedio, fontSize: 15 },
  riepilogo: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7 },
  riepilogoForte: { paddingTop: 12, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
  riepilogoVoce: { fontFamily: FONT.testo, fontSize: 15 },
  riepilogoValore: { fontFamily: FONT.testo, fontSize: 15 },
  riepilogoVoceForte: { fontFamily: FONT.testoForte, fontSize: 17 },
  info: { paddingVertical: 12, paddingHorizontal: 14 },
  infoEtichetta: { fontFamily: FONT.testoMedio, fontSize: 15 },
  statoBadge: {
    fontFamily: FONT.testoMedio,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  bottone: { borderRadius: 999, paddingVertical: 15, paddingHorizontal: 20, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  bottoneTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
  discreto: { paddingVertical: 10, alignItems: 'center' },
  discretoTesto: { fontFamily: FONT.testo, fontSize: 14 },
});
