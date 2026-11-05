// Le schede "Stato ordine" in cima alla home (views/partials/cliente/stato_home.ejs): UNA per ogni richiesta in attesa (anello che si svuota + conto alla
// rovescia) e per ogni ordine in consegna (minuti, corriere, avanzamento), una sotto l'altra. La richiesta scaduta da rinviare non ha scheda. Ogni scheda
// porta a "Stato ordini", già sulla pagina della sua attività. Niente animazioni: anello e barra si ridisegnano a ogni secondo.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, SvgXml } from 'react-native-svg';

import type { VoceAttivita } from '../api';
import { useAttivitaInCorso, useContoAllaRovescia } from '../dati';
import { ICONE } from '../icone';
import { FONT, useTema } from '../tema';
import { durataMinuti, mmss } from './ui';

const FRECCIA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
const FURGONE = ICONE.furgone.replace('stroke-width="1.6"', 'stroke-width="1.5"');
// Circonferenza dell'anello della scheda: 2 * PI * 24.
const CIRC = 150.8;
// Dove sta la barra di una consegna: a metà quando parte ("In viaggio") e un filo prima della fine all'arrivo (stesse costanti del server).
const PROGRESSO_IN_VIAGGIO = 0.5;
const PROGRESSO_ARRIVO = 0.94;
const IN_ARRIVO_SEC = 180;

// Apre "Stato ordini" già sulla pagina di questa attività.
function apri(v: VoceAttivita) {
  // `n` cambia a ogni tocco: così la pagina capisce che è una richiesta nuova anche se l'attività è la stessa di prima.
  router.navigate({ pathname: '/ordini', params: { voce: `${v.tipo}-${v.id}`, n: String(Date.now()) } });
}

function SchedaRichiesta({ v, lettoIl }: { v: VoceAttivita; lettoIl: number }) {
  const { c } = useTema();
  const secondi = useContoAllaRovescia(v.secondi ?? 0, lettoIl) ?? 0;
  const durata = v.durata || 600;
  const frazione = Math.min(1, Math.max(0, secondi / durata));
  // Il numero scritto è quello della configurazione (10), non la durata dell'anello: col timer accorciato per le prove sarebbe "1 min".
  const minuti = v.minuti_testo || Math.max(1, Math.round(durata / 60));
  return (
    <Pressable
      onPress={() => apri(v)}
      accessibilityRole="link"
      style={[stili.scheda, { backgroundColor: c.arancioChiaro, borderColor: '#f1c9b3' }]}
    >
      <View style={stili.riga}>
        <View style={stili.anello}>
          <Svg width={56} height={56} viewBox="0 0 56 56">
            <Circle cx={28} cy={28} r={24} fill="none" stroke="#ffffff" strokeWidth={4} />
            {frazione > 0 ? (
              <Circle
                cx={28}
                cy={28}
                r={24}
                fill="none"
                stroke={c.arancio}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={`${CIRC} ${CIRC}`}
                strokeDashoffset={CIRC * (1 - frazione)}
                rotation={-90}
                origin="28, 28"
              />
            ) : null}
          </Svg>
          <View style={stili.anelloCentro}>
            <Text style={[stili.tempo, { color: c.testo }]}>{mmss(secondi)}</Text>
          </View>
        </View>
        <View style={stili.testi}>
          <Text style={[stili.occhiello, { color: c.arancio }]}>Richiesta inviata</Text>
          <Text style={[stili.titolo, { color: c.testo }]}>Aspettiamo che un banco accetti</Text>
          <Text style={[stili.sub, { color: c.arancio }]}>Se nessuno accetta entro {minuti} min, ti rimborsiamo.</Text>
        </View>
        <SvgXml xml={FRECCIA} width={22} height={22} color={c.testo} />
      </View>
    </Pressable>
  );
}

function SchedaConsegna({ v, lettoIl }: { v: VoceAttivita; lettoIl: number }) {
  const { c } = useTema();
  const conEta = v.minuti !== null && v.eta_sec !== null;
  const restano = useContoAllaRovescia(conEta ? v.eta_sec : null, lettoIl);
  const inArrivo = restano !== null && restano <= IN_ARRIVO_SEC;
  const durata = v.durata_sec || 0;
  const minuti = restano !== null ? Math.max(1, Math.ceil(restano / 60)) : v.minuti;
  const titolo = !conEta || restano === null ? 'In consegna' : inArrivo ? 'In arrivo' : 'Arriva tra ' + durataMinuti(minuti ?? 1);
  // La barra avanza col tempo fino all'arrivo previsto; a metà ("In viaggio") se non c'è l'orario.
  const progresso =
    conEta && restano !== null && durata > 0
      ? PROGRESSO_IN_VIAGGIO + (PROGRESSO_ARRIVO - PROGRESSO_IN_VIAGGIO) * Math.min(1, Math.max(0, 1 - restano / durata))
      : PROGRESSO_IN_VIAGGIO;
  const corriere = v.corriere || '';
  return (
    <Pressable
      onPress={() => apri(v)}
      accessibilityRole="link"
      style={[stili.scheda, { backgroundColor: c.verdeChiaro, borderColor: '#bfe0c6' }]}
    >
      <View style={stili.riga}>
        <View style={stili.furgone}>
          <SvgXml xml={FURGONE} width={30} height={30} color={c.testo} />
        </View>
        <View style={stili.testi}>
          <Text style={[stili.occhiello, { color: c.verde }]}>Accettato · In consegna</Text>
          <Text style={[stili.titolo, { color: c.testo, fontSize: 18 }]}>{titolo}</Text>
          {corriere ? (
            <View style={stili.subRiga}>
              <View style={[stili.iniziale, { backgroundColor: c.verde }]}>
                <Text style={stili.inizialeTesto}>{Array.from(corriere)[0].toUpperCase()}</Text>
              </View>
              <Text style={[stili.sub, { color: c.verde, flexShrink: 1 }]}>
                Te lo porta <Text style={{ fontFamily: FONT.testoForte }}>{corriere}</Text>
              </Text>
            </View>
          ) : null}
        </View>
        <SvgXml xml={FRECCIA} width={22} height={22} color={c.testo} />
      </View>
      <View style={stili.barra}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.verde, width: `${Math.round(progresso * 1000) / 10}%` }} />
      </View>
      <View style={stili.tappe}>
        <Text style={[stili.tappa, { color: c.grigio }]}>Accettato</Text>
        <Text style={[stili.tappa, { color: c.grigio, textAlign: 'center' }]}>In viaggio</Text>
        <Text style={[stili.tappa, { color: c.grigio, textAlign: 'right' }]}>Consegnato</Text>
      </View>
    </Pressable>
  );
}

// Le schede in cima alla home: nessuna se non c'è niente in corso. Si leggono "in silenzio": non segnano lette le notifiche.
export function StatoHome() {
  const q = useAttivitaInCorso();
  const schede = (q.data?.voci ?? []).filter((v) => v.fase === 'richiesta' || v.fase === 'consegna');
  if (!schede.length) return null;
  return (
    <View>
      {schede.map((v) =>
        v.fase === 'richiesta' ? (
          <SchedaRichiesta key={`${v.tipo}-${v.id}`} v={v} lettoIl={q.dataUpdatedAt} />
        ) : (
          <SchedaConsegna key={`${v.tipo}-${v.id}`} v={v} lettoIl={q.dataUpdatedAt} />
        )
      )}
    </View>
  );
}

const stili = StyleSheet.create({
  scheda: { marginBottom: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderRadius: 16 },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  testi: { flex: 1, minWidth: 0, gap: 2 },
  occhiello: { fontFamily: FONT.testoForte, fontSize: 11.5, letterSpacing: 0.69, textTransform: 'uppercase' },
  titolo: { fontFamily: FONT.titolo, fontSize: 16, lineHeight: 20 },
  sub: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 17 },
  subRiga: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  anello: { width: 56, height: 56 },
  anelloCentro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  tempo: { fontFamily: FONT.titolo, fontSize: 13, fontVariant: ['tabular-nums'] },
  furgone: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  iniziale: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  inizialeTesto: { color: '#ffffff', fontFamily: FONT.testoForte, fontSize: 11 },
  barra: { marginTop: 12, height: 6, borderRadius: 3, backgroundColor: '#ffffff', overflow: 'hidden' },
  tappe: { flexDirection: 'row', marginTop: 6 },
  tappa: { flex: 1, fontFamily: FONT.testo, fontSize: 12 },
});
