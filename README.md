# Ordini Minuteria — MVP (Blocco 1)

App per digitalizzare gli ordini di minuteria tra installatori/idraulici pilota e il grossista.
Questo è **solo il Blocco 1**: creazione ordine (cliente) + vista ordini (agente). Il catalogo è
seedato con dati demo — il caricamento vero (CSV/form) è il Blocco 2.

## Avvio in locale

Richiede **Node.js 22.5 o superiore** (usa il modulo SQLite integrato in Node, niente
compilazioni native da installare — più semplice su qualsiasi hosting).

```
npm install
npm run seed     # crea/aggiorna utenti demo e catalogo demo (idempotente)
npm start
```

Apri `http://localhost:3000`. Vedrai un avviso "SQLite is an experimental feature": è normale,
non un errore.

## Credenziali demo

| Ruolo   | Utente  | Password    | Chi è |
|---------|---------|-------------|-------|
| Agente  | agente  | agente123   | Grossista / gestore |
| Cliente | rossi   | cliente123  | Rossi Impianti Srl |
| Cliente | bianchi | cliente123  | Idraulica Bianchi |
| Cliente | verdi   | cliente123  | Termoidraulica Verdi |

Queste credenziali sono solo per il test interno. Prima di far provare l'app ai clienti pilota
vanno cambiate (per ora si aggiornano a mano nel DB o rilanciando `db/seed.js` con altri dati —
un pannello per gestirle non è ancora stato costruito, non serve per il Blocco 1).

## Come si usa

**Cliente**: login → catalogo prodotti con quantità → scelta ritiro/consegna → invia ordine →
pagina di conferma con il totale finale (listino scontato + costi di gestione già inclusi, senza
dettaglio della percentuale, come deciso).

**Agente**: login → lista di tutti gli ordini ricevuti (cliente, data, importo, stato) → dettaglio
di ogni ordine con le righe prodotto. In questo blocco la vista è di sola lettura: il cambio di
stato (in evasione / evaso) arriva nel Blocco 3.

## Dati e prezzi

- Ogni prodotto ha un prezzo di listino e uno sconto Base **per prodotto** (come deciso, non un
  valore unico globale).
- Al momento dell'ordine il prezzo netto e lo sconto vengono "fotografati" nella riga ordine
  (`order_items`), così uno storico resta corretto anche se in futuro il prezzo di listino cambia.
- Il costo di servizio (10%, non mostrato come percentuale) è applicato solo al totale finale
  dell'ordine ed è configurabile nella tabella `config` (`servizio_pct`) senza toccare il codice.

## Struttura

```
server.js        entrypoint Express
db/schema.sql     schema SQLite
db/seed.js        dati demo (utenti + catalogo)
src/pricing.js    calcolo prezzi/totali
src/auth.js       middleware di autenticazione/ruolo
views/            pagine EJS (mobile-first, CSS in public/style.css)
```

Il database è un singolo file SQLite (`db/minuteria.db`), creato automaticamente al primo avvio.

Vedi anche `SCOPE.md` per l'elenco di cosa c'è oggi e cosa è volutamente fuori.
