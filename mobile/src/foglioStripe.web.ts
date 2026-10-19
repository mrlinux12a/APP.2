// Sul web (solo per lo sviluppo con expo start --web) il foglio di pagamento nativo di Stripe non esiste.
import { ErroreApi, type PagamentoDaFare } from './api';

export type EsitoFoglio = 'pagato' | 'annullato';

export async function apriFoglioStripe(_p: PagamentoDaFare, _nomeCliente?: string): Promise<EsitoFoglio> {
  throw new ErroreApi('Il pagamento con carta non si può provare nel browser: usa l’app sul telefono.', 0);
}
