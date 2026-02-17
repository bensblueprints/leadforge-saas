const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadforge-secret-key-2024';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
}

function extractState(address) {
  const m = address?.match(/,\s*([A-Z]{2})\s*\d{5}/);
  return m ? m[1] : '';
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
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { prospects, industry } = JSON.parse(event.body || '{}');

    if (!prospects || !Array.isArray(prospects) || prospects.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'prospects array is required' })
      };
    }

    // Check leads limit
    const userResult = await pool.query(
      'SELECT leads_used, leads_limit FROM lf_users WHERE id = $1',
      [decoded.userId]
    );
    if (userResult.rows.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'User not found' }) };
    }
    const user = userResult.rows[0];
    const remaining = user.leads_limit === -1 ? Infinity : user.leads_limit - user.leads_used;

    let added = 0;
    const errors = [];

    for (const p of prospects) {
      if (remaining !== Infinity && added >= remaining) break;

      const business_name = p.business_name || p.name;
      const address = p.address || '';
      const place_id = p.place_id || null;
      const lat = p.lat ?? null;
      const lng = p.lng ?? null;

      if (!business_name) {
        errors.push({ prospect: p, error: 'Missing business_name' });
        continue;
      }

      // Skip if already added (by place_id or business_name+address)
      let existing = { rows: [] };
      if (place_id) {
        existing = await pool.query(
          'SELECT id FROM lf_leads WHERE user_id = $1 AND place_id = $2',
          [decoded.userId, place_id]
        );
      }
      if (existing.rows.length === 0) {
        existing = await pool.query(
          'SELECT id FROM lf_leads WHERE user_id = $1 AND business_name = $2 AND COALESCE(address, \'\') = COALESCE($3, \'\')',
          [decoded.userId, business_name, address]
        );
      }

      if (existing.rows.length > 0) {
        errors.push({ prospect: business_name, error: 'Already added' });
        continue;
      }

      try {
        await pool.query(
          `INSERT INTO lf_leads (
            user_id, business_name, phone, email, address, city, state, industry,
            website, rating, reviews, place_id, lat, lng
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            decoded.userId,
            business_name,
            p.phone || '',
            p.email || '',
            address,
            p.city || (address ? address.split(',')[0]?.trim() : ''),
            p.state || extractState(address),
            industry || p.industry || '',
            p.website || '',
            p.rating || 0,
            p.reviews || 0,
            place_id,
            lat,
            lng
          ]
        );
        added++;
      } catch (err) {
        if (!err.message?.includes('duplicate')) {
          errors.push({ prospect: business_name, error: err.message });
        }
      }
    }

    if (added > 0) {
      await pool.query(
        'UPDATE lf_users SET leads_used = leads_used + $1, updated_at = NOW() WHERE id = $2',
        [added, decoded.userId]
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        added,
        totalRequested: prospects.length,
        errors: errors.length > 0 ? errors : undefined
      })
    };
  } catch (error) {
    console.error('Add prospects error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to add prospects', message: error.message })
    };
  }
};
