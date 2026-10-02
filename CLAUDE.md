# CLAUDE.md — contesto di lavoro per Claude

Orientamento rapido dopo un reset di contesto. Flusso completo in **README.md**, cosa manca
in **SCOPE.md**, punti aperti lato banco in **AUDIT_DISTRIBUTORE.md**. Qui solo ciò che non sta
già scritto lì.

## Stack e ambiente

- Node/Express + EJS, niente build, JS vanilla in `public/app.js`.
- DB: `db/index.js` sceglie Postgres se c'è `DATABASE_URL`, altrimenti SQLite — **in pratica
  gira solo su Postgres** (sintassi diretta in `server.js`/`src/*.js`). SQLite è legacy/rotto.
- **Produzione: una VPS** (`npm start`), stesso Supabase. `.env` non è in git: sulla VPS va creato a
  mano (`DATABASE_URL`, `SESSION_SECRET`, `PORT` facoltativa, default 3000). Dopo un `git pull` serve
  `npm ci` (senza, manca `compression` e il server non parte) e il riavvio. `npm install` non lancia
  il seed: `npm run seed` è manuale, **riscrive le password demo** e riattiva i banchi disattivati.
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
- Coordinate (da Nominatim/OpenStreetMap): Fegino = civico 1/7 rosso di Via Castel Morrone;
  Staglieno **approssimata** sul civico 9 (l'11R non è in OSM). Stanno in `distributors.geo_*` e in
  `store_locations` (una riga per filiale: la legge la pagina `/punti-vendita` e, per prima, la
  stima di partenza in `src/consegna.js`). Prima `geo.salvaPosizione` sovrascriveva
  `distributors.geo_*` con la posizione live di un dipendente: provando i login dal PC le filiali
  finivano nello stesso punto, a km dall'indirizzo. Ora la posizione del dispositivo non si raccoglie
  più (rimossi routes, box e codice del browser): se `distributors.geo_*` non coincide con
  `store_locations`, riallinearlo da lì.
- **Da decidere**: con "ritiro al banco" il cliente non sa in quale filiale ritirare (la filiale è
  nascosta); la pagina mappa mostra invece "Borea · Fegino" e "Borea · Staglieno"; manca un ruolo di
  responsabile che veda gli ordini di tutte le filiali.

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

## Richieste e ordini

- Zona non filtra più i distributori candidati (`distributoriCandidati` in `src/richieste.js`
  ignora il parametro `zona`): campo residuo su `distributors`/`users`, non aspettarsi che
  limiti chi riceve una richiesta.
- Il DB ammette **una sola richiesta aperta** (`in_attesa`/`con_offerte`) per cliente
  (`idx_requests_cliente_aperta`): negli script di prova chiudere (`flusso.annullaRichiesta`) quella
  precedente prima di crearne un'altra.
- L'ordine automatico (`richieste.impostaAssegnatore`, chiamato da `aggiornaScadenza`) scatta a
  ogni lettura della richiesta, non solo dal `setInterval` di 30 s in fondo a `server.js`. L'assegnatore
  si registra in `src/flusso_cliente.js`: uno script che usa solo `src/richieste.js` non lo ha.
- La risposta del banco (`/distributore/richieste/:id/rispondi`) oggi passa solo `rifiuta`,
  `prezzoRichiesto` e `utenteId`: `rispondi()` supporta ancora `righe`/`sconti`/`scontoCliente`
  (disponibilità parziale, sconto riga per riga) ma nessuna route li usa più — non è codice morto
  da un refuso, è la UI attuale che li ha rimossi.

## Installatori in Via Puggia 22/3 (provvisorio)

Tutti gli installatori sono in Via Puggia 22/3, Genova (`src/sede_installatori.js`, coordinate OSM):
`indirizzo_consegna` + `geo_*` con `geo_consenso = 1`, per chi c'è (`scripts/imposta_installatori_puggia.js`)
e per chi si iscrive (`anagrafiche.iscriviCliente`, il modulo non chiede più l'indirizzo di consegna).
La sede legale resta quella dichiarata. La posizione del dispositivo non si raccoglie: niente
`navigator.geolocation`, niente `/api/posizione`. Quando torneranno gli indirizzi veri togliere i due
punti d'uso.

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
- Dopo il "preso" gli avvisi nel gruppo ("confermato", "ritira al banco", "annullato") sono messaggi
  `esito` accodati da `avvisaOrdine`, `avvisaAnnulloOrdine` e `ritiraRichiesta(..., { motivo })`.
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
- Logica condivisa col sito, non duplicata: tutto il flusso richiesta → offerte → ordine →
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
- Provare richiesta/offerte/ordine **senza** richieste vere (arrivano ai banchi reali): risposte
  finte come sopra. Per provare il resto con il DB: cliente di prova creato in `users` (password
  casuale), richieste con `richieste.creaRichiesta`, poi **cancellare tutto** quello creato
  (richieste, risposte, ordini, notifiche, cliente); le notifiche finiscono agli utenti del banco, che
  ora sono interni. Le credenziali demo del README funzionano ma hanno storico vero.

## Notifiche

Badge "Stato ordini" somma non lette di `ordini`+`richieste`. Ricalcolare **dopo** averle
marcate lette se la route fa render diretto (non redirect), altrimenti resta il valore vecchio.

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
