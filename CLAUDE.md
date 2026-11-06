# CLAUDE.md — contesto di lavoro per Claude

Orientamento rapido dopo un reset di contesto. Qui c'è solo ciò che serve **sempre**: dove trovare cosa, la struttura delle cartelle, lo stack e l'ambiente.
Tutto il resto è diviso per argomento in **`docs/`**: prima di toccare una parte del sistema, leggi il suo file (tabella sotto). Come si avvia e si mette in produzione il progetto: **README.md**.

## Dove trovare cosa

Leggi il file **prima** di modificare quella parte: ogni file porta le scelte esplicite dell'utente ("non rimetterlo"), i motivi e come è stato provato.

| Argomento | File | Cosa contiene |
|---|---|---|
| Ditte, filiali, ritiro provvisorio | [docs/ditte-e-filiali.md](docs/ditte-e-filiali.md) | Borea e le sue filiali, chi vede cosa, prezzi uguali, ritiro provvisorio a Enoteca Squillari |
| Catalogo e ricerca | [docs/catalogo-e-ricerca.md](docs/catalogo-e-ricerca.md) | prodotti, `misura`, ricerca parziale con refusi, singolare/plurale, limite risultati |
| Velocità | [docs/velocita.md](docs/velocita.md) | cache, connessioni, query in parallelo, ricerca veloce/lenta, elenchi paginati |
| Aspetto grafico del sito | [docs/aspetto-grafico.md](docs/aspetto-grafico.md) | solo tema chiaro, carrello, righe compatte, varianti, profilo, accedi/registrati, storico, ordine in consegna, home |
| Richieste, ordini, Stato ordini | [docs/richieste-e-ordini.md](docs/richieste-e-ordini.md) | ciclo richiesta → ordine, pagamento alla richiesta, più ordini insieme, icona e striscia di "Stato ordini" |
| Pagamenti | [docs/pagamenti.md](docs/pagamenti.md) | Stripe (reale e sandbox), importo di prova, stati, ricevute, email, annullamento |
| Posizione, tragitto, orari del corriere | [docs/posizione-e-consegna.md](docs/posizione-e-consegna.md) | indirizzo di consegna, sede provvisoria Via Puggia, tragitto sulla mappa, ritiro del corriere |
| Landing pubblica (`/` senza accesso) | [docs/landing.md](docs/landing.md) | pagina di presentazione con la simulazione dell'ordine, Accedi/Registrati, adattamento al telefono, `start_url` della PWA; **il nome del servizio è "Flash Delivery"** (ex "Ordini Minuteria") e cosa NON va rinominato (sezione «Il nome») |
| Account dell'installatore | [docs/account-installatore.md](docs/account-installatore.md) | password dimenticata, cambio password, elimina account |
| Notifiche | [docs/notifiche.md](docs/notifiche.md) | notifiche in-app e Web Push ad app chiusa |
| Gruppo WhatsApp dei corrieri | [docs/whatsapp.md](docs/whatsapp.md) | `src/logica/whatsapp/whatsapp.js`, sondaggi, "preso", istanza proprietaria |
| App nativa e Android | [docs/app-nativa.md](docs/app-nativa.md) | `mobile/`, API `/api/v1`, pagamento nell'app, test di sicurezza |
| App dei corrieri | [docs/app-corrieri.md](docs/app-corrieri.md) | ruoli `corriere` e `supervisore_corrieri`, `corriere_id`, utente di prova, script per crearne, accesso e registrazione del corriere (solo nell'app, con l'email; il sito li rifiuta), cosa manca per sostituire WhatsApp |
| Convenzioni web e audit | [docs/convenzioni-web-e-audit.md](docs/convenzioni-web-e-audit.md) | `src/comune/http.js`, `src/middleware/errori.js`, input, accesso, fusi orari, cache degli asset, PWA, CSS, come si provano le cose |
| Banco: home | [docs/banco/home-e-aggiornamento.md](docs/banco/home-e-aggiornamento.md) | bacheca a 3 colonne, aggiornamento automatico |
| Banco: richiesta e ordine | [docs/banco/richiesta-e-ordine.md](docs/banco/richiesta-e-ordine.md) | dettaglio richiesta, pagina dell'ordine (da preparare / in consegna / consegnato) |
| Banco: storico e clienti | [docs/banco/storico-e-clienti.md](docs/banco/storico-e-clienti.md) | Storico ordini, elenco clienti, pagina del cliente approvato |
| Banco: anagrafica e orari | [docs/banco/anagrafica-e-orari.md](docs/banco/anagrafica-e-orari.md) | Anagrafica del banco, orari, carrello fuori orario |
| Banco: avvisi, suono, tempo reale | [docs/banco/avvisi.md](docs/banco/avvisi.md) | avvisi fuori dalla home, suono, notifiche del computer |
| Cosa c'è dentro e fuori | [docs/SCOPE.md](docs/SCOPE.md) | perimetro del progetto |
| Punti aperti lato banco | [docs/AUDIT_DISTRIBUTORE.md](docs/AUDIT_DISTRIBUTORE.md) | audit del banco, solo ciò che è ancora vero |
| Messa in funzione di Stripe e WhatsApp | [docs/guide/stripe-setup.md](docs/guide/stripe-setup.md), [docs/guide/whatsapp-setup.md](docs/guide/whatsapp-setup.md) | chiavi, webhook, variabili del `.env`, prova |
| Mockup e prompt | `docs/mockup/`, [docs/PROMPT_RIPRISTINO_PAGAMENTO_PROVA.md](docs/PROMPT_RIPRISTINO_PAGAMENTO_PROVA.md) | immagini di riferimento; come togliere l'importo di prova |

Le sezioni si richiamano per **nome** ("vedi «Posizione»", "vedi «Pagamento»"): il nome è il titolo `##` dentro il file indicato qui sopra. Dove un testo dice "qui sopra" o "qui sotto" parla delle sezioni vicine, che ora possono stare nello stesso file o in uno accanto.

## Struttura delle cartelle

```
server.js        avvio: ambiente, database, app, cicli di vita (l'app Express si compone in src/app.js)
src/config/      ambiente, viste, soglie dei limiti e della bacheca
src/middleware/  un file per ogni passo dell'app (sicurezza, limiti, sessione, corpo, origine, auth, errori, percorso...)
src/routes/      solo HTTP (nessuna query SQL: stanno tutte in logica/): una cartella per interfaccia, routes/cliente/ (pagine e API dell'installatore) e routes/banco/ (pagine del banco), più routes/api_v1/ (API dell'app); fuori dalle cartelle i file usati da più ruoli (autenticazione, notifiche, eventi, webhook_stripe) e agente
src/logica/      la logica di business, una cartella per area: account/ · banco/ · catalogo/ · notifiche/ · ordini/ (flusso_cliente, richieste, consegna...) · pagamenti/ (pricing, Stripe...) · whatsapp/
src/comune/      pezzi senza database usati ovunque (format, http, input, memo, icone, testi_legali, url_sito)
src/avvio/       ciò che parte con il server: processo (errori, porta, chiusura), servizi (scadenze, Stripe, WhatsApp), database
db/              index.js (unico accesso a Postgres), resilienza.js, schema.sql, seed.js
scripts/         db/ (schema, config, listini, sottocategorie) · una_tantum/ (migrazioni sul DB condiviso) · genera/ (icone, suono) · setup/ (chiavi VAPID, file Apple Pay) · verifica/ (prove e controlli: `verifica_stripe`, `stato_orari`, `prova_tragitto` solo leggono; `prova_push` e `prova_whatsapp` mandano messaggi veri)
views/           pagine EJS per area: auth/ · cliente/ · banco/ · agente/ · comune/ · partials/<area>/ (gli `include` sono relativi al file che li chiama, es. `../partials/comune/app_head`)
assets/          js/ e css/: i pezzi (numerati, uno per argomento) di app.js e style.css, che il server riunisce in un solo file (src/comune/asset_composti.js)
public/          sw.js, manifest, icone, mappa.js, pagamento.js, landing.css e landing.js (la landing, vedi docs/landing.md), img/, vendor/: file serviti così come sono
test/            node:test (`npm test`): una cartella per area (come src/logica, più middleware/, db/, comune/); sito/ ha un file per argomento che avvia il vero server con un DB finto (preparato in sito/_aiuti/server_finto.js)
mobile/          app React Native / Expo (ha il suo CLAUDE.md)
docs/            questa documentazione, divisa per argomento
backup/          copie di sicurezza degli script una tantum (fuori da git)
```

## Stack e ambiente

- Node/Express + EJS, niente build, JS vanilla in `assets/js` (`/app.js` e `/style.css` sono composti dai pezzi di `assets/js` e `assets/css`: vedi «Cache degli asset» in docs/convenzioni-web-e-audit.md).
- DB: **solo Postgres**, tutto in `db/` (`index.js` = accesso, `resilienza.js`, `schema.sql`, `seed.js`; l'importazione dei listini sta in `scripts/db/importa_listino.js`; la cartella `db/postgres/` e i due file passacarte `db/index.js`/`db/seed.js` di prima non esistono più, spostati il 24/10/2026). SQLite e tutti i suoi file (`db/sqlite/`, `db/minuteria.db`) sono stati eliminati lo stesso giorno.
  Nei testi SQL i valori sono SEMPRE segnaposto `?` (i parametri nominati `@nome` non esistono più), che `db.prepare` traduce in `$1, $2…`: nessun valore entra mai nel testo della query. Le uniche interpolazioni `${}` ammesse sono quelle
  strutturali (nomi di colonne/tabelle fissi, elenchi di segnaposto, costanti numeriche) e stanno tutte in una lista controllata da `test/db/sql_parametri.test.js`: una nuova va aggiunta lì dopo averla verificata.
- **Struttura del server (24/10/2026, refactoring)**: `server.js` è solo l'avvio (config, database, app, cicli di vita). L'app Express si compone in `src/app.js` (`creaApp`) da:
  `src/config/` (ambiente, viste, soglie `limiti`, `bacheca`), `src/middleware/` (sicurezza con **helmet**, **express-rate-limit**, origine, sessione, corpo, compressione, file statici, contesto delle viste),
  `src/routes/` (autenticazione, cliente/ [profilo, catalogo, carrello, richieste, pagamenti, ordini], notifiche, banco/, agente, eventi, webhook_stripe; `index.js`
  li monta nell'ordine giusto; `banco/` ha un file per argomento: avvisi, home, storico, richieste, ordini, anagrafica, clienti; l'API dell'app sta in `routes/api_v1/`, montata da `src/app.js` prima della sessione),
  `src/logica/<area>/` (la logica di business: flusso_cliente, richieste, pricing, catalogo... divise in account, banco, catalogo, notifiche, ordini, pagamenti, whatsapp), `src/comune/` (pezzi senza database: format, http, input, memo, icone...)
  e `src/avvio/` (processo, servizi che partono con il server e preparazione del database). Una route non contiene logica: chiama `src/logica/`. **Nel resto di questo file "`server.js`" indica la route o la funzione che prima stava in quel file: oggi sta in `src/routes/` o `src/logica/` (si trova con `grep`).** Le sezioni «Struttura» di README.md e di questo file sono la mappa aggiornata; i percorsi dei file citati altrove nei `docs/` seguono la stessa mappa.
  Ordine dei middleware da non cambiare: rifiuto di `%00` → sicurezza → compressione → webhook Stripe (corpo grezzo, PRIMA dei parser) → file statici → limite generale → corpo → `/api/v1` (token, senza cookie) →
  controllo origine → sessione → `/api/eventi` → contesto viste → route → 404 → errori. Il router di ogni modulo ripete `router.param('id', idNumerico)` (`app.param` non si eredita).
  Sopra ogni funzione e ogni route c'è un commento in italiano che spiega in parole semplici cosa fa: i nuovi vanno scritti allo stesso modo.
- **Limiti di richieste (express-rate-limit, in memoria per processo)** in `src/config/limiti.js`: generale 1000/min per indirizzo (`LIMITE_RICHIESTE_AL_MINUTO`), accessi falliti (login, registrazione e recupero password, anche dell'app)
  60 ogni 15 min, conta solo i tentativi andati male (`LIMITE_ACCESSI_FALLITI`), ricerche nel catalogo 300/min (`LIMITE_RICERCHE_AL_MINUTO`), indirizzo dalla posizione 30/min (`LIMITE_INDIRIZZI_AL_MINUTO`); variabili tutte facoltative.
  Le soglie sono larghe di proposito (un proxy mal configurato fa condividere l'indirizzo a tutti) e si sommano a `src/logica/account/limite_login.js` (tentativi per utente). Superato il limite: 429 + `Retry-After`, in JSON per `/api`.
  `LIMITE_RICHIESTE_DISATTIVATO=1` spegne tutto **solo per le prove** (`test/sito/_aiuti/server_finto.js` lo imposta); mai sul server vero. Helmet: CSP **senza** `script-src` (le pagine hanno script in linea), niente COOP/CORP/COEP,
  HSTS solo se la richiesta è HTTPS, `Permissions-Policy` con `geolocation=(self)`. Sulla VPS servono `npm ci` (helmet, express-rate-limit) e il riavvio di pm2. Prove: `test/middleware/limiti_richieste.test.js`.
- **Produzione: una VPS** sotto pm2 (processo `minuteria`, vedi README), stesso database del PC (Postgres sul server, **niente Supabase**). `.env` non è in
  git: sulla VPS va creato a mano (`DATABASE_URL`, `SESSION_SECRET`, `PORT` facoltativa, default 3000, più
  le variabili WhatsApp). Dopo un `git pull` serve `npm ci` e il riavvio: due processi pm2 sullo stesso
  `server.js` si contendono la porta e, con WhatsApp acceso, la stessa sessione. `npm run seed` è manuale,
  **riscrive le password demo** e riattiva i banchi disattivati.
- `.env` locale punta al **database di produzione condiviso** (il Postgres sul server, raggiunto con un **tunnel SSH** su `127.0.0.1:5433` che apre l'utente: senza tunnel gli script e il server locale danno `ECONNREFUSED`), nessun DB di test — girare in
  locale scrive sul DB vero, e il server locale esegue anche il timer delle scadenze (30 s) come
  la VPS: fermarlo quando non serve.
- **Rete che blocca il database (eduroam, 16/10/2026)**: dalla Wi-Fi dell'università il TCP verso il database remoto (allora un pooler Supabase, oggi non più usato) si apre (in 50 ms: risponde un
  firewall di mezzo) ma la richiesta SSL di Postgres non riceve mai risposta, su tutti gli IP e su 5432 e 6543 (provato: 0 connessioni su 10).
  **Non si risolve dal codice**: serve l'hotspot del telefono, una VPN o un tunnel SSH. `node scripts/db/diagnosi_rete_db.js` dice a che fase si
  ferma. Il codice però non deve appendersi né riempire il log: `db/resilienza.js` (provato in `test/db/resilienza.test.js`, pool finto)
  riprova la **connessione** (nessuna query è partita: sicuro anche per le scritture) e le **letture** + le istruzioni su `session` se la
  connessione cade a metà, ma **mai una scrittura persa a metà** (potrebbe essere arrivata: si duplicherebbe un ordine o un pagamento) né
  dentro una transazione; dopo 3 fallimenti di rete di fila un interruttore risponde subito per 5 s. A chi chiama arriva
  `ErroreDbNonRaggiungibile` (status 503, `dbNonRaggiungibile`), che `src/middleware/errori.js` mostra come "Servizio non raggiungibile" (pagina o JSON) con
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
- Modifiche schema in `db/schema.sql` (l'unico file di schema: la copia `db/schema.pg.sql` è stata eliminata il 24/10/2026; il file ha fine riga CRLF), poi `node scripts/db/apply_schema_pg.js` (transazione unica:
  un pezzo fallito annulla tutto). **Col ruolo attuale l'intero file non si applica**: `CREATE OR
  REPLACE FUNCTION ricerca_simili` dà "permission denied to set parameter
  pg_trgm.word_similarity_threshold". Per un blocco nuovo: leggere `schema.sql` dal suo commento
  fino in fondo e lanciarlo da solo (è così che si è applicato "Ditte e filiali"): lo fa
  `node scripts/db/applica_blocco_schema.js "<commento d'inizio>" [--applica]` (a secco senza il flag).
- Mai `pool.on('connect', async ...)`: causa query concorrenti sullo stesso client.
- **Finestra di conferma delle richieste: la riga `FINESTRA_CONFERMA_SEC=30` è stata TOLTA dal `.env` del PC il 21/10/2026** (richiesta esplicita: il testo "I banchi rispondono entro N min" in pagamento diceva "1 min", cioè i 30 s arrotondati). Ora vale il DB (10 min) anche sul PC. Quanto segue descrive come si rimette (era: 30 s sul PC, "per adesso", richiesta del 16/10/2026): `FINESTRA_CONFERMA_SEC=30` nel `.env`
  **locale** (non in git) fa leggere a `pricing.getFinestraMinuti` 0,5 minuti invece di `config.finestra_conferma_min` (DB condiviso con la VPS: 10 min,
  **non toccato**, i banchi veri di Borea hanno sempre i loro 10 minuti). Vale solo per l'istanza che ha la riga; all'avvio scrive `[config] FINESTRA_CONFERMA_SEC=...`.
  Per toglierla: via la riga e riavvio. `test/sito/_aiuti/server_finto.js` la svuota prima di caricare `server.js`. **I testi non seguono il timer (21/10/2026, richiesta esplicita: "deve esserci 10, ovunque, anche se per ora il timer è di 1m")**:
  ogni frase che dice quanto tempo hanno i banchi ("entro 10 min" nella scheda della home e in pagamento, "Entro 10 minuti, o ti rimborsiamo" in Stato ordini vuoto, "Nessun distributore ha confermato… entro i 10 minuti", notifiche e errori del banco "Hai 10 minuti per
  confermare", `minuti_risposta` dell'API dell'app) legge `pricing.getFinestraMinutiTesto()` = `finestra_conferma_min` della configurazione (10), **mai** `getFinestraMinuti()`, che resta per timer, anelli, `scade_il` e `finestraSecondi`. Nelle viste il local si chiama `minutiTesto` (non
  `minutiRisposta`); la voce `richiesta` di `statoIconaOrdini` porta `minutiTesto` per la scheda della home. Una frase nuova che nomina la finestra va scritta con quello. Un corriere su WhatsApp avrebbe 30 s per rispondere (la finestra è la stessa): togliere la riga quando si accende WhatsApp in locale.

## Script e file temporanei

- Script usa-e-getta: nello scratchpad di sessione o con prefisso `_tmp_` (il `.gitignore` copre solo `backup/` e `_tmp_backup_*.json`, **non** gli altri `_tmp_*`: un `git add -A`
  li prenderebbe), da cancellare dopo l'uso. Gli script che restano nel progetto stanno in `scripts/` per tipo (`db/`, `una_tantum/`, `genera/`, `setup/`, `verifica/`).
  Le copie di sicurezza degli script che toccano il DB condiviso vanno in `backup/` (fuori da git; lo script la crea se manca).
- Per parlare col DB da uno script: `require('dotenv').config()` e `pg` con `ssl: {
  rejectUnauthorized: false }`, oppure `require('./db')` per usare i moduli del progetto. Cambi di
  dati sul DB condiviso: prova a secco in transazione con ROLLBACK, poi conferma; copia delle righe
  toccate fuori dal repo.
- Pulire dopo una prova **per id o per link**, non per data: `creato_il` è un `timestamp` UTC senza
  fuso e un `Date` locale di JS lo confronta con 2 ore di scarto (le notifiche ai banchi restavano).
- Una sessione web **resta valida anche dopo `attivo = 0`** (il login controlla `attivo`, la
  sessione no): chi si disattiva va tolto anche dalla tabella `session` (lo fa
  `scripts/una_tantum/imposta_borea_filiali.js`). I token dell'app invece si controllano a ogni richiesta.
