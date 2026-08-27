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

## Come è organizzato il catalogo

Le categorie sono ordinate per **frequenza d'uso in cantiere**, non per struttura di
magazzino: chi apre l'app è un professionista che cerca un pezzo in fretta. In home
compaiono per prime **Raccorderia, Valvolame e Minuteria**; il resto sta sotto
"Altre categorie".

La gerarchia è **categoria → sottocategoria → marchio**: il marchio è un filtro
facoltativo dentro la categoria, mai il punto di partenza. Dentro una sottocategoria il
primo filtro è la **misura** (1/2", 16mm, DN25...), estratta dalle descrizioni.

La tassonomia sta in `db/tassonomia.js` (14 categorie con parole chiave e misure) e si
applica al catalogo con:

```
node db/riclassifica.js
```

Va rilanciato dopo ogni import di listino: assegna a ogni articolo categoria,
sottocategoria e misura.

## Ordine minimo e spedizione

Ordine minimo **€ 33** di merce, calcolata sui prezzi già maggiorati del servizio e IVA
esclusa. La **spedizione di € 10** si somma dopo e non concorre a raggiungere la soglia.
Entrambi i valori stanno in `config` (`ordine_minimo`, `spedizione_fissa`).

## Registrazione e approvazione

La pagina di ingresso ha due schede: **Accedi** e **Registrati**.

Chi si registra compila l'anagrafica completa della propria impresa o ditta individuale —
ragione sociale, referente, **partita IVA, codice fiscale, sede legale, CAP, città, provincia,
codice SDI o PEC**, indirizzo di consegna abituale, contatti — e sceglie i **distributori di
riferimento** fra quelli attivi.

Ai banchi scelti arriva la notifica *"Nuova anagrafica da approvare"*. Il distributore apre la
scheda del cliente, vede tutti i dati fiscali e decide: **approva** (indicando il proprio codice
cliente) o **rifiuta** se non lo riconosce. Finché nessuno approva, il cliente può sfogliare il
catalogo ma non inviare richieste; le richieste vanno **solo ai banchi che lo hanno approvato**.

Approvato il cliente, il banco imposta gli **sconti concordati** per ambito:

| Ambito | Esempio | Precedenza |
|---|---|---|
| Linea di prodotto | TOSHIBA · RAS | 1ª (vince) |
| Marchio | TOSHIBA | 2ª |
| Categoria merceologica | Condizionamento | 3ª |
| Generale | tutto il catalogo | 4ª |

Vale sempre la regola più precisa; dove non c'è nessuna regola resta lo sconto Base del listino
del banco. Svuotando un campo la regola sparisce. Questi sconti precompilano il modulo di
risposta, dove il banco può comunque ritoccare riga per riga.

## Punti vendita sulla mappa

`/punti-vendita` mostra i banchi dei distributori su mappa, un colore per insegna, con elenco
per insegna e distanza da te se hai condiviso la posizione. Al momento sono caricati i **12
punti vendita di Genova** di AFIS, BOREA, CAMBIELLI e FIDRA, con indirizzi presi dai siti
ufficiali e coordinate ricavate con Nominatim/OpenStreetMap:

```
node db/geocodifica.js          # geocodifica i punti nuovi
node db/geocodifica.js --tutti  # rigeocodifica tutto
```

Gli indirizzi stanno in `db/punti_vendita.js`: per aggiungere altre città basta estendere
quell'elenco e rilanciare lo script.

## Il flusso, passo per passo

**Cliente** (telefono)

1. **Home** — barra di ricerca e macro categorie merceologiche (Condizionamento, Caldaie e
   scaldacqua, Minuteria e raccorderia).
2. **Ricerca parziale** — basta un frammento di parola: scrivendo `valv` escono tutte le valvole,
   in qualunque categoria. Cerca in nome, codice, categoria, marchio ed EAN, e parte mentre si
   digita. La stessa barra c'è in **ogni elenco di selezione** (categoria, marchio, famiglia) ma
   lì è limitata all'elenco che stai sfogliando: dentro la famiglia RAV cerchi tra i 130 articoli
   RAV, non in tutto il catalogo. Svuotando il campo torna l'elenco paginato di partenza, e tutto
   funziona anche senza JavaScript (la barra è un normale form GET).
3. **Scelta del materiale** — dalla categoria si impostano le quantità e si preme **Procedi**
   (oppure "Aggiungi e continua a scegliere" per pescare da più categorie).
4. **Riepilogo** — "Procedi" non manda niente: mostra prima articoli, quantità, prezzi e
   totale. La richiesta parte solo dopo **Conferma e chiedi disponibilità**.
5. **Attesa** — la richiesta parte verso i distributori della zona del cliente che trattano
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

## Marchi e listini dei produttori

I listini ufficiali dei produttori si caricano da Excel con un importatore generico:

```
node db/importa_listino.js --marchio toshiba --file "listino.xlsx" --sconto 30
```

È idempotente (rilanciarlo aggiorna, non duplica) e per ogni prodotto importa codice,
descrizione, famiglia, EAN, contributo RAEE, refrigerante, F-GAS e GWP. Crea anche le righe
di listino per ogni banco distributore: senza quelle nessuno può confermare il marchio.

Per aggiungere un marchio basta una voce in `MARCHI` dentro `db/importa_listino.js` con la
mappatura delle colonne del suo file: la struttura regge quanti marchi si vuole.

**TOSHIBA** è il primo caricato — listino ufficiale 2026 Rev. 2, distribuito da T-Air Solutions
Italy (Beijer Ref Italy): **2388 articoli** in 6 famiglie (RAS, RAV, VRF, NEXETA, ESTIA, EDEN).
Il cliente lo trova dalla sezione *Marchi* in home: marchio → famiglia → articoli paginati.

> Lo sconto Base applicato dall'importatore (`--sconto`) è un valore di configurazione, non le
> condizioni commerciali reali: va sostituito con gli sconti veri prima di usare i prezzi con i
> clienti.

## Sconti al banco

Nella risposta a una richiesta il distributore può:

- **accettare al prezzo di richiesta** — un pulsante, conferma alle condizioni standard del suo
  listino, quelle che il cliente ha già visto;
- **applicare uno sconto riga per riga** — ogni riga ha il suo campo sconto, il prezzo per il
  cliente si ricalcola mentre lo si scrive;
- **usare lo sconto concordato col cliente** — un campo applica la stessa percentuale a tutte le
  righe e, se lo si spunta, resta nell'anagrafica del cliente e precompila le prossime richieste
  di quel cliente a quel banco.

Le righe con sconto diverso dallo standard restano evidenziate, e il cliente vede il prezzo già
scontato nel confronto offerte.

## Contributo RAEE

I listini dei produttori dichiarano i prezzi IVA, trasporto e RAEE esclusi. Il contributo RAEE
per articolo viene importato insieme al prodotto e compare come **voce separata** nel riepilogo
dell'ordine, nel dettaglio ordine e in bolla.

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

- **Cliente** — la posizione viene chiesta al browser **appena si apre l'app**: la home mostra
  subito la mappa con dove sei e gli otto punti vendita più vicini, con la distanza di ognuno.
  Se il permesso è già stato negato l'app non insiste.
- **Distributore** — la posizione del banco/mezzo permette al cliente di seguire la consegna:
  si condivide per singolo ordine con *Condividi la posizione del mezzo*.
- **Revoca** — *Disattiva e cancella la posizione* spegne il consenso, cancella davvero le
  coordinate salvate e interrompe le condivisioni attive. Se il permesso viene negato o tolto
  dal browser, il server viene allineato automaticamente.

Le posizioni si vedono su **mappa vera** (Leaflet servito dal progetto, tasselli
OpenStreetMap): la propria posizione nel riquadro consenso, il mezzo e la destinazione con la
distanza nella schermata di consegna, la destinazione della merce nella vista ordine del banco.
Leaflet è in `public/vendor/leaflet` e viene caricato solo nelle pagine che hanno una mappa; i
tasselli richiedono la connessione a internet e la mappa degrada a un messaggio se manca.

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
