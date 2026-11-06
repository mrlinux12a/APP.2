import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, SERVER } from '@/api';
import { CellaFiscale, RigaAn, SchedaAn } from '@/componenti/anagrafica';
import { AvvisiTelefono } from '@/componenti/AvvisiTelefono';
import { Avatar } from '@/componenti/Avatar';
import { CambioPassword } from '@/componenti/CambioPassword';
import { Campo } from '@/componenti/Campo';
import { informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import { Caricamento, Errore } from '@/componenti/Stato';
import { Avviso } from '@/componenti/ui';
import { useProfilo } from '@/dati';
import { useSessione } from '@/sessione';
import { FONT, useTema } from '@/tema';

// Un elenco puntato semplice ("Viene cancellato", "Resta, per obbligo di legge").
function Elenco({ voci }: { voci: string[] }) {
  const { c } = useTema();
  return (
    <View style={{ gap: 2 }}>
      {voci.map((v) => (
        <View key={v} style={stili.punto}>
          <Text style={[stili.elencoTesto, { color: c.testo }]}>•</Text>
          <Text style={[stili.elencoTesto, { color: c.testo, flex: 1 }]}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

// "La mia anagrafica" come sul sito (views/cliente/profilo.ejs): schede in sola lettura (nome, distributore, dati di fatturazione, contatti), l'accesso con il cambio della
// password, "Sul telefono" con gli avvisi, e in fondo l'eliminazione dell'account (richiesta da Google Play e dall'App Store per le app con registrazione). In più, solo
// nell'app, le informazioni (privacy, assistenza, versione). «Esci» non è qui: come sul sito sta nel menu del profilo (PulsanteAccount).
export default function Profilo() {
  const { c } = useTema();
  const { utente, eliminaAccount } = useSessione();
  const q = useProfilo();
  const [eliminando, setEliminando] = useState(false);
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  const conferma = async () => {
    if (!password) return setErrore('Scrivi la tua password per confermare.');
    setInCorso(true);
    setErrore(null);
    try {
      await eliminaAccount(password);
      // L'account non esiste più: la navigazione protetta riporta al login da sola.
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Eliminazione non riuscita: riprova.');
    } finally {
      setInCorso(false);
    }
  };

  const annullaEliminazione = () => {
    setEliminando(false);
    setPassword('');
    setErrore(null);
  };

  const u = q.data?.utente;
  const tipo = u?.tipo_testo || '';
  const referente = u?.referente || '';
  const cittaSede = u ? [u.cap, u.citta, u.provincia ? `(${u.provincia})` : ''].filter(Boolean).join(' ') : '';
  const assistenza = q.data?.assistenza || '';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
        {/* Il nome: il cerchio con le iniziali, la ragione sociale e "referente · tipo". */}
        <SchedaAn>
          <View style={stili.nome}>
            <Avatar nome={utente?.ragione_sociale} persona={referente} misura={56} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stili.ragione, { color: c.testo }]}>{utente?.ragione_sociale}</Text>
              {referente || tipo ? <Text style={[stili.sotto, { color: c.grigio }]}>{[referente, tipo].filter(Boolean).join(' · ')}</Text> : null}
            </View>
          </View>
        </SchedaAn>

        {q.isPending ? (
          <Caricamento />
        ) : q.isError ? (
          <Errore messaggio={q.error.message} riprova={() => q.refetch()} />
        ) : u ? (
          <>
            {u.stato_anagrafica === 'in_attesa' ? (
              <Avviso tipo="attenzione">Nessun distributore ti ha ancora approvato: puoi sfogliare il catalogo, ma non inviare richieste di disponibilità.</Avviso>
            ) : null}

            {q.data.distributore ? (
              <SchedaAn titolo="Distributore di riferimento">
                <RigaAn
                  icona="negozio"
                  blu
                  valore={q.data.distributore}
                  grande
                  dettaglio={q.data.codice_cliente ? `Codice cliente ${q.data.codice_cliente}` : undefined}
                />
              </SchedaAn>
            ) : null}

            <SchedaAn titolo="Dati di fatturazione">
              <RigaAn
                icona="azienda"
                etichetta="Ragione sociale"
                valore={u.ragione_sociale}
                dettaglio={[tipo, referente ? 'referente ' + referente : ''].filter(Boolean).join(' · ') || undefined}
              />
              {u.partita_iva || u.codice_fiscale || u.sdi_pec ? (
                <RigaAn
                  contenuto={
                    <View style={stili.fiscali}>
                      {u.partita_iva ? <CellaFiscale etichetta="Partita IVA" valore={u.partita_iva} /> : null}
                      {u.codice_fiscale ? <CellaFiscale etichetta="Codice fiscale" valore={u.codice_fiscale} /> : null}
                      {u.sdi_pec ? <CellaFiscale etichetta="Codice SDI / PEC" valore={u.sdi_pec} largo={u.sdi_pec.includes('@')} /> : null}
                    </View>
                  }
                />
              ) : null}
              {u.indirizzo || cittaSede ? <RigaAn icona="posizione" etichetta="Sede legale" valore={u.indirizzo || undefined} dettaglio={cittaSede || undefined} /> : null}
            </SchedaAn>

            {u.telefono || u.email ? (
              <SchedaAn titolo="Contatti">
                {u.telefono ? <RigaAn icona="telefono" etichetta="Telefono" valore={u.telefono} /> : null}
                {u.email ? <RigaAn icona="email" etichetta="Email" valore={u.email} /> : null}
              </SchedaAn>
            ) : null}
          </>
        ) : null}

        <SchedaAn titolo="Accesso">
          <RigaAn icona="persona" etichetta="Nome utente" valore={utente?.username} />
          <RigaAn icona="lucchetto" etichetta="Password" valore="••••••••••" spaziato />
          <View style={{ marginTop: 4 }}>
            <CambioPassword />
          </View>
        </SchedaAn>

        <AvvisiTelefono />

        <SchedaAn titolo="Informazioni">
          <RigaAn
            icona="scudo"
            etichetta="Informativa sulla privacy"
            valore="Quali dati usiamo e perché"
            alTocco={() => Linking.openURL(SERVER + '/privacy')}
            destra={<Icona nome="avanti" colore={c.grigio} dimensione={18} />}
          />
          {assistenza ? (
            <RigaAn
              icona="email"
              etichetta="Assistenza"
              valore={assistenza}
              alTocco={() => Linking.openURL('mailto:' + assistenza)}
              destra={<Icona nome="avanti" colore={c.grigio} dimensione={18} />}
            />
          ) : null}
          <RigaAn icona="info" etichetta="Versione dell’app" valore={Constants.expoConfig?.version || ''} />
        </SchedaAn>

        {/* Elimina account: chiusa è un avviso e un pulsante; aperta spiega cosa si cancella e cosa resta (come la pagina /profilo/elimina) e chiede la password. */}
        <SchedaAn titolo={eliminando ? 'Vuoi eliminare il tuo account?' : 'Elimina account'} pericolo>
          {eliminando ? (
            <View style={{ gap: 12 }}>
              <Text style={[stili.testo, { color: c.grigio }]}>
                L’account si disattiva subito e non si può più usare. Non si torna indietro: per tornare su Minuteria dovrai registrarti di nuovo.
              </Text>
              <View>
                <Text style={[stili.sottotitolo, { color: c.testo }]}>Viene cancellato</Text>
                <Elenco voci={['referente, email, telefono e PEC o codice SDI;', 'nome utente e password;', 'notifiche e telefoni collegati agli avvisi.']} />
              </View>
              <View>
                <Text style={[stili.sottotitolo, { color: c.testo }]}>Resta, per obbligo di legge</Text>
                <Elenco
                  voci={[
                    'ragione sociale, partita IVA, codice fiscale e indirizzo dell’impresa;',
                    'ordini, ricevute e pagamenti già emessi: fanno parte della contabilità tua e del distributore.',
                  ]}
                />
              </View>
              {errore ? <Avviso tipo="errore">{errore}</Avviso> : null}
              <Campo
                etichetta="Per confermare, scrivi la tua password"
                valore={password}
                cambia={setPassword}
                password
                errore={!!errore}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
              />
              <Pressable
                onPress={conferma}
                disabled={inCorso}
                accessibilityRole="button"
                style={({ pressed }) => [stili.eliminaBtn, { backgroundColor: pressed ? '#973030' : c.rosso, opacity: inCorso ? 0.6 : 1 }]}
              >
                <Text style={stili.eliminaBtnTesto}>{inCorso ? 'Elimino…' : 'Elimina il mio account'}</Text>
              </Pressable>
              <Pressable onPress={annullaEliminazione} disabled={inCorso} accessibilityRole="button" style={stili.annulla}>
                <Text style={[stili.annullaTesto, { color: c.grigio }]}>Annulla</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 0 }}>
              <Text style={[stili.testo, { color: c.grigio, marginBottom: 12 }]}>
                Se non vuoi più usare Minuteria puoi eliminare il tuo account. Ordini e ricevute già emessi restano per obbligo di legge.
              </Text>
              <Pressable
                onPress={() => {
                  if (!q.data) return informa('Elimina account', 'Attendi un istante e riprova.');
                  setEliminando(true);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [stili.elimina, { backgroundColor: pressed ? c.rossoChiaro : c.superficie }]}
              >
                <Text style={[stili.eliminaTesto, { color: c.rosso }]}>Elimina account…</Text>
              </Pressable>
            </View>
          )}
        </SchedaAn>

        <View style={stili.nota}>
          <View style={{ marginTop: 1 }}>
            <Icona nome="info" colore={c.accento} dimensione={18} />
          </View>
          <Text style={[stili.notaTesto, { color: c.grigio }]}>Per correggere i dati scrivi al tuo distributore o all’agente.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const stili = StyleSheet.create({
  // In fondo c'è la barra delle schede sospesa: circa 96px, come .app-anagrafica del sito.
  pagina: { padding: 14, gap: 12, paddingBottom: 96 },
  nome: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ragione: { fontFamily: FONT.titolo, fontSize: 18, lineHeight: 23 },
  sotto: { marginTop: 2, fontFamily: FONT.testo, fontSize: 14, lineHeight: 19 },
  fiscali: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 12 },
  testo: { fontFamily: FONT.testo, fontSize: 14.5, lineHeight: 21 },
  sottotitolo: { marginBottom: 6, fontFamily: FONT.testoForte, fontSize: 14 },
  punto: { flexDirection: 'row', gap: 8, paddingLeft: 6 },
  elencoTesto: { fontFamily: FONT.testo, fontSize: 14.5, lineHeight: 22 },
  elimina: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 1.5, borderColor: '#f0b9b6', borderRadius: 23 },
  eliminaTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  eliminaBtn: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderRadius: 26 },
  eliminaBtnTesto: { fontFamily: FONT.testoForte, fontSize: 16, color: '#ffffff' },
  annulla: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  annullaTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
  nota: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 4 },
  notaTesto: { flex: 1, fontFamily: FONT.testo, fontSize: 13.5, lineHeight: 20 },
});
