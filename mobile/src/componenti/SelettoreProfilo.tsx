import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { impostaProfiloAccesso } from '../profiloAccesso';
import { FONT, TEMI_ACCESSO, useTema, type ProfiloAccesso } from '../tema';
import { Icona } from './Icona';

const VOCI: { profilo: ProfiloAccesso; testo: string; icona: 'casco' | 'furgone' }[] = [
  { profilo: 'installatore', testo: 'Installatore', icona: 'casco' },
  { profilo: 'corriere', testo: 'Corriere', icona: 'furgone' },
];

const MARGINE_PAGINA = 20; // il margine ai lati delle schermate di accesso e di registrazione
const PADDING = 4; // quello dentro la pillola, e lo spazio tra le due voci

// Il controllo "Installatore | Corriere" in cima alle schermate di accesso e di registrazione: una pillola come quella "Accedi / Registrati", la voce aperta in
// bianco con l'icona nel colore del suo tipo (blu per l'installatore, oro per il corriere), l'altra in grigio. La voce bianca è un indicatore che SCIVOLA da una
// voce all'altra.
// - Nell'accesso (`dove="accesso"`) il tocco cambia solo il profilo: `login.tsx` fa scorrere le sue due metà.
// - Nella registrazione (`dove="registrazione"`) il tocco NON continua la registrazione dell'altro tipo: apre l'accesso dell'altro tipo, da cui si sceglie se
//   accedere o registrarsi.
// La scelta è ricordata (vedi `profiloAccesso.ts`).
export function SelettoreProfilo({ attivo, dove }: { attivo: ProfiloAccesso; dove: 'accesso' | 'registrazione' }) {
  const { c } = useTema();
  const { width } = useWindowDimensions();
  const posizione = attivo === 'corriere' ? 1 : 0;
  const [scorri] = useState(() => new Animated.Value(posizione));
  // La larghezza di una voce, dalla larghezza dello schermo (la pillola occupa tutto tra i due margini): così l'indicatore è al posto giusto già dal primo disegno.
  const larghezzaVoce = (width - MARGINE_PAGINA * 2 - PADDING * 3) / 2;

  useEffect(() => {
    Animated.timing(scorri, { toValue: posizione, duration: 280, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  }, [posizione, scorri]);

  const scegli = (profilo: ProfiloAccesso) => {
    if (profilo === attivo) return;
    impostaProfiloAccesso(profilo);
    if (dove === 'registrazione') router.replace('/login');
  };

  return (
    <View style={stili.pillola} accessibilityRole="tablist">
      <Animated.View
        style={[
          stili.indicatore,
          { width: larghezzaVoce, transform: [{ translateX: scorri.interpolate({ inputRange: [0, 1], outputRange: [0, larghezzaVoce + PADDING] }) }] },
        ]}
      />
      {VOCI.map((voce) => {
        const aperta = voce.profilo === attivo;
        return (
          <Pressable key={voce.profilo} onPress={() => scegli(voce.profilo)} accessibilityRole="tab" accessibilityState={{ selected: aperta }} style={stili.voce}>
            <Icona nome={voce.icona} dimensione={20} colore={aperta ? TEMI_ACCESSO[voce.profilo].iconaSelettore : c.grigio} />
            <Text style={[stili.testo, { color: aperta ? c.testo : c.grigio }]}>{voce.testo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const stili = StyleSheet.create({
  pillola: { flexDirection: 'row', gap: PADDING, marginBottom: 20, padding: PADDING, borderRadius: 14, backgroundColor: '#e6e2d9' },
  indicatore: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    height: 38,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    shadowColor: '#232019',
    shadowOpacity: 0.16,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  voce: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 },
  testo: { fontFamily: FONT.testoForte, fontSize: 14.5 },
});
