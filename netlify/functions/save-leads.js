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
    const { leads, city, industry } = JSON.parse(event.body);

    if (!leads || !Array.isArray(leads)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Leads array is required' })
      };
    }

    // Check user's lead limit
    const userResult = await pool.query(
      'SELECT leads_used, leads_limit, plan FROM users WHERE id = $1',
      [decoded.userId]
    );
    const user = userResult.rows[0];

    if (user.leads_used + leads.length > user.leads_limit) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Lead limit exceeded',
          message: `You have ${user.leads_limit - user.leads_used} leads remaining on your ${user.plan} plan`,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
        })
      };
    }

    let savedCount = 0;
    let duplicateCount = 0;

    for (const lead of leads) {
      try {
        await pool.query(
          `INSERT INTO leads (user_id, business_name, phone, email, address, city, state, industry, website, rating, reviews)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT DO NOTHING`,
          [
            decoded.userId,
            lead.business_name || lead.name || '',
            lead.phone || '',
            lead.email || '',
            lead.address || '',
            lead.city || city || '',
            lead.state || '',
            lead.industry || industry || '',
            lead.website || '',
            lead.rating || null,
            lead.reviews || 0
          ]
        );
        savedCount++;
      } catch (e) {
        duplicateCount++;
      }
    }

    // Update user's lead count
    await pool.query(
      'UPDATE users SET leads_used = leads_used + $1 WHERE id = $2',
      [savedCount, decoded.userId]
    );

    // Record scraped city
    if (city && industry) {
      await pool.query(
        `INSERT INTO user_scraped_cities (user_id, city, industry, lead_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, city, industry)
         DO UPDATE SET lead_count = user_scraped_cities.lead_count + $4, scraped_at = NOW()`,
        [decoded.userId, city, industry, savedCount]
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Saved ${savedCount} leads`,
        savedCount,
        duplicateCount,
        city,
        industry
      })
    };
  } catch (error) {
    console.error('Save leads error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to save leads', message: error.message })
    };
  }
};
