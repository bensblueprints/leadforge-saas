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

async function createGHLContact(apiKey, locationId, lead) {
  const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify({
      firstName: lead.business_name.split(' ')[0] || 'Business',
      lastName: lead.business_name.split(' ').slice(1).join(' ') || 'Owner',
      name: lead.business_name,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      address1: lead.address || undefined,
      city: lead.city || undefined,
      state: lead.state || undefined,
      companyName: lead.business_name,
      website: lead.website || undefined,
      source: 'LeadForge AI',
      locationId: locationId,
      tags: ['leadforge', lead.industry || 'general'].filter(Boolean)
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GHL API error: ${error}`);
  }

  return await response.json();
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
    const { leadIds } = JSON.parse(event.body);

    // Get user's GHL settings
    const settingsResult = await pool.query(
      'SELECT ghl_api_key, ghl_location_id FROM user_settings WHERE user_id = $1',
      [decoded.userId]
    );

    const settings = settingsResult.rows[0];

    if (!settings || !settings.ghl_api_key || !settings.ghl_location_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'GHL API not configured. Please add your API key and Location ID in settings.' })
      };
    }

    // Get leads to sync
    let leadsQuery = `
      SELECT id, business_name, phone, email, address, city, state, industry, website
      FROM leads WHERE user_id = $1 AND ghl_synced = false
    `;
    const values = [decoded.userId];

    if (leadIds && leadIds.length > 0) {
      leadsQuery += ` AND id = ANY($2)`;
      values.push(leadIds);
    }

    leadsQuery += ' LIMIT 50';

    const leadsResult = await pool.query(leadsQuery, values);
    const leads = leadsResult.rows;

    if (leads.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No leads to sync',
          syncedCount: 0
        })
      };
    }

    let syncedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const lead of leads) {
      try {
        const ghlContact = await createGHLContact(
          settings.ghl_api_key,
          settings.ghl_location_id,
          lead
        );

        // Update lead as synced
        await pool.query(
          'UPDATE leads SET ghl_synced = true, ghl_contact_id = $1 WHERE id = $2',
          [ghlContact.contact?.id || ghlContact.id, lead.id]
        );

        syncedCount++;
      } catch (error) {
        errorCount++;
        errors.push({ leadId: lead.id, error: error.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Synced ${syncedCount} leads to GoHighLevel`,
        syncedCount,
        errorCount,
        errors: errors.slice(0, 5) // Only return first 5 errors
      })
    };
  } catch (error) {
    console.error('GHL sync error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to sync leads', message: error.message })
    };
  }
};
