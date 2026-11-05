// Il cerchio blu con le iniziali (views/partials/comune/iniziali.ejs del sito): pulsante del profilo in alto e pagina "La mia anagrafica". Le iniziali sono le prime due
// parole significative della ragione sociale, senza congiunzioni né forma societaria ("Rossi Impianti S.r.l." → RI); con una parola sola le sue prime due lettere
// ("Borea" → BO). Se non c'è niente da cui ricavarle, l'omino.
import { StyleSheet, Text, View } from 'react-native';

import { FONT, useTema } from '../tema';
import { Icona } from './Icona';

// Parole che non fanno parte del nome (congiunzioni, articoli, forme societarie): come NON_NOME del sito.
const NON_NOME = ['e', 'di', 'de', 'del', 'della', 'dei', 'il', 'la', '&', 'srl', 'srls', 'spa', 'snc', 'sas', 'sapa', 'sdf', 'ss', 'scarl', 'coop', 'soc'];

// Le iniziali di un nome: due lettere maiuscole, o stringa vuota se non ce ne sono.
export function inizialiDi(testo: string | null | undefined) {
  const parole = String(testo ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^(l|d|dell|dall|all|nell|sull|un)['’]/i, '')) // "L'Idraulica" → "Idraulica"
    .filter((p) => /^\p{L}/u.test(p) && !NON_NOME.includes(p.toLowerCase().replace(/[.,]/g, '')));
  if (parole.length > 1) return (parole[0][0] + parole[1][0]).toUpperCase();
  return [...(parole[0] || '')]
    .filter((ch) => /\p{L}/u.test(ch))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// Il corpo del testo per ogni misura del cerchio (36, 40, 42, 48, 56), come .avatar-NN del sito.
const CORPO: Record<number, number> = { 36: 13, 40: 14, 42: 15, 48: 17, 56: 20 };

// `anello`: il cerchio chiaro attorno (3px) che il sito mette sul pulsante del profilo.
export function Avatar({ nome, persona, misura = 56, anello = false }: { nome: string | null | undefined; persona?: string | null; misura?: 36 | 40 | 42 | 48 | 56; anello?: boolean }) {
  const { c } = useTema();
  const sigla = inizialiDi(nome) || inizialiDi(persona);
  const cerchio = (
    <View style={[stili.cerchio, { width: misura, height: misura, borderRadius: misura / 2, backgroundColor: c.accento }]} accessible={false}>
      {sigla ? (
        <Text style={[stili.sigla, { color: c.suAccento, fontSize: CORPO[misura] }]}>{sigla}</Text>
      ) : (
        <Icona nome="persona" colore={c.suAccento} dimensione={Math.round(misura * 0.55)} />
      )}
    </View>
  );
  if (!anello) return cerchio;
  return <View style={{ padding: 3, borderRadius: (misura + 6) / 2, backgroundColor: c.accentoChiaro }}>{cerchio}</View>;
}

const stili = StyleSheet.create({
  cerchio: { alignItems: 'center', justifyContent: 'center' },
  sigla: { fontFamily: FONT.titolo },
});
