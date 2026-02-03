const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

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
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Find user
    const result = await pool.query(
      `SELECT id, email, password_hash, name, company, plan, leads_used, leads_limit, trial_ends_at, created_at
       FROM lf_users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid email or password' })
      };
    }

    // Get user settings
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id
       FROM lf_user_settings WHERE user_id = $1`,
      [user.id]
    );

    const settings = settingsResult.rows[0] || {};

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
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
        message: trialExpired ? 'Your free trial has expired. Please upgrade to continue.' : 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: trialExpired ? 0 : user.leads_limit,
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
        }
      })
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Login failed', message: error.message })
    };
  }
};
