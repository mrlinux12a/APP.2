// Tassonomia del catalogo, ordinata per frequenza d'uso in cantiere e non per
// struttura di magazzino: chi usa l'app è un professionista che cerca UN pezzo in fretta,
// quindi raccorderia, valvolame e minuteria vengono prima di tutto il resto.
//
// Ogni sottocategoria porta con sé le parole con cui la gente la cerca davvero
// (`keywords`) e le misure ricorrenti (`misure`), usate sia per classificare i prodotti
// sia per il filtro per misura.

module.exports = [
  {
    slug: 'raccorderia',
    nome: 'Raccorderia',
    icona: '🔩',
    priorita: 1,
    inEvidenza: true,
    descrizione: 'Raccordi a compressione, filettati, a pressare, scarico e gas',
    sottocategorie: [
      {
        nome: 'Raccordi a compressione (rame/multistrato)',
        keywords: ['raccordo a compressione', 'compressione', 'oliva', 'olive', 'raccordo rame'],
        misure: ['12mm', '14mm', '16mm', '18mm', '20mm', '26mm'],
      },
      {
        nome: 'Raccordi filettati',
        keywords: ['raccordo filettato', 'manicotto', 'gomito', 'tee', 'riduzione', 'nipplo', 'nipples'],
        misure: ['3/8"', '1/2"', '3/4"', '1"', '1"1/4', '1"1/2', '2"'],
      },
      {
        nome: 'Raccordi a pressare (sistema Press)',
        keywords: ['press fitting', 'pressfitting', 'raccordo a pressare', 'a pressare', 'pressare'],
        misure: ['16mm', '20mm', '26mm', '32mm'],
      },
      {
        nome: 'Raccordi rapidi / push-fit',
        keywords: ['raccordo rapido', 'push fit', 'push-fit', 'innesto rapido'],
        misure: [],
      },
      {
        nome: 'Bocchettoni a tre pezzi',
        keywords: ['bocchettone', 'tre pezzi', 'giunto smontabile'],
        misure: [],
      },
      {
        nome: 'Flange e controflange',
        keywords: ['flangia', 'flange', 'controflangia'],
        misure: ['DN25', 'DN32', 'DN40', 'DN50'],
      },
      {
        nome: 'Raccordi per scarico (PVC)',
        keywords: ['raccordo scarico', 'manicotto pvc', 'curva scarico', 'braga'],
        misure: ['32mm', '40mm', '50mm', '110mm'],
      },
      {
        nome: 'Raccordi per gas',
        keywords: ['raccordo gas', 'portagomma gas', 'portagomma'],
        misure: [],
      },
    ],
  },
  {
    slug: 'valvolame',
    nome: 'Valvolame',
    icona: '🔵',
    priorita: 2,
    inEvidenza: true,
    descrizione: 'Intercettazione, ritegno, sicurezza, termostatiche e miscelatori',
    sottocategorie: [
      {
        nome: 'Valvole a sfera',
        keywords: ['valvola a sfera', 'rubinetto a sfera', 'passaggio totale', 'sfera'],
        misure: ['1/2"', '3/4"', '1"'],
      },
      { nome: 'Saracinesche', keywords: ['saracinesca'], misure: [] },
      {
        nome: 'Valvole di ritegno',
        keywords: ['valvola di ritegno', 'ritegno', 'clapet', 'unidirezionale'],
        misure: [],
      },
      {
        nome: 'Valvole di sicurezza',
        keywords: ['valvola di sicurezza', 'scarico pressione', 'sicurezza 3 bar'],
        misure: ['1/2" 3 bar', '3/4" 6 bar'],
      },
      {
        nome: 'Valvole termostatiche per radiatori',
        keywords: ['valvola termostatica', 'testina termostatica', 'detentore'],
        misure: [],
      },
      {
        nome: 'Valvole di zona / sezionamento',
        keywords: ['valvola di zona', 'testina elettrotermica', 'elettrotermica', '2 vie', '3 vie'],
        misure: [],
      },
      {
        nome: 'Rubinetti di arresto',
        keywords: ['rubinetto di arresto', 'sottolavabo', 'arresto'],
        misure: [],
      },
      {
        nome: 'Miscelatori termostatici / anti-scottatura',
        keywords: ['miscelatore termostatico', 'anti scottatura', 'antiscottatura', 'gruppo miscelatore'],
        misure: [],
      },
      {
        nome: 'Valvole di scarico WC / cassetta',
        keywords: ['valvola scarico wc', 'galleggiante', 'meccanismo scarico', 'cassetta'],
        misure: [],
      },
      {
        nome: 'Defangatori e filtri di linea',
        keywords: ['defangatore', 'filtro defangatore', 'filtro y', 'filtro a y'],
        misure: [],
      },
    ],
  },
  {
    slug: 'minuteria',
    nome: 'Minuteria',
    icona: '🔧',
    priorita: 3,
    inEvidenza: true,
    descrizione: 'Guarnizioni, sigillanti, flessibili, sifoni, ricambi',
    sottocategorie: [
      {
        nome: 'Guarnizioni',
        keywords: ['guarnizione', 'o-ring', 'oring', 'guarnizione piatta'],
        misure: [],
      },
      {
        nome: 'Canapa, teflon, pasta sigillante',
        keywords: ['canapa', 'teflon', 'pasta sigillante', 'nastro teflon', 'ptfe', 'silicone', 'sigillante'],
        misure: [],
      },
      {
        nome: 'Fascette stringitubo',
        keywords: ['fascetta', 'stringitubo', 'collare'],
        misure: [],
      },
      {
        nome: 'Flessibili',
        keywords: ['flessibile', 'tubo flessibile', 'flessibile gas'],
        misure: ['30cm', '40cm', '50cm'],
      },
      { nome: 'Sifoni', keywords: ['sifone'], misure: [] },
      { nome: 'Rosoni e coprimuro', keywords: ['rosone', 'coprimuro'], misure: [] },
      { nome: 'Filtri e retine', keywords: ['rompigetto', 'retina', 'filtro aria'], misure: [] },
      { nome: 'Manicotti dielettrici', keywords: ['dielettrico'], misure: [] },
      {
        nome: 'Cartucce e ricambi rubinetteria',
        keywords: ['cartuccia', 'ricambio rubinetto'],
        misure: [],
      },
      { nome: 'Doccini e soffioni', keywords: ['doccino', 'soffione'], misure: [] },
      {
        nome: 'Membrane e presscontrol',
        keywords: ['presscontrol', 'membrana', 'autoclave'],
        misure: [],
      },
      {
        nome: 'Resistenze e termostati scaldabagno',
        keywords: ['resistenza scaldabagno', 'termostato scaldabagno'],
        misure: [],
      },
      { nome: 'Anodi di magnesio', keywords: ['anodo'], misure: [] },
      {
        nome: 'Bulloneria e staffaggio',
        keywords: ['vite', 'tassello', 'bullone', 'staffa', 'staffaggio', 'autofilettante'],
        misure: [],
      },
    ],
  },
  {
    slug: 'tubazioni',
    nome: 'Tubazioni',
    icona: '🪈',
    priorita: 4,
    descrizione: 'Rame, multistrato, PVC, PPR, ferro, corrugato',
    sottocategorie: [
      { nome: 'Tubo rame', keywords: ['tubo rame', 'rame coibentato'], misure: [] },
      { nome: 'Tubo multistrato', keywords: ['multistrato'], misure: ['16mm', '20mm', '26mm', '32mm'] },
      { nome: 'Tubo PVC scarico', keywords: ['tubo pvc', 'tubo scarico'], misure: [] },
      { nome: 'Tubo PPR', keywords: ['ppr'], misure: [] },
      { nome: 'Tubo ferro/acciaio zincato', keywords: ['tubo ferro', 'zincato'], misure: [] },
      { nome: 'Tubo corrugato e canaline', keywords: ['corrugato', 'canalina', 'canale'], misure: [] },
    ],
  },
  {
    slug: 'pompe',
    nome: 'Pompe e circolatori',
    icona: '⚙',
    priorita: 5,
    descrizione: 'Circolatori, elettropompe, autoclavi, scarico condensa',
    sottocategorie: [
      { nome: 'Circolatori riscaldamento', keywords: ['circolatore'], misure: [] },
      { nome: 'Elettropompe', keywords: ['elettropompa'], misure: [] },
      { nome: 'Autoclavi', keywords: ['autoclave'], misure: [] },
      { nome: 'Pompe sommerse', keywords: ['pompa sommersa', 'sommersa'], misure: [] },
      {
        nome: 'Pompe scarico condensa',
        keywords: ['scarico condensa', 'pompa condensa', 'pompa di rilancio', 'pompa di ricircolo'],
        misure: [],
      },
    ],
  },
  {
    slug: 'isolamento',
    nome: 'Isolamento',
    icona: '🧊',
    priorita: 6,
    descrizione: 'Guaine, coppelle, nastri isolanti',
    sottocategorie: [
      { nome: 'Guaine isolanti', keywords: ['guaina'], misure: [] },
      { nome: 'Coppelle', keywords: ['coppella'], misure: [] },
      { nome: 'Nastro isolante per tubi', keywords: ['nastro isolante'], misure: [] },
    ],
  },
  {
    slug: 'trattamento-acqua',
    nome: 'Trattamento acqua',
    icona: '💧',
    priorita: 7,
    descrizione: 'Addolcitori, filtri, dosatori, depuratori',
    sottocategorie: [
      { nome: 'Addolcitori', keywords: ['addolcitore'], misure: [] },
      { nome: 'Filtri acqua', keywords: ['filtro acqua', 'filtro autopulente'], misure: [] },
      { nome: 'Dosatori polifosfati', keywords: ['polifosfat', 'dosatore'], misure: [] },
      { nome: 'Depuratori', keywords: ['depuratore', 'osmosi'], misure: [] },
    ],
  },
  {
    slug: 'riscaldamento',
    nome: 'Riscaldamento',
    icona: '🔥',
    priorita: 8,
    descrizione: 'Caldaie, radiatori, scaldabagni, pompe di calore, termostati',
    sottocategorie: [
      {
        nome: 'Caldaie e ricambi',
        keywords: ['caldaia', 'condensazione', 'scarico fumi', 'coassiale', 'camera stagna'],
        misure: [],
      },
      { nome: 'Radiatori e termosifoni', keywords: ['radiatore', 'termosifone', 'termoarredo'], misure: [] },
      { nome: 'Scaldabagni e scaldacqua', keywords: ['scaldabagno', 'scaldacqua', 'boiler'], misure: [] },
      {
        nome: 'Pompe di calore',
        keywords: ['pompa di calore', 'estia', 'unità idronica', 'idronica', 'acs'],
        misure: [],
      },
      {
        nome: 'Termostati e cronotermostati',
        keywords: ['termostato', 'cronotermostato', 'comando a filo', 'comando remoto', 'sonda'],
        misure: [],
      },
      {
        nome: 'Componenti impianto',
        keywords: ['vaso di espansione', 'vaso espansione', 'collettore', 'accumulo', 'separatore'],
        misure: [],
      },
    ],
  },
  {
    slug: 'climatizzazione',
    nome: 'Climatizzazione',
    icona: '❄',
    priorita: 9,
    descrizione: 'Split, multisplit, VRF, ventilconvettori, VMC e accessori',
    sottocategorie: [
      {
        nome: 'Condizionatori split e multisplit',
        keywords: ['split', 'climatizzatore', 'unità interna', 'unità esterna', 'daiseikai', 'shorai', 'seiya'],
        misure: [],
      },
      { nome: 'Ventilconvettori', keywords: ['ventilconvettore', 'fancoil', 'fan coil'], misure: [] },
      { nome: 'VMC e recuperatori', keywords: ['vmc', 'recuperatore', 'ventilazione'], misure: [] },
      {
        nome: 'Canalizzabili e cassette',
        keywords: ['canalizzabile', 'cassetta', 'griglia', 'uta'],
        misure: [],
      },
      {
        nome: 'Accessori installazione clima',
        keywords: ['gas refrigerante', 'r32', 'r410', 'staffa unità esterna', 'bombola'],
        misure: [],
      },
    ],
  },
  {
    slug: 'sanitari',
    nome: 'Sanitari e rubinetteria',
    icona: '🚿',
    priorita: 10,
    descrizione: 'Rubinetteria, sanitari, piatti e box doccia',
    sottocategorie: [
      { nome: 'Rubinetteria bagno/cucina', keywords: ['rubinetteria', 'miscelatore lavabo', 'lavello'], misure: [] },
      { nome: 'Sanitari e vasi', keywords: ['vaso', 'bidet', 'lavabo', 'sanitario'], misure: [] },
      { nome: 'Piatti doccia', keywords: ['piatto doccia'], misure: [] },
      { nome: 'Box doccia', keywords: ['box doccia', 'cabina doccia'], misure: [] },
    ],
  },
  {
    slug: 'saldatura',
    nome: 'Saldatura e giunzione',
    icona: '🔥',
    priorita: 11,
    descrizione: 'Cannelli, leghe, disossidanti, elettrofusione',
    sottocategorie: [
      { nome: 'Cannelli e bombole gas', keywords: ['cannello', 'bombola gas'], misure: [] },
      { nome: 'Leghe saldanti e stagno', keywords: ['lega saldante', 'stagno', 'bacchetta'], misure: [] },
      { nome: 'Disossidanti', keywords: ['disossidante', 'decapante'], misure: [] },
      { nome: 'Saldatrici a elettrofusione', keywords: ['elettrofusione', 'polifusore'], misure: [] },
    ],
  },
  {
    slug: 'antincendio',
    nome: 'Antincendio',
    icona: '🧯',
    priorita: 12,
    descrizione: 'Valvole, naspi, idranti, estintori',
    sottocategorie: [
      { nome: 'Valvole e raccordi antincendio', keywords: ['antincendio', 'uni 45', 'uni 70'], misure: [] },
      { nome: 'Naspi e idranti', keywords: ['naspo', 'idrante'], misure: [] },
      { nome: 'Estintori', keywords: ['estintore'], misure: [] },
    ],
  },
  {
    slug: 'utensili',
    nome: 'Utensili e attrezzatura',
    icona: '🛠',
    priorita: 13,
    descrizione: 'Chiavi, tagliatubi, curvatubi, filettatrici, pressatrici',
    sottocategorie: [
      { nome: 'Chiavi e pinze', keywords: ['chiave inglese', 'pinza', 'chiave a pappagallo'], misure: [] },
      { nome: 'Tagliatubi', keywords: ['tagliatubi'], misure: [] },
      { nome: 'Curvatubi', keywords: ['curvatubi'], misure: [] },
      { nome: 'Filettatrici', keywords: ['filettatrice'], misure: [] },
      { nome: 'Pressatrici', keywords: ['pressatrice', 'pinza a pressare'], misure: [] },
    ],
  },
  {
    slug: 'sicurezza',
    nome: 'DPI e sicurezza',
    icona: '🦺',
    priorita: 14,
    descrizione: 'Guanti, occhiali, abbigliamento da lavoro',
    sottocategorie: [
      { nome: 'Guanti', keywords: ['guanto', 'guanti'], misure: [] },
      { nome: 'Occhiali protettivi', keywords: ['occhiali protettivi'], misure: [] },
      { nome: 'Abbigliamento da lavoro', keywords: ['abbigliamento', 'scarpe antinfortunistiche'], misure: [] },
    ],
  },
];
