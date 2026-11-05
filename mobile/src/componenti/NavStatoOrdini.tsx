// L'icona e l'etichetta della scheda "Stato ordini" nella barra in basso (views/partials/cliente/nav_ordini.ejs): cambiano con la fase della prima attività.
//   nessuna → la scatola e "Stato ordini"; richiesta in attesa → l'anello arancio che si svuota e il conto alla rovescia (mm:ss);
//   ordine in consegna → il furgone verde e "Arriva tra 12 min" / "In arrivo" / "In consegna"; richiesta scaduta → la scatola rossa e "Nessuna risposta".
// Con due o più attività il sito alterna i fotogrammi ogni due secondi e mezzo: l'app non ha animazioni, quindi mostra la più urgente (la prima) e un numero
// con quante sono (la stessa soluzione del sito con «riduci movimento»; il numero lo mette il layout delle schede).
import { Text, type ColorValue } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useAttivitaInCorso, useContoAllaRovescia } from '../dati';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';
import { durataMinuti, mmss } from './ui';

// Circonferenza dell'anello da 24: 2 * PI * 10.5.
const CIRC = 65.97;
// Sotto questa soglia l'ordine è "In arrivo" (3 minuti, come il sito).
const IN_ARRIVO_SEC = 180;

type StatoNav =
  | { fase: 'nessuna' }
  | { fase: 'richiesta'; testo: string; frazione: number }
  | { fase: 'consegna'; testo: string }
  | { fase: 'scaduta'; testo: string };

// La fase da mostrare adesso, con il testo già scritto. I secondi scendono da soli.
function useStatoNav(): StatoNav {
  const q = useAttivitaInCorso();
  const v = q.data?.voci[0];
  const lettoIl = q.dataUpdatedAt;
  const secondiRichiesta = useContoAllaRovescia(v && v.fase === 'richiesta' ? (v.secondi ?? 0) : null, lettoIl);
  const conEta = !!v && v.fase === 'consegna' && v.minuti !== null && v.eta_sec !== null;
  const restano = useContoAllaRovescia(conEta ? v.eta_sec : null, lettoIl);
  if (!v) return { fase: 'nessuna' };
  if (v.fase === 'richiesta') {
    const secondi = secondiRichiesta ?? 0;
    return { fase: 'richiesta', testo: mmss(secondi), frazione: Math.min(1, Math.max(0, secondi / (v.durata || 600))) };
  }
  if (v.fase === 'consegna') {
    if (!conEta || restano === null) return { fase: 'consegna', testo: 'In consegna' };
    if (restano <= IN_ARRIVO_SEC) return { fase: 'consegna', testo: 'In arrivo' };
    return { fase: 'consegna', testo: 'Arriva tra ' + durataMinuti(Math.max(1, Math.ceil(restano / 60))) };
  }
  return { fase: 'scaduta', testo: 'Nessuna risposta' };
}

// L'icona della scheda: l'anello di una richiesta in attesa, il furgone verde di un ordine in consegna, la scatola rossa di una richiesta senza risposta.
export function IconaStatoOrdini({ color }: { color: ColorValue }) {
  const { c } = useTema();
  const s = useStatoNav();
  if (s.fase === 'richiesta') {
    return (
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
        <Circle cx={12} cy={12} r={2.4} fill={c.arancio} />
      </Svg>
    );
  }
  if (s.fase === 'consegna') return <Icona nome="furgone" colore={c.verde} />;
  if (s.fase === 'scaduta') return <Icona nome="ordini" colore={c.rosso} />;
  return <Icona nome="ordini" colore={color} />;
}

// L'etichetta sotto l'icona: arancio col conto alla rovescia, verde con i minuti all'arrivo, rossa senza risposta; altrimenti "Stato ordini" come le altre.
export function EtichettaStatoOrdini({ color }: { color: ColorValue }) {
  const { c } = useTema();
  const s = useStatoNav();
  const colore = s.fase === 'richiesta' ? c.arancio : s.fase === 'consegna' ? c.verde : s.fase === 'scaduta' ? c.rosso : color;
  const testo = s.fase === 'nessuna' ? 'Stato ordini' : s.testo;
  return (
    <Text numberOfLines={1} style={{ color: colore, fontSize: 12, fontFamily: s.fase === 'nessuna' ? FONT.testoMedio : FONT.testoForte, fontVariant: ['tabular-nums'] }}>
      {testo}
    </Text>
  );
}
