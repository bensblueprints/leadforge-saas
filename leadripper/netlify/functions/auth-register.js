const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

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
    const { email, password, name, company } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and password are required' })
      };
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM lf_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'User with this email already exists' })
      };
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Calculate trial end date (7 days from now)
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);

    // Create user with 7-day free trial (500 leads limit)
    const result = await pool.query(
      `INSERT INTO lf_users (email, password_hash, name, company, plan, leads_limit, trial_ends_at)
       VALUES ($1, $2, $3, $4, 'trial', 500, $5)
       RETURNING id, email, name, company, plan, leads_used, leads_limit, trial_ends_at, created_at`,
      [email.toLowerCase(), passwordHash, name || '', company || '', trialEnd]
    );

    const user = result.rows[0];

    // Create default user settings
    await pool.query(
      `INSERT INTO lf_user_settings (user_id) VALUES ($1)`,
      [user.id]
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Account created successfully! You have a 7-day free trial with 500 leads.',
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
          isTrialActive: true
        }
      })
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Registration failed', message: error.message })
    };
  }
};
