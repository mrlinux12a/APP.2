# Convenzioni web e audit

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Audit web del 05/10/2026 (convenzioni nate da lì)

Solo sito/PWA (`mobile/` non toccata, schema DB e logica di business invariati). Cosa c'è di nuovo e perché:

- **`src/comune/http.js` e `src/middleware/`** (`errori.js`, `percorso.js`, `corpo.js`, `salva_sessione.js`; separati il 02/11/2026, prima stava tutto in `src/comune/http.js`): tutto il lato HTTP "trasversale", senza DB (quindi si prova con un'app Express vuota).
  `leggiQuery` è il *query parser* dell'app: ogni parametro è **sempre una stringa** (con quello di Express 5
  `?q=a&q=b` dava un array e `(req.query.q || '').trim()` andava in 500). `corpoSempreOggetto` (`middleware/corpo.js`): Express 5 lascia
  `req.body` *undefined* se nessun parser lo legge. `idNumerico` (`middleware/percorso.js`; lo applica `router.param('id', ...)` dentro `creaRouter` in `routes/base.js`,
  che usano anche le rotte del banco e quelle dell'API dell'app): un `:id` che non è un intero positivo da int4 è un **404**, non una query che
  fallisce. `gestoreNonTrovato` + `gestoreErrori` (`middleware/errori.js`) stanno **in fondo a `src/app.js`**: JSON per `/api/...` (forma
  `{ ok: false, errore }`, la legge anche l'app nativa via `errore`), pagina `errore` per il resto, mai lo stack;
  i 4xx del client (JSON malformato, 413) tengono il loro codice; se la pagina di errore non si disegna c'è una
  pagina di ripiego inline.
- **`src/middleware/auth.js`**: sessione scaduta su `/api/...` → **401 JSON** (prima un redirect alla pagina di login HTML,
  che faceva fallire `.json()` nel browser); ruolo sbagliato → pagina `errore` 403 (o JSON).
- **`src/comune/input.js`**: `leggiId`, `leggiQuantita`, `QUANTITA_MASSIMA = 9999` (tetto per riga di carrello; anche
  `max="9999"` nei campi e `assets/js`: i tre devono restare uguali). Usati dalle route del carrello, da
  `flusso.righeDaQuantita` e dalla registrazione. `righeCarrello` toglie dal carrello di sessione gli articoli non
  più attivi (prima il pallino li contava senza che la pagina li mostrasse); `/api/carrello/imposta` con un id
  inesistente risponde 404.
- **Accesso**: `src/logica/account/password.js` (`passwordValida`: bcrypt asincrono, confronto con hash fittizio se l'utente non
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
- **Redirect dopo una scrittura in sessione** (`src/middleware/salva_sessione.js`, `salvaSessionePrimaDelRedirect`, montato subito dopo
  `session()`): express-session manda intestazioni e quasi tutto il corpo e **solo dopo** scrive la sessione nel DB.
  Un JSON lo si legge intero, un redirect il browser lo segue appena ha le intestazioni: la pagina di arrivo leggeva la
  sessione vecchia ("Svuota carrello" → home col carrello ancora pieno, 6 volte su 12 sul DB vero; stesso rischio per
  "Riordina", per l'invio della richiesta e per l'avviso del carrello). Il middleware avvolge `res.redirect`: se la
  route ha cambiato la sessione (confronto con l'inizio richiesta, cookie escluso) la salva prima di rispondere.
  Non togliere `req.session.save` da `avviaSessione`; per nuove route con `req.session.x = ...; res.redirect(...)`
  non serve fare altro. Prova: `test/middleware/sessione_redirect.test.js` (archivio lento).
- **Ricerca e scroll infinito** (categoria, `app.js`, oggetto `scorrimento`): durante una ricerca lo scroll infinito sta
  fermo (prima accodava ai risultati le pagine successive della sottocategoria: 2 risultati diventavano 37), e svuotando
  il campo riparte dalla pagina con cui la pagina era stata disegnata, senza far ricomparire i pulsanti di pagina. Una
  pagina richiesta prima della ricerca e arrivata dopo si scarta (`generazione`). Aperta una pagina con `?q=` (invio
  dalla tastiera) svuotare il campo rimette ancora i risultati di quella `q`, non l'elenco: non toccato.
- **Pagine rimostrate dal tasto "indietro" (bfcache)**: lo stato della barra in basso (`partials/cliente/nav_ordini.ejs`) si
  rilegge a `pageshow` persisted e quando la scheda torna visibile, invece di aspettare il timer (un minuto in
  consegna: con un ordine in consegna e una nuova richiesta in attesa restava "In consegna"); il carrello di home,
  ricerca, marchio e "con foto" si rilegge da `/api/carrello` (le pagine categoria già lo facevano). Un pannello
  del browser incorporato nascosto non esegue IntersectionObserver né rAF: per provare scroll e simili serve
  `tabs_select` e uno screenshot (anche se scade) prima dello script.
- **`app.js` e `style.css` sono composti (02/11/2026, riordino «Fase 4»)**: non esistono come file interi. Si scrivono a pezzi, uno per argomento, in
  `assets/js/NN_nome.js` e `assets/css/NN_nome.css`; `src/comune/asset_composti.js` li riunisce in ordine di nome (il numero è l'ordine: nel CSS conta, nel JS
  è l'ordine in cui partono i blocchi) e `src/middleware/file_statici.js` li serve come `/app.js` e `/style.css`, con ETag, `Last-Modified` e risposta 304 come
  un file vero. Il browser fa quindi **una richiesta sola** per ognuno (scelta voluta: su una rete da cantiere le richieste in più pesano), e il testo che
  riceve è identico a quello del file intero di prima (controllato byte per byte alla divisione). Nessuna compilazione: si modifica un pezzo e basta (la
  versione `?v=` è la modifica più recente fra i pezzi). Per aggiungere un pezzo dagli il numero giusto; uno nuovo in mezzo costringe a rinumerare quelli
  dopo (lo controlla `test/comune/asset_composti.test.js`, che verifica anche che ogni pezzo sia completo da solo: sintassi valida per il JS, graffe chiuse per il CSS).
  Per trovare un blocco basta cercare il suo titolo (es. «Avvisi del banco») dentro `assets/`.
- **Cache degli asset**: `app.locals.asset('/style.css')` → `/style.css?v=<mtime>` (riletto ogni 5 s); gli URL con
  `?v=` e solo i file dell'elenco `ASSET_VERSIONATI` (`src/middleware/file_statici.js`: `style.css`, `app.js`, `mappa.js`, `pagamento.js`, `landing.css`, `landing.js`) escono con `Cache-Control: public, max-age=31536000, immutable`.
  Un asset nuovo con `asset(...)` va aggiunto a quell'elenco, altrimenti resta sul solo ETag.
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
  **segnaposto**, rigenerabili con `node scripts/genera/genera_icone_pwa.js`; manca ancora il logo vero.
  **`start_url` è `/login`, non `/`** (6/11/2026): `/` per chi non è collegato è la landing pubblica (vedi docs/landing.md), e chi apre l'app installata deve trovare l'accesso; chi ha già una sessione da `/login` viene rimandato alla sua pagina (un rimando in più, invisibile). `id` e `scope` restano `/` (l'identità dell'app installata non cambia).
  **Installare dal telefono (20/10/2026, richiesta "web app per mobile")**: il manifest ha `id`, `orientation: portrait`, `categories`; `partials/comune/installa.ejs`
  (nella home, compatta con la × "Non ora" per 30 giorni in `localStorage`, e nella scheda **"Sul telefono"** del profilo, sempre disponibile) è
  nascosta e il blocco "Installa l'app" di `app.js` la mostra solo con `beforeinstallprompt` (Chrome/Edge/Samsung, HTTPS) o, su iPhone/iPad con Safari,
  con la spiegazione "Condividi → Aggiungi alla schermata Home"; mai se è già aperta da installata. Nella scheda "Sul telefono" c'è anche "Avvisi sul telefono"
  (`[data-abilita-notifiche]`, che prima non stava in nessuna vista): chiede il permesso del browser **e iscrive il browser alle push (dal 21/10/2026: avvisi anche ad app chiusa, vedi "Notifiche ad app chiusa" qui sotto)**; senza push gli avvisi arrivano solo finché l'app è aperta
  (controllo ogni 5 s **solo mentre c'è una richiesta in attesa** (icona in fase `richiesta`) più un ultimo giro a richiesta finita, mai a riposo; **21/10/2026**: all'attivazione `POST /api/notifiche/attiva` segna come già viste tutte le notifiche esistenti, e `GET /api/notifiche/push` per cliente e agente restituisce solo quelle degli ultimi 10 minuti (`daMostrare(id, { massimoEtaSec: 600 })`; le più vecchie si segnano e non arrivano): prima, attivando il permesso, arrivavano tutte quelle mai "mostrate", anche di giorni prima. Le notifiche hanno `silent: false`, `vibrate`, `renotify` e, per l'installatore, **nessun suono del sito** (dal 21/10/2026 solo il suono di sistema, e solo con l'app in secondo piano o chiusa); il suono di sistema vero lo decide il telefono e **non si può forzare da una pagina**): **la rete di sicurezza**: le push vere (Web Push) sono la via principale, vedi "Notifiche ad app chiusa". Prove: `test/sito/sw.test.js` (il
  service worker in un contesto isolato con `caches`/`fetch` finti: il pannello browser incorporato non registra service worker, quindi **cache offline e
  installazione vera non sono provate su un telefono**) e due test in `test/sito/*.test.js`.
- **Browser**: `leggiJson` (in `Minuteria`, testa di `assets/js`) gestisce il 401 delle chiamate `/api` tornando
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
- **Prove**: `npm test` (`node:test`, nessuna dipendenza). I file di `test/sito/` (uno per argomento, ognuno con la sua porta, perché girano in parallelo) avviano il vero `server.js` con un DB
  finto in memoria, preparato in `test/sito/_aiuti/server_finto.js` (sostituisce `db/index.js` nella cache dei moduli *prima* di caricarlo: non apre mai
  connessioni a Postgres); `test/middleware/http.test.js` prova `src/comune/http.js`, i middleware (`errori`, `percorso`, `corpo`, `auth`) e `input.js`; `test/sito/sw.test.js` esegue
  `public/sw.js` in un contesto isolato. Il pannello browser incorporato non registra service worker (nemmeno uno
  banale), quindi `sw.js` si prova solo lì e in un browser vero su HTTPS. **Prove lanciate subito dopo la mezzanotte di Roma** (visto il 22/10/2026 alle 00:01, poi tutto verde alle 00:22): le fixture con istanti
  "fa N minuti" (`fa(60000)` dell'ordine 1295, `preparaRichiesta({ trascorsi })`, `ritiroTra`) e frasi con «oggi» possono cadere nel giorno prima e far fallire "banco: pagina dell'ordine a due colonne…" per i primi ~15 minuti del giorno: non è un
  difetto del prodotto, basta rilanciare. Nelle prove le date a N giorni si calcolano **sul calendario** (`Date.UTC(anno, mese, giorno + N)`), mai come `Date.now() + N × 86400000`: col cambio d'ora legale di mezzo (ultima domenica di ottobre e di marzo) "+8 giorni" cade 7 giorni dopo
  se si è appena passata la mezzanotte (era il caso di `test/pagamenti/pricing.test.js`, sistemato).
- Resta da decidere/fare (non toccato): l'avvio crea i dati con `db/seed` se `products` è vuota (rischioso in
  produzione se il catalogo viene svuotato durante un reimport: il seed riscrive le password demo); CSS non più
  usato (`.offerta*`, `.stepper-3`, `.card-richiesta*`, `.tessera-marchio`...). Il 24/10/2026 sono state tolte le funzioni
  senza chiamanti (`anagrafiche.distributoriApprovati`/`salvaRegola`/`scontoEffettivo`, `catalogo.misureDisponibili`, `notifiche.spostaInOrdini`/`aggiornaStatoOrdine`, `pricing.prezzoCliente*`, `format.oraSola`,
  le funzioni di `limite_login` non più usate, 5 icone), il partial dello storico sconti (`riga_sconti.ejs`, con il suo CSS e script) e `anagrafica_cliente.ejs`.
