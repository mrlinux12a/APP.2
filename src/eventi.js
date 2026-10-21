// Eventi dal server alle pagine aperte dell'installatore (Server-Sent Events): invece di far chiedere alla pagina "è cambiato qualcosa?" ogni pochi secondi,
// la pagina tiene aperta UNA connessione (GET /api/eventi, in server.js) e il server le scrive solo quando succede qualcosa. Oggi: l'ordine è stato segnato
// consegnato dal corriere (flusso_cliente.scriviConsegna) → la pagina dell'ordine diventa "Consegnato" e l'icona/scheda "Stato ordini" si aggiornano subito.
//
// Vale dentro UN processo: se l'evento nasce in un altro (per esempio il voto del corriere letto da un server locale con la stessa base dati) la pagina non lo
// riceve da qui, per questo le pagine tengono comunque un controllo lento di sicurezza (public/app.js). Niente di questo passa dal database: nessuna query.

const MASSIMO_PER_UTENTE = 8; // schede aperte dello stesso utente: oltre, la più vecchia viene chiusa (una scheda dimenticata non accumula connessioni)

const canali = new Map(); // id utente -> insieme delle risposte aperte

// Registra una connessione aperta; ritorna la funzione che la toglie (da chiamare alla chiusura).
function iscrivi(utenteId, res) {
  let insieme = canali.get(utenteId);
  if (!insieme) {
    insieme = new Set();
    canali.set(utenteId, insieme);
  }
  while (insieme.size >= MASSIMO_PER_UTENTE) {
    const vecchia = insieme.values().next().value;
    insieme.delete(vecchia);
    try { vecchia.end(); } catch (e) { /* già chiusa */ }
  }
  insieme.add(res);
  return () => {
    insieme.delete(res);
    if (!insieme.size && canali.get(utenteId) === insieme) canali.delete(utenteId);
  };
}

// Scrive un evento a tutte le pagine aperte di quell'utente. NON lancia mai: chi emette (un'azione del corriere, una consegna) non deve fallire per una pagina chiusa.
function emetti(utenteId, tipo, dati) {
  const insieme = canali.get(utenteId);
  if (!insieme) return 0;
  const messaggio = `event: ${tipo}\ndata: ${JSON.stringify(dati || {})}\n\n`;
  let consegnati = 0;
  for (const res of [...insieme]) {
    try {
      res.write(messaggio);
      consegnati += 1;
    } catch (e) {
      insieme.delete(res);
    }
  }
  return consegnati;
}

// Alla chiusura del server: le connessioni aperte non finiscono da sole e terrebbero fermo `server.close`.
function chiudiTutti() {
  for (const insieme of canali.values()) {
    for (const res of insieme) {
      try { res.end(); } catch (e) { /* già chiusa */ }
    }
  }
  canali.clear();
}

function connessioniAperte(utenteId) {
  if (utenteId === undefined) return [...canali.values()].reduce((somma, insieme) => somma + insieme.size, 0);
  return canali.has(utenteId) ? canali.get(utenteId).size : 0;
}

module.exports = { iscrivi, emetti, chiudiTutti, connessioniAperte };
