import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { FONT, useTema } from '../tema';

// Un campo di testo con la sua etichetta, come .acc-campo del sito: etichetta sopra, "Facoltativo" a destra, errore evidenziato in rosso, occhio sulla password.
export function Campo({
  etichetta,
  valore,
  cambia,
  facoltativo,
  errore,
  password,
  aiuto,
  ...resto
}: {
  etichetta: string;
  valore: string;
  cambia: (v: string) => void;
  facoltativo?: boolean;
  errore?: boolean;
  password?: boolean;
  aiuto?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'secureTextEntry'>) {
  const { c } = useTema();
  const [visibile, setVisibile] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <View style={stili.testa}>
        <Text style={[stili.etichetta, { color: c.testo }]}>{etichetta}</Text>
        {facoltativo ? <Text style={[stili.facoltativo, { color: c.grigio }]}>Facoltativo</Text> : null}
      </View>
      <View>
        <TextInput
          value={valore}
          onChangeText={cambia}
          secureTextEntry={!!password && !visibile}
          placeholderTextColor={c.grigio}
          accessibilityLabel={etichetta}
          style={[
            stili.campo,
            { color: c.testo, borderColor: errore ? c.rosso : c.bordo, backgroundColor: c.sfondo, paddingRight: password ? 56 : 12 },
          ]}
          {...resto}
        />
        {password ? (
          <Pressable
            onPress={() => setVisibile(!visibile)}
            accessibilityRole="button"
            accessibilityLabel={visibile ? 'Nascondi la password' : 'Mostra la password'}
            hitSlop={8}
            style={stili.occhio}
          >
            <Text style={[stili.occhioTesto, { color: c.accento }]}>{visibile ? 'Nascondi' : 'Mostra'}</Text>
          </Pressable>
        ) : null}
      </View>
      {aiuto ? <Text style={[stili.aiuto, { color: errore ? c.rosso : c.grigio }]}>{aiuto}</Text> : null}
    </View>
  );
}

const stili = StyleSheet.create({
  testa: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  etichetta: { fontFamily: FONT.testoMedio, fontSize: 15 },
  facoltativo: { fontFamily: FONT.testo, fontSize: 13 },
  campo: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, fontFamily: FONT.testo, minHeight: 48 },
  occhio: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  occhioTesto: { fontFamily: FONT.testoForte, fontSize: 13 },
  aiuto: { fontFamily: FONT.testo, fontSize: 13 },
});
