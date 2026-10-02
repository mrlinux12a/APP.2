// Prova del gruppo WhatsApp dei corrieri con un ordine FINTO (vedi README, "Gruppo WhatsApp dei corrieri").
//
// Si collega a WhatsApp con la sessione in whatsapp_auth/ (al primo giro mostra il QR), manda nel
// gruppo di prova il messaggio di un ordine finto e aspetta che qualcuno risponda "preso <minuti>".
// Poi stampa cosa ha letto e cancella tutto quello che ha creato.
//
// L'ordine finto è intestato a un cliente di prova disattivato e al banco AFIS (id 1, disattivato):
// nessun banco o cliente vero riceve notifiche. Il messaggio nel gruppo porta la scritta PROVA.
//
// Attenzione: la risposta va scritta da UN ALTRO numero del gruppo. I messaggi scritti dal numero
// collegato (dal suo telefono) sono ignorati, come quelli del bot stesso.
// Non lanciarlo mentre la VPS è collegata con WHATSAPP_ATTIVO=1: due istanze leggerebbero lo
// stesso gruppo e risponderebbero due volte.
//
// Uso:  node scripts/prova_whatsapp.js [--gruppo="Nome del gruppo" | id@g.us] [--numero=39333...] [--attesa=10]
//   --gruppo  il gruppo di prova (altrimenti WHATSAPP_GRUPPO dal .env; se manca, elenca i gruppi ed esce)
//   --numero  il numero del bot, con prefisso e senza +: al posto del QR stampa un codice da 8
//             caratteri da scrivere sul telefono (Dispositivi collegati → Collega con numero di telefono)
//   --attesa  minuti da aspettare la risposta (default 10)
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
const attesaMinuti = parseFloat(arg('attesa')) > 0 ? parseFloat(arg('attesa')) : 10;

const whatsapp = require('../src/whatsapp');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const BANCO_DI_PROVA = 1; // AFIS, disattivato

let clienteId = null;
let orderId = null;

async function pulisci() {
  if (orderId) {
    await db.prepare('DELETE FROM whatsapp_messaggi WHERE order_id = ?').run(orderId);
    await db.prepare('DELETE FROM notifications WHERE order_id = ?').run(orderId);
    await db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
  }
  if (clienteId) {
    await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(clienteId);
    await db.prepare('DELETE FROM users WHERE id = ?').run(clienteId);
  }
  clienteId = orderId = null;
}

async function fine(codice) {
  try {
    await pulisci();
    console.log('Dati di prova cancellati.');
  } catch (err) {
    console.error('Pulizia non riuscita, cancella a mano ordine', orderId, 'e utente', clienteId, ':', err.message);
    codice = 1;
  }
  process.exit(codice);
}

process.on('SIGINT', () => fine(1));

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

  const utente = await db
    .prepare(
      `INSERT INTO users (ruolo, username, password_hash, ragione_sociale, attivo)
       VALUES ('cliente', ?, 'x', 'PROVA WHATSAPP', 0)`
    )
    .run('_tmp_wa_prova_' + Date.now());
  clienteId = Number(utente.lastInsertRowid);

  const ordine = await db
    .prepare(
      `INSERT INTO orders (cliente_id, modalita, totale_netto, totale_finale, distributor_id, destinazione)
       VALUES (?, 'consegna_mezzo_grossista', 0, 0, ?, 'Via di Prova 1, 16100 Genova (GE)')`
    )
    .run(clienteId, BANCO_DI_PROVA);
  orderId = Number(ordine.lastInsertRowid);

  const riga = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const banco = await db.prepare('SELECT * FROM distributors WHERE id = ?').get(BANCO_DI_PROVA);
  await db
    .prepare(`INSERT INTO whatsapp_messaggi (order_id, tipo, testo) VALUES (?, 'ordine', ?)`)
    .run(orderId, '🧪 PROVA, non è un ordine vero\n' + whatsapp.testoOrdine(riga, banco));
  await whatsapp.svuotaCoda();

  const inviato = await db.prepare('SELECT stato, errore FROM whatsapp_messaggi WHERE order_id = ?').get(orderId);
  if (!inviato || inviato.stato !== 'inviato') {
    console.error('Messaggio NON inviato:', inviato && inviato.errore ? inviato.errore : 'controlla il gruppo');
    return fine(1);
  }
  console.log(`Messaggio inviato (ordine finto #${orderId}). Rispondi nel gruppo, citando il messaggio, con: preso 30`);
  console.log(`Aspetto fino a ${attesaMinuti} minuti...`);

  const scadenza = Date.now() + attesaMinuti * 60 * 1000;
  while (Date.now() < scadenza) {
    const o = await db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (o.corriere_minuti !== null) {
      console.log('\nRISPOSTA LETTA');
      console.log('  minuti:        ', o.corriere_minuti);
      console.log('  da:            ', o.corriere_nome || '(nome non disponibile)');
      console.log('  arrivo previsto:', new Date(o.corriere_arrivo_il).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }));
      const notifica = await db.prepare('SELECT testo FROM notifications WHERE user_id = ? AND order_id = ?').get(clienteId, orderId);
      console.log('  notifica al cliente:', notifica ? notifica.testo : 'NON CREATA');
      await pausa(3000); // lascia partire la conferma nel gruppo
      return fine(0);
    }
    await pausa(2000);
  }

  console.error('\nNessuna risposta valida entro il tempo.');
  return fine(1);
})().catch((err) => {
  console.error('Errore:', err.message);
  fine(1);
});
