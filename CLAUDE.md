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

## File temporanei di sessione (non nel repository)

Script di analisi/pulizia e mockup di design creati durante le sessioni vivono nella cartella
scratchpad temporanea di quella sessione (`AppData\Local\Temp\claude\...\scratchpad\`), **non
sono salvati nel progetto**. Se serve rifare un'analisi simile (es. ripetere la pulizia nomi su
nuovi prodotti importati, o la ricerca fattibilità immagini su altri marchi), la logica è
descritta sopra ma lo script va riscritto da zero.
