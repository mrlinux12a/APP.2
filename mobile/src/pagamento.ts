// Pagamento con carta nell'app: il foglio di pagamento di Stripe (PaymentSheet). Il server crea il pagamento (la carta viene solo AUTORIZZATA: l'importo
// resta bloccato e si incassa solo quando un banco conferma), l'app apre il foglio, poi chiede al server com'è andata.
//
// In Expo Go il foglio funziona ma senza Google Pay (serve una build vera, vedi ANDROID.md).
import { chiamaApi, ErroreApi, type EsitoPagamento, type PagamentoDaFare } from './api';
import { apriFoglioStripe, type EsitoFoglio } from './foglioStripe';

export type { EsitoFoglio };

// Apre il foglio di pagamento di Stripe per un pagamento creato dal server (il codice nativo sta in foglioStripe.ts, che sul web è sostituito da
// foglioStripe.web.ts: il modulo nativo di Stripe non si può includere nel pacchetto web di sviluppo). 'pagato' = carta autorizzata (poi si chiede
// l'esito al server), 'annullato' = l'utente ha chiuso il foglio. Lancia ErroreApi se il foglio non si apre o la carta viene rifiutata.
export function apriFoglioDiPagamento(p: PagamentoDaFare, nomeCliente?: string): Promise<EsitoFoglio> {
  return apriFoglioStripe(p, nomeCliente);
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Dopo il foglio, il server conferma la carta e fa nascere la richiesta (o la riapre, per "Rinvia"): si chiede finché non è definitivo. Di norma basta
// la prima lettura; si aspetta un po' perché la conferma di Stripe (3-D Secure, banca lenta) può arrivare con un attimo di ritardo.
export async function attendiEsitoPagamento(id: number, tentativi = 20, pausaMs = 1500): Promise<EsitoPagamento> {
  let ultimo: EsitoPagamento = { esito: 'in_corso' };
  for (let i = 0; i < tentativi; i++) {
    ultimo = await chiamaApi<EsitoPagamento>('/pagamenti/' + id);
    if (ultimo.esito !== 'in_corso' && ultimo.esito !== 'da_pagare') return ultimo;
    await pausa(pausaMs);
  }
  return ultimo;
}

// La risposta del server a "Paga e invia" / "Rinvia richiesta": { id } = la richiesta è già partita (pagamento di prova, o già pagata); { pagamento } = c'è da
// pagare con la carta.
export type RispostaInvio = { id: number } | { pagamento: PagamentoDaFare };

// Porta a termine un invio: se la richiesta è già partita finisce qui; altrimenti apre il foglio di pagamento e aspetta che il server la faccia nascere
// (carta autorizzata). Ritorna l'id della richiesta, o null se l'utente ha chiuso il foglio senza pagare (non è successo niente: nessun addebito).
// Lancia ErroreApi con un testo da mostrare se il pagamento non va a buon fine.
export async function completaInvio(risposta: RispostaInvio, nomeCliente?: string): Promise<number | null> {
  if ('id' in risposta) return risposta.id;
  const esitoFoglio = await apriFoglioDiPagamento(risposta.pagamento, nomeCliente);
  if (esitoFoglio === 'annullato') return null;
  const esito = await attendiEsitoPagamento(risposta.pagamento.id);
  if (esito.esito === 'ok') return esito.request_id;
  if (esito.esito === 'rifiutato') throw new ErroreApi(esito.messaggio, 0);
  if (esito.esito === 'in_corso' || esito.esito === 'da_pagare') {
    throw new ErroreApi('Il pagamento è in elaborazione. Controlla “Stato ordini” fra poco: se la richiesta non compare, non è stato addebitato nulla.', 0);
  }
  throw new ErroreApi('Il pagamento non è andato a buon fine. Non è stato addebitato nulla: riprova.', 0);
}
