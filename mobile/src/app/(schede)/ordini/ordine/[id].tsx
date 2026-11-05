import { useLocalSearchParams } from 'expo-router';

import { VistaOrdine } from '@/componenti/VistaOrdine';

export default function OrdineSchermata() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VistaOrdine id={Number(id)} />;
}
