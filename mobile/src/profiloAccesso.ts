// Quale schermata di accesso mostrare: quella dell'installatore o quella del corriere. L'app ricorda l'ultima scelta (AsyncStorage) e alla prossima apertura
// mostra quella; la scelta cambia toccando il selettore in cima alle schermate di accesso e di registrazione, e da sola con un accesso riuscito (chi esce
// ritrova l'accesso del suo tipo).
//
// È un piccolo negozio (come `negozio.ts`) e non uno stato della sessione: il valore si legge e si cambia SUBITO, senza aspettare un ridisegno. Il selettore
// scrive e porta alla schermata nuova nello stesso istante: con uno stato normale la schermata nuova potrebbe leggere ancora la scelta di prima e rimandare
// indietro.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { creaNegozio, useNegozio } from './negozio';
import type { ProfiloAccesso } from './tema';

const CHIAVE = 'profilo_accesso';
const negozio = creaNegozio<ProfiloAccesso>('installatore');

// Legge la scelta salvata (all'avvio, prima di mostrare l'app). Se manca o non si legge resta l'installatore: lo storage può dare errore (finestra privata
// del browser, dati bloccati) e l'accesso deve funzionare lo stesso.
export async function caricaProfiloAccesso(): Promise<void> {
  try {
    const salvato = await AsyncStorage.getItem(CHIAVE);
    if (salvato === 'installatore' || salvato === 'corriere') negozio.scrivi(() => salvato);
  } catch {}
}

// Cambia la scelta e la ricorda.
export function impostaProfiloAccesso(profilo: ProfiloAccesso): void {
  negozio.scrivi(() => profilo);
  AsyncStorage.setItem(CHIAVE, profilo).catch(() => {});
}

// La scelta di adesso, per le schermate.
export function useProfiloAccesso(): ProfiloAccesso {
  return useNegozio(negozio, (p) => p);
}
