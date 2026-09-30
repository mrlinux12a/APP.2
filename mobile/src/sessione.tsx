// Chi è entrato nell'app. Il token sta nel portachiavi del telefono (SecureStore); nel
// browser (solo per lo sviluppo con expo start --web) SecureStore non esiste e si usa
// localStorage.
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { chiamaApi, impostaToken, suAccessoScaduto, type Utente } from './api';

const CHIAVE_TOKEN = 'token_accesso';
// Nome e ragione sociale dell'ultimo accesso: servono solo a mostrare l'app senza aspettare la
// rete all'avvio (vedi SessioneProvider). Non sono credenziali: il token resta un altro valore.
const CHIAVE_UTENTE = 'utente_accesso';

const archivio = {
  leggi: (chiave: string): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(chiave)) : SecureStore.getItemAsync(chiave),
  scrivi: (chiave: string, v: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(chiave, v)) : SecureStore.setItemAsync(chiave, v),
  cancella: (chiave: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(chiave)) : SecureStore.deleteItemAsync(chiave),
};

function utenteSalvato(json: string | null): Utente | null {
  if (!json) return null;
  try {
    const u = JSON.parse(json);
    return u && typeof u.id === 'number' && typeof u.username === 'string' ? (u as Utente) : null;
  } catch {
    return null;
  }
}

type ValoreSessione = {
  pronta: boolean; // false finché non si sa se c'è un token salvato
  utente: Utente | null;
  entra: (username: string, password: string) => Promise<void>;
  esci: () => Promise<void>;
};

const ContestoSessione = createContext<ValoreSessione | null>(null);

export function SessioneProvider({ children }: { children: ReactNode }) {
  const [pronta, setPronta] = useState(false);
  const [utente, setUtente] = useState<Utente | null>(null);
  // Sale a ogni entrata/uscita: una verifica in background partita prima di un'uscita non deve
  // rimettere dentro chi nel frattempo è uscito.
  const generazione = useRef(0);

  const dimentica = useCallback(async () => {
    generazione.current += 1;
    impostaToken(null);
    setUtente(null);
    await Promise.all([archivio.cancella(CHIAVE_TOKEN), archivio.cancella(CHIAVE_UTENTE)]).catch(() => {});
  }, []);

  useEffect(() => {
    suAccessoScaduto(() => {
      dimentica();
    });
    (async () => {
      try {
        const [token, salvato] = await Promise.all([archivio.leggi(CHIAVE_TOKEN), archivio.leggi(CHIAVE_UTENTE)]);
        if (token) {
          impostaToken(token);
          const mia = generazione.current;
          const conferma = chiamaApi<{ utente: Utente }>('/me').then(({ utente }) => {
            if (generazione.current !== mia) return;
            setUtente(utente);
            archivio.scrivi(CHIAVE_UTENTE, JSON.stringify(utente)).catch(() => {});
          });
          const precedente = utenteSalvato(salvato);
          if (precedente) {
            // Già dentro: aspettare /me (350 ms a rete buona, fino a 20 s se il server non
            // risponde) lasciava una schermata vuota a ogni avvio. Si mostra l'app subito e il
            // token si verifica in background: se è scaduto (401) suAccessoScaduto fa uscire,
            // se manca la rete si resta dentro e le schermate mostrano "Riprova".
            setUtente(precedente);
            conferma.catch(() => {});
          } else {
            await conferma;
          }
        }
      } catch {
        // Nessun utente salvato e /me non risponde: token scaduto (se ne occupa
        // suAccessoScaduto) o server irraggiungibile, e si ricomincia dal login.
        impostaToken(null);
      } finally {
        setPronta(true);
      }
    })();
  }, [dimentica]);

  const entra = useCallback(async (username: string, password: string) => {
    const { token, utente } = await chiamaApi<{ token: string; utente: Utente }>('/login', {
      metodo: 'POST',
      corpo: { username, password, dispositivo: Platform.OS },
    });
    generazione.current += 1;
    impostaToken(token);
    await Promise.all([archivio.scrivi(CHIAVE_TOKEN, token), archivio.scrivi(CHIAVE_UTENTE, JSON.stringify(utente))]);
    setUtente(utente);
  }, []);

  const esci = useCallback(async () => {
    try {
      await chiamaApi('/logout', { metodo: 'POST' });
    } catch {}
    await dimentica();
  }, [dimentica]);

  const valore = useMemo(() => ({ pronta, utente, entra, esci }), [pronta, utente, entra, esci]);
  return <ContestoSessione.Provider value={valore}>{children}</ContestoSessione.Provider>;
}

export function useSessione() {
  const v = useContext(ContestoSessione);
  if (!v) throw new Error('useSessione fuori da SessioneProvider');
  return v;
}
