# CLAUDE.md — contesto di lavoro per Claude

Orientamento rapido dopo un reset di contesto. Flusso completo in **README.md**, cosa manca
in **SCOPE.md**. Qui solo ciò che non sta già scritto lì.

## Stack e ambiente

- Node/Express + EJS, niente build, JS vanilla in `public/app.js`.
- DB: `db/index.js` sceglie Postgres se c'è `DATABASE_URL`, altrimenti SQLite — **in pratica
  gira solo su Postgres** (sintassi diretta in `server.js`/`src/*.js`). SQLite è legacy/rotto.
- **Produzione: una VPS** (`npm start`; non più Vercel), stesso Supabase. `.env` non è in git: sulla
  VPS va creato a mano (`DATABASE_URL`, `SESSION_SECRET`, `PORT` facoltativa, default 3000). Dopo
  un `git pull` serve `npm ci` (senza, manca `compression` e il server non parte) e il riavvio.
  `npm install` non lancia più il seed: `npm run seed` è manuale e **riscrive le password demo**.
- `.env` locale punta al **Supabase di produzione condiviso**, nessun DB di test — girare in
  locale scrive sul DB vero, e il server locale esegue anche il timer delle scadenze (30 s) come
  la VPS: fermarlo quando non serve.
- Server locale **senza auto-reload**: dopo modifiche a `server.js`/file `require`-ati serve
  riavvio manuale (`.ejs`/`public/*` no).
- Modifiche schema in **entrambi** `db/postgres/schema.sql` e `db/schema.pg.sql` (root, copie
  identiche), poi `node scripts/apply_schema_pg.js` (transazione unica: un pezzo fallito annulla
  tutto).
- Mai `pool.on('connect', async ...)`: causa query concorrenti sullo stesso client.

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

## Aspetto grafico

Stile "Cantiere Notte" (scuro/ambra) + modalità chiara vera (`data-tema` su `<html>`,
`localStorage('tema')`). Icone SVG in `src/icone.js` (13 icone categoria provvisorie). Variabili CSS
in cima a `public/style.css`. DDT resta bianca (stampa).
- Testo sopra l'accento = `var(--su-blu)` (scuro sull'ambra, bianco sul blu): `#fff` sull'ambra dà
  contrasto 2:1. Nel tema chiaro verde/arancio/rosso sono scuriti per portare i badge a 4.5:1
  (stessi valori in `mobile/src/tema.tsx`).
- I `<button>` non ereditano il font (`button { font-family: inherit }`); campi input ≥16px, sotto
  Safari iPhone ingrandisce la pagina al tocco.
- Quirk mobile da non reintrodurre: `autocomplete/autocorrect/autocapitalize="off"` sui campi
  ricerca; ripristino focus dopo il redraw risultati (altrimenti la tastiera si chiude); tutte le
  barre di ricerca usano lo stesso `[data-ricerca]`, mai una navigazione mentre si scrive.

## Richieste e ordini

- Zona non filtra più i distributori candidati (`distributoriCandidati` in `src/richieste.js`
  ignora il parametro `zona`): campo residuo su `distributors`/`users`, non aspettarsi che
  limiti chi riceve una richiesta.
- L'ordine automatico (`richieste.impostaAssegnatore`, chiamato da `aggiornaScadenza`) scatta a
  ogni lettura della richiesta, non solo dal `setInterval` di 30 s in fondo a `server.js`: il sito
  ha girato su Vercel, dove quel timer non gira tra una richiesta e l'altra. L'assegnatore si
  registra in `src/flusso_cliente.js`: uno script che usa solo `src/richieste.js` non lo ha.
- La risposta del banco (`/distributore/richieste/:id/rispondi`) oggi passa solo `rifiuta` e
  `prezzoRichiesto`: `rispondi()` supporta ancora `righe`/`sconti`/`scontoCliente` (disponibilità
  parziale, sconto riga per riga) ma nessuna route li usa più — non è codice morto da un refuso,
  è la UI attuale che li ha rimossi.

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
  interruttore; `useTema()` restituisce solo `{ c }`); titoli delle barre a 17px (`STILE_TITOLO`,
  come `.appbar .titolo`: senza dimensione Android usa 20); prezzo sempre in fondo alla card e
  centrato sullo stepper; 2 misure affiancate su una riga, da 3 tendina; nome in Sora 600 come sul
  sito; righe dentro una card dello stesso colore del riquadro foto.
- Categorie e sottocategorie si aprono già piene: `usePrecaricaCatalogo` e
  `usePrecaricaSottocategorie` (`src/dati.ts`) leggono in background dettagli e prima pagina con le
  prime foto, 3 richieste alla volta, con le stesse opzioni delle query (stessa chiave → stessa
  cache). Il titolo dell'header arriva nel parametro `titolo` di `router.push`: cambiarlo dopo il
  caricamento ridisegna l'header a metà transizione. Non tornare a spinner + due richieste in fila.
- Avvio: la sessione si ripristina **senza aspettare la rete** (`src/sessione.tsx`): utente salvato
  in SecureStore insieme al token, `/me` verifica in background (401 → esce, rete assente → resta
  dentro).
- Niente schermate intermedie sbagliate nei passaggi (lampi segnalati dall'utente): il carrello si
  svuota solo **dopo** aver lasciato la scheda (prima compariva "Carrello vuoto / Vai al catalogo"
  mentre si aspettava "Stato ordini"); annullare/eliminare un ordine o una richiesta aggiorna
  `['stato-ordini']` (con `refetchType: 'all'`, la scheda sta sotto, non in primo piano) **prima** di
  uscire e non rilegge l'elemento tolto (404 → "non trovato"). Dopo un annullamento "Stato ordini"
  resta su "Nessun ordine in corso" (richiesta esplicita) finché non si lascia la scheda: altrimenti
  passava all'attività successiva per priorità, anche un ordine di ieri ancora aperto (entro 24 h),
  in verde, che sembrava la richiesta appena annullata "confermata" (`quandoChiusa`).
- **Barra del titolo**: una sola per tutte le schermate, `src/componenti/BarraTitolo.tsx` (opzione
  `header: intestazione` in pile e schede). La barra nativa delle pile era più alta di quella JS del
  Carrello su telefono (sul web non si vede: lì sono entrambe JS), e cambiare il font non serviva.
  Altezza 44 iOS / 64 Android + barra di stato, come la vecchia barra del Carrello: per
  cambiarla si tocca solo quel file. Non rimettere `headerStyle`/`headerTitleStyle` nelle pile.
- Tastiera Android: `KeyboardAvoidingView behavior={undefined}` è la scelta raccomandata dalla
  guida Expo, non cambiarla; con le schede in basso serve `tabBarHideOnKeyboard`.
- `icon.png` e `splash-icon.png` sono ancora i segnaposto di Expo: senza un logo vero la splash
  nativa non è configurata.
- Marchi assenti dall'app: `/marchi` non è linkato e nessun marchio è attivo.
- `mobile/src/icone.ts` è **generato** da `src/icone.js` (`node scripts/genera_icone_app.js`).
- Verifica: `npx tsc --noEmit` in `mobile/`; anteprima nel browser con la config `app-web` di
  `.claude/launch.json` (serve anche il server su :3000). Nel pannello browser nascosto clic e
  scroll non arrivano: leggere lo stato con `javascript_tool`. Il `popstate` sintetico rimonta
  `SessioneProvider` e azzera la cache: per provare il precaricamento ricaricare la pagina e
  cliccare gli elementi.
- Provare richiesta/offerte/ordine **senza** creare richieste vere (arrivano ai banchi reali):
  sostituire `window.fetch` con risposte catturate dall'API su richieste esistenti e navigare con
  `history.pushState` + evento `popstate`. Per provare il resto: utente di prova creato
  direttamente in `users` (password casuale, nessuna notifica ai banchi) e poi cancellato; le
  credenziali demo del README funzionano ma hanno storico vero.

## Notifiche

Badge "Stato ordini" somma non lette di `ordini`+`richieste`. Ricalcolare **dopo** averle
marcate lette se la route fa render diretto (non redirect), altrimenti resta il valore vecchio.

## File temporanei

Script una tantum nello scratchpad di sessione o in root con prefisso `_tmp_` (mai in git) —
cancellarli dopo l'uso.
