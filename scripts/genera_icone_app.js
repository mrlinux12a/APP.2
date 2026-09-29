// Copia le icone SVG di src/icone.js nell'app nativa (mobile/src/icone.ts), così le due
// versioni non divergono: le icone si modificano solo in src/icone.js e poi si rilancia
//   node scripts/genera_icone_app.js
// L'app le disegna con SvgXml di react-native-svg: qui si tolgono solo gli attributi pensati
// per l'HTML (dimensioni in em, allineamento verticale, aria-hidden); currentColor resta e
// prende il colore passato al componente.
const fs = require('fs');
const path = require('path');
const icone = require('../src/icone');

// Solo sul tag <svg> di apertura: i <rect> interni hanno width/height veri, da non toccare.
function perApp(svg) {
  return svg.replace(/^<svg[^>]*>/, (apertura) =>
    apertura
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\sstyle="[^"]*"/g, '')
      .replace(/\saria-hidden="[^"]*"/g, '')
  );
}

const categorie = {};
for (const [slug, svg] of Object.entries(icone.ICONE_CATEGORIA)) categorie[slug] = perApp(svg);

const generiche = {};
for (const [nome, valore] of Object.entries(icone)) {
  if (typeof valore === 'string' && nome.startsWith('icona')) {
    // iconaLente -> lente, iconaVuotoRicerca -> vuotoRicerca
    const chiave = nome.charAt(5).toLowerCase() + nome.slice(6);
    generiche[chiave] = perApp(valore);
  }
}

const destinazione = path.join(__dirname, '..', 'mobile', 'src', 'icone.ts');
const contenuto =
  '// GENERATO da scripts/genera_icone_app.js a partire da src/icone.js: non modificare a mano.\n\n' +
  'export const ICONE_CATEGORIA: Record<string, string> = ' + JSON.stringify(categorie, null, 2) + ';\n\n' +
  'export const ICONE = ' + JSON.stringify(generiche, null, 2) + ' as const;\n\n' +
  'export type NomeIcona = keyof typeof ICONE;\n';

fs.mkdirSync(path.dirname(destinazione), { recursive: true });
fs.writeFileSync(destinazione, contenuto);
console.log(`Scritte ${Object.keys(categorie).length} icone categoria e ${Object.keys(generiche).length} generiche in ${destinazione}`);
