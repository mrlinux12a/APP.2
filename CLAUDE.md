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

## Richieste e ordini

- Zona non filtra più i distributori candidati (`distributoriCandidati` in `src/richieste.js`
  ignora il parametro `zona`): campo residuo su `distributors`/`users`, non aspettarsi che
  limiti chi riceve una richiesta.
- L'ordine automatico (`richieste.impostaAssegnatore`, chiamato da `aggiornaScadenza`) scatta a
  ogni lettura della richiesta, non solo dal `setInterval` di 30s in fondo a `server.js`: su
  Vercel quel timer non gira tra una richiesta e l'altra, quindi senza questo la richiesta
  restava bloccata finché qualcuno non riapriva quella pagina per caso. L'assegnatore si
  registra in `src/flusso_cliente.js`: uno script che usa solo `src/richieste.js` non lo ha.
- La risposta del banco (`/distributore/richieste/:id/rispondi`) oggi passa solo `rifiuta` e
  `prezzoRichiesto`: `rispondi()` supporta ancora `righe`/`sconti`/`scontoCliente` (disponibilità
  parziale, sconto riga per riga) ma nessuna route li usa più — non è codice morto da un refuso,
  è la UI attuale che li ha rimossi.

## App nativa (`mobile/`)

Panoramica e avvio in README. Qui solo ciò che non si deduce dal codice.

- React Native + Expo (Expo Router in `mobile/src/app/`), **niente WebView** per scelta
  esplicita. Fase 1 solo installatore, poi banco "leggero", l'agente resta web. Le API Expo
  cambiano a ogni SDK: guida e regole in `mobile/AGENTS.md`, doc versionata prima di scrivere.
- `src/api_v1.js` è montata in `server.js` **prima** di controllo origine, sessione e middleware
  `res.locals`: solo token Bearer (`src/token_app.js`), CORS aperto (nessun cookie in gioco).
  `/api/v1/login` rifiuta i ruoli diversi da `cliente`.
- Logica condivisa col sito, non duplicata: tutto il flusso richiesta → offerte → ordine →
  stato ordini in **`src/flusso_cliente.js`** (le route di `server.js` fanno solo render/redirect:
  non rimetterci logica), più `src/prodotto_json.js` e `src/limite_login.js`.
- Carrello sul telefono (AsyncStorage per utente), totali ricalcolati dal server. Stato in
  `mobile/src/negozio.ts` con abbonamento per selettore: con un Context normale ogni "+"
  ridisegnava tutto l'elenco ed era lento — non tornarci.
- Scelte grafiche volute (richieste esplicite): prezzo sempre in fondo alla card e centrato sullo
  stepper; 2 misure affiancate su una riga, da 3 tendina; nome in Sora 600 come sul sito; righe
  dentro una card dello stesso colore del riquadro foto.
- Marchi assenti dall'app: `/marchi` non è linkato e nessun marchio è attivo.
- `mobile/src/icone.ts` è **generato** da `src/icone.js` (`node scripts/genera_icone_app.js`).
- Verifica: `npx tsc --noEmit` in `mobile/`; anteprima nel browser con la config `app-web` di
  `.claude/launch.json` (serve anche il server su :3000). Nel pannello browser nascosto clic e
  scroll non arrivano: leggere lo stato con `javascript_tool`.
- Provare richiesta/offerte/ordine **senza** creare richieste vere (arrivano ai banchi reali):
  sostituire `window.fetch` con risposte catturate dall'API su richieste esistenti e navigare con
  `history.pushState` + evento `popstate`. Per provare il resto: utente di prova creato
  direttamente in `users` (password casuale, nessuna notifica ai banchi) e poi cancellato; le
  credenziali demo del README funzionano ma hanno storico vero.

## Notifiche

Badge "Stato ordini" somma non lette di `ordini`+`richieste`. Ricalcolare **dopo** averle
marcate lette se la route fa render diretto (non redirect), altrimenti resta il valore vecchio.

## File temporanei

Script una tantum nello scratchpad di sessione o in root con prefisso `_tmp_` (mai in git) —
cancellarli dopo l'uso.
