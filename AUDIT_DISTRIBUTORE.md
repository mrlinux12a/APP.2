# Audit lato distributore (venditore) — 2026-09-05

Metodo: test reale end-to-end sul DB di produzione (non ipotesi da codice letto a freddo).
Ho vestito i panni dell'installatore (cliente demo "rossi"): aggiunto prodotti al carrello,
inviato una richiesta di disponibilità multi-articolo, poi vestito i panni del banco (AFIS)
per rispondere, farla scegliere dal cliente, prenderla in preparazione ed emettere la bolla.
Ho anche scorso clienti, notifiche e storico richieste con dati reali già presenti nel DB
(decine di richieste di test precedenti).

## Bug trovati e già corretti in questa sessione

Questi non sono suggerimenti: sono guasti confermati riproducendoli dal vivo. Il codice è
già stato corretto nella working directory (non committato, come da tua richiesta esplicita
di non fare mai commit/push senza permesso — li trovi con `git diff`).

1. **`config.finestra_conferma_min` era impostato a 10 *secondi* invece di 10 *minuti`**
   (valore `0.1666...`, probabile refuso di un test precedente, live sul DB di produzione).
   Conseguenza reale: **quasi tutte le richieste recenti nello storico risultano "Non
   risposta"** — nessun banco reale potrebbe mai rispondere in 10 secondi. Corretto
   riportando il valore a `10`.

2. **La pagina `/distributore/ordini/:id` andava in errore 500** (stack trace Node grezzo
   mostrato all'utente) per **qualsiasi ordine collegato a una richiesta** — cioè
   praticamente tutti. Causa: [server.js:1438-1440](server.js:1438) —
   `await richieste.calcolaOfferta(...).mancanti` legge `.mancanti` sulla Promise invece
   che sul risultato risolto (precedenza di `.` su `await`). Corretto aggiungendo le
   parentesi: `(await richieste.calcolaOfferta(...)).mancanti`.
   **Impatto**: prima di questa sessione, il banco probabilmente non riusciva mai ad aprire
   il dettaglio di un ordine collegato a una richiesta senza schiantarsi.

3. **Le notifiche al banco mostravano un numero grezzo non arrotondato**: *"Hai
   0.16666666666666666 minuti per confermare."* — bug generico (non solo conseguenza del
   punto 1: si ripresenterebbe con qualunque valore non intero di
   `finestra_conferma_min`). Corretto in [src/richieste.js:124](src/richieste.js:124) e
   [src/richieste.js:180](src/richieste.js:180) con `Math.round(minuti)`.

## Bug trovato, NON ancora corretto (serve una decisione)

4. **Il tempo di consegna mostrato al cliente nella schermata di confronto offerte è
   sbagliato quando il cliente non ha condiviso la posizione** (caso comune: è opt-in).
   Nella richiesta di prova, il banco ha dichiarato *partenza 2 ore, consegna 24 ore*, ma
   la schermata "Riepilogo offerte" mostrava **"🚚 Da te in 2 ore"** invece di 1 giorno —
   la schermata successiva (riepilogo ordine) mostra invece correttamente "1 giorno". Causa:
   [src/consegna.js:44-57](src/consegna.js:44) — `minutiStimati()`, quando non conosce la
   posizione del cliente (`km === null`), ritorna **solo** `partenzaMinuti`, scartando del
   tutto la `consegna_ore` dichiarata dal banco. Il valore sbagliato viene salvato in
   `consegna_minuti_stimati` e mostrato in
   [views/richiesta_offerte.ejs:70](views/richiesta_offerte.ejs:70).
   **Perché non l'ho corretto da solo**: non è un typo, è una scelta di comportamento —
   il fallback giusto è probabilmente `Math.max(partenzaMinuti, consegnaOreDichiarata * 60)`,
   ma andrebbe deciso insieme (es. se il banco dichiara "24 ore" intende già includere il
   viaggio, o no?). **Impatto per il venditore**: il banco dichiara un tempo di consegna nel
   modulo di risposta, e per una parte non piccola dei clienti (quelli senza geolocalizzazione
   attiva) l'app mostra ai clienti una promessa completamente diversa — un problema di
   credibilità che ricade sul banco, non sull'app.

## Almeno 10 modifiche da fare lato distributore

Elencate in ordine di impatto percepito durante il test, non di difficoltà implementativa.

1. **Correggere la stima di consegna senza geolocalizzazione** (bug #4 sopra) — priorità
   alta, è una promessa al cliente che il banco non sa di star facendo male.

2. **La schermata di risposta a una richiesta non ha un passaggio di verifica prima di
   confermare.** Il cliente, per inviare una richiesta, passa da un riepilogo esplicito
   ("Procedi" → riepilogo → "Conferma"). Il banco invece preme un solo pulsante
   ("Conferma con questi sconti e tempi") che scrive subito sconti, tempi di consegna e
   accettazione — nessun "rivedi prima di confermare". Dato che qui il banco si sta
   impegnando economicamente (sconto) e contrattualmente (tempi di consegna dichiarati),
   ha meno rete di sicurezza del cliente sullo stesso flusso.

3. **"Storico richieste" è un'unica lista lunga, senza filtri né paginazione.** Con solo
   3 clienti demo e ~40 richieste di test è già scomoda da scorrere; con un banco reale con
   decine di richieste al giorno diventa inutilizzabile in poco tempo. Manca un filtro per
   stato (Confermata / Non risposta / In attesa) e per cliente, e manca la paginazione o lo
   scroll infinito già presente lato cliente nel catalogo.

4. **Dentro "Storico richieste" compare la voce "In attesa"** per richieste che in realtà
   sono già scadute (il banco non ha più modo di rispondere) — vedere una richiesta ancora
   etichettata "In attesa" dentro quello che dovrebbe essere lo storico delle richieste
   chiuse è fuorviante: sembra ancora azionabile quando non lo è più.

5. **Il messaggio "Finestra di conferma chiusa"** compare nell'intestazione della pagina
   di dettaglio **subito dopo** che il banco ha confermato con successo — si legge come un
   avviso di errore/mancato risultato proprio nel momento in cui l'operazione è riuscita.
   Andrebbe distinto chiaramente il caso "hai risposto in tempo, ecco cosa hai confermato"
   dal caso "la finestra è scaduta senza risposta".

6. **Nessun modo di segnare tutte le notifiche come lette in blocco** (verificato nel
   codice, [views/notifiche.ejs](views/notifiche.ejs) non ha questa azione). Con l'account
   di test sono arrivate a 34 notifiche non lette in pochi giorni di utilizzo: per un banco
   reale con più clienti il campanello rischia di restare perennemente con un badge enorme
   e nessun modo rapido di "azzerarlo" dopo averle viste.

7. **La pagina Clienti non ha ricerca né filtro**, funziona bene con 3 clienti demo ma non
   scala: un distributore reale con decine o centinaia di clienti approvati dovrà scorrere
   tutto a mano per trovarne uno.

8. **Le pagine di errore mostrano lo stack trace Node grezzo all'utente** (visto di persona
   sul bug #2, prima della correzione: percorso completo del file sul disco del server,
   numeri di riga, traccia delle chiamate interne). Andrebbe sempre mostrata una pagina di
   errore generica al banco, con il dettaglio tecnico solo nei log server — sia per
   professionalità sia perché espone dettagli interni non necessari.

9. **Le icone 📦 vs 📄 nello storico richieste non hanno un significato ovvio** senza
   dedurlo da colore/testo accanto (sembra: 📦 = poi diventata un ordine, 📄 = solo
   risposta/non risposta) — o si spiega/etichetta meglio, o si toglie perché ridondante
   rispetto al badge di stato già presente.

10. **Nessuna vista d'insieme "quanto sto guadagnando/quanti pezzi mi restano da preparare
    oggi"** oltre ai 3 contatori (da confermare / da preparare / in preparazione). Per un
    banco che gestisce più clienti in parallelo, un riepilogo giornaliero (ordini evasi
    oggi, valore totale, tempo medio di risposta) aiuterebbe a capire il carico di lavoro
    senza aprire ogni richiesta/ordine singolarmente.

11. **Il modulo di risposta permette sia "sconto concordato cliente" sia "sconto per
    riga"**, con precedenza dichiarata nel README ma **non visibile nel modulo stesso** —
    se il banco applica uno sconto riga diverso da quello concordato, non c'è un avviso
    immediato del tipo "questo sovrascrive lo sconto concordato per questa riga" mentre lo
    sta scrivendo.

12. **Il tempo per rispondere è visibile ma non ci sono promemoria**: se il banco non ha
    la scheda aperta, l'unico avviso è la notifica iniziale — nessun secondo avviso (es. a
    2 minuti dalla scadenza) per richieste ancora "in attesa" quando la finestra sta per
    chiudersi, cosa che spiegherebbe anche perché nello storico ci sono così tante "Non
    risposta" indipendentemente dal bug #1.

## Nota metodologica

I punti 1-4 dei bug sono confermati con certezza (riprodotti e, per 3 su 4, risolti). I
punti nella lista "modifiche da fare" sono osservazioni dirette da test reale, non supposizioni
— ma la priorità relativa fra loro è una mia valutazione soggettiva su cosa disturba di più
un banco che usa l'app tutti i giorni: vale la pena discuterne prima di metterci mano.
