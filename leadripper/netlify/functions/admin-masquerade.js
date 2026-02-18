const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

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

    const { userId } = JSON.parse(event.body);

    if (!userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'User ID is required' })
      };
    }

    // Get target user info
    const result = await pool.query(
      `SELECT id, email, name, company, plan, leads_used, leads_limit, trial_ends_at, created_at
       FROM lf_users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = result.rows[0];

    // Get user settings
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id
       FROM lf_user_settings WHERE user_id = $1`,
      [user.id]
    );

    const settings = settingsResult.rows[0] || {};

    // Generate JWT token for the target user (with admin flag to indicate masquerade)
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        masqueradeBy: admin.id,
        masqueradeByEmail: admin.email
      },
      JWT_SECRET,
      { expiresIn: '2h' } // Shorter expiry for masquerade sessions
    );

    // Check trial status
    const isTrialActive = user.plan === 'trial' && user.trial_ends_at && new Date(user.trial_ends_at) > new Date();
    const trialExpired = user.plan === 'trial' && user.trial_ends_at && new Date(user.trial_ends_at) <= new Date();

    // Calculate days remaining in trial
    let trialDaysRemaining = 0;
    if (isTrialActive && user.trial_ends_at) {
      const now = new Date();
      const trialEnd = new Date(user.trial_ends_at);
      trialDaysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Now masquerading as ${user.email}`,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit,
          trialEndsAt: user.trial_ends_at,
          isTrialActive,
          trialExpired,
          trialDaysRemaining
        },
        settings: {
          ghlApiKey: settings.ghl_api_key ? '********' + settings.ghl_api_key.slice(-4) : null,
          ghlLocationId: settings.ghl_location_id,
          ghlAutoSync: settings.ghl_auto_sync,
          ghlPipelineId: settings.ghl_pipeline_id
        },
        masquerade: {
          active: true,
          adminId: admin.id,
          adminEmail: admin.email
        }
      })
    };
  } catch (error) {
    console.error('Admin masquerade error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to masquerade', message: error.message })
    };
  }
};
