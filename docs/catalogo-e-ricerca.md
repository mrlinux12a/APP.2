# Catalogo e ricerca

Estratto da [`CLAUDE.md`](../CLAUDE.md) nel riordino della documentazione (31/10/2026): il testo delle sezioni è quello di prima. Indice di tutti i file in `CLAUDE.md`.

## Catalogo

- **27.676 prodotti attivi** (non 51.182 — conteggi più vecchi altrove sono stale).
- `products.misura` è **0% popolata**: la misura va estratta dal testo di `nome`.
- `products.codice` è un ID interno, non il codice produttore; `products.codice_fornitore` è
  quello vero.
- Raggruppamento varianti (`raggruppaVarianti()`): un numero nudo a inizio nome NON è una
  misura di default, serve un simbolo attaccato (Ø, Dn, mm, ", °).

## Ricerca (`src/logica/catalogo/catalogo.js`, `cercaProdotti`)

Niente colonna "materiale", `misura` vuota: tutto estratto da `nome`.
- Sinonimi pollici↔mm solo per taglie gas/pressione (1/8–2.1/2), mai per scarichi/pluviali.
- Frazioni a parole ("un mezzo", "tre quarti"...) tradotte in cifra prima di cercare.
- Parole generiche di misura ("diametro", "pollici"...) tradotte in un pattern sul nome, mai
  cercate alla lettera (il catalogo non le scrive mai per esteso).
- **Refusi (rifatti il 16/10/2026)**: la ricerca è **prima esatta** (parte di parola, indice trigram); i refusi si tentano **solo se le schede esatte
  sono meno di 10** (`MINIMO_RISULTATI_SENZA_REFUSI`), in un secondo passo: candidati dal DB con `word_similarity >= 0.55` (`SOGLIA_REFUSI`) e poi filtro in JS
  (`corrispondeConRefusi`: per ogni parola, una parola del nome a distanza di Levenshtein ≤ 1, ≤ 2 dalle 8 lettere, anche se il nome è più lungo perché si sta
  ancora scrivendo). Prima si cercava sempre per somiglianza 0.45 e le parole lunghe attiravano nomi senza rapporto: "adattatore" trovava "contatore",
  "alimentatore", "scambiatore" (336 risultati su 551 sbagliati, più di "adatt": 248), "caldaia" trovava "turbina", "termostato" 452 nomi di troppo. Il DB **non ha
  `fuzzystrmatch`** (niente `levenshtein` in SQL, e non si installa estensioni sul DB condiviso): per questo il controllo è in JS. Il ripiego costa ~0,7 s (solo
  quando scatta); legge righe intere solo dei risultati tenuti. Numeri e sigle (`dn50`, `3/4`) non hanno refusi.
- **Singolare/plurale** (`radiceParola`): da 5 lettere senza la vocale finale ("valvole" trova le "valvola", "raccordi"/"raccordo", "adattatori"/"adattatore",
  "doccia"/"docce"). Il termine intero si cerca ovunque come prima, la **radice solo nel nome**: su tutto il testo "rubinetto" pescava l'intera categoria
  "Rubinetteria" (744 in più). A 4 lettere niente radice ("tub" prenderebbe quasi tutto). Prima lo faceva per caso la somiglianza.
- **Il limite conta le schede, non le righe** (`LIMITE_RISULTATI` = 100, uguale per ricerca live, `/cerca`, categoria, marchio): il `LIMIT` stava sulle righe e le varianti si
  raggruppavano DOPO, quindi con 60 si vedevano da 23 a 54 schede a seconda della parola ("adatt" 23, "adattatore" 50) e il resto spariva senza avviso. Ora una riga per gruppo
  (`ROW_NUMBER() OVER (PARTITION BY COALESCE(gruppo_id, -id))`) **prima** del `LIMIT` (si chiede limite+1: l'elenco porta `troncato` non enumerabile → `elenco.troncato`, JSON
  `troncato`, nota "Mostrati i primi risultati" in pagina e nella ricerca live, "Oltre N risultati"). Finestra e ricerca lavorano su poche colonne e rileggono le righe intere solo
  dei risultati (sulle righe intere +80 ms a pagina). Provato: "ada" 260 ≥ "adat" 236 ≥ "adatt" 211 ≥ "adattatore" 191, e ogni risultato di una parola lunga c'è anche in quella corta.
- **Parole di ricerca** (`dividiTermini`): `%` e `_` valgono per sé (`escapeLike`; "%%" leggeva tutto il catalogo in 3 s), la sola punteggiatura non è una parola (niente query),
  "dn 50"/"ø 20" si uniscono e `ø20`/`dn50`/`ø20mm` cercano la misura intera con confine (`ø\s?20(?!\d)`: prima "ø20" trovava "Ø200"). Prove: `test/catalogo/ricerca.test.js`.
- **Ancora lente** (non toccate, stesso costo di prima): ricerche in pollici (`3/4"`) con l'equivalenza in mm, che fanno una regex su tutti i nomi; e "diametro N" / "N mm"
  come due parole separate (non una misura).
- Marchio e categoria si cercano dallo **slug**, non dalla tabella `brands` (vuota).
- **Niente chip di filtro cliccabili** (rimossi da /cerca e /categoria su richiesta esplicita,
  non riproporli): solo ricerca testuale libera.
