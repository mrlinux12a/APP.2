// Il lavoro del corriere nell'app (solo nell'ambiente «app», vedi docs/ambienti.md e docs/app-corrieri.md): le richieste da prendere, il dettaglio, l'accettazione, le
// due fasi della consegna («Vai al ritiro», «Vai al cantiere») e il riepilogo finale.
//
// Come si incastra con il resto:
//  · una richiesta per il corriere è la RISPOSTA di un banco che ha confermato e aspetta un corriere (request_responses: esito 'confermato', corriere_stato
//    'in_attesa'), finché la finestra della richiesta è aperta. È la stessa condizione per cui su WhatsApp parte il messaggio nel gruppo. L'id che l'app usa è
//    quello della risposta;
//  · «Accetta» è richieste.corriereAccetta: scrive il corriere sulla risposta e fa nascere l'ordine (banco e installatore sono avvisati come per WhatsApp). Il primo
//    che accetta vince; un corriere ha una consegna sola alla volta;
//  · «Ho ritirato il materiale» scrive orders.ritirato_il e porta l'ordine del banco da «Da preparare» a «In consegna», come «Preparato»;
//  · «Consegna confermata» è la stessa scrittura del «consegnato» di WhatsApp (flusso_cliente.segnaConsegnatoDalCorriere).
//
// La posizione del corriere (rilevata dal telefono, obbligatoria) arriva a ogni chiamata che ne ha bisogno e non si salva da nessuna parte: serve a calcolare il
// tempo e i km fino al banco, che alla accettazione diventano `corriere_minuti` e `corriere_km`.
const db = require('../../../db');
const format = require('../../comune/format');
const { conCache } = require('../../comune/memo');
const geo = require('../ordini/geo');
const consegna = require('../ordini/consegna');
const percorso = require('../ordini/percorso');
const orari = require('../ordini/orari');
const tappe = require('../ordini/tappe');
const richieste = require('../ordini/richieste');
const flusso = require('../ordini/flusso_cliente');
const notifiche = require('../notifiche/notifiche');

// Un errore "previsto" che l'API dell'app trasforma in una risposta chiara: `stato` è il codice HTTP, `codice` una parola che l'app riconosce (es.
// 'non_piu_disponibile'), `dati` altri campi da restituire.
class ErroreCorriere extends Error {
  constructor(stato, codice, messaggio, dati = {}) {
    super(messaggio);
    this.stato = stato;
    this.codice = codice;
    this.dati = dati;
  }
}

// ---------- Piccoli aiuti ----------

// La posizione arrivata dal telefono: due numeri veri dentro i limiti della Terra e non (0, 0). Altrimenti null (= posizione mancante).
function leggiPosizione(lat, lng) {
  const vuoto = (v) => v === undefined || v === null || String(v).trim() === '';
  if (vuoto(lat) || vuoto(lng)) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lng: b };
}

const arrotonda1 = (n) => Math.round(n * 10) / 10;
// Una tappa (banco o cantiere) come punto { lat, lng }, o null se non ha una posizione vera: coordinate vuote NON valgono (0, 0).
const aPunto = (p) => (p ? leggiPosizione(p.lat, p.lng) : null);

// «Genova» da «Via Puggia 22/3, 16131 Genova GE»: la zona del cantiere per le schede. Prima il pezzo dopo il CAP, poi l'ultimo pezzo dell'indirizzo; vuoto se non si
// capisce.
function zonaDaIndirizzo(indirizzo) {
  const testo = String(indirizzo || '').replace(/\s+/g, ' ').trim();
  if (!testo) return '';
  const m = /\b\d{5}\s+([A-Za-zÀ-ÿ' .-]+?)(?:\s+\(?[A-Z]{2}\)?)?\s*$/.exec(testo);
  if (m && m[1].trim()) return m[1].trim();
  const parti = testo.split(/[,—]/).map((s) => s.trim()).filter(Boolean);
  return parti.length > 1 ? parti[parti.length - 1] : '';
}

// Il nome del corriere come lo vedono banco e installatore.
function nomeCorriere(u) {
  return [u.nome, u.cognome].filter((s) => s && String(s).trim()).join(' ').trim() || String(u.ragione_sociale || '').trim() || 'Corriere';
}

// L'indirizzo per una mappa esterna: le coordinate se ci sono (più precise), altrimenti il testo dell'indirizzo.
function destinazioneMappa(tappa) {
  const p = aPunto(tappa);
  return p ? `${p.lat},${p.lng}` : String((tappa && tappa.indirizzo) || '');
}

// Il link di Google Maps (si apre nell'app delle mappe se c'è, altrimenti nel browser): da `da` (facoltativo: senza, parte dalla posizione del telefono) a `a`.
function urlMappe(da, a) {
  const params = new URLSearchParams({ api: '1', destination: destinazioneMappa(a), travelmode: 'driving' });
  if (da) params.set('origin', destinazioneMappa(da));
  return 'https://www.google.com/maps/dir/?' + params.toString();
}

const CODICE_GIORNO = { Mon: 'lun', Tue: 'mar', Wed: 'mer', Thu: 'gio', Fri: 'ven', Sat: 'sab', Sun: 'dom' };
const senzaZero = (ora) => String(ora).replace(/^0/, '');

// Gli orari del banco oggi, come li scrive l'app: «Banco aperto 7:30 – 12:30 · 14:00 – 18:00», e fino a che ora resta aperto adesso. null se il banco non ha orari.
function orariDelBanco(valoreOrari, quando = new Date()) {
  const tutti = orari.leggiOrari(valoreOrari);
  if (!tutti) return null;
  const stato = orari.statoOrari(valoreOrari, quando);
  const oggi = tutti[CODICE_GIORNO[new Intl.DateTimeFormat('en-GB', { timeZone: orari.FUSO, weekday: 'short' }).format(quando)]] || [];
  const fasce = oggi.map(([da, a]) => `${senzaZero(da)} – ${senzaZero(a)}`);
  const testo = stato.aperto
    ? `Banco aperto ${fasce.join(' · ')}`
    : stato.riapre
    ? `Banco chiuso · riapre ${stato.riapre.testo}`
    : 'Banco chiuso';
  return { aperto: !!stato.aperto, oggi: fasce, testo, chiude_alle: stato.aperto && stato.chiude ? senzaZero(stato.chiude.ora) : null };
}

// ---------- Tragitto dalla posizione del corriere ----------

// Minuti e km in auto da un punto al banco: il servizio di mappe e, se nessuno risponde, la stima in linea d'aria (come per l'installatore, consegna.js).
// { minuti, km, fonte } o null se manca una delle due posizioni.
async function calcolaTragitto(daLat, daLng, aLat, aLng) {
  const da = { lat: daLat, lng: daLng };
  const a = { lat: aLat, lng: aLng };
  const kmAria = geo.distanzaKm(da, a);
  if (kmAria === null) return null;
  const dallaMappa = await percorso.minutiInAuto(da, a);
  if (dallaMappa) return { minuti: dallaMappa.minuti, km: dallaMappa.km === null ? arrotonda1(kmAria * consegna.FATTORE_STRADA) : dallaMappa.km, fonte: 'mappa' };
  const kmStrada = kmAria * consegna.FATTORE_STRADA;
  const v = await consegna.velocitaMedia();
  return { minuti: Math.max(1, Math.round((kmStrada / v) * 60)), km: arrotonda1(kmStrada), fonte: 'stima' };
}

// Le schede si ricaricano ogni pochi secondi e il corriere si sposta di poco: per un minuto stessa risposta se parte (circa) dallo stesso punto (3 decimali = ~100 m).
const tragittoInMemoria = conCache(60 * 1000, calcolaTragitto);
const arrotonda3 = (n) => Math.round(n * 1000) / 1000;

// Dalla posizione del corriere al banco. `fresco`: senza memoria (l'accettazione scrive il numero che poi vede il banco). null senza posizione o senza le coordinate del banco.
async function tragittoAlBanco(pos, banco, { fresco = false } = {}) {
  const dove = aPunto(banco);
  if (!pos || !dove) return null;
  return fresco ? calcolaTragitto(pos.lat, pos.lng, dove.lat, dove.lng) : tragittoInMemoria(arrotonda3(pos.lat), arrotonda3(pos.lng), dove.lat, dove.lng);
}

// I dati del banco cambiano di rado e le schede li chiedono a ogni giro.
const ritiroInMemoria = conCache(30 * 1000, (distributorId) => tappe.datiRitiro(distributorId));

// ---------- Disponibilità ----------

// Legge «Sei disponibile» sempre dal database: la riga dell'utente che arriva con il token può essere vecchia di un minuto.
async function leggiDisponibilita(corriereId) {
  const u = await db.prepare('SELECT corriere_disponibile FROM users WHERE id = ?').get(corriereId);
  return !!(u && Number(u.corriere_disponibile) === 1);
}

async function impostaDisponibilita(corriereId, disponibile) {
  await db.prepare('UPDATE users SET corriere_disponibile = ? WHERE id = ?').run(disponibile ? 1 : 0, corriereId);
  return !!disponibile;
}

// All'uscita dall'app il corriere non è più raggiungibile: niente richieste (né notifiche) finché non rientra e riaccende l'interruttore. Non lancia mai.
async function esciDalServizio(corriereId) {
  try {
    await impostaDisponibilita(corriereId, false);
  } catch (err) {
    console.error('[corrieri] disponibilità non azzerata all\'uscita:', err.message);
  }
}

// ---------- La consegna in corso ----------

// L'id dell'ordine che il corriere sta consegnando (preso e non ancora consegnato), o null.
async function ordineAttivoId(corriereId) {
  const r = await db.prepare('SELECT id FROM orders WHERE corriere_id = ? AND consegnato_il IS NULL ORDER BY id DESC LIMIT 1').get(corriereId);
  return r ? r.id : null;
}

// Una consegna presa il cui ordine non è ancora nato (la creazione è fallita e la riprova il timer): la risposta presa dal corriere, o null.
async function rispostaSenzaOrdine(corriereId) {
  return db
    .prepare(
      `SELECT rr.*
         FROM request_responses rr JOIN requests rq ON rq.id = rr.request_id
        WHERE rr.corriere_id = ? AND rr.corriere_stato = 'preso' AND rq.stato = 'in_attesa'
        ORDER BY rr.id DESC LIMIT 1`
    )
    .get(corriereId);
}

// L'ordine di QUESTO corriere con i dati della risposta da cui è nato (minuti e km stimati, che stanno lì), o null: l'ordine di un altro, o sparito perché il
// banco l'ha eliminato, non si vede.
async function ordineDelCorriere(ordineId, corriereId) {
  const r = await db
    .prepare(
      `SELECT o.*, rr.consegna_minuti_stimati AS stimati_risposta, rr.consegna_km, rr.corriere_km,
              u.ragione_sociale AS installatore
         FROM orders o
         JOIN users u ON u.id = o.cliente_id
         LEFT JOIN request_responses rr ON rr.request_id = o.request_id AND rr.distributor_id = o.distributor_id AND rr.corriere_id = o.corriere_id
        WHERE o.id = ? AND o.corriere_id = ?`
    )
    .get(ordineId, corriereId);
  return r || null;
}

// I minuti del tragitto banco → cantiere: sulla risposta, dopo l'accettazione, c'è la somma (corriere → banco + banco → cantiere).
function minutiBancoCantiere(r) {
  return Math.max(0, (Number(r.stimati_risposta) || 0) - (Number(r.corriere_minuti) || 0));
}

// La consegna in corso come la vede l'app: la fase (1 «Vai al ritiro», 2 «Vai al cantiere»), le due tappe, i tempi e i link alle mappe.
async function consegnaJson(r) {
  const [banco, cantiere] = await Promise.all([ritiroInMemoria(r.distributor_id), tappe.datiConsegna(r.cliente_id, r.destinazione)]);
  const ritirato = format.toDate(r.ritirato_il);
  const minutiTragitto = minutiBancoCantiere(r);
  const kmTragitto = r.consegna_km !== null && r.consegna_km !== undefined ? Number(r.consegna_km) : arrotonda1((geo.distanzaKm(aPunto(banco), aPunto(cantiere)) || 0) * consegna.FATTORE_STRADA) || null;
  const kmBanco = r.corriere_km !== null && r.corriere_km !== undefined ? Number(r.corriere_km) : null;
  const accettata = format.toDate(r.corriere_risposto_il);
  return {
    ordine_id: r.id,
    codice: '#' + r.id,
    fase: ritirato ? 2 : 1,
    accettata_il: accettata ? accettata.toISOString() : null,
    ritirato_il: ritirato ? ritirato.toISOString() : null,
    ritirato_alle: ritirato ? format.oraRoma(ritirato) : null,
    banco: {
      ditta: banco.ditta,
      filiale: banco.filiale,
      nome: banco.nome,
      indirizzo: banco.indirizzo,
      telefono: banco.telefono || '',
      orari: orariDelBanco(banco.orari),
    },
    cantiere: {
      installatore: r.installatore || '',
      indirizzo: cantiere.indirizzo,
      telefono: cantiere.telefono || '',
      note: (r.note || '').trim(),
    },
    al_banco: { minuti: Number(r.corriere_minuti) || 0, km: kmBanco },
    al_cantiere: { minuti: minutiTragitto, km: kmTragitto },
    // In fase 2 l'arrivo si conta da quando ha ritirato; in fase 1 resta quello promesso all'installatore alla accettazione.
    arrivo_stimato: ritirato ? format.oraRoma(new Date(ritirato.getTime() + minutiTragitto * 60 * 1000)) : r.corriere_arrivo_il ? format.oraRoma(r.corriere_arrivo_il) : null,
    mappe: {
      al_banco: urlMappe(null, banco),
      al_cantiere: urlMappe(null, cantiere),
      percorso: urlMappe(banco, cantiere),
    },
  };
}

// La consegna in corso del corriere: { consegna } con la fase attuale, { consegna: null } se non ne ha, { consegna: null, in_preparazione: true } nell'istante
// (di solito brevissimo) fra l'accettazione e la nascita dell'ordine.
async function inCorso(corriereId) {
  let id = await ordineAttivoId(corriereId);
  if (!id) {
    const sospesa = await rispostaSenzaOrdine(corriereId);
    if (!sospesa) return { consegna: null };
    // L'ordine non è nato (guasto passeggero): si riprova adesso, come farebbe il timer.
    try {
      await richieste.assegnaOrdine(sospesa.request_id, sospesa);
    } catch (err) {
      console.error('[corrieri] ordine non creato per la richiesta ' + sospesa.request_id + ':', err.message);
    }
    id = await ordineAttivoId(corriereId);
    if (!id) return { consegna: null, in_preparazione: true };
  }
  const ordine = await ordineDelCorriere(id, corriereId);
  return { consegna: ordine ? await consegnaJson(ordine) : null };
}

// ---------- Le richieste da prendere ----------

// Le colonne che servono per mostrare una richiesta al corriere (la risposta del banco, la richiesta e l'installatore).
const SELEZIONE_RICHIESTA = `
  SELECT rr.id, rr.request_id, rr.distributor_id, rr.esito, rr.corriere_stato, rr.corriere_id,
         rr.consegna_minuti_stimati, rr.consegna_km,
         EXTRACT(EPOCH FROM (NOW() - rr.risposto_il))::int AS secondi_fa,
         rq.cliente_id, rq.destinazione, rq.note, rq.stato AS stato_richiesta, rq.scade_il > NOW() AS aperta,
         u.ragione_sociale AS installatore
    FROM request_responses rr
    JOIN requests rq ON rq.id = rr.request_id
    JOIN users u ON u.id = rq.cliente_id`;

// Una richiesta si può ancora prendere? (il banco ha confermato, nessun corriere l'ha presa, la finestra è aperta)
function richiestaPrendibile(r) {
  return r.esito === 'confermato' && r.corriere_stato === 'in_attesa' && r.stato_richiesta === 'in_attesa' && !!r.aperta;
}

// Il tragitto banco → cantiere di una richiesta ancora da prendere: quello scritto alla conferma del banco; se manca (calcolo fallito) si ricalcola adesso e lo
// si scrive, come fa richieste.assicuraTragitto. { minuti, km } (km null se non si sa).
async function tragittoBancoCantiere(r) {
  let minuti = Number(r.consegna_minuti_stimati) || 0;
  let km = r.consegna_km === null || r.consegna_km === undefined ? null : Number(r.consegna_km);
  if (minuti > 0 && km !== null) return { minuti, km };
  try {
    const stima = await consegna.minutiStimati(r.distributor_id, r.cliente_id, 0);
    if (stima.minuti > 0 && minuti <= 0) {
      minuti = stima.minuti;
      await db.prepare("UPDATE request_responses SET consegna_minuti_stimati = ? WHERE id = ? AND corriere_stato = 'in_attesa' AND COALESCE(consegna_minuti_stimati, 0) <= 0").run(minuti, r.id);
    }
    if (km === null && stima.km !== null && stima.km !== undefined) {
      km = Number(stima.km);
      await db.prepare('UPDATE request_responses SET consegna_km = ? WHERE id = ? AND consegna_km IS NULL').run(km, r.id);
    }
  } catch (err) {
    console.error('[corrieri] tragitto banco → cantiere non calcolato per la risposta ' + r.id + ':', err.message);
  }
  return { minuti, km };
}

// La scheda di una richiesta nell'elenco: chi ritira, dove si consegna, il tempo e i km totali (dalla posizione del corriere fino al cantiere passando dal banco).
async function schedaRichiesta(r, pos) {
  const [banco, cantiere, tratta] = await Promise.all([ritiroInMemoria(r.distributor_id), tappe.datiConsegna(r.cliente_id, r.destinazione), tragittoBancoCantiere(r)]);
  const alBanco = await tragittoAlBanco(pos, banco);
  return {
    id: r.id,
    fa_secondi: Math.max(0, Number(r.secondi_fa) || 0),
    ritiro: { ditta: banco.ditta, zona: banco.filiale },
    consegna: { zona: zonaDaIndirizzo(cantiere.indirizzo) },
    tempo_totale_min: alBanco ? alBanco.minuti + tratta.minuti : null,
    km_totali: alBanco && alBanco.km !== null && tratta.km !== null ? arrotonda1(alBanco.km + tratta.km) : null,
  };
}

// L'elenco della home «Richieste»: se il corriere non è disponibile, o ha già una consegna, non vede richieste (e l'app lo dice). Le più vicine per prime quando si sa
// dov'è, altrimenti le più vecchie.
async function elencoRichieste(corriereId, pos) {
  const disponibile = await leggiDisponibilita(corriereId);
  if (!disponibile) return { disponibile: false, in_corso: false, richieste: [] };
  if ((await ordineAttivoId(corriereId)) || (await rispostaSenzaOrdine(corriereId))) return { disponibile: true, in_corso: true, richieste: [] };

  const righe = await db
    .prepare(
      SELEZIONE_RICHIESTA +
        ` WHERE rr.esito = 'confermato' AND rr.corriere_stato = 'in_attesa' AND rq.stato = 'in_attesa' AND rq.scade_il > NOW()
          ORDER BY rr.risposto_il ASC, rr.id ASC LIMIT 30`
    )
    .all();
  const schede = [];
  for (const r of righe) schede.push(await schedaRichiesta(r, pos));
  if (pos) schede.sort((a, b) => (a.tempo_totale_min ?? Infinity) - (b.tempo_totale_min ?? Infinity) || b.fa_secondi - a.fa_secondi);
  return { disponibile: true, in_corso: false, posizione: !!pos, richieste: schede };
}

// La richiesta con tutti i dettagli (schermata «Dettaglio richiesta»). Se non si può più prendere dà 410 con il motivo: già presa da un altro (o da lui), scaduta.
async function dettaglioRichiesta(corriereId, rispostaId, pos) {
  const r = await db.prepare(SELEZIONE_RICHIESTA + ' WHERE rr.id = ?').get(rispostaId);
  if (!r) throw new ErroreCorriere(404, 'non_trovata', 'Richiesta non trovata.');
  if (!richiestaPrendibile(r)) {
    const tua = r.corriere_stato === 'preso' && r.corriere_id === corriereId;
    const presa = r.corriere_stato === 'preso';
    throw new ErroreCorriere(410, tua ? 'tua' : presa ? 'gia_accettata' : 'scaduta', tua ? 'Questa consegna è già tua.' : presa ? 'Un altro corriere ha già accettato questa richiesta.' : 'Questa richiesta non è più disponibile.');
  }
  const [banco, cantiere, tratta] = await Promise.all([ritiroInMemoria(r.distributor_id), tappe.datiConsegna(r.cliente_id, r.destinazione), tragittoBancoCantiere(r)]);
  const alBanco = await tragittoAlBanco(pos, banco);
  return {
    id: r.id,
    fa_secondi: Math.max(0, Number(r.secondi_fa) || 0),
    tempo_totale_min: alBanco ? alBanco.minuti + tratta.minuti : null,
    km_totali: alBanco && alBanco.km !== null && tratta.km !== null ? arrotonda1(alBanco.km + tratta.km) : null,
    alla_sede: alBanco ? { minuti: alBanco.minuti, km: alBanco.km } : null,
    al_cantiere: { minuti: tratta.minuti, km: tratta.km },
    banco: {
      ditta: banco.ditta,
      filiale: banco.filiale,
      nome: banco.nome,
      indirizzo: banco.indirizzo,
      telefono: banco.telefono || '',
      orari: orariDelBanco(banco.orari),
    },
    cantiere: {
      installatore: r.installatore || '',
      indirizzo: cantiere.indirizzo,
      zona: zonaDaIndirizzo(cantiere.indirizzo),
      note: (r.note || '').trim(),
    },
    mappe: { percorso: urlMappe(banco, cantiere) },
  };
}

// ---------- Accettare, ritirare, consegnare ----------

// «Accetta richiesta». Serve la posizione: senza il server rifiuta, anche se l'app non l'avesse chiesta. Il tempo e i km fino al banco li calcola il server (non si fidano
// i numeri dell'app): diventano i minuti con cui il corriere arriva dal banco, quelli che il banco vede come «ritira alle HH:MM».
async function accetta(corriere, rispostaId, pos) {
  if (!pos) throw new ErroreCorriere(400, 'posizione_mancante', 'Attiva la posizione per accettare le richieste.');
  if (!(await leggiDisponibilita(corriere.id))) throw new ErroreCorriere(409, 'non_disponibile', 'Accendi «Sei disponibile» per accettare le richieste.');

  const r = await db.prepare(SELEZIONE_RICHIESTA + ' WHERE rr.id = ?').get(rispostaId);
  if (!r) throw new ErroreCorriere(404, 'non_trovata', 'Richiesta non trovata.');
  const banco = await ritiroInMemoria(r.distributor_id);
  const alBanco = await tragittoAlBanco(pos, banco, { fresco: true });
  if (!alBanco) throw new ErroreCorriere(503, 'tragitto_non_calcolabile', 'Non riesco a calcolare il tragitto fino al banco. Riprova tra poco.');

  const esito = await richieste.corriereAccetta(rispostaId, corriere.id, { minuti: alBanco.minuti, km: alBanco.km, nome: nomeCorriere(corriere) });
  if (esito.esito === 'occupato') throw new ErroreCorriere(409, 'gia_in_consegna', 'Hai già una consegna in corso: portala a termine prima di accettarne un\'altra.');
  if (esito.esito === 'gia_preso') {
    // Se la risposta è già sua (doppio tocco) è un successo, non un errore.
    const mia = await db.prepare('SELECT corriere_id FROM request_responses WHERE id = ?').get(rispostaId);
    if (!mia || mia.corriere_id !== corriere.id) throw new ErroreCorriere(410, 'gia_accettata', 'Un altro corriere ha già accettato questa richiesta.');
    return { ok: true, ordine_id: (await ordineAttivoId(corriere.id)) || null };
  }
  if (esito.esito !== 'preso') throw new ErroreCorriere(410, 'scaduta', 'Questa richiesta non è più disponibile.');
  return { ok: true, ordine_id: esito.ordineId || null };
}

// «Ho ritirato il materiale»: segna il ritiro, porta l'ordine del banco a «In consegna» (come «Preparato», se non c'era già arrivato) e avvisa banco e installatore.
// Ripeterlo non fa danni e non avvisa due volte. Ritorna la consegna aggiornata (fase 2).
async function segnaRitirato(corriere, ordineId) {
  const ordine = await ordineDelCorriere(ordineId, corriere.id);
  if (!ordine) throw new ErroreCorriere(404, 'ordine_non_trovato', 'Questa consegna non c\'è più: il banco potrebbe averla annullata.');
  if (ordine.consegnato_il) throw new ErroreCorriere(409, 'gia_consegnata', 'Questa consegna è già stata completata.');

  if (!ordine.ritirato_il) {
    const upd = await db
      .prepare(
        `UPDATE orders
            SET ritirato_il = NOW(),
                in_evasione_il = CASE WHEN stato = 'inviato' THEN NOW() ELSE in_evasione_il END,
                preso_in_carico_il = CASE WHEN stato = 'inviato' THEN NOW() ELSE preso_in_carico_il END,
                stato = CASE WHEN stato = 'inviato' THEN 'in_evasione' ELSE stato END
          WHERE id = ? AND corriere_id = ? AND ritirato_il IS NULL AND consegnato_il IS NULL`
      )
      .run(ordineId, corriere.id);
    if (upd.changes) await avvisaRitiro(ordine, corriere);
  }
  const aggiornato = await ordineDelCorriere(ordineId, corriere.id);
  if (!aggiornato) throw new ErroreCorriere(404, 'ordine_non_trovato', 'Questa consegna non c\'è più: il banco potrebbe averla annullata.');
  return { consegna: await consegnaJson(aggiornato) };
}

// Gli avvisi del ritiro: al banco («Ordine #12 ritirato», compare nelle sue notifiche) e all'installatore («Materiale ritirato», anche come push). Un guasto qui
// non deve far fallire un ritiro già scritto.
async function avvisaRitiro(ordine, corriere) {
  const ora = format.oraRoma(new Date());
  try {
    if (ordine.distributor_id) {
      await notifiche.notificaDistributore(ordine.distributor_id, {
        titolo: `Ordine #${ordine.id} ritirato`,
        testo: `${nomeCorriere(corriere)} ha ritirato il materiale alle ${ora}.`,
        link: '/distributore/ordini/' + ordine.id,
        categoria: 'ordini',
        sottostato: 'spedito',
        order_id: ordine.id,
        request_id: ordine.request_id || null,
      });
    }
    await notifiche.notifica(ordine.cliente_id, {
      titolo: 'Materiale ritirato',
      testo: `Ordine #${ordine.id} — il corriere ha ritirato il materiale ed è in viaggio da te.`,
      link: '/ordini/' + ordine.id,
      categoria: 'ordini',
      order_id: ordine.id,
    });
  } catch (err) {
    console.error(`[corrieri] avvisi del ritiro dell'ordine ${ordine.id} non inviati:`, err.message);
  }
}

// Il riepilogo di una consegna completata (schermata «Consegna completata»): gli orari di ritiro e consegna, quanto ci ha messo davvero (dall'accettazione alla
// consegna) rispetto alla stima, e i km fatti (fino al banco + dal banco al cantiere).
async function riepilogo(corriereId, ordineId) {
  const ordine = await ordineDelCorriere(ordineId, corriereId);
  if (!ordine) throw new ErroreCorriere(404, 'ordine_non_trovato', 'Consegna non trovata.');
  if (!ordine.consegnato_il) throw new ErroreCorriere(409, 'non_consegnata', 'Questa consegna non è ancora stata completata.');
  const consegnata = format.istanteUtc(ordine.consegnato_il);
  const accettata = format.toDate(ordine.corriere_risposto_il);
  const ritirata = format.toDate(ordine.ritirato_il);
  const effettivo = consegnata && accettata ? Math.max(1, Math.round((consegnata.getTime() - accettata.getTime()) / 60000)) : null;
  const stimato = Math.max(Number(ordine.corriere_minuti) || 0, Number(ordine.stimati_risposta) || 0) || null;
  const km = (Number(ordine.corriere_km) || 0) + (Number(ordine.consegna_km) || 0);
  return {
    ordine_id: ordine.id,
    codice: '#' + ordine.id,
    ritirata_alle: ritirata ? format.oraRoma(ritirata) : null,
    consegnata_alle: consegnata ? format.oraRoma(consegnata) : null,
    tempo_effettivo_min: effettivo,
    tempo_stimato_min: stimato,
    distanza_km: km > 0 ? arrotonda1(km) : null,
  };
}

// «Consegna confermata»: un solo tocco, niente foto né codici. Scrive la consegna come il «consegnato» di WhatsApp (avvisa il banco) e in più manda all'installatore la
// notifica «Ordine consegnato» (chi usa l'app non ha una pagina aperta che si aggiorna da sola). Si può confermare solo dopo il ritiro. Ripeterlo non fa danni.
async function segnaConsegnato(corriere, ordineId) {
  const ordine = await ordineDelCorriere(ordineId, corriere.id);
  if (!ordine) throw new ErroreCorriere(404, 'ordine_non_trovato', 'Questa consegna non c\'è più: il banco potrebbe averla annullata.');
  if (!ordine.ritirato_il && !ordine.consegnato_il) throw new ErroreCorriere(409, 'non_ritirato', 'Conferma prima di aver ritirato il materiale.');
  if (!ordine.consegnato_il) {
    await flusso.segnaConsegnatoDalCorriere(ordine);
    try {
      await notifiche.notifica(ordine.cliente_id, {
        titolo: 'Ordine consegnato',
        testo: `Ordine #${ordine.id} — la merce è arrivata.`,
        link: '/ordini/' + ordine.id,
        categoria: 'ordini',
        sottostato: 'consegnato',
        order_id: ordine.id,
      });
    } catch (err) {
      console.error(`[corrieri] notifica di consegna dell'ordine ${ordine.id} non inviata:`, err.message);
    }
  }
  return { ok: true, riepilogo: await riepilogo(corriere.id, ordineId) };
}

module.exports = {
  ErroreCorriere,
  leggiPosizione,
  zonaDaIndirizzo,
  orariDelBanco,
  urlMappe,
  leggiDisponibilita,
  impostaDisponibilita,
  esciDalServizio,
  elencoRichieste,
  dettaglioRichiesta,
  accetta,
  inCorso,
  segnaRitirato,
  segnaConsegnato,
  riepilogo,
};
