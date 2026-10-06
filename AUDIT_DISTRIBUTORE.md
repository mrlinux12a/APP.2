# Lato distributore (banco) — punti ancora aperti

Origine: audit del 05/09/2026 (test end-to-end sul DB di produzione), ripulito il 29/09 e il 04/10/2026:
restano solo i punti **ancora veri nel codice**.

## Bug non corretto (serve una decisione)

**La stima di consegna ignora la `consegna_ore` dichiarata dal banco quando il cliente non ha una
posizione.** `minutiStimati()` in `src/consegna.js`, con `km === null`, ritorna solo `partenzaMinuti`; il
chiamante (`rispondi()` in `src/richieste.js`) passa solo la partenza. Con il banco che dichiara
*partenza 2 ore, consegna 24 ore* la stima (`consegna_minuti_stimati`, che finisce nella notifica
"Ordine confermato" a modulo WhatsApp spento) dice "2 ore", mentre la pagina dell'ordine dice 1 giorno.

**Oggi è dormiente**: tutti gli installatori hanno coordinate fisse (Via Puggia 22/3) e con il gruppo
WhatsApp acceso vale il tempo scritto dal corriere. Riemerge se tornano indirizzi veri senza posizione.
Non è un refuso ma una scelta: il fallback probabile è `Math.max(partenzaMinuti, consegna_ore * 60)`, ma va
deciso se le "24 ore" dichiarate includano già il viaggio.

## Miglioramenti da fare (in ordine di impatto percepito, non di difficoltà)

1. **Nessun passaggio di verifica prima di confermare**: il banco preme un solo pulsante ("Accetta
   ordine") e la conferma chiude subito, facendo partire il messaggio ai corrieri.
2. **Nessun promemoria a ridosso della scadenza**: se il banco non ha la scheda aperta l'unico
   avviso è la notifica iniziale; niente secondo avviso (es. a 2 minuti dalla chiusura). Spiega
   in parte le tante "Non risposta" nello storico.
3. **"Storico richieste" è una lista unica**, senza filtri (per stato o cliente) né paginazione:
   con un banco reale e decine di richieste al giorno diventa inutilizzabile.
4. **Nessun "segna tutte come lette"** nelle notifiche: con più clienti il campanello resta con un
   badge enorme.
5. **La pagina Clienti non ha ricerca né filtro**: va bene con 3 clienti demo, non con decine o
   centinaia di clienti approvati.
6. **Nessuna vista d'insieme giornaliera** oltre ai 3 contatori (da confermare / da preparare /
   in preparazione): ordini evasi oggi, valore totale, tempo medio di risposta.

L'ordine di priorità dei punti 1-6 è una valutazione soggettiva: vale la pena discuterne prima di
metterci mano.
