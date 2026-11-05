import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, SvgXml } from 'react-native-svg';

import type { VoceAttivita } from '@/api';
import { FiguraVuota } from '@/componenti/att';
import { Icona } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { durataMinuti, mmss } from '@/componenti/ui';
import { VistaOrdine } from '@/componenti/VistaOrdine';
import { VistaRichiesta } from '@/componenti/VistaRichiesta';
import { useContoAllaRovescia, useStatoOrdini } from '@/dati';
import { ICONE } from '@/icone';
import { FONT, useTema } from '@/tema';

const IN_ARRIVO_SEC = 180;
// Circonferenza dell'anellino della scheda: 2 * PI * 10.5.
const CIRC = 65.97;
const FURGONE = ICONE.furgone.replace('stroke-width="1.6"', 'stroke-width="1.5"');

// Un passo di "Come funziona": icona colorata in un riquadro da 40, titolo e frase.
function Passo({ icona, tono, titolo, testo }: { icona: 'invio' | 'negozio' | 'furgone'; tono: 'blu' | 'arancio' | 'verde'; titolo: string; testo: string }) {
  const { c } = useTema();
  const sfondo = tono === 'blu' ? c.accentoChiaro : tono === 'arancio' ? c.arancioChiaro : c.verdeChiaro;
  const colore = tono === 'blu' ? c.accento : tono === 'arancio' ? c.arancio : c.verde;
  return (
    <View style={stili.passo}>
      <View style={[stili.passoIcona, { backgroundColor: sfondo }]}>
        <Icona nome={icona} colore={colore} dimensione={22} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[stili.passoTitolo, { color: c.testo }]}>{titolo}</Text>
        <Text style={[stili.passoTesto, { color: c.grigio }]}>{testo}</Text>
      </View>
    </View>
  );
}

// Nessuna attività in corso (views/cliente/ordini_cliente.ejs): la figura, il titolo, "Come funziona", "Vai al catalogo" e la riga "Storico ordini".
function NessunOrdine({ minuti }: { minuti: number }) {
  const { c } = useTema();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.sfondo }} contentContainerStyle={stili.vuoto}>
      <FiguraVuota icona="furgone" />

      <View style={{ alignItems: 'center' }}>
        <Text style={[stili.vuotoTitolo, { color: c.testo }]}>Nessun ordine in corso</Text>
        <Text style={[stili.vuotoSotto, { color: c.grigio }]}>Quando mandi una richiesta, qui segui ogni passaggio fino al cantiere.</Text>
      </View>

      <View style={[stili.scheda, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
        <Text style={[stili.occhiello, { color: c.grigio }]}>Come funziona</Text>
        <View style={{ gap: 14 }}>
          <Passo icona="invio" tono="blu" titolo="Mandi la richiesta" testo="Scegli i pezzi e paghi dal carrello." />
          <Passo icona="negozio" tono="arancio" titolo="Il banco conferma" testo={`Entro ${minuti} minuti, o ti rimborsiamo.`} />
          <Passo icona="furgone" tono="verde" titolo="Arriva in cantiere" testo="Vedi chi lo porta e quanto manca." />
        </View>
      </View>

      <Pressable
        onPress={() => router.navigate('/')}
        accessibilityRole="button"
        style={({ pressed }) => [stili.pulsante, { backgroundColor: pressed ? c.accentoScuro : c.accento }]}
      >
        <Icona nome="catalogo" colore={c.suAccento} dimensione={22} />
        <Text style={[stili.pulsanteTesto, { color: c.suAccento }]}>Vai al catalogo</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/ordini/storico')}
        accessibilityRole="link"
        style={[stili.rigaStorico, { backgroundColor: c.superficie, borderColor: c.bordo }]}
      >
        <View style={stili.rigaStoricoIcona}>
          <Icona nome="orario" colore={c.testo} dimensione={20} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[stili.passoTitolo, { color: c.testo }]}>Storico ordini</Text>
          <Text style={[stili.rigaStoricoSotto, { color: c.grigio }]}>Richieste e ordini passati</Text>
        </View>
        <Text style={stili.freccia}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

const chiaveVoce = (v: VoceAttivita) => `${v.tipo}-${v.id}`;

// Una scheda della striscia (.str-scheda): icona (anello per la richiesta, furgone per la consegna, scatola spenta con "!" per la scaduta), il valore e il nome breve.
function SchedaStriscia({ v, attiva, lettoIl, scegli, larghezza }: { v: VoceAttivita; attiva: boolean; lettoIl: number; scegli: () => void; larghezza?: number }) {
  const { c } = useTema();
  const secondi = useContoAllaRovescia(v.fase === 'richiesta' ? (v.secondi ?? 0) : null, lettoIl);
  const restano = useContoAllaRovescia(v.fase === 'consegna' && v.minuti !== null && v.eta_sec !== null ? v.eta_sec : null, lettoIl);
  const colori =
    v.fase === 'richiesta'
      ? { valore: '#8a3a14', sfondo: c.arancioChiaro, bordo: c.arancio }
      : v.fase === 'consegna'
        ? { valore: '#1f5f2e', sfondo: c.verdeChiaro, bordo: c.verde }
        : { valore: '#991b1b', sfondo: c.rossoChiaro, bordo: c.rosso };
  const frazione = v.fase === 'richiesta' && secondi !== null ? Math.min(1, Math.max(0, secondi / (v.durata || 600))) : 0;
  const valore =
    v.fase === 'richiesta'
      ? mmss(secondi ?? 0)
      : v.fase === 'consegna'
        ? restano !== null
          ? restano <= IN_ARRIVO_SEC
            ? 'In arrivo'
            : 'tra ' + durataMinuti(Math.max(1, Math.ceil(restano / 60)))
          : v.minuti === null
            ? 'In consegna'
            : v.in_arrivo
              ? 'In arrivo'
              : 'tra ' + durataMinuti(v.minuti)
        : 'Rinvia';
  return (
    <Pressable
      onPress={scegli}
      accessibilityRole="button"
      accessibilityState={{ selected: attiva }}
      style={[
        stili.str,
        larghezza ? { width: larghezza } : { flex: 1 },
        attiva ? { borderWidth: 2, backgroundColor: colori.sfondo, borderColor: colori.bordo } : { borderWidth: 1.5, backgroundColor: c.superficie, borderColor: c.bordo },
      ]}
    >
      <View style={stili.strIcona}>
        {v.fase === 'richiesta' ? (
          <>
            <Svg width={30} height={30} viewBox="0 0 24 24">
              <Circle cx={12} cy={12} r={10.5} fill="none" stroke={c.arancioChiaro} strokeWidth={2.4} />
              {frazione > 0 ? (
                <Circle
                  cx={12}
                  cy={12}
                  r={10.5}
                  fill="none"
                  stroke={c.arancio}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeDasharray={`${CIRC} ${CIRC}`}
                  strokeDashoffset={CIRC * (1 - frazione)}
                  rotation={-90}
                  origin="12, 12"
                />
              ) : null}
            </Svg>
            <View style={stili.strCentro}>
              <Icona nome="ordini" colore="#000000" dimensione={15} />
            </View>
          </>
        ) : v.fase === 'consegna' ? (
          <SvgXml xml={FURGONE} width={28} height={28} color="#1f5f2e" />
        ) : (
          <>
            <Icona nome="ordini" colore={c.grigio} dimensione={26} />
            <View style={[stili.strAllarme, { backgroundColor: c.rosso }]}>
              <Text style={stili.strAllarmeTesto}>!</Text>
            </View>
          </>
        )}
      </View>
      <Text style={[stili.strValore, { color: colori.valore }]} numberOfLines={1}>
        {valore}
      </Text>
      <Text style={[stili.strBreve, { color: '#6b6a5f' }]} numberOfLines={1}>
        {v.breve}
      </Text>
    </Pressable>
  );
}

// La striscia di schede in cima (partials/cliente/striscia_ordini.ejs), solo con due o più attività in corso: "N in corso · 1 di N" e una scheda per attività.
// Fino a 3 stanno in una riga a colonne uguali, da 4 in su scorrono di lato (112 px l'una).
function Striscia({ voci, attiva, scegli, lettoIl }: { voci: VoceAttivita[]; attiva: string; scegli: (chiave: string) => void; lettoIl: number }) {
  const { c } = useTema();
  const posizione = voci.findIndex((v) => chiaveVoce(v) === attiva) + 1;
  const schede = voci.map((v) => (
    <SchedaStriscia
      key={chiaveVoce(v)}
      v={v}
      attiva={chiaveVoce(v) === attiva}
      lettoIl={lettoIl}
      scegli={() => scegli(chiaveVoce(v))}
      larghezza={voci.length >= 4 ? 112 : undefined}
    />
  ));
  return (
    <View style={[stili.striscia, { backgroundColor: c.superficie }]}>
      <View style={stili.strisciaTesta}>
        <Text style={stili.strisciaConta}>{voci.length} in corso</Text>
        <Text style={stili.strisciaPos}>
          {posizione} di {voci.length}
        </Text>
      </View>
      {voci.length >= 4 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {schede}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>{schede}</View>
      )}
    </View>
  );
}

// Come /ordini sul sito: senza attività la pagina vuota, con una la sua pagina, con due o più la striscia di schede (la prima è la più urgente) e sotto la
// pagina di quella scelta. Si aggiorna da sola: una richiesta ogni 15 secondi, un ordine in consegna ogni minuto.
export default function StatoOrdini() {
  const { c } = useTema();
  const q = useStatoOrdini();
  const [scelta, setScelta] = useState<string | null>(null);
  // Le schede in cima alla home aprono questa pagina già sulla loro attività (`voce` = "richiesta-12" / "ordine-5"); `n` cambia a ogni tocco.
  const { voce, n } = useLocalSearchParams<{ voce?: string; n?: string }>();
  const [nVisto, setNVisto] = useState<string | undefined>(undefined);
  // La voce si applica una volta sola per ogni tocco: tornando sulla scheda con gli stessi parametri non deve riportare alla stessa attività.
  if (voce && n && n !== nVisto) {
    setNVisto(n);
    setScelta(voce);
  }

  // Ogni volta che si torna su questa scheda l'elenco si ricalcola.
  useFocusEffect(
    useCallback(() => {
      q.refetch();
      return () => setScelta(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;

  const voci = q.data.voci;
  if (!voci.length) return <NessunOrdine minuti={q.data.minuti_testo} />;
  const corrente = voci.find((v) => chiaveVoce(v) === scelta) || voci[0];
  const k = chiaveVoce(corrente);
  const compatta = voci.length >= 2;
  // Con la richiesta scaduta da poco c'è solo "Nessuna risposta": si apre la sua pagina (da lì si rinvia).
  const pagina =
    corrente.tipo === 'ordine' ? (
      <VistaOrdine key={k} id={corrente.id} compatta={compatta} />
    ) : (
      <VistaRichiesta key={k} id={corrente.id} quandoChiusa={() => q.refetch()} compatta={compatta} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.sfondo }}>
      {compatta ? <Striscia voci={voci} attiva={k} scegli={setScelta} lettoIl={q.dataUpdatedAt} /> : null}
      <View style={{ flex: 1 }}>{pagina}</View>
    </View>
  );
}

const stili = StyleSheet.create({
  vuoto: { flexGrow: 1, gap: 22, paddingTop: 28, paddingHorizontal: 16, paddingBottom: 110 },
  vuotoTitolo: { fontFamily: FONT.titoloForte, fontSize: 22, lineHeight: 28, textAlign: 'center' },
  vuotoSotto: { maxWidth: 300, marginTop: 8, fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  scheda: { borderWidth: 1, borderRadius: 16, padding: 16 },
  occhiello: { marginBottom: 14, fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.96, lineHeight: 14, textTransform: 'uppercase' },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passoIcona: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  passoTitolo: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 20 },
  passoTesto: { fontFamily: FONT.testo, fontSize: 13.5, lineHeight: 18 },
  pulsante: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 54, borderRadius: 27 },
  pulsanteTesto: { fontFamily: FONT.testoForte, fontSize: 17 },
  rigaStorico: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 16 },
  rigaStoricoIcona: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1efea', alignItems: 'center', justifyContent: 'center' },
  rigaStoricoSotto: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 18 },
  freccia: { color: '#a8a69b', fontSize: 24, lineHeight: 26 },
  striscia: { paddingTop: 2, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2ded3' },
  strisciaTesta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 10, paddingBottom: 8, paddingHorizontal: 2 },
  strisciaConta: { fontFamily: FONT.testoForte, fontSize: 13, letterSpacing: 0.78, textTransform: 'uppercase', color: '#5c5b52' },
  strisciaPos: { fontFamily: FONT.testo, fontSize: 13, color: '#6b6a5f' },
  str: { height: 86, minWidth: 0, paddingHorizontal: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 14 },
  strIcona: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  strCentro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  strAllarme: { position: 'absolute', top: -3, right: -5, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 8, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  strAllarmeTesto: { color: '#ffffff', fontFamily: FONT.testoForte, fontSize: 9, lineHeight: 11 },
  strValore: { fontFamily: FONT.titoloForte, fontSize: 14, lineHeight: 16, fontVariant: ['tabular-nums'] },
  strBreve: { maxWidth: '100%', fontFamily: FONT.testo, fontSize: 11.5, lineHeight: 14 },
});
