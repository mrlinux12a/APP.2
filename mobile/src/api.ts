// Chiamate all'API JSON del server (src/api_v1.js nel progetto principale).
import Constants from 'expo-constants';

// In sviluppo il telefono raggiunge il server sul PC attraverso la rete locale: l'indirizzo
// è lo stesso da cui Expo serve l'app (hostUri), con la porta del server Express. In
// produzione si imposta EXPO_PUBLIC_API_URL (l'indirizzo del server che ospita il sito).
function indirizzoServer(): string {
  const esplicito = process.env.EXPO_PUBLIC_API_URL;
  if (esplicito) return esplicito.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:3000`;
}

export const SERVER = indirizzoServer();

// In un'app installata (non in sviluppo) si parla solo con un indirizzo HTTPS vero: Android blocca il traffico non cifrato, e un indirizzo di
// segnaposto (".invalid", quello di eas.json prima di scrivere il dominio) o rimasto da una prova su rete locale farebbe un'app che non funziona.
// Ritorna il motivo per cui l'app non è configurata, o null.
export function erroreConfigurazione(): string | null {
  if (__DEV__) return null;
  if (!/^https:\/\//i.test(SERVER)) return 'L’app non è configurata: l’indirizzo del server deve essere HTTPS (EXPO_PUBLIC_API_URL).';
  if (/\.invalid(\/|:|$)/i.test(SERVER)) return 'L’app non è configurata: manca l’indirizzo del server (EXPO_PUBLIC_API_URL in eas.json).';
  return null;
}
const TIMEOUT_MS = 20000;
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

  // Senza un limite, con il server spento o il segnale che cade la chiamata restava appesa
  // per minuti (spinner infinito). Dopo TIMEOUT_MS si dà errore e resta il "Riprova".
  const interruzione = new AbortController();
  const scadenza = setTimeout(() => interruzione.abort(), TIMEOUT_MS);

  let risposta: Response;
  try {
    risposta = await fetch(BASE + percorso, {
      method: opzioni.metodo || 'GET',
      headers: intestazioni,
      body: opzioni.corpo !== undefined ? JSON.stringify(opzioni.corpo) : undefined,
      signal: interruzione.signal,
    });
  } catch {
    throw new ErroreApi('Server non raggiungibile: controlla la connessione.', 0);
  } finally {
    clearTimeout(scadenza);
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

// ---------- Flusso richiesta pagata -> ordine ----------

// Le voci del riepilogo come testo già pronto (euro all'italiana): le stesse chiavi del carrello del sito (flusso.vistaRiepilogo).
export type VistaRiepilogo = {
  app_corriere: string;
  app_servizio: string;
  app_imponibile: string;
  app_iva: string;
  app_totale: string;
  servizio_pct: string;
  iva_pct: string;
  banco_merce: string;
  banco_raee: string;
  banco_imponibile: string;
  banco_iva: string;
  banco_totale: string;
  articoli: string;
  con_raee: boolean;
  spesa: string;
  raggiunto: boolean;
  manca: string;
};

export type RiepilogoCarrello = {
  merce: string;
  raee: string | null;
  spedizione: string;
  imponibile: string;
  iva: string;
  iva_pct: number;
  // La spesa complessiva (consegna + materiale).
  totale_ivato: string;
  // Quello che l'installatore paga ORA in app (consegna in cantiere: corriere + servizio + IVA) e quello che paga DOPO al banco (materiale + IVA).
  da_pagare_ora: string;
  da_pagare_al_banco: string;
  riepilogo: VistaRiepilogo;
  // Nome della ditta a cui si paga il materiale ("BOREA"), se c'è.
  ditta: string | null;
  // true = carta vera (Stripe); false = pagamento di prova, nessun addebito.
  pagamento_reale: boolean;
  // Destinazione di partenza: l'indirizzo di consegna abituale.
  indirizzo_consegna: string;
  minimo: string;
  manca_al_minimo: string;
  raggiunto: boolean;
  minuti_risposta: number;
  non_piu_disponibili: number[];
};

// in_attesa: banchi e corrieri stanno rispondendo; ordinata: l'ordine è nato (c'è order_id);
// nessuna_offerta: chiusa senza ordine (blocco sulla carta tolto); annullata: l'ha annullata l'installatore.
export type StatoRichiesta = 'in_attesa' | 'nessuna_offerta' | 'ordinata' | 'annullata';

export type RigaSemplice = { quantita: number; nome: string; codice: string };

// Il pagamento fatto all'invio della richiesta (forma storica). null per le richieste del vecchio flusso.
export type Pagamento = {
  stato: 'pagato' | 'rimborsato';
  stato_testo: string;
  importo: string;
  simulato: boolean;
  pagato_il: string | null;
};

// Cosa dice la carta: bloccata, pagata, annullata (nessun addebito) o rimborsata. null per le richieste del vecchio flusso.
export type StatoPagamento = {
  chiave: 'bloccato' | 'pagato' | 'annullato' | 'rimborsato';
  testo: string;
  importo: string | null;
  data: string | null;
  carta: string | null;
  ricevuta: boolean;
  ricevuta_rimborso: boolean;
  prova: boolean;
};

// Le due parti di quello che si paga: la consegna in app, il materiale dopo al banco.
export type Importi = {
  consegna: { totale: string; corriere: string; servizio: string; servizio_pct: number; imponibile: string; iva: string; iva_pct: number };
  materiale: { totale: string; merce: string; raee: string | null; imponibile: string; iva: string };
  spesa: string;
};

export type RigaPrezzo = { quantita: number; nome: string; codice: string; cad: string; totale: string };

export type Richiesta = {
  id: number;
  stato: StatoRichiesta;
  order_id: number | null;
  creato_il: string;
  secondi: number;
  minuti_risposta: number;
  righe: RigaSemplice[];
  righe_prezzi: RigaPrezzo[];
  importi: Importi;
  ditta: string | null;
  rinvio: { consegna: string; materiale: string };
  risposte: { distributore: string; filiale: string; esito: string; esito_testo: string; banco_confermato: boolean }[];
  pagamento: Pagamento | null;
  stato_pagamento: StatoPagamento | null;
  annullabile: boolean;
};

export type Ordine = {
  id: number;
  stato: 'inviato' | 'in_evasione' | 'evaso';
  stato_testo: string;
  consegnato: boolean;
  tempo_testo: string;
  // Secondi all'arrivo alla risposta del server (negativi se l'orario è passato) e durata totale: servono al conto alla rovescia locale.
  eta_sec: number | null;
  durata_sec: number | null;
  in_arrivo: boolean;
  corriere: string | null;
  creato_il: string;
  consegnato_il: string | null;
  distributore: { nome: string; filiale: string } | null;
  ditta: string;
  modalita: string;
  destinazione: string | null;
  note: string | null;
  righe: { quantita: number; nome: string; codice: string; cad: string; subtotale: string }[];
  importi: Importi;
  totali: { merce: string; raee: string | null; consegna: string; iva: string; totale: string };
  iva_pct: number;
  pagamento: Pagamento | null;
  stato_pagamento: StatoPagamento | null;
  annullabile: boolean;
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

// Un'attività in corso di "Stato ordini": richiesta in attesa (secondi, durata), ordine in consegna (eta_sec, durata_sec) o richiesta scaduta da rinviare.
export type VoceAttivita = {
  tipo: 'ordine' | 'richiesta';
  id: number;
  fase: 'richiesta' | 'consegna' | 'scaduta';
  richiesta_id: number;
  breve: string;
  secondi: number | null;
  durata: number | null;
  eta_sec: number | null;
  durata_sec: number | null;
  in_arrivo: boolean;
  minuti: number | null;
  corriere: string;
};

// Il pagamento con carta da fare con il foglio di Stripe (POST /richieste o /richieste/:id/reinvia con Stripe attivo).
export type PagamentoDaFare = {
  esito: 'da_pagare';
  id: number;
  client_secret: string;
  chiave_pubblica: string;
  importo: string;
  modo: 'test' | 'live';
};

export type EsitoPagamento =
  | { esito: 'ok'; id: number; request_id: number; tipo: string }
  | PagamentoDaFare
  | { esito: 'in_corso' }
  | { esito: 'rifiutato'; titolo: string; messaggio: string }
  | { esito: 'annullato' }
  | { esito: 'non_configurato' };

// Lo Storico come sul sito: il materiale ordinato mese per mese, con i prezzi IVA inclusa e quanto si deve al banco.
export type VoceMateriale =
  | {
      tipo: 'ordine';
      id: number;
      data: string;
      stato: string;
      consegnato: boolean;
      totale: string;
      servizio: string;
      primo: string;
      altri: number;
      ditta: string;
      ricevuta: boolean;
      righe: { quantita: number; nome: string; codice: string; cad: string; totale: string }[];
    }
  | {
      tipo: 'richiesta';
      id: number;
      data: string;
      etichetta: string;
      tono: 'annullata' | 'nessuna';
      primo: string;
      altri: number;
      apribile: boolean;
      righe: { quantita: number; nome: string }[];
    };

export type Materiale = {
  mese: string;
  vista: 'ordine' | 'articolo';
  mesi: { chiave: string; titolo: string }[];
  ditte: string[];
  riepilogo: { totale: string; servizio: string; n_ordini: number };
  elenco: VoceMateriale[];
  articoli: { codice: string; nome: string; cad: string | null; quantita: number; totale: string; n_ordini: number }[];
  vuoto: boolean;
};

export type Profilo = {
  utente: Utente & {
    tipo_soggetto: string;
    tipo_testo: string;
    referente: string;
    partita_iva: string;
    codice_fiscale: string;
    indirizzo: string;
    cap: string;
    citta: string;
    provincia: string;
    sdi_pec: string;
    email: string;
    telefono: string;
    indirizzo_consegna: string;
  };
  distributore: string | null;
  assistenza: string | null;
};
