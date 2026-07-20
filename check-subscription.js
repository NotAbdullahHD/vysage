import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /api/check-subscription?customer_id=cus_... -> { pro, subscriptionId, cycle }
// Called on app load for anyone with a stored Stripe customer ID, so a
// cancellation or payment failure made from Stripe's Billing Portal (or
// anywhere else) is reflected back in the app without needing a database.
//
// Caveat: since this app has no user accounts, the "session" is really
// just a Stripe customer ID sitting in localStorage. That's fine for a
// single-device demo/MVP, but it means anyone who obtained a real
// customer ID (e.g. by inspecting their own network traffic) could query
// this endpoint for it — it doesn't leak payment details, but it's not a
// substitute for real auth if you add user accounts later.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { customer_id } = req.query;
  if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

  try {
    const subs = await stripe.subscriptions.list({ customer: customer_id, status: 'all', limit: 5 });
    const active = subs.data.find((s) => ['active', 'trialing'].includes(s.status));

    if (active) {
      const interval = active.items?.data?.[0]?.price?.recurring?.interval;
      return res.status(200).json({
        pro: true,
        subscriptionId: active.id,
        cycle: interval === 'year' ? 'yearly' : 'monthly',
      });
    }

    return res.status(200).json({ pro: false });
  } catch (err) {
    console.error('check-subscription error:', err);
    return res.status(500).json({ error: 'Could not check subscription' });
  }
}
