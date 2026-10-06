const db = require('../db');
const bcrypt = require('bcryptjs');
const sede = require('./sede_installatori');
const { conCache } = require('./memo');

// Registrazione dei clienti, approvazione da parte del distributore di riferimento (uno solo, lo stesso per
// tutti: vedi distributoriPredefiniti) e sconti concordati per ambito (generale, marchio, categoria, famiglia).

const TIPI_SOGGETTO = {
  impresa: 'Impresa',
  ditta_individuale: 'Ditta individuale',
};

// Il distributore a cui si collega ogni nuovo cliente: nome della ditta (come in `distributors.nome`) o id di una
// sua filiale. Si cambia con DISTRIBUTORE_PREDEFINITO nel .env, senza toccare il codice.
const DISTRIBUTORE_PREDEFINITO = 'BOREA SRL';

// I campi della registrazione divisi nei 3 passi della pagina (views/registrati.ejs): servono a riaprirla sul primo
// passo che ha un errore.
const CAMPI_PER_PASSO = [
  ['tipo_soggetto', 'ragione_sociale', 'referente', 'email', 'telefono'],
  ['partita_iva', 'codice_fiscale', 'indirizzo', 'cap', 'citta', 'provincia', 'sdi_pec'],
  ['username', 'password', 'password2'],
];

// ---------- Validazione ----------

// Testo ripulito. Con `extended: true` un campo di form può arrivare come array o oggetto (campo[]=...):
// qui diventa sempre una stringa.
function pulisci(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

// Nessun dato anagrafico reale è più lungo di così: il limite evita righe enormi nel DB e nelle pagine
// dei distributori che le leggono.
const LUNGHEZZA_MASSIMA = 200;
const LUNGHEZZA_MASSIMA_PASSWORD = 72; // bcrypt considera solo i primi 72 byte: oltre non aggiunge sicurezza

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
// Ritorna [{ testo, campi }]: il messaggio e i campi del modulo a cui si riferisce (nomi dei `name`).
async function validaIscrizione(dati) {
  const errori = [];
  const errore = (testo, ...campi) => errori.push({ testo, campi });
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
    if (!pulisci(dati[campo])) errore(`Manca ${etichetta}.`, campo);
  });
  const troppoLunghi = obbligatori
    .map(([campo]) => campo)
    .concat(['codice_fiscale', 'referente', 'sdi_pec'])
    .filter((campo) => pulisci(dati[campo]).length > LUNGHEZZA_MASSIMA);
  if (troppoLunghi.length) errore(`Nessun campo può superare i ${LUNGHEZZA_MASSIMA} caratteri.`, ...troppoLunghi);

  // hasOwn: senza, "constructor" o "__proto__" risulterebbero forme giuridiche valide.
  if (typeof dati.tipo_soggetto !== 'string' || !Object.hasOwn(TIPI_SOGGETTO, dati.tipo_soggetto)) {
    errore('Scegli se sei un’impresa o una ditta individuale.', 'tipo_soggetto');
  }

  const piva = pulisci(dati.partita_iva).replace(/\s/g, '');
  if (piva && !/^(IT)?\d{11}$/i.test(piva)) errore('La partita IVA deve avere 11 cifre.', 'partita_iva');

  const cf = pulisci(dati.codice_fiscale).replace(/\s/g, '');
  if (cf && !/^([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]|\d{11})$/i.test(cf)) {
    errore('Il codice fiscale non sembra valido.', 'codice_fiscale');
  }

  if (pulisci(dati.cap) && !/^\d{5}$/.test(pulisci(dati.cap))) errore('Il CAP deve avere 5 cifre.', 'cap');
  if (pulisci(dati.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pulisci(dati.email))) {
    errore("L'email non sembra valida.", 'email');
  }

  // Il nome utente si scrive tutto attaccato: niente spazi, niente accenti, minuscolo.
  const utente = normalizzaUtente(dati.username);
  if (pulisci(dati.username) && /\s/.test(pulisci(dati.username))) {
    errore('Il nome utente va scritto tutto attaccato, senza spazi (es. rossimpianti).', 'username');
  }
  if (utente && !/^[a-z0-9._-]{3,30}$/.test(utente)) {
    errore('Il nome utente può avere da 3 a 30 caratteri: solo lettere, numeri, punto, trattino o trattino basso.', 'username');
  }
  if (utente) {
    const exists = await db.prepare('SELECT id FROM users WHERE username = ?').get(utente);
    if (exists) errore('Questo nome utente è già in uso.', 'username');
  }

  const pwd = typeof dati.password === 'string' ? dati.password : '';
  if (pwd.length < 8) errore('La password deve avere almeno 8 caratteri.', 'password');
  if (pwd.length > LUNGHEZZA_MASSIMA_PASSWORD) {
    errore(`La password può avere al massimo ${LUNGHEZZA_MASSIMA_PASSWORD} caratteri.`, 'password');
  }
  if (pwd !== (typeof dati.password2 === 'string' ? dati.password2 : '')) errore('Le due password non coincidono.', 'password2');

  return errori;
}

// Il passo (1, 2 o 3) della pagina di registrazione da mostrare dopo degli errori: il primo che ha un campo sbagliato.
function primoPassoConErrori(errori) {
  const campi = new Set(errori.flatMap((e) => e.campi));
  const indice = CAMPI_PER_PASSO.findIndex((passo) => passo.some((campo) => campi.has(campo)));
  return indice === -1 ? 1 : indice + 1;
}

// ---------- Iscrizione ----------

// Le filiali attive del distributore di riferimento di ogni nuovo cliente (con tutte le filiali della ditta, come
// conTutteLeFiliali). Il valore è DISTRIBUTORE_PREDEFINITO nel .env — un id o il nome della ditta — o, se manca,
// BOREA SRL. Se non c'è nessun banco attivo con quel nome o id si registra comunque il cliente, senza legami, e si
// scrive nel log: bloccare la registrazione per un errore di configurazione sarebbe peggio.
async function distributoriPredefiniti() {
  const valore = pulisci(process.env.DISTRIBUTORE_PREDEFINITO) || DISTRIBUTORE_PREDEFINITO;
  const righe = /^\d+$/.test(valore)
    ? await db.prepare('SELECT id FROM distributors WHERE attivo = 1 AND id = ?').all(Number(valore))
    : await db.prepare('SELECT id FROM distributors WHERE attivo = 1 AND LOWER(nome) = LOWER(?)').all(valore);
  if (!righe.length) {
    console.error(`[registrazione] distributore predefinito "${valore}" non trovato fra i banchi attivi: il cliente non viene collegato a nessuno`);
    return [];
  }
  return conTutteLeFiliali(righe.map((r) => Number(r.id)));
}

async function iscriviCliente(dati, distributoriScelti) {
  const utente = normalizzaUtente(dati.username);
  // L'hash (asincrono, ~60 ms di calcolo) si fa prima della transazione: non tiene occupata una
  // connessione del DB né blocca il processo mentre gira.
  const passwordHash = await bcrypt.hash(String(dati.password), 10);

  const crea = db.transaction(async () => {
    const info = await db
      .prepare(
        `INSERT INTO users
           (ruolo, username, password_hash, ragione_sociale, email, telefono, zona,
            partita_iva, codice_fiscale, indirizzo, cap, citta, provincia, sdi_pec,
            indirizzo_consegna, referente, tipo_soggetto, stato_anagrafica, iscritto_il,
            geo_consenso, geo_lat, geo_lng)
         VALUES (?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, 'in_attesa', NOW(),
                 1, ?, ?)`
      )
      .run(
        'cliente',
        utente,
        passwordHash,
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
        sede.indirizzoConsegna,
        pulisci(dati.referente),
        dati.tipo_soggetto,
        sede.lat,
        sede.lng
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

  // Ogni banco collegato riceve la richiesta di approvazione.
  for (const id of distributoriScelti) {
    await notificaDistributore(id, {
      categoria: 'approvazioni',
      sottostato: 'in_sospeso',
      titolo: 'Nuova anagrafica da approvare',
      testo: `${cliente.ragione_sociale} (P. IVA ${cliente.partita_iva}) si è appena registrato: conferma se è un tuo cliente.`,
      link: '/distributore/clienti/' + clienteId,
    });
  }

  if (distributoriScelti.length) {
    await notifica(clienteId, {
      categoria: 'approvazioni',
      sottostato: 'in_sospeso',
      titolo: 'Iscrizione inviata',
      testo: 'Il distributore deve confermare che sei suo cliente. Ti avvisiamo appena risponde.',
      link: '/profilo',
    });
  }

  return cliente;
}

// ---------- Legami cliente ↔ distributore ----------

// Le filiali attive delle ditte a cui appartengono gli id dati (più gli id stessi, se senza
// ditta): l'installatore sceglie la ditta, il legame da approvare si crea con ogni filiale.
async function conTutteLeFiliali(ids) {
  if (!ids.length) return [];
  const righe = await db
    .prepare(
      `SELECT d.id FROM distributors d
        WHERE d.attivo = 1
          AND (d.id = ANY(?::int[])
               OR (d.ditta_id IS NOT NULL
                   AND d.ditta_id IN (SELECT ditta_id FROM distributors WHERE id = ANY(?::int[]))))
        ORDER BY d.id`
    )
    .all(ids, ids);
  return righe.map((r) => Number(r.id));
}

// Per il cliente una ditta è una voce sola, anche con più filiali: vale lo stato migliore
// (approvato, poi in attesa, poi rifiutato) e la filiale non si mostra. I banchi disattivati (AFIS, Cambielli e
// Fidra) non compaiono: le righe restano, perché lo storico di richieste e ordini le referenzia.
const PRIORITA_LEGAME = { approvato: 0, in_attesa: 1, rifiutato: 2 };

async function legamiDelCliente(clienteId) {
  const righe = await db
    .prepare(
      `SELECT cd.*, d.nome AS distributore, d.filiale, d.ditta_id
         FROM client_distributors cd
         JOIN distributors d ON d.id = cd.distributor_id
        WHERE cd.cliente_id = ? AND d.attivo = 1
        ORDER BY d.nome, d.id`
    )
    .all(clienteId);
  const gruppi = new Map();
  for (const r of righe) {
    const chiave = r.ditta_id ? 'd' + r.ditta_id : 'f' + r.distributor_id;
    const attuale = gruppi.get(chiave);
    if (!attuale || (PRIORITA_LEGAME[r.stato] ?? 9) < (PRIORITA_LEGAME[attuale.stato] ?? 9)) {
      gruppi.set(chiave, { ...r, filiale: '' });
    }
  }
  return [...gruppi.values()];
}

// Il distributore che il cliente vede come "di riferimento" (pagina "La mia anagrafica" e menu del profilo): il
// primo approvato, nell'ordine di nome in cui arrivano i legami; se nessuno ha ancora approvato, il primo.
// Non ha effetto sull'invio delle richieste (quello è `distributoriCandidati`, in richieste.js).
function distributoreDiRiferimento(legami) {
  return legami.find((l) => l.stato === 'approvato') || legami[0] || null;
}

// Referente e distributore di riferimento per l'intestazione del menu del profilo, che sta su ogni pagina del
// cliente: letti una volta al minuto per cliente invece che a ogni pagina (vedi memo.js). Una modifica (per
// esempio la prima approvazione di un banco) compare entro un minuto.
const intestazioneCliente = conCache(60 * 1000, async function intestazioneCliente(clienteId) {
  const [utente, legami] = await Promise.all([
    db.prepare('SELECT referente FROM users WHERE id = ?').get(clienteId),
    legamiDelCliente(clienteId),
  ]);
  const distributore = distributoreDiRiferimento(legami);
  return {
    referente: pulisci(utente && utente.referente),
    distributore: distributore ? distributore.distributore : '',
  };
});

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
  ).run(stato, pulisci(codiceCliente).slice(0, 50), pulisci(note).slice(0, 500), attuale.id);

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
  primoPassoConErrori,
  distributoriPredefiniti,
  iscriviCliente,
  conTutteLeFiliali,
  legamiDelCliente,
  distributoreDiRiferimento,
  intestazioneCliente,
  clientiDelDistributore,
  legame,
  decidi,
  distributoriApprovati,
  regoleSconto,
  salvaRegola,
  scontoPerProdotto,
};
