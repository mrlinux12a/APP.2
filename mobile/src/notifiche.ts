// Notifiche push: il telefono dice al server il suo token (POST /dispositivi) e, quando arriva una notifica, toccarla porta alla richiesta o all'ordine.
//
// Come funziona e cosa serve (vedi ANDROID.md): su Android le push passano da Firebase (FCM), quindi la build deve avere il file google-services.json e
// il progetto EAS le chiavi FCM. Senza, l'app funziona lo stesso: la registrazione fallisce in silenzio e restano le notifiche in-app.
// In Expo Go le push non esistono (da SDK 53 sono state tolte), e nel browser di sviluppo nemmeno: qui non succede niente.
import * as SecureStore from 'expo-secure-store';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { chiamaApi } from './api';

const CHIAVE_TOKEN_PUSH = 'token_push';

function supportate(): boolean {
  return Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

// Il modulo si carica solo se serve (in Expo Go o sul web importarlo darebbe errori).
function modulo(): typeof import('expo-notifications') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- caricamento volutamente tardivo: in Expo Go e sul web il modulo non va importato
  return require('expo-notifications');
}

// Dove porta una notifica: `link` è il percorso del sito ("/ordini/12", "/richieste/7") che il server mette nei dati della push.
export function apriDaLink(link: unknown) {
  const l = typeof link === 'string' ? link : '';
  let m = /^\/ordini\/(\d+)/.exec(l);
  if (m) return router.push({ pathname: '/ordini/ordine/[id]', params: { id: m[1] } });
  m = /^\/richieste\/(\d+)/.exec(l);
  if (m) return router.push({ pathname: '/ordini/richiesta/[id]', params: { id: m[1] } });
  return router.navigate('/ordini');
}

// Chiede il permesso (Android 13+), ottiene il token Expo e lo manda al server. Ritorna il token, o null se non è possibile (nessun permesso, emulatore,
// progetto EAS non ancora creato...): non lancia mai.
export async function registraDispositivo(): Promise<string | null> {
  if (!supportate() || !Device.isDevice) return null;
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
    if (status !== 'granted') status = (await N.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null; // finché non si fa `eas init` non c'è un progetto a cui legare il token
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    await chiamaApi('/dispositivi', { metodo: 'POST', corpo: { token, piattaforma: 'android' } });
    await SecureStore.setItemAsync(CHIAVE_TOKEN_PUSH, token).catch(() => {});
    return token;
  } catch (e) {
    console.warn('[notifiche] registrazione non riuscita:', e instanceof Error ? e.message : e);
    return null;
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

let ultimaGestita: string | null = null;

// Da montare una volta, dentro l'app con un utente collegato: registra il telefono e porta alla schermata giusta quando si tocca una notifica
// (anche quella che ha aperto l'app da chiusa).
export function useNotifichePush(attivo: boolean) {
  useEffect(() => {
    if (!attivo || !supportate()) return;
    const N = modulo();
    // Con l'app aperta la notifica si mostra comunque (di default Android la nasconderebbe).
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    registraDispositivo();

    const gestisci = (risposta: import('expo-notifications').NotificationResponse | null) => {
      if (!risposta) return;
      const id = risposta.notification.request.identifier;
      if (ultimaGestita === id) return;
      ultimaGestita = id;
      const dati = risposta.notification.request.content.data as { link?: unknown } | undefined;
      apriDaLink(dati?.link);
    };
    N.getLastNotificationResponseAsync().then(gestisci).catch(() => {});
    const abbonamento = N.addNotificationResponseReceivedListener(gestisci);
    return () => abbonamento.remove();
  }, [attivo]);
}
