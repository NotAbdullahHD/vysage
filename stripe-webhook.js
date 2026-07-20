import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe requires the RAW request body to verify a webhook's signature,
// so the platform's automatic JSON body-parsing has to be turned off here.
export const config = {
  api: { bodyParser: false },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// POST from Stripe -> { received: true }
// Configure this URL (https://<your-domain>/api/stripe-webhook) in the
// Stripe Dashboard under Developers > Webhooks.
//
// IMPORTANT — this is the real source of truth for payment state per
// Stripe's own guidance: a user can close the tab before the client-side
// verify-session call ever runs, but the webhook still fires reliably.
// This app has no server-side database yet, so there's nothing to persist
// events to right now — the client instead re-derives status itself via
// /api/check-subscription using the stored Stripe customer ID. If you add
// real user accounts + a database later, this is where you'd write
// event.data.object's subscription status against that user's record.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      // TODO once you have a database: upsert subscription status keyed by
      // event.data.object.customer here.
      console.log(`Stripe webhook received: ${event.type}`, event.data.object.id);
      break;
    default:
      break;
  }

  return res.status(200).json({ received: true });
}
