import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { useSessione } from '../sessione';
import { Avatar } from './Avatar';

// Il pulsante del profilo in alto a destra: il cerchio blu con le iniziali, come sul sito (.profilo-btn).
export function PulsanteAccount() {
  const { utente } = useSessione();
  return (
    <Pressable
      onPress={() => router.push('/profilo')}
      accessibilityRole="button"
      accessibilityLabel="Il mio account"
      hitSlop={10}
      style={{ paddingHorizontal: 10 }}
    >
      <Avatar nome={utente?.ragione_sociale} misura={36} anello />
    </Pressable>
  );
}
