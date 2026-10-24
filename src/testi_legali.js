// Le due pagine pubbliche che Google Play (e Apple) vogliono per un'app con registrazione: l'informativa sulla privacy e come eliminare
// l'account. Sono raggiungibili senza accedere: /privacy e /elimina-account (views/legale.ejs). Il titolare dei dati viene dal .env
// (src/azienda.js: AZIENDA_RAGIONE_SOCIALE, AZIENDA_INDIRIZZO, AZIENDA_PIVA, AZIENDA_EMAIL), mai scritto qui.
//
// ATTENZIONE: è un testo di partenza scritto sulla base di quello che il programma fa davvero (quali dati raccoglie, a chi li manda, per
// quanto li tiene). Va riletto e approvato da chi risponde del trattamento dei dati prima di pubblicare l'app.
const { azienda } = require('./azienda');

// I dati di chi gestisce il servizio (nome, indirizzo, partita IVA), presi dal .env, da scrivere nei testi legali.
function titolare() {
  const az = azienda();
  const nome = az.ragioneSociale || az.nome;
  const dettagli = [az.indirizzo, az.partitaIva ? 'P. IVA ' + az.partitaIva : ''].filter(Boolean).join(' · ');
  return { az, nome, dettagli };
}

// La frase su come contattare il titolare: l'email se c'è, altrimenti un rimando generico.
function contatto(az) {
  return az.email ? `all’indirizzo ${az.email}` : 'ai recapiti indicati dal servizio';
}

// Il testo dell'informativa sulla privacy, diviso in sezioni, per la pagina pubblica.
function privacy() {
  const { az, nome, dettagli } = titolare();
  return {
    titolo: 'Informativa sulla privacy',
    aggiornata: '19 ottobre 2026',
    sezioni: [
      {
        titolo: 'Chi tratta i tuoi dati',
        paragrafi: [
          `Il titolare del trattamento è ${nome}${dettagli ? ' (' + dettagli + ')' : ''}, che gestisce il servizio ${az.nome} (sito e app): permette alle imprese di installazione di chiedere la disponibilità del materiale ai distributori e di riceverlo in cantiere.`,
          `Per qualsiasi domanda sui tuoi dati scrivi ${contatto(az)}.`,
        ],
      },
      {
        titolo: 'Quali dati raccogliamo',
        elenco: [
          'Dati dell’impresa e del referente che inserisci registrandoti: ragione sociale, tipo di soggetto, partita IVA, codice fiscale, indirizzo della sede, referente, email, telefono, PEC o codice SDI.',
          'Credenziali di accesso: nome utente e password (la password è conservata solo in forma cifrata e non la leggiamo).',
          'Dati d’uso del servizio: richieste di disponibilità, ordini, materiale richiesto, indirizzo e note di consegna, ricevute, notifiche.',
          'Dati dei pagamenti: l’importo, la data e l’esito. I dati della carta sono gestiti direttamente da Stripe e non passano dai nostri server: noi conserviamo solo la marca e le ultime quattro cifre.',
          'Dati tecnici dell’app: l’identificativo che serve a inviare le notifiche al tuo telefono e il tipo di dispositivo.',
          'Sul sito, solo se lo consenti al browser: la posizione del dispositivo, usata per precompilare l’indirizzo di consegna e per calcolare il tragitto della merce dal distributore fino a te.',
        ],
        paragrafi: ['L’app non raccoglie la posizione del dispositivo, non usa la fotocamera né il microfono e non contiene pubblicità né strumenti di tracciamento.'],
      },
      {
        titolo: 'Perché li usiamo',
        elenco: [
          'Per dare il servizio che hai richiesto: creare e gestire il tuo account, inoltrare le richieste ai distributori, organizzare la consegna e i pagamenti (esecuzione del contratto).',
          'Per adempiere agli obblighi di legge, in particolare fiscali e contabili (ricevute, fatture).',
          'Per la sicurezza del servizio e per prevenire abusi e frodi (legittimo interesse).',
          'Per inviarti le notifiche sullo stato di richieste e ordini, che puoi disattivare dalle impostazioni del telefono.',
        ],
      },
      {
        titolo: 'A chi li comunichiamo',
        elenco: [
          'Il distributore a cui invii la richiesta, che riceve i dati dell’impresa e dell’ordine necessari a preparare e consegnare il materiale.',
          'I corrieri incaricati della consegna, limitatamente a indirizzo di consegna e dati dell’ordine.',
          'Stripe, che gestisce i pagamenti con carta.',
          'I fornitori tecnici che fanno funzionare il servizio: hosting e database, e il servizio di invio delle notifiche (Expo e Google).',
        ],
        paragrafi: ['Non vendiamo i tuoi dati e non li usiamo per pubblicità.'],
      },
      {
        titolo: 'Per quanto tempo li conserviamo',
        paragrafi: [
          'Finché il tuo account è attivo. Se lo elimini, i dati personali di contatto (referente, email, telefono, PEC/SDI), le credenziali e le notifiche vengono cancellati subito. I dati dell’impresa e degli ordini che compaiono su ricevute e documenti fiscali restano per il tempo previsto dalla legge (di norma dieci anni).',
        ],
      },
      {
        titolo: 'I tuoi diritti',
        paragrafi: [
          `Puoi chiedere in qualsiasi momento di accedere ai tuoi dati, correggerli, limitarne il trattamento, riceverli in un formato comune o opporti al trattamento, scrivendo ${contatto(az)}. Puoi eliminare l’account direttamente dall’app (Profilo → Elimina account) o seguendo le istruzioni nella pagina “Eliminazione dell’account”.`,
          'Se ritieni che i tuoi dati non siano trattati correttamente puoi proporre reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).',
        ],
      },
    ],
  };
}

// Il testo della pagina "Eliminazione dell'account" (richiesta da Google Play), diviso in sezioni.
function eliminazione() {
  const { az } = titolare();
  return {
    titolo: 'Eliminazione dell’account',
    aggiornata: '20 ottobre 2026',
    sezioni: [
      {
        titolo: 'Dal sito',
        elenco: [
          'Entra nel sito con il tuo account.',
          'Tocca il cerchio con le tue iniziali in alto a destra e scegli “La mia anagrafica”.',
          'In fondo alla pagina scegli “Elimina account” e conferma con la tua password.',
        ],
        paragrafi: ['Lo stesso account vale per il sito e per l’app: eliminarlo da una parte lo elimina ovunque.'],
      },
      {
        titolo: 'Dall’app',
        elenco: [
          'Apri l’app ed entra con il tuo account.',
          'Tocca l’icona del profilo in alto a destra.',
          'Scegli “Elimina account” e conferma con la tua password.',
        ],
        paragrafi: ['L’account si elimina subito. Se hai una richiesta o un ordine ancora in corso, prima devi aspettare che finisca (o che arrivi la consegna).'],
      },
      {
        titolo: 'Non riesci a entrare nell’app?',
        paragrafi: [
          `Scrivi ${contatto(az)} dall’indirizzo email con cui ti sei registrato, indicando il nome utente e la ragione sociale. Eliminiamo l’account e ti rispondiamo appena fatto.`,
        ],
      },
      {
        titolo: 'Cosa viene cancellato e cosa resta',
        elenco: [
          'Vengono cancellati: referente, email, telefono, PEC o codice SDI, nome utente, password, notifiche e i telefoni collegati alle notifiche. Dopo l’eliminazione non è più possibile entrare.',
          'Restano, per obbligo di legge: ragione sociale, partita IVA, codice fiscale e indirizzo dell’impresa, insieme a ordini, ricevute e pagamenti già emessi, perché fanno parte della contabilità tua e del distributore.',
        ],
      },
    ],
  };
}

module.exports = { privacy, eliminazione };
