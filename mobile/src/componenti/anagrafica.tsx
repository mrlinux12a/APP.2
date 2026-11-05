// Le schede di "La mia anagrafica" (views/cliente/profilo.ejs, classi .an-*): riquadro bianco con il titolo e, sotto, voci con un quadratino per l'icona, l'etichetta in
// maiuscolo e il valore. Le voci si dividono con una linea sottile; la prima e l'ultima di una scheda non hanno aria in più.
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NomeIcona } from '../icone';
import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

type PropsRiga = {
  icona?: NomeIcona;
  // Il quadratino grande azzurro (44px) del distributore e degli avvisi; senza, quello piccolo grigio (36px).
  blu?: boolean;
  etichetta?: string;
  valore?: string;
  // Il valore in grassetto grande (il nome del distributore) invece del normale.
  grande?: boolean;
  dettaglio?: ReactNode;
  // Numeri e codici con le cifre allineate.
  cifre?: boolean;
  // Un pezzo qualsiasi a destra (l'interruttore degli avvisi, la freccia di un link).
  destra?: ReactNode;
  // Al posto del testo della voce: un pezzo qualsiasi (le colonne di partita IVA e codice fiscale).
  contenuto?: ReactNode;
  // Rende tutta la voce toccabile (le voci di "Informazioni").
  alTocco?: () => void;
  // Il valore con le lettere distanziate (i puntini della password).
  spaziato?: boolean;
  prima?: boolean;
  ultima?: boolean;
};

// Una voce della scheda. `prima` e `ultima` le mette la scheda da sola.
export function RigaAn({ icona, blu, etichetta, valore, grande, dettaglio, cifre, destra, contenuto, alTocco, spaziato, prima, ultima }: PropsRiga) {
  const { c } = useTema();
  const corpo = (
    <View style={[stili.riga, prima && { paddingTop: 0 }, ultima ? { borderBottomWidth: 0, paddingBottom: 0 } : { borderBottomColor: '#ece9e2' }]}>
      {icona ? (
        <View style={[stili.icona, blu && stili.iconaBlu, { backgroundColor: blu ? c.accentoChiaro : '#f1efea' }]}>
          <Icona nome={icona} colore={blu ? c.accento : c.testo} dimensione={blu ? 24 : 20} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {contenuto ?? (
          <>
            {etichetta ? <Text style={[stili.etichetta, { color: c.grigio }]}>{etichetta}</Text> : null}
            {valore ? (
              <Text style={[grande ? stili.grande : stili.valore, cifre && { fontVariant: ['tabular-nums'] }, spaziato && { letterSpacing: 1 }, { color: c.testo }]}>{valore}</Text>
            ) : null}
            {dettaglio ? <Text style={[stili.dettaglio, { color: c.grigio }]}>{dettaglio}</Text> : null}
          </>
        )}
      </View>
      {destra}
    </View>
  );
  if (!alTocco) return corpo;
  return (
    <Pressable onPress={alTocco} accessibilityRole="link">
      {corpo}
    </Pressable>
  );
}

// Una colonna dei dati fiscali (partita IVA, codice fiscale, SDI/PEC): senza icona, due per riga; `largo` la porta a tutta la riga (una PEC è lunga).
export function CellaFiscale({ etichetta, valore, largo }: { etichetta: string; valore: string; largo?: boolean }) {
  const { c } = useTema();
  return (
    <View style={{ width: largo ? '100%' : '46%' }}>
      <Text style={[stili.etichetta, { color: c.grigio }]}>{etichetta}</Text>
      <Text style={[stili.valore, { color: c.testo, fontVariant: ['tabular-nums'] }]}>{valore}</Text>
    </View>
  );
}

// La scheda con il suo titolo. `pericolo`: bordo rosato (Elimina account). Le voci (RigaAn) tra i figli ricevono da sole `prima` e `ultima`.
export function SchedaAn({ titolo, pericolo, children }: { titolo?: string; pericolo?: boolean; children: ReactNode }) {
  const { c } = useTema();
  const figli = Children.toArray(children);
  return (
    <View style={[stili.scheda, { backgroundColor: c.superficie, borderColor: pericolo ? '#f0b9b6' : c.bordo }]}>
      {titolo ? <Text style={[stili.titolo, { color: c.testo }]}>{titolo}</Text> : null}
      {figli.map((f, i) =>
        isValidElement(f) && f.type === RigaAn
          ? cloneElement(f as ReactElement<PropsRiga>, { prima: i === 0, ultima: i === figli.length - 1 })
          : f
      )}
    </View>
  );
}

const stili = StyleSheet.create({
  scheda: { borderWidth: 1, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14 },
  titolo: { marginBottom: 14, fontFamily: FONT.titolo, fontSize: 15 },
  riga: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  icona: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  iconaBlu: { width: 44, height: 44, borderRadius: 12 },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 12, lineHeight: 16, letterSpacing: 0.72, textTransform: 'uppercase' },
  valore: { marginTop: 2, fontFamily: FONT.testoForte, fontSize: 15, lineHeight: 20 },
  grande: { fontFamily: FONT.titolo, fontSize: 17, lineHeight: 21 },
  dettaglio: { marginTop: 2, fontFamily: FONT.testo, fontSize: 14, lineHeight: 19 },
});
