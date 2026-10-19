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
locale scrive quindi sul DB vero. Senza `.env` l'app partirebbe in SQLite, ma è un percorso
legacy non più mantenuto (dettagli in `CLAUDE.md`).

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
PUSH_ATTIVO=0         # facoltativa: spegne le notifiche push dell'app (di default accese; senza la tabella dispositivi_push non partono)
EXPO_ACCESS_TOKEN=... # facoltativa: solo se nel progetto Expo è attiva la "sicurezza avanzata" delle push
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
esclusa. La **spedizione di € 10** si somma dopo e non concorre a raggiungere la soglia.
Entrambi i valori stanno in `config` (`ordine_minimo`, `spedizione_fissa`).

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
> (`distributoriApprovati()` in `src/anagrafiche.js` esiste ma nessuna route la richiama). Il
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
4. Nel `.env` della VPS: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`; `npm ci`
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
disattivati) sono solo in `db/punti_vendita.js`: lo script che li carica,
`db/postgres/geocodifica.js`, **non parte** (fa `require('./punti_vendita')` ma il file sta in
`db/`, non in `db/postgres/`).

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
   scaduta da poco); lo **Storico** ha tutto il resto (le richieste annullate si vedono ma non si aprono). Sul sito l'icona nella barra in basso segue la
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
3. **Ordini** — l'ordine entra in *Da preparare* → *Prendi in preparazione* → *Emetti bolla e
   segna la merce partita*. Il cliente può annullare solo finché resta *Da preparare*, e il
   banco riceve una notifica.
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

## Contributo RAEE

I listini dichiarano i prezzi IVA, trasporto e RAEE esclusi. Il contributo RAEE per articolo si
importa insieme al prodotto e compare come **voce separata** in riepilogo, ordine e bolla.

## Bolla / DDT

All'emissione l'app assegna un **numero progressivo per distributore e per anno** (es. `1/2026`)
e genera il documento di trasporto **intestato al cliente ordinante**, con anagrafica di
mittente e destinatario, destinazione della merce, righe, causale, colli, data e ora di
partenza, totali e spazi per le firme. `/ddt/:ordine` è ottimizzata per la stampa e la vedono il
banco che l'ha emessa, il cliente intestatario e l'agente (link nel dettaglio dell'ordine).

## Posizione

La posizione del dispositivo **non si raccoglie più**, né sul sito né nell'app. Per ora tutti gli
installatori stanno in **Via Puggia 22/3, Genova** (`src/sede_installatori.js`): è il loro indirizzo di
consegna e la posizione da cui si calcolano distanza e tragitto. I banchi usano il punto vendita
(`store_locations`). Chi è già iscritto si allinea con `node scripts/imposta_installatori_puggia.js`
(prova a secco, `--applica` per confermare); chi si iscrive da ora la riceve da solo. Le stime di
consegna usano la distanza in linea d'aria (`src/consegna.js`).

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
permesso al browser, ma solo mentre l'app è aperta in una scheda. Le notifiche push a telefono
spento arriveranno con l'app nativa.

## Gruppo WhatsApp dei corrieri

L'installatore ha già pagato quando manda la richiesta. Quando un banco **accetta**, nel gruppo
WhatsApp parte un messaggio con le due tappe: **prelievo merci** (nome, indirizzo e link alla mappa
della filiale che ha accettato) e **consegna** (indirizzo e mappa dell'installatore). Chi la prende
risponde **al messaggio** con la parola chiave e i minuti **totali** (dal ritiro alla consegna), per
esempio `preso 30` (anche `preso 1 ora e 15`, `preso 1h30`, `preso mezz'ora`).

- **Finché nessuno risponde** l'installatore non sa niente: la richiesta resta "in attesa" con il
  timer che scorre, come se nessun banco avesse accettato (`request_responses.corriere_stato =
  'in_attesa'`: la risposta del banco non vale come offerta in nessuna query dell'installatore).
- **Se qualcuno risponde entro il timer** l'**ordine nasce subito**, da solo, con il tempo scritto
  nel messaggio come tempo di consegna (`corriere_minuti`, `corriere_arrivo_il` = da adesso), e
  all'installatore arriva "Ordine confermato". Vale la **prima** risposta, chi arriva dopo trova
  scritto che è già presa. **Dopo il "preso" il bot non scrive più nel gruppo**: solo la risposta al
  "preso" ("✅ Preso! ... consegna entro le HH:MM"). L'unico altro messaggio possibile è l'avviso di
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
WHATSAPP_NUMERO=39333...      # facoltativa: collega con un codice invece del QR
```

Primo avvio: `npm start` stampa nel terminale un QR (o, con `WHATSAPP_NUMERO`, un codice da 8
caratteri). Sul telefono del numero dedicato: *Dispositivi collegati → Collega un dispositivo*
(col codice: *Collega con numero di telefono*). Il QR è grande, serve un terminale alto e largo, e si
rinnova ogni 20 secondi: se non si legge, il codice è più comodo. Se si passa da un metodo all'altro
dopo un tentativo fallito, cancellare prima `whatsapp_auth/`.
Senza `WHATSAPP_GRUPPO` il server, una volta collegato, stampa nome e id dei gruppi del numero.
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
- Acceso, l'ordine nasce quando un corriere risponde `preso <minuti>` nel gruppo, con quel tempo di consegna; **ogni ordine di prova fatto in locale scrive nel gruppo vero**.
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
server.js              entrypoint Express e rotte del sito
src/api_v1.js          API JSON dell'app nativa
src/flusso_cliente.js  richiesta pagata → ordine → stato ordini, condiviso fra sito e app
src/token_app.js       token di accesso dell'app (solo hash nel DB)
src/pricing.js         prezzi, servizio, IVA, finestre temporali configurabili
src/catalogo.js        ricerca parziale, categorie, varianti
src/richieste.js       ciclo di vita della richiesta: risposte dei banchi, scadenza, ordine automatico
src/pagamenti.js       pagamento dell'installatore: simulato o Stripe, punti di aggancio del flusso (rimborso, incasso)
src/stripe_pagamenti.js  Stripe: PaymentIntent, pagina di pagamento, webhook, incassi/rilasci/rimborsi (carta autorizzata e poi incassata)
src/whatsapp.js        gruppo WhatsApp dei corrieri (Baileys): messaggi, "preso", coda
src/anagrafiche.js     registrazione cliente, approvazione banco, sconti per ambito
src/consegna.js        stima del tempo di consegna
src/ddt.js             numerazione e dati della bolla / DDT
src/geo.js             lettura della posizione e distanze
src/notifiche.js       notifiche in-app
src/prodotto_json.js   formato JSON dei prodotti (ricerca live, scroll infinito, app)
src/limite_login.js    limiti ai tentativi di login (per utente e per indirizzo, web e app) e alle registrazioni
src/push.js            notifiche push dell'app (Expo Push Service), registrazione dei telefoni
src/account.js         eliminazione (anonimizzazione) dell'account dell'installatore
src/testi_legali.js    informativa sulla privacy e "come eliminare l'account" (/privacy, /elimina-account)
src/icone.js           icone SVG (sorgente anche per l'app)
src/sessioni.js        archivio sessioni su database
src/memo.js            cache a scadenza (60 s) per letture che il server non scrive mai
src/format.js          date, tempi di consegna, countdown
src/auth.js            middleware di autenticazione/ruolo
src/sede_installatori.js  indirizzo e coordinate fissi degli installatori (provvisorio)
db/                    db/postgres (produzione, con schema e funzioni della ricerca) e
                       db/sqlite (legacy, vedi CLAUDE.md)
db/seed.js             dati demo (utenti, distributori, legami cliente-banco)
scripts/               schema (apply_schema_pg.js, applica_blocco_schema.js), sottocategorie, icone app,
                       export, prova_whatsapp.js, migrazioni una tantum (filiali Borea, Via Puggia)
views/                 pagine EJS (cliente e distributore mobile-first)
public/                style.css, app.js (quantità, ricerca live, countdown), img/prodotti
mobile/                app React Native / Expo (vedi "App nativa")
```

Il database di produzione è **Postgres su Supabase** (`DATABASE_URL` in `.env`).

Vedi anche `SCOPE.md` per cosa c'è oggi e cosa è volutamente fuori.
