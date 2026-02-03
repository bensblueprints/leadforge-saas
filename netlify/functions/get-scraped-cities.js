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
    const industry = params.industry;

    let query = `
      SELECT city, industry, lead_count, scraped_at
      FROM user_scraped_cities WHERE user_id = $1
    `;
    const values = [decoded.userId];

    if (industry) {
      query += ' AND industry = $2';
      values.push(industry);
    }

    query += ' ORDER BY scraped_at DESC';

    const result = await pool.query(query, values);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        scrapedCities: result.rows
      })
    };
  } catch (error) {
    console.error('Get scraped cities error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get scraped cities', message: error.message })
    };
  }
};
