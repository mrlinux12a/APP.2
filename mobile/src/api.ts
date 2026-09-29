// Chiamate all'API JSON del server (src/api_v1.js nel progetto principale).
import Constants from 'expo-constants';

// In sviluppo il telefono raggiunge il server sul PC attraverso la rete locale: l'indirizzo
// è lo stesso da cui Expo serve l'app (hostUri), con la porta del server Express. In
// produzione si imposta EXPO_PUBLIC_API_URL (es. l'indirizzo del deploy su Vercel).
function indirizzoServer(): string {
  const esplicito = process.env.EXPO_PUBLIC_API_URL;
  if (esplicito) return esplicito.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:3000`;
}

export const SERVER = indirizzoServer();
const BASE = SERVER + '/api/v1';

// Le foto prodotto nel DB sono percorsi del sito (/img/prodotti/...).
export function urlFoto(percorso: string) {
  return /^https?:\/\//.test(percorso) ? percorso : SERVER + percorso;
}

// dati: il corpo della risposta d'errore (es. codice 'in_corso' e request_id).
export class ErroreApi extends Error {
  constructor(messaggio: string, public stato: number, public dati: any = null) {
    super(messaggio);
  }
}

let tokenCorrente: string | null = null;
let allaScadenza: (() => void) | null = null;

export function impostaToken(token: string | null) {
  tokenCorrente = token;
}

// Chiamata quando il server risponde 401 (token scaduto o revocato): la sessione esce.
export function suAccessoScaduto(fn: () => void) {
  allaScadenza = fn;
}

export async function chiamaApi<T>(percorso: string, opzioni: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  const intestazioni: Record<string, string> = { Accept: 'application/json' };
  if (tokenCorrente) intestazioni.Authorization = 'Bearer ' + tokenCorrente;
  if (opzioni.corpo !== undefined) intestazioni['Content-Type'] = 'application/json';

  let risposta: Response;
  try {
    risposta = await fetch(BASE + percorso, {
      method: opzioni.metodo || 'GET',
      headers: intestazioni,
      body: opzioni.corpo !== undefined ? JSON.stringify(opzioni.corpo) : undefined,
    });
  } catch {
    throw new ErroreApi('Server non raggiungibile: controlla la connessione.', 0);
  }

  let dati: any = null;
  try {
    dati = await risposta.json();
  } catch {}

  if (!risposta.ok) {
    if (risposta.status === 401 && tokenCorrente && allaScadenza) allaScadenza();
    throw new ErroreApi((dati && dati.errore) || 'Errore imprevisto (' + risposta.status + ').', risposta.status, dati);
  }
  return dati as T;
}

// ---------- Tipi delle risposte ----------

export type Utente = { id: number; username: string; ragione_sociale: string; ruolo: string };

export type Categoria = { slug: string; nome: string; descrizione: string; n_prodotti: number };

export type Sottocategoria = { slug: string; nome: string; n: number };

export type Disponibilita = 'disponibile' | 'in_esaurimento' | 'non_disponibile';

export type Variante = {
  id: number;
  etichetta: string;
  codice: string;
  disponibilita: Disponibilita;
  disponibilita_testo: string;
  raee: string | null;
  sconto_base_pct: number;
  listino: string;
  prezzo: string;
  prezzo_valore: number;
};

export type Prodotto = {
  id: number;
  codice: string;
  nome: string;
  categoria: string | null;
  brand_nome: string | null;
  brand_colore: string | null;
  foto_url: string | null;
  raee: string | null;
  disponibilita: Disponibilita;
  disponibilita_testo: string;
  sconto_base_pct: number;
  listino: string;
  prezzo: string;
  prezzo_valore: number;
  varianti: Variante[] | null;
};

export type Pagina = { risultati: Prodotto[]; pagina: number; pagine: number; totale: number };

// ---------- Flusso richiesta -> offerte -> ordine ----------

export type RiepilogoCarrello = {
  merce: string;
  raee: string | null;
  spedizione: string;
  totale: string;
  minimo: string;
  manca_al_minimo: string;
  raggiunto: boolean;
  minuti_risposta: number;
  non_piu_disponibili: number[];
};

export type StatoRichiesta = 'in_attesa' | 'con_offerte' | 'nessuna_offerta' | 'ordinata' | 'annullata';

export type RigaSemplice = { quantita: number; nome: string; codice: string };

export type Offerta = {
  distributore_id: number;
  distributore: string;
  filiale: string;
  imponibile: string;
  merce: string;
  consegna: string | null;
  copertura: 'totale' | 'parziale';
  mancanti: { nome: string; mancano: number }[];
  partenza_testo: string;
  arrivo_testo: string;
  note: string | null;
  piu_veloce: boolean;
  piu_conveniente: boolean;
};

export type Richiesta = {
  id: number;
  stato: StatoRichiesta;
  order_id: number | null;
  creato_il: string;
  secondi: number;
  minuti_risposta: number;
  righe: RigaSemplice[];
  risposte: { distributore: string; filiale: string; esito: string; esito_testo: string }[];
  offerte: Offerta[];
  offerte_scadute: boolean;
  secondi_scelta: number | null;
  nome_assegnazione: string | null;
};

export type Totali = {
  merce: string;
  raee: string | null;
  consegna: string | null;
  imponibile: string;
  iva: string;
  totale_ivato: string;
};

export type RiepilogoOfferta = {
  modalita: 'consegna_mezzo_grossista' | 'ritiro';
  cliente: { ragione_sociale: string; telefono: string | null };
  indirizzo_consegna: string;
  distributore: { id: number; nome: string; filiale: string; zona: string };
  partenza_testo: string;
  consegna_testo: string;
  mancanti: { nome: string; mancano: number }[];
  righe: (RigaSemplice & { prezzo: string; subtotale: string })[];
  totali: Totali;
  iva_pct: number;
  secondi_scelta: number | null;
  nome_assegnazione: string | null;
};

export type Ordine = {
  id: number;
  stato: 'inviato' | 'in_evasione' | 'evaso';
  stato_testo: string;
  consegnato: boolean;
  tempo_testo: string;
  creato_il: string;
  distributore: { nome: string; filiale: string } | null;
  modalita: string;
  modalita_testo: string;
  tempi_testo: string;
  destinazione: string | null;
  note: string | null;
  ddt: { numero: string; data: string } | null;
  righe: (RigaSemplice & { subtotale: string })[];
  totali: { merce: string; raee: string | null; consegna: string | null; iva: string; totale: string };
  iva_pct: number;
  assegnata_auto: boolean;
  annullabile: boolean;
  da_confermare_consegna: boolean;
};

export type VoceStorico = {
  richiesta_id: number;
  order_id: number | null;
  data: string;
  materiale: string;
  etichetta: string;
  tono: 'ok' | 'attesa' | 'ko';
};

export type Attivita = { tipo: 'ordine' | 'richiesta'; id: number } | null;
