# Cosa c'è dentro / cosa è volutamente fuori

Aggiornato al Blocco 1 (26/08/2026).

## Dentro (Blocco 1, oggi funzionante)

- Login con utenza assegnata manualmente (cliente / agente), nessuna registrazione self-service.
- Catalogo prodotti (dati demo seedati, non ancora caricabile dall'agente).
- Creazione ordine: selezione prodotti + quantità, scelta ritiro o consegna con mezzo del
  grossista, calcolo automatico del prezzo netto (listino − sconto Base per prodotto) e del
  totale finale (con costo di servizio incluso, non esplicitato).
- Pagina di conferma ordine per il cliente.
- Vista agente: elenco di tutti gli ordini con cliente/data/importo/stato e dettaglio riga per
  riga. Sola lettura.
- Isolamento dati: un cliente vede solo i propri ordini.

## Dentro ma non ancora costruito (previsto nei prossimi blocchi)

- **Blocco 2** — Caricamento/aggiornamento catalogo via CSV o form da parte dell'agente (oggi il
  catalogo è fisso, seedato a mano).
- **Blocco 3** — Cambio stato ordine da parte dell'agente (inviato → in evasione → evaso) e
  storico ordini consultabile dal cliente.
- **Blocco 4** — Estrazione dati per le metriche del pilot (clienti attivi/mese, tempo medio
  ordine→evasione, ordini per cliente) in CSV o query semplice.

## Volutamente fuori scope (non va costruito senza deciderlo insieme)

- Marketplace multi-grossista o comparazione prezzi tra fornitori.
- Registrazione self-service dei clienti.
- App nativa iOS/Android.
- Integrazione logistica automatizzata con corrieri esterni.
- Sconti/prezzi personalizzati per singolo cliente (lo sconto preciso resta in fattura, come oggi).
- Notifiche push, chat in-app, funzionalità social.
- Integrazione realtime col gestionale AS400 del grossista (import batch è compatibile col
  modello dati attuale, ma non è ancora costruito).
- Pagamento online: la fatturazione resta il processo attuale del grossista.
- Pannello di gestione utenti (creare/modificare credenziali clienti da interfaccia): per ora si
  fa a mano su `db/seed.js` o direttamente sul DB. Da valutare se serve prima del pilot o se basta
  per 3-5 utenti gestiti manualmente.

## Scelte di scope già confermate con l'utente

- Costo di servizio (+10%): incluso solo nel totale finale, nessuna riga separata nel riepilogo.
- Sconto Base: gestito per singolo prodotto (non un valore unico globale).
