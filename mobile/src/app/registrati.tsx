import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErroreApi, SERVER } from '@/api';
import { Campo } from '@/componenti/Campo';
import { Avviso, Bottone, Card, Forte } from '@/componenti/ui';
import { useSessione } from '@/sessione';
import { FONT, RAGGIO, useTema } from '@/tema';

// Registrazione dell'impresa: gli stessi dati e gli stessi tre passi del sito (views/registrati.ejs). Il server fa i controlli veri
// (anagrafiche.validaIscrizione) e dice quali campi sono sbagliati; qui si controlla solo che i campi obbligatori non siano vuoti prima di andare avanti.
// Dopo l'iscrizione si entra subito, e il distributore di riferimento è quello predefinito (BOREA): non si sceglie.
const CAMPI_PER_PASSO: string[][] = [
  ['tipo_soggetto', 'ragione_sociale', 'referente', 'email', 'telefono'],
  ['partita_iva', 'codice_fiscale', 'indirizzo', 'cap', 'citta', 'provincia', 'sdi_pec'],
  ['username', 'password', 'password2'],
];
const OBBLIGATORI = ['ragione_sociale', 'email', 'telefono', 'partita_iva', 'indirizzo', 'cap', 'citta', 'provincia', 'username', 'password', 'password2'];
const TITOLI = ['La tua impresa', 'Dati di fatturazione', 'Il tuo accesso'];

type ErroreCampo = { testo: string; campi: string[] };

export default function Registrati() {
  const { c } = useTema();
  const { registra } = useSessione();
  const [passo, setPasso] = useState(0);
  const [dati, setDati] = useState<Record<string, string>>({ tipo_soggetto: 'impresa', provincia: 'GE' });
  const [errori, setErrori] = useState<ErroreCampo[]>([]);
  const [invio, setInvio] = useState(false);
  const scorri = useRef<ScrollView>(null);

  const imposta = (k: string) => (v: string) => {
    setDati((d) => ({ ...d, [k]: v }));
    if (errori.length) setErrori((e) => e.filter((x) => !x.campi.includes(k)));
  };
  const sbagliato = (k: string) => errori.some((e) => e.campi.includes(k));
  const testoErrore = (k: string) => errori.find((e) => e.campi.includes(k))?.testo;

  // Mancano campi obbligatori nel passo?
  const mancanti = (p: number) => CAMPI_PER_PASSO[p].filter((k) => OBBLIGATORI.includes(k) && !(dati[k] || '').trim());
  const segnalaMancanti = (campi: string[]) =>
    setErrori(campi.map((k) => ({ testo: 'Campo obbligatorio.', campi: [k] })));

  const avanti = () => {
    const m = mancanti(passo);
    if (m.length) return segnalaMancanti(m);
    setErrori([]);
    setPasso(passo + 1);
    scorri.current?.scrollTo({ y: 0, animated: false });
  };

  const invia = async () => {
    for (let p = 0; p < 3; p++) {
      const m = mancanti(p);
      if (m.length) {
        setPasso(p);
        return segnalaMancanti(m);
      }
    }
    setInvio(true);
    setErrori([]);
    try {
      await registra(dati);
      // Entrato: la navigazione protetta porta da sola alle schede.
    } catch (e) {
      if (e instanceof ErroreApi && Array.isArray(e.dati?.errori)) {
        const lista = e.dati.errori as ErroreCampo[];
        setErrori(lista);
        // Si riapre il primo passo che ha un campo sbagliato.
        const primo = CAMPI_PER_PASSO.findIndex((campi) => campi.some((k) => lista.some((x) => x.campi.includes(k))));
        setPasso(primo === -1 ? 0 : primo);
        scorri.current?.scrollTo({ y: 0, animated: false });
      } else {
        setErrori([{ testo: e instanceof ErroreApi ? e.message : 'Registrazione non riuscita: riprova.', campi: [] }]);
      }
    } finally {
      setInvio(false);
    }
  };

  const tipi: [string, string][] = [
    ['impresa', 'Impresa'],
    ['ditta_individuale', 'Ditta individuale'],
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scorri} contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => (passo === 0 ? router.back() : setPasso(passo - 1))} hitSlop={10} accessibilityRole="button" style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text style={{ color: c.accento, fontFamily: FONT.testoForte, fontSize: 15 }}>‹ {passo === 0 ? 'Accedi' : 'Indietro'}</Text>
          </Pressable>
          <Text style={[stili.titolo, { color: c.testo }]}>Registra la tua impresa</Text>
          <Text style={[stili.passo, { color: c.grigio }]}>
            Passo {passo + 1} di 3 · {TITOLI[passo]}
          </Text>
          <View style={[stili.barra, { backgroundColor: c.bordo }]}>
            <View style={[stili.barraPiena, { backgroundColor: c.accento, width: `${((passo + 1) / 3) * 100}%` }]} />
          </View>

          {errori.length ? (
            <Avviso tipo="errore">
              {errori
                .filter((e, i, tutti) => tutti.findIndex((x) => x.testo === e.testo) === i)
                .map((e) => e.testo)
                .join('\n')}
            </Avviso>
          ) : null}

          <Card stile={{ gap: 14 }}>
            {passo === 0 ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={[stili.etichetta, { color: c.testo }]}>Sei</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {tipi.map(([valore, testo]) => {
                      const sel = dati.tipo_soggetto === valore;
                      return (
                        <Pressable
                          key={valore}
                          onPress={() => imposta('tipo_soggetto')(valore)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: sel }}
                          style={[stili.scelta, { borderColor: sel ? c.accento : c.bordo, backgroundColor: sel ? c.accentoChiaro : c.superficie }]}
                        >
                          <Text style={{ fontFamily: FONT.testoMedio, fontSize: 15, color: sel ? c.accento : c.testo }}>{testo}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <Campo etichetta="Ragione sociale" valore={dati.ragione_sociale || ''} cambia={imposta('ragione_sociale')} errore={sbagliato('ragione_sociale')} autoComplete="organization" textContentType="organizationName" />
                <Campo etichetta="Referente" valore={dati.referente || ''} cambia={imposta('referente')} facoltativo autoComplete="name" textContentType="name" />
                <Campo etichetta="Email" valore={dati.email || ''} cambia={imposta('email')} errore={sbagliato('email')} aiuto={testoErrore('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
                <Campo etichetta="Telefono" valore={dati.telefono || ''} cambia={imposta('telefono')} errore={sbagliato('telefono')} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
              </>
            ) : null}

            {passo === 1 ? (
              <>
                <Campo etichetta="Partita IVA" valore={dati.partita_iva || ''} cambia={imposta('partita_iva')} errore={sbagliato('partita_iva')} aiuto={testoErrore('partita_iva')} keyboardType="number-pad" maxLength={13} />
                <Campo etichetta="Codice fiscale" valore={dati.codice_fiscale || ''} cambia={imposta('codice_fiscale')} errore={sbagliato('codice_fiscale')} aiuto={testoErrore('codice_fiscale')} facoltativo autoCapitalize="characters" autoCorrect={false} maxLength={16} />
                <Campo etichetta="Indirizzo della sede" valore={dati.indirizzo || ''} cambia={imposta('indirizzo')} errore={sbagliato('indirizzo')} autoComplete="street-address" textContentType="fullStreetAddress" />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Campo etichetta="CAP" valore={dati.cap || ''} cambia={imposta('cap')} errore={sbagliato('cap')} aiuto={testoErrore('cap')} keyboardType="number-pad" maxLength={5} autoComplete="postal-code" />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Campo etichetta="Città" valore={dati.citta || ''} cambia={imposta('citta')} errore={sbagliato('citta')} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Campo etichetta="Prov." valore={dati.provincia || ''} cambia={imposta('provincia')} errore={sbagliato('provincia')} autoCapitalize="characters" maxLength={2} />
                  </View>
                </View>
                <Campo etichetta="Codice SDI o PEC" valore={dati.sdi_pec || ''} cambia={imposta('sdi_pec')} facoltativo autoCapitalize="none" autoCorrect={false} />
              </>
            ) : null}

            {passo === 2 ? (
              <>
                <Campo
                  etichetta="Nome utente"
                  valore={dati.username || ''}
                  cambia={imposta('username')}
                  errore={sbagliato('username')}
                  aiuto={testoErrore('username') || 'Tutto attaccato, senza spazi (es. rossimpianti).'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username-new"
                  textContentType="username"
                />
                <Campo etichetta="Password" valore={dati.password || ''} cambia={imposta('password')} errore={sbagliato('password')} aiuto={testoErrore('password') || 'Almeno 8 caratteri.'} password autoCapitalize="none" autoComplete="password-new" textContentType="newPassword" />
                <Campo etichetta="Ripeti la password" valore={dati.password2 || ''} cambia={imposta('password2')} errore={sbagliato('password2')} aiuto={testoErrore('password2')} password autoCapitalize="none" autoComplete="password-new" textContentType="newPassword" />
              </>
            ) : null}
          </Card>

          {passo < 2 ? (
            <Bottone titolo="Avanti" onPress={avanti} />
          ) : (
            <>
              <Bottone titolo="Crea l’account" onPress={invia} inCorso={invio} />
              <Text style={[stili.nota, { color: c.grigio }]}>
                Registrandoti accetti l’<Text style={{ color: c.accento }} onPress={() => Linking.openURL(SERVER + '/privacy')}><Forte>informativa sulla privacy</Forte></Text>.
              </Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 20, gap: 14, paddingBottom: 40 },
  titolo: { fontFamily: FONT.titoloForte, fontSize: 26 },
  passo: { fontFamily: FONT.testoMedio, fontSize: 14 },
  barra: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barraPiena: { height: 6, borderRadius: 3 },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15 },
  scelta: { flex: 1, borderWidth: 1, borderRadius: RAGGIO, paddingVertical: 12, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  nota: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
