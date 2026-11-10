import { useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { chiamaApi, ErroreApi, type UltimoOrdine } from '@/api';
import { carrello, euro, riordina, useRigheCarrello, type RigaCarrello } from '@/carrello';
import { FiguraVuota } from '@/componenti/att';
import { BarraRicerca } from '@/componenti/BarraRicerca';
import { chiedi, informa } from '@/componenti/dialoghi';
import { Icona } from '@/componenti/Icona';
import { NotaChiuso, RiquadroChiuso, StrisciaInChiusura } from '@/componenti/OrariBanco';
import { Stepper } from '@/componenti/Stepper';
import { Avviso, Forte } from '@/componenti/ui';
import { useOrari, useRiepilogoCarrello, useUltimoOrdine } from '@/dati';
import { completaInvio, type RispostaInvio } from '@/pagamento';
import { useSessione } from '@/sessione';
import { FONT, useTema } from '@/tema';

// Una riga del carrello (.carrello-articolo): nome, "€ x cad. · IVA esclusa · prezzo del banco", e in fondo cestino, stepper (si ferma a 1: per togliere c'è il cestino)
// e il totale della riga a prezzo del banco.
function Riga({ r, tolto }: { r: RigaCarrello; tolto: boolean }) {
  const { c } = useTema();
  const { quantita, ...dati } = r;
  return (
    <View style={[stili.articolo, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <Text style={[stili.artNome, { color: c.testo }]}>
        {r.nome}
        {r.etichetta ? <Text style={{ color: c.accento }}> {r.etichetta}</Text> : null}
      </Text>
      {tolto ? (
        <Text style={[stili.artPrezzo, { color: c.rosso }]}>Non più a catalogo: non verrà richiesto</Text>
      ) : (
        <Text style={[stili.artPrezzo, { color: c.grigio }]}>€ {r.prezzo} cad. · IVA esclusa · prezzo del banco</Text>
      )}
      <View style={stili.artAzioni}>
        <Pressable
          onPress={() => carrello.imposta(dati, 0)}
          accessibilityRole="button"
          accessibilityLabel={'Rimuovi dal carrello ' + r.nome}
          style={[stili.cestino, { backgroundColor: c.superficie, borderColor: c.bordo }]}
        >
          <Icona nome="cestino" colore={c.rosso} dimensione={22} />
        </Pressable>
        <Stepper valore={quantita} minimo={1} cambia={(n) => carrello.imposta(dati, n)} etichetta={r.nome} />
        <Text style={[stili.artTotale, { color: c.testo }]}>€ {euro(r.prezzo_valore * quantita)}</Text>
      </View>
    </View>
  );
}

// Una riga di "Cosa paghi e a chi": etichetta + nota piccola a sinistra, importo a destra.
function RigaCp({ et, sp, valore, colore }: { et: ReactNode; sp?: string; valore: string; colore: string }) {
  return (
    <View style={stili.cpRiga}>
      <Text style={[stili.cpDt, { color: colore }]}>
        <Text style={{ fontFamily: FONT.testoMedio }}>{et}</Text>
        {sp ? <Text style={stili.cpSp}> {sp}</Text> : null}
      </Text>
      <Text style={[stili.cpDd, { color: colore }]}>{valore}</Text>
    </View>
  );
}

// Il totale in fondo a un riquadro: la riga a sinistra e l'importo grande a destra.
function TotaleCp({ etichetta, nota, valore, colore, linea }: { etichetta: string; nota?: string; valore: string; colore: string; linea: string }) {
  return (
    <View style={[stili.cpTotale, { borderTopColor: linea }]}>
      <View style={{ flexShrink: 1 }}>
        <Text style={[stili.cpTotaleEt, { color: colore }]}>{etichetta}</Text>
        {nota ? <Text style={[stili.cpSp, { color: colore, opacity: 0.75 }]}>{nota}</Text> : null}
      </View>
      <Text style={[stili.cpTotaleValore, { color: colore }]}>{valore}</Text>
    </View>
  );
}

// L'indirizzo di consegna a campi separati (come sul sito, richiesta del 10/11/2026): indirizzo = la via, numero civico, interno (facoltativo), CAP, città. Parte
// vuoto; il mirino compila tutto TRANNE il numero civico. Il server (src/comune/indirizzo.js) ricontrolla e li compone in una riga.
type CampiIndirizzo = { indirizzo: string; civico: string; interno: string; cap: string; citta: string };
const INDIRIZZO_VUOTO: CampiIndirizzo = { indirizzo: '', civico: '', interno: '', cap: '', citta: '' };

// Gli spazi doppi e di bordo tolti, come fa il server.
const pulito = (t: string) => t.replace(/\s+/g, ' ').trim();

// Il primo campo da compilare (nell'ordine in cui si scrivono) con il suo nome per il messaggio, o null se c'è tutto. L'interno non serve; il CAP ha cinque cifre.
function primoMancante(c: CampiIndirizzo): { chiave: keyof CampiIndirizzo; nome: string } | null {
  if (!pulito(c.indirizzo)) return { chiave: 'indirizzo', nome: 'l’indirizzo' };
  if (!pulito(c.civico)) return { chiave: 'civico', nome: 'il numero civico' };
  if (!pulito(c.interno)) return { chiave: 'interno', nome: 'l’interno' };
  if (!/^\d{5}$/.test(pulito(c.cap))) return { chiave: 'cap', nome: 'il CAP (5 cifre)' };
  if (!pulito(c.citta)) return { chiave: 'citta', nome: 'la città' };
  return null;
}

// La scheda "Consegna in cantiere" a scheda chiusa: la via col civico e l'interno in evidenza ("Via Puggia 22 int. 3"), sotto CAP e città.
function viaCivico(c: CampiIndirizzo) {
  return [pulito(c.indirizzo), pulito(c.civico)].filter(Boolean).join(' ') + (pulito(c.interno) ? ' int. ' + pulito(c.interno) : '');
}
const capCittaDi = (c: CampiIndirizzo) => [pulito(c.cap), pulito(c.citta)].filter(Boolean).join(' ');

// Una stringa casuale per distinguere un invio dall'altro (lettere e cifre, tra 8 e 64 caratteri: lo chiede il server).
function nuovaChiave() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// Il carrello vuoto (views/cliente/carrello.ejs): la figura, il titolo, la ricerca (porta al catalogo con il testo scritto), "Sfoglia il catalogo" e, se c'è,
// l'ultimo ordine consegnato con "Rimetti nel carrello".
function CarrelloVuoto() {
  const { c } = useTema();
  const [testo, setTesto] = useState('');
  const ultimo = useUltimoOrdine(true);
  const [inCorso, setInCorso] = useState(false);
  const o: UltimoOrdine | null | undefined = ultimo.data?.ordine;

  const rimetti = async () => {
    if (!o) return;
    setInCorso(true);
    try {
      const { aggiunti, saltati } = await riordina(o.id);
      if (!aggiunti) informa('Riordina', 'Questi articoli non sono più disponibili.');
      else if (saltati) informa('Riordina', saltati === 1 ? '1 articolo non è più disponibile.' : `${saltati} articoli non sono più disponibili.`);
    } catch (e) {
      informa('Riordina', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setInCorso(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.sfondo }} contentContainerStyle={stili.vuoto} keyboardShouldPersistTaps="handled">
      <FiguraVuota icona="carrello" />

      <View style={{ alignItems: 'center' }}>
        <Text style={[stili.vuotoTitolo, { color: c.testo }]}>Il carrello è vuoto</Text>
        <Text style={[stili.vuotoSotto, { color: c.grigio }]}>Cerca il pezzo che ti manca o sfoglia le categorie.</Text>
      </View>

      <BarraRicerca
        home
        senzaFoto
        valore={testo}
        cambia={setTesto}
        segnaposto="Nome o misura: valv 3/4"
        alCerca={() => router.navigate(testo.trim() ? { pathname: '/', params: { q: testo.trim(), n: String(Date.now()) } } : '/')}
      />

      <Pressable
        onPress={() => router.navigate('/')}
        accessibilityRole="button"
        style={({ pressed }) => [stili.sfoglia, { backgroundColor: pressed ? c.accentoChiaro : c.superficie, borderColor: c.accento }]}
      >
        <Icona nome="catalogo" colore={c.accento} dimensione={22} />
        <Text style={[stili.sfogliaTesto, { color: c.accento }]}>Sfoglia il catalogo</Text>
      </Pressable>

      {o ? (
        <View style={[stili.uo, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
          <View style={stili.uoTesta}>
            <Text style={[stili.uoOcchiello, { color: c.grigio }]}>Il tuo ultimo ordine</Text>
            <Text style={[stili.uoData, { color: c.grigio }]}>{o.data}</Text>
          </View>
          <View style={{ gap: 8 }}>
            {o.righe.map((r, i) => (
              <View key={i} style={stili.uoRiga}>
                <Text style={[stili.uoQta, { backgroundColor: c.accentoChiaro }]}>{r.quantita}×</Text>
                <Text style={[stili.uoNome, { color: c.testo }]} numberOfLines={2}>
                  {r.nome}
                </Text>
              </View>
            ))}
          </View>
          {o.altri ? (
            <Text style={[stili.uoAltri, { color: c.grigio }]}>
              + {o.altri} {o.altri === 1 ? 'altro' : 'altri'}
            </Text>
          ) : null}
          <Pressable
            onPress={rimetti}
            disabled={inCorso}
            accessibilityRole="button"
            style={({ pressed }) => [stili.uoBtn, { borderColor: c.accento, backgroundColor: pressed ? c.accentoChiaro : c.superficie, opacity: inCorso ? 0.6 : 1 }]}
          >
            {inCorso ? <ActivityIndicator color={c.accento} /> : <Icona nome="riprova" colore={c.accento} dimensione={18} />}
            <Text style={[stili.uoBtnTesto, { color: c.accento }]}>Rimetti nel carrello</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default function Carrello() {
  const { c } = useTema();
  const { utente } = useSessione();
  const clientDati = useQueryClient();
  const righe = useRigheCarrello();
  const voci = useMemo(() => righe.map((r) => ({ id: r.id, quantita: r.quantita })), [righe]);
  const riepilogo = useRiepilogoCarrello(voci);
  // Gli orari del banco (richiesta del 22/10/2026): fuori orario il carrello si riempie e resta salvato ma la richiesta non parte. Se gli orari non si riescono a
  // leggere NON si blocca l'invio: l'ultima parola ce l'ha il server, che risponde "banco_chiuso" (vedi inviaRichiesta).
  const orari = useOrari(righe.length > 0);
  const bancoChiuso = orari.data ? !orari.data.aperto : false;
  const [invio, setInvio] = useState(false);
  // L'indirizzo di consegna a campi: parte VUOTO (come sul sito), lo scrive l'installatore o lo compila il mirino (tranne il civico).
  const [ind, setInd] = useState<CampiIndirizzo>(INDIRIZZO_VUOTO);
  // La scheda "Consegna in cantiere": chiusa (via e città + "Cambia") o aperta sui campi; parte aperta perché l'indirizzo è vuoto.
  const [modificaIndirizzo, setModificaIndirizzo] = useState(true);
  // Il messaggio sotto la scheda (posizione in cerca, permesso negato, cosa manca) e il mirino che gira mentre cerca.
  const [messaggio, setMessaggio] = useState('');
  const [cercando, setCercando] = useState(false);
  const [notaAperta, setNotaAperta] = useState(false);
  const [note, setNote] = useState('');
  const [altezzaBarra, setAltezzaBarra] = useState(110);
  const [tastiera, setTastiera] = useState(false);
  const tolti = new Set(riepilogo.data?.non_piu_disponibili || []);

  const cambiaCampo = (chiave: keyof CampiIndirizzo, valore: string) => {
    setInd((v) => ({ ...v, [chiave]: chiave === 'cap' ? valore.replace(/\D/g, '').slice(0, 5) : valore }));
    setMessaggio('');
  };

  // "Fatto": si richiude la scheda solo se i campi ci sono tutti (l'interno è facoltativo); altrimenti dice cosa manca.
  const conferma = () => {
    const m = primoMancante(ind);
    if (m) {
      setMessaggio('Manca ' + m.nome + ': compila tutti i campi per andare avanti.');
      return;
    }
    setMessaggio('');
    setModificaIndirizzo(false);
  };

  // Il mirino: legge la posizione del telefono SOLO al tocco (mai da sola), la trasforma in indirizzo sul server (GET /indirizzo) e compila indirizzo, CAP e città.
  // Il numero civico e l'interno restano vuoti: li scrive l'installatore (un civico preso dalla posizione poteva essere quello di un'altra casa).
  const usaPosizione = async () => {
    if (cercando) return;
    setCercando(true);
    setMessaggio('Cerco la tua posizione…');
    setModificaIndirizzo(true);
    let scadenza: ReturnType<typeof setTimeout> | undefined;
    try {
      const permesso = await Location.requestForegroundPermissionsAsync();
      if (!permesso.granted) {
        setMessaggio(
          permesso.canAskAgain
            ? 'Posizione non consentita. Tocca di nuovo il mirino per consentirla, oppure compila i campi.'
            : 'Posizione non consentita. Dalle impostazioni del telefono consenti la Posizione a Flash Delivery, poi riprova. Oppure compila i campi.'
        );
        return;
      }
      const p = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((fine) => {
          scadenza = setTimeout(() => fine(null), 15000);
        }),
      ]);
      if (!p) {
        setMessaggio('La posizione non arriva: prova all’aperto o compila i campi.');
        return;
      }
      const q = new URLSearchParams({ lat: String(p.coords.latitude), lng: String(p.coords.longitude), precisione: String(Math.round(p.coords.accuracy || 0)) });
      const r = await chiamaApi<{ ok: boolean; campi: { indirizzo: string; cap: string; citta: string } | null }>('/indirizzo?' + q.toString());
      if (!r.ok || !r.campi) {
        setMessaggio('Ho trovato la posizione ma non l’indirizzo: compila i campi.');
        return;
      }
      const campi = r.campi;
      setInd({ indirizzo: campi.indirizzo || '', civico: '', interno: '', cap: campi.cap || '', citta: campi.citta || '' });
      setMessaggio(
        (p.coords.accuracy || 0) > 30
          ? 'Posizione precisa solo a circa ' + Math.round(p.coords.accuracy || 0) + ' m: controlla la via e scrivi il numero civico.'
          : 'Scrivi il numero civico e l’interno per andare avanti.'
      );
    } catch {
      setMessaggio('Non riesco a leggere la posizione di questo telefono: compila i campi.');
    } finally {
      clearTimeout(scadenza);
      setCercando(false);
    }
  };

  // Con la tastiera aperta la barra di pagamento non deve coprire il campo che si sta scrivendo.
  useEffect(() => {
    const apre = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setTastiera(true));
    const chiude = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setTastiera(false));
    return () => {
      apre.remove();
      chiude.remove();
    };
  }, []);

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

  // "Paga e invia richiesta": con la carta vera si apre il foglio di pagamento di Stripe (la carta viene solo BLOCCATA: si addebita la consegna solo
  // quando un banco conferma), poi la richiesta parte verso il banco e si passa a "Stato ordini", che mostra l'attesa. Con il pagamento di prova parte subito.
  // L'ordine nasce da solo quando il corriere prende la consegna: l'installatore non sceglie né conferma altro.
  const inviaRichiesta = async () => {
    if (inviando.current) return;
    inviando.current = true;
    setInvio(true);
    try {
      const risposta = await chiamaApi<RispostaInvio>('/richieste', {
        metodo: 'POST',
        corpo: {
          righe: carrello.voci(),
          indirizzo: pulito(ind.indirizzo),
          civico: pulito(ind.civico),
          interno: pulito(ind.interno),
          cap: pulito(ind.cap),
          citta: pulito(ind.citta),
          note,
          chiave: chiaveInvio.current,
        },
      });
      const idRichiesta = await completaInvio(risposta, utente?.ragione_sociale);
      // Foglio di pagamento chiuso senza pagare: non è partito niente, il carrello resta com'è.
      if (idRichiesta === null) return;
      partita.current = true;
      // 'all': anche se la scheda è già stata vista e non è in primo piano, così non mostra i dati vecchi.
      await clientDati.invalidateQueries({ queryKey: ['stato-ordini'], refetchType: 'all' });
      router.navigate('/ordini');
    } catch (e) {
      // Il banco ha chiuso proprio mentre si compilava il carrello: si rileggono subito gli orari, così compare il riquadro "Ordini chiusi".
      if (e instanceof ErroreApi && e.dati?.codice === 'banco_chiuso') clientDati.invalidateQueries({ queryKey: ['orari'], refetchType: 'all' });
      informa(e instanceof ErroreApi && e.dati?.titolo ? String(e.dati.titolo) : 'Richiesta non inviata', e instanceof ErroreApi ? e.message : 'Invio non riuscito, riprova.');
    } finally {
      inviando.current = false;
      setInvio(false);
    }
  };

  if (!righe.length) return <CarrelloVuoto />;

  const r = riepilogo.data;
  // Scheda chiusa: la via col civico in evidenza, sotto CAP e città.
  const via = viaCivico(ind);
  const capCitta = capCittaDi(ind);
  const indirizzoCompleto = primoMancante(ind) === null;
  const nomeDitta = r?.ditta || '';
  const dopoA = nomeDitta ? 'a ' + nomeDitta : 'al banco';
  const campo = [stili.campo, { color: c.testo, borderColor: c.bordo, backgroundColor: c.sfondo }];
  // Non si paga finché l'indirizzo non è completo (indirizzo, civico, CAP, città: i campi del sito sono `required`).
  const puoPagare = !!r && r.raggiunto && !riepilogo.isFetching && !riepilogo.inAttesa && !bancoChiuso && indirizzoCompleto;
  const strisciaChiusura = !!orari.data && orari.data.aperto && !!orari.data.chiude && orari.data.chiude.in_chiusura;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.sfondo }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.sfondo }}
        contentContainerStyle={{ padding: 14, paddingBottom: tastiera ? 24 : altezzaBarra + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Fuori dagli orari del banco: il carrello si riempie e resta salvato, ma non si invia. */}
        {orari.data && !orari.data.aperto ? (
          <View style={{ marginBottom: 14 }}>
            <RiquadroChiuso orari={orari.data} />
          </View>
        ) : null}

        <View style={stili.testata}>
          <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" hitSlop={6} style={stili.aggiungi}>
            <Text style={[stili.aggiungiTesto, { color: c.accento }]}>+ Aggiungi pezzi</Text>
          </Pressable>
          <Pressable
            onPress={chiediSvuota}
            accessibilityRole="button"
            accessibilityLabel="Svuota carrello"
            hitSlop={6}
            style={[stili.svuota, { backgroundColor: c.superficie, borderColor: c.bordo }]}
          >
            <Icona nome="cestino" colore={c.testo} dimensione={16} />
            <Text style={[stili.svuotaTesto, { color: c.testo }]}>Svuota</Text>
          </Pressable>
        </View>

        {righe.map((x) => (
          <Riga key={x.id} r={x} tolto={tolti.has(x.id)} />
        ))}

        {/* Ordine minimo sulla merce a prezzo del banco (IVA, servizio e consegna esclusi). */}
        {r && !r.raggiunto ? (
          <View style={{ marginBottom: 12 }}>
            <Avviso tipo="attenzione">
              <Forte>Ordine minimo € {r.minimo}</Forte> di merce, IVA e spedizione escluse. Ti mancano <Forte>€ {r.manca_al_minimo}</Forte>.
            </Avviso>
          </View>
        ) : null}

        {/* Consegna: il campo è lo stesso di prima, si apre con "Cambia" (o subito, se l'indirizzo è vuoto). */}
        <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo, paddingVertical: 12 }]}>
          <View style={stili.consegnaRiga}>
            <View style={[stili.consegnaIco, { backgroundColor: c.accentoChiaro }]}>
              <Icona nome="posizione" colore={c.accento} dimensione={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stili.consegnaOcchiello, { color: c.grigio }]}>Consegna in cantiere</Text>
              {via ? <Text style={[stili.consegnaVia, { color: c.testo }]}>{via}</Text> : null}
              {capCitta ? <Text style={[stili.consegnaCitta, { color: c.grigio }]}>{capCitta}</Text> : null}
            </View>
            <Pressable
              onPress={() => (modificaIndirizzo ? conferma() : setModificaIndirizzo(true))}
              accessibilityRole="button"
              hitSlop={6}
              style={stili.cambia}
            >
              <Text style={[stili.cambiaTesto, { color: c.accento }]}>{modificaIndirizzo ? 'Fatto' : 'Cambia'}</Text>
            </Pressable>
          </View>
          {modificaIndirizzo ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              {/* Indirizzo a campi (come sul sito): il titolo è il segnaposto sbiadito. Il mirino compila tutto TRANNE il numero civico. */}
              <View style={stili.indirizzoRiga}>
                <TextInput
                  value={ind.indirizzo}
                  onChangeText={(t) => cambiaCampo('indirizzo', t)}
                  placeholder="Indirizzo (via, piazza…)"
                  placeholderTextColor={c.grigio}
                  accessibilityLabel="Indirizzo"
                  autoComplete="street-address"
                  returnKeyType="next"
                  style={[campo, { flex: 1, minWidth: 0 }]}
                />
                <Pressable
                  onPress={usaPosizione}
                  disabled={cercando}
                  accessibilityRole="button"
                  accessibilityLabel="Usa la mia posizione"
                  style={[stili.mirino, { borderColor: c.bordo, backgroundColor: c.superficie, opacity: cercando ? 0.6 : 1 }]}
                >
                  {cercando ? <ActivityIndicator color={c.accento} /> : <Icona nome="mirino" colore={c.accento} dimensione={24} />}
                </Pressable>
              </View>
              <View style={stili.indirizzoRiga}>
                <TextInput
                  value={ind.civico}
                  onChangeText={(t) => cambiaCampo('civico', t)}
                  placeholder="Numero civico"
                  placeholderTextColor={c.grigio}
                  accessibilityLabel="Numero civico"
                  autoComplete="off"
                  maxLength={12}
                  returnKeyType="next"
                  style={[campo, { flex: 1, minWidth: 0 }]}
                />
                <TextInput
                  value={ind.interno}
                  onChangeText={(t) => cambiaCampo('interno', t)}
                  placeholder="Interno"
                  placeholderTextColor={c.grigio}
                  accessibilityLabel="Interno"
                  autoComplete="off"
                  maxLength={12}
                  returnKeyType="next"
                  style={[campo, { flex: 1, minWidth: 0 }]}
                />
              </View>
              <View style={stili.indirizzoRiga}>
                <TextInput
                  value={ind.cap}
                  onChangeText={(t) => cambiaCampo('cap', t)}
                  placeholder="CAP"
                  placeholderTextColor={c.grigio}
                  accessibilityLabel="CAP"
                  autoComplete="postal-code"
                  keyboardType="number-pad"
                  maxLength={5}
                  returnKeyType="next"
                  style={[campo, { flex: 1, minWidth: 0 }]}
                />
                <TextInput
                  value={ind.citta}
                  onChangeText={(t) => cambiaCampo('citta', t)}
                  placeholder="Città"
                  placeholderTextColor={c.grigio}
                  accessibilityLabel="Città"
                  autoComplete="off"
                  maxLength={80}
                  returnKeyType="done"
                  onSubmitEditing={conferma}
                  style={[campo, { flex: 1, minWidth: 0 }]}
                />
              </View>
            </View>
          ) : null}
          {messaggio ? <Text style={[stili.messaggioPos, { color: c.grigio }]}>{messaggio}</Text> : null}
        </View>

        {/* Nota facoltativa: riquadro tratteggiato che si apre sul campo di testo. */}
        <View style={stili.nota}>
          <Pressable onPress={() => setNotaAperta(!notaAperta)} accessibilityRole="button" accessibilityState={{ expanded: notaAperta }} style={stili.notaTesta}>
            <Text style={[stili.notaPiu, { color: c.accento }]}>{notaAperta ? '−' : '+'}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stili.notaTitolo, { color: c.testo }]}>Aggiungi una nota per il banco</Text>
              <Text style={[stili.notaSotto, { color: c.grigio }]}>Facoltativa: orario, riferimento cantiere…</Text>
            </View>
          </Pressable>
          {notaAperta ? (
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Es. orario preferito, riferimento cantiere..."
              placeholderTextColor={c.grigio}
              accessibilityLabel="Nota per il banco"
              multiline
              maxLength={500}
              style={[campo, stili.notaCampo]}
            />
          ) : null}
        </View>

        {/* COSA PAGHI E A CHI: "Consegna in cantiere" si paga ORA in app, "Materiale" DOPO al banco; mai un totale unico. */}
        {r ? (
          <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo, paddingBottom: 12 }]}>
            <Text style={stili.cpTitolo}>Cosa paghi e a chi</Text>

            <View style={[stili.cpRiquadro, { backgroundColor: '#e3edf7', borderColor: '#245a8f', borderWidth: 2 }]}>
              <View style={stili.cpTesta}>
                <Icona nome="furgone" colore="#1a4468" dimensione={20} />
                <Text style={[stili.cpNome, { color: '#1a4468' }]}>Consegna in cantiere</Text>
                <Text style={[stili.cpBadge, { backgroundColor: '#245a8f', color: '#ffffff' }]}>Paghi ora</Text>
              </View>
              <Text style={[stili.cpSotto, { color: '#1a4468', opacity: 0.85 }]}>Il nostro servizio: lo addebitiamo quando premi «Paga e invia richiesta».</Text>
              <View style={[stili.cpRighe, { borderTopColor: '#b9cde2' }]}>
                <RigaCp et="Corriere" sp="· costo fisso" valore={'€ ' + r.riepilogo.app_corriere} colore="#1a4468" />
                <RigaCp
                  et="Servizio"
                  sp={`· ${r.riepilogo.servizio_pct}% della merce (€ ${r.riepilogo.banco_merce}) + IVA`}
                  valore={'€ ' + r.riepilogo.app_servizio}
                  colore="#1a4468"
                />
              </View>
              <TotaleCp etichetta="Totale da pagare ora" nota="IVA inclusa" valore={'€ ' + r.riepilogo.app_totale} colore="#1a4468" linea="#b9cde2" />
            </View>

            <View style={[stili.cpRiquadro, { backgroundColor: '#f7f6f2', borderColor: '#e2ded3', borderWidth: 1, marginTop: 10 }]}>
              <View style={stili.cpTesta}>
                <Icona nome="negozio" colore="#1c1917" dimensione={20} />
                <Text style={[stili.cpNome, { color: '#1c1917' }]}>Materiale</Text>
                <Text style={[stili.cpBadge, { backgroundColor: '#e2ded3', color: '#3f3e38' }]}>Paghi dopo {dopoA}</Text>
              </View>
              <Text style={[stili.cpSotto, { color: '#5c5b52' }]}>Non lo paghi ora: te lo fattura {nomeDitta || 'il banco'}.</Text>
              <View style={[stili.cpRighe, { borderTopColor: '#e2ded3' }]}>
                <RigaCp et="Merce" sp={`· prezzo del banco, ${r.riepilogo.articoli}`} valore={'€ ' + r.riepilogo.banco_merce} colore="#1c1917" />
                {r.riepilogo.con_raee ? <RigaCp et="Contributo RAEE" valore={'€ ' + r.riepilogo.banco_raee} colore="#1c1917" /> : null}
                <RigaCp et={`IVA ${r.riepilogo.iva_pct}%`} sp={`· su € ${r.riepilogo.banco_imponibile}`} valore={'€ ' + r.riepilogo.banco_iva} colore="#1c1917" />
              </View>
              <TotaleCp etichetta="Totale materiale" valore={'€ ' + r.riepilogo.banco_totale} colore="#1c1917" linea="#e2ded3" />
            </View>

            <View style={stili.cpSpesa}>
              <Text style={[stili.cpSpesaTesto, { color: c.grigio }]}>Spesa complessiva</Text>
              <Text style={[stili.cpSpesaTesto, { color: c.grigio }]}>€ {r.riepilogo.spesa}</Text>
            </View>
          </View>
        ) : riepilogo.isError ? (
          <Text style={[stili.meta, { color: c.rosso }]}>{riepilogo.error.message}</Text>
        ) : (
          <Text style={[stili.meta, { color: c.grigio }]}>Calcolo i totali…</Text>
        )}
      </ScrollView>

      {/* Barra di pagamento fissa in fondo, sopra la barra delle schede (.barra-paga). */}
      {tastiera ? null : (
        <View
          onLayout={(e) => setAltezzaBarra(e.nativeEvent.layout.height)}
          style={[stili.barra, { backgroundColor: c.superficie, borderTopColor: c.bordo }]}
        >
          {strisciaChiusura && orari.data ? <StrisciaInChiusura orari={orari.data} lettoIl={orari.dataUpdatedAt} inBarra /> : null}
          <View style={stili.barraRiga}>
            <View>
              <Text style={stili.bpLabel}>Paghi ora · consegna</Text>
              <Text style={stili.bpImporto}>€ {r ? r.riepilogo.app_totale : '—'}</Text>
            </View>
            <Pressable
              onPress={inviaRichiesta}
              disabled={!puoPagare || invio}
              accessibilityRole="button"
              accessibilityState={{ disabled: !puoPagare || invio }}
              style={({ pressed }) => [
                stili.paga,
                { backgroundColor: bancoChiuso ? '#a9bbd0' : !puoPagare ? '#c9d0d8' : pressed ? c.accentoScuro : c.accento },
              ]}
            >
              {invio ? <ActivityIndicator color={c.suAccento} /> : <Text style={[stili.pagaTesto, { color: c.suAccento }]}>Paga e invia richiesta</Text>}
            </Pressable>
          </View>
          {orari.data && bancoChiuso ? (
            <NotaChiuso orari={orari.data} />
          ) : (
            <View style={stili.barraNota}>
              <Icona nome="scudo" colore={c.verde} dimensione={16} />
              <Text style={[stili.barraNotaTesto, { color: c.grigio }]}>Se nessun banco accetta, ti rimborsiamo</Text>
            </View>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const stili = StyleSheet.create({
  testata: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  aggiungi: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  aggiungiTesto: { fontFamily: FONT.testoMedio, fontSize: 15 },
  svuota: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999 },
  svuotaTesto: { fontFamily: FONT.testoMedio, fontSize: 14 },
  articolo: { padding: 14, marginBottom: 12, borderWidth: 1, borderRadius: 14 },
  artNome: { fontFamily: FONT.titolo, fontSize: 16, lineHeight: 21 },
  artPrezzo: { marginTop: 4, fontFamily: FONT.testo, fontSize: 14, lineHeight: 19 },
  artAzioni: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  cestino: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  artTotale: { marginLeft: 'auto', fontFamily: FONT.titolo, fontSize: 17 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  consegnaRiga: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  consegnaIco: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  consegnaOcchiello: { fontFamily: FONT.testoForte, fontSize: 11.5, letterSpacing: 0.69, textTransform: 'uppercase' },
  consegnaVia: { fontFamily: FONT.testoForte, fontSize: 16, lineHeight: 21 },
  consegnaCitta: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 19 },
  cambia: { minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  cambiaTesto: { fontFamily: FONT.testoMedio, fontSize: 15 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo },
  indirizzoRiga: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  mirino: { width: 48, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  messaggioPos: { marginTop: 10, fontFamily: FONT.testo, fontSize: 13, lineHeight: 18 },
  nota: { marginBottom: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(107,106,95,0.45)', borderRadius: 12 },
  notaTesta: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingVertical: 10, paddingHorizontal: 14 },
  notaPiu: { width: 16, textAlign: 'center', fontFamily: FONT.testoMedio, fontSize: 18, lineHeight: 20 },
  notaTitolo: { fontFamily: FONT.testoForte, fontSize: 15 },
  notaSotto: { fontFamily: FONT.testo, fontSize: 13 },
  notaCampo: { marginHorizontal: 14, marginBottom: 14, minHeight: 64, textAlignVertical: 'top' },
  cpTitolo: { marginLeft: 2, marginBottom: 10, fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.72, textTransform: 'uppercase', color: '#5c5b52' },
  cpRiquadro: { borderRadius: 14, padding: 12 },
  cpTesta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpNome: { flex: 1, minWidth: 0, fontFamily: FONT.testoForte, fontSize: 15 },
  cpBadge: { overflow: 'hidden', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.24, textTransform: 'uppercase' },
  cpSotto: { marginTop: 6, marginBottom: 10, fontFamily: FONT.testo, fontSize: 13, lineHeight: 18 },
  cpRighe: { paddingTop: 10, paddingBottom: 2, borderTopWidth: 1 },
  cpRiga: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  cpDt: { flexShrink: 1, fontFamily: FONT.testo, fontSize: 14, lineHeight: 19 },
  cpSp: { fontFamily: FONT.testo, fontSize: 12.5 },
  cpDd: { fontFamily: FONT.testoMedio, fontSize: 14, fontVariant: ['tabular-nums'] },
  cpTotale: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 8, paddingTop: 10, borderTopWidth: 1 },
  cpTotaleEt: { fontFamily: FONT.testoForte, fontSize: 15 },
  cpTotaleValore: { fontFamily: FONT.titoloForte, fontSize: 22, fontVariant: ['tabular-nums'] },
  cpSpesa: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 10, marginHorizontal: 4 },
  cpSpesaTesto: { fontFamily: FONT.testo, fontSize: 13, fontVariant: ['tabular-nums'] },
  meta: { fontFamily: FONT.testo, fontSize: 13, textAlign: 'center' },
  barra: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  barraRiga: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bpLabel: { fontFamily: FONT.testoForte, fontSize: 12, color: '#1a4468' },
  bpImporto: { fontFamily: FONT.titoloForte, fontSize: 20, lineHeight: 23, color: '#1a4468', fontVariant: ['tabular-nums'] },
  paga: { flex: 1, minWidth: 0, height: 52, paddingHorizontal: 12, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  pagaTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
  barraNota: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  barraNotaTesto: { fontFamily: FONT.testo, fontSize: 12.5, lineHeight: 16 },
  vuoto: { flexGrow: 1, gap: 22, paddingTop: 28, paddingHorizontal: 16, paddingBottom: 40 },
  vuotoTitolo: { fontFamily: FONT.titoloForte, fontSize: 22, lineHeight: 28, textAlign: 'center' },
  vuotoSotto: { maxWidth: 300, marginTop: 8, fontFamily: FONT.testo, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  sfoglia: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 50, borderWidth: 1.5, borderRadius: 25 },
  sfogliaTesto: { fontFamily: FONT.testoForte, fontSize: 16 },
  uo: { gap: 12, padding: 14, borderWidth: 1, borderRadius: 16 },
  uoTesta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  uoOcchiello: { fontFamily: FONT.testoForte, fontSize: 12, letterSpacing: 0.96, textTransform: 'uppercase' },
  uoData: { fontFamily: FONT.testo, fontSize: 13 },
  uoRiga: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uoQta: { minWidth: 34, overflow: 'hidden', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, color: '#1a4468', fontFamily: FONT.titoloForte, fontSize: 13, textAlign: 'center' },
  uoNome: { flex: 1, minWidth: 0, fontFamily: FONT.testoMedio, fontSize: 15, lineHeight: 20 },
  uoAltri: { marginTop: -4, fontFamily: FONT.testoMedio, fontSize: 13.5 },
  uoBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, minHeight: 44, paddingHorizontal: 18, borderWidth: 1.5, borderRadius: 22 },
  uoBtnTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
});
