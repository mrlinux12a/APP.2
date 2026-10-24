// Prepara, a ogni richiesta, tutto quello che le pagine (EJS) trovano già pronto: chi è collegato, le funzioni per scrivere importi e date, le icone, il
// numero di pezzi nel carrello, le notifiche non lette e, per banco e installatore, i dati della barra in basso.
const pricing = require('../pricing');
const format = require('../format');
const icone = require('../icone');
const notifiche = require('../notifiche');
const geo = require('../geo');
const anagrafiche = require('../anagrafiche');
const flusso = require('../flusso_cliente');
const webPush = require('../web_push');
const { TESTO_DISPONIBILITA } = require('../prodotto_json');
const { contaCarrello } = require('../services/carrello_sessione');
const { letturaBanco, intestazioneBanco } = require('../services/banco');

// Rende disponibili utente, funzioni di aiuto e contatori a tutte le viste (res.locals). Una pagina non deve mai rompersi perché una di queste letture
// è fallita: gli errori si scrivono nel log e la parte relativa resta vuota.
async function contestoViste(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.euro = pricing.euro;
  res.locals.fmt = format;
  Object.assign(res.locals, icone);
  res.locals.carrelloPezzi = contaCarrello(req);
  res.locals.testoDisponibilita = TESTO_DISPONIBILITA;

  const utente = req.session.user;
  // Nessuna di queste dipende dal risultato di un'altra: prima giravano una dopo l'altra (fino a una decina di query in sequenza, anche per un cliente
  // senza nulla da mostrare), sommando la latenza di ognuna invece di pagare solo quella della più lenta.
  const [notificheNonLette, ordiniNonLetti, richiesteNonLette, geoStato, letturaContatori, statoOrdini, profiloCliente, bancoTesta] =
    await Promise.all([
      utente ? notifiche.nonLette(utente.id) : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'ordini') : Promise.resolve(0),
      utente && utente.ruolo === 'cliente' ? notifiche.nonLetteCategoria(utente.id, 'richieste') : Promise.resolve(0),
      utente ? geo.statoUtente(utente.id) : Promise.resolve({ consenso: false }),
      utente && utente.ruolo === 'distributore' && utente.distributor_id
        ? letturaBanco(utente.distributor_id)
        : Promise.resolve(null),
      // Icona dinamica "Stato ordini" (partials/nav_ordini.ejs): solo per il cliente e solo per le pagine, non per le API dell'app. Un errore qui non
      // deve mai rompere la pagina, ma va scritto nel log: se lo si ingoia in silenzio l'icona resta quella di prima e nessuno capisce perché.
      utente && utente.ruolo === 'cliente' && !req.path.startsWith('/api/')
        ? flusso.statoIconaOrdini(utente.id).catch((err) => {
            console.error('[nav] icona Stato ordini non calcolata:', err.message);
            return null;
          })
        : Promise.resolve(null),
      // Menu del profilo nell'appbar del cliente (partials/appbar.ejs): referente e distributore di riferimento. Come sopra, un errore non rompe la
      // pagina: il menu mostra solo la ragione sociale.
      utente && utente.ruolo === 'cliente' && !req.path.startsWith('/api/')
        ? anagrafiche.intestazioneCliente(utente.id).catch((err) => {
            console.error('[appbar] intestazione del profilo non letta:', err.message);
            return null;
          })
        : Promise.resolve(null),
      // Intestazione del banco, uguale su tutte le sue pagine. Come sopra: un errore non rompe la pagina (la barra mostra allora il nome dell'utente
      // al posto di ditta e filiale).
      utente && utente.ruolo === 'distributore' && utente.distributor_id && !req.path.startsWith('/api/')
        ? intestazioneBanco(utente.distributor_id).catch((err) => {
            console.error('[banco] intestazione non letta:', err.message);
            return null;
          })
        : Promise.resolve(null),
    ]);

  // Il prezzo di un articolo che vede l'installatore (catalogo, categoria, ricerca, varianti, carrello) è il PREZZO DEL BANCO: listino meno lo sconto
  // del banco, senza il 10% di servizio, che sta solo nella voce "Servizio" del riepilogo (vedi pricing.dividiTotale). Funzione pura (niente DB): i
  // template EJS non possono fare "await". `totaleRigaBanco` è prezzo × quantità arrotondato come `subtotale` dell'ordine.
  res.locals.prezzoBanco = (riga) => pricing.prezzoNetto(riga);
  res.locals.totaleRigaBanco = (riga, quantita) => pricing.round2(pricing.prezzoNetto(riga) * quantita);
  // Gli ordini creati prima delle offerte per distributore non hanno l'IVA calcolata.
  res.locals.totaleOrdine = (o) => (o.totale_ivato > 0 ? o.totale_ivato : o.totale_finale);
  res.locals.notificheNonLette = notificheNonLette;
  // Il tab "Stato ordini" segue tutta la pipeline del cliente (richiesta -> offerte -> ordine), non solo gli ordini veri e propri: il badge conta le
  // notifiche non lette di entrambe le categorie, altrimenti una conferma disponibilità (categoria "richieste") non farebbe comparire nulla.
  res.locals.ordiniNonLetti = ordiniNonLetti + richiesteNonLette;
  res.locals.statoOrdini = statoOrdini;
  res.locals.profiloCliente = profiloCliente;
  res.locals.bancoTesta = bancoTesta;
  res.locals.percorso = req.path; // la voce attiva dell'intestazione del banco si sceglie da qui
  // Notifiche ad app chiusa (src/web_push.js): la chiave pubblica con cui il browser si iscrive (vuota = le push sono spente) e l'iscrizione che il
  // server già ha per QUESTA sessione. Le legge public/app.js dai <meta> di partials/app_head.ejs: se l'iscrizione del browser è un'altra (primo
  // accesso, nuovo login, uscita e rientro) la manda di nuovo; senza questo confronto servirebbe una chiamata a ogni pagina.
  res.locals.pushChiave = utente ? webPush.chiavePubblica() : '';
  res.locals.pushEndpoint = (req.session && req.session.pushEndpoint) || '';
  res.locals.geo = geoStato;
  // I contatori del banco servono alla barra di navigazione di tutte le pagine distributore.
  res.locals.contatori = letturaContatori ? letturaContatori.contatori : null;
  // Quanto manca alla prima richiesta da confermare (null se non ce n'è): la striscia sotto l'intestazione del banco.
  res.locals.primaScadeSec = letturaContatori ? letturaContatori.primaScadeSec : null;
  // Pagine e risposte dell'app sono dati di chi è collegato: il browser (o un proxy davanti alla VPS) non deve riproporre una copia vecchia, altrimenti
  // richieste e ordini nuovi non si vedono finché non si forza il refresh. Con ETag il ricontrollo costa poco.
  res.set('Cache-Control', 'private, no-cache');
  next();
}

module.exports = { contestoViste };
