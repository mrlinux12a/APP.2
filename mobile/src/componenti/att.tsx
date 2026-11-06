// I mattoncini delle pagine "Verifica disponibilità", "Ordine in consegna", "Consegnato" e "Nessuna risposta", uguali alle classi `att-*` del sito
// (assets/css/09_attesa_consegna_chiusa.css e 13_pagamento_e_pagine_vuote.css): scheda con l'anello da 148 px, i tre passaggi, la scheda del banco, il
// materiale con le righe a prezzo del banco. Niente animazioni: l'anello e le barre si ridisegnano a ogni secondo ma non si muovono da soli.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, SvgXml } from 'react-native-svg';

import { ICONE, type NomeIcona } from '../icone';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

export const VERDE_SCURO = '#1f5f2e';
export const ROSSO_SCURO = '#991b1b';
export const ROSSO_LINK = '#8a3a3a';

export type TonoAtt = 'arancio' | 'verde' | 'rosso';

const SPUNTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROCE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const SPUNTA_GRANDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>';

// Circonferenza dell'anello grande: 2 * PI * 64 (come CIRC_ATTESA del sito).
const R = 64;
const CIRC = 2 * Math.PI * R;

// La scheda bianca (.card.att-card): bordo, angoli da 16, ombra nessuna.
export function CardAtt({ children, stile }: { children: ReactNode; stile?: StyleProp<ViewStyle> }) {
  const { c } = useTema();
  return <View style={[stili.card, { backgroundColor: c.superficie, borderColor: c.bordo }, stile]}>{children}</View>;
}

export function Spunta({ dimensione = 16 }: { dimensione?: number }) {
  const { c } = useTema();
  return (
    <View style={{ width: dimensione, height: dimensione, borderRadius: dimensione / 2, backgroundColor: c.verde, alignItems: 'center', justifyContent: 'center' }}>
      <SvgXml xml={SPUNTA} width={10} height={10} color="#ffffff" />
    </View>
  );
}

// L'anello da 148 px: la traccia chiara e, sopra, l'arco che si accorcia. `frazione` = quanto resta (1 = pieno, 0 = vuoto). Al centro `children`.
// Senza arco (`senzaArco`) c'è solo la traccia, come la richiesta scaduta.
export function AnelloAtt({
  frazione,
  tono,
  senzaArco,
  compatto,
  children,
}: {
  frazione: number;
  tono: TonoAtt;
  senzaArco?: boolean;
  // Sotto la striscia di "Stato ordini" (due o più attività) l'anello è da 112 px invece di 148 (.con-striscia del sito).
  compatto?: boolean;
  children?: ReactNode;
}) {
  const { c } = useTema();
  const traccia = tono === 'verde' ? c.verdeChiaro : tono === 'rosso' ? c.rossoChiaro : c.arancioChiaro;
  const arco = tono === 'verde' ? c.verde : c.arancio;
  const f = Math.min(1, Math.max(0, frazione));
  const lato = compatto ? 112 : 148;
  return (
    <View style={[stili.anello, { width: lato, height: lato, marginBottom: compatto ? 14 : 18 }]}>
      <Svg width={lato} height={lato} viewBox="0 0 148 148">
        <Circle cx={74} cy={74} r={R} fill="none" stroke={traccia} strokeWidth={10} />
        {senzaArco || f <= 0 ? null : (
          <Circle
            cx={74}
            cy={74}
            r={R}
            fill="none"
            stroke={arco}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${CIRC} ${CIRC}`}
            strokeDashoffset={CIRC * (1 - f)}
            rotation={-90}
            origin="74, 74"
          />
        )}
      </Svg>
      <View style={stili.anelloCentro}>{children}</View>
    </View>
  );
}

// Il tempo dentro l'anello ("09:41").
export function TempoAnello({ testo, spento, compatto }: { testo: string; spento?: boolean; compatto?: boolean }) {
  const { c } = useTema();
  return <Text style={[stili.tempo, { color: spento ? '#b8b4aa' : c.testo }, compatto && { fontSize: 25, lineHeight: 30 }]}>{testo}</Text>;
}

// La scheda dell'anello (.att-timer): 24 sopra, 16 ai lati, 18 sotto; sotto la striscia di "Stato ordini" più compatta (18 / 16).
export function stileTimer(compatto?: boolean): ViewStyle {
  return compatto ? { paddingTop: 18, paddingHorizontal: 16, paddingBottom: 16 } : { paddingTop: 24, paddingHorizontal: 16, paddingBottom: 18 };
}

// Titolo della scheda di stato, con il puntino davanti (fermo: niente pulsazione). `solo` = niente testo sotto, quindi più aria.
export function TitoloAtt({ testo, tono, solo, senzaPunto }: { testo: string; tono: TonoAtt; solo?: boolean; senzaPunto?: boolean }) {
  const { c } = useTema();
  const verde = tono === 'verde';
  return (
    <View style={[stili.titoloRiga, { marginBottom: verde && !solo ? 6 : tono === 'rosso' ? 6 : 18 }]}>
      {senzaPunto || tono === 'rosso' ? null : <View style={[stili.punto, { backgroundColor: verde ? c.verde : c.arancio }]} />}
      <Text style={[stili.titolo, { color: c.testo }, verde && stili.titoloVerde]}>{testo}</Text>
    </View>
  );
}

// Il testo piccolo sotto il titolo ("Il tempo per rispondere è scaduto.", "Te lo porta BOREA"): 14 px grigio. `spazio` = margine sotto (18 di norma, 14 nelle pagine rosse).
export function SottoAtt({ children, spazio = 18 }: { children: ReactNode; spazio?: number }) {
  const { c } = useTema();
  return <Text style={[stili.sotto, { color: c.grigio, marginBottom: spazio }]}>{children}</Text>;
}

// La pillola verde grande "✓ Nessun addebito sulla carta" (.att-rimborso), centrata sotto il testo.
export function PillolaOk({ testo }: { testo: string }) {
  const { c } = useTema();
  return (
    <View style={stili.rimborsoRiga}>
      <View style={[stili.rimborso, { backgroundColor: c.verdeChiaro }]}>
        <Spunta />
        <Text style={[stili.rimborsoTesto, { color: VERDE_SCURO }]}>{testo}</Text>
      </View>
    </View>
  );
}

export type PassoAtt = {
  etichetta: string;
  stato: 'fatto' | 'corrente' | 'dafare';
  // L'orario sotto il passo (pagina "Consegnato").
  ora?: string | null;
  // Barretta che si riempie (0–1): solo il passo corrente dell'ordine in consegna.
  riempimento?: number;
  croce?: boolean;
};

// I tre passaggi: Inviata (fatto) · Conferma banco (corrente) · In consegna.
export function PassiAtt({ passi, tono }: { passi: PassoAtt[]; tono: TonoAtt }) {
  const { c } = useTema();
  return (
    <View style={stili.passi} accessibilityRole="list">
      {passi.map((p) => {
        const barretta =
          p.stato === 'fatto'
            ? c.verde
            : p.stato === 'corrente'
              ? tono === 'verde'
                ? c.verdeChiaro
                : tono === 'rosso'
                  ? c.rosso
                  : c.arancio
              : c.bordo;
        const colore =
          p.stato === 'fatto'
            ? c.verde
            : p.stato === 'corrente'
              ? tono === 'verde'
                ? VERDE_SCURO
                : tono === 'rosso'
                  ? ROSSO_SCURO
                  : c.arancio
              : c.grigio;
        return (
          <View key={p.etichetta} style={stili.passo} accessibilityLabel={p.etichetta + (p.stato === 'corrente' ? ' (in corso)' : p.stato === 'fatto' ? ' (fatto)' : '')}>
            <View style={[stili.barretta, { backgroundColor: barretta }]}>
              {p.riempimento !== undefined ? (
                <View style={{ height: 5, borderRadius: 3, backgroundColor: c.verde, width: `${Math.round(Math.min(1, Math.max(0, p.riempimento)) * 100)}%` }} />
              ) : null}
            </View>
            <View style={stili.etichettaRiga}>
              {p.stato === 'fatto' ? <Spunta /> : null}
              {p.croce ? (
                <View style={[stili.croce, { backgroundColor: c.rosso }]}>
                  <SvgXml xml={CROCE} width={10} height={10} color="#ffffff" />
                </View>
              ) : null}
              <Text style={[stili.etichetta, { color: colore, fontFamily: p.stato === 'dafare' ? FONT.testoMedio : FONT.testoForte }]} numberOfLines={2}>
                {p.etichetta}
              </Text>
            </View>
            {p.ora ? <Text style={stili.ora}>{p.ora}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// La scheda del banco interpellato: icona del negozio, occhiello ("Banco interpellato", "Materiale da"), nome e a destra uno stato.
export function SchedaBanco({ occhiello, nome, destra }: { occhiello: string; nome: string; destra?: ReactNode }) {
  const { c } = useTema();
  return (
    <CardAtt stile={stili.banco}>
      <View style={stili.bancoIcona}>
        <Icona nome="negozio" colore={c.grigio} dimensione={20} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[stili.occhiello, { color: c.grigio }]}>{occhiello}</Text>
        <Text style={[stili.bancoNome, { color: c.testo }]}>{nome}</Text>
      </View>
      {destra}
    </CardAtt>
  );
}

// La scheda "Consegna in cantiere": sta SOTTO la scheda del banco ("Banco interpellato" / "Materiale da") in ogni fase e porta l'indirizzo scritto nell'ordine,
// con la stessa forma della scheda del banco (icona della posizione, occhiello, indirizzo che va a capo se è lungo). Senza indirizzo non si disegna.
export function SchedaConsegna({ indirizzo }: { indirizzo?: string | null }) {
  const { c } = useTema();
  if (!indirizzo || !indirizzo.trim()) return null;
  return (
    <CardAtt stile={stili.banco}>
      <View style={stili.bancoIcona}>
        <Icona nome="posizione" colore={c.grigio} dimensione={20} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[stili.occhiello, { color: c.grigio }]}>Consegna in cantiere</Text>
        <Text style={[stili.consegnaIndirizzo, { color: c.testo }]}>{indirizzo.trim()}</Text>
      </View>
    </CardAtt>
  );
}

// "Sta verificando" / "Disponibile" / "Non disponibile" / "Nessuna risposta" con il suo puntino colorato (.stato-badge dentro #stato-distributori).
export function BadgeBanco({ testo, esito }: { testo: string; esito: string }) {
  const { c } = useTema();
  const colori =
    esito === 'in_attesa'
      ? { sfondo: c.arancioChiaro, testo: '#8a3a14', punto: c.arancio }
      : esito === 'confermato'
        ? { sfondo: c.verdeChiaro, testo: c.verde, punto: c.verde }
        : { sfondo: c.rossoChiaro, testo: c.rosso, punto: c.rosso };
  return (
    <View style={[stili.badgeBanco, { backgroundColor: colori.sfondo }]}>
      <View style={[stili.badgePunto, { backgroundColor: colori.punto }]} />
      <Text style={[stili.badgeTesto, { color: colori.testo }]}>{testo}</Text>
    </View>
  );
}

// "✓ Confermato" / "✓ Disponibile" (verde) e "Non disponibile" / "Nessuna risposta" (rosso): le etichette a pillola della scheda del banco.
export function ChipOk({ testo }: { testo: string }) {
  const { c } = useTema();
  return (
    <View style={[stili.chip, { backgroundColor: c.verdeChiaro, paddingLeft: 6 }]}>
      <Spunta />
      <Text style={[stili.chipTesto, { color: VERDE_SCURO }]}>{testo}</Text>
    </View>
  );
}

export function ChipNo({ testo }: { testo: string }) {
  const { c } = useTema();
  return (
    <View style={[stili.chip, { backgroundColor: c.rossoChiaro }]}>
      <Text style={[stili.chipTesto, { color: ROSSO_SCURO, fontFamily: FONT.testoForte }]}>{testo}</Text>
    </View>
  );
}

export type RigaMateriale = { quantita: number; nome: string; codice: string; cad: string; totale: string };

// Il materiale con le righe a PREZZO DEL BANCO ("2×  Nome / Cod. 123 · € 4,00 cad.   € 8,00") e in fondo "Merce · IVA esclusa". `testa` sostituisce
// l'occhiello (la scheda dell'ordine consegnato ha banco e "Ordine #N" in testa).
export function SchedaMateriale({
  occhiello,
  testa,
  righe,
  etichettaMerce,
  merce,
}: {
  occhiello?: string;
  testa?: ReactNode;
  righe: RigaMateriale[];
  etichettaMerce: string;
  merce: string;
}) {
  const { c } = useTema();
  return (
    <CardAtt stile={{ paddingHorizontal: 16, paddingVertical: 14 }}>
      {testa ?? <Text style={[stili.occhiello, { color: c.grigio }]}>{occhiello}</Text>}
      <View style={{ marginTop: testa ? 6 : 8 }}>
        {righe.map((r, i) => (
          <View key={i} style={stili.riga}>
            <View style={[stili.qta, { backgroundColor: c.accentoChiaro }]}>
              <Text style={[stili.qtaTesto, { color: c.accentoScuro }]}>{r.quantita}×</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[stili.nome, { color: c.testo }]}>{r.nome}</Text>
              <Text style={[stili.codice, { color: c.grigio }]}>
                Cod. {r.codice} · € {r.cad} cad.
              </Text>
            </View>
            <Text style={[stili.prezzoRiga, { color: c.testo }]}>€ {r.totale}</Text>
          </View>
        ))}
      </View>
      <View style={[stili.riepilogo, { borderTopColor: c.bordo }]}>
        <Text style={[stili.voce, { color: c.grigio }]}>{etichettaMerce}</Text>
        <Text style={[stili.voce, { color: c.testo }]}>€ {merce}</Text>
      </View>
    </CardAtt>
  );
}

// L'intestazione della scheda del materiale consegnato: icona del negozio, "Materiale consegnato", nome del banco e a destra "Ordine #N".
export function TestaOrdineAtt({ nome, id }: { nome: string; id: number }) {
  const { c } = useTema();
  return (
    <View style={[stili.testaOrdine, { borderBottomColor: '#ece9e2' }]}>
      <View style={stili.bancoIcona}>
        <Icona nome="negozio" colore={c.grigio} dimensione={20} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[stili.occhiello, { color: c.grigio, marginBottom: 1 }]}>Materiale consegnato</Text>
        {nome ? <Text style={[stili.bancoNome, { color: c.testo }]}>{nome}</Text> : null}
      </View>
      <Text style={[stili.ordineId, { color: c.grigio }]}>Ordine #{id}</Text>
    </View>
  );
}

// "Arrivato in 47 min dall'invio": la pillola verde sotto la data della pagina "Consegnato".
export function PillolaArrivato({ testo }: { testo: string }) {
  return (
    <View style={stili.arrivatoRiga}>
      <Text style={stili.arrivato}>{testo}</Text>
    </View>
  );
}

// Il pulsante blu a tutta larghezza ("Rinvia richiesta", "Riordina gli stessi pezzi"), con l'icona a sinistra.
export function PulsanteBlu({ titolo, onPress, icona, disabilitato }: { titolo: string; onPress: () => void; icona?: NomeIcona; disabilitato?: boolean }) {
  const { c } = useTema();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabilitato}
      accessibilityRole="button"
      style={({ pressed }) => [stili.pulsante, { backgroundColor: disabilitato ? '#c9d0d8' : pressed ? c.accentoScuro : c.accento }]}
    >
      {icona ? <SvgXml xml={ICONE[icona].replace('stroke-width="1.6"', 'stroke-width="2.2"')} width={22} height={22} color={c.suAccento} /> : null}
      <Text style={[stili.pulsanteTesto, { color: c.suAccento }]}>{titolo}</Text>
    </Pressable>
  );
}

// Il link sottolineato rosso scuro in fondo alla pagina ("Annulla la richiesta", "Elimina richiesta").
export function LinkRosso({ titolo, onPress, forte, disabilitato }: { titolo: string; onPress: () => void; forte?: boolean; disabilitato?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabilitato} accessibilityRole="button" style={stili.linkRosso}>
      <Text style={[stili.linkRossoTesto, { fontFamily: forte ? FONT.testoMedio : FONT.testo, opacity: disabilitato ? 0.5 : 1 }]}>{titolo}</Text>
    </Pressable>
  );
}

// Il cerchio con la spunta grande della pagina "Consegnato" (120 px verde chiaro, dentro 76 px verde).
export function EsitoConsegnato() {
  const { c } = useTema();
  return (
    <View style={[stili.esito, { backgroundColor: c.verdeChiaro }]}>
      <View style={[stili.esitoInterno, { backgroundColor: c.verde }]}>
        <SvgXml xml={SPUNTA_GRANDE} width={40} height={40} color="#ffffff" />
      </View>
    </View>
  );
}

// Il pallino rosso con "!" sul bordo dell'anello (richiesta scaduta), a 45° in alto a destra.
export function PallinoAllarme({ compatto }: { compatto?: boolean }) {
  const { c } = useTema();
  return (
    <View
      style={[
        stili.allarme,
        { backgroundColor: c.rosso, borderColor: c.superficie },
        compatto && { left: 77, top: 9, width: 26, height: 26, borderRadius: 13, borderWidth: 2.5 },
      ]}
    >
      <Text style={[stili.allarmeTesto, compatto && { fontSize: 13, lineHeight: 16 }]}>!</Text>
    </View>
  );
}

// La figura delle pagine vuote (Stato ordini, Carrello): cerchio da 112 px azzurro con un cerchio tratteggiato dentro e l'icona a tratto sottile.
export function FiguraVuota({ icona }: { icona: NomeIcona }) {
  const { c } = useTema();
  return (
    <View style={[stili.figura, { backgroundColor: c.accentoChiaro }]}>
      <View style={[stili.figuraTratt, { borderColor: c.accento }]} />
      <SvgXml xml={ICONE[icona].replace('stroke-width="1.6"', 'stroke-width="1.3"')} width={46} height={46} color={c.accento} />
    </View>
  );
}

const stili = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16 },
  anello: { width: 148, height: 148, alignSelf: 'center', marginBottom: 18 },
  anelloCentro: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  tempo: { fontFamily: FONT.titoloForte, fontSize: 31, lineHeight: 36, fontVariant: ['tabular-nums'] },
  titoloRiga: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  punto: { width: 9, height: 9, borderRadius: 5 },
  titolo: { fontFamily: FONT.titolo, fontSize: 19, lineHeight: 24, textAlign: 'center', flexShrink: 1 },
  titoloVerde: { fontFamily: FONT.titoloForte, fontSize: 22, lineHeight: 27 },
  testaOrdine: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottomWidth: 1 },
  ordineId: { fontFamily: FONT.testo, fontSize: 13, lineHeight: 16 },
  arrivatoRiga: { alignItems: 'center', marginBottom: 18 },
  arrivato: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e3f3e6',
    color: '#1f5f2e',
    fontFamily: FONT.testoForte,
    fontSize: 13,
    lineHeight: 17,
  },
  sotto: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 19, textAlign: 'center' },
  rimborsoRiga: { alignItems: 'center', marginBottom: 18 },
  rimborso: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 10, paddingRight: 16, borderRadius: 999 },
  rimborsoTesto: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 18 },
  passi: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  passo: { flex: 1, minWidth: 0, gap: 7 },
  barretta: { height: 5, borderRadius: 3, overflow: 'hidden' },
  etichettaRiga: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  etichetta: { fontSize: 12.5, lineHeight: 15, textAlign: 'center', flexShrink: 1 },
  croce: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ora: { marginTop: 2, textAlign: 'center', fontFamily: FONT.testoForte, fontSize: 13, lineHeight: 16, color: '#1c1917', fontVariant: ['tabular-nums'] },
  occhiello: { fontFamily: FONT.testoMedio, fontSize: 12, letterSpacing: 0.96, textTransform: 'uppercase' },
  banco: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  bancoIcona: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f1efea', alignItems: 'center', justifyContent: 'center' },
  bancoNome: { fontFamily: FONT.testoForte, fontSize: 16, lineHeight: 20 },
  consegnaIndirizzo: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 20 },
  badgeBanco: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  badgePunto: { width: 6, height: 6, borderRadius: 3 },
  badgeTesto: { fontFamily: FONT.testoMedio, fontSize: 13, lineHeight: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingLeft: 12, paddingRight: 12, borderRadius: 999 },
  chipTesto: { fontFamily: FONT.testoMedio, fontSize: 13, lineHeight: 16 },
  riga: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  qta: { minWidth: 36, height: 28, paddingHorizontal: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  qtaTesto: { fontFamily: FONT.testoForte, fontSize: 14 },
  nome: { fontFamily: FONT.testoMedio, fontSize: 15, lineHeight: 20 },
  codice: { marginTop: 3, fontFamily: FONT.testo, fontSize: 13 },
  prezzoRiga: { fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 20 },
  riepilogo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  voce: { fontFamily: FONT.testo, fontSize: 14.5, flexShrink: 1 },
  pulsante: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 27 },
  pulsanteTesto: { fontFamily: FONT.testoForte, fontSize: 17 },
  linkRosso: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  linkRossoTesto: { color: ROSSO_LINK, fontSize: 15, textDecorationLine: 'underline' },
  esito: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 },
  esitoInterno: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  allarme: { position: 'absolute', left: 102, top: 12, width: 34, height: 34, borderRadius: 17, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  allarmeTesto: { color: '#ffffff', fontFamily: FONT.titolo, fontSize: 17, lineHeight: 20 },
  figura: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  figuraTratt: { position: 'absolute', top: 14, left: 14, right: 14, bottom: 14, borderRadius: 50, borderWidth: 2, borderStyle: 'dashed', opacity: 0.35 },
});
