import { useEffect, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PannelloCorriere } from '@/componenti/PannelloCorriere';
import { PannelloInstallatore } from '@/componenti/PannelloInstallatore';
import { SelettoreProfilo } from '@/componenti/SelettoreProfilo';
import { useProfiloAccesso } from '@/profiloAccesso';
import { useTema } from '@/tema';

// L'accesso, uguale per l'installatore (views/auth/login.ejs) e per il corriere (solo nell'app, mai sul sito: docs/app-corrieri.md). È UNA schermata sola con due
// metà larghe quanto lo schermo, una accanto all'altra: il selettore "Installatore | Corriere" in cima le fa scorrere (e il suo indicatore bianco scivola con loro),
// invece di sostituire una schermata con l'altra di colpo. Si parte dalla metà dell'ultima scelta (o di chi è appena uscito: vedi `profiloAccesso.ts`).
export default function Login() {
  const { c } = useTema();
  const profilo = useProfiloAccesso();
  const { width } = useWindowDimensions();
  const posizione = (profilo === 'corriere' ? 1 : 0);
  const [scorri] = useState(() => new Animated.Value(posizione));

  // A ogni cambio di profilo: chiude la tastiera (i campi vanno fuori vista) e fa scorrere le metà.
  useEffect(() => {
    Keyboard.dismiss();
    Animated.timing(scorri, { toValue: posizione, duration: 280, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  }, [posizione, scorri]);

  const spostamento = scorri.interpolate({ inputRange: [0, 1], outputRange: [0, -width] });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
          <View style={stili.selettore}>
            <SelettoreProfilo attivo={profilo} dove="accesso" />
          </View>
          {/* Le due metà: la pagina è larga quanto lo schermo, la fascia con le metà il doppio e si sposta di uno schermo intero. */}
          <View style={stili.vetrina}>
            <Animated.View style={[stili.fascia, { width: width * 2, transform: [{ translateX: spostamento }] }]}>
              <PannelloInstallatore larghezza={width} attivo={profilo === 'installatore'} />
              <PannelloCorriere larghezza={width} attivo={profilo === 'corriere'} />
            </Animated.View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const stili = StyleSheet.create({
  pagina: { flexGrow: 1, paddingTop: 28, paddingBottom: 24 },
  selettore: { paddingHorizontal: 20 },
  // Mostra solo la metà in vista; le due metà si allungano alla più alta, così il link in fondo resta in fondo anche per quella più bassa.
  vetrina: { flex: 1, overflow: 'hidden' },
  fascia: { flex: 1, flexDirection: 'row' },
});
