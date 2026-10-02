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
```

Per aggiornare dopo un nuovo commit:

```
git pull
npm ci
# riavvia il processo (npm start)
```

`npm ci` non si può saltare: le dipendenze cambiano (es. `compression`) e senza il server non
parte. Se il commit tocca lo schema (`db/postgres/schema.sql`), va applicato una volta con
`node scripts/apply_schema_pg.js`.

Da sistemare, se non è già stato fatto (vedi `SCOPE.md`): un servizio che tenga acceso il
processo e lo riavvii da solo, e HTTPS con un dominio davanti al sito.

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

Chi si registra compila l'anagrafica completa della propria impresa o ditta individuale —
ragione sociale, referente, **partita IVA, codice fiscale, sede legale, CAP, città, provincia,
codice SDI o PEC**, indirizzo di consegna abituale, contatti — e sceglie i **distributori di
riferimento** fra quelli attivi.

Ai banchi scelti arriva la notifica *"Nuova anagrafica da approvare"*. Il distributore apre la
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

`/punti-vendita` (link nel menu account) mostra i banchi dei distributori su mappa, con distanza
da te se hai condiviso la posizione. **Oggi la tabella `store_locations` è vuota.** I 12 punti
vendita di Genova (AFIS, BOREA, CAMBIELLI, FIDRA) sono in `db/punti_vendita.js`, con indirizzi dai
siti ufficiali; lo script che li carica e ricava le coordinate con Nominatim è
`db/postgres/geocodifica.js`, ma **non parte**: fa `require('./punti_vendita')` e quel file sta
in `db/`, non in `db/postgres/`. Va corretto il percorso prima di rilanciarlo.

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
4. **Carrello** — articoli, quantità, merce, RAEE, spedizione e totale stimato. La richiesta
   parte solo dopo **Conferma e chiedi disponibilità**, e solo se l'ordine minimo è raggiunto.
5. **Attesa** — la richiesta parte verso **tutti i distributori attivi** (non filtrata per zona
   né per copertura). Hanno **10 minuti** (`finestra_conferma_min`) per confermare la
   disponibilità. Il cliente vede un countdown e lo stato di ogni banco, e riceve una notifica
   a ogni risposta: può chiudere la schermata. Una sola richiesta aperta per cliente alla volta.
6. **Offerte** — appena almeno un distributore conferma, il cliente vede chi ha confermato con
   **tempo di consegna stimato e prezzo**, dal più conveniente (le complete prima delle
   parziali). Parte una finestra per scegliere, che si allunga a ogni nuova conferma: se il
   cliente non sceglie in tempo, l'ordine parte da solo verso chi copre **tutto** il materiale
   con la **consegna più veloce** (se nessuno copre tutto, vince comunque il più veloce). Oltre
   15 minuti dalla scadenza le offerte decadono senza creare un ordine e si può reinviare la
   richiesta.
7. **Riepilogo ordine** — consegna o ritiro, destinazione, note, articoli, imponibile, IVA e
   totale; **Invia l'ordine** chiude l'ordine con quel distributore. Se l'assegnazione
   automatica scatta mentre il cliente compila, viene avvisato che l'ordine è già partito con i
   valori predefiniti.
8. **Stato ordini** — mostra sempre e solo l'attività più rilevante (in attesa > da scegliere >
   in consegna > scaduta da poco); lo **Storico** ha tutto il resto.

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

## Geolocalizzazione (con consenso)

Su cliente e distributore, sempre subordinata al consenso esplicito: finché non si attiva non
viene registrata nessuna coordinata. Dopo il consenso l'app usa `watchPosition` e invia al
massimo un aggiornamento ogni 10 secondi. La **revoca** cancella davvero le coordinate e
interrompe le condivisioni attive. Il distributore può condividere la posizione del mezzo per
singolo ordine, così il cliente segue la consegna. Le stime di consegna usano la distanza in
linea d'aria (`src/consegna.js`).

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

Quando un ordine **con consegna** parte verso il banco (scelta del cliente o assegnazione
automatica), nel gruppo WhatsApp arriva un messaggio con il numero d'ordine, il **ritiro merce**
(via della filiale che ha accettato) e la **consegna merce** (destinazione dell'ordine). Chi lo
prende risponde **al messaggio** con la parola chiave e i minuti, per esempio `preso 30`
(anche `preso 1 ora e 15`, `preso 1h30`, `preso mezz'ora`). Il sistema legge il tempo, lo salva
sull'ordine (`corriere_minuti`, `corriere_arrivo_il`), avvisa cliente e banco, e nel gruppo
conferma. Vale la **prima** risposta: chi arriva dopo trova scritto che l'ordine è già preso.
Senza la parola chiave un messaggio è una chiacchiera e viene ignorato. Il "ritiro al banco" non
manda niente. Se il bot è il numero di chi risponde, quello che scrive dal proprio telefono vale
come risposta; non valgono i messaggi che il bot stesso manda nel gruppo.

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
giù partono appena torna. Prima del primo avvio va applicato il blocco "Gruppo WhatsApp dei
corrieri" di `db/postgres/schema.sql` (già applicato al DB di produzione il 30/09/2026).

**Prova con un ordine finto**, senza toccare banchi e clienti veri: crea un gruppo di prova (il
numero dedicato + un altro telefono che risponde) e lancia, dal PC e senza `WHATSAPP_ATTIVO` nel
`.env`:

```
node scripts/prova_whatsapp.js --gruppo="Nome del gruppo di prova"
```

Manda nel gruppo un messaggio marcato PROVA, aspetta la risposta `preso 30` (scritta da un altro
numero, citando il messaggio), stampa cosa ha letto e cancella i dati di prova. Senza `--gruppo`
elenca i gruppi del numero.

**Tenerlo sempre acceso senza rifare il QR**: la sessione è la cartella `whatsapp_auth/`, e un
riavvio o un reboot non chiedono di ricollegare nulla. Per passare dal PC alla VPS si copia quella
cartella (`scp -r whatsapp_auth utente@vps:/percorso/APP.2/`, poi `chmod 700` sul server) e si
**cancella quella sul PC**: le stesse credenziali in due posti si scollegano a vicenda. Sulla VPS
il processo va tenuto vivo con un servizio che lo riavvii (pm2 o systemd). Serve rifare il
collegamento solo se il telefono resta offline per circa 14 giorni, se il dispositivo viene
rimosso da *Dispositivi collegati* o se si cancella la cartella: il log dice "sessione chiusa dal
telefono".

## App nativa (in costruzione)

In `mobile/` c'è l'app per telefono, **React Native con Expo** (niente WebView). Per ora è solo
per l'**installatore**: login, catalogo, ricerca, categorie, elementi con foto, carrello,
richiesta di disponibilità, offerte, ordine, stato ordini e storico. Mancano le notifiche push,
la registrazione (per ora rimanda al sito) e la cancellazione account. Banco e agente restano
sul sito.

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
src/flusso_cliente.js  richiesta → offerte → ordine → stato ordini, condiviso fra sito e app
src/token_app.js       token di accesso dell'app (solo hash nel DB)
src/pricing.js         prezzi, servizio, IVA, finestre temporali configurabili
src/catalogo.js        ricerca parziale, categorie, varianti
src/richieste.js       ciclo di vita richiesta → offerte, assegnazione automatica
src/anagrafiche.js     registrazione cliente, approvazione banco, sconti per ambito
src/consegna.js        stima del tempo di consegna
src/ddt.js             numerazione e dati della bolla / DDT
src/geo.js             posizione con consenso, revoca e distanze
src/notifiche.js       notifiche in-app
src/prodotto_json.js   formato JSON dei prodotti (ricerca live, scroll infinito, app)
src/limite_login.js    limite ai tentativi di login (web e app)
src/icone.js           icone SVG (sorgente anche per l'app)
src/sessioni.js        archivio sessioni su database
src/memo.js            cache a scadenza (60 s) per letture che il server non scrive mai
src/format.js          date, tempi di consegna, countdown
src/auth.js            middleware di autenticazione/ruolo
db/                    db/postgres (produzione, con schema e funzioni della ricerca) e
                       db/sqlite (legacy, vedi CLAUDE.md)
db/seed.js             dati demo (utenti, distributori, legami cliente-banco)
scripts/               schema (apply_schema_pg.js), sottocategorie, icone app, export
views/                 pagine EJS (cliente e distributore mobile-first)
public/                style.css, app.js (quantità, ricerca live, countdown), img/prodotti
mobile/                app React Native / Expo (vedi "App nativa")
```

Il database di produzione è **Postgres su Supabase** (`DATABASE_URL` in `.env`).

Vedi anche `SCOPE.md` per cosa c'è oggi e cosa è volutamente fuori.
