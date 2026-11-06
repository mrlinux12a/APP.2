import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErroreApi, SERVER } from '@/api';
import { ErroriAcc, PulsanteAcc } from '@/componenti/acc';
import { Campo } from '@/componenti/Campo';
import { Icona } from '@/componenti/Icona';
import { SelettoreProfilo } from '@/componenti/SelettoreProfilo';
import { useSessione } from '@/sessione';
import { FONT, useTema } from '@/tema';

// Registrazione dell'impresa: gli stessi dati e gli stessi tre passi del sito (views/auth/registrati.ejs). Il server fa i controlli veri
// (anagrafiche.validaIscrizione) e dice quali campi sono sbagliati; qui si controlla solo che i campi obbligatori non siano vuoti prima di andare avanti.
// Dopo l'iscrizione si entra subito, e il distributore di riferimento è quello predefinito (BOREA): non si sceglie.
const CAMPI_PER_PASSO: string[][] = [
  ['tipo_soggetto', 'ragione_sociale', 'referente', 'email', 'telefono'],
  ['partita_iva', 'codice_fiscale', 'indirizzo', 'cap', 'citta', 'provincia', 'sdi_pec'],
  ['username', 'password', 'password2'],
];
const OBBLIGATORI = ['ragione_sociale', 'email', 'telefono', 'partita_iva', 'indirizzo', 'cap', 'citta', 'provincia', 'username', 'password', 'password2'];
const TITOLI = ['La tua impresa', 'Dati di fatturazione', 'Accesso'];

type ErroreCampo = { testo: string; campi: string[] };

export default function Registrati() {
  const { c } = useTema();
  const { registra } = useSessione();
  const [passo, setPasso] = useState(0);
  const [dati, setDati] = useState<Record<string, string>>({ tipo_soggetto: 'impresa', provincia: 'GE' });
  const [errori, setErrori] = useState<ErroreCampo[]>([]);
  const [invio, setInvio] = useState(false);
  // Da React Native 0.87 il riferimento a uno ScrollView è di tipo `ScrollViewInstance` (non più `ScrollView`).
  const scorri = useRef<ScrollViewInstance>(null);

  const imposta = (k: string) => (v: string) => {
    setDati((d) => ({ ...d, [k]: v }));
    if (errori.length) setErrori((e) => e.filter((x) => !x.campi.includes(k)));
  };
  const sbagliato = (k: string) => errori.some((e) => e.campi.includes(k));
  const testoErrore = (k: string) => errori.find((e) => e.campi.includes(k))?.testo;

  // Mancano campi obbligatori nel passo?
  const mancanti = (p: number) => CAMPI_PER_PASSO[p].filter((k) => OBBLIGATORI.includes(k) && !(dati[k] || '').trim());
  const segnalaMancanti = (campi: string[]) => setErrori(campi.map((k) => ({ testo: 'Campo obbligatorio.', campi: [k] })));

  const avanti = () => {
    const m = mancanti(passo);
    if (m.length) return segnalaMancanti(m);
    setErrori([]);
    setPasso(passo + 1);
    scorri.current?.scrollTo({ y: 0, animated: false });
  };

  const indietro = () => {
    if (passo === 0) return router.back();
    setPasso(passo - 1);
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

  // Gli errori da elencare in alto, senza ripetizioni.
  const righeErrore = errori.map((e) => e.testo).filter((t, i, tutti) => tutti.indexOf(t) === i);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.sfondo }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scorri} contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
          {/* Solo nell'app: "Installatore | Corriere" porta alla registrazione dell'uno o dell'altro. */}
          <SelettoreProfilo attivo="installatore" dove="registrazione" />
          {/* La testata: il cerchio bianco per tornare indietro e il titolo al centro (.reg-testata). */}
          <View style={stili.testata}>
            <Pressable onPress={indietro} accessibilityRole="button" accessibilityLabel="Indietro" style={stili.indietro}>
              <Icona nome="indietro" colore={c.accento} dimensione={24} />
            </Pressable>
            <Text style={[stili.titoloPagina, { color: c.testo }]}>Registra la tua impresa</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Tre tratti: quelli dei passi già aperti sono blu. */}
          <View style={stili.avanzamento} accessibilityLabel={`Passo ${passo + 1} di 3`}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[stili.tratto, { backgroundColor: i <= passo ? c.accento : '#d6d1c6' }]} />
            ))}
          </View>

          {righeErrore.length ? (
            <ErroriAcc titolo={righeErrore.length > 1 ? 'Controlla questi punti:' : undefined} righe={righeErrore} />
          ) : null}

          <View style={stili.passoTesta}>
            <Text style={[stili.passoTitolo, { color: c.testo }]}>{TITOLI[passo]}</Text>
            <Text style={[stili.passoNumero, { color: c.grigio }]}>Passo {passo + 1} di 3</Text>
          </View>

          <View style={{ gap: 18 }}>
            {passo === 0 ? (
              <>
                <View>
                  <Text style={[stili.etichetta, { color: c.testo }]}>Forma giuridica</Text>
                  <View style={stili.tipi}>
                    {tipi.map(([valore, testo]) => {
                      const sel = dati.tipo_soggetto === valore;
                      return (
                        <Pressable
                          key={valore}
                          onPress={() => imposta('tipo_soggetto')(valore)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: sel }}
                          style={[stili.tipo, { borderColor: sel ? c.accento : sbagliato('tipo_soggetto') ? c.rosso : '#d6d1c6', backgroundColor: sel ? c.accentoChiaro : '#ffffff' }]}
                        >
                          <View style={[stili.radio, { borderColor: sel ? c.accento : '#8a897e' }]}>{sel ? <View style={[stili.radioPunto, { backgroundColor: c.accento }]} /> : null}</View>
                          <Text style={[stili.tipoTesto, { color: sel ? c.accentoScuro : c.testo }]} numberOfLines={1}>
                            {testo}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <Campo etichetta="Ragione sociale" valore={dati.ragione_sociale || ''} cambia={imposta('ragione_sociale')} errore={sbagliato('ragione_sociale')} aiuto={testoErrore('ragione_sociale')} placeholder="es. Rossi Impianti S.r.l." maxLength={200} autoComplete="organization" textContentType="organizationName" />
                <Campo etichetta="Referente" valore={dati.referente || ''} cambia={imposta('referente')} errore={sbagliato('referente')} aiuto={testoErrore('referente')} facoltativo placeholder="Nome e cognome" maxLength={200} autoComplete="name" textContentType="name" />
                <Campo etichetta="Email" valore={dati.email || ''} cambia={imposta('email')} errore={sbagliato('email')} aiuto={testoErrore('email')} placeholder="nome@impresa.it" maxLength={200} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" />
                <Campo etichetta="Telefono" valore={dati.telefono || ''} cambia={imposta('telefono')} errore={sbagliato('telefono')} aiuto={testoErrore('telefono')} placeholder="es. 333 1234567" maxLength={200} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
              </>
            ) : null}

            {passo === 1 ? (
              <>
                <Campo etichetta="Partita IVA" valore={dati.partita_iva || ''} cambia={imposta('partita_iva')} errore={sbagliato('partita_iva')} aiuto={testoErrore('partita_iva')} placeholder="11 cifre" keyboardType="number-pad" maxLength={20} />
                <Campo
                  etichetta="Codice fiscale"
                  valore={dati.codice_fiscale || ''}
                  cambia={imposta('codice_fiscale')}
                  errore={sbagliato('codice_fiscale')}
                  aiuto={testoErrore('codice_fiscale') || 'Facoltativo, se diverso dalla Partita IVA'}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={20}
                />
                <Campo etichetta="Sede legale" valore={dati.indirizzo || ''} cambia={imposta('indirizzo')} errore={sbagliato('indirizzo')} aiuto={testoErrore('indirizzo')} placeholder="Via e numero civico" maxLength={200} autoComplete="street-address" textContentType="fullStreetAddress" />
                {/* CAP, Città e Prov. sulla stessa riga (.reg-riga-citta). */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ width: 96 }}>
                    <Campo etichetta="CAP" valore={dati.cap || ''} cambia={imposta('cap')} errore={sbagliato('cap')} aiuto={testoErrore('cap')} keyboardType="number-pad" maxLength={5} autoComplete="postal-code" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Campo etichetta="Città" valore={dati.citta || ''} cambia={imposta('citta')} errore={sbagliato('citta')} aiuto={testoErrore('citta')} maxLength={200} />
                  </View>
                  <View style={{ width: 72 }}>
                    <Campo etichetta="Prov." valore={dati.provincia || ''} cambia={imposta('provincia')} errore={sbagliato('provincia')} aiuto={testoErrore('provincia')} autoCapitalize="characters" maxLength={2} />
                  </View>
                </View>
                <Campo
                  etichetta="Codice SDI o PEC"
                  valore={dati.sdi_pec || ''}
                  cambia={imposta('sdi_pec')}
                  errore={sbagliato('sdi_pec')}
                  aiuto={testoErrore('sdi_pec') || 'Facoltativo: serve per la fattura elettronica'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={200}
                />
              </>
            ) : null}

            {passo === 2 ? (
              <>
                <Campo
                  etichetta="Nome utente"
                  valore={dati.username || ''}
                  cambia={imposta('username')}
                  errore={sbagliato('username')}
                  aiuto={testoErrore('username') || 'Tutto attaccato: lettere, numeri, punto o trattino.'}
                  placeholder="es. rossimpianti"
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  keyboardType="email-address"
                  autoComplete="username-new"
                  textContentType="username"
                />
                <Campo etichetta="Password" valore={dati.password || ''} cambia={imposta('password')} errore={sbagliato('password')} aiuto={testoErrore('password') || 'Almeno 8 caratteri.'} password maxLength={72} autoCapitalize="none" autoComplete="password-new" textContentType="newPassword" />
                <Campo etichetta="Ripeti la password" valore={dati.password2 || ''} cambia={imposta('password2')} errore={sbagliato('password2')} aiuto={testoErrore('password2')} password maxLength={72} autoCapitalize="none" autoComplete="password-new" textContentType="newPassword" />
                <View>
                  <Text style={[stili.nota, { color: c.grigio }]}>I dati fiscali servono per intestare le fatture.</Text>
                  <Text style={[stili.nota, { color: c.grigio, marginTop: 6 }]}>
                    Registrandoti accetti l’
                    <Text style={{ color: c.accento, fontFamily: FONT.testoForte }} onPress={() => Linking.openURL(SERVER + '/privacy')} accessibilityRole="link">
                      informativa sulla privacy
                    </Text>
                    .
                  </Text>
                </View>
              </>
            ) : null}
          </View>
        </ScrollView>

        {/* La fascia fissa in fondo (.reg-barra): il pulsante e il link a chi ha già un account. */}
        <View style={[stili.barra, { backgroundColor: c.sfondo }]}>
          <PulsanteAcc titolo={passo < 2 ? 'Avanti' : 'Crea l’anagrafica'} onPress={passo < 2 ? avanti : invia} inCorso={invio} />
          <Text style={[stili.accedi, { color: c.grigio }]}>
            Hai già un account?{' '}
            <Text style={{ color: c.accento, fontFamily: FONT.testoForte }} onPress={() => router.back()} accessibilityRole="link">
              Accedi
            </Text>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

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
  avanzamento: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  tratto: { flex: 1, height: 5, borderRadius: 3 },
  passoTesta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  passoTitolo: { flexShrink: 1, fontFamily: FONT.titoloForte, fontSize: 24 },
  passoNumero: { fontFamily: FONT.testo, fontSize: 13 },
  etichetta: { marginBottom: 6, fontFamily: FONT.testoForte, fontSize: 14 },
  tipi: { flexDirection: 'row', gap: 10 },
  tipo: { flex: 1, minWidth: 0, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 8, borderWidth: 1.5, borderRadius: 14 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioPunto: { width: 8, height: 8, borderRadius: 4 },
  tipoTesto: { flexShrink: 1, fontFamily: FONT.testoForte, fontSize: 15 },
  nota: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 18 },
  barra: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 10, borderTopWidth: 1, borderTopColor: 'rgba(35,32,25,0.08)' },
  accedi: { marginTop: 12, textAlign: 'center', fontFamily: FONT.testo, fontSize: 14 },
});
