// Pulizia nomi, seconda passata: toglie il numero iniziale SOLO dai due gruppi verificati
// come sicuri (duplica il codice fornitore, o si ripete più avanti nello stesso nome in un
// contesto inequivocabile: "DiamN" o "Ngr"). Non tocca i numeri fusi con un'unità (3"tot)
// né i veri numeri di modello/serie del produttore (RBM, Geberit...).
// DRY_RUN=1 stampa solo l'elenco, senza scrivere nulla. File temporaneo, va cancellato dopo l'uso.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false,
});
const DRY_RUN = process.env.DRY_RUN === '1';

function normalizza(s) { return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function togliCodiceIniziale(nome, codice, codiceFornitore) {
  let s = nome;
  const codNorm = normalizza(codice);
  const fornNorm = normalizza(codiceFornitore);
  for (let i = 0; i < 5; i++) {
    const m = s.match(/^(\S+)\s*/);
    if (!m) break;
    const tokenNorm = normalizza(m[1]);
    if (tokenNorm.length < 3) break;
    const combacia =
      (codNorm && codNorm.startsWith(tokenNorm)) ||
      (fornNorm && fornNorm.startsWith(tokenNorm)) ||
      (fornNorm && tokenNorm.startsWith(fornNorm));
    if (!combacia) break;
    s = s.slice(m[0].length);
  }
  return s.trim();
}

// Corretto rispetto alla prima versione: non basta che il numero compaia "da qualche
// parte" più avanti (un "3" isolato combacerebbe per puro caso dentro una frazione come
// "Ø3/4\"", che non c'entra nulla) — deve comparire in uno dei due contesti verificati a
// mano: "DiamN" (diametro) o "Ngr" (gradi), con un confine di parola dopo il numero così
// da non confondersi con un numero più lungo che lo contiene (es. "80" dentro "800").
function togliNumeroRidondante(nome) {
  const m = nome.match(/^([0-9]+(?:[.,][0-9]+)?)\s+(.*)$/);
  if (!m) return null;
  const [, numero, resto] = m;
  const numeroEsc = numero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('diam\\.?\\s*' + numeroEsc + '(?!\\d)|' + numeroEsc + 'gr\\b', 'i');
  if (!pattern.test(resto)) return null;
  return resto.trim();
}

(async () => {
  const client = await pool.connect();
  try {
    const rows = (await client.query("SELECT id, codice, codice_fornitore, nome FROM products WHERE nome ~ '^[0-9]'")).rows;

    const aggiornamenti = [];
    for (const r of rows) {
      const mAttaccato = r.nome.match(/^[0-9]+(\S*)/);
      const attaccato = mAttaccato ? mAttaccato[1] : '';
      if (attaccato && /^[a-zA-Z"°]/.test(attaccato)) continue;

      const viaCodice = togliCodiceIniziale(r.nome, r.codice, r.codice_fornitore);
      if (viaCodice && viaCodice !== r.nome) {
        aggiornamenti.push({ id: r.id, prima: r.nome, dopo: viaCodice, motivo: 'duplica codice fornitore' });
        continue;
      }

      const viaRidondanza = togliNumeroRidondante(r.nome);
      if (viaRidondanza) {
        aggiornamenti.push({ id: r.id, prima: r.nome, dopo: viaRidondanza, motivo: 'numero ripetuto (Diam./gr)' });
      }
    }

    console.log('Prodotti da aggiornare:', aggiornamenti.length, DRY_RUN ? '(DRY RUN, nessuna scrittura)' : '');
    console.log('--- Elenco completo prima/dopo ---');
    console.table(aggiornamenti.map((a) => ({ id: a.id, motivo: a.motivo, prima: a.prima, dopo: a.dopo })));

    if (DRY_RUN) return;

    await client.query('BEGIN');
    for (const a of aggiornamenti) {
      await client.query('UPDATE products SET nome = $1, aggiornato_il = NOW() WHERE id = $2', [a.dopo, a.id]);
    }
    await client.query('COMMIT');
    console.log('COMMIT eseguito.', aggiornamenti.length, 'nomi aggiornati.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Errore, ROLLBACK eseguito, nessuna modifica applicata:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
