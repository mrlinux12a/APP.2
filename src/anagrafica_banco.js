// Pagina "Anagrafica del banco" (GET /distributore/anagrafica, richiesta esplicita del 20/10/2026): lettura, controlli e salvataggi delle sue schede.
// Il banco ha UN SOLO profilo, con tutti i permessi: niente ruoli, colleghi o inviti. Le schede:
//  · Ditta      -> tabella `ditte` (tramite distributors.ditta_id); senza ditta_id valgono ragione_sociale e partita_iva di `distributors`.
//  · Filiale    -> riga di `distributors` (+ la riga di `store_locations` della filiale, che leggono /punti-vendita, la stima della consegna e il messaggio
//                  ai corrieri: i due indirizzi non devono mai divergere). La posizione sulla mappa NON si modifica da qui: è fissa, quella del DB.
//  · Orari      -> distributors.orari (src/orari.js).
//  · Accesso    -> users.email dell'utente loggato e la sua password.
//  · Notifiche  -> solo l'email per ogni nuova richiesta sta sul DB (distributors.email_nuove_richieste); suoni e notifiche del computer sono del browser.
// I controlli sono funzioni pure che ritornano gli errori PER CAMPO ({ campo: 'testo' }): la pagina li mostra sotto il campo, in rosso.
const db = require('../db');
const orari = require('./orari');
const eventi = require('./eventi');
// Il cambio password è condiviso con l'installatore e con il recupero della password: sta in src/password_account.js.
const { controllaCambioPassword, cambiaPassword, chiudiAltreSessioni } = require('./password_account');

const testo = (v, massimo = 300) => (typeof v === 'string' ? v.trim().slice(0, massimo) : '');

const RE_PIVA = /^\d{11}$/;
const RE_SDI = /^[A-Za-z0-9]{7}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_CAP = /^\d{5}$/;
const RE_PROVINCIA = /^[A-Za-z]{2}$/;
const RE_TELEFONO = /^\+?[0-9][0-9 ()./-]{4,24}$/;

// ---------- Controlli ----------

// L'indirizzo (via, CAP, città, provincia) che hanno sia la ditta (sede legale) sia la filiale (indirizzo di ritiro). `obbligatorio`: la via.
function controllaIndirizzo(c, errori, { obbligatorio }) {
  const v = {
    indirizzo: testo(c.indirizzo, 200),
    cap: testo(c.cap, 10),
    citta: testo(c.citta, 100),
    provincia: testo(c.provincia, 5).toUpperCase(),
  };
  if (obbligatorio && !v.indirizzo) errori.indirizzo = 'Scrivi la via e il numero civico.';
  if (v.cap && !RE_CAP.test(v.cap)) errori.cap = 'Il CAP ha 5 cifre.';
  if (v.provincia && !RE_PROVINCIA.test(v.provincia)) errori.provincia = 'La provincia si scrive con 2 lettere (per esempio GE).';
  return v;
}

// Ditta: ragione sociale (obbligatoria), P. IVA di 11 cifre, codice SDI di 7 caratteri oppure PEC, sede legale. Un campo lasciato vuoto va bene (oggi
// partita IVA e SDI sono vuoti): se è scritto, deve essere giusto. `conSdi`: false se la filiale non ha una ditta (SDI/PEC e sede sono della ditta).
function controllaDitta(corpo, { conDitta = true } = {}) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const errori = {};
  const valori = { ragione_sociale: testo(c.ragione_sociale, 200), partita_iva: testo(c.partita_iva, 20).replace(/\s+/g, '') };
  if (!valori.ragione_sociale) errori.ragione_sociale = 'Scrivi la ragione sociale.';
  if (valori.partita_iva && !RE_PIVA.test(valori.partita_iva)) errori.partita_iva = 'La partita IVA ha 11 cifre.';
  if (conDitta) {
    valori.sdi_pec = testo(c.sdi_pec, 120);
    if (valori.sdi_pec && !RE_SDI.test(valori.sdi_pec) && !RE_EMAIL.test(valori.sdi_pec)) {
      errori.sdi_pec = 'Scrivi il codice SDI (7 caratteri) oppure un indirizzo PEC valido.';
    }
    if (RE_SDI.test(valori.sdi_pec)) valori.sdi_pec = valori.sdi_pec.toUpperCase();
    Object.assign(valori, controllaIndirizzo(c, errori, { obbligatorio: false }));
  }
  return { valori, errori };
}

// Filiale: nome del banco, telefono, indirizzo di ritiro (la via serve ai corrieri), email per gli avvisi, zona servita.
function controllaFiliale(corpo) {
  const c = corpo && typeof corpo === 'object' ? corpo : {};
  const errori = {};
  const valori = {
    filiale: testo(c.filiale, 100),
    telefono: testo(c.telefono, 30),
    email: testo(c.email, 200),
    zona: testo(c.zona, 100),
  };
  if (!valori.filiale) errori.filiale = 'Scrivi il nome del banco.';
  if (valori.telefono && !RE_TELEFONO.test(valori.telefono)) errori.telefono = 'Il telefono può avere solo cifre, spazi e + ( ) - /.';
  if (valori.email && !RE_EMAIL.test(valori.email)) errori.email = 'Scrivi un indirizzo email valido.';
  if (!valori.zona) errori.zona = 'Scrivi la zona servita.';
  Object.assign(valori, controllaIndirizzo(c, errori, { obbligatorio: true }));
  return { valori, errori };
}

// ---------- Lettura ----------

// Tutto quello che serve alla pagina, in due giri di rete: la filiale e l'utente insieme, poi la ditta.
async function leggi(distributorId, utenteId) {
  const [filiale, utente] = await Promise.all([
    db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId),
    db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(utenteId),
  ]);
  if (!filiale) return null;
  const dittaRiga = filiale.ditta_id ? await db.prepare('SELECT * FROM ditte WHERE id = ?').get(filiale.ditta_id) : null;
  const conDitta = !!dittaRiga;
  // Senza ditta valgono i dati della filiale: ragione sociale e partita IVA (l'indirizzo della filiale è quello di ritiro, non la sede legale).
  const ditta = conDitta
    ? dittaRiga
    : { ragione_sociale: filiale.ragione_sociale || filiale.nome, partita_iva: filiale.partita_iva || '', sdi_pec: '', indirizzo: '', cap: '', citta: '', provincia: '' };
  return {
    filiale,
    ditta,
    conDitta,
    utente: utente || { email: '', username: '' },
    orari: orari.leggiOrari(filiale.orari),
    posizioneImpostata: Number.isFinite(Number(filiale.geo_lat)) && Number.isFinite(Number(filiale.geo_lng)) && filiale.geo_lat !== null && filiale.geo_lng !== null,
    emailNuoveRichieste: Number(filiale.email_nuove_richieste) === 1,
  };
}

// "Via X 1, 16131 Genova (GE)": come si scrive un indirizzo nelle schede in lettura. Vuoto se non c'è niente.
function indirizzoInRiga({ indirizzo, cap, citta, provincia }) {
  const luogo = [cap, citta].filter(Boolean).join(' ') + (provincia ? ' (' + provincia + ')' : '');
  return [indirizzo, luogo.trim()].filter(Boolean).join(', ');
}

// ---------- Salvataggi ----------

async function salvaDitta(distributorId, valori) {
  const filiale = await db.prepare('SELECT ditta_id FROM distributors WHERE id = ?').get(distributorId);
  if (!filiale) return false;
  if (filiale.ditta_id) {
    await db
      .prepare(
        `UPDATE ditte SET ragione_sociale = ?, partita_iva = ?, sdi_pec = ?, indirizzo = ?, cap = ?, citta = ?, provincia = ? WHERE id = ?`
      )
      .run(valori.ragione_sociale, valori.partita_iva, valori.sdi_pec, valori.indirizzo, valori.cap, valori.citta, valori.provincia, filiale.ditta_id);
  } else {
    await db
      .prepare('UPDATE distributors SET ragione_sociale = ?, partita_iva = ? WHERE id = ?')
      .run(valori.ragione_sociale, valori.partita_iva, distributorId);
  }
  return true;
}

// Salva la filiale. LA POSIZIONE SULLA MAPPA È FISSA (richiesta esplicita del 21/10/2026: quella di Borea è la solita, scritta nel DB): cambiare l'indirizzo
// di ritiro NON la ricalcola e nessuna pagina la sposta; `distributors.geo_*` e `store_locations.geo_*` non si toccano da qui. Ritorna:
//   { ok: true }
//   { ok: false, errori: { filiale: '...' } }   (un'altra filiale della ditta ha già questo nome)
async function salvaFiliale(distributorId, valori) {
  const attuale = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  if (!attuale) return { ok: false, errori: { filiale: 'Banco non trovato.' } };

  try {
    await db.transaction(async () => {
      await db
        .prepare(
          `UPDATE distributors SET filiale = ?, telefono = ?, email = ?, zona = ?, indirizzo = ?, cap = ?, citta = ?, provincia = ? WHERE id = ?`
        )
        .run(valori.filiale, valori.telefono, valori.email, valori.zona, valori.indirizzo, valori.cap, valori.citta, valori.provincia, distributorId);
      // La riga del punto vendita (una per filiale) segue: stesso indirizzo, telefono e email; il nome solo se era quello della filiale.
      await db
        .prepare(
          `UPDATE store_locations
              SET nome = CASE WHEN nome = ? THEN ? ELSE nome END, indirizzo = ?, cap = ?, citta = ?, provincia = ?, telefono = ?, email = ?
            WHERE id = (SELECT id FROM store_locations WHERE distributor_id = ? ORDER BY id LIMIT 1)`
        )
        .run(attuale.filiale, valori.filiale, valori.indirizzo, valori.cap, valori.citta, valori.provincia, valori.telefono, valori.email, distributorId);
    })();
  } catch (e) {
    // 23505 = indice unico (nome della ditta + nome della filiale): un'altra filiale ha già questo nome.
    if (e && e.code === '23505') return { ok: false, errori: { filiale: 'Un’altra filiale della tua ditta ha già questo nome.' } };
    throw e;
  }
  return { ok: true };
}

async function salvaOrari(distributorId, valore) {
  await db.prepare('UPDATE distributors SET orari = ?::jsonb WHERE id = ?').run(valore ? JSON.stringify(valore) : null, distributorId);
  // Richiesta esplicita del 22/10/2026: gli installatori collegati se ne accorgono subito. Evento 'orari' a ogni installatore con una pagina aperta: il carrello e la pagina
  // "Orari di BOREA" si rileggono da sole (public/app.js). Non deve mai far fallire il salvataggio.
  try { eventi.emettiARuolo('cliente', 'orari', {}); } catch (e) { /* pagine non avvisate: restano il controllo al ritorno in primo piano e il timer */ }
}

async function salvaEmailNuoveRichieste(distributorId, acceso) {
  await db.prepare('UPDATE distributors SET email_nuove_richieste = ? WHERE id = ?').run(acceso ? 1 : 0, distributorId);
}

module.exports = {
  controllaDitta, controllaFiliale, controllaCambioPassword,
  leggi, indirizzoInRiga,
  salvaDitta, salvaFiliale, salvaOrari, salvaEmailNuoveRichieste, cambiaPassword, chiudiAltreSessioni,
};
