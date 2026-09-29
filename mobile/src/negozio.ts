// Stato condiviso con abbonamento selettivo: ogni componente si ridisegna solo quando cambia
// il pezzo di stato che legge (es. la quantità di UN prodotto), non a ogni modifica. Con un
// Context normale ogni "+" ridisegnava tutte le card dell'elenco, e il tasto sembrava lento.
import { useSyncExternalStore } from 'react';

export type Negozio<T> = {
  leggi: () => T;
  scrivi: (aggiorna: (prima: T) => T) => void;
  abbonati: (fn: () => void) => () => void;
};

export function creaNegozio<T>(iniziale: T): Negozio<T> {
  let stato = iniziale;
  const abbonati = new Set<() => void>();
  return {
    leggi: () => stato,
    scrivi: (aggiorna) => {
      const nuovo = aggiorna(stato);
      if (nuovo === stato) return;
      stato = nuovo;
      abbonati.forEach((fn) => fn());
    },
    abbonati: (fn) => {
      abbonati.add(fn);
      return () => abbonati.delete(fn);
    },
  };
}

// Il selettore deve restituire un valore semplice (numero, stringa) o lo stato stesso:
// un oggetto nuovo a ogni chiamata farebbe ridisegnare all'infinito.
export function useNegozio<T, S>(negozio: Negozio<T>, selettore: (stato: T) => S): S {
  return useSyncExternalStore(negozio.abbonati, () => selettore(negozio.leggi()));
}
