import { router, useLocalSearchParams } from 'expo-router';

import { VistaRichiesta } from '@/componenti/VistaRichiesta';

export default function RichiestaSchermata() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <VistaRichiesta id={Number(id)} dopoEliminazione={() => router.back()} />;
}
