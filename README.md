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

Sulla tua macchina `.env` punta al **Postgres di produzione condiviso** (quello sul server, raggiunto con un tunnel SSH su `127.0.0.1:5433` da aprire a mano): `npm start` in
locale scrive quindi sul DB vero. Il database è solo Postgres (SQLite non esiste più): senza `DATABASE_URL`
nel `.env` l'app prova un Postgres locale di default (`postgres://minuteria:minuteria@localhost:5432/minuteria`).

## Produzione (VPS)

Il sito gira su una VPS con Node.js 22.5 o superiore, collegata allo stesso database. `.env` non è
nel repository: va creato a mano sul server con

```
DATABASE_URL=...      # stringa di connessione Postgres (se il database richiede SSL: aggiungere ?sslmode=require)
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
VAPID_PRIVATE_KEY=... #   `node scripts/setup/genera_chiavi_vapid.js` (la privata è un segreto: solo nel .env, mai in git né in chat)
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
commit tocca lo schema (`db/schema.sql`), il blocco nuovo si applica una volta sola (vedi
`CLAUDE.md`). Resta da fare l'HTTPS con un dominio davanti al sito (vedi `docs/SCOPE.md`): serve anche
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
`node scripts/db/assegna_sottocategorie.js`. Prodotti con lo stesso nome e misure diverse sono
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
passi** (un solo modulo, mostrato un passo alla volta da `assets/js`; senza JavaScript i tre
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

Senza `STRIPE_SECRET_KEY` nel `.env` non cambia niente: tutto resta simulato, anche in locale e nelle prove.

La guida completa (come funziona, chiavi e modalità reale/prova, webhook, messa in produzione) è in [`docs/guide/stripe-setup.md`](docs/guide/stripe-setup.md); le scelte di progetto e i dettagli del codice sono in [`docs/pagamenti.md`](docs/pagamenti.md).

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
`src/logica/ordini/flusso_cliente.js`)

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
   **simulato** (nessun provider né addebito; è anche quello dell'app senza Stripe): `src/logica/pagamenti/pagamenti.js`, colonne
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
node scripts/db/importa_listino.js --marchio toshiba --file "listino.xlsx" --sconto 30
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
il banco risponde (`righeDistributore` in `src/logica/ordini/richieste.js`): il codice per applicarli riga per
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
  `db/schema.sql`): sulla VPS applicarlo **prima** di riavviare, con
  `node scripts/db/applica_blocco_schema.js "-- Anagrafica del banco: orari"` (a secco) e poi con `--applica`.

## Password dimenticata, cambio password ed eliminazione dell'account (installatore)

- **Password dimenticata?** (sul login): l'installatore scrive nome utente o email e riceve un link, valido un'ora e una volta sola, per scegliere una nuova password. Dopo il cambio escono tutte le sessioni
  e l'app deve rifare l'accesso. **Serve l'invio email**: nel `.env` della VPS `SMTP_HOST` (e `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_DA`, vedi `src/logica/notifiche/email.js`) e `APP_URL=https://tuodominio.it` (il link
  si costruisce da lì, mai dall'indirizzo con cui arriva la richiesta). Senza, in produzione non parte niente. In locale, senza SMTP, il link compare nel log del server.
- **La mia anagrafica → Accesso**: cambio della password da dentro (con quella attuale). **Elimina account**: pagina di conferma con la password; si disattiva e si anonimizzano i dati personali, restano
  ordini e ricevute. Con una richiesta o un ordine in corso non si può.
- **Schema**: tabella `recupero_password` (blocco "Recupero della password dell'installatore" in fondo a `db/schema.sql`): applicarla sul DB condiviso **prima** di riavviare, con
  `node scripts/db/applica_blocco_schema.js "-- Recupero della password dell'installatore"` (a secco) e poi con `--applica`.

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
Genova** (`src/logica/account/sede_installatori.js`), usata anche come indirizzo di consegna. I banchi usano il punto vendita
(`store_locations`). Chi è già iscritto si allinea con `node scripts/una_tantum/imposta_installatori_puggia.js`
(prova a secco, `--applica` per confermare); chi si iscrive da ora la riceve da solo. Il tragitto lo calcola un servizio di
mappe, con la distanza in linea d'aria come ripiego (`src/logica/ordini/consegna.js`, `src/logica/ordini/percorso.js`).

Le mappe usano Leaflet servito dal progetto (`public/vendor/leaflet`) con tasselli
OpenStreetMap, ma **oggi le mappe sono nascoste** via CSS (ultima regola di
`assets/css`): schema e flussi restano attivi, non si vedono.

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
server (`src/logica/notifiche/web_push.js`) gli manda ogni notifica nuova; la mostra il service worker (`public/sw.js`).

**Per accenderle sul server** (una volta):

1. applicare il blocco di schema (crea la tabella `iscrizioni_push`; **prima** del riavvio):
   `node scripts/db/applica_blocco_schema.js "-- Notifiche push del sito e della web app"` (a secco), poi con `--applica`;
2. `git pull` e `npm ci` (dipendenza nuova: `web-push`);
3. generare le chiavi con `node scripts/setup/genera_chiavi_vapid.js` e scrivere nel `.env` della VPS `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`
   (il PC ha le sue, diverse: ogni server usa solo le iscrizioni nate con la propria chiave);
4. `pm2 restart minuteria`: nel log compare `[web push] accese`. Serve HTTPS.

Le notifiche sono **solo di sistema, col suono del telefono, con l'app in secondo piano o chiusa**: con l'app aperta davanti non arriva nessuna notifica e il sito non fa nessun suono
(il banco ha ancora i suoi avvisi dentro la pagina). Per provarle: dal telefono Profilo › Sul telefono › Attiva (dopo 10 secondi arriva una notifica di prova dal server: esci dall'app per vederla),
poi **Prova** per rifarla. Dal server: `node scripts/verifica/prova_push.js <nome-utente>` manda una prova ai suoi telefoni e scrive l'esito di ognuno.
Senza chiavi, senza tabella o con `PUSH_ATTIVO=0` il sito funziona come prima: avvisi solo con l'app aperta. L'app Android nativa ha le sue push (`src/logica/notifiche/push.js`, Expo).

**Banco** (richieste da confermare e "corriere trovato"): il suono arriva da ogni pagina del banco, anche con la scheda nascosta (il server avvisa la pagina in tempo reale, `GET /api/eventi`), e
con la pagina chiusa o in secondo piano arriva la notifica di sistema, **ma solo se il banco le ha accese**: sotto l'intestazione compare l'avviso azzurro "Attiva le notifiche" (si rimanda di
7 giorni con "Non ora"; l'interruttore sta anche in Anagrafica del banco › Notifiche). Se il browser tiene fermo l'audio compare "Attiva il suono": basta un tocco sulla pagina. La **home non si ricarica**:
le schede si aggiornano sul posto e il suono parte nello stesso istante della scheda (così l'audio resta sbloccato). Il suono
(`public/suoni/avviso.mp3`, "din-don" morbido) si rigenera con `node scripts/genera/genera_suono_avviso.js` (serve `ffmpeg` nel PATH); "Ascolta il suono" in Anagrafica lo fa sentire.

## Gruppo WhatsApp dei corrieri

Quando un banco **accetta**, nel gruppo WhatsApp dei corrieri parte un messaggio con le due tappe (prelievo merci e consegna); chi prende la consegna risponde con la parola chiave e i minuti che ci mette ad arrivare dal venditore.

Il flusso completo, le variabili del `.env`, il collegamento del numero (QR) e come si prova stanno in [`docs/guide/whatsapp-setup.md`](docs/guide/whatsapp-setup.md); le scelte di progetto e i dettagli del codice sono in [`docs/whatsapp.md`](docs/whatsapp.md).

## App nativa (Android)

In `mobile/` c'è l'app per telefono, **React Native con Expo** (niente WebView), per l'**installatore**: accesso e **registrazione** (tre passi, come il sito), catalogo, ricerca,
categorie, elementi con foto, carrello con **pagamento con carta** (foglio di Stripe: la carta viene solo bloccata e addebitata quando un banco conferma; senza `STRIPE_SECRET_KEY` è
il pagamento di prova, nessun addebito), richiesta in attesa, ordine, **Stato ordini con più attività insieme**, Storico (il materiale per mese, con la ricevuta in PDF e "Riordina"),
profilo con l'anagrafica ed **Elimina account**, **notifiche push**. Banco e agente restano sul sito. Come costruirla, firmarla e pubblicarla su Google Play: **`mobile/ANDROID.md`**.

L'app parla con il server tramite l'API JSON `/api/v1/...` (`src/routes/api_v1/`), con accesso a
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
categorie si generano da `src/comune/icone.js` con `node scripts/genera/genera_icone_app.js`; icona e schermata di avvio (la "M" su blu, segnaposto) con `node scripts/genera/genera_icone_android.js`.

Le pagine che Google Play chiede sono nel sito: `/privacy` e `/elimina-account` (`src/comune/testi_legali.js`: **bozza da far rileggere**; il titolare viene da `AZIENDA_*` nel `.env`).

## Struttura

```
server.js              avvio: ambiente, database, app, cicli di vita (scadenze, WhatsApp, chiusura pulita)
src/app.js             compone l'app Express: middleware nell'ordine giusto, route, gestori d'errore
src/config/            ambiente (.env), impostazioni delle viste, soglie dei limiti di richieste, soglie della bacheca del banco
src/middleware/        un file per ogni passo dell'app: sicurezza (helmet), limiti (express-rate-limit), origine, sessione, corpo, compressione, file statici, contesto delle viste, auth (login e ruolo), errori (pagina e JSON), percorso (%00 e :id)
src/routes/            solo la parte HTTP: una cartella per interfaccia (cliente/, banco/, api_v1/) e, fuori, i file usati da più ruoli (autenticazione, notifiche, eventi, webhook_stripe) e agente; index.js li monta nell'ordine giusto
src/routes/cliente/    le pagine e le API dell'installatore (ruolo `cliente`): profilo, catalogo, carrello, richieste, pagamenti, ordini (index.js le monta)
src/routes/banco/      le pagine del banco: avvisi, home, storico, richieste, ordini, anagrafica, clienti (index.js le monta)
src/routes/api_v1/     API JSON dell'app nativa (`/api/v1`): accesso, profilo, catalogo, richieste, ordini, ricevute, storico; ausiliari.js = pezzi condivisi
src/logica/            la logica di business, una cartella per area (le rotte fanno solo HTTP e chiamano queste):
  account/             utenti (letture degli utenti: accesso, anagrafica), anagrafiche (registrazione, approvazione banco, legami cliente-banco), account (eliminazione = anonimizzazione), token_app (token dell'app, solo hash nel DB),
                       password, password_account (cambio), recupero_password, limite_login (tentativi per utente e per indirizzo, web e app), sessioni (archivio su database),
                       sessione_utente, sede_installatori (indirizzo e coordinate fissi degli installatori, provvisorio)
  catalogo/            catalogo (ricerca parziale, categorie, varianti), prodotto_json (formato JSON dei prodotti: ricerca live, scroll infinito, app)
  ordini/              flusso_cliente (richiesta pagata → ordine → stato ordini, condiviso fra sito e app), richieste (ciclo di vita: risposte dei banchi, scadenza, ordine automatico),
                       consegna (tragitto dal banco all'installatore, con ripiego sulla stima in linea d'aria), percorso (tempo di guida da un servizio di mappe: Google Maps, poi OSRM, poi Valhalla),
                       corriere (orari del corriere: il ritiro che vede il banco), geo (posizione e distanze), orari (fasce di ricezione del banco), materiale (materiale ordinato e quanto si deve),
                       ordini (letture degli ordini), striscia_ordini, carrello_sessione, risposte_flusso
  pagamenti/           pricing (prezzi, servizio, IVA, finestre temporali), pagamenti (simulato o Stripe, punti di aggancio: rimborso, incasso), stripe_config, stripe_pagamenti (PaymentIntent, pagina di pagamento, webhook,
                       incassi/rilasci/rimborsi), ricevute (PDF), azienda (dati dell'azienda dal .env)
  banco/               tutto ciò che serve alle pagine del banco: banco (intestazione, numeri della barra, "Preparato", eliminazioni), bacheca (le tre colonne della home), anagrafica, avvisi, ordine, richiesta, storico, storico_dettaglio
  notifiche/           notifiche (in-app), push (app, Expo Push Service), web_push (sito e web app, chiavi VAPID), eventi (aggiornamento in tempo reale, Server-Sent Events), email
  whatsapp/            whatsapp.js: gruppo WhatsApp dei corrieri (Baileys): messaggi, "preso", coda. Non richiede richieste.js né flusso_cliente.js: le sue due azioni gliele registra src/avvio/servizi.js (impostaAzioni)
src/comune/            pezzi senza database usati ovunque: format (date, tempi di consegna, countdown), http (query, ritorni sicuri), input (id, quantità, escape LIKE), memo (cache a scadenza 60 s),
                       icone (SVG, sorgente anche per l'app), testi_legali (/privacy, /elimina-account), url_sito
src/avvio/             ciò che parte con il server: processo (errori, porta, chiusura pulita), servizi (controllo delle scadenze, Stripe, WhatsApp), database (preparazione all'avvio)
db/index.js            l'unico accesso al database (Postgres): db.prepare, db.transaction, db.exec; poi resilienza.js (rete che cade)
db/schema.sql          lo schema (l'unico file) e le funzioni SQL della ricerca
db/seed.js             dati demo (utenti, distributori, legami cliente-banco)
scripts/db/            schema (apply_schema_pg.js, applica_blocco_schema.js), configurazione, sottocategorie, importa_listino.js (listini Excel), diagnosi della rete
scripts/una_tantum/    migrazioni sul DB condiviso (filiali Borea, Via Puggia, ritiro provvisorio): prova a secco di default, --applica conferma
scripts/genera/        icone (app Android, app nativa, PWA) e suono degli avvisi del banco
scripts/setup/         chiavi VAPID per le push, file di verifica di Apple Pay
scripts/verifica/      prove e controlli (Stripe, push, tragitto, orari, WhatsApp): `verifica_stripe`, `stato_orari` e `prova_tragitto` leggono soltanto; `prova_push` e `prova_whatsapp` mandano messaggi veri, leggi l'intestazione prima di lanciarli
views/                 pagine EJS per area: auth/ (accesso, registrazione, password), cliente/ (installatore), banco/ (distributore), agente/, comune/ (errore, legale, notifiche); partials/ = parti riusate, per area (comune/, cliente/, banco/, agente/). Gli `include` sono relativi al file che li chiama
assets/js/            i pezzi di app.js (uno per argomento: quantità e ricerca live, countdown, banco, avvisi...), numerati: il server li riunisce in un solo /app.js
assets/css/           i pezzi di style.css, numerati come sopra: il server li riunisce in un solo /style.css (src/comune/asset_composti.js)
public/               il resto dei file serviti così come sono: sw.js, manifest, icone, mappa.js, pagamento.js, img/prodotti, vendor/
test/                  prove automatiche (`npm test`), una cartella per area come src/logica (account, banco, catalogo, notifiche, ordini, pagamenti, whatsapp) più middleware/, db/, comune/ e sito/ (un file per argomento che avvia il vero server con un DB finto, preparato in sito/_aiuti/server_finto.js; sw.test.js prova il service worker)
mobile/                app React Native / Expo (vedi "App nativa")
docs/                  documentazione per argomento (indice in CLAUDE.md), guide di messa in funzione in docs/guide/, mockup
backup/                copie di sicurezza degli script una tantum (fuori da git)
```

Il database di produzione è **Postgres sul server** (`DATABASE_URL` in `.env`).

Vedi anche `docs/SCOPE.md` per cosa c'è oggi e cosa è volutamente fuori.
