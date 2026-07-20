import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST { customer_id } -> { url }
// Client redirects to `url` — Stripe's hosted portal where the customer
// can update their card, switch plans, or cancel. Real cancellation
// should always go through here (or the webhook-driven flow), not a
// button that just edits localStorage.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customer_id } = req.body || {};
    if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer_id,
      return_url: `${origin}/`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    return res.status(500).json({ error: 'Could not create billing portal session' });
  }
}
