import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { FONT, useTema, useTemaAccesso } from '../tema';
import { Icona } from './Icona';

// Un campo di testo con la sua etichetta, come .acc-campo del sito (views/partials/comune/acc_campo.ejs): etichetta in grassetto sopra, campo alto 52 con il bordo
// beige e gli angoli tondi, sotto una riga grigia (`aiuto`, o "Facoltativo") che diventa rossa quando il campo è sbagliato, e sulla password l'occhio per mostrarla.
// Il campo attivo (`input:focus` del sito) ha il bordo nel colore dell'accento e un alone di 3 px nel suo tono chiaro: blu per l'installatore, giallo per il
// corriere (`TemaAccesso`). Se il campo è sbagliato il bordo resta rosso e l'alone c'è lo stesso, come sul sito.
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
  const t = useTemaAccesso();
  const [visibile, setVisibile] = useState(false);
  const [attivo, setAttivo] = useState(false);
  // Sotto il campo: l'aiuto scritto da chi lo usa (o l'errore del server); senza, per i campi non obbligatori, "Facoltativo".
  const riga = aiuto || (facoltativo ? 'Facoltativo' : '');
  return (
    <View>
      <Text style={[stili.etichetta, { color: c.testo }]}>{etichetta}</Text>
      <View>
        {/* L'alone è un riquadro di 3 px intorno al campo con margine negativo: occupa lo stesso posto di prima, quindi accendersi non sposta niente. */}
        <View style={[stili.alone, { backgroundColor: attivo ? t.accentoChiaro : 'transparent' }]}>
          <TextInput
            value={valore}
            onChangeText={cambia}
            secureTextEntry={!!password && !visibile}
            placeholderTextColor="#8a897e"
            accessibilityLabel={etichetta}
            // Una password non va mai maiuscola da sola né corretta dalla tastiera (con l'occhio la prima lettera comparirebbe maiuscola); chi usa il campo può
            // comunque cambiarlo, perché `...resto` viene dopo.
            autoCapitalize={password ? 'none' : undefined}
            autoCorrect={password ? false : undefined}
            spellCheck={password ? false : undefined}
            // Con la password in chiaro alcune tastiere Android (Samsung) ignorano `autoCapitalize` e mettono la prima lettera maiuscola: la tastiera "password
            // visibile" non lo fa mai.
            keyboardType={password && visibile && Platform.OS === 'android' ? 'visible-password' : undefined}
            style={[stili.campo, { color: c.testo, borderColor: errore ? c.rosso : attivo ? t.accento : '#d6d1c6', paddingRight: password ? 52 : 16 }]}
            {...resto}
            onFocus={(e) => {
              setAttivo(true);
              resto.onFocus?.(e);
            }}
            onBlur={(e) => {
              setAttivo(false);
              resto.onBlur?.(e);
            }}
          />
        </View>
        {password ? (
          <Pressable
            onPress={() => setVisibile(!visibile)}
            accessibilityRole="button"
            accessibilityLabel={visibile ? 'Nascondi la password' : 'Mostra la password'}
            accessibilityState={{ selected: visibile }}
            hitSlop={4}
            style={stili.occhio}
          >
            <Icona nome={visibile ? 'occhioBarrato' : 'occhio'} colore="#5c5b52" dimensione={22} />
          </Pressable>
        ) : null}
      </View>
      {riga ? <Text style={[stili.aiuto, errore ? { color: c.rosso, fontFamily: FONT.testoMedio } : { color: c.grigio }]}>{riga}</Text> : null}
    </View>
  );
}

const stili = StyleSheet.create({
  etichetta: { marginBottom: 6, fontFamily: FONT.testoForte, fontSize: 14 },
  alone: { margin: -3, padding: 3, borderRadius: 17 },
  campo: { height: 52, paddingHorizontal: 16, borderWidth: 1.5, borderRadius: 14, backgroundColor: '#ffffff', fontSize: 16, fontFamily: FONT.testo },
  occhio: { position: 'absolute', top: 4, right: 4, width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  aiuto: { marginTop: 6, fontFamily: FONT.testo, fontSize: 13, lineHeight: 17 },
});
