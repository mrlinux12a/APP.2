// Chi è entrato nell'app. Il token sta nel portachiavi del telefono (SecureStore); nel
// browser (solo per lo sviluppo con expo start --web) SecureStore non esiste e si usa
// localStorage.
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { chiamaApi, impostaToken, suAccessoScaduto, type Utente } from './api';

const CHIAVE = 'token_accesso';

const archivio = {
  leggi: (): Promise<string | null> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.getItem(CHIAVE)) : SecureStore.getItemAsync(CHIAVE),
  scrivi: (v: string): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.setItem(CHIAVE, v)) : SecureStore.setItemAsync(CHIAVE, v),
  cancella: (): Promise<void> =>
    Platform.OS === 'web' ? Promise.resolve(localStorage.removeItem(CHIAVE)) : SecureStore.deleteItemAsync(CHIAVE),
};

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

  const dimentica = useCallback(async () => {
    impostaToken(null);
    setUtente(null);
    await archivio.cancella().catch(() => {});
  }, []);

  useEffect(() => {
    suAccessoScaduto(() => {
      dimentica();
    });
    (async () => {
      try {
        const token = await archivio.leggi();
        if (token) {
          impostaToken(token);
          const { utente } = await chiamaApi<{ utente: Utente }>('/me');
          setUtente(utente);
        }
      } catch {
        // Token scaduto: se ne occupa suAccessoScaduto. Server irraggiungibile: si resta
        // fuori e si riprova dal login, invece di bloccare l'app su una schermata vuota.
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
    impostaToken(token);
    await archivio.scrivi(token);
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
