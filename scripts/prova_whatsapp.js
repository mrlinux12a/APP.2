// Prova del gruppo WhatsApp dei corrieri con una richiesta FINTA (vedi README, "Gruppo WhatsApp dei corrieri").
//
// Si collega a WhatsApp con la sessione in whatsapp_auth/ (al primo giro mostra il QR o il codice) e
// ripete quello che succede con un ordine vero:
//   1. crea una richiesta finta (già "pagata", pagamento simulato) e fa "accettare" il banco: nel gruppo
//      arriva il messaggio con le due tappe (prelievo e consegna);
//   2. aspetta che qualcuno risponda al messaggio con "preso <minuti>" entro la finestra (--finestra);
//   3. se risponde: l'ordine nasce da solo e all'installatore arriva la conferma con quel tempo; il bot
//      risponde al "preso" e nel gruppo non scrive altro;
//   4. se nessuno risponde: la finestra scade, la richiesta si chiude senza ordine (pagamento rimborsato)
//      e il messaggio viene ELIMINATO dal gruppo.
// Alla fine stampa il risultato e cancella tutto quello che ha creato.
//
// La richiesta è intestata a un cliente di prova disattivato e al banco AFIS (id 1, disattivato): nessun
// banco o cliente vero riceve notifiche. Il messaggio nel gruppo porta la scritta PROVA.
//
// Attenzione: se il bot è il numero di chi prova, la risposta si può scrivere anche dal suo telefono;
// altrimenti serve un altro numero del gruppo. Non lanciarlo mentre la VPS è collegata con
// WHATSAPP_ATTIVO=1: due istanze leggerebbero lo stesso gruppo e risponderebbero due volte.
//
// Uso:  node scripts/prova_whatsapp.js [--gruppo="Nome del gruppo" | id@g.us] [--numero=39333...]
//                                       [--finestra=3]
//   --gruppo   il gruppo di prova (altrimenti WHATSAPP_GRUPPO dal .env; se manca, elenca i gruppi ed esce)
//   --numero   il numero del bot, con prefisso e senza +: al posto del QR stampa un codice da 8 caratteri
//   --finestra minuti di tempo per rispondere, come la finestra della richiesta (default 3)
require('dotenv').config();
const db = require('../db');

const arg = (nome) => {
  const trovato = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return trovato ? trovato.slice(nome.length + 3) : null;
};

// Il modulo si accende da solo per questa prova: nel .env locale WHATSAPP_ATTIVO non va mai messo.
process.env.WHATSAPP_ATTIVO = '1';
if (arg('gruppo')) process.env.WHATSAPP_GRUPPO = arg('gruppo');
if (arg('numero')) process.env.WHATSAPP_NUMERO = arg('numero');
const finestraMinuti = parseFloat(arg('finestra')) > 0 ? parseFloat(arg('finestra')) : 3;

const whatsapp = require('../src/whatsapp');
const richieste = require('../src/richieste');
require('../src/flusso_cliente'); // registra l'assegnatore: senza, "preso" non crea l'ordine
const sede = require('../src/sede_installatori');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const BANCO_DI_PROVA = 1; // AFIS, disattivato

let clienteId = null;
let requestId = null;
let orderId = null;

async function pulisci() {
  if (requestId) {
    await db.prepare('DELETE FROM whatsapp_messaggi WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM notifications WHERE link = ?').run('/richieste/' + requestId);
    await db.prepare('DELETE FROM request_response_items WHERE response_id IN (SELECT id FROM request_responses WHERE request_id = ?)').run(requestId);
    await db.prepare('DELETE FROM request_responses WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM request_items WHERE request_id = ?').run(requestId);
    await db.prepare('DELETE FROM requests WHERE id = ?').run(requestId);
  }
  if (orderId) {
    await db.prepare('DELETE FROM notifications WHERE order_id = ?').run(orderId);
    await db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  }
  if (clienteId) {
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(clienteId);
    await db.prepare('DELETE FROM users WHERE id = ?').run(clienteId);
  }
  clienteId = requestId = orderId = null;
}

async function fine(codice) {
  try {
    await pulisci();
    console.log('Dati di prova cancellati.');
  } catch (err) {
    console.error('Pulizia non riuscita, cancella a mano richiesta', requestId, 'ordine', orderId, 'e utente', clienteId, ':', err.message);
    codice = 1;
  }
  process.exit(codice);
}

process.on('SIGINT', () => fine(1));

async function stato() {
  const r = await richieste.aggiornaScadenza(requestId); // come una visita alla pagina: chiude le finestre scadute
  const risposta = await richieste.getRisposta(requestId, BANCO_DI_PROVA);
  return { richiesta: r, risposta };
}

(async () => {
  whatsapp.avvia();

  console.log('Mi collego a WhatsApp (se compare un QR, scansionalo entro 3 minuti)...');
  const limite = Date.now() + 3 * 60 * 1000;
  while (!whatsapp.pronto()) {
    if (Date.now() > limite) {
      console.error('Collegamento non riuscito entro 3 minuti.');
      return fine(1);
    }
    await pausa(500);
  }

  if (!(process.env.WHATSAPP_GRUPPO || '').trim()) {
    await pausa(3000); // il modulo stampa l'elenco dei gruppi appena collegato
    console.log('\nNessun gruppo indicato: rilancia con --gruppo="Nome" oppure con l\'id qui sopra.');
    return fine(0);
  }

  const idGruppo = await whatsapp.gruppoId().catch(() => null);
  if (!idGruppo) {
    console.error('Gruppo non trovato: scrivi il nome esattamente com\'è su WhatsApp, oppure usa l\'id.');
    await whatsapp.elencaGruppi().catch(() => {});
    return fine(1);
  }
  console.log('Gruppo trovato:', idGruppo);

  // Cliente di prova, nella sede fissa degli installatori.
  const utente = await db
    .prepare(
      `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, attivo, indirizzo_consegna,
                          geo_consenso, geo_lat, geo_lng)
       VALUES ('cliente', ?, 'x', 'PROVA WHATSAPP', 0, ?, 1, ?, ?)`
    )
    .run('_tmp_wa_prova_' + Date.now(), sede.indirizzoConsegna, sede.lat, sede.lng);
  clienteId = Number(utente.lastInsertRowid);

  // Richiesta con un articolo qualsiasi, aperta per la finestra scelta.
  const prodotto = await db.prepare('SELECT id FROM products WHERE attivo = 1 ORDER BY id LIMIT 1').get();
  const rich = await db
    .prepare(
      `INSERT INTO requests (cliente_id, zona, stato, scade_il, destinazione, note,
                             pagamento_stato, pagamento_metodo, pagamento_importo, pagato_il)
       VALUES (?, 'Genova', 'in_attesa', NOW() + (? * INTERVAL '1 minute'), ?, 'PROVA',
               'pagato', 'simulato', 100, NOW())`
    )
    .run(clienteId, finestraMinuti, sede.indirizzoConsegna);
  requestId = Number(rich.lastInsertRowid);
  await db.prepare('INSERT INTO request_items (request_id, product_id, quantita) VALUES (?, ?, 2)').run(requestId, prodotto.id);
  await db
    .prepare(
      `INSERT INTO distributor_products (distributor_id, product_id, prezzo_listino, sconto_base_pct)
       SELECT ?, p.id, p.prezzo_listino, p.sconto_base_pct FROM products p WHERE p.id = ?
       ON CONFLICT (distributor_id, product_id) DO NOTHING`
    )
    .run(BANCO_DI_PROVA, prodotto.id);
  await db.prepare(`INSERT INTO request_responses (request_id, distributor_id, esito) VALUES (?, ?, 'in_attesa')`).run(requestId, BANCO_DI_PROVA);

  // Il banco accetta: come dal pulsante "Accetta ordine", con il gruppo acceso.
  const accettata = await richieste.rispondi(requestId, BANCO_DI_PROVA, { prezzoRichiesto: true, partenza_ore: 2, consegna_ore: 6 });
  if (!accettata.ok || !accettata.attesaCorriere) {
    console.error('Il banco non ha accettato come previsto:', JSON.stringify(accettata));
    return fine(1);
  }
  await whatsapp.svuotaCoda();
  const msg = await db.prepare('SELECT stato, errore FROM whatsapp_messaggi WHERE request_id = ?').get(requestId);
  if (!msg || msg.stato !== 'inviato') {
    console.error('Messaggio NON inviato:', msg && msg.errore ? msg.errore : 'controlla il gruppo');
    return fine(1);
  }
  console.log(`Messaggio inviato (richiesta finta #${requestId}). Per l'installatore la richiesta è ancora "in attesa".`);
  console.log(`Rispondi nel gruppo, citando il messaggio, con: preso 30   (hai ${finestraMinuti} minuti)`);

  // Aspetta "preso" oppure la scadenza.
  for (;;) {
    const { richiesta, risposta } = await stato();
    if (risposta.corriere_stato === 'preso') {
      orderId = richiesta.order_id ? Number(richiesta.order_id) : null;
      const notifica = orderId
        ? await db.prepare(`SELECT titolo, testo FROM notifications WHERE user_id = ? AND order_id = ?`).get(clienteId, orderId)
        : null;
      console.log('\nRISPOSTA LETTA');
      console.log('  minuti totali:   ', risposta.corriere_minuti);
      console.log('  da:              ', risposta.corriere_nome || '(nome non disponibile)');
      console.log('  stato richiesta: ', richiesta.stato, '(atteso ordinata)');
      if (orderId) {
        const o = await db.prepare('SELECT corriere_minuti, corriere_arrivo_il FROM orders WHERE id = ?').get(orderId);
        console.log(`  ordine #${orderId} creato da solo: corriere ${o.corriere_minuti} min, arrivo ${new Date(o.corriere_arrivo_il).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`);
      } else {
        console.error('  ORDINE NON CREATO (il timer lo riproverebbe).');
      }
      console.log('  notifica cliente:', notifica ? notifica.titolo + ' — ' + notifica.testo : 'NON CREATA');
      await pausa(4000); // lascia partire la risposta del bot nel gruppo (e nient'altro)
      return fine(orderId ? 0 : 1);
    }
    if (risposta.corriere_stato === 'scaduto' || richiesta.stato === 'nessuna_offerta') {
      console.log('\nFINESTRA SCADUTA senza risposta.');
      console.log('  stato richiesta per l\'installatore:', richiesta.stato, '(atteso nessuna_offerta)');
      console.log('  pagamento:', richiesta.pagamento_stato, '(atteso rimborsato)');
      await whatsapp.svuotaCoda();
      await pausa(1500);
      const dopo = await db.prepare('SELECT stato, errore FROM whatsapp_messaggi WHERE request_id = ?').get(requestId);
      console.log('  messaggio nel gruppo:', dopo.stato, dopo.stato === 'eliminato' ? '(cancellato per tutti)' : dopo.errore || '');
      return fine(dopo.stato === 'eliminato' ? 0 : 1);
    }
    await pausa(2000);
  }
})().catch((err) => {
  console.error('Errore:', err.message);
  fine(1);
});
