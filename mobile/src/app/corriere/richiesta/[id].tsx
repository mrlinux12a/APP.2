import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi } from '@/api';
import { chiedi as chiediConferma, informa } from '@/componenti/dialoghi';
import { CODICI, codiceErrore, useAccetta, useDettaglioRichiesta } from '@/corriere/dati';
import { usePosizione } from '@/corriere/posizione';
import { COL, FC } from '@/corriere/tema';
import type { DettaglioRichiesta } from '@/corriere/tipi';
import { BarraIndietro, Caricamento, IconaTonda, Pagina, Piede, Pulsante, Scheda, StatoErrore, StatoVuoto, apriMappa, chiama, kmTesto, minutiTesto, tornaIndietro } from '@/corriere/ui';
import type { NomeIcona } from '@/icone';

// Una tappa del percorso: il cerchio con l'icona, la linea che la collega alla tappa dopo e il testo (titolo, righe, eventuali pulsanti).
function Tappa({ icona, titolo, righe, ultima, children }: { icona: NomeIcona; titolo: string; righe: ReactNode[]; ultima?: boolean; children?: ReactNode }) {
  return (
    <View style={stili.tappa}>
      <View style={stili.tappaColonna}>
        <IconaTonda nome={icona} misura={40} />
        {!ultima ? <View style={stili.tappaLinea} /> : null}
      </View>
      <View style={[stili.tappaTesto, !ultima && { paddingBottom: 22 }]}>
        <Text style={stili.tappaTitolo}>{titolo}</Text>
        {righe.map((riga, i) => (
          <Text key={i} style={stili.tappaRiga}>
            {riga}
          </Text>
        ))}
        {children}
      </View>
    </View>
  );
}

// «Dettaglio richiesta»: il tempo totale, il percorso (dove sei → il banco → il cantiere) e «Accetta richiesta». Il primo corriere che accetta vince: se nel frattempo la
// richiesta è stata presa o è scaduta lo dice e riporta alle richieste.
export default function DettaglioRichiestaSchermata() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const idNumerico = Number(id);
  const query = useDettaglioRichiesta(idNumerico);
  const accetta = useAccetta();
  const { permesso, chiedi, aggiorna, apriImpostazioni } = usePosizione();
  const [inLavoro, setInLavoro] = useState(false);
  const d = query.data;

  // Una richiesta già sua (accettata poco fa, magari con un doppio tocco) porta alla consegna in corso.
  const codice = codiceErrore(query.error);
  useEffect(() => {
    if (codice === CODICI.tua) router.dismissTo('/corriere/in-corso');
  }, [codice]);

  const permessoNegato = () =>
    permesso === 'bloccato'
      ? chiediConferma('Serve la posizione', 'Per accettare una richiesta devi consentire la posizione all’app. Puoi farlo dalle impostazioni del telefono.', 'Apri le impostazioni', apriImpostazioni)
      : informa('Serve la posizione', 'Per accettare una richiesta devi consentire la posizione all’app: serve a calcolare quanto manca al banco.');

  // «Accetta richiesta»: serve il permesso, poi UNA lettura fresca della posizione (il server ne ricava i minuti fino al banco) e infine l'accettazione.
  const accettaRichiesta = async () => {
    setInLavoro(true);
    try {
      let stato = permesso;
      if (stato !== 'concesso') stato = await chiedi();
      if (stato !== 'concesso') return permessoNegato();
      const posizione = await aggiorna({ fresca: true });
      if (!posizione) {
        return informa('Non trovo la tua posizione', 'Controlla che la posizione del telefono sia accesa, prova a spostarti all’aperto e riprova.');
      }
      await accetta.mutateAsync({ id: idNumerico, posizione });
      router.dismissTo('/corriere/in-corso');
    } catch (e) {
      const c = codiceErrore(e);
      if (c === CODICI.tua) return router.dismissTo('/corriere/in-corso');
      if (c === CODICI.giaAccettata || c === CODICI.scaduta) {
        informa(c === CODICI.giaAccettata ? 'Richiesta già presa' : 'Richiesta non più disponibile', (e as ErroreApi).message);
        return void query.refetch();
      }
      if (c === CODICI.nonDisponibile) return informa('Sei offline', 'Accendi «Sei disponibile» nella home per accettare le richieste.');
      informa('Non sono riuscito ad accettare', e instanceof ErroreApi ? e.message : 'Controlla la connessione e riprova.');
    } finally {
      setInLavoro(false);
    }
  };

  if (!Number.isFinite(idNumerico)) {
    return (
      <Pagina>
        <BarraIndietro titolo="Dettaglio richiesta" />
        <StatoErrore messaggio="Questa richiesta non esiste." />
      </Pagina>
    );
  }

  // Un 410 (già presa da un altro, scaduta) o un 404 valgono anche se la richiesta si era vista un attimo prima: i dati vecchi restano in cache dopo l'errore, ma
  // non si può più accettare.
  const statoErrore = query.error instanceof ErroreApi ? query.error.stato : 0;
  const nonPiuPrendibile = query.isError && (statoErrore === 410 || statoErrore === 404);

  if (!d || nonPiuPrendibile) {
    return (
      <Pagina>
        <BarraIndietro titolo="Dettaglio richiesta" />
        {query.isPending || codice === CODICI.tua ? (
          <Caricamento />
        ) : nonPiuPrendibile ? (
          <StatoVuoto
            icona="avviso"
            titolo={codice === CODICI.giaAccettata ? 'Richiesta già presa' : 'Richiesta non più disponibile'}
            testo={query.error instanceof ErroreApi ? query.error.message : undefined}
            azione={{ titolo: 'Torna alle richieste', onPress: tornaIndietro }}
          />
        ) : (
          <StatoErrore messaggio={query.error instanceof ErroreApi ? query.error.message : 'Non riesco a caricare la richiesta.'} riprova={() => query.refetch()} />
        )}
      </Pagina>
    );
  }

  return (
    <Pagina>
      <BarraIndietro titolo="Dettaglio richiesta" />
      <ScrollView contentContainerStyle={stili.contenuto}>
        <Riepilogo d={d} />

        <Scheda>
          <Tappa
            icona="mirino"
            titolo="La tua posizione"
            righe={[d.alla_sede ? `Fino al banco: ${minutiTesto(d.alla_sede.minuti)} · ${kmTesto(d.alla_sede.km)}` : 'Attiva la posizione per vedere quanto manca al banco.']}
          />
          <Tappa
            icona="negozio"
            titolo={d.banco.filiale ? `${d.banco.ditta} · ${d.banco.filiale}` : d.banco.ditta}
            righe={[d.banco.indirizzo, d.banco.orari ? <Text style={{ color: d.banco.orari.aperto ? COL.verde : COL.arancio, fontFamily: FC.semi }}>{d.banco.orari.testo}</Text> : '']}
          >
            {d.banco.telefono ? (
              <View style={stili.tappaAzione}>
                <Pulsante titolo="Chiama il banco" icona="telefono" tipo="chiaro" altezza={42} onPress={() => chiama(d.banco.telefono)} />
              </View>
            ) : null}
          </Tappa>
          <Tappa
            ultima
            icona="destinazione"
            titolo={d.cantiere.installatore || 'Cantiere'}
            righe={[
              d.cantiere.indirizzo,
              `Dal banco al cantiere: ${minutiTesto(d.al_cantiere.minuti)} · ${kmTesto(d.al_cantiere.km)}`,
              ...(d.cantiere.note ? [`Note: ${d.cantiere.note}`] : []),
            ]}
          />
        </Scheda>

        <Pulsante titolo="Apri il percorso in Maps" icona="esterno" tipo="chiaro" altezza={50} onPress={() => apriMappa(d.mappe.percorso)} />
      </ScrollView>

      <Piede sullaPagina>
        <Pulsante titolo="Accetta richiesta" icona="spunta" onPress={accettaRichiesta} inCorso={inLavoro || accetta.isPending} />
      </Piede>
    </Pagina>
  );
}

// La scheda in cima: quanto ci vuole in tutto e quanti km (dalla posizione del telefono, passando dal banco, fino al cantiere).
function Riepilogo({ d }: { d: DettaglioRichiesta }) {
  const conPosizione = d.tempo_totale_min !== null;
  return (
    <Scheda stile={stili.riepilogo}>
      <Text style={stili.mini}>{conPosizione ? 'TEMPO TOTALE STIMATO' : 'DAL BANCO AL CANTIERE'}</Text>
      <View style={stili.riepilogoRiga}>
        <Text style={stili.grande}>{minutiTesto(conPosizione ? d.tempo_totale_min : d.al_cantiere.minuti)}</Text>
        <Text style={stili.grandeKm}>{kmTesto(conPosizione ? d.km_totali : d.al_cantiere.km)}</Text>
      </View>
      <Text style={stili.riepilogoSotto}>
        {conPosizione ? 'Dalla tua posizione, passando dal banco, fino al cantiere.' : 'Attiva la posizione per vedere anche il tempo dalla tua posizione fino al banco.'}
      </Text>
    </Scheda>
  );
}

const stili = StyleSheet.create({
  contenuto: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 14 },
  riepilogo: { gap: 4, backgroundColor: COL.gialloChiaro, borderColor: COL.giallo },
  mini: { fontFamily: FC.forte, fontSize: 11, letterSpacing: 0.8, color: COL.gialloTesto },
  riepilogoRiga: { flexDirection: 'row', alignItems: 'baseline', gap: 14 },
  grande: { fontFamily: FC.extra, fontSize: 40, lineHeight: 48, color: COL.testo },
  grandeKm: { fontFamily: FC.forte, fontSize: 20, color: COL.testo },
  riepilogoSotto: { fontFamily: FC.medio, fontSize: 14, lineHeight: 20, color: COL.gialloTesto },
  tappa: { flexDirection: 'row', gap: 14 },
  tappaColonna: { alignItems: 'center' },
  tappaLinea: { flex: 1, width: 2, marginTop: 4, borderRadius: 1, backgroundColor: COL.bordo },
  tappaTesto: { flex: 1, gap: 2 },
  tappaTitolo: { fontFamily: FC.extra, fontSize: 17, lineHeight: 24, color: COL.testo, marginTop: 6 },
  tappaRiga: { fontFamily: FC.medio, fontSize: 14, lineHeight: 20, color: COL.grigio },
  tappaAzione: { marginTop: 8, alignSelf: 'flex-start', minWidth: 190 },
});
