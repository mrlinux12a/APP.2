import type { ViewStyle } from 'react-native';

import { RAGGIO, type Colori } from '../tema';

// Righe di un elenco disegnate come un'unica card (come .card.card-fitta sul sito): stesso
// colore di fondo del riquadro foto, così lo spazio attorno alle foto si confonde con la
// card invece di staccarsi dallo sfondo della pagina.
export function stileRigaCard(c: Colori, indice: number, totale: number): ViewStyle {
  const prima = indice === 0;
  const ultima = indice === totale - 1;
  return {
    marginHorizontal: 14,
    backgroundColor: c.superficie,
    borderColor: c.bordo,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: prima ? 1 : 0,
    borderBottomWidth: ultima ? 1 : 0,
    borderTopLeftRadius: prima ? RAGGIO : 0,
    borderTopRightRadius: prima ? RAGGIO : 0,
    borderBottomLeftRadius: ultima ? RAGGIO : 0,
    borderBottomRightRadius: ultima ? RAGGIO : 0,
  };
}
