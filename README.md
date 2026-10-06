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
DISTRIBUTORE_PREDEFINITO=BOREA SRL   # facoltativa: a chi si collegano i nuovi clienti (vedi "Registrazione e approvazione")
```

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

A ogni filiale del distributore arriva la notifica *"Nuova anagrafica da approvare"*. Il distributore apre la
scheda del cliente, vede tutti i dati fiscali e decide: **approva** (indicando il proprio codice
cliente) o **rifiuta** se non lo riconosce. Approvato il cliente, il banco può impostare gli
**sconti concordati** (vedi "Sconti al banco").

> **Non ancora applicato**: il codice non blocca né filtra sulla base dell'approvazione — un
> cliente registrato ma non approvato da nessun banco può comunque inviare richieste, e queste
> arrivano a **tutti** i distributori attivi, non solo a quelli che l'hanno approvato
> (`distributoriApprovati()` in `src/anagrafiche.js` esiste ma nessuna route la richiama). Il
> comportamento inteso ("finché nessuno approva non può ordinare") non è quello reale:
> verificarlo prima di contarci in produzione.

## Punti vendita sulla mappa

`/punti-vendita` (link nel menu account) mostra i banchi su mappa. `store_locations` ha oggi **2
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
   **simulato** (nessun provider né addebito: `src/pagamenti.js`, colonne `pagamento_*` su
   `requests`) e va rimborsato se la richiesta si chiude senza ordine. Consegna sempre con il
   corriere: il ritiro al banco non esiste più.
5. **Attesa** — la richiesta parte verso **tutti i distributori attivi** (non filtrata per zona
   né per copertura). Hanno **10 minuti** (`finestra_conferma_min`) per confermare la
   disponibilità e, con il gruppo WhatsApp acceso, trovare un corriere. Il cliente vede un
   countdown e lo stato di ogni banco: può chiudere la schermata. Una sola richiesta aperta per
   cliente alla volta; può annullarla (pagamento rimborsato).
6. **Ordine automatico** — l'installatore **non sceglie né conferma più niente**. L'ordine nasce da
   solo quando una risposta del banco diventa valida: appena **un corriere prende la consegna**
   nel gruppo (vedi "Gruppo WhatsApp dei corrieri") o, a modulo spento, appena il banco accetta.
   All'installatore arriva "Ordine confermato" con il tempo di consegna stimato (quello scritto
   dal corriere). Se nessun banco accetta o nessun corriere prende la consegna entro la finestra,
   la richiesta si chiude ("Nessuna conferma ricevuta"), il **pagamento torna** e si può
   reinviare (si paga di nuovo lo stesso importo).
7. **Stato ordini** — mostra sempre e solo l'attività più rilevante (in attesa > in consegna >
   scaduta da poco); lo **Storico** ha tutto il resto. Sul sito l'icona nella barra in basso segue la
   fase: anello con conto alla rovescia (in attesa), furgone con i minuti all'arrivo (in consegna),
   "!" (nessuna risposta). Per ora l'ordine si può ancora annullare finché il banco non lo prende in
   carico (rimborso): lasciato per la fase di prova.

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
al prezzo standard del proprio listino o rifiuta. Restano attivi gli **sconti per ambito** nella
scheda del singolo cliente (`/distributore/clienti`), anche **a scalare** su 5 colonne (40+10+5 =
48,7%):

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
- **Modulo spento** (`WHATSAPP_ATTIVO` non impostato, come in locale): i banchi accettano e
  l'ordine nasce subito, senza corriere (con i tempi di consegna stimati dal banco).

Usa Baileys, una libreria **non ufficiale**: il server si comporta come un dispositivo collegato a
un numero WhatsApp. Serve un **numero dedicato** (con il proprio, il ban blocca anche il telefono)
che faccia parte del gruppo; WhatsApp può bloccare il numero in qualsiasi momento. Spento finché
non c'è `WHATSAPP_ATTIVO=1`, e va acceso **in un solo posto, la VPS**: due istanze collegate
leggerebbero lo stesso gruppo e risponderebbero due volte, e un server locale (stesso DB di
produzione) scriverebbe nel gruppo vero per ogni ordine di prova. Nel `.env` della VPS:

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

**Prova con una richiesta finta**, senza toccare banchi e clienti veri: crea un gruppo di prova (il
numero del bot + un altro telefono che risponde, o il telefono stesso del bot) e lancia, dal PC e
senza `WHATSAPP_ATTIVO` nel `.env`:

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

## App nativa (in costruzione)

In `mobile/` c'è l'app per telefono, **React Native con Expo** (niente WebView). Per ora è solo
per l'**installatore**: login, catalogo, ricerca, categorie, elementi con foto, carrello con
pagamento simulato e richiesta, ordine, stato ordini e storico. Mancano le notifiche push, la
registrazione (per ora rimanda al sito) e la cancellazione account. Banco e agente restano sul sito.

L'app parla con il server tramite l'API JSON `/api/v1/...` (`src/api_v1.js`), con accesso a
**token** (`Authorization: Bearer`, tabella `app_tokens`) invece del cookie di sessione.

Per provarla sul telefono (stessa rete Wi-Fi del PC, app **Expo Go** installata):

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
va bene con Expo Go; in un'app compilata Android e iOS bloccano il traffico non cifrato, quindi
per la build serve HTTPS. L'aspetto è solo chiaro (niente modalità scura). Le icone delle
categorie si generano da `src/icone.js` con `node scripts/genera_icone_app.js`; `icon.png` e
`splash-icon.png` sono ancora i segnaposto di Expo.

## Struttura

```
server.js              entrypoint Express e rotte del sito
src/api_v1.js          API JSON dell'app nativa
src/flusso_cliente.js  richiesta pagata → ordine → stato ordini, condiviso fra sito e app
src/token_app.js       token di accesso dell'app (solo hash nel DB)
src/pricing.js         prezzi, servizio, IVA, finestre temporali configurabili
src/catalogo.js        ricerca parziale, categorie, varianti
src/richieste.js       ciclo di vita della richiesta: risposte dei banchi, scadenza, ordine automatico
src/pagamenti.js       pagamento dell'installatore (simulato): incasso, rimborso
src/whatsapp.js        gruppo WhatsApp dei corrieri (Baileys): messaggi, "preso", coda
src/anagrafiche.js     registrazione cliente, approvazione banco, sconti per ambito
src/consegna.js        stima del tempo di consegna
src/ddt.js             numerazione e dati della bolla / DDT
src/geo.js             lettura della posizione e distanze
src/notifiche.js       notifiche in-app
src/prodotto_json.js   formato JSON dei prodotti (ricerca live, scroll infinito, app)
src/limite_login.js    limite ai tentativi di login (web e app)
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
