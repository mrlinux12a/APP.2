// I pezzi comuni delle pagine di accesso e registrazione (views/auth/*.ejs, assets/css/11_accesso_e_registrazione.css): il pulsante grande, la riga di errori e il
// link in fondo alla pagina.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FONT, useTema, useTemaAccesso } from '../tema';

// Il pulsante principale (.acc-btn): alto 54, tutto tondo, nel colore dell'accento (blu per l'installatore; giallo con testo scuro per il corriere, vedi
// `TemaAccesso`); da spento resta più chiaro con il cerchio che gira.
export function PulsanteAcc({ titolo, onPress, inCorso }: { titolo: string; onPress: () => void; inCorso?: boolean }) {
  const t = useTemaAccesso();
  return (
    <Pressable
      onPress={onPress}
      disabled={inCorso}
      accessibilityRole="button"
      style={({ pressed }) => [stili.pulsante, { backgroundColor: pressed ? t.accentoScuro : t.accento, opacity: inCorso ? 0.75 : 1 }]}
    >
      {inCorso ? <ActivityIndicator color={t.suAccento} /> : <Text style={[stili.pulsanteTesto, { color: t.suAccento }]}>{titolo}</Text>}
    </Pressable>
  );
}

// Un avviso che non è un errore (es. "Ti abbiamo mandato un'email"): stesso riquadro del rosso ma nei toni chiari dell'accento, con il testo scuro.
export function AvvisoAcc({ testo }: { testo: string }) {
  const { c } = useTema();
  const t = useTemaAccesso();
  return (
    <View style={[stili.errori, { backgroundColor: t.accentoChiaro }]} accessibilityRole="alert">
      <Text style={[stili.erroriTesto, { color: c.testo }]}>{testo}</Text>
    </View>
  );
}

// Il riquadro rosso degli errori (.errore): un titolo facoltativo ("Controlla questi punti:") e le righe sotto, ognuna col suo punto se sono più di una.
export function ErroriAcc({ titolo, righe }: { titolo?: string; righe: string[] }) {
  const { c } = useTema();
  if (!righe.length) return null;
  return (
    <View style={[stili.errori, { backgroundColor: c.rossoChiaro }]} accessibilityRole="alert">
      {titolo ? <Text style={[stili.erroriTitolo, { color: '#991b1b' }]}>{titolo}</Text> : null}
      {righe.map((r) => (
        <Text key={r} style={[stili.erroriTesto, { color: '#991b1b' }]}>
          {righe.length > 1 || titolo ? '•  ' : ''}
          {r}
        </Text>
      ))}
    </View>
  );
}

const stili = StyleSheet.create({
  pulsante: { height: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 27 },
  pulsanteTesto: { fontFamily: FONT.testoForte, fontSize: 17 },
  errori: { gap: 4, marginBottom: 18, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14 },
  erroriTitolo: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 21 },
  erroriTesto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 21 },
});
