const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

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

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const result = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id
       FROM lf_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({})
      };
    }

    const settings = result.rows[0];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ghl_api_key: settings.ghl_api_key ? '••••••••' : null,
        ghl_location_id: settings.ghl_location_id,
        ghl_auto_sync: settings.ghl_auto_sync,
        ghl_pipeline_id: settings.ghl_pipeline_id,
        hasGhlKey: !!settings.ghl_api_key
      })
    };
  } catch (error) {
    console.error('Get settings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get settings', message: error.message })
    };
  }
};
