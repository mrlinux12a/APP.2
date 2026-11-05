# Banco: dettaglio richiesta e pagina dell'ordine

Estratto da [`CLAUDE.md`](../../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Dettaglio richiesta del banco (14/10/2026)

`GET /distributore/richieste/:id` (`server.js`, logica di presentazione in `src/logica/banco/richiesta.js`) + `views/banco/dettaglio.ejs`, classi `ric-*`
(blocco "Dettaglio richiesta del banco" in fondo a `style.css`); la logica di risposta (`POST .../rispondi`: `prezzo_richiesto` / `rifiuta`) e
`POST .../elimina` **non sono cambiate**. Come lo Storico, la vista include `partials/banco/banco_testa` (con "Banco" accesa) e ha il suo titolo, non
passa da `partials/comune/appbar.ejs`. Richieste esplicite, non rimetterli: niente "Cliente ordinante" nascosto in un `<details>`, niente pulsante rosso
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
  `in_evasione` e la richiesta torna "Confermata". Prova: "banco: la richiesta con l'ordine "Da preparare" non ha una pagina…" e "banco: la freccia di ordine e richiesta riporta…" in `test/sito/banco_avvisi.test.js`, `test/sito/banco_ordine.test.js`, `test/sito/banco_richiesta.test.js`.
- **Timer** (`[data-ric-timer]`, blocco "Dettaglio richiesta del banco" di `app.js`): anello da 80px arancio come sulla home, **rosso negli ultimi
  2 minuti** (`SOGLIA_URGENTE_SEC = 120`; la home usa 3 minuti, `BACHECA.urgenteSec`). Come sulla home parte dai secondi rimasti e li trasforma in un
  istante col `Date.now()` del browser; a zero ricarica. "Rispondi entro le HH:MM" è `requests.scade_il` in ora italiana.
- **Tabella del materiale** (`tabellaMateriale`): Q.tà, articolo e codice, listino, prezzo per il cliente (sconto del banco + servizio, `cad. + IVA`),
  totale di riga. **"Totale per il cliente" = merce + contributo RAEE, IVA esclusa, senza la spedizione fissa** (che l'installatore paga alla piattaforma, non
  al banco: prima si mostrava `totali.imponibile`, che la include). Prima della risposta e se il banco rifiuta contano le quantità richieste; confermata,
  quelle confermate (le mancanti hanno "richiesti N, mancano M").
- **Passi**: con `WHATSAPP_ATTIVO=1` sono tre (conferma → avvisiamo i corrieri → prepari); **a modulo spento sono due**, perché non ci
  sono corrieri da avvisare e l'ordine nasce subito (vale anche per "Avanzamento"). Si vedono solo da confermare e in attesa del corriere.
- **Cliente sempre in vista**: nome, P. IVA, indirizzo (destinazione della richiesta, se no quello di consegna del cliente), telefono **NON cliccabile** (richiesta esplicita del 21/10/2026, vale anche nella pagina dell'ordine e nella scheda cliente: testo semplice, niente `tel:`, e `<meta name="format-detection" content="telephone=no">` via `app_head` con `senzaTelefoni: true`, perché iPhone altrimenti lo trasforma da solo in un collegamento; l'email nella scheda cliente resta `mailto:`; non rimettere i `tel:`). "Apri scheda
  cliente" solo se `anagrafiche.legame(banco, cliente)` esiste (altrimenti la pagina risponde 404: niente link morto).
- Prova: sei test "banco: richiesta ..." / "Preparato ..." in `test/sito/banco_richiesta.test.js` (DB finto `richiestaProva`, che tiene la richiesta 177) e `test/banco/richiesta_banco.test.js`.
  Sul DB vero: richiesta, cliente e utente banco di prova sul **banco AFIS (id 1, disattivato)**, inseriti con SQL (nessuna notifica, nessun banco vero la
  vede), poi cancellati; il timer di 30 s chiude da solo le richieste di prova scadute.

## Pagina dell'ordine del banco (19/10/2026, senza bolla dal 20/10/2026)

`GET /distributore/ordini/:id` (`server.js`, presentazione in `src/logica/banco/ordine.js`) + `views/banco/ordine.ejs`: la pagina di un ordine del banco, **che si adatta allo stato** (`storicoBanco.statoStorico`, lo stesso dello Storico):
**da preparare**, **in consegna** e **consegnato** ("Apri ordine completo" dello Storico funziona per tutti). **Stessa impostazione a due colonne della richiesta** (classi `ric-*` riusate, `ord-*` solo qui; blocco "Pagina dell'ordine del banco" in fondo a `style.css`;
`body.pagina-richiesta .pagina-ordine`). Come il dettaglio della richiesta include `partials/banco/banco_testa` **senza** `indietro` (la freccia è la sua, `ric-indietro`, e va a `paginaPrecedente`, vedi sopra). **Aprirla non scrive
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
- **Prove**: `test/banco/ordine_banco.test.js` (parti pure: momenti, tempo di consegna, passi per stato) e, in `test/sito/banco_ordine.test.js`, `test/sito/home_e_ordine_cliente.test.js`, `test/sito/stato_ordini_e_richieste.test.js`, "banco: pagina dell'ordine a due colonne…", "…disponibilità parziale e RAEE…", "banco: pagina dell'ordine "In consegna" e "Consegnato"…" e "banco: "Preparato" dalla pagina dell'ordine…" (DB finto: ordine 1295; istanti fissi `alle(h, m)` così non dipendono dall'ora; `ritiroTra(minuti)` fa arrivare il corriere fra N minuti; controlla anche che nessuna query scriva, `scrittureDa`). Per vedere la pagina senza DB: view e partial veri con `ejs.renderFile`, `style.css` vera e un piccolo server statico (dati finti, anche con e senza corriere). Sul browser vero: Postgres
  locale usa-e-getta (vedi "App Android e sicurezza"), il vero `server.js` lanciato da uno script in una cartella **senza `.env`** che imposta a mano `DATABASE_URL` locale, `STRIPE_*`, `WHATSAPP_ATTIVO=0`, `PUSH_ATTIVO=0`… (e `preview_start` con una voce di `.claude/launch.json` che lancia quello script), un banco (`borea`/`banco123` dal seed), un cliente e un ordine creato con `flusso.nuovaRichiesta` + `richieste.rispondi` + `richieste.corriereHaPreso` (con `WHATSAPP_ATTIVO=1` in quello script, mai collegato). Sul Postgres locale le colonne `TIMESTAMP` sono ora di Roma e non UTC: orari e giorni di quelle colonne risultano sfalsati di 2 ore (non lo sono sul DB di produzione in UTC), le `TIMESTAMPTZ` no. Dopo ogni `navigate` il pannello perde il ridimensionamento: `tabs_select` e `resize_window` prima dello screenshot.
