// Finestre di conferma native (Alert). Nel browser (solo sviluppo, expo start --web) Alert
// non mostra i pulsanti: si ripiega su window.confirm / window.alert.
import { Alert, Platform } from 'react-native';

export function informa(titolo: string, messaggio: string) {
  if (Platform.OS === 'web') return window.alert(titolo + '\n\n' + messaggio);
  Alert.alert(titolo, messaggio);
}

// Chiede conferma prima di un'azione; "Annulla" non fa nulla.
export function chiedi(titolo: string, messaggio: string, conferma: string, azione: () => void, distruttiva = false) {
  if (Platform.OS === 'web') {
    if (window.confirm(titolo + '\n\n' + messaggio)) azione();
    return;
  }
  Alert.alert(titolo, messaggio, [
    { text: 'Annulla', style: 'cancel' },
    { text: conferma, style: distruttiva ? 'destructive' : 'default', onPress: azione },
  ]);
}
