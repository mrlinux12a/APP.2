# Due ambienti: «reale» e «app»

Richiesta del 06/11/2026: «due ambienti: uno quello reale, che tra poco andrà in test, con web app, WhatsApp per i corrieri e web banco; e un altro, separato: app mobile installatore, corrieri e web app banco». Confermata con «Sì, parti».

**Stato (06/11/2026):** il codice e gli strumenti ci sono e sono provati in locale (vedi «Come è stato provato, e cosa no»). **Nessun ambiente vero è stato toccato**: né il database condiviso (quello del reale), né la VPS. Il database nuovo, il server, il DNS e Stripe li prepari tu con i passi qui sotto; il codice nuovo è ancora solo sul PC (non è stato salvato in git).

## In breve

|  | Ambiente «reale» | Ambiente «app» |
|---|---|---|
| Chi lo usa | installatori dal **sito**, corrieri nel **gruppo WhatsApp**, banco sul sito | installatori e corrieri dall'**app mobile**, banco sul sito di questo ambiente |
| Indirizzo | `consegneincantiere.it`, com'è | uno nuovo: consiglio un sottodominio, per esempio `app.consegneincantiere.it` |
| Database | quello di sempre: **non si tocca** | uno **nuovo** (catalogo, listini e filiali copiati dal reale; nessun cliente, ordine o pagamento) |
| Interruttore nel `.env` | `WHATSAPP_ATTIVO=1` (com'è) | `CORRIERI_APP=1`, WhatsApp spento |
| Pagamenti | come adesso | **solo la sandbox** di Stripe (`STRIPE_MODO=test`) |
| Codice | questo repository | questo repository, in una **seconda cartella** |
| Processo | pm2 `minuteria` | pm2 `flash-app` (nome a scelta) |
| Segreti | i suoi | **diversi**: `SESSION_SECRET`, chiavi VAPID, segreto del webhook di Stripe |

L'ambiente reale non cambia finché non lo aggiorni tu. E quando lo aggiornerai al codice nuovo, senza `CORRIERI_APP` nel suo `.env` si comporta come prima (le rotte dei corrieri rispondono 404, le colonne nuove non si leggono né si scrivono: provato dai test).

## Come il codice li distingue

Un solo interruttore, **`CORRIERI_APP=1`** nel `.env` (`src/logica/ordini/modalita_corrieri.js`). Non c'è nessuna colonna «origine» nelle richieste e nessuna scelta per singola richiesta: il modo lo decide l'installazione.

| | senza `CORRIERI_APP` (reale) | con `CORRIERI_APP=1` (app) |
|---|---|---|
| Dopo la conferma del banco | se `WHATSAPP_ATTIVO=1` parte il messaggio nel gruppo; altrimenti l'ordine nasce subito | la consegna aspetta un corriere dell'app: a quelli disponibili e liberi arriva una notifica («Nuova richiesta di consegna») |
| `/api/v1/corrieri/*` (registrazione, accesso, disponibilità, richieste, accetta, in corso, ritirato, consegnato, dispositivi) | 404 | attive |
| Colonne dei corrieri (`users.corriere_disponibile`, `request_responses.consegna_km` e `corriere_km`, `orders.ritirato_il`) | mai lette né scritte: il database non ha bisogno del blocco di schema | usate: il blocco «App dei corrieri: disponibilità, tragitto e ritiro» di `db/schema.sql` deve esserci |
| Database vuoto all'avvio | seed demo automatico (com'è sempre stato) | **niente seed** (creerebbe utenti con password note su un sito che si raggiunge da Internet): un avviso nel log |

I due modi non si mescolano: con `CORRIERI_APP=1` **e** `WHATSAPP_ATTIVO=1` insieme il server **non parte** (`[config] CORRIERI_APP=1 e WHATSAPP_ATTIVO=1 sono accesi insieme…`, uscita con errore), perché ogni consegna andrebbe in due posti e due corrieri potrebbero prenderla.

All'avvio il log dice sempre dove si trova (sono le righe da guardare):

```
[db] database: 127.0.0.1:5432/flash_app          ← deve essere il database di QUESTO ambiente
[stripe] modalità PROVA (sandbox, STRIPE_MODO=test)…
[corrieri] ambiente «app»: le consegne vanno ai corrieri nella loro app (CORRIERI_APP=1)
```

L'ambiente reale scrive invece `[corrieri] ambiente «reale»: le consegne vanno al gruppo WhatsApp dei corrieri`.

## Regole da non rompere

1. **Un `.env` per cartella, un database per `.env`.** Mai il `DATABASE_URL` del reale nella cartella dell'app, né il contrario. Dopo aver scritto un `.env`: `node scripts/verifica/ambiente.js --atteso app` (o `--atteso reale`), lanciato **dalla cartella** di quell'ambiente: dice a quale database parla, se il `.env` è dell'ambiente giusto e cosa manca. Non scrive niente e non stampa mai chiavi o password.
2. **Il `.env` del PC non va toccato**: punta al database condiviso (il reale, dal tunnel `127.0.0.1:5433`). Non ci si scrive `CORRIERI_APP=1`: il server locale col `.env` del progetto scrive sul database vero. Per provare i corrieri si usa un database `prova_…` locale (sezione sotto).
3. **L'ambiente app non ha nessuna chiave reale di Stripe**, nemmeno ferma in una riga che non si usa: `verifica/ambiente.js` lo segnala come errore. Solo `STRIPE_MODO=test` con le chiavi `STRIPE_TEST_…`.
4. **`npm run seed` non si lancia** su nessuno dei due (riscrive le password demo del README). All'avvio l'ambiente app non lo fa neppure da solo.
5. **Il database dell'app è in UTC** (`ALTER DATABASE … SET timezone TO 'UTC'`), come quello reale: i campi data senza fuso (`creato_il`, `consegnato_il`) si leggono come UTC e con un altro fuso si sfaserebbero di qualche ora. Lo script di copia e il controllo lo verificano.
6. **Il pm2 dell'app parte dalla cartella dell'app.** Il server legge il `.env` della cartella da cui parte (`dotenv`, `src/config/ambiente.js`): lanciato dalla cartella sbagliata leggerebbe il `.env` dell'altro ambiente.

## Prove in locale (senza toccare niente di vero)

Tutto lo sviluppo e le prove dei corrieri si fanno su un Postgres **del PC**, in un database il cui nome comincia per `prova_`. Il PC ha Postgres 18 (utente `postgres`, password `postgres`).

```sql
-- da pgAdmin o psql, collegato come postgres:
CREATE DATABASE prova_corrieri;
ALTER DATABASE prova_corrieri SET timezone TO 'UTC';
```

```bash
# lo schema nel database di prova (DATABASE_URL scritto qui vince sul .env del progetto)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/prova_corrieri node scripts/db/apply_schema_pg.js

# il giro completo dell'app dei corrieri su Postgres vero (18 casi: richiesta → banco conferma → corriere accetta → ritira → consegna)
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/prova_corrieri node --test test/corrieri/app_corrieri_postgres.test.js
```

(In PowerShell: `$env:TEST_DATABASE_URL = 'postgres://…'; node --test test/corrieri/app_corrieri_postgres.test.js`.)

- Il test **svuota** utenti, banchi e prodotti del database che gli indichi. Per questo parte solo se l'indirizzo è sul computer stesso **e** il nome comincia per `prova_`; altrimenti viene saltato (è l'unico dei 655 test di `npm test` che salta, senza `TEST_DATABASE_URL`).
- **Un server locale in modo «app»** (per guardare l'app mobile sul telefono o nell'anteprima web): crea una cartella **fuori dal progetto** con un suo `.env` (`DATABASE_URL` del database `prova_…`, `CORRIERI_APP=1`, `PORT=3100`, `SESSION_SECRET` qualsiasi, `HOST=0.0.0.0` solo se serve dal telefono) e lancia il server da lì: `cd quella-cartella` e `node C:\Users\SAMSUNG\lavoro\app2\APP.2\server.js`. Il `.env` del progetto (quello del database condiviso) non viene letto affatto. La prima riga del log deve nominare il database di prova. Nell'app: `EXPO_PUBLIC_API_URL=http://127.0.0.1:3100` (o l'indirizzo del PC sulla rete) in `mobile/.env.local`.
- Il catalogo si può portare nel database di prova con lo stesso script di copia (sezione «La copia del catalogo»), da un altro database locale.

## Mettere in piedi l'ambiente «app» (sulla VPS)

Ogni passo si può rifare. I comandi sono per la VPS (Linux, bash). Dove c'è un percorso tra segnaposto (`/percorso/…`) metti quello vero.

### 0. Prima di cominciare

- **Il codice nuovo è solo sul PC.** Prima va salvato in git e spinto (commit e push: lo decidi tu, io non lo faccio mai da solo). Poi sulla VPS lo si prende con `git clone`/`git pull`.
- **L'indirizzo.** Consiglio un sottodominio della stessa VPS, per esempio `app.consegneincantiere.it`: un solo server, una sola macchina, due siti. I cookie di accesso sono legati all'indirizzo esatto, quindi i due siti non si disturbano.
- **Stripe in modalità prova**: le chiavi `sk_test_…` e `pk_test_…` (quelle di sempre vanno bene) e, al passo 11, un webhook nuovo.
- **Postgres 13 o più** sulla VPS (`sudo -u postgres psql -c "SELECT version();"`): serve perché l'estensione `pg_trgm` della ricerca si crei anche senza essere amministratore.

### 1. L'indirizzo (DNS)

Dal pannello del dominio: un record `A` per `app.consegneincantiere.it` (o l'indirizzo che scegli) con lo **stesso IP** della VPS. La propagazione può richiedere da qualche minuto a qualche ora: i passi 2-9 si possono fare nel frattempo, il 10 (HTTPS) no.

### 2. Il database nuovo

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE flash_app LOGIN PASSWORD 'una-password-lunga-e-casuale';
CREATE DATABASE flash_app OWNER flash_app;
ALTER DATABASE flash_app SET timezone TO 'UTC';
\q
```

Non creare l'estensione `pg_trgm` a mano: ci pensa lo schema (creata da chi poi esegue lo schema, funziona anche la funzione di ricerca `ricerca_simili`; creata prima da un altro utente, la stessa funzione può dare «permission denied to set parameter pg_trgm.word_similarity_threshold»).

### 3. La cartella nuova

```bash
cd /percorso/dove-sta-la-cartella-del-sito-reale/..      # accanto a quella del sito reale
git clone <lo stesso indirizzo con cui hai clonato il sito reale> flash-app
cd flash-app
git checkout <il ramo che contiene il codice nuovo>
npm ci
```

### 4. Il `.env`

Crea `/percorso/flash-app/.env` (modello nella sezione «Il `.env` dell'ambiente app») e chiudilo agli altri: `chmod 600 .env`. I segreti nuovi:

```bash
openssl rand -hex 32                      # SESSION_SECRET (uno nuovo, mai quello del reale)
node scripts/setup/genera_chiavi_vapid.js # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (una coppia nuova)
```

### 5. Controllo del `.env`

```bash
node scripts/verifica/ambiente.js --atteso app --senza-database
```

Deve dire `Ambiente: «app»` e nessun `KO`. I `!!` sono avvisi da leggere (per esempio le notifiche spente perché mancano le chiavi VAPID). Se dice che manca `CORRIERI_APP=1` sei nella cartella sbagliata.

### 6. Lo schema

Sempre dalla cartella nuova (lo schema va nel database del **suo** `.env`):

```bash
node scripts/verifica/ambiente.js --atteso app      # riga «Database:»: deve essere flash_app (le righe sullo schema, ancora vuoto, danno KO: è normale)
node scripts/db/apply_schema_pg.js                  # «Schema applicato correttamente.»
```

Se dà `permission denied to create extension "pg_trgm"` il Postgres è più vecchio del previsto: rendi `flash_app` amministratore solo per questo passo (`ALTER ROLE flash_app SUPERUSER;`, rilancia lo schema, poi `ALTER ROLE flash_app NOSUPERUSER;`). Provato solo su Postgres 18 locale.

### 7. La copia del catalogo

`scripts/ambiente_app/prepara_database.js` copia dal database **reale** solo il catalogo (macro categorie, marchi, sottocategorie, prodotti e gruppi, relazione prodotto↔sottocategoria), i listini e le filiali dei **banchi attivi**, più la tabella `config`. **Non copia** clienti, ordini, richieste, pagamenti, sessioni, token, notifiche né i banchi veri. Per ogni filiale attiva crea invece un accesso di prova (`banco-…`) con una password casuale.

```bash
cd /percorso/flash-app
export ORIGINE_DATABASE_URL="$(grep '^DATABASE_URL=' /percorso/sito-reale/.env | cut -d= -f2-)"   # l'indirizzo del REALE, letto senza scriverlo a mano
node scripts/ambiente_app/prepara_database.js              # PROVA: copia dentro una transazione e annulla
node scripts/ambiente_app/prepara_database.js --applica    # lo fa davvero
unset ORIGINE_DATABASE_URL
```

- **La prova a secco prima, sempre.** Stampa `MODO: PROVA`, i due indirizzi (`Origine (solo lettura)` deve essere il reale, `Destinazione` il nuovo: **se sono invertiti o uguali fermati**), le righe copiate tabella per tabella, quanti valori di `config` e quali accessi di prova crea. Finisce con «PROVA: tutto è andato bene ma NON è stato salvato niente».
- Il reale si **legge soltanto** (connessione in sola lettura, una fotografia unica di tutte le tabelle). Lo script si rifiuta di partire se origine e destinazione sono lo stesso database, se il nuovo non è in UTC, se manca lo schema o se le tabelle del catalogo non sono vuote.
- Le **password dei banchi** vanno nel file `backup/credenziali_ambiente_app.txt` della cartella nuova (non vengono scritte a video né nei log; fuori da git; permessi solo tuoi). Leggile con `cat`, dalle ai tuoi tester e poi sposta o cancella il file. Con `--senza-banchi` non crea nessun accesso; con `--password-banchi <pw>` usi tu la stessa password per tutti.
- Il `.env` del reale ha di solito `DATABASE_URL="…"` senza virgolette. Se le ha, il comando sopra le porta dentro e lo script dice «indirizzo non valido»: toglile.

### 8. Controllo con il database

```bash
node scripts/verifica/ambiente.js --atteso app
```

Deve finire con «Nessun errore»: database in UTC, schema e colonne dei corrieri presenti, catalogo con i prodotti, almeno un utente banco, **nessun utente demo** del seed (se ci sono è un errore: significa che il database è stato riempito col seed invece che con la copia).

### 9. Accendere il server

```bash
cd /percorso/flash-app
pm2 start server.js --name flash-app
pm2 save
pm2 logs flash-app --lines 30
```

Le tre righe del paragrafo «Come il codice li distingue» devono esserci, con il **database nuovo** nella prima. `pm2 describe flash-app` deve mostrare come `exec cwd` la cartella nuova. Il processo `minuteria` del reale non viene toccato (`pm2 list` li mostra tutti e due). Nel `.env` ci vuole una `PORT` libera (`3001` nel modello): `ss -ltnp | grep 3001` non deve rispondere niente prima di partire.

### 10. nginx e HTTPS

Parti dal file di nginx del sito reale: copialo, cambia `server_name` (l'indirizzo nuovo) e la porta del `proxy_pass` (`http://127.0.0.1:3001`), lascia il resto. Devono esserci, come nel reale, `proxy_set_header Host $host;`, `X-Forwarded-For $proxy_add_x_forwarded_for` e `X-Forwarded-Proto $scheme` (senza `Host` ogni invio di un modulo dà «origine non corrispondente»; vedi anche il README, «Produzione»).

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.consegneincantiere.it     # o il tuo modo di avere HTTPS
```

L'HTTPS non è facoltativo: Stripe, le notifiche e l'app installata sul telefono lo vogliono (l'app mostra «L'app non è configurata» con un indirizzo non HTTPS).

### 11. Il webhook di Stripe (sandbox)

Nella dashboard di Stripe, **in modalità di prova**: Sviluppatori → Webhook → aggiungi un endpoint `https://app.consegneincantiere.it/webhooks/stripe`, eventi `payment_intent.amount_capturable_updated` e `payment_intent.canceled`. Copia il «segreto di firma» (`whsec_…`) in `STRIPE_TEST_WEBHOOK_SECRET` nel `.env` dell'app e `pm2 restart flash-app`. Dettagli e schermate: [guide/stripe-setup.md](guide/stripe-setup.md). Il webhook del reale resta com'è: quello di prova è un endpoint a parte, con un segreto suo.

### 12. L'app sul telefono

Un'app costruita parla con **un solo** server, scritto nella build. Per questo ambiente:

- in `mobile/eas.json`, profilo **`preview`** (l'APK da installare a mano), sostituisci `https://INSERISCI-IL-DOMINIO.invalid` con `https://app.consegneincantiere.it` (senza `/` finale). Il profilo `production` si lascia com'è: servirà quando sarà il reale ad avere l'app. **Non l'ho modificato io.**
- la build e le notifiche (account Expo, Firebase, `google-services.json`, chiave FCM) sono i passi di [mobile/ANDROID.md](../mobile/ANDROID.md), sezioni 2, 3 e 6; per questo ambiente il comando è `npx eas-cli build --platform android --profile preview`.
- per provare senza build: Expo Go con `EXPO_PUBLIC_API_URL=https://app.consegneincantiere.it` in `mobile/.env.local` (le notifiche push non esistono in Expo Go). **Attenzione: oggi `mobile/.env` ha `https://consegneincantiere.it`, cioè il sito reale**: finché non c'è un `.env.local` (che ha la precedenza su `.env`, Expo docs) le richieste dell'app, anche da Expo Go, arrivano al banco vero. Dopo aver cambiato il file basta ricaricare l'app (scuoti il telefono → Reload), senza riavviare Expo.

La stessa app serve sia gli installatori sia i corrieri: nella schermata di accesso c'è il selettore «Installatore | Corriere».

### 13. Il giro di prova

Si fa con tre persone (o tre schermate): banco, installatore, corriere.

| Chi | Cosa | Cosa deve succedere |
|---|---|---|
| Banco | apre `https://app.consegneincantiere.it/` e accede con un utente `banco-…` (password nel file del passo 7) | vede la bacheca delle richieste, vuota |
| Installatore | nell'app: Registrati (dati inventati), catalogo, carrello, indirizzo di consegna, «Paga e invia» con la carta di prova `4242 4242 4242 4242` | la richiesta compare al banco, con il conto alla rovescia |
| Corriere | nell'app: Registrati come corriere, accende «Sei disponibile» e consente la posizione | la home «Richieste» è vuota e non dà errori |
| Banco | conferma la richiesta | al corriere arriva la notifica e la richiesta compare nella sua home, con i minuti e i km fino al banco |
| Corriere | apre la richiesta e preme «Accetta richiesta» | l'ordine nasce; installatore e banco sono avvisati. Un secondo corriere che prova ad accettare vede «Richiesta già presa» |
| Corriere | «Vai al ritiro», poi «Ho ritirato il materiale» | nel banco l'ordine passa da «Da preparare» a «In consegna» |
| Corriere | «Vai al cantiere», poi «Consegna completata» | l'installatore vede l'ordine consegnato; il corriere vede il riepilogo e torna disponibile |

## Il `.env` dell'ambiente «app»

Modello (i valori tra `<…>` sono i tuoi; **non incollarne mai uno in chat**):

```
# --- database: QUELLO NUOVO, mai quello del reale ---
DATABASE_URL=postgres://flash_app:<password>@127.0.0.1:5432/flash_app

# --- come gira ---
PORT=3001                                # libera: il reale usa la 3000
SESSION_SECRET=<openssl rand -hex 32>    # nuovo
APP_URL=https://app.consegneincantiere.it    # l'indirizzo vero; nell'app mobile EXPO_PUBLIC_API_URL deve essere lo stesso
CORRIERI_APP=1                           # l'interruttore dell'ambiente «app»
# WHATSAPP_ATTIVO non va scritto (con CORRIERI_APP=1 il server non parte)

# --- pagamenti: SOLO sandbox ---
STRIPE_MODO=test
STRIPE_TEST_SECRET_KEY=<sk_test_…>
STRIPE_TEST_PUBLISHABLE_KEY=<pk_test_…>
STRIPE_TEST_WEBHOOK_SECRET=<whsec_… del webhook del passo 11>

# --- notifiche push ad app chiusa: una coppia NUOVA ---
VAPID_PUBLIC_KEY=<…>
VAPID_PRIVATE_KEY=<…>
VAPID_SUBJECT=mailto:<un-tuo-indirizzo>

# --- facoltative ---
DISTRIBUTORE_PREDEFINITO=BOREA SRL       # a chi si collegano gli installatori che si registrano (di default già questo)
GOOGLE_MAPS_API_KEY=<…>                  # tempi di tragitto come su Maps; senza, il tragitto lo calcola Valhalla (docs/posizione-e-consegna.md)
SMTP_HOST=<…>  SMTP_PORT=<…>  SMTP_USER=<…>  SMTP_PASS=<…>  EMAIL_DA=Flash Delivery <…>   # password dimenticata e ricevute; senza, nessuna email parte
EXPO_ACCESS_TOKEN=<…>                    # solo se nel progetto Expo c'è la «sicurezza avanzata» delle push
```

Cose che **non** vanno: `PAGAMENTO_SIMULATO`, `PAGAMENTO_SIMULATO_FORZA`, `FINESTRA_CONFERMA_SEC`, `LIMITE_RICHIESTE_DISATTIVATO` (sono del PC, per le prove), qualsiasi `WHATSAPP_…`, chiavi `sk_live_…`/`STRIPE_LIVE_…`. Gli installatori che si registrano entrano subito fra i clienti approvati del distributore predefinito (`APPROVAZIONE_AUTOMATICA=0` rimette la conferma a mano: README, «Registrazione e approvazione»). I valori di `config` copiati dal reale (ordine minimo, spedizione, finestra di conferma di 10 minuti…) si cambiano senza riavvio con `node scripts/db/imposta_config.js <chiave> <valore> --applica`, lanciato **dalla cartella dell'app**.

## Aggiornare l'ambiente «app»

```bash
cd /percorso/flash-app
git pull
npm ci
pm2 restart flash-app
```

Se il commit aggiunge un blocco in fondo a `db/schema.sql`, si applica una volta sola e **solo da questa cartella**: prima a secco, poi davvero.

```bash
node scripts/db/applica_blocco_schema.js "-- il commento d'inizio del blocco nuovo"
node scripts/db/applica_blocco_schema.js "-- il commento d'inizio del blocco nuovo" --applica
```

Le due cartelle possono stare su commit diversi: il reale si aggiorna quando lo decidi tu, l'app quando vuoi provare le novità.

## Rifare il database dell'ambiente «app»

La copia del catalogo parte solo su un database **vuoto** (a prova di errore: non si sovrappone a dati già presenti). Se il catalogo o i listini del reale cambiano e li vuoi nell'app, si rifà il database da capo, e **si perdono** installatori, corrieri e ordini di prova:

```bash
pm2 stop flash-app
sudo -u postgres psql -c "DROP DATABASE flash_app;" -c "CREATE DATABASE flash_app OWNER flash_app;" -c "ALTER DATABASE flash_app SET timezone TO 'UTC';"
# poi i passi 6 (schema), 7 (copia) e 8 (controllo), e
pm2 start flash-app
```

Se questo diventa un fastidio c'è una strada più leggera (aggiornare solo catalogo e listini senza toccare il resto): non è scritta, va decisa insieme.

## Passare l'ambiente reale all'app (se e quando)

Non è un passo di adesso e non va fatto per sbaglio: serve il tuo via esplicito, e prima vanno decise le cose in «Punti aperti». In ordine:

1. Copia di sicurezza del database reale (`pg_dump`).
2. `git pull` e `npm ci` nella cartella del reale; la nuova colonna `users.corriere_disponibile` e le altre del blocco «App dei corrieri: disponibilità, tragitto e ritiro» si applicano al database reale **a secco prima** (`applica_blocco_schema.js "-- App dei corrieri: disponibilita', tragitto e ritiro"`), poi con `--applica`.
3. Nel `.env` del reale: `CORRIERI_APP=1` e via `WHATSAPP_ATTIVO` (il gruppo smette di ricevere le consegne), poi `pm2 restart minuteria`.
4. Una build `production` dell'app con l'indirizzo vero (`mobile/eas.json`, profilo `production`).
5. I corrieri di WhatsApp si registrano dall'app. Senza di loro nessuna consegna parte: va fatto **prima** di spegnere il gruppo.

Il blocco di schema «App dei corrieri: ruoli e legami» (ruoli `corriere` e `supervisore_corrieri`, `supervisore_id`, `corriere_id`) è già sul database reale dal 06/11/2026 e può restarci: non cambia nessun dato.

## Come è stato provato, e cosa no

**Provato** (tutto in locale, su Postgres 18 del PC, mai sul database condiviso né sulla VPS):

- `npm test`: 655 test, 654 verdi e 1 saltato (il giro su Postgres vero, che parte solo con `TEST_DATABASE_URL`). Quel giro, lanciato a parte su `prova_corrieri`: 18 casi su 18 (primo che accetta vince, una consegna alla volta per corriere, ordine che nasce, stati del banco, orari e minuti).
- Gli strumenti degli ambienti: la copia del catalogo tra due database locali (25.000 prodotti e 100.000 righe di listino come prova: prova a secco che non lascia niente, copia vera con tabelle identiche riga per riga e con le date intatte, numerazione degli id riallineata, nessuna persona né ordine copiati, un accesso per ogni filiale attiva); i rifiuti (stesso database come origine e destinazione, destinazione non vuota o non in UTC); lo schema applicato da un utente normale su un database nuovo; il controllo `verifica/ambiente.js` (anche contro un database con gli utenti demo: dà errore).
- L'avvio vero del server da una cartella con un suo `.env`: legge solo quel `.env`, scrive le righe `[db]` e `[corrieri]`, con il catalogo vuoto **non fa il seed** (utenti 0, prodotti 0 dopo l'avvio), le rotte dei corrieri rispondono 401 senza token (esistono) e con `CORRIERI_APP=1` + `WHATSAPP_ATTIVO=1` esce con errore.
- Le schermate dei corrieri nell'anteprima web, contro l'API vera su un database locale: accesso, home con l'interruttore e le richieste, dettaglio, accetta, le due fasi, consegna completata, «richiesta già presa», «consegna non più disponibile», richiesta nuova che arriva da sola, profilo, avviso «Serve la tua posizione». `tsc --noEmit` e `expo lint` a zero problemi.

**Non provato:**

- **Su un telefono vero**: la posizione (nell'anteprima è simulata), l'apertura di Maps e del telefono dai pulsanti, le notifiche push (servono la build e Firebase), il foglio di pagamento di Stripe.
- **I passi sulla VPS** (Postgres, pm2, nginx, certbot, DNS): sono scritti per una configurazione standard e non li ho potuti eseguire sul tuo server. Se un comando non torna, fermati e dimmelo prima di insistere.
- **La copia contro il database reale**: provata tra due database locali, mai contro quello vero (si limita a leggere, ma la prima volta la prova a secco è la tua verifica).
- **Il webhook di Stripe di prova** con eventi veri di questo ambiente.
- **L'aspetto**: le immagini di riferimento dei corrieri non erano più disponibili quando ho scritto le schermate; ho seguito la descrizione scritta.

## Punti aperti

- **L'indirizzo dell'ambiente app** è `app.consegneincantiere.it` (indicato dall'utente il 06/11/2026, sulla stessa VPS) e resta da decidere **la scelta di Stripe** (le chiavi di prova di sempre o una sandbox nuova).
- **I banchi dell'ambiente app** sono accessi di prova nuovi (`banco-…`, password casuali), non quelli veri di Borea. Se vuoi che i banchi veri entrino anche lì, va deciso (e si copiano le password già cifrate oppure si danno accessi nuovi).
- **La registrazione dei corrieri è pubblica e dà accesso subito** (scelta tua del 06/11/2026: niente approvazione). In un ambiente di prova va bene; per il reale chiunque trovi l'indirizzo potrebbe farsi un account corriere e vedere le richieste: da rivedere prima di passare il reale all'app.
- **Catalogo e listini non si aggiornano da soli** dal reale all'app: vedi «Rifare il database dell'ambiente app».
- **Le notifiche push dei corrieri** usano il collegamento `/corriere/richieste/<id>`, che l'app apre da sola (`apriDaLink`). La funzione del server `push.destinazioneApp` conosce solo i collegamenti degli installatori e non va usata per quelli dei corrieri.
- **L'utente `corriere` (#421)** creato sul database condiviso il 06/11/2026 non ha un'email e non può entrare dall'app. Nel reale i corrieri sono quelli di WhatsApp; quell'utente si può cancellare (vedi [app-corrieri.md](app-corrieri.md)).

Vedi anche: [app-corrieri.md](app-corrieri.md) (le schermate e l'API dei corrieri), [whatsapp.md](whatsapp.md) (il gruppo del reale), [richieste-e-ordini.md](richieste-e-ordini.md) (il ciclo richiesta → ordine) e [app-nativa.md](app-nativa.md).
