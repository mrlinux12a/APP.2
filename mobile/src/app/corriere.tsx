import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PulsanteAcc } from '@/componenti/acc';
import { Icona } from '@/componenti/Icona';
import { useSessione } from '@/sessione';
import { FONT, TEMI_ACCESSO, TemaAccessoProvider, useTema } from '@/tema';

const T = TEMI_ACCESSO.corriere;

// La schermata del CORRIERE dopo l'accesso (solo nell'app: docs/app-corrieri.md). Per ora dice soltanto che l'account è attivo e permette di uscire: le
// schermate di lavoro (le consegne da fare, la conferma al posto di WhatsApp) arrivano dopo.
export default function Corriere() {
  const { c } = useTema();
  const { utente, esci } = useSessione();
  const [inUscita, setInUscita] = useState(false);

  // Esce dall'account: la navigazione protetta riporta da sola all'accesso dei corrieri (il profilo ricordato resta "corriere").
  const uscita = async () => {
    setInUscita(true);
    try {
      await esci();
    } finally {
      setInUscita(false);
    }
  };

  const nome = utente?.nome?.trim() || utente?.ragione_sociale?.trim() || '';

  return (
    <TemaAccessoProvider profilo="corriere">
      <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
        <View style={stili.pagina}>
          <View style={stili.centro}>
            <View style={[stili.icona, { backgroundColor: T.accento, shadowColor: T.ombra.colore, shadowOpacity: T.ombra.opacita }]}>
              <Icona nome="furgone" colore={T.suAccento} dimensione={26} />
            </View>
            <Text style={[stili.occhiello, { color: T.testoAccento }]}>FLASH DELIVERY · CORRIERI</Text>
            <Text style={[stili.titolo, { color: c.testo }]}>{nome ? `Ciao ${nome},` : 'Ciao,'}{'\n'}il tuo account corriere è attivo</Text>
            <Text style={[stili.sotto, { color: c.grigio }]}>Qui vedrai le consegne da fare, appena saranno pronte.</Text>
          </View>
          <PulsanteAcc titolo="Esci" onPress={uscita} inCorso={inUscita} />
        </View>
      </SafeAreaView>
    </TemaAccessoProvider>
  );
}

const stili = StyleSheet.create({
  pagina: { flex: 1, paddingTop: 28, paddingHorizontal: 20, paddingBottom: 24 },
  centro: { flex: 1, justifyContent: 'center' },
  icona: {
    width: 52,
    height: 52,
    marginBottom: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  occhiello: { fontFamily: FONT.titolo, fontSize: 13, letterSpacing: 1.3, textTransform: 'uppercase' },
  titolo: { marginTop: 6, marginBottom: 10, fontFamily: FONT.titoloForte, fontSize: 28, lineHeight: 34 },
  sotto: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 22 },
});
