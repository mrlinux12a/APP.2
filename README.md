# Ordini Minuteria — MVP

App per digitalizzare gli ordini di materiale termoidraulico tra installatori pilota e i
distributori di zona. La vista cliente è pensata **per il telefono**; la vista agente resta una
pagina da scrivania.

## Avvio in locale

Richiede **Node.js 22.5 o superiore** (usa il modulo SQLite integrato in Node, niente
compilazioni native da installare — più semplice su qualsiasi hosting).

```
npm install
npm run seed     # crea/aggiorna utenti, catalogo e listini demo (idempotente)
npm start
```

Apri `http://localhost:3000`. Vedrai un avviso "SQLite is an experimental feature": è normale,
non un errore.

## Credenziali demo

| Ruolo        | Utente     | Password   | Chi è |
|--------------|------------|------------|-------|
| Cliente      | rossi      | cliente123 | Rossi Impianti Srl |
| Cliente      | bianchi    | cliente123 | Idraulica Bianchi |
| Cliente      | verdi      | cliente123 | Termoidraulica Verdi |
| Distributore | afis       | banco123   | Banco AFIS SPA |
| Distributore | borea      | banco123   | Banco BOREA SRL |
| Distributore | cambielli  | banco123   | Banco CAMBIELLI SPA |
| Agente       | agente     | agente123  | Grossista / gestore |

Queste credenziali sono solo per il test interno: vanno cambiate prima di far provare l'app ai
clienti pilota (per ora si aggiornano a mano nel DB o rilanciando `db/seed.js` con altri dati).

## Il flusso, passo per passo

**Cliente** (telefono)

1. **Home** — barra di ricerca e macro categorie merceologiche (Condizionamento, Caldaie e
   scaldacqua, Minuteria e raccorderia).
2. **Ricerca parziale** — basta un frammento di parola: scrivendo `valv` escono tutte le valvole,
   in qualunque categoria. La ricerca parte mentre si digita.
3. **Scelta del materiale** — dalla categoria si impostano le quantità e si preme **Procedi**
   (oppure "Aggiungi e continua a scegliere" per pescare da più categorie).
4. **Attesa** — la richiesta parte verso i distributori della zona del cliente che trattano
   *tutti* i prodotti richiesti. Hanno **10 minuti** per confermare la disponibilità al banco.
   Il cliente vede un countdown e riceve una notifica appena arriva una risposta: può chiudere
   la schermata.
5. **Offerte** — appena almeno un distributore conferma (o allo scadere dei 10 minuti) il cliente
   vede l'elenco di chi ha confermato, con **tempo di consegna stimato e prezzo per ciascun
   distributore**, ordinati dal più conveniente.
6. **Riepilogo ordine** — scelto il distributore si arriva subito al riepilogo: consegna o ritiro,
   note, riepilogo articoli, imponibile, IVA e totale. Il pulsante **Invia l'ordine** chiude
   l'ordine con quel distributore.

**Distributore** (banco, telefono)

Due profili operativi richiesti — **AFIS** e **CAMBIELLI** — più BOREA, che resta attivo perché
il confronto lato cliente ne prevede tre.

1. **Richieste** — elenco di quelle da confermare con il tempo che resta, e i contatori del banco
   (da confermare / da preparare / in preparazione).
2. **Risposta riga per riga** — per ogni articolo il banco indica quanti pezzi copre:
   - tutti i pezzi di tutte le righe → **disponibilità totale**;
   - qualche riga ridotta → **disponibilità parziale**, e il cliente vede subito cosa manca;
   - tutto a zero (o pulsante *Rifiuta*) → **rifiuto per indisponibilità merce**.
   Insieme alla conferma il banco dichiara la **partenza ordine stimata** e la **consegna
   stimata**: entrambe arrivano al cliente nella schermata delle offerte. La consegna non può
   precedere la partenza.
3. **Ordini** — quando il cliente sceglie quel banco, l'ordine entra in *Da preparare* →
   *Prendi in preparazione* → *Emetti bolla e segna la merce partita*.
4. **Dati del cliente** — su richiesta e ordine il banco vede l'anagrafica completa
   dell'ordinante: ragione sociale, referente, indirizzo, P. IVA, codice fiscale, SDI/PEC,
   telefono, email e destinazione della merce.

Chi non risponde entro i 10 minuti risulta "non risposta": la non risposta **non** vale come
disponibilità.

## Bolla / DDT

All'emissione l'app assegna un **numero progressivo per distributore e per anno** (es. `1/2026`)
e genera il documento di trasporto **intestato al cliente ordinante**: mittente il banco con la
sua anagrafica, destinatario/intestatario il cliente con P. IVA, C.F., SDI/PEC e indirizzo, luogo
di destinazione della merce, righe con codice/descrizione/U.M./quantità/prezzo, causale del
trasporto, aspetto esteriore dei beni, colli, trasporto a cura di, data e ora di partenza,
totali e spazi per le firme di conducente e destinatario.

La pagina `/ddt/:ordine` è ottimizzata per la stampa (pulsante *Stampa / salva PDF*) e la vedono
il banco che l'ha emessa, il cliente intestatario e l'agente. Il cliente trova il link alla bolla
nel dettaglio del suo ordine.

## Geolocalizzazione in tempo reale (con consenso)

Attiva su **entrambi i profili**, cliente e distributore, e sempre subordinata al consenso
esplicito: finché non si preme *Attiva la posizione in tempo reale* non viene registrata nessuna
coordinata. Dopo il consenso l'app usa `watchPosition` e invia al massimo un aggiornamento ogni
10 secondi.

- **Cliente** — la posizione serve a calcolare la distanza dal banco e a seguire il mezzo in
  consegna.
- **Distributore** — la posizione del banco/mezzo permette al cliente di seguire la consegna:
  si condivide per singolo ordine con *Condividi la posizione del mezzo*.
- **Revoca** — *Disattiva e cancella la posizione* spegne il consenso, cancella davvero le
  coordinate salvate e interrompe le condivisioni attive. Se il permesso viene negato o tolto
  dal browser, il server viene allineato automaticamente.

Il cliente vede la consegna in uno **schema di posizione** (SVG generato in locale, con mezzo,
destinazione e distanza in linea d'aria): non è una mappa stradale e non dipende da servizi
esterni.

**Agente**

Login → lista di tutti gli ordini (cliente, distributore scelto, data, imponibile, totale, stato)
→ dettaglio riga per riga. Vista di sola lettura.

## Prezzi

- Ogni distributore ha un proprio listino con lo **sconto Base per prodotto**: lo stesso articolo
  può costare diversamente da banco a banco.
- Il prezzo mostrato al cliente è `listino − sconto Base` **+ 10%** di servizio, ed è sempre
  accompagnato dalla dicitura **+ IVA**.
- Nel riepilogo dell'ordine imponibile, IVA (22%) e totale sono esposti come voci separate;
  l'eventuale costo di consegna dipende dal distributore.
- Le percentuali sono configurabili nella tabella `config` (`servizio_pct`, `iva_pct`,
  `finestra_conferma_min`) senza toccare il codice.
- Al momento dell'ordine prezzi e sconti vengono "fotografati" nella riga ordine
  (`order_items`), così lo storico resta corretto anche se i listini cambiano.

## Notifiche

Le notifiche sono in-app (campanella in alto a destra) e diventano notifiche di sistema del
telefono se l'utente preme "Attiva le notifiche" e concede il permesso al browser. Non serve
alcun servizio esterno: l'app le recapita quando è aperta in una scheda.

## Struttura

```
server.js         entrypoint Express e rotte
db/schema.sql     schema SQLite
db/index.js       apertura DB e migrazioni leggere
db/seed.js        dati demo (utenti, catalogo, distributori, listini)
src/pricing.js    calcolo prezzi, servizio, IVA
src/catalogo.js   ricerca parziale e macro categorie
src/richieste.js  ciclo di vita richiesta → offerte → ordine (disponibilità totale/parziale)
src/ddt.js        numerazione e dati della bolla / DDT
src/geo.js        posizione con consenso, revoca e distanze
src/notifiche.js  notifiche in-app
src/format.js     date, tempi di consegna, countdown
src/auth.js       middleware di autenticazione/ruolo
views/            pagine EJS (cliente e distributore mobile-first)
public/style.css  stile dell'app
public/app.js     quantità, ricerca live, countdown, notifiche
```

Il database è un singolo file SQLite (`db/minuteria.db`), creato automaticamente al primo avvio.

Vedi anche `SCOPE.md` per l'elenco di cosa c'è oggi e cosa è volutamente fuori.
