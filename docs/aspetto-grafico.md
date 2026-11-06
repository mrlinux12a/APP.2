# Aspetto grafico del sito

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Aspetto grafico (sito web)

**Solo tema chiaro** (richiesta esplicita del 02/10/2026: tolta la modalità scura "Cantiere Notte",
l'interruttore e lo script `data-tema`; non rimetterli). Icone SVG in `src/comune/icone.js` (13 icone categoria
provvisorie). Variabili CSS in cima a `assets/css`.
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
  (`<details>`, campo `note`) → riepilogo (dal 17/10/2026 la card "Cosa paghi e a chi": vedi "Pagamento") → (il "Svuota" non è più in fondo: dal 22/10/2026 è la pillola col cestino in alto a destra, sulla stessa riga di "+ Aggiungi pezzi", `.btn-svuota`, con conferma; la scritta "N articoli · M pezzi" resta tolta). L'importo
  "Paghi ora" e **"Paga e invia richiesta"** stanno nella barra fissa `.barra-paga` sopra la navbar (il pulsante
  invia `#form-invia` con l'attributo `form=`); `--altezza-barra-paga` in `style.css` è lo spazio da
  lasciare in fondo alla pagina: se la barra cambia altezza, aggiornarlo. Dal 05/11/2026 l'app mobile
  segue queste modifiche (vedi «Allineamento dell'app al sito» in docs/app-nativa.md).
- **Righe compatte ovunque (richiesta esplicita del 16/10/2026)**: ricerca (`/cerca` e ricerca live della home), "Elementi con foto" (`/con-foto`), marchio (elenco di una famiglia) e
  categoria usano **tutte** `partials/cliente/prodotto_riga.ejs` (foto 56×56 a sinistra, stepper `− N +` che salva a ogni tocco, niente "Aggiungi", barra `.barra-vai` in basso);
  `.app-categoria` dà lo spazio in fondo. Ogni pagina ha `#risultati[data-righe-compatte]` con `data-carrello`, `data-pezzi`, `data-icona-vuota` (la home li ha sull'elenco
  delle categorie: la ricerca live ci disegna le righe con `rigaCompattaHtml`, e `/home` passa `carrello`). **La card classica `partials/prodotto.ejs` non è più usata da nessuna pagina (il file è stato eliminato il 24/10/2026)**, e con lei
  il blocco "scelte" qui sotto (`[data-passo]`, "Aggiungi (N)", sessionStorage) è codice rimasto in `app.js` ma senza pagine che lo usino: non reintrodurre card diverse, e se
  si pulisce `app.js` si può togliere. Prova: test "ricerca, "Elementi con foto" e home: righe compatte..." in `test/sito/catalogo_e_carrello.test.js`.
- **Quantità scelte e non ancora aggiunte** (card classica: ricerca, marchio, con-foto e ricerca live della home; richiesta esplicita del
  15/10/2026): il + scrive solo nel campo, "Aggiungi (N)" manda al carrello. Prima, cambiando pagina, i campi tornavano a 0. Ora stanno in
  `scelte` (`{ id: quantità }`, in `app.js`) e in **sessionStorage** (`minuteria.scelte.<id utente>`, dal `<meta name="utente">` di
  `partials/comune/app_head.ejs`; scadono dopo 12 h), e si rimettono nei campi a ogni pagina, ricerca live (`disegnaRisultati`, ripristino
  dell'elenco), scroll infinito e ritorno da "indietro" (`applicaScelte`). Il conto "N selezionati" e "Aggiungi (N)" si fanno su `scelte`, non
  sui campi in vista, e "Aggiungi" manda **tutte** le scelte (anche di card non in pagina; un articolo non più attivo lo salta il server).
  Cambiare misura su una card scarta la scelta della misura di prima (com'era). La pagina categoria (righe compatte, salvataggio a ogni
  tocco) non usa niente di tutto questo.
- **Elenco prodotti della categoria** (richieste esplicite del 04/10/2026, non rimetterli; solo
  `views/cliente/categoria.ejs`, le altre pagine — home, cerca, marchio, con-foto — hanno ancora la card classica
  `partials/prodotto.ejs` e lo stepper `[data-passo]` + "Aggiungi"): righe compatte `partials/cliente/prodotto_riga.ejs`
  (foto 56×56 o segnaposto con la scatola, nome, prezzo `+ IVA`), **niente** riga "Caldaie — 314 articoli",
  famiglia ripetuta, badge "Disponibile" (si mostra solo uno stato diverso) né "Nel carrello: N pz". Lo stepper
  `− N +` mostra la quantità **già nel carrello** e salva a ogni tocco su `/api/carrello/imposta` (nessun
  "Aggiungi"): stato, coda a una richiesta alla volta e ripristino in caso di errore in `assets/js`, blocco
  "Righe compatte della categoria". Un secondo costruttore JS (`rigaCompattaHtml`) disegna le stesse righe per
  ricerca live e scroll infinito, scelto da `#risultati[data-righe-compatte]`: i due markup devono restare
  uguali. In basso `.barra-vai` ("N pezzi" + "Vai al carrello →"), visibile solo con pezzi > 0;
  `--altezza-barra-vai` è lo spazio da lasciare in fondo alla pagina. Del vecchio blocco info restano solo le
  misure (blocco "Misura", sotto) e il RAEE: EAN, refrigerante e F-GAS non si vedono più nell'elenco.
- **Scelta della misura/variante** (richiesta esplicita del 06/10/2026; classi `misura-*`; vale per la riga
  compatta e per la card classica): blocco `partials/cliente/misura.ejs`, disegnato anche da `misuraHtml` in `app.js`
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
  `test/catalogo/varianti.test.js` per le etichette; per il resto serve un browser (nel pannello nascosto clic e animazioni non
  girano: `tabs_select` e uno screenshot prima).
- **Sottocategorie di una categoria** (`views/cliente/categoria.ejs`, ramo senza elenco prodotti, richiesta esplicita
  del 05/10/2026): griglia a 2 colonne di schede `.sotto-scheda` (foto 4:3 sopra, nome Sora 600 su max 2 righe
  sotto), **senza** numero di articoli, icona cartella né freccia; ricerca `.ricerca-fissa-sotto` sticky sotto
  l'appbar (funziona perché è figlia diretta di `.app`: non annidarla in un contenitore basso). **Foto**: nessuna
  colonna nel DB, vale `public/img/sottocategorie/<slug>.webp` (4:3, ~600×450); "varie" esiste in ogni categoria,
  quindi lì è `<macro>-varie.webp`. `sottocategorieDi` (`src/logica/catalogo/catalogo.js`) mette `foto` solo se il file esiste
  (riletto ogni 60 s con la cache): un `<img>` verso un file mancante non è gratis, `/img` cade nella sessione e
  nelle query delle viste prima del 404. Senza foto, o se non si carica (`onerror`), resta il riquadro grigio con
  l'icona della categoria madre.
- **La mia anagrafica** (`views/cliente/profilo.ejs`, richiesta esplicita del 05/10/2026; classi `an-*`): sola lettura,
  schede in quest'ordine: nome (cerchio con le iniziali) → **un solo** distributore → dati di fatturazione →
  contatti → nota. Il distributore è il **primo approvato** (le ditte arrivano da `legamiDelCliente` già in
  ordine di nome); se nessuno ha approvato, il primo della lista e senza codice. La regola sta in
  `anagrafiche.distributoreDiRiferimento`, usata anche dal menu del profilo: l'invio delle richieste
  (`distributoriCandidati`) non cambia. **Niente etichette di stato** ("Approvato"...) né riga
  "Consegna abituale" (l'indirizzo di consegna sta nel carrello). Un dato vuoto nasconde la sua voce, e una
  scheda senza voci sparisce. Il referente si chiama "referente" (è il campo della registrazione: non è detto
  che sia il titolare). Fondo pagina 96px da `.app-anagrafica`, non dai ~150px di `.app`.
- **Pulsante e menu del profilo** (`views/partials/comune/appbar.ejs`, richiesta esplicita del 05/10/2026; classi
  `profilo-*`, `pp-*`, `avatar-*`): solo per il **cliente**; l'agente ha ancora campanella e tendina
  `.menu-account`, il banco la sua intestazione (`partials/banco/banco_testa.ejs`, vedi "Home del banco"). Pulsante da 44px col cerchio da 36px con le iniziali (partial unico `partials/comune/iniziali.ejs`,
  usato anche in cima al menu, 48px, e in anagrafica, 56px). Velo e pannello stanno **fuori dall'`<header>`**: l'appbar
  ha z-index 20 e dentro non si potrebbe stare sopra la navbar (25), che il velo deve coprire (velo 30, pannello
  31). Voci: La mia anagrafica, Storico ordini (`/storico`), Esci. **Niente "Notifiche"** (tolta su richiesta
  esplicita del 05/10/2026, non rimetterla): `/notifiche` esiste ancora ma il cliente non ha più un link per
  arrivarci (aprirla segna tutte lette, anche quelle del badge di "Stato ordini"); banco e agente hanno ancora
  la campanella (il banco nella sua barra, l'agente nell'appbar). Il sottotitolo "referente · cliente di DISTRIBUTORE" viene da `res.locals.profiloCliente`
  (`anagrafiche.intestazioneCliente`, in cache 60 s per cliente: un'approvazione appena fatta compare entro un
  minuto). Script in `app.js` ("Menu del profilo"): Esc e tocco sul velo chiudono e riportano il focus sul
  pulsante, frecce/Home/End scorrono le voci, Tab fuori dal pannello lo chiude. L'app ha lo stesso menu (`mobile/src/componenti/PulsanteAccount.tsx`, vedi «Menu del profilo» in docs/app-nativa.md): se le voci cambiano sul sito, vanno cambiate anche lì.
- **Accedi, Registrati, Benvenuto** (`views/auth/login.ejs`, `auth/registrati.ejs`, `cliente/benvenuto.ejs`, richiesta esplicita del
  05/10/2026; classi `acc-*`, `reg-*`, `ben-*`; campi dal partial `partials/comune/acc_campo.ejs`, che disegna anche
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
- **Storico ordini = materiale e quanto si deve a BOREA** (`views/cliente/storico.ejs`, `partials/cliente/storico_riquadro.ejs`, `partials/cliente/storico_ordine.ejs`; richiesta
  esplicita del 16/10/2026, sostituisce lo storico a schede del 05/10; classi `sm-*`, `st-stato`, `st-riordina`). **Dati e calcolo in `src/logica/ordini/materiale.js`**
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
  `partials/cliente/storico_richiesta.ejs`: "Richiesta #N" + data compatta, "Nessun costo" al posto dell'importo, stato + primo articolo + "+altri"; le righe vengono da `request_items` con UNA lettura per tutte, insieme
  alle altre, e hanno solo quantità e nome perché le richieste non salvano prezzi). Un riquadro blu per **ditta** (oggi una, BOREA; mai la filiale; con più ditte i chip del mese stanno
  nel primo). Per ordine: `<details>` **tutti chiusi all'arrivo** (richiesta esplicita del 18/10/2026: non riaprire il primo); "Riordina" (solo consegnati) è un form `POST /storico/:id/riordina` fuori dal `<summary>`,
  "Dettagli ›" va a `/ordini/:id`. Per articolo: righe sommate per (codice, nome, prezzo cad.), dal totale più alto. **CSV** `GET /storico/materiale.csv?mese=`: `;`, BOM UTF-8, una riga per articolo, servizio sulla prima riga di ogni
  ordine, totali in fondo, celle che cominciano per `= + - @` con un apice (nomi come "- Materiale di montaggio" esistono nel catalogo). Il banco ha un suo CSV, senza servizio
  (vedi "Clienti del banco"). Prove: `test/ordini/materiale.test.js` e i test "storico: ..." di `test/sito/*.test.js`. Il fondo pagina è 96px (`.app-storico`).
- **Verifica disponibilità** (`views/cliente/richiesta_attesa.ejs`, richiesta esplicita del 04/10/2026, non rimettere
  paragrafi di spiegazione, "Hai pagato…", pulsante notifiche): timer con anello da 148px che si **svuota**,
  tre passaggi (`<ol>`), una scheda per banco, scheda "Materiale richiesto" (`partials/cliente/richiesta_materiale.ejs`: righe a prezzo del banco con "Cod. … · € cad.", "Merce · IVA
  esclusa · prezzi del banco"), scheda **"Pagamenti"** (`partials/cliente/pagamenti.ejs`, stato `attesa` = 'bloccato': consegna AZZURRA col lucchetto "Bloccati sulla carta · addebitati solo se BOREA conferma" (la carta è solo autorizzata), materiale
  IN SOSPESO, bordo tratteggiato e importo grigio, "Lo paghi a BOREA solo se conferma"; vedi "Importi della richiesta" nel Pagamento e "Pagamenti lato installatore" sotto), "Annulla" come link **solo finché nessun banco ha accettato** (sparisce da sé, anche dal polling). Anello e
  numero sono `[data-arco]`/`[data-countdown]` come l'icona della navbar: li muove **lo stesso timer** di
  `partials/cliente/nav_ordini.ejs` (stessa durata `scade_il − creato_il`, stessa formula), per questo il numero non ha più
  `id="countdown"` e il vecchio `mostraTempo` di `app.js` non scrive più niente. Il polling di `app.js` riscrive
  testo e classe di `[data-distributore]` (`stato-badge stato-<esito>`): il puntino davanti all'etichetta è un
  `::before` di `#stato-distributori .stato-badge`, così resta; "In attesa" lì si chiama "Sta verificando" (anche
  nel polling). **Niente più "Elimina definitivamente"** (richiesta esplicita del 17/10/2026, non rimetterlo): in attesa si può solo annullare; la rotta di
  eliminazione c'è ancora e si usa dalla pagina della richiesta chiusa. Non rimettere nemmeno la riga "Pagato" né "Richiesta del … · prezzi IVA esclusa".
- **Richiesta scaduta** (`views/cliente/richiesta_chiusa.ejs`, richiesta esplicita del 05/10/2026; classi `att-*`,
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
- **Ordine in consegna** (`views/cliente/ordine_dettaglio.ejs`, richiesta esplicita del 04/10/2026; stesse classi
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
- **Orario sotto ogni fase e pillola "Arrivato in … dall'invio" (23/10/2026, richiesta esplicita)** nella scheda `.att-consegnato`: sotto Inviata · Confermata · Consegnata una riga `.att-ora` (13px bold #1C1917, cifre tabellari): "19:23", oppure "14 ott · 19:23" se il passo cade in un giorno
  italiano diverso dalla consegna (`format.oraFaseRoma(naive, consegnato_il)`); sotto la data la pillola verde `.att-arrivato` ("Arrivato in 47 min dall'invio", `format.durataArrivo`: oltre l'ora "1 h 12 min", che `durataMinuti` da sola non scrive). **Un orario mancante non si scrive** (né "—") e senza orario d'invio non c'è la pillola
  (il sottotitolo allora tiene il suo margine). Dati da `flusso.fasiOrdine(ordine, richiesta)`, in `dettaglioOrdine` → `fasi { inviata, confermata, consegnata, durataMin }` (la query della richiesta, già fatta per il pagamento, ora legge anche `creato_il`: nessuna query in più). Inviata = `requests.creato_il`, **ma con "Rinvia richiesta" vale `pagato_il`**
  se è più recente: il rinvio riapre la STESSA riga senza toccare `creato_il` e riscrive `pagato_il` (alla nascita sono lo stesso `NOW()`), quindi l'ultimo invio, quello che ha fatto nascere l'ordine, è il più recente dei due (la specifica diceva solo `creato_il`, che con un rinvio sarebbe il primo invio). Confermata = `orders.creato_il`,
  Consegnata = `consegnato_il`. Durata = minuti dall'ultimo invio alla consegna (arrotondati, almeno 1; null se non si sa o se i dati non tornano). **API** `GET /api/v1/ordini/:id`: `fasi` (ISO), `durataMin`, e in più `fasi_testo` (gli stessi orari già scritti in ora italiana, per non far fare conti sui fusi all'app) e `durata_testo` (testo della pillola);
  l'app Expo (`VistaOrdine.tsx`, ordine consegnato) mostra pillola e tre passi con gli orari (solo `tsc` provato). Prove: `test/comune/format.test.js`, `test/ordini/stato_ordini.test.js` (`fasiOrdine`), tre test "ordine consegnato…" in `test/sito/home_e_ordine_cliente.test.js`, `test/sito/stato_ordini_e_richieste.test.js`; provato anche su un Postgres locale usa-e-getta (320 e 360 px, nessuno scroll orizzontale, tre colonne da 81px uguali).
- **Ordine consegnato** (`views/cliente/ordine_dettaglio.ejs`, ramo `consegnato` = cliente + `consegnato_il`, richiesta esplicita
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
- **Icona "Stato ordini"** (`views/partials/cliente/nav_ordini.ejs`; con più attività in corso segue la **prima inviata**, vedi
  "Più ordini insieme in Stato ordini"): fase calcolata da
  `flusso.statoIconaOrdini` (sola lettura, non segna le notifiche come lette) nel `Promise.all` del
  middleware di `server.js`, per ogni pagina del cliente. Un errore non rompe la pagina ma si scrive nel
  log come `[nav] ...` (ingoiarlo in silenzio lasciava l'icona sempre uguale: così si è scoperto che
  `format.toDate` non era esportata). `/nav/stato-ordini` rende solo il link (con `?scheda=1`, dalla home,
  anche la scheda di `partials/cliente/stato_home.ejs`), per il polling dello script inline (15 s in attesa, 60 s
  in consegna). **Un solo timer** per icona e scheda: muove ogni `[data-countdown]` e `[data-arco]`
  (con `data-circ`) della pagina. La barra "in consegna" della scheda della home **avanza col tempo** (dalla
  nascita dell'ordine all'arrivo previsto, `progresso` della voce) e arriverà davvero a "Consegnato" solo con
  l'evento di consegna, **ancora da collegare**; senza orario del corriere resta **ferma a metà**
  (`PROGRESSO_IN_VIAGGIO` in `flusso_cliente.js`).
  Nel frattempo c'è un pulsante **provvisorio** "Ordine consegnato" (`POST /ordini/:id/consegnato-prova` →
  `flusso.segnaConsegnatoProva`, scrive `consegnato_il` per qualunque stato dell'ordine, quindi la scheda
  sparisce): sta **solo nella pagina dell'ordine** (`cliente/ordine_dettaglio.ejs`, "Stato ordini"; con l'ordine
  `evaso` vale invece la rotta vera `/consegnato`), **non** nella scheda della home, dove "Consegnato" è
  un'etichetta non cliccabile (richiesta esplicita del 05/10/2026, non rimetterlo). **Dopo il clic si va SEMPRE in `/ordini`**
  ("Stato ordini": l'altro ordine in corso, se c'è, altrimenti la pagina "nessun ordine in corso"), anche con la rotta vera `/consegnato`;
  richiesta esplicita del 15/10/2026, che ho prima letto al contrario: **non** riportare sulla pagina "Consegnato" dell'ordine né in
  catalogo/home (il vecchio campo `ritorno`, che senza valore finiva in home, non c'è più). La pagina "Consegnato" si raggiunge dallo
  Storico. Da togliere insieme alla rotta quando c'è l'evento vero.
- **Immagini delle categorie (22/10/2026, richiesta esplicita)**: nella griglia della home le 11 categorie con immagine mostrano `public/img/categorie/<slug>.svg` (72×60, su bianco, raggio 12, `object-fit: contain`, `alt` vuoto, `width/height` fissi; 96×80 da 720px) al posto dell'icona su azzurro; "Riscaldamento e Caldaie" ed "Elementi con foto" restano con la loro icona (`.cat-ico`, ora su BIANCO come tutte le tessere: niente più `--blu-chiaro`). `catalogo.immagineCategoria(slug)` dà l'url solo se il file esiste (stessa logica di `fotoSottocategoria`) e il controllo sta dentro `macroCategorie`/`macroCategoria` (cache 60 s): `m.immagine` url o null; un file tolto torna all'icona entro un minuto, senza errori.
  Pagina categoria: il segnaposto delle sottocategorie senza foto usa l'immagine (su bianco, ~55% del riquadro, `.sotto-segnaposto-img`), la foto vera vince. **I 5 svg arrivati (bagno, condizionamento, elettrico, ricambi, trattamento) erano XML rotto** (`stop-opacity=0.9` senza virgolette: il browser li mostrava come immagine rotta): riparati nella copia in `public/img/categorie/` (non negli originali di `docs/mockup/immagini-categorie/`), un test controlla che siano ben formati. API: `GET /catalogo` e `GET /categorie/:slug` danno `immagine` (url assoluto da `APP_URL`, o null); l'app Expo la mostra con `SvgUri` (`react-native-svg`) in un riquadro bianco 96×80, con l'icona di ripiego se manca o non si carica (solo `tsc` provato). **Ordine delle categorie**: "Riscaldamento e Caldaie" è SEMPRE l'ultima categoria (`catalogo.categorieHome`, costante `CATEGORIA_IN_FONDO`, valida per sito e app); "Elementi con foto" resta l'ultima tessera. **Foto delle sottocategorie di "Raccorderia e Valvole"** (7 webp 1200×900 in `public/img/sottocategorie/`, nome = slug, la "varie" = `raccorderia-e-valvole-varie.webp`): le prende `fotoSottocategoria` da sola; `GET /categorie/:slug` dell'API dà `foto` (url assoluto o null) e il tipo `Sottocategoria` dell'app lo ha (la lista dell'app non le mostra ancora). `/img` ha `maxAge` 7 giorni: se una foto viene SOSTITUITA con lo stesso nome serve una versione nell'url. **Niente tema scuro**: non esiste dal 02/10/2026, le regole per lo scuro del testo ricevuto non si applicano. A 360px "Tubazioni e Sistemi di Distribuzione" va su tre righe (nessun taglio, `line-clamp` 3). Prove: `test/catalogo/categorie_immagini.test.js`.
- **Home installatore** (`views/cliente/home.ejs`): ricerca fissa (`.ricerca-fissa`, `top` = `--altezza-appbar`,
  52px), un'unica griglia compatta di categorie senza conteggi, pulsante "foto/codice a barre" **volutamente
  disabilitato** (funzione non ancora esistente). I nomi delle categorie sono quelli del DB, più lunghi di
  quelli del mockup. Le tessere (ingrandite il 05/10/2026, richiesta esplicita) sono **in colonna**: icona
  52px sopra, nome sotto a 15px, alte almeno 128px. Con il nome accanto all'icona, a questa grandezza
  restavano ~85px di testo e "Condizionamento" non ci stava. Il nome può andare su **tre righe**, così
  nessuno finisce in ellissi; `Condizionamento…` ha il corpo ridotto (14px; 13px sotto i 360px di schermo,
  12px sotto i 330px: la parola misura 139px a 15px e il testo ne ha 143 a 375px, 117 a 320px).
- **Pagine vuote dell'installatore** (richiesta esplicita del 14/10/2026; `views/cliente/ordini_cliente.ejs` = "Stato ordini" senza
  attività, il ramo `!righe.length` di `views/cliente/carrello.ejs`; blocco "Pagine vuote" in fondo a `style.css`, classi
  `vuoto-*`, `cf-*`, `riga-storico`, `uo-*`, `btn-vuoto-*`): figura da 112px (cerchio `--blu-chiaro`, icona 46px a tratto
  sottile, cerchio tratteggiato `.vuoto-fig-tratt`), titolo Sora 22/800 e sottotitolo, poi in colonna con gap 22px; fondo
  pagina 96px da `.app-vuoto` (non i ~150px di `.app`). Stato ordini: furgone, scheda "Come funziona" (tre passaggi, la
  durata è `pricing.getFinestraMinuti`, non un "10" scritto a mano), "Vai al catalogo", riga "Storico ordini" (la vecchia
  frase "è nel menu account" non c'è più). Carrello: la ricerca è la stessa della home (`.barra-home`, qui `.barra-vuoto`
  alta 52px, **senza** il pulsante foto; `GET /cerca`), "Sfoglia il catalogo" e, solo se c'è un ordine consegnato,
  "Il tuo ultimo ordine" (`flusso.ultimoOrdineConsegnato`: una sola query, e solo a carrello vuoto; al massimo 3 righe,
  data `format.dataCortaRoma` = "12 set"). "Rimetti nel carrello" è il form di "Riordina" dello storico
  (`POST /storico/:id/riordina`), quindi salta gli articoli non più disponibili e torna a `/carrello` con l'avviso. Le pagine
  col carrello pieno o con un'attività in corso non cambiano. `iconaInvio` (aeroplanino) è nuova in `src/comune/icone.js`.
- **Barra in basso** (`.navbar`, richiesta del 05/10/2026, vale anche per quella del banco): pillola tonda
  (raggio 31px, ombra) sollevata di `--nav-stacco` (10px) dal fondo, con 12px di margine ai lati. Il
  contenitore `.navbar` non intercetta i tocchi, solo `.interno`. `--nav-alt` (62px) è l'altezza della pillola,
  **da aggiornare se cambia**; `--barra-bassa` = `--nav-alt` + `--nav-stacco` è lo spazio che occupa: ogni barra
  fissa che sta sopra (`.barra-vai`, `.barra-paga`, `.barra-carrello`) e il riempimento in fondo alle pagine
  (`.app`, `.app-carrello`, `.app-categoria`) partono da lì: non scrivere più un `60px` a mano.
  **iOS (21/10/2026)**: su iPhone/web app installata la barra restava a metà schermo (screenshot dell'utente, catalogo dopo l'uso della ricerca): è il viewport del layout (a cui si agganciano i `fixed`) che non coincide con quello visibile dopo la tastiera o la barra di Safari. Fix in fondo a `app.js`
  ("iPhone / web app installata"): solo su iOS misura `visualViewport.offsetTop + height − documentElement.clientHeight` e, se lo scarto è ≥ 2px (senza pinch), lo scrive in `--vv-sposta` (px), che `.navbar`, `.barra-vai` e `.barra-paga` applicano come `translateY`. Provato solo il meccanismo (variabile → spostamento esatto) nel browser incorporato; **non su un iPhone vero**.
  **"Catalogo" torna dov'eri (21/10/2026, richiesta esplicita)**: l'ultima pagina di catalogo vista (`/categoria/*`, `/marchi/*`, `/con-foto`, `/cerca`, con la query) sta in `sessionStorage` `minuteria.catalogo.<id utente>`; dalle altre pagine (carrello, Stato ordini, Storico, profilo) il tasto "Catalogo" della barra e "+ Aggiungi pezzi" del carrello (`data-torna-catalogo`) puntano lì. Aprendo `/home` la memoria si azzera, e sulle pagine di catalogo il tasto va alla home (così se ne esce). Provato nel browser (categoria → carrello → Catalogo → categoria; da lì Catalogo → home → carrello → Catalogo → home).
