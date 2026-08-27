// Punti vendita dei distributori nel comune di Genova.
//
// Indirizzi raccolti dai siti ufficiali delle insegne (agosto 2026):
//   AFIS      → afis.it/dove-siamo
//   BOREA     → comini.eu/borea/professionisti/puntivendita
//   CAMBIELLI → cambielli.it/punti-vendita
//   FIDRA     → fidra.it/contatti
//
// Le coordinate vengono ricavate con `node db/geocodifica.js` (Nominatim/OpenStreetMap)
// e scritte in `geo_lat` / `geo_lng`: qui restano a null finché non si lancia lo script.
// Per ora solo Genova: aggiungendo altre città basta estendere questo elenco.

module.exports = [
  // ---------- AFIS ----------
  {
    distributore: 'AFIS SPA',
    nome: 'Genova Europa',
    indirizzo: 'Corso Europa 232',
    cap: '16132',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 395740',
    email: 'genovaeuropa@afis.it',
  },
  {
    distributore: 'AFIS SPA',
    nome: 'Genova Spataro',
    indirizzo: 'Via Spataro 44 rosso',
    cap: '16151',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 518601',
    email: 'genovaspataro@afis.it',
  },

  // ---------- BOREA ----------
  {
    distributore: 'BOREA SRL',
    nome: 'Genova Fegino',
    indirizzo: 'Via Castel Morrone 1',
    cap: '16161',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 716871',
    email: 'esp.genova@borea.it',
  },
  {
    distributore: 'BOREA SRL',
    nome: 'Genova Staglieno',
    indirizzo: 'Via Lungobisagno Istria 11',
    cap: '16141',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 2921898',
    email: '',
  },

  // ---------- CAMBIELLI ----------
  {
    distributore: 'CAMBIELLI SPA',
    nome: 'Genova Campi',
    indirizzo: 'Corso Ferdinando Maria Perrone 23/H',
    cap: '16152',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 6509509',
    email: '',
  },
  {
    distributore: 'CAMBIELLI SPA',
    nome: 'Genova Albaro',
    indirizzo: 'Piazza Merani 3/C',
    cap: '16145',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 3691052',
    email: '',
  },
  {
    distributore: 'CAMBIELLI SPA',
    nome: 'Genova Voltri',
    indirizzo: 'Via delle Fabbriche 33/N',
    cap: '16158',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '',
    email: '',
  },
  {
    distributore: 'CAMBIELLI SPA',
    nome: 'Atelier Genova centro',
    indirizzo: 'Via Canneto il Lungo 42R',
    cap: '16123',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 0012166',
    email: 'genova.atelier@cambielli.it',
  },

  // ---------- FIDRA ----------
  {
    distributore: 'FIDRA SPA',
    nome: 'Genova Pegli (sede)',
    indirizzo: 'Via Multedo di Pegli 4',
    cap: '16155',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 61731',
    email: 'showroom@fidra.it',
  },
  {
    distributore: 'FIDRA SPA',
    nome: 'Genova Campi',
    indirizzo: 'Via Renata Bianchi 81',
    cap: '16152',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 0980300',
    email: 'showroom@fidra.it',
  },
  {
    distributore: 'FIDRA SPA',
    nome: 'Genova San Martino',
    indirizzo: 'Via Papigliano 12',
    cap: '16131',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 894961',
    email: 'showroom@fidra.it',
  },
  {
    distributore: 'FIDRA SPA',
    nome: 'Genova Sturla',
    indirizzo: 'Via Isonzo 105 R',
    cap: '16147',
    citta: 'Genova',
    provincia: 'GE',
    telefono: '010 3770477',
    email: 'showroom@fidra.it',
  },
];
