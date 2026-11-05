# Banco: Storico ordini e Clienti

Estratto da [`CLAUDE.md`](../../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Storico ordini del banco (14/10/2026)

`GET /distributore/storico` (`server.js`, logica in `src/logica/banco/storico.js`) + `views/banco/storico.ejs`, classi `sto-*` (blocco
"Storico ordini del banco" in fondo a `style.css`). **Prende il posto di "Tutti gli ordini" e di "Storico richieste"**: la vecchia lista
`/distributore/ordini` è un **301** verso lo storico (con la query string; il dettaglio `/distributore/ordini/:id` e i suoi POST non
sono cambiati, i ripieghi dei POST vanno a `/distributore/storico`) e le richieste chiuse non hanno più una pagina. Richieste esplicite,
non rimetterli: niente freccia indietro (è una scheda dell'intestazione, come Clienti: la vista include `banco_testa`, non `appbar`), niente
nota "Flusso del banco: …" in fondo.
- **Stato di un ordine**: `statoStorico(o)` è l'unico punto (e `CONDIZIONE_STATO` è la stessa regola in SQL: conteggi delle schede e filtro
  della lista non possono divergere). **`consegnato_il` si guarda per primo**: con `/consegnato-prova` un ordine risulta consegnato restando
  `inviato` (oggi l'ordine #91 è così). Poi `inviato` = **Da preparare (blu)**, `in_evasione` (Preparato) **e** `evaso` (stato degli ordini vecchi, partiti con la bolla: ora non lo scrive più nessuno) = **In consegna (verde)**,
  consegnato = grigio. **Stati dell'ordine per il banco** (richiesta esplicita del 19/10/2026, valgono in Storico, scheda cliente, CSV del cliente e pagina dell'ordine): non esistono più "In preparazione" né "Partito"
  (chiavi `da_preparare` / `in_consegna` / `consegnato`, classi `sto-st-*` e `ric-st-*`); "In consegna" è dopo "Preparato" (vedi "Pagina dell'ordine del banco").
- **Righe apribili** (richiesta esplicita del 19/10/2026 sera; prima solo "Da preparare" era un link e le altre "righe fisse", **non rimetterle**): OGNI riga è un `<button type="button" class="sto-riga" aria-expanded aria-controls="dett-N" data-sto-apri>` dentro `<div class="sto-voce" id="oN" data-voce="N">`, con sotto il
  pannello `<div class="sto-dettaglio" id="dett-N" data-url="/distributore/storico/N/dettaglio" hidden>`, vuoto. Il blocco "Storico ordini: righe che si aprono" di `assets/js` al primo clic carica il frammento (`fetch`, "Caricamento…", errore con "Riprova", un `redirect` = sessione scaduta → ricarica per andare al login),
  **una voce aperta alla volta** (aprirne un'altra chiude la prima; un secondo clic la richiude; se la voce chiusa sta sopra, `scrollBy` tiene ferma la riga cliccata), il chevron (`iconaGiu`) gira di 180° (0,15 s) e la voce aperta ha sfondo `#F7FAFD` col pannello a barra blu a sinistra. **L'id aperto sta nell'ancora** (`#o149`, con `replaceState`: non sporca la cronologia):
  dopo una ricarica (anche quella automatica della pagina), o tornando dalla pagina dell'ordine con la freccia, la stessa voce si riapre (`daAncora`, anche su `hashchange`). Sotto i 900px la card è la voce (riga + pannello) e il pannello è a una colonna.
- **"Da incassare"** (ex "Totale"): `pricing.importi({ ordine }).banco.totale` = materiale + RAEE + IVA (78,69), **non** `totaleOrdine` (98,76: comprende la consegna e il servizio pagati in app, soldi della piattaforma). La lista legge le colonne di `COLONNE_IMPORTI` (`src/logica/banco/storico.js`); una prova (`test/banco/storico_dettaglio.test.js`) controlla che ci siano
  tutte quelle che `importiOrdine` e `ivaPctOrdine` leggono: se il calcolo ne usa una nuova va aggiunta lì, o la lista dà un importo sbagliato in silenzio. L'IVA di oggi (`getIvaPct`, in cache) è solo il ripiego per gli ordini senza IVA salvata.
- **Il pannello** (`GET /distributore/storico/:id/dettaglio` → `views/partials/banco/storico_dettaglio.ejs`, dati da `src/logica/banco/storico_dettaglio.js`; classi `sto-d-*`): un **frammento** HTML (non una pagina), solo ordini del banco loggato (404 testo semplice altrimenti), **sola lettura** (non chiama `prendiInCarico`: aprire il dettaglio non cambia l'ordine; provato con `scrittureDa`).
  Tre colonne (1,55fr | 1fr | 260px): **Materiale** (righe a prezzo del banco, "N articoli · M pezzi", piede "Merce · RAEE se > 0 · IVA · Da incassare dal cliente", "richiesti N, confermati M" in arancio con la risposta parziale), **Come è andata** (`cronologia`: Ricevuto, Confermato da te, Corriere X ha accettato (con ", ritira alle HH:MM": il tempo scritto su WhatsApp), Partito / Partito · in viaggio (passo in corso, pallino
  bianco col bordo verde), Consegnato · confermato dal cliente; passi futuri tratteggiati con ora "—"; **un passo senza dati non c'è**; sotto l'indirizzo e "Corriere X") e i pulsanti "Apri ordine completo ›" e "Scheda cliente ›" (solo se il cliente ha indicato questo banco: `anagrafiche.legame`). Una query per le righe e una per la risposta, più
  (in parallelo) il legame, l'indirizzo del cliente solo se l'ordine non ha la destinazione e l'IVA in cache. `?torna=` (la pagina dello Storico com'è, scritta dallo script) vale solo se è una pagina del banco (`ritornoBanco`); "Apri ordine completo" porta `torna` + `#oN`, così la freccia della pagina dell'ordine riporta allo Storico con la voce aperta.
  Prove: `test/banco/storico_dettaglio.test.js` (parti pure + guardia sulle colonne), "banco: dettaglio di una riga dello Storico (frammento)…" e "banco: Storico ordini con schede…" in `test/sito/banco_ordine.test.js`, `test/sito/banco_storico.test.js`.
- **Filtri nell'URL**, tutti lato server: `?stato=tutti|da_preparare|in_consegna|consegnati&periodo=oggi|7|30|tutti&q=&pagina=N`
  (default tutti e 7 giorni; valori sconosciuti tornano al default; i vecchi `in_preparazione` e `partiti` valgono `in_consegna`: `FILTRI_VECCHI`). Il periodo ragiona in **ora italiana** sulle colonne `TIMESTAMP` UTC: "oggi" è
  la mezzanotte di Roma, 7 e 30 sono gli ultimi N giorni da adesso. La ricerca è `ILIKE` sulla ragione sociale, più `o.id =` se quello che
  si scrive (tolto un `#`) è solo cifre; i `%` e `_` scritti dall'utente valgono per sé; sempre con segnaposto. **I conteggi delle schede** sono una
  query con `COUNT(*) FILTER` con gli stessi filtri di periodo e ricerca ma **senza** lo stato (il numero dice cosa si trova cliccando). Lista: `o.id DESC`,
  50 per pagina (`partials/comune/paginazione.ejs`, con `parametro: 'pagina'` e `unita: 'ordini'`; una pagina oltre l'ultima mostra l'ultima), materiale con una
  sola lettura di `order_items` per tutta la pagina. Righe raggruppate per giorno italiano (`fmt.giornoRoma`); "N ordini" conta le righe della pagina.
- **Aggiornamento automatico**: la pagina ha `data-auto-refresh` e `data-versione` come le altre del banco, e il blocco in `app.js` **non ricarica**
  finché un campo con `data-non-ricaricare` (la ricerca) ha testo non ancora inviato (`value !== defaultValue`), anche senza fuoco. Si ricarica
  solo quando i contatori della home cambiano: una consegna (`consegnato_il`) non li cambia, quindi non fa ricaricare lo storico da sola.
- **Sotto i 900px**: ricerca a tutta larghezza, schede che scorrono di lato senza barra, la tabella diventa una lista di card (quattro righe, senza la
  città). "Storico ordini" è una scheda del menu in alto (da 900px) e una voce del menu in basso (sotto i 900px: Home / Clienti / Storico), non più un pulsante vicino al cerchio né una voce della tendina.
- **La freccia indietro di ordine e richiesta torna da dove si è arrivati** (richiesta esplicita del 19/10/2026; prima era fissa su `/distributore`, la home): chi porta a
  `/distributore/ordini/:id` o `/distributore/richieste/:id` aggiunge `?torna=<pagina di partenza, codificata>` con `conRitorno` (`src/comune/http.js`, in `app.locals` per le viste): la riga dello Storico
  "Da preparare" (con i filtri e la pagina: `link({})`; il "Vedi ordine #N ›" della scheda cliente non c'è più). Le due pagine leggono `ritornoBanco(req.query.torna)`: **vale solo una pagina del
  banco** (home, Storico, elenco e scheda cliente, richiesta; con query e ancora), tutto il resto torna alla home, mai un indirizzo esterno (open redirect). Dalla richiesta si va all'ordine solo col redirect (l'ordine "Da preparare" non ha un link dalla richiesta: la route la rimanda da sola, passando `torna` com'è);
  la freccia dell'ordine riporta quindi alla pagina di partenza (la home, lo Storico...), non alla richiesta. Nelle viste il valore passato alle due pagine si chiama
  `paginaPrecedente`, **non `indietro`**: `partials/banco/banco_testa` (inclusa) lo leggerebbe e disegnerebbe una seconda freccia. Non passa dai POST (tranne "Preparato" dalla pagina dell'ordine, che manda `torna` e lo restituisce): dopo un errore di risposta la
  freccia riparte dalla home. Prove: `test/middleware/http.test.js` (`ritornoBanco`, `conRitorno`) e "banco: la freccia di ordine e richiesta riporta…" in `test/sito/banco_avvisi.test.js`.
- Prove: `test/banco/storico_banco.test.js` (parti pure) e i quattro test "banco: Storico ordini…" / "/distributore/ordini porta allo Storico" in
  `test/sito/*.test.js` (DB finto che tiene SQL e parametri delle query). Per provarlo sul DB vero serve un utente `distributore` di prova (non quelli
  del README: sono persone vere): `INSERT INTO users` con `bcrypt`, poi cancellarlo con le sue `session`. Aprire il dettaglio di un
  ordine `inviato` non lo tocca più (dal 19/10/2026); lo porta "In consegna" solo "Preparato" (POST `/preparazione`, che avvisa il cliente).

## Clienti del banco (14/10/2026)

`views/banco/clienti.ejs` e `views/banco/cliente.ejs` (classi `cli-*`, blocco "Clienti del banco" in
fondo a `style.css`); logica di approvazione e rifiuto **invariata** (`POST .../decidi`, stessi campi `codice_cliente`, `note`, `azione`). La rotta
`POST .../sconti` (campi `sconto<n>_<ambito>_<chiave>`) c'è ancora, **ma la pagina non ha più il modulo** (vedi "Pagina del cliente approvato"). Richieste esplicite, non rimetterli:
- **Niente freccia indietro né riga titolo** in cima all'elenco: "Clienti" è una scheda dell'intestazione, quindi le due
  pagine includono `partials/banco/banco_testa` **senza** `intestazione`/`indietro` (non passare da `partials/comune/appbar.ejs`). Titolo
  "Clienti" + campo di ricerca `[data-cerca-clienti]` (non `[data-ricerca]`: quello è la ricerca del catalogo).
- **Ricerca nel browser** (blocco "Clienti del banco" di `app.js`): ogni `[data-cliente]` porta in `data-cerca` ragione
  sociale, P. IVA e codice; ogni parola scritta deve comparire; le sezioni vuote spariscono e il numero accanto al titolo
  conta i rimasti; "Nessun cliente trovato." se non resta niente.
- Sezioni: **Da approvare** (solo se ce ne sono; scheda con bordo arancio e pulsante "Verifica ›"), **Clienti approvati**
  (tabella a 5 colonne, righe impilate sotto i 900px) e, in fondo, **Non riconosciuti** (i rifiutati: da lì si apre la
  pagina e si può ripensarci; la richiesta non li citava ma sparirebbero). Ordine per ragione sociale fatto nella rotta
  (`localeCompare`), non dal DB.
- **Ultimo ordine** = `MAX(orders.creato_il)` del cliente con **questa filiale** (`orders.distributor_id`), in una
  sub-query `LEFT JOIN` dentro `anagrafiche.clientiDelDistributore`: mai una query per riga. Si mostra con
  `fmt.dataSolaRoma`; le date di iscrizione con `fmt.dataOraRoma` (prima `dataOra` stampava l'ora UTC: 2 ore indietro).
- Il cerchio con le iniziali è `partials/comune/iniziali` con il parametro `tono` (`arancio` = da verificare, `grigio` =
  rifiutato, nessuno = blu/approvato).
- Pagina del cliente (**da verificare e rifiutato**): colonna sinistra = dati (fatturazione in 3 colonne, "Controlla su VIES ↗" in una nuova scheda,
  sede legale e consegna abituale, contatti: il telefono non è un collegamento, l'email sì), destra = decisione. Sotto i 900px
  la decisione va sopra i dati (l'**approvato** ha un altro layout: una barra con i dati e il materiale a tutta larghezza, vedi sotto). **Una voce senza dato non si
  disegna** (PEC, consegna, referente, telefono, email). La consegna abituale è una stringa sola
  ("Via X 1, 16131 Genova (GE)"): la via è ciò che sta prima della prima virgola. La città si mostra com'è salvata
  (un cliente ha "Génova" con l'accento nel DB: richiesta esplicita di non correggere i dati).
- Il riquadro "È un tuo cliente?" è `sticky` con `top: 80px` (64px dell'intestazione, anch'essa sticky, + 16px): con
  `top: 16px` finirebbe sotto la barra. La conferma sul rifiuto è un `onclick="return confirm(...)"` sul solo pulsante
  "rifiuta" (il form è uno, con i due pulsanti `name="azione"`).
- **Pagina del cliente approvato** (richiesta esplicita del 18/10/2026; al posto dei blocchi "Da incassare" e "Sconti concordati", non rimetterli) **e layout del 22/10/2026**
  (richiesta esplicita "più spazio verticale agli ordini", mockup `docs/mockup/banco-cliente-spazio.png`; solo per lo stato 'approvato', "Da verificare" e "Rifiutato" sono rimasti
  com'erano). **Niente più colonna di sinistra da 360px né scorrimento dentro la scheda**: una **barra bianca** (`.cli-barra`, ~60px, a tutta larghezza sotto l'intestazione del banco)
  con freccia tonda da 40px, iniziali da 40, nome (Sora 19) con la pillola "● Approvato", sotto "tipo · cod. cliente X · P.IVA Y" (voci vuote omesse: **non c'è più "referente · iscritto il"**,
  che ora si legge nel pannello) e, a destra, le pillole da 36px: telefono (testo, **non cliccabile**, niente `tel:`), email (`mailto:`) e "Dati cliente ▾". Quest'ultimo è il `<summary>`
  di un `<details class="cli-dati-det">` che sta DOPO la riga: da 900px il CSS lo posiziona in assoluto in fondo a destra della riga (`right: var(--cli-gutter)`, che replica i bordi
  del contenuto di `.cli-pagina-larga`) e il pannello si apre **sotto la barra spingendo giù la pagina**, senza JS, chiuso all'arrivo; sotto i 900px la barra va su due righe (nome sopra, pillole sotto
  che scorrono di lato) e il pulsante è a tutta larghezza. Nel pannello (`.cli-pannello`, blocchi `auto-fit` da 260px = 3-4 colonne) c'è tutto ciò che stava a sinistra: Dati di fatturazione (+ VIES),
  Indirizzi (sede legale, consegna abituale), Cliente approvato (codice, **referente, iscritto il**, approvato il, note interne). Poi `partials/banco/materiale_cliente.ejs` (classi `mc-*`, col contesto
  scritto in testa: in app l'installatore paga SOLO il servizio, il materiale lo paga dopo al banco, che qui ha tutto ciò che deve incassare, IVA inclusa; il servizio non compare mai) a tutta
  larghezza (`.cli-pagina-larga`, max 1600px; `.cli-layout-approvato` è una colonna sola). **Scorre la PAGINA**: via `max-height` dalla scheda e `overflow-y` dall'elenco; la scheda ha
  `overflow: clip` e **NON `hidden`** (hidden la renderebbe un contenitore di scorrimento e lo sticky smetterebbe di funzionare; un test lo controlla). La testata `.mc-fisso` (riga dei filtri:
  "Materiale ordinato" · mesi · "Altri mesi" · a destra "Per ordine/Per articolo" ed "Esporta"; sotto la **striscia** `.mc-striscia` con "N ordini", "N articoli · M pezzi", nota
  "Prezzi IVA inclusa · il cliente li paga a BOREA" e a destra il riquadro azzurro "Totale <mese> € X, di cui IVA") da 900px è `position: sticky; top: 64px` (l'altezza di `.banco-testa`: se cambia,
  aggiornarla) e prende l'ombra `.staccato` da un blocco di `app.js` ("Pagina di un cliente approvato", misura la posizione a ogni scorrimento con una rAF: **nel pannello del browser
  incorporato rAF e scroll non partono**, la logica si prova eseguendo il blocco a mano e dispatchando `scroll`); sotto i 900px non è sticky. **Sono spariti** `.mc-box*`, `.mc-riepilogo`, `.mc-fondo` (il
  totale in fondo ripeteva quello della striscia), il testo "Il cliente ha pagato solo il servizio…" e `.cli-intesta-app`. Righe: ordine da 50px (freccia · "Ordine #id" · data e ora · "N articoli" ·
  stato · totale; sotto i 900px su due righe), **aperto all'arrivo solo il primo ordine** (prima i primi due), articoli in righe da 44px con nome e "Cod. …" sulla stessa riga (`.mc-art-riga`).
  Misure a 1366×768 e 1440×800 con il primo ordine aperto (3 articoli): sotto la testata si vedono **6 righe di ordine + 3 righe di articolo** senza scorrere, **11-12 ordini** scorrendo
  (la testata resta); la richiesta diceva "almeno 8 righe di ordini": a pagina ferma sono 6 (+3 di articoli), il resto si vede scorrendo. Fra 900 e ~1075px i filtri vanno su due righe. **Un solo calcolo**: `materiale.materialeCliente(distributorId, clienteId, { mese, vista, ditta })` sta sopra `materialeOrdini` e non rifà
  conti. Differenze volute dallo Storico dell'installatore: stato = `storico_banco.statoStorico` (Da preparare / In consegna / Consegnato, pillole `sto-pillola
  sto-st-*`); totale ordine = `pricing.importiOrdine` (come l'installatore: con le righe arrotondate una per una può differire di 1-2 centesimi dalla somma delle righe) e IVA
  quella **salvata nell'ordine** (`ivaPctOrdine`), non `getIvaPct()` di oggi; "di cui IVA" = totale − somma dei netti di riga; "Articoli · pezzi" = articoli **distinti**
  (codice + nome) e somma delle quantità; ordine per `creato_il` decrescente, a parità l'id. La vista per articolo somma per (codice, nome) anche con prezzi diversi ("prezzi diversi",
  `cad` null; sotto i 640px "Negli ordini" passa sotto il nome); lo Storico dell'installatore invece divide per prezzo. Filtri: al massimo 2 mesi in segmenti + "Tutto", gli
  altri in una `<select name="mese" onchange="this.form.submit()">` ("Altri mesi", con `<noscript>` "Vai"); sono tutti GET, con `#materiale`; solo il primo ordine è aperto.
  **Niente più "Vedi ordine #N ›"** (richiesta esplicita del 19/10/2026; `linkOrdineBanco` e `href` degli ordini sono spariti da `materialeCliente`): la pagina dell'ordine c'è per tutti gli stati ma qui non c'è più un link: ci si arriva dalla home
  ("Ispeziona") o dallo Storico. **CSV** `GET /distributore/clienti/:id/materiale.csv?mese=` (404 se il cliente non è approvato): `;`, BOM, dal più vecchio, Data;Ordine;Stato;
  Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl., ultima riga il totale, **senza servizio**; file `materiale_<ragione-sociale>_<AAAA-MM|tutto>.csv` (`nomeFileCsvCliente`,
  slug ASCII). `Response.text()` toglie il BOM: nei test si leggono i byte. **Sconti**: la rotta `POST .../sconti` e le regole salvate (`client_discount_rules`) restano, ma senza
  modulo; il partial `riga_sconti.ejs` e i suoi stili (`.cli-sotto-titolo`, `.cli-elenco-sconti`) restano finché non si decide se eliminarli del tutto. Prove: test
  "banco: \"Materiale ordinato\"..." in `test/sito/*.test.js` e, in `ordini/materiale.test.js`, `materialeCliente`, il CSV del banco e il partial (stato vuoto, "Altri mesi"). Verifica
  visiva senza toccare il DB vero: pagina usa-e-getta con la **vista vera** (`ejs.renderFile` di `views/banco/cliente.ejs` con locals finti: `cliente`, `rapporto`, `materiale`, `tipi`, `fmt`, `euro`,
  `bancoTesta`, `currentUser`, le icone), `style.css` e `app.js` veri serviti da un piccolo server in una cartella fuori dal progetto, su più larghezze (1440, 1366, 960, 768, 375). Il test
  "banco: cliente approvato con tutti i dati…" in `test/sito/banco_home_e_clienti.test.js` controlla anche il CSS (niente `max-height`, `overflow: clip`, sticky solo da 900px).
- Prova: `test/sito/banco_home_e_clienti.test.js` ("banco: elenco clienti..." e "banco: pagina del cliente..."). Nel browser, per provare
  approvazione e rifiuto non usare i clienti veri (un "da approvare" è una persona reale): creare due clienti di prova,
  provare, **cancellarli per id** (users, client_distributors, notifications, client_discount_rules).
