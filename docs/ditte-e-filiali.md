# Ditte, filiali, dipendenti

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Ditte, filiali, dipendenti (solo Borea, dal 30/09/2026)

`ditte` → filiali → dipendenti. Niente tabelle nuove per le ultime due: **una filiale è una riga di
`distributors`** (`ditta_id`; `nome` = nome della ditta e si ripete, unica è la coppia `nome` +
`filiale`) e **un dipendente è una riga di `users`** ruolo `distributore` con `distributor_id` = la
sua filiale (una sola) e `nome`/`cognome`. Login, token app, sessioni e notifiche restano su `users`.
- **Oggi l'unico banco attivo è Borea** (filiali Fegino e Staglieno, utenti `fegino`, `staglieno` e
  il vecchio `borea`). AFIS, Cambielli e Fidra sono **disattivati** (`attivo = 0`, non cancellati:
  lo storico li referenzia). Credenziali in README. `scripts/una_tantum/imposta_borea_filiali.js` è la
  migrazione una tantum: prova a secco di default (transazione + ROLLBACK), `--applica` conferma.
- L'installatore vede **solo la ditta** ("Borea"): mai la filiale (`flusso_cliente.senzaFiliale`,
  `raggruppaRisposteDitta`, `anagrafiche.legamiDelCliente`; l'app nasconde `filiale` se vuota). La
  filiale la vedono banchi e agente (pannello banco). Il blanking sta nei punti **solo cliente**:
  `/ordini/:id` è condivisa fra ruoli, per questo lì si fa per ruolo e non in `dettaglioOrdine`.
  `legamiDelCliente` (anagrafica del cliente, "Distributori di riferimento") esclude i banchi disattivati: i
  legami con AFIS, Cambielli e Fidra restano in `client_distributors` (lo storico li referenzia) ma non si vedono.
- Una richiesta parte verso **ogni filiale** attiva (`attivo = 1`; la pausa della ricezione non esiste più dal
  09/10/2026: la colonna `distributors.ricezione_attiva` è rimasta nel DB ma nessuno la legge) (una riga di
  `request_responses` ciascuna) e la notifica arriva a tutti i dipendenti. **Vince la prima filiale
  che conferma**: `rispondi()` blocca la richiesta (`FOR UPDATE`), chiude le altre filiali della
  stessa ditta (`scaduto`) e registra chi ha risposto (`risposto_da`). Un rifiuto di una filiale non
  chiude la ditta finché un'altra deve ancora rispondere. L'ordine nasce con `orders.distributor_id`
  = la filiale che ha accettato: da lì parte il pacco e solo i suoi dipendenti lo vedono.
- Prezzi uguali: listino (`distributor_products`, 27.676 righe) e legami cliente
  (`client_distributors`) di Staglieno sono **copie** di Fegino. Un nuovo import di listino va
  scritto su tutte le filiali della ditta. Gli sconti (`client_discount_rules`)
  sono per filiale, non per ditta.
- Un `distributors` senza `ditta_id` (per esempio creato dal seed) funziona: ogni riga è una ditta a
  sé. Il seed (`db/seed.js`) non crea ditte.
- **RITIRO PROVVISORIO (23/10/2026, richiesta esplicita "momentaneamente")**: le due filiali ritirano la merce da **"Enoteca Squillari 1, Via Antonio Cantore, 266r, 16149 Genova GE"**: il corriere va lì ("PRELIEVO MERCI" del messaggio WhatsApp, con CAP e provincia dal 23/10), il tempo
  scritto su WhatsApp è il tempo per arrivare lì (già era "tempo per arrivare dal venditore, tappa 1": `corriere_risposto_il` + `corriere_minuti` = ritiro), e il tragitto verso l'installatore (`consegna.minutiStimati`) parte da lì. Si fa con `node scripts/una_tantum/imposta_ritiro_provvisorio.js` (prova a secco; `--applica` scrive
  `distributors.indirizzo/cap/citta/provincia/geo_*` e `store_locations` di Fegino e Staglieno, e ne crea uno se manca; copia degli indirizzi veri in `backup/_tmp_backup_ritiro_provvisorio.json`, fuori da git e MAI riscritta da un secondo `--applica`). **Per tornare agli indirizzi veri: `--ripristina` (a secco) e `--ripristina --applica`.**
  La posizione (44.4127894, 8.8890556) è il punto "Squillari" di OpenStreetMap (nodo 10095412676, negozio in Via Antonio Cantore, Sampierdarena), **non il civico 266r** (OSM non ha il numero): se serve più preciso si cambiano `lat`/`lng` nello script. In OSM il CAP di quel punto è 16151, nella richiesta 16149 (vale quello scritto). **Provato su un Postgres locale usa-e-getta (apply, secondo apply, ripristina) e APPLICATO al DB condiviso il 23/10/2026** (filiali id 2 e 181, punti vendita id 1 e 2; copia degli indirizzi veri in `backup/_tmp_backup_ritiro_provvisorio.json`: Fegino 44.4470549/8.8890734, Staglieno 44.4245244/8.9484645).
- Coordinate (Nominatim/OSM): Fegino = civico 1/7 rosso di Via Castel Morrone; Staglieno
  **approssimata** sul civico 9 (l'11R non è in OSM). Stanno in `distributors.geo_*` e in
  `store_locations` (una riga per filiale: la leggono `/punti-vendita`, `src/logica/ordini/consegna.js` e il
  messaggio ai corrieri). La posizione del dispositivo non si raccoglie più: se `distributors.geo_*`
  non coincide con `store_locations`, riallinearlo da lì.
- **Da decidere**: la pagina mappa mostra "Borea · Fegino" e "Borea · Staglieno" mentre l'installatore
  vede solo la ditta; manca un ruolo di responsabile che veda gli ordini di tutte le filiali.
