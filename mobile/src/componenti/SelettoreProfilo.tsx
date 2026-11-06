import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { impostaProfiloAccesso } from '../profiloAccesso';
import { FONT, TEMI_ACCESSO, useTema, type ProfiloAccesso } from '../tema';
import { Icona } from './Icona';

// Dove porta ogni voce, per tipo di pagina: l'accesso dell'uno o dell'altro, la registrazione dell'uno o dell'altro.
const PERCORSI = {
  accesso: { installatore: '/login', corriere: '/accesso-corriere' },
  registrazione: { installatore: '/registrati', corriere: '/registrati-corriere' },
} as const;

const VOCI: { profilo: ProfiloAccesso; testo: string; icona: 'casco' | 'furgone' }[] = [
  { profilo: 'installatore', testo: 'Installatore', icona: 'casco' },
  { profilo: 'corriere', testo: 'Corriere', icona: 'furgone' },
];

// Il controllo "Installatore | Corriere" in cima alle schermate di accesso e di registrazione: una pillola come quella "Accedi / Registrati", la voce aperta in
// bianco con l'icona nel colore del suo tipo (blu per l'installatore, oro per il corriere), l'altra in grigio. Un tocco passa alla schermata dell'altro tipo
// dello STESSO genere (da "Accedi installatore" ad "Accedi corriere", dalla registrazione di uno a quella dell'altro) e ricorda la scelta.
export function SelettoreProfilo({ attivo, dove }: { attivo: ProfiloAccesso; dove: keyof typeof PERCORSI }) {
  const { c } = useTema();

  const scegli = (profilo: ProfiloAccesso) => {
    if (profilo === attivo) return;
    impostaProfiloAccesso(profilo);
    router.replace(PERCORSI[dove][profilo]);
  };

  return (
    <View style={stili.pillola} accessibilityRole="tablist">
      {VOCI.map((voce) => {
        const aperta = voce.profilo === attivo;
        return (
          <Pressable
            key={voce.profilo}
            onPress={() => scegli(voce.profilo)}
            accessibilityRole="tab"
            accessibilityState={{ selected: aperta }}
            style={[stili.voce, aperta && stili.voceAperta]}
          >
            <Icona nome={voce.icona} dimensione={20} colore={aperta ? TEMI_ACCESSO[voce.profilo].iconaSelettore : c.grigio} />
            <Text style={[stili.testo, { color: aperta ? c.testo : c.grigio }]}>{voce.testo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const stili = StyleSheet.create({
  pillola: { flexDirection: 'row', gap: 4, marginBottom: 20, padding: 4, borderRadius: 14, backgroundColor: '#e6e2d9' },
  voce: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 },
  voceAperta: { backgroundColor: '#ffffff', shadowColor: '#232019', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  testo: { fontFamily: FONT.testoForte, fontSize: 14.5 },
});
