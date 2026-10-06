# Cosa c'è dentro / cosa è volutamente fuori

Aggiornato al 04/10/2026 (sito in produzione su una VPS, app nativa per l'installatore).

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
- **Carrello** con **ordine minimo di € 33** di merce e € 10 di spedizione che non fa soglia;
  destinazione e note si scrivono qui, il riepilogo con il totale da pagare è in fondo.
- **Pagamento alla richiesta** (dal 04/10/2026): l'installatore paga quando la manda. **Simulato**,
  senza provider; rimborsato se la richiesta si chiude senza ordine.
- **Richiesta di disponibilità** a **tutti** i distributori attivi (non filtrata per zona né per
  copertura), una sola aperta per cliente. Finestra di **10 minuti** (configurabile); la mancata
  risposta è "non risposta" e **non** vale come disponibilità. Schermata di attesa con countdown e
  stato per banco.
- **Ordine automatico**: nessuna scelta dell'offerta e nessun "Invia l'ordine". Il banco accetta,
  nel **gruppo WhatsApp dei corrieri** parte il messaggio con prelievo e consegna, e l'ordine nasce
  quando qualcuno risponde "preso <minuti>": quel tempo è il tempo di consegna. Se nessuno risponde
  la richiesta si chiude, il messaggio sparisce dal gruppo e il pagamento torna. Consegna sempre con
  il corriere (niente ritiro al banco).
- **Stato ordini** (una sola attività, la più rilevante, con l'icona della barra in basso che segue
  la fase) e **Storico**; il cliente conferma la consegna. Per ora può ancora annullare un ordine
  finché è *Da preparare* (rimborso): lasciato per la fase di prova.
- **App nativa** (React Native / Expo, `mobile/`): login, catalogo, ricerca, categorie, elementi
  con foto, carrello con pagamento simulato, richiesta, ordine, stato ordini e storico. Stesso
  database e stesse regole del sito (`src/flusso_cliente.js`). Solo tema chiaro; categorie e
  sottocategorie si aprono già piene e l'app entra senza aspettare la rete.

**Distributore (banco)**

- Vista completa: richieste da confermare con il tempo che resta, contatori, ordini
  *Da preparare → In preparazione → Partito*. Il banco vede l'ordine già pagato.
- Risposta con due sole azioni: **accetta tutto** al prezzo standard o **rifiuta**. Partenza e
  consegna stimata sono valori fissi (2 e 6 ore): con il gruppo WhatsApp acceso vale il tempo
  scritto dal corriere. Oggi l'unico banco attivo è **Borea** (filiali Fegino e Staglieno).
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
- **HTTPS con un dominio** davanti al sito (reverse proxy con certificato): necessario anche per
  l'app compilata.
- **Utenti demo**: le password sono note (README) e `npm run seed` le riscrive; vanno cambiate o
  tolte prima di far provare il sito ai clienti pilota.

**Sito e dati**
- **Pagamento online vero** — dal 04/10/2026 l'installatore paga quando manda la richiesta e l'ordine
  nasce da solo (nessuna scelta dell'offerta), ma il pagamento è **simulato** (`src/pagamenti.js`): manca
  il provider (incasso all'invio, rimborso se la richiesta si chiude senza ordine), e va deciso come
  trattare la differenza fra importo pagato e totale dell'ordine (spedizione fissa del carrello contro
  `costo_consegna` del banco, oggi 0 per Borea).
- **Caricamento del catalogo e dei listini da interfaccia** (CSV o form): oggi si fa con script.
- **Responsabile di ditta**: le filiali Borea esistono (una ditta, più filiali, più dipendenti), ma
  manca un ruolo che veda gli ordini di tutte le filiali.
- **Anagrafiche reali**: partite IVA, codici fiscali e indirizzi del seed sono valori di comodo e
  vanno sostituiti prima di emettere documenti veri.
- **Sconti reali per marchio e distributore**: oggi l'importatore applica uno sconto Base unico
  (`--sconto`) con una piccola variazione per banco. Vanno caricate le condizioni vere.
- **Punti vendita degli altri banchi**: `store_locations` ha solo le due filiali Borea e lo script di
  caricamento (`db/postgres/geocodifica.js`) ha il percorso di `punti_vendita` sbagliato (vedi README).
- **Stima di consegna senza posizione del cliente**: `minutiStimati()` in `src/consegna.js`
  ignora la consegna dichiarata dal banco e mostra solo la partenza (vedi
  `AUDIT_DISTRIBUTORE.md`); serve decidere il comportamento giusto.
- **Tasselli della mappa**: si usa il server pubblico di OpenStreetMap, adatto a una demo. Per il
  pilot serve un provider con contratto o un proxy con cache (quando le mappe torneranno visibili).
- **Presa in carico firmata**: il cliente segna "Ordine consegnato", ma manca la conferma firmata
  dal destinatario (lo spazio firma è già in bolla, ma su carta).
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
- Pannello di gestione utenti (creare/modificare credenziali da interfaccia): per ora a mano su
  `db/seed.js` o direttamente sul DB.

## Scelte di scope già confermate con l'utente

- 04/10/2026 — **L'installatore paga alla richiesta e non sceglie più l'offerta**: paga (per ora in
  simulazione), il banco accetta, il corriere prende la consegna su WhatsApp ("preso <minuti totali>") e
  l'ordine nasce da solo con quel tempo. Tolti il ritiro al banco, il confronto fra offerte, la finestra di
  scelta e "Invia l'ordine". Dopo il "preso" il bot non scrive più nel gruppo. L'annullo dell'ordine da
  parte dell'installatore resta solo per la fase di prova. Il **banco** continua a vedere la richiesta e ad
  accettare o rifiutare.
- 02/10/2026 — **Tutti gli installatori in Via Puggia 22/3** e **niente più posizione del dispositivo**
  (sostituisce le scelte di agosto sulla geolocalizzazione con consenso).
- **Solo tema chiaro**, su app (29/09/2026) e sito (02/10/2026): niente modalità scura né interruttore.
- 29/09/2026 — **Il sito passa da Vercel a una VPS**, con lo stesso Supabase; **l'app usa lo stesso
  database del sito**: niente DB di test separato.
- 23-26/09/2026 — **App nativa in React Native (Expo), senza WebView**: prima solo l'installatore, il
  banco in versione ridotta dopo, l'agente resta sul sito.
- 27/08/2026 — **La registrazione self-service entra nello scope**: il cliente crea l'anagrafica e sono i
  distributori indicati a verificarla approvandola.
- 26/08/2026 — **Il +10% è dentro ogni prezzo esposto**, sempre IVA esclusa con "+ IVA" accanto; **le
  notifiche sono dentro lo scope**, nella forma descritta sopra.
- La non risposta del distributore entro i 10 minuti non vale come disponibilità.
- Sconto Base gestito per singolo prodotto e per singolo distributore, non un valore unico.
