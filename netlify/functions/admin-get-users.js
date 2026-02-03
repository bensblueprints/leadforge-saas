const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// Helper to verify admin
async function verifyAdmin(token) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, is_admin FROM lf_users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return null;
    }

    return result.rows[0];
  } catch (e) {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const admin = await verifyAdmin(event.headers.authorization);
    if (!admin) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Get all users with their subscription info and lead counts
    const result = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.company,
        u.plan,
        u.leads_used,
        u.leads_limit,
        u.trial_ends_at,
        u.is_admin,
        u.created_at,
        s.status as subscription_status,
        s.stripe_subscription_id,
        s.current_period_end,
        (SELECT COUNT(*) FROM lf_leads WHERE user_id = u.id) as total_leads
      FROM lf_users u
      LEFT JOIN lf_subscriptions s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        users: result.rows.map(user => ({
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit,
          totalLeads: parseInt(user.total_leads) || 0,
          trialEndsAt: user.trial_ends_at,
          isAdmin: user.is_admin,
          createdAt: user.created_at,
          subscription: {
            status: user.subscription_status || 'none',
            stripeSubscriptionId: user.stripe_subscription_id,
            currentPeriodEnd: user.current_period_end
          }
        })),
        totalCount: result.rows.length
      })
    };
  } catch (error) {
    console.error('Admin get users error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get users', message: error.message })
    };
  }
};
