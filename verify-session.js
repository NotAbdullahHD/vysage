import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /api/verify-session?session_id=cs_... -> { pro, customerId, subscriptionId, cycle }
// Called by the client right after Stripe redirects back to success_url.
// This is a convenience check for immediate UI feedback — the webhook
// handler is the actual source of truth for payment state, per Stripe's
// guidance (users can close the tab before this ever runs).
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });

    const paid = session.payment_status === 'paid' || session.status === 'complete';
    const sub = session.subscription;
    const active = sub && ['active', 'trialing'].includes(sub.status);

    if (paid && active) {
      const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
      return res.status(200).json({
        pro: true,
        customerId: session.customer,
        subscriptionId: sub.id,
        cycle: interval === 'year' ? 'yearly' : 'monthly',
      });
    }

    return res.status(200).json({ pro: false });
  } catch (err) {
    console.error('verify-session error:', err);
    return res.status(500).json({ error: 'Could not verify session' });
  }
}
