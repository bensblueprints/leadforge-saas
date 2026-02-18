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
    const params = event.queryStringParameters || {};
    const limit = parseInt(params.limit) || 50;
    const offset = parseInt(params.offset) || 0;
    const industry = params.industry;
    const city = params.city;
    const synced = params.synced;
    const search = params.search;

    let query = `
      SELECT id, business_name, phone, email, address, city, state, industry,
             website, rating, reviews, ghl_synced, ghl_contact_id, created_at
      FROM lf_leads WHERE user_id = $1
    `;
    const values = [decoded.userId];
    let paramIndex = 2;

    if (search) {
      query += ` AND (business_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex} OR address ILIKE $${paramIndex} OR city ILIKE $${paramIndex} OR state ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    if (industry) {
      query += ` AND industry = $${paramIndex}`;
      values.push(industry);
      paramIndex++;
    }

    if (city) {
      query += ` AND city ILIKE $${paramIndex}`;
      values.push(`%${city}%`);
      paramIndex++;
    }

    if (synced !== undefined) {
      query += ` AND ghl_synced = $${paramIndex}`;
      values.push(synced === 'true');
      paramIndex++;
    }

    // Build count query with same filters (without LIMIT/OFFSET)
    let countQuery = 'SELECT COUNT(*) as total FROM lf_leads WHERE user_id = $1';
    const countValues = [decoded.userId];
    let countParamIndex = 2;

    if (search) {
      countQuery += ` AND (business_name ILIKE $${countParamIndex} OR email ILIKE $${countParamIndex} OR phone ILIKE $${countParamIndex} OR address ILIKE $${countParamIndex} OR city ILIKE $${countParamIndex} OR state ILIKE $${countParamIndex})`;
      countValues.push(`%${search}%`);
      countParamIndex++;
    }
    if (industry) {
      countQuery += ` AND industry = $${countParamIndex}`;
      countValues.push(industry);
      countParamIndex++;
    }
    if (city) {
      countQuery += ` AND city ILIKE $${countParamIndex}`;
      countValues.push(`%${city}%`);
      countParamIndex++;
    }
    if (synced !== undefined) {
      countQuery += ` AND ghl_synced = $${countParamIndex}`;
      countValues.push(synced === 'true');
      countParamIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);

    const [result, countResult] = await Promise.all([
      pool.query(query, values),
      pool.query(countQuery, countValues)
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        leads: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      })
    };
  } catch (error) {
    console.error('Get leads error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get leads', message: error.message })
    };
  }
};
