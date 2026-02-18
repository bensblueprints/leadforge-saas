const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

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

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    // Get user's GHL settings
    const settingsResult = await pool.query(
      'SELECT ghl_api_key, ghl_location_id FROM lf_user_settings WHERE user_id = $1',
      [decoded.userId]
    );

    const settings = settingsResult.rows[0];

    if (!settings || !settings.ghl_api_key || !settings.ghl_location_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'GHL API not configured. Please add your API key and Location ID first.' })
      };
    }

    // Fetch pipelines from GHL
    const response = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${settings.ghl_location_id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${settings.ghl_api_key}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GHL API error: ${error}`);
    }

    const data = await response.json();
    const pipelines = data.pipelines || [];

    // Format pipelines with their stages
    const formattedPipelines = pipelines.map(pipeline => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: (pipeline.stages || []).map(stage => ({
        id: stage.id,
        name: stage.name
      }))
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        pipelines: formattedPipelines
      })
    };
  } catch (error) {
    console.error('GHL pipelines error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch pipelines', message: error.message })
    };
  }
};
