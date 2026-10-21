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
  (0,5 → "1 min", `Math.round`): con 30 s sono imprecisi, non toccati. Un corriere su WhatsApp avrebbe 30 s per rispondere (la finestra è la stessa): togliere la riga quando si accende WhatsApp in locale.

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
  filiale la vedono banchi e agente (pannello banco). Il blanking sta nei punti **solo cliente**:
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
  scritto su tutte le filiali della ditta. Gli sconti (`client_discount_rules`)
  sono per filiale, non per ditta.
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
- **Refusi (rifatti il 16/10/2026)**: la ricerca è **prima esatta** (parte di parola, indice trigram); i refusi si tentano **solo se le schede esatte
  sono meno di 10** (`MINIMO_RISULTATI_SENZA_REFUSI`), in un secondo passo: candidati dal DB con `word_similarity >= 0.55` (`SOGLIA_REFUSI`) e poi filtro in JS
  (`corrispondeConRefusi`: per ogni parola, una parola del nome a distanza di Levenshtein ≤ 1, ≤ 2 dalle 8 lettere, anche se il nome è più lungo perché si sta
  ancora scrivendo). Prima si cercava sempre per somiglianza 0.45 e le parole lunghe attiravano nomi senza rapporto: "adattatore" trovava "contatore",
  "alimentatore", "scambiatore" (336 risultati su 551 sbagliati, più di "adatt": 248), "caldaia" trovava "turbina", "termostato" 452 nomi di troppo. Il DB **non ha
  `fuzzystrmatch`** (niente `levenshtein` in SQL, e non si installa estensioni sul DB condiviso): per questo il controllo è in JS. Il ripiego costa ~0,7 s (solo
  quando scatta); legge righe intere solo dei risultati tenuti. Numeri e sigle (`dn50`, `3/4`) non hanno refusi.
- **Singolare/plurale** (`radiceParola`): da 5 lettere senza la vocale finale ("valvole" trova le "valvola", "raccordi"/"raccordo", "adattatori"/"adattatore",
  "doccia"/"docce"). Il termine intero si cerca ovunque come prima, la **radice solo nel nome**: su tutto il testo "rubinetto" pescava l'intera categoria
  "Rubinetteria" (744 in più). A 4 lettere niente radice ("tub" prenderebbe quasi tutto). Prima lo faceva per caso la somiglianza.
- **Il limite conta le schede, non le righe** (`LIMITE_RISULTATI` = 100, uguale per ricerca live, `/cerca`, categoria, marchio): il `LIMIT` stava sulle righe e le varianti si
  raggruppavano DOPO, quindi con 60 si vedevano da 23 a 54 schede a seconda della parola ("adatt" 23, "adattatore" 50) e il resto spariva senza avviso. Ora una riga per gruppo
  (`ROW_NUMBER() OVER (PARTITION BY COALESCE(gruppo_id, -id))`) **prima** del `LIMIT` (si chiede limite+1: l'elenco porta `troncato` non enumerabile → `elenco.troncato`, JSON
  `troncato`, nota "Mostrati i primi risultati" in pagina e nella ricerca live, "Oltre N risultati"). Finestra e ricerca lavorano su poche colonne e rileggono le righe intere solo
  dei risultati (sulle righe intere +80 ms a pagina). Provato: "ada" 260 ≥ "adat" 236 ≥ "adatt" 211 ≥ "adattatore" 191, e ogni risultato di una parola lunga c'è anche in quella corta.
- **Parole di ricerca** (`dividiTermini`): `%` e `_` valgono per sé (`escapeLike`; "%%" leggeva tutto il catalogo in 3 s), la sola punteggiatura non è una parola (niente query),
  "dn 50"/"ø 20" si uniscono e `ø20`/`dn50`/`ø20mm` cercano la misura intera con confine (`ø\s?20(?!\d)`: prima "ø20" trovava "Ø200"). Prove: `test/ricerca.test.js`.
- **Ancora lente** (non toccate, stesso costo di prima): ricerche in pollici (`3/4"`) con l'equivalenza in mm, che fanno una regex su tutti i nomi; e "diametro N" / "N mm"
  come due parole separate (non una misura).
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
- **Elenchi** (`paginato`): conteggio (in cache) e pagina partono insieme. **Dal 16/10/2026 si pagina per schede**: una riga per gruppo prima di `LIMIT/OFFSET`, totale = `COUNT(DISTINCT COALESCE(gruppo_id, -id))`
  (prima 40 prodotti per pagina che si riunivano in da 2 a 34 schede, e la stessa famiglia sparsa su più pagine ricompariva in ognuna: "Raccorderia e valvole" 6079 prodotti → 2517
  schede, 63 pagine da 40, nessuna ripetuta). Le varianti dei gruppi
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
provvisorie). Variabili CSS in cima a `public/style.css`.
- Verde/arancio/rosso sono scuriti per portare i badge a 4.5:1 (stessi valori in
  `mobile/src/tema.tsx`).
- I `<button>` non ereditano il font (`button { font-family: inherit }`); campi input ≥16px, sotto
  Safari iPhone ingrandisce la pagina al tocco.
- Quirk mobile da non reintrodurre: `autocomplete/autocorrect/autocapitalize="off"` sui campi
  ricerca; ripristino focus dopo il redraw risultati (altrimenti la tastiera si chiude); tutte le
  barre di ricerca usano lo stesso `[data-ricerca]`, mai una navigazione mentre si scrive.
- **Carrello web** (richieste esplicite del 04/10/2026, non rimetterli): niente frasi di spiegazione
  (pezzi nel carrello, minimo raggiunto, "paghi ora / pagamento di
  prova"), niente codice/categoria sotto l'articolo, **niente scritta "N articoli · M pezzi"** (in cima c'è
  solo "+ Aggiungi pezzi"), niente riga "Imponibile" e niente "2 × € … → €…": la scheda articolo ha prezzo
  `cad. · IVA esclusa`, cestino, stepper e totale riga. Ordine pagina: articoli → "Consegna in cantiere"
  (campo `destinazione` che si apre con "Cambia"; Invio nel campo vale "Fatto", non paga) → nota facoltativa
  (`<details>`, campo `note`) → riepilogo (dal 17/10/2026 la card "Cosa paghi e a chi": vedi "Pagamento") → "Svuota carrello" (in fondo, link sottolineato, con conferma). L'importo
  "Paghi ora" e **"Paga e invia richiesta"** stanno nella barra fissa `.barra-paga` sopra la navbar (il pulsante
  invia `#form-invia` con l'attributo `form=`); `--altezza-barra-paga` in `style.css` è lo spazio da
  lasciare in fondo alla pagina: se la barra cambia altezza, aggiornarlo. L'app mobile non ha ancora seguito
  queste modifiche.
- **Righe compatte ovunque (richiesta esplicita del 16/10/2026)**: ricerca (`/cerca` e ricerca live della home), "Elementi con foto" (`/con-foto`), marchio (elenco di una famiglia) e
  categoria usano **tutte** `partials/prodotto_riga.ejs` (foto 56×56 a sinistra, stepper `− N +` che salva a ogni tocco, niente "Aggiungi", barra `.barra-vai` in basso);
  `.app-categoria` dà lo spazio in fondo. Ogni pagina ha `#risultati[data-righe-compatte]` con `data-carrello`, `data-pezzi`, `data-icona-vuota` (la home li ha sull'elenco
  delle categorie: la ricerca live ci disegna le righe con `rigaCompattaHtml`, e `/home` passa `carrello`). **La card classica `partials/prodotto.ejs` non è più usata da nessuna pagina**, e con lei
  il blocco "scelte" qui sotto (`[data-passo]`, "Aggiungi (N)", sessionStorage) è codice rimasto in `app.js` ma senza pagine che lo usino: non reintrodurre card diverse, e se
  si pulisce `app.js` si può togliere. Prova: test "ricerca, "Elementi con foto" e home: righe compatte..." in `test/server.test.js`.
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
  tutte le consegne vanno in…" né un link di recupero password **dentro la registrazione** (il "Password dimenticata?" sta solo sul login, vedi "Account dell'installatore"). **Un solo `<form>`** con tre
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
- **Storico ordini = materiale e quanto si deve a BOREA** (`views/storico.ejs`, `partials/storico_riquadro.ejs`, `partials/storico_ordine.ejs`; richiesta
  esplicita del 16/10/2026, sostituisce lo storico a schede del 05/10; classi `sm-*`, `st-stato`, `st-riordina`). **Dati e calcolo in `src/materiale.js`**
  (`materialeOrdini`), lo stesso calcolo su cui sta la scheda "Materiale ordinato" della pagina del cliente lato banco (`materialeCliente`, vedi "Clienti del banco"):
  banco e installatore non possono vedere cifre diverse (test "banco e installatore vedono le STESSE cifre": confronta i numeri, il markup e il CSV del banco sono suoi). Regole: prezzo cad. IVA inclusa
  = `(prezzo_netto_unitario + raee_unitario) × (1 + iva)`, totale riga = `(subtotale + raee_riga) × (1 + iva)`, totale ordine = somma delle righe; **mai**
  `prezzo_unitario_cliente`/`subtotale_cliente` nei totali del materiale (sono il prezzo col servizio, che si paga in app); tutto dai valori **salvati**
  nell'ordine, IVA compresa (`iva / imponibile` dell'ordine, ripiego la config). **"Servizio pagato in app"** per ordine = l'importo realmente addebitato
  (`requests.pagamento_importo`, con Stripe già aggiornato all'incassato) **se coerente** col calcolo `(Σ(subtotale_cliente − subtotale) + costo_consegna) × (1 + iva)`
  (tolleranza 1 centesimo); altrimenti il calcolo (gli ordini di prima, pagati interi in app, e quelli senza importo salvato). È servizio **+ consegna** e non
  entra mai nel totale del materiale. Filtri: `?mese=AAAA-MM|tutto` (default il mese corrente se ha attività, altrimenti il più recente; valori sbagliati tornano lì),
  `?vista=ordine|articolo`; mesi in **ora italiana** (`format.meseRoma`). Compaiono **tutti** gli ordini (anche in preparazione: **solo due etichette**, richiesta esplicita del
  18/10/2026, non rimettere "In consegna": Consegnato = `consegnato_il`, In preparazione = tutto il resto, anche `evaso`, perché dopo il "preso" del corriere su WhatsApp nel DB non c'è
  nessun evento di ritiro o partenza; il banco dal suo lato dice "In consegna", vedi "Stati dell'ordine per il banco"), niente più "In corso" (le richieste in attesa stanno in Stato ordini), le richieste chiuse senza ordine
  (nessuna risposta, annullate) **nello stesso elenco degli ordini, dal più recente per data di creazione, SENZA una sezione "Senza ordine" e con la STESSA scheda dell'ordine** (richieste esplicite del
  19/10/2026: `materialeOrdini` ritorna `elenco` = ordini e richieste fusi, a parità di istante prima l'ordine; `gruppi`/`senzaOrdine` restano per riquadri, vista per articolo e test; scheda in
  `partials/storico_richiesta.ejs`: "Richiesta #N" + data compatta, "Nessun costo" al posto dell'importo, stato + primo articolo + "+altri"; le righe vengono da `request_items` con UNA lettura per tutte, insieme
  alle altre, e hanno solo quantità e nome perché le richieste non salvano prezzi). Un riquadro blu per **ditta** (oggi una, BOREA; mai la filiale; con più ditte i chip del mese stanno
  nel primo). Per ordine: `<details>` **tutti chiusi all'arrivo** (richiesta esplicita del 18/10/2026: non riaprire il primo); "Riordina" (solo consegnati) è un form `POST /storico/:id/riordina` fuori dal `<summary>`,
  "Dettagli ›" va a `/ordini/:id`. Per articolo: righe sommate per (codice, nome, prezzo cad.), dal totale più alto. **CSV** `GET /storico/materiale.csv?mese=`: `;`, BOM UTF-8, una riga per articolo, servizio sulla prima riga di ogni
  ordine, totali in fondo, celle che cominciano per `= + - @` con un apice (nomi come "- Materiale di montaggio" esistono nel catalogo). Il banco ha un suo CSV, senza servizio
  (vedi "Clienti del banco"). Prove: `test/materiale.test.js` e i test "storico: ..." di `test/server.test.js`. Il fondo pagina è 96px (`.app-storico`).
- **Verifica disponibilità** (`views/richiesta_attesa.ejs`, richiesta esplicita del 04/10/2026, non rimettere
  paragrafi di spiegazione, "Hai pagato…", pulsante notifiche): timer con anello da 148px che si **svuota**,
  tre passaggi (`<ol>`), una scheda per banco, scheda "Materiale richiesto" (`partials/richiesta_materiale.ejs`: righe a prezzo del banco con "Cod. … · € cad.", "Merce · IVA
  esclusa · prezzi del banco"), scheda **"Pagamenti"** (`partials/pagamenti.ejs`, stato `attesa` = 'bloccato': consegna AZZURRA col lucchetto "Bloccati sulla carta · addebitati solo se BOREA conferma" (la carta è solo autorizzata), materiale
  IN SOSPESO, bordo tratteggiato e importo grigio, "Lo paghi a BOREA solo se conferma"; vedi "Importi della richiesta" nel Pagamento e "Pagamenti lato installatore" sotto), "Annulla" come link **solo finché nessun banco ha accettato** (sparisce da sé, anche dal polling). Anello e
  numero sono `[data-arco]`/`[data-countdown]` come l'icona della navbar: li muove **lo stesso timer** di
  `nav_ordini.ejs` (stessa durata `scade_il − creato_il`, stessa formula), per questo il numero non ha più
  `id="countdown"` e il vecchio `mostraTempo` di `app.js` non scrive più niente. Il polling di `app.js` riscrive
  testo e classe di `[data-distributore]` (`stato-badge stato-<esito>`): il puntino davanti all'etichetta è un
  `::before` di `#stato-distributori .stato-badge`, così resta; "In attesa" lì si chiama "Sta verificando" (anche
  nel polling). **Niente più "Elimina definitivamente"** (richiesta esplicita del 17/10/2026, non rimetterlo): in attesa si può solo annullare; la rotta di
  eliminazione c'è ancora e si usa dalla pagina della richiesta chiusa. Non rimettere nemmeno la riga "Pagato" né "Richiesta del … · prezzi IVA esclusa".
- **Richiesta scaduta** (`views/richiesta_chiusa.ejs`, richiesta esplicita del 05/10/2026; classi `att-*`,
  modificatore `.att-rosso`): il layout nuovo vale solo per `nessuna_offerta`; la richiesta **annullata** dall'installatore ha ancora il markup
  vecchio, ma con le stesse schede "Materiale richiesto" e "Pagamenti" (stato `chiusa`, `motivoChiusura: 'annullata'`, senza nota di rinvio). Niente animazioni. Anello vuoto, "00:00" grigio, pallino "!" a 45° sul bordo, titolo
  "Nessun banco ha confermato" (**"Nessun corriere ha confermato"** se un banco aveva accettato e nessun corriere ha preso la consegna in
  tempo, richiesta esplicita del 15/10/2026: `raggruppaRisposteDitta` porta `bancoConfermato` e la vista lo legge con `esito === 'scaduto'`;
  in quel caso il banco ha il chip verde "Disponibile", e la notifica di chiusura dice lo stesso, scelta da `esito.corrieriScaduti` in
  `chiudiFinestraRisposte`), pillola verde "Nessun addebito sulla carta" (dal 18/10/2026, al posto di "€ X rimborsati" / "Rimborso in corso": la carta era solo bloccata, non c'è nessun rimborso; senza pagamento niente pillola), un banco per ditta con il suo stato reale. Sotto il titolo
  "Il tempo per rispondere è scaduto." (non più "di N minuti": non dipende dalla finestra). Dopo il materiale la scheda **"Pagamenti"** (stato `chiusa`, dal 18/10/2026 UNA sola riga grigia "Nessun addebito · € 0,00" con la carta di credito, niente furgone né verde né
  materiale né dettaglio né ricevuta: "Il blocco di € X sulla carta è stato annullato. Nessuna consegna, niente da pagare a BOREA." o, se annullata da lui, "Hai annullato la richiesta: il blocco
  di € X è stato tolto dalla carta."); al posto del dettaglio la nota "Se rinvii la richiesta blocchiamo di nuovo € X sulla carta, addebitati solo se BOREA conferma. Il materiale (€ Y) lo paghi a BOREA."
  con X e Y ricalcolati OGGI (`dettaglioRichiesta` → `rinvio`). Niente più "Richiesta del …" in fondo al materiale.
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
  dello storico), **una sola scheda** banco + materiale ("Materiale consegnato", "Ordine #N", righe a prezzo del banco) e la scheda "Pagamenti"
  (consegna pagata in app / materiale da pagare a BOREA, mai un totale unico; dal 17/10/2026, vedi "Importi dell'ordine" nel Pagamento); pulsante
  "Ho ricevuto il materiale". Non rimettere "Dettagli consegna e documenti" né la nota sul prezzo definitivo (tolti su richiesta esplicita). Non rimettere: il riquadro verde con l'etichetta "Consegnato" e il nome del banco, il titolo
  "Prodotti", "Costo di consegna" (ora "Consegna in cantiere") né il link "Annulla ordine". Banco, agente e il ritiro **non**
  consegnato hanno ancora il markup vecchio. **Annullamento**: dal 18/10/2026 il cliente **non annulla mai un ordine** (`flusso.ordineAnnullabileDalCliente` è sempre `false`: nessun pulsante né sul sito né
  nell'API, e `/ordini/:id/elimina` rifiuta). Il rifiuto è `OrdineInLavorazione` (con `messaggioCliente` = "Il banco ha già confermato: l'ordine non si può più annullare. Per problemi contatta
  l'assistenza."), nessuna scrittura. Vedi "Pagamenti lato installatore".
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
  **iOS (21/10/2026)**: su iPhone/web app installata la barra restava a metà schermo (screenshot dell'utente, catalogo dopo l'uso della ricerca): è il viewport del layout (a cui si agganciano i `fixed`) che non coincide con quello visibile dopo la tastiera o la barra di Safari. Fix in fondo a `app.js`
  ("iPhone / web app installata"): solo su iOS misura `visualViewport.offsetTop + height − documentElement.clientHeight` e, se lo scarto è ≥ 2px (senza pinch), lo scrive in `--vv-sposta` (px), che `.navbar`, `.barra-vai` e `.barra-paga` applicano come `translateY`. Provato solo il meccanismo (variabile → spostamento esatto) nel browser incorporato; **non su un iPhone vero**.
  **"Catalogo" torna dov'eri (21/10/2026, richiesta esplicita)**: l'ultima pagina di catalogo vista (`/categoria/*`, `/marchi/*`, `/con-foto`, `/cerca`, con la query) sta in `sessionStorage` `minuteria.catalogo.<id utente>`; dalle altre pagine (carrello, Stato ordini, Storico, profilo) il tasto "Catalogo" della barra e "+ Aggiungi pezzi" del carrello (`data-torna-catalogo`) puntano lì. Aprendo `/home` la memoria si azzera, e sulle pagine di catalogo il tasto va alla home (così se ne esce). Provato nel browser (categoria → carrello → Catalogo → categoria; da lì Catalogo → home → carrello → Catalogo → home).

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
  `pagato`, `rimborsato`; importo = **`totali.da_pagare_app`** del carrello. **Regola dei prezzi (dal 17/10/2026; commento sopra `pricing.calcolaOrdine`, una sola
  funzione pura `pricing.dividiTotale` la applica per carrello, addebito, ordine e Storico)**: in app l'installatore paga ORA = corriere fisso (`spedizione_fissa`, 10 €)
  + servizio (`servizio_pct`, 10%, della merce **a prezzo del banco**, IVA esclusa, `round2(netto × pct/100)`: esattamente il 10%, non la somma di righe arrotondate)
  + IVA su (corriere + servizio); e paga DOPO a BOREA = merce a prezzo del banco (+ RAEE) + IVA su quella somma. `calcolaOrdine` ritorna `app` e `banco` (voci già arrotondate:
  corriere/servizio/imponibile/IVA/totale e merce/RAEE/imponibile/IVA/totale), `servizioPct`, `ivaPct`, `da_pagare_app` = `app.totale`, `materiale_banco` =
  `banco.totale`, `totale_ivato` = app.totale + banco.totale ("spesa complessiva"; `imponibile` e `iva` sono somme delle due parti). Esempio fisso nei test: merce 54,50 + 10,00
  → servizio 6,45; in app 10,00 + 6,45 + IVA 3,62 = **20,07**; materiale 64,50 + IVA 14,19 = **78,69**; spesa **98,76**. Lo usano `nuovaRichiesta` (importo), `avviaPagamento`
  (Stripe: PaymentIntent) e `segnaDaIncassare` (incasso = `LEAST(autorizzato, da_pagare_app dell'ordine)`); i rimborsi restituiscono quello che è stato pagato, "Rinvia" addebita di nuovo la consegna
  **ricalcolata con i prezzi di oggi** (dal 17/10/2026: vedi "Importi della richiesta").
  **Le righe mostrano il PREZZO DEL BANCO** (`pricing.prezzoNetto`, locals `prezzoBanco`/`totaleRigaBanco`): catalogo, categoria, ricerca live, varianti
  (`data-varianti`), carrello, `prodotto_json.js` e API dell'app (`prezzo`, `prezzo_valore`) dicono lo stesso prezzo, e la somma delle righe è la "Merce". Il 10% sta **solo**
  nella voce Servizio. **Non toccati**: `order_items.prezzo_unitario_cliente`/`subtotale_cliente` e `orders.totale_finale` si scrivono come prima (col 10%), quindi **la pagina
  dell'ordine vista dall'agente (e la vecchia `/ordini/:id` del banco) mostrano ancora il prezzo col 10%** (quella dell'**installatore** è già divisa: vedi "Importi dell'ordine"): da allineare. **Ordine minimo** (config `ordine_minimo`, 33) misurato su `totale_netto`
  (merce a prezzo del banco; `validaRichiesta` e `riepilogoCarrello`). **Banco**: la tabella del materiale nel dettaglio richiesta usa `prezzoNetto` (prima prezzo col servizio).
  **Carrello web**: card "Cosa paghi e a chi" (`views/carrello.ejs`, classi `cp-*`): riquadro azzurro "Consegna in cantiere" (PAGHI ORA: Corriere, Servizio, IVA, Totale da pagare ora) e
  riquadro "Materiale" (PAGHI DOPO A {ditta}, nome da `profiloCliente.distributore` senza forma giuridica, `fmt.nomeCommerciale`; Merce, RAEE solo se > 0, IVA, Totale materiale), sotto
  "Spesa complessiva"; barra "Paghi ora · consegna". Ogni importo è un `[data-riep="chiave"]` scritto da `flusso.vistaRiepilogo` (testo già pronto: la vista non fa conti) e
  **il ricalcolo dal vivo** (`aggiornaCarrelloDa` in `app.js`) lo riscrive dalla risposta di `POST /api/carrello/imposta` (`riepilogo`, `totali_righe`) **senza ricaricare**
  (± e quantità scritta; togliere una riga ricarica come prima), compreso l'avviso dell'ordine minimo (`[data-minimo-avviso]`, sempre nella pagina e `hidden` se raggiunto), la riga
  RAEE e il pulsante. Prove: `test/pricing.test.js` e i test "carrello: ..." di `test/server.test.js`. **Non seguono ancora**: l'app Expo (l'API dà `riepilogo`,
  `da_pagare_ora`, `da_pagare_al_banco`, ma l'app mostra ancora `totale_ivato`).
  **Importi dell'ordine, divisi uguale dappertutto (17/10/2026)**: alla nascita dell'ordine `flusso_cliente` salva in `orders` `servizio`, `imponibile_app`, `iva_app`,
  `da_pagare_app`, `imponibile_banco`, `iva_banco`, `materiale_banco` (DOUBLE PRECISION NOT NULL DEFAULT 0; blocco "Importi dell'ordine divisi" in fondo a `schema.sql`,
  **applicato al DB condiviso il 17/10/2026**; i 41 ordini di prima restano a 0). **Una sola funzione**, `pricing.importiOrdine(ordine, pagamento, ivaPct, servizioPct)` →
  `{ app: {corriere, servizio, imponibile, iva, totale, pagatoIl, rimborsato, metodo}, banco: {merce, raee, imponibile, iva, totale}, servizioPct, ivaPct }`, usata da pagina
  dell'ordine (`flusso.dettaglioOrdine` → `importi`), `src/materiale.js` (Storico, CSV, pagina del cliente lato banco) e pagine della richiesta: colonne salvate se ci sono
  (`da_pagare_app` o `materiale_banco` > 0), altrimenti **ricalcolo** per gli ordini vecchi (merce = `totale_netto`, servizio = `totale_finale − totale_netto`, corriere =
  `costo_consegna`, RAEE = `contributo_raee`, IVA con `pricing.ivaPctOrdine`: quella salvata nell'ordine, mai quella di oggi). Sugli ordini veri #124–#132 dà 20,07 / 78,69.
  `app.totale` = `requests.pagamento_importo` (l'incassato, con Stripe) **solo se non supera il calcolo di più di un centesimo**: gli ordini di prima pagati INTERI in app
  (98,76) mostrano il calcolo (20,07), non 98,76 (scelta mia: altrimenti "Consegna 98,76" accanto a "Materiale 78,69"). **Pagina dell'ordine dell'installatore**
  (`ordine_dettaglio.ejs`, in consegna, consegnato e il ritiro del vecchio flusso; la parte alta con anello, "Te lo porta…" e barra non è cambiata): scheda "Materiale in
  arrivo" / "Materiale consegnato" (`partials/ordine_righe.ejs`: righe `Cod. X · € cad.` a prezzo del banco + RAEE, "Merce · IVA esclusa") e scheda "Pagamenti" (`partials/pagamenti.ejs`, UNA per ordine e richieste, classi `pg-*`, parametri `{ importi, stato: 'attesa'|'ordine'|'consegnato'|'chiusa', ditta }`:
  riga verde "Consegna in cantiere · Pagata il gg/mm · Visa •••• 4242" con il link "Ricevuta", riga grigia "Materiale · Lo paghi a {ditta} con la sua fattura", `<details>` "Vedi il dettaglio degli importi"
  con i due riquadri; i quattro stati (bloccato/pagato/annullato/rimborsato) e il parametro `statoPag` sono descritti in "Pagamenti lato installatore"). **Mai un "Totale" unico** né Consegna/IVA/Totale sotto le righe. **Tolti su richiesta esplicita**: la sezione chiusa "Dettagli consegna e
  pagamento/documenti" (**destinazione e note della richiesta non si vedono più** nella pagina dell'ordine) e la nota "Prezzo definitivo, con eventuale sconto
  aggiuntivo…". Il pulsante "Ordine consegnato" ora è "Ho ricevuto il materiale" (stessa azione). **Banco e agente vedono ancora il markup vecchio** (`subtotale_cliente`,
  `totale_finale`, `totale_ivato`; commento sopra il loro ramo in `ordine_dettaglio.ejs`). Prove:
  `test/pricing.test.js` (`importiOrdine`, `ivaPctOrdine`), `test/materiale.test.js` ("Storico e pagina del banco…"), test "ordine in consegna/consegnato/VECCHIO/rimborsato…"
  e "richiesta in attesa/scaduta…" di `test/server.test.js`. **Sulla VPS**: `git pull`, lo schema (blocco sopra) PRIMA del riavvio di pm2: il nuovo `INSERT INTO orders`
  scrive le colonne e fallisce se non ci sono.
  **Importi della richiesta (17/10/2026)**: stessa divisione sulle pagine `GET /richieste/:id` (in attesa e chiusa). `flusso.nuovaRichiesta` passa i `totali` del carrello a
  `richieste.creaRichiesta`, che li salva su `requests`: `corriere`, `servizio`, `iva_app`, `da_pagare_app`, `merce_banco`, `raee_banco`, `iva_banco`, `materiale_banco` (DOUBLE
  PRECISION NOT NULL DEFAULT 0) più `rimborsato_il` (TIMESTAMP, scritta da `pagamenti.rimborsa`, azzerata da `incassaDiNuovo`); blocco "Importi della richiesta divisi" in fondo a
  `schema.sql`, **applicato al DB condiviso il 17/10/2026**. `pricing.importi({ ordine | richiesta })` è il punto unico (`importiOrdine` / `importiRichiesta`): per le richieste
  vecchie (colonne a 0) si ricalcola con `pricing.calcolaDaRigheDb` (calcolaOrdine sulle righe del DB, **stessa funzione del carrello**, consegna fissa di oggi);
  **`app.totale` = `pagamento_importo` quando c'è, senza controllo di coerenza** (diversamente dall'ordine: un rimborso mostra quanto è tornato davvero), `pagatoIl` = `pagato_il`,
  `rimborsatoIl` = `rimborsato_il` o, per una chiusa senza ordine (`nessuna_offerta`) rimborsata prima della colonna, `scade_il`; `conPagamento` dice se c'è un pagamento (le richieste del vecchio
  flusso non hanno la scheda "Pagamenti"). `dettaglioRichiesta` passa alla vista `importi`, `righePrezzi` (le righe di calcolaOrdine, forma di `order_items`: la stessa
  `partials/ordine_righe.ejs` dell'ordine), `ditta` (nome senza forma giuridica, vuoto con più ditte: "il banco") e `rinvio` ({ consegna, materiale } di oggi); `righe` resta quella
  del DB (la usa anche l'API dell'app). Attenzione: un `include` EJS vede i locals della pagina, quindi la scheda "Pagamenti" va chiamata con `rinvio: null` dove non c'è la nota.
  **"Rinvia richiesta" ora addebita la consegna ricalcolata con i prezzi di OGGI** (prima ripeteva `pagamento_importo`): `richieste.reinviaRichiesta` riscrive gli importi salvati e
  `pagamento_importo` (con Stripe quello già autorizzato, `importo` passato da `riapriRichiesta`; `avviaPagamentoReinvio` autorizza `flusso.totaliRichiestaOggi`), così la nota
  "Se rinvii la richiesta paghi di nuovo solo la consegna (€ X)" dice la verità. Le righe della scheda "Materiale richiesto" sono sempre a prezzi di oggi (`request_items` non salva
  prezzi): se i prezzi cambiano dopo l'invio, "Merce" (salvata) può non tornare con la somma delle righe. Prove: `test/richieste_importi.test.js` (INSERT, rinvio, rimborso,
  `importiRichiesta`) e i test "richiesta in attesa/scaduta/annullata…" di `test/server.test.js`.
  Quando la richiesta si chiude senza ordine (finestra scaduta, tutti rifiutano, annullo in fase 1) il blocco sulla carta si rilascia (`pagamenti.rimborsa`, solo DB; nel DB resta
  `pagamento_stato = 'rimborsato'`, ma per l'installatore è "nessun addebito"); "Rinvia" blocca di nuovo la carta. `pagamento_metodo` è `simulato` (app o sito senza
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
- L'annullo dell'ordine da parte dell'installatore **non esiste più** (18/10/2026, prima era lasciato per la fase di prova): `eliminaOrdine` lancia sempre `OrdineInLavorazione`.
- La risposta del banco (`/distributore/richieste/:id/rispondi`) oggi passa solo `rifiuta`,
  `prezzoRichiesto` e `utenteId`: `rispondi()` supporta ancora `righe`/`sconti`/`scontoCliente`
  (disponibilità parziale, sconto riga per riga) ma nessuna route li usa più — non è codice morto
  da un refuso, è la UI attuale che li ha rimossi.

## Pagamenti Stripe (14/10/2026)

`src/stripe_pagamenti.js` (PaymentIntent, pagina di pagamento, webhook, incassi) + punti di aggancio DB-only in
`src/pagamenti.js`; setup e messa in produzione in README ("Pagamenti con Stripe"). Scelte esplicite dell'utente: carta
**autorizzata e poi incassata** (non addebito + rimborso), **pagamento nella pagina del sito** con il Payment Element di
Stripe (prima era Checkout ospitato: cambiato lo stesso giorno, su richiesta), **sito e app Android** (l'app dal 19/10/2026 con il foglio di Stripe, vedi "App Android e sicurezza"),
**un solo conto Stripe** (niente Connect). Da non rompere:
- **Senza `STRIPE_SECRET_KEY` tutto è come prima** (`pagamenti.stripeAttivo()`): nessuna query su `stripe_pagamenti`,
  pagamento simulato. Le prove (`test/*.test.js`) non toccano mai Stripe né il DB vero (Stripe finto con
  `stripePagamenti.impostaStripe`, DB finto) e **non leggono il `.env`**: `test/server.test.js` svuota le variabili
  `STRIPE_*`/`APP_URL` prima di caricare `server.js` (dotenv non sovrascrive quelle già definite).
- **Reale e sandbox con un interruttore (20/10/2026, richiesta esplicita)**: `src/stripe_config.js` legge dal `.env` DUE serie (`STRIPE_LIVE_SECRET_KEY` / `_PUBLISHABLE_KEY` / `_WEBHOOK_SECRET` e le stesse con `STRIPE_TEST_`) e
  `STRIPE_MODO=live|test` (alias reale/produzione, prova/sandbox) sceglie quale vale; `pagamenti.stripeAttivo()` e `pagamenti.modoStripe()` passano da lì, e `stripe_pagamenti.js` legge chiavi e segreti dal modulo.
  **Senza `STRIPE_MODO` vale il vecchio `.env` a una serie** (il modo lo dice la chiave): nessun cambiamento per chi non lo scrive. Regole di sicurezza, tutte provate in `test/stripe_config.test.js`:
  (1) una chiave del modo sbagliato NON si usa mai (sk_test_ in `STRIPE_LIVE_SECRET_KEY`, o la vecchia `STRIPE_SECRET_KEY` reale con `STRIPE_MODO=test`: ignorata + avviso nel log); (2) **con `STRIPE_MODO` scritto Stripe resta
  "acceso" anche senza chiave** (`attivo()` = dichiarato || chiave): i pagamenti danno errore e NON ricadono sul simulato, che farebbe ordinare gratis; (3) il vecchio `STRIPE_WEBHOOK_SECRET` vale solo insieme alla vecchia
  chiave segreta (un `whsec_` non dice di che modo è: con le serie separate ogni modo vuole il suo); (4) `leggiEvento` prova il segreto del modo in uso e poi quello dell'altro (un endpoint per modo sullo stesso URL non
  accumula errori 400), `gestisciEvento` scarta gli eventi con `livemode` diverso. Il log all'avvio dice `[stripe] modalità REALE…` o `PROVA…` e avvisa se: manca la chiave del modo, il reale non ha `APP_URL` https, manca il webhook.
  In sandbox `/pagamento/<id>` mostra "Modalità prova" (`modoProva`). `node scripts/verifica_stripe.js [--modo=live|test]` è **sola lettura** (conto, carte/bonifici abilitati, webhook verso `APP_URL` con gli eventi giusti).
  **Cambiare modo con pagamenti aperti** li lascia fermi (ogni riga di `stripe_pagamenti` porta il suo `modo`, un'istanza lavora solo i suoi) finché non si torna: farlo senza richieste in attesa. **Sulla VPS non devono esserci
  `PAGAMENTO_SIMULATO` né `PAGAMENTO_SIMULATO_FORZA`** (la scorciatoia del 16/10 permette di ordinare senza pagare, anche con la chiave reale): è la prima cosa da controllare prima di incassare davvero. Le chiavi reali
  stanno solo sulla VPS: il `.env` del PC punta al DB di produzione e ha solo quelle di prova. `test/server.test.js` svuota anche le nuove variabili prima di caricare `server.js`.
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
  pagamento simulato del PC (`PAGAMENTO_SIMULATO=1`). Gli ordini fatti con la cifra di prova restano nel DB di produzione con `da_pagare_app` basso (e il banco vede il materiale intero). `test/server.test.js` la svuota; prove in `test/pricing.test.js`.
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
- **Metodi di pagamento in elenco, non a schede (20/10/2026, richiesta esplicita: "le carte in fondo sono buggate, voglio poterle selezionare scorrendo")**: `public/pagamento.js` monta il Payment Element con
  `layout: { type: 'accordion', defaultCollapsed: true, radios: true, spacedAccordionItems: true, visibleAccordionItemsCount: 10 }`: una riga per metodo (Carta, Satispay, Klarna, Amazon Pay nel conto di prova;
  quelli veri li decide il Dashboard), tutte chiuse, si tocca quella voluta e si apre sul posto; sono tutte visibili insieme e la pagina scorre normalmente. Prima era `tabs`: Stripe mostrava 3 metodi e metteva gli altri
  dietro un `<select>` "altro" (logo tagliato, scomodo sul telefono). Se si preme "Paga" senza averne scelto uno Stripe apre da solo "Carta" e mostra gli errori dei campi (provato, nessuno stato bloccato).
  **Provati nella sandbox, uno per uno** (320, 375 e 1100 px: niente tagli né scroll orizzontale): carta 4242 → `requires_capture` e ritorno; carta rifiutata 4000…0002 → "La tua carta è stata rifiutata." e pulsante di nuovo attivo;
  3-D Secure 4000…3184 → finestra di prova, "Complete" → `requires_capture`; **Satispay** e **Amazon Pay** → pagina di prova di Stripe, autorizzando il ritorno porta `redirect_status=pending` e il PaymentIntent diventa
  `requires_capture` un attimo dopo (il server lo gestisce: `completaRiga` vede `processing` → pagina "Pagamento in corso" che si ricarica ogni 2 s, e il webhook/timer fanno nascere la richiesta); **Klarna** reindirizza a
  `js.playground.klarna.com` (non accessibile dal pannello: l'autorizzazione e il ritorno NON sono provati). Per le prove: un PaymentIntent sandbox con gli stessi parametri di `creaIntento`, `views/pagamento.ejs`
  resa con `ejs.renderFile` e un piccolo server (niente DB); **il pannello del browser deve essere VISIBILE** (`mcp__ccd_view__show_pane` con `preview`) o i clic dentro l'iframe di Stripe non arrivano (da nascosto il
  form resta anche bianco per diversi secondi). I metodi non a carta non hanno marca né ultime 4 cifre: la riga si incassa lo stesso (test "incasso con un pagamento non a carta"). Il testo sotto il pulsante dice
  "non ti viene addebitato nulla" (non più "la carta"); il resto del sito dice ancora "carta" (scheda "Pagamenti", ricevute): per Satispay/Klarna/Amazon Pay è impreciso, non toccato.
- **Apple Pay (21/10/2026, richiesta esplicita)**: nel codice non serviva altro, il Payment Element lo mostra da solo (`automatic_payment_methods`, capture manuale supportata; il pulsante "Paga" della pagina apre il foglio di Apple Pay). Servono **tre cose fuori dal codice**: (1) Apple Pay attivo nel Dashboard
  (Impostazioni > Metodi di pagamento), nel modo giusto (reale o prova); (2) il **dominio registrato** su Stripe (Dashboard > Apple Pay > Aggiungi un nuovo dominio, o `applePayDomains.create`), una volta per dominio e per modo; (3) il **file di verifica** pubblicato a `https://<dominio>/.well-known/apple-developer-merchantid-domain-association`
  (rotta in `server.js` prima della sessione, perché `express.static` ignora le cartelle col punto; il file sta in `public/.well-known/` e lo scarica `node scripts/scarica_file_apple_pay.js`, è uguale per tutti i conti e non ha segreti). Senza il file la registrazione del dominio fallisce; senza dominio o senza HTTPS Apple Pay non compare e si paga con la carta,
  senza errori. Compare solo su Safari/iPhone/iPad/Mac con una carta nel Wallet, e non su `localhost` né su `http://192.168...`. `node scripts/verifica_stripe.js` ora avvisa se il dominio non è registrato o il file non è raggiungibile. **Non provato su un dispositivo Apple.**
- **Buco dell'app chiuso il 19/10/2026**: con Stripe acceso `POST /api/v1/richieste` e `/reinvia` creano il pagamento, non la richiesta (vedi "App Android e
  sicurezza"). Il sito in produzione richiede HTTPS (Stripe.js e webhook in modalità reale).
- Schema: blocco "Pagamenti con Stripe" in fondo a `schema.sql` (applicato al DB condiviso il 14/10/2026; `session_id`
  del primo giro con Checkout è stata tolta con un `DROP COLUMN` dentro lo stesso blocco).

## Pagamenti lato installatore: stati, ricevute, email, annullamento (18/10/2026)

Le regole stanno in cima a `src/pagamenti.js` (commento). Dove questa sezione contraddice frasi più vecchie qui sopra, vale questa.
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
- **`partials/pagamenti.ejs`**: parametro `statoPag` (`dettaglioRichiesta` e `dettaglioOrdine` lo passano; **non `pagamento`, che nell'ordine è già il pagamento grezzo**), `ordineId` per i link; senza
  `statoPag` si deduce da `stato`. Quattro stati: bloccato (azzurro #E3EDF7 col lucchetto, materiale tratteggiato), pagato (verde #E3F3E6, "Pagata il 15/10 · Visa •••• 4242", a destra importo e link
  "Ricevuta"), annullato (UNA riga grigia con la carta di credito), rimborsato (riga grigia con "Ricevuta" e "Ricevuta rimborso"). "Visa •••• 4242" è in `.pg-nowrap` (non si spezza). Il dettaglio
  degli importi c'è solo in bloccato e pagato.
- **Cattura e dati dell'incasso** (`stripe_pagamenti.js`, `dopoIncasso`): la `capture` è rimasta **identica** (stessi parametri e chiave `cap-<id>`: aggiungere `expand` con la stessa chiave darebbe un errore
  di idempotenza di Stripe sui retry); dopo la UPDATE a `incassato` (solo se ha cambiato una riga: una email sola) si fa, **ognuno nel suo try/catch**: lettura di `latest_charge` (ricevuta di Stripe, marca e
  ultime 4 cifre) e UPDATE di `receipt_url`, `carta_marca`, `carta_ultime4`, `incassato_il`; numero della ricevuta; email (**senza await**, con `.catch`: una promessa rifiutata farebbe cadere Node).
  Un guasto lì non può far fallire né ripetere l'incasso, nemmeno se lo schema nuovo non è ancora applicato. Il `receipt_email` del PaymentIntent c'era già (`creaIntento`): la ricevuta di Stripe via email la manda
  Stripe da sola, solo in modalità reale. **Non c'è un recupero per gli incassi di prima**: i vecchi `incassato` non hanno carta né `incassato_il` (la pagina dice "Pagata il …" senza carta, data = ultimo aggiornamento).
- **Ricevute** (`src/ricevute.js`, `src/azienda.js`): `assegna(ordineId, tipo)` dà il numero R-AAAA-NNNNNN (anno italiano, progressivo per anno e per tipo, indice unico anche su ordine+tipo: rigenerare il PDF non
  cambia il numero; INSERT…SELECT…ON CONFLICT DO NOTHING con riprova); `datiRicevuta(ordineId, { tipo, clienteId })` ritorna null se non c'è una ricevuta (non incassato, annullato, altro cliente);
  `modelloRicevuta(d)` è la funzione PURA con tutti i testi (si prova senza decodificare il PDF), `disegnaRicevuta` la disegna con pdfkit (Helvetica: non c'è Sora nel PDF, il resto è come il mockup).
  Dati dell'azienda **solo da .env** (`AZIENDA_*`, `RICEVUTA_NOTA_FISCALE`, vedi README); la nota fiscale non si stampa se manca. Rotte: `GET /ordini/:id/ricevuta.pdf`, `/ordini/:id/ricevuta-rimborso.pdf`,
  `GET /storico/ricevute.pdf?mese=` (un PDF, una pagina per ricevuta; 404 se non ce ne sono: il pulsante "Ricevute del mese" compare solo se ce n'è almeno una). "Ricevute del mese" prende gli ordini del mese
  **per data di creazione dell'ordine** (come la lista), non per data di incasso. La ricevuta di rimborso si numera quando la si apre la prima volta, con la data del rimborso.
- **Email** (`src/email.js`, nodemailer, SMTP dal .env): `inviaPagamentoRicevuto` non lancia MAI; senza `SMTP_HOST` non parte niente; timeout brevi (10/10/20 s). I pulsanti usano `APP_URL` (senza, non ci sono).
- **Annullamento solo in fase 1** (`flusso.annullaRichiesta`): transazione con `SELECT … FOR UPDATE` della richiesta (come `rispondi`), poi UPDATE con `stato = 'in_attesa' AND NOT EXISTS (… esito = 'confermato')`
  (anche se il corriere non ha risposto); poi `pagamenti.rimborsa` = rilascio (mai `da_rimborsare` perché in fase 1 non è incassata). `dettaglioRichiesta` porta `annullabile`, `/api/richieste/:id` anche, e il polling
  di `app.js` nasconde `[data-annulla-richiesta]` da solo. `eliminaRichiesta` segue la stessa regola (se c'è un ordine o un banco ha confermato lancia `OrdineInLavorazione` **prima** di scrivere;
  `richiestaId` sull'errore per il link di ritorno). L'ordine non si annulla mai (vedi "Pagina dell'ordine"). L'app Expo non legge ancora `annullabile` sulla richiesta (il server rifiuta comunque, `ok: false`).
- **Storico dell'installatore**: riquadro blu "Consegne pagate in app: € X" con **due pulsanti** (`.sm-bottoni`, 38px): "Ricevute del mese" e "Esporta elenco"; link "Ricevuta" (`.sm-ricevuta`) accanto a "Dettagli ›" solo
  sugli ordini con un incasso vero (`materialeOrdini` → `ricevuta`, UNA query in più `SELECT DISTINCT request_id FROM stripe_pagamenti …`, solo per l'installatore); riga "Consegna pagata in app · corriere + 10% + IVA".
  **Le richieste ANNULLATE** (scheda "Annullata", in fila con gli ordini) **non si aprono e non sono un link** (19/10/2026, richiesta esplicita: `materialeOrdini` dà `href: null` e la partial disegna un `<div class="sm-ordine sm-ordine-chiusa">`
  senza freccia né `<details>`); quelle chiuse per "Nessuna risposta" sono un `<details>` come l'ordine, e aperte portano a "Dettagli ›" (da lì si rinvia). La rotta `/richieste/:id` di una annullata resta raggiungibile con l'indirizzo; l'app mobile ha il suo storico e non è stata toccata.
- **Schema**: blocco "Ricevute di pagamento e dati della carta (18/10/2026)" in fondo a `schema.sql` (4 colonne su `stripe_pagamenti`, tabella `ricevute`, due indici unici). **Applicato al DB condiviso il 19/10/2026** (prova a secco e poi `--applica`; verificate colonne, tabella e la query di numerazione su Postgres vero, in una transazione annullata): la VPS usa lo stesso
  Supabase, quindi lo schema c'è già; sulla VPS servono `git pull`, `npm ci` (`pdfkit`, `nodemailer`) e le righe del `.env` (`AZIENDA_*`, `SMTP_*`). Nel `.env` **locale** c'è solo `AZIENDA_EMAIL=qako746@gmail.com`
  (provvisoria, richiesta esplicita del 19/10/2026): senza `SMTP_HOST` le email "Pagamento ricevuto" non partono.
- **Prove**: `test/pagamenti_stato.test.js`, `test/ricevute.test.js`, `test/email.test.js`, `test/annullamento.test.js`, i test "incasso: …" di `test/stripe_pagamenti.test.js` e, in `test/server.test.js`, "richiesta in attesa/scaduta/annullata",
  "ordine pagato con Stripe", "ordine con il pagamento rimborsato", "il cliente non annulla MAI un ordine" e "storico con pagamenti incassati". Per **vedere** un PDF senza poppler: `pypdfium2` in una cartella fuori dal progetto
  (`pip install --target <cartella> pypdfium2`); il pannello browser incorporato scarica i PDF invece di mostrarli.

## Posizione: Borea fissa, installatore = indirizzo di consegna del pagamento (21/10/2026) e sede provvisoria in Via Puggia 22/3

**Banco (Borea): la posizione è FISSA, quella scritta nel DB** (`distributors.geo_*` e `store_locations.geo_*`; richiesta esplicita del 21/10/2026). Nessun codice la ricalcola o la sposta: `anagrafica_banco.salvaFiliale` salva l'indirizzo di ritiro (anche in `store_locations`)
ma **non tocca le coordinate e non chiama la geocodifica**; la rotta `POST /distributore/anagrafica/posizione`, `spostaPosizione`, il `<dialog>` con la mappa e il blocco "Posizione del banco" di `public/mappa.js` sono stati **tolti** (restano `mappa.js` per `/punti-vendita`,
`distributors.geo_manuale` come colonna inutilizzata e il CSS `ab-mappa*`). La pagina Anagrafica mostra solo la riga verde/arancio "Posizione sulla mappa impostata / non impostata" e la nota "Cambiare l'indirizzo non sposta il punto sulla mappa". Per correggerla serve lo script
(Fegino = civico 1/7 rosso di Via Castel Morrone; Staglieno approssimata sul civico 9: vedi "Ditte, filiali, dipendenti"). La posizione del dispositivo del banco non si raccoglie.

**Installatore: la posizione NON si chiede all'ingresso, ma al momento di pagare**, nel campo "Consegna in cantiere" del carrello (richiesta esplicita del 21/10/2026, che sostituisce sia la versione del 20/10 "si chiede appena si apre il carrello" sia
quella, effimera, "si usa quella dell'account"; non rimetterle). Il campo `destinazione` **parte vuoto** ed è `required`; ci sono **due modi** per riempirlo: scriverlo, oppure toccare il **mirino accanto al campo** (`.consegna-pos-btn`, `iconaMirino`, 48px, `aria-label` "Usa la mia posizione"), che
legge la posizione del dispositivo. Blocco "Carrello: indirizzo di consegna" di `public/app.js` + `views/carrello.ejs`:
- **Il pulsante funziona da sito e da web app installata, su iPhone, Android e computer** (solo in HTTPS o su localhost: regola dei browser; senza, il messaggio lo dice e resta da scrivere). La posizione si legge **solo al clic** (mai da sola: nessun `cercaPosizione()` all'apertura).
  `navigator.geolocation.getCurrentPosition` prima con `enableHighAccuracy: true` (10 s), se fallisce per timeout o posizione non disponibile un secondo tentativo approssimato (`false`, 15 s, `maximumAge` 5 min); a permesso negato (codice 1) non si riprova. Poi `GET /api/indirizzo?lat&lng`
  (`geo.indirizzoDaPosizione`: Nominatim inversa, "Via Puggia 22, 16131 Genova (GE)", solo Italia e solo con una via; non lancia mai) riempie il campo, le coordinate vanno nei campi nascosti `dest_lat`/`dest_lng` e la scheda si chiude con "Cambia". Se la precisione è peggiore di 1 km (tipico di un
  computer senza GPS) il campo resta aperto con "Posizione poco precisa (circa N km): controlla l'indirizzo." Messaggi in `.consegna-pos` (fuori dal campo: restano visibili a scheda chiusa): in lavorazione, **permesso negato con la guida per il dispositivo** (iPhone/iPad: Impostazioni › Privacy e sicurezza ›
  Localizzazione › Safari; Android: lucchetto accanto all'indirizzo / impostazioni dell'app; altro: impostazioni del browser), posizione non disponibile, timeout, indirizzo non trovato. Il pulsante si disabilita e il mirino gira mentre cerca. Dopo il clic il campo si apre senza dare il fuoco (sul telefono la tastiera coprirebbe il messaggio).
- **Causa per cui il pulsante non poteva funzionare (trovata il 21/10/2026): `server.js` mandava `Permissions-Policy: geolocation=()`, che blocca la geolocalizzazione per tutte le pagine del sito** su qualunque dispositivo (la versione del 20/10 non aveva mai potuto funzionare fuori dalle prove). Ora è `geolocation=(self)`:
  solo questo sito, camera e microfono restano vietati. Se la posizione "non va" ricontrollare prima questo (`document.featurePolicy.allowsFeature('geolocation')` nella console del browser deve dare `true`) e HTTPS (`window.isSecureContext`).
- **Appena l'indirizzo si modifica le coordinate si tolgono** (`input` ≠ indirizzo ricavato dalla posizione): non descrivono più quell'indirizzo, e il server ricava la posizione dal testo scritto.
- **Non si invia senza un indirizzo**: `required` sul campo, un gestore `submit` sul form (ferma la propagazione, apre il campo e lo dice) e il server (`POST /richieste`: `ErroreFlusso('destinazione')` → 400 "Manca l'indirizzo di consegna", nessuna richiesta, nessuna chiamata alla mappa).
  **Solo il sito**: l'API dell'app (`api_v1.js`) e il vecchio flusso non lo richiedono e ripiegano su `indirizzo_consegna`.
- **Cosa salva il server** (`POST /richieste`, prima di pagare e di creare la richiesta): `geo.posizioneDellaDestinazione` → le coordinate del dispositivo se la pagina le ha mandate e valgono (riquadro dell'Italia), altrimenti la geocodifica dell'indirizzo scritto (`geo.geocodifica`, fino a ~6 s, non lancia mai); poi
  `geo.salvaPosizioneCliente` le scrive in `users.geo_lat/geo_lng/geo_consenso = 1`. Se la mappa non trova l'indirizzo la richiesta parte lo stesso e `users.geo_*` resta com'era. **Nessuna colonna nuova**: la posizione sta sull'utente, quindi è l'ULTIMA mandata; con due richieste
  insieme a indirizzi diversi, il tragitto di quella spedita per prima si calcola dall'ultima posizione (se serve, colonne `requests.dest_lat/dest_lng` e lo stesso nella tabella `stripe_pagamenti`).
- **Il tragitto** si calcola alla conferma del banco (`consegna.minutiStimati`, vedi "Orari del corriere") da `users.geo_*`; **un account senza posizione (o senza consenso) usa la sede provvisoria** invece di non calcolare niente: prima il tragitto valeva 0 e l'installatore vedeva
  solo il tempo del corriere (era il caso del cliente di prova id 2 in produzione: `geo_consenso = 0`, nessuna coordinata; le 6 ultime consegne avevano `consegna_minuti_stimati` = `corriere_minuti`).
- Il messaggio ai corrieri (`whatsapp.datiConsegna`) scrive la `destinazione` della richiesta e le coordinate di `users.geo_*` salvate con lo stesso invio: indirizzo e posizione coincidono.
- Testo della privacy (`src/testi_legali.js`): riga sul sito che usa la posizione per il tragitto. **Non fatto**: l'app Android non manda la posizione (e non richiede l'indirizzo). Nominatim ha una regola d'uso (1 richiesta al secondo, User-Agent): per molti utenti serve un servizio proprio.
- **Provato il 21/10/2026** su Postgres locale usa-e-getta (poi cancellato) con il vero `server.js` e nel browser incorporato a 375px (Nominatim vero): intestazione `geolocation=(self)` e `allowsFeature('geolocation') = true`; campo vuoto con il mirino accanto; clic vero → permesso negato dal pannello → messaggio con la guida;
  geolocalizzazione simulata (primo tentativo timeout, secondo ok) → "Via Puggia 22, 16131 Genova (GE)", coordinate nel form, scheda chiusa → "Paga e invia" (simulato, `PAGAMENTO_APP_PROVA`) → richiesta con `destinazione` giusta e `users.geo_*` salvati. **Non provato**: il permesso vero su un iPhone o un telefono Android
  (nel pannello è negato e la geolocalizzazione è simulata a mano), la web app installata, Safari; in HTTP su un indirizzo di rete (192.168.x.x) il browser non dà la posizione per regola, il messaggio lo dice.
- Prove: `test/orari_corriere.test.js` (sede provvisoria), `test/server.test.js` ("posizione di consegna: …", due test, e "sicurezza: … Permissions-Policy" che controlla `geolocation=(self)`; Nominatim finto `nominatim`, che intercetta `fetch` verso `nominatim.openstreetmap.org`: ogni prova che paga dal carrello chiama la geocodifica, che resta finta).

**Sede provvisoria**: tutti gli installatori hanno Via Puggia 22/3, Genova (`src/sede_installatori.js`, vedi README, "Posizione"): `indirizzo_consegna` + `geo_*` con `geo_consenso = 1`, impostati da
`scripts/imposta_installatori_puggia.js` e da `anagrafiche.iscriviCliente`; vale finché con un pagamento non arriva la posizione di un indirizzo. La sede legale resta quella dichiarata. Quando torneranno gli indirizzi veri togliere i punti d'uso.

## Home del banco: bacheca a 3 colonne (09/10/2026)

`GET /distributore` (`server.js`) + `views/distributore_richieste.ejs`, classi `banco-*`, `colonna*`, `scheda*`
(blocco "Home del banco" di `style.css`; la logica di risposta, corriere e ordini non è cambiata). Da confermare →
Attesa corriere → Da preparare, senza numeri d'ordine delle fasi. Convenzioni da non rompere:
- **Niente interruttore "ricezione"**, niente riquadri contatore, niente riga "filiale · zona": richieste esplicite.
  Il banco riceve sempre (`richieste.distributoriCandidati` non guarda più `ricezione_attiva`); la rotta
  `POST /api/distributore/stato` non esiste più.
- **Intestazione e tendina dell'utente sono UNA sola per tutto il banco** (richiesta esplicita del 14/10/2026,
  non farne un'altra): `partials/banco_testa.ejs` = ditta e filiale (`res.locals.bancoTesta`, in cache 60 s dal
  middleware di `server.js`), schede **Banco / Clienti / Storico ordini** (dal 19/10/2026 "Storico ordini" è una scheda del menu come le altre, la terza dopo Clienti, con l'icona `iconaOrdini`:
  prima era un pulsante accanto al cerchio dell'utente, `.banco-storico`, **non rimetterlo**) e cerchio con le iniziali della
  **filiale** ("Banco Genova Fegino" → BG) che apre la tendina `.menu-account` (**Anagrafica del banco** in cima dal 20/10/2026, poi Esci; Clienti compare lì solo sotto i 900px, dove le schede della barra spariscono; **non c'è più "Storico ordini"
  nella tendina**: sotto i 900px sta nel menu in basso, che ha tre voci, Home / Clienti / Storico: `nav_distributore` con `attivo: 'storico'` nello Storico e nella pagina dell'ordine). **Niente campanella delle notifiche** (tolta su richiesta esplicita
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
  non un contatore che decrementa). Rosso negli ultimi 180 s, "Nuova" per i primi 180 s, pillola dell'ordine rossa sotto
  15 min. A zero la scheda si spegne e la pagina si ricarica. La pillola dell'ordine conta fino al **ritiro del corriere**
  (`corriere_risposto_il` + `corriere_minuti`, in SQL `corriere.ritiroSql('o')`): è il tempo che il corriere ha scritto su WhatsApp, l'unico orario del
  corriere che il banco vede (vedi "Orari del corriere"). Senza corriere non c'è pillola.
- Il ritardo/`secondi_da_risposta`/`secondi_arrivo` si calcolano **in SQL** (`NOW()`), mai con un `Date` di JS sulle colonne
  `TIMESTAMP` (vedi sopra); `corriere_risposto_il` e `corriere_arrivo_il` sono `TIMESTAMPTZ`. Tre articoli al massimo per scheda, poi "+N altri
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
  (`ordinaVociIcona`): scadute (nei loro 10 minuti), richieste dal timer più corto, consegne dall'arrivo **più vicino** (senza minuti in fondo). **Cambio di
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
- **"Nessuna risposta" (fase `scaduta`): OGNI richiesta senza risposta resta 10 minuti dalla sua scadenza, per conto suo** (richiesta esplicita del 20/10/2026,
  sostituisce la regola del 15/10 "solo se è l'ULTIMA cosa successa, entro 3 h", che con due richieste insieme faceva sparire subito la prima a scadere: non rimetterla).
  `flusso.scaduteRecenti(cards)` = tutte le `nessuna_offerta` con `secondiAllaScomparsa > 0` (`SCADUTA_VISIBILE_MS` = 10 min da `scade_il`, arrotondato per eccesso), a prescindere
  da cos'altro è successo dopo (altre richieste, un ordine anche consegnato); l'annullata non è mai una voce. Ogni voce `scaduta` porta `scompareTraSec`; fra scadute prima quella che
  sparisce prima. Quando i 10 minuti finiscono si passa a: un'altra scaduta ancora nei suoi 10 minuti, poi le richieste/ordini nelle varie fasi, poi la pagina "Stato ordini" vuota
  (è l'ordine delle voci, quello che segue `/ordini`). **Come sparisce**: l'icona (`nav_ordini.ejs`) legge `[data-scompare-sec]` e, appena la prima è sparita (+0,8 s), rilegge lo
  stato (`avvia()` → `primaScomparsa()`); una pagina con la striscia si ricarica per la firma cambiata. Se la pagina aperta è proprio la richiesta che sparisce (`richiesta_chiusa.ejs`,
  `lasciaFra` da `server.js`, = 0 se è aperta dallo Storico o oltre i 10 minuti) un timer in pagina fa `location.replace('/ordini')` a +1 s e imposta `window.minuteriaLasciaIl`:
  l'icona, negli ultimi 6 s, **non ricarica** la pagina (`staPerLasciare`), altrimenti la ricarica vincerebbe la corsa e il cliente resterebbe su una richiesta ormai fuori dall'elenco.
  **Limite noto**: se TUTTI i banchi rifiutano prima della fine della finestra la richiesta si chiude subito (`chiudiSenzaOrdine`) ma `scade_il` resta nel futuro, quindi i 10 minuti
  contano dalla fine della finestra e non dal rifiuto (mancano un orario di chiusura nel DB). L'API dell'app (`/stato-ordini`) non scrive `scompare_tra_sec`: l'app non ha il passaggio automatico.
  Prove: `test/stato_ordini.test.js` ("DUE richieste…", "secondiAllaScomparsa…", "ogni «Nessuna risposta» porta i secondi…") e "richiesta senza risposta: resta in «Stato ordini» 10 minuti…" in `test/server.test.js`.
- Si guardano le ultime **30** richieste (`RICHIESTE_RECENTI`), non più 5.
- **L'icona alterna le attività quando sono 2 o più** (richiesta del 15/10/2026): `statoIconaOrdini` ritorna, oltre ai campi di sempre
  (la prima inviata), `voci` = TUTTE le attività nell'ordine di alternanza
  (`ordinaVociIcona`, funzione pura: prima le `scaduta` (da quella che sparisce prima), poi le `richiesta` dal timer più corto, poi le `consegna` da chi arriva prima, senza
  minuti in fondo; a parità la più vecchia). Le **scadute** entrano fra le voci anche con altre attività, ciascuna per 10 minuti (vedi sopra).
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
  - **Cronometro "In arrivo"** (16/10/2026): negli ultimi 3 minuti l'anello della pagina dell'ordine non si svuota più ma riparte da vuoto e si riempie fino
    all'arrivo (`circ × secondi/180`; a 180 s l'anello del viaggio è già quasi vuoto, quindi non c'è salto); lo fanno sia la vista (primo disegno) sia `app.js`.
    La barra della card in home, a tempo finito, **si ferma al 94%** (`PROGRESSO_ARRIVO`, in `app.js` il 44 di `50 + (1 - r) * 44`): "Consegnato" solo con la consegna vera.
  - **Badge dell'icona** (`{c}`): "45′" sotto l'ora, "5h57" oltre (`format.durataBreve`, uguale in `app.js`); sparisce in "In arrivo".
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
  tua conferma quando un corriere prende la consegna."), la nota della copertura parziale. La seconda scheda a
  sinistra si chiama **"Avanzamento"** e ogni passo ha una `fase` (`passiDopoConferma`): **fatto** (pallino verde con la spunta, "Fatto alle HH:MM"), **corrente**
  (pallino viola che pulsa con l'anello, "Corriere avvisato · da N min") e **futuro** (cerchio tratteggiato, testo grigio). In "Da confermare" la scheda resta
  "Cosa succede dopo la conferma", com'era. I secondi dalla conferma li calcola la route **in SQL** (`secondi_da_risposta`, come la home); il JS li trasforma in
  un istante (`data-trascorsi`) e ogni secondo aggiorna il cerchio e ogni `[data-da]`, con le stesse funzioni della home (`Minuteria.daMinuti` /
  `tempoTrascorso` in `app.js`; sul server `fmt.daMinuti` / `fmt.tempoTrascorso`: le due versioni devono restare uguali). Quando un corriere accetta,
  `data-auto-refresh` ricarica la pagina e la route, trovando l'ordine "Da preparare", la rimanda alla pagina dell'ordine (vedi sotto).
- **"Da preparare" non ha una pagina della richiesta** (richiesta esplicita del 19/10/2026: dopo che un corriere accetta, "Ispeziona" da "Attesa corriere" finiva in una pagina con timer del corriere e "Preparato", che non ci deve essere):
  `statoRichiestaBanco` dà ancora `da_preparare` (conferma + ordine del banco `inviato`, non consegnato) ma la route, appena lo vede, fa `redirect` a `/distributore/ordini/<id>` e passa `torna` così com'è (`conRitorno(ordine, daDove)`):
  la freccia dell'ordine riporta **da dove si era partiti** (la home se la richiesta si era aperta senza `torna`), **non** alla richiesta, che non è un passaggio. Il redirect vale anche quando la pagina in attesa del
  corriere si ricarica da sola. Sono spariti dalla vista e dalla route: il ramo "Da preparare" (timer `.ric-arrivo`, "Preparato", "Apri l'ordine"), `linkOrdine` ("Ordine collegato", "Gestisci l'ordine"), `arrivo`
  e il `secondi_arrivo` della lettura dell'ordine; `passiDopoConferma` non conosce più `corriere`/`daPreparare`. Il CSS `.ric-arrivo-*` resta perché lo usa il riquadro "Ritiro" della pagina dell'ordine. Dopo "Preparato" l'ordine è
  `in_evasione` e la richiesta torna "Confermata". Prova: "banco: la richiesta con l'ordine "Da preparare" non ha una pagina…" e "banco: la freccia di ordine e richiesta riporta…" in `test/server.test.js`.
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

## Pagina dell'ordine del banco (19/10/2026, senza bolla dal 20/10/2026)

`GET /distributore/ordini/:id` (`server.js`, presentazione in `src/ordine_banco.js`) + `views/distributore_ordine.ejs`: la pagina di un ordine del banco, **che si adatta allo stato** (`storicoBanco.statoStorico`, lo stesso dello Storico):
**da preparare**, **in consegna** e **consegnato** ("Apri ordine completo" dello Storico funziona per tutti). **Stessa impostazione a due colonne della richiesta** (classi `ric-*` riusate, `ord-*` solo qui; blocco "Pagina dell'ordine del banco" in fondo a `style.css`;
`body.pagina-richiesta .pagina-ordine`). Come il dettaglio della richiesta include `partials/banco_testa` **senza** `indietro` (la freccia è la sua, `ric-indietro`, e va a `paginaPrecedente`, vedi sopra). **Aprirla non scrive
niente, in nessuno stato**: l'ordine passa "In consegna" solo con "Preparato" (`POST /distributore/ordini/:id/preparazione`, `prendiInCarico`, che agisce comunque solo su `inviato`: un ordine già partito o consegnato non si tocca); resta `POST /elimina`.
Richieste esplicite, non rimetterli: le tre righe in alto ("Ricevuto…", "Partenza/Consegna dichiarata", "Consegna con mezzo del distributore"), "Cliente ordinante" a 4 righe, "Dove consegnare: posizione non disponibile", l'"Imponibile" col servizio e la consegna.
- **La bolla (DDT) non esiste più** (richiesta esplicita del 20/10/2026: la piattaforma non la gestisce): via la rotta `POST .../ddt`, la pagina `/ddt/:id` (`views/ddt.ejs`, `src/ddt.js`), il modulo con colli/aspetto/causale/trasporto, la scheda della bolla emessa, la
  colonna DDT dello Storico (e la ricerca per numero di DDT), la scheda "Bolla / DDT" del pannello dello Storico, "Apri la bolla" nella scheda cliente, il DDT nel CSV del banco, la riga "Documenti · DDT" dell'installatore, `ddt` nell'API dell'app e le sue stringhe nell'app
  mobile. **Non toccato nel DB condiviso**: le colonne `orders.ddt_*` e la tabella `ddt_counters` restano (ci sono le bolle già emesse e la loro numerazione: non si cancellano da qui) ma nessuno le legge né le scrive, e `schema.sql` non le crea più.
  Gli ordini `evaso` (partiti con la bolla) restano "In consegna" per il banco. `format.indirizzoCompleto` è il vecchio `ddt.indirizzoCompleto`.
- **Le tre versioni** (`stato.chiave`; materiale, consegna e cliente sono uguali in tutte): **Da preparare** = pillola blu che pulsa, "Materiale da preparare", riquadro Ritiro, scheda **"Materiale pronto? · Preparato"** (`.ord-prepara`: un form con `torna` = la pagina da cui si è arrivati; dopo il
  clic si resta sull'ordine, che diventa "In consegna", e la freccia riporta ancora lì), "Elimina ordine".
  **In consegna** (dopo "Preparato"): pillola azzurra `#E3EDF7`/`#1A4468` (`.ric-st-in_consegna`, senza pulsare), "Materiale **partito**" con "N articoli · M pezzi" e **"Stampa"** (`[data-stampa]` → `window.print()`; `@media print` mostra solo testata e
  materiale; è la lista del materiale, non una bolla), a destra la scheda azzurra `.ord-stato-consegna` (furgone, "In consegna", `ordineBanco.testoInConsegna`: "Partito alle HH:MM · ritiro alle HH:MM" da `in_evasione_il` (o `evaso_il` negli ordini vecchi) e dal ritiro del corriere, "Corriere X");
  niente "Elimina ordine". **Il banco non vede mai l'arrivo dal cliente** (`corriere_arrivo_il`): solo il ritiro.
  **Consegnato**: pillola grigia `#ECE9E2`/`#3F3E38`, testata "Ricevuto il gg/mm alle HH:MM" (`ordineBanco.ricevutoIl`, non più "oggi"), "Materiale consegnato", nota "Da incassare dal cliente con la tua fattura. Prezzi del banco.", scheda verde `.ord-stato-consegnato` (cerchio con la spunta,
  "Consegnato", "Il gg/mm alle HH:MM · confermato dal cliente", e due mini riquadri "Partito gg/mm · HH:MM" e "Tempo di consegna" = `consegnato_il − (evaso_il || in_evasione_il)`, "34 min" / "1 h 05"); Avanzamento tutto verde con le ore; niente "Elimina ordine".
  Un "Partito" senza un momento noto (consegna provvisoria su un ordine mai partito) non si scrive e "Tempo di consegna" non c'è.
  **Da sapere**: la pillola "In consegna" della pagina è azzurra (come da richiesta) mentre nella lista dello Storico "In consegna" è verde, e "Da preparare" è blu quasi uguale all'azzurro: sulla pagina i due stati si distinguono poco dal colore (la pagina vuole l'azzurro, lo Storico il verde).
- **Materiale a PREZZO DEL BANCO**: cad. = `prezzo_netto_unitario + raee_unitario`, totale riga = `subtotale + raee_riga`, mai `prezzo_unitario_cliente`; piede = `pricing.importi({ ordine }).banco` (Merce, RAEE solo se > 0,
  IVA con `ivaPctOrdine`, Totale: 64,50 + 14,19 = 78,69 nell'esempio). `ordine_banco.righeMateriale` abbina i `mancanti` (solo con `copertura = 'parziale'`, altrimenti `calcolaOfferta` non si chiama: pesa) per
  codice: "richiesti N, ne hai confermati M" sotto il codice; un articolo confermato a zero non è una riga dell'ordine e finisce nella riga "Non confermati…" sotto la tabella.
- **Niente spunte "preso" né "Lista di prelievo"** (richiesta esplicita del 19/10/2026, non rimetterli). La riga è un `<div class="ord-riga">`, tabella a 4 colonne: Q.tà, articolo, prezzo cad., totale; la rotta `POST /distributore/ordini/:id/righe/:rigaId/preso` è 404.
  **La colonna `order_items.preso_il` resta nel DB e in `schema.sql`** (blocco "Materiale preso…", applicato al DB condiviso il 19/10/2026) ma nessuno la legge né la scrive: si può togliere con un `DROP COLUMN`.
  Sempre su richiesta: **niente link "Apri in Maps"** (`linkMaps` e `mappa` tolti) e **niente riga "Consegna con mezzo del banco"** nella scheda Consegna: `descrizioneConsegna` ritorna `''` col mezzo del banco e la vista non disegna la riga (restano "Corriere X · ritiro al banco" e "Ritiro al banco da parte del cliente").
  `app.js` di questa pagina fa solo "Stampa".
- **Riquadro "Ritiro"**: solo con i minuti del corriere (`corriere.ritiro(ordine)` = `corriere_risposto_il` + `corriere_minuti`, **il tempo scritto su WhatsApp**: dal 20/10/2026 è davvero l'orario del ritiro, prima era l'arrivo dal cliente spacciato per ritiro); cerchio verde / rosso sotto
  `BACHECA.arrivoVicinoMin` (15), "In ritardo" a zero, lo muove il blocco di `app.js` di `[data-ric-arrivo]` (lo stesso del dettaglio della richiesta, ogni secondo). Il testo dice "Il corriere ritira alle HH:MM" e "Ritiro alle HH:MM" come la pillola della home ("ritira Marco · ore HH:MM").
- **Avanzamento** (`passiOrdine({ stato, oraConferma, corriere, oraRitiro, partito, consegnato })`): Confermato da te (ora di `risposto_il`, se no `creato_il`) → Corriere trovato ("{nome} ha accettato alle HH:MM" da `corriere_risposto_il`; **non c'è senza corriere**) → **da preparare**: Da preparare (attuale, blu, pallino che pulsa, "Ritiro alle HH:MM") → In consegna → Consegnato (ultimi due da venire);
  **in consegna**: Partito fatto ("Alle HH:MM") → Consegnato da venire ("Lo conferma il cliente"); **consegnato**: tutto fatto ("Confermato dal cliente alle HH:MM"). **Non c'è un passo "Preparato"** distinto da "Partito": il momento del "Preparato" (`in_evasione_il`) è quello della partenza.
  Un momento di un altro giorno rispetto alla nascita dell'ordine si scrive "il gg/mm alle HH:MM" (`ordineBanco.momento`/`quando`).
  **Colori** come nello Storico (salvo la pillola della pagina, vedi sopra): Da preparare blu, In consegna verde, Consegnato grigio (anche la pillola "Da preparare" del dettaglio richiesta è blu; la colonna "Da preparare" della home è rimasta verde: non toccata).
- **Mobile (< 900px)**: una colonna, ordine: testata, Ritiro (o la scheda dello stato in consegna/consegnato), Materiale, Preparato, Consegna, Cliente, Avanzamento, Elimina (`display: contents` sulle colonne e sulla coppia Consegna/Cliente + `order`); la tabella diventa una
  lista (badge, nome e codice con il cad., totale).
- **Prove**: `test/ordine_banco.test.js` (parti pure: momenti, tempo di consegna, passi per stato) e, in `test/server.test.js`, "banco: pagina dell'ordine a due colonne…", "…disponibilità parziale e RAEE…", "banco: pagina dell'ordine "In consegna" e "Consegnato"…" e "banco: "Preparato" dalla pagina dell'ordine…" (DB finto: ordine 1295; istanti fissi `alle(h, m)` così non dipendono dall'ora; `ritiroTra(minuti)` fa arrivare il corriere fra N minuti; controlla anche che nessuna query scriva, `scrittureDa`). Per vedere la pagina senza DB: view e partial veri con `ejs.renderFile`, `style.css` vera e un piccolo server statico (dati finti, anche con e senza corriere). Sul browser vero: Postgres
  locale usa-e-getta (vedi "App Android e sicurezza"), il vero `server.js` lanciato da uno script in una cartella **senza `.env`** che imposta a mano `DATABASE_URL` locale, `STRIPE_*`, `WHATSAPP_ATTIVO=0`, `PUSH_ATTIVO=0`… (e `preview_start` con una voce di `.claude/launch.json` che lancia quello script), un banco (`borea`/`banco123` dal seed), un cliente e un ordine creato con `flusso.nuovaRichiesta` + `richieste.rispondi` + `richieste.corriereHaPreso` (con `WHATSAPP_ATTIVO=1` in quello script, mai collegato). Sul Postgres locale le colonne `TIMESTAMP` sono ora di Roma e non UTC: orari e giorni di quelle colonne risultano sfalsati di 2 ore (non lo sono sul DB di produzione in UTC), le `TIMESTAMPTZ` no. Dopo ogni `navigate` il pannello perde il ridimensionamento: `tabs_select` e `resize_window` prima dello screenshot.

## Orari del corriere e tragitto sulla mappa (20/10/2026)

Richiesta esplicita: il banco vede **esattamente il tempo scritto dal corriere su WhatsApp**; l'installatore vede **quel tempo + il tragitto sulla mappa dal banco che ha accettato alla sua posizione**. Il messaggio nel gruppo (`whatsapp.testoRitiroConsegna`) dice che i minuti
sono "il tempo che ci metti ad arrivare dal venditore (tappa 1, prelievo merci)"; la risposta del bot è "✅ Preso! Richiesta #N: arrivi dal venditore in X, ritiro entro le HH:MM". **Dove questa sezione contraddice frasi più vecchie qui sotto (minuti "totali", "dal ritiro alla consegna", `corriere_arrivo_il` come ritiro), vale questa.**
- **Cosa vuol dire ogni colonna** (nessuna colonna nuova, nessuna modifica di schema): `request_responses.corriere_minuti` / `orders.corriere_minuti` = i minuti scritti dal corriere (verso il banco); `orders.corriere_risposto_il` = quando ha risposto (`corriere_preso_il` sulla risposta); **ritiro = `corriere_risposto_il` + `corriere_minuti`**
  (`src/corriere.js`: `ritiro(ordine)` in JS, `ritiroSql('o')` nelle query; non c'è una colonna apposta); `request_responses.consegna_minuti_stimati` = prima del "preso" il solo tragitto banco → installatore, dopo il "preso" corriere + tragitto (`richieste.corriereHaPreso` ci somma i minuti in SQL, `COALESCE(consegna_minuti_stimati, 0) + ?`);
  **`orders.corriere_arrivo_il` = `corriere_preso_il` + `consegna_minuti_stimati`** (`flusso.creaOrdineDaRisposta`, con `minutiConsegna` che non scende mai sotto i minuti del corriere): è l'arrivo dall'installatore e lo leggono invariati card, icona, striscia, pagina dell'ordine e API dell'app. Contare dall'istante della risposta e non da `NOW()` tiene il ritiro promesso al banco
  e l'arrivo promesso all'installatore sullo stesso orologio anche se l'ordine nasce un po' dopo (riprova del timer).
- **Chi vede cosa**: il banco **solo** il ritiro (pillola della home "29 min · ore HH:MM", riquadro "Ritiro" e Avanzamento della pagina dell'ordine, "ritira alle HH:MM" nel dettaglio dello Storico e nella card "In consegna", avviso a comparsa "Corriere trovato", notifica "Nuovo ordine da preparare: Il corriere ritira alle HH:MM",
  "Consegna presa da Marco: arriva da te in N minuti" nel dettaglio della richiesta); l'installatore **solo** l'arrivo (notifica "Consegna prevista entro le HH:MM (…)", "Arriva entro le HH:MM", conti alla rovescia). Il vecchio `/ordini/:id` visto da banco e agente: il banco vede il ritiro, l'agente l'arrivo.
  **Ordini nati prima di questa regola** hanno in `corriere_minuti` il tempo TOTALE: per loro il ritiro ricavato coincide con l'arrivo dal cliente (com'era mostrato al banco prima), nessuna migrazione.
- **Il tragitto** (`src/percorso.js`, `src/consegna.js`): `consegna.minutiStimati(banco, cliente, partenzaOre)` lo calcola quando il banco CONFERMA (`richieste.rispondi`, fuori da ogni transazione; con il corriere la partenza passata è 0) dal punto vendita più vicino alla posizione dell'installatore (`users.geo_*` con consenso: quella dell'indirizzo di consegna mandato col pagamento, o la sede provvisoria di Via Puggia, vedi "Posizione dell'installatore")
  con **un servizio di mappe scelto in cascata** (`src/percorso.js`, **cambiato il 21/10/2026**: il vecchio OSRM pubblico dava i tempi da strada libera, in città un terzo più brevi di Google Maps — Fegino → Via Dodecaneso 21 min contro 31 di Maps, quindi la prova "corriere 10" mostrava 31 invece di 41; Fegino → Via Puggia 20 contro 31,5 di Valhalla).
  Ordine: **1. Google Maps** (Routes API v2, `routingPreference: TRAFFIC_AWARE` = il tempo col traffico di adesso, lo stesso numero di Maps) **solo se** nel `.env` c'è `GOOGLE_MAPS_API_KEY` (la chiave viaggia nell'intestazione `X-Goog-Api-Key`, mai nell'indirizzo né nei log); **2. OSRM proprio** solo se c'è `ROUTING_URL` (il server pubblico di OSRM **non si chiama più**);
  **3. Valhalla** (`https://valhalla1.openstreetmap.de`, senza chiave, `VALHALLA_URL` per uno proprio): conta incroci e limiti di velocità, e per il percorso della prova dà 31 min (Maps 31; sul punto di Nominatim; 34 su un punto vicino, 31,5 per Via Puggia): scarto da Maps di pochi minuti. È un servizio pubblico di una fondazione, a uso leggero e senza garanzie;
  **4. la stima** in linea d'aria × 1,35 a `velocita_media_kmh` (25), minimo 5 min. Limite d'attesa 3,5 s per servizio, **non lancia mai**: il primo che risponde vale. `fonte: 'mappa' | 'stima'`, e per `mappa` anche `servizio: 'google' | 'osrm' | 'valhalla'`. `ROUTING_ATTIVO=0` spegne tutto (**`test/server.test.js` lo spegne**: le prove non fanno chiamate di rete). Le coordinate di banco e installatore vanno a quei servizi.
  **Per avere ESATTAMENTE il numero di Maps serve la chiave di Google** (Google Cloud → progetto con fatturazione → abilitare "Routes API" → chiave API, limitata alla Routes API e all'IP della VPS → `GOOGLE_MAPS_API_KEY=` nel `.env` della VPS e riavvio; c'è una quota gratuita mensile, con pochi ordini il costo è trascurabile). **Il codice per Google è scritto sulla documentazione e provato solo con risposte finte: non è stato provato contro Google vero.**
  `node scripts/prova_tragitto.js "<indirizzo | lat,lng>" --corriere 10` (sola lettura, nessun DB) mostra il tempo di ogni servizio e quello che vedrebbe l'installatore: serve a confrontarlo con Maps.
  La chiamata sta nella conferma del banco: costa ~150-500 ms, al massimo ~7 s se due servizi sono lenti (poi c'è la stima). **Sempre presente**: se il calcolo alla conferma si rompe (`rispondi` lo prende in un try/catch: la conferma vale comunque) o resta 0, `richieste.assicuraTragitto` lo **ricalcola al "preso" del corriere** prima di sommare i minuti
  (`UPDATE ... WHERE COALESCE(consegna_minuti_stimati, 0) <= 0`); ogni ripiego sulla stima e ogni posizione mancante si scrivono nel log (`[tragitto] ...`, e una riga per ogni conferma: `[tragitto] richiesta N: 31 min, 15.3 km (google)`). **Limite noto**: la posizione dell'installatore è `users.geo_*`, cioè l'ULTIMA mandata: con due richieste insieme a indirizzi diversi il tragitto della prima si calcola dall'ultima posizione
  (servirebbero `requests.dest_lat/dest_lng`, schema da applicare al DB condiviso: non fatto).
- **Senza WhatsApp** (modulo spento, nessun corriere) non cambia niente: l'ordine nasce alla conferma e l'installatore vede "Arriva entro N ore" dalla stima del banco (`consegna_ore`); `consegna_minuti_stimati` ora è il tragitto della mappa invece della stima in linea d'aria, ma lo usano solo il testo della notifica e l'ordinamento delle offerte.
- **Provato** (prima del 21/10/2026, con OSRM; oggi darebbe Valhalla/Google) su un Postgres locale usa-e-getta (schema + seed): richiesta → conferma (tragitto 21 min da OSRM) → "preso 30" → banco ritiro = risposta + 30 min, installatore arrivo = risposta + 51 min, SQL e JS coincidono; pagine banco (home, ordine, Storico) e installatore lette nel browser. Test: `test/orari_corriere.test.js` (corriere, percorso, consegna, `corriereHaPreso`, con DB e servizio finti).

## Storico ordini del banco (14/10/2026)

`GET /distributore/storico` (`server.js`, logica in `src/storico_banco.js`) + `views/distributore_storico.ejs`, classi `sto-*` (blocco
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
  pannello `<div class="sto-dettaglio" id="dett-N" data-url="/distributore/storico/N/dettaglio" hidden>`, vuoto. Il blocco "Storico ordini: righe che si aprono" di `public/app.js` al primo clic carica il frammento (`fetch`, "Caricamento…", errore con "Riprova", un `redirect` = sessione scaduta → ricarica per andare al login),
  **una voce aperta alla volta** (aprirne un'altra chiude la prima; un secondo clic la richiude; se la voce chiusa sta sopra, `scrollBy` tiene ferma la riga cliccata), il chevron (`iconaGiu`) gira di 180° (0,15 s) e la voce aperta ha sfondo `#F7FAFD` col pannello a barra blu a sinistra. **L'id aperto sta nell'ancora** (`#o149`, con `replaceState`: non sporca la cronologia):
  dopo una ricarica (anche quella automatica della pagina), o tornando dalla pagina dell'ordine con la freccia, la stessa voce si riapre (`daAncora`, anche su `hashchange`). Sotto i 900px la card è la voce (riga + pannello) e il pannello è a una colonna.
- **"Da incassare"** (ex "Totale"): `pricing.importi({ ordine }).banco.totale` = materiale + RAEE + IVA (78,69), **non** `totaleOrdine` (98,76: comprende la consegna e il servizio pagati in app, soldi della piattaforma). La lista legge le colonne di `COLONNE_IMPORTI` (`src/storico_banco.js`); una prova (`test/storico_dettaglio.test.js`) controlla che ci siano
  tutte quelle che `importiOrdine` e `ivaPctOrdine` leggono: se il calcolo ne usa una nuova va aggiunta lì, o la lista dà un importo sbagliato in silenzio. L'IVA di oggi (`getIvaPct`, in cache) è solo il ripiego per gli ordini senza IVA salvata.
- **Il pannello** (`GET /distributore/storico/:id/dettaglio` → `views/partials/storico_dettaglio.ejs`, dati da `src/storico_dettaglio.js`; classi `sto-d-*`): un **frammento** HTML (non una pagina), solo ordini del banco loggato (404 testo semplice altrimenti), **sola lettura** (non chiama `prendiInCarico`: aprire il dettaglio non cambia l'ordine; provato con `scrittureDa`).
  Tre colonne (1,55fr | 1fr | 260px): **Materiale** (righe a prezzo del banco, "N articoli · M pezzi", piede "Merce · RAEE se > 0 · IVA · Da incassare dal cliente", "richiesti N, confermati M" in arancio con la risposta parziale), **Come è andata** (`cronologia`: Ricevuto, Confermato da te, Corriere X ha accettato (con ", ritira alle HH:MM": il tempo scritto su WhatsApp), Partito / Partito · in viaggio (passo in corso, pallino
  bianco col bordo verde), Consegnato · confermato dal cliente; passi futuri tratteggiati con ora "—"; **un passo senza dati non c'è**; sotto l'indirizzo e "Corriere X") e i pulsanti "Apri ordine completo ›" e "Scheda cliente ›" (solo se il cliente ha indicato questo banco: `anagrafiche.legame`). Una query per le righe e una per la risposta, più
  (in parallelo) il legame, l'indirizzo del cliente solo se l'ordine non ha la destinazione e l'IVA in cache. `?torna=` (la pagina dello Storico com'è, scritta dallo script) vale solo se è una pagina del banco (`ritornoBanco`); "Apri ordine completo" porta `torna` + `#oN`, così la freccia della pagina dell'ordine riporta allo Storico con la voce aperta.
  Prove: `test/storico_dettaglio.test.js` (parti pure + guardia sulle colonne), "banco: dettaglio di una riga dello Storico (frammento)…" e "banco: Storico ordini con schede…" in `test/server.test.js`.
- **Filtri nell'URL**, tutti lato server: `?stato=tutti|da_preparare|in_consegna|consegnati&periodo=oggi|7|30|tutti&q=&pagina=N`
  (default tutti e 7 giorni; valori sconosciuti tornano al default; i vecchi `in_preparazione` e `partiti` valgono `in_consegna`: `FILTRI_VECCHI`). Il periodo ragiona in **ora italiana** sulle colonne `TIMESTAMP` UTC: "oggi" è
  la mezzanotte di Roma, 7 e 30 sono gli ultimi N giorni da adesso. La ricerca è `ILIKE` sulla ragione sociale, più `o.id =` se quello che
  si scrive (tolto un `#`) è solo cifre; i `%` e `_` scritti dall'utente valgono per sé; sempre con segnaposto. **I conteggi delle schede** sono una
  query con `COUNT(*) FILTER` con gli stessi filtri di periodo e ricerca ma **senza** lo stato (il numero dice cosa si trova cliccando). Lista: `o.id DESC`,
  50 per pagina (`partials/paginazione.ejs`, con `parametro: 'pagina'` e `unita: 'ordini'`; una pagina oltre l'ultima mostra l'ultima), materiale con una
  sola lettura di `order_items` per tutta la pagina. Righe raggruppate per giorno italiano (`fmt.giornoRoma`); "N ordini" conta le righe della pagina.
- **Aggiornamento automatico**: la pagina ha `data-auto-refresh` e `data-versione` come le altre del banco, e il blocco in `app.js` **non ricarica**
  finché un campo con `data-non-ricaricare` (la ricerca) ha testo non ancora inviato (`value !== defaultValue`), anche senza fuoco. Si ricarica
  solo quando i contatori della home cambiano: una consegna (`consegnato_il`) non li cambia, quindi non fa ricaricare lo storico da sola.
- **Sotto i 900px**: ricerca a tutta larghezza, schede che scorrono di lato senza barra, la tabella diventa una lista di card (quattro righe, senza la
  città). "Storico ordini" è una scheda del menu in alto (da 900px) e una voce del menu in basso (sotto i 900px: Home / Clienti / Storico), non più un pulsante vicino al cerchio né una voce della tendina.
- **La freccia indietro di ordine e richiesta torna da dove si è arrivati** (richiesta esplicita del 19/10/2026; prima era fissa su `/distributore`, la home): chi porta a
  `/distributore/ordini/:id` o `/distributore/richieste/:id` aggiunge `?torna=<pagina di partenza, codificata>` con `conRitorno` (`src/http.js`, in `app.locals` per le viste): la riga dello Storico
  "Da preparare" (con i filtri e la pagina: `link({})`; il "Vedi ordine #N ›" della scheda cliente non c'è più). Le due pagine leggono `ritornoBanco(req.query.torna)`: **vale solo una pagina del
  banco** (home, Storico, elenco e scheda cliente, richiesta; con query e ancora), tutto il resto torna alla home, mai un indirizzo esterno (open redirect). Dalla richiesta si va all'ordine solo col redirect (l'ordine "Da preparare" non ha un link dalla richiesta: la route la rimanda da sola, passando `torna` com'è);
  la freccia dell'ordine riporta quindi alla pagina di partenza (la home, lo Storico...), non alla richiesta. Nelle viste il valore passato alle due pagine si chiama
  `paginaPrecedente`, **non `indietro`**: `partials/banco_testa` (inclusa) lo leggerebbe e disegnerebbe una seconda freccia. Non passa dai POST (tranne "Preparato" dalla pagina dell'ordine, che manda `torna` e lo restituisce): dopo un errore di risposta la
  freccia riparte dalla home. Prove: `test/http.test.js` (`ritornoBanco`, `conRitorno`) e "banco: la freccia di ordine e richiesta riporta…" in `test/server.test.js`.
- Prove: `test/storico_banco.test.js` (parti pure) e i quattro test "banco: Storico ordini…" / "/distributore/ordini porta allo Storico" in
  `test/server.test.js` (DB finto che tiene SQL e parametri delle query). Per provarlo sul DB vero serve un utente `distributore` di prova (non quelli
  del README: sono persone vere): `INSERT INTO users` con `bcrypt`, poi cancellarlo con le sue `session`. Aprire il dettaglio di un
  ordine `inviato` non lo tocca più (dal 19/10/2026); lo porta "In consegna" solo "Preparato" (POST `/preparazione`, che avvisa il cliente).

## Clienti del banco (14/10/2026)

`views/distributore_clienti.ejs` e `views/distributore_cliente.ejs` (classi `cli-*`, blocco "Clienti del banco" in
fondo a `style.css`); logica di approvazione e rifiuto **invariata** (`POST .../decidi`, stessi campi `codice_cliente`, `note`, `azione`). La rotta
`POST .../sconti` (campi `sconto<n>_<ambito>_<chiave>`) c'è ancora, **ma la pagina non ha più il modulo** (vedi "Pagina del cliente approvato"). Richieste esplicite, non rimetterli:
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
  la decisione va sopra i dati sotto i 900px (l'approvato ha un altro layout, vedi sotto). **Una voce senza dato non si
  disegna** (PEC, consegna, referente, telefono, email). La consegna abituale è una stringa sola
  ("Via X 1, 16131 Genova (GE)"): la via è ciò che sta prima della prima virgola. La città si mostra com'è salvata
  (un cliente ha "Génova" con l'accento nel DB: richiesta esplicita di non correggere i dati).
- Il riquadro "È un tuo cliente?" è `sticky` con `top: 80px` (64px dell'intestazione, anch'essa sticky, + 16px): con
  `top: 16px` finirebbe sotto la barra. La conferma sul rifiuto è un `onclick="return confirm(...)"` sul solo pulsante
  "rifiuta" (il form è uno, con i due pulsanti `name="azione"`).
- **Pagina del cliente approvato** (richiesta esplicita del 18/10/2026; al posto dei blocchi "Da incassare" e "Sconti concordati", non rimetterli): testata con freccia
  tonda (`.cli-indietro-tondo`, niente riga "← Clienti") e pallino "● Approvato" (`.cli-intesta-app`); `.cli-layout-approvato` = colonna da 360px (fatturazione,
  contatti, "Cliente approvato": le schede di prima, spostate) + `partials/materiale_cliente.ejs` (classi `mc-*`, col contesto scritto in testa: in app l'installatore
  paga SOLO il servizio, il materiale lo paga dopo al banco, che qui ha tutto ciò che deve incassare, IVA inclusa; il servizio non compare mai). Contenitore
  allargato da 900px (`.cli-pagina-larga`, 1600px). Sotto i 900px colonne impilate con il materiale **prima** dei dati; da 900px la scheda ha
  `max-height: calc(100vh − 180px)` e scorre solo `.mc-elenco` (testata, filtri e riepilogo fissi), sotto scorre la pagina (niente scroll annidato su telefono).
  Le regole di layout dell'approvato stanno in `@media (min-width: 900px)`: il blocco è in fondo al file e senza quella guardia vincerebbe sulla regola dei 900px (a 768px
  le colonne restavano affiancate). **Un solo calcolo**: `materiale.materialeCliente(distributorId, clienteId, { mese, vista, ditta })` sta sopra `materialeOrdini` e non rifà
  conti. Differenze volute dallo Storico dell'installatore: stato = `storico_banco.statoStorico` (Da preparare / In consegna / Consegnato, pillole `sto-pillola
  sto-st-*`); totale ordine = `pricing.importiOrdine` (come l'installatore: con le righe arrotondate una per una può differire di 1-2 centesimi dalla somma delle righe) e IVA
  quella **salvata nell'ordine** (`ivaPctOrdine`), non `getIvaPct()` di oggi; "di cui IVA" = totale − somma dei netti di riga; "Articoli · pezzi" = articoli **distinti**
  (codice + nome) e somma delle quantità; ordine per `creato_il` decrescente, a parità l'id. La vista per articolo somma per (codice, nome) anche con prezzi diversi ("prezzi diversi",
  `cad` null; sotto i 640px "Negli ordini" passa sotto il nome); lo Storico dell'installatore invece divide per prezzo. Filtri: al massimo 2 mesi in segmenti + "Tutto", gli
  altri in una `<select name="mese" onchange="this.form.submit()">` ("Altri mesi", con `<noscript>` "Vai"); sono tutti GET, con `#materiale`; i primi 2 ordini sono aperti.
  **Niente più "Vedi ordine #N ›"** (richiesta esplicita del 19/10/2026; `linkOrdineBanco` e `href` degli ordini sono spariti da `materialeCliente`): la pagina dell'ordine c'è per tutti gli stati ma qui non c'è più un link: ci si arriva dalla home
  ("Ispeziona") o dallo Storico. **CSV** `GET /distributore/clienti/:id/materiale.csv?mese=` (404 se il cliente non è approvato): `;`, BOM, dal più vecchio, Data;Ordine;Stato;
  Codice;Articolo;Quantità;Prezzo cad. IVA incl.;Totale IVA incl., ultima riga il totale, **senza servizio**; file `materiale_<ragione-sociale>_<AAAA-MM|tutto>.csv` (`nomeFileCsvCliente`,
  slug ASCII). `Response.text()` toglie il BOM: nei test si leggono i byte. **Sconti**: la rotta `POST .../sconti` e le regole salvate (`client_discount_rules`) restano, ma senza
  modulo; il partial `riga_sconti.ejs` e i suoi stili (`.cli-sotto-titolo`, `.cli-elenco-sconti`) restano finché non si decide se eliminarli del tutto. Prove: test
  "banco: \"Materiale ordinato\"..." in `server.test.js` e, in `materiale.test.js`, `materialeCliente`, il CSV del banco e il partial (stato vuoto, "Altri mesi"). Verifica
  visiva senza toccare il DB vero: pagina usa-e-getta con partial veri, `style.css` vera e DB finto (come in `test/server.test.js`), su più larghezze (1440, 768, 375).
- Prova: `test/server.test.js` ("banco: elenco clienti..." e "banco: pagina del cliente..."). Nel browser, per provare
  approvazione e rifiuto non usare i clienti veri (un "da approvare" è una persona reale): creare due clienti di prova,
  provare, **cancellarli per id** (users, client_distributors, notifications, client_discount_rules).

## Account dell'installatore: password dimenticata, cambio password, elimina account (20/10/2026)

Richiesta esplicita ("fai 1 e 2" dopo l'elenco di cosa mancava). Solo **clienti** (installatori); il banco ha il suo cambio password nell'Anagrafica del banco, l'agente nessuno.
- **Password dimenticata** (`src/recupero_password.js`, `views/password_dimenticata.ejs`, `views/password_reimposta.ejs`; link "Password dimenticata?" sul login): `GET/POST /password-dimenticata`
  (nome utente **o** email, anche maiuscolo) → per ogni cliente attivo che corrisponde (al massimo 3) UNA email **all'indirizzo salvato nell'account**, mai a uno scritto da chi chiede, con un link
  `/reimposta-password/<codice>`. Il codice (32 byte, 43 caratteri base64url) **non sta nel DB**: tabella `recupero_password` con l'hash SHA-256, `scade_il` = un'ora, `usato_il`; un link nuovo annulla i
  precedenti dello stesso account; `accountDaCodice` non cerca nemmeno nel DB un codice mal formato. **La risposta è sempre la stessa** (account che c'è o no, senza email, eliminato: stessa pagina, stesso stato) e
  l'**invio non si aspetta** (nemmeno il tempo dice se l'account esiste; provato: `test` "risposta uguale per account che c'è e che non c'è"). Limiti (`limite_login`): 3 richieste/ora per coppia indirizzo+identificativo
  e 10/ora per indirizzo (429, conta anche per account inesistenti). Reimpostare (`reimposta`): link consumato nella STESSA transazione che cambia la password (due invii insieme non la cambiano due volte); con
  campi che non vanno il link NON si consuma; poi **si chiudono TUTTE le sessioni** dell'account (`session`, nessuna da tenere) e **si revocano gli accessi dell'app** (`app_tokens`), e si va a `/login?avviso=password`.
  **Il link nell'email usa `APP_URL`**, MAI l'intestazione Host (la scrive chi chiama: un link verso un sito altrui farebbe rubare il codice); senza `APP_URL` l'email non parte (riga nel log) tranne in locale
  (host `localhost`/`127.0.0.1`/`::1`), dove, **senza SMTP**, il link si scrive nel log del server (`[recupero password] (solo in locale) link per …`) per poter provare senza posta; mai su un indirizzo pubblico.
  **Serve l'SMTP configurato** (`SMTP_*` nel `.env`, vedi `src/email.js`): oggi non c'è sulla VPS, quindi in produzione **non parte nessuna email e il recupero non funziona finché non lo si configura**. `src/email.js`:
  `inviaRecuperoPassword` (HTML + testo, non lancia mai). Solo il cliente ha il recupero: banco/agente/account senza email o disattivati non ricevono niente.
- **Cambio password dal profilo** (`POST /profilo/password`, scheda "Accesso" di `views/profilo.ejs`, `<details>` che con errori resta aperto): stessa logica del banco, **estratta in `src/password_account.js`** (`cambiaPassword`,
  `controllaCambioPassword`, `chiudiAltreSessioni`, `revocaAccessiApp`, `scriviNuovaPassword`; `anagrafica_banco.js` la importa): attuale giusta (`passwordValida`), nuova 8–72 caratteri e DIVERSA, chiude le ALTRE
  sessioni e **da ora revoca anche gli accessi dell'app** (anche per il banco: `UPDATE app_tokens … revocato_il`), limite tentativi del login (chiave `cambio-password:<utente>`, 8 in 10 minuti → 429).
- **Elimina account dal sito** (`GET/POST /profilo/elimina`, `views/profilo_elimina.ejs`, scheda "Elimina account" nel profilo): usa lo STESSO `src/account.js` dell'app (anonimizza e disattiva, non cancella: ordini,
  ricevute e pagamenti restano). La pagina spiega cosa si cancella e cosa resta e chiede la password; **se c'è qualcosa in corso** (richiesta in attesa, ordine non consegnato nelle ultime 24 h, pagamento a metà) lo dice
  subito e il modulo non c'è (anche un POST a mano riceve 409); a buon fine `tokenApp.dimenticaUtente`, sessione distrutta, `/login?avviso=eliminato`. Le frasi del login (`?avviso=`) sono solo `AVVISI_LOGIN` in `server.js`.
  `/elimina-account` (pagina pubblica per Google Play, `src/testi_legali.js`) ora ha anche la sezione "Dal sito".
- **App Expo**: nel login c'è "Password dimenticata?" che apre `SERVER + '/password-dimenticata'` nel browser (come Privacy ed Elimina account); il cambio password dentro l'app non c'è (solo `tsc` provato, non su un telefono).
- **Schema** (blocco "Recupero della password dell'installatore (20/10/2026)" in fondo a `schema.sql` e `schema.pg.sql`, DOPO quello dell'anagrafica del banco): tabella `recupero_password` + indice. **Applicato solo al DB locale
  di prova, NON al condiviso** (`node scripts/applica_blocco_schema.js "-- Recupero della password dell'installatore"`). Senza la tabella il recupero dà errore 500; il resto (cambio password, elimina) funziona.
  Nota: `applica_blocco_schema.js` applica **dal commento indicato fino in fondo**, quindi lanciarlo con "-- Anagrafica del banco: orari" applica entrambi i blocchi.
- **Prove**: `test/recupero_password.test.js` (modulo e email, DB e posta finti), `test/anagrafica_banco.test.js` (la revoca degli accessi dell'app), e in `test/server.test.js` "login: link …", "recupero password: …", "profilo: scheda
  Accesso…", "elimina account dal sito…". Provato su Postgres locale con il server vero (link con scadenza reale, hash nel DB, sessioni vecchie fuori, account anonimizzato, nuovo recupero per un account eliminato: niente) e a 430px.
  **Non provato**: l'invio con un SMTP vero, l'app Expo su un telefono.

## Anagrafica del banco e orari (20/10/2026)

`GET /distributore/anagrafica` (`server.js`, "Anagrafica del banco") + `views/distributore_anagrafica.ejs` + `views/partials/ab_campo.ejs`, classi `ab-*` (blocco in fondo a `style.css`), logica in
**`src/anagrafica_banco.js`** (controlli, lettura, salvataggi) e **`src/orari.js`** (orari, pura). Mockup in `docs/mockup/anagrafica-banco*.png` (la loro intestazione è vecchia: bottone "Storico ordini" e campanella
non ci sono più, vale quella unica di `banco_testa`). **Un solo profilo con tutti i permessi**: niente ruoli, colleghi, inviti (richiesta esplicita, non aggiungerli). Prove: `test/orari.test.js`,
`test/anagrafica_banco.test.js` (controlli, salvataggi con DB finto, geocodifica con `fetch` finto), "banco: anagrafica…" e "carrello: con TUTTI i banchi chiusi…" in `test/server.test.js`, "orari" in `test/richieste_importi.test.js`.
- **Dove si apre**: voce "Anagrafica del banco" in cima alla tendina del cerchio (`banco_testa.ejs`); sulla pagina il cerchio ha la classe `.attivo` (anello blu pieno `#245A8F`) e nessuna scheda del menu è accesa
  (`sezione` vuota per quel percorso). **Dalla tendina sono spariti "Suoni notifiche" e "Attiva le notifiche del computer"**: gli interruttori stanno nella scheda Notifiche della pagina.
- **Schede e dove scrivono**: *Ditta* = tabella `ditte` via `distributors.ditta_id` (ragione sociale, P. IVA, SDI/PEC, sede legale); senza `ditta_id` vale `distributors.ragione_sociale/partita_iva` e la scheda cambia **solo
  quelle due** (SDI e sede non si mostrano: gli indirizzi di `distributors` sono quelli di ritiro, non la sede legale). *Questa filiale* = riga di `distributors` **e** riga di `store_locations` (la prima della filiale: indirizzo,
  telefono, email, e il nome solo se era quello della filiale): i due non devono divergere, li leggono `/punti-vendita`, `consegna.js` e il messaggio ai corrieri. *Orari* = `distributors.orari`. *Accesso* = `users.email`
  dell'utente loggato + password. Controlli (messaggi sotto il campo, rosso): P. IVA 11 cifre; SDI 7 caratteri (maiuscolo) **o** PEC; CAP 5 cifre; provincia 2 lettere (maiuscolo); **un campo vuoto va bene** (oggi P. IVA e
  SDI sono vuoti: non devono bloccare il salvataggio del telefono), ragione sociale / nome banco / via / zona sono obbligatori. Il nome della filiale duplicato (indice unico nome+filiale) dà l'errore sotto il campo (23505).
- **Come si apre una scheda**: ogni scheda ha lettura + modulo nascosto; "Modifica" è un link `?modifica=<scheda>#<scheda>` (senza JS il server la rende già aperta, `data-aperta`) che lo script (blocco "Anagrafica del banco"
  in fondo a `app.js`) trasforma in un cambio di vista. Con errori la pagina si ripropone 400 con la scheda aperta e i valori scritti; salvato → redirect `?ok=<scheda>` con il messaggio verde. **Niente `data-auto-refresh`**
  su questa pagina (si ricaricherebbe mentre si scrive).
- **Posizione sulla mappa: FISSA dal 21/10/2026** (richiesta esplicita: "la posizione di Borea è fissa, la solita inserita nel DB"). La pagina la mostra soltanto, riga verde se `geo_lat/geo_lng` ci sono, arancio se mancano, senza pulsanti. **Tolti** (erano della prima versione del 20/10): "Sposta"/"Imposta" con il `<dialog>` Leaflet,
  `POST /distributore/anagrafica/posizione`, `anagrafica_banco.spostaPosizione`, il ricalcolo dall'indirizzo al salvataggio della filiale (e i suoi esiti `ricalcolata`/`non_trovata`/`manuale`, il parametro `?pos=`) e il blocco di `public/mappa.js`; `geo.geocodifica` resta, ma la usa solo l'indirizzo di consegna dell'installatore.
  `distributors.geo_manuale` resta come colonna inutilizzata. Cambiare l'indirizzo di ritiro non sposta il punto (nota nel modulo). Per cambiare le coordinate di una filiale serve uno script (vedi "Ditte, filiali, dipendenti").
- **Orari** (`src/orari.js`): JSONB `{"lun":[["07:30","12:30"],["14:00","18:00"]],…,"dom":[]}`, sette giorni, al massimo due fasce, ora di **Roma** (`Intl`, anche se il server è in UTC), fascia `[inizio, fine)` nello stesso
  giorno. **NULL = sempre aperto** (com'era; anche un valore rovinato vale "aperto": meglio una richiesta fuori orario che una persa). Il modulo: una riga per giorno con interruttore aperto/chiuso e due fasce, "Copia su tutti i
  giorni feriali" (lun → mar–ven), e la casella "Nessun orario: sempre aperto" (non era nella spec: serve per tornare a NULL; con NULL il modulo propone gli orari del mockup, spenti). Non si salva con tutti i giorni chiusi
  (il banco non riceverebbe mai niente). In lettura i giorni consecutivi uguali stanno su una riga (`orari.riassunto`).
- **Effetto sulle richieste**: `richieste.distributoriCandidati` (solo le filiali aperte adesso), il ripiego "broadcast" di `creaRichiesta` (**mai** i chiusi: se sono tutti chiusi la richiesta nasce già `nessuna_offerta` e la carta
  si rilascia, come senza banchi) e **`flusso.controllaBancoAperto`** → `ErroreFlusso('banco_chiuso')`, chiamata da `validaRichiesta` (quindi dall'invio sul sito, con Stripe prima di autorizzare la carta **e di nuovo a carta già
  autorizzata**, e dall'API dell'app: `400` con `codice: 'banco_chiuso'`), da **"Rinvia richiesta"** (sito, API e `avviaPagamentoReinvio`; non era nella spec, ma rinviare a un banco chiuso farebbe pagare per niente) e dal carrello. Il
  carrello (`/carrello`, `richieste.statoBanchiAttivi`, una query solo a carrello pieno) al posto di "Paga e invia richiesta" mostra **"Il banco è chiuso · riapre giovedì alle 07:30"** (`.btn-paga-chiuso`, sempre `disabled`, e
  `aggiornaCarrelloDa` in `app.js` non lo riattiva: `data-banco-chiuso`); la nota "Se nessun banco accetta, ti rimborsiamo" non c'è. Più filiali: chiuso solo se lo sono **tutte**, e dice quando riapre la prima. **L'app Expo non
  mostra niente** (il suo carrello non sa degli orari: il server rifiuta e l'app vede l'errore generico dell'API). La pagina del carrello **non si aggiorna da sola** alla riapertura.
- **Password** (`POST /distributore/anagrafica/password`): controlla l'attuale con `passwordValida`, la nuova con `password.erroriNuovaPassword` (8–72 caratteri come in registrazione, uguale alla ripetizione, **diversa
  dall'attuale**), salva l'hash bcrypt e **chiude le altre sessioni** dello stesso utente (`DELETE FROM session WHERE (sess::jsonb #>> '{user,id}') = ? AND sid <> ?`, come `src/account.js`). I tentativi con l'attuale
  sbagliata contano nello stesso limite del login (`limite_login`, chiave `cambio-password:<utente>`: 8 in 10 minuti → 429). Le password non tornano mai nel modulo.
- **Notifiche** (solo browser, `localStorage`/permesso, blocco "Avvisi del banco" di `app.js`): "Suoni" (`minuteria.banco.suoni`, come prima) e "Notifiche del computer" (permesso del browser **e** `minuteria.banco.notificheSistema`:
  il permesso non si revoca da una pagina, quindi "spento" = "non le mostro", e la comparsa vera in `app.js` guarda `notificheSistemaConsentite()`); a permesso negato l'interruttore resta spento con la nota "Bloccate dal browser…".
  **"Email per ogni nuova richiesta" è NASCOSTA**: la riga compare solo quando `email.inviaNuovaRichiesta` esiste (oggi `src/email.js` manda solo "Pagamento ricevuto"); la colonna `distributors.email_nuove_richieste` e la
  rotta `POST /distributore/anagrafica/email-richieste` (JSON `{acceso}`) ci sono già.
- **Intestazione**: `intestazioneBanco` (server.js) ha una "versione" per banco, alzata dopo ogni salvataggio di ditta/filiale (`rileggiIntestazioneBanco`): il nuovo nome si vede subito, non fra 60 secondi.
- **Schema** (blocco "Anagrafica del banco: orari, email delle richieste, posizione spostata a mano" in fondo a `schema.sql` e `schema.pg.sql`): `distributors.orari JSONB`, `email_nuove_richieste INTEGER DEFAULT 0`,
  `geo_manuale INTEGER DEFAULT 0`. **Applicato solo al DB locale di prova; NON al DB condiviso di produzione**: va applicato PRIMA di mettere il codice sulla VPS (`node scripts/applica_blocco_schema.js "-- Anagrafica del banco: orari" [--applica]`).
  Senza le colonne il carrello e l'invio funzionano lo stesso (leggono `SELECT *`: `orari` mancante = sempre aperto), ma la pagina dell'anagrafica non può salvare orari né email (`geo_manuale` non serve più: la posizione è fissa).
- **Provato su Postgres vero** (locale usa-e-getta, server vero da una cartella senza `.env`; la parte sulla posizione di sotto è **superata dal 21/10/2026**, la posizione del banco ora è fissa): salvataggio di ditta e filiale, orari e banco chiuso nel carrello (pulsante, rifiuto del server, nessuna richiesta creata, ripiego broadcast),
  cambio password con due sessioni (l'altra esce), limite tentativi, vista a 375px. **Non provato**: il permesso delle notifiche del browser (nel pannello incorporato è negato: si vede solo la nota "Bloccate"), l'audio, Safari.

## Aggiornamento automatico del banco

Le pagine del banco (home, ordini, clienti, dettaglio richiesta) hanno `data-versione` = i contatori
con cui sono state disegnate e chiedono ogni 5 s `/api/distributore/novita` (gli stessi contatori, più
ultima richiesta/ordine e corrieri in attesa): se cambiano si ricaricano, anche se la scheda era in
secondo piano (aspettano di tornare visibili o che finisca la digitazione). Prima era una ricarica a
tempo che saltava le schede nascoste. Le risposte hanno `Cache-Control: private, no-cache`.

## Avvisi del banco fuori dalla home (20/10/2026)

Richiesta esplicita (mockup in `docs/mockup/notifiche-banco-pagina.png` e `notifiche-banco-tipi.png`): quando il banco non guarda la home, tre livelli + scheda del browser + suono. **Sulla
home NON ci sono la striscia né gli avvisi a comparsa** (le colonne mostrano già tutto); il pallino su "Banco", il titolo, la favicon, il suono e la notifica di sistema valgono anche lì.
Codice: `src/banco_avvisi.js` (dati), `views/partials/banco_avviso.ejs` (striscia + icone) e `banco_testa.ejs` (pallino, voci del menu), blocco "Avvisi del banco" in fondo a `public/app.js`,
blocco "Avvisi del banco" in fondo a `public/style.css`, `public/suoni/avviso.mp3` (5 KB, generato: due note). Prove: `test/banco_avvisi.test.js` e cinque test "banco: ..."/"avvisi del banco: ..." in `test/server.test.js`.
- **Schema** (blocco "Notifiche del banco: tipo e richiesta (20/10/2026)" in fondo a `schema.sql` e `schema.pg.sql`): `notifications.tipo TEXT` e `notifications.request_id INTEGER`, nullable, senza chiave esterna.
  **Applicato al DB condiviso il 20/10/2026** (prova a secco e poi `--applica`): `notifiche.notifica()` scrive le due colonne a ogni notifica, quindi il codice nuovo NON gira su un DB senza il blocco (anche sulla VPS: schema prima del riavvio).
- **Tipi** (`notifica(..., { tipo, request_id })`): `nuova_richiesta` (`richieste.creaRichiesta` e `reinviaRichiesta`), `corriere_trovato` (`flusso.creaOrdineDaRisposta`, è la notifica "Nuovo ordine da preparare", con `order_id`),
  `nessun_corriere` e `richiesta_scaduta` (**solo** `richieste.chiudiFinestraRisposte`, con `UPDATE ... RETURNING distributor_id`: la prima va al banco che aveva confermato aspettando un corriere, la seconda a chi non ha risposto; chi
  aveva già rifiutato o era stato chiuso perché una filiale sorella ha confermato non riceve niente), `ordine_consegnato` (`flusso.scriviConsegna`, chiamata da `segnaConsegnato` e `segnaConsegnatoProva`: UPDATE con
  `consegnato_il IS NULL`, un solo avviso anche con due conferme). Una richiesta annullata dal cliente o una persa a favore di un'altra ditta NON hanno un avviso loro: l'avviso "Nuova richiesta" sparisce da solo.
  Gli avvisi sono best effort: un guasto lì finisce nel log e non fa fallire la chiusura o la consegna.
- **`GET /distributore/stato-banco`** (JSON, `no-store`): `{ daConfermare, primaScadeSec, attesaCorriere, daPreparare, richieste: [{ id, cliente, articoli, pezzi, secondi, finestraSec, scadeAlle }], ordini: [id da preparare] }`.
  I conteggi sono i `contatori` che il middleware di `server.js` ha già letto (nessuna query in più); le richieste sono una query sola (`richiesteInAttesa`), gli ordini un'altra, in parallelo. `primaScadeSec` per il primo disegno della
  striscia arriva da `letturaBanco` (stessa query dei contatori) in `res.locals.primaScadeSec`: **non va nei contatori**, che finiscono in `data-versione` e farebbero ricaricare la pagina a ogni secondo.
- **`GET /api/notifiche/push`**: per il banco ogni notifica porta anche `tipo`, `request_id`, `order_id`, `eta_sec` e i dati dell'avviso (`arricchisciPush`: `richiesta` { cliente, articoli, pezzi, secondi, scadeAlle } o `null` se non è più da
  confermare; `ordine` { corriere, ritiroAlle, daPreparare } o { cliente, alle }). `daMostrare` marca `notificata` solo gli id letti (prima tutte quelle dell'utente: una nata fra SELECT e UPDATE si perdeva). Per gli altri ruoli cambia solo
  che ci sono colonne in più. **`POST /api/notifiche/lette`** `{ ids, richieste, ordini }`: "aperta o chiusa, la notifica risulta letta"; si manda anche la richiesta/l'ordine perché l'avviso sopravvive alle ricariche della pagina (che ne perdono gli id).
- **"Conferma" dall'avviso**: `POST /distributore/richieste/:id/rispondi` con `Accept: application/json` risponde `{ ok, errore }` (200, o 409 col motivo) invece del redirect; i form della home e del dettaglio (Accept html) restano com'erano.
- **Come ragiona lo script** (`[data-banco-testa]` sull'`<header>`, che deve restare uguale su tutte le pagine: un test lo confronta, quindi la home si riconosce dal percorso, non da un attributo): polling dello stato ogni 15 s e delle
  notifiche ogni 5 s (e subito dopo una conferma, o quando ne arriva una nuova); il blocco vecchio delle notifiche del browser non gira più sulle pagine del banco (resta per cliente e agente). Gli avvisi "Nuova richiesta" seguono
  l'**elenco del server**: ne compare uno per ogni richiesta ancora da confermare anche dopo un cambio di pagina o una ricarica (le pagine del banco si ricaricano da sole quando cambiano i contatori), sparisce quello di una richiesta che
  non c'è più (risposta di un collega: provato; scaduta; annullata) e allo scadere del conto alla rovescia (o con ≤ 5 s alla scomparsa) diventa "Richiesta scaduta", che l'avviso del server non ripete (`scadute`). "Corriere trovato" resta finché si
  chiude o si apre l'ordine, anche cambiando pagina (**sessionStorage** `minuteria.banco.avvisi.<id utente>`, massimo 2 ore) e sparisce se l'ordine non è più "da preparare" (`ordini` di stato-banco). Gli avvisi da 6 e 10 s si perdono se la
  pagina si ricarica prima. Si mostrano al massimo 3 (i più nuovi; gli altri restano vivi, con una pastiglia "+N altri avvisi"). Una notifica nata da più di 10 minuti (`eta_sec`, dopo una lunga assenza) non si mostra più. Sulla pagina della
  richiesta (o dell'ordine) a cui si riferisce l'avviso non compare (c'è già tutto) e la notifica si segna letta. Tutti i testi degli avvisi sono `textContent` (il nome del cliente lo scrive lui in registrazione).
- **Scelte mie da confermare**: senza il modulo WhatsApp (nessun corriere) l'avviso verde dice "Nuovo ordine · Ordine #N / Ordine già pagato: prepara il materiale." invece di "Corriere trovato" (sarebbe falso); gli avvisi si fermano sopra il
  menu in basso sotto i 900px; la striscia non è sticky (la barra sì: si vede sempre il pallino); `Notification.requestPermission()` richiede un clic: dal 20/10/2026 sta negli interruttori della scheda Notifiche dell'**Anagrafica del banco** (non più nella tendina dell'account: vedi la sezione sopra). "Suoni" è in `localStorage` (`minuteria.banco.suoni`). **Il suono parte solo dopo un clic su quella pagina** (regola del browser): ogni ricarica completa riparte da zero.
- **Non provato / limiti**: la notifica di sistema (nel browser incorporato il permesso è negato: il percorso è `document.hidden` + `Notification.permission === 'granted'`), l'ascolto vero del suono (si vede solo la richiesta dell'MP3),
  "riduci movimento" (solo il CSS, controllato da un test), Safari/iPhone. Provato nel browser incorporato su un Postgres locale usa-e-getta (`DROP DATABASE` fatto a fine prova): pallino, striscia (rossa sotto i 2 minuti), avviso con "Conferma" senza
  lasciare la pagina (poi "Nuovo ordine"), scadenza, risposta di un collega, "Corriere trovato" che resta cambiando pagina, chiusura automatica a 10 s con pausa al passaggio del mouse, titolo che alterna e favicon col pallino, home senza avvisi, 375 px.

## Gruppo WhatsApp dei corrieri (`src/whatsapp.js`)

Flusso e variabili in README. Qui solo ciò che non si deduce dal codice.
- **Interruttore 0/1 nel `.env`** (richiesta esplicita del 19/10/2026, prima era "mai acceso in locale"): `WHATSAPP_ATTIVO=1` acceso, `0` o niente spento (riavviare il server). Nel `.env` **locale**
  ci sono già `WHATSAPP_ATTIVO=0`, `WHATSAPP_ISTANZA=locale`, `WHATSAPP_AUTH_DIR=whatsapp_auth_locale` e `WHATSAPP_GRUPPO=` (vuoto: da riempire, a quel punto il server stampa i gruppi del numero). Il locale
  punta al DB di produzione e al gruppo vero: **acceso, ogni ordine di prova scrive ai corrieri veri**. Spento, `accodaRitiroConsegna` non scrive nemmeno in coda. Per provare dal PC senza ordini veri c'è
  `scripts/prova_whatsapp.js`, che si accende da solo e usa una richiesta finta.
  - **`npm test` e il `.env` (corretto il 19/10/2026)**: `test/server.test.js` *cancellava* `WHATSAPP_ATTIVO` prima di caricare `server.js`, ma `dotenv` la rimetteva dal `.env`: con `WHATSAPP_ATTIVO=1` nel `.env` locale le prove avviavano il VERO WhatsApp (sessione locale: rischio di scollegare il bot già acceso con un 440),
    "Avvisiamo i corrieri" compariva fra i passi e due prove fallivano. Ora la prova la imposta a `'0'` (una variabile definita dotenv non la sovrascrive). Le altre variabili del `.env` che accenderebbero servizi veri (`STRIPE_*`, `APP_URL`, `PAGAMENTO_SIMULATO*`, `FINESTRA_CONFERMA_SEC`) erano già svuotate così; se se ne aggiunge una, va svuotata lì.
  - **Sessione propria**: il locale NON deve usare `whatsapp_auth` (la sessione del 2 ottobre, copiata sulla VPS): le stesse credenziali da due macchine si scollegano a vicenda (440) e rovinano le chiavi
    di cifratura. Per questo `WHATSAPP_AUTH_DIR=whatsapp_auth_locale`: un secondo dispositivo sul numero, da collegare una volta con un QR (il server lo stampa nel terminale). Cartelle `whatsapp_auth*/` fuori da git.
  - **Istanza proprietaria dei messaggi** (colonna `whatsapp_messaggi.istanza`, blocco "WhatsApp: istanza proprietaria dei messaggi", **applicato al DB condiviso il 19/10/2026**): ogni riga in coda ha il nome
    dell'istanza che l'ha creata (`WHATSAPP_ISTANZA`, o `os.hostname()`) e **solo lei** la invia, la elimina (`da_eliminare`) e ne legge le risposte (`gestisciMessaggio` ignora il corriere che risponde a un
    messaggio di un'altra istanza: la riceve anche lei nello stesso gruppo). Con un nome scritto nel `.env` si trattano SOLO le righe con quel nome; senza, anche quelle senza nome (di prima o di un server
    non aggiornato: la VPS). `ritiraRichiesta` scrive solo righe, e l'avviso di annullo va all'istanza del "nuova consegna" di quella richiesta. **Aggiornare la VPS prima di accendere il locale**: il codice vecchio
    invia tutte le righe in coda, anche quelle del locale. Se il proprietario è spento un messaggio scaduto non viene eliminato dal gruppo finché non torna acceso. Prove: `test/whatsapp_istanza.test.js`.
  - Con `FINESTRA_CONFERMA_SEC` nel `.env` il corriere ha solo quei secondi per rispondere (all'avvio, con WhatsApp acceso, il server lo scrive nel log): togliere la riga quando si prova con WhatsApp.
- Baileys è **7.0.0-rc14** (l'ultima; la 6.x è il tag `legacy`), ESM: caricato con `import()` dentro
  `collega()`. Non ufficiale: il numero può essere bloccato. Logger muto finto (passare pino non serve).
- Gli orari del corriere stanno in colonne `TIMESTAMPTZ` (`corriere_risposto_il`, `corriere_arrivo_il`), a differenza
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
  esplicita. Fase 1 solo installatore, poi banco "leggero", l'agente resta web. Dal 19/10/2026 l'app ha registrazione, pagamento con Stripe, push, profilo ed eliminazione account: vedi "App Android e sicurezza". Le API Expo
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
Le notifiche del **banco** hanno anche `tipo` e `request_id` e diventano avvisi a comparsa: vedi "Avvisi del banco fuori dalla home".

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
- **PWA** (`public/manifest.webmanifest`, `public/sw.js`, `public/offline.html`, `public/icons/`): il service worker **non mette in
  cache pagine, CSS, JS né API** (sono dati di chi è collegato) e fa tre cose: mostra le notifiche su Chrome Android, dove
  `new Notification()` lancia (`Minuteria.mostraNotifica` in `app.js` prova il costruttore e ripiega su
  `registration.showNotification`), rende l'app installabile e, **solo per le navigazioni** (`request.mode === 'navigate'`), se la rete manca mostra
  `/offline.html` (l'unica cosa in cache, `minuteria-offline-v1`, scaricata con `cache: 'reload'` all'installazione; pagina autonoma, tutto in
  linea) invece dell'errore del browser. Immagini, script e `/api` non passano da qui e falliscono come prima: l'app non finge di avere dati che non ha.
  **Funziona solo in HTTPS** (o localhost): finché il sito resta su HTTP semplice non succede niente, senza errori. Le icone (lettera "M" su blu) sono
  **segnaposto**, rigenerabili con `node scripts/genera_icone_pwa.js`; manca ancora il logo vero.
  **Installare dal telefono (20/10/2026, richiesta "web app per mobile")**: il manifest ha `id`, `orientation: portrait`, `categories`; `partials/installa.ejs`
  (nella home, compatta con la × "Non ora" per 30 giorni in `localStorage`, e nella scheda **"Sul telefono"** del profilo, sempre disponibile) è
  nascosta e il blocco "Installa l'app" di `app.js` la mostra solo con `beforeinstallprompt` (Chrome/Edge/Samsung, HTTPS) o, su iPhone/iPad con Safari,
  con la spiegazione "Condividi → Aggiungi alla schermata Home"; mai se è già aperta da installata. Nella scheda "Sul telefono" c'è anche "Avvisi sul telefono"
  (`[data-abilita-notifiche]`, che prima non stava in nessuna vista): chiede il permesso del browser, **ma gli avvisi arrivano solo finché l'app è aperta**
  (controllo ogni 10 s): **non esiste Web Push** (servirebbero chiavi VAPID, un archivio delle iscrizioni e `web-push`). Prove: `test/sw.test.js` (il
  service worker in un contesto isolato con `caches`/`fetch` finti: il pannello browser incorporato non registra service worker, quindi **cache offline e
  installazione vera non sono provate su un telefono**) e due test in `test/server.test.js`.
- **Browser**: `leggiJson` (in `Minuteria`, testa di `public/app.js`) gestisce il 401 delle chiamate `/api` tornando
  al login; i pulsanti disabilitati dall'anti-doppio-invio si riattivano se la pagina riappare da "indietro"
  (`pageshow`, bfcache); il blocco "Consegna in cantiere" non va più in errore (e non ferma lo script) se manca
  un suo elemento. I font di Google si caricano senza bloccare il disegno (`media="print"` + `onload`).
- **CSS**: `overflow-x: clip` su `body` come rete di sicurezza *in più* delle cause vere (testi lunghi senza spazi
  con `overflow-wrap: anywhere`; `.carrello-layout > * { min-width: 0 }`; `.art-azioni` che va a capo a 320px;
  appbar a tutta larghezza da ≥720px senza il vecchio `width: 100vw`, che partiva 15px fuori dallo schermo con la
  barra di scorrimento). `.barra-azione` (barra fissa di salvataggio; il banco non la usa più nella pagina cliente) sta **sopra** la navbar (prima la copriva).
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

## App Android e sicurezza (19/10/2026)

Test di sicurezza + correzioni + app Android finita. Il cosa-fare per pubblicare sta in **`mobile/ANDROID.md`**; qui solo ciò che non si deduce dal codice.
- **Come si è provato (rifarlo così, MAI sul DB di produzione)**: Postgres 18 è installato sul PC (utente `postgres`/`postgres`, servizio `postgresql-x64-18`). Si crea un DB usa-e-getta
  (`CREATE DATABASE minuteria_pentest`), `DATABASE_URL=postgres://postgres:postgres@localhost:5432/minuteria_pentest node scripts/apply_schema_pg.js` (col superutente **l'intero schema si applica**,
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
- **Limiti** (`src/limite_login.js`, in memoria): login 8 errori in 10 min per utente+indirizzo **e** 60 per solo indirizzo (password spraying; soglia alta perché un proxy mal configurato fa condividere
  l'indirizzo), registrazioni 12 all'ora per indirizzo (la registrazione è pubblica e approva da sola). Contano sull'indirizzo vero: serve `X-Forwarded-For` dal proxy (README). Intestazioni: CSP
  **senza** `script-src` (le pagine hanno script in linea) ma con `frame-ancestors`, `base-uri`, `object-src`, `form-action`; `Permissions-Policy` (`camera=(), microphone=(), geolocation=(self)`: **la posizione è permessa a questo sito** per il pulsante del carrello, vedi "Posizione"; con `geolocation=()` il browser la bloccava sempre); HSTS solo se `req.secure`. Niente COOP: romperebbe le
  finestre di Google Pay/Link.
- **Da sapere / non toccato**: `db/minuteria.db` (SQLite legacy) è **tracciato in git** nonostante il `.gitignore` (togliere con `git rm --cached`, serve un commit); `xlsx` ha vulnerabilità senza correzione ma
  si usa solo negli script di importazione; `/ordini/:id/consegnato-prova` e la registrazione con approvazione automatica restano (scelte esplicite); `trust proxy` è 1 (un proxy solo).
- **API dell'app** (`src/api_v1.js`, tutta riscritta; provata contro Postgres e Stripe prova): `POST /richieste` e `/richieste/:id/reinvia` con Stripe → `{ pagamento: { id, client_secret, chiave_pubblica,
  importo, modo } }`, la richiesta nasce da `GET /pagamenti/:id` (stessa `stripe_pagamenti.preparaPagina`/`completaRiga` del sito; senza Stripe → `{ id }` come prima); `POST /registrazione` (token subito, errori per
  campo in `errori`), `GET /profilo`, `DELETE /account` (password; `src/account.js`: anonimizza e disattiva, **non** cancella ordini/ricevute/dati dell'impresa; 409 se c'è una richiesta in attesa, un
  ordine non consegnato da meno di 24 h o un pagamento aperto), `POST/DELETE /dispositivi` (token push), `GET /stato-ordini` → `{ attivo, voci }` (tutte le attività, come la striscia del sito),
  `GET /materiale?mese=&vista=` (lo Storico di `materialeOrdini`), `POST /ordini/:id/ricevuta` → indirizzo firmato HMAC di 5 minuti per `GET /ricevute/:id.pdf` (il telefono non può mandare
  `Authorization` quando apre un PDF), `GET /ordini/:id/riordina`; `/ordini/:id` e `/richieste/:id` portano `importi` (consegna/materiale divisi), `stato_pagamento`, `eta_sec`/`durata_sec`/`in_arrivo`,
  righe a prezzo del banco. `POST /ordini/:id/consegnato` usa la conferma provvisoria se l'ordine non è `evaso` (come il sito). Notifiche push: `notifiche.notifica()` chiama `push.inviaAUtente`
  (Expo Push Service, `PUSH_ATTIVO=0` per spegnere); tabella `dispositivi_push` nel blocco "Notifiche push dell'app Android" in fondo a `schema.sql`, **applicato solo al DB locale di prova, NON al
  DB condiviso** (senza, le push restano spente e il server lo scrive una volta nel log).
- **App** (`mobile/`): schermate nuove `registrati`, profilo con anagrafica ed "Elimina account", Storico per mese (`useMateriale`), Stato ordini con striscia per più attività, `componenti/Pagamenti.tsx`
  (stessi quattro stati del sito), carrello con "Paghi ora / Paghi dopo". **Il modulo nativo di Stripe sta in `src/foglioStripe.ts`, con `foglioStripe.web.ts` al suo posto sul web**: un `require`
  in una funzione non basta, Metro lo risolve comunque e il bundle web si rompe. `expo-notifications` si carica con `require` tardivo solo su Android fuori da Expo Go (`src/notifiche.ts`). Il plugin
  `@stripe/stripe-react-native` **vuole un oggetto di opzioni** (senza, `expo config` va in errore). `eas.json` ha il segnaposto `https://INSERISCI-IL-DOMINIO.invalid`: l'app installata mostra "App non
  configurata" finché non si scrive il dominio (`erroreConfigurazione` in `src/api.ts`). Icone e avvio sono segnaposto generati da `scripts/genera_icone_android.js`.
- **Verifiche dell'app**: `node node_modules/typescript/bin/tsc --noEmit` in `mobile/` (**non** `npx tsc`: in `mobile/` pesca un pacchetto sbagliato), `npx expo export --platform android` (bundle Hermes),
  `npx expo prebuild --platform android --no-install` (poi cancellare `mobile/android` e rimettere gli script `android`/`ios` di `package.json`, che prebuild cambia in `expo run:*`), `npx expo-doctor`.
  `expo lint` ha ancora 6 errori **già presenti** (ref/`Date.now` in render, `setState` in un effect, un apostrofo). Nel browser incorporato i clic reali a volte non arrivano a un `Pressable` dentro il
  carrello (tastiera/focus del campo nota): `elemento.click()` da `javascript_tool` sì; lo screenshot esce troncato a destra a larghezze da telefono (artefatto).
- **Non verificato** (niente telefono né SDK Android qui): il foglio di Stripe e Google Pay su un dispositivo vero, la ricezione delle push (serve `google-services.json` + chiave FCM v1 su EAS), la
  compilazione Gradle (la fa EAS). Il testo di `/privacy` e `/elimina-account` (`src/testi_legali.js`) è una **bozza** da far rileggere. Il nome del pacchetto `it.minuteria.ordini` è una scelta mia da
  confermare prima della prima pubblicazione (poi non si cambia).

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
