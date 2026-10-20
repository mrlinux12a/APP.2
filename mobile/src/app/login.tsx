import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErroreApi, SERVER } from '@/api';
import { useSessione } from '@/sessione';
import { FONT, RAGGIO, useTema } from '@/tema';

export default function Login() {
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

  const campo = [stili.campo, { color: c.testo, borderColor: c.bordo, backgroundColor: c.sfondo }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
          <Text style={[stili.marchio, { color: c.accento }]}>Ordini Minuteria</Text>
          <Text style={[stili.sottotitolo, { color: c.grigio }]}>
            Il pezzo che ti manca, in cantiere. Chiedi la disponibilità al banco e ricevi il materiale dove lavori.
          </Text>

          <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
            {errore ? (
              <Text style={[stili.errore, { color: c.rosso, backgroundColor: c.rossoChiaro }]}>{errore}</Text>
            ) : null}

            <Text style={[stili.etichetta, { color: c.testo }]}>Utente</Text>
            <TextInput
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              style={campo}
            />

            <Text style={[stili.etichetta, { color: c.testo }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={accedi}
              style={campo}
            />

            {/* Il recupero della password è una pagina del sito (email con il link): qui si apre nel browser, come Privacy ed Elimina account. */}
            <Pressable
              onPress={() => Linking.openURL(SERVER + '/password-dimenticata')}
              accessibilityRole="link"
              hitSlop={10}
              style={stili.linkDimenticata}
            >
              <Text style={[stili.link, { color: c.accento }]}>Password dimenticata?</Text>
            </Pressable>

            <Pressable
              onPress={accedi}
              disabled={invio}
              style={[stili.bottone, { backgroundColor: c.accento, opacity: invio ? 0.7 : 1 }]}
            >
              {invio ? (
                <ActivityIndicator color={c.suAccento} />
              ) : (
                <Text style={[stili.bottoneTesto, { color: c.suAccento }]}>Accedi</Text>
              )}
            </Pressable>

            <Text style={[stili.nota, { color: c.grigio }]}>Non hai ancora un account?</Text>
            <Pressable
              onPress={() => router.push('/registrati')}
              accessibilityRole="button"
              style={[stili.bottoneChiaro, { borderColor: c.bordo, backgroundColor: c.superficie }]}
            >
              <Text style={[stili.bottoneTesto, { color: c.accento }]}>Registra la tua impresa</Text>
            </Pressable>
            <Text style={[stili.nota, { color: c.grigio, textAlign: 'center' }]}>
              <Text onPress={() => Linking.openURL(SERVER + '/privacy')}>Privacy</Text>
              {' · '}
              <Text onPress={() => Linking.openURL(SERVER + '/elimina-account')}>Elimina il tuo account</Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const stili = StyleSheet.create({
  pagina: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 12 },
  marchio: { fontFamily: FONT.titoloForte, fontSize: 30 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 16, lineHeight: 22, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: RAGGIO, padding: 16 },
  errore: { fontFamily: FONT.testoMedio, fontSize: 14, padding: 10, borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15, marginTop: 10, marginBottom: 6 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo },
  linkDimenticata: { alignSelf: 'flex-end', marginTop: 12, minHeight: 28, justifyContent: 'center' },
  link: { fontFamily: FONT.testoForte, fontSize: 14 },
  bottone: { borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  bottoneTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
  nota: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 20, marginTop: 16 },
  bottoneChiaro: { borderWidth: 1, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 10, minHeight: 50, justifyContent: 'center' },
});
