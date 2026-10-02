// Per ora tutti gli installatori stanno nello stesso posto: Via Puggia 22/3, Genova. Non si usa la
// posizione del dispositivo (né sul sito né nell'app): la posizione di ogni cliente è questa, e
// serve alla distanza dai banchi, alla stima del tragitto e al messaggio ai corrieri.
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
