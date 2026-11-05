# Gruppo WhatsApp dei corrieri: messa in funzione

Estratto dal [`README.md`](../../README.md) nel riordino della documentazione (31/10/2026): il testo è quello di prima. Le scelte di progetto e i dettagli del codice sono in [`docs/whatsapp.md`](../whatsapp.md).

L'installatore ha già pagato quando manda la richiesta. Quando un banco **accetta**, nel gruppo
WhatsApp parte un messaggio con le due tappe: **prelievo merci** (nome, indirizzo e link alla mappa
della filiale che ha accettato) e **consegna** (indirizzo e mappa dell'installatore). Chi la prende
risponde **al messaggio** con la parola chiave e i minuti che ci mette **ad arrivare dal venditore** (la tappa 1,
prelievo merci), per esempio `preso 30` (anche `preso 1 ora e 15`, `preso 1h30`, `preso mezz'ora`).

**Due orari, ognuno per chi deve vederlo:** il **banco** vede esattamente il tempo scritto dal corriere ("Il corriere ritira alle HH:MM" =
momento della risposta + quei minuti: `orders.corriere_risposto_il` + `orders.corriere_minuti`, vedi `src/logica/ordini/corriere.js`); l'**installatore** vede
quando arriva la merce da lui = quei minuti **+ il tragitto dal banco che ha accettato alla sua posizione**, che il server calcola sulla mappa
quando il banco conferma (`src/logica/ordini/percorso.js`) e sta in `orders.corriere_arrivo_il`. Il tragitto viene, in quest'ordine, da **Google Maps** (col traffico del momento: è il
numero che si vede su Maps) se nel `.env` c'è `GOOGLE_MAPS_API_KEY`; da un OSRM proprio se c'è `ROUTING_URL`; da **Valhalla** (OpenStreetMap, senza chiave; `VALHALLA_URL`
per uno proprio); se nessuno risponde, dalla stima in linea d'aria. `ROUTING_ATTIVO=0` spegne tutto. Il server pubblico di OSRM non si usa più: in città dava tempi
un terzo più brevi di Maps. **Per avere esattamente il tempo di Maps serve la chiave Google** (Google Cloud → abilitare "Routes API" → chiave API, limitata alla Routes API
e all'IP della VPS → `GOOGLE_MAPS_API_KEY` nel `.env` della VPS e riavvio di pm2). Per confrontare i numeri: `node scripts/verifica/prova_tragitto.js "Via Dodecaneso, Genova" --corriere 10`.

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
`db/schema.sql` (già applicati al DB di produzione il 30/09 e il 02/10/2026):
`node scripts/db/applica_blocco_schema.js "-- WhatsApp: il corriere prende la consegna PRIMA" --applica`
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
node scripts/verifica/prova_whatsapp.js --gruppo="Nome del gruppo di prova"
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
