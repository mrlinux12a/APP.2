// app.js e style.css si scrivono a pezzi (assets/js, assets/css) e il server li riunisce (src/comune/asset_composti.js). Qui si controlla che i pezzi stiano al loro
// posto: numerati, riuniti in ordine, ognuno completo da solo (un pezzo che comincia o finisce a metà di un blocco romperebbe il file riunito).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { eComposto, leggiComposto } = require('../../src/comune/asset_composti');

const radice = path.join(__dirname, '..', '..');
const pezzi = (cartella, estensione) => fs.readdirSync(path.join(radice, 'assets', cartella)).filter((n) => n.endsWith(estensione)).sort();

test('eComposto: solo /app.js e /style.css si compongono, gli altri file si servono interi', () => {
  assert.equal(eComposto('/app.js'), true);
  assert.equal(eComposto('/style.css'), true);
  assert.equal(eComposto('/mappa.js'), false);
  assert.equal(eComposto('/pagamento.js'), false);
  assert.equal(eComposto('/constructor'), false);
});

test('i pezzi hanno un numero davanti, tutto diverso e senza buchi: è l\'ordine in cui vengono riuniti', () => {
  for (const [cartella, estensione] of [['js', '.js'], ['css', '.css']]) {
    const nomi = pezzi(cartella, estensione);
    assert.ok(nomi.length > 1, 'assets/' + cartella + ' ha più pezzi');
    nomi.forEach((nome, i) => assert.ok(nome.startsWith(String(i + 1).padStart(2, '0') + '_'), `${nome}: il numero deve essere ${i + 1}`));
  }
});

test('il file riunito è la giunzione dei pezzi in ordine di nome, byte per byte', () => {
  for (const [percorso, cartella, estensione] of [['/app.js', 'js', '.js'], ['/style.css', 'css', '.css']]) {
    const atteso = pezzi(cartella, estensione).map((n) => fs.readFileSync(path.join(radice, 'assets', cartella, n), 'utf8')).join('');
    assert.equal(leggiComposto(percorso).testo, atteso);
  }
});

test('ogni pezzo di JS è completo da solo (sintassi valida): si taglia solo fra un blocco e l\'altro', () => {
  for (const nome of pezzi('js', '.js')) {
    const testo = fs.readFileSync(path.join(radice, 'assets', 'js', nome), 'utf8');
    assert.doesNotThrow(() => new vm.Script(testo, { filename: nome }), nome);
  }
});

test('ogni pezzo di CSS è completo da solo (graffe e commenti chiusi): si taglia solo fra una regola e l\'altra', () => {
  for (const nome of pezzi('css', '.css')) {
    const testo = fs.readFileSync(path.join(radice, 'assets', 'css', nome), 'utf8');
    let profondita = 0;
    let inCommento = false;
    for (let i = 0; i < testo.length; i++) {
      if (inCommento) { if (testo[i] === '*' && testo[i + 1] === '/') { inCommento = false; i++; } continue; }
      if (testo[i] === '/' && testo[i + 1] === '*') { inCommento = true; i++; continue; }
      if (testo[i] === '{') profondita++;
      else if (testo[i] === '}') profondita--;
      assert.ok(profondita >= 0, `${nome}: una graffa chiusa di troppo`);
    }
    assert.equal(inCommento, false, `${nome}: un commento resta aperto`);
    assert.equal(profondita, 0, `${nome}: una graffa resta aperta`);
  }
});

test('la versione è la modifica più recente fra i pezzi e il tipo è quello giusto', () => {
  const js = leggiComposto('/app.js');
  const recente = Math.max(...pezzi('js', '.js').map((n) => fs.statSync(path.join(radice, 'assets', 'js', n)).mtimeMs));
  assert.equal(js.mtimeMs, recente);
  assert.match(js.tipo, /javascript/);
  assert.match(leggiComposto('/style.css').tipo, /text\/css/);
});
