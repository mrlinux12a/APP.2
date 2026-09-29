import { router, useLocalSearchParams } from 'expo-router';

import { VistaOrdine } from '@/componenti/VistaOrdine';

export default function OrdineSchermata() {
  const { id, nuovo } = useLocalSearchParams<{ id: string; nuovo?: string }>();
  return <VistaOrdine id={Number(id)} nuovo={nuovo === '1'} dopoEliminazione={() => router.back()} />;
}
