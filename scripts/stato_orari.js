// Cosa vede l'INSTALLATORE degli orari del banco, filiale per filiale: SOLA LETTURA (una SELECT sulle filiali attive, niente scritture).
//
//   node scripts/stato_orari.js                  adesso
//   node scripts/stato_orari.js "2026-10-22 18:50"   a quell'ora di Roma (per provare "e alle 18:50?")
//
// Perché serve: per l'installatore "BOREA" è APERTA se lo è ALMENO UNA filiale attiva; una filiale senza orari impostati NON riceve richieste (dal 22/10/2026 non esiste
// più "sempre aperto"). Qui si vede, filiale per filiale, chi tiene aperto e cosa risulta all'installatore.
require('dotenv').config({ quiet: true });
const richieste = require('../src/richieste');
const orari = require('../src/orari');

// L'istante da controllare: quello scritto sulla riga di comando ("AAAA-MM-GG HH:MM"), altrimenti adesso.
function quando() {
  const testo = process.argv[2];
  if (!testo) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(testo.trim());
  if (!m) { console.error('Formato: "AAAA-MM-GG HH:MM" (ora di Roma)'); process.exit(1); }
  // l'ora di Roma di quel momento: si prova prima con +2 (ora legale), poi +1 (solare), fino a trovare quella che a Roma dà proprio quell'ora
  for (const scarto of [2, 1]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - scarto, +m[5]));
    const roma = new Intl.DateTimeFormat('en-GB', { timeZone: orari.FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    if (roma === m[4] + ':' + m[5]) return d;
  }
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 1, +m[5]));
}

(async () => {
  const adesso = quando();
  const banco = await richieste.bancoPerInstallatore(adesso);
  const roma = new Intl.DateTimeFormat('it-IT', { timeZone: orari.FUSO, dateStyle: 'full', timeStyle: 'short' }).format(adesso);
  console.log('Momento (Roma): ' + roma);
  console.log('Filiali attive: ' + banco.distributori.length + ' · ditta per l\'installatore: ' + (banco.nome || '(più ditte o nessuna: "il banco")'));
  console.log('');
  for (const d of banco.distributori) {
    const s = orari.statoOrari(d.orari, adesso);
    const letti = orari.leggiOrari(d.orari);
    console.log('· #' + d.id + ' ' + d.nome + (d.filiale ? ' — ' + d.filiale : ''));
    if (!letti) console.log('    orari: NON IMPOSTATI (valore vuoto o illeggibile) → NON riceve richieste');
    else {
      for (const g of orari.GIORNI) console.log('    ' + orari.NOMI[g].padEnd(10) + (letti[g].length ? letti[g].map((f) => f[0] + '–' + f[1]).join('  ') : 'chiuso'));
    }
    console.log('    adesso: ' + (s.aperto ? 'APERTA' + (s.chiude ? ' (chiude alle ' + s.chiude.ora + ')' : '') : 'chiusa' + (s.riapre ? ', riapre ' + s.riapre.testo : '')));
    console.log('');
  }
  const t = orari.testiChiuso(banco.stato, banco.nome);
  console.log('RISULTATO per l\'installatore: ' + (banco.stato.aperto
    ? 'APERTO' + (banco.stato.chiude ? ' fino alle ' + banco.stato.chiude.ora + (orari.inChiusura(banco.stato) ? ' (striscia "Ancora ' + banco.stato.chiude.mancanoMin + ' min")' : '') : ' — nessuna chiusura (nessun banco attivo)')
    : 'CHIUSO — ' + t.titolo + ' · ' + t.sotto));
  process.exit(0);
})().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
