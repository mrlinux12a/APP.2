# Stripe: messa in funzione e produzione

Estratto dal [`README.md`](../../README.md) nel riordino della documentazione (31/10/2026): il testo è quello di prima. Le scelte di progetto e i dettagli del codice sono in [`docs/pagamenti.md`](../pagamenti.md).

Solo sul **sito** (l'app nativa resta sul pagamento simulato). Senza `STRIPE_SECRET_KEY` nel `.env` non cambia
niente: tutto resta simulato, anche in locale e nelle prove.

**Come funziona.** "Paga e invia richiesta" non crea più la richiesta: porta alla **pagina di pagamento del sito**
(`/pagamento/<id>`), con riepilogo e il form di Stripe (Payment Element) dentro la pagina: la carta la raccoglie Stripe
nel suo iframe e non passa dal nostro server. La carta viene solo **autorizzata**: Stripe blocca l'importo ma non lo
incassa (`capture_method: manual`). Con la carta autorizzata la richiesta nasce e parte verso i banchi, come prima.
- **Nasce l'ordine** → la carta si **incassa**, per il totale dell'ordine (se il banco ha applicato uno sconto è più
  basso dell'autorizzato; mai più alto). Da lì esiste la **ricevuta** (vedi "Ricevute, email e annullamento").
- **La richiesta si chiude senza ordine** (nessun banco, nessun corriere, annullo in fase 1) → il blocco si **rilascia**:
  non è passato un euro, nessun addebito, nessun rimborso, nessuna ricevuta. Per "Rinvia richiesta" si paga di nuovo
  (si blocca di nuovo la carta), e la stessa richiesta si riapre.
- **Il cliente non annulla mai un ordine**: dopo la conferma del banco niente annullamento (né dal sito né dall'app); per un
  problema si contatta l'assistenza, che può rimborsare dal Dashboard di Stripe (caso raro: la scheda Pagamenti dice
  "Rimborsata il … su Visa •••• 4242" e compare la "Ricevuta rimborso").

**Quali metodi di pagamento compaiono** lo decide Stripe (scelta dinamica): quelli attivi in Dashboard > Impostazioni >
Metodi di pagamento che supportano il blocco senza incasso, adatti a paese e dispositivo. Nella sandbox di prova oggi:
carta, Link, Satispay, Klarna, Amazon Pay. Si accendono e spengono dal Dashboard, senza toccare il codice (per un
cliente B2B probabilmente Klarna e simili non servono). **Apple Pay e Google Pay** compaiono da soli, ma solo in HTTPS e
su un dispositivo che li ha configurati (Apple Pay vuole anche il dominio registrato nel Dashboard): in locale
(`http://localhost`) di norma non si vedono.

I soldi arrivano sul **conto Stripe di chi ha le chiavi** (un conto solo: nessuno split verso Borea; il regolamento con
il banco resta fuori dall'app). La fattura non la fa Stripe.

**Configurazione** (`.env`, poi riavvio). Le chiavi si copiano **intere, prefisso compreso**:

```
STRIPE_SECRET_KEY=sk_test_...         # Dashboard Stripe > Sviluppatori > Chiavi API. Di prova (sk_test_) o vera (sk_live_)
STRIPE_PUBLISHABLE_KEY=pk_test_...    # la chiave pubblicabile, dello stesso ambiente (vale anche il nome STRIPE_PUBLIC_KEY)
STRIPE_WEBHOOK_SECRET=whsec_...       # del webhook (sotto)
APP_URL=https://tuodominio.it         # senza barra finale; se manca si usa l'indirizzo con cui il cliente apre il sito
```

Le chiavi **non vanno mai in git** (il `.env` non c'è nel repository). Con una chiave `sk_test_` nessun addebito è
vero. Se la chiave pubblicabile è senza prefisso (succede copiandola) il sito la completa da solo con quello della chiave
segreta e lo scrive nel log all'avvio (`[stripe] ...`): meglio correggere il `.env`. Se manca del tutto, o non ha la
forma di una chiave, al cliente mostra "Il pagamento online non è ancora configurato" invece di un form rotto. Prima di
tutto va applicato lo schema una volta (tabella `stripe_pagamenti`, vedi `CLAUDE.md`): se il database è già quello di
produzione è già stato fatto il 14/10/2026.

**Pagamento REALE e SANDBOX: due serie di chiavi e un interruttore** (dal 20/10/2026, `src/logica/pagamenti/stripe_config.js`). Nel `.env` si tengono le chiavi di **tutti e due** i modi e una riga sceglie quale vale:

```
STRIPE_MODO=live                      # live = pagamenti veri · test = sandbox di Stripe (carta 4242…) · (riga assente = come prima, vedi sotto)

STRIPE_LIVE_SECRET_KEY=sk_live_...        # Dashboard in modalità REALE > Sviluppatori > Chiavi API
STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_...
STRIPE_LIVE_WEBHOOK_SECRET=whsec_...      # il "segreto di firma" del webhook creato in modalità REALE

STRIPE_TEST_SECRET_KEY=sk_test_...        # Dashboard in modalità PROVA / sandbox
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...      # il segreto del webhook creato nella sandbox

APP_URL=https://tuodominio.it             # senza barra finale; con il modo reale DEVE essere https://
```

- **Si cambia modo con una riga** (`STRIPE_MODO=test` ↔ `live`) e `pm2 restart minuteria`; all'avvio il log dice in che modo è (`[stripe] modalità REALE…` o `PROVA…`). In sandbox la pagina di pagamento mostra "Modalità prova: nessun
  addebito reale" e le ricevute portano "Pagamento di prova (sandbox)".
- **Una chiave nel posto sbagliato non si usa mai** (per esempio `sk_test_` in `STRIPE_LIVE_SECRET_KEY`, o la vecchia `STRIPE_SECRET_KEY` reale con `STRIPE_MODO=test`): il log all'avvio lo dice. E con `STRIPE_MODO`
  scritto, se manca la chiave i pagamenti danno **errore** invece di ricadere sul pagamento simulato (che farebbe ordinare gratis). Il segreto del webhook (`whsec_`) non dice di che modo è: ogni modo vuole il suo.
- **Il vecchio `.env` con UNA serie** (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, senza `STRIPE_MODO`) continua a funzionare: il modo lo dice la chiave (`sk_live_` = reale). Senza chiavi
  e senza `STRIPE_MODO` il pagamento resta **simulato** (sviluppo sul PC).
- **Cosa succede ai pagamenti quando si cambia modo**: ogni pagamento ricorda il modo in cui è nato e un'istanza lavora solo i suoi. Un pagamento reale autorizzato e non ancora incassato, se passi a prova, **resta fermo**
  finché non torni a `live` (le autorizzazioni delle carte scadono dopo circa 7 giorni). Quindi: cambia modo quando **non ci sono richieste in attesa**.
- **Verificare senza pagare**: `node scripts/verifica/verifica_stripe.js` (o `--modo=live` / `--modo=test` per guardare l'altra serie) mostra le chiavi mascherate, segnala quelle nel posto sbagliato, chiede a Stripe di che conto sono
  (carte e bonifici abilitati) e se esiste il webhook verso `APP_URL` con gli eventi giusti. Solo lettura: non crea e non incassa niente.
- **Webhook**: se in Stripe hai un webhook per modo verso lo stesso indirizzo `https://tuodominio.it/webhooks/stripe`, va bene: il server controlla la firma col segreto del modo in uso e poi con quello dell'altro, e gli
  eventi dell'altro modo li riconosce e li scarta (niente errori che si accumulano nel Dashboard). Eventi da abilitare: `payment_intent.amount_capturable_updated` e `payment_intent.canceled`.
- **Il pagamento simulato** (`PAGAMENTO_SIMULATO=1`) è una scorciatoia **solo per il PC**, senza rete né chiavi. **Sulla VPS non deve esserci**: controlla che nel suo `.env` NON ci siano `PAGAMENTO_SIMULATO` e
  `PAGAMENTO_SIMULATO_FORZA` (con la seconda i clienti ordinano senza pagare, anche con la chiave reale). Per provare end-to-end si usa la **sandbox** (`STRIPE_MODO=test`), non il simulato.
- **Consiglio**: le chiavi **reali solo sulla VPS**. Il `.env` del PC punta al database di produzione: con `STRIPE_MODO=test` e solo le chiavi di prova non può toccare i pagamenti veri.

**Provare in locale** (modo di prova, carta `4242 4242 4242 4242`, data futura, CVC qualsiasi):
1. Account Stripe (gratuito), sandbox o modalità di prova: chiave segreta e pubblicabile **dello stesso ambiente** nel
   `.env`.
2. Facoltativo: la [Stripe CLI](https://docs.stripe.com/stripe-cli) con
   `stripe listen --forward-to localhost:3000/webhooks/stripe` stampa un `whsec_...` da mettere in
   `STRIPE_WEBHOOK_SECRET`. Senza webhook funziona lo stesso: la richiesta nasce al ritorno del cliente
   (`/pagamento/esito`) o, se ha chiuso la scheda subito dopo aver pagato, dal timer entro un minuto circa.
3. Riavviare il server, mettere materiale nel carrello, "Paga e invia richiesta": si apre la pagina di pagamento, si
   paga, si arriva alla schermata di attesa. Nel Dashboard il pagamento compare come autorizzato ma **non acquisito**
   (*uncaptured*) finché non nasce l'ordine. Altre carte: `4000 0027 6000 3184` (3-D Secure), `4000 0000 0000 9995`
   (rifiutata: si può riprovare con un'altra).
   Attenzione: il `.env` locale punta al **database di produzione**, quindi la richiesta di prova arriva ai banchi
   veri come ogni prova in locale (vedi `CLAUDE.md`).

**Messa in produzione.**
1. **HTTPS con un dominio davanti al sito è obbligatorio**: Stripe.js in modalità reale funziona solo in HTTPS, e il
   webhook in modalità reale accetta solo indirizzi `https://`. Vedi `docs/SCOPE.md`.
2. Attivare l'account Stripe (dati dell'azienda e IBAN) e prendere le chiavi `sk_live_...` e `pk_live_...`.
3. Dashboard > Sviluppatori > Webhook > aggiungere `https://tuodominio.it/webhooks/stripe` con gli eventi
   `payment_intent.amount_capturable_updated` e `payment_intent.canceled`, e copiare il segreto `whsec_...`.
4. Nel `.env` della VPS: `STRIPE_MODO=live`, le chiavi `STRIPE_LIVE_*` (e, se vuoi poter tornare in sandbox, anche `STRIPE_TEST_*`), `APP_URL`; **togli** `PAGAMENTO_SIMULATO` e `PAGAMENTO_SIMULATO_FORZA` se ci sono; poi `node scripts/verifica/verifica_stripe.js --modo=live`; `npm ci`
   (c'è la dipendenza `stripe`) e `pm2 restart minuteria`. **Un solo processo** per chiave: due istanze con la stessa
   chiave lavorano gli stessi incassi (le chiamate a Stripe sono idempotenti, ma meglio non provarci).
5. Dashboard > Impostazioni > Metodi di pagamento: scegliere i metodi da offrire (la **carta** deve esserci). Per
   Apple Pay registrare il dominio.

**Cosa guardare se qualcosa non torna.** Ogni tentativo di pagamento è una riga di `stripe_pagamenti` (`stato`,
`motivo`, `errore`, `tentativi`, `payment_intent_id`): le righe `da_verificare` sono incassi, rilasci o rimborsi che
non sono riusciti 30 volte e vanno guardati a mano nel Dashboard. Il log del server riporta `[stripe] ...`.

## Ricevute, email e annullamento

**Cosa vede l'installatore** (scheda "Pagamenti", `partials/cliente/pagamenti.ejs`; lo stato lo calcola `pagamenti.statoPagamento`):
- **Richiesta in attesa** — consegna azzurra "Bloccati sulla carta · addebitati solo se {ditta} conferma", materiale tratteggiato
  "Lo paghi a {ditta} solo se conferma". Nessuna ricevuta. Resta solo "Annulla la richiesta".
- **Ordine nato** — la carta è incassata: consegna verde "Pagata il 15/10 · Visa •••• 4242" con il link **Ricevuta**; materiale
  "Lo paghi a {ditta} con la sua fattura".
- **Nessuna risposta, o annullata da lui** — UNA riga grigia "Nessun addebito · € 0,00": niente furgone, niente verde, niente
  ricevuta, pillola "Nessun addebito sulla carta".

**Annullamento solo in fase 1**: richiesta in attesa **e** nessun banco ha ancora accettato (anche se il corriere non ha risposto).
Il controllo sta dentro la `UPDATE` (e la riga si blocca prima), così una conferma e un annullamento insieme non si incrociano;
il link sparisce da solo appena un banco conferma. Un ordine non si annulla mai: il sito rifiuta con "Il banco ha già confermato:
l'ordine non si può più annullare. Per problemi contatta l'assistenza.", e l'API dell'app dice sempre `annullabile: false`.

**Ricevuta.** Al momento dell'incasso si salvano su `stripe_pagamenti` l'indirizzo della ricevuta di Stripe, marca e ultime 4
cifre della carta e l'istante dell'incasso, e si assegna il numero della **ricevuta nostra** (`R-AAAA-NNNNNN`, progressivo per anno
e per tipo, tabella `ricevute`). Il PDF (`pdfkit`, A4) si apre da `GET /ordini/:id/ricevuta.pdf` (e `…/ricevuta-rimborso.pdf`),
solo per il cliente proprietario e solo per un pagamento **incassato**: nessuna ricevuta per un blocco annullato o per una
richiesta in attesa. C'è anche per i pagamenti **non reali** (simulato dell'app e del PC, Stripe con la chiave di prova), con scritto
"Pagamento di prova (sandbox): nessun addebito reale."; il numero è lo stesso progressivo dei veri. Nello Storico: "Ricevute del mese" (`GET /storico/ricevute.pdf?mese=AAAA-MM`: un
solo PDF con una pagina per ricevuta) e il link "Ricevuta" in ogni ordine incassato. Stripe manda per conto suo la propria
ricevuta via email all'incasso (`receipt_email` sul PaymentIntent), ma **solo in modalità reale**.

**Dati dell'azienda** (nel `.env`, mai nel codice; tutto facoltativo, quello che manca non si stampa):

```
AZIENDA_NOME=Minuteria                 # logo e intestazione dell'email (default "Minuteria")
AZIENDA_SOTTOTITOLO=Consegna materiale in cantiere
AZIENDA_RAGIONE_SOCIALE=...            # "EMESSA DA" nella ricevuta
AZIENDA_INDIRIZZO=Via ..., 16100 Genova (GE)
AZIENDA_PIVA=...
AZIENDA_EMAIL=assistenza@...           # in fondo alla ricevuta
RICEVUTA_NOTA_FISCALE=...              # riga di nota fiscale, DA FAR CONFERMARE AL COMMERCIALISTA; se manca non si stampa
```

**Email "Pagamento ricevuto"** (`src/logica/notifiche/email.js`, nodemailer). Parte dopo l'incasso, **senza mai bloccarlo** (se fallisce si scrive
nel log e basta). Senza `SMTP_HOST` non parte niente:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587                          # con TLS diretto (465) anche SMTP_SECURE=1
SMTP_USER=...
SMTP_PASS=...
EMAIL_DA=Minuteria <ordini@tuodominio.it>   # facoltativa: se manca "Nome" <SMTP_USER>
```

I pulsanti della mail ("Scarica la ricevuta", "Segui l'ordine") usano `APP_URL`; senza non compaiono.

**Messa in produzione di questa parte**: lo schema (blocco "Ricevute di pagamento e dati della carta" in fondo a
`db/schema.sql`: 4 colonne nuove su `stripe_pagamenti` e la tabella `ricevute`) è **già applicato al database condiviso**
(19/10/2026, e la VPS usa lo stesso); in un altro database va applicato **prima** del riavvio di pm2. Sulla VPS: `npm ci`
(nuove dipendenze `pdfkit` e `nodemailer`) e le righe del `.env` qui sopra. Anche se lo schema mancasse, l'incasso non
si ferma: ricevuta e dati della carta sono "best effort" (errore nel log, nessun effetto sui soldi).

> **L'app nativa paga con Stripe dal 19/10/2026** (foglio di pagamento, PaymentSheet): con Stripe acceso `POST /api/v1/richieste` e
> `/richieste/:id/reinvia` non creano più la richiesta ma il pagamento, e la richiesta nasce a carta autorizzata (`GET /api/v1/pagamenti/:id`,
> webhook o timer: la stessa logica del sito). Prima chi ordinava dall'app non pagava niente. Il foglio su un telefono vero non è stato provato
> (vedi `mobile/ANDROID.md`).
