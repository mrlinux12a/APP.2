// Questa rete arriva al database? Si lancia con:  node scripts/diagnosi_rete_db.js
//
// Controlla, per ogni indirizzo del pooler di DATABASE_URL, a che punto si ferma la connessione:
//   1. TCP                    (la porta si apre?)
//   2. richiesta SSL Postgres (il server risponde "S"?)
//   3. handshake TLS
// Dalla Wi-Fi dell'università (eduroam) il punto 1 riesce e il 2 no: il TCP si apre (in pochi millisecondi, chi risponde è un
// firewall di mezzo) ma al server Postgres non arriva mai niente, o la risposta non torna. Il codice dell'app non può farci niente:
// serve un'altra rete (hotspot del telefono), una VPN o un tunnel. Non stampa mai la password.
require('dotenv').config();
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;

const LIMITE_MS = 6000;

function fase(porta, ip, host) {
  return new Promise((risolvi) => {
    const t0 = Date.now();
    let ultima = 'TCP non aperto';
    const chiudi = (esito, ok = false) => { clearTimeout(limite); s.destroy(); risolvi({ ok, esito, ms: Date.now() - t0 }); };
    const s = net.connect({ host: ip, port: porta });
    const limite = setTimeout(() => chiudi('fermo dopo "' + ultima + '" (nessuna risposta in ' + LIMITE_MS / 1000 + ' s)'), LIMITE_MS);
    s.on('error', (e) => chiudi('errore ' + (e.code || e.message)));
    s.on('connect', () => {
      ultima = 'TCP aperto';
      s.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47])); // SSLRequest di Postgres
      ultima = 'richiesta SSL mandata';
    });
    s.once('data', (d) => {
      if (d[0] !== 83) return chiudi('il server non accetta SSL (risposta ' + String.fromCharCode(d[0]) + ')');
      ultima = 'SSL accettato';
      const t = tls.connect({ socket: s, servername: host, rejectUnauthorized: false });
      t.on('secureConnect', () => chiudi('TLS ok', true));
      t.on('error', (e) => chiudi('errore TLS ' + (e.code || e.message)));
    });
  });
}

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL non è impostata (.env).'); process.exit(1); }
  const url = new URL(process.env.DATABASE_URL);
  const porte = [Number(url.port) || 5432];
  let ips;
  try {
    ips = await dns.resolve4(url.hostname);
  } catch (e) {
    console.log('DNS: non riesco a risolvere ' + url.hostname + ' (' + e.code + '). Controlla la connessione a Internet.');
    process.exit(2);
  }
  console.log('Database: ' + url.hostname + ':' + porte[0] + '  (' + ips.length + ' indirizzi)');
  let riusciti = 0;
  let totale = 0;
  for (const porta of porte) {
    for (const ip of ips) {
      const r = await fase(porta, ip, url.hostname);
      totale++;
      if (r.ok) riusciti++;
      console.log('  ' + ip + ':' + porta + '  ' + (r.ok ? 'OK    ' : 'FALLITO') + '  ' + r.esito + '  (' + r.ms + ' ms)');
    }
  }
  console.log('');
  if (riusciti === totale) console.log('Questa rete arriva al database: se l\'app non parte il problema è altrove.');
  else if (riusciti === 0) {
    console.log('Questa rete NON lascia passare il traffico Postgres verso il database (nessun indirizzo risponde).');
    console.log('Non è un errore dell\'app. Prova con l\'hotspot del telefono, una VPN, o un tunnel SSH passando dal server.');
  } else console.log('Questa rete lascia passare il traffico Postgres solo a tratti: ' + riusciti + ' indirizzi su ' + totale + '.');
  process.exit(riusciti === totale ? 0 : 3);
})();
