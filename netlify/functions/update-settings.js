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
    const { ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, ghlIndustryPipelines, resendApiKey, webhookUrl, name, company } = JSON.parse(event.body);

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

    // Update settings if provided
    if (ghlApiKey !== undefined || ghlLocationId !== undefined || ghlAutoSync !== undefined || ghlPipelineId !== undefined || ghlIndustryPipelines !== undefined || resendApiKey !== undefined || webhookUrl !== undefined) {
      // First ensure settings row exists
      await pool.query(
        `INSERT INTO lf_user_settings (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [decoded.userId]
      );

      const settingsUpdates = [];
      const settingsValues = [];
      let paramIndex = 1;

      if (ghlApiKey !== undefined) {
        settingsUpdates.push(`ghl_api_key = $${paramIndex}`);
        settingsValues.push(ghlApiKey);
        paramIndex++;
      }
      if (ghlLocationId !== undefined) {
        settingsUpdates.push(`ghl_location_id = $${paramIndex}`);
        settingsValues.push(ghlLocationId);
        paramIndex++;
      }
      if (ghlAutoSync !== undefined) {
        settingsUpdates.push(`ghl_auto_sync = $${paramIndex}`);
        settingsValues.push(ghlAutoSync);
        paramIndex++;
      }
      if (ghlPipelineId !== undefined) {
        settingsUpdates.push(`ghl_pipeline_id = $${paramIndex}`);
        settingsValues.push(ghlPipelineId);
        paramIndex++;
      }
      if (resendApiKey !== undefined) {
        settingsUpdates.push(`resend_api_key = $${paramIndex}`);
        settingsValues.push(resendApiKey);
        paramIndex++;
      }
      if (webhookUrl !== undefined) {
        settingsUpdates.push(`webhook_url = $${paramIndex}`);
        settingsValues.push(webhookUrl);
        paramIndex++;
      }
      if (ghlIndustryPipelines !== undefined) {
        settingsUpdates.push(`ghl_industry_pipelines = $${paramIndex}`);
        settingsValues.push(JSON.stringify(ghlIndustryPipelines));
        paramIndex++;
      }

      if (settingsUpdates.length > 0) {
        settingsValues.push(decoded.userId);
        await pool.query(
          `UPDATE lf_user_settings SET ${settingsUpdates.join(', ')}, updated_at = NOW() WHERE user_id = $${paramIndex}`,
          settingsValues
        );
      }
    }

    // Fetch updated data
    const userResult = await pool.query(
      'SELECT id, email, name, company, plan, leads_used, leads_limit FROM lf_users WHERE id = $1',
      [decoded.userId]
    );
    const settingsResult = await pool.query(
      'SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, ghl_industry_pipelines, resend_api_key, webhook_url FROM lf_user_settings WHERE user_id = $1',
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
          ghlApiKey: settings.ghl_api_key ? '••••••••' : null,
          ghlLocationId: settings.ghl_location_id,
          ghlAutoSync: settings.ghl_auto_sync,
          ghlPipelineId: settings.ghl_pipeline_id,
          ghlIndustryPipelines: settings.ghl_industry_pipelines ? JSON.parse(settings.ghl_industry_pipelines) : {},
          resendApiKey: settings.resend_api_key ? '••••••••' : null,
          webhookUrl: settings.webhook_url,
          hasGhlKey: !!settings.ghl_api_key,
          hasResendKey: !!settings.resend_api_key
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
