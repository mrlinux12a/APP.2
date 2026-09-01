const db = require('../db');
const bcrypt = require('bcryptjs');

// Registrazione dei clienti, approvazione da parte dei distributori indicati come
// referenti e sconti concordati per ambito (generale, marchio, categoria, famiglia).

const TIPI_SOGGETTO = {
  impresa: 'Impresa',
  ditta_individuale: 'Ditta individuale',
};

// ---------- Validazione ----------

function pulisci(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

// Nome utente sempre in un pezzo solo: minuscolo, senza spazi né accenti.
function normalizzaUtente(v) {
  return pulisci(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

// Controlli volutamente leggeri: bloccano gli errori di battitura, non fanno le veci
// di una verifica fiscale vera (quella la fa il distributore approvando l'anagrafica).
async function validaIscrizione(dati, distributoriScelti) {
  const errori = [];
  const obbligatori = [
    ['ragione_sociale', 'la ragione sociale'],
    ['partita_iva', 'la partita IVA'],
    ['indirizzo', "l'indirizzo della sede"],
    ['cap', 'il CAP'],
    ['citta', 'la città'],
    ['provincia', 'la provincia'],
    ['email', "l'email"],
    ['telefono', 'il telefono'],
    ['username', 'il nome utente'],
  ];
  obbligatori.forEach(([campo, etichetta]) => {
    if (!pulisci(dati[campo])) errori.push(`Manca ${etichetta}.`);
  });

  if (!TIPI_SOGGETTO[dati.tipo_soggetto]) errori.push('Scegli se sei un’impresa o una ditta individuale.');

  const piva = pulisci(dati.partita_iva).replace(/\s/g, '');
  if (piva && !/^(IT)?\d{11}$/i.test(piva)) errori.push('La partita IVA deve avere 11 cifre.');

  const cf = pulisci(dati.codice_fiscale).replace(/\s/g, '');
  if (cf && !/^([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/i.test(cf)) {
    errori.push('Il codice fiscale non sembra valido.');
  }

  if (pulisci(dati.cap) && !/^\d{5}$/.test(pulisci(dati.cap))) errori.push('Il CAP deve avere 5 cifre.');
  if (pulisci(dati.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pulisci(dati.email))) {
    errori.push("L'email non sembra valida.");
  }

  // Il nome utente si scrive tutto attaccato: niente spazi, niente accenti, minuscolo.
  const utente = normalizzaUtente(dati.username);
  if (pulisci(dati.username) && /\s/.test(pulisci(dati.username))) {
    errori.push('Il nome utente va scritto tutto attaccato, senza spazi (es. rossimpianti).');
  }
  if (utente && !/^[a-z0-9._-]{3,30}$/.test(utente)) {
    errori.push(
      'Il nome utente può avere da 3 a 30 caratteri: solo lettere, numeri, punto, trattino o trattino basso.'
    );
  }
  if (utente) {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(utente);
    if (exists) errori.push('Questo nome utente è già in uso.');
  }

  const pwd = String(dati.password || '');
  if (pwd.length < 8) errori.push('La password deve avere almeno 8 caratteri.');
  if (pwd !== String(dati.password2 || '')) errori.push('Le due password non coincidono.');

  if (!distributoriScelti.length) errori.push('Scegli almeno un distributore di riferimento.');

  return errori;
}

// ---------- Iscrizione ----------

async function iscriviCliente(dati, distributoriScelti) {
  const utente = normalizzaUtente(dati.username);

  const crea = db.transaction(async () => {
    const info = await db
      .prepare(
        `INSERT INTO users
           (ruolo, username, password_hash, ragione_sociale, email, telefono, zona,
            partita_iva, codice_fiscale, indirizzo, cap, citta, provincia, sdi_pec,
            indirizzo_consegna, referente, tipo_soggetto, stato_anagrafica, iscritto_il)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, 'in_attesa', NOW())`
      )
      .run(
        'cliente',
        utente,
        bcrypt.hashSync(String(dati.password), 10),
        pulisci(dati.ragione_sociale),
        pulisci(dati.email),
        pulisci(dati.telefono),
        pulisci(dati.citta) || 'Genova',
        pulisci(dati.partita_iva).replace(/\s/g, '').toUpperCase(),
        pulisci(dati.codice_fiscale).replace(/\s/g, '').toUpperCase(),
        pulisci(dati.indirizzo),
        pulisci(dati.cap),
        pulisci(dati.citta),
        pulisci(dati.provincia).toUpperCase().slice(0, 2),
        pulisci(dati.sdi_pec),
        pulisci(dati.indirizzo_consegna),
        pulisci(dati.referente),
        dati.tipo_soggetto
      );

    const clienteId = Number(info.lastInsertRowid);
    const insLegame = db.prepare(
      `INSERT INTO client_distributors (cliente_id, distributor_id, stato) VALUES (?, ?, 'in_attesa')`
    );
    for (const id of distributoriScelti) await insLegame.run(clienteId, id);
    return clienteId;
  });

  const clienteId = await crea();
  const cliente = await db.prepare('SELECT * FROM users WHERE id = ?').get(clienteId);
  const { notifica, notificaDistributore } = require('./notifiche');

  // Ogni distributore indicato riceve la richiesta di approvazione.
  for (const id of distributoriScelti) {
    await notificaDistributore(id, {
      categoria: 'approvazioni',
      sottostato: 'in_sospeso',
      titolo: 'Nuova anagrafica da approvare',
      testo: `${cliente.ragione_sociale} (P. IVA ${cliente.partita_iva}) ti ha indicato come distributore di riferimento.`,
      link: '/distributore/clienti/' + clienteId,
    });
  }

  await notifica(clienteId, {
    categoria: 'approvazioni',
    sottostato: 'in_sospeso',
    titolo: 'Iscrizione inviata',
    testo: 'I distributori che hai scelto devono confermare che sei loro cliente. Ti avvisiamo appena rispondono.',
    link: '/profilo',
  });

  return cliente;
}

// ---------- Legami cliente ↔ distributore ----------

async function legamiDelCliente(clienteId) {
  return db
    .prepare(
      `SELECT cd.*, d.nome AS distributore, d.filiale
         FROM client_distributors cd
         JOIN distributors d ON d.id = cd.distributor_id
        WHERE cd.cliente_id = ?
        ORDER BY d.nome`
    )
    .all(clienteId);
}

async function clientiDelDistributore(distributorId) {
  return db
    .prepare(
      `SELECT cd.*, u.id AS cliente_id, u.ragione_sociale, u.partita_iva, u.citta, u.provincia,
              u.tipo_soggetto, u.referente, u.iscritto_il
         FROM client_distributors cd
         JOIN users u ON u.id = cd.cliente_id
        WHERE cd.distributor_id = ?
        ORDER BY CASE cd.stato WHEN 'in_attesa' THEN 0 WHEN 'approvato' THEN 1 ELSE 2 END,
                 u.ragione_sociale`
    )
    .all(distributorId);
}

async function legame(distributorId, clienteId) {
  return db
    .prepare('SELECT * FROM client_distributors WHERE distributor_id = ? AND cliente_id = ?')
    .get(distributorId, clienteId);
}

// Il distributore conferma (o nega) che l'anagrafica sia davvero un suo cliente.
async function decidi(distributorId, clienteId, { approva, codiceCliente = '', note = '' }) {
  const attuale = await legame(distributorId, clienteId);
  if (!attuale) return { ok: false, errore: 'Questo cliente non ti ha indicato come referente.' };

  const stato = approva ? 'approvato' : 'rifiutato';
  await db.prepare(
    `UPDATE client_distributors
        SET stato = ?, codice_cliente = ?, note = ?, deciso_il = NOW()
      WHERE id = ?`
  ).run(stato, pulisci(codiceCliente), pulisci(note), attuale.id);

  // Basta un'approvazione per rendere operativa l'anagrafica.
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM client_distributors WHERE cliente_id = ? AND stato = 'approvato'`
    )
    .get(clienteId);
  const approvazioni = row ? Number(row.n) : 0;
  await db.prepare('UPDATE users SET stato_anagrafica = ? WHERE id = ?').run(
    approvazioni > 0 ? 'attivo' : 'in_attesa',
    clienteId
  );

  const distributore = await db.prepare('SELECT nome FROM distributors WHERE id = ?').get(distributorId);
  const { notifica } = require('./notifiche');
  await notifica(clienteId, {
    categoria: 'approvazioni',
    sottostato: approva ? 'confermata' : 'negata',
    titolo: approva ? 'Anagrafica approvata' : 'Anagrafica non riconosciuta',
    testo: approva
      ? `${distributore.nome} ti ha riconosciuto come cliente: puoi inviargli richieste.`
      : `${distributore.nome} non ti ha riconosciuto come cliente. Contattali per sistemare la posizione.`,
    link: '/profilo',
  });

  return { ok: true, stato };
}

// Distributori che hanno approvato il cliente: sono gli unici a cui può ordinare.
async function distributoriApprovati(clienteId) {
  const rows = await db
    .prepare(
      `SELECT d.* FROM client_distributors cd
         JOIN distributors d ON d.id = cd.distributor_id
        WHERE cd.cliente_id = ? AND cd.stato = 'approvato' AND d.attivo = 1`
    )
    .all(clienteId);
  return rows.map((d) => d.id);
}

// ---------- Sconti per ambito ----------

async function regoleSconto(distributorId, clienteId) {
  return db
    .prepare(
      `SELECT * FROM client_discount_rules
        WHERE distributor_id = ? AND cliente_id = ?
        ORDER BY ambito, chiave`
    )
    .all(distributorId, clienteId);
}

// Sconto a scalare: 40+10+5 non fa 55, fa 48,7 — ogni sconto si applica sul residuo.
function scontoEffettivo(scaglioni) {
  const validi = (scaglioni || [])
    .map((s) => parseFloat(String(s === undefined || s === null ? '' : s).replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.min(90, n));
  if (!validi.length) return null;
  const residuo = validi.reduce((acc, s) => acc * (1 - s / 100), 1);
  return Math.round((1 - residuo) * 1000) / 10;
}

// Riscrive gli scaglioni come li scrive il banco: "40+10+5".
function formattaScalare(regola) {
  if (!regola) return '';
  const parti = [regola.sconto1, regola.sconto2, regola.sconto3, regola.sconto4, regola.sconto5]
    .filter((s) => s !== null && s !== undefined && s > 0)
    .map((s) => String(s).replace('.', ','));
  return parti.length ? parti.join('+') : String(regola.sconto_pct).replace('.', ',');
}

async function salvaRegola(distributorId, clienteId, ambito, chiave, scaglioni) {
  const chiavePulita = pulisci(chiave);
  const effettivo = scontoEffettivo(scaglioni);

  // Tutti i campi vuoti: la regola sparisce e torna a valere quella più generale.
  if (effettivo === null) {
    await db.prepare(
      `DELETE FROM client_discount_rules
        WHERE distributor_id = ? AND cliente_id = ? AND ambito = ? AND chiave = ?`
    ).run(distributorId, clienteId, ambito, chiavePulita);
    return null;
  }

  const s = [0, 1, 2, 3, 4].map((i) => {
    const n = parseFloat(String(scaglioni[i] === undefined ? '' : scaglioni[i]).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(Math.min(90, n) * 10) / 10 : null;
  });

  await db.prepare(
    `INSERT INTO client_discount_rules
       (distributor_id, cliente_id, ambito, chiave, sconto_pct, sconto1, sconto2, sconto3, sconto4, sconto5)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(distributor_id, cliente_id, ambito, chiave) DO UPDATE SET
       sconto_pct = excluded.sconto_pct, sconto1 = excluded.sconto1, sconto2 = excluded.sconto2,
       sconto3 = excluded.sconto3, sconto4 = excluded.sconto4, sconto5 = excluded.sconto5,
       aggiornato_il = NOW()`
  ).run(distributorId, clienteId, ambito, chiavePulita, effettivo, s[0], s[1], s[2], s[3], s[4]);
  return effettivo;
}

// Sconto valido per un prodotto: vince la regola più specifica che lo riguarda.
// famiglia del marchio → marchio → categoria merceologica. Non esiste uno sconto unico
// di anagrafica: ogni marchio ha condizioni sue.
function scontoPerProdotto(regole, prodotto) {
  if (!regole || !regole.length) return null;
  const cerca = (ambito, chiave) => regole.find((x) => x.ambito === ambito && x.chiave === chiave);

  const perFamiglia =
    prodotto.brand_slug && prodotto.famiglia
      ? cerca('famiglia', prodotto.brand_slug + ':' + prodotto.famiglia)
      : null;
  if (perFamiglia) {
    return { pct: perFamiglia.sconto_pct, ambito: 'famiglia', scalare: formattaScalare(perFamiglia) };
  }

  const perMarchio = prodotto.brand_slug ? cerca('marchio', prodotto.brand_slug) : null;
  if (perMarchio) {
    return { pct: perMarchio.sconto_pct, ambito: 'marchio', scalare: formattaScalare(perMarchio) };
  }

  const perMacro = prodotto.macro_slug ? cerca('macro', prodotto.macro_slug) : null;
  if (perMacro) {
    return { pct: perMacro.sconto_pct, ambito: 'macro', scalare: formattaScalare(perMacro) };
  }

  return null;
}

module.exports = {
  TIPI_SOGGETTO,
  scontoEffettivo,
  formattaScalare,
  validaIscrizione,
  iscriviCliente,
  legamiDelCliente,
  clientiDelDistributore,
  legame,
  decidi,
  distributoriApprovati,
  regoleSconto,
  salvaRegola,
  scontoPerProdotto,
};
