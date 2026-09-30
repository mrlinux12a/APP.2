// Letture dal server con cache (react-query): tornando indietro a una schermata già vista
// l'elenco è subito lì, senza ricaricare.
import { infiniteQueryOptions, keepPreviousData, queryOptions, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  chiamaApi,
  urlFoto,
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

// Il catalogo cambia di rado: dati "freschi" per 5 minuti (niente riletture inutili) e
// conservati 30 minuti anche se nessuna schermata li sta guardando, così quelli letti in
// anticipo (vedi sotto) sono ancora lì quando si apre la categoria.
const FRESCHI = 5 * 60 * 1000;
const CONSERVATI = 30 * 60 * 1000;

function opzioniCategoria(slug: string) {
  return queryOptions({
    queryKey: ['categoria', slug],
    queryFn: () =>
      chiamaApi<{ macro: { slug: string; nome: string; descrizione: string }; sottocategorie: Sottocategoria[] }>(
        '/categorie/' + encodeURIComponent(slug)
      ),
    staleTime: FRESCHI,
    gcTime: CONSERVATI,
  });
}

export function useCategoria(slug: string) {
  return useQuery(opzioniCategoria(slug));
}

function conParametri(percorso: string, parametri: Record<string, string | number | null | undefined>) {
  const parti = Object.entries(parametri)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => k + '=' + encodeURIComponent(String(v)));
  return percorso + (parti.length ? (percorso.includes('?') ? '&' : '?') + parti.join('&') : '');
}

// Elenco a pagine da 40 (come sul sito), caricate man mano che si scorre.
function opzioniElenco(percorso: string) {
  return infiniteQueryOptions({
    queryKey: ['elenco', percorso],
    queryFn: ({ pageParam }) => chiamaApi<Pagina>(conParametri(percorso, { pagina: pageParam })),
    initialPageParam: 1,
    getNextPageParam: (ultima: Pagina) => (ultima.pagina < ultima.pagine ? ultima.pagina + 1 : undefined),
    staleTime: FRESCHI,
    gcTime: CONSERVATI,
  });
}

export function useElencoPaginato(percorso: string, attivo = true) {
  return useInfiniteQuery({ ...opzioniElenco(percorso), enabled: attivo });
}

export function percorsoProdottiCategoria(slug: string, sotto: string | null) {
  return conParametri('/categorie/' + encodeURIComponent(slug) + '/prodotti', { sotto });
}

// ---------- Lettura in anticipo ----------
// La prima volta che si apriva una categoria servivano due giri al server di fila (prima le
// sottocategorie, poi il primo elenco di prodotti) più il download delle foto, con uno
// spinner nel mezzo. Qui si leggono in background appena si vede la schermata precedente:
// all'apertura è già tutto in cache. Solo la prima pagina, mai l'intero catalogo.

const FOTO_ANTICIPATE = 6;

// Esegue i compiti al massimo `contemporanei` alla volta, per non intasare il server; un
// compito fallito non ferma gli altri.
async function inCoda(compiti: (() => Promise<unknown>)[], contemporanei: number, annullato: () => boolean) {
  let prossimo = 0;
  const lavoratore = async () => {
    while (prossimo < compiti.length && !annullato()) {
      try {
        await compiti[prossimo++]();
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(contemporanei, compiti.length) }, lavoratore));
}

// Prima pagina di un elenco, con le foto dei primi prodotti già scaricate.
async function precaricaElenco(clientDati: QueryClient, percorso: string) {
  const dati = await clientDati.fetchInfiniteQuery(opzioniElenco(percorso));
  const urls = (dati.pages[0]?.risultati || [])
    .filter((p) => p.foto_url)
    .slice(0, FOTO_ANTICIPATE)
    .map((p) => urlFoto(p.foto_url as string));
  if (urls.length) Image.prefetch(urls).catch(() => {});
}

// Una categoria e, se la schermata va dritta ai prodotti (0 o 1 sottocategoria), anche il
// loro primo elenco: stessa regola di app/(schede)/(catalogo)/categoria/[slug].tsx.
async function precaricaCategoria(clientDati: QueryClient, slug: string) {
  const { sottocategorie } = await clientDati.fetchQuery(opzioniCategoria(slug));
  if (sottocategorie.length <= 1) {
    await precaricaElenco(clientDati, percorsoProdottiCategoria(slug, sottocategorie[0]?.slug ?? null));
  }
}

// Dalla home: tutte le categorie (le prime dell'elenco per prime), poi la vetrina con foto.
export function usePrecaricaCatalogo(categorie: Categoria[]) {
  const clientDati = useQueryClient();
  const chiave = categorie.map((m) => m.slug).join('|');
  useEffect(() => {
    if (!chiave) return;
    let annullato = false;
    inCoda(
      [
        ...chiave.split('|').map((slug) => () => precaricaCategoria(clientDati, slug)),
        () => precaricaElenco(clientDati, '/con-foto'),
      ],
      3,
      () => annullato
    );
    return () => {
      annullato = true;
    };
  }, [clientDati, chiave]);
}

// Dall'elenco delle sottocategorie: il primo elenco di ciascuna, mentre si legge quello.
export function usePrecaricaSottocategorie(slug: string, sottocategorie: Sottocategoria[]) {
  const clientDati = useQueryClient();
  const chiave = sottocategorie.map((s) => s.slug).join('|');
  useEffect(() => {
    if (!chiave) return;
    let annullato = false;
    inCoda(
      chiave.split('|').map((sotto) => () => precaricaElenco(clientDati, percorsoProdottiCategoria(slug, sotto))),
      3,
      () => annullato
    );
    return () => {
      annullato = true;
    };
  }, [clientDati, slug, chiave]);
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
// Si aspetta una breve pausa nei tocchi: cinque "+" di fila fanno una richiesta, non cinque.
// inAttesa: le quantità sono cambiate ma i totali mostrati sono ancora quelli di prima.
export function useRiepilogoCarrello(voci: { id: number; quantita: number }[]) {
  // Confronto per contenuto: chi chiama passa un array nuovo a ogni rendering.
  const chiave = JSON.stringify(voci);
  const chiaveDifferita = useDifferito(chiave, 300);
  const differite = useMemo<{ id: number; quantita: number }[]>(() => JSON.parse(chiaveDifferita), [chiaveDifferita]);
  const query = useQuery({
    queryKey: ['riepilogo-carrello', differite],
    queryFn: () => chiamaApi<RiepilogoCarrello>('/carrello/riepilogo', { metodo: 'POST', corpo: { righe: differite } }),
    enabled: differite.length > 0,
    placeholderData: keepPreviousData,
  });
  return { ...query, inAttesa: chiaveDifferita !== chiave };
}

const APERTA = new Set(['in_attesa', 'con_offerte']);

// Rilettura periodica solo mentre la schermata è in primo piano: con l'app su un'altra
// scheda (o sotto un'altra schermata) il giro rallenta, invece di continuare ogni pochi secondi
// per nulla. Non si ferma del tutto, così un'offerta arrivata nel frattempo non resta invisibile.
// Tornando in primo piano si rilegge subito, senza aspettare il prossimo giro.
function useRileggiAlRitorno(rileggi: () => unknown, inPrimoPiano: boolean) {
  const eraInPrimoPiano = useRef(inPrimoPiano);
  useEffect(() => {
    if (inPrimoPiano && !eraInPrimoPiano.current) rileggi();
    eraInPrimoPiano.current = inPrimoPiano;
  }, [inPrimoPiano, rileggi]);
}

// Mentre i banchi rispondono (o si sceglie) la richiesta si rilegge da sola ogni 4 secondi.
export function useRichiesta(id: number) {
  const inPrimoPiano = useIsFocused();
  const query = useQuery({
    queryKey: ['richiesta', id],
    queryFn: () => chiamaApi<Richiesta>('/richieste/' + id),
    refetchInterval: (q) => (q.state.data && APERTA.has(q.state.data.stato) ? (inPrimoPiano ? 4000 : 30000) : false),
  });
  useRileggiAlRitorno(query.refetch, inPrimoPiano);
  return query;
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

// L'ordine cambia stato quando il banco lo prende in carico o lo spedisce: si rilegge ogni 20s
// (ogni minuto se la schermata non è in primo piano, vedi useRileggiAlRitorno).
export function useOrdine(id: number) {
  const inPrimoPiano = useIsFocused();
  const query = useQuery({
    queryKey: ['ordine', id],
    queryFn: () => chiamaApi<Ordine>('/ordini/' + id),
    refetchInterval: inPrimoPiano ? 20000 : 60000,
  });
  useRileggiAlRitorno(query.refetch, inPrimoPiano);
  return query;
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
