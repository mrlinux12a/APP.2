# Lato distributore (banco) — punti ancora aperti

Origine: audit del 05/09/2026, un test end-to-end sul DB di produzione con i panni
dell'installatore (cliente demo) e poi del banco (AFIS): richiesta, risposta, scelta, ordine,
bolla. Ripulito il 29/09/2026: sono rimasti solo i punti **ancora veri nel codice**. I tre bug
di quella sessione (finestra di conferma a 10 *secondi* invece di minuti, errore 500 sul dettaglio
ordine, minuti non arrotondati nelle notifiche) sono corretti e committati, così come il
messaggio "Finestra di conferma chiusa" dopo una conferma riuscita, le pagine di errore con lo
stack trace e le icone 📦/📄 dello storico: non compaiono più.

## Bug non corretto (serve una decisione)

**Il tempo di consegna mostrato al cliente nel confronto offerte è sbagliato quando il cliente
non ha condiviso la posizione** (la geolocalizzazione è opt-in, quindi è il caso comune).
`minutiStimati()` in `src/consegna.js`, con `km === null`, ritorna solo `partenzaMinuti` e scarta
la `consegna_ore` dichiarata dal banco; il chiamante (`rispondi()` in `src/richieste.js`) passa
solo la partenza. Nel test il banco aveva dichiarato *partenza 2 ore, consegna 24 ore* ma il
confronto mostrava "Da te in 2 ore", mentre il riepilogo ordine mostrava correttamente 1 giorno.

Non è un refuso ma una scelta di comportamento: il fallback probabile è
`Math.max(partenzaMinuti, consegna_ore * 60)`, ma va deciso se "24 ore" dichiarate dal banco
includano già il viaggio. Ricade sul banco: il cliente riceve una promessa diversa da quella
dichiarata.

## Miglioramenti da fare (in ordine di impatto percepito, non di difficoltà)

1. **Nessun passaggio di verifica prima di confermare**: il cliente passa da un riepilogo
   esplicito, il banco preme un solo pulsante ("Accetta ordine") che chiude subito la conferma.
2. **Nessun promemoria a ridosso della scadenza**: se il banco non ha la scheda aperta l'unico
   avviso è la notifica iniziale; niente secondo avviso (es. a 2 minuti dalla chiusura). Spiega
   in parte le tante "Non risposta" nello storico.
3. **"Storico richieste" è una lista unica**, senza filtri (per stato o cliente) né paginazione:
   con un banco reale e decine di richieste al giorno diventa inutilizzabile.
4. **Nessun "segna tutte come lette"** nelle notifiche: con più clienti il campanello resta con un
   badge enorme (34 non lette in pochi giorni di test).
5. **La pagina Clienti non ha ricerca né filtro**: va bene con 3 clienti demo, non con decine o
   centinaia di clienti approvati.
6. **Nessuna vista d'insieme giornaliera** oltre ai 3 contatori (da confermare / da preparare /
   in preparazione): ordini evasi oggi, valore totale, tempo medio di risposta.

L'ordine di priorità dei punti 1-6 è una valutazione soggettiva: vale la pena discuterne prima di
metterci mano.
