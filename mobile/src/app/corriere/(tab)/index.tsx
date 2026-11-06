import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ErroreApi } from '@/api';
import { informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import { useElencoRichieste, useImpostaDisponibilita } from '@/corriere/dati';
import { usePosizione } from '@/corriere/posizione';
import { COL, FC } from '@/corriere/tema';
import type { SchedaRichiesta } from '@/corriere/tipi';
import { AvvisoScheda, Caricamento, Dato, Pagina, Pulsante, Scheda, StatoErrore, StatoVuoto, Titolo, kmTesto, minutiTesto, quandoFa } from '@/corriere/ui';

// Il campanello in alto: le notifiche arrivano sul telefono e non c'è un elenco da consultare (per ora), quindi spiega come funzionano.
function avvisiSpiegati() {
  informa('Avvisi sulle richieste', 'Quando arriva una nuova richiesta di consegna ti avvisiamo con una notifica sul telefono, se sei disponibile. Qui sotto trovi sempre quelle ancora da prendere.');
}

// La scheda di una richiesta da prendere: chi ritira, dove si consegna, quanto ci vuole in tutto e il pulsante per ispezionarla.
function CardRichiesta({ r }: { r: SchedaRichiesta }) {
  const apri = () => router.push({ pathname: '/corriere/richiesta/[id]', params: { id: String(r.id) } });
  return (
    <Scheda stile={stili.card}>
      <View style={stili.cardTesta}>
        <Text style={stili.ditta} numberOfLines={1}>
          {r.ritiro.ditta}
        </Text>
        <Text style={stili.quando}>{quandoFa(r.fa_secondi)}</Text>
      </View>
      <View style={stili.tratta}>
        <View style={stili.luogoBox}>
          <Text style={stili.mini}>RITIRO</Text>
          <Text style={stili.luogo} numberOfLines={2}>
            {r.ritiro.zona || r.ritiro.ditta}
          </Text>
        </View>
        <Icona nome="avanti" colore={COL.grigio} dimensione={20} />
        <View style={stili.luogoBox}>
          <Text style={stili.mini}>CONSEGNA</Text>
          <Text style={stili.luogo} numberOfLines={2}>
            {r.consegna.zona || 'Cantiere'}
          </Text>
        </View>
      </View>
      <View style={stili.dati}>
        <Dato icona="timer" valore={minutiTesto(r.tempo_totale_min)} etichetta="tempo totale" />
        <Dato icona="mirino" valore={kmTesto(r.km_totali)} etichetta="percorso" />
      </View>
      <Pulsante titolo="Ispeziona" onPress={apri} altezza={50} />
    </Scheda>
  );
}

// La home «Richieste»: l'interruttore «Sei disponibile» e le richieste ancora da prendere (le più vicine per prime).
export default function Richieste() {
  const { permesso, fallita, chiedi, aggiorna, apriImpostazioni } = usePosizione();
  const elenco = useElencoRichieste();
  const imposta = useImpostaDisponibilita();
  const [aggiornando, setAggiornando] = useState(false);

  // Quando si torna a questa scheda si rilegge la posizione se è vecchia, e poi ogni due minuti finché la si guarda: i tempi sulle schede seguono il corriere.
  useFocusEffect(
    useCallback(() => {
      aggiorna();
      const giro = setInterval(() => aggiorna(), 2 * 60 * 1000);
      return () => clearInterval(giro);
    }, [aggiorna])
  );

  const dati = elenco.data;

  // Per accettare serve la posizione: il permesso si chiede nel momento in cui il corriere si mette a disposizione.
  const cambiaDisponibilita = (acceso: boolean) => {
    imposta.mutate(acceso);
    if (acceso && (permesso === 'verifica' || permesso === 'da_chiedere')) chiedi();
  };

  // Tirando giù la lista si rileggono posizione e richieste.
  const ricarica = async () => {
    setAggiornando(true);
    try {
      await Promise.all([aggiorna({ fresca: true }), elenco.refetch()]);
    } finally {
      setAggiornando(false);
    }
  };

  const testa = (
    <View style={stili.testa}>
      <View style={{ flex: 1 }}>
        <Titolo>Richieste</Titolo>
      </View>
      <Pressable onPress={avvisiSpiegati} accessibilityRole="button" accessibilityLabel="Avvisi" hitSlop={6} style={stili.campanello}>
        <Icona nome="notifiche" colore={COL.testo} dimensione={22} />
      </Pressable>
    </View>
  );

  if (!dati) {
    return (
      <Pagina>
        {testa}
        {elenco.isError ? (
          <StatoErrore messaggio={elenco.error instanceof ErroreApi ? elenco.error.message : 'Non riesco a caricare le richieste.'} riprova={() => elenco.refetch()} />
        ) : (
          <Caricamento />
        )}
      </Pagina>
    );
  }

  const disponibile = dati.disponibile;
  const puoPrendere = disponibile && !dati.in_corso;

  return (
    <Pagina>
      <ScrollView
        contentContainerStyle={stili.contenuto}
        refreshControl={<RefreshControl refreshing={aggiornando} onRefresh={ricarica} tintColor={COL.testo} colors={[COL.giallo]} />}
      >
        {testa}

        <Scheda stile={stili.disponibilita}>
          <View style={[stili.stato, { backgroundColor: disponibile ? COL.verde : COL.interruttoreSpento }]} />
          <View style={{ flex: 1 }}>
            <Text style={stili.disponibileTitolo}>Sei disponibile</Text>
            <Text style={stili.disponibileTesto}>{disponibile ? 'Ricevi le richieste di consegna' : 'Sei offline: non ricevi richieste'}</Text>
          </View>
          <Switch
            value={disponibile}
            onValueChange={cambiaDisponibilita}
            disabled={imposta.isPending}
            trackColor={{ false: COL.interruttoreSpento, true: COL.verde }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={COL.interruttoreSpento}
            accessibilityLabel="Sei disponibile"
          />
        </Scheda>

        {imposta.isError ? <AvvisoScheda tono="errore" titolo="Non sono riuscito a cambiare lo stato" testo="Controlla la connessione e riprova." /> : null}

        {disponibile && permesso === 'da_chiedere' ? (
          <AvvisoScheda
            icona="posizione"
            titolo="Serve la tua posizione"
            testo="Serve per calcolare quanto manca al banco. Senza la posizione non puoi accettare le richieste."
            azione={{ titolo: 'Attiva la posizione', onPress: () => chiedi() }}
          />
        ) : null}
        {disponibile && permesso === 'bloccato' ? (
          <AvvisoScheda
            icona="posizione"
            titolo="La posizione è bloccata"
            testo="Senza la posizione non puoi accettare le richieste. Riattivala dalle impostazioni dell’app."
            azione={{ titolo: 'Apri le impostazioni', onPress: apriImpostazioni }}
          />
        ) : null}
        {disponibile && permesso === 'concesso' && fallita ? (
          <AvvisoScheda
            icona="posizione"
            titolo="Non trovo la tua posizione"
            testo="Controlla che la posizione del telefono sia accesa e prova a spostarti all’aperto."
            azione={{ titolo: 'Riprova', onPress: () => aggiorna({ fresca: true }) }}
          />
        ) : null}

        {!disponibile ? (
          <StatoVuoto icona="casco" titolo="Sei offline" testo="Accendi «Sei disponibile» per vedere le richieste di consegna e ricevere gli avvisi." />
        ) : dati.in_corso ? (
          <AvvisoScheda
            tono="info"
            icona="furgone"
            titolo="Hai una consegna in corso"
            testo="Portala a termine prima di accettare un’altra richiesta."
            azione={{ titolo: 'Vai alla consegna', onPress: () => router.navigate('/corriere/in-corso') }}
          />
        ) : null}

        {puoPrendere && dati.richieste.length === 0 ? (
          <StatoVuoto icona="vuotoScatola" titolo="Nessuna richiesta al momento" testo="Appena un banco ne conferma una, la trovi qui e ti avvisiamo con una notifica." />
        ) : null}
        {puoPrendere ? dati.richieste.map((r) => <CardRichiesta key={r.id} r={r} />) : null}
      </ScrollView>
    </Pagina>
  );
}

const stili = StyleSheet.create({
  contenuto: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },
  testa: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  campanello: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: COL.scheda, borderWidth: 1, borderColor: COL.bordo },
  disponibilita: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  stato: { width: 12, height: 12, borderRadius: 6 },
  disponibileTitolo: { fontFamily: FC.forte, fontSize: 17, color: COL.testo },
  disponibileTesto: { fontFamily: FC.medio, fontSize: 14, color: COL.grigio, marginTop: 1 },
  card: { gap: 14 },
  cardTesta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  ditta: { flex: 1, fontFamily: FC.extra, fontSize: 18, color: COL.testo },
  quando: { fontFamily: FC.semi, fontSize: 13, color: COL.grigio },
  tratta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  luogoBox: { flex: 1 },
  mini: { fontFamily: FC.forte, fontSize: 11, letterSpacing: 0.8, color: COL.grigio },
  luogo: { fontFamily: FC.forte, fontSize: 16, color: COL.testo, marginTop: 1 },
  dati: { flexDirection: 'row', gap: 28 },
});
