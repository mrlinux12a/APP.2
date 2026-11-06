import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErroreApi } from '@/api';
import { chiedi as chiediConferma, informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import { useConsegnato, useInCorso, useRileggiTutto, useRitirato } from '@/corriere/dati';
import { COL, FC, RAGGIO } from '@/corriere/tema';
import type { ConsegnaInCorso } from '@/corriere/tipi';
import { Caricamento, Dato, IconaTonda, Pagina, Piede, Pulsante, PulsantiContatto, Scheda, StatoErrore, StatoVuoto, Titolo, kmTesto, minutiTesto } from '@/corriere/ui';

// I due passi della consegna: 1 Ritiro (dal banco), 2 Consegna (al cantiere). Quello fatto è verde con la spunta, quello attuale giallo.
function Passo({ numero, testo, stato }: { numero: number; testo: string; stato: 'fatto' | 'corrente' | 'da_fare' }) {
  return (
    <View style={stili.passo}>
      <View
        style={[
          stili.passoCerchio,
          stato === 'corrente' && { backgroundColor: COL.giallo, borderColor: COL.giallo },
          stato === 'fatto' && { backgroundColor: COL.verde, borderColor: COL.verde },
        ]}
      >
        {stato === 'fatto' ? <Icona nome="spunta" colore="#FFFFFF" dimensione={18} /> : <Text style={[stili.passoNumero, stato === 'da_fare' && { color: COL.grigio }]}>{numero}</Text>}
      </View>
      <Text style={[stili.passoTesto, stato === 'da_fare' && { color: COL.grigio }]}>{testo}</Text>
    </View>
  );
}

function Passi({ fase }: { fase: 1 | 2 }) {
  return (
    <View style={stili.passi} accessible accessibilityLabel={fase === 1 ? 'Passo 1 di 2: ritiro' : 'Passo 2 di 2: consegna'}>
      <Passo numero={1} testo="Ritiro" stato={fase === 1 ? 'corrente' : 'fatto'} />
      <View style={[stili.passiLinea, fase === 2 && { backgroundColor: COL.verde }]} />
      <Passo numero={2} testo="Consegna" stato={fase === 2 ? 'corrente' : 'da_fare'} />
    </View>
  );
}

// Chiude una frase con il punto, senza raddoppiarlo se il nome finisce già con uno («Rossi Impianti S.r.l.»).
const conPunto = (frase: string) => (frase.endsWith('.') ? frase : frase + '.');

// «Segnala un problema»: per ora non c'è un modulo nell'app (fuori dal primo lancio, docs/app-corrieri.md); si rimanda ai contatti.
function segnalaProblema() {
  informa('Segnala un problema', 'Per ora nell’app non c’è un modulo per le segnalazioni. Se non riesci a ritirare o a consegnare, chiama il banco o il cliente con i pulsanti della scheda.');
}

// La scheda «In corso»: quello che serve per la consegna che il corriere ha accettato, in due passi: «Vai al ritiro» (con il codice da mostrare al banco) e «Vai al
// cantiere». Ogni passo ha il suo pulsante, che chiede conferma prima di scrivere.
export default function InCorso() {
  const query = useInCorso();
  const ritirato = useRitirato();
  const consegnato = useConsegnato();
  const rileggi = useRileggiTutto();
  const dati = query.data;

  // Se la consegna sparisce senza che l'abbia chiusa il corriere, l'ha tolta il banco (ha eliminato l'ordine): si dice invece di mostrare la scheda vuota.
  // `ultima` è l'ultima consegna vista (si aggiorna mentre si disegna, il modo che React indica per ricavare uno stato da un dato); `chiusaDaMe` si accende prima di
  // mandare «Consegna confermata», così la scomparsa che ne segue non passa per un annullamento.
  const [ultima, setUltima] = useState<ConsegnaInCorso | null>(null);
  const [chiusaDaMe, setChiusaDaMe] = useState(false);
  if (dati?.consegna && dati.consegna !== ultima) setUltima(dati.consegna);
  const sparita = ultima && dati && !dati.consegna && !dati.in_preparazione && !chiusaDaMe ? ultima.codice : null;

  // Un errore dell'API: si dice com'è andata e, se il motivo è che qualcosa è cambiato (ordine sparito, già consegnato...), si rilegge tutto.
  const errore = (e: unknown) => {
    informa('Non è andata a buon fine', e instanceof ErroreApi ? e.message : 'Controlla la connessione e riprova.');
    if (e instanceof ErroreApi && (e.stato === 404 || e.stato === 409)) rileggi();
  };

  const confermaRitiro = (c: ConsegnaInCorso) =>
    chiediConferma(
      'Hai ritirato il materiale?',
      `Confermi di aver ritirato tutto il materiale dell’ordine ${c.codice}? Il banco e il cliente vengono avvisati.`,
      'Sì, ho ritirato',
      () => ritirato.mutate(c.ordine_id, { onError: errore })
    );

  const confermaConsegna = (c: ConsegnaInCorso) =>
    chiediConferma('Consegna confermata?', `Confermi di aver consegnato il materiale dell’ordine ${c.codice}? Dopo non si può annullare.`, 'Sì, consegnato', () => {
      setChiusaDaMe(true);
      consegnato.mutate(c.ordine_id, {
        onSuccess: (r) => router.replace({ pathname: '/corriere/completata/[id]', params: { id: String(r.riepilogo.ordine_id) } }),
        onError: (e) => {
          setChiusaDaMe(false);
          errore(e);
        },
      });
    });

  const testa = (
    <View style={stili.testa}>
      <Titolo>In corso</Titolo>
    </View>
  );

  if (!dati) {
    return (
      <Pagina>
        {testa}
        {query.isError ? (
          <StatoErrore messaggio={query.error instanceof ErroreApi ? query.error.message : 'Non riesco a caricare la consegna.'} riprova={() => query.refetch()} />
        ) : (
          <Caricamento />
        )}
      </Pagina>
    );
  }

  if (sparita) {
    return (
      <Pagina>
        {testa}
        <StatoVuoto
          icona="avviso"
          titolo="Questa consegna non c’è più"
          testo={`L’ordine ${sparita} non risulta più: il banco potrebbe averlo annullato. Non devi fare altro.`}
          azione={{
            titolo: 'Torna alle richieste',
            onPress: () => {
              setUltima(null);
              router.navigate('/corriere');
            },
          }}
        />
      </Pagina>
    );
  }

  if (dati.in_preparazione) {
    return (
      <Pagina>
        {testa}
        <View style={stili.attesa}>
          <ActivityIndicator color={COL.testo} size="large" />
          <Text style={stili.attesaTesto}>Sto preparando la tua consegna…</Text>
        </View>
      </Pagina>
    );
  }

  const c = dati.consegna;
  if (!c) {
    return (
      <Pagina>
        {testa}
        <StatoVuoto
          icona="furgone"
          titolo="Nessuna consegna in corso"
          testo="Quando accetti una richiesta la trovi qui, con tutto quello che serve per ritirare e consegnare."
          azione={{ titolo: 'Vai alle richieste', onPress: () => router.navigate('/corriere') }}
        />
      </Pagina>
    );
  }

  const ritiro = c.fase === 1;
  const ditta = c.banco.filiale ? `${c.banco.ditta} · ${c.banco.filiale}` : c.banco.ditta;

  return (
    <Pagina>
      {testa}
      <ScrollView contentContainerStyle={stili.contenuto}>
        <Passi fase={c.fase} />

        {ritiro ? (
          <>
            <View style={stili.fase}>
              <Text style={stili.faseTitolo}>Vai al ritiro</Text>
              <Text style={stili.faseSotto}>{conPunto(`Ritira il materiale da ${ditta}`)}</Text>
            </View>

            <Scheda stile={stili.codice}>
              <Text style={stili.mini}>CODICE ORDINE</Text>
              <Text style={stili.codiceGrande} accessibilityLabel={`Codice ordine ${c.ordine_id}`}>
                {c.codice}
              </Text>
              <Text style={stili.codiceSotto}>Mostralo al banco per ritirare il materiale.</Text>
            </Scheda>

            <Scheda stile={stili.luogo}>
              <View style={stili.luogoTesta}>
                <IconaTonda nome="negozio" misura={42} />
                <View style={{ flex: 1 }}>
                  <Text style={stili.luogoTitolo}>{ditta}</Text>
                  <Text style={stili.luogoSotto}>{c.banco.indirizzo}</Text>
                </View>
              </View>
              {c.banco.orari ? (
                <Text style={[stili.orari, { color: c.banco.orari.aperto ? COL.verde : COL.arancio }]}>{c.banco.orari.testo}</Text>
              ) : null}
              <PulsantiContatto telefono={c.banco.telefono} mappa={c.mappe.al_banco} />
            </Scheda>

            <Scheda stile={stili.tempi}>
              <Dato icona="timer" valore={minutiTesto(c.al_banco.minuti)} etichetta="al banco" />
              <Dato icona="mirino" valore={kmTesto(c.al_banco.km)} etichetta="percorso" />
              {c.arrivo_stimato ? <Dato icona="orario" valore={c.arrivo_stimato} etichetta="arrivo al cantiere" /> : null}
            </Scheda>
          </>
        ) : (
          <>
            <View style={stili.fase}>
              <Text style={stili.faseTitolo}>Vai al cantiere</Text>
              <Text style={stili.faseSotto}>{conPunto(`Consegna il materiale${c.cantiere.installatore ? ` a ${c.cantiere.installatore}` : ''}`)}</Text>
            </View>

            <Scheda stile={stili.luogo}>
              <View style={stili.luogoTesta}>
                <IconaTonda nome="destinazione" misura={42} />
                <View style={{ flex: 1 }}>
                  <Text style={stili.luogoTitolo}>{c.cantiere.installatore || 'Cantiere'}</Text>
                  <Text style={stili.luogoSotto}>{c.cantiere.indirizzo}</Text>
                </View>
              </View>
              {c.cantiere.note ? (
                <View style={stili.note}>
                  <Text style={stili.mini}>NOTE DEL CLIENTE</Text>
                  <Text style={stili.noteTesto}>{c.cantiere.note}</Text>
                </View>
              ) : null}
              <PulsantiContatto telefono={c.cantiere.telefono} mappa={c.mappe.al_cantiere} />
            </Scheda>

            <Scheda stile={stili.tempi}>
              <Dato icona="timer" valore={minutiTesto(c.al_cantiere.minuti)} etichetta="al cantiere" />
              <Dato icona="mirino" valore={kmTesto(c.al_cantiere.km)} etichetta="percorso" />
              {c.arrivo_stimato ? <Dato icona="orario" valore={c.arrivo_stimato} etichetta="arrivo stimato" /> : null}
            </Scheda>
            {c.ritirato_alle ? <Text style={stili.nota}>Materiale ritirato alle {c.ritirato_alle}.</Text> : null}
          </>
        )}

        <Pulsante titolo="Segnala un problema" tipo="testo" onPress={segnalaProblema} altezza={46} />
      </ScrollView>

      <Piede>
        {ritiro ? (
          <Pulsante titolo="Ho ritirato il materiale" icona="spunta" onPress={() => confermaRitiro(c)} inCorso={ritirato.isPending} />
        ) : (
          <Pulsante titolo="Consegna confermata" icona="spunta" onPress={() => confermaConsegna(c)} inCorso={consegnato.isPending} />
        )}
      </Piede>
    </Pagina>
  );
}

const stili = StyleSheet.create({
  contenuto: { paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  testa: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  passi: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  passoCerchio: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COL.bordo, backgroundColor: COL.scheda },
  passoNumero: { fontFamily: FC.extra, fontSize: 14, color: COL.testo },
  passoTesto: { fontFamily: FC.forte, fontSize: 15, color: COL.testo },
  passiLinea: { flex: 1, height: 3, borderRadius: 2, backgroundColor: COL.bordo },
  fase: { gap: 2, marginTop: 4 },
  faseTitolo: { fontFamily: FC.extra, fontSize: 24, lineHeight: 30, color: COL.testo },
  faseSotto: { fontFamily: FC.medio, fontSize: 15, lineHeight: 21, color: COL.grigio },
  codice: { alignItems: 'center', gap: 4, paddingVertical: 20, backgroundColor: COL.gialloChiaro, borderColor: COL.giallo, borderRadius: RAGGIO },
  mini: { fontFamily: FC.forte, fontSize: 11, letterSpacing: 0.8, color: COL.grigio },
  codiceGrande: { fontFamily: FC.extra, fontSize: 52, lineHeight: 60, letterSpacing: 1, color: COL.testo },
  codiceSotto: { fontFamily: FC.medio, fontSize: 14, color: COL.gialloTesto, textAlign: 'center' },
  luogo: { gap: 14 },
  luogoTesta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  luogoTitolo: { fontFamily: FC.extra, fontSize: 18, lineHeight: 24, color: COL.testo },
  luogoSotto: { fontFamily: FC.medio, fontSize: 14, lineHeight: 20, color: COL.grigio, marginTop: 1 },
  orari: { fontFamily: FC.semi, fontSize: 14, lineHeight: 20 },
  note: { gap: 3, padding: 12, borderRadius: 12, backgroundColor: COL.sfondo },
  noteTesto: { fontFamily: FC.medio, fontSize: 15, lineHeight: 21, color: COL.testo },
  tempi: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 26, rowGap: 14 },
  nota: { fontFamily: FC.medio, fontSize: 13, color: COL.grigio, textAlign: 'center' },
  attesa: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  attesaTesto: { fontFamily: FC.semi, fontSize: 16, color: COL.grigio, textAlign: 'center' },
});
