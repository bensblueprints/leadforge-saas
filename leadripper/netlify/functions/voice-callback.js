const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const VOICE_SECRET = process.env.VOICE_AGENT_SECRET || 'leadripper-voice-2026';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Voice-Secret',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify secret
  const secret = event.headers['x-voice-secret'];
  if (secret !== VOICE_SECRET) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Ensure contact_name column exists (safe migration)
    await pool.query(`ALTER TABLE lf_leads ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`).catch(() => {});

    const { phone, owner_email, owner_name, business_name, after_hours_info, notes } = JSON.parse(event.body);

    if (!phone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing phone number' }) };
    }

    // Normalize phone: strip everything except digits, match last 10
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);

    // Find the lead by phone number (fuzzy match on last 10 digits)
    const findResult = await pool.query(
      `SELECT id, user_id, business_name, email, phone
       FROM lf_leads
       WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [`%${last10}`]
    );

    if (findResult.rows.length === 0) {
      // No existing lead — create a new one under user 1 (admin)
      const insertResult = await pool.query(
        `INSERT INTO lf_leads (user_id, business_name, email, phone, contact_name, industry, created_at, updated_at)
         VALUES (1, $1, $2, $3, $4, 'unknown', NOW(), NOW())
         RETURNING id`,
        [business_name || 'Unknown Business', owner_email || null, phone, owner_name || null]
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          action: 'created',
          lead_id: insertResult.rows[0].id,
          owner_name: owner_name || null,
          message: `New lead created with email: ${owner_email || 'none'}, contact: ${owner_name || 'none'}`
        })
      };
    }

    // Update existing lead with the captured email, name, and notes
    const lead = findResult.rows[0];
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (owner_email) {
      updates.push(`email = $${paramIdx++}`);
      values.push(owner_email);
    }
    if (owner_name) {
      updates.push(`contact_name = $${paramIdx++}`);
      values.push(owner_name);
    }
    if (business_name) {
      updates.push(`business_name = $${paramIdx++}`);
      values.push(business_name);
    }
    updates.push(`updated_at = NOW()`);

    if (updates.length > 1) {
      values.push(lead.id);
      await pool.query(
        `UPDATE lf_leads SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
        values
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        action: 'updated',
        lead_id: lead.id,
        previous_email: lead.email || null,
        new_email: owner_email || lead.email,
        owner_name: owner_name || null,
        business_name: business_name || lead.business_name,
        after_hours_info: after_hours_info || null,
        message: owner_email
          ? `Updated lead ${lead.id} email: ${lead.email || 'none'} → ${owner_email}, contact: ${owner_name || 'unknown'}`
          : `Lead ${lead.id} found but no new email provided`
      })
    };
  } catch (error) {
    console.error('Voice callback error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process callback', message: error.message })
    };
  }
};
