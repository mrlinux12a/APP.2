/* iPhone / web app installata: la barra in basso (e le barre "Vai al carrello" / "Paga" sopra di lei) sono position: fixed. Dopo la tastiera, o con la barra di
   Safari che si muove, iOS può lasciare il "viewport del layout" (quello a cui i fixed si agganciano) diverso da quello che si vede: la barra resta a metà
   schermo. Qui si misura lo scarto fra i due (visualViewport contro la misura del layout) e si scrive in --vv-sposta, che il CSS applica come translateY a
   .navbar, .barra-vai e .barra-paga: la barra torna sul bordo basso VISIBILE. Con uno scarto di meno di 2px (il caso normale) non si tocca niente. Con la
   pagina ingrandita a mano (pinch) non si corregge. Solo iOS: altrove i fixed si comportano. */
(function () {
  const ua = navigator.userAgent || '';
  const suIos = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const vv = window.visualViewport;
  if (!suIos || !vv) return;
  const radice = document.documentElement;
  let atteso = false;
  const aggiorna = function () {
    atteso = false;
    let sposta = 0;
    if (Math.abs(vv.scale - 1) < 0.01) {
      const scarto = vv.offsetTop + vv.height - radice.clientHeight;
      if (Math.abs(scarto) >= 2) sposta = Math.round(scarto);
    }
    radice.style.setProperty('--vv-sposta', sposta + 'px');
  };
  const pianifica = function () {
    if (atteso) return;
    atteso = true;
    requestAnimationFrame(aggiorna);
  };
  vv.addEventListener('resize', pianifica);
  vv.addEventListener('scroll', pianifica);
  window.addEventListener('scroll', pianifica, { passive: true });
  window.addEventListener('orientationchange', function () { setTimeout(pianifica, 300); });
  window.addEventListener('pageshow', pianifica);
  document.addEventListener('focusout', function () { setTimeout(pianifica, 150); setTimeout(pianifica, 600); });
  pianifica();
})();

/* "Catalogo" nella barra in basso torna alla pagina di catalogo in cui si era (categoria, marchio, "con foto", ricerca), non sempre alla home: andando nel
   carrello e tornando si resta dove si stava (richiesta esplicita del 21/10/2026). Si ricorda l'ultima pagina di catalogo vista in sessionStorage (per utente);
   aprendo la home (l'elenco delle categorie) la memoria si azzera, così dalla categoria si può sempre uscire toccando "Catalogo". Sulle pagine di catalogo il
   pulsante resta com'è (va alla home). Senza JavaScript, o senza memoria, vale il link di sempre (/home). */
(function () {
  const utente = (document.querySelector('meta[name="utente"]') || {}).content || '';
  const chiave = 'minuteria.catalogo.' + utente;
  const percorso = window.location.pathname;
  const inCatalogo = /^\/(categoria|marchi|con-foto|cerca)(\/|$)/.test(percorso);
  let ultima = '';
  try {
    if (inCatalogo) sessionStorage.setItem(chiave, percorso + window.location.search);
    else if (percorso === '/home') sessionStorage.removeItem(chiave);
    else ultima = sessionStorage.getItem(chiave) || '';
  } catch (e) { /* senza archivio la pagina funziona lo stesso: si va alla home */ }
  // Solo un percorso di questo sito (mai un indirizzo esterno scritto nell'archivio).
  if (!ultima || ultima.charAt(0) !== '/' || ultima.charAt(1) === '/' || ultima.charAt(1) === '\\') return;
  document.querySelectorAll('.navbar a[href="/home"], a[data-torna-catalogo]').forEach(function (a) {
    a.setAttribute('href', ultima);
  });
})();
