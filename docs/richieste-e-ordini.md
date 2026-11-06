# Richieste, ordini e Stato ordini

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Richieste e ordini

- Zona non filtra più i distributori candidati (`distributoriCandidati` in `src/logica/ordini/richieste.js`
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
  dopo `rispondi()` a modulo spento e subito dopo `corriereHaPreso()` con WhatsApp (o `corriereAccetta()` con l'app dei corrieri, ambiente «app»: `rispondi` aspetta un corriere con `modalita.conCorriere()`, cioè se `CORRIERI_APP=1` o `WHATSAPP_ATTIVO=1`; vedi [ambienti.md](ambienti.md) e [app-corrieri.md](app-corrieri.md)). Se la creazione
  fallisce la riprova `aggiornaScadenzeAperte` (timer di 30 s, **non** la lettura della richiesta:
  `aggiornaScadenza` ora chiude solo le finestre). L'assegnatore si registra in `src/logica/ordini/flusso_cliente.js`:
  uno script che usa solo `src/logica/ordini/richieste.js` non lo ha (anche `scripts/verifica/prova_whatsapp.js` lo importa).
  Destinazione e note stanno sulla richiesta (`requests.destinazione/note`, scritte dal carrello).
- **Pagamento** (`src/logica/pagamenti/pagamenti.js`): `requests.pagamento_stato` NULL = vecchio flusso,
  `pagato`, `rimborsato`; importo = **`totali.da_pagare_app`** del carrello. **AGGIORNAMENTO 23/10/2026 (richiesta esplicita: "5 euro costo fisso corriere, e costo di servizio con IVA incluso"; vale al posto di quanto segue sulla parte "in app")**:
  l'installatore paga ORA = **corriere 5,00** (`config.spedizione_fissa` = 5, già prezzo finale: niente IVA sopra) **+ servizio con l'IVA DENTRO** (`round2(round2(netto × 10%) × 1,22)`: merce 64,50 → servizio 6,45 → **7,87**), quindi **12,87** (era 20,07), senza riga IVA a parte nel riepilogo;
  il materiale dopo a BOREA non cambia (78,69; spesa complessiva 91,56). Un'interpretazione scelta con l'utente fra tre (11,45 / 12,87 / 13,97). In `pricing.dividiTotale` l'IVA contenuta nel totale (`app.iva` 2,32, `app.imponibile` 10,55) si ricava **per scorporo dal totale** (`scorporaIva`) ed è
  quella che si salva (`orders`/`requests`: `iva_app`, `imponibile_app`, `da_pagare_app`; `servizio` resta il 10% IVA ESCLUSA, da cui si ricava la %). `app.servizioIva` = servizio come si mostra, `app.ivaInclusa` = true. **Importi già salvati col modello di prima** (IVA sopra: 10 + 6,45 + IVA 3,62 = 20,07) non si toccano e si mostrano com'erano, con la riga IVA:
  `pricing.importiOrdine`/`importiRichiesta` passano da `conServizioMostrato`, che sceglie guardando l'IVA SALVATA (`appIvaInclusa`: più vicina allo scorporo o alla somma sopra; mai il totale addebitato, che con `PAGAMENTO_APP_PROVA` non somma). Le viste (`partials/cliente/pagamenti.ejs`, `email.js`, `ricevute.js`, API `importi.consegna.iva_inclusa`, app Expo) scrivono `app.servizioIva` e
  disegnano la riga IVA solo se `!app.ivaInclusa`; la ricevuta PDF nuova ha "Di cui imponibile / Di cui IVA 22%". **Sul DB condiviso `config.spedizione_fissa` è stato messo a 5 il 23/10/2026** (`node scripts/db/imposta_config.js spedizione_fissa 5 --applica`, era 10; per tornare indietro lo stesso comando con 10). La VPS legge lo stesso valore: finché non ha il codice nuovo (`git pull`, `npm ci`, riavvio pm2) fa pagare (5 + 6,45) × 1,22 = 13,97 invece di 12,87.
  Il testo qui sotto, dove dice 10 €, "+ IVA su (corriere + servizio)", 20,07 o 98,76, descrive il modello di PRIMA (resta valido per gli ordini nati prima). **Regola dei prezzi (dal 17/10/2026; commento sopra `pricing.calcolaOrdine`, una sola
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
  **Carrello web**: card "Cosa paghi e a chi" (`views/cliente/carrello.ejs`, classi `cp-*`): riquadro azzurro "Consegna in cantiere" (PAGHI ORA: Corriere, Servizio, IVA, Totale da pagare ora) e
  riquadro "Materiale" (PAGHI DOPO A {ditta}, nome da `profiloCliente.distributore` senza forma giuridica, `fmt.nomeCommerciale`; Merce, RAEE solo se > 0, IVA, Totale materiale), sotto
  "Spesa complessiva"; barra "Paghi ora · consegna". Ogni importo è un `[data-riep="chiave"]` scritto da `flusso.vistaRiepilogo` (testo già pronto: la vista non fa conti) e
  **il ricalcolo dal vivo** (`aggiornaCarrelloDa` in `app.js`) lo riscrive dalla risposta di `POST /api/carrello/imposta` (`riepilogo`, `totali_righe`) **senza ricaricare**
  (± e quantità scritta; togliere una riga ricarica come prima), compreso l'avviso dell'ordine minimo (`[data-minimo-avviso]`, sempre nella pagina e `hidden` se raggiunto), la riga
  RAEE e il pulsante. Prove: `test/pagamenti/pricing.test.js` e i test "carrello: ..." di `test/sito/*.test.js`. **Non seguono ancora**: l'app Expo (l'API dà `riepilogo`,
  `da_pagare_ora`, `da_pagare_al_banco`, ma l'app mostra ancora `totale_ivato`).
  **Importi dell'ordine, divisi uguale dappertutto (17/10/2026)**: alla nascita dell'ordine `flusso_cliente` salva in `orders` `servizio`, `imponibile_app`, `iva_app`,
  `da_pagare_app`, `imponibile_banco`, `iva_banco`, `materiale_banco` (DOUBLE PRECISION NOT NULL DEFAULT 0; blocco "Importi dell'ordine divisi" in fondo a `schema.sql`,
  **applicato al DB condiviso il 17/10/2026**; i 41 ordini di prima restano a 0). **Una sola funzione**, `pricing.importiOrdine(ordine, pagamento, ivaPct, servizioPct)` →
  `{ app: {corriere, servizio, imponibile, iva, totale, pagatoIl, rimborsato, metodo}, banco: {merce, raee, imponibile, iva, totale}, servizioPct, ivaPct }`, usata da pagina
  dell'ordine (`flusso.dettaglioOrdine` → `importi`), `src/logica/ordini/materiale.js` (Storico, CSV, pagina del cliente lato banco) e pagine della richiesta: colonne salvate se ci sono
  (`da_pagare_app` o `materiale_banco` > 0), altrimenti **ricalcolo** per gli ordini vecchi (merce = `totale_netto`, servizio = `totale_finale − totale_netto`, corriere =
  `costo_consegna`, RAEE = `contributo_raee`, IVA con `pricing.ivaPctOrdine`: quella salvata nell'ordine, mai quella di oggi). Sugli ordini veri #124–#132 dà 20,07 / 78,69.
  `app.totale` = `requests.pagamento_importo` (l'incassato, con Stripe) **solo se non supera il calcolo di più di un centesimo**: gli ordini di prima pagati INTERI in app
  (98,76) mostrano il calcolo (20,07), non 98,76 (scelta mia: altrimenti "Consegna 98,76" accanto a "Materiale 78,69"). **Pagina dell'ordine dell'installatore**
  (`cliente/ordine_dettaglio.ejs`, in consegna, consegnato e il ritiro del vecchio flusso; la parte alta con anello, "Te lo porta…" e barra non è cambiata): scheda "Materiale in
  arrivo" / "Materiale consegnato" (`partials/cliente/ordine_righe.ejs`: righe `Cod. X · € cad.` a prezzo del banco + RAEE, "Merce · IVA esclusa") e scheda "Pagamenti" (`partials/cliente/pagamenti.ejs`, UNA per ordine e richieste, classi `pg-*`, parametri `{ importi, stato: 'attesa'|'ordine'|'consegnato'|'chiusa', ditta }`:
  riga verde "Consegna in cantiere · Pagata il gg/mm · Visa •••• 4242" con il link "Ricevuta", riga grigia "Materiale · Lo paghi a {ditta} con la sua fattura", `<details>` "Vedi il dettaglio degli importi"
  con i due riquadri; i quattro stati (bloccato/pagato/annullato/rimborsato) e il parametro `statoPag` sono descritti in "Pagamenti lato installatore"). **Mai un "Totale" unico** né Consegna/IVA/Totale sotto le righe. **Tolti su richiesta esplicita**: la sezione chiusa "Dettagli consegna e
  pagamento/documenti" (**destinazione e note della richiesta non si vedono più** nella pagina dell'ordine) e la nota "Prezzo definitivo, con eventuale sconto
  aggiuntivo…". Il pulsante "Ordine consegnato" ora è "Ho ricevuto il materiale" (stessa azione). **Banco e agente vedono ancora il markup vecchio** (`subtotale_cliente`,
  `totale_finale`, `totale_ivato`; commento sopra il loro ramo in `cliente/ordine_dettaglio.ejs`). Prove:
  `test/pagamenti/pricing.test.js` (`importiOrdine`, `ivaPctOrdine`), `test/ordini/materiale.test.js` ("Storico e pagina del banco…"), test "ordine in consegna/consegnato/VECCHIO/rimborsato…"
  e "richiesta in attesa/scaduta…" di `test/sito/*.test.js`. **Sulla VPS**: `git pull`, lo schema (blocco sopra) PRIMA del riavvio di pm2: il nuovo `INSERT INTO orders`
  scrive le colonne e fallisce se non ci sono.
  **Importi della richiesta (17/10/2026)**: stessa divisione sulle pagine `GET /richieste/:id` (in attesa e chiusa). `flusso.nuovaRichiesta` passa i `totali` del carrello a
  `richieste.creaRichiesta`, che li salva su `requests`: `corriere`, `servizio`, `iva_app`, `da_pagare_app`, `merce_banco`, `raee_banco`, `iva_banco`, `materiale_banco` (DOUBLE
  PRECISION NOT NULL DEFAULT 0) più `rimborsato_il` (TIMESTAMP, scritta da `pagamenti.rimborsa`, azzerata da `incassaDiNuovo`); blocco "Importi della richiesta divisi" in fondo a
  `schema.sql`, **applicato al DB condiviso il 17/10/2026**. `pricing.importi({ ordine | richiesta })` è il punto unico (`importiOrdine` / `importiRichiesta`): per le richieste
  vecchie (colonne a 0) si ricalcola con `pricing.calcolaDaRigheDb` (calcolaOrdine sulle righe del DB, **stessa funzione del carrello**, consegna fissa di oggi);
  **`app.totale` = `pagamento_importo` quando c'è, senza controllo di coerenza** (diversamente dall'ordine: un rimborso mostra quanto è tornato davvero), `pagatoIl` = `pagato_il`,
  `rimborsatoIl` = `rimborsato_il` o, per una chiusa senza ordine (`nessuna_offerta`) rimborsata prima della colonna, `scade_il`; `conPagamento` dice se c'è un pagamento (le richieste del vecchio
  flusso non hanno la scheda "Pagamenti"). `dettaglioRichiesta` passa alla vista `importi`, `righePrezzi` (le righe di calcolaOrdine, forma di `order_items`: la stessa
  `partials/cliente/ordine_righe.ejs` dell'ordine), `ditta` (nome senza forma giuridica, vuoto con più ditte: "il banco") e `rinvio` ({ consegna, materiale } di oggi); `righe` resta quella
  del DB (la usa anche l'API dell'app). Attenzione: un `include` EJS vede i locals della pagina, quindi la scheda "Pagamenti" va chiamata con `rinvio: null` dove non c'è la nota.
  **"Rinvia richiesta" ora addebita la consegna ricalcolata con i prezzi di OGGI** (prima ripeteva `pagamento_importo`): `richieste.reinviaRichiesta` riscrive gli importi salvati e
  `pagamento_importo` (con Stripe quello già autorizzato, `importo` passato da `riapriRichiesta`; `avviaPagamentoReinvio` autorizza `flusso.totaliRichiestaOggi`), così la nota
  "Se rinvii la richiesta paghi di nuovo solo la consegna (€ X)" dice la verità. Le righe della scheda "Materiale richiesto" sono sempre a prezzi di oggi (`request_items` non salva
  prezzi): se i prezzi cambiano dopo l'invio, "Merce" (salvata) può non tornare con la somma delle righe. Prove: `test/ordini/richieste_importi.test.js` (INSERT, rinvio, rimborso,
  `importiRichiesta`) e i test "richiesta in attesa/scaduta/annullata…" di `test/sito/*.test.js`.
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

## Più ordini insieme in Stato ordini (15/10/2026)

Richiesta esplicita: l'installatore può avere più richieste/ordini in corso nello stesso momento. Tre fasi: **1** richiesta in
attesa di banco e corriere (`requests.stato = 'in_attesa'`), **2** ordine in consegna (`eInConsegna`: non consegnato, nato da
meno di 24 h), **3** consegnato (`consegnato_il`): la 3 **non è più attiva**, sta solo nello Storico. Logica in
`src/logica/ordini/flusso_cliente.js` (`leggiVoci`, `vociStriscia`, `statoIconaOrdini`, `attivitaCliente`); prove in `test/ordini/stato_ordini.test.js` e nei test
"Stato ordini..." / "striscia..." di `test/sito/stato_ordini_e_richieste.test.js`.
- **`/ordini` e la striscia di schede** (richiesta esplicita del 15/10/2026; sostituisce la lista `ordini_attivi.ejs`, tolta con il suo CSS e
  l'evento `stato-ordini-aggiorna`: non rimetterli). `/ordini` non rende più un elenco: **0 voci** → `ordini_cliente` (pagina vuota), **1** →
  redirect alla sua pagina, **2 o più** → redirect a `?voce=<tipo>-<id>` se è fra le voci, altrimenti alla PRIMA (la più urgente). Sopra la
  pagina di dettaglio (`richiesta_attesa`, `richiesta_chiusa`, `ordine_dettaglio` del cliente) c'è `partials/cliente/striscia_ordini.ejs`, solo se le
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
- **Home: una scheda per ogni attività** (richiesta del 15/10/2026): `partials/cliente/stato_home.ejs` fa un ciclo sulle `voci` dell'icona (solo
  `richiesta` e `consegna`: la scaduta non ha scheda, come prima) e disegna per ognuna la scheda di sempre, una sotto l'altra, nell'ordine
  dell'icona. Ogni scheda porta alla pagina della sua attività (`voce.href`) e ogni richiesta ha il suo `[data-secondi]`, quindi il suo
  conto. Le voci di consegna portano `corriere` e `progresso` (la barra a metà) proprio per questo. Il controllo periodico di `nav_ordini`
  rimpiazza tutto lo slot `[data-stato-home]`: una scheda sparisce da sola quando l'attività finisce.
- **"Nessuna risposta" (fase `scaduta`): OGNI richiesta senza risposta resta 10 minuti dalla sua scadenza, per conto suo** (richiesta esplicita del 20/10/2026,
  sostituisce la regola del 15/10 "solo se è l'ULTIMA cosa successa, entro 3 h", che con due richieste insieme faceva sparire subito la prima a scadere: non rimetterla).
  `flusso.scaduteRecenti(cards)` = tutte le `nessuna_offerta` con `secondiAllaScomparsa > 0` (`SCADUTA_VISIBILE_MS` = 10 min da `scade_il`, arrotondato per eccesso), a prescindere
  da cos'altro è successo dopo (altre richieste, un ordine anche consegnato); l'annullata non è mai una voce. Ogni voce `scaduta` porta `scompareTraSec`; fra scadute prima quella che
  sparisce prima. Quando i 10 minuti finiscono si passa a: un'altra scaduta ancora nei suoi 10 minuti, poi le richieste/ordini nelle varie fasi, poi la pagina "Stato ordini" vuota
  (è l'ordine delle voci, quello che segue `/ordini`). **Come sparisce**: l'icona (`partials/cliente/nav_ordini.ejs`) legge `[data-scompare-sec]` e, appena la prima è sparita (+0,8 s), rilegge lo
  stato (`avvia()` → `primaScomparsa()`); una pagina con la striscia si ricarica per la firma cambiata. Se la pagina aperta è proprio la richiesta che sparisce (`cliente/richiesta_chiusa.ejs`,
  `lasciaFra` da `server.js`, = 0 se è aperta dallo Storico o oltre i 10 minuti) un timer in pagina fa `location.replace('/ordini')` a +1 s e imposta `window.minuteriaLasciaIl`:
  l'icona, negli ultimi 6 s, **non ricarica** la pagina (`staPerLasciare`), altrimenti la ricarica vincerebbe la corsa e il cliente resterebbe su una richiesta ormai fuori dall'elenco.
  **Limite noto**: se TUTTI i banchi rifiutano prima della fine della finestra la richiesta si chiude subito (`chiudiSenzaOrdine`) ma `scade_il` resta nel futuro, quindi i 10 minuti
  contano dalla fine della finestra e non dal rifiuto (mancano un orario di chiusura nel DB). L'API dell'app (`/stato-ordini`) non scrive `scompare_tra_sec`: l'app non ha il passaggio automatico.
  Prove: `test/ordini/stato_ordini.test.js` ("DUE richieste…", "secondiAllaScomparsa…", "ogni «Nessuna risposta» porta i secondi…") e "richiesta senza risposta: resta in «Stato ordini» 10 minuti…" in `test/sito/stato_ordini_e_richieste.test.js`.
- Si guardano le ultime **30** richieste (`RICHIESTE_RECENTI`), non più 5.
- **L'icona alterna le attività quando sono 2 o più** (richiesta del 15/10/2026): `statoIconaOrdini` ritorna, oltre ai campi di sempre
  (la prima inviata), `voci` = TUTTE le attività nell'ordine di alternanza
  (`ordinaVociIcona`, funzione pura: prima le `scaduta` (da quella che sparisce prima), poi le `richiesta` dal timer più corto, poi le `consegna` da chi arriva prima, senza
  minuti in fondo; a parità la più vecchia). Le **scadute** entrano fra le voci anche con altre attività, ciascuna per 10 minuti (vedi sopra).
  `views/partials/cliente/nav_ordini.ejs`: con `voci.length >= 2` il link ha `multi`, `data-fasi="richiesta,consegna"`, `data-fase` della prima voce e
  `aria-label` ("Stato ordini: 2 attivi. In attesa, 07:42 rimasti. Arriva tra 18 minuti."), dentro un `.fotogramma` per voce (sovrapposti,
  dissolvenza di 250 ms, `aria-hidden`) e i `.puntini`; con 0 o 1 voce il markup è quello di sempre. Il contenuto di una fase sta **solo** in
  `partials/cliente/nav_ordini_fase.ejs`. Altezza dei fotogrammi `--nav-stato-alt` (43px = icona 24 + etichetta 19,2, **senza gap**: sovrapponibile al
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
- **Durata dell'anello = la finestra, non `scade_il - creato_il`** (`format.durataFinestraSec`, anche in `cliente/richiesta_attesa.ejs`): "Rinvia" riapre la
  stessa riga con `scade_il` ricalcolato e `creato_il` di prima (es. la richiesta 188: durata 7586 s), e l'anello partiva quasi vuoto.
- **Pagina dell'ordine singolo: orario E minuti (21/10/2026, richiesta esplicita)**: sotto il titolo ("Arriva entro le 10:45", o "Arriva entro 6 ore" senza corriere) c'è `<p class="att-minuti" data-eta-testo="Mancano {t}" data-eta-nascondi>` ("Mancano 18 min", "Mancano 5 h 57"):
  lo scende il blocco "Consegna in arrivo" di `app.js` ogni secondo (i minuti cambiano ogni minuto) e a 3 minuti o meno sparisce (`display: none`, come il badge dell'icona: il titolo dice già solo "In arrivo"). Solo nella pagina dell'ordine in consegna dell'installatore; la striscia con più ordini ha già il suo "tra N min".
  Prova: test "ordine in consegna: oltre all'orario…" in `test/sito/home_e_ordine_cliente.test.js`.
- **Conti alla rovescia della consegna** (richiesta esplicita del 16/10/2026: "tutti i timer devono scendere in modo lineare, anche le
  barre", i minuti devono scendere ogni minuto, a 3 minuti "In arrivo"). Prima "Arriva tra N min" lo scriveva solo il server: nella striscia
  con 2+ ordini restava **fisso** (la striscia non si aggiorna col polling dell'icona), in home e icona cambiava solo a ogni polling, l'anello
  e la barra della pagina dell'ordine si muovevano ogni 30 s (a scatti) e la barra della home era ferma al 50%. Ora **un solo blocco in `app.js`,
  "Consegna in arrivo"**, ogni secondo, col suo orologio: un contenitore `[data-eta-sec]` (secondi all'arrivo al momento del disegno, calcolati
  dal server: l'ora del PC non c'entra; `[data-eta-durata]` = secondi dalla nascita dell'ordine all'arrivo) e dentro `[data-eta-testo]` (testo con
  `{m}` = minuti, `ceil`, mai meno di 1), `[data-eta-barra]` (si riempie), `[data-eta-arco]` (si svuota). I contenitori sono: la card della home
  (`partials/cliente/stato_home.ejs`), la scheda della striscia (`partials/cliente/striscia_ordini.ejs`), il link o il fotogramma dell'icona (`partials/cliente/nav_ordini.ejs`), il riquadro della
  pagina dell'ordine (`cliente/ordine_dettaglio.ejs`). Il server disegna già il testo giusto (`voce.inArrivo`, `voce.etaSec`, `voce.durataSec`, da
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
    **L'app Expo e `src/routes/api_v1/` (`tempo_testo`: "Consegna prevista entro le…") non seguono ancora.**
  - **Cronometro "In arrivo"** (16/10/2026): negli ultimi 3 minuti l'anello della pagina dell'ordine non si svuota più ma riparte da vuoto e si riempie fino
    all'arrivo (`circ × secondi/180`; a 180 s l'anello del viaggio è già quasi vuoto, quindi non c'è salto); lo fanno sia la vista (primo disegno) sia `app.js`.
    La barra della card in home, a tempo finito, **si ferma al 94%** (`PROGRESSO_ARRIVO`, in `app.js` il 44 di `50 + (1 - r) * 44`): "Consegnato" solo con la consegna vera.
  - **Badge dell'icona** (`{c}`): "45′" sotto l'ora, "5h57" oltre (`format.durataBreve`, uguale in `app.js`); sparisce in "In arrivo".
  - Prove: `test/ordini/stato_ordini.test.js` (voci, soglia, disegno dei partial con `ejs.renderFile`). Il blocco JS non gira in `node --test`: per provarlo
    una pagina usa-e-getta con i partial veri + `style.css` + `app.js` su un server locale (ETA a 190 s: dopo 10 s passa a "In arrivo"), senza login né DB.
- Prova sul DB vero: richieste/ordini inseriti con SQL sul **banco AFIS (id 1, disattivato)** per un cliente usa-e-getta, poi
  cancellati per id. **Non creare richieste vere** (`creaRichiesta` le manda a tutti i banchi attivi, cioè a Borea).
