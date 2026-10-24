// Genera le immagini dell'app Android in mobile/assets (segnaposto come le icone della PWA: lettera "M" bianca su blu), senza dipendenze:
// encoder PNG con zlib. Quando ci sarà il logo vero basta sostituire i file (o questo disegno). Uso: node scripts/genera_icone_android.js
//
//   icon.png                      1024×1024  icona dell'app (e dell'anteprima su Google Play): blu pieno con la lettera
//   android-icon-background.png   1024×1024  sfondo dell'icona adattiva: blu pieno
//   android-icon-foreground.png   1024×1024  primo piano dell'icona adattiva: la lettera nella zona sicura (i 2/3 centrali), sfondo trasparente
//   android-icon-monochrome.png   1024×1024  versione per le icone "a tema" di Android 13+: solo la forma (il sistema la colora)
//   splash-icon.png               1024×1024  la lettera bianca su trasparente, sullo sfondo blu della schermata di avvio
//   notification-icon.png         96×96      icona della barra delle notifiche: solo la forma, bianca su trasparente (Android la tinge)
//   favicon.png                   48×48      per la versione web di sviluppo
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLU = [0x24, 0x5a, 0x8f];
const BIANCO = [255, 255, 255];
const USCITA = path.join(__dirname, '..', 'mobile', 'assets');

// La "M" in coordinate normalizzate (0..1), ridotta attorno al centro da `scala`.
function tratti(scala) {
  const punti = [[0.27, 0.71], [0.27, 0.29], [0.5, 0.57], [0.73, 0.29], [0.73, 0.71]];
  return punti.map(([x, y]) => [0.5 + (x - 0.5) * scala, 0.5 + (y - 0.5) * scala]);
}

// Distanza di un punto da un segmento: serve a disegnare la lettera a tratto spesso.
function distSegmento(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Dice se un punto cade sul tratto della lettera, cioè abbastanza vicino a uno dei suoi segmenti.
function sullaLettera(x, y, punti, mezzoSpessore) {
  for (let i = 0; i < punti.length - 1; i++) if (distSegmento(x, y, punti[i], punti[i + 1]) <= mezzoSpessore) return true;
  return false;
}

// `sfondo`: 'blu' (pieno), 'nessuno' (trasparente). `lettera`: colore RGB della lettera, o null per non disegnarla.
function disegna(dimensione, { sfondo, lettera, scala }) {
  const campioni = dimensione >= 256 ? 3 : 6;
  const punti = tratti(scala);
  const mezzoSpessore = 0.05 * scala;
  const riga = dimensione * 4 + 1;
  const raw = Buffer.alloc(riga * dimensione);
  for (let py = 0; py < dimensione; py++) {
    raw[py * riga] = 0; // filtro "nessuno"
    for (let px = 0; px < dimensione; px++) {
      let sulla = 0;
      for (let sy = 0; sy < campioni; sy++) {
        for (let sx = 0; sx < campioni; sx++) {
          const x = (px + (sx + 0.5) / campioni) / dimensione;
          const y = (py + (sy + 0.5) / campioni) / dimensione;
          if (lettera && sullaLettera(x, y, punti, mezzoSpessore)) sulla++;
        }
      }
      const mix = sulla / (campioni * campioni);
      const o = py * riga + 1 + px * 4;
      if (sfondo === 'blu') {
        const c = lettera || BIANCO;
        raw[o] = Math.round(BLU[0] + (c[0] - BLU[0]) * mix);
        raw[o + 1] = Math.round(BLU[1] + (c[1] - BLU[1]) * mix);
        raw[o + 2] = Math.round(BLU[2] + (c[2] - BLU[2]) * mix);
        raw[o + 3] = 255;
      } else {
        const c = lettera || BIANCO;
        raw[o] = c[0];
        raw[o + 1] = c[1];
        raw[o + 2] = c[2];
        raw[o + 3] = Math.round(255 * mix);
      }
    }
  }
  return codificaPng(dimensione, raw);
}

// Costruisce un blocco di un file PNG: lunghezza, tipo, dati e controllo di integrità (CRC).
function chunk(tipo, dati) {
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(dati.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(corpo) >>> 0);
  return Buffer.concat([lunghezza, corpo, crc]);
}

// Trasforma i pixel in un file PNG quadrato, senza librerie esterne.
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
  ['icon.png', 1024, { sfondo: 'blu', lettera: BIANCO, scala: 1 }],
  ['android-icon-background.png', 1024, { sfondo: 'blu', lettera: null, scala: 1 }],
  // Zona sicura delle icone adattive: il sistema ritaglia fino a un terzo ai bordi, la lettera sta nei 2/3 centrali.
  ['android-icon-foreground.png', 1024, { sfondo: 'nessuno', lettera: BIANCO, scala: 0.66 }],
  ['android-icon-monochrome.png', 1024, { sfondo: 'nessuno', lettera: BIANCO, scala: 0.66 }],
  ['splash-icon.png', 1024, { sfondo: 'nessuno', lettera: BIANCO, scala: 0.9 }],
  ['notification-icon.png', 96, { sfondo: 'nessuno', lettera: BIANCO, scala: 1 }],
  ['favicon.png', 48, { sfondo: 'blu', lettera: BIANCO, scala: 1 }],
];
for (const [nome, dim, opzioni] of file) {
  // android-icon-background non ha lettera: lo sfondo blu pieno.
  const png = disegna(dim, nome === 'android-icon-background.png' ? { ...opzioni, lettera: null } : opzioni);
  fs.writeFileSync(path.join(USCITA, nome), png);
  console.log(nome, dim + 'x' + dim, png.length + ' byte');
}
