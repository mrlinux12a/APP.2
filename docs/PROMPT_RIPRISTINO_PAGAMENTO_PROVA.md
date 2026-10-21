# Prompt: togliere del tutto l'importo di prova dei pagamenti

Da incollare in una nuova sessione di Claude Code aperta nella cartella del progetto (`C:\Users\SAMSUNG\lavoro\app2\APP.2`), **quando le prove con i pagamenti da 0,50 € sono finite**.

---

```
Le prove con i pagamenti sono finite: rimuovi del tutto l'"importo di prova" dei pagamenti e riporta il calcolo a quello di sempre (formula: corriere fisso 10 € + servizio 10% della merce a prezzo del banco + IVA 22% su corriere e servizio), senza lasciare NESSUNA via con cui una variabile d'ambiente possa abbassare il prezzo. L'obiettivo è che non resti nessuna vulnerabilità.

Contesto (verifica tu nel codice, non fidarti di questo elenco):
- In src/pricing.js c'è `importoProvaApp()` con le sue costanti e funzioni di appoggio (MINIMO_STRIPE, GIORNI_MASSIMI_LIVE, avvisiProva, avvisaProva, giornoRoma) e un blocco `{ ... }` subito dopo che scrive un log all'avvio. `calcolaOrdine` lo usa con `const prova = importoProvaApp(); if (prova !== null) app.totale = Math.min(prova, app.totale);`.
- Le variabili sono PAGAMENTO_APP_PROVA (la cifra) e PAGAMENTO_APP_PROVA_LIVE (la data AAAA-MM-GG fino a cui vale con Stripe reale / NODE_ENV=production).
- Sono citate in CLAUDE.md (paragrafo "Importo di prova", dentro "Pagamenti Stripe"), nei test (test/pricing.test.js, test/server.test.js) e nel .env del PC. Questo file stesso è parte del ripristino.

Cosa fare, in ordine:
1. src/pricing.js: elimina importoProvaApp, le sue costanti e funzioni di appoggio, il blocco di log all'avvio e le due righe in calcolaOrdine. Se `require('./stripe_config')` in pricing.js serviva solo a quello (controlla con grep), toglilo. Non toccare dividiTotale né il resto del calcolo.
2. Test: in test/pricing.test.js elimina i due test su PAGAMENTO_APP_PROVA e le righe che cancellano quelle variabili all'inizio; in test/server.test.js togli PAGAMENTO_APP_PROVA e PAGAMENTO_APP_PROVA_LIVE dall'elenco delle variabili svuotate. POI aggiungi UN test di regressione in test/pricing.test.js che dimostri che NESSUNA variabile d'ambiente può più cambiare il prezzo: imposta PAGAMENTO_APP_PROVA=0.01, PAGAMENTO_APP_PROVA_LIVE=<data di domani>, STRIPE_MODO=test e poi STRIPE_SECRET_KEY=sk_live_x e NODE_ENV=production, e controlla che con merce 54,50 + 10,00 e consegna 10 `calcolaOrdine` dia sempre da_pagare_app = 20,07 e materiale_banco = 78,69 (ripristina le variabili alla fine).
3. Documentazione: togli da CLAUDE.md il paragrafo "Importo di prova" e ogni altro riferimento a PAGAMENTO_APP_PROVA / importoProvaApp (sostituiscilo con UNA riga: "Nessuna variabile d'ambiente può abbassare l'importo pagato in app: la formula è l'unica fonte, provato in test/pricing.test.js"). Controlla anche README.md e SCOPE.md. Elimina questo file (docs/PROMPT_RIPRISTINO_PAGAMENTO_PROVA.md).
4. .env del PC: rimuovi le righe PAGAMENTO_APP_PROVA e PAGAMENTO_APP_PROVA_LIVE e il loro commento (non stampare mai il contenuto del .env: tocca solo quelle righe; non scrivere le altre variabili nelle risposte). NON toccare PAGAMENTO_SIMULATO, STRIPE_* né il resto: dimmi solo se ne vedi di pericolose.
5. Verifiche finali, e riportami l'esito di ognuna:
   a. grep in tutto il progetto (esclusi node_modules e .git) di `PAGAMENTO_APP_PROVA`, `importoProvaApp`, `avvisaProva`, `MINIMO_STRIPE`: deve restare solo il test di regressione del punto 2.
   b. `npm test` tutto verde.
   c. Avvia il server in locale con PAGAMENTO_APP_PROVA=0.01 forzata nell'ambiente e controlla che il carrello mostri l'importo della formula (non 0,01).
   d. `git status` e `git diff --stat`: elenca i file toccati.
6. Non fare commit né push: dimmi tu quando sei pronto e aspetta il mio ok.

Poi scrivimi una lista di cose che devo fare IO a mano perché tu non puoi (la VPS non è raggiungibile da qui):
- Sulla VPS: aprire il suo .env, cancellare le righe PAGAMENTO_APP_PROVA e PAGAMENTO_APP_PROVA_LIVE, controllare che NON ci siano PAGAMENTO_SIMULATO né PAGAMENTO_SIMULATO_FORZA, fare `git pull`, `npm ci` e `pm2 restart minuteria`.
- Nel log di pm2 dopo il riavvio NON deve comparire nessuna riga `[config] PAGAMENTO_APP_PROVA` né `ATTENZIONE: PAGAMENTO_APP_PROVA`.
- Aprire il carrello sul sito vero con un cliente di prova (senza pagare) e controllare che "Paghi ora" mostri l'importo della formula.
- Nel Dashboard di Stripe controllare i pagamenti di prova da 0,50 € fatti con soldi veri (rimborsarli se non servono) e che non ci siano pagamenti rimasti "autorizzati" (da catturare o annullare).
- Nel DB restano gli ordini e le richieste fatti con l'importo di prova (`da_pagare_app` basso): sono storia vera, non vanno cancellati né modificati da script.
```

---

Note per te (non fanno parte del prompt):

- **Rete di sicurezza già nel codice:** con Stripe reale o `NODE_ENV=production` l'importo di prova vale solo se `PAGAMENTO_APP_PROVA_LIVE` ha una data valida (al massimo 7 giorni da oggi). Passata la data, il prezzo torna da solo a quello della formula anche se le righe restano nel `.env`. Il prompt qui sopra serve a togliere comunque tutto il meccanismo, non solo a spegnerlo.
- Per le prove sulla VPS servono, nel suo `.env`: `PAGAMENTO_APP_PROVA=0.50` e `PAGAMENTO_APP_PROVA_LIVE=<data, al massimo tra 7 giorni>`, poi `pm2 restart minuteria`. Sulla VPS non devono esserci `PAGAMENTO_SIMULATO` né `PAGAMENTO_SIMULATO_FORZA`.
