# Ordini Minuteria — MVP

App per digitalizzare gli ordini di materiale termoidraulico tra installatori pilota e
distributori. Due superfici: il **sito** (vista cliente pensata per il telefono, vista banco,
vista agente da scrivania) e l'**app nativa** dell'installatore in `mobile/` (vedi "App nativa").

## Avvio in locale

Richiede **Node.js 22.5 o superiore**.

```
npm install
npm start
```

Apri `http://localhost:3000`. Il DB di produzione ha già utenti e catalogo: `npm run seed`
(dati demo, idempotente) serve solo su un DB vuoto, e **riscrive le password degli utenti demo**
ai valori della tabella qui sotto. `npm install` non lo lancia più.

Sulla tua macchina `.env` punta al **Supabase Postgres di produzione condiviso**: `npm start` in
locale scrive quindi sul DB vero. Il database è solo Postgres (SQLite non esiste più): senza `DATABASE_URL`
nel `.env` l'app prova un Postgres locale di default (`postgres://minuteria:minuteria@localhost:5432/minuteria`).

## Produzione (VPS)

Il sito gira su una VPS con Node.js 22.5 o superiore, collegata allo stesso Supabase. `.env` non è
nel repository: va creato a mano sul server con

```
DATABASE_URL=...      # stringa di connessione Postgres (pooler di Supabase)
SESSION_SECRET=...    # firma i cookie di login: se cambia, tutti devono rifare l'accesso
PORT=3000             # facoltativa
HOST=127.0.0.1        # facoltativa: indirizzo su cui ascolta. Di default solo il computer stesso; in LOCALE, per aprire il
                      #   sito dal telefono sullo stesso Wi-Fi, 0.0.0.0 (all'avvio stampa gli indirizzi da digitare)
DISTRIBUTORE_PREDEFINITO=BOREA SRL   # facoltativa: a chi si collegano i nuovi clienti (vedi "Registrazione e approvazione")
STRIPE_SECRET_KEY=sk_...             # facoltative, vedi "Pagamenti con Stripe": con la chiave il sito paga con Stripe,
STRIPE_PUBLISHABLE_KEY=pk_...        #   senza resta simulato (la pubblicabile serve al form di pagamento)
STRIPE_WEBHOOK_SECRET=whsec_...
PAGAMENTO_SIMULATO=1  # SOLO nel .env del PC, MAI sulla VPS: "Paga e invia" salta Stripe (pagamento simulato). Sulla VPS è ignorata
                      #   comunque con la chiave reale (sk_live_) o con NODE_ENV=production, ma la riga non ci deve stare
PAGAMENTO_SIMULATO_FORZA=1  # SOLO se vuoi il bypass ANCHE sulla VPS (con PAGAMENTO_SIMULATO=1): salta Stripe pure con sk_live_ e produzione,
                      #   quindi i clienti veri ordinano SENZA pagare. All'avvio il log scrive ATTENZIONE. Per spegnerlo: togli una riga e riavvia pm2
APP_URL=https://tuodominio.it        # indirizzo pubblico del sito, per il ritorno da Stripe
PUSH_ATTIVO=0         # facoltativa: spegne le notifiche push (app Android e notifiche ad app chiusa del sito); di default accese
EXPO_ACCESS_TOKEN=... # facoltativa: solo se nel progetto Expo è attiva la "sicurezza avanzata" delle push
VAPID_PUBLIC_KEY=...  # notifiche ad app chiusa del sito/web app (Android e iPhone): una coppia di chiavi per ogni ambiente, la genera
VAPID_PRIVATE_KEY=... #   `node scripts/genera_chiavi_vapid.js` (la privata è un segreto: solo nel .env, mai in git né in chat)
VAPID_SUBJECT=mailto:contatto@tuodominio.it  # contatto per i servizi push (Google, Apple, Mozilla): mailto: o https://; se APP_URL è https si può omettere
```

**Il proxy davanti al sito deve passare l'indirizzo vero del cliente** (`X-Forwarded-For`) e il protocollo (`X-Forwarded-Proto`): il server si fida di UN solo proxy
(`trust proxy 1`) e da lì ricava l'indirizzo su cui contare i tentativi di accesso e le registrazioni, e se la richiesta è HTTPS (HSTS, cookie `Secure`). Con nginx:
`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` e `proxy_set_header X-Forwarded-Proto $scheme;`. Con DUE proxy in fila (per esempio Cloudflare + nginx)
`trust proxy` va portato a 2 in `server.js`, altrimenti tutti i clienti sembrano arrivare dallo stesso indirizzo. Il server resta in ascolto su `127.0.0.1`: non esporlo direttamente.

Il processo gira sotto **pm2** (nome `minuteria`). Per aggiornare dopo un nuovo commit:

```
git pull
npm ci
pm2 restart minuteria
```

`npm ci` non si può saltare: le dipendenze cambiano (es. `compression`, `baileys`) e senza il
server non parte. Node non rilegge il codice da solo: dopo ogni `git pull` serve il riavvio. Se il
commit tocca lo schema (`db/postgres/schema.sql`), il blocco nuovo si applica una volta sola (vedi
`CLAUDE.md`). Resta da fare l'HTTPS con un dominio davanti al sito (vedi `SCOPE.md`): serve anche
perché funzionino il service worker (`public/sw.js`), le notifiche su Chrome Android e l'installazione
sulla schermata Home (`public/manifest.webmanifest`); in HTTP semplice il sito va, ma senza queste tre cose.

Le prove automatiche (`npm test`, senza dipendenze nuove) non toccano il database vero: vedi la sezione
«Audit web del 05/10/2026» di `CLAUDE.md`.

## Credenziali demo

| Ruolo        | Utente     | Password   | Chi è |
|--------------|------------|------------|-------|
| Cliente      | rossi      | cliente123 | Rossi Impianti Srl |
| Cliente      | bianchi    | cliente123 | Idraulica Bianchi |
| Cliente      | verdi      | cliente123 | Termoidraulica Verdi |
| Distributore | fegino     | banco123   | Dipendente Borea, filiale Fegino |
| Distributore | staglieno  | banco123   | Dipendente Borea, filiale Staglieno |
| Distributore | borea      | banco123   | Borea (vecchio utente unico, filiale Fegino) |
| Agente       | agente     | agente123  | Grossista / gestore |

Solo per il test interno (verificate valide sul DB il 30/09/2026): vanno cambiate prima di far
provare l'app ai clienti pilota. Sono account con storico vero: per provare cose nuove conviene
un utente di prova a parte (vedi `CLAUDE.md`).

`afis`, `cambielli` e `fidra` sono **disattivati** dal 30/09/2026 (`attivo = 0` su distributore e
utente, storico intatto): per ora l'unico banco è Borea. Si riattivano rimettendo `attivo = 1`.
Il seed (`npm run seed`) li ricrea e riattiva: non lanciarlo sul DB condiviso.

## Catalogo

**27.676 prodotti attivi** in 13 macro categorie (`macro_categorie`), ognuna con le sue
sottocategorie. La relazione prodotto ↔ sottocategoria è molti-a-molti
(`product_sottocategorie`: un articolo può stare in più sottocategorie) e si ricalcola con
`node scripts/assegna_sottocategorie.js`. Prodotti con lo stesso nome e misure diverse sono
raggruppati in una sola card con la scelta della misura (`product_groups`).

Il cliente arriva a un pezzo per categoria → sottocategoria → elenco paginato, oppure con la
**ricerca**: testuale libera, parziale, tollerante ai refusi. Non ci sono chip di filtro
(rimossi per scelta esplicita) e la misura non è una colonna: si ricava dal testo del nome, con
i sinonimi pollici↔mm (dettagli in `CLAUDE.md`).

## Ordine minimo e spedizione

Ordine minimo **€ 33** di merce, calcolata sui prezzi già maggiorati del servizio e IVA
esclusa. La **spedizione di € 5** (il corriere, già prezzo finale) si somma dopo e non concorre a raggiungere la soglia.
Entrambi i valori stanno in `config` (`ordine_minimo`, `spedizione_fissa`). Il **servizio** (10% della merce) si
paga in app **con l'IVA dentro**: con merce 64,50 € sono 5,00 + 7,87 = **12,87 €** (di cui IVA 2,32), senza una riga IVA a parte.

## Registrazione e approvazione

La pagina di ingresso ha due schede: **Accedi** e **Registrati**.

Chi si registra compila l'anagrafica completa della propria impresa o ditta individuale in **tre
passi** (un solo modulo, mostrato un passo alla volta da `public/app.js`; senza JavaScript i tre
blocchi si vedono insieme): *La tua impresa* (forma giuridica, ragione sociale, referente, contatti),
*Dati di fatturazione* (**partita IVA, codice fiscale, sede legale, CAP, città, provincia, codice SDI
o PEC**) e *Accesso* (nome utente e password). Non sceglie il distributore: ogni nuovo cliente è
collegato automaticamente al **distributore predefinito**, con tutte le sue filiali. Finita la
registrazione si apre `/benvenuto` (anagrafica pronta, distributore, "Vai al catalogo").

Il distributore predefinito è **BOREA SRL**. Per cambiarlo, nel `.env`:

```
DISTRIBUTORE_PREDEFINITO=BOREA SRL    # nome della ditta (come in distributors.nome) oppure l'id di una sua filiale
```

Se non corrisponde a nessun banco attivo la registrazione riesce lo stesso, senza legami, e il
server scrive un errore nel log (`[registrazione] distributore predefinito ... non trovato`).

**Per ora l'approvazione è automatica** (da metà ottobre 2026): chi si registra entra subito fra i
**clienti approvati** di tutte le filiali del distributore predefinito (legame `approvato`, anagrafica
`attivo`), senza conferma del banco e senza notifiche di approvazione. Si torna alla conferma a mano con
`APPROVAZIONE_AUTOMATICA=0` nel `.env` (e riavvio): allora a ogni filiale arriva la notifica
*"Nuova anagrafica da approvare"*, e il distributore apre la scheda del cliente, vede tutti i dati fiscali
e decide: **approva** (indicando il proprio codice cliente) o **rifiuta** se non lo riconosce. I clienti già
registrati prima del cambio e ancora in attesa restano tali finché il banco non decide (pagina Clienti).
Nella pagina di un cliente approvato il banco vede **tutto il materiale che ha ordinato** (ogni ordine, con prezzi IVA inclusa,
filtro per mese e CSV): è ciò che deve incassare, perché in app l'installatore paga solo il servizio. Gli **sconti concordati**
non si impostano più da lì (vedi "Sconti al banco").

> **Non ancora applicato**: il codice non blocca né filtra sulla base dell'approvazione — un
> cliente registrato ma non approvato da nessun banco può comunque inviare richieste, e queste
> arrivano a **tutti** i distributori attivi, non solo a quelli che l'hanno approvato
> (nessuna funzione filtra i banchi per approvazione). Il
> comportamento inteso ("finché nessuno approva non può ordinare") non è quello reale:
> verificarlo prima di contarci in produzione.

## Pagamenti con Stripe

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

**Pagamento REALE e SANDBOX: due serie di chiavi e un interruttore** (dal 20/10/2026, `src/stripe_config.js`). Nel `.env` si tengono le chiavi di **tutti e due** i modi e una riga sceglie quale vale:

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
- **Verificare senza pagare**: `node scripts/verifica_stripe.js` (o `--modo=live` / `--modo=test` per guardare l'altra serie) mostra le chiavi mascherate, segnala quelle nel posto sbagliato, chiede a Stripe di che conto sono
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
   webhook in modalità reale accetta solo indirizzi `https://`. Vedi `SCOPE.md`.
2. Attivare l'account Stripe (dati dell'azienda e IBAN) e prendere le chiavi `sk_live_...` e `pk_live_...`.
3. Dashboard > Sviluppatori > Webhook > aggiungere `https://tuodominio.it/webhooks/stripe` con gli eventi
   `payment_intent.amount_capturable_updated` e `payment_intent.canceled`, e copiare il segreto `whsec_...`.
4. Nel `.env` della VPS: `STRIPE_MODO=live`, le chiavi `STRIPE_LIVE_*` (e, se vuoi poter tornare in sandbox, anche `STRIPE_TEST_*`), `APP_URL`; **togli** `PAGAMENTO_SIMULATO` e `PAGAMENTO_SIMULATO_FORZA` se ci sono; poi `node scripts/verifica_stripe.js --modo=live`; `npm ci`
   (c'è la dipendenza `stripe`) e `pm2 restart minuteria`. **Un solo processo** per chiave: due istanze con la stessa
   chiave lavorano gli stessi incassi (le chiamate a Stripe sono idempotenti, ma meglio non provarci).
5. Dashboard > Impostazioni > Metodi di pagamento: scegliere i metodi da offrire (la **carta** deve esserci). Per
   Apple Pay registrare il dominio.

**Cosa guardare se qualcosa non torna.** Ogni tentativo di pagamento è una riga di `stripe_pagamenti` (`stato`,
`motivo`, `errore`, `tentativi`, `payment_intent_id`): le righe `da_verificare` sono incassi, rilasci o rimborsi che
non sono riusciti 30 volte e vanno guardati a mano nel Dashboard. Il log del server riporta `[stripe] ...`.

### Ricevute, email e annullamento

**Cosa vede l'installatore** (scheda "Pagamenti", `partials/pagamenti.ejs`; lo stato lo calcola `pagamenti.statoPagamento`):
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

**Email "Pagamento ricevuto"** (`src/email.js`, nodemailer). Parte dopo l'incasso, **senza mai bloccarlo** (se fallisce si scrive
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
`db/postgres/schema.sql`: 4 colonne nuove su `stripe_pagamenti` e la tabella `ricevute`) è **già applicato al database condiviso**
(19/10/2026, e la VPS usa lo stesso); in un altro database va applicato **prima** del riavvio di pm2. Sulla VPS: `npm ci`
(nuove dipendenze `pdfkit` e `nodemailer`) e le righe del `.env` qui sopra. Anche se lo schema mancasse, l'incasso non
si ferma: ricevuta e dati della carta sono "best effort" (errore nel log, nessun effetto sui soldi).

> **L'app nativa paga con Stripe dal 19/10/2026** (foglio di pagamento, PaymentSheet): con Stripe acceso `POST /api/v1/richieste` e
> `/richieste/:id/reinvia` non creano più la richiesta ma il pagamento, e la richiesta nasce a carta autorizzata (`GET /api/v1/pagamenti/:id`,
> webhook o timer: la stessa logica del sito). Prima chi ordinava dall'app non pagava niente. Il foglio su un telefono vero non è stato provato
> (vedi `mobile/ANDROID.md`).

## Punti vendita sulla mappa

`/punti-vendita` mostra i banchi su mappa. **Dal 14/10/2026 il banco non l'ha più**: tolta dal suo menu e
la rotta risponde 404 al ruolo `distributore`; per gli altri ruoli esiste ancora, ma nessun menu la linka.
`store_locations` ha oggi **2
righe**: le filiali Borea (Fegino e Staglieno), con coordinate OpenStreetMap; da lì leggono anche
la stima di consegna e il messaggio ai corrieri. Gli altri punti vendita (AFIS, Cambielli, Fidra,
disattivati) non hanno più un punto vendita nel database: lo script che li caricava
(`db/punti_vendita.js` e `db/postgres/geocodifica.js`) è stato eliminato il 24/10/2026 (resta nella cronologia di git).

## Il flusso, passo per passo

**Cliente** (sito da telefono, oppure app nativa: stesse regole, condivise in
`src/flusso_cliente.js`)

1. **Home** — barra di ricerca e macro categorie.
2. **Ricerca parziale** — basta un frammento di parola: scrivendo `valv` escono tutte le valvole.
   Cerca in nome, codice, categoria, marchio ed EAN e parte mentre si digita. La stessa barra
   c'è in ogni elenco, limitata a ciò che si sta sfogliando (dentro una sottocategoria si cerca
   solo lì).
3. **Scelta del materiale** — con gli stepper +/− si prepara la selezione; il tasto **Aggiungi**
   in basso la sposta nel carrello.
4. **Carrello e pagamento** — per ogni articolo `2 × € 59,95 / cad. → € 119,90` con stepper e
   *Rimuovi*; **Svuota carrello** è un tasto piccolo e rosso in alto a destra, con conferma. Sotto:
   destinazione della merce (di partenza l'indirizzo di consegna abituale), note per il distributore
   e, in fondo, il riepilogo (merce, RAEE, spedizione, imponibile, IVA, **totale da pagare**) e
   **Paga e invia la richiesta**, attivo solo con l'ordine minimo raggiunto. Il pagamento è
   **Stripe** sul sito se nel `.env` c'è `STRIPE_SECRET_KEY` (vedi "Pagamenti con Stripe"), altrimenti
   **simulato** (nessun provider né addebito; è anche quello dell'app senza Stripe): `src/pagamenti.js`, colonne
   `pagamento_*` su `requests`. Va restituito se la richiesta si chiude senza ordine. Consegna sempre con il
   corriere: il ritiro al banco non esiste più.
5. **Attesa** — la richiesta parte verso **tutti i distributori attivi** (non filtrata per zona
   né per copertura). Hanno **10 minuti** (`finestra_conferma_min`) per confermare la
   disponibilità e, con il gruppo WhatsApp acceso, trovare un corriere. Il cliente vede un
   countdown e lo stato di ogni banco: può chiudere la schermata. Può mandare altre richieste anche
   con una già in attesa o un ordine in consegna ("Stato ordini" le segue tutte); può annullarla
   (solo **finché nessun banco ha accettato**: il blocco sulla carta si toglie, nessun addebito).
6. **Ordine automatico** — l'installatore **non sceglie né conferma più niente**. L'ordine nasce da
   solo quando una risposta del banco diventa valida: appena **un corriere prende la consegna**
   nel gruppo (vedi "Gruppo WhatsApp dei corrieri") o, a modulo spento, appena il banco accetta.
   All'installatore arriva "Ordine confermato" con il tempo di consegna stimato (quello scritto
   dal corriere). Se nessun banco accetta o nessun corriere prende la consegna entro la finestra,
   la richiesta si chiude ("Nessuna conferma ricevuta"), il **blocco sulla carta si toglie** (nessun
   addebito) e si può reinviare (si blocca di nuovo la carta).
7. **Stato ordini** — mostra sempre e solo l'attività più rilevante (in attesa > in consegna >
   senza risposta); una richiesta senza risposta ci resta **10 minuti dalla scadenza**, ciascuna per
   conto suo (anche con altre richieste in corso), poi sparisce e si passa alla prossima attività o
   alla pagina vuota; lo **Storico** ha tutto il resto (le richieste annullate si vedono ma non si aprono). Sul sito l'icona nella barra in basso segue la
   fase: anello con conto alla rovescia (in attesa), furgone con i minuti all'arrivo (in consegna),
   "!" (nessuna risposta). Un ordine **non si annulla mai** dall'app o dal sito: il banco ha già
   confermato e la carta è incassata (per un problema, l'assistenza).

**Distributore** (banco, telefono) — profili AFIS, BOREA, CAMBIELLI e FIDRA.

1. **Richieste** — quelle da confermare con il tempo che resta, e i contatori del banco (da
   confermare / da preparare / in preparazione).
2. **Risposta** — due sole azioni: **Accetta ordine** (copre tutto alle condizioni standard del
   proprio listino) o **Rifiuta: merce non disponibile**. Partenza (2 ore) e consegna stimata
   (6 ore) sono valori fissi finché non arriva un corriere collegato via API. Chi non risponde
   entro la finestra risulta "non risposta", che **non** vale come disponibilità.
3. **Ordini** — l'ordine entra in *Da preparare* → *Preparato* (la merce è pronta per il
   corriere: l'ordine passa *In consegna* e il cliente è avvisato). Il banco vede l'orario in cui il
   corriere arriva da lui (il tempo scritto su WhatsApp). Il cliente non annulla un ordine già confermato.
4. **Dati del cliente** — su richiesta e ordine l'anagrafica completa dell'ordinante.

**Agente** — login → lista di tutti gli ordini (cliente, distributore, data, importi, stato) →
dettaglio riga per riga. Sola lettura.

## Marchi e listini dei produttori

I listini dei produttori si caricano da Excel con un importatore generico, idempotente
(rilanciarlo aggiorna, non duplica):

```
node db/postgres/importa_listino.js --marchio toshiba --file "listino.xlsx" --sconto 30
```

Per ogni prodotto importa codice, descrizione, famiglia, EAN, contributo RAEE, refrigerante,
F-GAS e GWP, e crea le righe di listino per ogni banco (senza, nessuno può confermare il
marchio). Un marchio nuovo richiede una voce in `MARCHI` dentro lo script, con la mappatura
delle colonne.

> **Stato attuale**: nel DB non ci sono marchi attivi né prodotti Toshiba; la sezione `/marchi`
> esiste ma è vuota e nessuna pagina la collega (l'app nativa non la mostra). Lo sconto
> `--sconto` è di configurazione, non le condizioni commerciali reali.

## Foto prodotto

`/con-foto` è una vetrina trasversale: mostra tutti i prodotti che hanno una `foto_url`, senza
toglierli dalle loro categorie. Si popola da sola. Oggi sono **6.118** prodotti con foto:
826 Effebi (import manuale) e 5.292 estratti dai listini PDF di Caleffi, Wavin, Grohe, Giacomini
e Fischer, abbinando il codice fornitore stampato accanto a ogni foto al `codice_fornitore` a DB
(Ariston escluso: layout non affidabile). Ogni catalogo ha regole di layout diverse e i
risultati sono stati verificati a campione prima di scrivere sul DB.

File in `public/img/prodotti/<marca>_<codice_fornitore>.webp`; `NULL` in `foto_url` non rompe
nulla, la card mostra lo spazio vuoto.

## Sconti al banco

Nella risposta a una richiesta il distributore **non** ha un modulo per scontare: accetta tutto
al prezzo standard del proprio listino o rifiuta. Le **regole di sconto per ambito** già salvate
restano nel DB (`client_discount_rules`) e la rotta `POST /distributore/clienti/:id/sconti` esiste ancora, ma
dal 18/10/2026 la pagina del cliente **non ha più il modulo** per modificarle (da decidere se eliminarle del
tutto). Erano anche **a scalare** su 5 colonne (40+10+5 = 48,7%):

| Ambito | Esempio | Precedenza |
|---|---|---|
| Linea di prodotto | TOSHIBA · RAS | 1ª (vince) |
| Marchio | TOSHIBA | 2ª |
| Categoria merceologica | Condizionamento | 3ª |
| Generale | tutto il catalogo | 4ª |

Vale sempre la regola più precisa; dove non c'è nessuna regola resta lo sconto Base del listino
del banco. Svuotando un campo la regola sparisce. Oggi sono solo un riferimento di lettura quando
il banco risponde (`righeDistributore` in `src/richieste.js`): il codice per applicarli riga per
riga esiste ancora (`rispondi()` accetta `sconti`/`scontoCliente`) ma nessuna route lo richiama.

## Anagrafica del banco e orari

Dalla tendina del cerchio con le iniziali (in alto a destra) il banco apre **Anagrafica del banco** (`/distributore/anagrafica`): i dati della ditta
(valgono per tutte le filiali: ragione sociale, partita IVA, SDI/PEC, sede legale), quelli della filiale (nome, telefono, indirizzo di ritiro, email, zona,
posizione sulla mappa), gli **orari**, l'accesso (email e cambio password) e gli interruttori di suoni e notifiche del computer. Il banco ha un solo profilo,
con tutti i permessi.

- **Orari**: fuori orario (ora di Roma) le richieste non arrivano a quella filiale. Senza orari impostati è sempre aperta. Se **tutte** le filiali sono chiuse
  l'installatore non può pagare: nel carrello il pulsante dice "Il banco è chiuso · riapre giovedì alle 07:30" e il server rifiuta comunque l'invio (anche
  "Rinvia richiesta").
- **Posizione**: è **fissa**, quella scritta nel DB (`distributors.geo_*` e `store_locations.geo_*`). Cambiare l'indirizzo di ritiro dalla pagina non la ricalcola e non c'è nessun modo di spostarla da lì.
- **Schema**: servono le colonne `distributors.orari` ed `email_nuove_richieste` (`geo_manuale` c'è ma non si usa più; blocco "Anagrafica del banco" in fondo a
  `db/postgres/schema.sql`): sulla VPS applicarlo **prima** di riavviare, con
  `node scripts/applica_blocco_schema.js "-- Anagrafica del banco: orari"` (a secco) e poi con `--applica`.

## Password dimenticata, cambio password ed eliminazione dell'account (installatore)

- **Password dimenticata?** (sul login): l'installatore scrive nome utente o email e riceve un link, valido un'ora e una volta sola, per scegliere una nuova password. Dopo il cambio escono tutte le sessioni
  e l'app deve rifare l'accesso. **Serve l'invio email**: nel `.env` della VPS `SMTP_HOST` (e `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_DA`, vedi `src/email.js`) e `APP_URL=https://tuodominio.it` (il link
  si costruisce da lì, mai dall'indirizzo con cui arriva la richiesta). Senza, in produzione non parte niente. In locale, senza SMTP, il link compare nel log del server.
- **La mia anagrafica → Accesso**: cambio della password da dentro (con quella attuale). **Elimina account**: pagina di conferma con la password; si disattiva e si anonimizzano i dati personali, restano
  ordini e ricevute. Con una richiesta o un ordine in corso non si può.
- **Schema**: tabella `recupero_password` (blocco "Recupero della password dell'installatore" in fondo a `db/postgres/schema.sql`): applicarla sul DB condiviso **prima** di riavviare, con
  `node scripts/applica_blocco_schema.js "-- Recupero della password dell'installatore"` (a secco) e poi con `--applica`.

## Contributo RAEE

I listini dichiarano i prezzi IVA, trasporto e RAEE esclusi. Il contributo RAEE per articolo si
importa insieme al prodotto e compare come **voce separata** in riepilogo e ordine.

## Posizione

**Sul sito** la posizione dell'installatore è quella dell'**indirizzo di consegna che manda nel form di pagamento** del carrello.
L'indirizzo parte vuoto e **la posizione non si chiede all'ingresso**: l'installatore ha due modi per darlo, scriverlo (il server ne
ricava la posizione) oppure toccare il **mirino accanto al campo**, che legge la posizione del dispositivo
(`navigator.geolocation`, da sito e da web app, su iPhone, Android e computer; serve HTTPS o localhost), la trasforma in indirizzo
(`GET /api/indirizzo`, OpenStreetMap) e manda le coordinate col pagamento. Il sito deve permettere la posizione al browser:
l'intestazione `Permissions-Policy` ha `geolocation=(self)` (con `geolocation=()` non funzionerebbe mai). **Senza un indirizzo non si può inviare.** Da quella posizione,
quando il banco accetta, si calcola il tragitto banco → installatore che si somma ai minuti del corriere. **L'app Android non
la manda ancora.**

Finché un account non ne ha una, vale la sede provvisoria: tutti gli installatori in **Via Puggia 22/3,
Genova** (`src/sede_installatori.js`), usata anche come indirizzo di consegna. I banchi usano il punto vendita
(`store_locations`). Chi è già iscritto si allinea con `node scripts/imposta_installatori_puggia.js`
(prova a secco, `--applica` per confermare); chi si iscrive da ora la riceve da solo. Il tragitto lo calcola un servizio di
mappe, con la distanza in linea d'aria come ripiego (`src/consegna.js`, `src/percorso.js`).

Le mappe usano Leaflet servito dal progetto (`public/vendor/leaflet`) con tasselli
OpenStreetMap, ma **oggi le mappe sono nascoste** via CSS (ultima regola di
`public/style.css`): schema e flussi restano attivi, non si vedono.

## Prezzi

- Ogni distributore ha un proprio listino con lo **sconto Base per prodotto**: lo stesso articolo
  può costare diversamente da banco a banco.
- Il prezzo mostrato al cliente è `listino − sconto Base` **+ 10%** di servizio, sempre con la
  dicitura **+ IVA**. Imponibile, IVA (22%) e totale sono voci separate nel riepilogo.
- Le percentuali sono in `config` (`servizio_pct`, `iva_pct`, `finestra_conferma_min`), senza
  toccare il codice.
- All'ordine prezzi e sconti vengono "fotografati" in `order_items`: lo storico resta corretto
  anche se i listini cambiano.

## Notifiche

In-app (campanella in alto a destra); diventano notifiche di sistema se l'utente concede il
permesso al browser. **Anche con l'app chiusa** (Web Push, dal 21/10/2026): sito e web app installata
su Android, iPhone/iPad (solo la web app installata sulla schermata Home, iOS 16.4 o successivo),
computer. L'installatore le attiva da Profilo › Sul telefono › Attiva, il banco dall'Anagrafica del
banco › Notifiche del computer. Il browser si iscrive al servizio push (Google, Apple, Mozilla) e il
server (`src/web_push.js`) gli manda ogni notifica nuova; la mostra il service worker (`public/sw.js`).

**Per accenderle sul server** (una volta):

1. applicare il blocco di schema (crea la tabella `iscrizioni_push`; **prima** del riavvio):
   `node scripts/applica_blocco_schema.js "-- Notifiche push del sito e della web app"` (a secco), poi con `--applica`;
2. `git pull` e `npm ci` (dipendenza nuova: `web-push`);
3. generare le chiavi con `node scripts/genera_chiavi_vapid.js` e scrivere nel `.env` della VPS `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`
   (il PC ha le sue, diverse: ogni server usa solo le iscrizioni nate con la propria chiave);
4. `pm2 restart minuteria`: nel log compare `[web push] accese`. Serve HTTPS.

Le notifiche sono **solo di sistema, col suono del telefono, con l'app in secondo piano o chiusa**: con l'app aperta davanti non arriva nessuna notifica e il sito non fa nessun suono
(il banco ha ancora i suoi avvisi dentro la pagina). Per provarle: dal telefono Profilo › Sul telefono › Attiva (dopo 10 secondi arriva una notifica di prova dal server: esci dall'app per vederla),
poi **Prova** per rifarla. Dal server: `node scripts/prova_push.js <nome-utente>` manda una prova ai suoi telefoni e scrive l'esito di ognuno.
Senza chiavi, senza tabella o con `PUSH_ATTIVO=0` il sito funziona come prima: avvisi solo con l'app aperta. L'app Android nativa ha le sue push (`src/push.js`, Expo).

**Banco** (richieste da confermare e "corriere trovato"): il suono arriva da ogni pagina del banco, anche con la scheda nascosta (il server avvisa la pagina in tempo reale, `GET /api/eventi`), e
con la pagina chiusa o in secondo piano arriva la notifica di sistema, **ma solo se il banco le ha accese**: sotto l'intestazione compare l'avviso azzurro "Attiva le notifiche" (si rimanda di
7 giorni con "Non ora"; l'interruttore sta anche in Anagrafica del banco › Notifiche). Se il browser tiene fermo l'audio compare "Attiva il suono": basta un tocco sulla pagina. La **home non si ricarica**:
le schede si aggiornano sul posto e il suono parte nello stesso istante della scheda (così l'audio resta sbloccato). Il suono
(`public/suoni/avviso.mp3`, "din-don" morbido) si rigenera con `node scripts/genera_suono_avviso.js` (serve `ffmpeg` nel PATH); "Ascolta il suono" in Anagrafica lo fa sentire.

## Gruppo WhatsApp dei corrieri

L'installatore ha già pagato quando manda la richiesta. Quando un banco **accetta**, nel gruppo
WhatsApp parte un messaggio con le due tappe: **prelievo merci** (nome, indirizzo e link alla mappa
della filiale che ha accettato) e **consegna** (indirizzo e mappa dell'installatore). Chi la prende
risponde **al messaggio** con la parola chiave e i minuti che ci mette **ad arrivare dal venditore** (la tappa 1,
prelievo merci), per esempio `preso 30` (anche `preso 1 ora e 15`, `preso 1h30`, `preso mezz'ora`).

**Due orari, ognuno per chi deve vederlo:** il **banco** vede esattamente il tempo scritto dal corriere ("Il corriere ritira alle HH:MM" =
momento della risposta + quei minuti: `orders.corriere_risposto_il` + `orders.corriere_minuti`, vedi `src/corriere.js`); l'**installatore** vede
quando arriva la merce da lui = quei minuti **+ il tragitto dal banco che ha accettato alla sua posizione**, che il server calcola sulla mappa
quando il banco conferma (`src/percorso.js`) e sta in `orders.corriere_arrivo_il`. Il tragitto viene, in quest'ordine, da **Google Maps** (col traffico del momento: è il
numero che si vede su Maps) se nel `.env` c'è `GOOGLE_MAPS_API_KEY`; da un OSRM proprio se c'è `ROUTING_URL`; da **Valhalla** (OpenStreetMap, senza chiave; `VALHALLA_URL`
per uno proprio); se nessuno risponde, dalla stima in linea d'aria. `ROUTING_ATTIVO=0` spegne tutto. Il server pubblico di OSRM non si usa più: in città dava tempi
un terzo più brevi di Maps. **Per avere esattamente il tempo di Maps serve la chiave Google** (Google Cloud → abilitare "Routes API" → chiave API, limitata alla Routes API
e all'IP della VPS → `GOOGLE_MAPS_API_KEY` nel `.env` della VPS e riavvio di pm2). Per confrontare i numeri: `node scripts/prova_tragitto.js "Via Dodecaneso, Genova" --corriere 10`.

- **Finché nessuno risponde** l'installatore non sa niente: la richiesta resta "in attesa" con il
  timer che scorre, come se nessun banco avesse accettato (`request_responses.corriere_stato =
  'in_attesa'`: la risposta del banco non vale come offerta in nessuna query dell'installatore).
- **Se qualcuno risponde entro il timer** l'**ordine nasce subito**, da solo, con i minuti del corriere
  (`corriere_minuti`) e l'arrivo dall'installatore (`corriere_arrivo_il` = risposta + minuti + tragitto), e
  all'installatore arriva "Ordine confermato". Vale la **prima** risposta, chi arriva dopo trova
  scritto che è già presa. **Dopo il "preso" il bot non scrive più nel gruppo**: solo la risposta al
  "preso" ("✅ Preso! ... arrivi dal venditore in N minuti, ritiro entro le HH:MM"). L'unico altro messaggio possibile è l'avviso di
  annullo, se l'installatore annulla un ordine che aveva già un corriere (annullo lasciato per la
  fase di prova).
- **Se il timer scade senza risposta** la richiesta si chiude senza ordine, il pagamento torna
  all'installatore, il messaggio viene **eliminato dal gruppo** e nessuno può più rispondere (la
  risposta tardiva è rifiutata anche prima che l'eliminazione arrivi). Lo stesso se il cliente annulla.
- Senza la parola chiave un messaggio è una chiacchiera e viene ignorato. Se il bot è il numero di
  chi risponde, quello che scrive dal proprio telefono vale come risposta; non valgono i messaggi che
  il bot stesso manda nel gruppo.
- **Modulo spento** (`WHATSAPP_ATTIVO=0` o non impostato): i banchi accettano e
  l'ordine nasce subito, senza corriere (con i tempi di consegna stimati dal banco).

Usa Baileys, una libreria **non ufficiale**: il server si comporta come un dispositivo collegato a
un numero WhatsApp. Serve un **numero dedicato** (con il proprio, il ban blocca anche il telefono)
che faccia parte del gruppo; WhatsApp può bloccare il numero in qualsiasi momento. Si accende e si spegne dal
`.env` con `WHATSAPP_ATTIVO=1` / `0` (riavviando il server). Nel `.env` della VPS:

```
WHATSAPP_ATTIVO=1
WHATSAPP_GRUPPO=...           # nome esatto del gruppo oppure il suo id (xxx@g.us)
WHATSAPP_PAROLA_CHIAVE=preso  # facoltativa
WHATSAPP_SONDAGGIO=1          # facoltativa: accompagna ogni "nuova consegna" con un sondaggio da votare (vedi sotto)
WHATSAPP_SONDAGGIO_MINUTI=5,10,15,20,30,45,60,90  # facoltativa: le opzioni del sondaggio, in minuti (da 2 a 12)
WHATSAPP_NUMERO=39333...      # facoltativa: collega con un codice invece del QR
```

Primo avvio: `npm start` stampa nel terminale un QR (o, con `WHATSAPP_NUMERO`, un codice da 8
caratteri). Sul telefono del numero dedicato: *Dispositivi collegati → Collega un dispositivo*
(col codice: *Collega con numero di telefono*). Il QR è grande, serve un terminale alto e largo, e si
rinnova ogni 20 secondi: se non si legge, il codice è più comodo. Se si passa da un metodo all'altro
dopo un tentativo fallito, cancellare prima `whatsapp_auth/`.
Senza `WHATSAPP_GRUPPO` il server, una volta collegato, stampa nome e id dei gruppi del numero.

**Dopo il "preso" (stesso interruttore, `WHATSAPP_SONDAGGIO=1`)**: il sondaggio dei minuti sparisce dal gruppo (resta il messaggio "nuova consegna"), il bot scrive "✅ Preso da Marco! Richiesta #N: arrivi dal venditore in 10 minuti, ritiro entro le …" e subito dopo manda un secondo sondaggio, "Ordine #N: consegna", con "🚀 Segna come Consegnato" (la seconda opzione, "⏳ Ancora in viaggio", c'è solo perché un sondaggio ne vuole due e non fa niente). Il primo voto su "Consegnato" segna l'ordine consegnato (come il pulsante dell'installatore: l'ordine passa a "Consegnato" e il banco riceve l'avviso "Il corriere ha segnato la consegna…"), il sondaggio sparisce e il bot scrive "📦 Ordine #N consegnato alle HH:MM — indirizzo di consegna". Non serve altro schema.

**Sondaggio per prendere la consegna** (`WHATSAPP_SONDAGGIO=1`, spento di default): nel gruppo i pulsanti veri non si possono avere (l'API ufficiale di WhatsApp non li ha nei gruppi e quelli
"interattivi" di Baileys sono un trucco non ufficiale). Si usa un **sondaggio WhatsApp**: subito dopo il messaggio "nuova consegna" il bot ne manda uno a scelta singola con i minuti per arrivare
dal venditore ("5 minuti", "10 minuti"... "1 ora", "1 ora e mezza"), e **il primo che vota prende la consegna**, come chi scrive "preso 30" (che continua a funzionare). Il bot risponde nel gruppo
("✅ Preso da Marco! ...") e a chi vota dopo ("già presa da Marco"). Alla scadenza o all'annullo il sondaggio sparisce dal gruppo come il messaggio. Serve il blocco di schema
"WhatsApp: sondaggio per prendere la consegna" (una colonna: **applicato al DB il 21/10/2026**; senza, il sondaggio non parte e il server lo scrive nel log). Sulla VPS: `git pull`, le righe
sopra nel `.env`, `pm2 restart minuteria` (il log dice "sondaggio per prendere la consegna ACCESO"). Nessuna libreria nuova.
La sessione sta in `whatsapp_auth/` (non in git: sono le credenziali del numero; se si cancella
bisogna ricollegare). I messaggi passano da una coda (`whatsapp_messaggi`): se il collegamento è
giù partono appena torna. Prima del primo avvio vanno applicati i due blocchi WhatsApp in fondo a
`db/postgres/schema.sql` (già applicati al DB di produzione il 30/09 e il 02/10/2026):
`node scripts/applica_blocco_schema.js "-- WhatsApp: il corriere prende la consegna PRIMA" --applica`
(senza `--applica` prova a secco; il primo blocco comincia con "-- Gruppo WhatsApp dei corrieri: coda
dei messaggi").

**In locale** (stesso DB e stesso gruppo della VPS) si può accendere con lo stesso interruttore, ma con due regole, già scritte nel `.env` locale:

```
WHATSAPP_ATTIVO=0                       # 1 = acceso
WHATSAPP_ISTANZA=locale                 # il nome di questo server
WHATSAPP_AUTH_DIR=whatsapp_auth_locale  # una sessione SUA, non quella della VPS
WHATSAPP_GRUPPO=...                     # nome esatto o id (xxx@g.us); se è vuoto, al collegamento stampa i gruppi del numero
```

- **Sessione propria**: la prima volta il server stampa un QR (o, con `WHATSAPP_NUMERO`, un codice) da collegare da *Dispositivi collegati*: è un secondo
  dispositivo sullo stesso numero. Le stesse credenziali usate da due macchine insieme si scollegano a vicenda (errore 440) e rovinano le chiavi: la VPS
  perderebbe il collegamento. La cartella è fuori da git (`whatsapp_auth*/`).
- **Un nome per istanza**: ogni messaggio in coda porta il nome del server che l'ha creato (`whatsapp_messaggi.istanza`) e lo invia, lo elimina e ne legge
  le risposte solo lui, così VPS e locale accesi insieme nello stesso gruppo non mandano messaggi doppi né rispondono due volte al corriere. La VPS, senza
  `WHATSAPP_ISTANZA`, usa il nome del computer e tratta anche i messaggi senza nome (di prima): **aggiornarla (`git pull` + riavvio) prima di accendere il locale**,
  altrimenti la versione vecchia manda anche i messaggi del locale. Blocco di schema "WhatsApp: istanza proprietaria dei messaggi" (già applicato al DB condiviso il 19/10/2026).
- Acceso, l'ordine nasce quando un corriere risponde `preso <minuti>` nel gruppo (i minuti per arrivare dal banco); **ogni ordine di prova fatto in locale scrive nel gruppo vero**.
  Con `FINESTRA_CONFERMA_SEC` nel `.env` il corriere ha solo quei secondi per rispondere (all'avvio il server lo scrive): togliere la riga.

**Prova con una richiesta finta**, senza toccare banchi e clienti veri: crea un gruppo di prova (il
numero del bot + un altro telefono che risponde, o il telefono stesso del bot) e lancia, dal PC
(si accende da solo, qualunque cosa dica `WHATSAPP_ATTIVO`):

```
node scripts/prova_whatsapp.js --gruppo="Nome del gruppo di prova"
```

Manda nel gruppo il messaggio delle due tappe, aspetta la risposta `preso 30` (citando il messaggio)
e stampa cosa ha letto. Se non rispondi entro `--finestra` minuti (default 3) verifica che il messaggio
venga eliminato dal gruppo (e il pagamento finto rimborsato). Dopo il "preso" l'ordine nasce da solo e lo
script lo stampa: nel gruppo deve arrivare solo la risposta del bot. Alla fine cancella i dati di prova.
Senza `--gruppo` elenca i gruppi del numero.

**Tenerlo sempre acceso senza rifare il QR**: la sessione è la cartella `whatsapp_auth/`, e un
riavvio o un reboot non chiedono di ricollegare nulla. Per passare dal PC alla VPS si copia quella
cartella (`scp -r whatsapp_auth utente@vps:/percorso/APP.2/`, poi `chmod 700` sul server) e si
**cancella quella sul PC**: le stesse credenziali in due posti si scollegano a vicenda. Sulla VPS
il processo è tenuto vivo da pm2. Serve rifare il
collegamento solo se il telefono resta offline per circa 14 giorni, se il dispositivo viene
rimosso da *Dispositivi collegati* o se si cancella la cartella: il log dice "sessione chiusa dal
telefono".

## App nativa (Android)

In `mobile/` c'è l'app per telefono, **React Native con Expo** (niente WebView), per l'**installatore**: accesso e **registrazione** (tre passi, come il sito), catalogo, ricerca,
categorie, elementi con foto, carrello con **pagamento con carta** (foglio di Stripe: la carta viene solo bloccata e addebitata quando un banco conferma; senza `STRIPE_SECRET_KEY` è
il pagamento di prova, nessun addebito), richiesta in attesa, ordine, **Stato ordini con più attività insieme**, Storico (il materiale per mese, con la ricevuta in PDF e "Riordina"),
profilo con l'anagrafica ed **Elimina account**, **notifiche push**. Banco e agente restano sul sito. Come costruirla, firmarla e pubblicarla su Google Play: **`mobile/ANDROID.md`**.

L'app parla con il server tramite l'API JSON `/api/v1/...` (`src/api_v1.js`), con accesso a
**token** (`Authorization: Bearer`, tabella `app_tokens`) invece del cookie di sessione. Con Stripe acceso `POST /api/v1/richieste` **non** crea la richiesta: crea il pagamento e
l'app apre il foglio di pagamento (`GET /api/v1/pagamenti/:id` dice com'è andata): dall'app non si ordina più senza pagare.

Per provarla sul telefono (stessa rete Wi-Fi del PC, app **Expo Go** installata; lì non funzionano Google Pay e le push):

```
npm start                 # il server, nel progetto principale
cd mobile
npm install
npx expo start            # QR code: Expo Go (Android) o fotocamera (iPhone)
```

In sviluppo l'app trova da sola il server sul PC (porta 3000); se Windows chiede di consentire
Node sulla rete privata, va consentito. Per farla parlare con un altro server (la VPS) si scrive in
`mobile/.env.local`:

```
EXPO_PUBLIC_API_URL=http://indirizzo-del-server:3000
```

Expo legge i `.env` solo da `mobile/` (quello alla radice è del server). Un indirizzo `http://`
va bene in sviluppo; in un'app installata Android blocca il traffico non cifrato (e l'app, senza un indirizzo HTTPS vero, mostra "App non configurata"),
quindi per la build serve HTTPS (`mobile/eas.json`). L'aspetto è solo chiaro (niente modalità scura). Le icone delle
categorie si generano da `src/icone.js` con `node scripts/genera_icone_app.js`; icona e schermata di avvio (la "M" su blu, segnaposto) con `node scripts/genera_icone_android.js`.

Le pagine che Google Play chiede sono nel sito: `/privacy` e `/elimina-account` (`src/testi_legali.js`: **bozza da far rileggere**; il titolare viene da `AZIENDA_*` nel `.env`).

## Struttura

```
server.js              avvio: ambiente, database, app, cicli di vita (scadenze, WhatsApp, chiusura pulita)
src/app.js             compone l'app Express: middleware nell'ordine giusto, route, gestori d'errore
src/config/            ambiente (.env), impostazioni delle viste, soglie dei limiti di richieste, soglie della bacheca del banco
src/middleware/        sicurezza (helmet), limiti (express-rate-limit), origine, sessione, corpo, compressione, file statici, contesto delle viste
src/routes/            le rotte del sito divise per argomento (autenticazione, catalogo, carrello, richieste, pagamenti, ordini, banco...)
src/services/          pezzi condivisi dalle rotte (banco, carrello in sessione, ciclo di vita, database, striscia ordini)
src/api_v1.js          API JSON dell'app nativa
src/flusso_cliente.js  richiesta pagata → ordine → stato ordini, condiviso fra sito e app
src/token_app.js       token di accesso dell'app (solo hash nel DB)
src/pricing.js         prezzi, servizio, IVA, finestre temporali configurabili
src/catalogo.js        ricerca parziale, categorie, varianti
src/richieste.js       ciclo di vita della richiesta: risposte dei banchi, scadenza, ordine automatico
src/pagamenti.js       pagamento dell'installatore: simulato o Stripe, punti di aggancio del flusso (rimborso, incasso)
src/stripe_pagamenti.js  Stripe: PaymentIntent, pagina di pagamento, webhook, incassi/rilasci/rimborsi (carta autorizzata e poi incassata)
src/whatsapp.js        gruppo WhatsApp dei corrieri (Baileys): messaggi, "preso", coda
src/anagrafiche.js     registrazione cliente, approvazione banco, legami cliente-banco
src/consegna.js        tragitto dal banco all'installatore (mappa, con ripiego sulla stima in linea d'aria)
src/percorso.js        tempo di guida fra due punti da un servizio di mappe (Google Maps se c'è la chiave, poi OSRM proprio, poi Valhalla)
src/corriere.js        orari del corriere: il ritiro che vede il banco (risposta su WhatsApp + minuti scritti)
src/geo.js             lettura della posizione e distanze
src/notifiche.js       notifiche in-app
src/prodotto_json.js   formato JSON dei prodotti (ricerca live, scroll infinito, app)
src/limite_login.js    limiti ai tentativi di login (per utente e per indirizzo, web e app) e alle registrazioni
src/push.js            notifiche push dell'app (Expo Push Service), registrazione dei telefoni
src/web_push.js        notifiche push del sito e della web app (Web Push, chiavi VAPID), iscrizioni dei browser
src/account.js         eliminazione (anonimizzazione) dell'account dell'installatore
src/testi_legali.js    informativa sulla privacy e "come eliminare l'account" (/privacy, /elimina-account)
src/icone.js           icone SVG (sorgente anche per l'app)
src/sessioni.js        archivio sessioni su database
src/memo.js            cache a scadenza (60 s) per letture che il server non scrive mai
src/format.js          date, tempi di consegna, countdown
src/auth.js            middleware di autenticazione/ruolo
src/sede_installatori.js  indirizzo e coordinate fissi degli installatori (provvisorio)
db/postgres/           connessione, schema (schema.sql, l'unico), funzioni della ricerca, seed e importazione dei listini
db/seed.js             dati demo (utenti, distributori, legami cliente-banco)
scripts/               schema (apply_schema_pg.js, applica_blocco_schema.js), sottocategorie, icone app,
                       export, prova_whatsapp.js, migrazioni una tantum (filiali Borea, Via Puggia)
views/                 pagine EJS (cliente e distributore mobile-first)
public/                style.css, app.js (quantità, ricerca live, countdown), img/prodotti
mobile/                app React Native / Expo (vedi "App nativa")
```

Il database di produzione è **Postgres su Supabase** (`DATABASE_URL` in `.env`).

Vedi anche `SCOPE.md` per cosa c'è oggi e cosa è volutamente fuori.
