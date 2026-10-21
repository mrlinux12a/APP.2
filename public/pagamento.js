/* Pagina di pagamento (views/pagamento.ejs): monta il form di Stripe (Payment Element) e conferma il pagamento.
   La carta la raccoglie Stripe dentro il suo iframe: qui non passa. Con la carta solo "bloccata" (capture_method
   manual) il PaymentIntent arriva a `requires_capture`; poi si va su /pagamento/esito, dove il server verifica con
   Stripe e fa nascere la richiesta. Con il 3-D Secure Stripe porta fuori e riporta da solo allo stesso indirizzo. */
(function () {
  'use strict';
  const radice = document.querySelector('[data-pagamento]');
  if (!radice) return;
  const pulsante = radice.querySelector('[data-pag-paga]');
  const messaggio = radice.querySelector('[data-pag-messaggio]');
  const etichetta = pulsante.textContent;

  function mostraErrore(testo) {
    messaggio.textContent = testo;
    messaggio.hidden = !testo;
  }

  // Stripe.js arriva da js.stripe.com: senza rete (o con un blocco) non c'è form, e lo si dice.
  if (typeof Stripe === 'undefined') {
    mostraErrore('Non riesco a caricare il modulo di pagamento. Controlla la connessione e ricarica la pagina.');
    return;
  }

  const stripe = Stripe(radice.dataset.chiave);
  const elements = stripe.elements({
    clientSecret: radice.dataset.segreto,
    locale: 'it',
    fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&display=swap' }],
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#245a8f',
        colorText: '#232019',
        colorDanger: '#bd3a3a',
        colorBackground: '#ffffff',
        fontFamily: '"Source Sans 3", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
        fontSizeBase: '16px', // sotto i 16px Safari su iPhone ingrandisce la pagina al tocco dei campi
        borderRadius: '12px',
        spacingUnit: '4px',
      },
    },
  });

  // I metodi che compaiono (carta, Apple Pay, Google Pay, Link...) li decide Stripe in base al Dashboard, al paese e al
  // dispositivo: Apple Pay e Google Pay si vedono solo in HTTPS e con un dispositivo che li ha configurati.
  // Elenco in verticale (una riga per metodo, si sceglie scorrendo la pagina), non a schede: con le schede Stripe mostra
  // 3 metodi e nasconde gli altri dietro un menu "altro" (un <select> che sul telefono è scomodo e taglia il logo).
  // Email e telefono NON si chiedono (richiesta esplicita del 21/10/2026): sono già nell'account dell'installatore e il server li mette nella pagina
  // (data-email / data-telefono). Si nascondono i campi di Stripe e gli stessi valori si passano alla conferma (billing_details): con un campo "never" Stripe
  // pretende il dato in confirmPayment. Se l'account non ha un dato valido (stringa vuota) quel campo resta com'era, così il pagamento non si blocca.
  const email = (radice.dataset.email || '').trim();
  const telefono = (radice.dataset.telefono || '').trim();
  const datiFatturazione = {};
  const campiNascosti = {};
  if (email) { datiFatturazione.email = email; campiNascosti.email = 'never'; }
  if (telefono) { datiFatturazione.phone = telefono; campiNascosti.phone = 'never'; }
  const pagamento = elements.create('payment', {
    layout: { type: 'accordion', defaultCollapsed: true, radios: true, spacedAccordionItems: true, visibleAccordionItemsCount: 10 },
    defaultValues: { billingDetails: datiFatturazione },
    fields: { billingDetails: campiNascosti },
  });
  pagamento.mount('#elemento-pagamento');
  pagamento.on('ready', function () { pulsante.disabled = false; });
  pagamento.on('loaderror', function (e) {
    mostraErrore((e && e.error && e.error.message) || 'Non riesco a mostrare il modulo di pagamento. Ricarica la pagina.');
  });

  let inCorso = false;
  pulsante.addEventListener('click', async function () {
    if (inCorso) return;
    inCorso = true;
    pulsante.disabled = true;
    pulsante.textContent = 'Sto pagando…';
    mostraErrore('');

    const esito = await stripe.confirmPayment({
      elements: elements,
      confirmParams: { return_url: radice.dataset.ritorno, payment_method_data: { billing_details: datiFatturazione } },
      redirect: 'if_required',
    });

    if (esito.error) {
      // Carta rifiutata, dati incompleti, 3-D Secure non superato: si resta qui e si può riprovare.
      mostraErrore(esito.error.message || 'Il pagamento non è andato a buon fine. Riprova.');
      pulsante.disabled = false;
      pulsante.textContent = etichetta;
      inCorso = false;
      return;
    }
    // Nessun reindirizzamento (carta senza 3-D Secure): si va al ritorno a mano, con lo stesso parametro che
    // Stripe aggiunge quando reindirizza.
    window.location.assign(radice.dataset.ritorno + '?payment_intent=' + encodeURIComponent(esito.paymentIntent.id));
  });

  // Tornando con "indietro" il browser può rimostrare la pagina com'era, col pulsante bloccato.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    inCorso = false;
    pulsante.disabled = false;
    pulsante.textContent = etichetta;
  });
})();
