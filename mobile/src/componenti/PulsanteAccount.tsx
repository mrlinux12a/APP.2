import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useProfilo } from '../dati';
import type { NomeIcona } from '../icone';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { Avatar } from './Avatar';
import { altezzaTotale } from './BarraTitolo';
import { Icona } from './Icona';

// Una voce del menu (.pp-voce): icona in un quadrato grigio, testo e freccia. "Esci" è rossa e senza freccia.
function Voce({ icona, testo, alTocco, esci = false }: { icona: NomeIcona; testo: string; alTocco: () => void; esci?: boolean }) {
  const { c } = useTema();
  const colore = esci ? '#a33232' : c.testo;
  return (
    <Pressable
      onPress={alTocco}
      accessibilityRole="menuitem"
      style={({ pressed }) => [stili.voce, pressed && { backgroundColor: c.sfondo }]}
    >
      <View style={[stili.voceIcona, { backgroundColor: esci ? c.rossoChiaro : '#f1efea' }]}>
        <Icona nome={icona} colore={colore} dimensione={19} />
      </View>
      <Text style={[stili.voceTesto, { color: colore }]}>{testo}</Text>
      {esci ? null : <Text style={stili.freccia}>›</Text>}
    </Pressable>
  );
}

// Il pannello a tendina del profilo (.profilo-pannello di views/partials/comune/appbar.ejs): in alto a destra sotto la barra, con il resto della pagina oscurato.
// Intestazione col cerchio delle iniziali, la ragione sociale e "referente · cliente di DISTRIBUTORE"; poi «La mia anagrafica», «Storico ordini» ed «Esci».
// Un tocco fuori dal pannello (o il tasto indietro di Android) lo chiude. Nessuna animazione, come ovunque nell'app.
function Menu({ chiudi }: { chiudi: () => void }) {
  const { c } = useTema();
  const { utente, esci } = useSessione();
  const profilo = useProfilo();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const sopra = altezzaTotale(insets.top);

  const referente = profilo.data?.utente.referente || '';
  const distributore = profilo.data?.distributore || '';
  const sotto = [referente, distributore ? 'cliente di ' + distributore : ''].filter(Boolean).join(' · ');

  // Se si è già nella pagina scelta si chiude soltanto; altrimenti ci si va (navigate non impila due volte la stessa pagina).
  const vai = (percorso: '/profilo' | '/ordini/storico') => {
    chiudi();
    if (pathname === percorso) return;
    // Lo Storico sta nella pila di "Stato ordini": aprendolo da un'altra scheda la pila partirebbe da lui e non avrebbe la freccia indietro.
    // `withAnchor` mette sotto "Stato ordini" (vedi `anchor` in ordini/_layout.tsx): indietro riporta lì.
    router.navigate(percorso, { withAnchor: true });
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={chiudi}>
      {/* Il tocco fuori dal pannello chiude (anche sulla barra in alto, dov'è il pulsante stesso). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={chiudi} accessibilityRole="button" accessibilityLabel="Chiudi il menu" />
      {/* Il velo parte sotto la barra, che resta in luce (.profilo-velo). */}
      <View pointerEvents="none" style={[stili.velo, { top: sopra }]} />
      <View
        accessibilityViewIsModal
        style={[
          stili.pannello,
          { top: sopra + 6, right: 10 + insets.right, width: Math.min(300, width - 20), maxHeight: height - sopra - 16, backgroundColor: c.superficie },
        ]}
      >
        <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
          <View style={stili.testata}>
            <Avatar nome={utente?.ragione_sociale} persona={referente} misura={48} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stili.ragione, { color: c.testo }]}>{utente?.ragione_sociale}</Text>
              {sotto ? <Text style={[stili.sotto, { color: c.grigio }]}>{sotto}</Text> : null}
            </View>
          </View>
          <View style={stili.linea} />
          <Voce icona="persona" testo="La mia anagrafica" alTocco={() => vai('/profilo')} />
          <Voce icona="orario" testo="Storico ordini" alTocco={() => vai('/ordini/storico')} />
          <View style={stili.linea} />
          <Voce
            icona="esci"
            testo="Esci"
            esci
            alTocco={() => {
              chiudi();
              esci();
            }}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

// Il pulsante del profilo in alto a destra: il cerchio blu con le iniziali, come sul sito (.profilo-btn). Apre il menu del profilo.
export function PulsanteAccount() {
  const { utente } = useSessione();
  const [aperto, setAperto] = useState(false);
  // Il profilo si legge già adesso (una volta ogni 5 minuti, la stessa richiesta della pagina «La mia anagrafica»): quando il menu si apre il sottotitolo c'è già.
  useProfilo();
  return (
    <>
      <Pressable
        onPress={() => setAperto(true)}
        accessibilityRole="button"
        accessibilityLabel="Menu profilo"
        accessibilityState={{ expanded: aperto }}
        hitSlop={10}
        style={{ paddingHorizontal: 10 }}
      >
        <Avatar nome={utente?.ragione_sociale} misura={36} anello />
      </Pressable>
      {aperto ? <Menu chiudi={() => setAperto(false)} /> : null}
    </>
  );
}

const stili = StyleSheet.create({
  velo: { position: 'absolute', right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(28, 25, 23, 0.28)' },
  pannello: {
    position: 'absolute',
    overflow: 'hidden',
    paddingBottom: 6,
    borderRadius: 18,
    shadowColor: '#1c1917',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
  testata: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 14 },
  ragione: { fontFamily: FONT.titolo, fontSize: 16, lineHeight: 20 },
  sotto: { marginTop: 2, fontFamily: FONT.testo, fontSize: 13.5, lineHeight: 18 },
  linea: { height: 1, marginHorizontal: 14, backgroundColor: '#ece9e2' },
  voce: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14 },
  voceIcona: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  voceTesto: { flex: 1, minWidth: 0, fontFamily: FONT.testoMedio, fontSize: 15 },
  freccia: { color: '#a8a69b', fontSize: 20, lineHeight: 22 },
});
