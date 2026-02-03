const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const AIRWALLEX_WEBHOOK_SECRET = process.env.AIRWALLEX_WEBHOOK_SECRET;

// Plans configuration - Updated pricing 2026
const PLANS = {
  basic: {
    leads_limit: 500
  },
  advanced: {
    leads_limit: 2500
  },
  premium: {
    leads_limit: 10000
  },
  enterprise: {
    leads_limit: -1 // unlimited
  }
};

function verifyWebhookSignature(payload, signature, timestamp) {
  if (!AIRWALLEX_WEBHOOK_SECRET) {
    console.warn('Webhook secret not configured, skipping verification');
    return true;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', AIRWALLEX_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  return signature === expectedSignature;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const signature = event.headers['x-signature'];
    const timestamp = event.headers['x-timestamp'];

    // Verify signature if configured
    if (AIRWALLEX_WEBHOOK_SECRET && !verifyWebhookSignature(event.body, signature, timestamp)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    const webhookEvent = JSON.parse(event.body);
    console.log('Webhook event received:', webhookEvent.name);

    // Handle different event types
    switch (webhookEvent.name) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(webhookEvent.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(webhookEvent.data.object);
        break;

      case 'payment_intent.cancelled':
        await handlePaymentCancelled(webhookEvent.data.object);
        break;

      default:
        console.log('Unhandled event type:', webhookEvent.name);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true })
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook processing failed' })
    };
  }
};

async function handlePaymentSuccess(paymentIntent) {
  console.log('Payment succeeded:', paymentIntent.id);

  // Find subscription by payment intent ID (stored in stripe_customer_id field)
  const subResult = await pool.query(
    'SELECT user_id, plan FROM lf_subscriptions WHERE stripe_customer_id = $1',
    [paymentIntent.id]
  );

  if (subResult.rows.length === 0) {
    console.log('No pending subscription found for payment intent:', paymentIntent.id);
    return;
  }

  const { user_id, plan } = subResult.rows[0];
  const planConfig = PLANS[plan] || PLANS.professional;

  // Calculate period end (30 days from now)
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  // Update subscription to active
  await pool.query(
    `UPDATE lf_subscriptions
     SET status = 'active',
         current_period_end = $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [periodEnd, user_id]
  );

  // Update user's plan and leads limit
  await pool.query(
    `UPDATE lf_users
     SET plan = $1,
         leads_limit = $2,
         leads_used = 0,
         updated_at = NOW()
     WHERE id = $3`,
    [plan, planConfig.leads_limit, user_id]
  );

  console.log(`User ${user_id} upgraded to ${plan} plan`);
}

async function handlePaymentFailed(paymentIntent) {
  console.log('Payment failed:', paymentIntent.id);

  // Update subscription status
  await pool.query(
    `UPDATE lf_subscriptions
     SET status = 'payment_failed',
         updated_at = NOW()
     WHERE stripe_customer_id = $1`,
    [paymentIntent.id]
  );
}

async function handlePaymentCancelled(paymentIntent) {
  console.log('Payment cancelled:', paymentIntent.id);

  // Remove pending subscription
  await pool.query(
    `DELETE FROM lf_subscriptions WHERE stripe_customer_id = $1 AND status = 'pending'`,
    [paymentIntent.id]
  );
}
