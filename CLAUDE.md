# CLAUDE.md — contesto di lavoro per Claude

Orientamento rapido dopo un reset di contesto. Flusso completo in **README.md**, cosa manca
in **SCOPE.md**. Qui solo ciò che non sta già scritto lì.

## Stack e ambiente

- Node/Express + EJS, niente build, JS vanilla in `public/app.js`.
- DB: `db/index.js` sceglie Postgres se c'è `DATABASE_URL`, altrimenti SQLite — **in pratica
  gira solo su Postgres** (sintassi diretta in `server.js`/`src/*.js`). SQLite è legacy/rotto.
- `.env` locale punta al **Supabase di produzione condiviso**, nessun DB di test — girare in
  locale scrive sul DB vero.
- Server locale **senza auto-reload**: dopo modifiche a `server.js`/file `require`-ati serve
  riavvio manuale (`.ejs`/`public/*` no).
- Modifiche schema in **entrambi** `db/postgres/schema.sql` e `db/schema.pg.sql` (root), poi
  `node scripts/apply_schema_pg.js` (transazione unica: un pezzo fallito annulla tutto).
- Mai `pool.on('connect', async ...)`: causa query concorrenti sullo stesso client.

## Catalogo

- **27.676 prodotti attivi** (non 51.182 — conteggi più vecchi altrove sono stale).
- `products.misura` è **0% popolata**: la misura va estratta dal testo di `nome`.
- `products.codice` è un ID interno, non il codice produttore; `products.codice_fornitore` è
  quello vero.
- Raggruppamento varianti (`raggruppaVarianti()`): un numero nudo a inizio nome NON è una
  misura di default, serve un simbolo attaccato (Ø, Dn, mm, ", °).

## Ricerca (`src/catalogo.js`, `cercaProdotti`)

Niente colonna "materiale", `misura` vuota: tutto estratto da `nome`.
- Sinonimi pollici↔mm solo per taglie gas/pressione (1/8–2.1/2), mai per scarichi/pluviali.
- Frazioni a parole ("un mezzo", "tre quarti"...) tradotte in cifra prima di cercare.
- Parole generiche di misura ("diametro", "pollici"...) tradotte in un pattern sul nome, mai
  cercate alla lettera (il catalogo non le scrive mai per esteso).
- Refusi tollerati (`word_similarity > 0.45`, da 4 caratteri) su nomi e parole-comando sopra.
- **Niente chip di filtro cliccabili** (rimossi da /cerca e /categoria su richiesta esplicita,
  non riproporli): solo ricerca testuale libera.

## Aspetto grafico

Stile "Cantiere Notte" (scuro/ambra) + modalità chiara vera (`data-tema` su `<html>`,
`localStorage('tema')`). Icone SVG in `src/icone.js` (13 icone categoria provvisorie).
Variabili CSS in cima a `public/style.css`. DDT resta bianca (stampa).

Quirk mobile da non reintrodurre: `autocomplete/autocorrect/autocapitalize="off"` sui campi
ricerca; ripristino focus dopo il redraw risultati (altrimenti la tastiera si chiude); tutte le
barre di ricerca usano lo stesso `[data-ricerca]`, mai una navigazione mentre si scrive.

## Notifiche

Badge "Stato ordini" somma non lette di `ordini`+`richieste`. Ricalcolare **dopo** averle
marcate lette se la route fa render diretto (non redirect), altrimenti resta il valore vecchio.

## File temporanei

Script una tantum nello scratchpad di sessione o in root con prefisso `_tmp_` (mai in git) —
cancellarli dopo l'uso.
