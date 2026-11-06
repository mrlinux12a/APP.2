import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, SERVER } from '@/api';
import { ErroriAcc, PannelloAcc, PulsanteAcc } from '@/componenti/acc';
import { Campo } from '@/componenti/Campo';
import { Icona } from '@/componenti/Icona';
import { useSessione } from '@/sessione';
import { FONT, useTema } from '@/tema';

// L'accesso dell'installatore (views/auth/login.ejs): la testata con l'icona e "Il pezzo che ti manca, in cantiere.", l'interruttore Accedi / Registrati, nome utente
// e password, il link per la password dimenticata, il pulsante e in fondo i link alla registrazione, alla privacy e all'eliminazione dell'account.
// È una delle due metà della schermata `login.tsx` (l'altra è `PannelloCorriere`).
export function PannelloInstallatore({ larghezza, attivo }: { larghezza: number; attivo: boolean }) {
  const { c } = useTema();
  const { entra } = useSessione();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  const accedi = async () => {
    if (!username.trim() || !password) return;
    setErrore(null);
    setInvio(true);
    try {
      // Come sul sito: uno spazio in più nel nome utente (autocorrezione) non fa fallire.
      await entra(username.trim(), password);
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Accesso non riuscito.');
    } finally {
      setInvio(false);
    }
  };

  return (
    <PannelloAcc larghezza={larghezza} attivo={attivo}>
      <View>
        <View style={[stili.icona, { backgroundColor: c.accento }]}>
          <Icona nome="ordini" colore={c.suAccento} dimensione={26} />
        </View>
        <Text style={[stili.occhiello, { color: c.accento }]}>Flash Delivery</Text>
        <Text style={[stili.titolo, { color: c.testo }]}>Il pezzo che ti manca, in cantiere.</Text>
        <Text style={[stili.sotto, { color: c.grigio }]}>Chiedi la disponibilità al banco e ricevi il materiale dove lavori.</Text>
      </View>

      {/* Accedi / Registrati: due metà in una pillola grigia, quella aperta in bianco. */}
      <View style={stili.schede} accessibilityRole="tablist">
        <View style={[stili.scheda, stili.schedaAttiva]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
          <Text style={[stili.schedaTesto, { color: c.testo }]}>Accedi</Text>
        </View>
        <Pressable onPress={() => router.push('/registrati')} accessibilityRole="tab" accessibilityState={{ selected: false }} style={stili.scheda}>
          <Text style={[stili.schedaTesto, { color: c.grigio }]}>Registrati</Text>
        </Pressable>
      </View>

      {errore ? <ErroriAcc righe={[errore]} /> : null}

      {/* Stessi campi della registrazione (`Campo`): la password ha l'occhio per mostrarla, e né il nome utente né la password partono con la maiuscola. */}
      <View style={{ gap: 18 }}>
        <Campo
          etichetta="Nome utente"
          valore={username}
          cambia={setUsername}
          placeholder="es. rossimpianti"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          // La tastiera "email" non mette mai la maiuscola da sola, nemmeno sulle tastiere Samsung che ignorano `autoCapitalize`.
          keyboardType="email-address"
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
        />
        <Campo
          etichetta="Password"
          valore={password}
          cambia={setPassword}
          password
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={accedi}
        />
      </View>

      {/* Il recupero della password è una pagina del sito (email con il link): qui si apre nel browser, come Privacy ed Elimina account. */}
      <Pressable onPress={() => Linking.openURL(SERVER + '/password-dimenticata')} accessibilityRole="link" hitSlop={8} style={stili.dimenticata}>
        <Text style={[stili.dimenticataTesto, { color: c.accento }]}>Password dimenticata?</Text>
      </Pressable>

      <PulsanteAcc titolo="Accedi" onPress={accedi} inCorso={invio} />

      <View style={stili.fondo}>
        <Text style={[stili.fondoTesto, { color: c.grigio }]}>
          <Text style={[stili.fondoLink, { color: c.accento }]} onPress={() => Linking.openURL(SERVER + '/privacy')} accessibilityRole="link">
            Privacy
          </Text>
          {' · '}
          <Text style={[stili.fondoLink, { color: c.accento }]} onPress={() => Linking.openURL(SERVER + '/elimina-account')} accessibilityRole="link">
            Elimina il tuo account
          </Text>
        </Text>
      </View>
    </PannelloAcc>
  );
}

const stili = StyleSheet.create({
  icona: {
    width: 52,
    height: 52,
    marginBottom: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#245a8f',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  occhiello: { fontFamily: FONT.titolo, fontSize: 13, letterSpacing: 1.3, textTransform: 'uppercase' },
  titolo: { marginTop: 6, marginBottom: 10, fontFamily: FONT.titoloForte, fontSize: 28, lineHeight: 32 },
  sotto: { marginBottom: 24, fontFamily: FONT.testo, fontSize: 15, lineHeight: 22 },
  schede: { flexDirection: 'row', gap: 4, marginBottom: 22, padding: 4, borderRadius: 14, backgroundColor: '#e6e2d9' },
  scheda: { flex: 1, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  schedaAttiva: { backgroundColor: '#ffffff', shadowColor: '#232019', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  schedaTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  dimenticata: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', marginTop: 4, marginBottom: 8 },
  dimenticataTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  // In fondo allo schermo, come .acc-fondo del sito.
  fondo: { marginTop: 'auto', paddingTop: 28, alignItems: 'center' },
  fondoTesto: { fontFamily: FONT.testo, fontSize: 15, textAlign: 'center' },
  fondoLink: { fontFamily: FONT.testoForte },
});
