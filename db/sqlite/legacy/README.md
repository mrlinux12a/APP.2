# File legacy — non più usati dall'app

Questi file erano alla radice di `db/` (duplicati/superati dal refactor che ha separato
`db/postgres/` e `db/sqlite/`). Nessun file del progetto li richiede più: verificato con
`grep -rn "require"` su `server.js`, `src/*.js`, `db/*.js`.

- `schema.sql` — identico a `db/sqlite/schema.sql` (il vero schema usato oggi).
- `index.sqlite.js` — versione precedente di `db/sqlite/index.js`, senza le colonne
  marchi/RAEE/sottocategoria aggiunte dopo.
- `riclassifica.js` — versione rotta: richiede `./tassonomia`, un file che non esiste più
  in questa cartella (cancellato). La versione valida è `db/sqlite/riclassifica.js`.

Tenuti qui solo per sicurezza/riferimento storico, non per essere eseguiti.
