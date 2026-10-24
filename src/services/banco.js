// Cose del banco (il distributore) che servono a più pagine: l'intestazione con ditta e filiale, i numeri della barra, gli ordini del banco e il
// passaggio "Preparato".
const db = require('../../db');
const { conCache } = require('../memo');
const geo = require('../geo');
const notifiche = require('../notifiche');
const format = require('../format');
const { BACHECA } = require('../config/bacheca');

// ---------- Intestazione del banco ----------

// Ditta e filiale scritte nell'intestazione del banco (views/partials/banco_testa.ejs), che ha ogni pagina del distributore: cambiano di rado, quindi si
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
// l'intestazione (partials/banco_avviso.ejs) lo scrive già al primo disegno, senza aspettare il browser. `primaScadeSec` NON sta nei contatori:
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

module.exports = {
  intestazioneBanco,
  rileggiIntestazioneBanco,
  letturaBanco,
  contatoriBanco,
  riassuntoArticoli,
  distanzaClienteBanco,
  ordineDelBanco,
  prendiInCarico,
};
