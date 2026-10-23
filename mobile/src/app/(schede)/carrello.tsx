import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { chiamaApi, ErroreApi, urlFoto } from '@/api';
import { carrello, useRigheCarrello, type RigaCarrello } from '@/carrello';
import { chiedi, informa } from '@/componenti/dialoghi';
import { stileRigaCard } from '@/componenti/rigaCard';
import { completaInvio, type RispostaInvio } from '@/pagamento';
import { useSessione } from '@/sessione';
import { Stepper } from '@/componenti/Stepper';
import { Vuoto } from '@/componenti/Stato';
import { Avviso, Bottone, Card, Forte, RigaInfo, RigaRiepilogo, SezioneTitolo } from '@/componenti/ui';
import { useRiepilogoCarrello } from '@/dati';
import { FONT, useTema } from '@/tema';

function Riga({ r, ultima, tolto }: { r: RigaCarrello; ultima: boolean; tolto: boolean }) {
  const { c } = useTema();
  const { quantita, ...dati } = r;
  return (
    <View style={[stili.riga, { borderBottomColor: c.bordo, borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth }]}>
      {r.foto_url ? (
        <Image source={urlFoto(r.foto_url)} style={[stili.foto, { backgroundColor: c.superficie }]} contentFit="contain" />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[stili.nome, { color: c.testo }]}>
          {r.nome}
          {r.etichetta ? <Text style={{ color: c.accento }}> {r.etichetta}</Text> : null}
        </Text>
        <Text style={[stili.meta, { color: c.grigio }]}>Cod. {r.codice}</Text>
        {tolto ? (
          <Text style={[stili.meta, { color: c.rosso }]}>Non più a catalogo: non verrà richiesto</Text>
        ) : (
          <Text style={[stili.prezzo, { color: c.accento }]}>
            € {r.prezzo} <Text style={[stili.meta, { color: c.grigio }]}>+ IVA cad.</Text>
          </Text>
        )}
      </View>
      {/* Come sul sito: nel carrello lo stepper si ferma a 1, per togliere c'è "Rimuovi". */}
      <View style={stili.azioni}>
        <Stepper valore={quantita} minimo={1} cambia={(n) => carrello.imposta(dati, n)} etichetta={r.nome} />
        <Pressable onPress={() => carrello.imposta(dati, 0)} hitSlop={6}>
          <Text style={[stili.rimuovi, { color: c.rosso }]}>Rimuovi</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Una stringa casuale per distinguere un invio dall'altro (lettere e cifre, tra 8 e 64 caratteri: lo chiede il server).
function nuovaChiave() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export default function Carrello() {
  const { c } = useTema();
  const { utente } = useSessione();
  const clientDati = useQueryClient();
  const righe = useRigheCarrello();
  const voci = useMemo(() => righe.map((r) => ({ id: r.id, quantita: r.quantita })), [righe]);
  const riepilogo = useRiepilogoCarrello(voci);
  const [invio, setInvio] = useState(false);
  const [destinazione, setDestinazione] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const pezzi = righe.reduce((n, r) => n + r.quantita, 0);
  const tolti = new Set(riepilogo.data?.non_piu_disponibili || []);

  // La destinazione parte dall'indirizzo di consegna abituale (una volta sola: poi resta quello
  // che l'installatore ha scritto).
  useEffect(() => {
    if (riepilogo.data && destinazione === null) setDestinazione(riepilogo.data.indirizzo_consegna);
  }, [riepilogo.data, destinazione]);

  const chiediSvuota = () =>
    chiedi('Svuotare il carrello?', 'Togli tutti i pezzi dal carrello.', 'Svuota', () => carrello.svuota(), true);

  // Richiesta partita: il carrello si svuota solo quando si lascia la scheda. Svuotarlo subito
  // mostrava "Il carrello è vuoto / Vai al catalogo" per tutto il tempo in cui si aspetta
  // "Stato ordini", cioè un attimo di catalogo prima dell'attesa delle risposte.
  const partita = useRef(false);
  // Chiave dell'invio di QUESTO carrello: il server fa partire una richiesta sola per chiave, quindi un doppio tocco o un
  // nuovo tentativo dopo una risposta persa non crea un secondo ordine. Si rinnova quando il carrello si svuota dopo
  // l'invio: per un ordine nuovo si riparte da un carrello nuovo.
  const chiaveInvio = useRef(nuovaChiave());
  // Il secondo tocco può arrivare prima che `invio` (stato) ridisegni il pulsante come disattivato.
  const inviando = useRef(false);
  useFocusEffect(
    useCallback(
      () => () => {
        if (!partita.current) return;
        partita.current = false;
        chiaveInvio.current = nuovaChiave();
        carrello.svuota();
      },
      []
    )
  );

  // "Paga e invia la richiesta": con la carta vera si apre il foglio di pagamento di Stripe (la carta viene solo BLOCCATA: si addebita la consegna solo
  // quando un banco conferma), poi la richiesta parte verso il banco e si passa a "Stato ordini", che mostra l'attesa. Con il pagamento di prova parte subito.
  // L'ordine nasce da solo quando il corriere prende la consegna: l'installatore non sceglie né conferma altro.
  const inviaRichiesta = async () => {
    if (inviando.current) return;
    inviando.current = true;
    setInvio(true);
    try {
      const risposta = await chiamaApi<RispostaInvio>('/richieste', {
        metodo: 'POST',
        corpo: { righe: carrello.voci(), destinazione: destinazione || '', note, chiave: chiaveInvio.current },
      });
      const idRichiesta = await completaInvio(risposta, utente?.ragione_sociale);
      // Foglio di pagamento chiuso senza pagare: non è partito niente, il carrello resta com'è.
      if (idRichiesta === null) return;
      partita.current = true;
      // 'all': anche se la scheda è già stata vista e non è in primo piano, così non mostra i dati vecchi.
      await clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' });
      router.navigate('/ordini');
    } catch (e) {
      informa('Richiesta non inviata', e instanceof ErroreApi ? e.message : 'Invio non riuscito, riprova.');
    } finally {
      inviando.current = false;
      setInvio(false);
    }
  };

  if (!righe.length) {
    return (
      <View style={{ flex: 1, backgroundColor: c.sfondo }}>
        <Vuoto icona="vuotoScatola" messaggio={'Il carrello è vuoto.\nAggiungi articoli dalle categorie o dalla ricerca.'} />
        <View style={{ padding: 14 }}>
          <Bottone titolo="Vai al catalogo" onPress={() => router.navigate('/')} />
        </View>
      </View>
    );
  }

  const r = riepilogo.data;
  const campo = [stili.campo, { color: c.testo, borderColor: c.bordo, backgroundColor: c.sfondo }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={righe}
        keyExtractor={(x) => String(x.id)}
        renderItem={({ item, index }) => (
          <View style={stileRigaCard(c, index, righe.length)}>
            <Riga r={item} ultima={index === righe.length - 1} tolto={tolti.has(item.id)} />
          </View>
        )}
        style={{ flex: 1, backgroundColor: c.sfondo }}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={stili.testata}>
            <Text style={[stili.sottotitolo, { color: c.grigio }]}>
              <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{pezzi} pezzi</Text> nel carrello — controlla le
              quantità prima di pagare.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={stili.piede}>
            <Bottone titolo="Svuota carrello" tipo="rosso" onPress={chiediSvuota} />
            {r ? (
              <>
                <SezioneTitolo>Cosa paghi e a chi</SezioneTitolo>
                <Card stile={{ backgroundColor: c.accentoChiaro, borderColor: c.accentoChiaro }}>
                  <Text style={[stili.cpEtichetta, { color: c.accento }]}>PAGHI ORA · CONSEGNA IN CANTIERE</Text>
                  <RigaRiepilogo voce="Corriere" valore={'€ ' + r.riepilogo.app_corriere} />
                  <RigaRiepilogo voce={`Servizio · ${r.riepilogo.servizio_pct}% della merce + IVA`} valore={'€ ' + r.riepilogo.app_servizio} />
                  <RigaRiepilogo voce="Totale da pagare ora · IVA inclusa" valore={'€ ' + r.riepilogo.app_totale} forte />
                </Card>
                <Card>
                  <Text style={[stili.cpEtichetta, { color: c.grigio }]}>
                    PAGHI DOPO {r.ditta ? 'A ' + r.ditta.toUpperCase() : 'AL BANCO'} · MATERIALE
                  </Text>
                  <RigaRiepilogo voce="Merce · prezzo del banco" valore={'€ ' + r.riepilogo.banco_merce} />
                  {r.riepilogo.con_raee ? <RigaRiepilogo voce="Contributo RAEE" valore={'€ ' + r.riepilogo.banco_raee} /> : null}
                  <RigaRiepilogo voce={`IVA ${r.riepilogo.iva_pct}%`} valore={'€ ' + r.riepilogo.banco_iva} />
                  <RigaRiepilogo voce="Totale materiale" valore={'€ ' + r.riepilogo.banco_totale} forte />
                </Card>
                <Text style={[stili.spesa, { color: c.grigio }]}>
                  Spesa complessiva <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>€ {r.riepilogo.spesa}</Text> · {r.riepilogo.articoli}
                </Text>
              </>
            ) : riepilogo.isError ? (
              <Text style={[stili.meta, { color: c.rosso }]}>{riepilogo.error.message}</Text>
            ) : (
              <Text style={[stili.meta, { color: c.grigio }]}>Calcolo i totali…</Text>
            )}
            {r && !r.raggiunto ? (
              <Avviso tipo="attenzione">
                <Forte>Ordine minimo € {r.minimo}</Forte> di merce, IVA e spedizione escluse. Ti mancano{' '}
                <Forte>€ {r.manca_al_minimo}</Forte>.
              </Avviso>
            ) : null}

            <SezioneTitolo>Consegna in cantiere</SezioneTitolo>
            <Card>
              <Text style={[stili.etichetta, { color: c.testo }]}>Destinazione della merce</Text>
              <TextInput
                value={destinazione || ''}
                onChangeText={setDestinazione}
                placeholder="Via, numero, CAP, città"
                placeholderTextColor={c.grigio}
                style={campo}
              />
            </Card>

            <SezioneTitolo>Nota (facoltativa)</SezioneTitolo>
            <Card>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Es. orario preferito, riferimento cantiere..."
                placeholderTextColor={c.grigio}
                multiline
                maxLength={500}
                style={[campo, { minHeight: 64, textAlignVertical: 'top' }]}
              />
            </Card>

            <SezioneTitolo>Pagamento</SezioneTitolo>
            <Card fitta>
              <RigaInfo
                etichetta={r ? `Paghi ora € ${r.da_pagare_ora}` : 'Paghi ora'}
                dettaglio={
                  r && r.pagamento_reale
                    ? `Il blocco è sulla carta: la consegna viene addebitata solo se ${r.ditta || 'il banco'} conferma. Se nessuno conferma, non paghi niente. Il materiale lo paghi dopo ${r.ditta ? 'a ' + r.ditta : 'al banco'}.`
                    : 'Pagamento di prova: non viene addebitato nulla. Il materiale lo paghi dopo al banco.'
                }
                ultima
              />
            </Card>

            <Bottone
              titolo={r ? `Paga € ${r.da_pagare_ora} e invia la richiesta` : 'Paga e invia la richiesta'}
              onPress={inviaRichiesta}
              disabilitato={!r || !r.raggiunto || riepilogo.isFetching || riepilogo.inAttesa}
              inCorso={invio}
            />
            {r ? (
              <Text style={[stili.notaCentro, { color: c.grigio }]}>
                {r.ditta || 'Il banco'} risponde entro {r.minuti_risposta} minuti. Appena un corriere prende la consegna ti arriva la
                conferma dell’ordine con il tempo stimato: non devi scegliere né confermare altro.
              </Text>
            ) : null}
            <Bottone titolo="Continua a scegliere" tipo="chiaro" onPress={() => router.navigate('/')} />
          </View>
        }
      />
    </KeyboardAvoidingView>
  );
}

const stili = StyleSheet.create({
  testata: { padding: 14, paddingBottom: 10 },
  sottotitolo: { fontFamily: FONT.testo, fontSize: 15, lineHeight: 20 },
  riga: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  foto: { width: 48, height: 48, borderRadius: 6 },
  nome: { fontFamily: FONT.nome, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: FONT.testo, fontSize: 13 },
  prezzo: { fontFamily: FONT.testoForte, fontSize: 15 },
  azioni: { alignItems: 'center', gap: 4 },
  rimuovi: { fontFamily: FONT.testoMedio, fontSize: 13 },
  piede: { padding: 14, gap: 12 },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15, marginBottom: 6 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo },
  cpEtichetta: { fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.4, marginBottom: 4 },
  spesa: { fontFamily: FONT.testo, fontSize: 14, textAlign: 'center' },
  notaCentro: { fontFamily: FONT.testo, fontSize: 13, textAlign: 'center', marginTop: -4 },
});
