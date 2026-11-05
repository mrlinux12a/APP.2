// La scheda "Sul telefono" del profilo (views/cliente/profilo.ejs): "Avvisi sul telefono" con un interruttore acceso/spento. Acceso = il telefono riceve le notifiche push
// anche con l'app chiusa; spento = il telefono esce dall'elenco del server. Il permesso di sistema si chiede una volta sola; se è stato negato per sempre, l'interruttore
// resta spento e il riquadro giallo spiega come sbloccarlo dalle impostazioni. Dove le push non esistono (Expo Go, emulatore, browser) la scheda non compare.
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useAvvisiTelefono } from '../notifiche';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { RigaAn, SchedaAn } from './anagrafica';
import { Avviso, Bottone } from './ui';

export function AvvisiTelefono() {
  const { c } = useTema();
  const { utente } = useSessione();
  const { stato, occupato, messaggio, cambia, apriImpostazioni } = useAvvisiTelefono(utente ? utente.id : null);

  if (stato === 'non_supportati') return null;

  const bloccati = stato === 'bloccati';
  return (
    <>
      <SchedaAn titolo="Sul telefono">
        <RigaAn
          icona="notifiche"
          blu
          valore="Avvisi sul telefono"
          dettaglio="Ricevi un avviso quando un banco risponde alla tua richiesta."
          destra={
            <Switch
              value={stato === 'attivi'}
              onValueChange={cambia}
              disabled={stato === 'verifica' || bloccati || occupato}
              trackColor={{ false: '#d6d1c6', true: c.verde }}
              thumbColor="#ffffff"
              accessibilityLabel="Avvisi sul telefono"
            />
          }
        />
        {bloccati ? (
          <View style={stili.blocco}>
            <Text style={stili.bloccoTitolo}>Le notifiche sono bloccate sul telefono</Text>
            <Text style={stili.bloccoTesto}>Per riceverle apri le impostazioni dell’app, scegli «Notifiche» e consentile. Poi torna qui: gli avvisi si accendono da soli.</Text>
            <Bottone titolo="Apri le impostazioni" tipo="chiaro" onPress={apriImpostazioni} />
          </View>
        ) : null}
      </SchedaAn>
      {messaggio ? <Avviso tipo="attenzione">{messaggio}</Avviso> : null}
    </>
  );
}

// Il riquadro giallo di .an-blocco-notifiche: permesso negato dal telefono.
const stili = StyleSheet.create({
  blocco: { gap: 6, marginTop: 12, padding: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#fff4d6', borderWidth: 1, borderColor: '#e7c76a' },
  bloccoTitolo: { fontFamily: FONT.testoForte, fontSize: 14, lineHeight: 20, color: '#5a4300' },
  bloccoTesto: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 20, color: '#5a4300', marginBottom: 6 },
});
