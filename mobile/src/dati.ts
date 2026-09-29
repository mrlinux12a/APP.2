// Letture dal server con cache (react-query): tornando indietro a una schermata già vista
// l'elenco è subito lì, senza ricaricare.
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  chiamaApi,
  type Attivita,
  type Categoria,
  type Ordine,
  type Pagina,
  type Prodotto,
  type Richiesta,
  type RiepilogoCarrello,
  type RiepilogoOfferta,
  type Sottocategoria,
  type VoceStorico,
} from './api';

export function useCatalogo() {
  return useQuery({
    queryKey: ['catalogo'],
    queryFn: () => chiamaApi<{ in_evidenza: Categoria[]; altre: Categoria[]; con_foto: number }>('/catalogo'),
  });
}

export function useCategoria(slug: string) {
  return useQuery({
    queryKey: ['categoria', slug],
    queryFn: () =>
      chiamaApi<{ macro: { slug: string; nome: string; descrizione: string }; sottocategorie: Sottocategoria[] }>(
        '/categorie/' + encodeURIComponent(slug)
      ),
  });
}

function conParametri(percorso: string, parametri: Record<string, string | number | null | undefined>) {
  const parti = Object.entries(parametri)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => k + '=' + encodeURIComponent(String(v)));
  return percorso + (parti.length ? (percorso.includes('?') ? '&' : '?') + parti.join('&') : '');
}

// Elenco a pagine da 40 (come sul sito), caricate man mano che si scorre.
export function useElencoPaginato(percorso: string, attivo = true) {
  return useInfiniteQuery({
    queryKey: ['elenco', percorso],
    queryFn: ({ pageParam }) => chiamaApi<Pagina>(conParametri(percorso, { pagina: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.pagina < ultima.pagine ? ultima.pagina + 1 : undefined),
    enabled: attivo,
  });
}

export function percorsoProdottiCategoria(slug: string, sotto: string | null) {
  return conParametri('/categorie/' + encodeURIComponent(slug) + '/prodotti', { sotto });
}

function useDifferito<T>(valore: T, ms: number) {
  const [differito, setDifferito] = useState(valore);
  useEffect(() => {
    const t = setTimeout(() => setDifferito(valore), ms);
    return () => clearTimeout(t);
  }, [valore, ms]);
  return differito;
}

// Ricerca mentre si scrive: parte dopo una breve pausa e dai 2 caratteri (come il sito).
// I risultati precedenti restano visibili finché arrivano i nuovi, niente lampeggio.
export function useRicerca(testo: string, ambito: { macro?: string | null; sotto?: string | null } = {}) {
  const q = useDifferito(testo.trim(), 250);
  const attiva = q.length >= 2;
  const query = useQuery({
    queryKey: ['cerca', q, ambito.macro || null, ambito.sotto || null],
    queryFn: () =>
      chiamaApi<{ risultati: Prodotto[] }>(conParametri('/cerca', { q, macro: ambito.macro, sotto: ambito.sotto })),
    enabled: attiva,
    placeholderData: keepPreviousData,
  });
  return { ...query, attiva: testo.trim().length >= 2, q };
}

// ---------- Flusso richiesta -> offerte -> ordine ----------

// Totali del carrello ricalcolati dal server (prezzi veri, spedizione, ordine minimo).
export function useRiepilogoCarrello(voci: { id: number; quantita: number }[]) {
  return useQuery({
    queryKey: ['riepilogo-carrello', voci],
    queryFn: () => chiamaApi<RiepilogoCarrello>('/carrello/riepilogo', { metodo: 'POST', corpo: { righe: voci } }),
    enabled: voci.length > 0,
    placeholderData: keepPreviousData,
  });
}

const APERTA = new Set(['in_attesa', 'con_offerte']);

// Mentre i banchi rispondono (o si sceglie) la richiesta si rilegge da sola ogni 4 secondi.
export function useRichiesta(id: number) {
  return useQuery({
    queryKey: ['richiesta', id],
    queryFn: () => chiamaApi<Richiesta>('/richieste/' + id),
    refetchInterval: (q) => (q.state.data && APERTA.has(q.state.data.stato) ? 4000 : false),
  });
}

export function useRiepilogoOfferta(richiestaId: number, distributoreId: number, modalita: string) {
  return useQuery({
    queryKey: ['offerta', richiestaId, distributoreId, modalita],
    queryFn: () =>
      chiamaApi<RiepilogoOfferta>(
        conParametri(`/richieste/${richiestaId}/offerte/${distributoreId}`, { modalita: modalita === 'ritiro' ? 'ritiro' : null })
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

// L'ordine cambia stato quando il banco lo prende in carico o lo spedisce: si rilegge ogni 20s.
export function useOrdine(id: number) {
  return useQuery({
    queryKey: ['ordine', id],
    queryFn: () => chiamaApi<Ordine>('/ordini/' + id),
    refetchInterval: 20000,
  });
}

export function useStatoOrdini() {
  return useQuery({
    queryKey: ['stato-ordini'],
    queryFn: () => chiamaApi<{ attivo: Attivita }>('/stato-ordini'),
    staleTime: 0,
  });
}

export function useStorico() {
  return useQuery({
    queryKey: ['storico'],
    queryFn: () => chiamaApi<{ voci: VoceStorico[] }>('/storico'),
    staleTime: 0,
  });
}

// Conto alla rovescia locale fra una lettura e l'altra dal server: parte dai secondi letti
// (aggiornati a ogni lettura) e scende di uno al secondo.
export function useContoAllaRovescia(secondi: number | null | undefined, lettoIl: number) {
  const [ora, setOra] = useState(Date.now());
  useEffect(() => {
    if (secondi === null || secondi === undefined) return;
    const t = setInterval(() => setOra(Date.now()), 1000);
    return () => clearInterval(t);
  }, [secondi]);
  if (secondi === null || secondi === undefined) return null;
  return Math.max(0, secondi - Math.max(0, Math.floor((ora - lettoIl) / 1000)));
}
