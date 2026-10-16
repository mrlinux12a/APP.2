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

  // "8 min", "1 h 05": una durata in minuti come la scrive la home del banco (uguale a format.durataMinuti sul server).
  function durataMinuti(min) {
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  }

  // "meno di 1 min", "3 min", "1 h 05": quanto tempo è passato da quando il banco ha confermato ("Corriere avvisato · da 3 min",
  // sulla home e nel dettaglio della richiesta). Uguale a format.daMinuti.
  function daMinuti(secondi) {
    const min = Math.max(0, Math.floor(secondi / 60));
    return min < 1 ? 'meno di 1 min' : durataMinuti(min);
  }

  // "04:13" che sale, "1 h 05" oltre l'ora (cerchio dell'attesa del corriere). Uguale a format.tempoTrascorso.
  function tempoTrascorso(secondi) {
    const s = Math.max(0, Math.floor(secondi));
    if (s >= 3600) return durataMinuti(Math.floor(s / 60));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  return {
    QUANTITA_MASSIMA: QUANTITA_MASSIMA,
    limitaQuantita: limitaQuantita,
    leggiJson: leggiJson,
    mostraNotifica: mostraNotifica,
    durataMinuti: durataMinuti,
    daMinuti: daMinuti,
    tempoTrascorso: tempoTrascorso,
  };
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

  // ---------- Quantità scelte e non ancora aggiunte ----------
  // Il + del catalogo scrive solo nel campo della card: il carrello cambia quando si preme "Aggiungi". Cambiando pagina il campo
  // tornava a 0 e le scelte si perdevano. Ora stanno in `scelte` ({ id prodotto: quantità }) e si copiano in sessionStorage (una scheda
  // del browser, un utente: la chiave porta il suo id), da cui si rimettono nei campi a ogni pagina, ricerca o scroll infinito.
  // Il conto "N selezionati" e il pulsante "Aggiungi (N)" guardano `scelte`, non i campi: valgono anche per le card non in vista.
  // Senza sessionStorage (navigazione privata, blocco) le scelte restano per la sola pagina aperta, come prima.
  const SCELTE_SCADENZA_MS = 12 * 3600 * 1000;
  const metaUtente = document.querySelector('meta[name="utente"]');
  const chiaveScelte = 'minuteria.scelte.' + (metaUtente ? metaUtente.content : '');

  function leggiScelteSalvate() {
    const out = {};
    try {
      const grezzo = JSON.parse(window.sessionStorage.getItem(chiaveScelte) || 'null');
      if (!grezzo || typeof grezzo.q !== 'object' || !grezzo.q || Date.now() - (Number(grezzo.t) || 0) > SCELTE_SCADENZA_MS) return out;
      Object.keys(grezzo.q).forEach(function (id) {
        const n = limitaQuantita(parseInt(grezzo.q[id], 10) || 0);
        if (n > 0 && /^\d+$/.test(id)) out[id] = n;
      });
    } catch (err) { /* storage assente o contenuto non valido: si riparte vuoti */ }
    return out;
  }

  let scelte = leggiScelteSalvate();

  function salvaScelte() {
    try {
      if (Object.keys(scelte).length) window.sessionStorage.setItem(chiaveScelte, JSON.stringify({ t: Date.now(), q: scelte }));
      else window.sessionStorage.removeItem(chiaveScelte);
    } catch (err) { /* resta solo in questa pagina */ }
  }

  function impostaScelta(id, qta) {
    if (!id) return;
    const n = limitaQuantita(parseInt(qta, 10) || 0);
    if (n > 0) scelte[id] = n; else delete scelte[id];
    salvaScelte();
  }

  // Rimette nei campi di `radice` le quantità scelte. Con `azzera` anche chi non ha una scelta torna a 0 (tornando con "indietro" la
  // pagina può riapparire con i campi di prima: vale quello che c'è in memoria ora).
  function applicaScelte(radice, azzera) {
    (radice || document).querySelectorAll('input[data-qta]').forEach(function (inp) {
      const id = inp.getAttribute('data-prodotto-qta');
      if (id in scelte) inp.value = scelte[id];
      else if (azzera) inp.value = 0;
    });
  }

  function ricalcolaBarra() {
    let pendenti = 0;
    Object.keys(scelte).forEach(function (id) { pendenti += scelte[id]; });
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
    impostaScelta(input.getAttribute('data-prodotto-qta'), input.value);
    ricalcolaBarra();
  });

  document.addEventListener('input', function (e) {
    if (!e.target.matches('input[data-qta]')) return;
    impostaScelta(e.target.getAttribute('data-prodotto-qta'), e.target.value);
    ricalcolaBarra();
  });

  // Le scelte di prima (altra pagina, altra ricerca) tornano nei campi di questa pagina.
  applicaScelte(document);
  ricalcolaBarra();
  // Pagina rimostrata dal tasto "indietro" (bfcache) o tornata in primo piano: le scelte vere sono quelle salvate, che un'altra pagina
  // può aver cambiato nel frattempo.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    scelte = leggiScelteSalvate();
    applicaScelte(document, true);
    ricalcolaBarra();
  });

  // Click Aggiungi globale -> raccoglie tutti gli stepper con qty>0 e invia batch
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-aggiungi-tutti]');
    if (!btn) return;
    e.preventDefault();
    if (btn.disabled) return;
    // Si aggiunge tutto quello che è stato scelto, anche nelle card che non sono in questa pagina (altra ricerca, pagina precedente).
    const inviati = Object.keys(scelte).map(function (id) { return { id: id, qty: scelte[id] }; });
    const items = inviati.filter(function (v) { return v.qty > 0; });
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
        // Aggiunto: le scelte non ci sono più (né in memoria né salvate) e tutti gli stepper tornano a 0.
        items.forEach(function (v) { delete scelte[v.id]; });
        salvaScelte();
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
    if (azioniEl) {
      // La quantità scelta per la misura di prima non passa a quella nuova: la card riparte da quanto era stato scelto per questa.
      const campoPrima = azioniEl.querySelector('input[data-qta]');
      if (campoPrima && campoPrima.getAttribute('data-prodotto-qta') !== String(v.id)) impostaScelta(campoPrima.getAttribute('data-prodotto-qta'), 0);
      azioniEl.innerHTML = azioniHtml(v.id, v.disponibilita);
      applicaScelte(azioniEl);
    }

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
        applicaScelte(contenitore); // l'elenco di partenza ha i campi a 0: si rimettono le quantità scelte
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
      applicaScelte(contenitore); // un prodotto già scelto in una ricerca precedente riappare con la sua quantità
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
            applicaScelte(cardFitta);
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

/* Home del banco (bacheca a 3 colonne, views/distributore_richieste.ejs): fa muovere timer ed etichette a tempo.
   Ogni valore parte da quanti secondi mancano (o sono passati) quando il server ha disegnato la pagina, trasformati
   in un istante con l'orologio del browser: un conteggio non perde colpi se la scheda resta in secondo piano (i
   timer delle schede nascoste vengono rallentati) e l'orologio del PC, magari sfasato, non conta.
   - richiesta da confermare: anello che si svuota e mm:ss; rosso negli ultimi minuti (data-soglia-urgente); etichetta
     "Nuova" per i primi minuti; allo scadere la scheda si spegne e la pagina si ricarica (la richiesta non c'è più);
   - corriere avvisato: "da N min", da quando il banco ha confermato;
   - ordine da preparare: minuti all'arrivo del corriere, rossi sotto i data-soglia-arrivo minuti.
   Le soglie le scrive il server (BACHECA in server.js): le stesse che ha usato per le classi iniziali. */
(function () {
  'use strict';
  const bacheca = document.querySelector('[data-bacheca]');
  if (!bacheca) return;

  const sogliaUrgente = parseInt(bacheca.getAttribute('data-soglia-urgente'), 10) || 180;
  const sogliaArrivo = parseInt(bacheca.getAttribute('data-soglia-arrivo'), 10) || 15;
  const avvio = Date.now();

  function numero(el, nome) {
    const n = parseInt(el.getAttribute(nome), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function mmss(sec) {
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  // "8 min", "1 h 05": uguale a durata() nella vista (e a quello del dettaglio della richiesta).
  const durata = Minuteria.durataMinuti;

  // Scrive solo se il testo cambia: ogni secondo si controllano tutte le schede, ma il DOM si tocca di rado.
  function scrivi(el, testo) {
    if (el && el.textContent !== testo) el.textContent = testo;
  }

  const richieste = Array.prototype.map.call(bacheca.querySelectorAll('[data-richiesta]'), function (el) {
    const anello = el.querySelector('[data-anello]');
    const circ = anello ? parseFloat(anello.getAttribute('stroke-dasharray')) : 0;
    return {
      el: el,
      anello: anello,
      circ: circ,
      tempo: el.querySelector('[data-tempo]'),
      nuova: el.querySelector('[data-nuova]'),
      fine: avvio + numero(el, 'data-secondi') * 1000,
      finestra: Math.max(1, numero(el, 'data-finestra')),
      nuovaFine: avvio + numero(el, 'data-nuova-sec') * 1000,
      chiusa: false,
    };
  });

  const corrieri = Array.prototype.map.call(bacheca.querySelectorAll('[data-corriere]'), function (el) {
    return { el: el, da: el.querySelector('[data-da]'), inizio: avvio - numero(el, 'data-trascorsi') * 1000 };
  });

  const arrivi = Array.prototype.map.call(bacheca.querySelectorAll('[data-arrivo]'), function (el) {
    return { el: el, min: el.querySelector('[data-arrivo-min]'), fine: avvio + numero(el, 'data-secondi') * 1000 };
  });

  if (!richieste.length && !corrieri.length && !arrivi.length) return;

  function tick() {
    const adesso = Date.now();

    richieste.forEach(function (r) {
      const sec = Math.max(0, Math.ceil((r.fine - adesso) / 1000));
      scrivi(r.tempo, mmss(sec));
      if (r.anello) r.anello.style.strokeDashoffset = String((r.circ * (1 - Math.min(1, sec / r.finestra))).toFixed(2));
      r.el.classList.toggle('urgente', sec <= sogliaUrgente);
      if (r.nuova && adesso >= r.nuovaFine) {
        r.nuova.remove();
        r.nuova = null;
      }
      if (sec === 0 && !r.chiusa) {
        // La richiesta è scaduta: sparirà dalla colonna con la ricarica (la pagina si accorgerebbe da sola entro
        // pochi secondi, ma così la scheda non resta lì a contare zero).
        r.chiusa = true;
        r.el.classList.remove('urgente');
        r.el.classList.add('scaduta');
        setTimeout(function () { window.location.reload(); }, 2500);
      }
    });

    corrieri.forEach(function (c) {
      scrivi(c.da, Minuteria.daMinuti((adesso - c.inizio) / 1000));
    });

    arrivi.forEach(function (a) {
      const min = Math.ceil((a.fine - adesso) / 60000);
      scrivi(a.min, min <= 0 ? 'In ritardo' : durata(min));
      a.el.classList.toggle('vicino', min <= sogliaArrivo);
    });
  }

  tick();
  setInterval(tick, 1000);
})();

/* Dettaglio di una richiesta al banco (views/distributore_dettaglio.ejs). Due tempi, in due stati diversi:
   - "Da confermare": il timer con l'anello che si svuota (qui sotto). Come sulla home
   parte da quanti secondi mancano quando il server ha disegnato la pagina, trasformati in un istante con l'orologio del
   browser (un conteggio non perde colpi se la scheda resta in secondo piano). Negli ultimi data-soglia-urgente secondi (2
   minuti) anello e tempo passano dall'arancio al rosso; a zero la pagina si ricarica per mostrare che la richiesta è scaduta.
   - "Attesa corriere": il tempo da quando il banco ha confermato SALE (cerchio mm:ss, "1 h 05" oltre l'ora, e "da N min" nel passo
     in corso). Parte dai secondi trascorsi (data-trascorsi, calcolati dal server in SQL come per la home) e li trasforma in un istante
     col Date.now() del browser; i testi sono quelli di Minuteria (gli stessi di "Corriere avvisato · da N min" sulla home). */
(function () {
  'use strict';
  const attesa = document.querySelector('[data-ric-attesa]');
  if (attesa) {
    const inizio = Date.now() - (parseInt(attesa.getAttribute('data-trascorsi'), 10) || 0) * 1000;
    const cerchio = attesa.querySelector('[data-trascorso]');
    const da = document.querySelectorAll('[data-da]');
    const aggiorna = function () {
      const secondi = Math.max(0, (Date.now() - inizio) / 1000);
      const tempo = Minuteria.tempoTrascorso(secondi);
      if (cerchio && cerchio.textContent !== tempo) cerchio.textContent = tempo;
      const testo = Minuteria.daMinuti(secondi);
      da.forEach(function (el) { if (el.textContent !== testo) el.textContent = testo; });
    };
    aggiorna();
    setInterval(aggiorna, 1000);
  }

  // "Da preparare": minuti all'arrivo del corriere (come la pillola della home), rossi sotto la soglia; "In ritardo" a zero.
  const arrivo = document.querySelector('[data-ric-arrivo]');
  if (arrivo) {
    const min = arrivo.querySelector('[data-arrivo-min]');
    const fineArrivo = Date.now() + (parseInt(arrivo.getAttribute('data-secondi'), 10) || 0) * 1000;
    const sogliaArrivo = parseInt(arrivo.getAttribute('data-soglia-arrivo'), 10) || 15;
    const aggiornaArrivo = function () {
      const minuti = Math.ceil((fineArrivo - Date.now()) / 60000);
      const testo = minuti <= 0 ? 'In ritardo' : Minuteria.durataMinuti(minuti);
      if (min && min.textContent !== testo) min.textContent = testo;
      arrivo.classList.toggle('vicino', minuti <= sogliaArrivo);
    };
    aggiornaArrivo();
    setInterval(aggiornaArrivo, 1000);
  }

  const timer = document.querySelector('[data-ric-timer]');
  if (!timer) return;
  const tempo = timer.querySelector('[data-tempo]');
  const anello = timer.querySelector('[data-anello]');
  const circ = anello ? parseFloat(anello.getAttribute('stroke-dasharray')) : 0;

  function numero(nome) {
    const n = parseInt(timer.getAttribute(nome), 10);
    return Number.isFinite(n) ? n : 0;
  }

  const fine = Date.now() + numero('data-secondi') * 1000;
  const finestra = Math.max(1, numero('data-finestra'));
  const soglia = numero('data-soglia-urgente') || 120;
  let chiusa = false;

  function tick() {
    const sec = Math.max(0, Math.ceil((fine - Date.now()) / 1000));
    const testo = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
    if (tempo && tempo.textContent !== testo) tempo.textContent = testo;
    if (anello) anello.style.strokeDashoffset = String((circ * (1 - Math.min(1, sec / finestra))).toFixed(2));
    timer.classList.toggle('urgente', sec <= soglia);
    if (sec === 0 && !chiusa) {
      chiusa = true;
      setTimeout(function () { window.location.reload(); }, 2500);
    }
  }

  tick();
  setInterval(tick, 1000);
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

/* Pagine del banco (home, storico ordini, clienti, dettaglio richiesta): richieste e ordini
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

  // Un campo marcato data-non-ricaricare (la ricerca dello Storico ordini) con del testo non ancora inviato: la ricarica
  // lo cancellerebbe, quindi si aspetta anche se il campo non ha più il fuoco. defaultValue è ciò che il server ha
  // disegnato (la ricerca già inviata): cambiato rispetto a quello = testo non inviato.
  function conTestoNonInviato() {
    return Array.prototype.some.call(document.querySelectorAll('input[data-non-ricaricare]'), function (c) {
      return c.value !== c.defaultValue;
    });
  }

  function suCampo() {
    const attivo = document.activeElement;
    return (!!attivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(attivo.tagName)) || conTestoNonInviato();
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

/* Storico ordini del banco: la "×" per svuotare la ricerca compare appena nel campo c'è del testo (anche non ancora
   inviato) e sparisce quando è vuoto. È un link che riporta alla pagina senza ricerca, quindi funziona anche senza questo
   script (che lo mostra solo quando serve). */
(function () {
  'use strict';
  const campo = document.querySelector('[data-storico-cerca]');
  const svuota = document.querySelector('[data-storico-svuota]');
  if (!campo || !svuota) return;
  campo.addEventListener('input', function () { svuota.hidden = !campo.value; });
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

/* Consegna in arrivo: minuti, "In arrivo", barra e anello di un ordine in consegna scendono (o salgono, per la barra) col tempo,
   in modo lineare, con l'orologio del browser. Prima il testo "Arriva tra N min" lo scriveva solo il server (fermo finché non
   arrivava un aggiornamento: nella striscia con più ordini restava fisso per sempre), l'anello e la barra dell'ordine si muovevano
   a scatti ogni 30 secondi e quella della home era ferma a metà.
   Un contenitore [data-eta-sec] porta i secondi che mancano all'arrivo al momento del disegno (calcolati sul server, quindi l'ora
   del PC non c'entra; possono essere negativi) e, se c'è, [data-eta-durata] = secondi dalla nascita dell'ordine all'arrivo. Dentro:
     [data-eta-testo]  testo con {m} = minuti che mancano (mai meno di 1) o {t} = la stessa durata scritta come sulla home del banco
                       ("8 min", "5 h 57"); a 3 minuti o meno diventa solo "In arrivo", mai prima. Senza segnaposto
                       (il titolo dell'ordine) fuori dai 3 minuti torna lo stesso testo normale. Con anche [data-eta-nascondi]
                       (il badge dei minuti dell'icona, "N′") a 3 minuti o meno non si scrive "In arrivo" ma sparisce, perché
                       accanto a "In arrivo" un numero di minuti direbbe un'altra cosa.
     [data-eta-barra]  larghezza = tempo trascorso sul totale (si riempie); serve la durata.
     [data-eta-arco]   anello che si svuota (stroke-dashoffset su data-circ); serve la durata.
   Un colpo al secondo, con le transizioni CSS da 1 s lineari: il movimento è continuo. La fine di ogni contenitore si fissa la
   prima volta che lo si vede, quindi un contenitore rimpiazzato dall'aggiornamento dell'icona riparte dal suo numero nuovo e uno
   che resta non si sposta. IN_ARRIVO_SEC è la stessa soglia di format.SOGLIA_IN_ARRIVO_SEC sul server. Non usare [data-consegna]:
   è già la scheda "Consegna in cantiere" del carrello, e il suo blocco in alto in questo file va in errore (e ferma tutto lo
   script) se non trova i suoi pulsanti. */
(function () {
  'use strict';
  const IN_ARRIVO_SEC = 180;
  const fini = new WeakMap(); // contenitore [data-eta-sec] -> istante (ms) in cui si arriva

  // Secondi che mancano all'arrivo, con i decimali (anche negativi).
  function restano(contenitore) {
    let fine = fini.get(contenitore);
    if (fine === undefined) {
      fine = Date.now() + (Number(contenitore.getAttribute('data-eta-sec')) || 0) * 1000;
      fini.set(contenitore, fine);
    }
    return (fine - Date.now()) / 1000;
  }
  // Quanto resta del viaggio, da 1 (appena nato l'ordine) a 0 (arrivo previsto o dopo); null se non c'è la durata.
  function rimasto(contenitore) {
    const durata = Number(contenitore.getAttribute('data-eta-durata')) || 0;
    return durata ? Math.min(1, Math.max(0, restano(contenitore) / durata)) : null;
  }

  function aggiorna() {
    if (document.hidden) return;
    document.querySelectorAll('[data-eta-testo]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      if (!c) return;
      const s = restano(c);
      const inArrivo = s <= IN_ARRIVO_SEC;
      const minuti = Math.max(1, Math.ceil(s / 60));
      if (el.hasAttribute('data-eta-nascondi')) { // il badge dei minuti: a 3 minuti o meno sparisce, resta solo "In arrivo"; sopra i 99 non ci sta
        el.style.display = inArrivo || minuti > 99 ? 'none' : '';
        if (inArrivo || minuti > 99) return;
      }
      const testo = inArrivo
        ? 'In arrivo'
        : el.getAttribute('data-eta-testo').replace('{m}', minuti).replace('{t}', Minuteria.durataMinuti(minuti));
      if (el.textContent !== testo) el.textContent = testo;
    });
    document.querySelectorAll('[data-eta-barra]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      const r = c ? rimasto(c) : null;
      if (r !== null) el.style.width = ((1 - r) * 100).toFixed(1) + '%';
    });
    document.querySelectorAll('[data-eta-arco]').forEach(function (el) {
      const c = el.closest('[data-eta-sec]');
      const r = c ? rimasto(c) : null;
      if (r !== null) el.style.strokeDashoffset = ((Number(el.getAttribute('data-circ')) || 402.12) * (1 - r)).toFixed(2);
    });
  }

  aggiorna();
  setInterval(aggiorna, 1000);
  // Un timer in una scheda nascosta viene rallentato (e qui non si disegna): al ritorno si riallinea subito.
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

/* Clienti del banco (/distributore/clienti): il campo "Cerca" filtra subito, nel browser, i clienti da approvare, gli
   approvati e i non riconosciuti. Ogni cliente ([data-cliente]) porta in data-cerca ragione sociale, partita IVA e
   codice cliente; senza badare alle maiuscole, ogni parola scritta deve comparire in uno dei tre. Una sezione senza
   corrispondenze sparisce, il numero accanto al titolo conta quelle rimaste e, se non resta niente, compare "Nessun
   cliente trovato.". Il campo non è dentro un form e non naviga: l'aggiornamento automatico del banco aspetta che
   si smetta di scrivere (vedi sopra). */
(function () {
  'use strict';
  const campo = document.querySelector('[data-cerca-clienti]');
  if (!campo) return;
  const sezioni = Array.prototype.slice.call(document.querySelectorAll('[data-sezione-clienti]'));
  const nessuno = document.querySelector('[data-cerca-nessuno]');

  function applica() {
    const parole = campo.value.toLowerCase().split(/\s+/).filter(Boolean);
    let visibili = 0;
    sezioni.forEach(function (sezione) {
      let nella = 0;
      sezione.querySelectorAll('[data-cliente]').forEach(function (voce) {
        const testo = (voce.getAttribute('data-cerca') || '').toLowerCase();
        const trovato = parole.every(function (p) { return testo.indexOf(p) !== -1; });
        voce.hidden = !trovato;
        if (trovato) nella += 1;
      });
      visibili += nella;
      sezione.hidden = parole.length > 0 && nella === 0;
      sezione.querySelectorAll('[data-conta-sezione]').forEach(function (conta) {
        conta.textContent = parole.length ? String(nella) : conta.getAttribute('data-totale');
      });
    });
    if (nessuno) nessuno.hidden = !(parole.length > 0 && visibili === 0);
  }

  campo.addEventListener('input', applica);
  // Tornando con "indietro" il browser può rimettere il testo nel campo: l'elenco va riallineato.
  window.addEventListener('pageshow', applica);
  applica();
})();

/* Striscia degli ordini in corso (partials/striscia_ordini.ejs). Con 4 o più schede la striscia scorre di lato: al caricamento si porta in
   vista quella della pagina aperta. Swipe tra gli ordini, SOLO con la striscia e SOLO su touch: uno spostamento orizzontale sul contenuto
   (non sulla striscia) passa all'ordine successivo (verso sinistra) o al precedente (verso destra). Conta come swipe se supera 60px ed è
   almeno 1,5 volte quello verticale; si ignora se parte su un campo di testo o dentro qualcosa che scorre in orizzontale. La pagina nuova si
   chiede SUBITO (senza aspettare l'animazione): intanto il contenuto scorre di lato e si attenua (translateX + .str-cambio; niente
   spostamento con "riduci movimento"), e la scheda di destinazione diventa subito quella attiva, anche con un tocco sulla striscia. Sulla
   prima e sull'ultima voce non si va da nessuna parte: un rimbalzo di 8px. */
(function () {
  'use strict';
  const striscia = document.querySelector('[data-striscia]');
  if (!striscia) return;
  const schede = Array.prototype.slice.call(striscia.querySelectorAll('a[data-voce]'));
  const corrente = schede.findIndex(function (a) { return a.getAttribute('aria-current') === 'page'; });
  if (corrente !== -1 && striscia.classList.contains('striscia-scorre')) {
    schede[corrente].scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  const contenuto = document.querySelector('.app > .contenuto');

  // Passando da un ordine all'altro la pagina nuova arriva dal server (qualche centinaio di millisecondi): intanto la scheda toccata
  // diventa subito quella attiva e il contenuto si attenua, così il tocco ha una risposta visibile senza aspettare.
  function segnaInArrivo(scheda) {
    schede.forEach(function (s) { s.classList.toggle('str-attiva', s === scheda); });
    if (contenuto) contenuto.classList.add('str-cambio');
  }
  striscia.addEventListener('click', function (e) {
    const scheda = e.target instanceof Element ? e.target.closest('a[data-voce]') : null;
    if (!scheda || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (scheda.getAttribute('aria-current') === 'page') return;
    segnaInArrivo(scheda);
  });
  // Tornando con "indietro" la pagina può essere rimostrata com'era (bfcache): la scheda attiva è quella vera, il contenuto a posto.
  window.addEventListener('pageshow', function () {
    schede.forEach(function (s, i) { s.classList.toggle('str-attiva', i === corrente); });
    if (contenuto) { contenuto.classList.remove('str-cambio'); contenuto.style.transform = ''; contenuto.style.opacity = ''; }
  });

  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  if (!contenuto || corrente === -1 || !touch) return;
  const ridotto = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let inizio = null;

  function scorreInOrizzontale(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1) {
        const o = window.getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
    }
    return false;
  }

  function rimbalzo(verso) {
    if (ridotto.matches) return;
    contenuto.classList.add('swipe-rimbalzo');
    contenuto.style.transform = 'translateX(' + verso * 8 + 'px)';
    setTimeout(function () {
      contenuto.style.transform = '';
      setTimeout(function () { contenuto.classList.remove('swipe-rimbalzo'); }, 140);
    }, 110);
  }

  // verso: -1 = il contenuto esce verso sinistra (si va all'ordine dopo), 1 = verso destra (a quello prima)
  function vai(indice, verso) {
    if (indice < 0 || indice >= schede.length) { rimbalzo(verso); return; }
    // La navigazione parte SUBITO: il contenuto scorre di lato mentre il browser aspetta la pagina nuova (prima si aspettavano 150ms
    // di animazione e poi si partiva, e quei 150ms si sommavano all'attesa del server).
    segnaInArrivo(schede[indice]);
    if (!ridotto.matches) contenuto.style.transform = 'translateX(' + verso * 24 + 'px)';
    window.location.href = schede[indice].href;
  }

  contenuto.addEventListener('touchstart', function (e) {
    inizio = null;
    if (e.touches.length !== 1) return;
    const bersaglio = e.target instanceof Element ? e.target : null;
    if (!bersaglio || bersaglio.closest('input, textarea, select, [contenteditable="true"]') || scorreInOrizzontale(bersaglio)) return;
    inizio = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  contenuto.addEventListener('touchend', function (e) {
    if (!inizio) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - inizio.x;
    const dy = t.clientY - inizio.y;
    inizio = null;
    if (Math.abs(dx) <= 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    vai(dx < 0 ? corrente + 1 : corrente - 1, dx < 0 ? -1 : 1);
  }, { passive: true });
  contenuto.addEventListener('touchcancel', function () { inizio = null; }, { passive: true });
})();

/* Service worker: serve a mostrare le notifiche dove `new Notification` non esiste (Chrome per Android) e a
   rendere l'app installabile sulla schermata Home. Non mette in cache pagine né file: restano sempre quelli
   del server. Funziona solo in HTTPS (o su localhost): altrove il browser non lo offre e non succede niente. */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* l'app funziona anche senza */ });
  });
}
