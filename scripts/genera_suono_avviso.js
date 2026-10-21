// Genera public/suoni/avviso.mp3: il suono degli avvisi del banco (nuova richiesta, corriere trovato).
//
// Richiesta esplicita del 21/10/2026: il suono di prima (Mi5 → La5, 659 e 880 Hz, attacco di 10 ms, picco a -5 dBFS) era "duro e squillante". Questo è un
// "din-don" morbido: La4 → Re5 (440 e 587 Hz), attacco dolce di 18 ms, solo tre armoniche che si spengono più in fretta della fondamentale (timbro da
// campanello di legno, niente note sopra i 2 kHz) e un picco a -6 dBFS (RMS circa -20 contro i -15 di prima). Le due note si sovrappongono: la prima non
// viene tagliata dalla seconda.
//
// Uso: node scripts/genera_suono_avviso.js [percorso.mp3] [--wav percorso.wav]
//   senza argomenti scrive public/suoni/avviso.mp3 (serve ffmpeg nel PATH per la codifica MP3; con --wav si può scrivere solo il WAV, senza ffmpeg).
// Per cambiare il carattere del suono basta toccare le costanti qui sotto e rilanciare.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SR = 44100;
const NOTE = [
  { hz: 440.0, inizio: 0.0, peso: 0.85, tau: 0.2 }, // La4: più corta, lascia spazio alla seconda
  { hz: 587.33, inizio: 0.26, peso: 1.0, tau: 0.3 }, // Re5: la nota che "suona" di più e resta un po' di più
];
// Fondamentale e due armoniche: ampiezza relativa e quanto durano rispetto alla fondamentale (le armoniche si spengono prima: suono tondo, non metallico).
const ARMONICHE = [
  { n: 1, a: 1.0, durata: 1.0 },
  { n: 2, a: 0.28, durata: 0.5 },
  { n: 3, a: 0.07, durata: 0.3 },
];
const ATTACCO_S = 0.018; // salita a coseno: niente "click" all'inizio
const CODA_S = 1.35; // quanto dopo l'ultima nota il suono è praticamente spento
const SFUMATA_FINALE_S = 0.12;
const PICCO_DBFS = -6;

function sintetizza() {
  const durata = NOTE[NOTE.length - 1].inizio + CODA_S;
  const n = Math.round(durata * SR);
  const x = new Float64Array(n);
  for (const nota of NOTE) {
    const i0 = Math.round(nota.inizio * SR);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / SR;
      const attacco = t < ATTACCO_S ? 0.5 * (1 - Math.cos((Math.PI * t) / ATTACCO_S)) : 1;
      let somma = 0;
      for (const h of ARMONICHE) {
        somma += h.a * Math.exp(-t / (nota.tau * h.durata)) * Math.sin(2 * Math.PI * nota.hz * h.n * t);
      }
      x[i] += nota.peso * attacco * somma;
    }
  }
  // Sfumata finale e normalizzazione al picco voluto.
  const f = Math.round(SFUMATA_FINALE_S * SR);
  for (let i = 0; i < f; i++) x[n - 1 - i] *= 0.5 * (1 - Math.cos((Math.PI * i) / f));
  let picco = 0;
  for (let i = 0; i < n; i++) picco = Math.max(picco, Math.abs(x[i]));
  const guadagno = Math.pow(10, PICCO_DBFS / 20) / picco;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * guadagno * 32767))), i * 2);
  return pcm;
}

function wav(pcm) {
  const testa = Buffer.alloc(44);
  testa.write('RIFF', 0);
  testa.writeUInt32LE(36 + pcm.length, 4);
  testa.write('WAVEfmt ', 8);
  testa.writeUInt32LE(16, 16);
  testa.writeUInt16LE(1, 20); // PCM
  testa.writeUInt16LE(1, 22); // mono
  testa.writeUInt32LE(SR, 24);
  testa.writeUInt32LE(SR * 2, 28);
  testa.writeUInt16LE(2, 32);
  testa.writeUInt16LE(16, 34);
  testa.write('data', 36);
  testa.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([testa, pcm]);
}

const argomenti = process.argv.slice(2);
const iWav = argomenti.indexOf('--wav');
const percorsoWav = iWav !== -1 ? argomenti[iWav + 1] : null;
const posizionali = argomenti.filter((a, i) => i !== iWav && i !== iWav + 1 || iWav === -1);
const percorsoMp3 = posizionali[0] || path.join(__dirname, '..', 'public', 'suoni', 'avviso.mp3');

const file = wav(sintetizza());
if (percorsoWav) {
  fs.writeFileSync(percorsoWav, file);
  console.log('WAV scritto:', percorsoWav, `(${file.length} byte)`);
  if (!posizionali.length) process.exit(0); // solo il WAV
}
const temporaneo = path.join(os.tmpdir(), 'avviso_minuteria_' + process.pid + '.wav');
fs.writeFileSync(temporaneo, file);
const esito = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', temporaneo, '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', String(SR), '-ac', '1', percorsoMp3], { stdio: 'inherit' });
fs.unlinkSync(temporaneo);
if (esito.status !== 0) {
  console.error('ffmpeg non è riuscito a scrivere l\'MP3 (è installato e nel PATH?).');
  process.exit(1);
}
console.log('MP3 scritto:', percorsoMp3, `(${fs.statSync(percorsoMp3).size} byte)`);
