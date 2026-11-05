# App nativa e Android

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## App nativa (`mobile/`)

Panoramica e avvio in README. Qui solo ciò che non si deduce dal codice.

- React Native + Expo (Expo Router in `mobile/src/app/`), **niente WebView** per scelta
  esplicita. Fase 1 solo installatore, poi banco "leggero", l'agente resta web. Dal 19/10/2026 l'app ha registrazione, pagamento con Stripe, push, profilo ed eliminazione account: vedi "App Android e sicurezza". Le API Expo
  cambiano a ogni SDK: guida e regole in `mobile/AGENTS.md`, doc versionata prima di scrivere.
- `src/routes/api_v1/` è montata in `src/app.js` **prima** di controllo origine, sessione e middleware
  `res.locals`: solo token Bearer (`src/logica/account/token_app.js`), CORS aperto (nessun cookie in gioco).
  `/api/v1/login` rifiuta i ruoli diversi da `cliente`.
- Logica condivisa col sito, non duplicata: tutto il flusso richiesta pagata → ordine →
  stato ordini in **`src/logica/ordini/flusso_cliente.js`** (le route di `server.js` fanno solo render/redirect:
  non rimetterci logica), più `src/logica/catalogo/prodotto_json.js` e `src/logica/account/limite_login.js`.
- `EXPO_PUBLIC_API_URL` si imposta in `mobile/.env.local` (Expo legge i `.env` solo da `mobile/`,
  non da quello alla radice, che è del server): senza, l'app cerca il server sul PC.
- Carrello sul telefono (AsyncStorage per utente), totali ricalcolati dal server (con 300 ms di
  attesa fra un tocco e l'altro). Stato in `mobile/src/negozio.ts` con abbonamento per
  selettore: con un Context normale ogni "+" ridisegnava tutto l'elenco — non tornarci.
- Scelte grafiche volute (richieste esplicite): **solo tema chiaro** (niente modalità scura né
  interruttore; `useTema()` restituisce solo `{ c }`); titoli delle barre a 17px (`STILE_TITOLO`);
  prezzo sempre in fondo alla card e centrato sullo stepper; 2 misure affiancate su una riga, da 3
  tendina; nome in Sora 600 come sul sito; righe dentro una card dello stesso colore del riquadro foto.
- **Barra del titolo**: una sola per tutte le schermate, `src/componenti/BarraTitolo.tsx` (opzione
  `header: intestazione` in pile e schede). La barra nativa delle pile era più alta di quella JS del
  Carrello su telefono (sul web non si vede: lì sono entrambe JS) e cambiare il font non serviva.
  Altezza 44 iOS / 64 Android + barra di stato: per cambiarla si tocca solo quel file. Non rimettere
  `headerStyle`/`headerTitleStyle` nelle pile.
- Categorie e sottocategorie si aprono già piene: `usePrecaricaCatalogo` e
  `usePrecaricaSottocategorie` (`src/dati.ts`) leggono in background dettagli e prima pagina con le
  prime foto, 3 richieste alla volta, con le stesse opzioni delle query (stessa chiave → stessa
  cache). Il titolo dell'header arriva nel parametro `titolo` di `router.push`: cambiarlo dopo il
  caricamento ridisegna l'header a metà transizione. Non tornare a spinner + due richieste in fila.
- Avvio: la sessione si ripristina **senza aspettare la rete** (`src/sessione.tsx`): utente salvato
  in SecureStore insieme al token, `/me` verifica in background (401 → esce, rete assente → resta
  dentro).
- **Niente schermate intermedie sbagliate** (lampi segnalati dall'utente): il carrello si svuota solo
  dopo aver lasciato la scheda (prima compariva "Carrello vuoto / Vai al catalogo" mentre si
  aspettava "Stato ordini"). Annullare/eliminare un ordine o una richiesta aggiorna
  `['stato-ordini']` (con `refetchType: 'all'`: la scheda sta sotto, non in primo piano) **prima** di
  uscire e non rilegge l'elemento tolto (404 → "non trovato"). Dopo un annullamento "Stato ordini"
  resta su "Nessun ordine in corso" (richiesta esplicita, `quandoChiusa`) finché non si lascia la
  scheda: altrimenti passava a un ordine di ieri ancora aperto (entro 24 h), in verde, che sembrava
  la richiesta appena annullata "confermata".
- Tastiera Android: `KeyboardAvoidingView behavior={undefined}` è la scelta raccomandata dalla
  guida Expo, non cambiarla; con le schede in basso serve `tabBarHideOnKeyboard`.
- `icon.png` e `splash-icon.png` sono ancora i segnaposto di Expo: senza un logo vero la splash
  nativa non è configurata.
- Marchi assenti dall'app: `/marchi` non è linkato e nessun marchio è attivo.
- `mobile/src/icone.ts` è **generato** da `src/comune/icone.js` (`node scripts/genera/genera_icone_app.js`).
- Verifica: `npx tsc --noEmit` in `mobile/` (il lint `expo lint` ha errori già presenti: apostrofi
  nei testi e un `setState` in un effect). Anteprima nel browser: se la porta 8081 è già occupata
  dall'Expo dell'utente, `preview_start` rifiuta: aprire direttamente `http://localhost:8081`. Senza
  login: in `localStorage` mettere `token_accesso` e `utente_accesso` (JSON utente), sostituire
  `window.fetch` con risposte finte (`/me`, `/stato-ordini`...) e lanciare
  `history.pushState` + `popstate` (rimonta `SessioneProvider`; azzera la cache). Nel pannello
  browser nascosto clic e scroll non arrivano: leggere lo stato con `javascript_tool`. Le misure
  delle barre native (Android/iOS) **non si vedono sul web**.
- Provare richiesta/ordine **senza** richieste vere (arrivano ai banchi reali): risposte
  finte come sopra. Per provare il resto con il DB: cliente di prova creato in `users` (password
  casuale), richieste con `richieste.creaRichiesta`, poi **cancellare tutto** quello creato
  (richieste, risposte, ordini, notifiche, cliente); le notifiche finiscono agli utenti del banco, che
  ora sono interni. Le credenziali demo del README funzionano ma hanno storico vero.

## App Android e sicurezza (19/10/2026)

Test di sicurezza + correzioni + app Android finita. Il cosa-fare per pubblicare sta in **`mobile/ANDROID.md`**; qui solo ciò che non si deduce dal codice.
- **Come si è provato (rifarlo così, MAI sul DB di produzione)**: Postgres 18 è installato sul PC (utente `postgres`/`postgres`, servizio `postgresql-x64-18`). Si crea un DB usa-e-getta
  (`CREATE DATABASE minuteria_pentest`), `DATABASE_URL=postgres://postgres:postgres@localhost:5432/minuteria_pentest node scripts/db/apply_schema_pg.js` (col superutente **l'intero schema si applica**,
  anche `ricerca_simili`), `node db/seed.js` e qualche prodotto con SQL; poi `node server.js` con `PORT=3100`, `DATABASE_URL` locale e le variabili `STRIPE_*`, `APP_URL`, `PAGAMENTO_SIMULATO`,
  `FINESTRA_CONFERMA_SEC` **svuotate** (dotenv non sovrascrive quelle già definite, nemmeno se vuote). Per provare Stripe in modalità prova si lasciano le chiavi del `.env` (`sk_test_`): le righe
  di `stripe_pagamenti` usano la chiave di idempotenza `pi-test-<id>`, quindi **dopo un reset del DB gli id non vanno riazzerati** (`TRUNCATE ... CONTINUE IDENTITY`, o `setval` molto avanti):
  un id riusato riporta un PaymentIntent vecchio già incassato e il pagamento sembra "annullato". Spegnere i server (`Stop-Process` sulla porta) e `DROP DATABASE` a fine prova.
- **Corretto**: open redirect in `POST /carrello` (`ritorno`, ora `http.percorsoInterno`); `%00` nella query/percorso/corpo (Postgres lo rifiuta → 500: ora tolto da `leggiQuery`/`corpoSempreOggetto`,
  400 nel percorso, e gli errori Postgres di "valore non valido" 22021/22P05/22003/22P02/22007/22008 sono 400 in `gestoreErrori` e nell'API); `partenza_ore`/`consegna_ore` di `rispondi` scritte a mano
  (numero enorme → colonna intera → 500: la route non le legge più, `rispondi` le tronca a 720); `GET /distributore/ordini/:id` non prende più in carico se `Sec-Fetch-Site: cross-site`
  (era una GET che scrive; dal 19/10/2026 non lo prende più in carico da nessuna parte); **il banco che elimina un ordine o una richiesta ora fa tornare il pagamento** (`pagamenti.rimborsa` dentro la transazione) e avvisa il cliente (prima restava addebitato);
  **lavoro differito dentro una transazione**: `richiediElaborazione` (timer di 2 s dopo l'incasso) ereditava il client della transazione già chiusa (AsyncLocalStorage) e girava su una connessione
  ormai nel pool (avviso di pg "client.query() ... already executing a query"): ora passa da `db.fuoriDallaTransazione`, come l'invio push; qualsiasi nuovo `setTimeout`/promessa "senza aspettare" avviato
  da dentro `db.transaction` deve fare lo stesso; `npm audit fix` (proxy-addr critica: spoofing di `req.ip`, che conta i tentativi di accesso; qs).
- **Limiti** (`src/logica/account/limite_login.js`, in memoria): login 8 errori in 10 min per utente+indirizzo **e** 60 per solo indirizzo (password spraying; soglia alta perché un proxy mal configurato fa condividere
  l'indirizzo), registrazioni 12 all'ora per indirizzo (la registrazione è pubblica e approva da sola). Contano sull'indirizzo vero: serve `X-Forwarded-For` dal proxy (README). Intestazioni: CSP
  **senza** `script-src` (le pagine hanno script in linea) ma con `frame-ancestors`, `base-uri`, `object-src`, `form-action`; `Permissions-Policy` (`camera=(), microphone=(), geolocation=(self)`: **la posizione è permessa a questo sito** per il pulsante del carrello, vedi "Posizione"; con `geolocation=()` il browser la bloccava sempre); HSTS solo se `req.secure`. Niente COOP: romperebbe le
  finestre di Google Pay/Link.
- **Da sapere / non toccato**: `db/minuteria.db` (SQLite legacy) è stato eliminato il 24/10/2026 (resta nella cronologia di git); `xlsx` ha vulnerabilità senza correzione ma
  si usa solo negli script di importazione; `/ordini/:id/consegnato-prova` e la registrazione con approvazione automatica restano (scelte esplicite); `trust proxy` è 1 (un proxy solo).
- **API dell'app** (`src/routes/api_v1/`, tutta riscritta; provata contro Postgres e Stripe prova): `POST /richieste` e `/richieste/:id/reinvia` con Stripe → `{ pagamento: { id, client_secret, chiave_pubblica,
  importo, modo } }`, la richiesta nasce da `GET /pagamenti/:id` (stessa `stripe_pagamenti.preparaPagina`/`completaRiga` del sito; senza Stripe → `{ id }` come prima); `POST /registrazione` (token subito, errori per
  campo in `errori`), `GET /profilo`, `DELETE /account` (password; `src/logica/account/account.js`: anonimizza e disattiva, **non** cancella ordini/ricevute/dati dell'impresa; 409 se c'è una richiesta in attesa, un
  ordine non consegnato da meno di 24 h o un pagamento aperto), `POST/DELETE /dispositivi` (token push), `GET /stato-ordini` → `{ attivo, voci }` (tutte le attività, come la striscia del sito),
  `GET /materiale?mese=&vista=` (lo Storico di `materialeOrdini`), `POST /ordini/:id/ricevuta` → indirizzo firmato HMAC di 5 minuti per `GET /ricevute/:id.pdf` (il telefono non può mandare
  `Authorization` quando apre un PDF), `GET /ordini/:id/riordina`; `/ordini/:id` e `/richieste/:id` portano `importi` (consegna/materiale divisi), `stato_pagamento`, `eta_sec`/`durata_sec`/`in_arrivo`,
  righe a prezzo del banco. `POST /ordini/:id/consegnato` usa la conferma provvisoria se l'ordine non è `evaso` (come il sito). Notifiche push: `notifiche.notifica()` chiama `push.inviaAUtente`
  (Expo Push Service, `PUSH_ATTIVO=0` per spegnere); tabella `dispositivi_push` nel blocco "Notifiche push dell'app Android" in fondo a `schema.sql`, **applicato solo al DB locale di prova, NON al
  DB condiviso** (senza, le push restano spente e il server lo scrive una volta nel log).
- **App** (`mobile/`): schermate nuove `registrati`, profilo con anagrafica ed "Elimina account", Storico per mese (`useMateriale`), Stato ordini con striscia per più attività, `componenti/Pagamenti.tsx`
  (stessi quattro stati del sito), carrello con "Paghi ora / Paghi dopo". **Il modulo nativo di Stripe sta in `src/foglioStripe.ts`, con `foglioStripe.web.ts` al suo posto sul web**: un `require`
  in una funzione non basta, Metro lo risolve comunque e il bundle web si rompe. `expo-notifications` si carica con `require` tardivo solo su Android fuori da Expo Go (`src/logica/notifiche/notifiche.ts`). Il plugin
  `@stripe/stripe-react-native` **vuole un oggetto di opzioni** (senza, `expo config` va in errore). `eas.json` ha il segnaposto `https://INSERISCI-IL-DOMINIO.invalid`: l'app installata mostra "App non
  configurata" finché non si scrive il dominio (`erroreConfigurazione` in `src/api.ts`). Icone e avvio sono segnaposto generati da `scripts/genera/genera_icone_android.js`.
- **Verifiche dell'app**: `node node_modules/typescript/bin/tsc --noEmit` in `mobile/` (**non** `npx tsc`: in `mobile/` pesca un pacchetto sbagliato), `npx expo export --platform android` (bundle Hermes),
  `npx expo prebuild --platform android --no-install` (poi cancellare `mobile/android` e rimettere gli script `android`/`ios` di `package.json`, che prebuild cambia in `expo run:*`), `npx expo-doctor`.
  `expo lint` ha ancora 6 errori **già presenti** (ref/`Date.now` in render, `setState` in un effect, un apostrofo). Nel browser incorporato i clic reali a volte non arrivano a un `Pressable` dentro il
  carrello (tastiera/focus del campo nota): `elemento.click()` da `javascript_tool` sì; lo screenshot esce troncato a destra a larghezze da telefono (artefatto).
- **Non verificato** (niente telefono né SDK Android qui): il foglio di Stripe e Google Pay su un dispositivo vero, la ricezione delle push (serve `google-services.json` + chiave FCM v1 su EAS), la
  compilazione Gradle (la fa EAS). Il testo di `/privacy` e `/elimina-account` (`src/comune/testi_legali.js`) è una **bozza** da far rileggere. Il nome del pacchetto `it.minuteria.ordini` è una scelta mia da
  confermare prima della prima pubblicazione (poi non si cambia).
