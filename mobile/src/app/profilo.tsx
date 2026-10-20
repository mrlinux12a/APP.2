import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi, SERVER } from '@/api';
import { Campo } from '@/componenti/Campo';
import { informa } from '@/componenti/dialoghi';
import { Caricamento, Errore } from '@/componenti/Stato';
import { Avviso, Bottone, Card, Nota, RigaInfo, SezioneTitolo } from '@/componenti/ui';
import { useProfilo } from '@/dati';
import { useSessione } from '@/sessione';
import { FONT, RAGGIO, useTema } from '@/tema';

function iniziali(nome: string) {
  const parole = nome.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((parole[0] || '?')[0] + (parole.length > 1 ? parole[1][0] : '')).toUpperCase();
}

// "La mia anagrafica" (sola lettura, come sul sito), le pagine di informazione e le due uscite: esci o elimina l'account (richiesto da Google Play per le
// app con registrazione).
export default function Profilo() {
  const { c } = useTema();
  const { utente, esci, eliminaAccount } = useSessione();
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

  const u = q.data?.utente;
  const indirizzo = u ? [u.indirizzo, [u.cap, u.citta, u.provincia ? `(${u.provincia})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const voci: { etichetta: string; dettaglio: string }[] = u
    ? ([
        u.tipo_testo ? { etichetta: u.tipo_testo, dettaglio: u.referente ? 'Referente: ' + u.referente : '' } : null,
        u.partita_iva ? { etichetta: 'Partita IVA', dettaglio: u.partita_iva } : null,
        u.codice_fiscale ? { etichetta: 'Codice fiscale', dettaglio: u.codice_fiscale } : null,
        indirizzo ? { etichetta: 'Sede', dettaglio: indirizzo } : null,
        u.sdi_pec ? { etichetta: 'Codice SDI / PEC', dettaglio: u.sdi_pec } : null,
        u.email ? { etichetta: 'Email', dettaglio: u.email } : null,
        u.telefono ? { etichetta: 'Telefono', dettaglio: u.telefono } : null,
        q.data?.distributore ? { etichetta: 'Distributore di riferimento', dettaglio: q.data.distributore } : null,
      ].filter(Boolean) as { etichetta: string; dettaglio: string }[])
    : [];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={stili.pagina} keyboardShouldPersistTaps="handled">
        <View style={[stili.testata, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
          <View style={[stili.avatar, { backgroundColor: c.accentoChiaro }]}>
            <Text style={[stili.avatarTesto, { color: c.accento }]}>{iniziali(utente?.ragione_sociale || '')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[stili.ragione, { color: c.testo }]}>{utente?.ragione_sociale}</Text>
            <Text style={[stili.meta, { color: c.grigio }]}>Cliente · {utente?.username}</Text>
          </View>
        </View>

        <SezioneTitolo>La mia anagrafica</SezioneTitolo>
        {q.isPending ? (
          <Caricamento />
        ) : q.isError ? (
          <Errore messaggio={q.error.message} riprova={() => q.refetch()} />
        ) : (
          <Card fitta>
            {voci.map((v, i) => (
              <RigaInfo key={v.etichetta} etichetta={v.etichetta} dettaglio={v.dettaglio} ultima={i === voci.length - 1} />
            ))}
          </Card>
        )}
        <Nota>Per correggere i tuoi dati scrivi all’assistenza{q.data?.assistenza ? ': ' + q.data.assistenza : ''}.</Nota>

        <SezioneTitolo>Informazioni</SezioneTitolo>
        <Card fitta>
          <Pressable onPress={() => Linking.openURL(SERVER + '/privacy')} accessibilityRole="link">
            <RigaInfo etichetta="Informativa sulla privacy" dettaglio="Quali dati usiamo e perché" />
          </Pressable>
          {q.data?.assistenza ? (
            <Pressable onPress={() => Linking.openURL('mailto:' + q.data!.assistenza)} accessibilityRole="link">
              <RigaInfo etichetta="Assistenza" dettaglio={q.data.assistenza} />
            </Pressable>
          ) : null}
          <RigaInfo etichetta="Versione dell’app" dettaglio={Constants.expoConfig?.version || ''} ultima />
        </Card>

        <Bottone
          titolo="Esci"
          tipo="chiaro"
          onPress={async () => {
            if (router.canGoBack()) router.back();
            await esci();
          }}
        />

        {eliminando ? (
          <Card stile={{ gap: 12, borderColor: c.rosso }}>
            <Text style={[stili.eliminaTitolo, { color: c.rosso }]}>Elimina l’account</Text>
            <Text style={[stili.eliminaTesto, { color: c.testo }]}>
              Non potrai più entrare. Vengono cancellati referente, email, telefono e le notifiche. Restano, per obbligo di legge, i dati dell’impresa e gli
              ordini e le ricevute già emessi.
            </Text>
            {errore ? <Avviso tipo="errore">{errore}</Avviso> : null}
            <Campo etichetta="La tua password" valore={password} cambia={setPassword} password autoCapitalize="none" autoComplete="current-password" textContentType="password" />
            <Bottone titolo="Elimina definitivamente" tipo="rosso" onPress={conferma} inCorso={inCorso} />
            <Bottone
              titolo="Annulla"
              tipo="chiaro"
              onPress={() => {
                setEliminando(false);
                setPassword('');
                setErrore(null);
              }}
              disabilitato={inCorso}
            />
          </Card>
        ) : (
          <Bottone
            titolo="Elimina account"
            tipo="discreto"
            onPress={() => {
              if (!q.data) return informa('Elimina account', 'Attendi un istante e riprova.');
              setEliminando(true);
            }}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 40 },
  testata: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: RAGGIO, padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarTesto: { fontFamily: FONT.titolo, fontSize: 18 },
  ragione: { fontFamily: FONT.titolo, fontSize: 18 },
  meta: { fontFamily: FONT.testo, fontSize: 14, marginTop: 2 },
  eliminaTitolo: { fontFamily: FONT.titolo, fontSize: 17 },
  eliminaTesto: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 20 },
});
