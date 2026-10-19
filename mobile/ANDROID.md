# App Android: dalla cartella alla build

L'app è React Native con Expo (niente WebView). Questa pagina dice cosa serve, nell'ordine, per avere un'app installabile su Android e poi su Google Play.
Tutto il codice è pronto; mancano le cose che dipendono da te (dominio HTTPS, account, chiavi). Cosa è già stato verificato e cosa no sta in fondo.

## 1. Il server, prima dell'app

1. **HTTPS con un dominio** davanti al sito (reverse proxy con certificato). Un'app installata blocca il traffico `http://`: senza dominio non si compila niente di utile.
   Nel `.env` della VPS: `APP_URL=https://tuodominio.it`.
2. **Schema del database** (una volta, sul DB condiviso): il blocco delle notifiche push.
   ```
   node scripts/applica_blocco_schema.js "-- Notifiche push dell'app Android"            # prova a secco
   node scripts/applica_blocco_schema.js "-- Notifiche push dell'app Android" --applica  # lo applica
   ```
   Senza, tutto funziona lo stesso ma l'app non riceve notifiche (il server lo scrive una volta nel log).
3. **Stripe**: nella VPS `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (vedi README, "Pagamenti con Stripe"). L'app non porta nessuna chiave Stripe: la chiave pubblicabile le arriva dal server
   insieme a ogni pagamento. Con Stripe acceso **dall'app non si ordina più senza pagare** (prima `POST /api/v1/richieste` era sempre simulata). Senza `STRIPE_SECRET_KEY` l'app usa il pagamento di prova (nessun addebito) e lo dice.
4. `git pull`, `npm ci` e riavvio di pm2 (vedi README, "Produzione (VPS)").
5. Facoltativo: `EXPO_ACCESS_TOKEN` (se nel progetto Expo attivi la "sicurezza avanzata" delle push) e `PUSH_ATTIVO=0` per spegnere le push (per esempio sul PC, che parla col DB di produzione).
6. Le pagine che Google Play chiede sono già nel sito: `https://tuodominio.it/privacy` e `https://tuodominio.it/elimina-account`. **Il testo è una bozza** scritta sul comportamento reale del programma
   (`src/testi_legali.js`, il titolare viene da `AZIENDA_*` nel `.env`): va riletto da chi risponde del trattamento dei dati prima di pubblicare.

## 2. Account e chiavi (una volta)

- **Expo / EAS**: `cd mobile && npm install && npx eas-cli login && npx eas-cli init`. `init` crea il progetto e scrive `extra.eas.projectId` in `app.json` (serve alle notifiche push).
- **Indirizzo del server**: in `mobile/eas.json` sostituisci `https://INSERISCI-IL-DOMINIO.invalid` (nei profili `preview` e `production`) con quello vero.
  Finché c'è il segnaposto l'app installata mostra "App non configurata": è voluto, meglio di errori di rete misteriosi.
- **Nome del pacchetto**: `it.minuteria.ordini` (`app.json`, `android.package`). Sceglilo ora: dopo la prima pubblicazione su Google Play non si cambia più.
- **Firebase (notifiche push)**: crea un progetto su console.firebase.google.com, aggiungi un'app Android con lo stesso nome del pacchetto, scarica `google-services.json` in `mobile/`
  e aggiungi in `app.json`, dentro `android`: `"googleServicesFile": "./google-services.json"`. Poi carica su EAS la chiave di servizio FCM v1
  (`npx eas-cli credentials`, Android → Google Service Account Key for Push Notifications): https://docs.expo.dev/push-notifications/fcm-credentials/
- **Google Play Console**: account sviluppatore (25 $ una tantum) e la scheda dell'app.

## 3. Build

```
cd mobile
npx eas-cli build --platform android --profile preview       # APK da installare e provare sul telefono (distribuzione interna)
npx eas-cli build --platform android --profile production    # AAB per Google Play (versionCode automatico)
npx eas-cli submit --platform android --profile production   # invio a Google Play, traccia "test interno"
```

- La **prima** build `production` chiede di creare (o caricare) la chiave di firma: lascia che EAS la gestisca e **non perderla** (`eas credentials`).
- `development` (`--profile development`) è per provare con `npx expo start --dev-client`; serve solo se modifichi codice nativo.
- Per provare l'interfaccia senza build: `npx expo start` e Expo Go. Lì **non** funzionano Google Pay e le notifiche push (limiti di Expo Go), il resto sì; senza chiavi Stripe il pagamento è quello di prova.

## 4. Scheda su Google Play: cosa preparare

- **Informativa sulla privacy**: `https://tuodominio.it/privacy`. **Eliminazione dell'account**: `https://tuodominio.it/elimina-account` (e dall'app: Profilo → Elimina account).
- **Sicurezza dei dati** (modulo): l'app raccoglie dati dell'impresa (nome, email, telefono, indirizzo, partita IVA), cronologia degli ordini, identificativo del dispositivo per le notifiche;
  i pagamenti sono gestiti da Stripe (il numero della carta non passa dai nostri server); dati cifrati in transito (HTTPS); l'utente può chiedere la cancellazione. Nessuna posizione, nessuna pubblicità.
- **Account di prova per chi controlla l'app**: Google lo chiede. Crea un cliente dedicato (non un'impresa vera) e scrivine le credenziali nella scheda; con `STRIPE_SECRET_KEY` di prova (`sk_test_`) non si addebita niente.
- Icona 512×512, immagine di presentazione 1024×500 e gli screenshot: l'icona e la schermata di avvio di ora sono un segnaposto (la "M" su blu, `node scripts/genera_icone_android.js`); quando c'è il logo vero si sostituiscono i file in `mobile/assets`.
- Classificazione dei contenuti e pubblico di destinazione: app per professionisti, nessun contenuto per minori.

## 5. Cosa è stato verificato e cosa no

Verificato (con server e database locali usa-e-getta, e Stripe in modalità prova):
- tutta l'API dell'app, compreso il pagamento con carta: creazione del pagamento, autorizzazione della carta di prova, nascita della richiesta, incasso quando un banco conferma, rilascio del blocco se si annulla
  in fase 1 o se la finestra scade, "Rinvia" con nuovo pagamento; registrazione; eliminazione dell'account; push (registrazione dei token); ricevuta PDF con indirizzo firmato; storico per mese;
- l'app: controllo dei tipi (`npx tsc --noEmit`), pacchetto Android (`npx expo export --platform android`), generazione del progetto nativo (`npx expo prebuild`, manifest e permessi controllati),
  e la versione web di sviluppo collegata al server di prova (accesso, registrazione a tre passi, carrello, attesa, ordine, storico, profilo).

**Non** verificato, perché qui non c'è un telefono né l'SDK Android: il foglio di pagamento di Stripe e Google Pay su un dispositivo vero, la ricezione delle notifiche push (servono i punti 2 e 3), la compilazione Gradle (la fa EAS).
Prima di pubblicare prova su un telefono, con una build `preview` e la chiave Stripe di prova (carta `4242 4242 4242 4242`): paga, annulla la richiesta, fai confermare un ordine al banco, tocca la notifica.
