// La scheda "PAGAMENTI" come sul sito (views/partials/pagamenti.ejs): la consegna in cantiere, che si paga in app, e il materiale, che si paga al banco
// (a BOREA). MAI un "Totale" unico che li somma. Cambiano colori e testi secondo lo stato della carta (`stato_pagamento.chiave`, le regole stanno in
// src/pagamenti.js del server):
//   bloccato   richiesta in attesa: la carta è solo AUTORIZZATA, l'importo è bloccato; il materiale si paga solo se il banco conferma
//   pagato     è nato l'ordine, la carta è stata incassata ("Pagata il 15/10 · Visa •••• 4242", con il link "Ricevuta")
//   annullato  nessuna risposta o annullata da te: UNA riga grigia "Nessun addebito"
//   rimborsato (raro) riga grigia con la data del rimborso
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { chiamaApi, ErroreApi, type Importi, type StatoPagamento } from '../api';
import { FONT, RAGGIO, useTema } from '../tema';
import { informa } from './dialoghi';
import { Icona } from './Icona';
import type { NomeIcona } from '../icone';

type Props = {
  importi: Importi;
  // Lo stato della carta; null per le richieste del vecchio flusso (si ricava da `fallback`).
  stato: StatoPagamento | null;
  // Se `stato` manca: 'attesa' (richiesta in attesa), 'ordine' (ordine nato), 'chiusa' (richiesta chiusa senza ordine).
  fallback: 'attesa' | 'ordine' | 'chiusa';
  // La ditta senza forma giuridica ("BOREA"); vuota = "il banco".
  ditta: string | null;
  // Dove c'è un ordine: serve al link "Ricevuta".
  ordineId?: number;
  // Solo se chiusa: perché è chiusa e cosa succederebbe rinviandola (prezzi di oggi).
  motivoChiusura?: 'banco' | 'annullata';
  rinvio?: { consegna: string; materiale: string };
};

// Apre la ricevuta in PDF: il server dà un indirizzo firmato valido pochi minuti, che il telefono apre nel browser o nel lettore di PDF.
export async function apriRicevuta(ordineId: number) {
  try {
    const { url } = await chiamaApi<{ url: string }>(`/ordini/${ordineId}/ricevuta`, { metodo: 'POST' });
    await Linking.openURL(url);
  } catch (e) {
    informa('Ricevuta non disponibile', e instanceof ErroreApi ? e.message : 'Non riesco ad aprire la ricevuta, riprova tra poco.');
  }
}

function Riga({
  icona,
  tono,
  titolo,
  sotto,
  importo,
  ricevuta,
  tratteggio,
}: {
  icona: NomeIcona;
  tono: 'azzurro' | 'verde' | 'grigio';
  titolo: string;
  sotto: string;
  importo: string;
  ricevuta?: () => void;
  tratteggio?: boolean;
}) {
  const { c } = useTema();
  const sfondo = tono === 'azzurro' ? c.accentoChiaro : tono === 'verde' ? c.verdeChiaro : c.sfondo;
  const colore = tono === 'azzurro' ? c.accento : tono === 'verde' ? c.verde : c.grigio;
  return (
    <View
      style={[
        stili.riga,
        { backgroundColor: sfondo, borderColor: tratteggio ? c.bordo : 'transparent', borderStyle: tratteggio ? 'dashed' : 'solid', borderWidth: tratteggio ? 1.5 : 0 },
      ]}
    >
      <Icona nome={icona} colore={colore} dimensione={22} />
      <View style={{ flex: 1 }}>
        <Text style={[stili.nome, { color: c.testo }]}>{titolo}</Text>
        <Text style={[stili.sotto, { color: colore }]}>{sotto}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[stili.importo, { color: tratteggio ? c.grigio : c.testo }]}>{importo}</Text>
        {ricevuta ? (
          <Pressable onPress={ricevuta} hitSlop={8} style={stili.linkRicevuta} accessibilityRole="link">
            <Icona nome="scontrino" colore={c.accento} dimensione={14} />
            <Text style={[stili.ricevuta, { color: c.accento }]}>Ricevuta</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function Dettaglio({ importi, bloccato, aChi, nomeBanco }: { importi: Importi; bloccato: boolean; aChi: string; nomeBanco: string }) {
  const { c } = useTema();
  const [aperto, setAperto] = useState(false);
  const cons = importi.consegna;
  const mat = importi.materiale;
  const voce = (et: string, sp: string, valore: string) => (
    <View style={stili.voce} key={et + sp}>
      <Text style={[stili.voceTesto, { color: c.testo }]}>
        {et} <Text style={{ color: c.grigio }}>{sp}</Text>
      </Text>
      <Text style={[stili.voceTesto, { color: c.testo }]}>€ {valore}</Text>
    </View>
  );
  return (
    <View>
      <Pressable onPress={() => setAperto(!aperto)} style={stili.apri} accessibilityRole="button" accessibilityState={{ expanded: aperto }}>
        <Text style={[stili.apriTesto, { color: c.accento }]}>{aperto ? 'Nascondi il dettaglio' : 'Vedi il dettaglio degli importi'}</Text>
        <Text style={{ color: c.accento, fontSize: 16 }}>{aperto ? '▴' : '▾'}</Text>
      </Pressable>
      {aperto ? (
        <View style={{ gap: 10 }}>
          <View style={[stili.riquadro, { backgroundColor: c.verdeChiaro }]}>
            <Text style={[stili.riquadroTitolo, { color: c.verde }]}>Consegna · {bloccato ? 'bloccata sulla carta' : 'pagata'}</Text>
            {voce('Corriere', '· costo fisso', cons.corriere)}
            {voce('Servizio', `· ${cons.servizio_pct}% della merce`, cons.servizio)}
            {voce(`IVA ${cons.iva_pct}%`, `· su € ${cons.imponibile}`, cons.iva)}
          </View>
          <View style={[stili.riquadro, { backgroundColor: c.sfondo }]}>
            <Text style={[stili.riquadroTitolo, { color: c.grigio }]}>Materiale · {bloccato ? `se ${nomeBanco} conferma` : aChi}</Text>
            {voce('Merce', '· prezzo del banco', mat.merce)}
            {mat.raee ? voce('Contributo RAEE', '', mat.raee) : null}
            {voce(`IVA ${cons.iva_pct}%`, `· su € ${mat.imponibile}`, mat.iva)}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function Pagamenti({ importi, stato, fallback, ditta, ordineId, motivoChiusura = 'banco', rinvio }: Props) {
  const { c } = useTema();
  const chiave = stato ? stato.chiave : fallback === 'attesa' ? 'bloccato' : fallback === 'chiusa' ? 'annullato' : 'pagato';
  const aChi = ditta ? `a ${ditta}` : 'al banco';
  const nomeBanco = ditta || 'il banco';
  const consegna = importi.consegna.totale;
  const carta = stato && stato.carta ? stato.carta : '';
  const quando = stato && stato.data ? stato.data.split(',')[0] : '';
  const apriRic = ordineId && stato && stato.ricevuta ? () => apriRicevuta(ordineId) : undefined;
  const bloccato = chiave === 'bloccato';

  return (
    <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }]}>
      <Text style={[stili.titolo, { color: c.testo }]}>Pagamenti</Text>

      {chiave === 'annullato' || chiave === 'rimborsato' ? (
        <>
          <Riga
            icona="pagamento"
            tono="grigio"
            titolo={chiave === 'rimborsato' ? `Rimborsata${quando ? ' il ' + quando : ''} ${carta ? 'su ' + carta : 'sul tuo metodo di pagamento'}` : 'Nessun addebito'}
            sotto={
              chiave === 'rimborsato'
                ? ''
                : motivoChiusura === 'annullata'
                  ? `Hai annullato la richiesta: il blocco di € ${consegna} è stato tolto dalla carta.`
                  : `Il blocco di € ${consegna} sulla carta è stato annullato. Nessuna consegna, niente da pagare ${aChi}.`
            }
            importo={chiave === 'rimborsato' ? '€ ' + consegna : '€ 0,00'}
            ricevuta={chiave === 'rimborsato' ? apriRic : undefined}
          />
          {chiave === 'annullato' && rinvio ? (
            <Text style={[stili.nota, { color: c.grigio }]}>
              Se rinvii la richiesta blocchiamo di nuovo € {rinvio.consegna} sulla carta, addebitati solo se {nomeBanco} conferma. Il materiale (€ {rinvio.materiale})
              lo paghi {aChi}.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Riga
            icona="furgone"
            tono={bloccato ? 'azzurro' : 'verde'}
            titolo="Consegna in cantiere"
            sotto={
              bloccato
                ? `Bloccati sulla carta · addebitati solo se ${nomeBanco} conferma`
                : `${quando ? 'Pagata il ' + quando : 'Pagata in app'}${carta ? ' · ' + carta : ''}`
            }
            importo={'€ ' + consegna}
            ricevuta={bloccato ? undefined : apriRic}
          />
          <Riga
            icona="negozio"
            tono="grigio"
            titolo="Materiale"
            sotto={bloccato ? `Lo paghi ${aChi} solo se conferma` : `Lo paghi ${aChi} con la sua fattura`}
            importo={'€ ' + importi.materiale.totale}
            tratteggio={bloccato}
          />
          <Dettaglio importi={importi} bloccato={bloccato} aChi={aChi} nomeBanco={nomeBanco} />
        </>
      )}
    </View>
  );
}

const stili = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RAGGIO, padding: 14, gap: 10 },
  titolo: { fontFamily: FONT.titolo, fontSize: 17 },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 12 },
  nome: { fontFamily: FONT.testoForte, fontSize: 15 },
  sotto: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 18, marginTop: 2 },
  importo: { fontFamily: FONT.titolo, fontSize: 16 },
  linkRicevuta: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  ricevuta: { fontFamily: FONT.testoForte, fontSize: 13 },
  nota: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 19 },
  apri: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, minHeight: 44 },
  apriTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
  riquadro: { borderRadius: 12, padding: 12, gap: 6 },
  riquadroTitolo: { fontFamily: FONT.testoForte, fontSize: 13 },
  voce: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  voceTesto: { fontFamily: FONT.testo, fontSize: 14 },
});
