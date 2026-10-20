// Invio email (nodemailer, SMTP dal .env) e l'email "Pagamento ricevuto".
//
// Senza SMTP_HOST nel .env non parte niente (si scrive una riga nel log, una volta): il progetto non aveva un sistema di invio email e finché
// non è configurato resta solo la ricevuta via email di Stripe (receipt_email sul PaymentIntent, vedi src/stripe_pagamenti.js).
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("1" per TLS diretto, di norma con la 465), SMTP_USER, SMTP_PASS
//   EMAIL_DA   mittente, "Nome <indirizzo@dominio>" (default: il nome dell'azienda e SMTP_USER)
// L'invio NON deve mai bloccare né far fallire un incasso: ogni errore finisce nel log e basta (inviaPagamentoRicevuto non lancia mai), e i tempi
// d'attesa sono brevi (un SMTP che non risponde non deve fermare il giro dei pagamenti di Stripe).
const pricing = require('./pricing');
const format = require('./format');
const { azienda } = require('./azienda');

let trasporto = null;
let avvisatoNonConfigurato = false;

const configurato = () => String(process.env.SMTP_HOST || '').trim() !== '';

function creaTrasporto() {
  const nodemailer = require('nodemailer');
  const porta = Number(process.env.SMTP_PORT) || 587;
  const utente = String(process.env.SMTP_USER || '').trim();
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST).trim(),
    port: porta,
    secure: /^(1|true|si|sì|yes)$/i.test(String(process.env.SMTP_SECURE || '').trim()) || porta === 465,
    auth: utente ? { user: utente, pass: String(process.env.SMTP_PASS || '') } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

// Per le prove: un trasporto finto al posto di quello vero ({ sendMail(opzioni) }).
function impostaTrasporto(t) {
  trasporto = t;
}

function mittente() {
  const da = String(process.env.EMAIL_DA || '').trim();
  if (da) return da;
  const utente = String(process.env.SMTP_USER || '').trim();
  return utente ? `"${azienda().nome.replace(/"/g, '')}" <${utente}>` : undefined;
}

// Manda una mail. Ritorna { inviata: true } oppure { inviata: false, motivo }. Lancia solo per un errore del trasporto: chi la chiama per un
// incasso passa da inviaPagamentoRicevuto, che lo ingoia.
async function invia({ a, oggetto, html, testo }) {
  if (!trasporto) {
    if (!configurato()) {
      if (!avvisatoNonConfigurato) {
        avvisatoNonConfigurato = true;
        console.log('[email] SMTP_HOST non impostato: nessuna email viene inviata (resta la ricevuta di Stripe).');
      }
      return { inviata: false, motivo: 'SMTP non configurato' };
    }
    trasporto = creaTrasporto();
  }
  await trasporto.sendMail({ from: mittente(), to: a, subject: oggetto, html, text: testo });
  return { inviata: true };
}

// ---------- "Pagamento ricevuto" ----------

const esc = (t) =>
  String(t === null || t === undefined ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const euro = (n) => pricing.euro(n);

const oggettoPagamentoRicevuto = (d) => `Pagamento ricevuto · Ordine #${d.ordineId} · € ${euro(d.importi.app.totale)}`;

const frasePagamento = (d) =>
  `${d.ditta || 'Il banco'} ha confermato il tuo ordine #${d.ordineId}. Abbiamo addebitato la consegna in cantiere sulla tua ${d.carta ? d.carta.testo : 'carta'}.`;

function quandoTesto(d) {
  return `${format.dataSolaRoma(d.data)}, ${format.oraSolaRoma(d.data)}`;
}

// L'HTML della mail: larga 520px, tabelle e stili in linea (i client di posta non leggono altro). Tutto quello che arriva da fuori è escapato.
function htmlPagamentoRicevuto(d) {
  const az = d.azienda || azienda();
  const app = d.importi.app;
  const base = az.urlApp;
  const bottone = (testo, href, pieno) =>
    href
      ? `<td style="padding:0 6px 0 0"><a href="${esc(href)}" style="display:inline-block;padding:14px 22px;border-radius:26px;font-size:15px;font-weight:700;text-decoration:none;` +
        (pieno ? 'background:#245A8F;color:#ffffff;border:2px solid #245A8F' : 'background:#ffffff;color:#245A8F;border:2px solid #245A8F') +
        `">${esc(testo)}</a></td>`
      : '';
  const riga = (etichetta, importo) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#1F5F2E">${esc(etichetta)}</td><td align="right" style="padding:6px 0;font-size:14px;color:#1F5F2E">€ ${euro(importo)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(oggettoPagamentoRicevuto(d))}</title></head>
<body style="margin:0;padding:0;background:#EBE9E3;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1C1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBE9E3"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden">
    <tr><td style="background:#245A8F;padding:18px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:30px;height:30px;background:#ffffff;border-radius:8px;text-align:center;font-size:16px;font-weight:800;color:#245A8F;line-height:30px">${esc((az.nome || 'M').charAt(0).toUpperCase())}</td>
        <td style="padding-left:12px;font-size:18px;font-weight:800;color:#ffffff">${esc(az.nome)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:28px 24px 8px">
      <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;font-weight:800;color:#1C1917">Pagamento ricevuto</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#3F3E38">${esc(frasePagamento(d))}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E3F3E6;border-radius:14px"><tr><td style="padding:16px 18px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding-bottom:6px;font-size:15px;font-weight:700;color:#1F5F2E">Consegna in cantiere</td><td align="right" style="padding-bottom:6px;font-size:26px;font-weight:800;color:#1F5F2E">€ ${euro(app.totale)}</td></tr>
          ${riga('Corriere · costo fisso', app.corriere)}
          ${riga(`Servizio · ${d.importi.servizioPct}% della merce`, app.servizio)}
          ${riga(`IVA ${d.importi.ivaPct}%`, app.iva)}
        </table>
      </td></tr></table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;background:#F7F6F2;border:1px solid #E2DED3;border-radius:14px"><tr><td style="padding:14px 18px;font-size:14px;line-height:1.5;color:#3F3E38">
        <strong style="color:#1C1917">Materiale € ${euro(d.importi.banco.totale)}</strong> IVA inclusa: non è in questo pagamento, lo paghi a ${esc(d.ditta || 'il banco')} con la sua fattura.
      </td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>
        ${bottone('Scarica la ricevuta', base ? `${base}/ordini/${d.ordineId}/ricevuta.pdf` : '', true)}
        ${bottone("Segui l'ordine", base ? `${base}/ordini/${d.ordineId}` : '', false)}
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 24px 26px"><div style="border-top:1px solid #ECE9E2;padding-top:14px;font-size:12px;line-height:1.6;color:#6B6A5F">
      Ricevuta N. ${esc(d.numero)} · ${esc(quandoTesto(d))}<br>
      Trovi tutte le ricevute in Storico ordini → Ricevute del mese.
    </div></td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// La stessa mail in solo testo (per i client che non mostrano l'HTML).
function testoPagamentoRicevuto(d) {
  const app = d.importi.app;
  const base = d.azienda ? d.azienda.urlApp : azienda().urlApp;
  return [
    'Pagamento ricevuto',
    '',
    frasePagamento(d),
    '',
    `Consegna in cantiere: € ${euro(app.totale)}`,
    `  Corriere · costo fisso: € ${euro(app.corriere)}`,
    `  Servizio · ${d.importi.servizioPct}% della merce: € ${euro(app.servizio)}`,
    `  IVA ${d.importi.ivaPct}%: € ${euro(app.iva)}`,
    '',
    `Materiale € ${euro(d.importi.banco.totale)} IVA inclusa: non è in questo pagamento, lo paghi a ${d.ditta || 'il banco'} con la sua fattura.`,
    '',
    base ? `Scarica la ricevuta: ${base}/ordini/${d.ordineId}/ricevuta.pdf` : '',
    base ? `Segui l'ordine: ${base}/ordini/${d.ordineId}` : '',
    '',
    `Ricevuta N. ${d.numero} · ${quandoTesto(d)}`,
    'Trovi tutte le ricevute in Storico ordini → Ricevute del mese.',
  ].filter((r, i, tutte) => r !== '' || tutte[i - 1] !== '').join('\n');
}

// Dopo un incasso riuscito: manda la mail al cliente. NON lancia MAI: se fallisce si scrive nel log e basta (la capture è già fatta).
async function inviaPagamentoRicevuto(dati) {
  try {
    const a = String((dati.cliente && dati.cliente.email) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) return { inviata: false, motivo: 'il cliente non ha un indirizzo email valido' };
    return await invia({ a, oggetto: oggettoPagamentoRicevuto(dati), html: htmlPagamentoRicevuto(dati), testo: testoPagamentoRicevuto(dati) });
  } catch (e) {
    console.error(`[email] "Pagamento ricevuto" per l'ordine ${dati && dati.ordineId} non inviata:`, e.message);
    return { inviata: false, motivo: e.message };
  }
}

// ---------- "Reimposta la password" ----------

const oggettoRecuperoPassword = () => `Reimposta la password · ${azienda().nome}`;

// Il testo è lo stesso nelle due versioni. `username` è nella mail perché chi dimentica la password spesso dimentica anche il nome utente.
const fraseRecupero = (d) => [
  `Abbiamo ricevuto una richiesta per reimpostare la password del tuo account${d.nome ? ' (' + d.nome + ')' : ''}.`,
  `Nome utente: ${d.username}`,
  `Il link vale ${d.validitaMin} minuti e si può usare una volta sola.`,
  'Se non l’hai chiesto tu, ignora questa email: la tua password non cambia.',
];

function htmlRecuperoPassword(d) {
  const az = d.azienda || azienda();
  const frasi = fraseRecupero(d);
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(oggettoRecuperoPassword())}</title></head>
<body style="margin:0;padding:0;background:#EBE9E3;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1C1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EBE9E3"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden">
    <tr><td style="background:#245A8F;padding:18px 24px;font-size:18px;font-weight:800;color:#ffffff">${esc(az.nome)}</td></tr>
    <tr><td style="padding:28px 24px 8px">
      <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;font-weight:800;color:#1C1917">Reimposta la password</h1>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#3F3E38">${esc(frasi[0])}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F2;border:1px solid #E2DED3;border-radius:14px"><tr><td style="padding:12px 16px;font-size:14px;line-height:1.5;color:#3F3E38">
        ${esc(frasi[1])}
      </td></tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr>
        <td><a href="${esc(d.link)}" style="display:inline-block;padding:14px 26px;border-radius:26px;font-size:16px;font-weight:700;text-decoration:none;background:#245A8F;color:#ffffff">Scegli una nuova password</a></td>
      </tr></table>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#3F3E38">${esc(frasi[2])}</p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#6B6A5F;word-break:break-all">Se il pulsante non funziona, copia questo indirizzo nel browser:<br>${esc(d.link)}</p>
    </td></tr>
    <tr><td style="padding:18px 24px 26px"><div style="border-top:1px solid #ECE9E2;padding-top:14px;font-size:12px;line-height:1.6;color:#6B6A5F">${esc(frasi[3])}</div></td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function testoRecuperoPassword(d) {
  const frasi = fraseRecupero(d);
  return ['Reimposta la password', '', frasi[0], frasi[1], '', 'Scegli una nuova password da questo indirizzo:', d.link, '', frasi[2], '', frasi[3]].join('\n');
}

// Manda il link di recupero. NON lancia MAI (chi la chiama non deve poter capire, dal tempo o da un errore, se l'account esiste): se fallisce si scrive nel log.
// `d` = { a, username, nome, link, validitaMin }; l'indirizzo `a` è SEMPRE quello salvato nell'account, mai uno scritto da chi chiede.
async function inviaRecuperoPassword(d) {
  try {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.a || ''))) return { inviata: false, motivo: 'l’account non ha un indirizzo email valido' };
    return await invia({ a: d.a, oggetto: oggettoRecuperoPassword(), html: htmlRecuperoPassword(d), testo: testoRecuperoPassword(d) });
  } catch (e) {
    console.error('[email] recupero password non inviato:', e.message);
    return { inviata: false, motivo: e.message };
  }
}

module.exports = {
  configurato,
  impostaTrasporto,
  invia,
  oggettoRecuperoPassword,
  htmlRecuperoPassword,
  testoRecuperoPassword,
  inviaRecuperoPassword,
  oggettoPagamentoRicevuto,
  htmlPagamentoRicevuto,
  testoPagamentoRicevuto,
  inviaPagamentoRicevuto,
};
