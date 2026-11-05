// Carrello dell'app: vive sul telefono (non nella sessione web) e parte intero verso il
// server quando si chiede la disponibilità. Si salva per utente, così sopravvive alla
// chiusura dell'app senza mescolarsi fra due account sullo stesso telefono.
//
// Come sul sito (righe compatte, richiesta del 16/10/2026), lo stepper `− N +` del catalogo scrive subito nel carrello a ogni tocco: niente "Aggiungi".
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, type ReactNode } from 'react';

import { chiamaApi } from './api';
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

// "Riordina gli stessi pezzi" di un ordine consegnato: il server dice quali articoli ci sono ancora (con i prezzi di oggi) e si sommano alle quantità già nel
// carrello. Ritorna quanti articoli sono stati aggiunti e quanti non sono più disponibili.
export async function riordina(ordineId: number): Promise<{ aggiunti: number; saltati: number }> {
  const { articoli, saltati } = await chiamaApi<{ articoli: (DatiRiga & { quantita: number })[]; saltati: number }>(`/ordini/${ordineId}/riordina`);
  negozioCarrello.scrivi((prima) => {
    const dopo = { ...prima };
    for (const { quantita, ...dati } of articoli) {
      dopo[dati.id] = { ...dati, quantita: Math.min(9999, (prima[dati.id] ? prima[dati.id].quantita : 0) + quantita) };
    }
    return dopo;
  });
  return { aggiunti: articoli.length, saltati };
}

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

// ---------- Salvataggio per utente ----------

// Carica il carrello dell'utente che entra e lo salva a ogni modifica (con una breve
// attesa: dieci "+" di fila fanno una sola scrittura).
export function CarrelloProvider({ children }: { children: ReactNode }) {
  const { utente } = useSessione();
  const chiave = utente ? 'carrello_' + utente.id : null;

  useEffect(() => {
    negozioCarrello.scrivi(() => ({}));
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
