// "Cambia password" dentro l'app (prima c'era solo sul sito). I controlli sono quelli del server (stessi del sito: password attuale giusta, nuova abbastanza lunga e
// diversa dall'attuale, ripetizione uguale): qui si mostra l'errore sotto il campo che lo ha causato. Cambiata la password il telefono resta dentro (vedi
// `cambiaPassword` in sessione.tsx); gli altri accessi, sito compreso, vengono chiusi dal server.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErroreApi } from '../api';
import { useSessione } from '../sessione';
import { FONT, useTema } from '../tema';
import { Campo } from './Campo';
import { informa } from './dialoghi';
import { Avviso, Bottone } from './ui';

type Errori = { attuale?: string; nuova?: string; ripeti?: string };

export function CambioPassword() {
  const { c } = useTema();
  const { cambiaPassword } = useSessione();
  const [aperto, setAperto] = useState(false);
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [ripeti, setRipeti] = useState('');
  const [errori, setErrori] = useState<Errori>({});
  const [generale, setGenerale] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  // Richiude il modulo e svuota i campi: una password non resta scritta nello stato dopo l'uso.
  const chiudi = () => {
    setAperto(false);
    setAttuale('');
    setNuova('');
    setRipeti('');
    setErrori({});
    setGenerale(null);
  };

  const salva = async () => {
    if (inCorso) return;
    setInCorso(true);
    setErrori({});
    setGenerale(null);
    try {
      await cambiaPassword(attuale, nuova, ripeti);
      chiudi();
      informa('Password cambiata', 'Da ora entri con la nuova password. Gli altri dispositivi e il sito dovranno rifare l’accesso.');
    } catch (e) {
      if (e instanceof ErroreApi && e.dati && typeof e.dati.errori === 'object' && e.dati.errori) {
        setErrori(e.dati.errori as Errori);
      } else {
        setGenerale(e instanceof ErroreApi ? e.message : 'Cambio non riuscito: riprova.');
      }
    } finally {
      setInCorso(false);
    }
  };

  // Come il <details> del sito (.an-pw): il pulsante "Cambia password" apre il modulo sotto di sé e lo richiude; sta dentro la scheda "Accesso".
  const pulsante = (
    <Pressable
      onPress={() => (aperto ? chiudi() : setAperto(true))}
      accessibilityRole="button"
      accessibilityState={{ expanded: aperto }}
      style={({ pressed }) => [stili.pulsante, { backgroundColor: pressed ? c.sfondo : c.superficie }]}
    >
      <Text style={[stili.pulsanteTesto, { color: c.testo }]}>Cambia password</Text>
    </Pressable>
  );

  if (!aperto) return pulsante;

  return (
    <View style={{ gap: 12 }}>
      {pulsante}
      {generale ? <Avviso tipo="errore">{generale}</Avviso> : null}
      <Campo
        etichetta="Password attuale"
        valore={attuale}
        cambia={setAttuale}
        password
        errore={!!errori.attuale}
        aiuto={errori.attuale}
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
      />
      <Campo
        etichetta="Nuova password"
        valore={nuova}
        cambia={setNuova}
        password
        errore={!!errori.nuova}
        aiuto={errori.nuova}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Campo
        etichetta="Ripeti la nuova password"
        valore={ripeti}
        cambia={setRipeti}
        password
        errore={!!errori.ripeti}
        aiuto={errori.ripeti}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Bottone titolo="Salva la nuova password" onPress={salva} inCorso={inCorso} />
    </View>
  );
}

const stili = StyleSheet.create({
  pulsante: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, borderWidth: 1, borderColor: '#d6d1c6', borderRadius: 22 },
  pulsanteTesto: { fontFamily: FONT.testoForte, fontSize: 15 },
});
