import * as Linking from 'expo-linking';
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
            Materiale termoidraulico dai distributori della tua zona: chiedi la disponibilità al banco, confronta
            tempi e prezzi, ordina.
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

            {/* La registrazione per ora resta sul sito: è un modulo lungo (dati fiscali,
                distributori di riferimento) che arriverà nell'app in un passo successivo. */}
            <Text style={[stili.nota, { color: c.grigio }]}>
              Non hai ancora un'anagrafica?{' '}
              <Text style={{ color: c.accento }} onPress={() => Linking.openURL(SERVER + '/registrati')}>
                Registra la tua impresa sul sito
              </Text>
              : i distributori che indichi dovranno confermare che sei loro cliente.
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
  bottone: { borderRadius: 999, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  bottoneTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
  nota: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 20, marginTop: 16 },
});
