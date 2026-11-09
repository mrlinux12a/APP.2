// Le risposte dell'API di lavoro del corriere (src/routes/api_v1/corrieri_consegne.js nel progetto principale; docs/app-corrieri.md). Gli errori «previsti» hanno
// `dati.codice` (vedi CODICI in dati.ts): 'gia_accettata', 'scaduta', 'tua', 'posizione_mancante', 'gia_in_consegna'...

// Dove si trova il telefono (una lettura sola: niente tracciamento).
export type Posizione = { lat: number; lng: number };

// Gli orari del banco oggi, già scritti dal server: «Banco aperto 7:30 – 12:30 · 14:00 – 18:00» / «Banco chiuso · riapre domani alle 07:30».
export type OrariBanco = { aperto: boolean; oggi: string[]; testo: string; chiude_alle: string | null };

// Tempo e km di un pezzo di strada (km null se il server non lo sa).
export type Tragitto = { minuti: number; km: number | null };

// Una richiesta nell'elenco della home. `tempo_totale_min` e `km_totali` sono null finché il server non conosce la posizione del telefono.
export type SchedaRichiesta = {
  id: number;
  fa_secondi: number;
  ritiro: { ditta: string; zona: string };
  consegna: { zona: string };
  tempo_totale_min: number | null;
  km_totali: number | null;
};

// `disponibile` = «Sei disponibile» acceso; `in_corso` = il corriere ha già una consegna (allora l'elenco è vuoto); `posizione` = il server ha usato la posizione.
export type ElencoRichieste = { disponibile: boolean; in_corso: boolean; posizione?: boolean; richieste: SchedaRichiesta[] };

export type BancoRitiro = { ditta: string; filiale: string; nome: string; indirizzo: string; telefono: string; orari: OrariBanco | null };

export type DettaglioRichiesta = {
  id: number;
  fa_secondi: number;
  tempo_totale_min: number | null;
  km_totali: number | null;
  // Dalla posizione del corriere al banco (null senza posizione) e dal banco al cantiere.
  alla_sede: Tragitto | null;
  al_cantiere: Tragitto;
  banco: BancoRitiro;
  cantiere: { installatore: string; indirizzo: string; zona: string; note: string };
  // `al_banco`: dalla posizione del telefono al banco; `al_cantiere`: dal banco al cantiere; `percorso`: come `al_cantiere` (resta per compatibilità).
  mappe: { al_banco: string; al_cantiere: string; percorso: string };
};

// La consegna in corso: `fase` 1 = «Vai al ritiro», 2 = «Vai al cantiere».
export type ConsegnaInCorso = {
  ordine_id: number;
  codice: string;
  fase: 1 | 2;
  accettata_il: string | null;
  ritirato_il: string | null;
  ritirato_alle: string | null;
  banco: BancoRitiro;
  cantiere: { installatore: string; indirizzo: string; telefono: string; note: string };
  al_banco: Tragitto;
  al_cantiere: Tragitto;
  arrivo_stimato: string | null;
  mappe: { al_banco: string; al_cantiere: string; percorso: string };
};

// `in_preparazione`: il corriere ha accettato ma l'ordine non è ancora nato (di solito un attimo): si riprova subito dopo.
export type RispostaInCorso = { consegna: ConsegnaInCorso | null; in_preparazione?: boolean };

export type RiepilogoConsegna = {
  ordine_id: number;
  codice: string;
  ritirata_alle: string | null;
  consegnata_alle: string | null;
  tempo_effettivo_min: number | null;
  tempo_stimato_min: number | null;
  distanza_km: number | null;
};
