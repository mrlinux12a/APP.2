// Chi è entrato nell'app. Il token sta nel portachiavi del telefono (SecureStore); nel
// browser (solo per lo sviluppo con expo start --web) SecureStore non esiste e si usa
// localStorage.
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { chiamaApi, ErroreApi, impostaToken, suAccessoScaduto, type Utente } from './api';
import { dimenticaTokenPush, tokenPushSalvato } from './notifiche';
import { caricaProfiloAccesso, impostaProfiloAccesso } from './profiloAccesso';

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

// Chi sono, secondo il tipo di account: gli installatori hanno `/me`, i corrieri `/corrieri/me` (le due API sono separate, l'una rifiuta l'altro con un 403).
// Senza un utente salvato non si sa quale: si prova `/me` e, se risponde 403 (è l'account di un corriere), l'altra.
async function leggiMe(ruolo?: string): Promise<{ utente: Utente }> {
  if (ruolo === 'corriere') return chiamaApi<{ utente: Utente }>('/corrieri/me');
  try {
    return await chiamaApi<{ utente: Utente }>('/me');
  } catch (e) {
    if (!ruolo && e instanceof ErroreApi && e.stato === 403) return chiamaApi<{ utente: Utente }>('/corrieri/me');
    throw e;
  }
}

type ValoreSessione = {
  pronta: boolean; // false finché non si sa se c'è un token salvato
  utente: Utente | null;
  entra: (username: string, password: string) => Promise<void>;
  // Registra una nuova impresa (stessi campi del sito) ed entra subito. Con dei campi sbagliati lancia ErroreApi con `dati.errori`.
  registra: (dati: Record<string, string>) => Promise<void>;
  // Accesso del corriere (con l'email) e sua registrazione (nome, cognome, email, password): come i due sopra, ma sull'API `/corrieri/...`. Una password o un'email
  // sbagliate, o l'account di un altro tipo ("Questo account non è un account corriere"), lanciano ErroreApi con il messaggio del server.
  entraCorriere: (email: string, password: string) => Promise<void>;
  registraCorriere: (dati: Record<string, string>) => Promise<void>;
  esci: () => Promise<void>;
  // Cambia la password (stessi controlli del sito). Con dei campi sbagliati lancia ErroreApi con `dati.errori` (chiavi attuale / nuova / ripeti). Il server chiude
  // le altre sessioni e revoca anche il token di questo telefono: ne manda uno nuovo, che qui si salva al posto del vecchio, così chi cambia password resta dentro.
  cambiaPassword: (attuale: string, nuova: string, ripeti: string) => Promise<void>;
  // Elimina l'account (serve la password) ed esce. Con qualcosa in corso il server rifiuta (409) e l'account resta com'era.
  eliminaAccount: (password: string) => Promise<void>;
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
        // Insieme al token si legge la schermata di accesso scelta l'ultima volta (installatore o corriere): serve prima di mostrare l'accesso.
        const [token, salvato] = await Promise.all([archivio.leggi(CHIAVE_TOKEN), archivio.leggi(CHIAVE_UTENTE), caricaProfiloAccesso()]);
        if (token) {
          impostaToken(token);
          const mia = generazione.current;
          const precedente = utenteSalvato(salvato);
          const conferma = leggiMe(precedente?.ruolo).then(({ utente }) => {
            if (generazione.current !== mia) return;
            setUtente(utente);
            archivio.scrivi(CHIAVE_UTENTE, JSON.stringify(utente)).catch(() => {});
          });
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

  // Si è entrati (accesso o registrazione): il token si usa e si salva, e si ricorda a quale tipo di accesso appartiene chi è entrato, così all'uscita (o alla
  // prossima apertura) si ritrova la sua schermata.
  const apri = useCallback(async (token: string, utente: Utente) => {
    generazione.current += 1;
    impostaToken(token);
    await Promise.all([archivio.scrivi(CHIAVE_TOKEN, token), archivio.scrivi(CHIAVE_UTENTE, JSON.stringify(utente))]);
    impostaProfiloAccesso(utente.ruolo === 'corriere' ? 'corriere' : 'installatore');
    setUtente(utente);
  }, []);

  const entra = useCallback(
    async (username: string, password: string) => {
      const { token, utente } = await chiamaApi<{ token: string; utente: Utente }>('/login', {
        metodo: 'POST',
        corpo: { username, password, dispositivo: Platform.OS },
      });
      await apri(token, utente);
    },
    [apri]
  );

  const registra = useCallback(
    async (dati: Record<string, string>) => {
      const { token, utente } = await chiamaApi<{ token: string; utente: Utente }>('/registrazione', {
        metodo: 'POST',
        corpo: { ...dati, dispositivo: Platform.OS },
      });
      await apri(token, utente);
    },
    [apri]
  );

  const entraCorriere = useCallback(
    async (email: string, password: string) => {
      const { token, utente } = await chiamaApi<{ token: string; utente: Utente }>('/corrieri/accedi', {
        metodo: 'POST',
        corpo: { email, password, dispositivo: Platform.OS },
      });
      await apri(token, utente);
    },
    [apri]
  );

  const registraCorriere = useCallback(
    async (dati: Record<string, string>) => {
      const { token, utente } = await chiamaApi<{ token: string; utente: Utente }>('/corrieri/registrati', {
        metodo: 'POST',
        corpo: { ...dati, dispositivo: Platform.OS },
      });
      await apri(token, utente);
    },
    [apri]
  );

  const esci = useCallback(async () => {
    try {
      // Il telefono che esce non deve più ricevere le notifiche di questo utente.
      await chiamaApi('/logout', { metodo: 'POST', corpo: { token_push: await tokenPushSalvato() } });
    } catch {}
    await dimenticaTokenPush();
    await dimentica();
  }, [dimentica]);

  const cambiaPassword = useCallback(async (attuale: string, nuova: string, ripeti: string) => {
    const { token } = await chiamaApi<{ ok: boolean; token: string }>('/password', {
      metodo: 'POST',
      corpo: { attuale, nuova, ripeti, dispositivo: Platform.OS },
    });
    impostaToken(token);
    await archivio.scrivi(CHIAVE_TOKEN, token);
  }, []);

  const eliminaAccount = useCallback(
    async (password: string) => {
      await chiamaApi('/account', { metodo: 'DELETE', corpo: { password } });
      await dimenticaTokenPush();
      await dimentica();
    },
    [dimentica]
  );

  const valore = useMemo(
    () => ({ pronta, utente, entra, registra, entraCorriere, registraCorriere, esci, cambiaPassword, eliminaAccount }),
    [pronta, utente, entra, registra, entraCorriere, registraCorriere, esci, cambiaPassword, eliminaAccount]
  );
  return <ContestoSessione.Provider value={valore}>{children}</ContestoSessione.Provider>;
}

export function useSessione() {
  const v = useContext(ContestoSessione);
  if (!v) throw new Error('useSessione fuori da SessioneProvider');
  return v;
}
