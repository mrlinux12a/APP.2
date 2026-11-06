import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { inizialiDi } from '@/componenti/Avatar';
import { chiedi as chiediConferma } from '@/componenti/dialoghi';
import { COL, FC } from '@/corriere/tema';
import { AvvisoScheda, Pagina, Pulsante, Scheda, Titolo } from '@/corriere/ui';
import { useAvvisiTelefono } from '@/notifiche';
import { useSessione } from '@/sessione';

// Il Profilo del corriere: chi è, l'interruttore degli avvisi sul telefono (le nuove richieste arrivano come notifica) e l'uscita. Cambio password, dati e storico
// compensi non ci sono ancora (fuori dal primo lancio, docs/app-corrieri.md).
export default function ProfiloCorriere() {
  const { utente, esci } = useSessione();
  const { stato, occupato, messaggio, cambia, apriImpostazioni } = useAvvisiTelefono(utente ? utente.id : null, 'corriere');

  const nome = [utente?.nome, utente?.cognome].filter((s) => s && s.trim()).join(' ').trim() || utente?.ragione_sociale?.trim() || 'Corriere';
  const sigla = inizialiDi(nome) || 'C';

  // Uscendo il server toglie il corriere dall'elenco dei disponibili: lo dice prima di farlo.
  const conferma = () =>
    chiediConferma('Vuoi uscire?', 'Uscendo non sei più disponibile e non ricevi richieste finché non rientri e riaccendi «Sei disponibile».', 'Esci', () => {
      esci();
    });

  return (
    <Pagina>
      <View style={stili.testa}>
        <Titolo>Profilo</Titolo>
      </View>
      <ScrollView contentContainerStyle={stili.contenuto}>
        <Scheda stile={stili.identita}>
          <View style={stili.avatar} accessible={false}>
            <Text style={stili.sigla}>{sigla}</Text>
          </View>
          <Text style={stili.nome}>{nome}</Text>
          {utente?.email ? <Text style={stili.email}>{utente.email}</Text> : null}
          <Text style={stili.ruolo}>CORRIERE</Text>
        </Scheda>

        {stato !== 'non_supportati' ? (
          <Scheda>
            <View style={stili.riga}>
              <View style={{ flex: 1 }}>
                <Text style={stili.rigaTitolo}>Avvisi sul telefono</Text>
                <Text style={stili.rigaSotto}>Ricevi una notifica quando arriva una nuova richiesta di consegna, anche con l’app chiusa.</Text>
              </View>
              <Switch
                value={stato === 'attivi'}
                onValueChange={cambia}
                disabled={stato === 'verifica' || stato === 'bloccati' || occupato}
                trackColor={{ false: COL.interruttoreSpento, true: COL.verde }}
                thumbColor="#FFFFFF"
                ios_backgroundColor={COL.interruttoreSpento}
                accessibilityLabel="Avvisi sul telefono"
              />
            </View>
          </Scheda>
        ) : null}
        {stato === 'bloccati' ? (
          <AvvisoScheda
            icona="notifiche"
            titolo="Le notifiche sono bloccate"
            testo="Per ricevere le nuove richieste apri le impostazioni dell’app, scegli «Notifiche» e consentile. Poi torna qui."
            azione={{ titolo: 'Apri le impostazioni', onPress: apriImpostazioni }}
          />
        ) : null}
        {messaggio ? <AvvisoScheda tono="errore" titolo={messaggio} /> : null}

        <Pulsante titolo="Esci" icona="esci" tipo="chiaro" onPress={conferma} />
      </ScrollView>
    </Pagina>
  );
}

const stili = StyleSheet.create({
  testa: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  contenuto: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },
  identita: { alignItems: 'center', gap: 4, paddingVertical: 24 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: COL.giallo, marginBottom: 8 },
  sigla: { fontFamily: FC.extra, fontSize: 30, color: COL.testo },
  nome: { fontFamily: FC.extra, fontSize: 22, lineHeight: 28, color: COL.testo, textAlign: 'center' },
  email: { fontFamily: FC.medio, fontSize: 15, color: COL.grigio, textAlign: 'center' },
  ruolo: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', fontFamily: FC.forte, fontSize: 11, letterSpacing: 0.8, color: COL.gialloTesto, backgroundColor: COL.gialloChiaro },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rigaTitolo: { fontFamily: FC.forte, fontSize: 16, color: COL.testo },
  rigaSotto: { fontFamily: FC.medio, fontSize: 13, lineHeight: 19, color: COL.grigio, marginTop: 2 },
});
