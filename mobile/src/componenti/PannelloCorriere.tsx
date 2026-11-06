import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, SERVER } from '@/api';
import { AvvisoAcc, ErroriAcc, PannelloAcc, PulsanteAcc } from '@/componenti/acc';
import { Campo } from '@/componenti/Campo';
import { Icona } from '@/componenti/Icona';
import { useSessione } from '@/sessione';
import { FONT, TEMI_ACCESSO, TemaAccessoProvider, useTema } from '@/tema';

const T = TEMI_ACCESSO.corriere;
const EMAIL_PLAUSIBILE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// L'accesso del CORRIERE (solo nell'app, mai sul sito: docs/app-corrieri.md). Stessa struttura e stesse misure di `PannelloInstallatore`: cambiano i colori (giallo
// con testo scuro, vedi `TemaAccesso`) e i testi. Il corriere non ha un nome utente: entra con l'email. È l'altra metà della schermata `login.tsx`.
export function PannelloCorriere({ larghezza, attivo }: { larghezza: number; attivo: boolean }) {
  const { c } = useTema();
  const { entraCorriere } = useSessione();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  const accedi = async () => {
    if (!email.trim() || !password) return;
    setErrore(null);
    setAvviso(null);
    setInvio(true);
    try {
      // Uno spazio in più nell'email (autocorrezione) non deve far fallire l'accesso.
      await entraCorriere(email.trim(), password);
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Accesso non riuscito.');
    } finally {
      setInvio(false);
    }
  };

  // "Password dimenticata?" parte dall'app: il server manda all'email scritta qui il link per scegliere la nuova password (lo stesso recupero degli installatori).
  // La risposta è sempre la stessa, che l'email sia registrata o no.
  const dimenticata = async () => {
    setErrore(null);
    setAvviso(null);
    if (!EMAIL_PLAUSIBILE.test(email.trim())) {
      setErrore('Scrivi la tua email nel campo qui sotto, poi tocca “Password dimenticata?”.');
      return;
    }
    try {
      await chiamaApi('/corrieri/password-dimenticata', { metodo: 'POST', corpo: { email: email.trim() } });
      setAvviso('Se l’email è registrata, ti abbiamo mandato un link per scegliere una nuova password. Vale un’ora: poi torna qui e accedi.');
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Richiesta non riuscita: riprova.');
    }
  };

  return (
    <TemaAccessoProvider profilo="corriere">
      <PannelloAcc larghezza={larghezza} attivo={attivo}>
        <View>
          <View style={[stili.icona, { backgroundColor: T.accento, shadowColor: T.ombra.colore, shadowOpacity: T.ombra.opacita }]}>
            <Icona nome="furgone" colore={T.suAccento} dimensione={26} />
          </View>
          <Text style={[stili.occhiello, { color: T.testoAccento }]}>FLASH DELIVERY · CORRIERI</Text>
          <Text style={[stili.titolo, { color: c.testo }]}>Consegne in cantiere, quando sei libero.</Text>
          <Text style={[stili.sotto, { color: c.grigio }]}>Ricevi le consegne da fare: ritiri al banco e porti il materiale in cantiere.</Text>
        </View>

        {/* Accedi / Registrati: due metà in una pillola grigia, quella aperta in bianco. */}
        <View style={stili.schede} accessibilityRole="tablist">
          <View style={[stili.scheda, stili.schedaAttiva]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
            <Text style={[stili.schedaTesto, { color: c.testo }]}>Accedi</Text>
          </View>
          <Pressable onPress={() => router.push('/registrati-corriere')} accessibilityRole="tab" accessibilityState={{ selected: false }} style={stili.scheda}>
            <Text style={[stili.schedaTesto, { color: c.grigio }]}>Registrati</Text>
          </Pressable>
        </View>

        {errore ? <ErroriAcc righe={[errore]} /> : null}
        {avviso ? <AvvisoAcc testo={avviso} /> : null}

        <View style={{ gap: 18 }}>
          <Campo
            etichetta="Email"
            valore={email}
            cambia={setEmail}
            placeholder="nome@esempio.it"
            // La tastiera "email" non mette mai la maiuscola da sola, nemmeno sulle tastiere Samsung che ignorano `autoCapitalize`.
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="email"
            textContentType="emailAddress"
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

        <Pressable onPress={dimenticata} accessibilityRole="link" hitSlop={8} style={stili.dimenticata}>
          <Text style={[stili.dimenticataTesto, { color: T.testoAccento }]}>Password dimenticata?</Text>
        </Pressable>

        <PulsanteAcc titolo="Accedi" onPress={accedi} inCorso={invio} />

        <View style={stili.fondo}>
          <Text style={[stili.fondoTesto, { color: c.grigio }]}>
            <Text style={[stili.fondoLink, { color: T.testoAccento }]} onPress={() => Linking.openURL(SERVER + '/privacy')} accessibilityRole="link">
              Privacy
            </Text>
            {' · '}
            <Text style={[stili.fondoLink, { color: T.testoAccento }]} onPress={() => Linking.openURL(SERVER + '/elimina-account')} accessibilityRole="link">
              Elimina il tuo account
            </Text>
          </Text>
        </View>
      </PannelloAcc>
    </TemaAccessoProvider>
  );
}

// Le stesse misure di `PannelloInstallatore`.
const stili = StyleSheet.create({
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
  titolo: { marginTop: 6, marginBottom: 10, fontFamily: FONT.titoloForte, fontSize: 28, lineHeight: 32 },
  sotto: { marginBottom: 24, fontFamily: FONT.testo, fontSize: 15, lineHeight: 22 },
  schede: { flexDirection: 'row', gap: 4, marginBottom: 22, padding: 4, borderRadius: 14, backgroundColor: '#e6e2d9' },
  scheda: { flex: 1, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  schedaAttiva: { backgroundColor: '#ffffff', shadowColor: '#232019', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  schedaTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  dimenticata: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', marginTop: 4, marginBottom: 8 },
  dimenticataTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  fondo: { marginTop: 'auto', paddingTop: 28, alignItems: 'center' },
  fondoTesto: { fontFamily: FONT.testo, fontSize: 15, textAlign: 'center' },
  fondoLink: { fontFamily: FONT.testoForte },
});
