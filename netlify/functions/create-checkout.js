const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// Airwallex API Configuration
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY;
const AIRWALLEX_BASE_URL = process.env.AIRWALLEX_ENV === 'production'
  ? 'https://api.airwallex.com'
  : 'https://api-demo.airwallex.com';

// Plans configuration
const PLANS = {
  professional: {
    name: 'Professional',
    price: 9700, // in cents
    currency: 'USD',
    leads_limit: 5000
  },
  enterprise: {
    name: 'Enterprise',
    price: 29700, // in cents
    currency: 'USD',
    leads_limit: -1 // unlimited
  }
};

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function getAirwallexToken() {
  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': AIRWALLEX_CLIENT_ID,
      'x-api-key': AIRWALLEX_API_KEY
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airwallex auth failed: ${error}`);
  }

  const data = await response.json();
  return data.token;
}

async function createPaymentIntent(accessToken, amount, currency, orderId, customerEmail) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: amount / 100, // Airwallex expects amount in dollars, not cents
    currency: currency,
    merchant_order_id: orderId,
    metadata: {
      customer_email: customerEmail
    },
    return_url: `${process.env.URL || 'https://leadforge-saas.netlify.app'}/payment-success`,
    descriptor: 'LeadForge AI Subscription'
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Payment intent creation failed: ${error}`);
  }

  return response.json();
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { planId, email, userId } = JSON.parse(event.body);

    // Validate plan
    const plan = PLANS[planId];
    if (!plan) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
      };
    }

    // Check if user exists and get their info
    let userEmail = email;
    let dbUserId = userId;

    if (userId) {
      const userResult = await pool.query(
        'SELECT id, email FROM lf_users WHERE id = $1',
        [userId]
      );
      if (userResult.rows.length > 0) {
        userEmail = userResult.rows[0].email;
        dbUserId = userResult.rows[0].id;
      }
    }

    // Generate order ID
    const orderId = `LF_${Date.now()}_${planId}`;

    // Get Airwallex access token
    const accessToken = await getAirwallexToken();

    // Create payment intent
    const paymentIntent = await createPaymentIntent(
      accessToken,
      plan.price,
      plan.currency,
      orderId,
      userEmail
    );

    // Store pending subscription in database
    if (dbUserId) {
      await pool.query(
        `INSERT INTO lf_subscriptions (user_id, plan, status, stripe_customer_id)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (user_id) DO UPDATE SET
           plan = $2,
           status = 'pending',
           stripe_customer_id = $3,
           updated_at = NOW()`,
        [dbUserId, planId, paymentIntent.id]
      );
    }

    // Build checkout URL for Airwallex Hosted Payment Page
    const checkoutUrl = `https://checkout.airwallex.com/hosted?` +
      `intent_id=${paymentIntent.id}&` +
      `client_secret=${paymentIntent.client_secret}&` +
      `currency=${plan.currency}&` +
      `env=${process.env.AIRWALLEX_ENV === 'production' ? 'prod' : 'demo'}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        checkoutUrl,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: plan.price,
        currency: plan.currency,
        planName: plan.name
      })
    };
  } catch (error) {
    console.error('Checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create checkout session',
        message: error.message
      })
    };
  }
};
