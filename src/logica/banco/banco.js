// Cose del banco (il distributore) che servono a più pagine: l'intestazione con ditta e filiale, i numeri della barra, gli ordini del banco e il
// passaggio "Preparato".
const db = require('../../../db');
const { conCache } = require('../../comune/memo');
const geo = require('../ordini/geo');
const notifiche = require('../notifiche/notifiche');
const format = require('../../comune/format');
const { BACHECA } = require('../../config/bacheca');
const pagamenti = require('../pagamenti/pagamenti');

// ---------- Intestazione del banco ----------

// Ditta e filiale scritte nell'intestazione del banco (views/partials/banco/banco_testa.ejs), che ha ogni pagina del distributore: cambiano di rado, quindi si
// leggono una volta al minuto invece che a ogni pagina. La chiave della cache include una "versione" per banco: quando l'Anagrafica del banco cambia
// nome o filiale la si alza e l'intestazione si rilegge subito (senza, il vecchio nome restava fino a un minuto).
const versioneIntestazioneBanco = new Map();
const intestazioneBancoLetta = conCache(60000, (distributorId) =>
  db.prepare('SELECT nome, filiale FROM distributors WHERE id = ?').get(distributorId)
);

// Dà ditta e filiale del banco, per l'intestazione delle sue pagine.
const intestazioneBanco = (distributorId) => intestazioneBancoLetta(distributorId, versioneIntestazioneBanco.get(distributorId) || 0);

// Fa rileggere subito l'intestazione del banco (dopo che ha cambiato nome o filiale nell'Anagrafica).
const rileggiIntestazioneBanco = (distributorId) => versioneIntestazioneBanco.set(distributorId, (versioneIntestazioneBanco.get(distributorId) || 0) + 1);

// ---------- Numeri della barra del banco ----------

// I contatori e, nella stessa lettura (nessuna query in più), quanto manca alla prima richiesta da confermare: la striscia arancio sotto
// l'intestazione (partials/banco/banco_avviso.ejs) lo scrive già al primo disegno, senza aspettare il browser. `primaScadeSec` NON sta nei contatori:
// cambia a ogni secondo, e i contatori finiscono in data-versione (la pagina si ricarica se cambiano).
async function letturaBanco(distributorId) {
  // Prima erano 5 query separate, una dopo l'altra (await in sequenza): eseguita ad ogni singola pagina vista da un distributore, sommava 5 andate e
  // ritorno verso il DB dove ne bastava una per gli ordini (con FILTER) più altre due, tutte e tre in parallelo.
  const [ordini, daRispondereRow, daApprovareRow] = await Promise.all([
    db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE stato = 'inviato' AND consegnato_il IS NULL) AS da_preparare,
         COUNT(*) FILTER (WHERE stato = 'in_evasione') AS in_preparazione,
         COALESCE(MAX(id), 0) AS ultimo
         FROM orders WHERE distributor_id = ?`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()) AS n,
              COALESCE(MAX(r.id) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()), 0) AS ultima,
              COUNT(*) FILTER (WHERE rr.corriere_stato = 'in_attesa') AS attesa_corriere,
              MIN(EXTRACT(EPOCH FROM (r.scade_il - NOW()))::int) FILTER (WHERE rr.esito = 'in_attesa' AND r.scade_il > NOW()) AS prima_scade
         FROM request_responses rr JOIN requests r ON r.id = rr.request_id
        WHERE rr.distributor_id = ?
          AND ((rr.esito = 'in_attesa' AND r.scade_il > NOW()) OR rr.corriere_stato = 'in_attesa')`
    ).get(distributorId),
    db.prepare(
      `SELECT COUNT(*) AS n FROM client_distributors WHERE distributor_id = ? AND stato = 'in_attesa'`
    ).get(distributorId),
  ]);
  return {
    contatori: {
      daRispondere: Number(daRispondereRow.n),
      daPreparare: Number(ordini.da_preparare),
      inPreparazione: Number(ordini.in_preparazione),
      daApprovare: Number(daApprovareRow.n),
      // Non si vedono in pagina: servono a /api/distributore/novita per accorgersi che qualcosa è cambiato anche quando i conteggi restano uguali (una
      // richiesta scade e un'altra arriva, un corriere prende la consegna).
      ultimaRichiesta: Number(daRispondereRow.ultima),
      ultimoOrdine: Number(ordini.ultimo),
      inAttesaCorriere: Number(daRispondereRow.attesa_corriere),
    },
    primaScadeSec: daRispondereRow.prima_scade === null || daRispondereRow.prima_scade === undefined ? null : Math.max(0, Number(daRispondereRow.prima_scade)),
  };
}

// Solo i numeri che il banco deve avere sotto gli occhi (richieste da confermare, ordini da preparare...).
async function contatoriBanco(distributorId) {
  return (await letturaBanco(distributorId)).contatori;
}

// Articoli di una scheda della home: conteggi per la riga "2 articoli · 3 pezzi" e le prime righe da mostrare.
function riassuntoArticoli(righe) {
  return {
    nArticoli: righe.length,
    nPezzi: righe.reduce((somma, r) => somma + Number(r.quantita || 0), 0),
    anteprima: righe.slice(0, BACHECA.righeVisibili),
    altre: Math.max(0, righe.length - BACHECA.righeVisibili),
  };
}

// ---------- Ordini del banco ----------

// Distanza banco↔cliente: c'è solo se entrambi hanno dato il consenso alla posizione.
function distanzaClienteBanco(cliente, distributore) {
  if (!cliente || !distributore) return null;
  if (!cliente.geo_consenso) return null;
  const km = geo.distanzaKm(
    { lat: cliente.geo_lat, lng: cliente.geo_lng },
    { lat: distributore.geo_lat, lng: distributore.geo_lng }
  );
  return geo.formattaDistanza(km);
}

// Carica un ordine verificando che appartenga al banco loggato (altrimenti null: l'ordine di un altro banco non si vede).
async function ordineDelBanco(req) {
  const ordine = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!ordine || ordine.distributor_id !== req.session.user.distributor_id) return null;
  return ordine;
}

// Segna l'ordine come preparato dal banco (stato 'inviato' -> 'in_evasione': per il banco passa da "Da preparare" a "In consegna") e avvisa il cliente.
// Scatta SOLO con "Preparato" (POST .../preparazione, dalla card in home e dalla pagina dell'ordine): aprire la pagina dell'ordine non lo prende in
// carico. Agisce solo su 'inviato': un ordine già partito (in_evasione, evaso) o consegnato resta com'è, anche se qualcuno chiama di nuovo "Preparato"
// da una pagina rimasta aperta.
async function prendiInCarico(ordine) {
  if (ordine.stato !== 'inviato') return ordine;
  await db.prepare(
    `UPDATE orders SET stato = 'in_evasione', in_evasione_il = NOW(), preso_in_carico_il = NOW()
      WHERE id = ?`
  ).run(ordine.id);
  // Il nome della ditta come lo vede l'installatore ("BOREA"); un guasto nella lettura non deve fermare "Preparato".
  const dittaOrdine = ordine.distributor_id
    ? await db.prepare('SELECT nome FROM distributors WHERE id = ?').get(ordine.distributor_id).catch(() => null)
    : null;
  await notifiche.notifica(ordine.cliente_id, {
    titolo: 'Ordine in preparazione',
    testo: `Ordine #${ordine.id} — ${format.nomeCommerciale(dittaOrdine && dittaOrdine.nome) || 'Il banco'} sta preparando il tuo materiale.`,
    link: '/ordini/' + ordine.id,
    categoria: 'ordini',
    order_id: ordine.id,
  });
  return { ...ordine, stato: 'in_evasione', in_evasione_il: new Date(), preso_in_carico_il: new Date() };
}

// ---------- Risposta alla richiesta, eliminazioni ----------

// La risposta di questo banco a una richiesta, con da quanto tempo ha risposto (`secondi_da_risposta`, contati dal DB: lo stesso calcolo della home, per il
// tempo di attesa del corriere). Undefined se il banco non ha risposto.
async function rispostaConTempi(richiestaId, distributorId) {
  return db
    .prepare(
      `SELECT rr.*, EXTRACT(EPOCH FROM (NOW() - rr.risposto_il))::int AS secondi_da_risposta
         FROM request_responses rr
        WHERE rr.request_id = ? AND rr.distributor_id = ?`
    )
    .get(richiestaId, distributorId);
}

// Elimina un ordine dal banco: l'ordine sparisce e il pagamento torna all'installatore. Dice se il pagamento è stato rimborsato.
async function eliminaOrdineDalBanco(ordine) {
  const elimina = db.transaction(async () => {
    // L'ordine sparisce, ma l'installatore ha già pagato la consegna (con Stripe la carta è anche già stata incassata): il pagamento gli torna (solo
    // DB; lo esegue il giro di Stripe). Senza questa riga spariva l'ordine e restava addebitato.
    const rimborsato = ordine.request_id ? await pagamenti.rimborsa(ordine.request_id) : false;
    if (ordine.request_id) await db.prepare('UPDATE requests SET order_id = NULL, stato = ? WHERE id = ?').run('annullata', ordine.request_id);
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(ordine.id);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(ordine.id);
    return rimborsato;
  });
  return elimina();
}

// Elimina una richiesta dal banco (solo per lui: sparisce da "da confermare" e dal suo storico). Se un altro banco l'ha già ordinata, o ci sono altre
// risposte, toglie solo la risposta di questo banco; se è l'unica rimasta e la richiesta non è ordinata, toglie anche la richiesta vuota.
async function eliminaRichiestaDalBanco(richiesta, risposta) {
  const elimina = db.transaction(async () => {
    await db.prepare('DELETE FROM request_response_items WHERE response_id = ?').run(risposta.id);
    await db.prepare('DELETE FROM request_responses WHERE id = ?').run(risposta.id);
    const rm = await db.prepare('SELECT COUNT(*) n FROM request_responses WHERE request_id = ?').get(richiesta.id);
    const rimaste = rm ? Number(rm.n) : 0;
    if (rimaste === 0 && richiesta.stato !== 'ordinata') {
      // La richiesta sparisce: la carta dell'installatore non deve restare bloccata (o addebitata) per qualcosa che non esiste più. Solo DB (lo esegue
      // il giro di Stripe); no-op se la richiesta era già stata rimborsata o è del vecchio flusso.
      await pagamenti.rimborsa(richiesta.id);
      await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(richiesta.id);
      await db.prepare('DELETE FROM requests WHERE id = ?').run(richiesta.id);
    }
  });
  await elimina();
}

module.exports = {
  rispostaConTempi,
  eliminaOrdineDalBanco,
  eliminaRichiestaDalBanco,
  intestazioneBanco,
  rileggiIntestazioneBanco,
  letturaBanco,
  contatoriBanco,
  riassuntoArticoli,
  distanzaClienteBanco,
  ordineDelBanco,
  prendiInCarico,
};
