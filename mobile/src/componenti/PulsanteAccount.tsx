import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { useTema } from '../tema';
import { Icona } from './Icona';

export function PulsanteAccount() {
  const { c } = useTema();
  return (
    <Pressable
      onPress={() => router.push('/profilo')}
      accessibilityRole="button"
      accessibilityLabel="Il mio account"
      hitSlop={10}
      style={{ paddingHorizontal: 12 }}
    >
      <Icona nome="persona" colore={c.account} />
    </Pressable>
  );
}
