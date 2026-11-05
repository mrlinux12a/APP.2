import type { ViewStyle } from 'react-native';

import type { Colori } from '../tema';

// Le righe prodotto di un elenco formano un'unica scheda bianca a tutta larghezza (come `.elenco-righe` del sito su telefono: esce dai margini della pagina, senza
// bordi laterali né angoli arrotondati): bordo solo sopra la prima riga e sotto l'ultima, e 12 px d'aria sopra la prima.
export function stileElencoRighe(c: Colori, indice: number, totale: number): ViewStyle {
  const prima = indice === 0;
  const ultima = indice === totale - 1;
  return {
    marginTop: prima ? 12 : 0,
    backgroundColor: c.superficie,
    borderColor: c.bordo,
    borderTopWidth: prima ? 1 : 0,
    borderBottomWidth: ultima ? 1 : 0,
  };
}
