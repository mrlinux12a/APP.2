// Letture e azioni dell'API dei corrieri con cache (react-query), come src/dati.ts per l'installatore. Le chiavi della cache cominciano tutte con 'corriere': una
// notifica arrivata con l'app aperta le rilegge in blocco (src/notifiche.ts).
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { chiamaApi, ErroreApi } from '../api';
import { posizioneNota } from './posizione';
import type { DettaglioRichiesta, ElencoRichieste, Posizione, RiepilogoConsegna, RispostaInCorso } from './tipi';

// I codici degli errori «previsti» del server (campo `dati.codice` dell'ErroreApi).
export const CODICI = {
  giaAccettata: 'gia_accettata',
  scaduta: 'scaduta',
  tua: 'tua',
  nonTrovata: 'non_trovata',
  posizioneMancante: 'posizione_mancante',
  giaInConsegna: 'gia_in_consegna',
  nonDisponibile: 'non_disponibile',
  ordineNonTrovato: 'ordine_non_trovato',
} as const;

export function codiceErrore(errore: unknown): string | null {
  return errore instanceof ErroreApi && errore.dati && typeof errore.dati.codice === 'string' ? errore.dati.codice : null;
}

const CHIAVE_ELENCO = ['corriere', 'richieste'] as const;
const CHIAVE_IN_CORSO = ['corriere', 'in-corso'] as const;
const chiaveDettaglio = (id: number) => ['corriere', 'richiesta', id] as const;
const chiaveRiepilogo = (id: number) => ['corriere', 'riepilogo', id] as const;

// Le letture che hanno bisogno della posizione la portano nell'indirizzo (?lat=..&lng=..): serve al server per calcolare tempi e km, non la salva.
function conPosizione(percorso: string): string {
  const p = posizioneNota();
  return p ? `${percorso}?lat=${p.lat}&lng=${p.lng}` : percorso;
}

const leggiElenco = () => chiamaApi<ElencoRichieste>(conPosizione('/corrieri/richieste'));
const leggiInCorso = () => chiamaApi<RispostaInCorso>('/corrieri/in-corso');

const opzioniElenco = () => queryOptions({ queryKey: CHIAVE_ELENCO, queryFn: leggiElenco, staleTime: 0 });
const opzioniInCorso = () => queryOptions({ queryKey: CHIAVE_IN_CORSO, queryFn: leggiInCorso, staleTime: 0 });

// Le due letture «vive» (richieste da prendere e consegna in corso) le tiene aggiornate SOLO il layout delle schede, che è sempre montato quando si è nell'area del
// corriere: così il numero sulla scheda "Richieste" e il punto su "In corso" sono giusti anche da un'altra scheda. Le schermate leggono la stessa cache con
// `useElencoRichieste` e `useInCorso`, senza un secondo giro di richieste.
export function useSincronizzaCorriere() {
  const inPrimoPiano = useIsFocused();
  const elenco = useQuery({ ...opzioniElenco(), refetchInterval: inPrimoPiano ? 8000 : 20000 });
  const inCorso = useQuery({
    ...opzioniInCorso(),
    // Nell'istante fra l'accettazione e la nascita dell'ordine si riprova in fretta.
    refetchInterval: (q) => (q.state.data?.in_preparazione ? 2000 : inPrimoPiano ? 15000 : 30000),
  });
  return { elenco: elenco.data, inCorso: inCorso.data };
}

export function useElencoRichieste() {
  return useQuery(opzioniElenco());
}

export function useInCorso() {
  return useQuery(opzioniInCorso());
}

// Il dettaglio di una richiesta. Si rilegge mentre lo si guarda (un altro corriere può prenderla, la finestra del banco può scadere); dopo un errore (410) si ferma.
export function useDettaglioRichiesta(id: number) {
  const inPrimoPiano = useIsFocused();
  return useQuery({
    queryKey: chiaveDettaglio(id),
    queryFn: () => chiamaApi<DettaglioRichiesta>(conPosizione('/corrieri/richieste/' + id)),
    staleTime: 0,
    refetchInterval: (q) => (q.state.status === 'error' || !inPrimoPiano ? false : 8000),
  });
}

export function useRiepilogo(ordineId: number) {
  return useQuery({
    queryKey: chiaveRiepilogo(ordineId),
    queryFn: () => chiamaApi<RiepilogoConsegna>('/corrieri/consegne/' + ordineId + '/riepilogo'),
    staleTime: 5 * 60 * 1000,
  });
}

// «Sei disponibile»: l'interruttore si sposta subito (la cache si aggiorna prima della risposta) e poi si rilegge com'è davvero.
export function useImpostaDisponibilita() {
  const clientDati = useQueryClient();
  return useMutation({
    mutationFn: (disponibile: boolean) => chiamaApi<{ disponibile: boolean }>('/corrieri/disponibilita', { metodo: 'PUT', corpo: { disponibile } }),
    onMutate: (disponibile) => {
      clientDati.setQueryData<ElencoRichieste>(CHIAVE_ELENCO, (v) => (v ? { ...v, disponibile, richieste: disponibile ? v.richieste : [] } : v));
    },
    onSettled: () => clientDati.invalidateQueries({ queryKey: CHIAVE_ELENCO }),
  });
}

// «Accetta richiesta»: la posizione (appena letta) va nel corpo. A cosa è stata accettata lo dice la consegna in corso, che qui si legge subito, così la schermata
// «In corso» nasce già piena invece di mostrarsi vuota per un attimo.
export function useAccetta() {
  const clientDati = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, posizione }: { id: number; posizione: Posizione }) => {
      const esito = await chiamaApi<{ ok: boolean; ordine_id: number | null }>('/corrieri/richieste/' + id + '/accetta', {
        metodo: 'POST',
        corpo: { lat: posizione.lat, lng: posizione.lng },
      });
      await clientDati.fetchQuery({ queryKey: CHIAVE_IN_CORSO, queryFn: leggiInCorso, staleTime: 0 }).catch(() => {});
      return esito;
    },
    onSettled: () => {
      clientDati.invalidateQueries({ queryKey: CHIAVE_ELENCO });
      clientDati.invalidateQueries({ queryKey: ['corriere', 'richiesta'] });
    },
  });
}

// «Ho ritirato il materiale»: la consegna passa alla fase 2 (la risposta porta già quella aggiornata).
export function useRitirato() {
  const clientDati = useQueryClient();
  return useMutation({
    mutationFn: (ordineId: number) => chiamaApi<RispostaInCorso>('/corrieri/consegne/' + ordineId + '/ritirato', { metodo: 'POST' }),
    onSuccess: (risposta) => {
      clientDati.setQueryData<RispostaInCorso>(CHIAVE_IN_CORSO, { consegna: risposta.consegna });
    },
  });
}

// «Consegna confermata»: la consegna in corso sparisce e il riepilogo resta in cache per la schermata «Consegna completata».
export function useConsegnato() {
  const clientDati = useQueryClient();
  return useMutation({
    mutationFn: (ordineId: number) => chiamaApi<{ ok: boolean; riepilogo: RiepilogoConsegna }>('/corrieri/consegne/' + ordineId + '/consegnato', { metodo: 'POST' }),
    onSuccess: (risposta) => {
      clientDati.setQueryData<RiepilogoConsegna>(chiaveRiepilogo(risposta.riepilogo.ordine_id), risposta.riepilogo);
      clientDati.setQueryData<RispostaInCorso>(CHIAVE_IN_CORSO, { consegna: null });
      clientDati.invalidateQueries({ queryKey: CHIAVE_ELENCO });
    },
  });
}

// Rilegge tutto quello che riguarda le consegne (dopo un errore che dice che qualcosa è cambiato).
export function useRileggiTutto() {
  const clientDati = useQueryClient();
  return () => clientDati.invalidateQueries({ queryKey: ['corriere'], refetchType: 'all' });
}
