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

async function createGHLContact(apiKey, locationId, lead, pipelineId = null) {
  const contactData = {
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
  };

  const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify(contactData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GHL API error: ${error}`);
  }

  const contactResult = await response.json();
  const contactId = contactResult.contact?.id || contactResult.id;

  // If we have a pipeline ID, add the contact to the pipeline
  if (pipelineId && contactId) {
    try {
      await addContactToPipeline(apiKey, contactId, pipelineId);
    } catch (pipelineError) {
      console.error('Failed to add contact to pipeline:', pipelineError.message);
      // Continue even if pipeline assignment fails
    }
  }

  return contactResult;
}

async function addContactToPipeline(apiKey, contactId, pipelineId) {
  // Create an opportunity in the pipeline for this contact
  const response = await fetch('https://services.leadconnectorhq.com/opportunities/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify({
      pipelineId: pipelineId,
      contactId: contactId,
      name: 'LeadForge Lead',
      status: 'open'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to add to pipeline: ${error}`);
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
      'SELECT ghl_api_key, ghl_location_id, ghl_pipeline_id, ghl_industry_pipelines FROM lf_user_settings WHERE user_id = $1',
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

    // Parse industry pipelines
    let industryPipelines = {};
    try {
      if (settings.ghl_industry_pipelines) {
        industryPipelines = JSON.parse(settings.ghl_industry_pipelines);
      }
    } catch (e) {
      console.error('Failed to parse industry pipelines:', e);
    }

    // Get leads to sync
    let leadsQuery = `
      SELECT id, business_name, phone, email, address, city, state, industry, website
      FROM lf_leads WHERE user_id = $1 AND ghl_synced = false
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
        // Determine the pipeline ID: industry-specific or default
        let pipelineId = settings.ghl_pipeline_id || null;

        if (lead.industry && industryPipelines[lead.industry]) {
          pipelineId = industryPipelines[lead.industry];
        }

        const ghlContact = await createGHLContact(
          settings.ghl_api_key,
          settings.ghl_location_id,
          lead,
          pipelineId
        );

        // Update lead as synced
        await pool.query(
          'UPDATE lf_leads SET ghl_synced = true, ghl_contact_id = $1 WHERE id = $2',
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
