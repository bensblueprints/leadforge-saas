const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

// Plan configurations
const PLANS = {
  free: { leadsLimit: 50 },
  trial: { leadsLimit: 500 },
  basic: { leadsLimit: 500 },
  advanced: { leadsLimit: 2500 },
  premium: { leadsLimit: 10000 },
  enterprise: { leadsLimit: 999999 }
};

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

  if (event.httpMethod !== 'POST') {
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

    const { userId, action, plan } = JSON.parse(event.body);

    if (!userId || !action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID and action are required' })
      };
    }

    // Check if user exists
    const userResult = await pool.query('SELECT id, email, plan FROM lf_users WHERE id = $1', [userId]);

    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const targetUser = userResult.rows[0];
    let message = '';

    switch (action) {
      case 'cancel':
        // Cancel subscription - revert to free plan
        await pool.query(
          `UPDATE lf_users SET plan = 'free', leads_limit = $1, trial_ends_at = NULL WHERE id = $2`,
          [PLANS.free.leadsLimit, userId]
        );
        await pool.query(
          `UPDATE lf_subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );
        message = `Subscription cancelled for ${targetUser.email}. Reverted to free plan.`;
        break;

      case 'upgrade':
        if (!plan || !PLANS[plan]) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Valid plan is required for upgrade' })
          };
        }

        // Upgrade/change plan
        await pool.query(
          `UPDATE lf_users SET plan = $1, leads_limit = $2 WHERE id = $3`,
          [plan, PLANS[plan].leadsLimit, userId]
        );

        // Update or create subscription record
        await pool.query(`
          INSERT INTO lf_subscriptions (user_id, plan, status, updated_at)
          VALUES ($1, $2, 'active', NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET plan = $2, status = 'active', updated_at = NOW()
        `, [userId, plan]);

        message = `${targetUser.email} upgraded to ${plan} plan.`;
        break;

      case 'reset_leads':
        // Reset leads used count
        await pool.query('UPDATE lf_users SET leads_used = 0 WHERE id = $1', [userId]);
        message = `Lead usage reset for ${targetUser.email}.`;
        break;

      case 'extend_trial':
        // Extend trial by 7 days from now
        const newTrialEnd = new Date();
        newTrialEnd.setDate(newTrialEnd.getDate() + 7);
        await pool.query(
          `UPDATE lf_users SET plan = 'trial', trial_ends_at = $1, leads_limit = $2 WHERE id = $3`,
          [newTrialEnd, PLANS.trial.leadsLimit, userId]
        );
        message = `Trial extended by 7 days for ${targetUser.email}.`;
        break;

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action. Use: cancel, upgrade, reset_leads, or extend_trial' })
        };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message
      })
    };
  } catch (error) {
    console.error('Admin update subscription error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update subscription', message: error.message })
    };
  }
};
