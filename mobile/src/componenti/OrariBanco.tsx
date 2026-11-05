// Gli orari del banco nel carrello (richiesta del 22/10/2026, mockup docs/mockup/carrello-chiuso.png e carrello-in-chiusura.png): fuori orario il carrello si riempie e
// resta salvato ma non si invia; poco prima della chiusura una striscia dice quanto manca. I testi li scrive il server (src/logica/ordini/orari.js), mai l'app.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Orari } from '../api';
import { useContoAllaRovescia } from '../dati';
import { FONT, RAGGIO, useTema } from '../tema';
import { Icona } from './Icona';

// Il titolo della pagina "Orari": con il nome del banco ("Orari di BOREA"), come l'intestazione del sito.
export function titoloOrari(nome: string | null | undefined) {
  return nome ? 'Orari di ' + nome : 'Orari del banco';
}

// Apre la pagina con i sette giorni.
export function apriOrari(nome: string | null | undefined) {
  router.push({ pathname: '/orari', params: { titolo: titoloOrari(nome) } });
}

// Il testo con una parte in grassetto ("Riapre " + "domani alle 07:30").
function ConGrassetto({ prima, forte, stile }: { prima: string; forte: string; stile: object }) {
  return (
    <Text style={stile}>
      {prima}
      {forte ? <Text style={{ fontFamily: FONT.testoForte }}>{forte}</Text> : null}
    </Text>
  );
}

// In cima al carrello quando il banco è chiuso: quando riapre, e il link agli orari.
export function RiquadroChiuso({ orari }: { orari: Orari }) {
  const { c } = useTema();
  const t = orari.testi;
  if (orari.aperto || !t) return null;
  return (
    <View style={[stili.chiuso, { backgroundColor: c.accentoScuro }]} accessibilityRole="summary">
      <View style={stili.testa}>
        <View style={stili.luna}>
          <Icona nome="luna" colore={c.suAccento} dimensione={22} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[stili.titolo, { color: c.suAccento }]}>{t.titolo}</Text>
          <ConGrassetto prima={t.sottoPrefisso} forte={t.quando} stile={[stili.sotto, { color: c.suAccento }]} />
        </View>
      </View>
      <Text style={[stili.testo, { color: c.suAccento }]}>Puoi continuare ad aggiungere materiale: il carrello resta salvato e lo invii appena riapre.</Text>
      <Pressable onPress={() => apriOrari(orari.nome)} accessibilityRole="link" hitSlop={8} style={stili.vediOrari}>
        <Icona nome="orario" colore={c.suAccento} dimensione={18} />
        <Text style={[stili.vediOrariTesto, { color: c.suAccento }]}>Vedi orari</Text>
        <Icona nome="avanti" colore={c.suAccento} dimensione={16} />
      </Pressable>
    </View>
  );
}

// Poco prima della chiusura (il server dice quando: `chiude.in_chiusura`, 30 minuti): "Ancora 9 min per inviare: alle 17:00 chiudiamo". I minuti scendono da soli.
export function StrisciaInChiusura({ orari, lettoIl }: { orari: Orari; lettoIl: number }) {
  const { c } = useTema();
  const chiude = orari.aperto ? orari.chiude : null;
  const secondi = useContoAllaRovescia(chiude && chiude.in_chiusura ? chiude.secondi : null, lettoIl);
  if (!chiude || !chiude.in_chiusura || secondi === null) return null;
  const minuti = Math.max(1, Math.ceil(secondi / 60));
  return (
    <View style={[stili.striscia, { backgroundColor: c.arancioChiaro }]} accessibilityRole="alert">
      <Icona nome="timer" colore={c.arancio} dimensione={18} />
      <Text style={[stili.strisciaTesto, { color: c.arancio }]}>
        Ancora <Text style={{ fontFamily: FONT.testoForte }}>{minuti} min</Text> per inviare: alle {chiude.ora} chiudiamo
      </Text>
    </View>
  );
}

// Sotto il pulsante di invio, a banco chiuso: "Ordini chiusi · BOREA riapre domani alle 07:30".
export function NotaChiuso({ orari }: { orari: Orari }) {
  const { c } = useTema();
  const t = orari.testi;
  if (orari.aperto || !t) return null;
  return (
    <View style={stili.nota}>
      <Icona nome="luna" colore={c.grigio} dimensione={16} />
      <ConGrassetto prima={t.notaPrefisso} forte={t.quando} stile={[stili.notaTesto, { color: c.grigio }]} />
    </View>
  );
}

const stili = StyleSheet.create({
  chiuso: { borderRadius: RAGGIO, padding: 16, gap: 12 },
  testa: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  luna: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  titolo: { fontFamily: FONT.titolo, fontSize: 18 },
  sotto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, marginTop: 2 },
  testo: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, opacity: 0.92 },
  vediOrari: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 32 },
  vediOrariTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  striscia: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RAGGIO, paddingVertical: 10, paddingHorizontal: 14 },
  strisciaTesto: { flexShrink: 1, fontFamily: FONT.testoMedio, fontSize: 14, lineHeight: 20 },
  nota: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -4 },
  notaTesto: { flexShrink: 1, fontFamily: FONT.testo, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
