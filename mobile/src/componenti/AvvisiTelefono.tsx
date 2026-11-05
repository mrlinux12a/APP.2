// "Avvisi sul telefono" nel profilo: un interruttore acceso/spento, come sul sito (views/cliente/profilo.ejs). Acceso = il telefono riceve le notifiche push anche con
// l'app chiusa; spento = il telefono esce dall'elenco del server. Il permesso di sistema si chiede una volta sola; se è stato negato per sempre, l'interruttore resta
// spento e il riquadro spiega come sbloccarlo dalle impostazioni. Dove le push non esistono (Expo Go, emulatore, browser) la riga non compare.
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useAvvisiTelefono } from '../notifiche';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';
import { Avviso, Bottone, Card, SezioneTitolo } from './ui';

export function AvvisiTelefono() {
  const { c } = useTema();
  const { utente } = useSessione();
  const { stato, occupato, messaggio, cambia, apriImpostazioni } = useAvvisiTelefono(utente ? utente.id : null);

  if (stato === 'non_supportati') return null;

  const bloccati = stato === 'bloccati';
  return (
    <>
      <SezioneTitolo>Notifiche</SezioneTitolo>
      <Card fitta>
        <View style={stili.riga}>
          <View style={[stili.icona, { backgroundColor: c.accentoChiaro }]}>
            <Icona nome="notifiche" colore={c.accento} dimensione={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[stili.valore, { color: c.testo }]}>Avvisi sul telefono</Text>
            <Text style={[stili.dettaglio, { color: c.grigio }]}>Ricevi un avviso quando un banco risponde alla tua richiesta.</Text>
          </View>
          <Switch
            value={stato === 'attivi'}
            onValueChange={cambia}
            disabled={stato === 'verifica' || bloccati || occupato}
            trackColor={{ false: c.bordo, true: c.accento }}
            thumbColor="#ffffff"
            accessibilityLabel="Avvisi sul telefono"
          />
        </View>
      </Card>
      {messaggio ? <Avviso tipo="attenzione">{messaggio}</Avviso> : null}
      {bloccati ? (
        <Card stile={{ gap: 10 }}>
          <Text style={[stili.valore, { color: c.testo }]}>Le notifiche sono bloccate sul telefono</Text>
          <Text style={[stili.dettaglio, { color: c.grigio }]}>
            Per riceverle apri le impostazioni dell’app, scegli «Notifiche» e consentile. Poi torna qui: gli avvisi si accendono da soli.
          </Text>
          <Bottone titolo="Apri le impostazioni" tipo="chiaro" onPress={apriImpostazioni} />
        </Card>
      ) : null}
    </>
  );
}

const stili = StyleSheet.create({
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  icona: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  valore: { fontFamily: FONT.testoForte, fontSize: 16 },
  dettaglio: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 20, marginTop: 2 },
});
