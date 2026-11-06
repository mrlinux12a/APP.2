// La posizione del telefono del corriere. È OBBLIGATORIA per accettare una richiesta (serve al server per calcolare il tempo e i km fino al banco) e si rileva da
// sola: una lettura quando serve, mai un tracciamento in continuo e nessun indirizzo scritto a mano (docs/app-corrieri.md). Qui sta tutto: permesso, lettura e
// ultima posizione nota. La posizione non si salva da nessuna parte: parte solo insieme alle richieste all'API che ne hanno bisogno (dati.ts).
import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking } from 'react-native';

import type { Posizione } from './tipi';

// verifica = non si sa ancora; concesso = si può leggere; da_chiedere = il telefono lascia ancora chiedere il permesso; bloccato = negato per sempre (solo dalle
// impostazioni del telefono).
export type Permesso = 'verifica' | 'concesso' | 'da_chiedere' | 'bloccato';

// Una lettura che non risponde entro questo tempo si lascia perdere (GPS spento, dentro un edificio...).
const TEMPO_MASSIMO_MS = 12000;
// Una posizione più recente di così si riusa; più vecchia si rilegge quando si torna alla schermata.
const ETA_UTILE_MS = 90 * 1000;
// Se la lettura nuova non riesce si ripiega sull'ultima posizione che il telefono conosce, purché non più vecchia di così.
const ETA_ACCETTABILE_MS = 3 * 60 * 1000;

let ultima: { posizione: Posizione; alle: number } | null = null;

// L'ultima posizione letta (le richieste all'API la mettono nell'indirizzo: vedi dati.ts), o null.
export function posizioneNota(): Posizione | null {
  return ultima ? ultima.posizione : null;
}

function daPermesso(p: Location.LocationPermissionResponse): Permesso {
  if (p.granted) return 'concesso';
  return p.canAskAgain ? 'da_chiedere' : 'bloccato';
}

// Il permesso com'è adesso, senza chiedere niente. Se il telefono non lo sa dire si considera ancora da chiedere.
async function leggiPermesso(): Promise<Permesso> {
  try {
    return daPermesso(await Location.getForegroundPermissionsAsync());
  } catch {
    return 'da_chiedere';
  }
}

const comePosizione = (p: Location.LocationObject): Posizione => ({ lat: p.coords.latitude, lng: p.coords.longitude });

// Una lettura dal telefono: quella nuova (con un limite di tempo) e, se non riesce, l'ultima che il telefono conosce purché recente. null se non si trova niente.
async function leggiDalTelefono(): Promise<Posizione | null> {
  let scadenza: ReturnType<typeof setTimeout> | undefined;
  try {
    const trovata = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((fine) => {
        scadenza = setTimeout(() => fine(null), TEMPO_MASSIMO_MS);
      }),
    ]);
    if (trovata) return comePosizione(trovata);
  } catch {
    // Servizi di localizzazione spenti o lettura non riuscita: si prova con l'ultima posizione nota.
  } finally {
    clearTimeout(scadenza);
  }
  try {
    const nota = await Location.getLastKnownPositionAsync({ maxAge: ETA_ACCETTABILE_MS });
    if (nota) return comePosizione(nota);
  } catch {}
  return null;
}

type Valore = {
  permesso: Permesso;
  // L'ultima posizione trovata, o null.
  posizione: Posizione | null;
  inLettura: boolean;
  // true se l'ultima lettura non ha trovato niente (con il permesso già concesso): GPS spento o segnale assente.
  fallita: boolean;
  // Mostra la richiesta di permesso del telefono (se può ancora) e, se viene concesso, legge la posizione.
  chiedi: () => Promise<Permesso>;
  // Rilegge permesso e posizione. `fresca`: ignora quella recente e legge di nuovo (serve all'accettazione). null se manca il permesso o la posizione non si trova.
  aggiorna: (opzioni?: { fresca?: boolean }) => Promise<Posizione | null>;
  apriImpostazioni: () => void;
};

const Contesto = createContext<Valore | null>(null);

// Da montare una volta, sopra tutte le schermate del corriere. Al ritorno dell'app in primo piano ricontrolla il permesso (può essere cambiato dalle impostazioni).
export function PosizioneProvider({ children }: { children: ReactNode }) {
  const clientDati = useQueryClient();
  const [permesso, setPermesso] = useState<Permesso>('verifica');
  const [posizione, setPosizione] = useState<Posizione | null>(posizioneNota());
  const [inLettura, setInLettura] = useState(false);
  const [fallita, setFallita] = useState(false);
  const inCorso = useRef<Promise<Posizione | null> | null>(null);

  // Una lettura alla volta: chi la chiede mentre ce n'è una in corso aspetta quella.
  const leggi = useCallback((): Promise<Posizione | null> => {
    if (inCorso.current) return inCorso.current;
    setInLettura(true);
    const lettura = leggiDalTelefono()
      .then((p) => {
        if (p) {
          ultima = { posizione: p, alle: Date.now() };
          setPosizione(p);
          setFallita(false);
          // Tempi e km delle richieste partono dalla posizione: con quella nuova si rileggono.
          clientDati.invalidateQueries({ queryKey: ['corriere', 'richieste'] });
          clientDati.invalidateQueries({ queryKey: ['corriere', 'richiesta'] });
        } else {
          setFallita(true);
        }
        return p;
      })
      .finally(() => {
        inCorso.current = null;
        setInLettura(false);
      });
    inCorso.current = lettura;
    return lettura;
  }, [clientDati]);

  const aggiorna = useCallback(
    ({ fresca = false }: { fresca?: boolean } = {}): Promise<Posizione | null> =>
      leggiPermesso().then((p) => {
        setPermesso(p);
        if (p !== 'concesso') return null;
        if (!fresca && ultima && Date.now() - ultima.alle < ETA_UTILE_MS) return ultima.posizione;
        return leggi();
      }),
    [leggi]
  );

  const chiedi = useCallback(async (): Promise<Permesso> => {
    let esito: Permesso;
    try {
      esito = daPermesso(await Location.requestForegroundPermissionsAsync());
    } catch {
      esito = 'da_chiedere';
    }
    setPermesso(esito);
    if (esito === 'concesso') leggi();
    return esito;
  }, [leggi]);

  useEffect(() => {
    aggiorna();
    const abbonamento = AppState.addEventListener('change', (s) => {
      if (s === 'active') aggiorna();
    });
    return () => abbonamento.remove();
  }, [aggiorna]);

  // All'uscita dall'account la posizione non resta al prossimo che entra sullo stesso telefono.
  useEffect(() => {
    return () => {
      ultima = null;
    };
  }, []);

  const valore = useMemo<Valore>(
    () => ({ permesso, posizione, inLettura, fallita, chiedi, aggiorna, apriImpostazioni: () => Linking.openSettings().catch(() => {}) }),
    [permesso, posizione, inLettura, fallita, chiedi, aggiorna]
  );
  return <Contesto.Provider value={valore}>{children}</Contesto.Provider>;
}

export function usePosizione(): Valore {
  const v = useContext(Contesto);
  if (!v) throw new Error('usePosizione fuori da PosizioneProvider');
  return v;
}
