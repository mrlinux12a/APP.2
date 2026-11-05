# Velocità

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Velocità

Il DB sta su un altro server: ogni query costa un giro di rete (~50 ms), quindi conta il **numero
di query in sequenza**, non la loro complessità. Mai query dentro un ciclo (N+1).
- **Cache a scadenza 60 s** (`src/comune/memo.js`, `conCache`): config (`pricing`), struttura del catalogo
  (`catalogo.js`), token dell'app (`token_app.js`). Sono letture che il server non scrive mai: una
  modifica fatta da script compare entro un minuto. Gli oggetti restituiti sono condivisi fra le
  richieste: non modificarli.
- **Connessioni** (`db/index.js`): tenute aperte 5 min e 3 svegliate ogni minuto
  (`mantieniCalde`, chiamata da `server.js`). Il default di pg le chiude dopo 10 s e la richiesta
  dopo ogni pausa pagava ~330-420 ms di connessione nuova (una query calda: ~45).
- **Ricerca**: due modi con gli stessi risultati. *Veloce* (~45 ms nel DB): funzioni SQL
  `ricerca_esatti`/`ricerca_simili` e indice `idx_products_ricerca_trgm` (in `schema.sql`); le
  parole da 3+ caratteri diventano insiemi di id intersecati sull'indice, misure e parole da 1-2
  caratteri filtrano le righe rimaste (`OFFSET 0` forza quest'ordine). *Lenta* (~220 ms): la
  query originale, usata da sola se le funzioni non esistono (errore 42883). La soglia 0.45 sta
  nella clausola SET di `ricerca_simili`: una SET di sessione non è affidabile col pooler in
  modalità transazione. `ricerca_testo` è nell'indice: se cambia, l'indice va ricreato. Per
  confrontare una versione nuova con la vecchia: `git show HEAD:src/logica/catalogo/catalogo.js` in un file
  temporaneo, insiemi e chiave (categoria+nome) d'ordine, non gli id.
- **Elenchi** (`paginato`): conteggio (in cache) e pagina partono insieme. **Dal 16/10/2026 si pagina per schede**: una riga per gruppo prima di `LIMIT/OFFSET`, totale = `COUNT(DISTINCT COALESCE(gruppo_id, -id))`
  (prima 40 prodotti per pagina che si riunivano in da 2 a 34 schede, e la stessa famiglia sparsa su più pagine ricompariva in ognuna: "Raccorderia e valvole" 6079 prodotti → 2517
  schede, 63 pagine da 40, nessuna ripetuta). Le varianti dei gruppi
  viaggiano nella stessa query, **una volta per gruppo** (`conMembriDelGruppo`, colonna `_gruppo`):
  ripetute su ogni riga costavano più della seconda query che sostituivano. Ordine dei pareggi
  `nome, prezzo_listino, id`: prima era arbitrario (con OFFSET le righe potevano ripetersi o
  saltare); la variante "di default" di un gruppo è la più economica fra quelle con lo stesso nome.
- **Stato ordini** (`attivitaCliente`): "segna lette" e lettura delle richieste recenti partono
  insieme; le scadenze si aggiornano dopo, così le notifiche che creano restano da leggere. La query delle
  richieste recenti porta con sé `secondi_rimasti` (dal DB): `aggiornaScadenza` si chiama solo per le richieste con
  la finestra finita o del vecchio flusso (prima una per ogni richiesta aperta, due letture ciascuna), in parallelo.
- **Sessioni web**: `touch` al massimo ogni 10 min per sessione (`src/logica/account/sessioni.js`); con
  `rolling: true` express-session aspetta quell'UPDATE prima di chiudere ogni risposta.
- `compression` in `server.js`; `/img` e `/vendor` con `maxAge` 7 giorni, CSS/JS solo ETag.
- Carrello web: +/− raggruppano i tocchi (un salvataggio, un ricaricamento), con le quantità
  mandate una alla volta: richieste parallele sulla stessa sessione si sovrascrivono.
