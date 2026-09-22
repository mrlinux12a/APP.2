// Popola sottocategorie + product_sottocategorie per tutte le macro categorie (tranne
// "generico", che resta senza sottocategorie: il codice esistente la sfoglia già
// direttamente, vedi sfogliaDiretto in server.js).
//
// Fonte dati: la colonna products.categoria (testo del fornitore, valorizzata al 100% dei
// prodotti attivi) è il segnale principale — è già quasi sempre un raggruppamento
// merceologico sensato. Dove è troppo generica o è il nome di una linea/brand
// (es. "Idrotermosanitario", "Profipress", "Icon"), si passa a un secondo livello di
// parole chiave sul nome prodotto, con la stessa logica di corrispondenza per
// sottostringa già usata in src/catalogo.js.
//
// Regola di assegnazione: 0 corrispondenze di parole chiave -> sottocategoria "varie"
// della macro (garantisce copertura 100%, necessaria perché la navigazione filtra le
// sottocategorie censite); 1 corrispondenza -> quella; 2+ corrispondenze -> tutte
// (il caso "indeciso, in entrambe" richiesto).
//
// Uso:  node scripts/assegna_sottocategorie.js
// Idempotente: cancella e ricrea sottocategorie/product_sottocategorie per le macro
// gestite qui, tutto dentro un'unica transazione.
require('dotenv').config();
const db = require('../db');

const MACRO_CONFIG = {
  'riscaldamento-e-caldaie': {
    subcategorie: [
      { slug: 'caldaie', nome: 'Caldaie' },
      { slug: 'canne-fumarie-doppia-parete', nome: 'Canne fumarie doppia parete' },
      { slug: 'canne-fumarie-monoparete', nome: 'Canne fumarie monoparete e coassiali' },
      { slug: 'stufe-pellet-legna', nome: 'Stufe a pellet, legna e combustibili' },
      { slug: 'radiatori-e-termostatici', nome: 'Radiatori e valvole termostatiche' },
      { slug: 'impianti-radianti', nome: 'Impianti radianti a pavimento' },
      { slug: 'collettori-e-distribuzione', nome: 'Collettori e distribuzione' },
      { slug: 'contabilizzazione', nome: 'Contabilizzazione calore' },
      { slug: 'isolamento-e-sicurezza', nome: 'Isolamento e sicurezza impianto' },
      { slug: 'solare-termico', nome: 'Solare termico' },
      { slug: 'componenti-controllo-caldaia', nome: 'Regolazione e componenti di controllo' },
    ],
    categoriaMap: {
      'caldaia': 'caldaie',
      'caldaie': 'caldaie',
      'sistemi ibridi': 'caldaie',
      'alta potenza': 'caldaie',
      'efficientamento energetico': 'caldaie',
      'doppia parete coiben. lana minerale inox': 'canne-fumarie-doppia-parete',
      'doppia parete coibentato aria inox': 'canne-fumarie-doppia-parete',
      'doppia parete coibentato aria plastica': 'canne-fumarie-doppia-parete',
      'monoparete rigido e flessibile inox': 'canne-fumarie-monoparete',
      'monoparete rigido e flessibile plastica': 'canne-fumarie-monoparete',
      'coassiali plastica': 'canne-fumarie-monoparete',
      'coassiale per caminetti a gas': 'canne-fumarie-monoparete',
      'attraversamento tetto': 'canne-fumarie-monoparete',
      'fumisteria': 'canne-fumarie-monoparete',
      'applicazioni industriale inox': 'canne-fumarie-monoparete',
      'monop. e doppiap. sistemi legna/pellet': 'stufe-pellet-legna',
      'combustibili': 'stufe-pellet-legna',
      'termostatici': 'radiatori-e-termostatici',
      'valvole radiatori controllo terminale': 'radiatori-e-termostatici',
      'distribuzione radiatori e fancoil': 'radiatori-e-termostatici',
      'valv/componenti x rad/contab.indiretta': 'radiatori-e-termostatici',
      'comfort climatico-accessori sistemi rad.': 'radiatori-e-termostatici',
      'sistemi di climatizzazione radiante': 'impianti-radianti',
      'sistemi di pannelli radianti': 'impianti-radianti',
      'sist.climatiz. radiante-termoregolazione': 'impianti-radianti',
      'sanitherm ng': 'impianti-radianti',
      'comfort climatico-tubazioni': 'impianti-radianti',
      'collettori di distribuzione': 'collettori-e-distribuzione',
      'comfort climatico-collettori': 'collettori-e-distribuzione',
      'comfort climatico-gruppi miscelazione': 'collettori-e-distribuzione',
      'moduli utenza': 'collettori-e-distribuzione',
      'collettori sanitari componibili': 'collettori-e-distribuzione',
      'componenti centr.term/distribuz.a zone': 'collettori-e-distribuzione',
      'bilanciamento idraulico': 'collettori-e-distribuzione',
      'termoregolazione': 'collettori-e-distribuzione',
      'comfort climatico-cassette contenimento': 'collettori-e-distribuzione',
      'contabilizzazione diretta': 'contabilizzazione',
      "contab.diretta energia/consumi idrici": 'contabilizzazione',
      'contabilizzazione indiretta': 'contabilizzazione',
      'isolamento': 'isolamento-e-sicurezza',
      'comfort climatico-pannelli isolanti': 'isolamento-e-sicurezza',
      'comfort climatico-panello isolante secco': 'isolamento-e-sicurezza',
      'componenti di controllo e sicurezza': 'isolamento-e-sicurezza',
      'solare termico': 'solare-termico',
    },
    keywordLayer: [
      { slug: 'caldaie', keywords: ['caldaia', 'caldaie', 'ibrido', 'condensazione', 'camera stagna', 'camera aperta'] },
      { slug: 'radiatori-e-termostatici', keywords: ['radiatore', 'termostatic', 'testina', 'detentore', 'fancoil'] },
      { slug: 'impianti-radianti', keywords: ['radiante', 'pavimento radiante', 'massetto'] },
      { slug: 'collettori-e-distribuzione', keywords: ['collettore', 'miscelazione', 'distributore', 'cassetta', 'cassaforma', 'incasso'] },
      { slug: 'isolamento-e-sicurezza', keywords: ['guaina', 'isolante', 'coppella', 'valvola di sicurezza', 'manometro'] },
      { slug: 'solare-termico', keywords: ['solare', 'pannello solare'] },
      { slug: 'canne-fumarie-monoparete', keywords: ['coassiale', 'scarico fumi', 'canna fumaria'] },
      { slug: 'componenti-controllo-caldaia', keywords: ['sensore', 'sonda', 'elettrovalvola', 'bobina', 'regolatore', 'resistenza elettrica', 'scambiatore', 'centralina', 'modulo idrico', 'wi-fi', 'contatore'] },
      { slug: 'contabilizzazione', keywords: ['contatore'] },
    ],
  },

  'raccorderia-e-valvole': {
    subcategorie: [
      { slug: 'valvole-a-sfera', nome: 'Valvole e rubinetti a sfera' },
      { slug: 'valvole-industriali-motorizzate', nome: 'Valvole industriali e motorizzate' },
      { slug: 'rubinetti-e-valvole-varie', nome: 'Rubinetti e valvole varie' },
      { slug: 'raccordi-ottone-bronzo', nome: 'Raccordi in ottone e bronzo' },
      { slug: 'raccordi-a-saldare', nome: 'Raccordi a saldare' },
      { slug: 'raccordi-a-pressare', nome: 'Raccordi a pressare' },
    ],
    categoriaMap: {
      'valvole sfera ottone': 'valvole-a-sfera',
      'valvole sfera gas': 'valvole-a-sfera',
      'rubinetti sfera acqua': 'valvole-a-sfera',
      'valvole a sfera di ritegno e accessori': 'valvole-a-sfera',
      'valvole e rubinetti a sfera': 'valvole-a-sfera',
      'rubinetti a squadra': 'valvole-a-sfera',
      'valvole industriali': 'valvole-industriali-motorizzate',
      'valvole motorizzate pneumatiche': 'valvole-industriali-motorizzate',
      'valvole motorizzate elettriche': 'valvole-industriali-motorizzate',
      'valvole farfalla': 'valvole-industriali-motorizzate',
      'valvole di zona': 'valvole-industriali-motorizzate',
      'valvole e rubinetti': 'rubinetti-e-valvole-varie',
      'riduzione della pressione': 'rubinetti-e-valvole-varie',
      'allacciamenti acqua/gas': 'rubinetti-e-valvole-varie',
      'raccordi ottone e bronzo': 'raccordi-ottone-bronzo',
      'raccordi filettati bronzo': 'raccordi-ottone-bronzo',
      'raccorderia': 'raccordi-ottone-bronzo',
      'raccordi a saldare': 'raccordi-a-saldare',
      'raccordi rame a saldare': 'raccordi-a-saldare',
      'raccordi a pressione': 'raccordi-a-pressare',
      'raccordi pressfitting': 'raccordi-a-pressare',
    },
    // "Idrotermosanitario"/"Idrotermosanitaria" (43% della macro categoria) è un
    // contenitore generico del fornitore che mescolava raccordi e valvole di ogni tipo:
    // non mappato sopra, cade qui sotto e viene smistato dal nome del prodotto.
    keywordLayer: [
      { slug: 'valvole-a-sfera', keywords: ['valvola a sfera', 'valvola sfera', 'rubinetto a sfera', 'rubinetto sfera'] },
      { slug: 'valvole-industriali-motorizzate', keywords: ['valvola farfalla', 'motorizzat', 'elettrovalvola', 'valvola di zona', 'attuatore'] },
      { slug: 'rubinetti-e-valvole-varie', keywords: ['rubinetto', 'valvola', 'riduttore', 'disconnettore', 'stabilizzatore', 'miscelatore', 'termostatic', 'filtro', 'termometro', 'manometro', 'disaeratore', 'collettore'] },
      { slug: 'raccordi-ottone-bronzo', keywords: ['raccordo', 'manicotto', 'bocchettone', 'nipplo', 'gomito', 'curva', 'riduzione', 'flangia', 'tappo', 'prolunga', 'dado', 'ghiera', 'portagomma', 'diritto', 'coibentazione', 'guscio', 'calibratore'] },
      { slug: 'raccordi-a-saldare', keywords: ['a saldare', 'saldobrasare'] },
      { slug: 'raccordi-a-pressare', keywords: ['pressare', 'pressfit'] },
    ],
  },

  'tubazioni-e-sistemi-di-distribuzione': {
    subcategorie: [
      { slug: 'tubi-rame', nome: 'Tubi e raccordi in rame' },
      { slug: 'tubi-inox', nome: 'Tubi e raccordi in acciaio inox' },
      { slug: 'tubi-acciaio-carbonio', nome: 'Tubi e raccordi in acciaio al carbonio' },
      { slug: 'multistrato-pushfit', nome: 'Multistrato e sistemi push-fit' },
      { slug: 'tubi-pe-distribuzione', nome: 'Tubi PE e distribuzione acqua/gas' },
      { slug: 'raccorderia-generica', nome: 'Raccorderia e sistemi vari' },
    ],
    categoriaMap: {
      'profipress': 'tubi-rame',
      'profipress g': 'tubi-rame',
      'profipress s': 'tubi-rame',
      'sanpress inox': 'tubi-inox',
      'sanpress inox g': 'tubi-inox',
      'sanpress': 'tubi-inox',
      'mapress acciaio inox': 'tubi-inox',
      'temponox': 'tubi-inox',
      'mapress cunife': 'tubi-inox',
      'prestabo': 'tubi-acciaio-carbonio',
      'megapress': 'tubi-acciaio-carbonio',
      'megapress g': 'tubi-acciaio-carbonio',
      'megapress s': 'tubi-acciaio-carbonio',
      'mapress acciaio al carbonio': 'tubi-acciaio-carbonio',
      'raxofix': 'multistrato-pushfit',
      'smartpress': 'multistrato-pushfit',
      'flowfit': 'multistrato-pushfit',
      'sistema hep2o': 'multistrato-pushfit',
      'easytop': 'multistrato-pushfit',
      'pushfit': 'multistrato-pushfit',
      'mepla': 'multistrato-pushfit',
      'volex': 'multistrato-pushfit',
      'fonterra': 'multistrato-pushfit',
      'pe': 'tubi-pe-distribuzione',
      'tubi di distribuzione': 'tubi-pe-distribuzione',
      'distribuzione per impianti acqua e gas': 'tubi-pe-distribuzione',
      'acqua': 'tubi-pe-distribuzione',
      'distribuzione centrale': 'tubi-pe-distribuzione',
      'distribuzione sanitaria': 'tubi-pe-distribuzione',
      'sistemi di adduzione': 'tubi-pe-distribuzione',
      'sistemi adduzione': 'tubi-pe-distribuzione',
      'strutture idrauliche': 'tubi-pe-distribuzione',
      'tubazioni e raccorderia': 'raccorderia-generica',
      'indoor climate solutions': 'raccorderia-generica',
    },
  },

  'bagno-e-sanitari': {
    subcategorie: [
      { slug: 'rubinetteria-bagno', nome: 'Rubinetteria bagno' },
      { slug: 'rubinetteria-cucina', nome: 'Rubinetteria cucina e lavelli' },
      { slug: 'doccia', nome: 'Doccia e accessori' },
      { slug: 'sanitari-a-incasso', nome: 'Sanitari e sistemi a incasso' },
      { slug: 'comandi-e-placche-scarico', nome: 'Comandi e placche di scarico' },
      { slug: 'ceramiche-e-arredo', nome: 'Ceramiche e arredo bagno' },
      { slug: 'allacciamenti', nome: 'Allacciamenti apparecchi' },
    ],
    categoriaMap: {
      'rubinetteria bagno e accessori': 'rubinetteria-bagno',
      'rubinetteria speciale': 'rubinetteria-bagno',
      'rubinetterie': 'rubinetteria-bagno',
      'rubinetteria cucina, accessori e lavelli': 'rubinetteria-cucina',
      'doccia e accessori': 'doccia',
      'docce': 'doccia',
      'sistemi sanitari': 'sanitari-a-incasso',
      'moduli di installazione': 'sanitari-a-incasso',
      'corpi incasso': 'sanitari-a-incasso',
      'placche comando e comandi per wc': 'comandi-e-placche-scarico',
      'piastre di azionamento': 'comandi-e-placche-scarico',
      'sistemi risciacquo': 'comandi-e-placche-scarico',
      'sistemi di sciaquo per wc e orinatoi': 'comandi-e-placche-scarico',
      'cassetta di risciacquo da incasso': 'comandi-e-placche-scarico',
      'cassette di risciacquo esterne': 'comandi-e-placche-scarico',
      'comandi per orinatoi': 'comandi-e-placche-scarico',
      'ceramiche': 'ceramiche-e-arredo',
      'lavabi': 'ceramiche-e-arredo',
      'orinatoi e pareti di separazione': 'ceramiche-e-arredo',
      'mobili per bagno': 'ceramiche-e-arredo',
      'componenti arredo bagno e accessori': 'ceramiche-e-arredo',
      'allacciamenti apparecchi': 'allacciamenti',
    },
    // Le linee design Grohe/Geberit (Icon, Smyle, Selnova...) sono nomi di collezione, non
    // di tipo di prodotto: non mappate sopra, cadono qui e vengono smistate dal nome.
    keywordLayer: [
      { slug: 'rubinetteria-bagno', keywords: ['miscelatore lavabo', 'miscelatore bidet', 'miscelatore bagno', 'rubinetto lavabo', 'rubinetto bidet', 'gruppo lavabo', 'bocca di erogazione'] },
      { slug: 'rubinetteria-cucina', keywords: ['miscelatore cucina', 'rubinetto cucina', 'lavello'] },
      { slug: 'doccia', keywords: ['doccia', 'soffione', 'doccetta', 'piatto doccia', 'box doccia', 'deviatore'] },
      { slug: 'sanitari-a-incasso', keywords: ['vaso', ' wc', 'wc ', 'bidet', 'incasso', 'cassetta', 'cisterna', 'sciacquone'] },
      { slug: 'comandi-e-placche-scarico', keywords: ['placca', 'pulsante di scarico', 'piastra di comando'] },
      { slug: 'ceramiche-e-arredo', keywords: ['lavabo', 'specchio', 'mobile bagno', 'colonna bagno', 'pensile'] },
    ],
  },

  'condizionamento-e-climatizzazione': {
    subcategorie: [
      { slug: 'climatizzatori-residenziali', nome: 'Climatizzatori residenziali' },
      { slug: 'climatizzatori-commerciali-vrf', nome: 'Climatizzatori commerciali e VRF' },
      { slug: 'pompe-di-calore', nome: 'Pompe di calore' },
      { slug: 'unita-e-kit', nome: 'Unità interne/esterne e kit installazione' },
      { slug: 'tubazioni-e-raccordi-clima', nome: 'Tubazioni e raccordi per climatizzatori' },
      { slug: 'scarico-condensa-e-griglie', nome: 'Scarico condensa, griglie e supporti' },
    ],
    categoriaMap: {
      'residenziale': 'climatizzatori-residenziali',
      'residenziale monosplit': 'climatizzatori-residenziali',
      'residenziale multisplit': 'climatizzatori-residenziali',
      'climatizzatori': 'climatizzatori-residenziali',
      'commerciale': 'climatizzatori-commerciali-vrf',
      'commerciale r32': 'climatizzatori-commerciali-vrf',
      'light commercial': 'climatizzatori-commerciali-vrf',
      'vrf - vrv - dvm - mrv - multi v': 'climatizzatori-commerciali-vrf',
      'pompe di calore e ibridi': 'pompe-di-calore',
      'pompe calore': 'pompe-di-calore',
      'pompe di calore': 'pompe-di-calore',
      'estia': 'pompe-di-calore',
      'revive': 'pompe-di-calore',
      'eden': 'pompe-di-calore',
    },
    keywordLayer: [
      { slug: 'climatizzatori-residenziali', keywords: ['monosplit', 'multisplit', 'residenzial'] },
      { slug: 'climatizzatori-commerciali-vrf', keywords: ['vrf', 'vrv', 'commercial', 'cassette', 'canalizzat'] },
      { slug: 'pompe-di-calore', keywords: ['pompa di calore', 'ibrido'] },
      { slug: 'unita-e-kit', keywords: ['unità interna', 'unita interna', 'unità esterna', 'unita esterna', 'kit', 'telecomando', 'linea frigo'] },
      { slug: 'tubazioni-e-raccordi-clima', keywords: ['tubo rame', 'raccordo', 'curva', 'manicotto', 'bocchettone', 'tappo', 'giunto', 'tee ', 'cartellatrice', 'bombola', 'gas r410', 'gas r32', 'gas r407', 'refrigerante', 'sae', 'valvola di non ritorno'] },
      { slug: 'scarico-condensa-e-griglie', keywords: ['scarico condensa', 'condensa', 'sifone', 'griglia', 'canalina', 'vaschetta', 'supporto', 'staffa', 'mensola', 'termometro', 'regolatore', 'silenziatore'] },
    ],
  },

  'ricambi-e-accessori': {
    subcategorie: [
      { slug: 'cartucce-e-miscelatori', nome: 'Cartucce e miscelatori di ricambio' },
      { slug: 'flessibili-e-doccette', nome: 'Flessibili e doccette' },
      { slug: 'guarnizioni-e-oring', nome: 'Guarnizioni e o-ring' },
      { slug: 'manopole-e-comandi', nome: 'Manopole e comandi' },
      { slug: 'sifoni-e-piletta', nome: 'Sifoni e piletta di ricambio' },
      { slug: 'rosoni-supporti-staffe', nome: 'Rosoni, supporti e staffe' },
      { slug: 'kit-e-gruppi-ricambio', nome: 'Kit e gruppi di ricambio' },
      { slug: 'filtri-e-trattamento-ricambio', nome: 'Filtri e prodotti di trattamento' },
      { slug: 'pompe-e-circolatori-ricambio', nome: 'Pompe, circolatori ed elettrovalvole' },
      { slug: 'componenti-caldaia-ricambio', nome: 'Componenti caldaia di ricambio' },
      { slug: 'raccordi-e-tubi-ricambio', nome: 'Raccordi e tubi di ricambio' },
    ],
    categoriaMap: {},
    keywordLayer: [
      { slug: 'cartucce-e-miscelatori', keywords: ['cartuccia', 'miscelatore', 'deviatore', 'monocomando'] },
      { slug: 'flessibili-e-doccette', keywords: ['flessibile', 'doccetta', 'tubo doccia', 'soffione'] },
      { slug: 'guarnizioni-e-oring', keywords: ['guarnizione', 'gaurnizione', 'o-ring', 'oring'] },
      { slug: 'manopole-e-comandi', keywords: ['manopola', 'leva', 'comando', 'pomolo', 'maniglia'] },
      { slug: 'sifoni-e-piletta', keywords: ['sifone', 'piletta'] },
      { slug: 'rosoni-supporti-staffe', keywords: ['rosone', 'supporto', 'staffa', 'cappuccio', 'coperchio', 'prolunga'] },
      { slug: 'kit-e-gruppi-ricambio', keywords: ['kit', 'gruppo', 'set '] },
      { slug: 'filtri-e-trattamento-ricambio', keywords: ['filtro', 'detergente', 'disincrostante', 'anticalcare', 'antigel'] },
      { slug: 'pompe-e-circolatori-ricambio', keywords: ['pompa', 'circolatore', 'elettrovalvola'] },
      { slug: 'componenti-caldaia-ricambio', keywords: ['scambiatore', 'bruciatore', 'elettrodo', 'ventilatore', 'sonda', 'termostato', 'centralina', 'resistenza elettrica'] },
      { slug: 'raccordi-e-tubi-ricambio', keywords: ['raccordo', 'tubo', 'manicotto', 'curva', 'ghiera', 'bocchettone'] },
    ],
  },

  'ventilazione-e-trattamento-aria': {
    subcategorie: [
      { slug: 'canalizzazioni-e-raccordi', nome: 'Canalizzazioni e raccordi VMC' },
      { slug: 'griglie-e-diffusori', nome: 'Griglie e diffusori' },
      { slug: 'plenum-e-collettori', nome: 'Plenum e collettori aria' },
      { slug: 'unita-e-impianti-vmc', nome: 'Unità e impianti VMC' },
      { slug: 'ventilconvettori', nome: 'Ventilconvettori' },
      { slug: 'accessori-gas-refrigerante', nome: 'Accessori per gas refrigerante' },
      { slug: 'supporti-e-strutture-esterne', nome: 'Supporti e strutture per unità esterne' },
      { slug: 'bacinelle-e-scarico-condensa', nome: 'Bacinelle e scarico condensa' },
    ],
    categoriaMap: {
      'ventilconvettori': 'ventilconvettori',
      'vmc': 'unita-e-impianti-vmc',
      'sistema vmc': 'unita-e-impianti-vmc',
      'trattamento aria e vmc residenziale': 'unita-e-impianti-vmc',
      'trattamento aria': 'unita-e-impianti-vmc',
    },
    // Le linee VMC a marchio (Smart Clima, Project Wind, Toolsplit, Apply.Co/Air,
    // Galaxy, Showgas) non mappate sopra: smistate dal nome del prodotto.
    keywordLayer: [
      { slug: 'canalizzazioni-e-raccordi', keywords: ['canalina', 'manicotto', 'curva', 'giunto', 'raccordo', 'riduzione', 'derivazione', 'tappo', 'tubo'] },
      { slug: 'griglie-e-diffusori', keywords: ['griglia', 'diffusore', 'bocchetta', 'serranda', 'barriera', 'antivibrante'] },
      { slug: 'plenum-e-collettori', keywords: ['plenum', 'collettore'] },
      { slug: 'unita-e-impianti-vmc', keywords: ['vmc', 'recuperatore', 'filtro aria'] },
      { slug: 'accessori-gas-refrigerante', keywords: ['bombola', 'gas r410', 'gas r32', 'gas r407', 'refrigerante', 'cartella', 'sae', 'valvola di non ritorno', 'manometric'] },
      { slug: 'supporti-e-strutture-esterne', keywords: ['supporto a pavimento', 'staffa a pavimento', 'mensola', 'ts-cover', 'copricaldaia', 'basi a pavimento', 'passaggio a tetto', 'torrino'] },
      { slug: 'bacinelle-e-scarico-condensa', keywords: ['bacinella', 'raccolta condensa', 'scarico condensa'] },
    ],
  },

  'fissaggi-e-utensili': {
    subcategorie: [
      { slug: 'utensili-e-attrezzatura', nome: 'Utensili e attrezzatura' },
      { slug: 'ancoranti-e-fissaggi', nome: 'Ancoranti e fissaggi' },
      { slug: 'sigillanti-e-adesivi', nome: 'Sigillanti e adesivi' },
    ],
    categoriaMap: {
      'attrezzaura': 'utensili-e-attrezzatura',
      'attrezzatura': 'utensili-e-attrezzatura',
      'attrezzi': 'utensili-e-attrezzatura',
      'attrezzatura e utensili': 'utensili-e-attrezzatura',
      'samontec': 'utensili-e-attrezzatura',
      'punte e inserti': 'utensili-e-attrezzatura',
      'ancoranti metallici ad alte prestazioni': 'ancoranti-e-fissaggi',
      'ancoranti chimici': 'ancoranti-e-fissaggi',
      'fissaggi universali': 'ancoranti-e-fissaggi',
      'fissaggi prolungati': 'ancoranti-e-fissaggi',
      'fissaggi per lastre e soffitti': 'ancoranti-e-fissaggi',
      'fissaggi leggeri': 'ancoranti-e-fissaggi',
      'fissaggi per isolamento': 'ancoranti-e-fissaggi',
      'fissaggi per materiali elettrici': 'ancoranti-e-fissaggi',
      'fissaggi per idrotermosanitari': 'ancoranti-e-fissaggi',
      'viti legno e staffe': 'ancoranti-e-fissaggi',
      'schiume e sigillanti': 'sigillanti-e-adesivi',
      'adesivi': 'sigillanti-e-adesivi',
      'loctite': 'sigillanti-e-adesivi',
      'solar - fix': 'sigillanti-e-adesivi',
      'tenuta': 'sigillanti-e-adesivi',
      'spray': 'sigillanti-e-adesivi',
    },
  },

  'scarico-e-fognatura': {
    subcategorie: [
      { slug: 'tubazioni-silenziate', nome: 'Tubazioni silenziate' },
      { slug: 'scarichi-a-pavimento', nome: 'Scarichi a pavimento e drenaggio' },
      { slug: 'sifoni-e-scarichi', nome: 'Sifoni e scarichi' },
      { slug: 'tubi-raccordi-scarico', nome: 'Tubi e raccordi di scarico' },
    ],
    categoriaMap: {
      'silent-pp': 'tubazioni-silenziate',
      'silent-pro': 'tubazioni-silenziate',
      'silent-db20': 'tubazioni-silenziate',
      'tecnologia di drenaggio': 'scarichi-a-pavimento',
      'scarichi e sifoni': 'sifoni-e-scarichi',
      'sifoni': 'sifoni-e-scarichi',
      'sistemi di scarico': 'tubi-raccordi-scarico',
      'sistema scarico': 'tubi-raccordi-scarico',
      'sistemi fognatura': 'tubi-raccordi-scarico',
      'pp-ht': 'tubi-raccordi-scarico',
    },
  },

  'trattamento-acqua': {
    subcategorie: [
      { slug: 'trattamento-fisico-magnetico', nome: 'Trattamento fisico e magnetico' },
      { slug: 'trattamento-chimico', nome: 'Trattamento chimico e anticorrosione' },
      { slug: 'filtrazione-e-dosaggio', nome: 'Filtrazione e dosaggio' },
    ],
    categoriaMap: {
      "trattamento dell'acqua fisico": 'trattamento-fisico-magnetico',
      "trattamento dell'acqua magnetico": 'trattamento-fisico-magnetico',
      'anticorrosione': 'trattamento-chimico',
      "trattamento dell'acqua chimico": 'trattamento-chimico',
      'fernox': 'trattamento-chimico',
      'idrocosmotek dosaggio': 'trattamento-chimico',
      'idrocosmotek condizionamento chimico': 'trattamento-chimico',
      'idrocosmotek disincrostanti': 'trattamento-chimico',
      'idrocosmotek addolcimento': 'trattamento-chimico',
      'idrocosmotek filtrazione': 'filtrazione-e-dosaggio',
      'idrocosmotek affinatori-osmosi-debatter.': 'filtrazione-e-dosaggio',
      'idrocosmotek kit analisi e ausiliari': 'filtrazione-e-dosaggio',
    },
    keywordLayer: [
      { slug: 'trattamento-fisico-magnetico', keywords: ['magnetic', 'fisico'] },
      { slug: 'trattamento-chimico', keywords: ['chimico', 'anticorrosione', 'disincrostante', 'antigel'] },
      { slug: 'filtrazione-e-dosaggio', keywords: ['filtro', 'filtrazione', 'osmosi', 'dosaggio'] },
    ],
  },

  'acqua-calda-sanitaria': {
    subcategorie: [
      { slug: 'scaldacqua', nome: 'Scaldacqua' },
      { slug: 'bollitori', nome: 'Bollitori e fan coil' },
      { slug: 'accessori-acs', nome: 'Accessori acqua calda sanitaria' },
    ],
    categoriaMap: {
      'accessori acqua calda sanitaria': 'accessori-acs',
      'scaldacqua tradizionali': 'scaldacqua',
      'scaldacqua rinnovabile': 'scaldacqua',
      'bollitori e fan coil': 'bollitori',
      'bollitori': 'bollitori',
    },
  },

  'elettrico-e-fotovoltaico': {
    subcategorie: [
      { slug: 'fotovoltaico', nome: 'Fotovoltaico' },
      { slug: 'elettrico', nome: 'Elettrico' },
    ],
    categoriaMap: {
      'fotovoltaico': 'fotovoltaico',
      'fv power': 'fotovoltaico',
      'elettrico': 'elettrico',
    },
  },
};

const SLUG_VARIE = 'varie';
const NOME_VARIE = 'Varie';

function classifica(cfg, categoriaRaw, nomeRaw) {
  const categoriaNorm = String(categoriaRaw || '').trim().toLowerCase();
  const tier1 = cfg.categoriaMap[categoriaNorm];
  if (tier1) return [tier1];

  if (cfg.keywordLayer) {
    const nomeNorm = String(nomeRaw || '').toLowerCase();
    const trovate = cfg.keywordLayer
      .filter((regola) => regola.keywords.some((k) => nomeNorm.includes(k)))
      .map((regola) => regola.slug);
    if (trovate.length) return [...new Set(trovate)];
  }
  return [SLUG_VARIE];
}

async function main() {
  const macroSlugs = Object.keys(MACRO_CONFIG);

  const esegui = db.transaction(async () => {
    // Ripulisce solo le macro categorie gestite qui: "generico" non viene toccato
    // (nessuna riga sua da cancellare, dato che non è mai stato popolato).
    for (const macroSlug of macroSlugs) {
      await db.prepare('DELETE FROM product_sottocategorie WHERE macro_slug = ?').run(macroSlug);
      await db.prepare('DELETE FROM sottocategorie WHERE macro_slug = ?').run(macroSlug);
    }

    for (const macroSlug of macroSlugs) {
      const cfg = MACRO_CONFIG[macroSlug];

      // Registra le sottocategorie definite, più il fallback "varie" per garantire
      // copertura 100% (sottocategorieDi() nasconde comunque quelle rimaste a 0 prodotti).
      let ordine = 0;
      for (const s of cfg.subcategorie) {
        const keywordsDoc = [
          ...Object.entries(cfg.categoriaMap).filter(([, slug]) => slug === s.slug).map(([raw]) => raw),
          ...((cfg.keywordLayer || []).find((r) => r.slug === s.slug)?.keywords || []),
        ].join(', ');
        await db
          .prepare('INSERT INTO sottocategorie (macro_slug, slug, nome, keywords, ordine) VALUES (?, ?, ?, ?, ?)')
          .run(macroSlug, s.slug, s.nome, keywordsDoc, ordine++);
      }
      await db
        .prepare('INSERT INTO sottocategorie (macro_slug, slug, nome, keywords, ordine) VALUES (?, ?, ?, ?, ?)')
        .run(macroSlug, SLUG_VARIE, NOME_VARIE, '', 999);

      // Classifica tutti i prodotti attivi della macro categoria.
      const prodotti = await db
        .prepare('SELECT id, categoria, nome FROM products WHERE macro_slug = ? AND attivo = 1')
        .all(macroSlug);

      const righe = [];
      for (const p of prodotti) {
        const slugs = classifica(cfg, p.categoria, p.nome);
        for (const slug of slugs) righe.push([p.id, macroSlug, slug]);
      }

      // Insert a blocchi (una sola andata/ritorno di rete ogni ~500 righe, invece di una
      // per prodotto: su una connessione remota come Supabase sarebbero altrimenti decine
      // di migliaia di round-trip dentro un'unica transazione aperta).
      const BLOCCO = 500;
      for (let i = 0; i < righe.length; i += BLOCCO) {
        const fetta = righe.slice(i, i + BLOCCO);
        const placeholders = fetta.map(() => '(?, ?, ?)').join(', ');
        const valori = fetta.flat();
        await db
          .prepare(`INSERT INTO product_sottocategorie (product_id, macro_slug, sottocategoria_slug) VALUES ${placeholders}`)
          .run(...valori);
      }

      console.log(`${macroSlug}: ${prodotti.length} prodotti, ${righe.length} assegnazioni`);
    }
  });

  await esegui();

  // ---- Report di verifica (fuori transazione, sola lettura) ----
  console.log('\n=== Copertura per sottocategoria ===');
  for (const macroSlug of macroSlugs) {
    const righe = await db
      .prepare(
        `SELECT s.slug, s.nome, COUNT(ps.product_id) AS n
           FROM sottocategorie s
           LEFT JOIN product_sottocategorie ps ON ps.macro_slug = s.macro_slug AND ps.sottocategoria_slug = s.slug
          WHERE s.macro_slug = ?
          GROUP BY s.slug, s.nome
          ORDER BY n DESC`
      )
      .all(macroSlug);
    console.log(`\n${macroSlug}:`);
    for (const r of righe) console.log(`  ${r.nome.padEnd(45)} ${r.n}`);
  }

  const senzaSottocategoria = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM products p
        WHERE p.attivo = 1 AND p.macro_slug <> 'generico'
          AND NOT EXISTS (SELECT 1 FROM product_sottocategorie ps WHERE ps.product_id = p.id)`
    )
    .get();
  console.log(`\nProdotti attivi senza alcuna sottocategoria (atteso: 0): ${senzaSottocategoria.n}`);

  const doppie = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT product_id FROM product_sottocategorie GROUP BY product_id HAVING COUNT(*) > 1
       ) t`
    )
    .get();
  console.log(`Prodotti assegnati a 2+ sottocategorie (parole chiave ambigue): ${doppie.n}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Errore:', e);
  process.exit(1);
});
