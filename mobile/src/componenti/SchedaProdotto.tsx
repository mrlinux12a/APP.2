import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { urlFoto, type Disponibilita, type Prodotto } from '../api';
import { selezione, useQuantitaNelCarrello, useQuantitaSelezionata, type DatiRiga } from '../carrello';
import { FONT, useTema, type Colori } from '../tema';
import { Icona } from './Icona';
import { ALTEZZA_STEPPER, Stepper } from './Stepper';

// Dati mostrati per la misura scelta: il prodotto stesso o una delle sue varianti.
type Scelta = {
  id: number;
  codice: string;
  etichetta: string | null;
  disponibilita: Disponibilita;
  disponibilita_testo: string;
  raee: string | null;
  sconto_base_pct: number;
  listino: string;
  prezzo: string;
  prezzo_valore: number;
};

function sceltaDi(p: Prodotto, id: number): Scelta {
  const v = p.varianti?.find((x) => x.id === id);
  if (v) return { ...v };
  return { ...p, etichetta: null };
}

function datiRiga(p: Prodotto, s: Scelta): DatiRiga {
  return {
    id: s.id,
    nome: p.nome,
    etichetta: s.etichetta,
    codice: s.codice,
    prezzo: s.prezzo,
    prezzo_valore: s.prezzo_valore,
    foto_url: p.foto_url,
  };
}

export function coloriDisponibilita(c: Colori, d: Disponibilita) {
  if (d === 'disponibile') return { sfondo: c.verdeChiaro, testo: c.verde };
  if (d === 'in_esaurimento') return { sfondo: c.arancioChiaro, testo: c.arancio };
  return { sfondo: c.rossoChiaro, testo: c.rosso };
}

// ultima: niente linea di separazione sotto, la chiude già il bordo della card.
function SchedaProdottoBase({ p, ultima = false }: { p: Prodotto; ultima?: boolean }) {
  const { c } = useTema();
  const [idScelto, setIdScelto] = useState(p.id);
  const [tendina, setTendina] = useState(false);
  const [fotoAperta, setFotoAperta] = useState(false);

  const s = sceltaDi(p, idScelto);
  const disp = coloriDisponibilita(c, s.disponibilita);
  const varianti = p.varianti || [];
  const selezionati = useQuantitaSelezionata(s.id);
  const nelCarrello = useQuantitaNelCarrello(s.id);

  const scegliVariante = (id: number) => {
    if (id === idScelto) return;
    selezione.sposta(idScelto, datiRiga(p, sceltaDi(p, id)));
    setIdScelto(id);
  };

  return (
    <View style={[stili.scheda, { borderBottomColor: c.bordo, borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth }]}>
      <View style={stili.info}>
        <Text style={[stili.nome, { color: c.testo }]}>
          {p.brand_nome ? (
            <Text style={[stili.marchio, { backgroundColor: p.brand_colore || c.accento }]}> {p.brand_nome} </Text>
          ) : null}
          {p.brand_nome ? ' ' : ''}
          {p.nome}
        </Text>

        {/* Come sul sito: da 3 misure in su una tendina; con 2, i tasti affiancati su una
            riga sola (scorrevole se non ci stanno), mai uno sotto l'altro. */}
        {varianti.length >= 3 ? (
          <Pressable
            onPress={() => setTendina(true)}
            accessibilityRole="button"
            accessibilityLabel={'Misura di ' + p.nome}
            style={[stili.tendina, { borderColor: c.bordo, backgroundColor: c.sfondo }]}
          >
            <Text style={[stili.tendinaTesto, { color: c.testo }]} numberOfLines={1}>
              {s.etichetta}
            </Text>
            <Text style={{ color: c.grigio }}>▾</Text>
          </Pressable>
        ) : varianti.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={stili.chipScorri}
            contentContainerStyle={stili.chipRiga}
          >
            {varianti.map((v) => {
              const attiva = v.id === idScelto;
              return (
                <Pressable
                  key={v.id}
                  onPress={() => scegliVariante(v.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: attiva }}
                  style={[
                    stili.chip,
                    { borderColor: attiva ? c.accento : c.bordo, backgroundColor: attiva ? c.accento : c.sfondo },
                  ]}
                >
                  <Text style={[stili.chipTesto, { color: attiva ? c.suAccento : c.testo }]}>{v.etichetta}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={stili.metaRiga}>
          {p.categoria ? <Text style={[stili.meta, { color: c.grigio }]}>{p.categoria}</Text> : null}
          <Text style={[stili.badge, { backgroundColor: disp.sfondo, color: disp.testo }]}>{s.disponibilita_testo}</Text>
        </View>
        {s.raee ? <Text style={[stili.meta, { color: c.grigio }]}>RAEE € {s.raee}</Text> : null}
        {nelCarrello > 0 ? (
          <Text style={[stili.nelCarrello, { backgroundColor: c.verdeChiaro, color: c.verde }]}>
            Nel carrello: {nelCarrello} pz
          </Text>
        ) : null}

        {/* Il prezzo sta sempre in fondo alla card, alla stessa altezza dello stepper:
            non si sposta con la lunghezza del nome o con le misure. */}
        <View style={stili.prezzoRiga}>
          <Text style={[stili.prezzo, { color: c.accento }]}>
            {s.sconto_base_pct > 0 ? <Text style={[stili.barrato, { color: c.barrato }]}>€ {s.listino}  </Text> : null}€{' '}
            {s.prezzo} <Text style={[stili.iva, { color: c.grigio }]}>+ IVA</Text>
          </Text>
        </View>
      </View>

      <View style={stili.laterale}>
        {p.foto_url ? (
          <Pressable onPress={() => setFotoAperta(true)} accessibilityLabel={'Foto di ' + p.nome}>
            <Image source={urlFoto(p.foto_url)} style={[stili.foto, { backgroundColor: c.superficie }]} contentFit="contain" />
          </Pressable>
        ) : (
          <View style={stili.foto} />
        )}
        {s.disponibilita === 'non_disponibile' ? (
          <View style={stili.nonDisponibile}>
            <Text style={[stili.meta, { color: c.grigio }]}>non disponibile</Text>
          </View>
        ) : (
          <Stepper valore={selezionati} cambia={(n) => selezione.imposta(datiRiga(p, s), n)} etichetta={p.nome} />
        )}
      </View>

      <Modal visible={tendina} transparent animationType="slide" onRequestClose={() => setTendina(false)}>
        <Pressable style={stili.velo} onPress={() => setTendina(false)} />
        <SafeAreaView edges={['bottom']} style={[stili.foglio, { backgroundColor: c.superficie }]}>
          <Text style={[stili.foglioTitolo, { color: c.testo }]} numberOfLines={2}>
            {p.nome}
          </Text>
          <FlatList
            data={varianti}
            keyExtractor={(v) => String(v.id)}
            renderItem={({ item: v }) => (
              <Pressable
                onPress={() => {
                  scegliVariante(v.id);
                  setTendina(false);
                }}
                style={[stili.opzione, { borderBottomColor: c.bordo }]}
              >
                <Text style={[stili.opzioneTesto, { color: v.id === idScelto ? c.accento : c.testo }]}>{v.etichetta}</Text>
                <Text style={[stili.meta, { color: c.grigio }]}>€ {v.prezzo}</Text>
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>

      <Modal visible={fotoAperta} transparent animationType="fade" onRequestClose={() => setFotoAperta(false)}>
        <Pressable style={stili.fotoVelo} onPress={() => setFotoAperta(false)}>
          {p.foto_url ? (
            <Image
              source={urlFoto(p.foto_url)}
              style={[stili.fotoGrande, { backgroundColor: c.superficie }]}
              contentFit="contain"
            />
          ) : null}
          <View style={stili.chiudi}>
            <Icona nome="chiudi" colore="#ffffff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export const SchedaProdotto = memo(SchedaProdottoBase);

const stili = StyleSheet.create({
  scheda: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  info: { flex: 1, minWidth: 0 },
  // Sito: .prodotto .nome = Sora 600, 16px, interlinea 1.3.
  nome: { fontFamily: FONT.nome, fontSize: 16, lineHeight: 21 },
  marchio: { color: '#fff', fontFamily: FONT.testoForte, fontSize: 11, letterSpacing: 0.4 },
  tendina: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 6,
    marginBottom: 2,
    minWidth: 110,
  },
  tendinaTesto: { fontFamily: FONT.testoMedio, fontSize: 14, flexShrink: 1 },
  chipScorri: { marginTop: 6, marginBottom: 2, flexGrow: 0 },
  chipRiga: { flexDirection: 'row', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 14 },
  chipTesto: { fontFamily: FONT.testoMedio, fontSize: 13 },
  metaRiga: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  meta: { fontFamily: FONT.testo, fontSize: 13, marginTop: 2 },
  badge: {
    fontFamily: FONT.testoMedio,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  nelCarrello: {
    alignSelf: 'flex-start',
    fontFamily: FONT.testoMedio,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 6,
  },
  // Spinta in fondo (marginTop auto) e alta quanto lo stepper, con il testo centrato: il
  // prezzo si allinea sempre al centro dei tasti +/−.
  prezzoRiga: { marginTop: 'auto', paddingTop: 6, minHeight: ALTEZZA_STEPPER + 6, justifyContent: 'center' },
  prezzo: { fontFamily: FONT.testoForte, fontSize: 16 },
  barrato: { fontFamily: FONT.testo, fontSize: 13, textDecorationLine: 'line-through' },
  iva: { fontFamily: FONT.testo, fontSize: 13 },
  laterale: { alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  foto: { width: 80, height: 80, borderRadius: 8 },
  nonDisponibile: { height: ALTEZZA_STEPPER, justifyContent: 'center' },
  velo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  foglio: { maxHeight: '60%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 14 },
  foglioTitolo: { fontFamily: FONT.nome, fontSize: 16, paddingHorizontal: 16, paddingBottom: 8 },
  opzione: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  opzioneTesto: { fontFamily: FONT.testoMedio, fontSize: 16 },
  fotoVelo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  fotoGrande: { width: '100%', height: '80%', borderRadius: 8 },
  chiudi: {
    position: 'absolute',
    top: 48,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
