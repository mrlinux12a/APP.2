// L'icona e l'etichetta della scheda "Stato ordini" nella barra in basso, uguali a quelle del sito (views/partials/cliente/nav_ordini.ejs e nav_ordini_fase.ejs,
// assets/css/07_stato_ordini_e_home.css): un'icona per ogni fase dell'attività.
//   nessuna → la scatola e "Stato ordini";
//   richiesta in attesa → l'anello arancio che si svuota con la scatola dentro, il puntino arancio in alto a destra e "In attesa · 07:42";
//   ordine in consegna → il furgone con la pastiglia verde dei minuti (45′) e "Arriva tra 45 min" / "In arrivo" / "In consegna";
//   richiesta senza risposta → la scatola grigia con il "!" rosso e "Nessuna risposta".
// Con DUE O PIÙ attività mostra un fotogramma alla volta, uno per attività, e passa al successivo ogni 2,5 secondi (come il sito), con sotto un puntino per
// attività che dice quale si sta vedendo. Il cambio è netto, senza dissolvenza (nell'app non ci sono animazioni). Con «riduci movimento» del telefono non si alterna:
// resta il primo fotogramma (il più urgente) e un numero scuro in alto a sinistra dice quante sono. Icona ed etichetta sono due pezzi separati della barra: leggono lo
// stesso contatore (`giro`), così mostrano sempre la stessa attività. Il tocco sulla scheda porta alla pagina dell'attività che si vede in quel momento (`useVoceMostrata`).
import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Text, View, type ColorValue } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { VoceAttivita } from '../api';
import { useAttivitaInCorso, useContoAllaRovescia } from '../dati';
import { creaNegozio, useNegozio } from '../negozio';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';
import { durataBreve, durataMinuti, mmss } from './ui';

// Circonferenza dell'anello da 24: 2 * PI * 10.5.
const CIRC = 65.97;
// Sotto questa soglia l'ordine è "In arrivo" (3 minuti, come il sito).
const IN_ARRIVO_SEC = 180;
// Ogni quanto si passa all'attività successiva (come il sito: 2,5 secondi).
const PASSO_MS = 2500;
// Il colore scuro dei puntini e del numero (lo stesso del sito).
const SCURO = '#1C1917';
const NESSUNA_VOCE: VoceAttivita[] = [];

// ---- Il contatore che fa girare i fotogrammi, uguale per l'icona e per l'etichetta ----

// Quante volte è passato il tempo di un fotogramma: il fotogramma visibile è `giro % numero di attività`.
const giro = creaNegozio(0);
let usiDelGiro = 0;
let timerGiro: ReturnType<typeof setInterval> | null = null;
let ascoltoApp: { remove: () => void } | null = null;

// Fa partire il timer se l'app è in primo piano (in background non serve girare).
function avviaTimer() {
  if (timerGiro || AppState.currentState !== 'active') return;
  timerGiro = setInterval(() => giro.scrivi((n) => (n + 1) % 1000000), PASSO_MS);
}

function fermaTimer() {
  if (!timerGiro) return;
  clearInterval(timerGiro);
  timerGiro = null;
}

// Chiede di far girare i fotogrammi; restituisce la funzione che rinuncia. Il timer è uno solo anche se lo chiedono in tanti (le due icone della barra, che
// si sovrappongono, e l'etichetta): parte col primo, si ferma con l'ultimo, e riparte dal primo fotogramma.
function prendiGiro() {
  usiDelGiro += 1;
  if (usiDelGiro === 1) {
    giro.scrivi(() => 0);
    ascoltoApp = AppState.addEventListener('change', (stato) => (stato === 'active' ? avviaTimer() : fermaTimer()));
    avviaTimer();
  }
  return () => {
    usiDelGiro -= 1;
    if (usiDelGiro > 0) return;
    fermaTimer();
    ascoltoApp?.remove();
    ascoltoApp = null;
  };
}

function useGiro(attivo: boolean) {
  useEffect(() => (attivo ? prendiGiro() : undefined), [attivo]);
}

// «Riduci movimento» del telefono: con quello acceso i fotogrammi non si alternano (come «riduci movimento» del sito).
export function useRiduciMovimento() {
  const [riduci, setRiduci] = useState(false);
  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (vivo) setRiduci(v);
      })
      .catch(() => {});
    const ascolto = AccessibilityInfo.addEventListener('reduceMotionChanged', setRiduci);
    return () => {
      vivo = false;
      ascolto.remove();
    };
  }, []);
  return riduci;
}

// Le attività in corso e quale mostrare adesso: `i` è l'indice del fotogramma visibile (sempre 0 con una sola attività o con «riduci movimento»).
function useFotogrammi() {
  const { data, dataUpdatedAt } = useAttivitaInCorso();
  const riduci = useRiduciMovimento();
  const voci = data ? data.voci : NESSUNA_VOCE;
  const n = voci.length;
  const alterna = n >= 2 && !riduci;
  useGiro(alterna);
  const passo = useNegozio(giro, (s) => s);
  return { voci, n, i: alterna ? passo % n : 0, lettoIl: dataUpdatedAt, alterna, riduci };
}

// La voce che si sta vedendo adesso nella barra, solo se le attività sono due o più (con una sola il tocco fa quello di sempre). Serve al tocco sulla scheda:
// come sul sito, porta dritto alla pagina di quell'attività.
export function useVoceMostrata() {
  const { data } = useAttivitaInCorso();
  const riduci = useRiduciMovimento();
  return (): VoceAttivita | null => {
    const voci = data ? data.voci : NESSUNA_VOCE;
    if (voci.length < 2) return null;
    return voci[riduci ? 0 : giro.leggi() % voci.length] ?? null;
  };
}

// La frase che il lettore di schermo legge al posto dei fotogrammi che cambiano da soli: "Stato ordini: 2 attivi. In attesa. Arriva tra 18 min."
export function fraseStatoOrdini(voci: VoceAttivita[]) {
  const frase = (v: VoceAttivita) => {
    if (v.fase === 'richiesta') return 'In attesa';
    if (v.fase === 'consegna') return v.minuti === null ? 'In consegna' : v.in_arrivo ? 'In arrivo' : 'Arriva tra ' + durataMinuti(v.minuti);
    return 'Nessuna risposta';
  };
  return `Stato ordini: ${voci.length} attivi. ${voci.map(frase).join('. ')}.`;
}

// ---- Cosa si vede per una fase ----

type Vista =
  | { fase: 'richiesta'; testo: string; frazione: number }
  | { fase: 'consegna'; testo: string; pastiglia: string | null }
  | { fase: 'scaduta'; testo: string };

// Testo, anello e pastiglia di un'attività, con i secondi che scendono da soli fra una lettura e l'altra.
function useVista(v: VoceAttivita, lettoIl: number): Vista {
  const secondiRichiesta = useContoAllaRovescia(v.fase === 'richiesta' ? (v.secondi ?? 0) : null, lettoIl);
  const secondiArrivo = useContoAllaRovescia(v.fase === 'consegna' && v.minuti !== null && v.eta_sec !== null ? v.eta_sec : null, lettoIl);
  if (v.fase === 'richiesta') {
    const secondi = secondiRichiesta ?? 0;
    return { fase: 'richiesta', testo: 'In attesa · ' + mmss(secondi), frazione: Math.min(1, Math.max(0, secondi / (v.durata || 600))) };
  }
  if (v.fase === 'consegna') {
    // Senza l'orario di arrivo del corriere non si sa quanto manca: solo "In consegna" e nessuna pastiglia.
    if (v.minuti === null) return { fase: 'consegna', testo: 'In consegna', pastiglia: null };
    const inArrivo = secondiArrivo !== null ? secondiArrivo <= IN_ARRIVO_SEC : v.in_arrivo;
    const minuti = secondiArrivo !== null ? Math.max(1, Math.ceil(secondiArrivo / 60)) : v.minuti;
    return { fase: 'consegna', testo: inArrivo ? 'In arrivo' : 'Arriva tra ' + durataMinuti(minuti), pastiglia: inArrivo ? null : durataBreve(minuti) };
  }
  return { fase: 'scaduta', testo: 'Nessuna risposta' };
}

// La pastiglia tonda sull'angolo dell'icona: i minuti all'arrivo (verde) o il "!" (rosso). `sinistra` è la distanza dal bordo sinistro dell'icona.
function Pastiglia({ testo, sfondo, sinistra }: { testo: string; sfondo: string; sinistra: number }) {
  const { c } = useTema();
  return (
    <View
      style={{
        position: 'absolute',
        top: -5,
        left: sinistra,
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: c.superficie,
        backgroundColor: sfondo,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#ffffff', fontFamily: FONT.testoForte, fontSize: 9.6, lineHeight: 12, includeFontPadding: false }}>{testo}</Text>
    </View>
  );
}

// Il numero delle attività, solo con «riduci movimento»: in alto a sinistra sull'icona, in un pallino scuro (.conteggio del sito).
function Conteggio({ n }: { n: number }) {
  const { c } = useTema();
  return (
    <View
      style={{
        position: 'absolute',
        top: 1,
        left: -10,
        minWidth: 15,
        height: 15,
        paddingHorizontal: 4,
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: c.superficie,
        backgroundColor: SCURO,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#ffffff', fontFamily: FONT.testoForte, fontSize: 9.6, lineHeight: 12, includeFontPadding: false }}>{n}</Text>
    </View>
  );
}

// L'icona di UN'attività (quadrato da 24, come .ico-stato del sito): anello con la scatola e il puntino, furgone con i minuti, scatola grigia con il "!".
function IconaFase({ v, lettoIl, color }: { v: VoceAttivita; lettoIl: number; color: ColorValue }) {
  const { c } = useTema();
  const s = useVista(v, lettoIl);
  if (s.fase === 'richiesta') {
    return (
      <>
        <Svg width={24} height={24} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={10.5} fill="none" stroke={c.arancioChiaro} strokeWidth={2.2} />
          {s.frazione > 0 ? (
            <Circle
              cx={12}
              cy={12}
              r={10.5}
              fill="none"
              stroke={c.arancio}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeDasharray={`${CIRC} ${CIRC}`}
              strokeDashoffset={CIRC * (1 - s.frazione)}
              rotation={-90}
              origin="12, 12"
            />
          ) : null}
        </Svg>
        {/* La scatola da 12 px al centro dell'anello e il puntino arancio in alto a destra (fermo: nell'app niente pulsazione). */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Icona nome="ordini" colore={color} dimensione={12} />
        </View>
        <View style={{ position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: c.superficie, backgroundColor: c.arancio }} />
      </>
    );
  }
  if (s.fase === 'consegna') {
    return (
      <>
        <Icona nome="furgone" colore={color} dimensione={22} />
        {s.pastiglia ? <Pastiglia testo={s.pastiglia} sfondo={c.verde} sinistra={18} /> : null}
      </>
    );
  }
  return (
    <>
      <Icona nome="ordini" colore={c.grigio} dimensione={20} />
      <Pastiglia testo="!" sfondo={c.rosso} sinistra={16} />
    </>
  );
}

// L'icona della scheda: quella dell'attività che tocca in questo momento (una sola, o a turno se sono due o più).
export function IconaStatoOrdini({ color }: { color: ColorValue }) {
  const f = useFotogrammi();
  const v = f.voci[f.i];
  if (!v) return <Icona nome="ordini" colore={color} />;
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <IconaFase v={v} lettoIl={f.lettoIl} color={color} />
      {f.riduci && f.n >= 2 ? <Conteggio n={f.n} /> : null}
    </View>
  );
}

// Il testo dell'etichetta, uguale in tutti gli stati. La barra è bassa (circa 48 px: 5 di margine, 28 per l'icona, la riga dell'etichetta): la riga è di 13 px e sale di 2
// sotto l'icona (che è da 24 dentro un riquadro da 28), così il testo sta dove stanno quelli di Catalogo e Carrello e i puntini restano dentro la scheda.
const RIGA_ETICHETTA = { marginTop: -2, fontSize: 12, lineHeight: 13 } as const;

// Un puntino per attività sotto l'etichetta: quello pieno è l'attività che si sta vedendo (.puntini del sito, qui da 4 px per entrare nella barra).
function Puntini({ n, attivo }: { n: number; attivo: number }) {
  return (
    <View style={{ position: 'absolute', top: '100%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4, pointerEvents: 'none' }}>
      {Array.from({ length: n }, (_, k) => (
        <View key={k} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: SCURO, opacity: k === attivo ? 1 : 0.25 }} />
      ))}
    </View>
  );
}

// L'etichetta di UN'attività: arancio col conto alla rovescia, verde con i minuti all'arrivo, rossa senza risposta.
function EtichettaFase({ v, lettoIl }: { v: VoceAttivita; lettoIl: number }) {
  const { c } = useTema();
  const s = useVista(v, lettoIl);
  const colore = s.fase === 'richiesta' ? c.arancio : s.fase === 'consegna' ? c.verde : c.rosso;
  return (
    <Text numberOfLines={1} style={[RIGA_ETICHETTA, { color: colore, fontFamily: FONT.testoForte, fontVariant: ['tabular-nums'] }]}>
      {s.testo}
    </Text>
  );
}

// L'etichetta sotto l'icona: segue la stessa attività dell'icona e, con due o più, ha sotto i puntini; senza attività è "Stato ordini" come le altre schede.
export function EtichettaStatoOrdini({ color }: { color: ColorValue }) {
  const f = useFotogrammi();
  const v = f.voci[f.i];
  if (!v) {
    return (
      <Text numberOfLines={1} style={[RIGA_ETICHETTA, { color, fontFamily: FONT.testoMedio }]}>
        Stato ordini
      </Text>
    );
  }
  return (
    <View style={{ alignItems: 'center' }}>
      <EtichettaFase v={v} lettoIl={f.lettoIl} />
      {f.alterna ? <Puntini n={f.n} attivo={f.i} /> : null}
    </View>
  );
}
