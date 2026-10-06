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
- Una richiesta parte verso **ogni filiale** attiva con `ricezione_attiva` (una riga di
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
- **Stato ordini** (`attivitaCorrente`): "segna lette" e lettura delle richieste recenti partono
  insieme; le scadenze si aggiornano dopo, così le notifiche che creano restano da leggere.
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
  `profilo-*`, `pp-*`, `avatar-*`): solo per il **cliente**; banco e agente hanno ancora campanella e tendina
  `.menu-account`. Pulsante da 44px col cerchio da 36px con le iniziali (partial unico `partials/iniziali.ejs`,
  usato anche in cima al menu, 48px, e in anagrafica, 56px). Velo e pannello stanno **fuori dall'`<header>`**: l'appbar
  ha z-index 20 e dentro non si potrebbe stare sopra la navbar (25), che il velo deve coprire (velo 30, pannello
  31). Voci: La mia anagrafica, Storico ordini (`/storico`), Esci. **Niente "Notifiche"** (tolta su richiesta
  esplicita del 05/10/2026, non rimetterla): `/notifiche` esiste ancora ma il cliente non ha più un link per
  arrivarci (aprirla segna tutte lette, anche quelle del badge di "Stato ordini"); banco e agente hanno ancora
  campanella e voce nella tendina. Il sottotitolo "referente · cliente di DISTRIBUTORE" viene da `res.locals.profiloCliente`
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
  è `approvato`). **L'approvazione non blocca niente**: un cliente `in_attesa` ordina comunque, e la richiesta va a
  tutti i banchi attivi (vedi README); il banner di `/profilo` ("non inviare richieste") è quindi inesatto.
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
  "Nessun banco ha confermato", rimborso in pillola verde ("€ X rimborsati"; se `pagamento_stato` è ancora
  `pagato` "Rimborso in corso"; senza pagamento niente pillola), un banco per ditta con il suo stato reale.
  Il pulsante è "Rinvia richiesta" (una sola "i", niente "paghi di nuovo €"): l'azione e il pagamento sono
  quelli di prima. La data è `fmt.dataOraRoma(creato_il, ', ')`, in ora italiana. "Eliminare" è un link con la
  stessa conferma.
- **Ordine in consegna** (`views/ordine_dettaglio.ejs`, richiesta esplicita del 04/10/2026; stesse classi
  `att-*` della verifica disponibilità, modificatore `.att-verde`): vale per il cliente con ordine **non
  consegnato** e non "ritiro"; consegnato, ritiro, banco e agente hanno ancora il markup vecchio. L'anello
  parte pieno alla nascita dell'ordine e si svuota fino all'arrivo (`corriere_arrivo_il`, o `creato_il` +
  `consegna_ore`); la barra "In consegna" si riempie all'inverso. Lo muove l'ultimo blocco di `app.js` dai
  numeri su `[data-viaggio]` (`data-durata`, `data-rimanente`, calcolati nella vista), ogni 30 s. **Non
  rinominarlo `[data-consegna]`**: è la scheda "Consegna in cantiere" del carrello e il suo blocco in `app.js`
  va in errore, fermando tutto lo script, se non trova i suoi pulsanti. `creato_il`, `pagato_il` e le altre
  colonne `TIMESTAMP` sono ora UTC senza fuso e pg le legge come ora locale (2 h di scarto a Roma, nessuna su
  una VPS in UTC): per confrontarle con `Date.now()` o `corriere_arrivo_il` si usa `fmt.istanteUtc`, per
  mostrarle in ora italiana `fmt.dataOraRoma` (`fmt.dataOra` stampa l'ora UTC così com'è). Titolo = tempo
  stimato reale ("Arriva entro 6 ore", o "entro le HH:MM" col corriere); "Te lo porta" = `corriere_nome`, se
  vuoto il nome del banco.
- **Icona "Stato ordini"** (`views/partials/nav_ordini.ejs`): fase calcolata da
  `flusso.statoIconaOrdini` (sola lettura, non segna le notifiche come lette) nel `Promise.all` del
  middleware di `server.js`, per ogni pagina del cliente. Un errore non rompe la pagina ma si scrive nel
  log come `[nav] ...` (ingoiarlo in silenzio lasciava l'icona sempre uguale: così si è scoperto che
  `format.toDate` non era esportata). `/nav/stato-ordini` rende solo il link (con `?scheda=1`, dalla home,
  anche la scheda di `partials/stato_home.ejs`), per il polling dello script inline (15 s in attesa, 60 s
  in consegna). **Un solo timer** per icona e scheda: muove ogni `[data-countdown]` e `[data-arco]`
  (con `data-circ`) della pagina. La barra "in consegna" sta **ferma a metà** (`PROGRESSO_IN_VIAGGIO`
  in `flusso_cliente.js`) e arriverà a "Consegnato" solo con l'evento di consegna, **ancora da collegare**.
  Nel frattempo c'è un pulsante **provvisorio** "Ordine consegnato" (`POST /ordini/:id/consegnato-prova` →
  `flusso.segnaConsegnatoProva`, scrive `consegnato_il` per qualunque stato dell'ordine, quindi la scheda
  sparisce): sta **solo nella pagina dell'ordine** (`ordine_dettaglio.ejs`, "Stato ordini"; con l'ordine
  `evaso` vale invece la rotta vera `/consegnato`), **non** nella scheda della home, dove "Consegnato" è
  un'etichetta non cliccabile (richiesta esplicita del 05/10/2026, non rimetterlo). La rotta accetta un campo
  `ritorno` (solo `/ordini/<numero>`) per riportare sull'ordine; senza va in home. Da togliere insieme alla
  rotta quando c'è l'evento vero.
- **Home installatore** (`views/home.ejs`): ricerca fissa (`.ricerca-fissa`, `top` = `--altezza-appbar`,
  52px), un'unica griglia compatta di categorie senza conteggi, pulsante "foto/codice a barre" **volutamente
  disabilitato** (funzione non ancora esistente). I nomi delle categorie sono quelli del DB, più lunghi di
  quelli del mockup. Le tessere (ingrandite il 05/10/2026, richiesta esplicita) sono **in colonna**: icona
  52px sopra, nome sotto a 15px, alte almeno 128px. Con il nome accanto all'icona, a questa grandezza
  restavano ~85px di testo e "Condizionamento" non ci stava. Il nome può andare su **tre righe**, così
  nessuno finisce in ellissi; `Condizionamento…` ha il corpo ridotto (14px; 13px sotto i 360px di schermo,
  12px sotto i 330px: la parola misura 139px a 15px e il testo ne ha 143 a 375px, 117 a 320px).
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
- Il DB ammette **una sola richiesta aperta** (`in_attesa`/`con_offerte`) per cliente
  (`idx_requests_cliente_aperta`): negli script di prova chiudere (`flusso.annullaRichiesta`) quella
  precedente prima di crearne un'altra.
- **Dal 04/10/2026 l'installatore paga alla richiesta e non sceglie più l'offerta.** Niente più
  "riepilogo / Invia l'ordine", finestra di scelta, assegnatore a tolleranza, ritiro al banco: l'ordine
  nasce da solo (`richieste.assegnaOrdine` → `flusso_cliente.creaOrdineDaRisposta`) quando una risposta
  del banco è valida (`OFFERTA_VISIBILE`: senza corriere, o con `corriere_stato = 'preso'`), cioè subito
  dopo `rispondi()` a modulo spento e subito dopo `corriereHaPreso()` con WhatsApp. Se la creazione
  fallisce la riprova `aggiornaScadenzeAperte` (timer di 30 s, **non** la lettura della richiesta:
  `aggiornaScadenza` ora chiude solo le finestre). L'assegnatore si registra in `src/flusso_cliente.js`:
  uno script che usa solo `src/richieste.js` non lo ha (anche `scripts/prova_whatsapp.js` lo importa).
  Destinazione e note stanno sulla richiesta (`requests.destinazione/note`, scritte dal carrello).
- **Pagamento SIMULATO** (`src/pagamenti.js`): `requests.pagamento_stato` NULL = vecchio flusso,
  `pagato`, `rimborsato`; importo = `totali.totale_ivato` del carrello (spedizione fissa inclusa).
  Rimborso quando la richiesta si chiude senza ordine (finestra scaduta, tutti rifiutano, annullo, ordine
  annullato); "Rinvia" lo riaddebita. Provider vero = cambiare solo quel file.
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

## Installatori in Via Puggia 22/3 (provvisorio)

Tutti gli installatori sono in Via Puggia 22/3, Genova (`src/sede_installatori.js`, vedi README,
"Posizione"): `indirizzo_consegna` + `geo_*` con `geo_consenso = 1`, impostati da
`scripts/imposta_installatori_puggia.js` e da `anagrafiche.iscriviCliente`. La sede legale resta quella
dichiarata. Niente `navigator.geolocation` né `/api/posizione`. Quando torneranno gli indirizzi veri
togliere i due punti d'uso.

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
