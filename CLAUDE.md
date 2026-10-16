# CLAUDE.md — contesto di lavoro per Claude

Orientamento rapido dopo un reset di contesto. Flusso completo in **README.md**, cosa manca
in **SCOPE.md**, punti aperti lato banco in **AUDIT_DISTRIBUTORE.md**. Qui solo ciò che non sta
già scritto lì.

## Stack e ambiente

- Node/Express + EJS, niente build, JS vanilla in `public/app.js`.
- DB: `db/index.js` sceglie Postgres se c'è `DATABASE_URL`, altrimenti SQLite — **in pratica
  gira solo su Postgres** (sintassi diretta in `server.js`/`src/*.js`). SQLite è legacy/rotto.
- **Produzione: una VPS** sotto pm2 (processo `minuteria`, vedi README), stesso Supabase. `.env` non è in
  git: sulla VPS va creato a mano (`DATABASE_URL`, `SESSION_SECRET`, `PORT` facoltativa, default 3000, più
  le variabili WhatsApp). Dopo un `git pull` serve `npm ci` e il riavvio: due processi pm2 sullo stesso
  `server.js` si contendono la porta e, con WhatsApp acceso, la stessa sessione. `npm run seed` è manuale,
  **riscrive le password demo** e riattiva i banchi disattivati.
- `.env` locale punta al **Supabase di produzione condiviso**, nessun DB di test — girare in
  locale scrive sul DB vero, e il server locale esegue anche il timer delle scadenze (30 s) come
  la VPS: fermarlo quando non serve.
- **Rete che blocca il database (eduroam, 16/10/2026)**: dalla Wi-Fi dell'università il TCP verso il pooler Supabase si apre (in 50 ms: risponde un
  firewall di mezzo) ma la richiesta SSL di Postgres non riceve mai risposta, su tutti gli IP e su 5432 e 6543 (provato: 0 connessioni su 10).
  **Non si risolve dal codice**: serve l'hotspot del telefono, una VPN o un tunnel SSH. `node scripts/diagnosi_rete_db.js` dice a che fase si
  ferma. Il codice però non deve appendersi né riempire il log: `db/postgres/resilienza.js` (provato in `test/resilienza.test.js`, pool finto)
  riprova la **connessione** (nessuna query è partita: sicuro anche per le scritture) e le **letture** + le istruzioni su `session` se la
  connessione cade a metà, ma **mai una scrittura persa a metà** (potrebbe essere arrivata: si duplicherebbe un ordine o un pagamento) né
  dentro una transazione; dopo 3 fallimenti di rete di fila un interruttore risponde subito per 5 s. A chi chiama arriva
  `ErroreDbNonRaggiungibile` (status 503, `dbNonRaggiungibile`), che `src/http.js` mostra come "Servizio non raggiungibile" (pagina o JSON) con
  una riga di log. `connectionTimeoutMillis` è 5 s (era 15): una connessione sana si apre in <1 s. Il timeout di attesa nel pool pieno
  ("timeout exceeded when trying to connect") non conta per l'interruttore. `mantieniCalde` scrive una riga quando il DB smette di
  rispondere e una quando torna. Una query nuova con una scrittura "furba" dentro un `SELECT` sarebbe riprovata: `eLettura` guarda le parole
  INSERT/UPDATE/DELETE/... nel testo, quindi niente scritture dentro un `WITH ... SELECT` che non le dichiari.
- **Dal telefono sulla stessa rete Wi-Fi** (15/10/2026): il server ascolta di default solo su `127.0.0.1` (così sulla VPS,
  dietro il proxy); col `HOST=0.0.0.0` nel `.env` **locale** (non in git) ascolta su tutte le schede e all'avvio stampa gli
  indirizzi (`http://192.168.x.x:3000`). Il firewall di Windows ha già le regole per `node.exe` (Public e Private). Se non si
  collega lo stesso, la rete può isolare i dispositivi ("AP isolation", rete ospiti). Dal telefono, in HTTP semplice, **non**
  funziona la pagina di pagamento Stripe (Stripe.js vuole HTTPS fuori da localhost) e `APP_URL=http://localhost:3000` farebbe
  tornare dal pagamento su un indirizzo sbagliato: per provare i pagamenti da telefono serve un tunnel HTTPS.
- Server locale **senza auto-reload**: dopo modifiche a `server.js`/file `require`-ati serve
  riavvio manuale (`.ejs`/`public/*` no).
- Modifiche schema in **entrambi** `db/postgres/schema.sql` e `db/schema.pg.sql` (root, copie
  identiche; il file ha fine riga CRLF), poi `node scripts/apply_schema_pg.js` (transazione unica:
  un pezzo fallito annulla tutto). **Col ruolo attuale l'intero file non si applica**: `CREATE OR
  REPLACE FUNCTION ricerca_simili` dà "permission denied to set parameter
  pg_trgm.word_similarity_threshold". Per un blocco nuovo: leggere `schema.sql` dal suo commento
  fino in fondo e lanciarlo da solo (è così che si è applicato "Ditte e filiali"): lo fa
  `node scripts/applica_blocco_schema.js "<commento d'inizio>" [--applica]` (a secco senza il flag).
- Mai `pool.on('connect', async ...)`: causa query concorrenti sullo stesso client.
- **Finestra di conferma delle richieste = 30 s sul PC, "per adesso"** (richiesta esplicita del 16/10/2026): `FINESTRA_CONFERMA_SEC=30` nel `.env`
  **locale** (non in git) fa leggere a `pricing.getFinestraMinuti` 0,5 minuti invece di `config.finestra_conferma_min` (DB condiviso con la VPS: 10 min,
  **non toccato**, i banchi veri di Borea hanno sempre i loro 10 minuti). Vale solo per l'istanza che ha la riga; all'avvio scrive `[config] FINESTRA_CONFERMA_SEC=...`.
  Per toglierla: via la riga e riavvio. `test/server.test.js` la svuota prima di caricare `server.js`. I testi che dicono "N minuti" arrotondano
  (0,5 → "1 min", `Math.round`): con 30 s sono imprecisi, non toccati. Un corriere su WhatsApp avrebbe 30 s per rispondere (la finestra è la stessa).

## Ditte, filiali, dipendenti (solo Borea, dal 30/09/2026)

`ditte` → filiali → dipendenti. Niente tabelle nuove per le ultime due: **una filiale è una riga di
`distributors`** (`ditta_id`; `nome` = nome della ditta e si ripete, unica è la coppia `nome` +
`filiale`) e **un dipendente è una riga di `users`** ruolo `distributore` con `distributor_id` = la
sua filiale (una sola) e `nome`/`cognome`. Login, token app, sessioni e notifiche restano su `users`.
- **Oggi l'unico banco attivo è Borea** (filiali Fegino e Staglieno, utenti `fegino`, `staglieno` e
  il vecchio `borea`). AFIS, Cambielli e Fidra sono **disattivati** (`attivo = 0`, non cancellati:
  lo storico li referenzia). Credenziali in README. `scripts/imposta_borea_filiali.js` è la
  migrazione una tantum: prova a secco di default (transazione + ROLLBACK), `--applica` conferma.
- L'installatore vede **solo la ditta** ("Borea"): mai la filiale (`flusso_cliente.senzaFiliale`,
  `raggruppaRisposteDitta`, `anagrafiche.legamiDelCliente`; l'app nasconde `filiale` se vuota). La
  filiale la vedono banchi e agente (DDT, pannello banco). Il blanking sta nei punti **solo cliente**:
  `/ordini/:id` è condivisa fra ruoli, per questo lì si fa per ruolo e non in `dettaglioOrdine`.
  `legamiDelCliente` (anagrafica del cliente, "Distributori di riferimento") esclude i banchi disattivati: i
  legami con AFIS, Cambielli e Fidra restano in `client_distributors` (lo storico li referenzia) ma non si vedono.
- Una richiesta parte verso **ogni filiale** attiva (`attivo = 1`; la pausa della ricezione non esiste più dal
  09/10/2026: la colonna `distributors.ricezione_attiva` è rimasta nel DB ma nessuno la legge) (una riga di
  `request_responses` ciascuna) e la notifica arriva a tutti i dipendenti. **Vince la prima filiale
  che conferma**: `rispondi()` blocca la richiesta (`FOR UPDATE`), chiude le altre filiali della
  stessa ditta (`scaduto`) e registra chi ha risposto (`risposto_da`). Un rifiuto di una filiale non
  chiude la ditta finché un'altra deve ancora rispondere. L'ordine nasce con `orders.distributor_id`
  = la filiale che ha accettato: da lì parte il pacco e solo i suoi dipendenti lo vedono.
- Prezzi uguali: listino (`distributor_products`, 27.676 righe) e legami cliente
  (`client_distributors`) di Staglieno sono **copie** di Fegino. Un nuovo import di listino va
  scritto su tutte le filiali della ditta. Sconti (`client_discount_rules`) e numerazione DDT
  (`ddt_counters`) sono per filiale, non per ditta.
- Un `distributors` senza `ditta_id` (per esempio creato dal seed) funziona: ogni riga è una ditta a
  sé. Il seed (`db/postgres/seed.js`) non crea ditte.
- Coordinate (Nominatim/OSM): Fegino = civico 1/7 rosso di Via Castel Morrone; Staglieno
  **approssimata** sul civico 9 (l'11R non è in OSM). Stanno in `distributors.geo_*` e in
  `store_locations` (una riga per filiale: la leggono `/punti-vendita`, `src/consegna.js` e il
  messaggio ai corrieri). La posizione del dispositivo non si raccoglie più: se `distributors.geo_*`
  non coincide con `store_locations`, riallinearlo da lì.
- **Da decidere**: la pagina mappa mostra "Borea · Fegino" e "Borea · Staglieno" mentre l'installatore
  vede solo la ditta; manca un ruolo di responsabile che veda gli ordini di tutte le filiali.

## Catalogo

- **27.676 prodotti attivi** (non 51.182 — conteggi più vecchi altrove sono stale).
- `products.misura` è **0% popolata**: la misura va estratta dal testo di `nome`.
- `products.codice` è un ID interno, non il codice produttore; `products.codice_fornitore` è
  quello vero.
- Raggruppamento varianti (`raggruppaVarianti()`): un numero nudo a inizio nome NON è una
  misura di default, serve un simbolo attaccato (Ø, Dn, mm, ", °).

## Ricerca (`src/catalogo.js`, `cercaProdotti`)

Niente colonna "materiale", `misura` vuota: tutto estratto da `nome`.
- Sinonimi pollici↔mm solo per taglie gas/pressione (1/8–2.1/2), mai per scarichi/pluviali.
- Frazioni a parole ("un mezzo", "tre quarti"...) tradotte in cifra prima di cercare.
- Parole generiche di misura ("diametro", "pollici"...) tradotte in un pattern sul nome, mai
  cercate alla lettera (il catalogo non le scrive mai per esteso).
- Refusi tollerati (`word_similarity > 0.45`, da 4 caratteri) su nomi e parole-comando sopra.
- Marchio e categoria si cercano dallo **slug**, non dalla tabella `brands` (vuota).
- **Niente chip di filtro cliccabili** (rimossi da /cerca e /categoria su richiesta esplicita,
  non riproporli): solo ricerca testuale libera.

## Velocità

Il DB sta su un altro server: ogni query costa un giro di rete (~50 ms), quindi conta il **numero
di query in sequenza**, non la loro complessità. Mai query dentro un ciclo (N+1).
- **Cache a scadenza 60 s** (`src/memo.js`, `conCache`): config (`pricing`), struttura del catalogo
  (`catalogo.js`), token dell'app (`token_app.js`). Sono letture che il server non scrive mai: una
  modifica fatta da script compare entro un minuto. Gli oggetti restituiti sono condivisi fra le
  richieste: non modificarli.
- **Connessioni** (`db/postgres/index.js`): tenute aperte 5 min e 3 svegliate ogni minuto
  (`mantieniCalde`, chiamata da `server.js`). Il default di pg le chiude dopo 10 s e la richiesta
  dopo ogni pausa pagava ~330-420 ms di connessione nuova (una query calda: ~45).
- **Ricerca**: due modi con gli stessi risultati. *Veloce* (~45 ms nel DB): funzioni SQL
  `ricerca_esatti`/`ricerca_simili` e indice `idx_products_ricerca_trgm` (in `schema.sql`); le
  parole da 3+ caratteri diventano insiemi di id intersecati sull'indice, misure e parole da 1-2
  caratteri filtrano le righe rimaste (`OFFSET 0` forza quest'ordine). *Lenta* (~220 ms): la
  query originale, usata da sola se le funzioni non esistono (errore 42883). La soglia 0.45 sta
  nella clausola SET di `ricerca_simili`: una SET di sessione non è affidabile col pooler in
  modalità transazione. `ricerca_testo` è nell'indice: se cambia, l'indice va ricreato. Per
  confrontare una versione nuova con la vecchia: `git show HEAD:src/catalogo.js` in un file
  temporaneo, insiemi e chiave (categoria+nome) d'ordine, non gli id.
- **Elenchi** (`paginato`): conteggio (in cache) e pagina partono insieme. Le varianti dei gruppi
  viaggiano nella stessa query, **una volta per gruppo** (`conMembriDelGruppo`, colonna `_gruppo`):
  ripetute su ogni riga costavano più della seconda query che sostituivano. Ordine dei pareggi
  `nome, prezzo_listino, id`: prima era arbitrario (con OFFSET le righe potevano ripetersi o
  saltare); la variante "di default" di un gruppo è la più economica fra quelle con lo stesso nome.
- **Stato ordini** (`attivitaCliente`): "segna lette" e lettura delle richieste recenti partono
  insieme; le scadenze si aggiornano dopo, così le notifiche che creano restano da leggere. La query delle
  richieste recenti porta con sé `secondi_rimasti` (dal DB): `aggiornaScadenza` si chiama solo per le richieste con
  la finestra finita o del vecchio flusso (prima una per ogni richiesta aperta, due letture ciascuna), in parallelo.
- **Sessioni web**: `touch` al massimo ogni 10 min per sessione (`src/sessioni.js`); con
  `rolling: true` express-session aspetta quell'UPDATE prima di chiudere ogni risposta.
- `compression` in `server.js`; `/img` e `/vendor` con `maxAge` 7 giorni, CSS/JS solo ETag.
- Carrello web: +/− raggruppano i tocchi (un salvataggio, un ricaricamento), con le quantità
  mandate una alla volta: richieste parallele sulla stessa sessione si sovrascrivono.

## Aspetto grafico (sito web)

**Solo tema chiaro** (richiesta esplicita del 02/10/2026: tolta la modalità scura "Cantiere Notte",
l'interruttore e lo script `data-tema`; non rimetterli). Icone SVG in `src/icone.js` (13 icone categoria
provvisorie). Variabili CSS in cima a `public/style.css`. DDT bianca (stampa).
- Verde/arancio/rosso sono scuriti per portare i badge a 4.5:1 (stessi valori in
  `mobile/src/tema.tsx`).
- I `<button>` non ereditano il font (`button { font-family: inherit }`); campi input ≥16px, sotto
  Safari iPhone ingrandisce la pagina al tocco.
- Quirk mobile da non reintrodurre: `autocomplete/autocorrect/autocapitalize="off"` sui campi
  ricerca; ripristino focus dopo il redraw risultati (altrimenti la tastiera si chiude); tutte le
  barre di ricerca usano lo stesso `[data-ricerca]`, mai una navigazione mentre si scrive.
- **Carrello web** (richieste esplicite del 04/10/2026, non rimetterli): niente frasi di spiegazione
  (pezzi nel carrello, minimo raggiunto, "indirizzo che finisce sulla bolla", "paghi ora / pagamento di
  prova"), niente codice/categoria sotto l'articolo, **niente scritta "N articoli · M pezzi"** (in cima c'è
  solo "+ Aggiungi pezzi"), niente riga "Imponibile" e niente "2 × € … → €…": la scheda articolo ha prezzo
  `cad. · IVA esclusa`, cestino, stepper e totale riga. Ordine pagina: articoli → "Consegna in cantiere"
  (campo `destinazione` che si apre con "Cambia"; Invio nel campo vale "Fatto", non paga) → nota facoltativa
  (`<details>`, campo `note`) → riepilogo → "Svuota carrello" (in fondo, link sottolineato, con conferma). Il
  totale e **"Paga e invia richiesta"** stanno nella barra fissa `.barra-paga` sopra la navbar (il pulsante
  invia `#form-invia` con l'attributo `form=`); `--altezza-barra-paga` in `style.css` è lo spazio da
  lasciare in fondo alla pagina: se la barra cambia altezza, aggiornarlo. L'app mobile non ha ancora seguito
  queste modifiche.
- **Quantità scelte e non ancora aggiunte** (card classica: ricerca, marchio, con-foto e ricerca live della home; richiesta esplicita del
  15/10/2026): il + scrive solo nel campo, "Aggiungi (N)" manda al carrello. Prima, cambiando pagina, i campi tornavano a 0. Ora stanno in
  `scelte` (`{ id: quantità }`, in `app.js`) e in **sessionStorage** (`minuteria.scelte.<id utente>`, dal `<meta name="utente">` di
  `partials/app_head.ejs`; scadono dopo 12 h), e si rimettono nei campi a ogni pagina, ricerca live (`disegnaRisultati`, ripristino
  dell'elenco), scroll infinito e ritorno da "indietro" (`applicaScelte`). Il conto "N selezionati" e "Aggiungi (N)" si fanno su `scelte`, non
  sui campi in vista, e "Aggiungi" manda **tutte** le scelte (anche di card non in pagina; un articolo non più attivo lo salta il server).
  Cambiare misura su una card scarta la scelta della misura di prima (com'era). La pagina categoria (righe compatte, salvataggio a ogni
  tocco) non usa niente di tutto questo.
- **Elenco prodotti della categoria** (richieste esplicite del 04/10/2026, non rimetterli; solo
  `views/categoria.ejs`, le altre pagine — home, cerca, marchio, con-foto — hanno ancora la card classica
  `partials/prodotto.ejs` e lo stepper `[data-passo]` + "Aggiungi"): righe compatte `partials/prodotto_riga.ejs`
  (foto 56×56 o segnaposto con la scatola, nome, prezzo `+ IVA`), **niente** riga "Caldaie — 314 articoli",
  famiglia ripetuta, badge "Disponibile" (si mostra solo uno stato diverso) né "Nel carrello: N pz". Lo stepper
  `− N +` mostra la quantità **già nel carrello** e salva a ogni tocco su `/api/carrello/imposta` (nessun
  "Aggiungi"): stato, coda a una richiesta alla volta e ripristino in caso di errore in `public/app.js`, blocco
  "Righe compatte della categoria". Un secondo costruttore JS (`rigaCompattaHtml`) disegna le stesse righe per
  ricerca live e scroll infinito, scelto da `#risultati[data-righe-compatte]`: i due markup devono restare
  uguali. In basso `.barra-vai` ("N pezzi" + "Vai al carrello →"), visibile solo con pezzi > 0;
  `--altezza-barra-vai` è lo spazio da lasciare in fondo alla pagina. Del vecchio blocco info restano solo le
  misure (blocco "Misura", sotto) e il RAEE: EAN, refrigerante e F-GAS non si vedono più nell'elenco.
- **Scelta della misura/variante** (richiesta esplicita del 06/10/2026; classi `misura-*`; vale per la riga
  compatta e per la card classica): blocco `partials/misura.ejs`, disegnato anche da `misuraHtml` in `app.js`
  (i due devono restare uguali: la ricerca live e lo scroll infinito ridisegnano da lì). **Niente più `<select>`**
  né `.chip-variante`. Occhiello "Misura · H × L × P" (12px, maiuscolo); con 2 varianti chip affiancati
  (`role="radio"`, selezionato = bordo blu + `--blu-chiaro`, **non** blu pieno); da 3 in su pulsante con ▾ che apre
  il **pannello dal basso** ("Scegli la misura", una riga per variante con pallino e prezzo, "Conferma"). Il
  pannello è uno solo, creato da `app.js` al primo tocco (nessun markup in pagina) e riempito dai `data-varianti`
  della riga: toccare una riga **applica subito** la misura (prezzo, stepper e carrello come con i chip), Conferma, velo
  ed Esc chiudono soltanto e il fuoco torna sul pulsante. Etichette e occhiello li scrive il server, **non** il
  browser: `catalogo.etichettaVariante` ("H108xl60xp44cm" → "108 × 60 × 44 cm") e `infoVarianti` (`p.varianti_info`,
  passato da `prodotto_json.js`). Solo se **tutte** le varianti di un prodotto sono dimensioni con le lettere nello
  stesso ordine (può essere anche "L × H × P") si riscrivono; altrimenti restano com'erano e l'occhiello è
  "Variante" (e il pannello "Scegli la variante"): sono la grande maggioranza (Ø, Dn, gradi...). Riga con varianti:
  `.riga-prod[data-varianti]` è una griglia (foto | nome, misura, prezzo + stepper in fondo sulla stessa riga) con
  `.riga-info { display: contents }`: l'HTML è lo stesso delle righe senza varianti, cambia solo il CSS.
  `data-varianti` ha le stesse chiavi nel partial e nell'API (`sconto_base_pct`, non più `sconto`). Prova:
  `test/varianti.test.js` per le etichette; per il resto serve un browser (nel pannello nascosto clic e animazioni non
  girano: `tabs_select` e uno screenshot prima).
- **Sottocategorie di una categoria** (`views/categoria.ejs`, ramo senza elenco prodotti, richiesta esplicita
  del 05/10/2026): griglia a 2 colonne di schede `.sotto-scheda` (foto 4:3 sopra, nome Sora 600 su max 2 righe
  sotto), **senza** numero di articoli, icona cartella né freccia; ricerca `.ricerca-fissa-sotto` sticky sotto
  l'appbar (funziona perché è figlia diretta di `.app`: non annidarla in un contenitore basso). **Foto**: nessuna
  colonna nel DB, vale `public/img/sottocategorie/<slug>.webp` (4:3, ~600×450); "varie" esiste in ogni categoria,
  quindi lì è `<macro>-varie.webp`. `sottocategorieDi` (`src/catalogo.js`) mette `foto` solo se il file esiste
  (riletto ogni 60 s con la cache): un `<img>` verso un file mancante non è gratis, `/img` cade nella sessione e
  nelle query delle viste prima del 404. Senza foto, o se non si carica (`onerror`), resta il riquadro grigio con
  l'icona della categoria madre.
- **La mia anagrafica** (`views/profilo.ejs`, richiesta esplicita del 05/10/2026; classi `an-*`): sola lettura,
  schede in quest'ordine: nome (cerchio con le iniziali) → **un solo** distributore → dati di fatturazione →
  contatti → nota. Il distributore è il **primo approvato** (le ditte arrivano da `legamiDelCliente` già in
  ordine di nome); se nessuno ha approvato, il primo della lista e senza codice. La regola sta in
  `anagrafiche.distributoreDiRiferimento`, usata anche dal menu del profilo: l'invio delle richieste
  (`distributoriCandidati`) non cambia. **Niente etichette di stato** ("Approvato"...) né riga
  "Consegna abituale" (l'indirizzo di consegna sta nel carrello). Un dato vuoto nasconde la sua voce, e una
  scheda senza voci sparisce. Il referente si chiama "referente" (è il campo della registrazione: non è detto
  che sia il titolare). Fondo pagina 96px da `.app-anagrafica`, non dai ~150px di `.app`.
- **Pulsante e menu del profilo** (`views/partials/appbar.ejs`, richiesta esplicita del 05/10/2026; classi
  `profilo-*`, `pp-*`, `avatar-*`): solo per il **cliente**; l'agente ha ancora campanella e tendina
  `.menu-account`, il banco la sua intestazione (`partials/banco_testa.ejs`, vedi "Home del banco"). Pulsante da 44px col cerchio da 36px con le iniziali (partial unico `partials/iniziali.ejs`,
  usato anche in cima al menu, 48px, e in anagrafica, 56px). Velo e pannello stanno **fuori dall'`<header>`**: l'appbar
  ha z-index 20 e dentro non si potrebbe stare sopra la navbar (25), che il velo deve coprire (velo 30, pannello
  31). Voci: La mia anagrafica, Storico ordini (`/storico`), Esci. **Niente "Notifiche"** (tolta su richiesta
  esplicita del 05/10/2026, non rimetterla): `/notifiche` esiste ancora ma il cliente non ha più un link per
  arrivarci (aprirla segna tutte lette, anche quelle del badge di "Stato ordini"); banco e agente hanno ancora
  la campanella (il banco nella sua barra, l'agente nell'appbar). Il sottotitolo "referente · cliente di DISTRIBUTORE" viene da `res.locals.profiloCliente`
  (`anagrafiche.intestazioneCliente`, in cache 60 s per cliente: un'approvazione appena fatta compare entro un
  minuto). Script in `app.js` ("Menu del profilo"): Esc e tocco sul velo chiudono e riportano il focus sul
  pulsante, frecce/Home/End scorrono le voci, Tab fuori dal pannello lo chiude.
- **Accedi, Registrati, Benvenuto** (`views/login.ejs`, `registrati.ejs`, `benvenuto.ejs`, richiesta esplicita del
  05/10/2026; classi `acc-*`, `reg-*`, `ben-*`; campi dal partial `partials/acc_campo.ejs`, che disegna anche
  l'occhio della password). Non rimettere: la nota "i distributori che indichi dovranno confermare…", gli asterischi
  `*` (i facoltativi hanno l'hint "Facoltativo"), la sezione "I tuoi distributori di riferimento", la nota "Per ora
  tutte le consegne vanno in…" né un link di recupero password (non esiste). **Un solo `<form>`** con tre
  `fieldset` `[data-reg-passo]`: senza JS si vedono tutti, con JS ("Registrazione a passi" in `app.js`) uno alla
  volta; lo script mette `form.noValidate` perché un campo non valido in un fieldset nascosto bloccherebbe l'invio
  senza messaggio, e controlla i passi da sé (`checkValidity`/`reportValidity`), tutti prima dell'invio. La
  validazione vera è sul server: `anagrafiche.validaIscrizione(dati)` ritorna `[{ testo, campi }]` e
  `primoPassoConErrori` dice il passo da riaprire (`data-passo-iniziale`); i campi sbagliati hanno `aria-invalid`.
  I nomi dei campi per passo stanno in `CAMPI_PER_PASSO` (`anagrafiche.js`): un campo nuovo va aggiunto lì e in
  vista. **Il distributore non si sceglie più**: `POST /registrati` ignora `req.body.distributori` e collega il
  cliente a `anagrafiche.distributoriPredefiniti()` (env `DISTRIBUTORE_PREDEFINITO`, id o nome della ditta, default
  `BOREA SRL`, tutte le filiali; se non esiste scrive un errore nel log e iscrive senza legami). Poi redirect a
  `/benvenuto` (senza stato: riaprirla mostra la stessa cosa; la riga "confermerà a breve" c'è finché il legame non
  è `approvato`). **Dal 14/10/2026 l'approvazione è automatica** (richiesta esplicita, "per adesso"):
  `anagrafiche.iscriviCliente` crea i legami già `approvato` (con `deciso_il`) su tutte le filiali, mette
  `users.stato_anagrafica = 'attivo'` e **non manda nessuna notifica** (né "Nuova anagrafica da approvare" al banco né
  "Iscrizione inviata" al cliente); quindi in `/benvenuto` la riga "confermerà a breve" non compare mai. Con
  `APPROVAZIONE_AUTOMATICA=0` nel `.env` (letta a ogni iscrizione) tutto torna com'era (legame `in_attesa`, notifiche);
  senza nessun banco collegato resta `in_attesa` comunque. I clienti già `in_attesa` prima del cambio non si toccano:
  li approva il banco, o uno script una tantum. **L'approvazione non blocca niente**: un cliente `in_attesa` ordina
  comunque, e la richiesta va a tutti i banchi attivi (vedi README); il banner di `/profilo` ("non inviare richieste")
  è quindi inesatto.
  `/profilo?benvenuto=1` non esiste più.
- **Storico ordini** (`views/storico.ejs` + `partials/storico_scheda.ejs`, richiesta esplicita del 05/10/2026; classi
  `st-*`): intestazione "Storico ordini". Sezione **"In corso"** (richieste in attesa + ordini in consegna entro 24 h:
  stessa regola di `attivitaCorrente`, `eInConsegna` in `flusso_cliente.js`; non solo la più recente) e sotto un
  gruppo per **mese di creazione** in ora italiana (`format.meseRoma`), dal più recente. Dati e raggruppamento
  stanno in `flusso.storicoCliente` (la route è sottile); la scheda è `voceStorico`. Etichette fisse: In consegna
  (anche per "inviato/in preparazione/partito"), In attesa, Consegnato, Nessuna risposta, Annullata. Al centro il
  nome della **ditta** (mai la filiale; arriva con un JOIN nella stessa lettura degli ordini di
  `richiesteClienteConStato`) o, senza ordine, "Rimborsato" / "Rimborso in corso" (niente se la richiesta è del
  vecchio flusso, `pagamento_stato` NULL). A destra `totaleOrdine(ordine)` o l'importo pagato. Si vedono solo le
  ultime 50 richieste. **Riordina** (solo schede "Consegnato"): form `POST /storico/:id/riordina` *fuori* dal
  link della scheda; somma al carrello di sessione gli `order_items` dell'ordine (tetto `QUANTITA_MASSIMA`),
  salta quelli disattivati, tolti dal catalogo o `non_disponibile` (`flusso.articoliDaRiordinare`) e passa il
  numero dei saltati a `/carrello` in `req.session.avvisoCarrello` (avviso letto e cancellato al primo GET). Non è
  nell'API dell'app. Il fondo pagina è 96px (`.app-storico`).
- **Verifica disponibilità** (`views/richiesta_attesa.ejs`, richiesta esplicita del 04/10/2026, non rimettere
  paragrafi di spiegazione, "Hai pagato…", pulsante notifiche): timer con anello da 148px che si **svuota**,
  tre passaggi (`<ol>`), una scheda per banco, scheda del materiale col "Pagato", "Annulla" come link. Anello e
  numero sono `[data-arco]`/`[data-countdown]` come l'icona della navbar: li muove **lo stesso timer** di
  `nav_ordini.ejs` (stessa durata `scade_il − creato_il`, stessa formula), per questo il numero non ha più
  `id="countdown"` e il vecchio `mostraTempo` di `app.js` non scrive più niente. Il polling di `app.js` riscrive
  testo e classe di `[data-distributore]` (`stato-badge stato-<esito>`): il puntino davanti all'etichetta è un
  `::before` di `#stato-distributori .stato-badge`, così resta; "In attesa" lì si chiama "Sta verificando" (anche
  nel polling). "Elimina definitivamente" resta sotto "Annulla", non toccato.
- **Richiesta scaduta** (`views/richiesta_chiusa.ejs`, richiesta esplicita del 05/10/2026; classi `att-*`,
  modificatore `.att-rosso`): vale solo per `nessuna_offerta`; la richiesta **annullata** dall'installatore ha
  ancora il markup vecchio. Niente animazioni. Anello vuoto, "00:00" grigio, pallino "!" a 45° sul bordo, titolo
  "Nessun banco ha confermato" (**"Nessun corriere ha confermato"** se un banco aveva accettato e nessun corriere ha preso la consegna in
  tempo, richiesta esplicita del 15/10/2026: `raggruppaRisposteDitta` porta `bancoConfermato` e la vista lo legge con `esito === 'scaduto'`;
  in quel caso il banco ha il chip verde "Disponibile", e la notifica di chiusura dice lo stesso, scelta da `esito.corrieriScaduti` in
  `chiudiFinestraRisposte`), rimborso in pillola verde ("€ X rimborsati"; se `pagamento_stato` è ancora
  `pagato` "Rimborso in corso"; senza pagamento niente pillola), un banco per ditta con il suo stato reale.
  Il pulsante è "Rinvia richiesta" (una sola "i", niente "paghi di nuovo €"): l'azione e il pagamento sono
  quelli di prima. La data è `fmt.dataOraRoma(creato_il, ', ')`, in ora italiana. "Eliminare" è un link con la
  stessa conferma.
- **Ordine in consegna** (`views/ordine_dettaglio.ejs`, richiesta esplicita del 04/10/2026; stesse classi
  `att-*` della verifica disponibilità, modificatore `.att-verde`): vale per il cliente con ordine **non
  consegnato** e non "ritiro"; consegnato, ritiro, banco e agente hanno ancora il markup vecchio. L'anello
  parte pieno alla nascita dell'ordine e si svuota fino all'arrivo (`corriere_arrivo_il`, o `creato_il` +
  `consegna_ore`); la barra "In consegna" si riempie all'inverso. Li muove il blocco "Consegna in arrivo" di
  `app.js` (vedi "Conti alla rovescia della consegna" sotto), **ogni secondo e in modo lineare** (prima ogni 30 s,
  a scatti). **Non
  rinominarlo `[data-consegna]`**: è la scheda "Consegna in cantiere" del carrello e il suo blocco in `app.js`
  va in errore, fermando tutto lo script, se non trova i suoi pulsanti. `creato_il`, `pagato_il` e le altre
  colonne `TIMESTAMP` sono ora UTC senza fuso e pg le legge come ora locale (2 h di scarto a Roma, nessuna su
  una VPS in UTC): per confrontarle con `Date.now()` o `corriere_arrivo_il` si usa `fmt.istanteUtc`, per
  mostrarle in ora italiana `fmt.dataOraRoma` (`fmt.dataOra` stampa l'ora UTC così com'è). Titolo = tempo
  stimato reale ("Arriva entro 6 ore", o "Arriva entro le HH:MM" col corriere) **finché mancano più di 3 minuti**:
  da lì, o a orario passato, solo **"In arrivo"** (richiesta esplicita del 16/10/2026; vedi sotto); "Te lo porta" =
  `corriere_nome`, se vuoto il nome del banco.
- **Ordine consegnato** (`views/ordine_dettaglio.ejs`, ramo `consegnato` = cliente + `consegnato_il`, richiesta esplicita
  del 14/10/2026; stesse classi `att-*`, in verde, **senza animazioni**; chiude `.app-consegnato` con 96px in fondo): scheda
  di stato (cerchio 120px con spunta in cerchio pieno 76px, "Consegnato", `fmt.dataEstesaRoma(consegnato_il)` = "Mercoledì 14
  ottobre alle 20:10", tre passaggi tutti `att-fatto`), pulsante blu "Riordina gli stessi pezzi" (stesso `POST /storico/:id/riordina`
  dello storico), **una sola scheda** banco + materiale + costi ("Materiale da", "Ordine #N"), "Dettagli consegna e documenti"
  (chiuso), nota sul prezzo. Non rimettere: il riquadro verde con l'etichetta "Consegnato" e il nome del banco, il titolo
  "Prodotti", "Costo di consegna" (ora "Consegna in cantiere") né il link "Annulla ordine". Banco, agente e il ritiro **non**
  consegnato hanno ancora il markup vecchio. **Annullamento**: `flusso.ordineAnnullabileDalCliente` è l'unica regola (pagina,
  `/ordini/:id/elimina`, `/richieste/:id/elimina`, API dell'app) e vuole `stato = 'inviato'` **e** `consegnato_il` vuoto: con la
  rotta provvisoria `/consegnato-prova` un ordine risulta consegnato restando `inviato`, e prima si poteva annullare (e
  rimborsare) anche così. Il rifiuto è `OrdineInLavorazione` (con `consegnato` e `messaggioCliente`), nessuna scrittura.
- **Icona "Stato ordini"** (`views/partials/nav_ordini.ejs`; con più attività in corso segue la **prima inviata**, vedi
  "Più ordini insieme in Stato ordini"): fase calcolata da
  `flusso.statoIconaOrdini` (sola lettura, non segna le notifiche come lette) nel `Promise.all` del
  middleware di `server.js`, per ogni pagina del cliente. Un errore non rompe la pagina ma si scrive nel
  log come `[nav] ...` (ingoiarlo in silenzio lasciava l'icona sempre uguale: così si è scoperto che
  `format.toDate` non era esportata). `/nav/stato-ordini` rende solo il link (con `?scheda=1`, dalla home,
  anche la scheda di `partials/stato_home.ejs`), per il polling dello script inline (15 s in attesa, 60 s
  in consegna). **Un solo timer** per icona e scheda: muove ogni `[data-countdown]` e `[data-arco]`
  (con `data-circ`) della pagina. La barra "in consegna" della scheda della home **avanza col tempo** (dalla
  nascita dell'ordine all'arrivo previsto, `progresso` della voce) e arriverà davvero a "Consegnato" solo con
  l'evento di consegna, **ancora da collegare**; senza orario del corriere resta **ferma a metà**
  (`PROGRESSO_IN_VIAGGIO` in `flusso_cliente.js`).
  Nel frattempo c'è un pulsante **provvisorio** "Ordine consegnato" (`POST /ordini/:id/consegnato-prova` →
  `flusso.segnaConsegnatoProva`, scrive `consegnato_il` per qualunque stato dell'ordine, quindi la scheda
  sparisce): sta **solo nella pagina dell'ordine** (`ordine_dettaglio.ejs`, "Stato ordini"; con l'ordine
  `evaso` vale invece la rotta vera `/consegnato`), **non** nella scheda della home, dove "Consegnato" è
  un'etichetta non cliccabile (richiesta esplicita del 05/10/2026, non rimetterlo). **Dopo il clic si va SEMPRE in `/ordini`**
  ("Stato ordini": l'altro ordine in corso, se c'è, altrimenti la pagina "nessun ordine in corso"), anche con la rotta vera `/consegnato`;
  richiesta esplicita del 15/10/2026, che ho prima letto al contrario: **non** riportare sulla pagina "Consegnato" dell'ordine né in
  catalogo/home (il vecchio campo `ritorno`, che senza valore finiva in home, non c'è più). La pagina "Consegnato" si raggiunge dallo
  Storico. Da togliere insieme alla rotta quando c'è l'evento vero.
- **Home installatore** (`views/home.ejs`): ricerca fissa (`.ricerca-fissa`, `top` = `--altezza-appbar`,
  52px), un'unica griglia compatta di categorie senza conteggi, pulsante "foto/codice a barre" **volutamente
  disabilitato** (funzione non ancora esistente). I nomi delle categorie sono quelli del DB, più lunghi di
  quelli del mockup. Le tessere (ingrandite il 05/10/2026, richiesta esplicita) sono **in colonna**: icona
  52px sopra, nome sotto a 15px, alte almeno 128px. Con il nome accanto all'icona, a questa grandezza
  restavano ~85px di testo e "Condizionamento" non ci stava. Il nome può andare su **tre righe**, così
  nessuno finisce in ellissi; `Condizionamento…` ha il corpo ridotto (14px; 13px sotto i 360px di schermo,
  12px sotto i 330px: la parola misura 139px a 15px e il testo ne ha 143 a 375px, 117 a 320px).
- **Pagine vuote dell'installatore** (richiesta esplicita del 14/10/2026; `views/ordini_cliente.ejs` = "Stato ordini" senza
  attività, il ramo `!righe.length` di `views/carrello.ejs`; blocco "Pagine vuote" in fondo a `style.css`, classi
  `vuoto-*`, `cf-*`, `riga-storico`, `uo-*`, `btn-vuoto-*`): figura da 112px (cerchio `--blu-chiaro`, icona 46px a tratto
  sottile, cerchio tratteggiato `.vuoto-fig-tratt`), titolo Sora 22/800 e sottotitolo, poi in colonna con gap 22px; fondo
  pagina 96px da `.app-vuoto` (non i ~150px di `.app`). Stato ordini: furgone, scheda "Come funziona" (tre passaggi, la
  durata è `pricing.getFinestraMinuti`, non un "10" scritto a mano), "Vai al catalogo", riga "Storico ordini" (la vecchia
  frase "è nel menu account" non c'è più). Carrello: la ricerca è la stessa della home (`.barra-home`, qui `.barra-vuoto`
  alta 52px, **senza** il pulsante foto; `GET /cerca`), "Sfoglia il catalogo" e, solo se c'è un ordine consegnato,
  "Il tuo ultimo ordine" (`flusso.ultimoOrdineConsegnato`: una sola query, e solo a carrello vuoto; al massimo 3 righe,
  data `format.dataCortaRoma` = "12 set"). "Rimetti nel carrello" è il form di "Riordina" dello storico
  (`POST /storico/:id/riordina`), quindi salta gli articoli non più disponibili e torna a `/carrello` con l'avviso. Le pagine
  col carrello pieno o con un'attività in corso non cambiano. `iconaInvio` (aeroplanino) è nuova in `src/icone.js`.
- **Barra in basso** (`.navbar`, richiesta del 05/10/2026, vale anche per quella del banco): pillola tonda
  (raggio 31px, ombra) sollevata di `--nav-stacco` (10px) dal fondo, con 12px di margine ai lati. Il
  contenitore `.navbar` non intercetta i tocchi, solo `.interno`. `--nav-alt` (62px) è l'altezza della pillola,
  **da aggiornare se cambia**; `--barra-bassa` = `--nav-alt` + `--nav-stacco` è lo spazio che occupa: ogni barra
  fissa che sta sopra (`.barra-vai`, `.barra-paga`, `.barra-carrello`) e il riempimento in fondo alle pagine
  (`.app`, `.app-carrello`, `.app-categoria`) partono da lì: non scrivere più un `60px` a mano.

## Richieste e ordini

- Zona non filtra più i distributori candidati (`distributoriCandidati` in `src/richieste.js`
  ignora il parametro `zona`): campo residuo su `distributors`/`users`, non aspettarsi che
  limiti chi riceve una richiesta.
- **Un cliente può avere più richieste aperte insieme** (richiesta del 15/10/2026): l'indice unico
  `idx_requests_cliente_aperta` è stato **tolto** dal DB (blocco "Più richieste aperte per cliente" in fondo a
  `schema.sql`) e dal codice sono spariti `richiestaBloccante`, l'errore `in_corso` e la gestione del 23505. Il
  "Più richieste" vuol dire **ordini nuovi dal carrello, mai lo stesso ordine ricliccato** (richiesta esplicita del 15/10/2026,
  dopo che avevo scritto il contrario): vedi "Un invio, una richiesta" qui sotto. Vedi anche "Più ordini insieme in Stato ordini".
- **Un invio, una richiesta** (`requests.chiave_invio`, indice unico `(cliente_id, chiave_invio)` dove la chiave c'è; blocco "Un invio,
  una richiesta" in fondo a `schema.sql`): ogni apertura della pagina del carrello scrive nel modulo `#form-invia` una chiave nuova
  (`chiave_invio`, 24 caratteri esadecimali, da `server.js`); l'app ne genera una per carrello (`chiave` nel corpo di
  `POST /api/v1/richieste`, si rinnova quando il carrello si svuota dopo l'invio). La **stessa chiave dà una richiesta sola**: un doppio
  clic (anche in parallelo: lo decide l'indice unico, errore 23505), un secondo tentativo dopo una risposta persa o il tasto
  "indietro" sulla stessa pagina portano alla richiesta già partita (`flusso.nuovaRichiesta`, `chiaveInvioValida`: senza chiave o fuori
  forma non c'è controllo). Il controllo è **prima** di validare il carrello (con "indietro" il carrello può essere già vuoto). Con Stripe:
  la chiave sta anche su `stripe_pagamenti`; un secondo clic mentre il pagamento è ancora da fare riporta alla stessa pagina (stesso
  PaymentIntent), a invio già diventato richiesta porta a quella (`ErroreFlusso('gia_inviata')`, la route lo trasforma in redirect), e una
  seconda carta autorizzata per lo stesso invio (due schede) si respinge e si rilascia (`inCasoDiDuplicato: 'rifiuta'`). Un ordine
  identico a uno precedente ma fatto da un carrello nuovo parte normalmente.
- **Dal 04/10/2026 l'installatore paga alla richiesta e non sceglie più l'offerta.** Niente più
  "riepilogo / Invia l'ordine", finestra di scelta, assegnatore a tolleranza, ritiro al banco: l'ordine
  nasce da solo (`richieste.assegnaOrdine` → `flusso_cliente.creaOrdineDaRisposta`) quando una risposta
  del banco è valida (`OFFERTA_VISIBILE`: senza corriere, o con `corriere_stato = 'preso'`), cioè subito
  dopo `rispondi()` a modulo spento e subito dopo `corriereHaPreso()` con WhatsApp. Se la creazione
  fallisce la riprova `aggiornaScadenzeAperte` (timer di 30 s, **non** la lettura della richiesta:
  `aggiornaScadenza` ora chiude solo le finestre). L'assegnatore si registra in `src/flusso_cliente.js`:
  uno script che usa solo `src/richieste.js` non lo ha (anche `scripts/prova_whatsapp.js` lo importa).
  Destinazione e note stanno sulla richiesta (`requests.destinazione/note`, scritte dal carrello).
- **Pagamento** (`src/pagamenti.js`): `requests.pagamento_stato` NULL = vecchio flusso,
  `pagato`, `rimborsato`; importo = `totali.totale_ivato` del carrello (spedizione fissa inclusa).
  Rimborso quando la richiesta si chiude senza ordine (finestra scaduta, tutti rifiutano, annullo, ordine
  annullato); "Rinvia" lo riaddebita. `pagamento_metodo` è `simulato` (app nativa, o sito senza
  `STRIPE_SECRET_KEY`) o `stripe` (sito con la chiave: vedi "Pagamenti Stripe" sotto).
  **Consegna dell'ordine = spedizione fissa pagata** (corretto il 05/10/2026): `richieste.calcolaOfferta`
  (da cui nascono ordine e totale dell'offerta) usa `pricing.getSpedizioneFissa()`, la stessa cifra del
  carrello, e non più `distributors.costo_consegna` (Borea: 0). Prima l'ordine diceva "consegna inclusa" e il
  totale restava 12,20 € sotto a quanto pagato (10 € + IVA 22%, incassati e mai fatturati). Così l'ordine
  mostra "Consegna in cantiere € 10,00" e il totale coincide col pagamento; `distributors.costo_consegna` non
  entra più nei calcoli. Gli ordini del flusso nuovo nati prima (era solo l'85) sono stati riallineati con
  uno script una tantum: copia delle righe in `%TEMP%\backup_allinea_consegna_*.json`. Resta una differenza
  possibile solo se il banco applica uno sconto che il carrello non conosceva (la merce dell'ordine è più
  bassa di quella pagata): non c'è rimborso della differenza.
- `'con_offerte'` non si scrive più (resta nel CHECK del DB): una richiesta rimasta così dal vecchio
  flusso la chiude `aggiornaScadenza` come `nessuna_offerta`, senza rimborso né notifica.
- L'annullo dell'ordine da parte dell'installatore (`eliminaOrdine`, finché il banco non lo prende in
  carico) è **lasciato apposta per la fase di prova**: a regime non deve poterlo fare.
- La risposta del banco (`/distributore/richieste/:id/rispondi`) oggi passa solo `rifiuta`,
  `prezzoRichiesto` e `utenteId`: `rispondi()` supporta ancora `righe`/`sconti`/`scontoCliente`
  (disponibilità parziale, sconto riga per riga) ma nessuna route li usa più — non è codice morto
  da un refuso, è la UI attuale che li ha rimossi.

## Pagamenti Stripe (14/10/2026)

`src/stripe_pagamenti.js` (PaymentIntent, pagina di pagamento, webhook, incassi) + punti di aggancio DB-only in
`src/pagamenti.js`; setup e messa in produzione in README ("Pagamenti con Stripe"). Scelte esplicite dell'utente: carta
**autorizzata e poi incassata** (non addebito + rimborso), **pagamento nella pagina del sito** con il Payment Element di
Stripe (prima era Checkout ospitato: cambiato lo stesso giorno, su richiesta), **solo sito** (l'app resta simulata),
**un solo conto Stripe** (niente Connect). Da non rompere:
- **Senza `STRIPE_SECRET_KEY` tutto è come prima** (`pagamenti.stripeAttivo()`): nessuna query su `stripe_pagamenti`,
  pagamento simulato. Le prove (`test/*.test.js`) non toccano mai Stripe né il DB vero (Stripe finto con
  `stripePagamenti.impostaStripe`, DB finto) e **non leggono il `.env`**: `test/server.test.js` svuota le variabili
  `STRIPE_*`/`APP_URL` prima di caricare `server.js` (dotenv non sovrascrive quelle già definite).
- **Chiavi** (`.env`): `STRIPE_SECRET_KEY`, chiave pubblicabile (`STRIPE_PUBLISHABLE_KEY` o l'alias
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
  che è ignorata). Anche con il bypass la richiesta va ai banchi veri, come ogni prova locale. Per togliere il bypass: via la riga.
- **Nessuna chiamata a Stripe dentro una transazione.** `pagamenti.rimborsa` e `segnaDaIncassare` girano dentro le
  transazioni del flusso (chiusura finestra, creazione ordine, eliminazioni) e **scrivono solo sul DB** (`stato` di
  `stripe_pagamenti` → `da_incassare` / `da_rilasciare` / `da_rimborsare`); le esegue `stripePagamenti.elabora()`, 2 s dopo
  (`richiediElaborazione`) e dal timer di 30 s di `server.js`, con chiavi di idempotenza (`cap-<id>`, `rel-<id>`, `ref-<id>`)
  e fino a 30 tentativi (poi `da_verificare`). Una nuova rotta che chiude una richiesta passa da `pagamenti.rimborsa`, non
  tocca `pagamento_stato` da sola.
- **La richiesta nasce a carta autorizzata**, non al clic: `POST /richieste` con Stripe crea riga + PaymentIntent
  (`capture_method: manual`, `automatic_payment_methods`) e fa `303` verso `/pagamento/<id>` **senza creare niente e senza
  svuotare il carrello**. La pagina (`views/pagamento.ejs` + `public/pagamento.js`, `stripe.confirmPayment` con
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
- **Buco noto, da chiudere prima dell'app ai clienti**: `POST /api/v1/richieste` (e `/reinvia`) restano simulate, quindi
  dall'app si ordina senza pagare anche con Stripe acceso sul sito. Il sito in produzione richiede HTTPS (Stripe.js e
  webhook in modalità reale).
- Schema: blocco "Pagamenti con Stripe" in fondo a `schema.sql` (applicato al DB condiviso il 14/10/2026; `session_id`
  del primo giro con Checkout è stata tolta con un `DROP COLUMN` dentro lo stesso blocco).

## Installatori in Via Puggia 22/3 (provvisorio)

Tutti gli installatori sono in Via Puggia 22/3, Genova (`src/sede_installatori.js`, vedi README,
"Posizione"): `indirizzo_consegna` + `geo_*` con `geo_consenso = 1`, impostati da
`scripts/imposta_installatori_puggia.js` e da `anagrafiche.iscriviCliente`. La sede legale resta quella
dichiarata. Niente `navigator.geolocation` né `/api/posizione`. Quando torneranno gli indirizzi veri
togliere i due punti d'uso.

## Home del banco: bacheca a 3 colonne (09/10/2026)

`GET /distributore` (`server.js`) + `views/distributore_richieste.ejs`, classi `banco-*`, `colonna*`, `scheda*`
(blocco "Home del banco" di `style.css`; la logica di risposta, corriere e ordini non è cambiata). Da confermare →
Attesa corriere → Da preparare, senza numeri d'ordine delle fasi. Convenzioni da non rompere:
- **Niente interruttore "ricezione"**, niente riquadri contatore, niente riga "filiale · zona": richieste esplicite.
  Il banco riceve sempre (`richieste.distributoriCandidati` non guarda più `ricezione_attiva`); la rotta
  `POST /api/distributore/stato` non esiste più.
- **Intestazione e tendina dell'utente sono UNA sola per tutto il banco** (richiesta esplicita del 14/10/2026,
  non farne un'altra): `partials/banco_testa.ejs` = ditta e filiale (`res.locals.bancoTesta`, in cache 60 s dal
  middleware di `server.js`), schede Banco/Clienti, "Storico ordini" e cerchio con le iniziali della
  **filiale** ("Banco Genova Fegino" → BG) che apre la tendina `.menu-account` (Esci; Clienti e Storico ordini
  compaiono lì solo dove la barra non li mostra). **Niente campanella delle notifiche** (tolta su richiesta esplicita
  del 14/10/2026, non rimetterla: `/notifiche` esiste ancora ma il banco non ha un link per arrivarci). La home la include; **tutte le altre pagine del
  distributore passano da `partials/appbar.ejs`, che per `ruolo = distributore` delega qui** (anche `/notifiche` e la
  pagina `errore`): un `appbar` nuovo in una vista del banco funziona da solo. Sotto la barra le pagine interne hanno
  una riga con freccia e titolo (`intestazione`/`indietro` di `appbar`), la home no. La scheda attiva si sceglie da
  `res.locals.percorso` (= `req.path`): "Storico ordini" è accesa su `/distributore/storico` **e** su `/distributore/ordini/...` (un
  ordine fa parte dello storico). **Niente "Punti vendita"** nel menu del banco e `/punti-vendita` gli risponde 404.
- **Da 900px** il menu in basso non si mostra su nessuna pagina del banco (`nav_distributore`, classe
  `.nav-solo-stretta`, sempre) e la home è una sola schermata con le colonne che scorrono dentro; sotto i 900px le
  colonne si impilano e il menu in basso resta.
- Le colonne: **Da confermare** = `request_responses.esito = 'in_attesa'` con la finestra aperta; **Attesa corriere** =
  `esito = 'confermato'` e `corriere_stato = 'in_attesa'` (mai con il modulo WhatsApp spento: l'ordine nasce subito);
  **Da preparare** = `orders.stato = 'inviato'`. **Pulsanti (richiesta esplicita del 14/10/2026, non rimettere "Verifica e conferma")**: nelle schede
  "Da confermare" **"Conferma"** (46px, arancio, a tutta larghezza) è un form `rispondi` con `azione=prezzo_richiesto` e `torna=home`: **conferma subito tutto
  il materiale senza aprire il dettaglio** (a modulo spento l'ordine nasce lì e la scheda passa in "Da preparare", altrimenti in "Attesa corriere"; se
  non riesce il server riporta al dettaglio con `?errore=`). Sotto, affiancati e larghi metà ciascuno (42px, `grid`: con `flex` risultavano disuguali),
  **"Ispeziona"** (link al dettaglio, con l'occhio) e **"Non disponibile"** (`rispondi` con `rifiuta` e `torna=home`, subito, senza conferma). Nelle
  schede "Attesa corriere" **"Ispeziona"** è una pillola da 38px in cima a destra (`.btn-ispeziona`; sotto ~300px di scheda va a capo) e il nome del
  cliente non è più un link. **"Da preparare" (richiesta esplicita del 14/10/2026, non rimettere "Prepara")**: due pulsanti uguali affiancati (42px,
  `.scheda-azioni-ordine`): **"Ispeziona"** apre `/distributore/richieste/<request_id>` (il dettaglio nello stato "Da preparare", col timer del corriere) e
  **non tocca l'ordine**, che resta in colonna; **"Preparato"** (blu) è un form `POST /distributore/ordini/:id/preparazione` con `torna=home`: `prendiInCarico`
  porta l'ordine in `in_evasione` (esce dalla colonna) e avvisa il cliente. Un ordine **senza `request_id`** non ha Ispeziona, solo Preparato a tutta larghezza.
  **Non c'è più un pulsante dalla home verso `/distributore/ordini/:id`** (la pagina con la bolla/DDT): ci si arriva dallo Storico ordini o da "Gestisci
  l'ordine" nel dettaglio della richiesta (a ordine già preso in carico); aprirla prende in carico l'ordine `inviato`. L'occhio è `iconaOcchio` (già c'era,
  per la password; stroke 1.9 dal CSS dei pulsanti).
- **Tempi**: soglie in `BACHECA` (`server.js`) → `data-soglia-*` sulla bacheca → blocco "Home del banco" di `app.js`: il
  server disegna le classi iniziali, lo script le aggiorna ogni secondo dagli istanti (secondi mancanti + `Date.now()`,
  non un contatore che decrementa). Rosso negli ultimi 180 s, "Nuova" per i primi 180 s, pillola dell'ordine rossa sotto
  15 min. A zero la scheda si spegne e la pagina si ricarica. La pillola dell'ordine conta fino a
  **`orders.corriere_arrivo_il`**, che per il resto del sito è la consegna al cliente (minuti totali dal ritiro alla
  consegna): non c'è nel DB un orario di arrivo del corriere al banco. Senza corriere non c'è pillola.
- Il ritardo/`secondi_da_risposta`/`secondi_arrivo` si calcolano **in SQL** (`NOW()`), mai con un `Date` di JS sulle colonne
  `TIMESTAMP` (vedi sopra); `corriere_arrivo_il` è `TIMESTAMPTZ`. Tre articoli al massimo per scheda, poi "+N altri
  articoli". Prova: `test/server.test.js` ("home del banco...") con il DB finto.

## Più ordini insieme in Stato ordini (15/10/2026)

Richiesta esplicita: l'installatore può avere più richieste/ordini in corso nello stesso momento. Tre fasi: **1** richiesta in
attesa di banco e corriere (`requests.stato = 'in_attesa'`), **2** ordine in consegna (`eInConsegna`: non consegnato, nato da
meno di 24 h), **3** consegnato (`consegnato_il`): la 3 **non è più attiva**, sta solo nello Storico. Logica in
`src/flusso_cliente.js` (`leggiVoci`, `vociStriscia`, `statoIconaOrdini`, `attivitaCliente`); prove in `test/stato_ordini.test.js` e nei test
"Stato ordini..." / "striscia..." di `test/server.test.js`.
- **`/ordini` e la striscia di schede** (richiesta esplicita del 15/10/2026; sostituisce la lista `ordini_attivi.ejs`, tolta con il suo CSS e
  l'evento `stato-ordini-aggiorna`: non rimetterli). `/ordini` non rende più un elenco: **0 voci** → `ordini_cliente` (pagina vuota), **1** →
  redirect alla sua pagina, **2 o più** → redirect a `?voce=<tipo>-<id>` se è fra le voci, altrimenti alla PRIMA (la più urgente). Sopra la
  pagina di dettaglio (`richiesta_attesa`, `richiesta_chiusa`, `ordine_dettaglio` del cliente) c'è `partials/striscia_ordini.ejs`, solo se le
  voci sono 2+ **e** la pagina aperta è una di loro (`strisciaPer` in `server.js`: un ordine consegnato aperto dallo storico non ha la striscia;
  usa le voci già lette dal middleware per l'icona e aggiunge solo il materiale con `flusso.conBreve`, una lettura per tutte). Con la striscia:
  titolo "Stato ordini", niente freccia indietro, `body.con-striscia` (anello 112px, timer 25px, padding 18px 16px 16px: scala anche pallino
  d'allarme e furgone). Con 4+ schede la striscia scorre (112px, scroll-snap, la attiva portata in vista da `app.js`); con 2-3 sono colonne
  uguali. Swipe fra gli ordini (solo touch, soglia 60px e 1,5× il verticale, ignorato su campi e contenitori che scorrono in orizzontale,
  150ms di uscita, rimbalzo da 8px ai capi, niente animazione con "riduci movimento"): blocco "Striscia degli ordini in corso" di `app.js`.
- **Le voci** (`costruisciVoce`, un'unica costruzione per icona e striscia: non possono dire cose diverse): `{ fase, tipo, id, richiestaId, href,
  voce: 'tipo-id', secondi/durata (richiesta), minuti (consegna) }` più `breve` (primo articolo + " +N") solo nella striscia. Ordine
  (`ordinaVociIcona`): scaduta recente, richieste dal timer più corto, consegne dall'arrivo **più vicino** (senza minuti in fondo). **Cambio di
  ripartenza**: nella lista di prima le consegne andavano dalla più lontana. `firmaVoci` (`tipo-id-fase`, in ordine alfabetico, non dipende dal
  tempo né dall'ordine) sta in `data-firma` del link dell'icona e della striscia: la pagina con la striscia **si ricarica** quando il controllo
  periodico di `nav_ordini` vede una firma diversa (ordine passato di fase, nuovo, finito); se cambia solo il tempo si muovono solo i timer.
  I timer delle schede sono `[data-countdown]`/`[data-arco]` dentro `a[data-secondi]`, mossi dallo stesso tick dell'icona (`closest`).
- **Il tocco sull'icona** porta **dritto alla pagina** della voce mostrata in quel momento (`data-href` su ogni fotogramma, href aggiornato a
  ogni cambio; con UNA sola voce l'href è la sua pagina; con 0 resta `/ordini`). Non passa più da `/ordini?voce=...` (che esiste ancora e
  funziona, ma era un redirect in più: ~250 ms). Le pagine di richiesta e ordine segnano da sé le notifiche come lette.
- **Velocità del passaggio fra ordini** (richiesta esplicita del 15/10/2026): le pagine `/ordini/:id` e `/richieste/:id` partono con le
  letture in **parallelo** (`flusso.dettaglioOrdine`/`dettaglioRichiesta`, segna-lette e materiale della striscia nella stessa `Promise.all`):
  ogni lettura in fila è un giro di rete (~45 ms) e prima erano 8-9 (pagina dell'ordine da ~470 ms a ~290 ms sul DB vero). Non rimetterle in
  fila. Sulla striscia il tocco (`click`) e lo swipe marcano subito la scheda di destinazione come attiva e attenuano il contenuto
  (`.str-cambio`), e lo swipe **non aspetta più i 150 ms** di animazione prima di chiedere la pagina (blocco "Striscia degli ordini in corso"
  di `app.js`). Una pagina intera si ricarica comunque: un cambio senza ricarica (fetch + sostituzione del contenuto) richiederebbe di
  rendere ri-eseguibili i blocchi di `app.js` di attesa e consegna, per ora non fatto.
- **L'API dell'app segue UNA sola attività: la PRIMA INVIATA** (richiesta con id più basso fra quelle in corso, qualunque fase;
  `attivitaCorrente`). L'app nativa (`GET /api/v1/stato-ordini` → `{ attivo }`) vede un'attività sola: non ha l'elenco né la striscia.
- **Home: una scheda per ogni attività** (richiesta del 15/10/2026): `partials/stato_home.ejs` fa un ciclo sulle `voci` dell'icona (solo
  `richiesta` e `consegna`: la scaduta non ha scheda, come prima) e disegna per ognuna la scheda di sempre, una sotto l'altra, nell'ordine
  dell'icona. Ogni scheda porta alla pagina della sua attività (`voce.href`) e ogni richiesta ha il suo `[data-secondi]`, quindi il suo
  conto. Le voci di consegna portano `corriere` e `progresso` (la barra a metà) proprio per questo. Il controllo periodico di `nav_ordini`
  rimpiazza tutto lo slot `[data-stato-home]`: una scheda sparisce da sola quando l'attività finisce.
- **"Nessuna risposta" (fase `scaduta`) solo se è l'ULTIMA cosa successa** (`scadutaRecente`: la richiesta con l'id più alto è
  `nessuna_offerta` da meno di 3 h). Prima bastava una scaduta qualunque fra le ultime cinque: con un ordine consegnato (fase 3)
  l'icona diceva comunque "Nessuna risposta" (bug segnalato il 15/10/2026).
- Si guardano le ultime **30** richieste (`RICHIESTE_RECENTI`), non più 5.
- **L'icona alterna le attività quando sono 2 o più** (richiesta del 15/10/2026): `statoIconaOrdini` ritorna, oltre ai campi di sempre
  (la prima inviata), `voci` = TUTTE le attività nell'ordine di alternanza
  (`ordinaVociIcona`, funzione pura: prima la `scaduta`, poi le `richiesta` dal timer più corto, poi le `consegna` da chi arriva prima, senza
  minuti in fondo; a parità la più vecchia). La **scaduta** entra fra le voci anche con altre attività (la vecchia regola la nascondeva).
  `views/partials/nav_ordini.ejs`: con `voci.length >= 2` il link ha `multi`, `data-fasi="richiesta,consegna"`, `data-fase` della prima voce e
  `aria-label` ("Stato ordini: 2 attivi. In attesa, 07:42 rimasti. Arriva tra 18 minuti."), dentro un `.fotogramma` per voce (sovrapposti,
  dissolvenza di 250 ms, `aria-hidden`) e i `.puntini`; con 0 o 1 voce il markup è quello di sempre. Il contenuto di una fase sta **solo** in
  `partials/nav_ordini_fase.ejs`. Altezza dei fotogrammi `--nav-stato-alt` (43px = icona 24 + etichetta 19,2, **senza gap**: sovrapponibile al
  pixel all'icona singola, misurato): se cambia il corpo del testo va aggiornata. Script: giro ogni 2,5 s con UN solo `setInterval` (non si
  ricrea a ogni aggiornamento, altrimenti il cambio slitta), fermo a pagina nascosta; con `prefers-reduced-motion` non alterna, resta il primo
  e compare `.conteggio` (numero in un pallino scuro). Dopo ogni sostituzione del link si riparte dall'indice in cui si era (`indice`, `ferma`
  toglie la dissolvenza per quell'istante). Aggiornamento ogni 15 s se fra le fasi c'è `richiesta`, altrimenti 60 s se c'è `consegna`; un conto
  che arriva a 00:00 chiama subito `aggiorna()` (una volta per contenitore). Il bottone/elenco di `/ordini` non cambia. L'app Expo **non** ha
  l'icona dinamica (la scheda "Stato ordini" ha un'icona fissa): da fare a parte.
- **Conti alla rovescia: ognuno col SUO `[data-secondi]`** (non più uno unico dell'icona): `[data-countdown]`/`[data-arco]` leggono secondi e
  `data-durata` dal contenitore più vicino (`closest`): il fotogramma, il link (icona singola), la scheda della home, `.contenuto` della schermata
  di attesa. Prima, con più richieste, la schermata della seconda partiva col tempo della prima ("timer non pieno"). La fine di un contenitore si
  fissa la prima volta che lo si vede (WeakMap): un contenitore che non viene sostituito non deve ripartire a ogni `avvia()`.
- **Durata dell'anello = la finestra, non `scade_il - creato_il`** (`format.durataFinestraSec`, anche in `richiesta_attesa.ejs`): "Rinvia" riapre la
  stessa riga con `scade_il` ricalcolato e `creato_il` di prima (es. la richiesta 188: durata 7586 s), e l'anello partiva quasi vuoto.
- **Conti alla rovescia della consegna** (richiesta esplicita del 16/10/2026: "tutti i timer devono scendere in modo lineare, anche le
  barre", i minuti devono scendere ogni minuto, a 3 minuti "In arrivo"). Prima "Arriva tra N min" lo scriveva solo il server: nella striscia
  con 2+ ordini restava **fisso** (la striscia non si aggiorna col polling dell'icona), in home e icona cambiava solo a ogni polling, l'anello
  e la barra della pagina dell'ordine si muovevano ogni 30 s (a scatti) e la barra della home era ferma al 50%. Ora **un solo blocco in `app.js`,
  "Consegna in arrivo"**, ogni secondo, col suo orologio: un contenitore `[data-eta-sec]` (secondi all'arrivo al momento del disegno, calcolati
  dal server: l'ora del PC non c'entra; `[data-eta-durata]` = secondi dalla nascita dell'ordine all'arrivo) e dentro `[data-eta-testo]` (testo con
  `{m}` = minuti, `ceil`, mai meno di 1), `[data-eta-barra]` (si riempie), `[data-eta-arco]` (si svuota). I contenitori sono: la card della home
  (`stato_home.ejs`), la scheda della striscia (`striscia_ordini.ejs`), il link o il fotogramma dell'icona (`nav_ordini.ejs`), il riquadro della
  pagina dell'ordine (`ordine_dettaglio.ejs`). Il server disegna già il testo giusto (`voce.inArrivo`, `voce.etaSec`, `voce.durataSec`, da
  `costruisciVoce`); il polling dell'icona che rimpiazza i nodi li fa ripartire dal suo numero nuovo. Senza `corriere_arrivo_il` (voce con
  `minuti` null) non c'è niente da far scendere: "In consegna" e barra al 50%. **L'arrivo è `corriere_arrivo_il` e, se manca, `creato_il` +
  `consegna_ore`** (la stima del banco, come nella pagina dell'ordine: `costruisciVoce` e la SELECT di `richiesteAttiveClienteLeggere` ora leggono
  `consegna_ore`; prima card e icona dicevano "In consegna" per gli ordini senza corriere). Il testo lungo è `{t}` = `durataMinuti` ("8 min", "5 h 57":
  `format.durataMinuti` sul server, `Minuteria.durataMinuti` nel browser), `{m}` = minuti puri (solo il badge, che sopra i 99 non c'è). Le transizioni CSS di anelli e barre sono tutte `1s linear`
  (`.stato-barra span` era `0.6s ease`). **La barra della home parte da "In viaggio" (50%), non da "Accettato"**, e arriva al 100% ("Consegnato")
  all'orario d'arrivo (`progresso` = 0,5 + 0,5 × tempo trascorso sul totale; `data-eta-barra="da-meta"`). La barretta "In consegna" della pagina
  dell'ordine invece va da 0 a 100.
  - **"In arrivo" a 3 minuti o meno, e basta** (niente "Arriva tra", "Arriva entro le HH:MM" né il badge dei minuti dell'icona, `[data-eta-nascondi]`):
    soglia `format.SOGLIA_IN_ARRIVO_SEC` = 180 s (`format.inArrivo`), **uguale a `IN_ARRIVO_SEC` in `app.js`**; vale anche a orario passato con l'ordine
    non ancora consegnato. Scritte: icona e card della home "In arrivo", striscia "In arrivo" (invece di "tra N min"), titolo dell'ordine "In arrivo".
    **L'app Expo e `api_v1.js` (`tempo_testo`: "Consegna prevista entro le…") non seguono ancora.**
  - Prove: `test/stato_ordini.test.js` (voci, soglia, disegno dei partial con `ejs.renderFile`). Il blocco JS non gira in `node --test`: per provarlo
    una pagina usa-e-getta con i partial veri + `style.css` + `app.js` su un server locale (ETA a 190 s: dopo 10 s passa a "In arrivo"), senza login né DB.
- Prova sul DB vero: richieste/ordini inseriti con SQL sul **banco AFIS (id 1, disattivato)** per un cliente usa-e-getta, poi
  cancellati per id. **Non creare richieste vere** (`creaRichiesta` le manda a tutti i banchi attivi, cioè a Borea).

## Dettaglio richiesta del banco (14/10/2026)

`GET /distributore/richieste/:id` (`server.js`, logica di presentazione in `src/richiesta_banco.js`) + `views/distributore_dettaglio.ejs`, classi `ric-*`
(blocco "Dettaglio richiesta del banco" in fondo a `style.css`); la logica di risposta (`POST .../rispondi`: `prezzo_richiesto` / `rifiuta`) e
`POST .../elimina` **non sono cambiate**. Come lo Storico, la vista include `partials/banco_testa` (con "Banco" accesa) e ha il suo titolo, non
passa da `appbar.ejs`. Richieste esplicite, non rimetterli: niente "Cliente ordinante" nascosto in un `<details>`, niente pulsante rosso
"Rifiuta: merce non disponibile" né "Accetta ordine" (ora "Conferma: è disponibile" verde e "Non disponibile" neutro), niente grande riquadro vuoto del
timer, "Elimina dal banco" solo come link di testo in fondo.
- **Due colonne** (sinistra: materiale e "Cosa succede dopo la conferma"; destra: azione, cliente, elimina; 818 + 400px). Sotto i 900px una colonna
  sola con l'azione per prima: le colonne diventano `display: contents` e i blocchi si ordinano con `order` (azione, materiale, cliente, passi, elimina).
- **Stato accanto al titolo** (`statoRichiestaBanco`): Da confermare (arancio), Attesa corriere (viola), Confermata (verde), Nessun corriere (rosso),
  Non disponibile / Annullata / Chiusa / Scaduta (grigio). A destra "Ricevuta oggi alle HH:MM" (in ora italiana, `fmt.giornoRoma` + `fmt.oraSolaRoma`).
  Con la conferma a destra compare anche "· confermata alle HH:MM" (`risposto_il` in ora italiana) e il pallino di "Attesa corriere" lampeggia piano
  (`.ric-punto.pulse`, spento con `prefers-reduced-motion`). Il titolo della tabella è "Materiale confermato" dopo la risposta, "Materiale richiesto" prima.
- **"Attesa corriere"** (`ric-attesa`, `ric-avanzamento`): la scheda d'azione è un cerchio da 84px viola col **tempo da quando hai confermato, che SALE** (mm:ss, "1 h 05"
  oltre l'ora) + "in attesa", titolo "Corriere avvisato", "Non preparare ancora: ti avvisiamo appena un corriere accetta.", un riquadro grigio ("Il cliente vede la
  tua conferma quando un corriere prende la consegna."), la nota della copertura parziale e, se l'ordine esiste già, una riga "Ordine collegato". La seconda scheda a
  sinistra si chiama **"Avanzamento"** e ogni passo ha una `fase` (`passiDopoConferma`): **fatto** (pallino verde con la spunta, "Fatto alle HH:MM"), **corrente**
  (pallino viola che pulsa con l'anello, "Corriere avvisato · da N min") e **futuro** (cerchio tratteggiato, testo grigio). In "Da confermare" la scheda resta
  "Cosa succede dopo la conferma", com'era. I secondi dalla conferma li calcola la route **in SQL** (`secondi_da_risposta`, come la home); il JS li trasforma in
  un istante (`data-trascorsi`) e ogni secondo aggiorna il cerchio e ogni `[data-da]`, con le stesse funzioni della home (`Minuteria.daMinuti` /
  `tempoTrascorso` in `app.js`; sul server `fmt.daMinuti` / `fmt.tempoTrascorso`: le due versioni devono restare uguali). Quando un corriere accetta,
  `data-auto-refresh` ricarica la pagina nello stato "Confermata".
- **"Da preparare"** (`statoRichiestaBanco`: conferma + ordine del banco ancora `inviato`, non consegnato; pillola verde): la scheda d'azione ha il **timer del
  corriere** (`.ric-arrivo`: cerchio da 84px con i minuti a `orders.corriere_arrivo_il` e "ore HH:MM", rosso sotto i 15 minuti come la pillola della home, "In ritardo"
  a zero; `secondi_arrivo` calcolato in SQL dalla route, il JS `[data-ric-arrivo]` lo muove con `Minuteria.durataMinuti`) e **"Preparato"** (stesso POST del
  pulsante della home). **Come sulla home, quell'orario è la consegna dal cliente** (`corriere_arrivo_il`; nel DB non c'è l'arrivo al banco): la pagina lo
  dice ("Consegna dal cliente entro le HH:MM"). Senza orario (modulo spento) niente timer, solo "Preparato". "Avanzamento" mostra conferma e corriere **fatti**
  e "Da preparare" **in corso** (il pallino in corso prende il colore del suo tono: viola dei corrieri, verde del da preparare). Dopo "Preparato" l'ordine è
  `in_evasione` e la richiesta torna "Confermata", con "Gestisci l'ordine #N".
- **Timer** (`[data-ric-timer]`, blocco "Dettaglio richiesta del banco" di `app.js`): anello da 80px arancio come sulla home, **rosso negli ultimi
  2 minuti** (`SOGLIA_URGENTE_SEC = 120`; la home usa 3 minuti, `BACHECA.urgenteSec`). Come sulla home parte dai secondi rimasti e li trasforma in un
  istante col `Date.now()` del browser; a zero ricarica. "Rispondi entro le HH:MM" è `requests.scade_il` in ora italiana.
- **Tabella del materiale** (`tabellaMateriale`): Q.tà, articolo e codice, listino, prezzo per il cliente (sconto del banco + servizio, `cad. + IVA`),
  totale di riga. **"Totale per il cliente" = merce + contributo RAEE, IVA esclusa, senza la spedizione fissa** (che l'installatore paga alla piattaforma, non
  al banco: prima si mostrava `totali.imponibile`, che la include). Prima della risposta e se il banco rifiuta contano le quantità richieste; confermata,
  quelle confermate (le mancanti hanno "richiesti N, mancano M").
- **Passi**: con `WHATSAPP_ATTIVO=1` sono tre (conferma → avvisiamo i corrieri → prepari); **a modulo spento sono due**, perché non ci
  sono corrieri da avvisare e l'ordine nasce subito (vale anche per "Avanzamento"). Si vedono solo da confermare e in attesa del corriere.
- **Cliente sempre in vista**: nome, P. IVA, indirizzo (destinazione della richiesta, se no quello di consegna del cliente), telefono `tel:`. "Apri scheda
  cliente" solo se `anagrafiche.legame(banco, cliente)` esiste (altrimenti la pagina risponde 404: niente link morto).
- Prova: sei test "banco: richiesta ..." / "Preparato ..." in `test/server.test.js` (DB finto `richiestaProva`, che tiene la richiesta 177) e `test/richiesta_banco.test.js`.
  Sul DB vero: richiesta, cliente e utente banco di prova sul **banco AFIS (id 1, disattivato)**, inseriti con SQL (nessuna notifica, nessun banco vero la
  vede), poi cancellati; il timer di 30 s chiude da solo le richieste di prova scadute.

## Storico ordini del banco (14/10/2026)

`GET /distributore/storico` (`server.js`, logica in `src/storico_banco.js`) + `views/distributore_storico.ejs`, classi `sto-*` (blocco
"Storico ordini del banco" in fondo a `style.css`). **Prende il posto di "Tutti gli ordini" e di "Storico richieste"**: la vecchia lista
`/distributore/ordini` è un **301** verso lo storico (con la query string; il dettaglio `/distributore/ordini/:id` e i suoi POST non
sono cambiati, i ripieghi dei POST vanno a `/distributore/storico`) e le richieste chiuse non hanno più una pagina. Richieste esplicite,
non rimetterli: niente freccia indietro (è una scheda dell'intestazione, come Clienti: la vista include `banco_testa`, non `appbar`), niente
nota "Flusso del banco: …" in fondo.
- **Stato di un ordine**: `statoStorico(o)` è l'unico punto (e `CONDIZIONE_STATO` è la stessa regola in SQL: conteggi delle schede e filtro
  della lista non possono divergere). **`consegnato_il` si guarda per primo**: con `/consegnato-prova` un ordine risulta consegnato restando
  `inviato` (oggi l'ordine #91 è così). Poi `inviato` = Da preparare (verde), `in_evasione` = In preparazione (arancio), `evaso` = Partito (blu),
  consegnato = grigio.
- **Filtri nell'URL**, tutti lato server: `?stato=tutti|da_preparare|in_preparazione|partiti|consegnati&periodo=oggi|7|30|tutti&q=&pagina=N`
  (default tutti e 7 giorni; valori sconosciuti tornano al default). Il periodo ragiona in **ora italiana** sulle colonne `TIMESTAMP` UTC: "oggi" è
  la mezzanotte di Roma, 7 e 30 sono gli ultimi N giorni da adesso. La ricerca è `ILIKE` su ragione sociale e numero DDT, più `o.id =` se quello che
  si scrive (tolto un `#`) è solo cifre; i `%` e `_` scritti dall'utente valgono per sé; sempre con segnaposto. **I conteggi delle schede** sono una
  query con `COUNT(*) FILTER` con gli stessi filtri di periodo e ricerca ma **senza** lo stato (il numero dice cosa si trova cliccando). Lista: `o.id DESC`,
  50 per pagina (`partials/paginazione.ejs`, con `parametro: 'pagina'` e `unita: 'ordini'`; una pagina oltre l'ultima mostra l'ultima), materiale con una
  sola lettura di `order_items` per tutta la pagina. Righe raggruppate per giorno italiano (`fmt.giornoRoma`); "N ordini" conta le righe della pagina.
- **Aggiornamento automatico**: la pagina ha `data-auto-refresh` e `data-versione` come le altre del banco, e il blocco in `app.js` **non ricarica**
  finché un campo con `data-non-ricaricare` (la ricerca) ha testo non ancora inviato (`value !== defaultValue`), anche senza fuoco. Si ricarica
  solo quando i contatori della home cambiano: una consegna (`consegnato_il`) non li cambia, quindi non fa ricaricare lo storico da sola.
- **Sotto i 900px**: ricerca a tutta larghezza, schede che scorrono di lato senza barra, la tabella diventa una lista di card (quattro righe, senza la
  città). Da 640px in giù il pulsante "Storico ordini" della barra sparisce e resta la voce nella tendina; il menu in basso è sempre Home e Clienti.
- Prove: `test/storico_banco.test.js` (parti pure) e i quattro test "banco: Storico ordini…" / "/distributore/ordini porta allo Storico" in
  `test/server.test.js` (DB finto che tiene SQL e parametri delle query). Per provarlo sul DB vero serve un utente `distributore` di prova (non quelli
  del README: sono persone vere): `INSERT INTO users` con `bcrypt`, poi cancellarlo con le sue `session`. **Non aprire dal browser il dettaglio di un
  ordine `inviato`**: `prendiInCarico` lo porta in preparazione e avvisa il cliente.

## Clienti del banco (14/10/2026)

`views/distributore_clienti.ejs` e `views/distributore_cliente.ejs` (classi `cli-*`, blocco "Clienti del banco" in
fondo a `style.css`); logica di approvazione, rifiuto e sconti **invariata** (`POST .../decidi` e `.../sconti`, stessi
campi `codice_cliente`, `note`, `azione`, `sconto<n>_<ambito>_<chiave>`). Richieste esplicite, non rimetterli:
- **Niente freccia indietro né riga titolo** in cima all'elenco: "Clienti" è una scheda dell'intestazione, quindi le due
  pagine includono `partials/banco_testa` **senza** `intestazione`/`indietro` (non passare da `appbar.ejs`). Titolo
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
- Il cerchio con le iniziali è `partials/iniziali` con il parametro `tono` (`arancio` = da verificare, `grigio` =
  rifiutato, nessuno = blu/approvato).
- Pagina del cliente: colonna sinistra = dati (fatturazione in 3 colonne, "Controlla su VIES ↗" in una nuova scheda,
  sede legale e consegna abituale, contatti `tel:`/`mailto:`), destra = decisione. Per i **da verificare e i rifiutati**
  la decisione va sopra i dati sotto i 900px; per gli approvati (codice, note, sconti) no. **Una voce senza dato non si
  disegna** (PEC, consegna, referente, telefono, email). La consegna abituale è una stringa sola
  ("Via X 1, 16131 Genova (GE)"): la via è ciò che sta prima della prima virgola. La città si mostra com'è salvata
  (un cliente ha "Génova" con l'accento nel DB: richiesta esplicita di non correggere i dati).
- Il riquadro "È un tuo cliente?" è `sticky` con `top: 80px` (64px dell'intestazione, anch'essa sticky, + 16px): con
  `top: 16px` finirebbe sotto la barra. La conferma sul rifiuto è un `onclick="return confirm(...)"` sul solo pulsante
  "rifiuta" (il form è uno, con i due pulsanti `name="azione"`).
- La barra "Salva gli sconti" (`.barra-azione`) da 900px in su sta a `bottom: 0` (il menu in basso non c'è).
- Prova: `test/server.test.js` ("banco: elenco clienti..." e "banco: pagina del cliente..."). Nel browser, per provare
  approvazione e rifiuto non usare i clienti veri (un "da approvare" è una persona reale): creare due clienti di prova,
  provare, **cancellarli per id** (users, client_distributors, notifications, client_discount_rules).

## Aggiornamento automatico del banco

Le pagine del banco (home, ordini, clienti, dettaglio richiesta) hanno `data-versione` = i contatori
con cui sono state disegnate e chiedono ogni 5 s `/api/distributore/novita` (gli stessi contatori, più
ultima richiesta/ordine e corrieri in attesa): se cambiano si ricaricano, anche se la scheda era in
secondo piano (aspettano di tornare visibili o che finisca la digitazione). Prima era una ricarica a
tempo che saltava le schede nascoste. Le risposte hanno `Cache-Control: private, no-cache`.

## Gruppo WhatsApp dei corrieri (`src/whatsapp.js`)

Flusso e variabili in README. Qui solo ciò che non si deduce dal codice.
- **Mai acceso in locale**: `WHATSAPP_ATTIVO=1` solo sulla VPS, mai nel `.env` locale. Il `.env` locale
  punta al DB di produzione: un ordine fatto in locale, con il modulo acceso, scriverebbe nel gruppo
  vero; e due istanze accese leggono lo stesso gruppo (risposte doppie, coda inviata due volte: lo
  svuotamento non "prenota" le righe). Spento, `accodaRitiroConsegna` non scrive nemmeno in coda. Per
  provare dal PC c'è `scripts/prova_whatsapp.js`, che si accende da solo e usa una richiesta finta.
- Baileys è **7.0.0-rc14** (l'ultima; la 6.x è il tag `legacy`), ESM: caricato con `import()` dentro
  `collega()`. Non ufficiale: il numero può essere bloccato. Logger muto finto (passare pino non serve).
- L'orario d'arrivo del corriere sta in colonne `TIMESTAMPTZ` (`corriere_arrivo_il`), a differenza
  del resto dello schema (TIMESTAMP UTC senza fuso): si mostra con `format.oraRoma`, ora italiana
  fissa perché la VPS può essere in UTC.
- Il bot è il numero personale dell'utente, quindi ciò che scrive dal telefono arriva come messaggio
  `fromMe` e **vale come risposta**. I messaggi del bot (ordine, conferme) contengono «preso» e un
  `#id`: restano fuori perché Baileys li emette come `append` (si elabora solo `notify`) e, in più,
  per id (`inviatiDalBot` e `whatsapp_messaggi.wa_msg_id`). Non togliere questi controlli.
- **Il messaggio parte quando il banco accetta**, non alla nascita dell'ordine (`richieste.rispondi` →
  `whatsapp.accodaRitiroConsegna`). Lo stato sta su `request_responses.corriere_stato` (NULL = nessun
  corriere richiesto / modulo spento, `in_attesa`, `preso`, `scaduto`): le query che l'installatore vede
  filtrano con `OFFERTA_VISIBILE` (richieste.js) e `raggruppaRisposteDitta` mostra "in attesa"/"nessuna
  risposta". Una nuova query sulle offerte deve usare lo stesso filtro. `corriereHaPreso` è atomica (la
  finestra è dentro la UPDATE). Chi ritira i messaggi (`ritiraRichiesta`) scrive solo righe: li
  elimina/manda l'istanza collegata, dalla coda (`da_eliminare`, ~60 s se a scadere è un altro server).
- Dopo il "preso" la prima filiale che ha accettato resta l'unica: le altre della ditta sono già chiuse,
  quindi se nessun corriere risponde non c'è un secondo tentativo con l'altra filiale.
- La risposta si abbina alla richiesta dal messaggio **citato** (`wa_msg_id` in `whatsapp_messaggi`), o da
  `#id` nel testo se quell'ordine ha un nostro messaggio. Senza parola chiave è chiacchiera: ignorata.
- Dopo il "preso" il bot **non scrive più** (richiesta esplicita: l'ordine nasce al "preso", quindi niente
  "il cliente ha confermato"; `avvisaOrdine` è stato tolto). Restano solo la risposta al "preso" e gli
  avvisi di annullo: messaggi `esito` accodati da `avvisaAnnulloOrdine` e `ritiraRichiesta(..., { motivo })`.
- Prova senza gruppo vero: `impostaSocket` in `_prova` mette un socket finto; richieste di prova sul
  banco AFIS (id 1, disattivato: nessun utente attivo riceve notifiche), poi cancellare per id.
  Con il gruppo vero: `scripts/prova_whatsapp.js`.

## App nativa (`mobile/`)

Panoramica e avvio in README. Qui solo ciò che non si deduce dal codice.

- React Native + Expo (Expo Router in `mobile/src/app/`), **niente WebView** per scelta
  esplicita. Fase 1 solo installatore, poi banco "leggero", l'agente resta web. Le API Expo
  cambiano a ogni SDK: guida e regole in `mobile/AGENTS.md`, doc versionata prima di scrivere.
- `src/api_v1.js` è montata in `server.js` **prima** di controllo origine, sessione e middleware
  `res.locals`: solo token Bearer (`src/token_app.js`), CORS aperto (nessun cookie in gioco).
  `/api/v1/login` rifiuta i ruoli diversi da `cliente`.
- Logica condivisa col sito, non duplicata: tutto il flusso richiesta pagata → ordine →
  stato ordini in **`src/flusso_cliente.js`** (le route di `server.js` fanno solo render/redirect:
  non rimetterci logica), più `src/prodotto_json.js` e `src/limite_login.js`.
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
- `mobile/src/icone.ts` è **generato** da `src/icone.js` (`node scripts/genera_icone_app.js`).
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

## Notifiche

Badge "Stato ordini" somma non lette di `ordini`+`richieste`. Ricalcolare **dopo** averle
marcate lette se la route fa render diretto (non redirect), altrimenti resta il valore vecchio.

## Audit web del 05/10/2026 (convenzioni nate da lì)

Solo sito/PWA (`mobile/` non toccata, schema DB e logica di business invariati). Cosa c'è di nuovo e perché:

- **`src/http.js`**: tutto il lato HTTP "trasversale", senza DB (quindi si prova con un'app Express vuota).
  `leggiQuery` è il *query parser* dell'app: ogni parametro è **sempre una stringa** (con quello di Express 5
  `?q=a&q=b` dava un array e `(req.query.q || '').trim()` andava in 500). `corpoSempreOggetto`: Express 5 lascia
  `req.body` *undefined* se nessun parser lo legge. `idNumerico` (`app.param('id', ...)` in `server.js`,
  `router.param` in `api_v1.js`): un `:id` che non è un intero positivo da int4 è un **404**, non una query che
  fallisce. `gestoreNonTrovato` + `gestoreErrori` stanno **in fondo a `server.js`**: JSON per `/api/...` (forma
  `{ ok: false, errore }`, la legge anche l'app nativa via `errore`), pagina `errore` per il resto, mai lo stack;
  i 4xx del client (JSON malformato, 413) tengono il loro codice; se la pagina di errore non si disegna c'è una
  pagina di ripiego inline.
- **`src/auth.js`**: sessione scaduta su `/api/...` → **401 JSON** (prima un redirect alla pagina di login HTML,
  che faceva fallire `.json()` nel browser); ruolo sbagliato → pagina `errore` 403 (o JSON).
- **`src/input.js`**: `leggiId`, `leggiQuantita`, `QUANTITA_MASSIMA = 9999` (tetto per riga di carrello; anche
  `max="9999"` nei campi e `public/app.js`: i tre devono restare uguali). Usati dalle route del carrello, da
  `flusso.righeDaQuantita` e dalla registrazione. `righeCarrello` toglie dal carrello di sessione gli articoli non
  più attivi (prima il pallino li contava senza che la pagina li mostrasse); `/api/carrello/imposta` con un id
  inesistente risponde 404.
- **Accesso**: `src/password.js` (`passwordValida`: bcrypt asincrono, confronto con hash fittizio se l'utente non
  esiste, password non-testo respinta) condiviso da `POST /login` e `/api/v1/login`; login e registrazione
  rigenerano la sessione (`avviaSessione`, contro la session fixation); credenziali errate → **401** (non 200);
  cookie `secure: 'auto'` (Secure solo se la richiesta è davvero HTTPS: oggi il sito gira anche in HTTP).
- **Registrazione**: `validaIscrizione` ora controlla lunghezze (200; password max 72 per bcrypt), che
  `tipo_soggetto` sia una chiave vera (`Object.hasOwn`, non `constructor`) e che i campi siano testo; l'`INSERT`
  che incappa nel vincolo unico del nome utente (23505, corsa fra controllo e inserimento) rimostra il modulo
  con l'errore invece di un 500.
- **Bolla (DDT)**: `ddt.emetti` ora ritorna `{ numero, nuovo }` e **ricontrolla dentro la transazione**, con la
  riga dell'ordine bloccata (`FOR UPDATE`): un doppio invio assegnava due numeri e lasciava un buco nella
  numerazione. La notifica "Merce in partenza" parte solo se `nuovo`.
- **Fusi orari**: `flusso.eta()` usa `format.istanteUtc` per le finestre di 3 e 24 ore di `attivitaCorrente` e
  `statoIconaOrdini` (prima `new Date(colonna)` sbagliava dell'offset del fuso sul PC; sulla VPS in UTC nessuna
  differenza). Regola già scritta sopra, applicata a due punti rimasti.
- **Velocità**: home del banco e scheda cliente non fanno più una query per card/marchio in ciclo
  (`righeRichieste` e un `ANY(?::int[])` su `order_items`; famiglie dei marchi in `Promise.all`);
  `eliminaRichiesta` cancella le righe delle risposte con una sola `DELETE ... IN (SELECT ...)`.
- **Redirect dopo una scrittura in sessione** (`src/http.js`, `salvaSessionePrimaDelRedirect`, montato subito dopo
  `session()`): express-session manda intestazioni e quasi tutto il corpo e **solo dopo** scrive la sessione nel DB.
  Un JSON lo si legge intero, un redirect il browser lo segue appena ha le intestazioni: la pagina di arrivo leggeva la
  sessione vecchia ("Svuota carrello" → home col carrello ancora pieno, 6 volte su 12 sul DB vero; stesso rischio per
  "Riordina", per l'invio della richiesta e per l'avviso del carrello). Il middleware avvolge `res.redirect`: se la
  route ha cambiato la sessione (confronto con l'inizio richiesta, cookie escluso) la salva prima di rispondere.
  Non togliere `req.session.save` da `avviaSessione`; per nuove route con `req.session.x = ...; res.redirect(...)`
  non serve fare altro. Prova: `test/sessione_redirect.test.js` (archivio lento).
- **Ricerca e scroll infinito** (categoria, `app.js`, oggetto `scorrimento`): durante una ricerca lo scroll infinito sta
  fermo (prima accodava ai risultati le pagine successive della sottocategoria: 2 risultati diventavano 37), e svuotando
  il campo riparte dalla pagina con cui la pagina era stata disegnata, senza far ricomparire i pulsanti di pagina. Una
  pagina richiesta prima della ricerca e arrivata dopo si scarta (`generazione`). Aperta una pagina con `?q=` (invio
  dalla tastiera) svuotare il campo rimette ancora i risultati di quella `q`, non l'elenco: non toccato.
- **Pagine rimostrate dal tasto "indietro" (bfcache)**: lo stato della barra in basso (`partials/nav_ordini.ejs`) si
  rilegge a `pageshow` persisted e quando la scheda torna visibile, invece di aspettare il timer (un minuto in
  consegna: con un ordine in consegna e una nuova richiesta in attesa restava "In consegna"); il carrello di home,
  ricerca, marchio e "con foto" si rilegge da `/api/carrello` (le pagine categoria già lo facevano). Un pannello
  del browser incorporato nascosto non esegue IntersectionObserver né rAF: per provare scroll e simili serve
  `tabs_select` e uno screenshot (anche se scade) prima dello script.
- **Cache degli asset**: `app.locals.asset('/style.css')` → `/style.css?v=<mtime>` (riletto ogni 5 s); gli URL con
  `?v=` e solo `style.css`/`app.js`/`mappa.js` escono con `Cache-Control: public, max-age=31536000, immutable`.
  **Le viste vanno scritte con `asset(...)`**, non con `/app.js` nudo (quello resta sul solo ETag). `/favicon.ico`
  è servito prima della sessione. Header `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`;
  niente CSP (script e stili inline). Chiusura pulita su SIGTERM/SIGINT; il controllo scadenze (30 s) non si
  sovrappone.
- **PWA** (`public/manifest.webmanifest`, `public/sw.js`, `public/icons/`): il service worker **non mette niente in
  cache** (pagine e API sono dati di chi è collegato) e serve solo a mostrare le notifiche su Chrome Android, dove
  `new Notification()` lancia (`Minuteria.mostraNotifica` in `app.js` prova il costruttore e ripiega su
  `registration.showNotification`) e a rendere l'app installabile. **Funziona solo in HTTPS** (o localhost): finché
  il sito resta su HTTP semplice non succede niente, senza errori. Le icone (lettera "M" su blu) sono
  **segnaposto**, rigenerabili con `node scripts/genera_icone_pwa.js`; manca ancora il logo vero.
- **Browser**: `leggiJson` (in `Minuteria`, testa di `public/app.js`) gestisce il 401 delle chiamate `/api` tornando
  al login; i pulsanti disabilitati dall'anti-doppio-invio si riattivano se la pagina riappare da "indietro"
  (`pageshow`, bfcache); il blocco "Consegna in cantiere" non va più in errore (e non ferma lo script) se manca
  un suo elemento. I font di Google si caricano senza bloccare il disegno (`media="print"` + `onload`).
- **CSS**: `overflow-x: clip` su `body` come rete di sicurezza *in più* delle cause vere (testi lunghi senza spazi
  con `overflow-wrap: anywhere`; `.carrello-layout > * { min-width: 0 }`; `.art-azioni` che va a capo a 320px;
  appbar a tutta larghezza da ≥720px senza il vecchio `width: 100vw`, che partiva 15px fuori dallo schermo con la
  barra di scorrimento). `.barra-azione` (banco, "Salva gli sconti") sta **sopra** la navbar (prima la copriva).
  Campi `email`/`tel` ora stilizzati (erano quelli del browser, 13px); `select` e campi sconto ≥16px (iPhone zoomava);
  aree di tocco ≥44px su ricerca, quantità digitata, chip, paginazione, schede login, "Vedi tutti gli ordini",
  "togli dalla lista" (cerchio da 28px con area estesa da `::after`). Safe area (`env(safe-area-inset-*)`) su
  appbar e foto a schermo intero.
- **Prove**: `npm test` (`node:test`, nessuna dipendenza). `test/server.test.js` avvia il vero `server.js` con un DB
  finto in memoria (sostituisce `db/index.js` nella cache dei moduli *prima* di caricarlo: non apre mai
  connessioni a Postgres); `test/http.test.js` prova `src/http.js`/`auth.js`/`input.js`; `test/sw.test.js` esegue
  `public/sw.js` in un contesto isolato. Il pannello browser incorporato non registra service worker (nemmeno uno
  banale), quindi `sw.js` si prova solo lì e in un browser vero su HTTPS.
- Resta da decidere/fare (non toccato): l'avvio crea i dati con `db/seed` se `products` è vuota (rischioso in
  produzione se il catalogo viene svuotato durante un reimport: il seed riscrive le password demo); CSS non più
  usato (`.offerta*`, `.stepper-3`, `.card-richiesta*`, `.tessera-marchio`...); funzioni senza chiamanti ma
  pensate per flussi futuri (`anagrafiche.distributoriApprovati`, `catalogo.misureDisponibili`,
  `notifiche.spostaInOrdini`/`aggiornaStatoOrdine`: quest'ultima servirà all'evento "consegnato").

## Script e file temporanei

- Script una tantum in root con prefisso `_tmp_` o nello scratchpad di sessione: il `.gitignore` copre solo
  `_tmp_backup_*.json`, **non** gli altri (un `git add -A` li prenderebbe, e `scripts/_tmp_icone_review.html` è perfino tracciato):
  cancellarli dopo l'uso.
- Per parlare col DB da uno script: `require('dotenv').config()` e `pg` con `ssl: {
  rejectUnauthorized: false }`, oppure `require('./db')` per usare i moduli del progetto. Cambi di
  dati sul DB condiviso: prova a secco in transazione con ROLLBACK, poi conferma; copia delle righe
  toccate fuori dal repo.
- Pulire dopo una prova **per id o per link**, non per data: `creato_il` è un `timestamp` UTC senza
  fuso e un `Date` locale di JS lo confronta con 2 ore di scarto (le notifiche ai banchi restavano).
- Una sessione web **resta valida anche dopo `attivo = 0`** (il login controlla `attivo`, la
  sessione no): chi si disattiva va tolto anche dalla tabella `session` (lo fa
  `scripts/imposta_borea_filiali.js`). I token dell'app invece si controllano a ogni richiesta.
