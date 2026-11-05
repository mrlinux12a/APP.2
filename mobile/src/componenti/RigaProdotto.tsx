import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';

import { urlFoto, type Disponibilita, type Prodotto, type Variante } from '../api';
import { carrello, useQuantitaNelCarrello, type DatiRiga } from '../carrello';
import { FONT, useTema, type Colori } from '../tema';
import { Icona } from './Icona';

// Una riga compatta del catalogo, come views/partials/cliente/prodotto_riga.ejs del sito: foto 56×56 a sinistra, nome, (misura), prezzo `+ IVA` e lo stepper
// `− N +` che mostra la quantità GIÀ nel carrello e la salva a ogni tocco (niente "Aggiungi": richiesta esplicita del 16/10/2026). Niente "Disponibile" né
// "Nel carrello: N pz": si scrive solo uno stato diverso da "disponibile". Se i due markup del sito cambiano, questo file va allineato.

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
  const v: Variante | undefined = p.varianti?.find((x) => x.id === id);
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

// Come sul sito (misura.ejs): si parte dalla misura del prodotto stesso, se è fra le varianti, altrimenti dalla prima.
function idIniziale(p: Prodotto) {
  const varianti = p.varianti || [];
  return varianti.some((v) => v.id === p.id) ? p.id : varianti.length ? varianti[0].id : p.id;
}

export function coloriDisponibilita(c: Colori, d: Disponibilita) {
  if (d === 'disponibile') return { sfondo: c.verdeChiaro, testo: c.verde };
  if (d === 'in_esaurimento') return { sfondo: c.arancioChiaro, testo: c.arancio };
  return { sfondo: c.rossoChiaro, testo: c.rosso };
}

const MENO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>';
const PIU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>';
const FRECCIA_GIU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

// `− N +`: a 0 bordo neutro e numero grigio, sopra 0 bordo e numero blu (il bordo è sempre da 1,5: cambia solo colore, lo stepper non si sposta).
function StepperRiga({ valore, cambia, nome }: { valore: number; cambia: (n: number) => void; nome: string }) {
  const { c } = useTema();
  const attivo = valore > 0;
  return (
    <View style={[stili.stepper, { borderColor: attivo ? c.accento : c.bordo }]}>
      <Pressable
        onPress={() => cambia(Math.max(0, valore - 1))}
        disabled={!attivo}
        hitSlop={2}
        accessibilityRole="button"
        accessibilityLabel={'Togli uno: ' + nome}
        style={({ pressed }) => [stili.passo, { backgroundColor: c.superficie, opacity: !attivo ? 0.4 : pressed ? 0.6 : 1 }]}
      >
        <SvgXml xml={MENO} width={18} height={18} color={c.accento} />
      </Pressable>
      <Text style={[stili.qta, { color: attivo ? c.accento : c.grigio, fontFamily: attivo ? FONT.titolo : FONT.nome }]} accessibilityLiveRegion="polite">
        {valore}
      </Text>
      <Pressable
        onPress={() => cambia(Math.min(9999, valore + 1))}
        hitSlop={2}
        accessibilityRole="button"
        accessibilityLabel={'Aggiungi uno: ' + nome}
        style={({ pressed }) => [stili.passo, { backgroundColor: c.superficie, opacity: pressed ? 0.6 : 1 }]}
      >
        <SvgXml xml={PIU} width={18} height={18} color={c.accento} />
      </Pressable>
    </View>
  );
}

// La scelta della misura (o variante), come misura.ejs: occhiello, poi due chip affiancati oppure, da tre varianti in su, un pulsante con ▾ che apre il pannello
// dal basso (una riga per variante con pallino e prezzo: toccarla applica subito la misura; "Conferma" e il velo chiudono soltanto).
function Misura({ p, idScelto, scegli }: { p: Prodotto; idScelto: number; scegli: (id: number) => void }) {
  const { c } = useTema();
  const [pannello, setPannello] = useState(false);
  const varianti = p.varianti || [];
  const info = p.varianti_info || { voce: 'Misura', ordine: '', occhiello: 'Misura', titolo: 'Scegli la misura' };
  const scelta = varianti.find((v) => v.id === idScelto) || varianti[0];
  const molte = varianti.length >= 3;

  return (
    <View style={stili.misura}>
      <Text style={[stili.occhiello, { color: c.grigio }]}>
        {info.occhiello}
        {molte ? ` · ${varianti.length} disponibili` : ''}
      </Text>
      {molte ? (
        <Pressable
          onPress={() => setPannello(true)}
          accessibilityRole="button"
          accessibilityLabel={`${info.voce} di ${p.nome}: ${scelta?.etichetta ?? ''}`}
          style={[stili.apri, { borderColor: c.accento, backgroundColor: c.accentoChiaro }]}
        >
          <Text style={[stili.apriTesto, { color: c.accentoScuro }]}>{scelta?.etichetta}</Text>
          <SvgXml xml={FRECCIA_GIU} width={16} height={16} color={c.accentoScuro} />
        </Pressable>
      ) : (
        <View style={stili.chipRiga} accessibilityRole="radiogroup" accessibilityLabel={`${info.voce} di ${p.nome}`}>
          {varianti.map((v) => {
            const attiva = v.id === idScelto;
            return (
              <Pressable
                key={v.id}
                onPress={() => scegli(v.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: attiva }}
                style={[stili.chip, { borderColor: attiva ? c.accento : '#d6d1c6', backgroundColor: attiva ? c.accentoChiaro : '#ffffff' }]}
              >
                <Text style={[stili.chipTesto, { color: attiva ? c.accentoScuro : c.testo }]}>{v.etichetta}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={pannello} transparent animationType="none" onRequestClose={() => setPannello(false)}>
        <View style={stili.velo}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPannello(false)} accessibilityLabel="Chiudi" />
          <SafeAreaView edges={['bottom']} style={[stili.pannello, { backgroundColor: '#ffffff' }]}>
            <View style={stili.maniglia} />
            <Text style={[stili.pannelloTitolo, { color: c.testo }]}>{info.titolo}</Text>
            <Text style={[stili.pannelloSotto, { color: c.grigio }]} numberOfLines={2}>
              {p.nome}
              {info.ordine ? ' · ' + info.ordine : ''}
            </Text>
            <ScrollView style={stili.elenco} contentContainerStyle={{ gap: 8, paddingVertical: 3 }}>
              {varianti.map((v) => {
                const attiva = v.id === idScelto;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => scegli(v.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: attiva }}
                    style={[stili.riga, { borderColor: attiva ? c.accento : '#d6d1c6', backgroundColor: attiva ? c.accentoChiaro : '#ffffff' }]}
                  >
                    <View style={[stili.radio, attiva ? { borderColor: c.accento, backgroundColor: c.accento } : { borderColor: '#b9b4a8' }]}>
                      {attiva ? <View style={stili.radioPunto} /> : null}
                    </View>
                    <Text style={[stili.rigaTesto, { color: c.testo }]}>{v.etichetta}</Text>
                    <Text style={[stili.rigaPrezzo, { color: attiva ? c.testo : c.grigio }]}>€ {v.prezzo}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setPannello(false)}
              accessibilityRole="button"
              style={({ pressed }) => [stili.conferma, { backgroundColor: pressed ? c.accentoScuro : c.accento }]}
            >
              <Text style={[stili.confermaTesto, { color: c.suAccento }]}>Conferma</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function RigaProdottoBase({ p, ultima = false }: { p: Prodotto; ultima?: boolean }) {
  const { c } = useTema();
  const [idScelto, setIdScelto] = useState(() => idIniziale(p));
  const [fotoAperta, setFotoAperta] = useState(false);

  const s = sceltaDi(p, idScelto);
  const disp = coloriDisponibilita(c, s.disponibilita);
  const conVarianti = !!p.varianti && p.varianti.length > 0;
  const nelCarrello = useQuantitaNelCarrello(s.id);
  const dati = datiRiga(p, s);

  const foto = p.foto_url ? (
    <Pressable onPress={() => setFotoAperta(true)} accessibilityLabel={'Foto di ' + p.nome} accessibilityRole="imagebutton">
      <Image source={urlFoto(p.foto_url)} style={stili.foto} contentFit="cover" cachePolicy="memory-disk" transition={0} />
    </Pressable>
  ) : (
    <View style={[stili.foto, stili.fotoVuota]}>
      <Icona nome="ordini" colore="#a3a094" dimensione={28} />
    </View>
  );

  const nome = (
    <Text style={[stili.nome, { color: c.testo }]} numberOfLines={3}>
      {p.brand_nome ? <Text style={[stili.marchio, { backgroundColor: p.brand_colore || c.accento }]}> {p.brand_nome} </Text> : null}
      {p.brand_nome ? ' ' : ''}
      {p.nome}
    </Text>
  );

  const stato =
    s.disponibilita !== 'disponibile' ? (
      <View style={stili.stato}>
        <Text style={[stili.badge, { backgroundColor: disp.sfondo, color: disp.testo }]}>{s.disponibilita_testo}</Text>
      </View>
    ) : null;

  const prezzo = (
    <View style={stili.prezzoBlocco}>
      <Text style={[stili.prezzo, { color: c.testo }]}>
        {s.sconto_base_pct > 0 ? <Text style={[stili.barrato, { color: '#a7a498' }]}>€ {s.listino}  </Text> : null}€ {s.prezzo}
        <Text style={[stili.iva, { color: c.grigio }]}> + IVA</Text>
      </Text>
      {s.raee ? <Text style={[stili.raee, { color: c.grigio }]}>RAEE € {s.raee}</Text> : null}
    </View>
  );

  const stepper =
    s.disponibilita === 'non_disponibile' ? null : <StepperRiga valore={nelCarrello} cambia={(n) => carrello.imposta(dati, n)} nome={p.nome} />;

  return (
    <View style={[stili.riga0, { borderBottomColor: '#ece9e2', borderBottomWidth: ultima ? 0 : 1 }]}>
      {foto}
      {conVarianti ? (
        // Con le misure: nome, misura, stato e in fondo, sulla stessa riga, prezzo a sinistra e stepper a destra (la misura ha tutta la larghezza).
        <View style={stili.info}>
          {nome}
          <Misura p={p} idScelto={idScelto} scegli={setIdScelto} />
          {stato}
          <View style={stili.prezzoStepper}>
            <View style={{ flex: 1, minWidth: 0 }}>{prezzo}</View>
            {stepper}
          </View>
        </View>
      ) : (
        <>
          <View style={stili.info}>
            {nome}
            {stato}
            {prezzo}
          </View>
          {stepper}
        </>
      )}

      <Modal visible={fotoAperta} transparent animationType="none" onRequestClose={() => setFotoAperta(false)}>
        <Pressable style={stili.fotoVelo} onPress={() => setFotoAperta(false)}>
          {p.foto_url ? (
            <Image source={urlFoto(p.foto_url)} style={[stili.fotoGrande, { backgroundColor: c.superficie }]} contentFit="contain" transition={0} />
          ) : null}
          <View style={stili.chiudi}>
            <Icona nome="chiudi" colore="#ffffff" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export const RigaProdotto = memo(RigaProdottoBase);

const stili = StyleSheet.create({
  riga0: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  foto: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#f1efea' },
  fotoVuota: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  // Sito: .riga-nome = Sora 600, 14.5px, interlinea 1.25, fino a 3 righe.
  nome: { fontFamily: FONT.nome, fontSize: 14.5, lineHeight: 18 },
  marchio: { color: '#fff', fontFamily: FONT.testoForte, fontSize: 11, letterSpacing: 0.4 },
  stato: { marginTop: 4, alignItems: 'flex-start' },
  badge: { fontFamily: FONT.testoMedio, fontSize: 12, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  prezzoBlocco: { marginTop: 4 },
  prezzo: { fontFamily: FONT.titolo, fontSize: 16, lineHeight: 21 },
  barrato: { fontFamily: FONT.testo, fontSize: 13, textDecorationLine: 'line-through' },
  iva: { fontFamily: FONT.testo, fontSize: 13 },
  raee: { fontFamily: FONT.testo, fontSize: 12 },
  prezzoStepper: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 2, borderWidth: 1.5, borderRadius: 22, backgroundColor: '#f7f6f2' },
  passo: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', elevation: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } },
  qta: { minWidth: 32, paddingHorizontal: 2, textAlign: 'center', fontSize: 16, fontVariant: ['tabular-nums'] },
  // Misura
  misura: { marginTop: 8 },
  occhiello: { fontFamily: FONT.testoForte, fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 6 },
  chipRiga: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 40, maxWidth: '100%', paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 12, justifyContent: 'center' },
  chipTesto: { fontFamily: FONT.testoForte, fontSize: 14, lineHeight: 17 },
  apri: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, minHeight: 40, paddingLeft: 14, paddingRight: 12, borderWidth: 1.5, borderRadius: 12 },
  apriTesto: { flexShrink: 1, fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 18 },
  // Pannello dal basso
  velo: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(28, 25, 23, 0.4)' },
  pannello: { maxHeight: '70%', paddingTop: 10, paddingHorizontal: 16, paddingBottom: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  maniglia: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#d6d1c6', alignSelf: 'center', marginBottom: 16 },
  pannelloTitolo: { fontFamily: FONT.titolo, fontSize: 18, lineHeight: 23 },
  pannelloSotto: { fontFamily: FONT.testo, fontSize: 14, lineHeight: 18, marginTop: 4 },
  elenco: { flexGrow: 0, marginTop: 12 },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 14 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  radioPunto: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  rigaTesto: { flex: 1, minWidth: 0, fontFamily: FONT.testoForte, fontSize: 16, lineHeight: 20 },
  rigaPrezzo: { fontFamily: FONT.testoForte, fontSize: 15, fontVariant: ['tabular-nums'] },
  conferma: { height: 52, marginTop: 16, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  confermaTesto: { fontFamily: FONT.titolo, fontSize: 16 },
  // Foto grande
  fotoVelo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  fotoGrande: { width: '100%', height: '80%', borderRadius: 8 },
  chiudi: { position: 'absolute', top: 48, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
});
