# App nativa e Android

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## App nativa (`mobile/`)

Panoramica e avvio in README. Qui solo ciò che non si deduce dal codice.

- React Native + Expo (Expo Router in `mobile/src/app/`), **niente WebView** per scelta
  esplicita. Fase 1 solo installatore, poi banco "leggero", l'agente resta web. Dal 19/10/2026 l'app ha registrazione, pagamento con Stripe, push, profilo ed eliminazione account: vedi "App Android e sicurezza". Le API Expo
  cambiano a ogni SDK: guida e regole in `mobile/AGENTS.md`, doc versionata prima di scrivere.
- `src/routes/api_v1/` è montata in `src/app.js` **prima** di controllo origine, sessione e middleware
  `res.locals`: solo token Bearer (`src/logica/account/token_app.js`), CORS aperto (nessun cookie in gioco).
  `/api/v1/login` rifiuta i ruoli diversi da `cliente` («Questo account non è un account installatore»): i corrieri hanno un accesso e una registrazione a parte, solo nell'app (`/api/v1/corrieri/*`, accesso unico con due metà che scorrono nel `login`, `registrati-corriere`, l'area `corriere/` con le sue quattro schede, selettore «Installatore | Corriere» animato): [app-corrieri.md](app-corrieri.md). **Le rotte dei corrieri esistono solo nell'ambiente «app»** (`CORRIERI_APP=1`, 404 altrove): un'app costruita parla con **un solo** server, quello scritto nella build (`EXPO_PUBLIC_API_URL`), quindi l'app dei corrieri funziona solo contro un server dell'ambiente «app» ([ambienti.md](ambienti.md)).
- Logica condivisa col sito, non duplicata: tutto il flusso richiesta pagata → ordine →
  stato ordini in **`src/logica/ordini/flusso_cliente.js`** (le route di `server.js` fanno solo render/redirect:
  non rimetterci logica), più `src/logica/catalogo/prodotto_json.js` e `src/logica/account/limite_login.js`.
- `EXPO_PUBLIC_API_URL` si imposta in `mobile/.env.local` (Expo legge i `.env` solo da `mobile/`,
  non da quello alla radice, che è del server): senza, l'app cerca il server sul PC. Nelle build (`mobile/eas.json`) il profilo `preview` è quello dell'ambiente «app» di prova e `production` quello del reale: entrambi hanno ancora il segnaposto `https://INSERISCI-IL-DOMINIO.invalid` e si compilano a mano (vedi [ambienti.md](ambienti.md), «L'app sul telefono»).
- **Posizione (06/11/2026)**: `expo-location` (`mobile/app.json`), solo con l'app aperta, senza permessi in background; la usa solo l'area del corriere (`mobile/src/corriere/posizione.tsx`). Dipendenza nuova: `@expo-google-fonts/manrope` (il font delle schermate del corriere).
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
- Verifica: `npx tsc --noEmit` in `mobile/` e `npx expo lint` (a **0 problemi** dal 05/11/2026: tenerlo così,
  vedi «Allineamento dell'app al sito»). Anteprima nel browser: se la porta 8081 è già occupata
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

## App Android: orari del banco, cambio password, avvisi (05/11/2026)

Richiesta: "finisci e completa l'app mobile per android, solo l'interfaccia per installatori, e configura le notifiche". Confronto con l'interfaccia web dell'installatore: mancavano tre cose, ora ci sono. Niente per il banco (resta sul sito).
- **Orari del banco** (mockup `docs/mockup/carrello-chiuso.png`, `carrello-in-chiusura.png`, `orari-borea.png`): `mobile/src/componenti/OrariBanco.tsx` (riquadro "Ordini chiusi", striscia "Ancora N min", nota sotto il pulsante), pagina `mobile/src/app/orari.tsx`
  (titolo "Orari di BOREA" dal parametro `titolo`, come le categorie), hook `useOrari` in `mobile/src/dati.ts`. I testi li scrive il server (`GET /api/v1/orari` → `src/logica/ordini/orari.js`), mai l'app. Dettagli e perché non c'è il tempo reale: «Anagrafica del banco, orari» in `docs/banco/anagrafica-e-orari.md`.
- **Cambio password**: Profilo → Sicurezza (`componenti/CambioPassword.tsx`, `cambiaPassword` in `sessione.tsx`, `POST /api/v1/password`): vedi `docs/account-installatore.md`. Un dettaglio che si rompe facilmente: dopo il cambio il vecchio token è revocato, quindi
  `chiamaApi` (`mobile/src/api.ts`) fa uscire dalla sessione solo se il 401 arriva a una richiesta partita **con il token ancora in uso**; una richiesta rimasta in volo col token vecchio non deve buttare fuori chi ha già quello nuovo.
- **Notifiche** (`mobile/src/notifiche.ts`, `componenti/AvvisiTelefono.tsx`): comportamento e interruttore in `docs/notifiche.md`. `useNotifichePush` ora riceve l'id dell'utente (non più un booleano) perché la preferenza è per utente. Le Expo push passano dal servizio Expo (`push.js`);
  per farle arrivare serve ancora la parte che dipende da te (account, Firebase, chiave FCM, progetto EAS): è l'elenco di `mobile/ANDROID.md`, sezione 2 e 5.
- **Controlli fatti**: `tsc --noEmit` pulito; `expo lint`: gli stessi 6 problemi già presenti (carrello, `Stepper`, `VistaOrdine`, `VistaRichiesta`, `dati.ts`), nessuno nei file nuovi; `expo export --platform android` riuscito; `expo-doctor` 20/21 (segnala 5 pacchetti Expo indietro di una
  patch: `expo`, `expo-constants`, `expo-notifications`, `expo-router`, `expo-splash-screen`; si allineano con `npx expo install --check`, non fatto per non cambiare le dipendenze senza chiedere); `npm test` 604 test, tutti verdi (5 nuovi).
- **Non verificato**: l'interfaccia su un telefono vero o un emulatore (nessuno qui), la ricezione delle push, il permesso di Android 13+, il passaggio dalle impostazioni di sistema. Da provare con una build `preview` (vedi `mobile/ANDROID.md`).
- **iPhone (stesso giorno, richiesta "fai anche per ios se manca qualcosa")**: guida in **`mobile/IOS.md`**. Cambiato nel codice solo ciò che era scritto per Android: `supportate()` in `notifiche.ts` ora accetta anche iOS (canale solo su Android, `piattaforma: 'ios'` al server),
  `googlePay` solo su Android in `foglioStripe.ts`, `ITSAppUsesNonExemptEncryption: false` in `app.json` (dichiarazione dell'utente verso Apple). Tutto il resto (tastiera, barra del titolo, schema `minuteria://`, `bundleIdentifier`) c'era già. Verificato solo `tsc` e `npx expo export --platform ios`.
  **L'Expo Go dell'App Store non apre il progetto su iPhone** (si ferma all'SDK 54, il progetto è SDK 58): serve comunque l'account Apple Developer a pagamento, per una build EAS o per l'Expo Go nuovo da TestFlight (`npx eas-cli@latest go`, non provato). Apple Pay non è acceso (servirebbe un Merchant ID).

## Aggiornamento a Expo SDK 58 (05/11/2026)

Richiesta: "rifai tutto per expo sdk 58". Il progetto era sull'SDK 57; ora è sull'**SDK 58**: `expo` ^58.0.23, React Native 0.88.1 (era 0.86.3), React 19.3.0, `expo-router` ~58.0.30, `expo-notifications` ~58.1.8, `@stripe/stripe-react-native` 0.81.0 (era 0.64.0), `react-native-screens` ~4.30.1. Serve Node 22.13 o più (il PC ha 22.14.0).
- **Come si è fatto**: `npm install expo@^58.0.0` e `npx expo install --fix` (guida: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/). `npm` si è fermato con un conflitto (`ERESOLVE`: `@expo/ui` 57 rimasto dal vecchio `expo-router` contro il nuovo `expo-router`),
  quindi sono stati cancellati `node_modules` e `package-lock.json` e rifatto `npm install` da capo, poi `npx expo install --fix` per `@types/react` ed `eslint-config-expo`. **Il `package-lock.json` è stato rigenerato** (cambiano anche le versioni indirette). Per tornare indietro: `git checkout -- mobile/package.json mobile/package-lock.json` e `npm ci` in `mobile/`.
- **Codice cambiato** (solo due correzioni di tipo, React Native 0.87 ha reso i tipi più rigidi): `registrati.tsx` usa `ScrollViewInstance` per il riferimento allo `ScrollView`; `ElencoProdotti.tsx` passa `undefined` e non `null` a `ListEmptyComponent`/`ListFooterComponent`.
- **Novità dell'SDK 58 valutate** (https://expo.dev/changelog/sdk-58): `expo-notifications` ora **mostra di default** le notifiche con l'app aperta, ma il nostro `setNotificationHandler` in `useNotifichePush` le spegne esplicitamente (regola del 21/10/2026): nessun cambio.
  **R8 è acceso di default nelle build release Android** (`android.enableMinifyInReleaseBuilds=true` nel progetto generato): non provato con Stripe e le notifiche; se una build release dà errori che il debug non dà, si spegne con `expo-build-properties` (`android.enableMinifyInReleaseBuilds: false`).
  `expo-router` ora ha `web.output` di default "server": l'anteprima web si compila lo stesso (`expo export --platform web` riuscito). Il passaggio di Stripe da 0.64 a 0.81 non ha richiesto modifiche (`tsc` pulito), ma **il foglio di pagamento non è stato provato su un telefono**: da riprovare con la carta di prova.
- **Verifiche**: `tsc` pulito; `expo lint` gli stessi 6 problemi di prima; `expo-doctor` 20/20; `expo export` per Android, iOS e web riuscito; `expo prebuild` Android riuscito (manifest con `POST_NOTIFICATIONS`, Google Pay, icona delle notifiche, schema `minuteria`; poi cancellato `mobile/android`, ripristinati `package.json` e `app.json`);
  per iOS il prebuild non gira su Windows: configurazione controllata con `npx expo config --type introspect` (`ITSAppUsesNonExemptEncryption`, schemi, `aps-environment`); `npm test` alla radice.
- **Correzioni dopo la prima prova in Expo Go (05/11/2026)**: (1) in Expo Go l'app mostrava una schermata di errore perché `Constants.executionEnvironment` con l'SDK 58 non dice più "Expo Go": `supportate()` (`notifiche.ts`) e `inExpoGo()` (`foglioStripe.ts`) ora usano **`isRunningInExpoGo()` di `expo`**, lo stesso controllo di `expo-notifications`; in più
  l'avvio delle notifiche in `useNotifichePush` è dentro un `try/catch`, così un errore delle notifiche non può più far cadere l'app. (2) Il login usa `Campo` come la registrazione: la password ha il pulsante **Mostra/Nascondi**, e utente e password non partono con la maiuscola (`autoCapitalize="none"` non basta su alcune tastiere Samsung:
  l'utente usa la tastiera "email", la password in chiaro quella "password visibile"). Provato solo nell'anteprima web (campi, attributi, Mostra/Nascondi); la tastiera vera è da provare sul telefono.
- **Expo Go**: con l'SDK 58 serve l'Expo Go dell'SDK 58 (un Expo Go dell'SDK 57 non apre più il progetto). Secondo Expo arriverà negli store entro qualche settimana dal rilascio; nel frattempo si scarica da `expo.dev/go` (propone l'SDK 58). Su iPhone resta valido quanto scritto in `mobile/IOS.md`.

## Allineamento dell'app al sito, senza animazioni (05/11/2026)

Richiesta: "elimina le animazioni, categorie e sottocategorie non sono aggiornate, deve essere aggiornato tutto al web app, neanche carrello e stato ordini, e neanche il resto: aggiorna tutto sia per android che ios". Il sito (`views/`, `assets/css/`) è il modello: quando cambia il sito, l'app va riallineata, non il contrario.
- **Nessuna animazione, voluta**: transizioni delle schede e delle pile spente (`animation: 'none'`), niente `Animated`/`Reanimated`, niente movimento da codice. Gli anelli del conto alla rovescia e le barre si ridisegnano **ogni secondo** da `useContoAllaRovescia` (`src/dati.ts`) e non scorrono da sé. Non rimettere animazioni
  (nemmeno «piccole»). **Unica eccezione voluta (06/11/2026, richiesta esplicita)**: con più attività in corso l'icona della scheda "Stato ordini" alterna un fotogramma alla volta ogni 2,5 s come il sito, ma con cambio netto, senza dissolvenza (vedi «Stato ordini: icone a rotazione e card "Consegna in cantiere"» in fondo).
- **Schermate rifatte sul sito**: home (`StatoHome`, categorie e sottocategorie come `views/cliente/home.ejs`), righe prodotto (`RigaProdotto`, le «righe compatte» di «Righe compatte ovunque» in `aspetto-grafico.md`), carrello (`(schede)/carrello.tsx`: articoli → «Consegna in cantiere» con "Cambia" → nota → riepilogo «Cosa paghi e a chi» → barra fissa
  «Paga e invia richiesta»), Stato ordini (`ordini/index.tsx`, striscia per attività, `NavStatoOrdini.tsx` per icona ed etichetta nella barra: anello arancio e mm:ss, furgone verde e «Arriva tra N min» / «In arrivo», scatola rossa «Nessuna risposta»),
  pagina richiesta e ordine (`VistaRichiesta`, `VistaOrdine`), Storico (`ordini/storico.tsx`: per mese, vista «per ordine» o «per articolo»), profilo con anagrafica (`profilo.tsx`, `Avatar`, `anagrafica.tsx`: `RigaAn`/`SchedaAn`/`CellaFiscale`, `acc.tsx`: `PulsanteAcc`/`ErroriAcc`),
  orari, accedi e registrati (`Campo`).
- **Come si passa una ricerca o una voce da un'altra scheda**: con un parametro di percorso più un `n` che cambia a ogni tocco (`q`+`n` per la ricerca della home dal carrello vuoto, `voce`+`n` per aprire una voce di Stato ordini). La schermata li copia nello stato **durante il disegno** (confronto con l'ultimo `n` visto), non in un
  `useEffect`: la regola di lint `react-hooks/set-state-in-effect` lo vieta e i valori nuovi comparirebbero un disegno dopo. Lo stesso per la destinazione precompilata del carrello (da `riepilogo.indirizzo_consegna`) e per `Stepper` (`valoreVisto`).
- **Cambi all'API** (`src/routes/api_v1/`, tutti con campi **nuovi**: l'app vecchia non si rompe): `GET /stato-ordini` porta `minuti_testo` (minuti da scrivere nei testi, vedi «Finestra di conferma» in `CLAUDE.md`, mai il timer) e vale `?lette=0` per la lettura silenziosa che non segna lette le notifiche;
  `GET /ultimo-ordine` (la scheda «ultimo ordine» del carrello vuoto), `consegnato_il_esteso`, `durata`/`durata_testo` negli ordini; `GET /materiale` porta `servizio_pct` per ordine e `ordini: [id]` per articolo; `GET /profilo` porta `utente.stato_anagrafica` (`in_attesa` = nessun banco ha ancora approvato: si sfoglia ma non si invia) e `codice_cliente`
  (solo se il banco ha approvato). Tipi in `mobile/src/api.ts`. Prova: `test/account/api_profilo.test.js` (il server ricorda per 60 s l'utente di un token: ogni prova usa un token nuovo).
- **Non portato nell'app** (scelte da confermare o cose che richiedono altro lavoro): il pulsante a mirino «Usa la mia posizione» (servirebbe `expo-location`, e la guida dice che l'app non invia la posizione), i filtri per marchio (l'API non ha i marchi), «Ricevute del mese» ed «Esporta elenco» (PDF/CSV) nello Storico,
  la riga «installa l'app» di «Sul telefono». La nota sui prezzi nelle pagine di categoria del sito è ancora quella vecchia: l'app usa ovunque quella della home (`NOTA_PREZZI`).
- **Verifiche**: `tsc --noEmit` pulito, `expo lint` **0 problemi** (erano 6), `expo-doctor` 20/20, `expo export` per Android e iOS riusciti, `npm test` alla radice 608 test verdi (4 nuovi). **Non verificato**: il disegno su un telefono Android o su un iPhone veri (nessuno qui), né nell'anteprima web: i confronti con il sito
  sono fatti leggendo `views/` e `assets/css/`, non guardando le due schermate fianco a fianco. Da fare con Expo Go (SDK 58) o con una build `preview`, scorrendo catalogo, carrello, Stato ordini, storico e profilo.

## Menu del profilo (05/11/2026)

Richiesta: "da carrello non posso più cliccare l'icona menu, e da Stato ordini compare un'icona Storico accanto all'icona; cliccando l'icona dovrebbe aprire la tendina con la mia anagrafica, storico ordini ed esci". Modello: «Pulsante e menu del profilo» in `docs/aspetto-grafico.md` (`views/partials/comune/appbar.ejs`, classi `profilo-*`, `pp-*`).
- **`componenti/PulsanteAccount.tsx`** è ora il pulsante **e** il pannello a tendina (un `Modal` trasparente, senza animazione): cerchio con le iniziali → pannello in alto a destra sotto la barra, resto della pagina oscurato (la barra resta in luce), intestazione con cerchio + ragione sociale + «referente · cliente di DISTRIBUTORE» (da `useProfilo`, letto già dal pulsante così il sottotitolo c'è all'apertura),
  poi «La mia anagrafica», «Storico ordini», «Esci» (rossa, senza freccia). Un tocco fuori, sulla barra o il tasto indietro di Android lo chiudono. Misure e colori sono quelli di `.profilo-pannello`/`.pp-*`; `altezzaTotale` di `BarraTitolo.tsx` (esportata) dà dove parte il velo.
- **Il pulsante c'è in ogni pagina del cliente**, come sul sito: pile Catalogo e Stato ordini (`headerRight` nelle `screenOptions`), **Carrello** (prima non l'aveva: `headerRight` nelle opzioni della scheda in `(schede)/_layout.tsx`) e la pagina profilo. Non c'è in «Orari di BOREA» (`senzaProfilo` sul sito). **Non rimettere** il link «Storico» accanto all'icona in Stato ordini: lo Storico è una voce del menu (e resta la riga «Storico ordini» nella pagina vuota, come sul sito).
- **«La mia anagrafica»** non è più una modale con barra nativa «Il mio account»: è una pagina normale con la stessa barra delle altre (`header: intestazione`), titolo come sul sito, freccia indietro. **«Esci» non sta più in fondo alla pagina** (era un'aggiunta dell'app: ora c'è il menu, come sul sito). Lo Storico si intitola «Storico ordini» (era «Storico»).
- **Lo Storico dal menu di un'altra scheda**: sta nella pila di Stato ordini, quindi aprirlo da Catalogo o Carrello lo metteva come unica pagina della pila, senza freccia indietro. Ora `router.navigate('/ordini/storico', { withAnchor: true })` più `unstable_settings = { anchor: 'index' }` in `(schede)/ordini/_layout.tsx` mettono sotto «Stato ordini»: indietro porta lì (sul sito porta alla home). Un `router.navigate('/ordini')` seguito da `push` **non** basta: la prima volta, con la scheda non ancora montata, il secondo vince e la pila resta di una pagina.
- **Come si è provato** (anteprima web su `localhost:8081`, nessuna richiesta vera): il trucco del `popstate` descritto sopra **non rimonta più la sessione**. Funziona questo: in `javascript_tool` si mettono `token_accesso` e `utente_accesso` in `localStorage`, si crea un `<iframe src="/">` a tutto schermo, si assegna `iframe.contentWindow.fetch = finta` subito e ogni millisecondo per un paio di secondi (prima che il bundle parta), e le risposte finte (`/me`, `/profilo`, `/stato-ordini`, `/catalogo`, `/ultimo-ordine`, `/materiale`) escono dal frame. Poi `iframe.contentDocument` si interroga con `querySelector` (`[aria-label="Menu profilo"]`, `[role="menuitem"]`, `[aria-label="Indietro"]`); gli elementi delle schermate non in primo piano restano nel DOM, quindi si filtrano per visibilità.
  Provato: apertura e chiusura del menu, voci e sottotitolo, Storico da Catalogo e da Carrello (freccia presente, indietro → Stato ordini), anagrafica (freccia, indietro → pagina di prima), Esci → login. `tsc --noEmit` e `expo lint` a 0 problemi. **Non provato su un telefono**: il `Modal` su Android con barra di stato trasparente (`statusBarTranslucent`/`navigationBarTranslucent`) e il velo che parte sotto la barra.
- **Resta diverso dal sito** (non toccato): la barra in basso del sito è una pillola sospesa (`.navbar`), l'app ha la barra delle schede di sempre; renderla sospesa vuol dire spostare la barra di pagamento del carrello e «Vai al carrello» e rivedere i fondi pagina (circa 96px, già pensati per la barra sospesa).

## Stato ordini: icone a rotazione e card «Consegna in cantiere» (06/11/2026)

Richiesta: «su web mostra in ogni fase della richiesta, sotto banco interpellato, una card consegna in cantiere con sotto la posizione inviata nell'ordine: su app c'è già, ma spostala anche lì, sotto banco interpellato / materiale da» e «le icone in stato ordini dell'app non hanno la stessa dinamica e grafica del sito: icone per ogni stato e, con una o più attività, mostra le icone una alla volta ogni tot secondi».

- **Card «Consegna in cantiere» sotto il banco, in ogni fase** (`SchedaConsegna` in `componenti/att.tsx`: icona della posizione, occhiello in maiuscolo, indirizzo a capo se è lungo; senza indirizzo non si disegna):
  richiesta in attesa e senza risposta → subito sotto «Banco interpellato»; richiesta annullata → sotto «Distributori interpellati»; ordine in consegna → sotto «Materiale da» e prima di «Materiale in arrivo»; ordine consegnato → dopo la scheda del materiale (il banco sta nella sua testata).
  In fondo alla pagina dell'ordine resta solo «Note» (la riga «Consegna in cantiere» che c'era lì è stata tolta: era lo stesso indirizzo). **Le viste del sito in questo repository (`views/cliente/richiesta_attesa.ejs`, `richiesta_chiusa.ejs`, `ordine_dettaglio.ejs`) non hanno questa card**: l'app la mostra comunque come richiesto; se il sito che si vede in produzione la ha, va riportata qui.
- **Il server ora dà l'indirizzo anche per la richiesta**: `GET /api/v1/richieste/:id` porta `destinazione` (la colonna `requests.destinazione`, `null` se vuota; per l'ordine c'era già). Tipo `Richiesta.destinazione` in `mobile/src/api.ts`. Prova: `test/ordini/api_richiesta_destinazione.test.js` (DB finto; con indirizzo, senza indirizzo, richiesta di un altro cliente → 404). `npm test`: 611 prove.
- **Icona ed etichetta della scheda «Stato ordini» come sul sito** (`componenti/NavStatoOrdini.tsx`, riscritto; riferimento `views/partials/cliente/nav_ordini.ejs` e `nav_ordini_fase.ejs`, `assets/css/07_stato_ordini_e_home.css`):
  nessuna attività → scatola e «Stato ordini»; richiesta in attesa → anello arancio che si svuota con la scatola da 12 px dentro, puntino arancio in alto a destra, «In attesa · mm:ss»; ordine in consegna → furgone nel colore della barra con la pastiglia verde dei minuti (`45′`, `durataBreve`), «Arriva tra N min» / «In arrivo» (3 minuti o meno, senza pastiglia) / «In consegna» (senza orario); richiesta senza risposta → scatola grigia con il «!» rosso e «Nessuna risposta».
  I secondi scendono da soli (`useContoAllaRovescia`) e i minuti all'arrivo si ricalcolano dall'orario letto.
- **Rotazione con due o più attività**: un fotogramma per attività, **si passa al successivo ogni 2,5 s** (`PASSO_MS`, come il sito) e sotto l'etichetta c'è un puntino per attività (quello pieno è la visibile). Il cambio è **netto, senza dissolvenza** (nell'app non ci sono animazioni). Icona ed etichetta sono due pezzi separati della barra e leggono lo stesso contatore (`giro`, un `creaNegozio`): un solo timer, che parte col primo che lo chiede e si ferma con l'ultimo e quando l'app va in background (`AppState`).
  **«Riduci movimento» del telefono** (come `prefers-reduced-motion` del sito): niente rotazione, resta il primo fotogramma (il più urgente) e un numero scuro in alto a sinistra dice quante sono (`Conteggio`). Se sul telefono le animazioni sono tolte dalle impostazioni, l'icona quindi non gira: è voluto.
  `tabBarBadge` della scheda non c'è più. Il lettore di schermo legge una frase sola con tutte le attività (`fraseStatoOrdini`, `tabBarAccessibilityLabel`).
- **Il tocco sulla scheda porta all'attività che si vede in quel momento** (come `data-href` del sito): con due o più attività, `tabPress` in `(schede)/_layout.tsx` annulla il tocco normale e fa `router.navigate({ pathname: '/ordini', params: { voce: 'ordine-5', n: Date.now() } })` (`useVoceMostrata`); con una sola o nessuna vale il tocco di sempre.
- **Altezza della barra**: la barra è bassa (circa 48 px: 5 di margine, 28 per l'icona, la riga dell'etichetta). La riga dell'etichetta è di 13 px e sale di 2 sotto l'icona (`RIGA_ETICHETTA`), i puntini sono da 4 px (5 sul sito) e stanno dentro la scheda: con la riga di prima (17 px) puntini ed etichetta uscivano dal fondo.
- **Come si è provato** (anteprima web `localhost:8081`, iframe e `fetch` finto come sopra, con tre attività di fasi diverse): i tre fotogrammi si alternano ogni 2,5 s con la pastiglia e il puntino giusti; il tocco sul furgone apre la pagina dell'ordine («2 di 3»); card sotto il banco in richiesta in attesa, senza risposta, annullata, ordine in consegna e consegnato; con «riduci movimento» (simulato con `matchMedia`) resta il primo fotogramma e compare il «3»; con una attività niente puntini né numero; senza attività «Stato ordini». `tsc --noEmit` e `expo lint` a 0 problemi.
  **Non provato su un telefono**: le misure della barra su Android (variante «material» della barra, margine di 10 px) e iOS; sul web la barra è sempre a 48 px e il `Text` dell'etichetta di Catalogo e Carrello è tagliato in basso già di suo. L'avviso rosso di sviluppo «Invalid DOM property `transform-origin`» sul web viene da `origin` di react-native-svg (c'era già prima negli anelli).
