# Cosa c'è dentro / cosa è volutamente fuori

Aggiornato al 30/09/2026 (sito in produzione su una VPS, app nativa per l'installatore).

## Dentro (oggi funzionante)

**Installatore (sito da telefono e app nativa)**

- Login con utenze assegnate e **registrazione self-service** con tutti i dati di fatturazione e
  la scelta dei distributori di riferimento. L'approvazione del banco esiste come passaggio ma
  **non è applicata**: un cliente non approvato può inviare richieste, che arrivano a tutti i
  distributori attivi (vedi README, "Registrazione e approvazione").
- **Catalogo**: 27.676 prodotti in 13 macro categorie con sottocategorie; varianti raggruppate
  in una card con scelta della misura; **ricerca parziale** in nome, codice, categoria, marchio
  ed EAN, che parte mentre si digita e tollera i refusi (niente chip di filtro, per scelta).
- **Foto prodotto**: vetrina trasversale `/con-foto`, 6.118 prodotti (826 Effebi + 5.292 estratti
  dai listini PDF di Caleffi, Wavin, Grohe, Giacomini, Fischer; Ariston escluso, layout non
  affidabile; RBM in attesa di iscrizione al portale fornitore).
- **Carrello** con **ordine minimo di € 33** di merce e € 10 di spedizione che non fa soglia.
- **Richiesta di disponibilità** a **tutti** i distributori attivi (non filtrata per zona né per
  copertura), una sola aperta per cliente. Finestra di **10 minuti** (configurabile); la mancata
  risposta è "non risposta" e **non** vale come disponibilità.
- **Schermata di attesa** con countdown e stato per banco, notifica a ogni risposta.
- **Confronto offerte** con tempo di consegna stimato e prezzo, dalla più conveniente (le
  complete prima delle parziali). **Disponibilità parziale ammessa**: il cliente vede cosa
  manca e decide se ordinare lo stesso.
- **Finestra per scegliere**: parte alla prima conferma e si allunga a ogni nuova conferma (mai
  si accorcia); scaduta, l'ordine va da solo a chi copre **tutto** il materiale con la consegna
  più veloce (se nessuno copre tutto, vince comunque il più veloce). Dopo 15 minuti di
  tolleranza le offerte decadono senza ordine e si può reinviare la richiesta.
- **Riepilogo ordine** con consegna/ritiro, destinazione, note, imponibile, IVA e totale.
- **Stato ordini** (una sola attività, la più rilevante) e **Storico**; il cliente può annullare
  un ordine solo finché è *Da preparare*, e conferma la consegna.
- **App nativa** (React Native / Expo, `mobile/`): login, catalogo, ricerca, categorie, elementi
  con foto, carrello, richiesta, offerte, ordine, stato ordini e storico. Stesso database e
  stesse regole del sito (`src/flusso_cliente.js`). Solo tema chiaro; categorie e sottocategorie
  si aprono già piene e l'app entra senza aspettare la rete.

**Distributore (banco)**

- Vista completa (AFIS, BOREA, CAMBIELLI, FIDRA): richieste da confermare con il tempo che resta,
  contatori, ordini *Da preparare → In preparazione → Partito*.
- Risposta con due sole azioni: **accetta tutto** al prezzo standard o **rifiuta**. Partenza e
  consegna stimata sono valori fissi (2 e 6 ore) finché non arriva un corriere collegato via API.
- **Anagrafica completa del cliente ordinante** su richiesta e ordine, e **approvazione** delle
  anagrafiche dei nuovi clienti.
- **Sconti per ambito** concordati col singolo cliente (linea di prodotto, marchio, categoria,
  generale; vince la regola più precisa), anche **a scalare** su 5 colonne (40+10+5 = 48,7%).
  Oggi solo come riferimento di lettura quando il banco risponde.
- **Prezzi per distributore**: listino e sconto Base per prodotto e per banco.
- **Bolla / DDT** intestata al cliente, numerazione progressiva per distributore e per anno,
  pagina stampabile, link visibile anche al cliente.

**Agente**

- Elenco di tutti gli ordini con cliente, distributore, importi e stato, e dettaglio riga per
  riga. Sola lettura.

**Trasversale**

- **Prezzo esposto = (listino − sconto Base) + 10%**, sempre IVA esclusa con la dicitura "+ IVA";
  prezzi e sconti "fotografati" nella riga d'ordine. **Contributo RAEE** come voce separata.
- **Notifiche in-app** raggruppate per Ordini / Richieste / Approvazioni con sottostati
  (una richiesta confermata diventa un ordine e passa in Ordini), promuovibili a notifica di
  sistema mentre il sito è aperto.
- **Posizione degli installatori fissa** (Via Puggia 22/3, Genova) e dei banchi del punto vendita: la
  posizione del dispositivo non si raccoglie più (dal 02/10/2026). Le **mappe sono oggi nascoste** via CSS.
- **Isolamento dati**: un cliente vede solo i propri ordini, un distributore solo le proprie
  richieste e gli ordini assegnati a lui.
- **Sessioni su database** (un riavvio non scollega nessuno) e menu account in alto a destra.
- **Produzione su una VPS** (Node, `npm start`), collegata allo stesso Supabase; non più su
  Vercel. Come si aggiorna: README, "Produzione (VPS)".
- **Marchi con listini dei produttori** caricabili da Excel con un importatore generico
  (`db/postgres/importa_listino.js`). Oggi nel DB non ci sono marchi attivi.

## Da costruire (prossimi passi)

**App nativa**
- Notifiche **push** native (tabella dei token di dispositivo, invio da `src/notifiche.js`).
- Registrazione in app (oggi rimanda al sito) e **cancellazione dell'account** dall'app, richiesta
  da Apple; privacy policy pubblicata, anche per la posizione.
- Versione "leggera" per il **banco**: push, accetta/rifiuta, elenco ordini con cambio stato.
- Build per i clienti pilota (TestFlight / test interno di Google Play), con `EXPO_PUBLIC_API_URL`
  su un indirizzo **HTTPS**: le build bloccano il traffico `http://` verso un IP.
- **Logo e splash** dell'app: `icon.png` e `splash-icon.png` sono ancora i segnaposto di Expo.

**Produzione (VPS)**
- Un servizio (systemd o pm2) che tenga acceso il processo e lo riavvii da solo, invece di
  `npm start` a mano (se non è già stato messo).
- **HTTPS con un dominio** davanti al sito (reverse proxy con certificato): necessario anche per
  l'app compilata.
- **Utenti demo**: le password sono note (README) e `npm run seed` le riscrive; vanno cambiate o
  tolte prima di far provare il sito ai clienti pilota.

**Sito e dati**
- **Metodi di pagamento in app** — oggi il riepilogo dice "alle condizioni concordate con il
  distributore"; il metodo vero va definito insieme.
- **Caricamento del catalogo e dei listini da interfaccia** (CSV o form): oggi si fa con script.
- **Filiali vere**: oggi il distributore ha un "banco di riferimento" e una zona testuale; la
  gestione a filiali con più banchi per distributore è il passo successivo.
- **Anagrafiche reali**: partite IVA, codici fiscali e indirizzi del seed sono valori di comodo e
  vanno sostituiti prima di emettere documenti veri.
- **Sconti reali per marchio e distributore**: oggi l'importatore applica uno sconto Base unico
  (`--sconto`) con una piccola variazione per banco. Vanno caricate le condizioni vere.
- **Punti vendita**: la tabella è vuota e lo script di caricamento
  (`db/postgres/geocodifica.js`) ha il percorso di `punti_vendita` sbagliato (vedi README).
- **Stima di consegna senza posizione del cliente**: `minutiStimati()` in `src/consegna.js`
  ignora la consegna dichiarata dal banco e mostra solo la partenza (vedi
  `AUDIT_DISTRIBUTORE.md`); serve decidere il comportamento giusto.
- **Tasselli della mappa**: si usa il server pubblico di OpenStreetMap, adatto a una demo. Per il
  pilot serve un provider con contratto o un proxy con cache (quando le mappe torneranno visibili).
- **Presa in carico firmata**: il cliente segna "Ordine consegnato", ma manca la conferma firmata
  dal destinatario (lo spazio firma è già in bolla, ma su carta).
- **Il residuo di un ordine parziale**: oggi il cliente rifà la richiesta per ciò che manca, non
  c'è un ordine collegato in attesa.
- **Estrazione dati** per le metriche del pilot (clienti attivi/mese, tempo medio
  richiesta→conferma, tasso di conferma per distributore).
- **Ricerca per foto del pezzo**: richiede un modello di riconoscimento immagini; va deciso se
  introdurre un servizio esterno.
- **Tempo di percorrenza reale**: la consegna stimata usa la distanza in linea d'aria corretta
  di un fattore strada e una velocità media (`velocita_media_kmh`); per il tempo vero serve un
  servizio di routing, con la dipendenza esterna che comporta.

## Volutamente fuori scope (non va costruito senza deciderlo insieme)

- Notifiche push sul **sito** (service worker): sul sito le notifiche arrivano solo mentre è
  aperto in una scheda; a telefono spento è compito dell'app nativa.
- Integrazione logistica automatizzata con corrieri esterni.
- Sconti/prezzi personalizzati per singolo cliente (lo sconto preciso resta in fattura).
- Chat in-app, funzionalità social.
- Integrazione realtime col gestionale AS400 del grossista (l'import batch è compatibile col
  modello dati attuale, ma non è costruito).
- Pagamento online.
- Pannello di gestione utenti (creare/modificare credenziali da interfaccia): per ora a mano su
  `db/seed.js` o direttamente sul DB.

## Scelte di scope già confermate con l'utente

- 02/10/2026 — **Il corriere prende la consegna su WhatsApp prima dell'offerta**: quando il banco accetta,
  nel gruppo parte il messaggio con prelievo e consegna; l'installatore vede la conferma solo se qualcuno
  risponde "preso <minuti totali>" entro il timer, e quel tempo è il tempo di consegna. Se il timer scade, il
  messaggio si cancella dal gruppo e per l'installatore nessun banco ha accettato.
- 02/10/2026 — **Tutti gli installatori in Via Puggia 22/3** e **niente più posizione del dispositivo**.
- 02/10/2026 — **Anche il sito ha solo il tema chiaro**: tolti modalità scura e interruttore.
- 29/09/2026 — **Il sito passa da Vercel a una VPS**, con lo stesso Supabase.
- 29/09/2026 — **L'app ha solo il tema chiaro**: niente modalità scura e niente interruttore.
- 29/09/2026 — **L'app usa lo stesso database del sito** (Supabase di produzione): niente DB di
  test separato.
- 26/09/2026 — **App nativa in React Native (Expo)**, con **prima solo l'installatore**; il banco
  in versione ridotta viene dopo, l'agente resta sul sito.
- 23/09/2026 — **L'app nativa entra nello scope** (era esclusa) e **senza WebView**.
- 27/08/2026 — **La registrazione self-service entra nello scope** (era esclusa): il cliente
  crea l'anagrafica e sono i distributori indicati a verificarla approvandola.
- 27/08/2026 — **La posizione si attiva all'apertura dell'app**, non più solo su pulsante: il
  consenso resta quello del browser e la revoca cancella le coordinate.
- 26/08/2026 — **Disponibilità parziale ammessa**: il banco può confermare meno pezzi di quelli
  richiesti; il cliente vede l'offerta marcata "parziale" con l'elenco di ciò che manca.
- 26/08/2026 — **Geolocalizzazione solo con consenso esplicito** su entrambi i profili,
  revocabile, con cancellazione effettiva delle coordinate. Nessuna mappa di terze parti.
- 26/08/2026 — **Il +10% è dentro ogni prezzo esposto**, non più solo nel totale finale, e i
  prezzi sono sempre IVA esclusa con "+ IVA" accanto.
- 26/08/2026 — **Il confronto tra più distributori è dentro lo scope** (era escluso come
  "marketplace multi-grossista"): ora è il cuore del flusso cliente.
- 26/08/2026 — **Le notifiche sono dentro lo scope** (erano escluse), nella forma descritta sopra.
- La non risposta del distributore entro i 10 minuti non vale come disponibilità.
- Sconto Base gestito per singolo prodotto e per singolo distributore, non un valore unico.
