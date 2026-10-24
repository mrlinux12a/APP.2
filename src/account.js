// Eliminazione dell'account di un installatore (richiesta dell'app: Google Play e Apple vogliono che chi si iscrive dall'app possa anche
// cancellarsi dall'app).
//
// "Eliminare" qui vuol dire disattivare e anonimizzare, non cancellare le righe: ordini, ricevute e pagamenti devono
// restare, per obblighi fiscali e contabili e perché i banchi li referenziano. Quindi:
//  · RESTANO i dati dell'impresa che servono a quei documenti: ragione sociale, partita IVA, codice fiscale, indirizzo della sede e di
//    consegna (sono dati di un'impresa, non di una persona, e compaiono sulle ricevute già emesse);
//  · SPARISCONO i dati personali di contatto (referente, email, telefono, PEC/SDI), il nome utente (diventa "eliminato-<id>", liberando
//    quello vecchio) e la password; l'account non può più entrare (attivo = 0);
//  · si cancellano gli accessi (token dell'app, sessioni web), i telefoni registrati per le push e le notifiche in-app.
// Si rifiuta se c'è qualcosa in corso (una richiesta in attesa, un ordine non ancora consegnato nelle ultime 24 ore, un pagamento a metà):
// la persona deve prima lasciarlo finire, altrimenti resterebbe un ordine senza nessuno a cui consegnarlo.
const crypto = require('crypto');
const db = require('../db');
const push = require('./push');

class AccountNonEliminabile extends Error {
  // Crea l'errore "c'è ancora qualcosa in corso": il testo va anche al cliente così com'è.
  constructor(messaggio) {
    super(messaggio);
    this.messaggioCliente = messaggio;
  }
}

// Cosa c'è ancora in corso per questo cliente: { richieste, ordini, pagamenti } (numeri).
async function attivitaInCorso(userId) {
  const riga = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM requests WHERE cliente_id = ? AND stato = 'in_attesa') AS richieste,
         (SELECT COUNT(*) FROM orders WHERE cliente_id = ? AND consegnato_il IS NULL AND creato_il > NOW() - INTERVAL '24 hours') AS ordini,
         (SELECT COUNT(*) FROM stripe_pagamenti WHERE cliente_id = ? AND stato IN ('da_pagare', 'in_creazione') AND creato_il > NOW() - INTERVAL '2 hours') AS pagamenti`
    )
    .get(userId, userId, userId);
  return {
    richieste: Number(riga && riga.richieste) || 0,
    ordini: Number(riga && riga.ordini) || 0,
    pagamenti: Number(riga && riga.pagamenti) || 0,
  };
}

// Elimina (anonimizza) l'account di un cliente. Lancia AccountNonEliminabile se c'è qualcosa in corso. Il chiamante ha già verificato la password.
async function eliminaAccount(utente) {
  if (!utente || utente.ruolo !== 'cliente') throw new AccountNonEliminabile('Questo account non si può eliminare dall’app.');
  const corso = await attivitaInCorso(utente.id);
  if (corso.richieste || corso.ordini || corso.pagamenti) {
    throw new AccountNonEliminabile(
      'Hai una richiesta o un ordine ancora in corso. Aspetta che finisca (o che arrivi la consegna) e poi elimina l’account.'
    );
  }

  // Una password che nessuno può indovinare né digitare: non è un hash bcrypt valido, quindi nessun confronto potrà mai riuscire.
  const passwordInutilizzabile = '!eliminato!' + crypto.randomBytes(24).toString('hex');
  const elimina = db.transaction(async () => {
    await db.prepare('DELETE FROM app_tokens WHERE user_id = ?').run(utente.id);
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(utente.id);
    // Le sessioni web aperte restano valide anche dopo attivo = 0 (il login controlla `attivo`, la sessione no): vanno tolte.
    await db.prepare(`DELETE FROM session WHERE (sess::jsonb #>> '{user,id}') = ?`).run(String(utente.id));
    await db
      .prepare(
        `UPDATE users
            SET attivo = 0, username = ?, password_hash = ?, email = '', telefono = '', referente = '', sdi_pec = '', nome = '', cognome = ''
          WHERE id = ? AND ruolo = 'cliente'`
      )
      .run('eliminato-' + utente.id, passwordInutilizzabile, utente.id);
  });
  await elimina();
  // Fuori dalla transazione e senza che un guasto la annulli: il telefono non riceve più nulla (il token si cancellerebbe comunque alla prima push).
  await push.rimuoviUtente(utente.id).catch((err) => console.error('[account] telefoni non rimossi:', err.message));
  await require('./web_push').rimuoviUtente(utente.id).catch((err) => console.error('[account] browser non rimossi:', err.message));
  return true;
}

module.exports = { AccountNonEliminabile, attivitaInCorso, eliminaAccount };
