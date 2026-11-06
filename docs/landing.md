# Landing pubblica

La pagina che vede chi apre il sito **senza essere collegato** (`GET /`). Spiega il servizio con una simulazione dell'ordine che gira tutta nel browser e porta
all'accesso e alla registrazione. Il nome del servizio è **Flash Delivery**, ovunque: dal 6/11/2026 (richiesta esplicita) ha preso il posto di "Ordini Minuteria" / "Minuteria" in tutte le pagine, nelle email, nelle notifiche, nel manifest e nell'app nativa (vedi «Il nome» più sotto).

## Dove sta

| Cosa | File |
|---|---|
| Pagina (EJS, autonoma: ha il suo `<head>`, non usa `style.css` né `app.js`) | `views/auth/landing.ejs` |
| Stile | `public/landing.css` (le sezioni sono numerate nei commenti: 1-3 il disegno originale, 4 Accedi/Registrati/fondo pagina, 5-6 il telefono) |
| Simulazione (JS vanilla, una riga per funzione) | `public/landing.js` |
| Percorso | `src/routes/autenticazione.js`, `router.get('/')` |
| Cache lunga di css e js | `ASSET_VERSIONATI` in `src/middleware/file_statici.js` |
| Prove | `test/sito/landing.test.js` |

## Chi la vede

- **Non collegato**: `/` mostra la landing (200, `Cache-Control: private, no-cache`, nessuna lettura dal database: la sessione anonima non ne fa).
- **Collegato**: `/` rimanda come prima alla sua pagina (installatore `/home`, banco `/distributore`, agente `/agente/ordini`). La landing non si vede mai da dentro.
- `/login` è la pagina di accesso (con la scheda **Registrati**) e `/registrati` la registrazione: la landing li usa come destinazioni, non li sostituisce.
- **App installata (PWA)**: il manifest ha `start_url: "/login"` (prima `/`), così chi apre l'icona trova l'accesso e non la landing; vedi «PWA» in docs/convenzioni-web-e-audit.md.

## Cosa contiene

- Intestazione: marchio, "Come funziona", "I vantaggi", **"Scopri come ↗"** (scorre alla simulazione, scelta esplicita dell'utente: non toglierlo) e **"Accedi"** (porta a `/login`).
- Titolo e frase di apertura; il pulsante "Scopri come" dentro la prima schermata resta nel codice ma **nascosto dal CSS** (`.actions`), com'era nel testo originale.
- **Simulazione**: scheda di avvio → catalogo (3 articoli, quantità) → conferma del banco → consegna con mappa e furgone → popup "CONSEGNATO" → "Nuovo ordine". Non manda niente al server; la pausa si attiva anche da sola se la scheda del browser va in secondo piano (`visibilitychange`).
- Fascia dei tre passaggi, "Meno spostamenti" (numerata **01**) e "I vantaggi" (numerata **03**: manca il 02, è il testo dell'originale, non un errore di codice).
- In fondo l'invito "Il pezzo che ti manca, in cantiere." (stesse parole di `views/auth/login.ejs`) con **Registra la tua impresa** → `/registrati` e "Hai già un account? Accedi" → `/login`.
- Piè di pagina con **Privacy** (`/privacy`) ed **Elimina il tuo account** (`/elimina-account`).

## Sul telefono

Richiesta esplicita: la simulazione non deve essere un telefono dentro il telefono. Sotto gli **800 px** il pannello è una schermata dell'APP (senza cornice, tacca, barra di stato, orologio, finte app e dock), larga come la pagina (massimo 520 px) e alta quanto serve:

- l'avvio è una scheda con l'icona (si tocca per iniziare); il catalogo sta intero in una schermata (a 375 px il pannello è alto circa 570 px, a 320 px entra in 640);
- ogni passo che cambia il pannello lo riporta in cima allo schermo (`showPanel()` in `landing.js`, solo ≤700 px, istantaneo se l'utente ha chiesto meno movimento);
- nella consegna: stato, **mappa** subito sotto, poi l'elenco dei passaggi (non il contrario);
- fino a **900 px** l'intestazione tiene solo i due pulsanti (con quattro voci il nome del marchio andava a capo); fino a **600 px** i testi sono più piccoli, il pulsante del fondo è a tutta larghezza; a **≤360 px** i pulsanti vanno a capo sotto il marchio;
- nessun scorrimento orizzontale a 320, 375, 768 e 1280 px (controllato in anteprima). Sopra gli 800 px il disegno è quello originale (due colonne, telefono con cornice).

## Come si guarda senza toccare il database

Il server vero con `.env` locale scrive sul **database di produzione**: non va avviato per guardare una pagina. Per l'anteprima basta un piccolo server usa-e-getta che rende `views/auth/landing.ejs` con EJS (passando un finto `asset: (p) => p`) e serve `public/`, senza database né sessione. Le prove del sito (`npm test`) usano invece il DB finto.

## Punti aperti

- **Icona**: il nome è cambiato ma le icone (`public/icons/`, generate da `scripts/genera/genera_icone_pwa.js`) e il distintivo delle notifiche sono ancora la "M" su blu di prima; la landing usa invece il marchio "F" arancione. Le ricevute e le email prendono l'iniziale dal nome (ora una "F"). Da decidere con quale marchio rifare le icone.
- Numerazione delle sezioni (01 → 03) e pulsante nascosto della prima schermata: lasciati come nel testo ricevuto.
- Non provata su un telefono vero (solo emulazione a 320/375/768/1280 px nel browser dell'app).

## Il nome

Il nome mostrato all'utente è **Flash Delivery** (cambiato il 6/11/2026, prima "Ordini Minuteria" e "Minuteria"): titoli e scritte delle pagine, `<title>`, titolo sotto l'icona su iPhone (`apple-mobile-web-app-title`), `name` e `short_name` del manifest, titolo delle notifiche (`web_push.js`, `sw.js`), pagina offline, email e ricevute (`AZIENDA_NOME`, default "Flash Delivery"), descrizione del pagamento su Stripe, nome del dispositivo collegato di WhatsApp, `name` di `mobile/app.json` e testi dell'app nativa. Chi ha `AZIENDA_NOME` nel `.env` (sul server o in locale) deve cambiarlo a mano: vale quello, non il default.

**Non cambiano** (sono nomi interni, cambiarli rompe cose): l'oggetto JS `Minuteria` di `assets/js`, gli eventi `minuteria:...`, le chiavi di `localStorage`/`sessionStorage` `minuteria.*`, i tag delle notifiche `minuteria-<id>`, la cache del service worker `minuteria-offline-v1`, il segreto di sessione derivato da `minuteria-session` (cambiarlo sloggherebbe tutti), il database e il processo pm2 `minuteria`, i nomi dei pacchetti, lo `slug` e lo schema `minuteria://` dell'app, il pacchetto Android/iOS `it.minuteria.ordini` (non si cambia dopo la prima pubblicazione: scelta da confermare, vedi mobile/ANDROID.md) e la parola "minuteria" nel senso di ferramenta (categoria del catalogo). Lo `User-Agent` verso OpenStreetMap ora è `FlashDelivery/1.0 (...)`.
