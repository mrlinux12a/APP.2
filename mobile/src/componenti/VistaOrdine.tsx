import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { ErroreApi, type Ordine } from '../api';
import { riordina } from '../carrello';
import { useContoAllaRovescia, useOrdine } from '../dati';
import { ICONE } from '../icone';
import { FONT, useTema } from '../tema';
import { AnelloAtt, CardAtt, ChipOk, EsitoConsegnato, PassiAtt, PillolaArrivato, PulsanteBlu, SchedaBanco, SchedaConsegna, SchedaMateriale, SottoAtt, stileTimer, TestaOrdineAtt, TitoloAtt, VERDE_SCURO } from './att';
import { informa } from './dialoghi';
import { Pagamenti } from './Pagamenti';
import { Caricamento, Errore } from './Stato';
import { Card, durataMinuti, Nota, RigaInfo } from './ui';

// Entro questa soglia l'ordine "è in arrivo" e non si scrivono più i minuti (la stessa del sito: format.SOGLIA_IN_ARRIVO_SEC).
const IN_ARRIVO_SEC = 180;

// Il furgone grande al centro dell'anello (stroke più sottile, come .att-furgone svg del sito). Fermo: sul sito oscilla, qui niente animazioni.
const FURGONE = ICONE.furgone.replace('stroke-width="1.6"', 'stroke-width="1.4"');

// La parte alta di un ordine in consegna (la scheda verde del sito): anello che si svuota fino all'arrivo (negli ultimi 3 minuti riparte da vuoto e si
// riempie), "Arriva entro le 18:30", "Mancano 18 min", "Te lo porta …" e i tre passi con la barretta di "In consegna" che si riempie col tempo trascorso.
// Si ridisegna ogni secondo dal conto alla rovescia locale; niente transizioni.
function Consegna({ o, lettoIl, compatta }: { o: Ordine; lettoIl: number; compatta?: boolean }) {
  const restano = useContoAllaRovescia(o.eta_sec, lettoIl);
  const conArrivo = restano !== null;
  const inArrivo = conArrivo && restano <= IN_ARRIVO_SEC;
  const durata = o.durata_sec || 0;
  // Quanto manca in proporzione alla durata (1 = appena nato, 0 = arrivato). Senza orario d'arrivo l'anello resta pieno e fermo.
  const rimasta = conArrivo && durata > 0 ? Math.min(1, Math.max(0, restano / durata)) : 1;
  const frazioneAnello = conArrivo && inArrivo ? 1 - Math.max(0, restano) / IN_ARRIVO_SEC : rimasta;
  // La barretta di "In consegna": tempo trascorso; senza durata a metà, come sul sito.
  const trascorso = durata > 0 && conArrivo ? 1 - rimasta : 0.5;
  const titolo = inArrivo ? 'In arrivo' : o.tempo_testo;
  const mancano = conArrivo ? Math.max(1, Math.ceil(restano / 60)) : null;
  // Chi porta la merce: il corriere se c'è, altrimenti il banco (consegna con il suo mezzo).
  const chiPorta = (o.corriere || '').trim() || o.ditta || (o.distributore ? o.distributore.nome : '');
  const { c } = useTema();
  return (
    <CardAtt stile={stileTimer(compatta)}>
      <AnelloAtt frazione={frazioneAnello} tono="verde" compatto={compatta}>
        <SvgXml xml={FURGONE} width={compatta ? 44 : 58} height={compatta ? 44 : 58} color={c.testo} />
      </AnelloAtt>
      <TitoloAtt testo={titolo} tono="verde" solo={!chiPorta && !conArrivo} />
      {conArrivo && !inArrivo ? (
        <Text style={[stili.minuti, { color: VERDE_SCURO, marginBottom: chiPorta ? 6 : 18 }]}>Mancano {durataMinuti(mancano ?? 1)}</Text>
      ) : null}
      {chiPorta ? (
        <SottoAtt>
          Te lo porta <Text style={{ fontFamily: FONT.testoForte, color: c.testo }}>{chiPorta}</Text>
        </SottoAtt>
      ) : null}
      <PassiAtt
        tono="verde"
        passi={[
          { etichetta: 'Inviata', stato: 'fatto' },
          { etichetta: 'Confermata', stato: 'fatto' },
          { etichetta: 'In consegna', stato: 'corrente', riempimento: trascorso },
        ]}
      />
    </CardAtt>
  );
}

// Un ordine del cliente, come la pagina /ordini/:id del sito (versione installatore): in consegna (anello verde) o consegnato (spunta, orari, Riordina).
// compatta: la pagina sta sotto la striscia di "Stato ordini" (due o più attività), quindi l'anello e la scheda in alto sono più piccoli.
export function VistaOrdine({ id, compatta }: { id: number; compatta?: boolean }) {
  const { c } = useTema();
  const q = useOrdine(id);
  const [azione, setAzione] = useState<string | null>(null);

  if (q.isPending) return <Caricamento />;
  if (q.isError) return <Errore messaggio={q.error.message} riprova={() => q.refetch()} />;
  const o = q.data;

  const ripeti = async () => {
    setAzione('riordina');
    try {
      const { aggiunti, saltati } = await riordina(id);
      if (!aggiunti) {
        informa('Riordina', 'Questi articoli non sono più disponibili.');
        return;
      }
      if (saltati) informa('Riordina', saltati === 1 ? '1 articolo non è più disponibile.' : `${saltati} articoli non sono più disponibili.`);
      router.navigate('/carrello');
    } catch (e) {
      informa('Riordina', e instanceof ErroreApi ? e.message : 'Riprova tra poco.');
    } finally {
      setAzione(null);
    }
  };

  // In fondo restano le sole note: l'indirizzo di consegna ha la sua scheda sotto il banco (SchedaConsegna).
  const dettagli = [o.note ? { etichetta: 'Note', dettaglio: o.note } : null].filter(Boolean) as { etichetta: string; dettaglio: string }[];

  const righe = o.righe.map((r) => ({ quantita: r.quantita, nome: r.nome, codice: r.codice, cad: r.cad, totale: r.subtotale }));
  const nomeBanco = o.ditta || (o.distributore ? o.distributore.nome : '');

  if (o.consegnato) {
    return (
      <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
        <CardAtt stile={stili.consegnato}>
          <EsitoConsegnato />
          <TitoloAtt testo="Consegnato" tono="verde" senzaPunto />
          {o.consegnato_il_esteso ? <SottoAtt spazio={o.durata_testo ? 10 : 18}>{o.consegnato_il_esteso}</SottoAtt> : null}
          {o.durata_testo ? <PillolaArrivato testo={o.durata_testo} /> : null}
          <PassiAtt
            tono="verde"
            passi={[
              // Un orario che manca (ordine vecchio, senza richiesta) non si scrive: resta solo l'etichetta.
              { etichetta: 'Inviata', stato: 'fatto', ora: o.fasi_testo.inviata },
              { etichetta: 'Confermata', stato: 'fatto', ora: o.fasi_testo.confermata },
              { etichetta: 'Consegnata', stato: 'fatto', ora: o.fasi_testo.consegnata },
            ]}
          />
        </CardAtt>

        <PulsanteBlu titolo="Riordina gli stessi pezzi" icona="riprova" onPress={ripeti} disabilitato={azione === 'riordina'} />

        <SchedaMateriale testa={<TestaOrdineAtt nome={nomeBanco} id={o.id} />} righe={righe} etichettaMerce="Merce · IVA esclusa" merce={o.importi.materiale.imponibile} />

        {/* Il banco sta in testa alla scheda del materiale: l'indirizzo viene subito dopo. */}
        <SchedaConsegna indirizzo={o.destinazione} />

        <Pagamenti importi={o.importi} stato={o.stato_pagamento} fallback="ordine" ditta={o.ditta || null} ordineId={o.id} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: c.sfondo }} contentContainerStyle={stili.pagina}>
      <Consegna o={o} lettoIl={q.dataUpdatedAt} compatta={compatta} />

      {nomeBanco ? <SchedaBanco occhiello="Materiale da" nome={nomeBanco} destra={<ChipOk testo="Confermato" />} /> : null}

      <SchedaConsegna indirizzo={o.destinazione} />

      <SchedaMateriale occhiello="Materiale in arrivo" righe={righe} etichettaMerce="Merce · IVA esclusa" merce={o.importi.materiale.imponibile} />

      <Pagamenti importi={o.importi} stato={o.stato_pagamento} fallback="ordine" ditta={o.ditta || null} ordineId={o.id} />

      {dettagli.length ? (
        <Card fitta>
          {dettagli.map((d, i) => (
            <RigaInfo key={i} etichetta={d.etichetta} dettaglio={d.dettaglio} ultima={i === dettagli.length - 1} />
          ))}
        </Card>
      ) : null}

      <Nota>Per problemi con l’ordine contatta l’assistenza: dopo la conferma del banco non si può più annullare.</Nota>
    </ScrollView>
  );
}

const stili = StyleSheet.create({
  pagina: { padding: 14, gap: 12, paddingBottom: 32 },
  // La scheda "Consegnato" ha un filo meno aria sopra (.att-timer.att-consegnato: 22 / 16 / 18).
  consegnato: { paddingTop: 22, paddingHorizontal: 16, paddingBottom: 18 },
  minuti: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 20, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
