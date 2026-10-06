const pricing = require('./pricing');

const TESTO_DISPONIBILITA = {
  disponibile: 'Disponibile',
  in_esaurimento: 'In esaurimento',
  non_disponibile: 'Non disponibile',
};

// Un prodotto di catalogo nel formato JSON usato dalla ricerca live, dallo scroll
// infinito e dall'app: la percentuale di servizio si passa già calcolata (una volta per
// richiesta).
function prodottoJson(p, servizioPct) {
  return {
    id: p.id,
    codice: p.codice,
    nome: p.nome,
    macro_nome: p.macro_nome,
    brand_nome: p.brand_nome,
    brand_colore: p.brand_colore,
    foto_url: p.foto_url || null,
    raee: p.raee > 0 ? pricing.euro(p.raee) : null,
    disponibilita: p.disponibilita,
    disponibilita_testo: TESTO_DISPONIBILITA[p.disponibilita] || p.disponibilita,
    sconto_base_pct: p.sconto_base_pct,
    listino: pricing.euro(p.prezzo_listino),
    prezzo: pricing.euro(pricing.prezzoClienteConPct(p, servizioPct)),
    varianti_info: p.varianti ? p.varianti_info : null,
    varianti: p.varianti
      ? p.varianti.map((v) => ({
          id: v.id,
          etichetta: v.etichetta,
          codice: v.codice,
          disponibilita: v.disponibilita,
          disponibilita_testo: TESTO_DISPONIBILITA[v.disponibilita] || v.disponibilita,
          raee: v.raee > 0 ? pricing.euro(v.raee) : null,
          sconto_base_pct: v.sconto_base_pct, // senza, cambiando misura su una riga da ricerca live il prezzo di listino non si barra
          listino: pricing.euro(v.prezzo_listino),
          prezzo: pricing.euro(pricing.prezzoClienteConPct(v, servizioPct)),
        }))
      : null,
  };
}

module.exports = { TESTO_DISPONIBILITA, prodottoJson };
