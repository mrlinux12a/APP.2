// Notifiche push: il telefono dice al server il suo token (POST /dispositivi) e, quando arriva una notifica, toccarla porta alla richiesta o all'ordine.
//
// Come funziona e cosa serve (vedi ANDROID.md): su Android le push passano da Firebase (FCM), quindi la build deve avere il file google-services.json e
// il progetto EAS le chiavi FCM. Senza, l'app funziona lo stesso: la registrazione fallisce in silenzio e restano le notifiche in-app.
// In Expo Go le push non esistono (da SDK 53 sono state tolte), e nel browser di sviluppo nemmeno: qui non succede niente.
//
// Come si comporta (richiesta del 21/10/2026, la stessa del sito): notifiche di sistema col suono del telefono con l'app in SECONDO PIANO o CHIUSA; con l'app
// aperta IN PRIMO PIANO nessun banner e nessun suono (la schermata si aggiorna da sola, vedi `useNotifichePush`).
// "Avvisi sul telefono" è un interruttore acceso/spento come sul sito (profilo): spegnerlo toglie il telefono dall'elenco del server.
import { useQueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { chiamaApi } from './api';

const CHIAVE_TOKEN_PUSH = 'token_push';
// Chi ha spento "Avvisi sul telefono" (uno per utente: su un telefono condiviso l'interruttore di uno non spegne gli avvisi dell'altro).
const chiaveAvvisi = (utenteId: number) => 'avvisi_telefono_' + utenteId;

function supportate(): boolean {
  return Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

// Il modulo si carica solo se serve (in Expo Go o sul web importarlo darebbe errori).
function modulo(): typeof import('expo-notifications') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- caricamento volutamente tardivo: in Expo Go e sul web il modulo non va importato
  return require('expo-notifications');
}

// Dove porta una notifica: `link` è il percorso del sito ("/ordini/12", "/richieste/7", "/profilo") che il server mette nei dati della push.
export function apriDaLink(link: unknown) {
  const l = typeof link === 'string' ? link : '';
  let m = /^\/ordini\/(\d+)/.exec(l);
  if (m) return router.push({ pathname: '/ordini/ordine/[id]', params: { id: m[1] } });
  m = /^\/richieste\/(\d+)/.exec(l);
  if (m) return router.push({ pathname: '/ordini/richiesta/[id]', params: { id: m[1] } });
  if (/^\/profilo(\/|$|\?)/.test(l)) return router.push('/profilo');
  return router.navigate('/ordini');
}

// ---------- Preferenza "Avvisi sul telefono" ----------

// Acceso, salvo che l'utente lo abbia spento (come sul sito: preferenza `minuteria.avvisi.telefono` ≠ 'no').
async function avvisiVoluti(utenteId: number): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  return (await SecureStore.getItemAsync(chiaveAvvisi(utenteId)).catch(() => null)) !== 'no';
}

async function ricordaAvvisi(utenteId: number, voluti: boolean) {
  if (Platform.OS === 'web') return;
  if (voluti) await SecureStore.deleteItemAsync(chiaveAvvisi(utenteId)).catch(() => {});
  else await SecureStore.setItemAsync(chiaveAvvisi(utenteId), 'no').catch(() => {});
}

// ---------- Registrazione del telefono ----------

type EsitoRegistrazione =
  | { ok: true; token: string }
  | { ok: false; motivo: 'non_supportato' | 'permesso' | 'senza_progetto' | 'errore' };

// Ottiene il token Expo e lo manda al server. Con `chiediPermesso` mostra la richiesta di sistema (Android 13+) se serve; senza, si ferma se il permesso non
// c'è già. Non lancia mai: dice com'è andata.
async function registra(chiediPermesso: boolean): Promise<EsitoRegistrazione> {
  if (!supportate() || !Device.isDevice) return { ok: false, motivo: 'non_supportato' };
  try {
    const N = modulo();
    // Il canale va creato prima di chiedere il permesso (Android 13+ lo mostra solo allora).
    await N.setNotificationChannelAsync('default', {
      name: 'Richieste e ordini',
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#245a8f',
    });
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted' && chiediPermesso) status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return { ok: false, motivo: 'permesso' };
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return { ok: false, motivo: 'senza_progetto' }; // finché non si fa `eas init` non c'è un progetto a cui legare il token
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    await chiamaApi('/dispositivi', { metodo: 'POST', corpo: { token, piattaforma: 'android' } });
    await SecureStore.setItemAsync(CHIAVE_TOKEN_PUSH, token).catch(() => {});
    return { ok: true, token };
  } catch (e) {
    console.warn('[notifiche] registrazione non riuscita:', e instanceof Error ? e.message : e);
    return { ok: false, motivo: 'errore' };
  }
}

// Il token di questo telefono registrato per l'utente (per toglierlo all'uscita).
export async function tokenPushSalvato(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  return SecureStore.getItemAsync(CHIAVE_TOKEN_PUSH).catch(() => null);
}

export async function dimenticaTokenPush() {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(CHIAVE_TOKEN_PUSH).catch(() => {});
}

// Toglie questo telefono dall'elenco del server. Ritorna false se il server non risponde: il telefono sarebbe ancora nell'elenco.
async function togliDispositivo(): Promise<boolean> {
  try {
    const token = await tokenPushSalvato();
    if (token) await chiamaApi('/dispositivi', { metodo: 'DELETE', corpo: { token } });
    await dimenticaTokenPush();
    return true;
  } catch {
    return false;
  }
}

// Mette il telefono in regola, se l'utente vuole gli avvisi: all'avvio (con richiesta del permesso), quando l'app torna in primo piano (solo se manca il token e il
// permesso c'è già, per esempio concesso dalle impostazioni) e quando il token cambia (`forza`).
async function sincronizzaAvvisi(utenteId: number, { chiedi = false, forza = false } = {}) {
  if (!supportate() || !Device.isDevice) return;
  if (!(await avvisiVoluti(utenteId))) return;
  if (!forza && (await tokenPushSalvato())) return;
  await registra(chiedi);
}

// ---------- Hook ----------

let ultimaGestita: string | null = null;

// Da montare una volta, dentro l'app con un utente collegato (`utenteId`, null se non c'è): registra il telefono, tiene aggiornate le schermate quando arriva una
// notifica con l'app aperta e porta alla schermata giusta quando si tocca una notifica (anche quella che ha aperto l'app da chiusa).
export function useNotifichePush(utenteId: number | null) {
  const clientDati = useQueryClient();
  useEffect(() => {
    if (utenteId === null || !supportate()) return;
    const N = modulo();
    // Con l'app in primo piano nessun banner e nessun suono (richiesta del 21/10/2026): la schermata si aggiorna da sola, qui sotto.
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
    });
    sincronizzaAvvisi(utenteId, { chiedi: true, forza: true });

    const gestisci = (risposta: import('expo-notifications').NotificationResponse | null) => {
      if (!risposta) return;
      const id = risposta.notification.request.identifier;
      if (ultimaGestita === id) return;
      ultimaGestita = id;
      const dati = risposta.notification.request.content.data as { link?: unknown } | undefined;
      apriDaLink(dati?.link);
    };
    N.getLastNotificationResponseAsync().then(gestisci).catch(() => {});
    const tocco = N.addNotificationResponseReceivedListener(gestisci);
    // Notifica arrivata con l'app aperta: non si mostra niente, ma ciò che c'è a schermo (Stato ordini, la richiesta, l'ordine) si rilegge subito.
    const arrivata = N.addNotificationReceivedListener(() => {
      clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' });
      clientDati.invalidateQueries({ queryKey: ['richiesta'] });
      clientDati.invalidateQueries({ queryKey: ['ordine'] });
      clientDati.invalidateQueries({ queryKey: ['materiale'] });
    });
    // Il servizio di Google può cambiare il token del telefono: il server deve conoscere quello nuovo.
    const cambioToken = N.addPushTokenListener(() => {
      sincronizzaAvvisi(utenteId, { forza: true });
    });
    const primoPiano = AppState.addEventListener('change', (s) => {
      if (s === 'active') sincronizzaAvvisi(utenteId);
    });
    return () => {
      tocco.remove();
      arrivata.remove();
      cambioToken.remove();
      primoPiano.remove();
    };
  }, [utenteId, clientDati]);
}

// Lo stato dell'interruttore "Avvisi sul telefono" nel profilo:
// - non_supportati: Expo Go, emulatore, browser (niente push) → il profilo non mostra l'interruttore;
// - attivi: il telefono è nell'elenco del server e il permesso c'è;
// - spenti: l'utente li ha spenti, o il permesso non è stato ancora dato (si può chiedere);
// - bloccati: il permesso è stato negato e il telefono non lo richiede più: si può solo riaprire dalle impostazioni.
export type StatoAvvisi = 'verifica' | 'non_supportati' | 'attivi' | 'spenti' | 'bloccati';

// Dove le push non esistono (Expo Go, emulatore, browser) o non c'è un utente.
function senzaPush(utenteId: number | null): boolean {
  return utenteId === null || !supportate() || !Device.isDevice;
}

// Lo stato dell'interruttore, letto dal permesso del telefono, dalla preferenza dell'utente e dal token registrato.
async function calcolaStato(utenteId: number | null): Promise<StatoAvvisi> {
  if (utenteId === null || senzaPush(utenteId)) return 'non_supportati';
  try {
    const permesso = await modulo().getPermissionsAsync();
    if (!permesso.granted) return permesso.canAskAgain ? 'spenti' : 'bloccati';
    const [voluti, token] = await Promise.all([avvisiVoluti(utenteId), tokenPushSalvato()]);
    return voluti && token ? 'attivi' : 'spenti';
  } catch {
    return 'spenti';
  }
}

export function useAvvisiTelefono(utenteId: number | null) {
  const [stato, setStato] = useState<StatoAvvisi>(() => (senzaPush(utenteId) ? 'non_supportati' : 'verifica'));
  const [occupato, setOccupato] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const leggi = useCallback(async () => {
    setStato(await calcolaStato(utenteId));
  }, [utenteId]);

  // Si rilegge quando l'app torna in primo piano: il permesso può essere cambiato dalle impostazioni del telefono (in quel caso si registra anche il telefono).
  useEffect(() => {
    let attivo = true;
    // Se l'hook viene chiuso (o cambia utente) prima che la lettura finisca, il risultato si butta.
    const rileggi = () =>
      calcolaStato(utenteId).then((s) => {
        if (attivo) setStato(s);
      });
    rileggi();
    if (utenteId === null) return () => {};
    const abbonamento = AppState.addEventListener('change', async (s) => {
      if (s !== 'active') return;
      await sincronizzaAvvisi(utenteId);
      rileggi();
    });
    return () => {
      attivo = false;
      abbonamento.remove();
    };
  }, [utenteId]);

  const cambia = async (acceso: boolean) => {
    if (occupato || utenteId === null) return;
    setOccupato(true);
    setMessaggio(null);
    try {
      if (acceso) {
        const esito = await registra(true);
        if (esito.ok) await ricordaAvvisi(utenteId, true);
        else if (esito.motivo === 'permesso') setMessaggio('Il telefono non ci ha dato il permesso di mandarti avvisi: puoi darlo dalle impostazioni.');
        else if (esito.motivo === 'senza_progetto') setMessaggio('Gli avvisi non sono ancora attivi su questa versione dell’app.');
        else setMessaggio('Non sono riuscito ad accendere gli avvisi: controlla la connessione e riprova.');
      } else if (await togliDispositivo()) {
        await ricordaAvvisi(utenteId, false);
      } else {
        setMessaggio('Non riesco a spegnere gli avvisi adesso: controlla la connessione e riprova.');
      }
    } finally {
      await leggi();
      setOccupato(false);
    }
  };

  return { stato, occupato, messaggio, cambia, apriImpostazioni: () => Linking.openSettings().catch(() => {}) };
}
