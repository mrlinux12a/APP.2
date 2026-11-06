import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErroreApi } from '@/api';
import { ErroriAcc, PulsanteAcc } from '@/componenti/acc';
import { Campo } from '@/componenti/Campo';
import { Icona } from '@/componenti/Icona';
import { SelettoreProfilo } from '@/componenti/SelettoreProfilo';
import { useSessione } from '@/sessione';
import { FONT, TEMI_ACCESSO, TemaAccessoProvider, useTema } from '@/tema';

const T = TEMI_ACCESSO.corriere;
type ErroreCampo = { testo: string; campi: string[] };

// Se il campo manca, il testo che il server userebbe (src/logica/account/corrieri.js): si controlla qui per non fare una chiamata a vuoto.
const MANCANTI: [string, string][] = [
  ['nome', 'Scrivi il tuo nome.'],
  ['cognome', 'Scrivi il tuo cognome.'],
  ['email', 'Scrivi la tua email.'],
  ['password', 'Scrivi una password.'],
];

// La registrazione del CORRIERE (solo nell'app, mai sul sito: docs/app-corrieri.md): una schermata sola, senza passi né barra di avanzamento. Bastano nome,
// cognome, email e una password (niente "Ripeti la password", telefono, partita IVA o nome utente: si entra con l'email). Il server fa i controlli veri
// (email valida e non già usata, password di almeno 8 caratteri) e dice quali campi sono sbagliati. Dopo la registrazione si entra subito.
export default function RegistratiCorriere() {
  const { c } = useTema();
  const { registraCorriere } = useSessione();
  const [dati, setDati] = useState<Record<string, string>>({});
  const [errori, setErrori] = useState<ErroreCampo[]>([]);
  const [invio, setInvio] = useState(false);

  const imposta = (k: string) => (v: string) => {
    setDati((d) => ({ ...d, [k]: v }));
    if (errori.length) setErrori((e) => e.filter((x) => !x.campi.includes(k)));
  };
  const sbagliato = (k: string) => errori.some((e) => e.campi.includes(k));
  const testoErrore = (k: string) => errori.find((e) => e.campi.includes(k))?.testo;

  // Indietro: alla schermata di prima; se non ce n'è una (si è arrivati con il selettore) all'accesso (che mostra quello dei corrieri: il profilo ricordato è il loro).
  const indietro = () => (router.canGoBack() ? router.back() : router.replace('/login'));

  const invia = async () => {
    const mancanti = MANCANTI.filter(([k]) => !(k === 'password' ? dati[k] || '' : (dati[k] || '').trim()));
    if (mancanti.length) return setErrori(mancanti.map(([k, testo]) => ({ testo, campi: [k] })));
    setInvio(true);
    setErrori([]);
    try {
      await registraCorriere({ nome: dati.nome.trim(), cognome: dati.cognome.trim(), email: dati.email.trim(), password: dati.password });
      // Entrato: la navigazione protetta porta da sola alla schermata del corriere.
    } catch (e) {
      if (e instanceof ErroreApi && Array.isArray(e.dati?.errori)) setErrori(e.dati.errori as ErroreCampo[]);
      else setErrori([{ testo: e instanceof ErroreApi ? e.message : 'Registrazione non riuscita: riprova.', campi: [] }]);
    } finally {
      setInvio(false);
    }
  };

  // Gli errori da elencare in alto, senza ripetizioni.
  const righeErrore = errori.map((e) => e.testo).filter((t, i, tutti) => tutti.indexOf(t) === i);

  return (
    <TemaAccessoProvider profilo="corriere">
      <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
            <SelettoreProfilo attivo="corriere" dove="registrazione" />

            {/* La testata: il cerchio bianco per tornare indietro e il titolo al centro (.reg-testata). */}
            <View style={stili.testata}>
              <Pressable onPress={indietro} accessibilityRole="button" accessibilityLabel="Indietro" style={stili.indietro}>
                <Icona nome="indietro" colore={T.testoAccento} dimensione={24} />
              </Pressable>
              <Text style={[stili.titoloPagina, { color: c.testo }]}>Registrati come corriere</Text>
              <View style={{ width: 44 }} />
            </View>

            {righeErrore.length ? <ErroriAcc titolo={righeErrore.length > 1 ? 'Controlla questi punti:' : undefined} righe={righeErrore} /> : null}

            <View style={stili.intestazione}>
              <Text style={[stili.titolo, { color: c.testo }]}>I tuoi dati</Text>
              <Text style={[stili.sotto, { color: c.grigio }]}>Bastano nome, cognome, email e una password.</Text>
            </View>

            <View style={{ gap: 18 }}>
              {/* Nome e Cognome affiancati. */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Campo etichetta="Nome" valore={dati.nome || ''} cambia={imposta('nome')} errore={sbagliato('nome')} aiuto={testoErrore('nome')} maxLength={100} autoComplete="name-given" textContentType="givenName" autoCapitalize="words" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Campo etichetta="Cognome" valore={dati.cognome || ''} cambia={imposta('cognome')} errore={sbagliato('cognome')} aiuto={testoErrore('cognome')} maxLength={100} autoComplete="name-family" textContentType="familyName" autoCapitalize="words" />
                </View>
              </View>
              <Campo
                etichetta="Email"
                valore={dati.email || ''}
                cambia={imposta('email')}
                errore={sbagliato('email')}
                aiuto={testoErrore('email')}
                placeholder="nome@esempio.it"
                maxLength={200}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="email"
                textContentType="emailAddress"
              />
              <Campo
                etichetta="Password"
                valore={dati.password || ''}
                cambia={imposta('password')}
                errore={sbagliato('password')}
                aiuto={testoErrore('password') || 'Almeno 8 caratteri.'}
                password
                maxLength={72}
                autoCapitalize="none"
                autoComplete="password-new"
                textContentType="newPassword"
              />
            </View>
          </ScrollView>

          {/* La fascia fissa in fondo (.reg-barra): il pulsante e il link a chi ha già un account. */}
          <View style={[stili.barra, { backgroundColor: c.sfondo }]}>
            <PulsanteAcc titolo="Crea l’account" onPress={invia} inCorso={invio} />
            <Text style={[stili.accedi, { color: c.grigio }]}>
              Hai già un account?{' '}
              <Text style={{ color: T.testoAccento, fontFamily: FONT.testoForte }} onPress={indietro} accessibilityRole="link">
                Accedi
              </Text>
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </TemaAccessoProvider>
  );
}

// Le stesse misure di `registrati.tsx`.
const stili = StyleSheet.create({
  pagina: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 24 },
  testata: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  indietro: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#232019',
    shadowOpacity: 0.16,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  titoloPagina: { fontFamily: FONT.titolo, fontSize: 16 },
  intestazione: { marginBottom: 18 },
  titolo: { fontFamily: FONT.titoloForte, fontSize: 24 },
  sotto: { marginTop: 6, fontFamily: FONT.testo, fontSize: 15, lineHeight: 21 },
  barra: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 10, borderTopWidth: 1, borderTopColor: 'rgba(35,32,25,0.08)' },
  accedi: { marginTop: 12, textAlign: 'center', fontFamily: FONT.testo, fontSize: 14 },
});
