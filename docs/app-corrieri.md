# App dei corrieri

Richiesta del 06/11/2026: «devo creare un'interfaccia mobile, con React Native, per i corrieri; quest'app sostituirà in seguito WhatsApp: le richieste ai corrieri verranno inviate qui e le conferme verranno prese da quest'app. L'app sarà solo mobile, si accede sempre dalla solita schermata di login, ma la schermata si spezza in due: la prima (che c'è già) per gli installatori, la seconda per i corrieri. Questa schermata di login ci sarà solo nell'app mobile: se fai login da installatore con un corriere dirà "utente non registrato", e viceversa. Più avanti ci sarà anche un supervisore dei corrieri.»

Stesso giorno, seconda parte: le schermate di lavoro, in quattro schede (**Richieste · In corso · Storico · Profilo**): la home «Richieste» con l'interruttore «Sei disponibile» e le schede delle richieste, il «Dettaglio richiesta» con «Accetta richiesta», «In corso» in due fasi («Vai al ritiro», «Vai al cantiere») e «Consegna completata». Poi il cambio di rotta: **due ambienti separati** (vedi sotto e [ambienti.md](ambienti.md)).

**Stato (06/11/2026):** fatti il database, l'accesso e la registrazione del corriere, **le schermate di lavoro e l'API** (richieste, accettazione, ritiro, consegna, riepilogo, notifiche). Provati in locale: test automatici, il giro completo su un Postgres vero e le schermate nell'anteprima web contro l'API vera. **Non provato su un telefono** (posizione, Maps, telefonate, notifiche push, vedi «Da fare / punti aperti»). Funziona **solo nell'ambiente «app»** (`CORRIERI_APP=1`); nell'ambiente «reale» i corrieri restano nel gruppo WhatsApp ([whatsapp.md](whatsapp.md)) e le rotte dei corrieri rispondono 404. Le due strade **non convivono** nella stessa installazione: con `CORRIERI_APP=1` e `WHATSAPP_ATTIVO=1` insieme il server non parte.

## I due ambienti (cambio di rotta del 06/11/2026)

Lo stesso codice gira in due installazioni, ognuna col suo `.env` e il suo database: **«reale»** (sito + gruppo WhatsApp dei corrieri + banco sul sito) e **«app»** (app degli installatori + app dei corrieri + banco sul sito). Non c'è una colonna «origine» né una scelta per singola richiesta: il modo lo decide l'installazione (`src/logica/ordini/modalita_corrieri.js`). Come si prepara l'ambiente «app», cosa si copia dal reale, le regole da non rompere e come si prova in locale: **[ambienti.md](ambienti.md)**.

## Scelte esplicite dell'utente (non cambiarle senza chiedere)

- **«Ho ritirato il materiale»** scrive `orders.ritirato_il` e porta l'ordine del banco da «Da preparare» a «In consegna» (come «Preparato»).
- **La posizione del corriere è obbligatoria e si rileva da sola**: una lettura quando serve, nessun tracciamento in continuo, nessun indirizzo scritto a mano. Senza permesso la home dice «Serve la tua posizione» (pulsante «Attiva la posizione») e non si può accettare. Se la lettura nuova non riesce, il telefono può dare l'ultima posizione che conosce, non più vecchia di 3 minuti. Il server non la salva: la usa per calcolare minuti e km fino al banco.
- **Nessuna approvazione del corriere**: la registrazione è pubblica e dà accesso subito. **Nessun interruttore di sicurezza.**
- **Una consegna alla volta per corriere**; **il primo che accetta vince**.
- **«Consegna confermata» è un tocco solo**, senza foto né codici.

## Il ciclo di una consegna

| Passo | Cosa succede | Dove |
|---|---|---|
| Il banco conferma | La risposta del banco (`request_responses`: `esito = 'confermato'`, `corriere_stato = 'in_attesa'`) **è la «richiesta» del corriere** (l'id che l'app usa è quello della risposta). Si scrivono i km banco → cantiere (`consegna_km`). A tutti i corrieri disponibili e liberi arriva la notifica «Nuova richiesta di consegna». La finestra e il rimborso se nessuno accetta sono quelli di sempre (timer delle scadenze) | `richieste.rispondi` → `corrieri/avvisi.js` |
| Il corriere accetta | `richieste.corriereAccetta`: atomica (blocco sull'utente, `UPDATE` condizionale). Scrive `corriere_id`, nome, minuti e km fino al banco; fa nascere l'ordine (`orders.corriere_id`) e avvisa banco e installatore come con WhatsApp. Due accettazioni dello stesso corriere in contemporanea: la seconda trova la prima. Ripetere la stessa accettazione dà lo stesso esito | `corrieri/consegne.accetta` |
| Fase 1 «Vai al ritiro» | Indirizzo del banco, orari, telefono, mappa; tempo e km dalla posizione | `consegne.inCorso` |
| «Ho ritirato il materiale» | `orders.ritirato_il = NOW()`; l'ordine del banco passa a «In consegna»; installatore e banco sono avvisati | `consegne.segnaRitirato` |
| Fase 2 «Vai al cantiere» | Indirizzo del cantiere, nota, telefono dell'installatore | `consegne.inCorso` |
| «Consegna completata» | Stessa scrittura del «consegnato» di WhatsApp (`flusso_cliente.segnaConsegnatoDalCorriere`); solo dopo il ritiro. Riepilogo con orari e tempi | `consegne.segnaConsegnato`, `consegne.riepilogo` |

Tutto il codice del corriere sta in `src/logica/corrieri/` (`consegne.js`, `avvisi.js`); i pezzi condivisi con WhatsApp sono stati spostati in `src/logica/ordini/tappe.js` (`datiRitiro`, `datiConsegna`, `pulisciTelefono`: dove si ritira e dove si consegna), che ora usano tutti e due. `richieste.corriereAccetta` e `richieste.corriereHaPreso` finiscono nella stessa `ordineDaPreso`. Se il banco elimina l'ordine o la richiesta, il corriere vede «Questa consegna non c'è più».

## L'API di lavoro (`/api/v1/corrieri/…`, `src/routes/api_v1/corrieri_consegne.js`)

Solo nell'ambiente «app» (altrimenti 404). Token del corriere (`richiedeCorriere`). La posizione arriva a ogni chiamata che ne ha bisogno: `?lat=&lng=` nelle letture, `lat` e `lng` nel corpo nelle scritture.

| Rotta | Cosa fa |
|---|---|
| `GET` / `PUT /disponibilita` | «Sei disponibile» (letto dal database). `PUT {disponibile: true\|false}`. L'uscita dall'app (`/logout`) lo spegne |
| `GET /richieste` | La home: `{disponibile, in_corso, richieste}`, dalla più vicina. Con una consegna in corso, o da spento, l'elenco è vuoto e dice perché |
| `GET /richieste/:id` | Il dettaglio. 410 con codice `gia_accettata` (un altro corriere), `scaduta` o `tua` (l'ha già presa lui) |
| `POST /richieste/:id/accetta` | `{lat, lng}` obbligatori (400 `posizione_mancante`). 409 `gia_in_consegna`. Risposta `{ok, ordine_id}` |
| `GET /in-corso` | `{consegna}` con la fase (1 o 2); `{consegna: null}` se non ne ha; `{consegna: null, in_preparazione: true}` nell'istante fra l'accettazione e la nascita dell'ordine |
| `POST /consegne/:id/ritirato` | Fase 2 e ordine del banco «In consegna» |
| `POST /consegne/:id/consegnato` | 409 `non_ritirato` / `gia_consegnata`; risposta `{ok, riepilogo}` |
| `GET /consegne/:id/riepilogo` | Il riepilogo (409 `non_consegnata` se non è finita) |
| `POST` / `DELETE /dispositivi` | Il telefono comunica (o toglie) il token push |

Gli errori «previsti» sono `{errore: "testo", codice: "…"}`: 400 `posizione_mancante` / `dato_non_valido`; 404 `non_trovata` / `ordine_non_trovato`; 409 `non_disponibile`; 503 `tragitto_non_calcolabile` (oltre ai codici nella tabella). L'accesso e la registrazione (`/registrati`, `/accedi`, `/me`, `/password-dimenticata`) stanno in `corrieri.js` (sezione sotto) e sono dietro lo stesso interruttore.

## Le schermate (`mobile/src/app/corriere/`)

L'area del corriere ha quattro schede e, sopra, il dettaglio di una richiesta e la «Consegna completata»; la posizione del telefono vive nel layout dell'area, così tutte le schermate leggono la stessa. Font **Manrope** (`@expo-google-fonts/manrope`, caricato in `_layout.tsx`), giallo `#FFCC00` come colore del corriere (`src/corriere/tema.ts`).

- **Richieste** (`(tab)/index.tsx`): interruttore «Sei disponibile», le schede (ditta e zona del ritiro, zona della consegna, tempo e km totali; la più vicina per prima), avviso «Serve la tua posizione», campanello che spiega come funzionano le notifiche.
- **Dettaglio richiesta** (`richiesta/[id].tsx`): le due tappe, «Accetta richiesta». Se nel frattempo un altro corriere l'ha presa: «Richiesta già presa» / «Richiesta non più disponibile» con «Torna alle richieste».
- **In corso** (`(tab)/in-corso.tsx`): fase 1 «Vai al ritiro» (banco, apertura di Maps e della chiamata, «Ho ritirato il materiale») e fase 2 «Vai al cantiere» («Consegna completata»). Se il banco ha annullato: «Questa consegna non c'è più».
- **Consegna completata** (`completata/[id].tsx`): riepilogo con orari e tempi.
- **Storico**: **segnaposto** («Lo storico arriva presto»); il riepilogo di ogni consegna si vede subito dopo averla conclusa.
- **Profilo** (`(tab)/profilo.tsx`): nome, email, interruttore degli avvisi sul telefono, «Esci» (che spegne «Sei disponibile»). Cambio password e dati non ci sono ancora.
- Aiuti in `mobile/src/corriere/`: `dati.ts` (letture e azioni con react-query; **le chiavi della cache cominciano tutte per `'corriere'`**: una notifica con l'app aperta le rilegge in blocco), `posizione.tsx` (permesso, lettura, ultima posizione nota), `tema.ts`, `tipi.ts`, `ui.tsx`. Le due letture «vive» (richieste e consegna in corso) le tiene aggiornate solo il layout delle schede: elenco ogni 8 s (20 s se la scheda non è in primo piano), consegna in corso ogni 15 s (30 s), ogni 2 s nell'istante fra l'accettazione e la nascita dell'ordine.
- Nuove dipendenze: `expo-location` (solo con l'app aperta, nessun permesso in background: il testo del permesso sta in `app.json`) e `@expo-google-fonts/manrope`.

## Notifiche ai corrieri

Quando un banco conferma, `corrieri/avvisi.js` manda «Nuova richiesta di consegna» a ogni corriere **attivo, con «Sei disponibile» acceso e senza una consegna già in corso**, con il link `/corriere/richieste/<id>` (nessuna riga in `notifications`: sono dell'installatore e del banco). Il telefono si registra su `POST /corrieri/dispositivi` (`mobile/src/notifiche.ts`: `useNotifichePush(utenteId, ruolo)`, canale Android «Richieste di consegna» giallo); toccare la notifica apre il dettaglio (`apriDaLink` con ruolo `corriere`, `/corriere/richiesta/[id]`). **Il server ha un'altra funzione, `push.destinazioneApp`, che conosce solo i link degli installatori: non usarla per quelli dei corrieri.** L'invio passa dal servizio Expo come per gli installatori (`PUSH_ATTIVO=0` lo spegne); servono la tabella `dispositivi_push` (nel `db/schema.sql`: sul database nuovo dell'ambiente «app» c'è, su quello condiviso del reale no) e la build con Firebase ([mobile/ANDROID.md](../mobile/ANDROID.md)).

## Ruoli e legami (blocco «App dei corrieri: ruoli e legami» in `db/schema.sql`)

- **`users.ruolo`** ammette anche `corriere` e `supervisore_corrieri` (vincolo `users_ruolo_check`). Il nome lungo è voluto: `supervisore` da solo si confonderebbe con i dipendenti del banco (`distributore`) e con l'`agente`. Il supervisore è già ammesso, ma **nessun supervisore esiste ancora** e nessun codice lo usa.
- **`users.supervisore_id`** (FK su `users`, NULL = nessun supervisore) lega un corriere al suo supervisore, come `distributor_id` lega un dipendente alla sua filiale. Un supervisore con corrieri collegati non si cancella (la FK lo impedisce); non c'è un controllo che `supervisore_id` punti davvero a un `supervisore_corrieri`: lo fa `scripts/db/crea_utente_corriere.js` alla creazione, il codice che lo cambierà dovrà farlo da sé.
- **`request_responses.corriere_id`** e **`orders.corriere_id`** (FK su `users`, NULL = consegna presa su WhatsApp o di prima) dicono *quale account* ha preso la consegna; `corriere_nome` resta (è il nome che si legge nel gruppo e nelle schermate di installatore e banco). Dal 06/11/2026 li scrive l'app: `richieste.corriereAccetta` sulla risposta del banco, `flusso_cliente.creaOrdineDaRisposta` sull'ordine (con `corriere_id` il banco legge anche «Il corriere {nome} ritira alle…»), e `reinviaRichiesta` li azzera insieme a `corriere_stato`, `corriere_nome`… quando la richiesta torna in attesa (solo con `CORRIERI_APP=1`: nel reale la colonna `corriere_id` esiste ma il codice di WhatsApp non la tocca).
- Il blocco è additivo (colonne nullabili, vincolo allargato): non cambia nessun dato, si può rilanciare, e il vecchio codice del sito/VPS non se ne accorge. È **già sul database condiviso** dal 06/11/2026.

## Colonne dell'ambiente «app» (blocco «App dei corrieri: disponibilità, tragitto e ritiro»)

In fondo a `db/schema.sql`, **non applicato al database condiviso** (il reale non ne ha bisogno; lo schema completo lo applica al database nuovo dell'ambiente «app»): `users.corriere_disponibile` (1 = «Sei disponibile», 0 = no; parte da 0), `request_responses.consegna_km` (km banco → cantiere, scritti quando il banco conferma) e `corriere_km` (km dalla posizione del corriere al banco, scritti quando accetta), `orders.ritirato_il` (TIMESTAMPTZ, NULL = non ancora ritirato). Il codice le legge e le scrive **solo con `CORRIERI_APP=1`**. Per applicarlo al reale (se e quando): [ambienti.md](ambienti.md), «Passare l'ambiente reale all'app».

## Accesso e registrazione (06/11/2026, richiesta «solo nell'app nativa»)

**Regola ferrea: queste schermate esistono SOLO nell'app (`mobile/`).** Il sito (`views/auth/login.ejs`, `registrati.ejs`, la landing) non cambia: niente selettore, niente pagine né rotte web per i corrieri (provato da `test/sito/corrieri_sito.test.js`: `/login` e `/registrati` non nominano i corrieri e `/corriere`, `/corrieri`, `/accesso-corriere`, `/registrati-corriere`, `/corrieri/accedi` danno 404).

- **Identità: l'email.** Il corriere non ha un nome utente: `users.username` = email in minuscolo (la colonna è già `NOT NULL UNIQUE`, quindi l'email è unica anche con due registrazioni insieme: la seconda dà 23505 e l'API risponde «Questa email è già registrata.»). Nome e cognome stanno in `users.nome`/`cognome`, `ragione_sociale` = «Nome Cognome». Nessun telefono, partita IVA o indirizzo.
- **API** (`src/routes/api_v1/corrieri.js`, logica in `src/logica/account/corrieri.js`, stesso token `app_tokens` e stessi limiti di tentativi dell'installatore; **tutta dietro `CORRIERI_APP=1`**, altrimenti 404):
  - `POST /api/v1/corrieri/registrati` `{nome, cognome, email, password}` → `{token, utente}`; con dati sbagliati 400 e `errori: [{testo, campi}]` (nome/cognome mancanti, email mancante, non valida o già usata, password sotto gli 8 caratteri).
  - `POST /api/v1/corrieri/accedi` `{email, password}` → `{token, utente}`. Credenziali sbagliate o email sconosciuta: **401 «Credenziali non valide.»** (lo stesso messaggio dell'installatore). Se la password è giusta ma l'account è di un altro ruolo: **403 «Questo account non è un account corriere»**; di proposito *dopo* il controllo della password, così il messaggio non rivela a un estraneo se un'email esiste.
  - `GET /api/v1/corrieri/me` (solo ruolo `corriere`: 401 senza token, 403 con quello di un installatore) e `POST /api/v1/corrieri/password-dimenticata` `{email}` (risponde sempre `{ok: true}`, che l'email esista o no).
  - L'uscita è la `/logout` comune (non controlla il ruolo; per un corriere spegne anche «Sei disponibile»). `/api/v1/login` dell'installatore dice «Questo account non è un account installatore» a chi ha un account corriere o supervisore.
- **Il sito rifiuta i corrieri** (in tutti e due gli ambienti): `POST /login` (`src/routes/autenticazione.js`), dopo la password giusta e senza creare la sessione, risponde 403 con «Gli account corriere si usano dall'app.» per i ruoli `corriere` e `supervisore_corrieri` (`eSoloApp` in `corrieri.js`). Anche il supervisore è solo-app: la sua app non c'è ancora.
- **Password dimenticata**: dall'app, con lo stesso recupero degli installatori (tabella `recupero_password`, email con il link). `recupero_password.richiedi(email, {ruolo: 'corriere'})` cerca tra i corrieri; dal sito il recupero cerca solo installatori (`ruolo = 'cliente'` di default). **Limite noto**: il link nell'email apre la pagina *web* di nuova password (la stessa, che accetta anche i codici dei corrieri); a cambio fatto il corriere vede «Password cambiata…» sul sito e deve tornare nell'app.
- **Schermate** (`mobile/src/app/`): `login.tsx` (l'accesso è **una schermata sola** con due metà larghe quanto lo schermo, `PannelloInstallatore` e `PannelloCorriere` in `componenti/`, che **scorrono in 280 ms** con il selettore; la metà fuori vista non si tocca né si legge: `PannelloAcc`; il corriere **non ha** la riga «Non hai un account? Registrati come corriere», c'è solo «Registrati» nell'interruttore Accedi/Registrati), `registrati-corriere.tsx` (una schermata sola: Nome e Cognome affiancati, Email, Password con nota «Almeno 8 caratteri.», barra fissa «Crea l'account»; nessun passo né «ripeti password»). `_layout.tsx`: `(schede)`, `profilo` e `orari` solo per `ruolo === 'cliente'`, l'area `corriere` solo per i corrieri, `login` e le due registrazioni solo senza account. (La schermata provvisoria `corriere.tsx` e la rotta `accesso-corriere.tsx` sono state sostituite dall'area `corriere/`.)
- **Selettore «Installatore | Corriere»** (`componenti/SelettoreProfilo.tsx`) in cima ad accesso e registrazione: l'indicatore bianco scivola da una voce all'altra. **Nell'accesso** un tocco cambia solo il profilo (le due metà scorrono); **nella registrazione** un tocco NON continua la registrazione dell'altro tipo: apre l'accesso (`router.replace('/login')`) dell'altro profilo, da cui si sceglie Accedi o Registrati. La scelta è ricordata in AsyncStorage (`profilo_accesso`, `profiloAccesso.ts`, un piccolo negozio **sincrono** e non uno stato React: il selettore scrive e naviga nello stesso istante, con uno stato la schermata nuova leggerebbe ancora il valore vecchio e rimanderebbe indietro). `login.tsx` parte dalla metà del profilo ricordato; un accesso riuscito imposta il profilo del suo ruolo, quindi chi esce ritrova la sua schermata.
- **Colori** (`tema.tsx`, `TEMI_ACCESSO` + `TemaAccessoProvider`/`useTemaAccesso`, usati da `PulsanteAcc`, `AvvisoAcc` e `Campo`): installatore blu `#245A8F` (scuro `#1A4468`, chiaro `#E3EDF7`, testo sul pulsante bianco); corriere giallo `#FFCC00` (scuro `#E6B800`, alone del campo attivo `#FFF4CC`, testo sul pulsante `#1C1917`, link e occhiello `#7A5C00`, ombra dell'icona `rgba(204,163,0,0.35)`, icona attiva del selettore `#C99A00`). Tutto il resto è identico. **`Campo` mostra il bordo e un alone da 3 px sul campo attivo anche per l'installatore** (nel colore del suo tema).
- **Sessione** (`sessione.tsx`): `entraCorriere`, `registraCorriere`; all'avvio `leggiMe(ruolo)` legge `/corrieri/me` o `/me` secondo il ruolo salvato. **Le notifiche push partono per l'installatore e per il corriere**, ognuno sulla sua API (vedi «Notifiche ai corrieri»).

## L'utente corriere

- Creato sul DB condiviso il 06/11/2026: **`#421`, nome utente `corriere`**, ragione sociale «Corriere di prova». **Non ha un'email, quindi non può entrare con l'accesso dell'app** (che chiede l'email) né da nessun'altra parte: nel database condiviso (il reale) non serve a niente e si può cancellare. Nell'ambiente «app» i corrieri si registrano dall'app con la loro email. Password **casuale**, in `backup/credenziali_corriere.txt` (fuori da git; non è mai stata scritta nei log né in chat). Niente password di comodo del tipo `corriere123` come nel seed: il DB è quello di produzione e raggiungibile da `/api/v1/login`. Non è nel `db/seed.js` per lo stesso motivo (il seed riscrive le password demo).
- **`scripts/db/crea_utente_corriere.js`** crea corrieri e supervisori (default: l'utente di prova). Prova a secco senza `--applica`; si può rilanciare (se il nome c'è già non cambia niente, se c'è con un altro ruolo si ferma: un installatore non diventa corriere per sbaglio). Esempi:
  ```
  node scripts/db/crea_utente_corriere.js marco.bianchi --nome "Marco Bianchi" --telefono "333 1234567" --applica
  node scripts/db/crea_utente_corriere.js anna.verdi --ruolo supervisore_corrieri --nome "Anna Verdi" --applica
  node scripts/db/crea_utente_corriere.js marco.bianchi --supervisore anna.verdi --applica
  ```
  (l'ultimo vale solo alla creazione: per collegare un corriere già esistente a un supervisore oggi serve un `UPDATE users SET supervisore_id = ... WHERE id = ...`). La prova a secco consuma un numero di `users_id_seq`: l'id vero può saltare. **Un utente creato così non ha l'email e non entra dall'app**: per i corrieri dell'app serve la registrazione dall'app.

## Da fare / punti aperti

- **Non provato su un telefono vero** (solo anteprima web contro l'API vera e test automatici): la posizione (nell'anteprima è simulata), l'apertura di Maps e della chiamata dai pulsanti, le notifiche push (servono la build e Firebase), tastiera «email», riempimento automatico, barra fissa con la tastiera aperta, l'alone dei campi. L'aspetto delle schermate segue la descrizione scritta: le immagini di riferimento non erano più disponibili.
- **Un corriere non può rinunciare a una consegna già accettata**: l'ordine nasce all'accettazione e non c'è un «rilascia» né una scadenza. Se il corriere sparisce, la consegna resta «in consegna» finché il banco non la gestisce a mano. «Segnala un problema» è un segnaposto che rimanda a chiamare il banco o il cliente. Da decidere con l'utente.
- **Storico e Profilo** sono scarni: lo Storico è un segnaposto, il Profilo non ha cambio password né dati. Il campanello non ha un elenco (le notifiche arrivano sul telefono).
- **La registrazione è pubblica e dà accesso subito**, per scelta. Va bene per l'ambiente di prova; **prima di dare l'app a corrieri veri nel reale serve un passaggio di approvazione** (un flag «approvato» o il supervisore che conferma): da decidere.
- **Il supervisore dei corrieri** non esiste ancora (ruolo e legame sì, nessuna schermata né codice).
- **Il link della password dimenticata** apre la pagina web (vedi «Accesso e registrazione»): se si vuole che il corriere non esca mai dall'app serve un link profondo (`minuteria://…`) o una schermata nell'app.
- **Il compenso del corriere** non è gestito né mostrato nell'app: l'installatore paga la quota fissa di sempre (`spedizione_fissa`) e il resto fra corriere e azienda è fuori da questo codice.
- **Sostituire WhatsApp nel reale**: vedi [ambienti.md](ambienti.md), «Passare l'ambiente reale all'app». Le due azioni che il gruppo scatena (`corriereHaPreso`, `segnaConsegnatoDalCorriere`) sono le stesse che usa l'app, atomiche e indipendenti dal canale.

## Come si è provato

**Database e script (6/11/2026, primo giro):** DB Postgres locale usa-e-getta con lo **schema di prima** (da `git show HEAD:db/schema.sql`: vincolo vecchio, che rifiutava `corriere`), blocco applicato con `applica_blocco_schema.js` a secco, poi due volte con `--applica` (rilanciabile), poi lo script in 11 casi (prova a secco, creazione, rilancio, nome già di un installatore, supervisore + corriere collegato, supervisore inesistente, ruolo/nome/password non validi, supervisore con supervisore) e la password del file contro l'hash nel DB. Poi prova a secco e applicazione sul DB condiviso, e un secondo lancio dello script per vedere che non duplica.

**Accesso e registrazione**: `test/account/api_corrieri.test.js` (registrazione, errori per campo, email doppia, accesso, messaggi per ruolo, `/me`, password dimenticata, limiti, e l'ultimo test: senza `CORRIERI_APP` tutte le rotte danno 404), `test/sito/corrieri_sito.test.js` (il sito rifiuta il corriere, l'installatore entra, nessuna traccia dei corrieri nelle pagine web) e 2 casi in `test/account/recupero_password.test.js`.

**Schermate di lavoro e ciclo di consegna:**
- `test/corrieri/consegne_pure.test.js` (le funzioni senza database: posizione, zona, orari del banco…) e **`test/corrieri/app_corrieri_postgres.test.js`**, il giro completo su un Postgres vero (18 casi: richiesta, conferma del banco, i corrieri la vedono, il primo che accetta vince, un corriere = una consegna, ritiro, consegna, riepilogo, banco che elimina l'ordine, doppia accettazione). Parte solo con `TEST_DATABASE_URL` su un database `prova_…` **locale** (svuota utenti, banchi e prodotti: vedi [ambienti.md](ambienti.md), «Prove in locale»). `npm test` alla radice: 655 test, 654 verdi e 1 saltato (quel giro, senza il database di prova).
- Le schermate nell'anteprima web, contro l'API vera su un database locale: accesso, disponibile/non disponibile, elenco con i tempi calcolati, dettaglio, accetta, fase 1, fase 2, «Consegna completata» con gli orari giusti, «Richiesta già presa», «Questa consegna non c'è più», una richiesta nuova che arriva da sola, Profilo, Storico (segnaposto), avviso «Serve la tua posizione». La posizione è simulata. `tsc --noEmit` e `expo lint` a 0 problemi. Nell'anteprima i clic non arrivano con l'emulazione «mobile» attiva (touch): per provare l'app si usa la finestra normale.

## Per tornare indietro (DB condiviso)

Il blocco «ruoli e legami» (già sul database condiviso):

```sql
DELETE FROM users WHERE ruolo IN ('corriere', 'supervisore_corrieri');  -- prima i corrieri, poi i supervisori
ALTER TABLE orders DROP COLUMN corriere_id;
ALTER TABLE request_responses DROP COLUMN corriere_id;
ALTER TABLE users DROP COLUMN supervisore_id;
ALTER TABLE users DROP CONSTRAINT users_ruolo_check;
ALTER TABLE users ADD CONSTRAINT users_ruolo_check CHECK (ruolo IN ('cliente', 'agente', 'distributore'));
```

Il blocco «disponibilità, tragitto e ritiro» (solo se è stato applicato a un database; prima di quello sopra):

```sql
ALTER TABLE orders DROP COLUMN ritirato_il;
ALTER TABLE request_responses DROP COLUMN corriere_km;
ALTER TABLE request_responses DROP COLUMN consegna_km;
ALTER TABLE users DROP COLUMN corriere_disponibile;
```
