# Cosa c'è dentro / cosa è volutamente fuori

Aggiornato al 26/08/2026 (vista cliente mobile con richiesta di disponibilità multi-distributore).

## Dentro (oggi funzionante)

- Login con utenza assegnata manualmente (cliente / distributore / agente), nessuna
  registrazione self-service.
- **Vista cliente in formato telefono**: home con macro categorie merceologiche, ricerca,
  selezione materiale, barra Procedi fissa in fondo, barra di navigazione bassa.
- **Ricerca parziale**: ogni parola digitata viene cercata anche come frammento dentro nome,
  codice e categoria del prodotto (scrivendo `valv` escono tutte le valvole). Parte mentre si
  digita.
- **Richiesta di disponibilità ai distributori**: premendo Procedi la richiesta arriva ai
  rivenditori attivi nella zona del cliente che trattano tutti i prodotti richiesti
  (AFIS SPA, BOREA SRL, CAMBIELLI SPA nei dati demo).
- **Finestra di 10 minuti**: il distributore conferma o dichiara il materiale non disponibile.
  La mancata risposta viene registrata come "non risposta" e **non** vale come disponibilità.
- **Schermata di attesa** con countdown, stato per distributore e notifica all'arrivo delle
  risposte (il cliente può chiudere la schermata).
- **Confronto offerte**: elenco dei distributori che hanno confermato, con tempo di consegna
  stimato e prezzo di ciascuno, ordinati dal più conveniente.
- **Riepilogo ordine** con scelta consegna/ritiro, note, imponibile, IVA e totale; l'ordine viene
  chiuso con il distributore scelto.
- **Prezzi per distributore**: ogni banco ha il proprio listino e sconto Base per prodotto.
- **Prezzo esposto = (listino − sconto Base) + 10%**, sempre con la dicitura "+ IVA" accanto.
- Notifiche in-app per cliente e distributore, promuovibili a notifica di sistema del telefono.
- Vista agente: elenco di tutti gli ordini con cliente, distributore, importi e stato, più il
  dettaglio riga per riga. Sola lettura.
- Isolamento dati: un cliente vede solo i propri ordini, un distributore solo le proprie
  richieste e gli ordini assegnati a lui.

- **Vista distributore completa** (profili AFIS e CAMBIELLI, più BOREA):
  - risposta **riga per riga** con disponibilità totale, parziale o rifiuto per indisponibilità;
  - **partenza ordine stimata** oltre alla consegna stimata, entrambe comunicate al cliente;
  - **anagrafica completa del cliente ordinante** su richiesta e ordine (ragione sociale,
    referente, indirizzo, P. IVA, C.F., SDI/PEC, telefono, email, destinazione merce);
  - flusso ordine **Da preparare → In preparazione → Partito**.
- **Bolla / DDT intestata al cliente**, con numerazione progressiva per distributore e per anno,
  pagina stampabile e link visibile anche al cliente.
- **Geolocalizzazione in tempo reale con consenso esplicito**, su cliente e distributore, con
  revoca che cancella le coordinate; il cliente segue il mezzo in consegna con distanza in linea
  d'aria (schema locale, nessun servizio di mappe esterno).

- **Marchi con listini ufficiali dei produttori**, caricati da Excel con un importatore
  generico (`db/importa_listino.js`). TOSHIBA è il primo: 2388 articoli, 6 famiglie, con EAN,
  contributo RAEE, refrigerante, F-GAS e GWP. La struttura regge quanti marchi si vuole.
- **Contributo RAEE come voce separata** in riepilogo, ordine e bolla: i listini dichiarano i
  prezzi IVA, trasporto e RAEE esclusi.
- **Sconti al banco**: riga per riga, o uno sconto unico applicato a tutte le righe e salvabile
  nell'anagrafica del cliente, oppure accettazione secca al prezzo di richiesta.
- **Geolocalizzazione su mappa** (Leaflet servito in locale, tasselli OpenStreetMap) in tutte le
  schermate che mostrano una posizione.

- **Registrazione self-service del cliente** con tutti i dati di fatturazione, scelta dei
  distributori di riferimento e approvazione da parte del banco prima di poter ordinare.
- **Sconti per ambito** concordati dal banco col singolo cliente: linea di prodotto, marchio,
  categoria merceologica o generale, con precedenza dalla regola più precisa.
- **Punti vendita sulla mappa**: 12 banchi di AFIS, BOREA, CAMBIELLI e FIDRA a Genova, con
  indirizzi dai siti ufficiali e coordinate da Nominatim.
- **Posizione del cliente chiesta all'avvio**, con mappa dei punti vendita più vicini in home.

- **Catalogo per frequenza d'uso**: 14 categorie con sottocategorie, parole chiave e
  misure; home con Raccorderia, Valvolame e Minuteria in evidenza e "Cosa ti serve?" sopra
  la ricerca.
- **Gerarchia categoria → sottocategoria → marchio**: il marchio è un filtro dentro la
  categoria, non il livello principale.
- **Filtro per misura** come primo filtro dell'elenco, marca come filtro secondario.
- **Riordino in un tocco** dei pezzi ordinati più spesso.
- **Riepilogo prima di procedere**: la richiesta parte solo dopo conferma esplicita.
- **Ordine minimo di € 33** di merce più € 10 di spedizione che non fa soglia.
- **Finestra di 5 minuti** per scegliere fra più offerte; scaduta, l'ordine va da solo al
  distributore con la consegna stimata più veloce (partenza dichiarata + tragitto).
- **Centro notifiche raggruppato** per Ordini / Richieste / Approvazioni con sottostati;
  una richiesta confermata diventa un ordine e si sposta nella categoria Ordini.
- **Sconti a scalare su 5 colonne** (40+10+5 = 48,7%) per marchio, categoria e linea.
- **Sessioni su database**: un riavvio del server non scollega più nessuno.
- **Menu account** in alto a destra, con dentro l'uscita.

## Da costruire (prossimi passi)

- **Metodi di pagamento in app** — oggi il riepilogo dice "alle condizioni concordate con il
  distributore"; il metodo vero va definito insieme.
- **Caricamento/aggiornamento catalogo e listini** via CSV o form (oggi catalogo e listini per
  distributore sono seedati a mano in `db/seed.js`).
- **Filiali vere**: oggi il distributore ha un "banco di riferimento" e una zona testuale; la
  gestione a filiali con più banchi per distributore è il passo successivo.
- **Anagrafiche reali**: partite IVA, codici fiscali e indirizzi nel seed sono valori di comodo
  per la demo e vanno sostituiti prima di emettere documenti veri.
- **Sconti reali per marchio e distributore**: oggi l'importatore applica uno sconto Base unico
  (parametro `--sconto`) con una piccola variazione per banco. Vanno caricate le condizioni vere,
  presumibilmente per famiglia di prodotto.
- **Prodotti a sistema**: il listino Toshiba PDF quota anche il prezzo di sistema (interna +
  esterna); in app oggi ogni articolo è a sé.
- **Tasselli della mappa**: si usa il server pubblico di OpenStreetMap, adatto al volume di una
  demo. Per il pilot serve un provider con contratto (o un proxy con cache).
- **Conferma di consegna**: oggi l'ultimo stato è "Partito"; manca la presa in carico firmata
  dal destinatario (lo spazio firma è già in bolla, ma su carta).
- **Il residuo di un ordine parziale**: oggi il cliente rifà la richiesta per ciò che manca,
  non c'è un ordine collegato in attesa.
- **Estrazione dati** per le metriche del pilot (clienti attivi/mese, tempo medio
  richiesta→conferma, tasso di conferma per distributore).

- **Ricerca per foto del pezzo**: richiede un modello di riconoscimento immagini, oggi
  assente. Va deciso se introdurre un servizio esterno.
- **Tempo di percorrenza reale**: la consegna stimata usa la distanza in linea d'aria
  corretta di un fattore strada e una velocità media (config `velocita_media_kmh`). Per il
  tempo vero serve un servizio di routing, con la dipendenza esterna che comporta.
- **Listini di raccorderia, valvolame e minuteria**: sono le categorie in cima alla home
  ma oggi contengono solo i pochi articoli demo. Servono i listini veri.

## Volutamente fuori scope (non va costruito senza deciderlo insieme)

- App nativa iOS/Android (oggi è un'app web pensata per il telefono).
- Notifiche push a telefono spento / service worker: le notifiche arrivano mentre l'app è aperta
  in una scheda del browser.
- Integrazione logistica automatizzata con corrieri esterni.
- Sconti/prezzi personalizzati per singolo cliente (lo sconto preciso resta in fattura).
- Chat in-app, funzionalità social.
- Integrazione realtime col gestionale AS400 del grossista (import batch è compatibile col
  modello dati attuale, ma non è ancora costruito).
- Pagamento online.
- Pannello di gestione utenti (creare/modificare credenziali da interfaccia): per ora si fa a
  mano su `db/seed.js` o direttamente sul DB.

## Scelte di scope già confermate con l'utente

- 27/08/2026 — **La registrazione self-service entra nello scope** (era esclusa): il cliente
  crea l'anagrafica e sono i distributori indicati a verificarla approvandola.
- 27/08/2026 — **La posizione si attiva all'apertura dell'app**, non più solo su pulsante: il
  consenso resta quello del browser e la revoca cancella le coordinate.

- 26/08/2026 — **Disponibilità parziale ammessa**: il banco può confermare meno pezzi di quelli
  richiesti; il cliente vede l'offerta marcata "parziale" con l'elenco di ciò che manca e decide
  se ordinare lo stesso. Le offerte complete precedono quelle parziali nel confronto.
- 26/08/2026 — **Geolocalizzazione solo con consenso esplicito** su entrambi i profili, revocabile,
  con cancellazione effettiva delle coordinate. Nessuna mappa di terze parti.

- 26/08/2026 — **Il +10% ora è dentro ogni prezzo esposto**, non più solo nel totale finale, e i
  prezzi sono sempre IVA esclusa con la dicitura "+ IVA" accanto. Sostituisce la scelta
  precedente (servizio incluso solo nel totale, senza dettaglio).
- 26/08/2026 — **Il confronto tra più distributori è dentro lo scope**: era stato escluso come
  "marketplace multi-grossista", ora è il cuore del flusso cliente.
- 26/08/2026 — **Le notifiche sono dentro lo scope** (erano escluse), nella forma descritta sopra.
- La non risposta del distributore entro i 10 minuti non vale come disponibilità.
- Sconto Base gestito per singolo prodotto e per singolo distributore, non un valore unico.
