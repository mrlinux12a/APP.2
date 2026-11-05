# App iPhone: cosa serve e cosa è già pronto

Il codice dell'app è lo stesso di Android (React Native con Expo): schermate, carrello, orari, cambio password, pagamento con carta e notifiche funzionano anche su iPhone.
Questa pagina dice cosa è già stato adattato e, soprattutto, cosa dipende da te. Per i passi comuni (server, dominio HTTPS, Stripe) vale `ANDROID.md`, sezione 1.

## 1. Come provarla su un iPhone (leggi prima questo)

- **L'Expo Go dell'App Store non apre questo progetto.** Si ferma all'SDK 54 e il progetto è sull'SDK 58 (dal 05/11/2026; https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/). Le strade sono due, e **tutte e due vogliono l'account Apple Developer a pagamento**:
  - una **build vera con EAS** (consigliata: l'app usa Stripe e le notifiche, che sono parti native, e così provi l'app com'è davvero);
  - un Expo Go più nuovo, che Expo distribuisce solo su TestFlight con `npx eas-cli@latest go` (https://docs.expo.dev/get-started/expo-go/): non l'ho provato, e vale la pena solo per guardare l'interfaccia, non le notifiche.
- **Account Apple Developer** (Apple Developer Program, 99 $ l'anno): senza non si firma l'app né si creano le chiavi delle notifiche.
- **Su Windows non c'è il simulatore iOS** (serve un Mac): si prova solo su un iPhone vero.

## 2. Cosa è già pronto nel codice

- `app.json`: `bundleIdentifier` `it.minuteria.ordini`, solo iPhone (`supportsTablet: false`, su iPad gira ingrandita), tema chiaro, schema `minuteria://` (serve al ritorno dal pagamento).
  `ITSAppUsesNonExemptEncryption: false`: l'app usa solo il HTTPS normale del telefono, quindi a ogni caricamento Apple non rifà la domanda sulla crittografia. **È una dichiarazione tua verso Apple: se l'app dovesse
  usare crittografia propria, va tolta.**
- Notifiche (`src/notifiche.ts`): su iPhone si registrano come su Android (il server riceve `piattaforma: 'ios'`), il permesso si chiede una volta sola, e se è negato nel profilo compare il riquadro "Apri le impostazioni".
  Il resto del comportamento è identico (nessun banner con l'app aperta, tocco → ordine o richiesta).
- Pagamento (`src/foglioStripe.ts`): il foglio di Stripe paga con la carta. Google Pay si accende solo su Android.
- Tastiera, barra del titolo e area sicura erano già scritte per tutte e due le piattaforme (`KeyboardAvoidingView`, `BarraTitolo.tsx`). Icona 1024×1024 senza trasparenza.
- Il server non cambia: `POST /api/v1/dispositivi` accetta già `ios`, e Expo Push Service consegna ad Apple (APNs) da solo.

## 3. Cosa devi fare tu (una volta)

1. **Account Apple Developer** attivo. Il nome del pacchetto `it.minuteria.ordini` è una scelta da confermare prima del primo invio: poi non si cambia.
2. `cd mobile && npx eas-cli login`, poi `npx eas-cli init` se non l'hai già fatto per Android (scrive `extra.eas.projectId`, serve anche alle notifiche).
3. **Registra il tuo iPhone** per le build di prova: `npx eas-cli device:create` (apre un link da aprire dall'iPhone, installa un profilo).
4. **Indirizzo del server**: in `eas.json` il dominio HTTPS vero al posto di `https://INSERISCI-IL-DOMINIO.invalid` (stesso file di Android, vale per tutte e due).
5. **Prima build**: `npx eas-cli build --platform ios --profile preview`. EAS ti chiede l'accesso ad Apple e, alla domanda sulle notifiche, rispondi **sì** (crea da solo la chiave APNs). Quando finisce, installa l'app dal link sull'iPhone.
6. **Pubblicazione**: crea la scheda dell'app in App Store Connect, poi `npx eas-cli build --platform ios --profile production` e `npx eas-cli submit --platform ios --profile production` (arriva su TestFlight).

## 4. Scheda App Store: cosa preparare

- Informativa sulla privacy `https://tuodominio.it/privacy` ed eliminazione dell'account (c'è già nell'app: Profilo → Elimina account; Apple la richiede per le app con registrazione).
- **Account di prova per chi controlla l'app**: Apple lo chiede come Google (cliente dedicato, non un'impresa vera).
- "App Privacy" (le etichette sui dati): gli stessi dati dichiarati per Google Play (dati dell'impresa, ordini, identificativo del dispositivo per le notifiche, nessuna posizione né pubblicità).
- Screenshot da iPhone, icona e testi: l'icona di ora è il segnaposto (la "M" su blu).

## 5. Apple Pay (facoltativo, oggi spento)

Per accenderlo: un Merchant ID creato su developer.apple.com, il suo nome come `merchantIdentifier` nel plugin `@stripe/stripe-react-native` di `app.json`, il certificato Apple Pay caricato nel pannello di Stripe, e
`applePay: { merchantCountryCode: 'IT' }` in `initPaymentSheet` (`src/foglioStripe.ts`). Senza, su iPhone si paga con la carta.

## 6. Cosa è stato verificato e cosa no

Verificato: controllo dei tipi (`tsc`), pacchetto iOS (`npx expo export --platform ios`, bundle Hermes generato), `expo lint` (ora **0 problemi**: i 6 di prima sono stati sistemati nell'allineamento al sito del 05/11/2026, vedi `docs/app-nativa.md`). Dopo quell'allineamento è stato riprovato anche `npx expo export --platform ios` (riuscito).
**Non** verificato (niente iPhone, niente Mac, niente account Apple): la build e la firma, l'installazione, il permesso delle notifiche e la loro consegna, il foglio di pagamento, l'aspetto delle schermate (barra del titolo, tacca, tastiera).
Il progetto nativo iOS non è stato generato (`expo prebuild` per iOS richiede macOS per installare i pacchetti nativi). Prima di pubblicare prova la build `preview` su un iPhone, con la chiave Stripe di prova (carta `4242 4242 4242 4242`).
