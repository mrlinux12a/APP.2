// Il messaggio che Stripe manda al nostro server quando un pagamento cambia stato.
const express = require('express');
const stripePagamenti = require('../stripe_pagamenti');

const router = express.Router();

// Riceve gli avvisi di Stripe (carta autorizzata, pagamento scaduto...) e li passa a chi gestisce i pagamenti. Risponde 2xx quando ha ricevuto, 400 se la
// firma non è giusta (la chiamata non viene da Stripe) e 500 se il guasto è nostro (così Stripe riprova da solo per giorni).
// Va montata PRIMA dei parser del corpo: la firma si verifica sul testo grezzo, e un JSON già interpretato non la farebbe più tornare. Niente sessione né
// controllo d'origine: la chiamata viene da Stripe, non da un browser, e vale solo se la firma (il segreto del webhook, vedi src/stripe_config.js) è giusta.
router.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!stripePagamenti.attivo() || !stripePagamenti.webhookConfigurato()) return res.status(503).send('Stripe non configurato');
  let evento;
  try {
    evento = stripePagamenti.leggiEvento(req.body, req.get('stripe-signature'));
  } catch (e) {
    return res.status(400).send('Firma non valida');
  }
  try {
    await stripePagamenti.gestisciEvento(evento);
    res.json({ ricevuto: true });
  } catch (e) {
    console.error('[stripe] webhook', evento.type, e.message);
    res.status(500).send('Errore');
  }
});

module.exports = router;
