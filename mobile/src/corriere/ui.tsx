// I mattoncini comuni delle schermate di lavoro del corriere: pagina, scheda, pulsanti, avvisi, stati vuoti e di errore, e i formati dei numeri («34 min», «12,4 km»).
// Stile: fondo beige, schede bianche con bordo sottile e raggio 18, giallo per le azioni, testo scuro, font Manrope (vedi tema.ts).
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import type { NomeIcona } from '@/icone';
import { ALTEZZA_PULSANTE, COL, FC, RAGGIO } from './tema';

// ---------- Formati ----------

// «34 min», «1 h 05»; «—» se non si sa.
export function minutiTesto(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

// «12,4 km» (virgola all'italiana); «—» se non si sa.
export function kmTesto(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  return `${km.toFixed(1).replace('.', ',')} km`;
}

// Da quanto è arrivata una richiesta: «Adesso», «3 min fa», «2 h fa».
export function quandoFa(secondi: number): string {
  if (secondi < 45) return 'Adesso';
  const min = Math.round(secondi / 60);
  return min < 60 ? `${min} min fa` : `${Math.floor(min / 60)} h fa`;
}

// ---------- Azioni verso fuori dall'app ----------

// Apre il percorso nell'app delle mappe (o nel browser, se il telefono non ne ha una).
export function apriMappa(url: string) {
  Linking.openURL(url).catch(() => informa('Non riesco ad aprire le mappe', 'Controlla di avere sul telefono un’app per le mappe o un browser.'));
}

// Fa partire la chiamata (si apre il tastierino del telefono col numero già scritto).
export function chiama(telefono: string) {
  const numero = telefono.replace(/[^\d+]/g, '');
  if (!numero) return;
  Linking.openURL('tel:' + numero).catch(() => informa('Non riesco a chiamare', 'Questo telefono non può fare chiamate. Il numero è ' + telefono + '.'));
}

// «Indietro»: se c'è una schermata prima si torna lì; se la schermata è stata aperta da una notifica (niente schermata prima) si va alla home dei corrieri.
export function tornaIndietro() {
  if (router.canGoBack()) router.back();
  else router.replace('/corriere');
}

// ---------- Struttura ----------

// Il fondo della pagina con la zona sicura (tacca, barra di stato). Nelle schede il fondo lo copre la barra delle schede, quindi di default solo in alto.
export function Pagina({ children, bordi = ['top'] }: { children: ReactNode; bordi?: Edge[] }) {
  return (
    <SafeAreaView style={stili.pagina} edges={bordi}>
      {children}
    </SafeAreaView>
  );
}

export function Titolo({ children }: { children: ReactNode }) {
  return (
    <Text style={stili.titolo} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Scheda({ children, stile }: { children: ReactNode; stile?: StyleProp<ViewStyle> }) {
  return <View style={[stili.scheda, stile]}>{children}</View>;
}

// Il piede fisso con il pulsante principale (resta in vista mentre il resto scorre). Nelle schermate sopra le schede (`sullaPagina`) lascia anche lo spazio per la
// barra dei gesti del telefono; nelle schede ci pensa già la barra delle schede.
export function Piede({ children, sullaPagina = false }: { children: ReactNode; sullaPagina?: boolean }) {
  const { bottom } = useSafeAreaInsets();
  return <View style={[stili.piede, { paddingBottom: sullaPagina ? Math.max(bottom, 12) : 12 }]}>{children}</View>;
}

// La barra in alto delle schermate che stanno sopra le schede (dettaglio richiesta): freccia indietro tonda e titolo.
export function BarraIndietro({ titolo }: { titolo: string }) {
  return (
    <View style={stili.barra}>
      <Pressable onPress={tornaIndietro} accessibilityRole="button" accessibilityLabel="Indietro" hitSlop={8} style={stili.barraIndietro}>
        <Icona nome="indietro" colore={COL.testo} dimensione={24} />
      </Pressable>
      <Text style={stili.barraTitolo} accessibilityRole="header">
        {titolo}
      </Text>
      <View style={stili.barraIndietro} />
    </View>
  );
}

// ---------- Pulsanti ----------

type TipoPulsante = 'giallo' | 'chiaro' | 'testo';

// Il pulsante grande: giallo con testo scuro per l'azione principale, bianco con bordo per le altre, solo testo per le azioni discrete.
export function Pulsante({
  titolo,
  onPress,
  tipo = 'giallo',
  icona,
  inCorso,
  disabilitato,
  altezza = ALTEZZA_PULSANTE,
}: {
  titolo: string;
  onPress: () => void;
  tipo?: TipoPulsante;
  icona?: NomeIcona;
  inCorso?: boolean;
  disabilitato?: boolean;
  altezza?: number;
}) {
  const spento = !!(inCorso || disabilitato);
  return (
    <Pressable
      onPress={onPress}
      disabled={spento}
      accessibilityRole="button"
      accessibilityState={{ disabled: spento, busy: !!inCorso }}
      style={({ pressed }) => [
        stili.pulsante,
        { height: altezza, borderRadius: altezza / 2 },
        tipo === 'giallo' && { backgroundColor: pressed ? COL.gialloPremuto : COL.giallo },
        tipo === 'chiaro' && { backgroundColor: pressed ? '#F6F5F1' : COL.scheda, borderWidth: 1, borderColor: COL.bordo },
        tipo === 'testo' && { backgroundColor: pressed ? '#ECEAE4' : 'transparent' },
        disabilitato && !inCorso && { opacity: 0.45 },
      ]}
    >
      {inCorso ? (
        <ActivityIndicator color={COL.testo} />
      ) : (
        <>
          {icona ? <Icona nome={icona} colore={tipo === 'testo' ? COL.grigio : COL.testo} dimensione={altezza > 50 ? 22 : 20} /> : null}
          <Text style={[stili.pulsanteTesto, altezza <= 50 && { fontSize: 15 }, tipo === 'testo' && { fontFamily: FC.semi, fontSize: 15, color: COL.grigio }]}>{titolo}</Text>
        </>
      )}
    </Pressable>
  );
}

// «Chiama» e «Naviga» affiancati (banco e cantiere). Chi non ha un telefono mostra solo la mappa.
export function PulsantiContatto({ telefono, mappa, etichettaMappa = 'Naviga' }: { telefono?: string; mappa: string; etichettaMappa?: string }) {
  return (
    <View style={stili.contatti}>
      {telefono ? (
        <View style={{ flex: 1 }}>
          <Pulsante titolo="Chiama" icona="telefono" tipo="chiaro" altezza={46} onPress={() => chiama(telefono)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Pulsante titolo={etichettaMappa} icona="esterno" tipo="chiaro" altezza={46} onPress={() => apriMappa(mappa)} />
      </View>
    </View>
  );
}

// ---------- Piccoli pezzi ----------

// Un'icona dentro un cerchio colorato (default: giallo chiaro con l'icona giallo scuro).
export function IconaTonda({ nome, misura = 40, sfondo = COL.gialloChiaro, colore = COL.gialloTesto }: { nome: NomeIcona; misura?: number; sfondo?: string; colore?: string }) {
  return (
    <View style={{ width: misura, height: misura, borderRadius: misura / 2, backgroundColor: sfondo, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Icona nome={nome} colore={colore} dimensione={Math.round(misura * 0.52)} />
    </View>
  );
}

// Un dato con la sua icona («34 min tempo totale», «12,4 km»).
export function Dato({ icona, valore, etichetta }: { icona: NomeIcona; valore: string; etichetta: string }) {
  return (
    <View style={stili.dato} accessible accessibilityLabel={`${etichetta}: ${valore}`}>
      <Icona nome={icona} colore={COL.gialloTesto} dimensione={20} />
      <View>
        <Text style={stili.datoValore}>{valore}</Text>
        <Text style={stili.datoEtichetta}>{etichetta}</Text>
      </View>
    </View>
  );
}

type Tono = 'info' | 'attenzione' | 'errore' | 'ok';

const TONI: Record<Tono, { sfondo: string; testo: string }> = {
  info: { sfondo: COL.gialloChiaro, testo: COL.gialloTesto },
  attenzione: { sfondo: COL.arancioChiaro, testo: COL.arancio },
  errore: { sfondo: COL.rossoChiaro, testo: COL.rosso },
  ok: { sfondo: COL.verdeChiaro, testo: COL.verde },
};

// Un riquadro colorato con titolo, testo e (se serve) un pulsante: «Attiva la posizione», «Hai una consegna in corso»...
export function AvvisoScheda({
  tono = 'attenzione',
  icona = 'avviso',
  titolo,
  testo,
  azione,
}: {
  tono?: Tono;
  icona?: NomeIcona;
  titolo: string;
  testo?: string;
  azione?: { titolo: string; onPress: () => void };
}) {
  const colori = TONI[tono];
  return (
    <View style={[stili.avviso, { backgroundColor: colori.sfondo }]} accessibilityRole="alert">
      <View style={stili.avvisoRiga}>
        <Icona nome={icona} colore={colori.testo} dimensione={22} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[stili.avvisoTitolo, { color: colori.testo }]}>{titolo}</Text>
          {testo ? <Text style={stili.avvisoTesto}>{testo}</Text> : null}
        </View>
      </View>
      {azione ? <Pulsante titolo={azione.titolo} onPress={azione.onPress} tipo="chiaro" altezza={46} /> : null}
    </View>
  );
}

// Niente da mostrare (nessuna richiesta, nessuna consegna...): icona grande, titolo, spiegazione e, se serve, un pulsante.
export function StatoVuoto({ icona, titolo, testo, azione }: { icona: NomeIcona; titolo: string; testo?: string; azione?: { titolo: string; onPress: () => void } }) {
  return (
    <View style={stili.vuoto}>
      <IconaTonda nome={icona} misura={72} />
      <Text style={stili.vuotoTitolo}>{titolo}</Text>
      {testo ? <Text style={stili.vuotoTesto}>{testo}</Text> : null}
      {azione ? (
        <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
          <Pulsante titolo={azione.titolo} onPress={azione.onPress} />
        </View>
      ) : null}
    </View>
  );
}

export function StatoErrore({ messaggio, riprova }: { messaggio: string; riprova?: () => void }) {
  return (
    <View style={stili.vuoto}>
      <IconaTonda nome="avviso" misura={72} sfondo={COL.rossoChiaro} colore={COL.rosso} />
      <Text style={stili.vuotoTesto}>{messaggio}</Text>
      {riprova ? (
        <View style={{ alignSelf: 'stretch', marginTop: 6 }}>
          <Pulsante titolo="Riprova" icona="riprova" tipo="chiaro" onPress={riprova} />
        </View>
      ) : null}
    </View>
  );
}

export function Caricamento() {
  return (
    <View style={stili.vuoto}>
      <ActivityIndicator color={COL.testo} size="large" />
    </View>
  );
}

const stili = StyleSheet.create({
  pagina: { flex: 1, backgroundColor: COL.sfondo },
  titolo: { fontFamily: FC.extra, fontSize: 28, lineHeight: 34, color: COL.testo },
  scheda: { backgroundColor: COL.scheda, borderWidth: 1, borderColor: COL.bordo, borderRadius: RAGGIO, padding: 16 },
  piede: { gap: 8, paddingHorizontal: 20, paddingTop: 12, backgroundColor: COL.sfondo, borderTopWidth: 1, borderTopColor: COL.bordo },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  barraIndietro: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  barraTitolo: { flex: 1, textAlign: 'center', fontFamily: FC.forte, fontSize: 18, color: COL.testo },
  pulsante: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  pulsanteTesto: { fontFamily: FC.forte, fontSize: 17, color: COL.testo },
  contatti: { flexDirection: 'row', gap: 10 },
  dato: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datoValore: { fontFamily: FC.forte, fontSize: 17, color: COL.testo },
  datoEtichetta: { fontFamily: FC.medio, fontSize: 12, color: COL.grigio },
  avviso: { gap: 12, padding: 14, borderRadius: RAGGIO },
  avvisoRiga: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avvisoTitolo: { fontFamily: FC.forte, fontSize: 16, lineHeight: 22 },
  avvisoTesto: { fontFamily: FC.medio, fontSize: 14, lineHeight: 20, color: COL.testo },
  vuoto: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  vuotoTitolo: { fontFamily: FC.extra, fontSize: 21, lineHeight: 27, color: COL.testo, textAlign: 'center' },
  vuotoTesto: { fontFamily: FC.medio, fontSize: 15, lineHeight: 22, color: COL.grigio, textAlign: 'center' },
});
