// Il foglio di pagamento di Stripe (PaymentSheet) sul telefono. Il pagamento lo crea il server: la carta viene solo AUTORIZZATA (l'importo resta
// bloccato) e si incassa quando un banco conferma. Vedi pagamento.ts per il flusso intero.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initPaymentSheet, initStripe, presentPaymentSheet } from '@stripe/stripe-react-native';

import { ErroreApi, type PagamentoDaFare } from './api';

export type EsitoFoglio = 'pagato' | 'annullato';

// In Expo Go il foglio funziona ma Google Pay non esiste: serve una build vera.
const inExpoGo = () => Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function apriFoglioStripe(p: PagamentoDaFare, nomeCliente?: string): Promise<EsitoFoglio> {
  // La chiave pubblicabile arriva dal server insieme al pagamento: così l'app non ne porta una scritta dentro (prova e reale restano quelle del server).
  await initStripe({ publishableKey: p.chiave_pubblica, urlScheme: 'minuteria' });
  const { error: errorePreparazione } = await initPaymentSheet({
    merchantDisplayName: 'Ordini Minuteria',
    paymentIntentClientSecret: p.client_secret,
    // Solo metodi che confermano subito: la richiesta parte a carta autorizzata.
    allowsDelayedPaymentMethods: false,
    returnURL: 'minuteria://pagamento',
    primaryButtonLabel: `Paga € ${p.importo}`,
    style: 'alwaysLight',
    defaultBillingDetails: nomeCliente ? { name: nomeCliente } : undefined,
    appearance: { colors: { primary: '#245a8f' } },
    googlePay: inExpoGo() ? undefined : { merchantCountryCode: 'IT', currencyCode: 'EUR', testEnv: p.modo !== 'live' },
  });
  if (errorePreparazione) {
    throw new ErroreApi('Il pagamento non è disponibile in questo momento. Non è stato addebitato nulla. Riprova tra poco.', 0);
  }
  const { error } = await presentPaymentSheet();
  if (!error) return 'pagato';
  if (error.code === 'Canceled') return 'annullato';
  throw new ErroreApi(error.localizedMessage || error.message || 'Pagamento non riuscito. Non è stato addebitato nulla.', 0);
}
