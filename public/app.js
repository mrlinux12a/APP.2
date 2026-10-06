/* Comportamenti lato client dell'app cliente: selettori quantità, ricerca parziale
   mentre si digita, countdown della finestra di 10 minuti e notifiche del browser. */

/* Pezzi condivisi fra i blocchi di questo file (ognuno vive nel suo scope). */
const Minuteria = (function () {
  'use strict';

  // Stesso tetto del server (src/input.js): una quantità oltre non ha senso per un articolo di minuteria.
  const QUANTITA_MASSIMA = 9999;

  function limitaQuantita(n) {
    return Math.min(QUANTITA_MASSIMA, Math.max(0, n));
  }

  // Legge la risposta JSON di una chiamata a /api/...: con la sessione scaduta il server risponde 401 e si
  // torna al login (prima il redirect finiva in una pagina HTML e `.json()` andava in errore, senza alcun
  // messaggio). L'errore lanciato porta sessioneScaduta = true, così chi chiama non mostra anche un avviso.
  function leggiJson(risposta) {
    if (risposta.status === 401) {
      window.location.href = '/login';
      const errore = new Error('sessione scaduta');
      errore.sessioneScaduta = true;
      throw errore;
    }
    return risposta.json();
  }

  // Mostra una notifica di sistema. `new Notification(...)` esiste su desktop e iOS, ma Chrome per Android lo
  // rifiuta (TypeError): lì si passa dal service worker (/sw.js), che gestisce anche il tocco sulla notifica.
  function mostraNotifica(titolo, testo, link, tag) {
    try {
      const notifica = new Notification(titolo, { body: testo, tag: tag });
      if (link) {
        notifica.onclick = function () {
          window.focus();
          window.location.href = link;
        };
      }
      return;
    } catch (err) { /* si prova con il service worker */ }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then(function (registrazione) {
        return registrazione.showNotification(titolo, { body: testo, tag: tag, data: { link: link || '/' } });
      })
      .catch(function () { /* niente notifica: l'avviso resta comunque in "Stato ordini" */ });
  }

  return { QUANTITA_MASSIMA: QUANTITA_MASSIMA, limitaQuantita: limitaQuantita, leggiJson: leggiJson, mostraNotifica: mostraNotifica };
})();

(function () {
  'use strict';

  const { QUANTITA_MASSIMA, limitaQuantita, leggiJson, mostraNotifica } = Minuteria;

  // ---------- Selettore quantità (+ / -) e Aggiungi globale ----------
  function aggiornaBadgeCarrello(pezzi) {
    const badge = document.querySelector('[data-nav-badge]');
    if (badge) {
      if (pezzi > 0) { badge.textContent = pezzi; badge.removeAttribute('hidden'); }
      else badge.setAttribute('hidden', '');
    }
    const wrap = document.querySelector('[data-carrello-wrap]');
    const vuoto = document.querySelector('[data-carrello-vuoto]');
    const conta = document.querySelector('[data-carrello-conta]');
    const vai = document.querySelector('[data-vai-carrello]');
    if (conta) conta.textContent = pezzi;
    if (wrap) { if (pezzi > 0) wrap.removeAttribute('hidden'); else wrap.setAttribute('hidden',''); }
    if (vuoto) { if (pezzi > 0) vuoto.setAttribute('hidden',''); else vuoto.removeAttribute('hidden'); }
    if (vai) { if (pezzi > 0) vai.removeAttribute('hidden'); else vai.setAttribute('hidden',''); }
    ricalcolaBarra();
  }

  function aggiornaMiniCard(prodottoId, qty) {
    const card = document.querySelector('[data-nel-carrello="' + prodottoId + '"]');
    if (!card) return;
    const num = card.querySelector('[data-qta-carrello]');
    if (num) num.textContent = qty;
    if (qty > 0) card.removeAttribute('hidden');
    else card.setAttribute('hidden','');
  }

  function ricalcolaBarra() {
    let pendenti = 0;
    document.querySelectorAll('input[data-qta]').forEach(function (i) {
      pendenti += Math.max(0, parseInt(i.value, 10) || 0);
    });
    const wrap = document.querySelector('[data-pendenti-wrap]');
    const num = document.querySelector('[data-pendenti]');
    const sep = document.querySelector('[data-sep-pendenti]');
    const barra = document.querySelector('[data-barra-carrello]');
    const btn = document.querySelector('[data-aggiungi-tutti]');
    const badge = document.querySelector('[data-nav-badge]');
    const carrelloPezzi = badge && !badge.hasAttribute('hidden') ? parseInt(badge.textContent,10)||0 : 0;
    // pendenti count
    if (wrap) { if (pendenti > 0) { wrap.removeAttribute('hidden'); if(num) num.textContent = pendenti; } else wrap.setAttribute('hidden',''); }
    if (sep) {
      const carrelloVis = document.querySelector('[data-carrello-wrap]') && !document.querySelector('[data-carrello-wrap]').hasAttribute('hidden');
      if (pendenti > 0 && carrelloVis) sep.removeAttribute('hidden'); else sep.setAttribute('hidden','');
    }
    if (btn) {
      btn.disabled = pendenti === 0;
      btn.textContent = pendenti > 0 ? 'Aggiungi (' + pendenti + ')' : 'Aggiungi';
    }
    if (barra) {
      if (pendenti > 0 || carrelloPezzi > 0) barra.removeAttribute('hidden');
      else barra.setAttribute('hidden','');
    }
  }

  // Stepper catalogo (+/-)
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-passo]');
    if (!btn) return;
    e.preventDefault();
    const stepper = btn.closest('.stepper');
    const input = stepper ? stepper.querySelector('input[data-qta]') : btn.parentElement.querySelector('input[type="number"]');
    if (!input) return;
    const passo = parseInt(btn.dataset.passo, 10);
    input.value = limitaQuantita((parseInt(input.value, 10) || 0) + passo);
    ricalcolaBarra();
  });

  document.addEventListener('input', function (e) {
    if (e.target.matches('input[data-qta]')) ricalcolaBarra();
  });

  ricalcolaBarra();

  // Click Aggiungi globale -> raccoglie tutti gli stepper con qty>0 e invia batch
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-aggiungi-tutti]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    const items = [];
    document.querySelectorAll('input[data-qta]').forEach(function (inp) {
      const q = Math.max(0, parseInt(inp.value, 10) || 0);
      if (q > 0) {
        const id = inp.getAttribute('data-prodotto-qta');
        if (id) items.push({ id: id, qty: q });
      }
    });
    if (!items.length) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '…';
    fetch('/api/carrello/aggiungi-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
    })
      .then(leggiJson)
      .then(function (d) {
        if (!d.ok) throw new Error(d.errore || 'errore');
        // reset tutti gli stepper a 0
        document.querySelectorAll('input[data-qta]').forEach(function (inp) { inp.value = 0; });
        // aggiorna mini-card per ogni prodotto aggiunto
        Object.keys(d.aggiornati || {}).forEach(function (pid) { aggiornaMiniCard(pid, d.aggiornati[pid]); });
        // fallback: se il server non ha rimandato tutti, usa carrello
        if (d.carrello) Object.keys(d.carrello).forEach(function (pid) { if (!(pid in (d.aggiornati||{}))) aggiornaMiniCard(pid, d.carrello[pid]); });
        aggiornaBadgeCarrello(d.pezzi);
        ricalcolaBarra();
        btn.textContent = 'Aggiunto ✓';
        setTimeout(function () { ricalcolaBarra(); }, 900);
      })
      .catch(function (err) {
        btn.textContent = old;
        btn.disabled = false;
        if (err && err.sessioneScaduta) return;
        window.alert('Non è stato possibile aggiungere al carrello.');
      });
  });

  // ---------- Carrello: modifica quantità e rimozione ----------
  // Più tocchi ravvicinati su + e − fanno un solo salvataggio e un solo ricaricamento: prima
  // ogni tocco ricaricava tutta la pagina (cinque tocchi, cinque ricaricamenti da mezzo
  // secondo l'uno). Le quantità si mandano una alla volta: richieste in parallelo sulla stessa
  // sessione si sovrascriverebbero a vicenda.
  const quantitaDaSalvare = {};
  let timerSalvataggioCarrello = null;
  function programmaSalvataggioCarrello(id, qty) {
    quantitaDaSalvare[id] = qty;
    clearTimeout(timerSalvataggioCarrello);
    timerSalvataggioCarrello = setTimeout(function () {
      const voci = Object.keys(quantitaDaSalvare).map(function (k) { return { id: k, qty: quantitaDaSalvare[k] }; });
      Object.keys(quantitaDaSalvare).forEach(function (k) { delete quantitaDaSalvare[k]; });
      voci
        .reduce(function (catena, voce) {
          return catena.then(function () {
            return fetch('/api/carrello/imposta', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(voce),
            })
              .then(leggiJson)
              .then(function (d) { if (d && typeof d.pezzi === 'number') aggiornaBadgeCarrello(d.pezzi); });
          });
        }, Promise.resolve())
        .catch(function () { /* la pagina si ricarica comunque e mostra il carrello vero */ })
        .then(function () { if (!invioCarrelloInCorso) window.location.reload(); });
    }, 400);
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-passo-carrello]');
    if (!btn) return;
    e.preventDefault();
    const stepper = btn.closest('[data-stepper-carrello]');
    const id = stepper ? stepper.getAttribute('data-stepper-carrello') : null;
    const input = document.querySelector('[data-qta-carrello-input="' + id + '"]');
    if (!input || !id) return;
    const passo = parseInt(btn.dataset.passoCarrello, 10);
    // Nel carrello il minimo è 1: per togliere del tutto una riga c'è il pulsante
    // "Rimuovi" dedicato, non si arriva a 0 scalando con lo stepper.
    const nuovo = Math.max(1, Math.min(QUANTITA_MASSIMA, (parseInt(input.value, 10) || 0) + passo));
    input.value = nuovo;
    const meno = stepper.querySelector('[data-passo-carrello="-1"]');
    if (meno) meno.disabled = nuovo <= 1;
    programmaSalvataggioCarrello(id, nuovo);
  });

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-rimuovi]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute('data-rimuovi');
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: 0 }),
    })
      .then(function () { window.location.reload(); })
      .catch(function () { window.location.reload(); });
  });

  // Quantità scritta a mano: si salva quando il campo perde il fuoco e la pagina si ricarica
  // per aggiornare totale e ordine minimo. Prima non si salvava mai (il pulsante "Aggiorna"
  // a cui si affidava non esiste) e la richiesta partiva con la quantità vecchia.
  let invioCarrelloInCorso = false;
  document.addEventListener('change', function (e) {
    if (!e.target.matches('[data-qta-carrello-input]')) return;
    const id = e.target.getAttribute('data-qta-carrello-input');
    const qty = limitaQuantita(parseInt(e.target.value, 10) || 0);
    // Il campo mostra il valore davvero salvato (con il tetto applicato).
    e.target.value = qty;
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: qty }),
    })
      .then(function () { if (!invioCarrelloInCorso) window.location.reload(); })
      .catch(function () { if (!invioCarrelloInCorso) window.location.reload(); });
  });

  // "Paga e invia la richiesta" è un form separato: porta con sé le quantità visibili,
  // così vale quello che il cliente vede anche se il salvataggio sopra non ha fatto in tempo.
  document.addEventListener('submit', function (e) {
    const form = e.target.closest('[data-invia-carrello]');
    if (!form) return;
    invioCarrelloInCorso = true;
    document.querySelectorAll('[data-qta-carrello-input]').forEach(function (inp) {
      const campo = document.createElement('input');
      campo.type = 'hidden';
      campo.name = 'quantita_' + inp.getAttribute('data-qta-carrello-input');
      campo.value = limitaQuantita(parseInt(inp.value, 10) || 0);
      form.appendChild(campo);
    });
  });

  // ---------- Carrello: indirizzo di consegna ("Cambia") e nota facoltativa ----------
  // Il campo "destinazione" è sempre nel form (anche nascosto, parte comunque con la richiesta): "Cambia"
  // lo mostra, "Fatto" lo richiude e riscrive la scheda. Invio dentro il campo vale "Fatto": prima
  // inviava il form, cioè pagava.
  (function () {
    const consegna = document.querySelector('[data-consegna]');
    const campo = consegna && consegna.querySelector('input[name="destinazione"]');
    const zonaCampo = consegna && consegna.querySelector('[data-consegna-campo]');
    const bottone = consegna && consegna.querySelector('[data-consegna-cambia]');
    const via = consegna && consegna.querySelector('[data-consegna-via]');
    const citta = consegna && consegna.querySelector('[data-consegna-citta]');
    // Se manca un solo pezzo della scheda non si fa niente: un errore qui fermerebbe tutto il resto dello script.
    if (campo && zonaCampo && bottone && via && citta) {
      const apri = function () {
        zonaCampo.hidden = false;
        bottone.textContent = 'Fatto';
        campo.focus();
      };
      const conferma = function () {
        const testo = campo.value.trim();
        if (!testo) { campo.focus(); return; }
        const taglio = testo.indexOf(',');
        via.textContent = taglio === -1 ? testo : testo.slice(0, taglio).trim();
        citta.textContent = taglio === -1 ? '' : testo.slice(taglio + 1).trim();
        zonaCampo.hidden = true;
        bottone.textContent = 'Cambia';
      };
      bottone.addEventListener('click', function () { if (zonaCampo.hidden) apri(); else conferma(); });
      campo.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); conferma(); }
      });
    }

    const nota = document.querySelector('[data-nota]');
    const testoNota = nota && nota.querySelector('textarea');
    const titoloNota = nota && nota.querySelector('summary');
    if (nota && testoNota && titoloNota) {
      const testo = testoNota;
      // Già scritta (il browser rimette il testo dopo un ricaricamento): si mostra aperta.
      const apriSeScritta = function () { if (testo.value.trim()) nota.open = true; };
      apriSeScritta();
      window.addEventListener('pageshow', apriSeScritta);
      // Il fuoco va nel campo solo se è l'utente ad aprirla: all'apertura automatica aprirebbe la tastiera.
      titoloNota.addEventListener('click', function () {
        if (!nota.open) setTimeout(function () { testo.focus(); }, 0);
      });
    }
  })();

  // ---------- Helper condivisi per costruire una card prodotto da JSON ----------
  // (usati sia dalla ricerca live sotto, sia dallo scroll infinito delle categorie)

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Blocco stepper/mini-carrello (o messaggio "non disponibile"): usato sia al primo
  // disegno della card, sia quando si cambia variante dal selettore misure.
  function azioniHtml(id, disponibilita) {
    if (disponibilita === 'non_disponibile') return '<div class="meta">non disponibile</div>';
    return (
      '<div class="prodotto-azioni">' +
      '<div class="stepper">' +
      '<button type="button" data-passo="-1" aria-label="Togli">−</button>' +
      '<input type="number" min="0" max="9999" step="1" inputmode="numeric" data-qta data-prodotto-qta="' + id + '" value="0">' +
      '<button type="button" data-passo="1" aria-label="Aggiungi">+</button>' +
      '</div>' +
      '<div class="mini-carrello" data-nel-carrello="' + id + '" hidden><span>Nel carrello: <strong data-qta-carrello="' + id + '">0</strong> pz</span></div>' +
      '</div>'
    );
  }

  // Con 2 varianti bastano due chip affiancati; da 3 in su un pulsante apre il pannello dal basso
  // (deve restare uguale a views/partials/misura.ejs).
  const SOGLIA_CHIP = 2;
  const FRECCIA_MISURA = '<svg class="misura-freccia" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // Blocco "Misura" di un prodotto con varianti (occhiello + chip o pulsante) e l'attributo con i dati delle
  // varianti: condivisi fra la card classica e la riga compatta della categoria. Le etichette arrivano già
  // scritte come misure ("108 × 60 × 44 cm") dal server (catalogo.etichettaVariante), qui non si rifanno.
  // Deve restare uguale a views/partials/misura.ejs.
  function misuraHtml(p) {
    if (!p.varianti) return '';
    const info = p.varianti_info || { voce: 'Misura', ordine: '', occhiello: 'Misura', titolo: 'Scegli la misura' };
    const n = p.varianti.length;
    const scelta = p.varianti.find(function (v) { return v.id === p.id; }) || p.varianti[0];
    return (
      '<div class="misura" data-misura><div class="misura-occhiello">' + esc(info.occhiello) +
      (n > SOGLIA_CHIP ? ' · ' + n + ' disponibili' : '') + '</div>' +
      (n > SOGLIA_CHIP
        ? '<button type="button" class="misura-apri" data-misura-apri aria-haspopup="dialog" data-pannello-titolo="' + esc(info.titolo) +
          '" data-pannello-sotto="' + esc(p.nome + (info.ordine ? ' · ' + info.ordine : '')) + '">' +
          '<span class="misura-sr">' + esc(info.voce) + ' di ' + esc(p.nome) + ': </span>' +
          '<span class="misura-testo" data-misura-testo>' + esc(scelta.etichetta) + '</span>' + FRECCIA_MISURA + '</button>'
        : '<div class="misura-chip" role="radiogroup" aria-label="' + esc(info.voce) + ' di ' + esc(p.nome) + '">' +
          p.varianti.map(function (v) {
            const attiva = v.id === scelta.id;
            return '<button type="button" class="misura-opz' + (attiva ? ' attivo' : '') + '" role="radio" aria-checked="' + attiva +
              '" tabindex="' + (attiva ? 0 : -1) + '" data-variante-id="' + v.id + '">' + esc(v.etichetta) + '</button>';
          }).join('') + '</div>') +
      '</div>'
    );
  }

  function variantiAttr(p) {
    return p.varianti ? ' data-varianti=\'' + esc(JSON.stringify(p.varianti)).replace(/'/g, '&#39;') + '\'' : '';
  }

  function cardProdottoHtml(p) {
    const barrato = p.sconto_base_pct > 0
      ? '<span class="barrato">€ ' + p.listino + '</span>'
      : '';
    const varianti = misuraHtml(p);
    return (
      '<div class="prodotto" data-prodotto="' + p.id + '"' + variantiAttr(p) +
      '>' +
      '<div class="info">' +
      '<div class="nome">' +
      (p.brand_nome
        ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' +
          esc(p.brand_nome) + '</span> '
        : '') +
      esc(p.nome) + '</div>' +
      varianti +
      '<div class="meta" data-riga-meta><span data-riga-codice hidden>' + esc(p.codice) + '</span>' + esc(p.macro_nome || '') +
      (p.raee ? ' · RAEE € ' + p.raee : '') +
      ' <span class="badge badge-' + p.disponibilita + '" data-riga-badge>' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="prezzo" data-riga-prezzo>' + barrato + '€ ' + p.prezzo + ' <span class="iva">+ IVA</span></div>' +
      '</div>' +
      '<div class="prodotto-laterale">' +
      (p.foto_url
        ? '<img class="prodotto-foto" src="' + esc(p.foto_url) + '" alt="" loading="lazy">'
        : '<div class="prodotto-foto prodotto-foto-vuota" aria-hidden="true"></div>') +
      '<div data-riga-azioni>' + azioniHtml(p.id, p.disponibilita) + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  // ---------- Righe compatte della categoria: − N + che scrive subito nel carrello ----------
  // Solo la pagina categoria (#risultati[data-righe-compatte]; il markup server è in
  // views/partials/prodotto_riga.ejs e deve restare uguale a rigaCompattaHtml qui sotto). Il numero
  // sullo stepper è la quantità già nel carrello, non un contatore a parte: ogni tocco lo cambia
  // subito a schermo e la quantità va a /api/carrello/imposta, una richiesta alla volta (richieste
  // parallele sulla stessa sessione si sovrascriverebbero) e, per lo stesso prodotto, solo l'ultimo
  // valore. Se il salvataggio fallisce il numero torna a quello confermato dal server.
  //   salvate: carrello come l'ha confermato il server { id: qty }
  //   volute:  quantità mostrate e non ancora confermate { id: qty }
  //   pezzi:   pezzi totali nel carrello secondo il server (comprende i prodotti fuori pagina)
  const radiceRighe = document.querySelector('[data-righe-compatte]');
  const iconaFotoVuota = radiceRighe ? radiceRighe.dataset.iconaVuota || '' : '';
  const righe = { salvate: {}, volute: {}, pezzi: 0, inCorso: false, dopo: [] };

  function carrelloNormalizzato(c) {
    const out = {};
    Object.keys(c || {}).forEach(function (id) {
      const q = parseInt(c[id], 10) || 0;
      if (q > 0) out[id] = q;
    });
    return out;
  }

  if (radiceRighe) {
    try { righe.salvate = carrelloNormalizzato(JSON.parse(radiceRighe.dataset.carrello || '{}')); } catch (err) { /* parte vuoto */ }
    righe.pezzi = parseInt(radiceRighe.dataset.pezzi, 10) || 0;
  }

  function qtaRiga(id) {
    return id in righe.volute ? righe.volute[id] : (righe.salvate[id] || 0);
  }

  function pezziRighe() {
    let scarto = 0;
    Object.keys(righe.volute).forEach(function (id) { scarto += righe.volute[id] - (righe.salvate[id] || 0); });
    return Math.max(0, righe.pezzi + scarto);
  }

  function prodottoDaSalvare() {
    return Object.keys(righe.volute).find(function (id) { return righe.volute[id] !== (righe.salvate[id] || 0); });
  }

  function disegnaRiga(id) {
    const q = qtaRiga(id);
    document.querySelectorAll('[data-riga-stepper="' + id + '"]').forEach(function (st) {
      st.classList.toggle('attivo', q > 0);
      const num = st.querySelector('[data-riga-qta]');
      if (num) num.textContent = q;
      const meno = st.querySelector('[data-riga-passo="-1"]');
      if (meno) meno.disabled = q <= 0;
    });
  }

  // Pallino del Carrello nella navbar e barra "N pezzi · Vai al carrello" (solo con pezzi > 0).
  function disegnaTotaliRighe() {
    const pezzi = pezziRighe();
    aggiornaBadgeCarrello(pezzi);
    const barra = document.querySelector('[data-barra-vai]');
    if (!barra) return;
    barra.hidden = pezzi <= 0;
    const testo = barra.querySelector('[data-barra-pezzi]');
    if (testo) testo.textContent = pezzi + (pezzi === 1 ? ' pezzo' : ' pezzi');
  }

  function ridisegnaRighe() {
    document.querySelectorAll('[data-riga-stepper]').forEach(function (st) {
      disegnaRiga(st.getAttribute('data-riga-stepper'));
    });
    disegnaTotaliRighe();
  }

  function segnalaErroreRiga(id) {
    document.querySelectorAll('[data-riga-stepper="' + id + '"]').forEach(function (st) {
      st.classList.remove('errore');
      void st.offsetWidth; // riparte l'animazione anche se era già in corso
      st.classList.add('errore');
      setTimeout(function () { st.classList.remove('errore'); }, 700);
    });
  }

  function salvaRighe() {
    if (righe.inCorso) return;
    const id = prodottoDaSalvare();
    if (id === undefined) {
      righe.volute = {}; // tutto uguale al server
      const dopo = righe.dopo;
      righe.dopo = [];
      dopo.forEach(function (f) { f(); });
      return;
    }
    righe.inCorso = true;
    fetch('/api/carrello/imposta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, qty: righe.volute[id] }),
      keepalive: true, // un salvataggio partito non si perde se si cambia pagina subito dopo
    })
      .then(function (r) { if (!r.ok && r.status !== 401) throw new Error('http'); return leggiJson(r); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error('rifiutato');
        righe.salvate = carrelloNormalizzato(d.carrello);
        righe.pezzi = parseInt(d.pezzi, 10) || 0;
        Object.keys(righe.volute).forEach(function (k) {
          if (righe.volute[k] === (righe.salvate[k] || 0)) delete righe.volute[k];
        });
      })
      .catch(function () {
        delete righe.volute[id]; // il numero torna a quello di prima
        segnalaErroreRiga(id);
      })
      .then(function () {
        righe.inCorso = false;
        ridisegnaRighe();
        salvaRighe();
      });
  }

  // Tornando con "indietro" la pagina può riapparire com'era, con le quantità di prima: si rileggono.
  function sincronizzaRighe() {
    fetch('/api/carrello', { cache: 'no-store' })
      .then(leggiJson)
      .then(function (d) {
        if (!d || !d.carrello || righe.inCorso || prodottoDaSalvare() !== undefined) return;
        righe.salvate = carrelloNormalizzato(d.carrello);
        righe.pezzi = parseInt(d.pezzi, 10) || 0;
        righe.volute = {};
        ridisegnaRighe();
      })
      .catch(function () { /* resta quello che c'è */ });
  }

  if (radiceRighe) {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-riga-passo]');
      if (!btn) return;
      e.preventDefault();
      if (btn.disabled) return;
      const stepper = btn.closest('[data-riga-stepper]');
      if (!stepper) return;
      const id = stepper.getAttribute('data-riga-stepper');
      const prima = qtaRiga(id);
      const dopo = limitaQuantita(prima + parseInt(btn.getAttribute('data-riga-passo'), 10));
      if (dopo === prima) return;
      righe.volute[id] = dopo;
      disegnaRiga(id);
      disegnaTotaliRighe();
      salvaRighe();
    });

    // Un link toccato mentre un salvataggio è ancora in corso (ultimo + e subito "Vai al carrello")
    // aspetta che il carrello sia aggiornato: sulla pagina dopo si vedrebbe il numero vecchio.
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest('a[href]');
      if (!link || link.target === '_blank') return;
      if (!righe.inCorso && prodottoDaSalvare() === undefined) return;
      e.preventDefault();
      let partito = false;
      const vai = function () { if (!partito) { partito = true; window.location.href = link.href; } };
      righe.dopo.push(vai);
      setTimeout(vai, 3000); // rete che non risponde: si va comunque
    });

    window.addEventListener('pageshow', function (e) {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      if (e.persisted || (nav && nav.type === 'back_forward')) sincronizzaRighe();
    });
  }

  // Home, ricerca, marchio, "con foto": tornando con "indietro" la pagina può riapparire com'era, con il carrello di
  // prima nella barra "Vai al carrello" e nel pallino. Si rilegge (le pagine categoria lo fanno già con le loro righe).
  if (!radiceRighe && document.body.dataset.loggato === '1' && document.querySelector('[data-nav-badge]')) {
    window.addEventListener('pageshow', function (e) {
      const nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
      if (!e.persisted && !(nav && nav.type === 'back_forward')) return;
      fetch('/api/carrello', { cache: 'no-store' })
        .then(leggiJson)
        .then(function (d) { if (d && typeof d.pezzi === 'number') aggiornaBadgeCarrello(d.pezzi); })
        .catch(function () { /* resta quello che c'è */ });
    });
  }

  function stepperRigaHtml(id, disponibilita, qty) {
    if (disponibilita === 'non_disponibile') return '';
    return (
      '<div class="riga-stepper' + (qty > 0 ? ' attivo' : '') + '" data-riga-stepper="' + id +
      '" role="group" aria-label="Quantità nel carrello">' +
      '<button type="button" class="riga-passo" data-riga-passo="-1" aria-label="Togli uno"' + (qty > 0 ? '' : ' disabled') +
      '><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>' +
      '<span class="riga-qta" data-riga-qta="' + id + '" aria-live="polite">' + qty + '</span>' +
      '<button type="button" class="riga-passo" data-riga-passo="1" aria-label="Aggiungi uno">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>' +
      '</div>'
    );
  }

  function prezzoRigaHtml(prezzo, listino, scontoPct, raee) {
    return (
      (scontoPct > 0 ? '<span class="barrato">€ ' + listino + '</span>' : '') +
      '<span class="importo">€ ' + prezzo + '</span> <span class="iva">+ IVA</span>' +
      (raee ? '<span class="raee">RAEE € ' + raee + '</span>' : '')
    );
  }

  function rigaCompattaHtml(p) {
    const foto = p.foto_url
      ? '<img class="prodotto-foto riga-foto" src="' + esc(p.foto_url) + '" alt="" loading="lazy">'
      : '<div class="riga-foto riga-foto-vuota" aria-hidden="true">' + iconaFotoVuota + '</div>';
    const marchio = p.brand_nome
      ? '<span class="marchio-tag" style="--marchio:' + esc(p.brand_colore || '#1d4e89') + '">' + esc(p.brand_nome) + '</span> '
      : '';
    return (
      '<div class="riga-prod" data-prodotto="' + p.id + '" data-riga-compatta' + variantiAttr(p) + '>' +
      foto +
      '<div class="riga-info">' +
      '<div class="riga-nome">' + marchio + esc(p.nome) + '</div>' +
      misuraHtml(p) +
      '<div class="riga-stato" data-riga-stato' + (p.disponibilita === 'disponibile' ? ' hidden' : '') + '>' +
      '<span class="badge badge-' + p.disponibilita + '" data-riga-badge>' + esc(p.disponibilita_testo) + '</span></div>' +
      '<div class="riga-prezzo" data-riga-prezzo>' + prezzoRigaHtml(p.prezzo, p.listino, p.sconto_base_pct, p.raee) + '</div>' +
      '</div>' +
      '<div class="riga-azioni" data-riga-azioni>' + stepperRigaHtml(p.id, p.disponibilita, qtaRiga(p.id)) + '</div>' +
      '</div>'
    );
  }

  // Cambio misura dentro una riga compatta: prezzo, stato e stepper (con la quantità già nel
  // carrello per quella misura) passano alla variante scelta.
  function applicaVarianteRiga(card, v) {
    segnaMisuraScelta(card, v);
    const badge = card.querySelector('[data-riga-badge]');
    if (badge) {
      badge.className = 'badge badge-' + v.disponibilita;
      badge.textContent = v.disponibilita_testo || v.disponibilita;
    }
    const stato = card.querySelector('[data-riga-stato]');
    if (stato) stato.hidden = v.disponibilita === 'disponibile';
    const prezzo = card.querySelector('[data-riga-prezzo]');
    if (prezzo) prezzo.innerHTML = prezzoRigaHtml(v.prezzo, v.listino, v.sconto_base_pct, v.raee);
    const azioni = card.querySelector('[data-riga-azioni]');
    if (azioni) azioni.innerHTML = stepperRigaHtml(v.id, v.disponibilita, qtaRiga(v.id));
  }

  // ---------- Selettore varianti (misure) dentro una card prodotto ----------
  // Chip e pulsante del pannello mostrano la misura scelta: la card passa alla variante `v`.
  function segnaMisuraScelta(card, v) {
    card.setAttribute('data-prodotto', v.id);
    card.querySelectorAll('[data-variante-id]').forEach(function (c) {
      const attivo = c.getAttribute('data-variante-id') === String(v.id);
      c.classList.toggle('attivo', attivo);
      c.setAttribute('aria-checked', attivo ? 'true' : 'false');
      c.tabIndex = attivo ? 0 : -1;
    });
    const testo = card.querySelector('[data-misura-testo]');
    if (testo) testo.textContent = v.etichetta;
  }

  // Aggiorna la card (prezzo, codice, disponibilità, stepper) sulla variante scelta,
  // sia che arrivi da un chip cliccato sia dal pannello delle misure.
  function applicaVariante(card, v) {
    if (card.hasAttribute('data-riga-compatta')) { applicaVarianteRiga(card, v); return; }
    segnaMisuraScelta(card, v);
    const codiceEl = card.querySelector('[data-riga-codice]');
    if (codiceEl) codiceEl.textContent = v.codice;
    const badgeEl = card.querySelector('[data-riga-badge]');
    if (badgeEl) {
      badgeEl.className = 'badge badge-' + v.disponibilita;
      badgeEl.textContent = v.disponibilita_testo || v.disponibilita;
    }
    const prezzoEl = card.querySelector('[data-riga-prezzo]');
    if (prezzoEl) {
      const barrato = v.sconto_base_pct > 0 ? '<span class="barrato">€ ' + v.listino + '</span>' : '';
      prezzoEl.innerHTML = barrato + '€ ' + v.prezzo + ' <span class="iva">+ IVA</span>';
    }
    const azioniEl = card.querySelector('[data-riga-azioni]');
    if (azioniEl) azioniEl.innerHTML = azioniHtml(v.id, v.disponibilita);

    risincronizzaCarrelloVisibile();
    ricalcolaBarra();
  }

  function variantiDellaCard(card) {
    try { return JSON.parse(card.getAttribute('data-varianti')); } catch (err) { return null; }
  }

  function trovaVariante(card, id) {
    const varianti = variantiDellaCard(card);
    return (varianti && varianti.find(function (x) { return String(x.id) === String(id); })) || null;
  }

  document.addEventListener('click', function (e) {
    const chip = e.target.closest('[data-variante-id]');
    if (!chip) return;
    e.preventDefault();
    const card = chip.closest('[data-varianti]');
    if (!card) return;
    const v = trovaVariante(card, chip.getAttribute('data-variante-id'));
    if (v) applicaVariante(card, v);
  });

  // Chip e righe del pannello sono un gruppo di radio: le frecce scelgono la misura accanto (e la applicano).
  document.addEventListener('keydown', function (e) {
    const passo = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const el = passo && e.target.closest ? e.target.closest('.misura-opz, .misura-riga') : null;
    if (!el) return;
    e.preventDefault();
    const sorelle = Array.prototype.slice.call(el.parentNode.children);
    const prossima = sorelle[(sorelle.indexOf(el) + passo + sorelle.length) % sorelle.length];
    prossima.focus();
    prossima.click();
  });

  // ---------- Pannello "Scegli la misura" (da 3 varianti in su) ----------
  // Uno solo per pagina: nasce al primo tocco e ogni volta si riempie dai data-varianti della riga toccata.
  // Toccare una misura la applica subito alla riga (prezzo, stepper e carrello come con i chip): "Conferma",
  // il velo ed Esc chiudono soltanto, e il fuoco torna sul pulsante della misura.
  const pannelloMisura = { velo: null, elenco: null, apritore: null, card: null };

  function rigaPannelloHtml(v, scelta) {
    return (
      '<button type="button" class="misura-riga' + (scelta ? ' attivo' : '') + '" role="radio" aria-checked="' + scelta +
      '" tabindex="' + (scelta ? 0 : -1) + '" data-pannello-variante="' + v.id + '">' +
      '<span class="misura-radio" aria-hidden="true"></span>' +
      '<span class="misura-riga-testo">' + esc(v.etichetta) + '</span>' +
      '<span class="misura-riga-prezzo">€ ' + esc(v.prezzo) + '</span></button>'
    );
  }

  function chiudiPannelloMisura() {
    const velo = pannelloMisura.velo;
    if (!velo || velo.hidden) return;
    velo.hidden = true;
    document.documentElement.classList.remove('misura-aperta');
    const apritore = pannelloMisura.apritore;
    pannelloMisura.apritore = pannelloMisura.card = null;
    if (apritore && apritore.isConnected) apritore.focus();
  }

  function creaPannelloMisura() {
    const velo = document.createElement('div');
    velo.className = 'misura-velo';
    velo.hidden = true;
    velo.innerHTML =
      '<div class="misura-pannello" role="dialog" aria-modal="true" aria-labelledby="misura-titolo">' +
      '<div class="misura-maniglia" aria-hidden="true"></div>' +
      '<h2 class="misura-titolo" id="misura-titolo"></h2><p class="misura-sotto"></p>' +
      '<div class="misura-elenco" role="radiogroup" aria-labelledby="misura-titolo"></div>' +
      '<button type="button" class="misura-conferma">Conferma</button></div>';
    document.body.appendChild(velo);
    pannelloMisura.velo = velo;
    pannelloMisura.elenco = velo.querySelector('.misura-elenco');

    velo.addEventListener('click', function (e) {
      if (e.target === velo || e.target.closest('.misura-conferma')) { chiudiPannelloMisura(); return; }
      const riga = e.target.closest('[data-pannello-variante]');
      const card = pannelloMisura.card;
      const v = riga && card && trovaVariante(card, riga.getAttribute('data-pannello-variante'));
      if (!v) return;
      applicaVariante(card, v);
      pannelloMisura.elenco.querySelectorAll('[data-pannello-variante]').forEach(function (r) {
        r.classList.toggle('attivo', r === riga);
        r.setAttribute('aria-checked', r === riga ? 'true' : 'false');
        r.tabIndex = r === riga ? 0 : -1;
      });
    });
  }

  function apriPannelloMisura(apritore) {
    const card = apritore.closest('[data-varianti]');
    const varianti = card && variantiDellaCard(card);
    if (!varianti || !varianti.length) return;
    if (!pannelloMisura.velo) creaPannelloMisura();
    const velo = pannelloMisura.velo;
    const elenco = pannelloMisura.elenco;
    const idScelto = String(card.getAttribute('data-prodotto'));
    pannelloMisura.apritore = apritore;
    pannelloMisura.card = card;
    velo.querySelector('.misura-titolo').textContent = apritore.getAttribute('data-pannello-titolo') || 'Scegli la misura';
    velo.querySelector('.misura-sotto').textContent = apritore.getAttribute('data-pannello-sotto') || '';
    elenco.innerHTML = varianti.map(function (v) { return rigaPannelloHtml(v, String(v.id) === idScelto); }).join('');
    velo.hidden = false;
    document.documentElement.classList.add('misura-aperta');
    const scelta = elenco.querySelector('.attivo') || elenco.firstElementChild;
    if (!scelta) return;
    scelta.focus({ preventScroll: true });
    // Con molte misure l'elenco scorre: la scelta si porta a metà, non resta fuori vista.
    elenco.scrollTop = scelta.offsetTop - (elenco.clientHeight - scelta.offsetHeight) / 2;
  }

  document.addEventListener('click', function (e) {
    const apri = e.target.closest('[data-misura-apri]');
    if (!apri) return;
    e.preventDefault();
    apriPannelloMisura(apri);
  });

  // Esc chiude; Tab resta dentro il pannello (la riga scelta e "Conferma").
  document.addEventListener('keydown', function (e) {
    const velo = pannelloMisura.velo;
    if (!velo || velo.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); chiudiPannelloMisura(); return; }
    if (e.key !== 'Tab') return;
    const fuochi = Array.prototype.filter.call(velo.querySelectorAll('button'), function (b) { return b.tabIndex >= 0; });
    const primo = fuochi[0];
    const ultimo = fuochi[fuochi.length - 1];
    if (!primo) return;
    if (!velo.contains(document.activeElement)) { e.preventDefault(); primo.focus(); }
    else if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus(); }
  });

  // Dopo aver inserito nuove card nel DOM: aggancia i loro quantità/mini-carrello e
  // aggiorna la barra in fondo. Serve sia dopo una sostituzione che dopo un'aggiunta.
  function risincronizzaCarrelloVisibile() {
    fetch('/api/carrello').then(leggiJson).then(function (d) {
      if (!d.carrello) return;
      Object.keys(d.carrello).forEach(function (id) { aggiornaMiniCard(id, d.carrello[id]); });
    }).catch(function () {});
    ricalcolaBarra();
  }

  // ---------- Ricerca parziale mentre si digita ----------

  const campoRicerca = document.querySelector('[data-ricerca]');
  const contenitore = document.getElementById('risultati');
  // Nella categoria l'elenco è fatto di righe compatte (vedi sopra), altrove di card classiche.
  const righeCompatte = !!(contenitore && contenitore.hasAttribute('data-righe-compatte'));
  const costruisciRiga = righeCompatte ? rigaCompattaHtml : cardProdottoHtml;
  const classeElenco = righeCompatte ? 'card card-fitta elenco-righe' : 'card card-fitta griglia-prodotti';

  // Ricerca e scroll infinito (più sotto) lavorano sullo stesso elenco. Finché si vedono i risultati di una ricerca lo
  // scroll infinito sta fermo: prima accodava ai risultati le pagine successive della categoria (da 2 risultati si
  // arrivava a 40 articoli che non c'entravano). Svuotando il campo si rimette l'elenco di partenza, e lo scroll
  // riparte dalla pagina con cui era stato disegnato: senza, le pagine già caricate e poi tolte non tornavano più.
  // `generazione` cambia a ogni passaggio, così una pagina richiesta prima della ricerca e arrivata dopo si scarta.
  const scorrimento = {
    generazione: 0,
    ferma: function () { this.generazione++; this.inRicerca = true; },
    riparti: function () { this.generazione++; this.inRicerca = false; },
    inRicerca: false,
    ripristina: function () {}, // lo imposta lo scroll infinito, se la pagina ce l'ha
    sostituisceLaPaginazione: false, // vero se lo scroll infinito ha nascosto i pulsanti di pagina
  };

  if (campoRicerca && contenitore) {
    let timer = null;
    let ultima = campoRicerca.value.trim();
    // Elenco mostrato all'apertura della pagina: si ripristina svuotando la ricerca.
    const contenutoIniziale = contenitore.innerHTML;
    const paginazione = document.querySelector('[data-paginazione]');
    // Ambito della pagina (categoria, marchio, famiglia, gruppo): la ricerca resta lì dentro.
    const ambito = campoRicerca.dataset.ambito || '';

    campoRicerca.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(cerca, 220);
    });

    function mostraPaginazione(visibile) {
      if (!paginazione) return;
      // Con lo scroll infinito i pulsanti di pagina restano nascosti anche dopo una ricerca: prima ricomparivano.
      if (visibile && !scorrimento.sostituisceLaPaginazione) paginazione.removeAttribute('hidden');
      else paginazione.setAttribute('hidden', '');
    }

    function cerca() {
      const q = campoRicerca.value.trim();
      if (q === ultima) return;
      ultima = q;
      if (q.length < 2) {
        scorrimento.riparti();
        contenitore.innerHTML = contenutoIniziale;
        scorrimento.ripristina();
        mostraPaginazione(true);
        ricalcolaBarra();
        // L'elenco di partenza ha le quantità di quando la pagina è stata caricata: si rimettono quelle di ora.
        if (righeCompatte) ridisegnaRighe();
        return;
      }
      scorrimento.ferma();
      fetch('/api/cerca?q=' + encodeURIComponent(q) + (ambito ? '&' + ambito : ''))
        .then(leggiJson)
        .then(function (dati) {
          if (campoRicerca.value.trim() !== q) return;
          // Da cellulare, sostituire il contenuto della pagina mentre si sta scrivendo
          // può far sparire la tastiera (il browser toglie il focus dal campo quando il
          // layout intorno cambia): se l'utente sta ancora scrivendo qui, si rimette il
          // focus subito dopo aver ridisegnato i risultati.
          const eraFocus = document.activeElement === campoRicerca;
          mostraPaginazione(false);
          disegnaRisultati(dati.risultati || []);
          if (eraFocus) campoRicerca.focus();
        })
        .catch(function () { /* offline: resta l'ultimo elenco mostrato */ });
    }

    function disegnaRisultati(risultati) {
      if (!risultati.length) {
        contenitore.innerHTML =
          '<div class="vuoto"><span class="emoji">🤷</span>Nessun prodotto trovato.</div>';
        return;
      }
      contenitore.innerHTML = '<div class="' + classeElenco + '">' + risultati.map(costruisciRiga).join('') + '</div>';
      if (!righeCompatte) risincronizzaCarrelloVisibile();
    }
  }

  // ---------- Scroll infinito nelle categorie ----------
  // La prima pagina arriva già renderizzata dal server (partials/paginazione fa da
  // fallback se JS non parte); da qui in poi, avvicinandosi al fondo della lista si
  // carica ed accoda la pagina successiva, senza bisogno di cliccare "Successiva".
  (function () {
    const scrollInfinito = document.querySelector('[data-scroll-infinito]');
    if (!scrollInfinito || !contenitore) return;

    let pagina = parseInt(scrollInfinito.dataset.pagina, 10) || 1;
    let pagine = parseInt(scrollInfinito.dataset.pagine, 10) || 1;
    const paginaIniziale = pagina;
    const pagineIniziali = pagine;
    let caricamento = false;
    const urlBase = scrollInfinito.dataset.url;

    const paginazione = document.querySelector('[data-paginazione]');
    if (paginazione) paginazione.setAttribute('hidden', ''); // sostituita dallo scroll
    scorrimento.sostituisceLaPaginazione = true;

    const sentinella = document.createElement('div');
    sentinella.setAttribute('data-sentinella-scroll', '');
    scrollInfinito.after(sentinella);

    function caricaProssimaPagina() {
      if (caricamento || scorrimento.inRicerca || pagina >= pagine) return;
      caricamento = true;
      const generazione = scorrimento.generazione;
      fetch(urlBase + (urlBase.indexOf('?') === -1 ? '?' : '&') + 'pagina=' + (pagina + 1))
        .then(leggiJson)
        .then(function (dati) {
          // Nel frattempo è partita (o finita) una ricerca: questa pagina non appartiene più all'elenco mostrato.
          if (generazione !== scorrimento.generazione) return;
          const cardFitta = contenitore.querySelector('.card-fitta');
          if (cardFitta && dati.risultati && dati.risultati.length) {
            cardFitta.insertAdjacentHTML('beforeend', dati.risultati.map(costruisciRiga).join(''));
            if (!righeCompatte) risincronizzaCarrelloVisibile();
          }
          pagina = dati.pagina || pagina + 1;
          pagine = dati.pagine || pagine;
          caricamento = false;
          if (pagina >= pagine) osservatore.disconnect();
        })
        .catch(function () { if (generazione === scorrimento.generazione) caricamento = false; });
    }

    const osservatore = new IntersectionObserver(function (voci) {
      if (voci[0].isIntersecting) caricaProssimaPagina();
    }, { rootMargin: '400px' });
    osservatore.observe(sentinella);

    // Svuotata la ricerca l'elenco è di nuovo la prima pagina: si riparte da lì (e si riaccende l'osservatore, che
    // poteva essersi spento arrivando all'ultima pagina; osservando di nuovo se ne ottiene subito lo stato).
    scorrimento.ripristina = function () {
      caricamento = false;
      pagina = paginaIniziale;
      pagine = pagineIniziali;
      osservatore.disconnect();
      if (pagina < pagine) osservatore.observe(sentinella);
    };
  })();

  // ---------- Schermata di attesa: countdown + polling ----------

  const attesa = document.querySelector('[data-attesa]');
  if (attesa) {
    let secondi = parseInt(attesa.dataset.secondi, 10) || 0;
    const orologio = document.getElementById('countdown');
    const elenco = document.getElementById('stato-distributori');
    const richiestaId = attesa.dataset.attesa;

    function mostraTempo() {
      if (!orologio) return;
      const s = Math.max(0, secondi);
      orologio.textContent =
        String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    setInterval(function () {
      secondi = Math.max(0, secondi - 1);
      mostraTempo();
    }, 1000);
    mostraTempo();

    const etichette = {
      in_attesa: ['Sta verificando', 'stato-in_attesa'],
      confermato: ['Disponibile', 'stato-confermato'],
      non_disponibile: ['Non disponibile', 'stato-non_disponibile'],
      scaduto: ['Nessuna risposta', 'stato-scaduto'],
    };

    setInterval(function () {
      fetch('/api/richieste/' + richiestaId)
        .then(leggiJson)
        .then(function (dati) {
          if (typeof dati.secondi === 'number') secondi = dati.secondi;
          if (elenco && dati.risposte) {
            dati.risposte.forEach(function (r) {
              // Confronto sull'attributo invece di un selettore CSS: un nome con le virgolette lo rompeva.
              const nodo = Array.prototype.find.call(elenco.querySelectorAll('[data-distributore]'), function (el) {
                return el.getAttribute('data-distributore') === r.nome;
              });
              if (!nodo) return;
              const et = etichette[r.esito] || etichette.in_attesa;
              nodo.textContent = et[0];
              nodo.className = 'stato-badge ' + et[1];
            });
          }
          // L'ordine è nato (corriere trovato): si va dritti all'ordine, con il banner di conferma.
          if (dati.order_id) window.location.href = '/ordini/' + dati.order_id + '?nuovo=1';
          else if (dati.stato !== 'in_attesa') window.location.reload();
        })
        .catch(function () { /* riprova al giro dopo */ });
    }, 3000);
  }

  // ---------- Notifiche del browser ----------

  const pulsanteNotifiche = document.querySelector('[data-abilita-notifiche]');
  if (pulsanteNotifiche && 'Notification' in window) {
    if (Notification.permission === 'granted') pulsanteNotifiche.hidden = true;
    pulsanteNotifiche.addEventListener('click', function () {
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') {
          pulsanteNotifiche.hidden = true;
          mostraNotifica('Notifiche attive', 'Ti avviseremo quando i distributori rispondono.', null, 'minuteria-attive');
        }
      });
    });
  }

  if ('Notification' in window && document.body.dataset.loggato === '1') {
    setInterval(function () {
      if (Notification.permission !== 'granted') return;
      fetch('/api/notifiche/push')
        .then(leggiJson)
        .then(function (dati) {
          (dati.notifiche || []).forEach(function (n) {
            mostraNotifica(n.titolo, n.testo, n.link, 'minuteria-' + n.id);
          });
        })
        .catch(function () { /* nessuna notifica questo giro */ });
    }, 10000);
  }
})();

/* Nome utente: si scrive tutto attaccato, quindi spazi e maiuscole spariscono da soli. */
(function () {
  'use strict';
  const campo = document.querySelector('[data-utente]');
  if (!campo) return;

  campo.addEventListener('input', function () {
    const posizione = campo.selectionStart;
    const prima = campo.value;
    const dopo = prima
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9._-]/g, '');
    if (dopo !== prima) {
      campo.value = dopo;
      const scarto = prima.length - dopo.length;
      campo.setSelectionRange(Math.max(0, posizione - scarto), Math.max(0, posizione - scarto));
    }
  });
})();

/* Sconti a scalare: mostra lo sconto effettivo mentre il banco scrive gli scaglioni. */
(function () {
  'use strict';

  const righe = document.querySelectorAll('[data-riga-sconti]');
  if (!righe.length) return;

  function calcola(riga) {
    const campi = riga.querySelectorAll('[data-scaglione]');
    let residuo = 1;
    let almenoUno = false;

    campi.forEach(function (c) {
      const n = parseFloat(String(c.value).replace(',', '.'));
      if (Number.isFinite(n) && n > 0) {
        residuo *= 1 - Math.min(90, n) / 100;
        almenoUno = true;
      }
    });

    const box = riga.querySelector('[data-effettivo]');
    const valore = riga.querySelector('[data-valore-effettivo]');
    if (!box || !valore) return;

    if (!almenoUno) {
      box.setAttribute('hidden', '');
      return;
    }
    valore.textContent = String(Math.round((1 - residuo) * 1000) / 10).replace('.', ',');
    box.removeAttribute('hidden');
  }

  righe.forEach(function (riga) {
    riga.addEventListener('input', function (e) {
      if (e.target.matches('[data-scaglione]')) calcola(riga);
    });
    calcola(riga);
  });
})();

/* Menu del profilo in alto a destra: dentro ci sta anche l'uscita. Il cliente ha un pannello con un velo scuro
   dietro (partials/appbar.ejs), banco e agente una tendina. Il pannello del cliente sta fuori dall'appbar, quindi
   pulsante, pannello e velo si cercano nella pagina e non dentro un contenitore comune. */
(function () {
  'use strict';

  const bottone = document.querySelector('[data-menu-apri]');
  const tendina = document.querySelector('[data-menu-tendina]');
  if (!bottone || !tendina) return;
  const velo = document.querySelector('[data-menu-velo]'); // solo nel menu del cliente

  function aperto() {
    return !tendina.hasAttribute('hidden');
  }

  function voci() {
    return Array.prototype.slice.call(tendina.querySelectorAll('[role="menuitem"]'));
  }

  function apri(si) {
    if (si) tendina.removeAttribute('hidden');
    else tendina.setAttribute('hidden', '');
    if (velo) {
      if (si) velo.removeAttribute('hidden');
      else velo.setAttribute('hidden', '');
    }
    bottone.setAttribute('aria-expanded', si ? 'true' : 'false');
  }

  // Esc e tocco sul velo: il focus torna sul pulsante, da cui si era aperto il menu.
  function chiudiERiportaIlFocus() {
    apri(false);
    bottone.focus();
  }

  bottone.addEventListener('click', function (e) {
    e.stopPropagation();
    const siApre = !aperto();
    apri(siApre);
    // Aperto da tastiera (un click senza puntatore ha detail 0): il focus entra nel menu, sulla prima voce.
    if (siApre && e.detail === 0 && voci().length) voci()[0].focus();
  });

  if (velo) velo.addEventListener('click', chiudiERiportaIlFocus);

  document.addEventListener('click', function (e) {
    if (aperto() && !tendina.contains(e.target) && !bottone.contains(e.target)) apri(false);
  });

  document.addEventListener('keydown', function (e) {
    if (!aperto()) return;
    if (e.key === 'Escape') {
      chiudiERiportaIlFocus();
      return;
    }
    const lista = voci();
    const attivo = document.activeElement;
    if (!lista.length || !(tendina.contains(attivo) || attivo === bottone)) return;
    const i = lista.indexOf(attivo);
    let prossima = null;
    if (e.key === 'ArrowDown') prossima = lista[(i + 1) % lista.length];
    else if (e.key === 'ArrowUp') prossima = lista[i <= 0 ? lista.length - 1 : i - 1];
    else if (e.key === 'Home') prossima = lista[0];
    else if (e.key === 'End') prossima = lista[lista.length - 1];
    if (prossima) {
      e.preventDefault();
      prossima.focus();
    }
  });

  // Con Tab fuori dal pannello il menu si chiude, invece di restare aperto sotto il velo.
  tendina.addEventListener('focusout', function (e) {
    if (aperto() && e.relatedTarget && !tendina.contains(e.relatedTarget) && e.relatedTarget !== bottone) apri(false);
  });

  // Tornando indietro da una voce del menu la pagina può riapparire dalla cache col menu ancora aperto.
  window.addEventListener('pageshow', function () {
    apri(false);
  });
})();

/* Countdown generico: qualsiasi elemento con data-countdown-live si aggiorna da solo
   ogni secondo (finestra di risposta del banco, elenco richieste, ecc.), invece di
   restare fermo al valore calcolato dal server al momento del caricamento pagina.
   Con data-ricarica-a-zero, allo scadere ricarica la pagina per mostrare il nuovo stato. */
(function () {
  'use strict';
  document.querySelectorAll('[data-countdown-live]').forEach(function (el) {
    let sec = parseInt(el.getAttribute('data-secondi'), 10) || 0;
    if (sec <= 0) return;
    const ricarica = el.hasAttribute('data-ricarica-a-zero');
    setInterval(function () {
      sec = Math.max(0, sec - 1);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      if (sec === 0 && ricarica) setTimeout(function () { window.location.reload(); }, 2500);
    }, 1000);
  });
})();

/* Banco distributore: pausa/riattiva la ricezione di nuove richieste, cambio istantaneo
   senza ricaricare la pagina (la sede resta comunque attiva sulla piattaforma). */
(function () {
  'use strict';
  const btn = document.querySelector('[data-toggle-banco]');
  if (!btn) return;
  const testo = btn.querySelector('[data-toggle-banco-testo]');

  btn.addEventListener('click', function () {
    const attivoOra = btn.dataset.attivo === '1';
    const nuovo = !attivoOra;
    btn.disabled = true;
    fetch('/api/distributore/stato', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attivo: nuovo }),
    })
      .then(Minuteria.leggiJson)
      .then(function (d) {
        if (!d || typeof d.attivo !== 'boolean') throw new Error('risposta non valida');
        btn.dataset.attivo = d.attivo ? '1' : '0';
        btn.classList.toggle('attivo', d.attivo);
        btn.classList.toggle('pausa', !d.attivo);
        if (testo) testo.textContent = d.attivo ? 'Banco operativo · Ricezione attiva' : 'Non disponibile · In pausa';
      })
      .catch(function (err) {
        if (!(err && err.sessioneScaduta)) window.alert('Non è stato possibile cambiare lo stato del banco.');
      })
      .finally(function () { btn.disabled = false; });
  });
})();

/* Impedisce il doppio invio dei form che cambiano stato (conferma ordine, risposta del
   banco, elimina...): un doppio tap — frequente su rete lenta da cantiere, quando non si
   vede subito una reazione — poteva mandare due POST identiche in rapida successione.
   Il server si difende comunque (la richiesta passa a 'ordinata' una volta sola, vedi
   creaOrdineDaRisposta in src/flusso_cliente.js), ma è meglio non generarla nemmeno la seconda richiesta. Generico: si applica a ogni <form> dell'app,
   non solo a quello dell'ordine. */
document.addEventListener('submit', function (e) {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const bottoni = form.querySelectorAll('button[type="submit"], input[type="submit"]');
  if (!bottoni.length) return;
  // Il ritardo di un tick lascia al browser il tempo di leggere quale bottone è stato
  // premuto (nome/valore) prima di disabilitarlo: alcuni form hanno più bottoni di invio
  // diversi (es. "Conferma" / "Rifiuta") e disabilitarli subito, in modo sincrono, rischia
  // di far perdere quale dei due ha davvero avviato l'invio.
  setTimeout(function () {
    bottoni.forEach(function (b) {
      // Solo quelli attivi: un pulsante già disabilitato dal server (es. "Paga" sotto il minimo) deve restarlo.
      if (b.disabled) return;
      b.disabled = true;
      b.setAttribute('data-bloccato-da-invio', '');
    });
  }, 0);
}, true);

/* Tornando con "indietro" dopo un invio (anche finito con un errore) il browser può rimostrare la pagina
   com'era, con i pulsanti ancora bloccati: si riattivano. */
window.addEventListener('pageshow', function (e) {
  if (!e.persisted) return;
  document.querySelectorAll('[data-bloccato-da-invio]').forEach(function (b) {
    b.disabled = false;
    b.removeAttribute('data-bloccato-da-invio');
  });
});

/* Pagine del venditore (home, ordini da evadere, clienti, dettaglio richiesta): richieste e ordini
   appena arrivati compaiono senza premere F5. Ogni pochi secondi chiede al server due numeri
   leggeri (/api/distributore/novita) e li confronta con quelli con cui la pagina è stata disegnata
   (data-versione): se sono cambiati si ricarica. Non dipende da una ricarica a tempo, che si salta
   quando la scheda è in secondo piano. Se la scheda è nascosta o l'utente sta scrivendo in un
   campo aspetta, e ricarica appena torna in primo piano o esce dal campo. */
(function () {
  'use strict';
  const ms = parseInt(document.body.dataset.autoRefresh, 10);
  if (!ms) return;

  const versionePagina = document.body.dataset.versione || null;
  let inCorso = false;
  let daRicaricare = false;
  let erroriDiFila = 0;

  function suCampo() {
    const attivo = document.activeElement;
    return !!attivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(attivo.tagName);
  }

  function ricarica() {
    if (document.hidden || suCampo()) {
      daRicaricare = true;
      return;
    }
    window.location.reload();
  }

  function riprendi() {
    if (daRicaricare && !document.hidden && !suCampo()) window.location.reload();
  }

  function controlla() {
    if (inCorso) return;
    inCorso = true;
    fetch('/api/distributore/novita', { cache: 'no-store', credentials: 'same-origin' })
      .then(Minuteria.leggiJson)
      .then(function (d) {
        erroriDiFila = 0;
        if (versionePagina !== null && JSON.stringify(d) !== versionePagina) ricarica();
      })
      .catch(function () {
        // Il controllo leggero non risponde (sessione scaduta, proxy, rete): si torna alla
        // ricarica a tempo, che almeno porta alla pagina di accesso o all'elenco aggiornato.
        erroriDiFila += 1;
        if (erroriDiFila >= 3) ricarica();
      })
      .then(function () { inCorso = false; });
  }

  setInterval(controlla, Math.min(ms, 5000));
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    riprendi();
    controlla();
  });
  document.addEventListener('focusout', function () { setTimeout(riprendi, 300); });
  window.addEventListener('online', controlla);
  // Tornando con "indietro" il browser può rimostrare la pagina com'era: va ridisegnata.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) window.location.reload();
  });
})();

/* Foto prodotto a schermo intero: un tap sulla miniatura la apre ingrandita. Delegato su
   document (le card della ricerca live/scroll infinito vengono ridisegnate a runtime, un
   listener messo sulla singola <img> al caricamento pagina non le coprirebbe). Il segnaposto
   invisibile (.prodotto-foto-vuota, dove non c'è ancora una foto vera) è escluso. */
(function () {
  'use strict';
  let overlay = null;

  function apri(src) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'foto-overlay';
      overlay.innerHTML =
        '<button type="button" class="foto-overlay-chiudi" aria-label="Chiudi">' +
        '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>' +
        '</button>' +
        '<img class="foto-overlay-img" alt="">';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('.foto-overlay-chiudi')) chiudi();
      });
    }
    overlay.querySelector('.foto-overlay-img').src = src;
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }

  function chiudi() {
    if (!overlay) return;
    overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    const foto = e.target.closest('.prodotto-foto:not(.prodotto-foto-vuota)');
    if (!foto) return;
    apri(foto.src);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') chiudi();
  });
})();

/* Ordine in consegna (views/ordine_dettaglio.ejs): l'anello si svuota e la barra "In consegna" si riempie man
   mano che passa il tempo fino all'arrivo previsto. Il riquadro [data-viaggio] porta la durata totale e i secondi
   rimasti al momento del disegno (calcolati sul server, quindi l'ora del PC non c'entra); da lì conta l'orologio
   del browser. Un aggiornamento ogni 30 secondi basta: l'anello copre ore. Senza orario d'arrivo (durata 0)
   resta com'è stato disegnato. Non chiamarlo [data-consegna]: è già la scheda "Consegna in cantiere" del carrello,
   e il suo blocco in alto in questo file va in errore (e ferma tutto lo script) se non trova i suoi pulsanti. */
(function () {
  'use strict';
  const riquadro = document.querySelector('[data-viaggio]');
  if (!riquadro) return;
  const durata = Number(riquadro.getAttribute('data-durata')) || 0;
  if (!durata) return;
  const arco = riquadro.querySelector('[data-viaggio-arco]');
  const barra = riquadro.querySelector('[data-viaggio-barra]');
  const circ = arco ? Number(arco.getAttribute('data-circ')) || 402.12 : 0;
  const fine = Date.now() + (Number(riquadro.getAttribute('data-rimanente')) || 0) * 1000;

  function aggiorna() {
    // Quanto resta: 1 appena confermato, 0 all'arrivo previsto o dopo (anello vuoto, barra piena).
    const rimasto = Math.min(1, Math.max(0, (fine - Date.now()) / 1000 / durata));
    if (arco) arco.style.strokeDashoffset = (circ * (1 - rimasto)).toFixed(2);
    if (barra) barra.style.width = ((1 - rimasto) * 100).toFixed(1) + '%';
  }

  setInterval(aggiorna, 30000);
  // Un timer in una scheda nascosta viene rallentato: al ritorno si riallinea subito.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) aggiorna(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) aggiorna(); });
})();

/* Password con l'occhio (partials/acc_campo.ejs): il pulsante parte nascosto, perché senza script non farebbe niente.
   Mostra o nasconde il testo del campo accanto e aggiorna etichetta e stato per chi usa uno screen reader. */
(function () {
  'use strict';
  const pulsanti = document.querySelectorAll('[data-mostra-password]');
  if (!pulsanti.length) return;
  pulsanti.forEach(function (pulsante) {
    pulsante.hidden = false;
    pulsante.addEventListener('click', function () {
      const campo = pulsante.parentNode.querySelector('input');
      if (!campo) return;
      const mostra = campo.type === 'password';
      campo.type = mostra ? 'text' : 'password';
      pulsante.setAttribute('aria-pressed', mostra ? 'true' : 'false');
      pulsante.setAttribute('aria-label', mostra ? 'Nascondi password' : 'Mostra password');
    });
  });
})();

/* Registrazione a passi (views/registrati.ejs): un solo modulo diviso in tre fieldset, qui se ne mostra uno alla volta.
   "Avanti" controlla solo i campi del passo corrente (la validazione vera resta sul server); dopo un errore del server
   la pagina arriva già sul primo passo sbagliato (data-passo-iniziale). Senza script i tre blocchi restano tutti
   visibili e il modulo funziona come un modulo qualunque. */
(function () {
  'use strict';
  const radice = document.querySelector('[data-registrazione]');
  if (!radice) return;
  const form = radice.querySelector('[data-reg-form]');
  const passi = Array.prototype.slice.call(radice.querySelectorAll('[data-reg-passo]'));
  const segmenti = radice.querySelectorAll('.reg-avanzamento span');
  const avanti = radice.querySelector('[data-reg-avanti]');
  const indietro = radice.querySelector('[data-reg-indietro]');
  if (!form || passi.length < 2 || !avanti) return;

  const ultimo = passi.length - 1;
  let corrente = Math.min(passi.length, Math.max(1, Number(radice.getAttribute('data-passo-iniziale')) || 1)) - 1;

  // Un fieldset nascosto con un campo non valido farebbe fallire l'invio del browser senza un messaggio ("campo non
  // focalizzabile"): i controlli li facciamo noi, passo per passo, prima dell'invio.
  form.noValidate = true;
  radice.setAttribute('data-passi', 'attivi');

  function campiDel(indice) {
    return Array.prototype.slice.call(passi[indice].querySelectorAll('input, select, textarea'));
  }

  // Primo campo non valido del passo, o null.
  function primoSbagliato(indice) {
    return campiDel(indice).find(function (campo) { return !campo.checkValidity(); }) || null;
  }

  function mostra(indice, conFocus) {
    corrente = indice;
    passi.forEach(function (passo, i) { passo.hidden = i !== indice; });
    segmenti.forEach(function (segmento, i) { segmento.classList.toggle('fatto', i <= indice); });
    avanti.textContent = indice === ultimo ? "Crea l'anagrafica" : 'Avanti';
    if (conFocus) {
      window.scrollTo(0, 0);
      const primo = campiDel(indice).find(function (campo) { return campo.type !== 'radio'; });
      if (primo) primo.focus({ preventScroll: true });
    }
  }

  // Mostra il passo e fa uscire il messaggio del browser sul campo sbagliato.
  function segnala(indice, campo) {
    if (indice !== corrente) mostra(indice, false);
    campo.focus({ preventScroll: true });
    campo.reportValidity();
  }

  avanti.addEventListener('click', function (e) {
    if (corrente < ultimo) {
      e.preventDefault();
      const sbagliato = primoSbagliato(corrente);
      if (sbagliato) return segnala(corrente, sbagliato);
      return mostra(corrente + 1, true);
    }
    // Ultimo passo: prima di inviare si controllano tutti, e si torna sul primo che ha un problema.
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  // Rete di sicurezza (invio con Invio da un campo, o da script): non deve partire un modulo con un passo sbagliato.
  form.addEventListener('submit', function (e) {
    for (let i = 0; i <= ultimo; i++) {
      const sbagliato = primoSbagliato(i);
      if (sbagliato) {
        e.preventDefault();
        return segnala(i, sbagliato);
      }
    }
  });

  if (indietro) {
    indietro.addEventListener('click', function (e) {
      if (corrente > 0) {
        e.preventDefault();
        mostra(corrente - 1, false);
        window.scrollTo(0, 0);
      }
    });
  }

  mostra(corrente, false);
})();

/* Service worker: serve a mostrare le notifiche dove `new Notification` non esiste (Chrome per Android) e a
   rendere l'app installabile sulla schermata Home. Non mette in cache pagine né file: restano sempre quelli
   del server. Funziona solo in HTTPS (o su localhost): altrove il browser non lo offre e non succede niente. */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* l'app funziona anche senza */ });
  });
}
