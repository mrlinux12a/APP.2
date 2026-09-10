# CLAUDE.md — contesto di lavoro per Claude

Questo file è per orientarsi velocemente dopo un reset del contesto. Per il funzionamento
completo dell'app (flusso cliente/distributore/agente) vedi **README.md**; per cosa manca
ancora vedi **SCOPE.md**. Qui sotto solo le cose che non stanno già scritte lì: stato attuale,
decisioni tecniche prese in sessione, e lavori in corso.

## Stack e ambiente

- Node/Express + EJS, nessun build step, JS vanilla in `public/app.js`.
- DB: dispatcher in `db/index.js` — Postgres (Supabase) se `DATABASE_URL` è impostato, altrimenti
  SQLite locale. **In pratica il progetto gira solo su Postgres**: il codice usa sintassi
  Postgres diretta (`NOW()`, `INTERVAL`, ecc.) in `src/richieste.js`, `src/ddt.js`, `src/geo.js`,
  `server.js` senza alcuna traduzione per SQLite — su SQLite puro queste query falliscono
  (`NOW()` non esiste). Il path SQLite è legacy/non mantenuto, non fidarsi del README su questo
  punto specifico.
- `.env` locale ha un `DATABASE_URL` reale che punta al **Supabase di produzione condiviso** —
  non c'è un DB di test separato. Testare in locale (`npm start`) significa scrivere sul DB vero.
- Il server locale **non fa auto-reload**: dopo aver modificato `server.js` o qualunque file
  `require`-ato da lui (es. `src/*.js`, `db/sqlite/index.js`) serve un riavvio manuale per vedere
  l'effetto. Le view `.ejs` e `public/*.css/js` invece si aggiornano da sole (nessuna cache).
- Modifiche allo schema Postgres: si scrivono come `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in
  **entrambi** `db/postgres/schema.sql` e il duplicato `db/schema.pg.sql` in root (tenuti
  allineati a mano, nessuno dei due è generato dall'altro), poi si applicano con
  `node scripts/apply_schema_pg.js`. Per SQLite (legacy) l'equivalente sta in
  `db/sqlite/index.js` con l'helper `aggiungiColonna(tabella, colonna, ddl)`.

## Stato ordini (cliente) — riscritto in sessione

`/ordini` (tab in basso) non mostra più un elenco di card: è un **dispatcher** che trova
l'unica cosa davvero attiva del cliente e ci reindirizza (schermo pieno, non un riepilogo).
Priorità fissa: **in attesa > da scegliere > in consegna > scaduta senza conferme**, sempre la
più recente per livello. Ogni livello ha una finestra oltre la quale non conta più come attivo
(ma resta sempre raggiungibile da Storico):
- in attesa: finché non scade il countdown (`config.finestra_conferma_min`)
- da scegliere: 3 ore dall'ingresso in quello stato (`scelta_scade_il`)
- in consegna: 24 ore dalla creazione ordine, o subito se il cliente preme "Ordine consegnato"
- scaduta senza conferme: 3 ore da `scade_il`, poi solo "Riinvia richiesta" (stesso id, non ne
  crea una nuova — vedi `richieste.reinviaRichiesta`)

Regola di invio: non si può creare una nuova richiesta se ce n'è già una **in attesa** o
**da scegliere** (blocco in `richiestaBloccante()` in `server.js`); un ordine in consegna invece
non blocca, una nuova richiesta lo scavalca come "attivo".

**Storico** (voce nel menu account, non più nel tab in basso) mostra tutto senza filtri —
richieste scadute/annullate, ordini passati e consegnati — sempre raggiungibile anche quando
non è più "attivo".

Nuova colonna `orders.consegnato_il` (TIMESTAMP, nullable): lo stato DB resta `'evaso'`,
"consegnato" si deriva da questa colonna valorizzata, senza toccare il CHECK su `stato`.

## Aspetto grafico — in corso, deciso finora

L'app era percepita "da bambini" (icone emoji ovunque). Sostituite con **icone SVG a linee**
disegnate a mano in `src/icone.js` (24x24, `stroke="currentColor"`, niente librerie esterne),
esposte ai template via `res.locals` in `server.js` (`iconaCategoria`, `iconaLente`,
`iconaCatalogo`, `iconaCarrello`, `iconaOrdini`). Le icone delle 13 categorie merceologiche
**non piacciono ancora** all'utente (disegno provvisorio, da rifare più avanti) — la lente e le
3 icone della barra in basso invece sono approvate.

Stile scelto: **"Cantiere Notte"**, scuro con accento ambra, font Sora (titoli) + Source Sans 3
(corpo), caricati da Google Fonts in `views/partials/app_head.ejs`. Applicato tramite le
variabili CSS in cima a `public/style.css` (`--blu`, `--sfondo`, `--surface`, `--testo`, ecc.),
quindi si è propagato a **quasi tutta l'app** con un solo cambio di token — non è stata rifatta
pagina per pagina. Eccezione voluta: la pagina bolla/DDT resta bianca, è pensata per la stampa.

**Modalità chiara** aggiunta dopo, con toggle vero (non solo preferenza di sistema): bottone nel
menu account, stato in `data-tema="chiaro"` su `<html>`, ricordato in `localStorage('tema')`,
applicato prima del disegno pagina (script inline in `app_head.ejs`) per evitare il lampo del
tema sbagliato. Palette chiara: bianco caldo `#f3f1ec` (non bianco puro), accento **blu
petrolio** `#245a8f` (diverso dall'ambra dello scuro, scelta esplicita dell'utente). Icona
account: **teal**, diverso valore per tema (`--account`, più scuro in chiaro per il contrasto).
Icone lente/nav: colore fisso per tema via `--icona-nav` (ambra in scuro, nera in chiaro),
indipendente dallo stato attivo/non attivo del tab.

Prossimi passi previsti (non ancora chiesti esplicitamente): ridisegnare le 13 icone categoria,
eventualmente replicare lo stile in modo più mirato sulle pagine non ancora riviste a mano
(distributore, agente, DDT — quest'ultima resta bianca apposta).

## Catalogo prodotti — pulizia nomi e ricerca immagini

### Pulizia nomi (fatta, applicata al DB reale)

51.182 prodotti, **14.833 nomi puliti** (29%) con una pipeline di regole sicure (script non più
su disco, era in una cartella temporanea di sessione — se serve rifarla, la logica è: rimuovi
codice produttore iniziale dal nome, rimuovi marchio ripetuto a inizio nome, collassa spazi
multipli, sistema punteggiatura penzolante finale, sistema parentesi troncate, converti nomi
TUTTO MAIUSCOLO in Title Case). Scartata deliberatamente una regola "collassa parole ripetute":
testata su tutto il catalogo, quasi tutti i casi erano terminologia tecnica corretta (es.
"Femmina Femmina", "Maschio Maschio" = raccordo con entrambe le estremità uguali) non errori.

Backup pre-pulizia: `db/backup_nomi_2026-09-03T15-09-54-366Z.json`. Log di ogni modifica reale:
`db/log_pulizia_nomi_2026-09-03T15-43-44-311Z.json`. Casi rimasti irrisolti (serve giudizio
umano, elencati per intero) in `db/db_case.txt`: 36 nomi con asterischi come separatori
(soprattutto Ariston, sembra testo di listino promozionale finito nel campo nome), 419 nomi con
la descrizione duplicata al loro interno (non risolvibile in automatico: la metà "buona" da
tenere non è sempre la stessa), 512 gruppi con nome identico su codici diversi (diagnosi, non un
errore nel nome — spesso taglie/potenze diverse della stessa famiglia prodotto).

`db/nomi_info_mancanti.txt`: gruppi di prodotti con nome identico ma **prezzo molto diverso**
(rapporto prezzo max/min), ordinati dal caso più grave — è il modo più affidabile trovato per
individuare dove il nome nasconde davvero un'informazione mancante (misura/potenza/modello),
perché è basato su un fatto verificabile (prezzi diversi = per forza prodotti diversi) invece
che su una stima.

### `codice_fornitore` — aggiunta importante

Il campo `products.codice` è un ID **interno/gestionale**, non il codice ufficiale del
produttore (verificato: 0% di corrispondenza tra i due). Aggiunta nuova colonna
**`products.codice_fornitore`** (TEXT, nullable), popolata al 100% (51.182/51.182) da 23 file
CSV forniti dall'utente (uno per marchio, in `C:\Users\SAMSUNG\Desktop\catalogo\`, colonne
`Codice;Descrizione;Sigla;Marca;Cod. Fornitore;...`), abbinati per `Codice` = `products.codice`.
Verificato che `codice_fornitore` è davvero il codice articolo ufficiale del produttore (es.
"41066DC0" per un articolo Grohe combacia esattamente con l'URL prodotto su grohe.com) — con
un'eccezione nota: **Toshiba.csv** ha `Marca = "BEIJER REF ITALY-TOSHIBA"` (l'importatore
italiano, non Toshiba direttamente), quindi lì il codice potrebbe essere quello dell'importatore.

### Ricerca automatica delle foto prodotto — risultati della ricerca (importante, da non riperdere)

Obiettivo: usare `codice_fornitore` + `nome` per trovare in automatico una foto per (quasi)
ogni prodotto. Risultati di due ricerche empiriche vere (ricerche web reali, non stime):

- Su un campione casuale di 45 prodotti, verificando ogni pagina trovata (non fidandosi
  dell'anteprima Google): **15/45 "sicuro" (33%)**, 21/45 "incerto" (pagina plausibile ma non
  verificabile con certezza, tipico quando esistono varianti di taglia/finitura molto simili),
  9/45 "no". **Stima realistica sul catalogo intero: ~17.000 prodotti su 51.182.**
- **`codice` (interno) non serve mai per la ricerca web** — non è pubblicato da nessuna parte.
  Quello che funziona è **`marca` + `nome`**, perché il nome spesso incorpora già il vero codice
  modello del produttore (es. "Selection 41066", "R583", "Genus One+ System 30").
- Pattern per tipo di prodotto: marchi grandi con nomenclatura di modello riconoscibile (Grohe,
  Viega, Caleffi, Ariston, Daikin, Giacomini, Wavin, RBM) → quasi sempre trovabile. Ricambi
  minuti/varianti di taglia molto simili (riduzioni Geberit, contalitri Giacomini) → zona grigia,
  il motore di ricerca spesso restituisce il "cugino" con taglia sbagliata. Pezzi di nicchia B2B
  (specialmente G.B.D. SPA — canne fumarie/accessori) → spesso introvabili online.

Ricerca separata su **13 marchi principali** (~83% del catalogo per numero di articoli) per
capire se i siti dei produttori hanno un modo strutturato (URL diretto dal codice) di risalire
alla foto, invece di cercare uno per uno:
- **Solo Giacomini è pienamente automatizzabile**: dal `codice_fornitore` si ricava il prefisso
  famiglia (es. `R19Y064` → `R19`) e si costruisce direttamente
  `https://dam.giacomini.com/PHOTO-HD/{FAMIGLIA}.JPG` — nessuna ricerca necessaria. Foto di
  famiglia, non della variante esatta, ma verificato funzionante.
- **Geberit e Grohe**: fattibile ma una richiesta per prodotto (niente URL diretto), e con
  cautela legale — il `robots.txt` di Geberit **vieta esplicitamente** le pagine di ricerca che
  servirebbero, e Grohe ha risposto **403** anche a una singola richiesta automatica di prova
  (rilevamento anti-bot). Non fare scraping massivo su questi due senza un accordo esplicito.
- Gli altri 10 marchi controllati (Viega, Ferrari, Daikin, RBM, Wavin, Effebi, Tecnosystemi,
  Georg Fischer, Tecnogas, GBD): nessun pattern affidabile trovato, ID interni scollegati dal
  codice fornitore, niente feed immagini pubblico.

**Catalogo del distributore come alternativa** (Cambielli, Borea — sono anche i due distributori
demo dentro l'app): **vicolo cieco pubblico**. Entrambi hanno solo siti vetrina, il catalogo vero
con foto/prezzi è dietro login professionale riservato (MYCLUB per Cambielli, area riservata per
Borea). Se in futuro si ottiene un accesso professionale vero a uno dei due, quella sarebbe la
via legittima per un feed immagini in blocco — non ancora verificato dall'interno.

**Conclusione operativa**: non esiste oggi un modo di procurarsi foto per "quasi tutti" i
prodotti in automatico e nel rispetto dei siti dei produttori. Le strade concrete restano: (1)
implementare subito l'automazione Giacomini (~2.330 articoli, sicura), (2) verificare se
l'installatore/distributore ha già (o può ottenere) un accesso B2B con media kit presso i
marchi principali, (3) accettare una copertura parziale (~33%) via ricerca nome+marca per il
resto, con verifica manuale caso per caso prima di pubblicare qualunque foto.

## Raggruppamento prodotti per misura (varianti) — Fase 1-4 completate

Obiettivo: nel catalogo, prodotti identici a parte la misura (es. "Valvola Sicurezza Ø1/2\" 3bar"
e "...Ø1/2\" 6bar") compaiono come **una sola card** con un selettore di misure, invece che una
riga per variante.

- Schema: tabella `product_groups` (marca, categoria, nome_rappresentativo) + colonne su
  `products`: `gruppo_id` (FK, nullable — un prodotto senza gruppo resta indipendente come prima,
  zero rischio) e `variante_valori` (TEXT, JSON dei token estratti, es. `["Ø1/2\"f","6bar"]`).
- Algoritmo di raggruppamento (script una tantum, non salvato nel repo — vedi sezione file
  temporanei sotto): un token del nome conta come "variabile" **solo se ha un'unità/simbolo
  riconoscibile attaccato** (Ø, Dn, Pn, Sp., L., mm, ", °, frazioni, combo tipo 40x40, "N vie").
  Un numero nudo (es. "25" a inizio nome) NON viene considerato una misura — spesso è un numero
  di modello/serie del produttore (verificato su RBM: "25 Valvola..." e "22 Uniflux..." sono due
  modelli diversi, non due misure dello stesso prodotto), o una gradazione lega (Moon 304/316), o
  una quantità di confezione ("60 Coppie..."). Sogliato inoltre con un controllo di sanità sul
  prezzo (rapporto max/min > 20x nel gruppo → sospetto, escluso).
- **Risultato applicato al DB reale**: 4.964 gruppi, 18.827 prodotti raggruppati su 51.182
  (36,8%). Il resto non è "fallito", è lasciato fuori deliberatamente: sono per lo più numeri
  senza unità riconoscibile, dove non c'è modo sicuro di distinguere una misura vera da un codice
  interno senza guardare prodotto per prodotto.
- **Variabili non numeriche (maschio/femmina, colore, finitura) NON implementate**: analizzate
  ma scartate per ora — "maschio/femmina" descrive l'attacco fisico di ciascuna estremità di un
  pezzo (spesso 2, a volte 3 per i pezzi a T), non è un'etichetta stilistica intercambiabile come
  il colore; raggrupparle rischiava di unire prodotti realmente diversi. Serve una decisione
  dell'utente su quali attributi promuovere a "variabile vera" prima di implementarle.
- UI: in `views/partials/prodotto.ejs` e nella funzione `cardProdottoHtml` in `public/app.js`
  (stesso componente sia per il rendering server-side sia per ricerca live/scroll infinito) —
  sotto **8 varianti** mostra chip cliccabili, sopra passa a un `<select>` nativo (più compatto
  per gruppi affollati, es. "Valvola Sicurezza" ne ha oltre 60). Logica di raggruppamento query
  in `src/catalogo.js` (`raggruppaVarianti()`), applicata sia a `cercaProdotti()` sia a
  `paginato()` (quindi categoria e marchio).
- **Non ancora fatto**: pannello per staccare manualmente una variante finita per errore in un
  gruppo (oggi servirebbe intervento diretto sul DB); pagina/UI di ricerca per allargare ancora
  la copertura (43% è il tetto raggiunto finora, non un limite tecnico assoluto).

## Home distributore — dashboard operativa (fatto)

`/distributore` riscritta da elenco piatto a dashboard: toggle "Banco operativo / In pausa"
(colonna nuova `distributors.ricezione_attiva`, **rispettata nel matching richieste** —
`src/richieste.js` → `distributoriCandidati()` filtra `ricezione_attiva = 1`, sia nella query
principale sia nel fallback broadcast; distinta da `distributors.attivo` che è l'attivazione
della sede sulla piattaforma, non va confusa). Cambio di stato istantaneo via
`POST /api/distributore/stato`, nessun reload.

Card "Da confermare" con countdown grande (badge ambra, `--arancio` — non `--blu`, perché
`--blu` è ambra solo in scuro ma diventa blu petrolio in chiaro, mentre l'allarme deve restare
ambra in entrambi i temi) e anteprima prodotti reale (prime 2 righe + "+N altri"), non solo il
totale pezzi. KPI ridotti a 3 e cliccabili (da confermare / da preparare / in consegna — "in
consegna" in `contatoriBanco()` somma `in_evasione` + `evaso`). Storico spostato su
`/distributore/storico` dedicata (raggiungibile solo dal menu account), tolto dalla home per non
intasarla. Menu in basso ridotto a **Home + Clienti** soltanto (Ordini e Notifiche restano
raggiungibili da menu account / campanella, non più tab fissi).

Due bug reali (non solo estetici) trovati testando dal vivo e corretti in questa sessione:
- `views` con `min-width:0` mancante su `.urgente-card` causava overflow orizzontale su mobile
  con nomi prodotto lunghi (card che sfondava lo schermo).
- **`/richieste/:id/annulla` non chiudeva le risposte "in attesa" dei distributori** — una
  richiesta annullata dal cliente restava visibile al banco come ancora da confermare, a tempo
  indeterminato. Ora la POST chiude anche `request_responses` (esito → `'scaduto'`) per quella
  richiesta.

## Altri bug corretti in sessione (sparsi, utile saperli già chiusi)

- `finestra_conferma_min` in `config` era finita a 0,1666 minuti (10 secondi) invece di 10 —
  probabile refuso di un test precedente rimasto live in produzione, spiegava perché quasi tutto
  lo storico richieste risultava "Non risposta". Corretto (valore tornato a 10).
- `server.js`, dettaglio ordine banco: `await richieste.calcolaOfferta(...).mancanti` leggeva
  `.mancanti` sulla Promise invece che sul risultato risolto (precedenza `.` su `await`) — la
  pagina `/distributore/ordini/:id` andava in 500 per **qualsiasi** ordine legato a una
  richiesta, cioè quasi tutti. Corretto con le parentesi.
- Notifiche al banco mostravano un numero non arrotondato ("Hai 0.16666666666666666 minuti per
  confermare") quando `finestra_conferma_min` non era un intero — `Math.round()` aggiunto in
  `src/richieste.js`.
- Login non toglieva gli spazi dal nome utente prima del confronto in DB (uno spazio finale
  faceva fallire l'accesso anche con credenziali giuste). La registrazione invece già puliva
  tutti i campi (`pulisci()`/`normalizzaUtente()` in `src/anagrafiche.js`).
- Carrello: scendere a 0 con lo stepper eliminava la riga. Ora il minimo nel carrello è **1**
  (il "−" si disabilita a 1, sbiadito); rimuovere richiede il pulsante "Rimuovi" esplicito, mai
  più uno zero accidentale.

## Notifiche — badge "Stato ordini" lato cliente

Il tab "Stato ordini" mostra un pallino **azzurro** (`+N`, distinto dal rosso del carrello) per
notifiche non lette che coprono **sia** categoria `ordini` **sia** `richieste` (il tab segue
tutta la pipeline cliente: richiesta → offerte → ordine, non solo gli ordini in senso stretto —
una conferma disponibilità del distributore è categoria "richieste", non "ordini"; il badge va
sommato su entrambe altrimenti quell'evento non accende nulla). Segnato come letto visitando
`/ordini`, `/richieste/:id` o `/ordini/:id` — attenzione se si tocca uno di questi tre: il
conteggio va ricalcolato/azzerato **dopo** aver marcato come lette (il middleware condiviso lo
calcola prima che la route giri, quindi va risettato a mano in `res.locals.ordiniNonLetti` se la
route stessa fa un render invece di un redirect, altrimenti si vede il valore vecchio per un
giro).

## Aspetto grafico — aggiornamenti dopo la sezione sopra

- Toggle chiaro/scuro **spostato dal menu account all'appbar**, icona sole/luna a sinistra
  dell'icona account (stesso stile line-icon delle altre).
- Icone nav in basso (catalogo/carrello/stato ordini) e lente: **bianche** in scuro (non più
  ambra — `--icona-nav` cambiato), lente leggermente più grande in entrambi i temi.
- Card "in arrivo tra..." (`ordine_hero.verde` in `ordine_dettaglio.ejs`): in chiaro era troppo
  sbiadita (il testo principale restava colore normale su sfondo verde tenuissimo) — corretto
  **solo per il tema chiaro** con override mirato, lo scuro non è stato toccato.

## File temporanei di sessione (non nel repository)

Script di analisi/pulizia e mockup di design creati durante le sessioni vivono nella cartella
scratchpad temporanea di quella sessione (`AppData\Local\Temp\claude\...\scratchpad\`), **non
sono salvati nel progetto**. Se serve rifare un'analisi simile (es. ripetere la pulizia nomi su
nuovi prodotti importati, o la ricerca fattibilità immagini su altri marchi), la logica è
descritta sopra ma lo script va riscritto da zero.
