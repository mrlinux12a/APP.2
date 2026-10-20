// Per ora tutti gli installatori partono dallo stesso posto: Via Puggia 22/3, Genova. È la posizione di ogni cliente FINCHÉ non ne arriva una vera: sul sito
// è quella dell'indirizzo di consegna mandato col pagamento (precompilato dalla posizione del dispositivo, o scritto a mano: vedi "Carrello: indirizzo di
// consegna" in public/app.js e POST /richieste; l'app nativa non la manda ancora). Serve alla distanza dai banchi, al tragitto che si somma ai minuti del
// corriere e al messaggio ai corrieri; un account senza nessuna posizione (consegna.minutiStimati) usa questa.
//
// Si applica a chi è già iscritto con scripts/imposta_installatori_puggia.js e a chi si iscrive da
// ora (anagrafiche.iscriviCliente). La sede legale (indirizzo, CAP, città) resta quella dichiarata:
// cambiano solo l'indirizzo di consegna e la posizione. Coordinate da OpenStreetMap (civico 22).
// Quando torneranno gli indirizzi veri basta togliere i due punti d'uso.
module.exports = {
  indirizzoConsegna: 'Via Puggia 22/3, 16131 Genova (GE)',
  lat: 44.4019645,
  lng: 8.9742339,
};
