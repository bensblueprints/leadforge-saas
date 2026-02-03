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

  if (event.httpMethod !== 'POST') {
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
    const { ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, name, company } = JSON.parse(event.body);

    // Update user profile if provided
    if (name !== undefined || company !== undefined) {
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name);
        paramIndex++;
      }
      if (company !== undefined) {
        updates.push(`company = $${paramIndex}`);
        values.push(company);
        paramIndex++;
      }

      values.push(decoded.userId);
      await pool.query(
        `UPDATE lf_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        values
      );
    }

    // Update GHL settings if provided
    if (ghlApiKey !== undefined || ghlLocationId !== undefined || ghlAutoSync !== undefined || ghlPipelineId !== undefined) {
      const ghlUpdates = [];
      const ghlValues = [];
      let ghlParamIndex = 1;

      if (ghlApiKey !== undefined) {
        ghlUpdates.push(`ghl_api_key = $${ghlParamIndex}`);
        ghlValues.push(ghlApiKey);
        ghlParamIndex++;
      }
      if (ghlLocationId !== undefined) {
        ghlUpdates.push(`ghl_location_id = $${ghlParamIndex}`);
        ghlValues.push(ghlLocationId);
        ghlParamIndex++;
      }
      if (ghlAutoSync !== undefined) {
        ghlUpdates.push(`ghl_auto_sync = $${ghlParamIndex}`);
        ghlValues.push(ghlAutoSync);
        ghlParamIndex++;
      }
      if (ghlPipelineId !== undefined) {
        ghlUpdates.push(`ghl_pipeline_id = $${ghlParamIndex}`);
        ghlValues.push(ghlPipelineId);
        ghlParamIndex++;
      }

      ghlValues.push(decoded.userId);
      await pool.query(
        `UPDATE lf_user_settings SET ${ghlUpdates.join(', ')}, updated_at = NOW() WHERE user_id = $${ghlParamIndex}`,
        ghlValues
      );
    }

    // Fetch updated data
    const userResult = await pool.query(
      'SELECT id, email, name, company, plan, leads_used, leads_limit FROM lf_users WHERE id = $1',
      [decoded.userId]
    );
    const settingsResult = await pool.query(
      'SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id FROM lf_user_settings WHERE user_id = $1',
      [decoded.userId]
    );

    const user = userResult.rows[0];
    const settings = settingsResult.rows[0] || {};

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Settings updated successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
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
    console.error('Update settings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update settings', message: error.message })
    };
  }
};
