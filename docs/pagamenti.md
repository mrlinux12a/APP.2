# Pagamenti

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Pagamenti Stripe (14/10/2026)

`src/logica/pagamenti/stripe_pagamenti.js` (PaymentIntent, pagina di pagamento, webhook, incassi) + punti di aggancio DB-only in
`src/logica/pagamenti/pagamenti.js`; setup e messa in produzione in docs/guide/stripe-setup.md. Scelte esplicite dell'utente: carta
**autorizzata e poi incassata** (non addebito + rimborso), **pagamento nella pagina del sito** con il Payment Element di
Stripe (prima era Checkout ospitato: cambiato lo stesso giorno, su richiesta), **sito e app Android** (l'app dal 19/10/2026 con il foglio di Stripe, vedi "App Android e sicurezza"),
**un solo conto Stripe** (niente Connect). Da non rompere:
- **Senza `STRIPE_SECRET_KEY` tutto è come prima** (`pagamenti.stripeAttivo()`): nessuna query su `stripe_pagamenti`,
  pagamento simulato. Le prove (`test/*.test.js`) non toccano mai Stripe né il DB vero (Stripe finto con
  `stripePagamenti.impostaStripe`, DB finto) e **non leggono il `.env`**: `test/sito/_aiuti/server_finto.js` svuota le variabili
  `STRIPE_*`/`APP_URL` prima di caricare `server.js` (dotenv non sovrascrive quelle già definite).
- **Reale e sandbox con un interruttore (20/10/2026, richiesta esplicita)**: `src/logica/pagamenti/stripe_config.js` legge dal `.env` DUE serie (`STRIPE_LIVE_SECRET_KEY` / `_PUBLISHABLE_KEY` / `_WEBHOOK_SECRET` e le stesse con `STRIPE_TEST_`) e
  `STRIPE_MODO=live|test` (alias reale/produzione, prova/sandbox) sceglie quale vale; `pagamenti.stripeAttivo()` e `pagamenti.modoStripe()` passano da lì, e `stripe_pagamenti.js` legge chiavi e segreti dal modulo.
  **Senza `STRIPE_MODO` vale il vecchio `.env` a una serie** (il modo lo dice la chiave): nessun cambiamento per chi non lo scrive. Regole di sicurezza, tutte provate in `test/pagamenti/stripe_config.test.js`:
  (1) una chiave del modo sbagliato NON si usa mai (sk_test_ in `STRIPE_LIVE_SECRET_KEY`, o la vecchia `STRIPE_SECRET_KEY` reale con `STRIPE_MODO=test`: ignorata + avviso nel log); (2) **con `STRIPE_MODO` scritto Stripe resta
  "acceso" anche senza chiave** (`attivo()` = dichiarato || chiave): i pagamenti danno errore e NON ricadono sul simulato, che farebbe ordinare gratis; (3) il vecchio `STRIPE_WEBHOOK_SECRET` vale solo insieme alla vecchia
  chiave segreta (un `whsec_` non dice di che modo è: con le serie separate ogni modo vuole il suo); (4) `leggiEvento` prova il segreto del modo in uso e poi quello dell'altro (un endpoint per modo sullo stesso URL non
  accumula errori 400), `gestisciEvento` scarta gli eventi con `livemode` diverso. Il log all'avvio dice `[stripe] modalità REALE…` o `PROVA…` e avvisa se: manca la chiave del modo, il reale non ha `APP_URL` https, manca il webhook.
  In sandbox `/pagamento/<id>` mostra "Modalità prova" (`modoProva`). `node scripts/verifica/verifica_stripe.js [--modo=live|test]` è **sola lettura** (conto, carte/bonifici abilitati, webhook verso `APP_URL` con gli eventi giusti).
  **Cambiare modo con pagamenti aperti** li lascia fermi (ogni riga di `stripe_pagamenti` porta il suo `modo`, un'istanza lavora solo i suoi) finché non si torna: farlo senza richieste in attesa. **Sulla VPS non devono esserci
  `PAGAMENTO_SIMULATO` né `PAGAMENTO_SIMULATO_FORZA`** (la scorciatoia del 16/10 permette di ordinare senza pagare, anche con la chiave reale): è la prima cosa da controllare prima di incassare davvero. Le chiavi reali
  stanno solo sulla VPS: il `.env` del PC punta al DB di produzione e ha solo quelle di prova. `test/sito/_aiuti/server_finto.js` svuota anche le nuove variabili prima di caricare `server.js`.
- **Chiavi** (`.env`; vecchio schema a una serie, ancora valido): `STRIPE_SECRET_KEY`, chiave pubblicabile (`STRIPE_PUBLISHABLE_KEY` o l'alias
  `STRIPE_PUBLIC_KEY`, che l'utente aveva già usato), `STRIPE_WEBHOOK_SECRET`, `APP_URL`. La pubblicabile deve avere il
  prefisso `pk_test_`/`pk_live_`. Copiandola dal Dashboard il prefisso si perde facilmente (l'utente l'aveva incollata
  come `51UQ…`, 99 caratteri): se è tutta alfanumerica e lunga (`chiaveSenzaPrefisso`) il prefisso si ricava dalla chiave
  segreta (`sk_test_` → `pk_test_`) e all'avvio si scrive un avviso (`controllaConfigurazione`); se non ha proprio la forma
  di una chiave, `/pagamento/<id>` risponde 503 "non configurato" (in locale con l'indicazione di cosa guardare).
- **Bypass del pagamento in locale** (richiesta esplicita del 15/10/2026, "momentaneamente"): con `PAGAMENTO_SIMULATO=1` nel `.env`
  **del PC** (non in git) "Paga e invia" e "Rinvia richiesta" saltano la pagina Stripe e partono con il pagamento simulato
  (`pagamenti.pagaConStripe()`, usata da `server.js`; `stripePagamenti.attivo()` resta quello di prima). **Sulla VPS deve funzionare
  sempre Stripe**: la riga non c'è nel suo `.env` e `pagamentoSimulatoForzato()` la ignora con la chiave reale (`sk_live_`) o con
  `NODE_ENV=production`; non guarda MAI l'indirizzo della richiesta (l'intestazione Host la scrive chi chiama: sarebbe un buco). Il
  bypass cambia solo COME si paga una richiesta nuova: rimborsi, rilasci e incassi di pagamenti Stripe già fatti (il `.env` locale ha il
  DB di produzione) funzionano uguale, quindi `stripeAttivo()` non cambia. All'avvio il log dice `[stripe] PAGAMENTO_SIMULATO=1...` (o
  che è ignorata). Anche con il bypass la richiesta va ai banchi veri, come ogni prova locale. Per togliere il bypass: via la riga. **Sulla VPS si può accendere di proposito (richiesta esplicita del 16/10/2026)** con DUE righe nel suo `.env`: `PAGAMENTO_SIMULATO=1` e `PAGAMENTO_SIMULATO_FORZA=1` (la seconda annulla le difese di `sk_live_`/`NODE_ENV=production`; da sola non fa niente; log `ATTENZIONE` all'avvio): i clienti veri ordinano senza pagare. Per spegnerlo basta togliere una delle due e riavviare pm2.
- **Importo di prova: l'installatore paga ORA 0,01 € (21/10/2026, richiesta esplicita "per adesso, per fare dei test")**: `PAGAMENTO_APP_PROVA=0.01` nel `.env` **del PC** (non in git; la virgola va bene) fa valere quella cifra come `app.totale` = `da_pagare_app`
  (`pricing.importoProvaApp`, applicata in `calcolaOrdine`, quindi carrello, addebito, `requests`/`orders`, incasso, Storico, "Rinvia" e API dell'app dicono la stessa cifra). **La formula non cambia**: corriere, servizio e IVA restano quelle di `dividiTotale` e si vedono nel riepilogo
  (Corriere 10,00 · Servizio 6,45 · IVA 3,62 ma "Totale da pagare ora" 0,01: le voci non sommano al totale, è voluto); il materiale da pagare dopo a BOREA e la spesa complessiva (0,01 + materiale) seguono; **mai più della formula** (`Math.min`). **Stripe vero rifiuta importi sotto 0,50 €** (anche in sandbox): 0,01 va bene solo col
  pagamento simulato del PC (`PAGAMENTO_SIMULATO=1`). Gli ordini fatti con la cifra di prova restano nel DB di produzione con `da_pagare_app` basso (e il banco vede il materiale intero). `test/sito/_aiuti/server_finto.js` la svuota; prove in `test/pagamenti/pricing.test.js`.
  **Con Stripe REALE (`STRIPE_MODO=live`) o `NODE_ENV=production` la riga da sola è IGNORATA** (protezione voluta: la VPS non deve mai far pagare meno per una riga dimenticata). **Eccezione TEMPORANEA per provare pagamenti veri da 0,50 € (richiesta esplicita del 21/10/2026)**: serve una seconda riga,
  `PAGAMENTO_APP_PROVA_LIVE=AAAA-MM-GG`, la data (ora di Roma, compresa) fino a cui vale, **al massimo 7 giorni da oggi**: passata quella data, o se manca, è scritta male o è troppo lontana, l'importo torna quello della formula da solo, anche se le righe restano nel `.env`; con la live la cifra non scende mai sotto 0,50 (minimo di Stripe)
  e all'avvio il log scrive `[config] ATTENZIONE: PAGAMENTO_APP_PROVA=0.50 con Stripe REALE / produzione, fino al <data>...` (o `ignorata`/`scaduta` con il motivo). Esempio per la VPS: `PAGAMENTO_APP_PROVA=0.50` e `PAGAMENTO_APP_PROVA_LIVE=2026-10-22` nel suo `.env` e `pm2 restart minuteria`; sulla VPS non devono esserci `PAGAMENTO_SIMULATO` né `PAGAMENTO_SIMULATO_FORZA`.
  **DA RIMUOVERE del tutto a prove finite**: `docs/PROMPT_RIPRISTINO_PAGAMENTO_PROVA.md` è il prompt per farlo (codice, test, doc, `.env` del PC; e a mano il `.env` della VPS + riavvio). Finché c'è, `pricing.importoProvaApp` è l'unico punto in cui una variabile d'ambiente può abbassare il prezzo.
- **Nessuna chiamata a Stripe dentro una transazione.** `pagamenti.rimborsa` e `segnaDaIncassare` girano dentro le
  transazioni del flusso (chiusura finestra, creazione ordine, eliminazioni) e **scrivono solo sul DB** (`stato` di
  `stripe_pagamenti` → `da_incassare` / `da_rilasciare` / `da_rimborsare`); le esegue `stripePagamenti.elabora()`, 2 s dopo
  (`richiediElaborazione`) e dal timer di 30 s di `server.js`, con chiavi di idempotenza (`cap-<id>`, `rel-<id>`, `ref-<id>`)
  e fino a 30 tentativi (poi `da_verificare`). Una nuova rotta che chiude una richiesta passa da `pagamenti.rimborsa`, non
  tocca `pagamento_stato` da sola.
- **La richiesta nasce a carta autorizzata**, non al clic: `POST /richieste` con Stripe crea riga + PaymentIntent
  (`capture_method: manual`, `automatic_payment_methods`) e fa `303` verso `/pagamento/<id>` **senza creare niente e senza
  svuotare il carrello**. La pagina (`views/cliente/pagamento.ejs` + `public/pagamento.js`, `stripe.confirmPayment` con
  `redirect: 'if_required'`) porta a `GET /pagamento/esito?payment_intent=...`. La richiesta la crea `completaRiga`, che
  chiamano **tre vie**: il ritorno del cliente, il webhook `POST /webhooks/stripe` (`payment_intent.amount_capturable_updated`,
  montato **prima** di `express.json()`: la firma si verifica sul corpo grezzo) e il **timer** (`elabora`: ogni pagamento
  `da_pagare` aperto da più di un minuto con la carta autorizzata). Quindi il webhook è comodo ma non indispensabile. Una
  UPDATE atomica `da_pagare → in_creazione` assicura che la crei uno solo. Il carrello è fotografato sulla riga (`righe`,
  `destinazione`, `note`): conta quello, non la sessione. Se la creazione fallisce (richiesta già aperta, guasto) la carta
  si **rilascia** e il testo per il cliente sta in `motivo` (`errore` è solo il guasto tecnico). Un PaymentIntent mai pagato
  si annulla dopo 70 min (`verificaPendente`); la pagina non si apre più dopo 60 min; una carta autorizzata oltre i 90 min
  non fa più nascere la richiesta. `flusso.nuovaRichiesta` con `metodoPagamento: 'stripe'` **non** riporta alla richiesta
  già aperta sul 23505 (a differenza del simulato): due carte non devono finire sulla stessa richiesta.
- **Incasso = totale dell'ordine** (`LEAST(autorizzato, totale ordine)`), mai di più; `requests.pagamento_importo` si
  aggiorna se è più basso. "Rinvia richiesta" con Stripe è un nuovo pagamento (`tipo = 'reinvio'`,
  `avviaPagamentoReinvio`) e riapre la stessa richiesta (`richieste.reinviaRichiesta(id, { metodoPagamento: 'stripe' })`);
  il ramo simulato di `flusso.reinviaRichiesta` resta per l'app.
- **`modo` ('test'/'live', dalla chiave) su ogni riga**: il `.env` locale punta al DB di produzione, e un'istanza con la
  chiave di prova non deve toccare i pagamenti veri (né il contrario). `elabora` e il webhook ignorano l'altro modo.
- **SDK 23 / API 2026-09-30**: parametri verificati con `tsc` (c'è in `mobile/node_modules`: file `.ts` temporaneo dentro
  il progetto, poi cancellarlo) e **contro la vera API in sandbox** (autorizzazione, incasso parziale, rimborso, rilascio,
  carta rifiutata riprovabile): l'API cambia fra le major, non fidarsi della memoria.
- **Provare la pagina nel browser** (pannello incorporato): l'iframe di Stripe si disegna con un secondo di ritardo (il
  primo screenshot è bianco: rifarlo) e a larghezze da telefono lo screenshot lo mostra tagliato a destra pur essendo
  largo il giusto (artefatto della cattura, non del layout); l'errore in console "unknown error occurred when fetching
  the script" viene dagli script di Google Pay/Apple Pay, bloccati lì. Non pagare dal browser con un cliente demo: il
  timer farebbe nascere la richiesta e arriverebbe ai banchi veri. Pulire con `DELETE FROM stripe_pagamenti` per id e
  `paymentIntents.cancel`.
- **Metodi di pagamento in elenco, non a schede (20/10/2026, richiesta esplicita: "le carte in fondo sono buggate, voglio poterle selezionare scorrendo")**: `public/pagamento.js` monta il Payment Element con
  `layout: { type: 'accordion', defaultCollapsed: true, radios: true, spacedAccordionItems: true, visibleAccordionItemsCount: 10 }`: una riga per metodo (Carta, Satispay, Klarna, Amazon Pay nel conto di prova;
  quelli veri li decide il Dashboard), tutte chiuse, si tocca quella voluta e si apre sul posto; sono tutte visibili insieme e la pagina scorre normalmente. Prima era `tabs`: Stripe mostrava 3 metodi e metteva gli altri
  dietro un `<select>` "altro" (logo tagliato, scomodo sul telefono). Se si preme "Paga" senza averne scelto uno Stripe apre da solo "Carta" e mostra gli errori dei campi (provato, nessuno stato bloccato).
  **Provati nella sandbox, uno per uno** (320, 375 e 1100 px: niente tagli né scroll orizzontale): carta 4242 → `requires_capture` e ritorno; carta rifiutata 4000…0002 → "La tua carta è stata rifiutata." e pulsante di nuovo attivo;
  3-D Secure 4000…3184 → finestra di prova, "Complete" → `requires_capture`; **Satispay** e **Amazon Pay** → pagina di prova di Stripe, autorizzando il ritorno porta `redirect_status=pending` e il PaymentIntent diventa
  `requires_capture` un attimo dopo (il server lo gestisce: `completaRiga` vede `processing` → pagina "Pagamento in corso" che si ricarica ogni 2 s, e il webhook/timer fanno nascere la richiesta); **Klarna** reindirizza a
  `js.playground.klarna.com` (non accessibile dal pannello: l'autorizzazione e il ritorno NON sono provati). Per le prove: un PaymentIntent sandbox con gli stessi parametri di `creaIntento`, `views/cliente/pagamento.ejs`
  resa con `ejs.renderFile` e un piccolo server (niente DB); **il pannello del browser deve essere VISIBILE** (`mcp__ccd_view__show_pane` con `preview`) o i clic dentro l'iframe di Stripe non arrivano (da nascosto il
  form resta anche bianco per diversi secondi). I metodi non a carta non hanno marca né ultime 4 cifre: la riga si incassa lo stesso (test "incasso con un pagamento non a carta"). Il testo sotto il pulsante dice
  "non ti viene addebitato nulla" (non più "la carta"); il resto del sito dice ancora "carta" (scheda "Pagamenti", ricevute): per Satispay/Klarna/Amazon Pay è impreciso, non toccato.
- **Email e telefono NON si chiedono nel pagamento (21/10/2026, richiesta esplicita)**: `preparaPagina` legge `users.email`/`telefono` dell'installatore (`contattiPerStripe`: email valida e telefono di 6-15 cifre con `+` facoltativo, altrimenti stringa vuota) e la vista li mette in `data-email`/`data-telefono`;
  `public/pagamento.js` crea il Payment Element con `fields.billingDetails.{email,phone}: 'never'` + `defaultValues`, e li ripassa a `confirmPayment` in `payment_method_data.billing_details` (con "never" Stripe pretende il dato lì). Un dato assente resta un campo di Stripe, così il pagamento non si blocca.
  L'email arrivava già come `receipt_email` del PaymentIntent (`creaIntento`). **Provato nella sandbox** (carta 4242: `requires_capture`, `billing_details` con email e telefono dell'account). **Resta**: nella scheda Carta Stripe mostra ancora, in fondo, la casella facoltativa "Salva le mie informazioni… più veloce" (**Link**): solo se la si spunta compaiono
  email (già riempita) e cellulare. Da codice non si toglie (con l'API di oggi `payment_method_types` non è più ammesso e `excluded_payment_method_types` non accetta `link`): si spegne in Dashboard > Impostazioni > Metodi di pagamento > Link, per sandbox e reale. Senza email nota (prima del cambio) in cima alla Carta compariva "Checkout sicuro e veloce con Link" con email e telefono: ora no.
- **Apple Pay (21/10/2026, richiesta esplicita)**: nel codice non serviva altro, il Payment Element lo mostra da solo (`automatic_payment_methods`, capture manuale supportata; il pulsante "Paga" della pagina apre il foglio di Apple Pay). Servono **tre cose fuori dal codice**: (1) Apple Pay attivo nel Dashboard
  (Impostazioni > Metodi di pagamento), nel modo giusto (reale o prova); (2) il **dominio registrato** su Stripe (Dashboard > Apple Pay > Aggiungi un nuovo dominio, o `applePayDomains.create`), una volta per dominio e per modo; (3) il **file di verifica** pubblicato a `https://<dominio>/.well-known/apple-developer-merchantid-domain-association`
  (rotta in `server.js` prima della sessione, perché `express.static` ignora le cartelle col punto; il file sta in `public/.well-known/` e lo scarica `node scripts/setup/scarica_file_apple_pay.js`, è uguale per tutti i conti e non ha segreti). Senza il file la registrazione del dominio fallisce; senza dominio o senza HTTPS Apple Pay non compare e si paga con la carta,
  senza errori. Compare solo su Safari/iPhone/iPad/Mac con una carta nel Wallet, e non su `localhost` né su `http://192.168...`. `node scripts/verifica/verifica_stripe.js` ora avvisa se il dominio non è registrato o il file non è raggiungibile. **Non provato su un dispositivo Apple.**
- **Buco dell'app chiuso il 19/10/2026**: con Stripe acceso `POST /api/v1/richieste` e `/reinvia` creano il pagamento, non la richiesta (vedi "App Android e
  sicurezza"). Il sito in produzione richiede HTTPS (Stripe.js e webhook in modalità reale).
- Schema: blocco "Pagamenti con Stripe" in fondo a `schema.sql` (applicato al DB condiviso il 14/10/2026; `session_id`
  del primo giro con Checkout è stata tolta con un `DROP COLUMN` dentro lo stesso blocco).

## Pagamenti lato installatore: stati, ricevute, email, annullamento (18/10/2026)

Le regole stanno in cima a `src/logica/pagamenti/pagamenti.js` (commento). Dove questa sezione contraddice frasi più vecchie qui sopra, vale questa.
- **La carta all'invio è solo AUTORIZZATA**; si incassa quando nasce l'ordine (un banco conferma e, con WhatsApp, un corriere prende la consegna). Nessun banco / annullo in fase 1 →
  il blocco si rilascia (cancel del PaymentIntent, stato `rilasciato`): nessun addebito, **nessun rimborso**, nessuna ricevuta (la ricevuta c'è anche per i pagamenti di prova: vedi `statoPagamento`).
- **Con l'ordine nato la carta è PAGATA, subito** (richiesta esplicita del 19/10/2026): quando il corriere accetta (o, a WhatsApp spento, il banco conferma) nasce l'ordine e la stessa transazione porta la riga di Stripe a `da_incassare`; la capture la fa `elabora()` pochi secondi dopo (e la pagina dell'ordine non si
  ricarica da sola), quindi per qualche secondo, o a lungo se la capture tarda, la scheda "Pagamenti" diceva ancora "Bloccati sulla carta · addebitati solo se BOREA conferma" e non aveva la ricevuta. Ora `calcolaStatoPagamento` dà `pagato` a una riga `da_incassare` **con un ordine** (`ordine` o `richiesta.order_id`), con importo
  `incasso_cent`, data = nascita dell'ordine (`aggiornato_il`) e **`ricevuta: true`** (il PDF c'è da subito, senza la carta: marca e ultime 4 cifre, e il link alla ricevuta di Stripe, arrivano con la capture; il numero R-… assegnato prima resta lo stesso). Senza ordine resta `bloccato`, e `autorizzato` non cambia. Anche lo Storico
  dell'installatore (`materialeOrdini`) legge `da_incassare` fra le righe "con ricevuta": un ordine in consegna ha "Ricevuta" e "Dettagli ›" senza aspettare la consegna, e "Ricevute del mese" lo include. Se la capture fallisce per sempre (`da_verificare`) la riga esce da `STATI_CARTA` e si ricade sulla richiesta: `pagato` senza ricevuta (pagamento `stripe` senza riga).
- **`pagamenti.statoPagamento(richiesta|ordine)`** (e `rigaPagamento`, `calcolaStatoPagamento` puro) dà alle viste UNA chiave: `bloccato` (autorizzato, o da_incassare **senza** ordine), `pagato` (incassato, o da_incassare con l'ordine nato),
  `annullato` (da_rilasciare, rilasciato, scaduto, **o richiesta annullata/senza risposta senza incasso anche se Stripe non ha ancora rilasciato**), `rimborsato` (da_rimborsare, rimborsato:
  raro, lo fa l'assistenza dal Dashboard). Prende l'ultima riga di `stripe_pagamenti` fra quelle che raccontano il destino della carta (con "Rinvia" ce ne sono due). **Senza riga di Stripe**
  (pagamento simulato dell'app / del PC, o richiesta di prima) lo stato si ricava dalla richiesta. **La ricevuta c'è anche per i pagamenti NON reali** (richiesta esplicita del 19/10/2026, al posto della
  vecchia regola "mai una ricevuta"): per un pagamento **simulato** con l'ordine nato (`pagamento_metodo = 'simulato'`; un 'stripe' senza la sua riga no: non si sa se è stato incassato); `calcolaStatoPagamento` dà `prova: true`
  (anche per le righe di Stripe nate con la chiave di prova, `modo = 'test'`), `datiRicevuta` lo passa e il PDF aggiunge in fondo al blocco PAGAMENTO "Pagamento di prova (sandbox): nessun addebito reale." (un'unica riga:
  `modelloRicevuta`). Il numero R-AAAA-NNNNNN è **lo stesso progressivo** dei pagamenti veri (come già per Stripe con la chiave di prova) e si assegna alla prima apertura del PDF (per il simulato non c'è un incasso che lo
  assegni): sul DB condiviso con la produzione i numeri di prova si intercalano ai veri. Nello Storico il link "Ricevuta" e "Ricevute del mese" li prendono (`materialeOrdini`: `pagamento_metodo = 'simulato'` e `pagamento_stato = 'pagato'`).
  Su un pagamento simulato **non parte l'email** "Pagamento ricevuto" (parte solo all'incasso Stripe, `dopoIncasso`). `pagamento_stato = 'rimborsato'` sulla richiesta significa ancora "il blocco è tornato", non un rimborso.
- **`partials/cliente/pagamenti.ejs`**: parametro `statoPag` (`dettaglioRichiesta` e `dettaglioOrdine` lo passano; **non `pagamento`, che nell'ordine è già il pagamento grezzo**), `ordineId` per i link; senza
  `statoPag` si deduce da `stato`. Quattro stati: bloccato (azzurro #E3EDF7 col lucchetto, materiale tratteggiato), pagato (verde #E3F3E6, "Pagata il 15/10 · Visa •••• 4242", a destra importo e link
  "Ricevuta"), annullato (UNA riga grigia con la carta di credito), rimborsato (riga grigia con "Ricevuta" e "Ricevuta rimborso"). "Visa •••• 4242" è in `.pg-nowrap` (non si spezza). Il dettaglio
  degli importi c'è solo in bloccato e pagato.
- **Cattura e dati dell'incasso** (`stripe_pagamenti.js`, `dopoIncasso`): la `capture` è rimasta **identica** (stessi parametri e chiave `cap-<id>`: aggiungere `expand` con la stessa chiave darebbe un errore
  di idempotenza di Stripe sui retry); dopo la UPDATE a `incassato` (solo se ha cambiato una riga: una email sola) si fa, **ognuno nel suo try/catch**: lettura di `latest_charge` (ricevuta di Stripe, marca e
  ultime 4 cifre) e UPDATE di `receipt_url`, `carta_marca`, `carta_ultime4`, `incassato_il`; numero della ricevuta; email (**senza await**, con `.catch`: una promessa rifiutata farebbe cadere Node).
  Un guasto lì non può far fallire né ripetere l'incasso, nemmeno se lo schema nuovo non è ancora applicato. Il `receipt_email` del PaymentIntent c'era già (`creaIntento`): la ricevuta di Stripe via email la manda
  Stripe da sola, solo in modalità reale. **Non c'è un recupero per gli incassi di prima**: i vecchi `incassato` non hanno carta né `incassato_il` (la pagina dice "Pagata il …" senza carta, data = ultimo aggiornamento).
- **Ricevute** (`src/logica/pagamenti/ricevute.js`, `src/logica/pagamenti/azienda.js`): `assegna(ordineId, tipo)` dà il numero R-AAAA-NNNNNN (anno italiano, progressivo per anno e per tipo, indice unico anche su ordine+tipo: rigenerare il PDF non
  cambia il numero; INSERT…SELECT…ON CONFLICT DO NOTHING con riprova); `datiRicevuta(ordineId, { tipo, clienteId })` ritorna null se non c'è una ricevuta (non incassato, annullato, altro cliente);
  `modelloRicevuta(d)` è la funzione PURA con tutti i testi (si prova senza decodificare il PDF), `disegnaRicevuta` la disegna con pdfkit (Helvetica: non c'è Sora nel PDF, il resto è come il mockup).
  Dati dell'azienda **solo da .env** (`AZIENDA_*`, `RICEVUTA_NOTA_FISCALE`, vedi README); la nota fiscale non si stampa se manca. Rotte: `GET /ordini/:id/ricevuta.pdf`, `/ordini/:id/ricevuta-rimborso.pdf`,
  `GET /storico/ricevute.pdf?mese=` (un PDF, una pagina per ricevuta; 404 se non ce ne sono: il pulsante "Ricevute del mese" compare solo se ce n'è almeno una). "Ricevute del mese" prende gli ordini del mese
  **per data di creazione dell'ordine** (come la lista), non per data di incasso. La ricevuta di rimborso si numera quando la si apre la prima volta, con la data del rimborso.
- **Email** (`src/logica/notifiche/email.js`, nodemailer, SMTP dal .env): `inviaPagamentoRicevuto` non lancia MAI; senza `SMTP_HOST` non parte niente; timeout brevi (10/10/20 s). I pulsanti usano `APP_URL` (senza, non ci sono).
- **Annullamento solo in fase 1** (`flusso.annullaRichiesta`): transazione con `SELECT … FOR UPDATE` della richiesta (come `rispondi`), poi UPDATE con `stato = 'in_attesa' AND NOT EXISTS (… esito = 'confermato')`
  (anche se il corriere non ha risposto); poi `pagamenti.rimborsa` = rilascio (mai `da_rimborsare` perché in fase 1 non è incassata). `dettaglioRichiesta` porta `annullabile`, `/api/richieste/:id` anche, e il polling
  di `app.js` nasconde `[data-annulla-richiesta]` da solo. `eliminaRichiesta` segue la stessa regola (se c'è un ordine o un banco ha confermato lancia `OrdineInLavorazione` **prima** di scrivere;
  `richiestaId` sull'errore per il link di ritorno). L'ordine non si annulla mai (vedi "Pagina dell'ordine"). L'app Expo non legge ancora `annullabile` sulla richiesta (il server rifiuta comunque, `ok: false`).
- **Storico dell'installatore**: riquadro blu "Consegne pagate in app: € X" con **due pulsanti** (`.sm-bottoni`, 38px): "Ricevute del mese" e "Esporta elenco"; link "Ricevuta" (`.sm-ricevuta`) accanto a "Dettagli ›" solo
  sugli ordini con un incasso vero (`materialeOrdini` → `ricevuta`, UNA query in più `SELECT DISTINCT request_id FROM stripe_pagamenti …`, solo per l'installatore); riga "Consegna pagata in app · corriere + 10% + IVA".
  **Le richieste ANNULLATE** (scheda "Annullata", in fila con gli ordini) **non si aprono e non sono un link** (19/10/2026, richiesta esplicita: `materialeOrdini` dà `href: null` e la partial disegna un `<div class="sm-ordine sm-ordine-chiusa">`
  senza freccia né `<details>`); quelle chiuse per "Nessuna risposta" sono un `<details>` come l'ordine, e aperte portano a "Dettagli ›" (da lì si rinvia). La rotta `/richieste/:id` di una annullata resta raggiungibile con l'indirizzo; l'app mobile ha il suo storico e non è stata toccata.
- **Schema**: blocco "Ricevute di pagamento e dati della carta (18/10/2026)" in fondo a `schema.sql` (4 colonne su `stripe_pagamenti`, tabella `ricevute`, due indici unici). **Applicato al DB condiviso il 19/10/2026** (prova a secco e poi `--applica`; verificate colonne, tabella e la query di numerazione su Postgres vero, in una transazione annullata): la VPS usa lo stesso
  database, quindi lo schema c'è già; sulla VPS servono `git pull`, `npm ci` (`pdfkit`, `nodemailer`) e le righe del `.env` (`AZIENDA_*`, `SMTP_*`). Nel `.env` **locale** c'è solo `AZIENDA_EMAIL=qako746@gmail.com`
  (provvisoria, richiesta esplicita del 19/10/2026): senza `SMTP_HOST` le email "Pagamento ricevuto" non partono.
- **Prove**: `test/pagamenti/pagamenti_stato.test.js`, `test/pagamenti/ricevute.test.js`, `test/notifiche/email.test.js`, `test/ordini/annullamento.test.js`, i test "incasso: …" di `test/pagamenti/stripe_pagamenti.test.js` e, in `test/sito/stato_ordini_e_richieste.test.js`, "richiesta in attesa/scaduta/annullata",
  "ordine pagato con Stripe", "ordine con il pagamento rimborsato", "il cliente non annulla MAI un ordine" e "storico con pagamenti incassati". Per **vedere** un PDF senza poppler: `pypdfium2` in una cartella fuori dal progetto
  (`pip install --target <cartella> pypdfium2`); il pannello browser incorporato scarica i PDF invece di mostrarli.
