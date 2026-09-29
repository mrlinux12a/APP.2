// Carrello dell'app: vive sul telefono (non nella sessione web) e parte intero verso il
// server quando si chiede la disponibilità. Si salva per utente, così sopravvive alla
// chiusura dell'app senza mescolarsi fra due account sullo stesso telefono.
//
// Come sul sito, nel catalogo lo stepper non tocca subito il carrello: prepara una
// "selezione", e il tasto Aggiungi in basso la sposta nel carrello tutta insieme.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, type ReactNode } from 'react';

import { creaNegozio, useNegozio } from './negozio';
import { useSessione } from './sessione';

// Copia dei dati del prodotto al momento della scelta: servono solo per mostrare la riga.
// Prezzi e disponibilità veri li ricalcola il server.
export type DatiRiga = {
  id: number;
  nome: string;
  etichetta: string | null; // misura della variante scelta, se il prodotto ne ha
  codice: string;
  prezzo: string;
  prezzo_valore: number;
  foto_url: string | null;
};

export type RigaCarrello = DatiRiga & { quantita: number };

type Righe = Record<number, RigaCarrello>;

const negozioCarrello = creaNegozio<Righe>({});
const negozioSelezione = creaNegozio<Righe>({});

function sommaPezzi(righe: Righe) {
  let n = 0;
  for (const k in righe) n += righe[k].quantita;
  return n;
}

function conQuantita(righe: Righe, riga: DatiRiga, quantita: number): Righe {
  const dopo = { ...righe };
  if (quantita > 0) dopo[riga.id] = { ...riga, quantita };
  else delete dopo[riga.id];
  return dopo;
}

// ---------- Carrello ----------

export const carrello = {
  imposta(riga: DatiRiga, quantita: number) {
    negozioCarrello.scrivi((prima) => conQuantita(prima, riga, quantita));
  },
  svuota() {
    negozioCarrello.scrivi(() => ({}));
  },
  // Coppie {id, quantita} da mandare al server.
  voci() {
    return Object.values(negozioCarrello.leggi()).map((r) => ({ id: r.id, quantita: r.quantita }));
  },
};

export function useQuantitaNelCarrello(id: number) {
  return useNegozio(negozioCarrello, (s) => (s[id] ? s[id].quantita : 0));
}

export function usePezziNelCarrello() {
  return useNegozio(negozioCarrello, sommaPezzi);
}

export function useRigheCarrello(): RigaCarrello[] {
  const stato = useNegozio(negozioCarrello, (s) => s);
  return Object.values(stato);
}

// ---------- Selezione (stepper del catalogo, prima di Aggiungi) ----------

export const selezione = {
  imposta(riga: DatiRiga, quantita: number) {
    negozioSelezione.scrivi((prima) => conQuantita(prima, riga, quantita));
  },
  // Cambio di misura su una card: la quantità scelta passa alla nuova variante.
  sposta(daId: number, a: DatiRiga) {
    negozioSelezione.scrivi((prima) => {
      const q = prima[daId] ? prima[daId].quantita : 0;
      if (!q) return prima;
      const dopo = { ...prima };
      delete dopo[daId];
      dopo[a.id] = { ...a, quantita: q };
      return dopo;
    });
  },
  // Sposta tutta la selezione nel carrello (sommando alle quantità già presenti).
  aggiungiAlCarrello() {
    const scelte = Object.values(negozioSelezione.leggi());
    if (!scelte.length) return 0;
    negozioCarrello.scrivi((prima) => {
      const dopo = { ...prima };
      for (const r of scelte) dopo[r.id] = { ...r, quantita: (prima[r.id] ? prima[r.id].quantita : 0) + r.quantita };
      return dopo;
    });
    negozioSelezione.scrivi(() => ({}));
    return scelte.reduce((n, r) => n + r.quantita, 0);
  },
};

export function useQuantitaSelezionata(id: number) {
  return useNegozio(negozioSelezione, (s) => (s[id] ? s[id].quantita : 0));
}

export function usePezziSelezionati() {
  return useNegozio(negozioSelezione, sommaPezzi);
}

// ---------- Salvataggio per utente ----------

// Carica il carrello dell'utente che entra e lo salva a ogni modifica (con una breve
// attesa: dieci "+" di fila fanno una sola scrittura).
export function CarrelloProvider({ children }: { children: ReactNode }) {
  const { utente } = useSessione();
  const chiave = utente ? 'carrello_' + utente.id : null;

  useEffect(() => {
    negozioCarrello.scrivi(() => ({}));
    negozioSelezione.scrivi(() => ({}));
    if (!chiave) return;

    let caricato = false;
    let attesa: ReturnType<typeof setTimeout> | null = null;
    const smetti = negozioCarrello.abbonati(() => {
      // Finché il carrello salvato non è stato letto non si scrive: il carrello vuoto
      // iniziale sovrascriverebbe quello salvato.
      if (!caricato) return;
      if (attesa) clearTimeout(attesa);
      attesa = setTimeout(() => {
        AsyncStorage.setItem(chiave, JSON.stringify(negozioCarrello.leggi())).catch(() => {});
      }, 300);
    });
    AsyncStorage.getItem(chiave)
      .then((json) => {
        if (json) negozioCarrello.scrivi(() => JSON.parse(json));
      })
      .catch(() => {})
      .finally(() => {
        caricato = true;
      });
    return () => {
      smetti();
      if (attesa) {
        clearTimeout(attesa);
        AsyncStorage.setItem(chiave, JSON.stringify(negozioCarrello.leggi())).catch(() => {});
      }
    };
  }, [chiave]);

  return <>{children}</>;
}

export function euro(n: number) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
