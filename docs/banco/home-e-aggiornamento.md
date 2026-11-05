# Banco: home e aggiornamento automatico

Estratto da [`CLAUDE.md`](../../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

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
  `.nav-solo-stretta`, sempre) e la home è una sola schermata con le colonne che scorrono dentro; sotto i 900px le
  colonne si impilano e il menu in basso resta.
- Le colonne: **Da confermare** = `request_responses.esito = 'in_attesa'` con la finestra aperta; **Attesa corriere** =
  `esito = 'confermato'` e `corriere_stato = 'in_attesa'` (mai con il modulo WhatsApp spento: l'ordine nasce subito);
  **Da preparare** = `orders.stato = 'inviato'` **e `consegnato_il IS NULL`** (come nello Storico: un ordine segnato consegnato con la rotta provvisoria resta `inviato`; se restava in colonna, "Ispeziona" finiva nello Storico perché la pagina dell'ordine rimanda lì gli ordini consegnati; vale anche per il contatore `da_preparare` di `contatoriBanco`). **Pulsanti (richiesta esplicita del 14/10/2026, non rimettere "Verifica e conferma")**: nelle schede
  "Da confermare" **"Conferma"** (46px, arancio, a tutta larghezza) è un form `rispondi` con `azione=prezzo_richiesto` e `torna=home`: **conferma subito tutto
  il materiale senza aprire il dettaglio** (a modulo spento l'ordine nasce lì e la scheda passa in "Da preparare", altrimenti in "Attesa corriere"; se
  non riesce il server riporta al dettaglio con `?errore=`). Sotto, affiancati e larghi metà ciascuno (42px, `grid`: con `flex` risultavano disuguali),
  **"Ispeziona"** (link al dettaglio, con l'occhio) e **"Non disponibile"** (`rispondi` con `rifiuta` e `torna=home`, subito, senza conferma). Nelle
  schede "Attesa corriere" **"Ispeziona"** è una pillola da 38px in cima a destra (`.btn-ispeziona`; sotto ~300px di scheda va a capo) e il nome del
  cliente non è più un link. **"Da preparare" (richiesta esplicita del 14/10/2026, non rimettere "Prepara")**: due pulsanti uguali affiancati (42px,
  `.scheda-azioni-ordine`): **"Ispeziona"** apre `/distributore/ordini/<id>` (dal 19/10/2026: la pagina dell'ordine; prima
  apriva il dettaglio della richiesta) e **non tocca l'ordine**, che resta in colonna: la pagina non lo prende più in carico; c'è anche per un ordine **senza `request_id`**.
  **"Preparato"** (blu) è un form `POST /distributore/ordini/:id/preparazione` con `torna=home`: `prendiInCarico` porta l'ordine in `in_evasione` (esce dalla colonna: per il
  banco è **"In consegna"**) e avvisa il cliente. L'occhio è `iconaOcchio` (già c'era, per la password; stroke 1.9 dal CSS dei pulsanti).
- **Tempi**: soglie in `BACHECA` (`server.js`) → `data-soglia-*` sulla bacheca → blocco "Home del banco" di `app.js`: il
  server disegna le classi iniziali, lo script le aggiorna ogni secondo dagli istanti (secondi mancanti + `Date.now()`,
  non un contatore che decrementa). Rosso negli ultimi 180 s, "Nuova" per i primi 180 s. **La pillola dell'ordine "Da preparare" mostra SOLO i minuti che mancano ("8 min", "In ritardo") ed è SEMPRE verde**
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
