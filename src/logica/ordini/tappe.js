// Le due tappe di una consegna: dove si ritira (il banco) e dove si porta (il cantiere dell'installatore), con indirizzo, posizione e telefono.
//
// Le usano il messaggio ai corrieri su WhatsApp (src/logica/whatsapp/whatsapp.js) e le schermate dell'app dei corrieri (src/logica/corrieri/consegne.js): un solo
// posto, così i due modi dicono sempre lo stesso indirizzo.
const db = require('../../../db');
const format = require('../../comune/format');

// Il cellulare dell'installatore come lo scrive nel profilo, su una riga sola e di lunghezza ragionevole (il messaggio finisce in un gruppo: niente a capo
// né testi lunghi infilati in quel campo). Vuoto se non c'è.
function pulisciTelefono(telefono) {
  return String(telefono || '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

// Dove si ritira: la filiale che ha accettato. Vale il punto vendita (store_locations), che è
// l'indirizzo vero; la riga del distributore resta come ripiego. Oltre a nome, indirizzo e posizione porta il telefono della filiale e i suoi orari (JSON,
// come stanno in distributors.orari): su WhatsApp non servono, l'app dei corrieri li mostra.
async function datiRitiro(distributorId) {
  const d = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(distributorId);
  const s = await db
    .prepare(
      `SELECT indirizzo, cap, citta, provincia, geo_lat, geo_lng FROM store_locations
        WHERE distributor_id = ? AND attivo = 1 AND geo_lat IS NOT NULL ORDER BY id LIMIT 1`
    )
    .get(distributorId);
  return {
    nome: [d.nome, d.filiale].filter(Boolean).join(' — '),
    // La ditta senza forma giuridica ("BOREA") e la filiale ("Fegino"), per le etichette corte dell'app dei corrieri.
    ditta: format.nomeCommerciale(d.nome),
    filiale: d.filiale || '',
    // "Via Antonio Cantore, 266r, 16149 Genova GE": il CAP e la provincia ci sono, il corriere deve trovare il posto giusto.
    indirizzo: s
      ? [s.indirizzo, [s.cap, s.citta, s.provincia].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : [d.indirizzo, d.zona].filter(Boolean).join(', '),
    lat: s ? s.geo_lat : d.geo_lat,
    lng: s ? s.geo_lng : d.geo_lng,
    telefono: pulisciTelefono(d.telefono),
    orari: d.orari || null,
  };
}

// Dove si consegna: l'indirizzo scritto nel carrello (`destinazione` della richiesta) e la posizione che l'installatore ha mandato con quello stesso invio
// (users.geo_*). Per le richieste senza destinazione (app, vecchio flusso) l'indirizzo di consegna abituale. Porta anche il cellulare dell'installatore
// (users.telefono, vuoto se non c'è), che il corriere trova nel messaggio per chiamarlo all'arrivo.
async function datiConsegna(clienteId, destinazione) {
  const c = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  return {
    indirizzo: String(destinazione || '').trim() || (c.indirizzo_consegna || '').trim() || format.indirizzoCompleto(c),
    lat: c.geo_lat,
    lng: c.geo_lng,
    telefono: pulisciTelefono(c.telefono),
  };
}

module.exports = { pulisciTelefono, datiRitiro, datiConsegna };
