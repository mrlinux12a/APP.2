// I dati dell'azienda che emette ricevute ed email ("Emessa da", logo, piè di pagina, link). Vengono dal .env: MAI scritti nel codice (sono dati
// fiscali di chi gestisce il servizio, non di chi ha scritto il programma). Tutto facoltativo: quello che manca semplicemente non si stampa.
//   AZIENDA_NOME             nome mostrato nel logo e nell'intestazione dell'email (default "Minuteria", il nome dell'app)
//   AZIENDA_SOTTOTITOLO      riga sotto il nome nella ricevuta (default "Consegna materiale in cantiere")
//   AZIENDA_RAGIONE_SOCIALE  ragione sociale in "EMESSA DA"
//   AZIENDA_INDIRIZZO        sede, su una riga ("Via Roma 1, 16100 Genova (GE)")
//   AZIENDA_PIVA             partita IVA (solo le cifre, o con "IT")
//   AZIENDA_EMAIL            indirizzo di assistenza, in fondo alla ricevuta
//   RICEVUTA_NOTA_FISCALE    riga di nota fiscale da far confermare al commercialista (es. "La fattura elettronica è inviata tramite SDI.");
//                            se manca non si stampa
//   APP_URL                  indirizzo pubblico del sito (già usato da Stripe): serve ai pulsanti dell'email
function azienda() {
  const e = process.env;
  const v = (nome) => String(e[nome] || '').trim();
  return {
    nome: v('AZIENDA_NOME') || 'Minuteria',
    sottotitolo: v('AZIENDA_SOTTOTITOLO') || 'Consegna materiale in cantiere',
    ragioneSociale: v('AZIENDA_RAGIONE_SOCIALE'),
    indirizzo: v('AZIENDA_INDIRIZZO'),
    partitaIva: v('AZIENDA_PIVA'),
    email: v('AZIENDA_EMAIL'),
    notaFiscale: v('RICEVUTA_NOTA_FISCALE'),
    urlApp: v('APP_URL').replace(/\/+$/, ''),
  };
}

module.exports = { azienda };
