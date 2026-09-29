import type { ColorValue } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { ICONE, ICONE_CATEGORIA, type NomeIcona } from '../icone';

export function Icona({ nome, dimensione = 22, colore }: { nome: NomeIcona; dimensione?: number; colore: ColorValue }) {
  return <SvgXml xml={ICONE[nome]} width={dimensione} height={dimensione} color={colore} />;
}

export function IconaCategoria({ slug, dimensione = 22, colore }: { slug: string; dimensione?: number; colore: ColorValue }) {
  return (
    <SvgXml
      xml={ICONE_CATEGORIA[slug] || ICONE_CATEGORIA.generico}
      width={dimensione}
      height={dimensione}
      color={colore}
    />
  );
}
