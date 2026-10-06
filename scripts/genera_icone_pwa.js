// Genera le icone PNG della PWA in public/icons (segnaposto: lettera "M" bianca su blu) senza dipendenze:
// encoder PNG con zlib. Quando ci sarà il logo vero basta sostituire i quattro file. Uso: node scripts/genera_icone_pwa.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLU = [0x24, 0x5a, 0x8f];
const BIANCO = [255, 255, 255];
const USCITA = path.join(__dirname, '..', 'public', 'icons');

// "M" in coordinate normalizzate (0..1). `scala` la rimpicciolisce attorno al centro (per le icone maskable,
// che devono stare nella zona sicura del 80% centrale).
function tratti(scala) {
  const punti = [[0.27, 0.71], [0.27, 0.29], [0.5, 0.57], [0.73, 0.29], [0.73, 0.71]];
  return punti.map(([x, y]) => [0.5 + (x - 0.5) * scala, 0.5 + (y - 0.5) * scala]);
}

function distSegmento(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function sulleLettera(x, y, punti, mezzoSpessore) {
  for (let i = 0; i < punti.length - 1; i++) {
    if (distSegmento(x, y, punti[i], punti[i + 1]) <= mezzoSpessore) return true;
  }
  return false;
}

// Dentro un quadrato con gli angoli arrotondati (raggio r, in coordinate normalizzate)?
function dentroArrotondato(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

function disegna(dimensione, { maskable }) {
  const campioni = 4;
  const scala = maskable ? 0.72 : 1;
  const punti = tratti(scala);
  const mezzoSpessore = 0.045 * scala * 1.0;
  const raw = Buffer.alloc((dimensione * 4 + 1) * dimensione);
  for (let py = 0; py < dimensione; py++) {
    raw[py * (dimensione * 4 + 1)] = 0; // filtro "nessuno"
    for (let px = 0; px < dimensione; px++) {
      let sfondo = 0, lettera = 0;
      for (let sy = 0; sy < campioni; sy++) {
        for (let sx = 0; sx < campioni; sx++) {
          const x = (px + (sx + 0.5) / campioni) / dimensione;
          const y = (py + (sy + 0.5) / campioni) / dimensione;
          const dentro = maskable ? true : dentroArrotondato(x, y, 0.22);
          if (dentro) {
            sfondo++;
            if (sulleLettera(x, y, punti, mezzoSpessore)) lettera++;
          }
        }
      }
      const totale = campioni * campioni;
      const a = sfondo / totale;
      const mix = sfondo ? lettera / sfondo : 0;
      const o = py * (dimensione * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(BLU[0] + (BIANCO[0] - BLU[0]) * mix);
      raw[o + 1] = Math.round(BLU[1] + (BIANCO[1] - BLU[1]) * mix);
      raw[o + 2] = Math.round(BLU[2] + (BIANCO[2] - BLU[2]) * mix);
      raw[o + 3] = Math.round(255 * a);
    }
  }
  return codificaPng(dimensione, raw);
}

function chunk(tipo, dati) {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(corpo) >>> 0);
  return Buffer.concat([lunghezza, corpo, crc]);
}

function codificaPng(dimensione, raw) {
  const testata = Buffer.alloc(13);
  testata.writeUInt32BE(dimensione, 0);
  testata.writeUInt32BE(dimensione, 4);
  testata[8] = 8; // 8 bit per canale
  testata[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', testata),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(USCITA, { recursive: true });
const file = [
  ['icona-192.png', 192, false],
  ['icona-512.png', 512, false],
  ['icona-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true], // iOS arrotonda da solo gli angoli: sfondo pieno
];
for (const [nome, dim, maskable] of file) {
  const png = disegna(dim, { maskable });
  fs.writeFileSync(path.join(USCITA, nome), png);
  console.log(nome, dim + 'x' + dim, png.length + ' byte');
}
