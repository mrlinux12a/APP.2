# Banco: home e aggiornamento automatico

Estratto da [`CLAUDE.md`](../../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Restyling della home e popup «Ispeziona» (10/11/2026, branch `test/v2-grafica`)

Richiesta esplicita dell'utente (brief + 4 mockup, risposte alle domande del 10/11/2026). **Dove una riga delle sezioni qui sotto dice il contrario, vale questa sezione.** Scelte da non disfare:
- **Barra unica, nuova, su tutte le pagine del banco** (anche Clienti, Storico e Anagrafica: cambia solo la barra, il contenuto di quelle pagine no): striscia scura `#22332E` da 8px, barra bianca con la ditta **in maiuscolo** e il nome del banco, schede Banco / Clienti / Storico ordini (voce attiva `#E3EDF7`), cerchio con le iniziali che apre la tendina (ditta e banco in testa, poi Anagrafica del banco, Esci in rosso). Sotto i 900px resta il menu in basso. Font **Inter** + **Space Grotesk**, caricati **solo per `ruolo = distributore`** (`partials/comune/app_head.ejs`); sul resto del sito nessun font in più.
- **Tre colonne, tre pallini**: Da confermare (arancio) · Attesa corriere (blu) · Da preparare (verde), dentro `.bacheca-colonne`. La pagina scorre (non è più «una sola schermata»). Ordine delle schede: Da confermare = la **scadenza più vicina in alto**; Da preparare = il **corriere più vicino in alto** (senza corriere in fondo); ricalcolato a ogni aggiornamento (`src/logica/banco/bacheca.js`).
- **Sulle schede solo i codici prodotto** (monospace) e la quantità `×N`: **niente nomi degli articoli, niente indirizzo, niente magazzino/giacenza**. Il codice della scheda è `#ORD-<id richiesta>` in Da confermare e Attesa corriere e `ORD-<id ordine>` in Da preparare (come fa il sistema: richiesta e ordine hanno id diversi). Le quantità sono solo `×N` (`products.unita_misura` non è usata).
- **Pulsanti** (sostituiscono «Conferma»/«Preparato» della home): Da confermare = **«Ispeziona»** + **«Non disponibile»** (subito, senza motivo e senza notifica) e sotto, a tutta larghezza, **«Accetta»** (= `rispondi` con `azione=prezzo_richiesto`, come il vecchio «Conferma»). Attesa corriere = solo «Ispeziona». Da preparare = «Ispeziona» + **«Ritirato dal corriere»**, che è il vecchio «Preparato» (stessa rotta `POST /distributore/ordini/:id/preparazione`: l'ordine esce dalla bacheca e per il banco è «In consegna» nello Storico). Sulla **pagina dell'ordine** il pulsante si chiama ancora «Preparato».
- **Timer** (sempre dai secondi del server, trasformati in istanti col `Date.now()` del browser): pillola `mm:ss` + barra che si accorcia in Da confermare (**rosso negli ultimi 120 s**, `BACHECA.urgenteSec`; l'etichetta «Nuova» non c'è più); a zero la scheda dice **«Scaduto»**, spegne i pulsanti e poi sparisce, **senza passare la richiesta ad altri banchi**. Attesa corriere: «da mm:ss» che sale + riquadro animato «Cerco un corriere…». Da preparare: riquadro verde «Corriere in arrivo tra mm:ss» (dal tempo scritto dal corriere, vedi «Orari del corriere»); a zero scrive **«Corriere arrivato al banco»**, che è una **stima** dal tempo dichiarato (nessun segnale nuovo dall'app dei corrieri). Il totale del ritiro è `corriere_minuti` (`arrivo.totale`).
- **Ogni scheda ha `data-lavoro`**: `r<id richiesta>` (e resta lo stesso quando la richiesta diventa ordine) oppure `o<id ordine>` per un ordine senza richiesta. È la chiave del popup.
- **Popup «Ispeziona»** (`views/partials/banco/ispeziona.ejs`, logica `src/logica/banco/ispeziona.js`, script `assets/js/15_banco_ispeziona.js`, rotta `GET /distributore/ispeziona/:chiave` in `src/routes/banco/home.js`, risposta `no-store`, 404 per chiavi sbagliate o lavori di un altro banco). Con JS «Ispeziona» apre il popup (senza JS il collegamento porta alla pagina di prima). Contenuto: cliente (nome, P.IVA, telefono **testo semplice, niente `tel:`** come da richiesta del 21/10/2026, «Apri scheda cliente» solo se c'è il legame), blocco del tempo della fase, tabella **«Materiale richiesto»** con Listino / «Prezzo cliente» / Totale. **«Prezzo cliente» = prezzo del banco, IVA esclusa** (la regola del 16/10/2026; l'ordine usa i prezzi salvati, la richiesta li calcola sul listino del banco) e il totale include il RAEE. Pulsanti per fase: Chiudi sempre; Da confermare «Non disponibile» + «Accetta ordine»; Da preparare «Ritirato dal corriere». Le azioni usano le rotte di sempre, in JSON (`Accept: application/json`), senza lasciare la pagina.
- **Il popup aperto segue il lavoro**: a ogni `minuteria:bacheca` (l'evento che la home lancia dopo ogni aggiornamento sul posto) rilegge il frammento; **si ridisegna solo se cambia `data-isp-firma`** (fase, materiale, cliente, corriere...: i secondi che scorrono non contano, così i conti alla rovescia non ripartono). Se il lavoro esce dalla bacheca (ritirato, scaduto, rifiutato, annullato, chiuso su un altro banco) il popup passa a «Non più in bacheca» con l'avviso del motivo e i soli pulsanti di chiusura. Chiusura con X, Esc o clic fuori; il focus resta dentro (trappola del focus, il resto della pagina `inert`), bersagli da almeno 44px, `prefers-reduced-motion` rispettato. Sul telefono il pannello occupa quasi tutto lo schermo e la tabella scorre in orizzontale dentro il suo riquadro (provato a 375px).
- Prove: `test/sito/banco_home_e_clienti.test.js` (home), `test/sito/banco_ispeziona.test.js` (popup in tutte le fasi, cambio di fase, 404, «Ritirato dal corriere» in JSON). Il DB finto ha `corriere_minuti` sull'ordine 1280 e i listini salvati nelle righe dell'ordine 1295. Per vedere la home in un browser **senza toccare il database vero** si può avviare il server con il DB finto di `test/sito/_aiuti/server_finto.js` (`avvia(porta)`, login `banco` / `password-di-prova`) da uno script usa-e-getta.

## Home del banco: bacheca a 3 colonne (09/10/2026)

`GET /distributore` (`server.js`) + `views/banco/richieste.ejs`, classi `banco-*`, `colonna*`, `scheda*`
(blocco "Home del banco" di `style.css`; la logica di risposta, corriere e ordini non è cambiata). Da confermare →
Attesa corriere → Da preparare, senza numeri d'ordine delle fasi. Convenzioni da non rompere:
- **Niente interruttore "ricezione"**, niente riquadri contatore, niente riga "filiale · zona": richieste esplicite.
  Il banco riceve sempre (`richieste.distributoriCandidati` non guarda più `ricezione_attiva`); la rotta
  `POST /api/distributore/stato` non esiste più.
- **Intestazione e tendina dell'utente sono UNA sola per tutto il banco** (richiesta esplicita del 14/10/2026,
  non farne un'altra): `partials/banco/banco_testa.ejs` = ditta e filiale (`res.locals.bancoTesta`, in cache 60 s dal
  middleware di `server.js`), schede **Banco / Clienti / Storico ordini** (dal 19/10/2026 "Storico ordini" è una scheda del menu come le altre, la terza dopo Clienti, con l'icona `iconaOrdini`:
  prima era un pulsante accanto al cerchio dell'utente, `.banco-storico`, **non rimetterlo**) e cerchio con le iniziali della
  **filiale** ("Banco Genova Fegino" → BG) che apre la tendina `.menu-account` (**Anagrafica del banco** in cima dal 20/10/2026, poi Esci; Clienti compare lì solo sotto i 900px, dove le schede della barra spariscono; **non c'è più "Storico ordini"
  nella tendina**: sotto i 900px sta nel menu in basso, che ha tre voci, Home / Clienti / Storico: `nav_distributore` con `attivo: 'storico'` nello Storico e nella pagina dell'ordine). **Niente campanella delle notifiche** (tolta su richiesta esplicita
  del 14/10/2026, non rimetterla: `/notifiche` esiste ancora ma il banco non ha un link per arrivarci). La home la include; **tutte le altre pagine del
  distributore passano da `partials/comune/appbar.ejs`, che per `ruolo = distributore` delega qui** (anche `/notifiche` e la
  pagina `errore`): un `appbar` nuovo in una vista del banco funziona da solo. Sotto la barra le pagine interne hanno
  una riga con freccia e titolo (`intestazione`/`indietro` di `appbar`), la home no. La scheda attiva si sceglie da
  `res.locals.percorso` (= `req.path`): "Storico ordini" è accesa su `/distributore/storico` **e** su `/distributore/ordini/...` (un
  ordine fa parte dello storico). **Niente "Punti vendita"** nel menu del banco e `/punti-vendita` gli risponde 404.
- **Da 900px** il menu in basso non si mostra su nessuna pagina del banco (`nav_distributore`, classe
  `.nav-solo-stretta`, sempre); sotto i 900px le colonne si impilano e il menu in basso resta. (Dal 10/11/2026 la home **non** è più una sola schermata con le colonne che scorrono dentro: scorre la pagina.)
- Le colonne: **Da confermare** = `request_responses.esito = 'in_attesa'` con la finestra aperta; **Attesa corriere** =
  `esito = 'confermato'` e `corriere_stato = 'in_attesa'` (mai con il modulo WhatsApp spento: l'ordine nasce subito);
  **Da preparare** = `orders.stato = 'inviato'` **e `consegnato_il IS NULL`** (come nello Storico: un ordine segnato consegnato con la rotta provvisoria resta `inviato`; se restava in colonna, "Ispeziona" finiva nello Storico perché la pagina dell'ordine rimanda lì gli ordini consegnati; vale anche per il contatore `da_preparare` di `contatoriBanco`). **Pulsanti (richiesta esplicita del 14/10/2026, non rimettere "Verifica e conferma")**: nelle schede
  "Da confermare" **"Conferma"** (dal 10/11/2026 si chiama **"Accetta"**: vedi la sezione in cima; 46px, arancio, a tutta larghezza) è un form `rispondi` con `azione=prezzo_richiesto` e `torna=home`: **conferma subito tutto
  il materiale senza aprire il dettaglio** (a modulo spento l'ordine nasce lì e la scheda passa in "Da preparare", altrimenti in "Attesa corriere"; se
  non riesce il server riporta al dettaglio con `?errore=`). Sotto, affiancati e larghi metà ciascuno (42px, `grid`: con `flex` risultavano disuguali),
  **"Ispeziona"** (link al dettaglio, con l'occhio) e **"Non disponibile"** (`rispondi` con `rifiuta` e `torna=home`, subito, senza conferma). Nelle
  schede "Attesa corriere" **"Ispeziona"** è una pillola da 38px in cima a destra (`.btn-ispeziona`; sotto ~300px di scheda va a capo) e il nome del
  cliente non è più un link. **"Da preparare" (richiesta esplicita del 14/10/2026, non rimettere "Prepara")**: due pulsanti uguali affiancati (42px,
  `.scheda-azioni-ordine`): **"Ispeziona"** apre `/distributore/ordini/<id>` (dal 19/10/2026: la pagina dell'ordine; prima
  apriva il dettaglio della richiesta) e **non tocca l'ordine**, che resta in colonna: la pagina non lo prende più in carico; c'è anche per un ordine **senza `request_id`**.
  **"Preparato"** (sulla home dal 10/11/2026 è **"Ritirato dal corriere"**; sulla pagina dell'ordine resta "Preparato"; blu) è un form `POST /distributore/ordini/:id/preparazione` con `torna=home`: `prendiInCarico` porta l'ordine in `in_evasione` (esce dalla colonna: per il
  banco è **"In consegna"**) e avvisa il cliente. L'occhio è `iconaOcchio` (già c'era, per la password; stroke 1.9 dal CSS dei pulsanti).
- **Tempi**: soglie in `BACHECA` (`server.js`) → `data-soglia-*` sulla bacheca → blocco "Home del banco" di `app.js`: il
  server disegna le classi iniziali, lo script le aggiorna ogni secondo dagli istanti (secondi mancanti + `Date.now()`,
  non un contatore che decrementa). Rosso negli ultimi 180 s, "Nuova" per i primi 180 s (**dal 10/11/2026: rosso negli ultimi 120 s e niente "Nuova"**; la pillola «8 min» qui sotto è ora il riquadro «Corriere in arrivo tra mm:ss»: vedi la sezione in cima). **La pillola dell'ordine "Da preparare" mostra SOLO i minuti che mancano ("8 min", "In ritardo") ed è SEMPRE verde**
  (richiesta esplicita del 21/10/2026: via l'orario "ore HH:MM", via il rosso sotto i 15 minuti, via `data-soglia-arrivo` dalla bacheca e `.vicino`/`.pillola-ora`; `BACHECA.arrivoVicinoMin` resta solo per il riquadro "Ritiro" della pagina dell'ordine). A zero la scheda si spegne e la pagina si ricarica. La pillola dell'ordine conta fino al **ritiro del corriere**
  (`corriere_risposto_il` + `corriere_minuti`, in SQL `corriere.ritiroSql('o')`): è il tempo che il corriere ha scritto su WhatsApp, l'unico orario del
  corriere che il banco vede (vedi "Orari del corriere"). Senza corriere non c'è pillola.
- Il ritardo/`secondi_da_risposta`/`secondi_arrivo` si calcolano **in SQL** (`NOW()`), mai con un `Date` di JS sulle colonne
  `TIMESTAMP` (vedi sopra); `corriere_risposto_il` e `corriere_arrivo_il` sono `TIMESTAMPTZ`. Tre articoli al massimo per scheda, poi "+N altri
  articoli". Prova: `test/sito/banco_home_e_clienti.test.js` ("home del banco...") con il DB finto.

## Aggiornamento automatico del banco

Le pagine del banco (home, ordini, clienti, dettaglio richiesta) hanno `data-versione` = i contatori
con cui sono state disegnate e chiedono ogni 5 s `/api/distributore/novita` (gli stessi contatori, più
ultima richiesta/ordine e corrieri in attesa): se cambiano si ricaricano, anche se la scheda era in
secondo piano (aspettano di tornare visibili o che finisca la digitazione). Prima era una ricarica a
tempo che saltava le schede nascoste. Le risposte hanno `Cache-Control: private, no-cache`.
**Eccezione: la HOME non si ricarica più** (21/10/2026): le sue tre colonne si aggiornano sul posto, vedi "Suono, tempo reale e notifiche del computer del banco". Le altre pagine
(storico, clienti, dettaglio richiesta, ordine) si ricaricano ancora, ma dopo aver fatto sentire il suono in corso.
